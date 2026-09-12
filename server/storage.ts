/**
 * Disk persistence: one JSON file per floor, plus a buildings registry.
 *
 * Per-floor files mean two people editing different floors never touch the same file,
 * and everything is written sorted and pretty-printed so `git diff` after an edit shows
 * the change you actually made rather than a reshuffled blob.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  BuildingsFile,
  FloorGraphFile,
  type Building,
  type Feature,
  type GraphEdge,
  type GraphNode,
  type Project,
} from '../src/model/types'

export const DATA_DIR = path.resolve(process.cwd(), 'data')
const GRAPH_DIR = path.join(DATA_DIR, 'graph')
const BUILDINGS_FILE = path.join(DATA_DIR, 'buildings.json')
export const FLOORPLANS_DIR = path.join(DATA_DIR, 'floorplans')

/** `GHC:4` -> `{ buildingId: 'GHC', floorKey: '4' }` */
export function splitFloorId(floorId: string): { buildingId: string; floorKey: string } {
  const idx = floorId.indexOf(':')
  if (idx < 0) throw new Error(`Malformed floor id: ${floorId}`)
  return { buildingId: floorId.slice(0, idx), floorKey: floorId.slice(idx + 1) }
}

/** Keep ids from escaping the data directory or producing illegal filenames. */
function safeSegment(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]/g, '_')
  if (!cleaned || cleaned === '.' || cleaned === '..') {
    throw new Error(`Unsafe path segment: ${value}`)
  }
  return cleaned
}

export function floorFilePath(floorId: string): string {
  const { buildingId, floorKey } = splitFloorId(floorId)
  return path.join(GRAPH_DIR, safeSegment(buildingId), `${safeSegment(floorKey)}.json`)
}

async function readJson(file: string): Promise<unknown | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new Error(`Could not read ${path.relative(DATA_DIR, file)}: ${(err as Error).message}`, {
      cause: err,
    })
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

/**
 * Assemble the whole dataset. Floors with no graph file yet simply contribute nothing,
 * which is the normal state for a floor whose plan has been uploaded but not traced.
 */
export async function loadProject(): Promise<Project> {
  const raw = await readJson(BUILDINGS_FILE)
  if (!raw) return { buildings: [], features: [], nodes: {}, edges: {} }

  const parsed = BuildingsFile.safeParse(raw)
  if (!parsed.success) {
    throw new Error(`data/buildings.json is invalid: ${parsed.error.issues[0]?.message}`)
  }

  const project: Project = {
    buildings: parsed.data.buildings,
    features: parsed.data.features,
    nodes: {},
    edges: {},
  }

  for (const building of project.buildings) {
    for (const floor of building.floors) {
      const fileRaw = await readJson(floorFilePath(floor.id))
      if (!fileRaw) continue

      const file = FloorGraphFile.safeParse(fileRaw)
      if (!file.success) {
        throw new Error(
          `data/graph for floor ${floor.id} is invalid: ${file.error.issues[0]?.message}`,
        )
      }
      for (const node of file.data.nodes) project.nodes[node.id] = node
      for (const edge of file.data.edges) project.edges[edge.id] = edge
    }
  }

  return project
}

export async function saveBuildings(buildings: Building[], features: Feature[]): Promise<void> {
  await writeJson(BUILDINGS_FILE, {
    buildings: [...buildings].sort(byId),
    features: [...features].sort(byId),
  })
}

export async function saveFloorGraph(
  floorId: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
): Promise<void> {
  await writeJson(floorFilePath(floorId), {
    floorId,
    nodes: [...nodes].sort(byId),
    edges: [...edges].sort(byId),
  })
}

/**
 * Split a whole project back into per-floor files. Cross-floor edges are owned by the
 * file of their `from` node, so every edge lands in exactly one file.
 */
export async function saveProject(project: Project): Promise<void> {
  await saveBuildings(project.buildings, project.features)

  const byFloor = new Map<string, { nodes: GraphNode[]; edges: GraphEdge[] }>()
  for (const building of project.buildings) {
    for (const floor of building.floors) {
      byFloor.set(floor.id, { nodes: [], edges: [] })
    }
  }

  for (const node of Object.values(project.nodes)) {
    byFloor.get(node.floorId)?.nodes.push(node)
  }
  for (const edge of Object.values(project.edges)) {
    const owner = project.nodes[edge.from]?.floorId
    if (owner) byFloor.get(owner)?.edges.push(edge)
  }

  for (const [floorId, contents] of byFloor) {
    await saveFloorGraph(floorId, contents.nodes, contents.edges)
  }
}

function byId(a: { id: string }, b: { id: string }): number {
  return a.id.localeCompare(b.id)
}

/**
 * Human-readable names, derived rather than typed.
 *
 * The scaling trick is to name FEATURES, not nodes. There are tens of thousands of
 * hallway corners and nobody will ever name them; there are a couple of hundred named
 * corridors, stairwells, bridges and exits. Name "the Helix" once and every node on it
 * reads well, because labels are generated from the feature, the floor, and the nearest
 * landmark reachable through the graph.
 *
 * Precedence: curated name -> room number -> adjacent room -> adjacent exit ->
 * named feature -> between two landmarks -> bare fallback.
 */
import type { Building, Feature, GraphNode, Project } from './types'
import { buildingOfFloor, findFloor } from './types'

/** How far to look for a landmark before giving up, in metres of graph distance. */
const LANDMARK_SEARCH_RADIUS_M = 45

export interface Labeler {
  labelFor(node: GraphNode): string
  shortLabelFor(node: GraphNode): string
}

/**
 * Build a labeler for a project.
 *
 * The index is built on first use rather than per call, because labels have to be
 * globally unique: two corners off the same room both derive "hallway outside Gates 4401",
 * and two identical search results are useless. Collisions can only be detected by
 * labelling everything, so the first request labels the whole graph and then
 * disambiguates. Each node's landmark search is radius-limited, so the cost scales with
 * local density rather than with the size of the graph.
 */
export function createLabeler(project: Project): Labeler {
  const adjacency = buildUndirectedAdjacency(project)
  const features = new Map(project.features.map((f) => [f.id, f]))
  let index: Map<string, string> | null = null

  function resolve(): Map<string, string> {
    if (index) return index
    const raw = new Map<string, string>()
    for (const node of Object.values(project.nodes)) {
      raw.set(node.id, deriveLabel(project, node, adjacency, features))
    }
    index = disambiguate(project, raw)
    return index
  }

  function label(node: GraphNode): string {
    return resolve().get(node.id) ?? deriveLabel(project, node, adjacency, features)
  }

  return {
    labelFor: label,
    shortLabelFor: (node) => shorten(project, node, label(node)),
  }
}

/**
 * Make colliding labels distinguishable: first by floor when that separates them, then by
 * compass bearing from the centre of the colliding group.
 */
function disambiguate(project: Project, raw: Map<string, string>): Map<string, string> {
  const groups = new Map<string, string[]>()
  for (const [id, label] of raw) {
    const group = groups.get(label)
    if (group) group.push(id)
    else groups.set(label, [id])
  }

  const out = new Map(raw)

  for (const [label, ids] of groups) {
    if (ids.length < 2) continue

    // If the group spans floors, naming the floor is the most useful distinction.
    const floorKeys = new Set(ids.map((id) => floorKeyOf(project, project.nodes[id])))
    const byFloor = floorKeys.size > 1

    // Remaining ties on one floor get a compass bearing from the group's centre.
    const centroidX = ids.reduce((sum, id) => sum + project.nodes[id].x, 0) / ids.length
    const centroidY = ids.reduce((sum, id) => sum + project.nodes[id].y, 0) / ids.length

    const perFloorCounts = new Map<string, number>()
    for (const id of ids) {
      const key = floorKeyOf(project, project.nodes[id])
      perFloorCounts.set(key, (perFloorCounts.get(key) ?? 0) + 1)
    }

    for (const id of ids) {
      const node = project.nodes[id]
      const floorKey = floorKeyOf(project, node)
      const parts: string[] = []
      if (byFloor) parts.push(`floor ${floorKey}`)
      if ((perFloorCounts.get(floorKey) ?? 0) > 1) {
        parts.push(bearing(node.x - centroidX, node.y - centroidY))
      }
      if (parts.length > 0) out.set(id, `${label} (${parts.join(', ')})`)
    }
  }

  return out
}

/** Eight-point compass. Image y grows downward, so north is negative y. */
function bearing(dx: number, dy: number): string {
  if (dx === 0 && dy === 0) return 'centre'
  const angle = (Math.atan2(-dy, dx) * 180) / Math.PI
  const points = ['east', 'north-east', 'north', 'north-west', 'west', 'south-west', 'south', 'south-east']
  const index = Math.round(((angle + 360) % 360) / 45) % 8
  return points[index]
}

/** One-off convenience. Prefer createLabeler when labelling more than a few nodes. */
export function labelFor(project: Project, node: GraphNode): string {
  return createLabeler(project).labelFor(node)
}

/* ------------------------------------------------------------------ */

type Adjacency = Map<string, { to: string; distanceM: number }[]>

function buildUndirectedAdjacency(project: Project): Adjacency {
  const adj: Adjacency = new Map()
  const link = (a: string, b: string, d: number) => {
    let list = adj.get(a)
    if (!list) {
      list = []
      adj.set(a, list)
    }
    list.push({ to: b, distanceM: d })
  }
  // Labelling is about proximity, not traversability, so ignore direction here.
  for (const edge of Object.values(project.edges)) {
    link(edge.from, edge.to, edge.distanceM)
    link(edge.to, edge.from, edge.distanceM)
  }
  return adj
}

function deriveLabel(
  project: Project,
  node: GraphNode,
  adjacency: Adjacency,
  features: Map<string, Feature>,
): string {
  const building = buildingOfFloor(project, node.floorId)
  const floorKey = floorKeyOf(project, node)
  const short = shortNameOf(building)
  const feature = node.featureId ? features.get(node.featureId) : undefined

  // 1. Curated name wins outright.
  if (node.name) {
    return node.roomNumber ? `${node.name} (${short} ${node.roomNumber})` : node.name
  }

  // 2. The node is a room with a number.
  if (node.roomNumber) return `${short} ${node.roomNumber}`

  // 3. Entrances name the place they open onto.
  if (node.kind === 'entrance') {
    const full = building?.name ?? short
    return feature ? `${full} — ${feature.name} entrance` : `${full} — entrance`
  }

  // 4. Vertical circulation. A landing between levels says so explicitly.
  if (node.kind === 'stairs' || node.kind === 'elevator' || node.kind === 'ramp') {
    const between = parseMidFloor(floorKey)
    const name = feature?.name ?? defaultVerticalName(node)
    if (between) return `${short} — ${name}, between ${between[0]} and ${between[1]}`
    return `${short} ${floorKey} — ${name}`
  }

  if (node.kind === 'restroom') return `${short} ${floorKey} — restroom`

  // 5. Hallway corners, the overwhelming majority. Look outward for something named.
  const landmarks = findLandmarks(project, node, adjacency, features)

  const room = landmarks.find((l) => l.kind === 'room')
  if (room) return `hallway outside ${short} ${room.text}`

  const exit = landmarks.find((l) => l.kind === 'exit')
  if (exit) return `hallway by the exit to ${exit.text}`

  if (feature) {
    const near = landmarks[0]
    return near
      ? `${short} ${floorKey} — ${feature.name}, near ${near.text}`
      : `${short} ${floorKey} — ${feature.name}`
  }

  if (landmarks.length >= 2) {
    return `${short} ${floorKey} — hallway between ${landmarks[0].text} and ${landmarks[1].text}`
  }
  if (landmarks.length === 1) {
    return `${short} ${floorKey} — hallway near ${landmarks[0].text}`
  }

  // 6. Nothing nearby is named yet. The ID is at least readable.
  return `${short} ${floorKey} — ${node.id}`
}

interface Landmark {
  kind: 'room' | 'exit' | 'feature' | 'named'
  text: string
  distanceM: number
}

/**
 * Nearest named things, by graph distance rather than straight line — a room on the
 * far side of a wall is not a useful landmark even when it is metres away.
 */
function findLandmarks(
  project: Project,
  origin: GraphNode,
  adjacency: Adjacency,
  features: Map<string, Feature>,
): Landmark[] {
  const found: Landmark[] = []
  const best = new Map<string, number>([[origin.id, 0]])
  // Small radius, so a plain sorted frontier beats the overhead of a heap here.
  const frontier: { id: string; d: number }[] = [{ id: origin.id, d: 0 }]

  while (frontier.length > 0) {
    frontier.sort((a, b) => a.d - b.d)
    const current = frontier.shift()!
    if (current.d > LANDMARK_SEARCH_RADIUS_M) break

    const node = project.nodes[current.id]
    if (node && node.id !== origin.id) {
      const landmark = asLandmark(node, current.d, features)
      if (landmark) found.push(landmark)
    }

    for (const arc of adjacency.get(current.id) ?? []) {
      const next = current.d + arc.distanceM
      if (next < (best.get(arc.to) ?? Infinity) && next <= LANDMARK_SEARCH_RADIUS_M) {
        best.set(arc.to, next)
        frontier.push({ id: arc.to, d: next })
      }
    }
  }

  found.sort((a, b) => a.distanceM - b.distanceM)
  return found
}

function asLandmark(
  node: GraphNode,
  distanceM: number,
  features: Map<string, Feature>,
): Landmark | null {
  if (node.roomNumber) return { kind: 'room', text: node.roomNumber, distanceM }

  if (node.kind === 'entrance') {
    const feature = node.featureId ? features.get(node.featureId) : undefined
    if (feature) return { kind: 'exit', text: feature.name, distanceM }
  }

  if (node.name) return { kind: 'named', text: node.name, distanceM }

  if (node.kind === 'stairs' || node.kind === 'elevator') {
    const feature = node.featureId ? features.get(node.featureId) : undefined
    return {
      kind: 'feature',
      text: feature ? feature.name : defaultVerticalName(node),
      distanceM,
    }
  }

  return null
}

function defaultVerticalName(node: GraphNode): string {
  if (node.kind === 'elevator') return 'the elevator'
  if (node.kind === 'ramp') return 'the ramp'
  return 'the stairwell'
}

/** `4M5` -> ['4', '5'], for landings that sit between two levels. */
function parseMidFloor(floorKey: string): [string, string] | null {
  const m = /^([A-Za-z0-9.]+)M([A-Za-z0-9.]+)$/.exec(floorKey)
  return m ? [m[1], m[2]] : null
}

function floorKeyOf(project: Project, node: GraphNode): string {
  return findFloor(project, node.floorId)?.floorKey ?? node.floorId.split(':').pop() ?? '?'
}

function shortNameOf(building: Building | undefined): string {
  return building?.shortName ?? building?.id ?? '?'
}

/** Compact form for turn-by-turn text, where the full label is too long to read. */
function shorten(project: Project, node: GraphNode, full: string): string {
  const building = buildingOfFloor(project, node.floorId)
  const code = building?.id ?? '?'
  const short = shortNameOf(building)

  if (node.roomNumber) return `${code} ${node.roomNumber}`

  // "hallway outside Doherty 2315" -> "outside DH 2315".
  // The trailing group keeps any disambiguator, so the room number is never what gets
  // dropped: "hallway outside Gates 4401 (west)" -> "outside GHC 4401 (west)".
  const outside = /^hallway outside .+?\s(\S+?)(\s\([^)]*\))?$/.exec(full)
  if (outside) return `outside ${code} ${outside[1]}${outside[2] ?? ''}`

  if (short !== code && full.startsWith(`${short} `)) {
    return `${code}${full.slice(short.length)}`
  }
  return full
}

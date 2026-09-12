/**
 * One-time backfill for the `kind` field on edges.
 *
 *   npx tsx scripts/backfill-edge-kinds.ts [--dry]
 *
 * Edge kind used to be worked out on the fly from the two endpoints. It is now stored and
 * entered by hand, so edges written before the change have no value. This fills those in
 * once, using the old rule as a starting point, and writes the result to disk.
 *
 * It only touches edges with NO kind set. An edge you have corrected by hand is left
 * alone, so running it again is safe and your fixes survive.
 *
 * The inference rule lives here, not in the app, on purpose: this is the only place it
 * should ever run. Nothing recomputes kind at load or render time.
 */
import fs from 'node:fs/promises'
import path from 'node:path'

const DATA_DIR = path.resolve(process.cwd(), 'data')
const GRAPH_DIR = path.join(DATA_DIR, 'graph')
const dryRun = process.argv.includes('--dry')

/** Rise below which two floors count as the same level — see the note on the seam case. */
const LEVEL_TOLERANCE_M = 0.5

type EdgeKind = 'walk' | 'stairs' | 'elevator' | 'ramp'

interface RawNode {
  id: string
  floorId: string
  kind: string
}
interface RawEdge {
  id: string
  from: string
  to: string
  kind?: EdgeKind
}
interface RawFloorFile {
  floorId: string
  nodes: RawNode[]
  edges: RawEdge[]
}

/**
 * The historical rule, with the cross-building bug corrected: classify by actual RISE
 * rather than by the two floors merely having different ids. Gates 4, Wean 4, NSH 4 and
 * Doherty B all sit at elevation 0, so a doorway between two of them is a walk — the old
 * floor-id test called every such seam a staircase.
 */
function inferKind(a: RawNode, b: RawNode, elevations: Map<string, number>): EdgeKind {
  const riseM = Math.abs((elevations.get(a.floorId) ?? 0) - (elevations.get(b.floorId) ?? 0))

  if (riseM > LEVEL_TOLERANCE_M) {
    if (a.kind === 'elevator' || b.kind === 'elevator') return 'elevator'
    if (a.kind === 'ramp' || b.kind === 'ramp') return 'ramp'
    return 'stairs'
  }

  if (a.kind === 'ramp' || b.kind === 'ramp') return 'ramp'
  return 'walk'
}

async function main(): Promise<void> {
  const buildings = JSON.parse(await fs.readFile(path.join(DATA_DIR, 'buildings.json'), 'utf8')) as {
    buildings: Array<{ floors: Array<{ id: string; elevationM: number }> }>
  }
  const elevations = new Map<string, number>()
  for (const building of buildings.buildings) {
    for (const floor of building.floors) elevations.set(floor.id, floor.elevationM)
  }

  // Nodes are needed to classify an edge, and a cross-floor edge's endpoints live in
  // different files, so read every file before deciding anything.
  const files = await graphFiles()
  const parsed = new Map<string, RawFloorFile>()
  const nodes = new Map<string, RawNode>()
  for (const file of files) {
    const data = JSON.parse(await fs.readFile(file, 'utf8')) as RawFloorFile
    parsed.set(file, data)
    for (const node of data.nodes) nodes.set(node.id, node)
  }

  const counts: Record<string, number> = {}
  let filled = 0
  let alreadySet = 0
  let unresolved = 0
  const touched: string[] = []

  for (const [file, data] of parsed) {
    let changed = false
    for (const edge of data.edges) {
      if (edge.kind) {
        alreadySet++
        continue
      }
      const a = nodes.get(edge.from)
      const b = nodes.get(edge.to)
      if (!a || !b) {
        // A dangling edge cannot be classified; leave it for validation to report.
        unresolved++
        continue
      }
      edge.kind = inferKind(a, b, elevations)
      counts[edge.kind] = (counts[edge.kind] ?? 0) + 1
      filled++
      changed = true
    }
    if (changed) {
      touched.push(path.relative(DATA_DIR, file))
      if (!dryRun) await writeFloorFile(file, data)
    }
  }

  console.log(`${dryRun ? '[dry run] would fill' : 'filled'} ${filled} edge kinds`, counts)
  console.log(`left alone (already set by hand): ${alreadySet}`)
  if (unresolved > 0) console.log(`skipped (dangling endpoint): ${unresolved}`)
  console.log(`files ${dryRun ? 'that would change' : 'written'}: ${touched.length}`)
  for (const file of touched) console.log(`  ${file}`)
}

async function graphFiles(): Promise<string[]> {
  const out: string[] = []
  for (const dir of await fs.readdir(GRAPH_DIR, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue
    for (const name of await fs.readdir(path.join(GRAPH_DIR, dir.name))) {
      if (name.endsWith('.json')) out.push(path.join(GRAPH_DIR, dir.name, name))
    }
  }
  return out.sort()
}

/**
 * Rewrite with the same shape the server uses — sorted, two-space indented, trailing
 * newline — so the diff shows only the added kind lines.
 */
async function writeFloorFile(file: string, data: RawFloorFile): Promise<void> {
  const byId = (x: { id: string }, y: { id: string }) => x.id.localeCompare(y.id)
  const ordered = {
    floorId: data.floorId,
    nodes: [...data.nodes].sort(byId),
    edges: [...data.edges].sort(byId).map(reorderEdge),
  }
  await fs.writeFile(file, `${JSON.stringify(ordered, null, 2)}\n`, 'utf8')
}

/** Keep key order matching the schema so the files stay uniform. */
function reorderEdge(edge: RawEdge): RawEdge {
  const { id, from, to, ...rest } = edge as RawEdge & Record<string, unknown>
  const { bidirectional, kind, distanceM, tiredIndex, wheelchair, ...extra } = rest
  return { id, from, to, bidirectional, kind, distanceM, tiredIndex, wheelchair, ...extra } as RawEdge
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

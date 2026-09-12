/**
 * Stable, human-readable IDs: `GHC-4-H07` is hallway junction 7 on Gates 4.
 *
 * Readable IDs matter because these end up in JSON diffs, in validation messages, and
 * in bug reports. A UUID tells you nothing when a route looks wrong.
 */
import type { NodeKind, Project } from './types'

/**
 * One letter per node kind. Note elevator is `V` (vertical lift), not `E`, so it
 * doesn't collide with entrance.
 */
const KIND_CODE: Record<NodeKind, string> = {
  room: 'R',
  corner: 'H', // hallway junction
  stairs: 'S',
  elevator: 'V',
  ramp: 'P',
  door: 'D',
  entrance: 'E',
  restroom: 'W',
  poi: 'O',
}

export function nodeKindCode(kind: NodeKind): string {
  return KIND_CODE[kind]
}

/** Floor keys appear inside '-' separated IDs, so strip any separators they contain. */
function sanitizeFloorKey(floorKey: string): string {
  return floorKey.replace(/[^A-Za-z0-9.]/g, '')
}

/**
 * A floor key for something between two levels: floors 4 and 5 -> `4M5`.
 * Used for stair landings, where "between 4 and 5" is the only honest answer.
 */
export function midFloorKey(lower: string, upper: string): string {
  return `${sanitizeFloorKey(lower)}M${sanitizeFloorKey(upper)}`
}

/** Next free node ID for this building/floor/kind, e.g. `GHC-4-H07`. */
export function nextNodeId(
  project: Project,
  buildingId: string,
  floorKey: string,
  kind: NodeKind,
): string {
  const prefix = `${buildingId}-${sanitizeFloorKey(floorKey)}-${nodeKindCode(kind)}`
  const pattern = new RegExp(`^${escapeRegExp(prefix)}(\\d+)$`)

  let max = 0
  for (const id of Object.keys(project.nodes)) {
    const m = pattern.exec(id)
    if (m) max = Math.max(max, Number(m[1]))
  }

  const seq = max + 1
  return `${prefix}${String(seq).padStart(2, '0')}`
}

/**
 * Edge IDs are derived from their endpoints, which makes them idempotent: connecting
 * the same two nodes twice can't create a duplicate edge.
 */
export function makeEdgeId(from: string, to: string): string {
  return `${from}->${to}`
}

/** True if an edge already joins these two nodes, in either direction. */
export function findExistingEdge(project: Project, a: string, b: string): string | null {
  if (project.edges[makeEdgeId(a, b)]) return makeEdgeId(a, b)
  if (project.edges[makeEdgeId(b, a)]) return makeEdgeId(b, a)
  return null
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export interface ParsedNodeId {
  buildingId: string
  floorKey: string
  kindCode: string
  seq: number
}

/** Best-effort parse, for diagnostics. Returns null for IDs we didn't generate. */
export function parseNodeId(id: string): ParsedNodeId | null {
  const m = /^([A-Za-z0-9]+)-([A-Za-z0-9.M]+)-([A-Z])(\d+)$/.exec(id)
  if (!m) return null
  return { buildingId: m[1], floorKey: m[2], kindCode: m[3], seq: Number(m[4]) }
}

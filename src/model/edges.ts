/**
 * Everything about an edge that ISN'T stored: its kind, its default tiredness,
 * its estimated duration, and its routing cost.
 *
 * Edge kind is derived from the two node kinds rather than stored, because the nodes
 * already carry the information — two stairs nodes on different floors can only be a
 * staircase. That keeps the stored edge at exactly three fields.
 */
import type { GraphEdge, GraphNode, NodeKind, Project } from './types'

export type EdgeKind = 'walk' | 'stairs' | 'elevator' | 'ramp'

/** Tiredness multiplier per kind. Applied to distance, so it scales with how far you go. */
export const TIRED_INDEX: Record<EdgeKind, number> = {
  elevator: 0.25,
  walk: 1,
  ramp: 1.5,
  stairs: 2,
}

/**
 * Speeds used only to estimate a duration for display. Never an input to the search,
 * so these are free to tune.
 */
export const SPEED_MPS: Record<EdgeKind, number> = {
  walk: 1.4,
  stairs: 0.5,
  elevator: 1.0,
  ramp: 1.2,
}

const VERTICAL_KINDS: ReadonlySet<NodeKind> = new Set<NodeKind>(['stairs', 'elevator', 'ramp'])

export function isVerticalNodeKind(kind: NodeKind): boolean {
  return VERTICAL_KINDS.has(kind)
}

/**
 * Infer an edge's kind from its endpoints.
 *
 * Cross-floor edges must be vertical circulation of some sort, so when the endpoints
 * disagree we take the more specific kind rather than guessing "walk" — you cannot
 * change floors by walking on the level.
 */
export function inferEdgeKind(a: GraphNode, b: GraphNode): EdgeKind {
  const crossFloor = a.floorId !== b.floorId

  if (crossFloor) {
    if (a.kind === 'elevator' || b.kind === 'elevator') return 'elevator'
    if (a.kind === 'ramp' || b.kind === 'ramp') return 'ramp'
    return 'stairs'
  }

  if (a.kind === 'ramp' || b.kind === 'ramp') return 'ramp'
  return 'walk'
}

/** Kind of an existing edge, looked up through the project. */
export function edgeKind(project: Project, edge: GraphEdge): EdgeKind | null {
  const a = project.nodes[edge.from]
  const b = project.nodes[edge.to]
  if (!a || !b) return null
  return inferEdgeKind(a, b)
}

export function defaultTiredIndex(kind: EdgeKind): number {
  return TIRED_INDEX[kind]
}

/** Stairs are the only kind that is inaccessible by default. */
export function defaultWheelchair(kind: EdgeKind): boolean {
  return kind !== 'stairs'
}

/** Display-only duration estimate. */
export function estimateSeconds(distanceM: number, kind: EdgeKind): number {
  return distanceM / SPEED_MPS[kind]
}

/**
 * The routing cost of traversing an edge.
 *
 *   cost = (1 + W * tiredIndex) * distanceM
 *
 * At W = 0 the tiredIndex cancels entirely and this is pure shortest distance. As W
 * rises, stairs (x2) are penalised and elevators (x0.25) become attractive. Stays
 * non-negative for every W >= 0, so Dijkstra is valid at any slider position.
 */
export function edgeCost(edge: Pick<GraphEdge, 'distanceM' | 'tiredIndex'>, w: number): number {
  return (1 + w * edge.tiredIndex) * edge.distanceM
}

/** How tiring an edge is, independent of the weight. Used for route readouts. */
export function edgeTiredness(edge: Pick<GraphEdge, 'distanceM' | 'tiredIndex'>): number {
  return edge.tiredIndex * edge.distanceM
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} sec`
  const mins = Math.round(seconds / 60)
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  return `${h} hr ${mins % 60} min`
}

export function formatDistance(meters: number): string {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(2)} km`
}

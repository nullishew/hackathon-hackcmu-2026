/**
 * Edge kinds, their defaults, and the routing cost.
 *
 * An edge's kind is STORED and entered by hand. Nothing infers it from geometry, floors or
 * elevations: whether a link is stairs is a fact about the link that the person tracing it
 * knows and the coordinates do not. It also means an edge between two buildings behaves
 * exactly like an edge inside one — there is no cross-building special case anywhere.
 */
import type { EdgeKind, GraphEdge } from './types'

export type { EdgeKind }

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

/** The kind of an edge. Stored, never inferred. */
export function edgeKind(edge: GraphEdge): EdgeKind {
  return edge.kind
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

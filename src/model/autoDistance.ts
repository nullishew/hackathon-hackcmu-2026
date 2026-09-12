/**
 * Suggested `distanceM` for a new edge — what the editor pre-fills so the three stored
 * fields mostly fill themselves.
 *
 * Plain geometry is right for level walking and for elevators, but wrong for stairs.
 * Stairwell nodes are plotted at the same spot on each floor plan (that is where the
 * stairwell *is*), so their straight-line 3D distance is just the rise — which would
 * systematically understate stairs and make them look artificially cheap to the router.
 * Real flights cover roughly two metres of tread per metre of rise, plus landings, so we
 * estimate the run instead of believing the stacked coordinates.
 */
import { inferEdgeKind } from './edges'
import { worldPosition } from './geometry'
import type { GraphNode, Project } from './types'

/**
 * Horizontal run per metre of rise on a staircase. A 7in riser with an 11in tread is
 * about 1.57; landings and switchbacks push a realistic stairwell nearer 2.
 */
export const STAIR_RUN_PER_RISE = 2

export interface DistanceSuggestion {
  distanceM: number
  /** How it was derived, so the editor can say why and flag estimates. */
  basis: 'geometric' | 'stair-estimate' | 'elevator-rise'
  note?: string
}

/**
 * Returns null when either floor is uncalibrated — the editor must prompt for
 * calibration rather than invent a number.
 */
export function suggestDistanceM(
  project: Project,
  a: GraphNode,
  b: GraphNode,
): DistanceSuggestion | null {
  const pa = worldPosition(project, a)
  const pb = worldPosition(project, b)
  if (!pa || !pb) return null

  const horizontal = Math.hypot(pb.x - pa.x, pb.z - pa.z)
  const rise = Math.abs(pb.y - pa.y)
  const geometric = Math.hypot(horizontal, rise)
  const kind = inferEdgeKind(a, b)

  if (kind === 'elevator') {
    // A shaft really is a vertical line; the rise is the honest distance.
    return { distanceM: geometric, basis: 'elevator-rise' }
  }

  if (kind === 'stairs') {
    const estimatedRun = Math.max(horizontal, rise * STAIR_RUN_PER_RISE)
    const estimated = Math.hypot(estimatedRun, rise)
    if (estimated > geometric) {
      return {
        distanceM: estimated,
        basis: 'stair-estimate',
        note: `Estimated from a ${rise.toFixed(1)} m rise — stacked stairwell nodes have no run of their own.`,
      }
    }
  }

  return { distanceM: geometric, basis: 'geometric' }
}

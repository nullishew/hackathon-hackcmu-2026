/**
 * Choosing a route endpoint by tapping the map.
 *
 * Separate from the map component so the selection maths can be tested directly, and so
 * the component file exports only components (which is what React fast refresh needs).
 */

/** Which endpoint a map tap should fill in. */
export type PickTarget = 'from' | 'to'

/** Screen-pixel radius within which a tap counts as hitting a point. */
export const TAP_RADIUS_PX = 18

/** A gesture that travels further than this was a pan, not a tap. */
export const TAP_SLOP_PX = 6

/**
 * The closest point to a target, or null if nothing is within `maxDistance`.
 *
 * Nearest-within-a-radius rather than first-hit: points cluster tightly in corridors, so
 * a tap between two of them should take the one actually closest to the finger.
 */
export function nearestPoint<T extends { x: number; y: number }>(
  points: readonly T[],
  target: { x: number; y: number },
  maxDistance: number,
): T | null {
  let best: T | null = null
  let bestDistance = maxDistance
  for (const point of points) {
    const distance = Math.hypot(point.x - target.x, point.y - target.y)
    if (distance < bestDistance) {
      bestDistance = distance
      best = point
    }
  }
  return best
}

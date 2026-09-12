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

/**
 * Did the gesture that just ended move far enough to be a drag rather than a click?
 *
 * Both the 2D map and the 3D stack listen for clicks on the same left button that also
 * pans or orbits the camera, and the browser raises a click on release however far the
 * pointer travelled. Without this check, orbiting the 3D view drops you into the 2D map.
 *
 * A null start means we never saw the press — the gesture began somewhere else — so treat
 * it as a drag. Refusing to act is the safe default: a missed click costs one more click,
 * an accidental one throws away what the user was looking at.
 */
export function isDragGesture(
  start: { x: number; y: number } | null,
  end: { x: number; y: number },
  slopPx: number = TAP_SLOP_PX,
): boolean {
  if (!start) return true
  return Math.hypot(end.x - start.x, end.y - start.y) > slopPx
}

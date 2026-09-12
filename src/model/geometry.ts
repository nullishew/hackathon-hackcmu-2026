/**
 * Coordinate plumbing: plan-image pixels -> floor-local metres -> shared world metres.
 *
 * World axes: X and Z are the ground plane (Z is the top-down "y" you see in the site
 * layout), Y is up and comes straight from the floor's elevationM. Keeping pixels in
 * storage and doing this conversion on read means re-calibrating a floor never
 * requires rewriting its nodes.
 */
import type { Building, Calibration, Floor, GraphNode, Project } from './types'
import { buildingOfFloor, findFloor } from './types'

export interface Vec3 {
  x: number
  y: number
  z: number
}

function rotate2d(x: number, z: number, deg: number): [number, number] {
  if (!deg) return [x, z]
  const r = (deg * Math.PI) / 180
  const c = Math.cos(r)
  const s = Math.sin(r)
  return [x * c - z * s, x * s + z * c]
}

/** Pixel position -> metres in the floor's own frame, before the building is placed. */
export function pixelToFloorLocal(
  node: Pick<GraphNode, 'x' | 'y'>,
  cal: Calibration,
): [number, number] {
  const lx = (node.x - cal.originX) / cal.pixelsPerMeter
  const lz = (node.y - cal.originY) / cal.pixelsPerMeter
  return rotate2d(lx, lz, cal.rotationDeg)
}

/**
 * Full world position of a node. Returns null when the floor has no calibration yet —
 * callers must handle that rather than silently treating pixels as metres.
 */
export function worldPosition(project: Project, node: GraphNode): Vec3 | null {
  const floor = findFloor(project, node.floorId)
  if (!floor?.calibration) return null
  const building = buildingOfFloor(project, node.floorId)
  if (!building) return null
  return worldPositionWith(node, floor, building)
}

export function worldPositionWith(
  node: Pick<GraphNode, 'x' | 'y'>,
  floor: Floor,
  building: Building,
): Vec3 | null {
  if (!floor.calibration) return null
  const [lx, lz] = pixelToFloorLocal(node, floor.calibration)
  const [rx, rz] = rotate2d(lx, lz, building.placement.rotationDeg)
  return {
    x: rx + building.placement.x,
    y: floor.elevationM,
    z: rz + building.placement.y,
  }
}

/**
 * The 3D distance between two nodes, in metres: horizontal run combined with the rise
 * between their floors. This is what fills in an edge's `distanceM` automatically.
 *
 * Returns null if either floor is uncalibrated, so the editor can prompt instead of
 * inventing a number.
 */
export function autoDistanceM(project: Project, a: GraphNode, b: GraphNode): number | null {
  const pa = worldPosition(project, a)
  const pb = worldPosition(project, b)
  if (!pa || !pb) return null
  const dx = pb.x - pa.x
  const dy = pb.y - pa.y
  const dz = pb.z - pa.z
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

/** Horizontal-only distance, for sanity checks and display. */
export function horizontalDistanceM(
  project: Project,
  a: GraphNode,
  b: GraphNode,
): number | null {
  const pa = worldPosition(project, a)
  const pb = worldPosition(project, b)
  if (!pa || !pb) return null
  return Math.hypot(pb.x - pa.x, pb.z - pa.z)
}

/**
 * Derive pixelsPerMeter from a drawn reference line of known real length.
 * This one interaction is what removes manual distance entry from the whole workflow.
 */
export function calibrationFromReferenceLine(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  realLengthM: number,
): { pixelsPerMeter: number } | { error: string } {
  if (realLengthM <= 0) return { error: 'Reference length must be greater than zero.' }
  const px = Math.hypot(p2.x - p1.x, p2.y - p1.y)
  if (px < 1) return { error: 'Reference line is too short to measure — draw a longer one.' }
  return { pixelsPerMeter: px / realLengthM }
}

/** A default calibration anchored at the image's top-left, for a freshly uploaded plan. */
export function defaultCalibration(pixelsPerMeter: number): Calibration {
  return { pixelsPerMeter, originX: 0, originY: 0, rotationDeg: 0 }
}

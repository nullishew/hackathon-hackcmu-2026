/**
 * Pure geometry for the 3D stack, separated from the React/three components so it can be
 * tested directly. Getting floor placement wrong is the failure that makes the stack look
 * like a squashed pile or puts the route beside the building instead of inside it, and
 * that is much easier to catch in a test than by squinting at a render.
 */
import * as THREE from 'three'
import { worldPositionWith } from '../model/geometry'
import { buildingOfFloor, findFloor, type Building, type Floor, type Project } from '../model/types'
import type { Route } from '../routing/route'

export interface PlacedFloor {
  floor: Floor
  building: Building
  /** World-space corners for image pixels (0,0), (W,0), (W,H), (0,H). */
  corners: THREE.Vector3[]
}

/**
 * Floor planes are built from their four world-space corners rather than a
 * position-plus-rotation, so calibration rotation and building placement come from the
 * same code that positions the nodes. A plane and the points drawn on it cannot disagree.
 */
export function placeFloors(project: Project, exaggeration: number): PlacedFloor[] {
  const out: PlacedFloor[] = []
  for (const building of project.buildings) {
    for (const floor of building.floors) {
      if (!floor.calibration || !floor.image) continue
      const { widthPx, heightPx } = floor.image
      const pixelCorners = [
        { x: 0, y: 0 },
        { x: widthPx, y: 0 },
        { x: widthPx, y: heightPx },
        { x: 0, y: heightPx },
      ]
      const corners: THREE.Vector3[] = []
      for (const pt of pixelCorners) {
        const world = worldPositionWith(pt, floor, building)
        if (!world) break
        corners.push(new THREE.Vector3(world.x, world.y * exaggeration, world.z))
      }
      if (corners.length === 4) out.push({ floor, building, corners })
    }
  }
  return out
}

export function buildQuad(corners: THREE.Vector3[]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  const positions = new Float32Array(
    [corners[0], corners[1], corners[2], corners[0], corners[2], corners[3]].flatMap((v) => [
      v.x,
      v.y,
      v.z,
    ]),
  )
  // Image V runs downward, so flip it to keep the plan the right way up.
  const uvs = new Float32Array([0, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0])
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.computeVertexNormals()
  return geometry
}

/** The route as one continuous polyline through the stack. */
export function routeToPoints(
  project: Project,
  route: Route,
  exaggeration: number,
): THREE.Vector3[] {
  const points: THREE.Vector3[] = []
  for (const nodeId of route.nodeIds) {
    const node = project.nodes[nodeId]
    if (!node) continue
    const floor = findFloor(project, node.floorId)
    const building = buildingOfFloor(project, node.floorId)
    if (!floor || !building) continue
    const world = worldPositionWith(node, floor, building)
    if (!world) continue
    // Lift the line slightly off the plane so it is never hidden inside it.
    points.push(new THREE.Vector3(world.x, world.y * exaggeration + 0.35, world.z))
  }
  return points
}

export function boundsOf(placed: PlacedFloor[]): { center: THREE.Vector3; radius: number } {
  const box = new THREE.Box3()
  for (const p of placed) {
    for (const corner of p.corners) box.expandByPoint(corner)
  }
  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())
  return { center, radius: Math.max(size.x, size.y, size.z) * 0.9 || 50 }
}

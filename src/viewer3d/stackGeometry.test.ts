import { describe, expect, it } from 'vitest'
import { gatesFixture } from '../model/fixtures'
import { worldPositionWith } from '../model/geometry'
import { buildingOfFloor, findFloor } from '../model/types'
import { defaultRouteOptions, findRoute } from '../routing/route'
import { boundsOf, buildQuad, placeFloors, routeToPoints } from './stackGeometry'

const project = gatesFixture()

describe('floor placement', () => {
  it('places one plane per calibrated floor with an image', () => {
    const placed = placeFloors(project, 1)
    expect(placed).toHaveLength(6)
  })

  it('sizes a plane from calibration — 1000 px at 10 px/m is 100 m across', () => {
    const [first] = placeFloors(project, 1)
    const width = first.corners[0].distanceTo(first.corners[1])
    const height = first.corners[1].distanceTo(first.corners[2])
    expect(width).toBeCloseTo(100, 5)
    expect(height).toBeCloseTo(60, 5)
  })

  it('stacks floors in elevation order, 4.5 m apart', () => {
    const placed = placeFloors(project, 1)
    const heights = placed.map((p) => p.corners[0].y)
    expect(heights).toEqual([0, 4.5, 9, 13.5, 18, 22.5])
  })

  it('applies vertical exaggeration to height only, never to the footprint', () => {
    const plain = placeFloors(project, 1)
    const tall = placeFloors(project, 3)
    expect(tall[5].corners[0].y).toBeCloseTo(plain[5].corners[0].y * 3, 5)
    // Footprint is untouched.
    expect(tall[0].corners[0].distanceTo(tall[0].corners[1])).toBeCloseTo(
      plain[0].corners[0].distanceTo(plain[0].corners[1]),
      5,
    )
  })

  it('skips floors that have no plan image or no calibration', () => {
    const partial = gatesFixture()
    partial.buildings[0].floors[0].image = undefined
    partial.buildings[0].floors[1].calibration = undefined
    expect(placeFloors(partial, 1)).toHaveLength(4)
  })
})

describe('plane geometry', () => {
  it('builds two triangles with matching UVs', () => {
    const [first] = placeFloors(project, 1)
    const geometry = buildQuad(first.corners)
    expect(geometry.getAttribute('position').count).toBe(6)
    expect(geometry.getAttribute('uv').count).toBe(6)
  })
})

describe('route in world space', () => {
  const result = findRoute(project, 'GHC-4-H01', 'GHC-9-H01', defaultRouteOptions)
  if (!result.ok) throw new Error(result.error)
  const route = result.route

  it('produces one point per node on the route', () => {
    const points = routeToPoints(project, route, 1)
    expect(points).toHaveLength(route.nodeIds.length)
  })

  it('climbs from the bottom floor to the top', () => {
    const points = routeToPoints(project, route, 1)
    expect(points[0].y).toBeLessThan(points[points.length - 1].y)
    // Six floors at 4.5 m, plus the small lift off the plane.
    expect(points[points.length - 1].y - points[0].y).toBeCloseTo(22.5, 1)
  })

  it('puts route points where the nodes actually are, not beside them', () => {
    const points = routeToPoints(project, route, 1)
    const node = project.nodes[route.nodeIds[0]]
    const floor = findFloor(project, node.floorId)!
    const building = buildingOfFloor(project, node.floorId)!
    const world = worldPositionWith(node, floor, building)!
    expect(points[0].x).toBeCloseTo(world.x, 5)
    expect(points[0].z).toBeCloseTo(world.z, 5)
  })

  it('lifts the line clear of the floor plane so it is never hidden inside it', () => {
    const points = routeToPoints(project, route, 1)
    const placed = placeFloors(project, 1)
    expect(points[0].y).toBeGreaterThan(placed[0].corners[0].y)
  })
})

describe('camera framing', () => {
  it('centres on the stack and returns a radius that contains it', () => {
    const placed = placeFloors(project, 2.5)
    const { center, radius } = boundsOf(placed)
    // Floors span 0..100 m in x and 0..60 m in z.
    expect(center.x).toBeCloseTo(50, 5)
    expect(center.z).toBeCloseTo(30, 5)
    expect(radius).toBeGreaterThan(50)
  })

  it('falls back to a usable radius when nothing is placed', () => {
    expect(boundsOf([]).radius).toBe(50)
  })
})

import { describe, expect, it } from 'vitest'
import { gatesFixture } from '../model/fixtures'
import { defaultRouteOptions, findRoute, type RouteOptions } from './route'

const project = gatesFixture()

function route(from: string, to: string, overrides: Partial<RouteOptions> = {}) {
  return findRoute(project, from, to, { ...defaultRouteOptions, ...overrides })
}

function expectOk(result: ReturnType<typeof route>) {
  if (!result.ok) throw new Error(`Expected a route, got: ${result.error}`)
  return result.route
}

describe('shortest path at W = 0', () => {
  it('takes the stairs, because the stairwell is nearer than the elevator', () => {
    const r = expectOk(route('GHC-4-H01', 'GHC-9-H01'))
    expect(r.stairsCount).toBeGreaterThan(0)
    expect(r.elevatorCount).toBe(0)
  })

  it('reports the shortest distance, not a tiredness-adjusted one', () => {
    const r = expectOk(route('GHC-4-H01', 'GHC-9-H01'))
    // 3 m to the stairwell + 5 flights of ~10.06 m + 3 m back out.
    expect(r.distanceM).toBeCloseTo(56.3, 0)
    // At W = 0 the minimised cost is exactly the distance.
    expect(r.cost).toBeCloseTo(r.distanceM, 5)
  })
})

describe('tiredness weight', () => {
  it('switches to the elevator once tiredness is weighted', () => {
    const r = expectOk(route('GHC-4-H01', 'GHC-9-H01', { tirednessWeight: 1 }))
    expect(r.elevatorCount).toBeGreaterThan(0)
    expect(r.stairsCount).toBe(0)
  })

  it('returns a different route at W = 0 than at W = 1', () => {
    const shortest = expectOk(route('GHC-4-H01', 'GHC-9-H01'))
    const easiest = expectOk(route('GHC-4-H01', 'GHC-9-H01', { tirednessWeight: 1 }))
    expect(shortest.nodeIds).not.toEqual(easiest.nodeIds)
  })

  it('monotonically reduces total tiredness as W rises', () => {
    const weights = [0, 0.25, 0.5, 1, 2, 4]
    const tiredness = weights.map(
      (w) => expectOk(route('GHC-4-H01', 'GHC-9-H01', { tirednessWeight: w })).tiredness,
    )
    for (let i = 1; i < tiredness.length; i++) {
      expect(tiredness[i]).toBeLessThanOrEqual(tiredness[i - 1] + 1e-9)
    }
    // And the easiest route really is less tiring than the shortest one.
    expect(tiredness.at(-1)!).toBeLessThan(tiredness[0])
  })

  it('trades distance for comfort, never improving both', () => {
    const shortest = expectOk(route('GHC-4-H01', 'GHC-9-H01'))
    const easiest = expectOk(route('GHC-4-H01', 'GHC-9-H01', { tirednessWeight: 4 }))
    expect(easiest.distanceM).toBeGreaterThan(shortest.distanceM)
    expect(easiest.tiredness).toBeLessThan(shortest.tiredness)
  })
})

describe('hard filters', () => {
  it('never returns a stairs edge when wheelchair access is required', () => {
    const r = expectOk(route('GHC-4-H01', 'GHC-9-H01', { requireWheelchair: true }))
    expect(r.stairsCount).toBe(0)
    expect(r.steps.every((s) => s.edge.wheelchair)).toBe(true)
  })

  it('reports no route rather than cheating when a floor is stairs-only', () => {
    // The elevator skips floor 6, so avoiding stairs strands it.
    const result = route('GHC-4-H01', 'GHC-6-H01', { avoidStairs: true })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('no stairs')
  })

  it('still reaches a stairs-only floor when stairs are allowed', () => {
    const r = expectOk(route('GHC-4-H01', 'GHC-6-H01'))
    expect(r.stairsCount).toBeGreaterThan(0)
  })

  it('names the active filters when it fails, so the message is actionable', () => {
    const result = route('GHC-4-H01', 'GHC-6-H01', {
      requireWheelchair: true,
      avoidElevators: true,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('wheelchair')
      expect(result.error).toContain('no elevators')
    }
  })
})

describe('leg decomposition', () => {
  it('produces one leg per floor, each pointing at the way out', () => {
    const r = expectOk(route('GHC-4-H01', 'GHC-9-H01'))
    expect(r.legs.map((l) => l.floorId)).toEqual([
      'GHC:4',
      'GHC:5',
      'GHC:6',
      'GHC:7',
      'GHC:8',
      'GHC:9',
    ])
    // Every leg but the last hands off via a stairs or elevator step.
    for (const leg of r.legs.slice(0, -1)) {
      expect(leg.exit).toBeDefined()
      expect(leg.exit!.kind).toBe('stairs')
    }
    expect(r.legs.at(-1)!.exit).toBeUndefined()
  })

  it('keeps legs continuous — each leg starts where the last one arrived', () => {
    const r = expectOk(route('GHC-4-H01', 'GHC-9-H01'))
    for (let i = 1; i < r.legs.length; i++) {
      expect(r.legs[i].nodeIds[0]).toBe(r.legs[i - 1].exit!.to.id)
    }
  })

  it('gives a single leg for a route that stays on one floor', () => {
    const r = expectOk(route('GHC-4-E01', 'GHC-4-R01'))
    expect(r.legs).toHaveLength(1)
    expect(r.floorChanges).toBe(0)
  })
})

describe('degenerate requests', () => {
  it('rejects an unknown node', () => {
    const result = route('GHC-4-H01', 'NOPE-1-H01')
    expect(result.ok).toBe(false)
  })

  it('rejects routing a point to itself', () => {
    const result = route('GHC-4-H01', 'GHC-4-H01')
    expect(result.ok).toBe(false)
  })
})

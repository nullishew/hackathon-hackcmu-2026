import { describe, expect, it } from 'vitest'
import { nearestPoint } from './pick'

describe('nearestPoint', () => {
  const points = [
    { id: 'a', x: 0, y: 0 },
    { id: 'b', x: 10, y: 0 },
    { id: 'c', x: 10, y: 10 },
  ]

  it('returns the closest point, not the first one within range', () => {
    // Sits between a and b, slightly nearer b.
    expect(nearestPoint(points, { x: 6, y: 0 }, 20)?.id).toBe('b')
  })

  it('returns null when nothing is within the tolerance', () => {
    expect(nearestPoint(points, { x: 100, y: 100 }, 5)).toBeNull()
  })

  it('respects the tolerance exactly at the boundary', () => {
    // Distance is exactly 5, and the bound is exclusive, so this must miss.
    expect(nearestPoint([{ id: 'a', x: 0, y: 0 }], { x: 5, y: 0 }, 5)).toBeNull()
    expect(nearestPoint([{ id: 'a', x: 0, y: 0 }], { x: 4.9, y: 0 }, 5)?.id).toBe('a')
  })

  it('handles an empty set', () => {
    expect(nearestPoint([], { x: 0, y: 0 }, 10)).toBeNull()
  })

  it('measures diagonally, not per axis', () => {
    // dx and dy are each 4, but the diagonal distance is ~5.66 and so out of range.
    expect(nearestPoint([{ id: 'a', x: 0, y: 0 }], { x: 4, y: 4 }, 5)).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { isDragGesture, nearestPoint } from './pick'

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

describe('isDragGesture', () => {
  it('treats a still pointer as a click', () => {
    expect(isDragGesture({ x: 100, y: 100 }, { x: 100, y: 100 })).toBe(false)
  })

  it('tolerates the tiny wobble of a real mouse click', () => {
    expect(isDragGesture({ x: 100, y: 100 }, { x: 102, y: 101 })).toBe(false)
  })

  it('treats an orbit drag as a drag, so the 3D view does not jump to 2D', () => {
    expect(isDragGesture({ x: 100, y: 100 }, { x: 180, y: 140 })).toBe(true)
  })

  it('measures diagonally rather than per axis', () => {
    // 5 px on each axis is ~7.07 px of travel, past the 6 px default.
    expect(isDragGesture({ x: 0, y: 0 }, { x: 5, y: 5 })).toBe(true)
  })

  it('refuses to act when the press was never seen', () => {
    // A gesture that began outside the object must not count as a click on it.
    expect(isDragGesture(null, { x: 0, y: 0 })).toBe(true)
  })

  it('honours a custom slop', () => {
    expect(isDragGesture({ x: 0, y: 0 }, { x: 20, y: 0 }, 30)).toBe(false)
    expect(isDragGesture({ x: 0, y: 0 }, { x: 40, y: 0 }, 30)).toBe(true)
  })
})

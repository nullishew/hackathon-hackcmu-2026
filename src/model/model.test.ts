import { describe, expect, it } from 'vitest'
import { suggestDistanceM } from './autoDistance'
import { defaultTiredIndex, defaultWheelchair, edgeCost, inferEdgeKind } from './edges'
import { gatesFixture } from './fixtures'
import { calibrationFromReferenceLine } from './geometry'
import { createLabeler } from './labels'
import { nextNodeId } from './ids'

describe('calibration', () => {
  it('derives pixelsPerMeter from a reference line of known length', () => {
    // A 300 px line across a corridor the user says is 30 m.
    const result = calibrationFromReferenceLine({ x: 0, y: 0 }, { x: 300, y: 0 }, 30)
    expect(result).toEqual({ pixelsPerMeter: 10 })
  })

  it('refuses a line too short to measure', () => {
    const result = calibrationFromReferenceLine({ x: 0, y: 0 }, { x: 0.5, y: 0 }, 30)
    expect(result).toHaveProperty('error')
  })

  it('recovers a known corridor length to within a few percent', () => {
    const project = gatesFixture()
    // H01 -> H02 is laid out 100 px apart at 10 px/m.
    const edge = project.edges['GHC-4-H01->GHC-4-H02']
    expect(edge.distanceM).toBeCloseTo(10, 1)
  })
})

describe('edge kind inference', () => {
  const project = gatesFixture()
  const node = (id: string) => project.nodes[id]

  it('reads two stairs nodes on different floors as a staircase', () => {
    expect(inferEdgeKind(node('GHC-4-S01'), node('GHC-5-S01'))).toBe('stairs')
  })

  it('reads two elevator nodes on different floors as an elevator', () => {
    expect(inferEdgeKind(node('GHC-4-V01'), node('GHC-5-V01'))).toBe('elevator')
  })

  it('reads same-floor corridor nodes as a walk', () => {
    expect(inferEdgeKind(node('GHC-4-H01'), node('GHC-4-H02'))).toBe('walk')
  })

  it('assigns the documented tiredness defaults', () => {
    expect(defaultTiredIndex('elevator')).toBe(0.25)
    expect(defaultTiredIndex('walk')).toBe(1)
    expect(defaultTiredIndex('ramp')).toBe(1.5)
    expect(defaultTiredIndex('stairs')).toBe(2)
  })

  it('marks only stairs inaccessible by default', () => {
    expect(defaultWheelchair('stairs')).toBe(false)
    expect(defaultWheelchair('elevator')).toBe(true)
    expect(defaultWheelchair('walk')).toBe(true)
  })
})

describe('auto distance', () => {
  const project = gatesFixture()

  it('estimates a stair run rather than trusting stacked stairwell coordinates', () => {
    const s = suggestDistanceM(project, project.nodes['GHC-4-S01'], project.nodes['GHC-5-S01'])
    expect(s?.basis).toBe('stair-estimate')
    // 4.5 m rise with a 2:1 run is hypot(9, 4.5) ~= 10.06 m, not the bare 4.5 m rise.
    expect(s?.distanceM).toBeCloseTo(10.06, 1)
  })

  it('treats an elevator shaft as pure rise', () => {
    const s = suggestDistanceM(project, project.nodes['GHC-4-V01'], project.nodes['GHC-5-V01'])
    expect(s?.basis).toBe('elevator-rise')
    expect(s?.distanceM).toBeCloseTo(4.5, 2)
  })

  it('returns null for an uncalibrated floor instead of inventing a number', () => {
    const broken = gatesFixture()
    broken.buildings[0].floors[0].calibration = undefined
    const s = suggestDistanceM(broken, broken.nodes['GHC-4-H01'], broken.nodes['GHC-4-H02'])
    expect(s).toBeNull()
  })
})

describe('edge cost', () => {
  it('cancels tiredIndex entirely at W = 0', () => {
    const stairs = { distanceM: 10, tiredIndex: 2 }
    const walk = { distanceM: 10, tiredIndex: 1 }
    expect(edgeCost(stairs, 0)).toBe(edgeCost(walk, 0))
  })

  it('penalises stairs over an elevator as W rises', () => {
    const stairs = { distanceM: 10, tiredIndex: 2 }
    const elevator = { distanceM: 10, tiredIndex: 0.25 }
    expect(edgeCost(stairs, 1)).toBeGreaterThan(edgeCost(elevator, 1))
  })
})

describe('derived labels', () => {
  const project = gatesFixture()
  const { labelFor, shortLabelFor } = createLabeler(project)
  const label = (id: string) => labelFor(project.nodes[id])

  it('uses a curated name with the room number alongside', () => {
    expect(label('GHC-4-R01')).toBe('Rashid Auditorium (Gates 4401)')
  })

  it('falls back to building plus room number', () => {
    expect(label('GHC-5-R01')).toBe('Gates 5301')
  })

  it('names a hallway by the room it sits outside', () => {
    // Two corners share this corridor, so a compass disambiguator is appended.
    expect(label('GHC-4-H01')).toBe('hallway outside Gates 4401 (west)')
  })

  it('names a stairwell node by its feature', () => {
    expect(label('GHC-4-S01')).toBe('Gates 4 — the Helix')
  })

  it('names an entrance by what it opens onto', () => {
    expect(label('GHC-4-E01')).toBe('Gates and Hillman Centers — the Cut entrance')
  })

  it('abbreviates for turn-by-turn text', () => {
    // The room number must survive abbreviation; the disambiguator rides along.
    expect(shortLabelFor(project.nodes['GHC-4-H01'])).toBe('outside GHC 4401 (west)')
  })
})

describe('node ids', () => {
  it('allocates the next free sequence for a kind on a floor', () => {
    const project = gatesFixture()
    // GHC-4-H01 and GHC-4-H02 already exist.
    expect(nextNodeId(project, 'GHC', '4', 'corner')).toBe('GHC-4-H03')
  })

  it('starts a fresh sequence for an unused kind', () => {
    const project = gatesFixture()
    expect(nextNodeId(project, 'GHC', '4', 'restroom')).toBe('GHC-4-W01')
  })
})

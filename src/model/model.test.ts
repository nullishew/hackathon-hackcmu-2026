import { describe, expect, it } from 'vitest'
import { suggestDistanceM } from './autoDistance'
import { defaultTiredIndex, defaultWheelchair, edgeCost, edgeKind } from './edges'
import { gatesFixture } from './fixtures'
import { calibrationFromReferenceLine } from './geometry'
import { createLabeler } from './labels'
import { nextNodeId } from './ids'
import type { Building, GraphEdge, GraphNode, Project } from './types'

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

describe('edge kind', () => {
  const project = gatesFixture()

  it('is read from the edge, not worked out from its endpoints', () => {
    expect(edgeKind(project.edges['GHC-4-S01->GHC-5-S01'])).toBe('stairs')
    expect(edgeKind(project.edges['GHC-4-V01->GHC-5-V01'])).toBe('elevator')
    expect(edgeKind(project.edges['GHC-4-H01->GHC-4-H02'])).toBe('walk')
  })

  /**
   * The point of storing it: a flat doorway between two buildings is a walk even though
   * the two floor ids differ. Nothing may override what was entered by hand.
   */
  it('keeps a cross-building link a walk', () => {
    const seam = twoBuildingsAtSameElevation()
    expect(edgeKind(seam.edge)).toBe('walk')
  })

  it('survives reclassifying one of its endpoints', () => {
    const seam = twoBuildingsAtSameElevation()
    seam.project.nodes[seam.a.id] = { ...seam.a, kind: 'stairs' }
    // The node changed; the edge is still what it was entered as.
    expect(edgeKind(seam.project.edges[seam.edge.id])).toBe('walk')
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
    const s = suggestDistanceM(project, project.nodes['GHC-4-S01'], project.nodes['GHC-5-S01'], 'stairs')
    expect(s?.basis).toBe('stair-estimate')
    // 4.5 m rise with a 2:1 run is hypot(9, 4.5) ~= 10.06 m, not the bare 4.5 m rise.
    expect(s?.distanceM).toBeCloseTo(10.06, 1)
  })

  it('treats an elevator shaft as pure rise', () => {
    const s = suggestDistanceM(project, project.nodes['GHC-4-V01'], project.nodes['GHC-5-V01'], 'elevator')
    expect(s?.basis).toBe('elevator-rise')
    expect(s?.distanceM).toBeCloseTo(4.5, 2)
  })

  it('returns null for an uncalibrated floor instead of inventing a number', () => {
    const broken = gatesFixture()
    broken.buildings[0].floors[0].calibration = undefined
    const s = suggestDistanceM(broken, broken.nodes['GHC-4-H01'], broken.nodes['GHC-4-H02'], 'walk')
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

/**
 * Two single-floor buildings whose floors share an elevation, joined by entrance nodes —
 * the shape of the real Gates/Newell-Simon seam.
 */
function twoBuildingsAtSameElevation() {
  const project: Project = {
    buildings: [
      buildingWithFloor('AAA', 0),
      buildingWithFloor('BBB', 0),
    ],
    features: [],
    nodes: {},
    edges: {},
  }
  const a: GraphNode = { id: 'AAA-1-E01', floorId: 'AAA:1', x: 10, y: 10, kind: 'entrance' }
  const b: GraphNode = { id: 'BBB-1-E01', floorId: 'BBB:1', x: 20, y: 20, kind: 'entrance' }
  project.nodes[a.id] = a
  project.nodes[b.id] = b

  const edge: GraphEdge = {
    id: `${a.id}->${b.id}`,
    from: a.id,
    to: b.id,
    bidirectional: true,
    kind: 'walk',
    distanceM: 2.3,
    tiredIndex: 1,
    wheelchair: true,
  }
  project.edges[edge.id] = edge
  return { project, a, b, edge }
}

function buildingWithFloor(id: string, elevationM: number): Building {
  return {
    id,
    name: id,
    placement: { x: 0, y: 0, rotationDeg: 0 },
    floors: [
      {
        id: `${id}:1`,
        buildingId: id,
        floorKey: '1',
        ordinal: 1,
        elevationM,
        calibration: { pixelsPerMeter: 10, originX: 0, originY: 0, rotationDeg: 0 },
      },
    ],
  }
}

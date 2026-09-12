/**
 * A hand-built Gates fixture: floors 4 through 9, a stairwell (the Helix), an elevator
 * bank, and an entrance onto the Cut.
 *
 * It exists so routing, the filter panel and the 3D stack can all be built and tested
 * before any real floor plan has been traced. Two deliberate properties:
 *
 *  - The stairwell is much closer to the corridor than the elevator is, so the shortest
 *    route (W = 0) takes the stairs while a tired route takes the elevator. That flip is
 *    the clearest single proof the tiredness model works.
 *  - The elevator does not stop on floor 6, so floor 6 is reachable only by stairs. That
 *    gives us a genuine "no route" case for the avoid-stairs filter.
 */
import { suggestDistanceM } from './autoDistance'
import { defaultTiredIndex, defaultWheelchair, inferEdgeKind } from './edges'
import { makeEdgeId } from './ids'
import type { Building, Feature, Floor, GraphEdge, GraphNode, Project } from './types'
import { makeFloorId } from './types'

const PIXELS_PER_METER = 10
const FLOOR_HEIGHT_M = 4.5
const FLOORS = [4, 5, 6, 7, 8, 9]
/** Floor 6 has no elevator stop, which is what makes it stairs-only. */
const ELEVATOR_STOPS = [4, 5, 7, 8, 9]

const FEATURES: Feature[] = [
  { id: 'feat-helix', kind: 'stairwell', name: 'the Helix', buildingId: 'GHC', aliases: ['helix'] },
  { id: 'feat-elev-a', kind: 'elevator_bank', name: 'the Hillman elevators', buildingId: 'GHC' },
  { id: 'feat-cut', kind: 'exit', name: 'the Cut', buildingId: 'GHC' },
]

/** Pixel layout shared by every floor — Gates repeats, which is why stamp-floor matters. */
const LAYOUT = {
  stairs: { x: 130, y: 300 },
  corner1: { x: 160, y: 300 },
  corner2: { x: 260, y: 300 },
  elevator: { x: 360, y: 300 },
  room: { x: 160, y: 220 },
  entrance: { x: 160, y: 400 },
}

export function gatesFixture(): Project {
  const floors: Floor[] = FLOORS.map((n, i) => ({
    id: makeFloorId('GHC', String(n)),
    buildingId: 'GHC',
    floorKey: String(n),
    ordinal: n,
    elevationM: i * FLOOR_HEIGHT_M,
    image: { src: '/floorplans/GHC/placeholder.svg', widthPx: 1000, heightPx: 600 },
    calibration: { pixelsPerMeter: PIXELS_PER_METER, originX: 0, originY: 0, rotationDeg: 0 },
  }))

  const building: Building = {
    id: 'GHC',
    name: 'Gates and Hillman Centers',
    shortName: 'Gates',
    placement: { x: 0, y: 0, rotationDeg: 0 },
    floors,
  }

  const project: Project = {
    buildings: [building],
    features: FEATURES,
    nodes: {},
    edges: {},
  }

  const add = (node: GraphNode) => {
    project.nodes[node.id] = node
  }

  for (const n of FLOORS) {
    const floorId = makeFloorId('GHC', String(n))
    const id = (code: string) => `GHC-${n}-${code}`

    add({ id: id('S01'), floorId, ...LAYOUT.stairs, kind: 'stairs', featureId: 'feat-helix' })
    add({ id: id('H01'), floorId, ...LAYOUT.corner1, kind: 'corner' })
    add({ id: id('H02'), floorId, ...LAYOUT.corner2, kind: 'corner' })

    if (ELEVATOR_STOPS.includes(n)) {
      add({
        id: id('V01'),
        floorId,
        ...LAYOUT.elevator,
        kind: 'elevator',
        featureId: 'feat-elev-a',
      })
    }

    // Floor 4 carries Rashid; the other floors get a plain numbered room.
    add(
      n === 4
        ? {
            id: id('R01'),
            floorId,
            ...LAYOUT.room,
            kind: 'room',
            roomNumber: '4401',
            name: 'Rashid Auditorium',
          }
        : { id: id('R01'), floorId, ...LAYOUT.room, kind: 'room', roomNumber: `${n}301` },
    )

    if (n === 4) {
      add({
        id: id('E01'),
        floorId,
        ...LAYOUT.entrance,
        kind: 'entrance',
        featureId: 'feat-cut',
      })
    }
  }

  // Same-floor corridor edges.
  for (const n of FLOORS) {
    const id = (code: string) => `GHC-${n}-${code}`
    connect(project, id('S01'), id('H01'))
    connect(project, id('H01'), id('H02'))
    connect(project, id('H01'), id('R01'))
    if (ELEVATOR_STOPS.includes(n)) connect(project, id('H02'), id('V01'))
    if (n === 4) connect(project, id('H01'), id('E01'))
  }

  // The Helix: a stairs edge between every consecutive pair of floors.
  for (let i = 0; i < FLOORS.length - 1; i++) {
    connect(project, `GHC-${FLOORS[i]}-S01`, `GHC-${FLOORS[i + 1]}-S01`)
  }

  // The elevator shaft, skipping floor 6.
  for (let i = 0; i < ELEVATOR_STOPS.length - 1; i++) {
    connect(project, `GHC-${ELEVATOR_STOPS[i]}-V01`, `GHC-${ELEVATOR_STOPS[i + 1]}-V01`)
  }

  return project
}

/**
 * Create an edge the way the editor does: infer the kind from the endpoints, then let
 * distance, tiredIndex and wheelchair fill themselves in.
 */
function connect(project: Project, fromId: string, toId: string): GraphEdge {
  const from = project.nodes[fromId]
  const to = project.nodes[toId]
  if (!from || !to) throw new Error(`Cannot connect missing nodes: ${fromId} -> ${toId}`)

  const kind = inferEdgeKind(from, to)
  const suggestion = suggestDistanceM(project, from, to)
  if (!suggestion) throw new Error(`Uncalibrated floor for edge ${fromId} -> ${toId}`)

  const edge: GraphEdge = {
    id: makeEdgeId(fromId, toId),
    from: fromId,
    to: toId,
    bidirectional: true,
    distanceM: round2(suggestion.distanceM),
    tiredIndex: defaultTiredIndex(kind),
    wheelchair: defaultWheelchair(kind),
  }
  project.edges[edge.id] = edge
  return edge
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

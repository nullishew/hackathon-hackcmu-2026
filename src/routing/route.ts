/**
 * Dijkstra over the node graph, minimising
 *
 *   cost(edge) = (1 + W * tiredIndex) * distanceM
 *
 * At W = 0 the tiredIndex cancels and this is the shortest-distance path. Raising W
 * penalises stairs and favours elevators. Weights are non-negative for every W >= 0,
 * so Dijkstra is valid at any slider position.
 *
 * The result is decomposed into LEGS — one contiguous run per floor — because that is
 * exactly what the 2D drill-down renders and what the 3D view highlights.
 */
import { edgeCost, edgeKind, edgeTiredness, estimateSeconds, type EdgeKind } from '../model/edges'
import { findFloor } from '../model/types'
import type { GraphEdge, GraphNode, Project } from '../model/types'
import { MinHeap } from './heap'

export interface RouteOptions {
  /** W in the cost function. 0 = pure shortest distance. */
  tirednessWeight: number
  requireWheelchair: boolean
  avoidStairs: boolean
  avoidElevators: boolean
}

export const defaultRouteOptions: RouteOptions = {
  tirednessWeight: 0,
  requireWheelchair: false,
  avoidStairs: false,
  avoidElevators: false,
}

export interface RouteStep {
  edge: GraphEdge
  kind: EdgeKind
  from: GraphNode
  to: GraphNode
  distanceM: number
  seconds: number
  /**
   * Set when the step moves to a different floor plan. Drives leg splitting, since each
   * leg renders exactly one plan — true even for a doorway into another building.
   */
  changesFloor: boolean
  /**
   * Set when the step actually changes height. Unlike `changesFloor` this is geometric:
   * Gates 4 and NSH 4 are different plans at the same elevation, so crossing between them
   * changes floor but not level.
   */
  changesLevel: boolean
}

export interface RouteLeg {
  floorId: string
  /** Nodes traversed on this floor, in order. */
  nodeIds: string[]
  /** Same-floor steps within this leg. */
  steps: RouteStep[]
  distanceM: number
  seconds: number
  /** The step that leaves this floor — the staircase or elevator you head for next. */
  exit?: RouteStep
}

export interface Route {
  nodeIds: string[]
  steps: RouteStep[]
  legs: RouteLeg[]
  distanceM: number
  seconds: number
  /** Total (1 + W*ti)*d actually minimised. */
  cost: number
  /** Total tiredIndex * distance, independent of W. */
  tiredness: number
  /** How many times the route actually changes height. */
  floorChanges: number
  stairsCount: number
  elevatorCount: number
}

export type RouteResult = { ok: true; route: Route } | { ok: false; error: string }

interface Arc {
  edge: GraphEdge
  kind: EdgeKind
  to: string
  cost: number
}

/**
 * Build the directed adjacency list, dropping edges excluded by the hard filters.
 * Filtering here rather than inside the search means an impossible request fails as
 * "no route under these settings" instead of quietly returning something unusable.
 */
function buildAdjacency(project: Project, options: RouteOptions): Map<string, Arc[]> {
  const adj = new Map<string, Arc[]>()

  const add = (from: string, to: string, edge: GraphEdge, kind: EdgeKind) => {
    const cost = edgeCost(edge, options.tirednessWeight)
    let list = adj.get(from)
    if (!list) {
      list = []
      adj.set(from, list)
    }
    list.push({ edge, kind, to, cost })
  }

  for (const edge of Object.values(project.edges)) {
    // A dangling endpoint cannot be traversed; validation reports those separately.
    if (!project.nodes[edge.from] || !project.nodes[edge.to]) continue
    const kind = edgeKind(edge)

    if (options.requireWheelchair && !edge.wheelchair) continue
    if (options.avoidStairs && kind === 'stairs') continue
    if (options.avoidElevators && kind === 'elevator') continue

    add(edge.from, edge.to, edge, kind)
    if (edge.bidirectional) add(edge.to, edge.from, edge, kind)
  }

  return adj
}

export function findRoute(
  project: Project,
  fromId: string,
  toId: string,
  options: RouteOptions = defaultRouteOptions,
): RouteResult {
  const start = project.nodes[fromId]
  const goal = project.nodes[toId]
  if (!start) return { ok: false, error: `Start node ${fromId} does not exist.` }
  if (!goal) return { ok: false, error: `Destination node ${toId} does not exist.` }
  if (fromId === toId) {
    return { ok: false, error: 'Start and destination are the same point.' }
  }

  const adj = buildAdjacency(project, options)

  const dist = new Map<string, number>([[fromId, 0]])
  /** node -> the arc we arrived by, for path reconstruction. */
  const cameBy = new Map<string, Arc & { from: string }>()
  const settled = new Set<string>()
  const heap = new MinHeap<{ id: string; d: number }>((e) => e.d)
  heap.push({ id: fromId, d: 0 })

  while (heap.size > 0) {
    const current = heap.pop()!
    if (settled.has(current.id)) continue
    settled.add(current.id)
    if (current.id === toId) break

    for (const arc of adj.get(current.id) ?? []) {
      if (settled.has(arc.to)) continue
      const next = current.d + arc.cost
      if (next < (dist.get(arc.to) ?? Infinity)) {
        dist.set(arc.to, next)
        cameBy.set(arc.to, { ...arc, from: current.id })
        heap.push({ id: arc.to, d: next })
      }
    }
  }

  if (!settled.has(toId)) {
    return { ok: false, error: describeUnreachable(options) }
  }

  return { ok: true, route: assembleRoute(project, fromId, toId, cameBy, dist.get(toId) ?? 0) }
}

/** Name the filters in play, so a failure is actionable rather than just "no route". */
function describeUnreachable(options: RouteOptions): string {
  const active: string[] = []
  if (options.requireWheelchair) active.push('wheelchair accessible only')
  if (options.avoidStairs) active.push('no stairs')
  if (options.avoidElevators) active.push('no elevators')
  return active.length > 0
    ? `No route with these settings (${active.join(', ')}). Try relaxing a filter.`
    : 'No route exists between these two points — the graph is disconnected here.'
}

function elevationOf(project: Project, node: GraphNode): number {
  return findFloor(project, node.floorId)?.elevationM ?? 0
}

function assembleRoute(
  project: Project,
  fromId: string,
  toId: string,
  cameBy: Map<string, Arc & { from: string }>,
  totalCost: number,
): Route {
  // Walk backwards from the goal, then reverse.
  const steps: RouteStep[] = []
  let cursor = toId
  while (cursor !== fromId) {
    const arc = cameBy.get(cursor)!
    const from = project.nodes[arc.from]
    const to = project.nodes[cursor]
    steps.push({
      edge: arc.edge,
      kind: arc.kind,
      from,
      to,
      distanceM: arc.edge.distanceM,
      seconds: estimateSeconds(arc.edge.distanceM, arc.kind),
      changesFloor: from.floorId !== to.floorId,
      changesLevel: elevationOf(project, from) !== elevationOf(project, to),
    })
    cursor = arc.from
  }
  steps.reverse()

  const nodeIds = [fromId, ...steps.map((s) => s.to.id)]

  let distanceM = 0
  let seconds = 0
  let tiredness = 0
  let stairsCount = 0
  let elevatorCount = 0
  for (const s of steps) {
    distanceM += s.distanceM
    seconds += s.seconds
    tiredness += edgeTiredness(s.edge)
    if (s.kind === 'stairs') stairsCount++
    if (s.kind === 'elevator') elevatorCount++
  }

  const legs = buildLegs(project, fromId, steps)

  return {
    nodeIds,
    steps,
    legs,
    distanceM,
    seconds,
    cost: totalCost,
    tiredness,
    floorChanges: steps.filter((s) => s.changesLevel).length,
    stairsCount,
    elevatorCount,
  }
}

/**
 * Split the route into one leg per floor. A floor-changing step becomes the current
 * leg exit and opens the next leg, so each leg answers "where do I walk on this floor,
 * and what do I head for to leave it".
 */
function buildLegs(project: Project, fromId: string, steps: RouteStep[]): RouteLeg[] {
  const startNode = project.nodes[fromId]
  const legs: RouteLeg[] = []

  let leg: RouteLeg = {
    floorId: startNode.floorId,
    nodeIds: [fromId],
    steps: [],
    distanceM: 0,
    seconds: 0,
  }

  for (const step of steps) {
    if (step.changesFloor) {
      leg.exit = step
      legs.push(leg)
      leg = {
        floorId: step.to.floorId,
        nodeIds: [step.to.id],
        steps: [],
        distanceM: 0,
        seconds: 0,
      }
      continue
    }
    leg.steps.push(step)
    leg.nodeIds.push(step.to.id)
    leg.distanceM += step.distanceM
    leg.seconds += step.seconds
  }

  legs.push(leg)
  return legs
}

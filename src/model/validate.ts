/**
 * Structural checks on the graph.
 *
 * These exist because the failure modes of hand-traced indoor graphs are quiet: a
 * stairwell that was never linked, a wing connected to nothing, a floor whose plan was
 * never calibrated. None of those throw an error — they just make routes wrong or
 * impossible. Surfacing them is what makes data entry self-correcting.
 */
import type { Project } from './types'
import { buildingOfFloor, findFloor } from './types'

export type IssueSeverity = 'error' | 'warning'

export interface Issue {
  severity: IssueSeverity
  kind: string
  message: string
  /** Things to select when the user clicks the issue. */
  nodeIds?: string[]
  floorId?: string
}

export function validateProject(project: Project): Issue[] {
  const issues: Issue[] = []
  const nodes = Object.values(project.nodes)
  const edges = Object.values(project.edges)

  // --- dangling edges -------------------------------------------------
  for (const edge of edges) {
    const missing = [edge.from, edge.to].filter((id) => !project.nodes[id])
    if (missing.length > 0) {
      issues.push({
        severity: 'error',
        kind: 'dangling-edge',
        message: `Edge ${edge.id} points at missing node ${missing.join(' and ')}.`,
      })
    }
  }

  // --- uncalibrated floors that already have points -------------------
  const floorsWithNodes = new Set(nodes.map((n) => n.floorId))
  for (const floorId of floorsWithNodes) {
    const floor = findFloor(project, floorId)
    if (floor && !floor.calibration) {
      issues.push({
        severity: 'error',
        kind: 'uncalibrated',
        message: `Floor ${floor.floorKey} has points but no calibration, so its distances are unknown.`,
        floorId,
      })
    }
  }

  // --- orphan nodes ---------------------------------------------------
  const degree = new Map<string, number>()
  for (const edge of edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1)
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1)
  }
  const orphans = nodes.filter((n) => !degree.has(n.id))
  if (orphans.length > 0) {
    issues.push({
      severity: 'warning',
      kind: 'orphan-nodes',
      message: `${orphans.length} point${orphans.length === 1 ? '' : 's'} connected to nothing.`,
      nodeIds: orphans.map((n) => n.id),
    })
  }

  // --- implausible distances ------------------------------------------
  const implausible = edges.filter((e) => e.distanceM <= 0 || e.distanceM > 400)
  if (implausible.length > 0) {
    issues.push({
      severity: 'warning',
      kind: 'implausible-distance',
      message: `${implausible.length} edge${implausible.length === 1 ? '' : 's'} with a distance of 0 or over 400 m.`,
      nodeIds: implausible.flatMap((e) => [e.from, e.to]),
    })
  }

  // --- accessibility that contradicts the edge kind --------------------
  // Step-free routing trusts the wheelchair flag and nothing else, which is right: it is
  // the fact a human entered. That makes a staircase marked accessible actively dangerous
  // rather than merely odd, so say so here instead of second-guessing it at route time.
  const stairsMarkedAccessible = edges.filter((e) => e.kind === 'stairs' && e.wheelchair)
  if (stairsMarkedAccessible.length > 0) {
    issues.push({
      severity: 'error',
      kind: 'stairs-marked-accessible',
      message:
        `${stairsMarkedAccessible.length} stairs edge${stairsMarkedAccessible.length === 1 ? '' : 's'} ` +
        `marked wheelchair accessible — step-free routes will send people up them.`,
      nodeIds: stairsMarkedAccessible.flatMap((e) => [e.from, e.to]),
    })
  }

  // --- points outside their plan image --------------------------------
  const outOfBounds = nodes.filter((n) => {
    const image = findFloor(project, n.floorId)?.image
    if (!image) return false
    return n.x < 0 || n.y < 0 || n.x > image.widthPx || n.y > image.heightPx
  })
  if (outOfBounds.length > 0) {
    issues.push({
      severity: 'warning',
      kind: 'out-of-bounds',
      message: `${outOfBounds.length} point${outOfBounds.length === 1 ? '' : 's'} sitting outside the floor plan image.`,
      nodeIds: outOfBounds.map((n) => n.id),
    })
  }

  // --- floors with no way up or down ----------------------------------
  for (const floorId of floorsWithNodes) {
    const hasVertical = edges.some((e) => {
      const from = project.nodes[e.from]
      const to = project.nodes[e.to]
      if (!from || !to) return false
      return (
        from.floorId !== to.floorId && (from.floorId === floorId || to.floorId === floorId)
      )
    })
    if (!hasVertical) {
      const floor = findFloor(project, floorId)
      const building = buildingOfFloor(project, floorId)
      // A single-floor building is legitimately self-contained.
      if (floor && building && building.floors.length > 1) {
        issues.push({
          severity: 'error',
          kind: 'no-vertical-link',
          message: `Floor ${floor.floorKey} of ${building.id} has no stairs or elevator connecting it to another floor.`,
          floorId,
        })
      }
    }
  }

  // --- disconnected components ----------------------------------------
  const components = connectedComponents(project)
  if (components.length > 1) {
    const sorted = [...components].sort((a, b) => b.length - a.length)
    const stranded = sorted.slice(1)
    issues.push({
      severity: 'error',
      kind: 'disconnected',
      message:
        `The graph is in ${components.length} disconnected pieces — ` +
        `${stranded.reduce((n, c) => n + c.length, 0)} points cannot be reached from the largest piece.`,
      nodeIds: stranded.flat(),
    })
  }

  // --- buildings not joined to the rest -------------------------------
  // This is the check that catches "you cannot get from Gates to Doherty".
  if (project.buildings.length > 1) {
    const linked = new Set<string>()
    for (const edge of edges) {
      const a = buildingOfFloor(project, project.nodes[edge.from]?.floorId ?? '')
      const b = buildingOfFloor(project, project.nodes[edge.to]?.floorId ?? '')
      if (a && b && a.id !== b.id) {
        linked.add(a.id)
        linked.add(b.id)
      }
    }
    for (const building of project.buildings) {
      const hasNodes = nodes.some((n) => n.floorId.startsWith(`${building.id}:`))
      if (hasNodes && !linked.has(building.id)) {
        issues.push({
          severity: 'warning',
          kind: 'isolated-building',
          message: `${building.id} has no edge to any other building.`,
        })
      }
    }
  }

  return issues
}

/** Connected components, ignoring direction — reachability for humans, not for the router. */
function connectedComponents(project: Project): string[][] {
  const adj = new Map<string, string[]>()
  for (const id of Object.keys(project.nodes)) adj.set(id, [])
  for (const edge of Object.values(project.edges)) {
    if (!adj.has(edge.from) || !adj.has(edge.to)) continue
    adj.get(edge.from)!.push(edge.to)
    adj.get(edge.to)!.push(edge.from)
  }

  const seen = new Set<string>()
  const components: string[][] = []
  for (const start of adj.keys()) {
    if (seen.has(start)) continue
    const group: string[] = []
    const stack = [start]
    seen.add(start)
    while (stack.length > 0) {
      const id = stack.pop()!
      group.push(id)
      for (const next of adj.get(id) ?? []) {
        if (seen.has(next)) continue
        seen.add(next)
        stack.push(next)
      }
    }
    components.push(group)
  }
  return components
}

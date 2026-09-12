/**
 * One floor, flat, showing just the current leg of the route: where you come in, the path
 * across this floor, and the staircase or elevator you head for to leave it.
 *
 * Rendering a single leg rather than the whole route is the point — on this floor, the
 * parts of the journey happening five storeys up are noise.
 */
import { useMemo } from 'react'
import { FloorCanvas } from '../floor2d/FloorCanvas'
import { useViewport } from '../floor2d/useViewport'
import { formatDistance } from '../model/edges'
import { findFloor, type GraphNode, type Project } from '../model/types'
import type { Route } from '../routing/route'

export function LegView({
  project,
  route,
  legIndex,
  floorId,
  onChangeLeg,
}: {
  project: Project
  route: Route | null
  legIndex: number
  floorId: string
  onChangeLeg: (index: number) => void
}) {
  const viewportApi = useViewport()
  const floor = findFloor(project, floorId)
  const leg = route?.legs[legIndex]

  const segments = useMemo<Array<[GraphNode, GraphNode]>>(() => {
    if (!leg) return []
    return leg.steps.map((step) => [step.from, step.to] as [GraphNode, GraphNode])
  }, [leg])

  const nodesOnFloor = useMemo(
    () => Object.values(project.nodes).filter((n) => n.floorId === floorId),
    [project.nodes, floorId],
  )

  const start = leg ? project.nodes[leg.nodeIds[0]] : undefined
  const end = leg ? project.nodes[leg.nodeIds[leg.nodeIds.length - 1]] : undefined
  const exitNode = leg?.exit?.from
  const exitTargetFloor = leg?.exit ? findFloor(project, leg.exit.to.floorId) : undefined

  const scale = viewportApi.viewport.scale

  return (
    <div className="leg-view">
      <header className="leg-header">
        <div>
          <strong>
            {floorId.split(':')[0]} floor {floor?.floorKey ?? '?'}
          </strong>
          {leg && <span className="muted"> · {formatDistance(leg.distanceM)} on this floor</span>}
        </div>

        {route && (
          <div className="leg-nav">
            <button type="button" disabled={legIndex <= 0} onClick={() => onChangeLeg(legIndex - 1)}>
              ← Previous
            </button>
            <span className="muted">
              Leg {legIndex + 1} of {route.legs.length}
            </span>
            <button
              type="button"
              disabled={legIndex >= route.legs.length - 1}
              onClick={() => onChangeLeg(legIndex + 1)}
            >
              Next →
            </button>
          </div>
        )}

        {leg?.exit && (
          <div className="next-transition">
            {leg.exit.kind === 'elevator' ? '🛗' : '↕'} Take the {leg.exit.kind} to floor{' '}
            {exitTargetFloor?.floorKey ?? '?'}
          </div>
        )}
        {leg && !leg.exit && <div className="next-transition arrive">You arrive on this floor</div>}
      </header>

      <FloorCanvas
        floor={floor}
        nodes={nodesOnFloor}
        edges={[]}
        hideGraph
        routeSegments={segments}
        viewportApi={viewportApi}
        overlay={
          <>
            {start && (
              <Marker node={start} scale={scale} color="#5bd1a0" label={legIndex === 0 ? 'Start' : 'You arrive'} />
            )}
            {end && end.id !== start?.id && (
              <Marker
                node={end}
                scale={scale}
                color={leg?.exit ? '#ffd24a' : '#ff4d4d'}
                label={leg?.exit ? 'Leave here' : 'Destination'}
              />
            )}
            {exitNode && exitTargetFloor && (
              <text
                x={exitNode.x + 16 / scale}
                y={exitNode.y - 16 / scale}
                fill="#ffd24a"
                fontSize={16 / scale}
                style={{ pointerEvents: 'none' }}
              >
                {leg?.exit?.kind} → {exitTargetFloor.floorKey}
              </text>
            )}
          </>
        }
      />
    </div>
  )
}

function Marker({
  node,
  scale,
  color,
  label,
}: {
  node: GraphNode
  scale: number
  color: string
  label: string
}) {
  return (
    <g style={{ pointerEvents: 'none' }}>
      <circle
        cx={node.x}
        cy={node.y}
        r={9 / scale}
        fill={color}
        stroke="#14130f"
        strokeWidth={2 / scale}
      />
      <text x={node.x + 14 / scale} y={node.y + 5 / scale} fill="#e8e4dc" fontSize={14 / scale}>
        {label}
      </text>
    </g>
  )
}

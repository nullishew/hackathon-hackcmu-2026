/**
 * The floor plan canvas: the plan image with the graph drawn over it in SVG.
 *
 * Shared by the data entry screen and the viewer's drill-down, deliberately — the same
 * component renders nodes-and-edges for editing and a route leg for navigating, so the
 * two views cannot drift apart visually.
 */
import { useEffect, useRef, type ReactNode } from 'react'
import type { EdgeKind } from '../model/edges'
import { nodeStyle } from '../model/nodeStyle'
import type { Floor, GraphEdge, GraphNode } from '../model/types'
import { useViewport, type Point, type ViewportApi } from './useViewport'

export interface RenderEdge {
  edge: GraphEdge
  from: GraphNode
  to: GraphNode
  kind: EdgeKind
}

export interface FloorCanvasProps {
  floor: Floor | undefined
  nodes: GraphNode[]
  edges: RenderEdge[]
  selectedNodeIds?: ReadonlySet<string>
  selectedEdgeIds?: ReadonlySet<string>
  /** Nodes on the active route, drawn emphasised. */
  routeNodeIds?: ReadonlySet<string>
  /** Consecutive node pairs forming the route on this floor. */
  routeSegments?: Array<[GraphNode, GraphNode]>
  /** Hide the graph entirely — used by the viewer, which only shows the route. */
  hideGraph?: boolean
  showLabels?: boolean
  onCanvasPointerDown?: (pt: Point, event: React.PointerEvent) => void
  onCanvasPointerMove?: (pt: Point, event: React.PointerEvent) => void
  onCanvasPointerUp?: (pt: Point, event: React.PointerEvent) => void
  onNodePointerDown?: (nodeId: string, event: React.PointerEvent) => void
  onEdgePointerDown?: (edgeId: string, event: React.PointerEvent) => void
  /** Extra SVG drawn in image coordinates, above the graph. */
  overlay?: ReactNode
  viewportApi?: ViewportApi
  className?: string
  /** Treat a one-finger drag as map panning instead of an editing gesture. */
  panWithPrimaryPointer?: boolean
}


const EDGE_COLOR: Record<EdgeKind, string> = {
  walk: '#9b978f',
  stairs: '#3b92f0',
  elevator: '#7a5cf0',
  ramp: '#2aa9a0',
}

export function FloorCanvas({
  floor,
  nodes,
  edges,
  selectedNodeIds,
  selectedEdgeIds,
  routeNodeIds,
  routeSegments,
  hideGraph,
  showLabels,
  onCanvasPointerDown,
  onCanvasPointerMove,
  onCanvasPointerUp,
  onNodePointerDown,
  onEdgePointerDown,
  overlay,
  viewportApi,
  className,
  panWithPrimaryPointer = false,
}: FloorCanvasProps) {
  const internal = useViewport()
  const vp = viewportApi ?? internal
  const { svgRef, viewport, toImage, zoomAt, panBy, fit } = vp

  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<{ distance: number; centerX: number; centerY: number } | null>(null)
  const image = floor?.image

  // Frame the plan when the floor (or its image) changes.
  const fitKey = `${floor?.id ?? ''}:${image?.src ?? ''}`
  useEffect(() => {
    if (image) fit(image.widthPx, image.heightPx)
  }, [fitKey, fit, image])

  // Wheel zoom needs a non-passive listener to be able to preventDefault.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.12 : 1 / 1.12)
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [svgRef, zoomAt])

  /** Middle mouse, or shift-drag, pans — leaving plain drag free for editing gestures. */
  function isPanGesture(event: React.PointerEvent): boolean {
    return event.button === 1 || (event.button === 0 && event.shiftKey)
  }

  return (
    <svg
      ref={svgRef}
      className={`floor-canvas ${className ?? ''}`}
      onPointerDown={(event) => {
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
        if (pointers.current.size === 2) {
          gesture.current = twoFingerGesture(pointers.current)
          event.currentTarget.setPointerCapture(event.pointerId)
          return
        }
        if (panWithPrimaryPointer || isPanGesture(event)) {
          event.currentTarget.setPointerCapture(event.pointerId)
          return
        }
        onCanvasPointerDown?.(toImage(event.clientX, event.clientY), event)
      }}
      onPointerMove={(event) => {
        const previous = pointers.current.get(event.pointerId)
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
        if (pointers.current.size === 2) {
          const next = twoFingerGesture(pointers.current)
          const before = gesture.current
          if (before) {
            panBy(next.centerX - before.centerX, next.centerY - before.centerY)
            zoomAt(next.centerX, next.centerY, next.distance / before.distance)
          }
          gesture.current = next
          return
        }
        if (previous && (panWithPrimaryPointer || isPanGesture(event))) {
          panBy(event.clientX - previous.x, event.clientY - previous.y)
          return
        }
        onCanvasPointerMove?.(toImage(event.clientX, event.clientY), event)
      }}
      onPointerUp={(event) => {
        const wasGesture = pointers.current.size > 1 || panWithPrimaryPointer || isPanGesture(event)
        pointers.current.delete(event.pointerId)
        if (pointers.current.size < 2) gesture.current = null
        if (wasGesture) {
          return
        }
        onCanvasPointerUp?.(toImage(event.clientX, event.clientY), event)
      }}
      onPointerCancel={(event) => {
        pointers.current.delete(event.pointerId)
        if (pointers.current.size < 2) gesture.current = null
      }}
    >
      <g transform={`translate(${viewport.tx} ${viewport.ty}) scale(${viewport.scale})`}>
        {image ? (
          <image
            href={image.src}
            width={image.widthPx}
            height={image.heightPx}
            style={{ pointerEvents: 'none' }}
          />
        ) : (
          <g>
            <rect width={1000} height={600} fill="#1b1a18" />
            <text x={500} y={300} fill="#6e6a64" fontSize={22} textAnchor="middle">
              No floor plan uploaded for this floor yet
            </text>
          </g>
        )}

        {!hideGraph && (
          <g className="graph-edges">
            {edges.map(({ edge, from, to, kind }) => {
              const selected = selectedEdgeIds?.has(edge.id)
              return (
                <g key={edge.id}>
                  {/* Fat invisible line so thin edges are still easy to click. */}
                  <line
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    stroke="transparent"
                    strokeWidth={12 / viewport.scale}
                    style={{ cursor: onEdgePointerDown ? 'pointer' : 'default' }}
                    onPointerDown={(event) => {
                      if (!onEdgePointerDown) return
                      event.stopPropagation()
                      onEdgePointerDown(edge.id, event)
                    }}
                  />
                  <line
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    stroke={selected ? '#ffd24a' : EDGE_COLOR[kind]}
                    strokeWidth={(selected ? 3.4 : 2) / viewport.scale}
                    strokeDasharray={edge.wheelchair ? undefined : `${6 / viewport.scale}`}
                    style={{ pointerEvents: 'none' }}
                  />
                </g>
              )
            })}
          </g>
        )}

        {/* The route sits above the graph so it reads clearly over a busy floor. */}
        {routeSegments && routeSegments.length > 0 && (
          <g className="route">
            {routeSegments.map(([from, to], i) => (
              <line
                key={`${from.id}-${to.id}-${i}`}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke="#ff7e3d"
                strokeWidth={5 / viewport.scale}
                strokeLinecap="round"
                style={{ pointerEvents: 'none' }}
              />
            ))}
          </g>
        )}

        {!hideGraph && (
          <g className="graph-nodes">
            {nodes.map((node) => {
              const style = nodeStyle(node.kind)
              const selected = selectedNodeIds?.has(node.id)
              const onRoute = routeNodeIds?.has(node.id)
              return (
                <g key={node.id}>
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={(style.r + (selected ? 3 : 0)) / viewport.scale}
                    fill={style.fill}
                    stroke={selected ? '#ffd24a' : onRoute ? '#ff7e3d' : '#111'}
                    strokeWidth={(selected || onRoute ? 2.5 : 1) / viewport.scale}
                    style={{ cursor: onNodePointerDown ? 'pointer' : 'default' }}
                    onPointerDown={(event) => {
                      if (!onNodePointerDown) return
                      event.stopPropagation()
                      onNodePointerDown(node.id, event)
                    }}
                  />
                  {showLabels && node.roomNumber && (
                    <text
                      x={node.x + 9 / viewport.scale}
                      y={node.y + 4 / viewport.scale}
                      fill="#e8e4dc"
                      fontSize={12 / viewport.scale}
                      style={{ pointerEvents: 'none' }}
                    >
                      {node.roomNumber}
                    </text>
                  )}
                </g>
              )
            })}
          </g>
        )}

        {overlay}
      </g>
    </svg>
  )
}

function twoFingerGesture(pointers: Map<number, { x: number; y: number }>) {
  const [a, b] = [...pointers.values()]
  const dx = b.x - a.x
  const dy = b.y - a.y
  return {
    distance: Math.max(1, Math.hypot(dx, dy)),
    centerX: (a.x + b.x) / 2,
    centerY: (a.y + b.y) / 2,
  }
}

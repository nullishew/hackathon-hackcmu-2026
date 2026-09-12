/** A top-down campus map for one selected height across every building. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useViewport } from '../floor2d/useViewport'
import { worldPositionWith } from '../model/geometry'
import type { Labeler } from '../model/labels'
import { nodeStyle } from '../model/nodeStyle'
import type { Building, Floor, GraphNode, Project } from '../model/types'
import type { Route } from '../routing/route'
import { nearestPoint, TAP_RADIUS_PX, TAP_SLOP_PX, type PickTarget } from './pick'


/** Elevations are stored as metres; treat anything closer than a centimetre as the same slab. */
const ELEVATION_EPS = 0.01

interface MapFloor { building: Building; floor: Floor; matrix: string; corners: Array<{ x: number; y: number }> }

export function BuildingMap({
  project,
  route,
  labeler,
  picking,
  fromId,
  toId,
  onPickNode,
}: {
  project: Project
  route: Route | null
  labeler: Labeler
  /** Non-null while the user is choosing an endpoint by tapping the map. */
  picking: PickTarget | null
  fromId: string | null
  toId: string | null
  onPickNode: (nodeId: string) => void
}) {
  const levels = useMemo(
    () =>
      [...new Set(project.buildings.flatMap((b) => b.floors.map((f) => f.elevationM)))].sort(
        (a, b) => a - b,
      ),
    [project.buildings],
  )
  const [level, setLevel] = useState<number>(() => levels.find((elevation) => Math.abs(elevation) < ELEVATION_EPS) ?? levels[0] ?? 0)
  const { svgRef, viewport, fit, panBy, zoomAt } = useViewport()
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<{ distance: number; x: number; y: number } | null>(null)
  const mapFloors = useMemo(() => placeLevel(project, level), [level, project])
  const bounds = useMemo(() => boundsOf(mapFloors), [mapFloors])
  const [showPoints, setShowPoints] = useState(false)
  /** Picking is useless without the points visible, so it forces them on. */
  const pointsVisible = showPoints || picking !== null

  const nodesByFloor = useMemo(() => {
    const byFloor = new Map<string, GraphNode[]>()
    for (const node of Object.values(project.nodes)) {
      const list = byFloor.get(node.floorId)
      if (list) list.push(node)
      else byFloor.set(node.floorId, [node])
    }
    return byFloor
  }, [project.nodes])

  /** Every point on the floors currently shown, in map coordinates. */
  const points = useMemo(() => {
    const out: Array<{ node: GraphNode; x: number; y: number }> = []
    for (const { building, floor } of mapFloors) {
      for (const node of nodesByFloor.get(floor.id) ?? []) {
        const world = worldPositionWith(node, floor, building)
        if (world) out.push({ node, x: world.x, y: world.z })
      }
    }
    return out
  }, [mapFloors, nodesByFloor])

  useEffect(() => { fit(bounds.width, bounds.height) }, [bounds.height, bounds.width, fit, level])
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (event: WheelEvent) => { event.preventDefault(); zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.12 : 1 / 1.12) }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [svgRef, zoomAt])

  /**
   * Tap and pan share the same pointer stream, so track how far the gesture travelled and
   * treat only a near-stationary one as a tap. Doing the hit test ourselves rather than
   * with per-circle click handlers is deliberate: the SVG captures the pointer for
   * panning, so click events never reach the individual circles.
   */
  const tap = useRef<{ x: number; y: number; travel: number } | null>(null)

  function worldAt(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return null
    return {
      x: (clientX - rect.left - viewport.tx) / viewport.scale + bounds.minX,
      y: (clientY - rect.top - viewport.ty) / viewport.scale + bounds.minY,
    }
  }

  function nodeAt(clientX: number, clientY: number): GraphNode | null {
    const target = worldAt(clientX, clientY)
    if (!target) return null
    // Divide the tolerance by scale so it stays a constant size on screen at any zoom.
    return nearestPoint(points, target, TAP_RADIUS_PX / viewport.scale)?.node ?? null
  }

  function onMove(event: React.PointerEvent) {
    // A mouse pointer may continue to emit move events after a click ended outside the
    // SVG. Never treat hover movement as a map gesture; touch has no buttons value.
    if (event.pointerType === 'mouse' && event.buttons === 0) {
      pointers.current.delete(event.pointerId)
      return
    }
    const previous = pointers.current.get(event.pointerId)
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (tap.current && previous) {
      tap.current.travel += Math.hypot(event.clientX - previous.x, event.clientY - previous.y)
    }
    if (pointers.current.size === 2) {
      const next = pinch(pointers.current)
      if (gesture.current) { panBy(next.x - gesture.current.x, next.y - gesture.current.y); zoomAt(next.x, next.y, next.distance / gesture.current.distance) }
      gesture.current = next
    } else if (previous) panBy(event.clientX - previous.x, event.clientY - previous.y)
  }

  return <div className="building-map">
    <div className="map-toolbar">
      <label>Level<select value={level} onChange={(e) => setLevel(Number(e.target.value))}>{levels.map((ordinal) => <option key={ordinal} value={ordinal}>{levelName(project, ordinal)}</option>)}</select></label>
      <button type="button" className={pointsVisible ? 'chip active' : 'chip'} aria-pressed={pointsVisible} disabled={picking !== null} title={picking !== null ? 'Points stay visible while you are choosing an endpoint' : 'Show every point on this level'} onClick={() => setShowPoints(!showPoints)}>
        {points.length} points
      </button>
      <span>{mapFloors.map(({ building, floor }) => `${building.id} ${floor.floorKey}`).join(' · ')}</span>
    </div>
    <div className={picking ? 'map-help picking' : 'map-help'}>
      {picking
        ? `Tap a point to set ${picking === 'from' ? 'where you are' : 'where you are going'} · drag to move`
        : 'Drag to move · pinch or scroll to zoom'}
    </div>
    <svg ref={svgRef} className={picking ? 'floor-canvas building-map-canvas picking' : 'floor-canvas building-map-canvas'} onPointerDown={(event) => { pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY }); if (pointers.current.size === 2) gesture.current = pinch(pointers.current); tap.current = pointers.current.size === 1 ? { x: event.clientX, y: event.clientY, travel: 0 } : null; event.currentTarget.setPointerCapture(event.pointerId) }} onPointerMove={onMove} onPointerUp={(event) => {
      pointers.current.delete(event.pointerId)
      if (pointers.current.size < 2) gesture.current = null
      const gestureTap = tap.current
      tap.current = null
      if (!picking || !gestureTap || gestureTap.travel > TAP_SLOP_PX) return
      const hit = nodeAt(event.clientX, event.clientY)
      if (hit) onPickNode(hit.id)
    }} onPointerCancel={(event) => { pointers.current.delete(event.pointerId); gesture.current = null; tap.current = null }}>
      <g transform={`translate(${viewport.tx - bounds.minX * viewport.scale} ${viewport.ty - bounds.minY * viewport.scale}) scale(${viewport.scale})`}>
        {mapFloors.map(({ building, floor, matrix, corners }) => <g key={floor.id}>
          <image href={floor.image?.src} width={floor.image?.widthPx} height={floor.image?.heightPx} transform={matrix} />
          <path d={`${corners.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ')} Z`} fill="none" stroke="#4a453c" strokeWidth={1 / viewport.scale} />
          <text x={corners[0].x} y={corners[0].y - 5 / viewport.scale} fill="#e8e4dc" fontSize={15 / viewport.scale} fontWeight={650}>{building.id} · floor {floor.floorKey}</text>
        </g>)}
        {pointsVisible && (
          <g className="map-points">
            {points.map(({ node, x, y }) => (
              <circle
                key={node.id}
                cx={x}
                cy={y}
                r={(nodeStyle(node.kind).r * 0.6) / viewport.scale}
                fill={nodeStyle(node.kind).fill}
                stroke="#14130f"
                strokeWidth={0.8 / viewport.scale}
              >
                <title>{labeler.labelFor(node)}</title>
              </circle>
            ))}
          </g>
        )}

        {/* Chosen endpoints stay visible whether or not the points layer is on. */}
        {points
          .filter(({ node }) => node.id === fromId || node.id === toId)
          .map(({ node, x, y }) => (
            <g key={`endpoint-${node.id}`}>
              <circle
                cx={x}
                cy={y}
                r={7 / viewport.scale}
                fill={node.id === fromId ? '#5bd1a0' : '#ff4d4d'}
                stroke="#14130f"
                strokeWidth={1.6 / viewport.scale}
              />
              <text
                x={x + 10 / viewport.scale}
                y={y + 4 / viewport.scale}
                fill="#e8e4dc"
                fontSize={13 / viewport.scale}
                style={{ pointerEvents: 'none' }}
              >
                {node.id === fromId ? 'Start' : 'Destination'}
              </text>
            </g>
          ))}

        {(route?.legs ?? []).flatMap((leg) => {
          const placed = mapFloors.find(({ floor }) => floor.id === leg.floorId)
          if (!placed) return []
          return leg.steps.flatMap((step, index) => {
            const from = worldPositionWith(step.from, placed.floor, placed.building); const to = worldPositionWith(step.to, placed.floor, placed.building)
            return from && to ? <line key={`${leg.floorId}-${index}`} x1={from.x} y1={from.z} x2={to.x} y2={to.z} stroke="#ff7e3d" strokeWidth={5 / viewport.scale} strokeLinecap="round" /> : []
          })
        })}
      </g>
    </svg>
  </div>
}

function placeLevel(project: Project, elevationM: number): MapFloor[] {
  return project.buildings.flatMap((building) => {
    const floor = building.floors.find((candidate) => Math.abs(candidate.elevationM - elevationM) < ELEVATION_EPS)
    if (!floor?.image || !floor.calibration) return []
    const p00 = worldPositionWith({ x: 0, y: 0 }, floor, building); const p10 = worldPositionWith({ x: floor.image.widthPx, y: 0 }, floor, building); const p01 = worldPositionWith({ x: 0, y: floor.image.heightPx }, floor, building); const p11 = worldPositionWith({ x: floor.image.widthPx, y: floor.image.heightPx }, floor, building)
    if (!p00 || !p10 || !p01 || !p11) return []
    return [{ building, floor, matrix: `matrix(${(p10.x - p00.x) / floor.image.widthPx} ${(p10.z - p00.z) / floor.image.widthPx} ${(p01.x - p00.x) / floor.image.heightPx} ${(p01.z - p00.z) / floor.image.heightPx} ${p00.x} ${p00.z})`, corners: [p00, p10, p11, p01].map(({ x, z }) => ({ x, y: z })) }]
  })
}

function boundsOf(floors: MapFloor[]) {
  const points = floors.flatMap(({ corners }) => corners)
  const minX = Math.min(...points.map((point) => point.x), 0); const minY = Math.min(...points.map((point) => point.y), 0); const maxX = Math.max(...points.map((point) => point.x), 100); const maxY = Math.max(...points.map((point) => point.y), 100); const margin = 12
  return { minX: minX - margin, minY: minY - margin, width: maxX - minX + margin * 2, height: maxY - minY + margin * 2 }
}
function levelName(project: Project, elevationM: number) {
  const labels = project.buildings.flatMap((building) =>
    building.floors
      .filter((floor) => Math.abs(floor.elevationM - elevationM) < ELEVATION_EPS)
      .map((floor) => `${building.id} ${floor.floorKey}`),
  )
  const height = Number.isInteger(elevationM) ? `${elevationM}` : elevationM.toFixed(2)
  return labels.length === 0 ? `${height} m` : `${height} m · ${labels.join(' / ')}`
}
function pinch(points: Map<number, { x: number; y: number }>) { const [a, b] = [...points.values()]; return { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }

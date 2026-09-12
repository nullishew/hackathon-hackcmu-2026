/** A top-down campus map for one selected height across every building. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useViewport } from '../floor2d/useViewport'
import { worldPositionWith } from '../model/geometry'
import type { Building, Floor, Project } from '../model/types'
import type { Route } from '../routing/route'

/** Elevations are stored as metres; treat anything closer than a centimetre as the same slab. */
const ELEVATION_EPS = 0.01

interface MapFloor { building: Building; floor: Floor; matrix: string; corners: Array<{ x: number; y: number }> }

export function BuildingMap({ project, route }: { project: Project; route: Route | null }) {
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

  useEffect(() => { fit(bounds.width, bounds.height) }, [bounds.height, bounds.width, fit, level])
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (event: WheelEvent) => { event.preventDefault(); zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.12 : 1 / 1.12) }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [svgRef, zoomAt])

  function onMove(event: React.PointerEvent) {
    // A mouse pointer may continue to emit move events after a click ended outside the
    // SVG. Never treat hover movement as a map gesture; touch has no buttons value.
    if (event.pointerType === 'mouse' && event.buttons === 0) {
      pointers.current.delete(event.pointerId)
      return
    }
    const previous = pointers.current.get(event.pointerId)
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointers.current.size === 2) {
      const next = pinch(pointers.current)
      if (gesture.current) { panBy(next.x - gesture.current.x, next.y - gesture.current.y); zoomAt(next.x, next.y, next.distance / gesture.current.distance) }
      gesture.current = next
    } else if (previous) panBy(event.clientX - previous.x, event.clientY - previous.y)
  }

  return <div className="building-map">
    <div className="map-toolbar"><label>Level<select value={level} onChange={(e) => setLevel(Number(e.target.value))}>{levels.map((ordinal) => <option key={ordinal} value={ordinal}>{levelName(project, ordinal)}</option>)}</select></label><span>{mapFloors.map(({ building, floor }) => `${building.id} ${floor.floorKey}`).join(' · ')}</span></div>
    <div className="map-help">Drag to move · pinch or scroll to zoom</div>
    <svg ref={svgRef} className="floor-canvas building-map-canvas" onPointerDown={(event) => { pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY }); if (pointers.current.size === 2) gesture.current = pinch(pointers.current); event.currentTarget.setPointerCapture(event.pointerId) }} onPointerMove={onMove} onPointerUp={(event) => { pointers.current.delete(event.pointerId); if (pointers.current.size < 2) gesture.current = null }} onPointerCancel={(event) => { pointers.current.delete(event.pointerId); gesture.current = null }}>
      <g transform={`translate(${viewport.tx - bounds.minX * viewport.scale} ${viewport.ty - bounds.minY * viewport.scale}) scale(${viewport.scale})`}>
        {mapFloors.map(({ building, floor, matrix, corners }) => <g key={floor.id}>
          <image href={floor.image?.src} width={floor.image?.widthPx} height={floor.image?.heightPx} transform={matrix} />
          <path d={`${corners.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ')} Z`} fill="none" stroke="#4a453c" strokeWidth={1 / viewport.scale} />
          <text x={corners[0].x} y={corners[0].y - 5 / viewport.scale} fill="#e8e4dc" fontSize={15 / viewport.scale} fontWeight={650}>{building.id} · floor {floor.floorKey}</text>
        </g>)}
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

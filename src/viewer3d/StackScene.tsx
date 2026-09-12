/**
 * The 3D stack: every floor plan as a textured plane at its own elevation, with the
 * route drawn as one continuous line through the whole building.
 *
 * Floor planes are built from their four world-space corners rather than from a
 * position-plus-rotation, so calibration rotation and building placement are handled by
 * the same code that positions the nodes. The plane and the points on it cannot disagree.
 *
 * Vertical exaggeration is display-only: Gates is ~100 m across but only ~22 m tall, and
 * at true scale the stack reads as a squashed pile rather than a building.
 */
import { Line, OrbitControls, useTexture } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { Suspense, useMemo } from 'react'
import * as THREE from 'three'
import type { Project } from '../model/types'
import type { Route } from '../routing/route'
import { boundsOf, buildQuad, placeFloors, routeToPoints, type PlacedFloor } from './stackGeometry'

export interface StackSceneProps {
  project: Project
  route: Route | null
  activeFloorId: string | null
  verticalExaggeration: number
  onSelectFloor: (floorId: string) => void
}

export function StackScene({
  project,
  route,
  activeFloorId,
  verticalExaggeration,
  onSelectFloor,
}: StackSceneProps) {
  const placed = useMemo(() => placeFloors(project, verticalExaggeration), [project, verticalExaggeration])

  const routePoints = useMemo(
    () => (route ? routeToPoints(project, route, verticalExaggeration) : []),
    [project, route, verticalExaggeration],
  )

  const routeFloorIds = useMemo(
    () => new Set(route?.legs.map((l) => l.floorId) ?? []),
    [route],
  )

  const { center, radius } = useMemo(() => boundsOf(placed), [placed])

  if (placed.length === 0) {
    return (
      <div className="screen-message">
        No floor plans placed yet. Upload one on the data entry screen.
      </div>
    )
  }

  return (
    <Canvas camera={{ position: [center.x + radius, center.y + radius * 0.9, center.z + radius], fov: 45 }}>
      <ambientLight intensity={1.1} />
      <directionalLight position={[1, 2, 1]} intensity={0.5} />

      <Suspense fallback={null}>
        {placed.map((p) => (
          <FloorPlane
            key={p.floor.id}
            placed={p}
            active={p.floor.id === activeFloorId}
            onRoute={routeFloorIds.has(p.floor.id)}
            anyRoute={routeFloorIds.size > 0}
            onSelect={() => onSelectFloor(p.floor.id)}
          />
        ))}
      </Suspense>

      {routePoints.length >= 2 && (
        <>
          <Line points={routePoints} color="#ff7e3d" lineWidth={4} />
          <mesh position={routePoints[0]}>
            <sphereGeometry args={[1.2, 16, 16]} />
            <meshBasicMaterial color="#5bd1a0" />
          </mesh>
          <mesh position={routePoints[routePoints.length - 1]}>
            <sphereGeometry args={[1.2, 16, 16]} />
            <meshBasicMaterial color="#ff4d4d" />
          </mesh>
        </>
      )}

      <OrbitControls target={center} makeDefault />
    </Canvas>
  )
}

interface PlaneProps {
  placed: PlacedFloor
  active: boolean
  onRoute: boolean
  anyRoute: boolean
  onSelect: () => void
}

/**
 * A floor with no plan image must not take the textured path: useTexture suspends, and
 * an empty src would hold the entire Suspense boundary — blanking the whole stack
 * because one floor has not been uploaded yet.
 */
function FloorPlane(props: PlaneProps) {
  const src = props.placed.floor.image?.src
  return src ? <TexturedPlane {...props} src={src} /> : <BlankPlane {...props} />
}

function TexturedPlane({ src, ...props }: PlaneProps & { src: string }) {
  const texture = useTexture(src)
  return <PlaneMesh {...props} map={texture} color="#ffffff" />
}

function BlankPlane(props: PlaneProps) {
  return <PlaneMesh {...props} map={null} color="#2a2824" />
}

function PlaneMesh({
  placed,
  active,
  onRoute,
  anyRoute,
  onSelect,
  map,
  color,
}: PlaneProps & { map: THREE.Texture | null; color: string }) {
  const geometry = useMemo(() => buildQuad(placed.corners), [placed.corners])

  // Floors the route never touches fade back so the route reads through the stack.
  const opacity = active ? 1 : onRoute ? 0.95 : anyRoute ? 0.3 : 0.75

  return (
    <mesh
      geometry={geometry}
      onClick={(event) => {
        event.stopPropagation()
        onSelect()
      }}
    >
      <meshBasicMaterial
        map={map}
        color={color}
        transparent
        opacity={opacity}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  )
}

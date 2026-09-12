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
import { Suspense, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { Project } from '../model/types'
import type { Route } from '../routing/route'
import { boundsOf, buildQuad, placeFloors, routeToPoints, type PlacedFloor } from './stackGeometry'

const FLOOR_OPACITY = 0.67

const FLOOR_PLAN_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const FLOOR_PLAN_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D map;
  uniform vec2 texelSize;
  uniform float floorOpacity;
  varying vec2 vUv;

  float inkAmount(vec4 pixel) {
    float luminance = dot(pixel.rgb, vec3(0.2126, 0.7152, 0.0722));
    // Treat the dark CAD strokes and labels as ink, leaving colored floor fills intact.
    return (1.0 - smoothstep(0.20, 0.48, luminance)) * step(0.001, pixel.a);
  }

  void main() {
    vec4 pixel = texture2D(map, vUv);

    // Do not turn the transparent canvas surrounding a plan into a translucent floor.
    if (pixel.a < 0.001) discard;

    // Pull adjacent ink one source pixel inward to make fine strokes and lettering legible
    // without extending the plan into any transparent source pixels.
    float ink = inkAmount(pixel);
    ink = max(ink, inkAmount(texture2D(map, vUv + vec2(texelSize.x, 0.0))));
    ink = max(ink, inkAmount(texture2D(map, vUv - vec2(texelSize.x, 0.0))));
    ink = max(ink, inkAmount(texture2D(map, vUv + vec2(0.0, texelSize.y))));
    ink = max(ink, inkAmount(texture2D(map, vUv - vec2(0.0, texelSize.y))));

    gl_FragColor = vec4(mix(pixel.rgb, vec3(0.0), ink), mix(pixel.a * floorOpacity, pixel.a, ink));
  }
`

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

      <ExplorerControls target={center} radius={radius} />
    </Canvas>
  )
}

/**
 * OrbitControls becomes a practical free-exploration camera when panning is enabled:
 * drag to look around, right-drag/two-finger drag to translate, and pinch/wheel to
 * move into a detail. These gestures work consistently with a mouse, trackpad, or phone.
 */
function ExplorerControls({ target, radius }: { target: THREE.Vector3; radius: number }) {
  const controls = useRef<OrbitControlsImpl>(null)

  useEffect(() => {
    const current = controls.current
    if (!current) return
    current.minDistance = Math.max(1, radius * 0.025)
    current.maxDistance = Math.max(100, radius * 30)
    current.zoomToCursor = true
    // Keep input sensitivity stable; OrbitControls applies the same proportional
    // dolly step at every distance, so a scroll/pinch always feels relative to scale.
    current.zoomSpeed = 0.85
    current.panSpeed = 1
  }, [radius])

  return (
    <OrbitControls
      ref={controls}
      target={target}
      makeDefault
      enableDamping
      dampingFactor={0.09}
      enablePan
      screenSpacePanning
      minPolarAngle={0.02}
      maxPolarAngle={Math.PI - 0.02}
      touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
      mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }}
    />
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
  const image = texture.image as { width: number; height: number }
  const texelSize = useMemo(
    () => new THREE.Vector2(1 / image.width, 1 / image.height),
    [image.height, image.width],
  )

  return <FloorPlanMesh {...props} map={texture} texelSize={texelSize} />
}

function BlankPlane(props: PlaneProps) {
  return <BlankPlaneMesh {...props} />
}

function FloorPlanMesh({
  placed,
  onSelect,
  map,
  texelSize,
}: PlaneProps & { map: THREE.Texture; texelSize: THREE.Vector2 }) {
  const geometry = useMemo(() => buildQuad(placed.corners), [placed.corners])

  return (
    <mesh
      geometry={geometry}
      onClick={(event) => {
        event.stopPropagation()
        onSelect()
      }}
    >
      <shaderMaterial
        uniforms={{
          map: { value: map },
          texelSize: { value: texelSize },
          floorOpacity: { value: FLOOR_OPACITY },
        }}
        vertexShader={FLOOR_PLAN_VERTEX_SHADER}
        fragmentShader={FLOOR_PLAN_FRAGMENT_SHADER}
        transparent
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  )
}

function BlankPlaneMesh({ placed, onSelect }: PlaneProps) {
  const geometry = useMemo(() => buildQuad(placed.corners), [placed.corners])

  return (
    <mesh
      geometry={geometry}
      onClick={(event) => {
        event.stopPropagation()
        onSelect()
      }}
    >
      <meshBasicMaterial color="#2a2824" transparent opacity={FLOOR_OPACITY} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  )
}

/**
 * Core data model. Zod schemas are the single source of truth; TS types are derived,
 * so anything we load off disk is validated and typed by the same definition.
 */
import { z } from 'zod'

/** What a plotted point represents. */
export const NodeKind = z.enum([
  'room',
  'corner', // a turn or junction in a corridor — the most common kind by far
  'stairs',
  'elevator',
  'ramp',
  'door',
  'entrance',
  'restroom',
  'poi',
])
export type NodeKind = z.infer<typeof NodeKind>

/**
 * A node. Position is in PIXELS on its floor's plan image; the floor's calibration
 * lifts it into world metres. Storing pixels means re-calibrating a floor never
 * requires touching its nodes.
 */
export const GraphNode = z.object({
  id: z.string(),
  floorId: z.string(),
  x: z.number(),
  y: z.number(),
  kind: NodeKind,
  roomNumber: z.string().optional(),
  /** Curated name. Everything else is derived by labelFor(). */
  name: z.string().optional(),
  aliases: z.array(z.string()).optional(),
  /** The named corridor / stairwell / bridge this node belongs to. */
  featureId: z.string().optional(),
})
export type GraphNode = z.infer<typeof GraphNode>

/**
 * An edge. Exactly three pieces of data beyond its endpoints: 3D distance,
 * tiredness multiplier, wheelchair accessibility.
 *
 * Time is NOT stored — it is estimated for display from distance and speed.
 * Edge kind is NOT stored — it is derived from the two node kinds.
 */
export const GraphEdge = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  /** When true the edge is traversable in both directions. */
  bidirectional: z.boolean(),
  /** 3D distance in metres (horizontal run plus rise). */
  distanceM: z.number().nonnegative(),
  tiredIndex: z.number().nonnegative(),
  wheelchair: z.boolean(),
})
export type GraphEdge = z.infer<typeof GraphEdge>

/** Maps plan-image pixels to metres. Set by drawing one reference line of known length. */
export const Calibration = z.object({
  pixelsPerMeter: z.number().positive(),
  /** Pixel coordinates of this floor's local origin. */
  originX: z.number(),
  originY: z.number(),
  /** Rotation of the plan relative to its building's axes. */
  rotationDeg: z.number(),
})
export type Calibration = z.infer<typeof Calibration>

export const FloorImage = z.object({
  src: z.string(),
  widthPx: z.number().positive(),
  heightPx: z.number().positive(),
})
export type FloorImage = z.infer<typeof FloorImage>

export const Floor = z.object({
  /** `${buildingId}:${floorKey}` */
  id: z.string(),
  buildingId: z.string(),
  /** The label humans use: '4', 'A', 'B2'. */
  floorKey: z.string(),
  /** Orders the floor switcher and the 3D stack. */
  ordinal: z.number(),
  /** Absolute height of this floor's slab, in metres. Drives rise and 3D placement. */
  elevationM: z.number(),
  image: FloorImage.optional(),
  calibration: Calibration.optional(),
})
export type Floor = z.infer<typeof Floor>

export const Building = z.object({
  /** Short code, also the id: 'GHC'. */
  id: z.string(),
  name: z.string(),
  /**
   * Conversational form used in room labels: 'Doherty' gives "Doherty 2315", where the
   * full name would give the clunkier "Doherty Hall 2315". Defaults to the id.
   */
  shortName: z.string().optional(),
  /** Where this building sits in the shared world, in metres. */
  placement: z.object({ x: z.number(), y: z.number(), rotationDeg: z.number() }),
  floors: z.array(Floor),
})
export type Building = z.infer<typeof Building>

/** A named piece of circulation. Naming these is what lets node labels derive themselves. */
export const FeatureKind = z.enum([
  'corridor',
  'stairwell',
  'elevator_bank',
  'bridge',
  'tunnel',
  'atrium',
  'ramp',
  'exit',
])
export type FeatureKind = z.infer<typeof FeatureKind>

export const Feature = z.object({
  id: z.string(),
  kind: FeatureKind,
  name: z.string(),
  buildingId: z.string().optional(),
  aliases: z.array(z.string()).optional(),
})
export type Feature = z.infer<typeof Feature>

/** What one per-floor file on disk holds. */
export const FloorGraphFile = z.object({
  floorId: z.string(),
  nodes: z.array(GraphNode),
  /** Cross-floor edges are owned by the file of `from`'s floor. */
  edges: z.array(GraphEdge),
})
export type FloorGraphFile = z.infer<typeof FloorGraphFile>

export const BuildingsFile = z.object({
  buildings: z.array(Building),
  features: z.array(Feature).default([]),
})
export type BuildingsFile = z.infer<typeof BuildingsFile>

/** The whole dataset, flattened for fast lookup. Split back into per-floor files on save. */
export interface Project {
  buildings: Building[]
  features: Feature[]
  nodes: Record<string, GraphNode>
  edges: Record<string, GraphEdge>
}

export function emptyProject(): Project {
  return { buildings: [], features: [], nodes: {}, edges: {} }
}

/* ---------- lookup helpers ---------- */

export function floorsOf(project: Project): Floor[] {
  return project.buildings.flatMap((b) => b.floors)
}

export function findFloor(project: Project, floorId: string): Floor | undefined {
  return floorsOf(project).find((f) => f.id === floorId)
}

export function findBuilding(project: Project, buildingId: string): Building | undefined {
  return project.buildings.find((b) => b.id === buildingId)
}

/** The building a floor belongs to. */
export function buildingOfFloor(project: Project, floorId: string): Building | undefined {
  return project.buildings.find((b) => b.floors.some((f) => f.id === floorId))
}

export function makeFloorId(buildingId: string, floorKey: string): string {
  return `${buildingId}:${floorKey}`
}

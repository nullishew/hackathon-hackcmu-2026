/**
 * The editor's single source of truth.
 *
 * Undo is snapshot-based rather than a command log: the dataset is small enough that
 * copying the node and edge maps per edit is cheap, and snapshots cannot drift out of
 * sync with the model the way hand-written inverse operations do.
 *
 * Saving is debounced per dirty floor, so a burst of plotting produces one write per
 * floor rather than one per click.
 */
import { create } from 'zustand'
import { suggestDistanceM } from '../model/autoDistance'
import { defaultTiredIndex, defaultWheelchair } from '../model/edges'
import { findExistingEdge, makeEdgeId, nextNodeId } from '../model/ids'
import {
  buildingOfFloor,
  emptyProject,
  findFloor,
  type Building,
  type Calibration,
  type Feature,
  type EdgeKind,
  type Floor,
  type GraphEdge,
  type GraphNode,
  type NodeKind,
  type Project,
} from '../model/types'
import { fetchProject, putBuildings, putFloor, uploadFloorplan } from './api'

const HISTORY_LIMIT = 120
const SAVE_DEBOUNCE_MS = 700

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface Selection {
  nodeIds: string[]
  edgeIds: string[]
}

interface ProjectState {
  project: Project
  status: LoadStatus
  error: string | null
  /**
   * True when the graph came from the baked snapshot, so there is no API to save to —
   * the public build. Surfaced in the editor rather than letting every edit fail silently.
   */
  readOnly: boolean
  /** Floors whose graph has unsaved changes. */
  dirtyFloors: Set<string>
  buildingsDirty: boolean
  saving: boolean
  lastSavedAt: number | null
  past: Project[]
  future: Project[]
  selection: Selection

  load: () => Promise<void>
  flush: () => Promise<void>

  undo: () => void
  redo: () => void

  select: (selection: Partial<Selection>) => void
  clearSelection: () => void

  /**
   * Record one undo point for a gesture that will produce many updates — a drag emits a
   * move per pointer event, and each of those must not become its own undo step.
   */
  beginHistoryGroup: () => void

  addNode: (floorId: string, x: number, y: number, kind: NodeKind) => string | null
  moveNode: (nodeId: string, x: number, y: number) => void
  /** Move without recording history; pair with beginHistoryGroup at gesture start. */
  moveNodeLive: (nodeId: string, x: number, y: number) => void
  updateNode: (nodeId: string, patch: Partial<GraphNode>) => void
  deleteNodes: (nodeIds: string[]) => void

  connect: (fromId: string, toId: string) => string | null
  updateEdge: (edgeId: string, patch: Partial<GraphEdge>) => void
  deleteEdges: (edgeIds: string[]) => void
  recomputeEdgeDistance: (edgeId: string) => void

  /** Extend a stairwell or elevator through a set of floors in one action. */
  linkThroughFloors: (nodeId: string, targetFloorIds: string[]) => number
  /** Copy a traced floor onto another floor — CMU towers repeat, so this is the big one. */
  stampFloor: (sourceFloorId: string, targetFloorId: string) => { nodes: number; edges: number }

  updateFloor: (floorId: string, patch: Partial<Floor>) => void
  setCalibration: (floorId: string, calibration: Calibration) => void
  attachFloorplan: (floorId: string, file: File) => Promise<void>
  addFloor: (buildingId: string, floorKey: string, elevationM: number) => void
  addBuilding: (building: Building) => void
  upsertFeature: (feature: Feature) => void
}

/** Shallow-copy the mutable parts. Buildings are copied only when they change. */
function snapshot(project: Project): Project {
  return {
    buildings: project.buildings,
    features: project.features,
    nodes: { ...project.nodes },
    edges: { ...project.edges },
  }
}

export const useProjectStore = create<ProjectState>((set, get) => {
  const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()

  /** Record the pre-edit state for undo and drop any redo branch. */
  function pushHistory(): void {
    const { project, past } = get()
    const next = [...past, snapshot(project)]
    if (next.length > HISTORY_LIMIT) next.shift()
    set({ past: next, future: [] })
  }

  function markFloorDirty(floorId: string): void {
    if (get().readOnly) return
    const dirty = new Set(get().dirtyFloors)
    dirty.add(floorId)
    set({ dirtyFloors: dirty })
    scheduleSave(floorId)
  }

  function markBuildingsDirty(): void {
    if (get().readOnly) return
    set({ buildingsDirty: true })
    scheduleBuildingsSave()
  }

  function scheduleSave(floorId: string): void {
    clearTimeout(saveTimers.get(floorId))
    saveTimers.set(
      floorId,
      setTimeout(() => {
        void saveFloorNow(floorId)
      }, SAVE_DEBOUNCE_MS),
    )
  }

  function scheduleBuildingsSave(): void {
    clearTimeout(saveTimers.get('__buildings__'))
    saveTimers.set(
      '__buildings__',
      setTimeout(() => {
        void saveBuildingsNow()
      }, SAVE_DEBOUNCE_MS),
    )
  }

  async function saveFloorNow(floorId: string): Promise<void> {
    const { project } = get()
    const nodes = Object.values(project.nodes).filter((n) => n.floorId === floorId)
    // Cross-floor edges live with their `from` node's floor, so each edge saves once.
    const edges = Object.values(project.edges).filter(
      (e) => project.nodes[e.from]?.floorId === floorId,
    )

    set({ saving: true })
    try {
      await putFloor(floorId, nodes, edges)
      const dirty = new Set(get().dirtyFloors)
      dirty.delete(floorId)
      set({ dirtyFloors: dirty, lastSavedAt: Date.now(), error: null })
    } catch (err) {
      set({ error: `Could not save floor ${floorId}: ${(err as Error).message}` })
    } finally {
      set({ saving: false })
    }
  }

  async function saveBuildingsNow(): Promise<void> {
    const { project } = get()
    set({ saving: true })
    try {
      await putBuildings(project.buildings, project.features)
      set({ buildingsDirty: false, lastSavedAt: Date.now(), error: null })
    } catch (err) {
      set({ error: `Could not save buildings: ${(err as Error).message}` })
    } finally {
      set({ saving: false })
    }
  }

  /**
   * A node that moved invalidates the geometry its edges were measured from, so their
   * distances are recomputed. A hand-entered distance therefore survives until the
   * shape of the route actually changes, which is the behaviour that surprises least.
   */
  function recomputeEdgesTouching(project: Project, nodeId: string): void {
    for (const edge of Object.values(project.edges)) {
      if (edge.from !== nodeId && edge.to !== nodeId) continue
      const from = project.nodes[edge.from]
      const to = project.nodes[edge.to]
      if (!from || !to) continue
      const suggestion = suggestDistanceM(project, from, to, edge.kind)
      if (suggestion) {
        project.edges[edge.id] = { ...edge, distanceM: round2(suggestion.distanceM) }
      }
    }
  }

  function applyMove(nodeId: string, x: number, y: number): void {
    const existing = get().project.nodes[nodeId]
    if (!existing) return
    const project = snapshot(get().project)
    project.nodes[nodeId] = { ...existing, x: round2(x), y: round2(y) }
    recomputeEdgesTouching(project, nodeId)
    set({ project })
    markFloorDirty(existing.floorId)
  }

  return {
    project: emptyProject(),
    status: 'idle',
    error: null,
    readOnly: false,
    dirtyFloors: new Set(),
    buildingsDirty: false,
    saving: false,
    lastSavedAt: null,
    past: [],
    future: [],
    selection: { nodeIds: [], edgeIds: [] },

    async load() {
      set({ status: 'loading', error: null })
      try {
        const { project, source } = await fetchProject()
        set({ project, status: 'ready', readOnly: source === 'snapshot' })
      } catch (err) {
        set({ status: 'error', error: (err as Error).message })
      }
    },

    /** Write everything pending immediately — used before navigating away. */
    async flush() {
      for (const timer of saveTimers.values()) clearTimeout(timer)
      saveTimers.clear()
      const { dirtyFloors, buildingsDirty } = get()
      for (const floorId of dirtyFloors) await saveFloorNow(floorId)
      if (buildingsDirty) await saveBuildingsNow()
    },

    undo() {
      const { past, future, project } = get()
      if (past.length === 0) return
      const previous = past[past.length - 1]
      set({
        project: previous,
        past: past.slice(0, -1),
        future: [snapshot(project), ...future].slice(0, HISTORY_LIMIT),
      })
      for (const floorId of affectedFloors(previous)) markFloorDirty(floorId)
    },

    redo() {
      const { past, future, project } = get()
      if (future.length === 0) return
      const next = future[0]
      set({
        project: next,
        past: [...past, snapshot(project)].slice(-HISTORY_LIMIT),
        future: future.slice(1),
      })
      for (const floorId of affectedFloors(next)) markFloorDirty(floorId)
    },

    select(selection) {
      set({ selection: { ...get().selection, ...selection } })
    },

    clearSelection() {
      set({ selection: { nodeIds: [], edgeIds: [] } })
    },

    addNode(floorId, x, y, kind) {
      const floor = findFloor(get().project, floorId)
      const building = buildingOfFloor(get().project, floorId)
      if (!floor || !building) return null

      pushHistory()
      const project = snapshot(get().project)
      const id = nextNodeId(project, building.id, floor.floorKey, kind)
      project.nodes[id] = { id, floorId, x: round2(x), y: round2(y), kind }
      set({ project })
      markFloorDirty(floorId)
      return id
    },

    beginHistoryGroup() {
      pushHistory()
    },

    moveNode(nodeId, x, y) {
      pushHistory()
      applyMove(nodeId, x, y)
    },

    moveNodeLive(nodeId, x, y) {
      applyMove(nodeId, x, y)
    },

    updateNode(nodeId, patch) {
      const existing = get().project.nodes[nodeId]
      if (!existing) return

      pushHistory()
      const project = snapshot(get().project)
      project.nodes[nodeId] = { ...existing, ...patch, id: nodeId, floorId: existing.floorId }
      // Deliberately does NOT touch the edges. An edge's kind, tiredness and accessibility
      // are entered by hand, and silently rewriting them when a node is reclassified would
      // throw away those corrections.
      set({ project })
      markFloorDirty(existing.floorId)
    },

    deleteNodes(nodeIds) {
      if (nodeIds.length === 0) return
      pushHistory()
      const project = snapshot(get().project)
      const doomed = new Set(nodeIds)
      const floors = new Set<string>()

      for (const id of nodeIds) {
        const node = project.nodes[id]
        if (node) floors.add(node.floorId)
        delete project.nodes[id]
      }
      // Never leave an edge dangling.
      for (const edge of Object.values(project.edges)) {
        if (doomed.has(edge.from) || doomed.has(edge.to)) delete project.edges[edge.id]
      }

      set({ project, selection: { nodeIds: [], edgeIds: [] } })
      for (const floorId of floors) markFloorDirty(floorId)
    },

    connect(fromId, toId) {
      if (fromId === toId) return null
      const current = get().project
      const from = current.nodes[fromId]
      const to = current.nodes[toId]
      if (!from || !to) return null

      // Edge ids derive from their endpoints, so reconnecting is idempotent.
      const existing = findExistingEdge(current, fromId, toId)
      if (existing) return existing

      pushHistory()
      const project = snapshot(current)
      // New edges start as a level walk — the overwhelming majority are — and the kind is
      // then set by hand in the inspector. Nothing guesses it from the two floors.
      const kind: EdgeKind = 'walk'
      const suggestion = suggestDistanceM(project, from, to, kind)
      const id = makeEdgeId(fromId, toId)
      project.edges[id] = {
        id,
        from: fromId,
        to: toId,
        bidirectional: true,
        kind,
        distanceM: suggestion ? round2(suggestion.distanceM) : 0,
        tiredIndex: defaultTiredIndex(kind),
        wheelchair: defaultWheelchair(kind),
      }
      set({ project })
      markFloorDirty(from.floorId)
      return id
    },

    updateEdge(edgeId, patch) {
      const existing = get().project.edges[edgeId]
      if (!existing) return

      pushHistory()
      const project = snapshot(get().project)
      project.edges[edgeId] = { ...existing, ...patch, id: edgeId }
      set({ project })
      const owner = project.nodes[existing.from]?.floorId
      if (owner) markFloorDirty(owner)
    },

    deleteEdges(edgeIds) {
      if (edgeIds.length === 0) return
      pushHistory()
      const project = snapshot(get().project)
      const floors = new Set<string>()
      for (const id of edgeIds) {
        const edge = project.edges[id]
        if (!edge) continue
        const owner = project.nodes[edge.from]?.floorId
        if (owner) floors.add(owner)
        delete project.edges[id]
      }
      set({ project, selection: { ...get().selection, edgeIds: [] } })
      for (const floorId of floors) markFloorDirty(floorId)
    },

    recomputeEdgeDistance(edgeId) {
      const current = get().project
      const edge = current.edges[edgeId]
      if (!edge) return
      const from = current.nodes[edge.from]
      const to = current.nodes[edge.to]
      if (!from || !to) return
      const suggestion = suggestDistanceM(current, from, to, edge.kind)
      if (!suggestion) return
      get().updateEdge(edgeId, { distanceM: round2(suggestion.distanceM) })
    },

    /**
     * Place a matching node at the same spot on each target floor and chain them
     * together in floor order. A nine-storey stairwell becomes one gesture instead of
     * nine placements and eight connections.
     */
    linkThroughFloors(nodeId, targetFloorIds) {
      const current = get().project
      const source = current.nodes[nodeId]
      if (!source) return 0

      pushHistory()
      const project = snapshot(current)
      const touched = new Set<string>([source.floorId])

      // Work in floor order so the chain runs bottom to top.
      const floors = [source.floorId, ...targetFloorIds]
        .map((id) => findFloor(project, id))
        .filter((f): f is Floor => Boolean(f))
        .sort((a, b) => a.ordinal - b.ordinal)

      const idOnFloor = new Map<string, string>([[source.floorId, source.id]])
      for (const floor of floors) {
        if (idOnFloor.has(floor.id)) continue
        const building = buildingOfFloor(project, floor.id)
        if (!building) continue
        const id = nextNodeId(project, building.id, floor.floorKey, source.kind)
        project.nodes[id] = {
          id,
          floorId: floor.id,
          x: source.x,
          y: source.y,
          kind: source.kind,
          featureId: source.featureId,
        }
        idOnFloor.set(floor.id, id)
        touched.add(floor.id)
      }

      let created = 0
      for (let i = 0; i < floors.length - 1; i++) {
        const a = idOnFloor.get(floors[i].id)
        const b = idOnFloor.get(floors[i + 1].id)
        if (!a || !b) continue
        if (findExistingEdge(project, a, b)) continue
        // Not an inference: you selected a stairs/elevator node and asked to extend it
        // through floors, so the edges this builds are that kind by your instruction.
        // Anything else starts as a walk and is set by hand.
        const kind: EdgeKind =
          source.kind === 'stairs' || source.kind === 'elevator' || source.kind === 'ramp'
            ? source.kind
            : 'walk'
        const suggestion = suggestDistanceM(project, project.nodes[a], project.nodes[b], kind)
        const id = makeEdgeId(a, b)
        project.edges[id] = {
          id,
          from: a,
          to: b,
          bidirectional: true,
          kind,
          distanceM: suggestion ? round2(suggestion.distanceM) : 0,
          tiredIndex: defaultTiredIndex(kind),
          wheelchair: defaultWheelchair(kind),
        }
        created++
      }

      set({ project })
      for (const floorId of touched) markFloorDirty(floorId)
      return created
    },

    /**
     * Copy every node and same-floor edge from one floor onto another. Room numbers are
     * re-prefixed when they start with the source floor key (4401 -> 5401), which is how
     * CMU actually numbers rooms; anything else is copied verbatim for review.
     */
    stampFloor(sourceFloorId, targetFloorId) {
      const current = get().project
      const source = findFloor(current, sourceFloorId)
      const target = findFloor(current, targetFloorId)
      const building = buildingOfFloor(current, targetFloorId)
      if (!source || !target || !building || sourceFloorId === targetFloorId) {
        return { nodes: 0, edges: 0 }
      }

      pushHistory()
      const project = snapshot(current)
      const remap = new Map<string, string>()

      for (const node of Object.values(current.nodes)) {
        if (node.floorId !== sourceFloorId) continue
        const id = nextNodeId(project, building.id, target.floorKey, node.kind)
        project.nodes[id] = {
          ...node,
          id,
          floorId: targetFloorId,
          roomNumber: restripeRoomNumber(node.roomNumber, source.floorKey, target.floorKey),
          // A curated name belongs to the original room, not its copy.
          name: undefined,
        }
        remap.set(node.id, id)
      }

      let edgeCount = 0
      for (const edge of Object.values(current.edges)) {
        const from = remap.get(edge.from)
        const to = remap.get(edge.to)
        // Only same-floor edges copy; vertical links are made with linkThroughFloors.
        if (!from || !to) continue
        const id = makeEdgeId(from, to)
        if (project.edges[id]) continue
        project.edges[id] = { ...edge, id, from, to }
        edgeCount++
      }

      set({ project })
      markFloorDirty(targetFloorId)
      return { nodes: remap.size, edges: edgeCount }
    },

    updateFloor(floorId, patch) {
      pushHistory()
      const current = get().project
      const buildings = current.buildings.map((b) => ({
        ...b,
        floors: b.floors.map((f) => (f.id === floorId ? { ...f, ...patch, id: floorId } : f)),
      }))
      set({ project: { ...current, buildings } })
      markBuildingsDirty()
    },

    setCalibration(floorId, calibration) {
      get().updateFloor(floorId, { calibration })
      // Every distance on this floor was measured in the old scale.
      const project = snapshot(get().project)
      for (const node of Object.values(project.nodes)) {
        if (node.floorId === floorId) recomputeEdgesTouching(project, node.id)
      }
      set({ project })
      markFloorDirty(floorId)
    },

    async attachFloorplan(floorId, file) {
      try {
        const { src } = await uploadFloorplan(floorId, file)
        const dims = await readImageSize(file)
        get().updateFloor(floorId, { image: { src, ...dims } })
      } catch (err) {
        set({ error: `Upload failed: ${(err as Error).message}` })
      }
    },

    addFloor(buildingId, floorKey, elevationM) {
      const current = get().project
      const building = current.buildings.find((b) => b.id === buildingId)
      if (!building) return
      const id = `${buildingId}:${floorKey}`
      if (building.floors.some((f) => f.id === id)) return

      pushHistory()
      const ordinal = Number.parseFloat(floorKey)
      const floor: Floor = {
        id,
        buildingId,
        floorKey,
        ordinal: Number.isFinite(ordinal) ? ordinal : building.floors.length + 1,
        elevationM,
      }
      const buildings = current.buildings.map((b) =>
        b.id === buildingId
          ? { ...b, floors: [...b.floors, floor].sort((x, y) => x.ordinal - y.ordinal) }
          : b,
      )
      set({ project: { ...current, buildings } })
      markBuildingsDirty()
    },

    addBuilding(building) {
      const current = get().project
      if (current.buildings.some((b) => b.id === building.id)) return
      pushHistory()
      set({ project: { ...current, buildings: [...current.buildings, building] } })
      markBuildingsDirty()
    },

    upsertFeature(feature) {
      pushHistory()
      const current = get().project
      const features = current.features.some((f) => f.id === feature.id)
        ? current.features.map((f) => (f.id === feature.id ? feature : f))
        : [...current.features, feature]
      set({ project: { ...current, features } })
      markBuildingsDirty()
    },
  }
})

function affectedFloors(project: Project): string[] {
  return [...new Set(Object.values(project.nodes).map((n) => n.floorId))]
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** `4401` stamped from floor 4 onto floor 5 becomes `5401`. Left alone if it doesn't match. */
function restripeRoomNumber(
  roomNumber: string | undefined,
  sourceFloorKey: string,
  targetFloorKey: string,
): string | undefined {
  if (!roomNumber) return undefined
  if (!roomNumber.startsWith(sourceFloorKey)) return roomNumber
  return `${targetFloorKey}${roomNumber.slice(sourceFloorKey.length)}`
}

async function readImageSize(file: File): Promise<{ widthPx: number; heightPx: number }> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('Could not read that image.'))
      img.src = url
    })
    // SVGs without intrinsic dimensions report 0; fall back to a sane canvas size.
    return {
      widthPx: img.naturalWidth || 1000,
      heightPx: img.naturalHeight || 600,
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * The data entry screen. Optimised for repetition, not for looking impressive.
 *
 * The speed comes from three behaviours:
 *  - the plot kind is sticky, so fifteen corridor corners are fifteen clicks
 *  - chain mode connects each new point to the last, so drawing a corridor is one pass
 *  - edge properties fill themselves from calibration and the two point kinds
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { FloorCanvas, type RenderEdge } from '../floor2d/FloorCanvas'
import { useViewport, type Point } from '../floor2d/useViewport'
import { edgeKind } from '../model/edges'
import { calibrationFromReferenceLine } from '../model/geometry'
import {
  findFloor,
  type Building,
  type GraphNode,
  type NodeKind as NodeKindT,
} from '../model/types'
import { validateProject } from '../model/validate'
import { useProjectStore } from '../state/projectStore'
import { Inspector } from './Inspector'
import { PdfImport } from './PdfImport'

type Mode = 'select' | 'plot' | 'connect' | 'calibrate'

/** Number-key order for the sticky plot kind. Corner is 1 because it is most of the work. */
const KIND_ORDER: NodeKindT[] = [
  'corner',
  'room',
  'stairs',
  'elevator',
  'door',
  'entrance',
  'restroom',
  'ramp',
  'poi',
]

export function EntryScreen() {
  const project = useProjectStore((s) => s.project)
  const status = useProjectStore((s) => s.status)
  const error = useProjectStore((s) => s.error)
  const load = useProjectStore((s) => s.load)
  const saving = useProjectStore((s) => s.saving)
  const dirtyFloors = useProjectStore((s) => s.dirtyFloors)
  const selection = useProjectStore((s) => s.selection)
  const select = useProjectStore((s) => s.select)
  const clearSelection = useProjectStore((s) => s.clearSelection)
  const addNode = useProjectStore((s) => s.addNode)
  const connect = useProjectStore((s) => s.connect)
  const beginHistoryGroup = useProjectStore((s) => s.beginHistoryGroup)
  const moveNodeLive = useProjectStore((s) => s.moveNodeLive)
  const deleteNodes = useProjectStore((s) => s.deleteNodes)
  const deleteEdges = useProjectStore((s) => s.deleteEdges)
  const undo = useProjectStore((s) => s.undo)
  const redo = useProjectStore((s) => s.redo)
  const setCalibration = useProjectStore((s) => s.setCalibration)

  const [mode, setMode] = useState<Mode>('plot')
  const [plotKind, setPlotKind] = useState<NodeKindT>('corner')
  const [chain, setChain] = useState(true)
  const [selectedFloorId, setFloorId] = useState<string | null>(null)
  const [chainAnchor, setChainAnchor] = useState<string | null>(null)
  const [connectFrom, setConnectFrom] = useState<string | null>(null)
  const [calLine, setCalLine] = useState<{ a: Point; b: Point } | null>(null)
  const [calLength, setCalLength] = useState('30')
  const [calError, setCalError] = useState<string | null>(null)
  const [box, setBox] = useState<{ a: Point; b: Point } | null>(null)
  const dragNode = useRef<string | null>(null)

  const viewportApi = useViewport()

  useEffect(() => {
    void load()
  }, [load])

  const floors = useMemo(
    () =>
      project.buildings.flatMap((b) =>
        b.floors.map((f) => ({ building: b, floor: f })),
      ),
    [project.buildings],
  )

  // Fall back to the first floor until the user picks one. Derived rather than synced
  // through an effect, so there is no render where the screen has no floor.
  const floorId = selectedFloorId ?? floors[0]?.floor.id ?? null
  const floor = floorId ? findFloor(project, floorId) : undefined

  const nodesOnFloor = useMemo(
    () => Object.values(project.nodes).filter((n) => n.floorId === floorId),
    [project.nodes, floorId],
  )

  /** Edges with at least one end on this floor, so vertical links are visible too. */
  const edgesOnFloor = useMemo<RenderEdge[]>(() => {
    const out: RenderEdge[] = []
    for (const edge of Object.values(project.edges)) {
      const from = project.nodes[edge.from]
      const to = project.nodes[edge.to]
      if (!from || !to) continue
      if (from.floorId !== floorId && to.floorId !== floorId) continue
      out.push({ edge, from, to, kind: edgeKind(edge) })
    }
    return out
  }, [project.edges, project.nodes, floorId])

  const issues = useMemo(() => validateProject(project), [project])

  /* ----------------------------- keyboard ----------------------------- */

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      // Never hijack keys while the user is typing in the inspector.
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        redo()
        return
      }
      if (event.key === 'Escape') {
        setConnectFrom(null)
        setChainAnchor(null)
        setCalLine(null)
        clearSelection()
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        deleteEdges(selection.edgeIds)
        deleteNodes(selection.nodeIds)
        return
      }

      const modes: Record<string, Mode> = { v: 'select', p: 'plot', c: 'connect', k: 'calibrate' }
      const nextMode = modes[event.key.toLowerCase()]
      if (nextMode) {
        setMode(nextMode)
        setConnectFrom(null)
        return
      }

      const index = Number(event.key)
      if (Number.isInteger(index) && index >= 1 && index <= KIND_ORDER.length) {
        setPlotKind(KIND_ORDER[index - 1])
        setMode('plot')
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [clearSelection, deleteEdges, deleteNodes, redo, selection, undo])

  /* ---------------------------- interactions ---------------------------- */

  function onCanvasDown(pt: Point, event: React.PointerEvent) {
    if (!floorId) return

    if (mode === 'plot') {
      const id = addNode(floorId, pt.x, pt.y, plotKind)
      if (!id) return
      if (chain && chainAnchor) connect(chainAnchor, id)
      setChainAnchor(id)
      select({ nodeIds: [id], edgeIds: [] })
      return
    }

    if (mode === 'calibrate') {
      setCalLine({ a: pt, b: pt })
      setCalError(null)
      return
    }

    if (mode === 'connect') {
      setConnectFrom(null)
      return
    }

    // Select mode: start a rubber-band box.
    setBox({ a: pt, b: pt })
    if (!event.shiftKey) clearSelection()
  }

  function onCanvasMove(pt: Point) {
    if (dragNode.current) {
      moveNodeLive(dragNode.current, pt.x, pt.y)
      return
    }
    if (calLine) setCalLine((line) => (line ? { ...line, b: pt } : null))
    if (box) setBox((b) => (b ? { ...b, b: pt } : null))
  }

  function onCanvasUp() {
    dragNode.current = null

    if (box) {
      const selected = nodesOnFloor.filter((n) => insideBox(n, box))
      if (selected.length > 0) {
        const edgeIds = edgesOnFloor
          .filter((e) => insideBox(e.from, box) && insideBox(e.to, box))
          .map((e) => e.edge.id)
        select({ nodeIds: selected.map((n) => n.id), edgeIds })
      }
      setBox(null)
    }
  }

  function onNodeDown(nodeId: string, event: React.PointerEvent) {
    if (mode === 'connect') {
      if (connectFrom && connectFrom !== nodeId) {
        const edgeId = connect(connectFrom, nodeId)
        if (edgeId) select({ nodeIds: [], edgeIds: [edgeId] })
        // Chain onward from here, so a corridor is one continuous pass.
        setConnectFrom(nodeId)
      } else {
        setConnectFrom(nodeId)
      }
      return
    }

    if (mode === 'plot') {
      // Continue a corridor from an existing point rather than starting adrift.
      setChainAnchor(nodeId)
      select({ nodeIds: [nodeId], edgeIds: [] })
      return
    }

    if (event.shiftKey) {
      const next = selection.nodeIds.includes(nodeId)
        ? selection.nodeIds.filter((id) => id !== nodeId)
        : [...selection.nodeIds, nodeId]
      select({ nodeIds: next })
      return
    }

    select({ nodeIds: [nodeId], edgeIds: [] })
    beginHistoryGroup()
    dragNode.current = nodeId
  }

  function applyCalibration() {
    if (!calLine || !floorId || !floor) return
    const result = calibrationFromReferenceLine(calLine.a, calLine.b, Number(calLength))
    if ('error' in result) {
      setCalError(result.error)
      return
    }
    setCalibration(floorId, {
      pixelsPerMeter: result.pixelsPerMeter,
      originX: floor.calibration?.originX ?? 0,
      originY: floor.calibration?.originY ?? 0,
      rotationDeg: floor.calibration?.rotationDeg ?? 0,
    })
    setCalLine(null)
    setMode('plot')
  }

  /* ------------------------------- render ------------------------------- */

  if (status === 'loading' || status === 'idle') {
    return <div className="screen-message">Loading data…</div>
  }
  if (status === 'error') {
    return (
      <div className="screen-message error">
        <p>Could not load data: {error}</p>
        <p className="hint">
          Is the data API running? Start both with <code>npm run dev</code>.
        </p>
      </div>
    )
  }

  return (
    <div className="entry-screen">
      <header className="toolbar">
        <div className="toolbar-group">
          <Link to="/" className="brand">
            CMU Nav
          </Link>
          <span className="toolbar-label">Data entry</span>
        </div>

        <div className="toolbar-group">
          {(['select', 'plot', 'connect', 'calibrate'] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              className={mode === m ? 'mode active' : 'mode'}
              onClick={() => {
                setMode(m)
                setConnectFrom(null)
              }}
            >
              {m}
              <kbd>{m === 'select' ? 'V' : m === 'plot' ? 'P' : m === 'connect' ? 'C' : 'K'}</kbd>
            </button>
          ))}
        </div>

        {mode === 'plot' && (
          <div className="toolbar-group kinds">
            {KIND_ORDER.map((kind, i) => (
              <button
                key={kind}
                type="button"
                className={plotKind === kind ? 'chip active' : 'chip'}
                onClick={() => setPlotKind(kind)}
                title={`Press ${i + 1}`}
              >
                <span className={`dot ${kind}`} />
                {kind}
              </button>
            ))}
            <label className="check">
              <input type="checkbox" checked={chain} onChange={(e) => setChain(e.target.checked)} />
              chain
            </label>
          </div>
        )}

        <div className="toolbar-group right">
          <button type="button" onClick={undo} title="Ctrl+Z">
            Undo
          </button>
          <button type="button" onClick={redo} title="Ctrl+Shift+Z">
            Redo
          </button>
          <span className={saving ? 'save-state saving' : 'save-state'}>
            {saving ? 'Saving…' : dirtyFloors.size > 0 ? `${dirtyFloors.size} unsaved` : 'Saved'}
          </span>
        </div>
      </header>

      {error && <div className="banner error">{error}</div>}

      <div className="entry-body">
        <FloorSidebar
          buildings={project.buildings}
          activeFloorId={floorId}
          onSelect={setFloorId}
          nodeCounts={countByFloor(project.nodes)}
        />

        <main className="canvas-area">
          {mode === 'connect' && (
            <div className="mode-hint">
              {connectFrom
                ? 'Now click the point to connect to. Keep clicking to chain along a corridor.'
                : 'Click the first point.'}
            </div>
          )}
          {mode === 'calibrate' && (
            <div className="mode-hint">
              Drag a line along something you know the length of, then enter that length.
            </div>
          )}
          {mode === 'plot' && !floor?.calibration && (
            <div className="mode-hint warn">
              This floor has no scale yet — press <kbd>K</kbd> and calibrate it, or distances will
              be unknown.
            </div>
          )}

          <FloorCanvas
            floor={floor}
            nodes={nodesOnFloor}
            edges={edgesOnFloor}
            selectedNodeIds={new Set(selection.nodeIds)}
            selectedEdgeIds={new Set(selection.edgeIds)}
            showLabels
            viewportApi={viewportApi}
            onCanvasPointerDown={onCanvasDown}
            onCanvasPointerMove={onCanvasMove}
            onCanvasPointerUp={onCanvasUp}
            onNodePointerDown={onNodeDown}
            onEdgePointerDown={(edgeId) => select({ nodeIds: [], edgeIds: [edgeId] })}
            overlay={
              <>
                {connectFrom && project.nodes[connectFrom] && (
                  <circle
                    cx={project.nodes[connectFrom].x}
                    cy={project.nodes[connectFrom].y}
                    r={12 / viewportApi.viewport.scale}
                    fill="none"
                    stroke="#ffd24a"
                    strokeWidth={2 / viewportApi.viewport.scale}
                  />
                )}
                {chain && mode === 'plot' && chainAnchor && project.nodes[chainAnchor] && (
                  <circle
                    cx={project.nodes[chainAnchor].x}
                    cy={project.nodes[chainAnchor].y}
                    r={10 / viewportApi.viewport.scale}
                    fill="none"
                    stroke="#5bd1a0"
                    strokeWidth={2 / viewportApi.viewport.scale}
                  />
                )}
                {calLine && (
                  <line
                    x1={calLine.a.x}
                    y1={calLine.a.y}
                    x2={calLine.b.x}
                    y2={calLine.b.y}
                    stroke="#ffd24a"
                    strokeWidth={3 / viewportApi.viewport.scale}
                  />
                )}
                {box && (
                  <rect
                    x={Math.min(box.a.x, box.b.x)}
                    y={Math.min(box.a.y, box.b.y)}
                    width={Math.abs(box.b.x - box.a.x)}
                    height={Math.abs(box.b.y - box.a.y)}
                    fill="rgba(255,210,74,0.12)"
                    stroke="#ffd24a"
                    strokeWidth={1 / viewportApi.viewport.scale}
                  />
                )}
              </>
            }
          />

          {calLine && (
            <div className="cal-prompt">
              <label>
                That line is
                <input
                  autoFocus
                  value={calLength}
                  onChange={(e) => setCalLength(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && applyCalibration()}
                />
                metres
              </label>
              <button type="button" className="primary" onClick={applyCalibration}>
                Set scale
              </button>
              <button type="button" onClick={() => setCalLine(null)}>
                Cancel
              </button>
              {calError && <span className="error-text">{calError}</span>}
            </div>
          )}

          <ValidationStrip issues={issues} onSelectNodes={(ids) => select({ nodeIds: ids })} />
        </main>

        <Inspector />
      </div>
    </div>
  )
}

/* ---------------------------- floor sidebar ---------------------------- */

function FloorSidebar({
  buildings,
  activeFloorId,
  onSelect,
  nodeCounts,
}: {
  buildings: Building[]
  activeFloorId: string | null
  onSelect: (floorId: string) => void
  nodeCounts: Record<string, number>
}) {
  const attachFloorplan = useProjectStore((s) => s.attachFloorplan)
  const addFloor = useProjectStore((s) => s.addFloor)
  const stampFloor = useProjectStore((s) => s.stampFloor)
  const [stampSource, setStampSource] = useState('')
  const [newFloorKey, setNewFloorKey] = useState<Record<string, string>>({})
  const [stampResult, setStampResult] = useState<string | null>(null)
  const [pdfOpen, setPdfOpen] = useState(false)

  const activeBuildingId = activeFloorId?.split(':')[0] ?? ''
  const activeBuilding = buildings.find((b) => b.id === activeBuildingId)
  const allFloors = buildings.flatMap((b) => b.floors)

  return (
    <nav className="floor-sidebar">
      {buildings.map((building) => (
        <section key={building.id}>
          <h4 title={building.name}>{building.id}</h4>
          {building.floors.length === 0 && (
            <p className="hint">No floors yet — add one below.</p>
          )}
          <ul>
            {building.floors.map((floor) => (
              <li key={floor.id}>
                <button
                  type="button"
                  className={floor.id === activeFloorId ? 'floor active' : 'floor'}
                  onClick={() => onSelect(floor.id)}
                >
                  <span className="floor-key">{floor.floorKey}</span>
                  <span className="floor-meta">
                    {nodeCounts[floor.id] ?? 0} pts
                    {!floor.calibration && <em title="No scale set"> · no scale</em>}
                    {!floor.image && <em title="No plan uploaded"> · no plan</em>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <form
            className="add-floor"
            onSubmit={(e) => {
              e.preventDefault()
              const key = (newFloorKey[building.id] ?? '').trim()
              if (!key) return
              const highest = building.floors.reduce((max, f) => Math.max(max, f.elevationM), 0)
              addFloor(building.id, key, building.floors.length === 0 ? 0 : highest + 4.5)
              setNewFloorKey((prev) => ({ ...prev, [building.id]: '' }))
            }}
          >
            <input
              value={newFloorKey[building.id] ?? ''}
              placeholder="add floor, e.g. 3"
              onChange={(e) =>
                setNewFloorKey((prev) => ({ ...prev, [building.id]: e.target.value }))
              }
            />
            <button type="submit">+</button>
          </form>
        </section>
      ))}

      {activeFloorId && (
        <section className="floor-tools">
          <h4>This floor</h4>

          <button type="button" className="primary" onClick={() => setPdfOpen(true)}>
            Import from PDF…
          </button>
          <p className="hint">
            The plans CMU hands out are PDFs, and evacuation sets cover every floor in one
            file — import assigns pages to floors in a single pass.
          </p>

          <label className="upload">
            …or upload an image
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void attachFloorplan(activeFloorId, file)
              }}
            />
          </label>

          <label>
            Stamp graph from
            <select value={stampSource} onChange={(e) => setStampSource(e.target.value)}>
              <option value="">— choose a floor —</option>
              {allFloors
                .filter((floor) => floor.id !== activeFloorId && floor.buildingId === activeBuildingId)
                .map((floor) => (
                  <option key={floor.id} value={floor.id}>
                    {floor.buildingId} {floor.floorKey}
                  </option>
                ))}
            </select>
          </label>
          <button
            type="button"
            disabled={!stampSource}
            onClick={() => {
              const result = stampFloor(stampSource, activeFloorId)
              setStampResult(`Copied ${result.nodes} points and ${result.edges} edges.`)
            }}
          >
            Stamp onto this floor
          </button>
          {stampResult && <p className="hint">{stampResult}</p>}
        </section>
      )}

      <AddBuildingForm />

      {pdfOpen && activeBuilding && (
        <PdfImport
          floors={activeBuilding.floors}
          onImport={(floorId, file) => attachFloorplan(floorId, file)}
          onClose={() => setPdfOpen(false)}
        />
      )}
    </nav>
  )
}

/**
 * Creating a building was the missing step that blocked everything past the first one —
 * floors and plans all hang off a building that has to exist first.
 */
function AddBuildingForm() {
  const addBuilding = useProjectStore((s) => s.addBuilding)
  const buildings = useProjectStore((s) => s.project.buildings)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  return (
    <section className="add-building">
      <h4>New building</h4>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const id = code.trim().toUpperCase()
          if (!id) return
          if (buildings.some((b) => b.id === id)) {
            setError(`${id} already exists.`)
            return
          }
          // Offset each new building so they do not all stack on the same spot in 3D.
          const offset = buildings.length * 160
          addBuilding({
            id,
            name: name.trim() || id,
            shortName: name.trim().replace(/ (Hall|Center|Centers|Centre)$/i, '') || id,
            placement: { x: offset, y: 0, rotationDeg: 0 },
            floors: [],
          })
          setCode('')
          setName('')
          setError(null)
        }}
      >
        <input
          value={code}
          placeholder="code, e.g. WEH"
          onChange={(e) => setCode(e.target.value)}
        />
        <input
          value={name}
          placeholder="name, e.g. Wean Hall"
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit">Add building</button>
      </form>
      {error && <p className="error-text">{error}</p>}
    </section>
  )
}

/* --------------------------- validation strip --------------------------- */

function ValidationStrip({
  issues,
  onSelectNodes,
}: {
  issues: ReturnType<typeof validateProject>
  onSelectNodes: (ids: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const errors = issues.filter((i) => i.severity === 'error').length

  return (
    <div className={open ? 'validation open' : 'validation'}>
      <button type="button" className="validation-toggle" onClick={() => setOpen(!open)}>
        {issues.length === 0
          ? 'No problems found'
          : `${issues.length} issue${issues.length === 1 ? '' : 's'}${errors > 0 ? ` · ${errors} blocking` : ''}`}
      </button>
      {open && (
        <ul>
          {issues.length === 0 && <li className="ok">The graph checks out.</li>}
          {issues.map((issue, i) => (
            <li key={`${issue.kind}-${i}`} className={issue.severity}>
              {issue.message}
              {issue.nodeIds && issue.nodeIds.length > 0 && (
                <button type="button" className="link" onClick={() => onSelectNodes(issue.nodeIds!)}>
                  select
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/* -------------------------------- helpers -------------------------------- */

function insideBox(node: GraphNode, box: { a: Point; b: Point }): boolean {
  const x1 = Math.min(box.a.x, box.b.x)
  const x2 = Math.max(box.a.x, box.b.x)
  const y1 = Math.min(box.a.y, box.b.y)
  const y2 = Math.max(box.a.y, box.b.y)
  return node.x >= x1 && node.x <= x2 && node.y >= y1 && node.y <= y2
}

function countByFloor(nodes: Record<string, GraphNode>): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const node of Object.values(nodes)) {
    counts[node.floorId] = (counts[node.floorId] ?? 0) + 1
  }
  return counts
}

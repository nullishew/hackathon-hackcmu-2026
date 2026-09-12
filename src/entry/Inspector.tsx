/**
 * Property panel for the current selection.
 *
 * An edge has only three stored fields, so its whole editor fits in a few rows — which
 * is what makes bulk-editing a selected wing fast. Distance shows the auto-suggested
 * value alongside the stored one, so an override is visible rather than invisible.
 */
import { useMemo, useState } from 'react'
import { suggestDistanceM } from '../model/autoDistance'
import {
  TIRED_INDEX,
  defaultTiredIndex,
  defaultWheelchair,
  edgeKind,
  estimateSeconds,
  formatDuration,
} from '../model/edges'
import { createLabeler } from '../model/labels'
import {
  EdgeKind,
  NodeKind,
  buildingOfFloor,
  findFloor,
  type Project,
} from '../model/types'
import { useProjectStore } from '../state/projectStore'

const NODE_KINDS = NodeKind.options

export function Inspector() {
  const project = useProjectStore((s) => s.project)
  const selection = useProjectStore((s) => s.selection)

  const labeler = useMemo(() => createLabeler(project), [project])

  const nodes = selection.nodeIds.map((id) => project.nodes[id]).filter(Boolean)
  const edges = selection.edgeIds.map((id) => project.edges[id]).filter(Boolean)

  if (nodes.length === 0 && edges.length === 0) {
    return (
      <aside className="inspector">
        <p className="muted">
          Nothing selected. Click a point or a line, or press <kbd>P</kbd> to start plotting.
        </p>
      </aside>
    )
  }

  return (
    <aside className="inspector">
      {nodes.length === 1 && edges.length === 0 && (
        <NodeEditor nodeId={nodes[0].id} label={labeler.labelFor(nodes[0])} project={project} />
      )}
      {edges.length === 1 && nodes.length === 0 && (
        <EdgeEditor edgeId={edges[0].id} project={project} />
      )}
      {(nodes.length > 1 || edges.length > 1 || (nodes.length >= 1 && edges.length >= 1)) && (
        <BulkEditor nodeIds={nodes.map((n) => n.id)} edgeIds={edges.map((e) => e.id)} />
      )}
    </aside>
  )
}

/* ------------------------------- node ------------------------------- */

function NodeEditor({
  nodeId,
  label,
  project,
}: {
  nodeId: string
  label: string
  project: Project
}) {
  const node = project.nodes[nodeId]
  const updateNode = useProjectStore((s) => s.updateNode)
  const deleteNodes = useProjectStore((s) => s.deleteNodes)
  const linkThroughFloors = useProjectStore((s) => s.linkThroughFloors)

  const building = buildingOfFloor(project, node.floorId)
  const floor = findFloor(project, node.floorId)
  const features = project.features.filter(
    (f) => !f.buildingId || f.buildingId === building?.id,
  )
  const isVertical = node.kind === 'stairs' || node.kind === 'elevator' || node.kind === 'ramp'

  const [linkTargets, setLinkTargets] = useState<string[]>([])
  const otherFloors = (building?.floors ?? []).filter((f) => f.id !== node.floorId)

  return (
    <div className="panel">
      <header>
        <h3>{label}</h3>
        <code>{node.id}</code>
      </header>

      <label>
        Kind
        <select
          value={node.kind}
          onChange={(e) => updateNode(nodeId, { kind: e.target.value as typeof node.kind })}
        >
          {NODE_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </label>

      <label>
        Room number
        <input
          value={node.roomNumber ?? ''}
          placeholder="e.g. 4401"
          onChange={(e) => updateNode(nodeId, { roomNumber: e.target.value || undefined })}
        />
      </label>

      <label>
        Name <span className="hint">(only if it has a real one)</span>
        <input
          value={node.name ?? ''}
          placeholder="e.g. Rashid Auditorium"
          onChange={(e) => updateNode(nodeId, { name: e.target.value || undefined })}
        />
      </label>

      <label>
        Feature <span className="hint">(names every node on it)</span>
        <select
          value={node.featureId ?? ''}
          onChange={(e) => updateNode(nodeId, { featureId: e.target.value || undefined })}
        >
          <option value="">— none —</option>
          {features.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name} ({f.kind})
            </option>
          ))}
        </select>
      </label>

      <p className="coords">
        {floor ? `floor ${floor.floorKey}` : node.floorId} · {node.x}, {node.y} px
      </p>

      {isVertical && otherFloors.length > 0 && (
        <div className="subpanel">
          <h4>Link through floors</h4>
          <p className="hint">
            Places a matching {node.kind} node at the same spot on each floor and chains them
            together.
          </p>
          <div className="floor-checks">
            {otherFloors.map((f) => (
              <label key={f.id} className="check">
                <input
                  type="checkbox"
                  checked={linkTargets.includes(f.id)}
                  onChange={(e) =>
                    setLinkTargets((prev) =>
                      e.target.checked ? [...prev, f.id] : prev.filter((id) => id !== f.id),
                    )
                  }
                />
                {f.floorKey}
              </label>
            ))}
          </div>
          <div className="row">
            <button
              type="button"
              onClick={() => setLinkTargets(otherFloors.map((f) => f.id))}
            >
              All floors
            </button>
            <button
              type="button"
              className="primary"
              disabled={linkTargets.length === 0}
              onClick={() => {
                linkThroughFloors(nodeId, linkTargets)
                setLinkTargets([])
              }}
            >
              Link {linkTargets.length || ''}
            </button>
          </div>
        </div>
      )}

      <button type="button" className="danger" onClick={() => deleteNodes([nodeId])}>
        Delete point
      </button>
    </div>
  )
}

/* ------------------------------- edge ------------------------------- */

function EdgeEditor({ edgeId, project }: { edgeId: string; project: Project }) {
  const edge = project.edges[edgeId]
  const updateEdge = useProjectStore((s) => s.updateEdge)
  const deleteEdges = useProjectStore((s) => s.deleteEdges)
  const recompute = useProjectStore((s) => s.recomputeEdgeDistance)

  const labeler = useMemo(() => createLabeler(project), [project])
  const from = project.nodes[edge.from]
  const to = project.nodes[edge.to]
  const kind = edgeKind(edge)
  const suggestion = from && to ? suggestDistanceM(project, from, to, kind) : null
  const overridden =
    suggestion !== null && Math.abs(suggestion.distanceM - edge.distanceM) > 0.05

  return (
    <div className="panel">
      <header>
        <h3>
          {from ? labeler.shortLabelFor(from) : edge.from} → {to ? labeler.shortLabelFor(to) : edge.to}
        </h3>
        <code>{edge.id}</code>
      </header>

      <label>
        Kind
        <select
          value={edge.kind}
          onChange={(e) => updateEdge(edgeId, { kind: e.target.value as EdgeKind })}
        >
          {EdgeKind.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <p className="hint">
        Entered by hand, never guessed from the floors. A doorway between two buildings is a
        walk even though the floors differ.
      </p>

      <label>
        Distance (m)
        <input
          type="number"
          step="0.1"
          min="0"
          value={edge.distanceM}
          onChange={(e) => updateEdge(edgeId, { distanceM: Number(e.target.value) })}
        />
      </label>
      {suggestion && (
        <p className="hint">
          {overridden ? (
            <>
              Overridden — calibration suggests {suggestion.distanceM.toFixed(1)} m.{' '}
              <button type="button" className="link" onClick={() => recompute(edgeId)}>
                use it
              </button>
            </>
          ) : (
            <>Auto from calibration ({suggestion.basis.replace('-', ' ')}).</>
          )}
          {suggestion.note ? ` ${suggestion.note}` : ''}
        </p>
      )}

      <label>
        Tired index
        <input
          type="number"
          step="0.05"
          min="0"
          value={edge.tiredIndex}
          onChange={(e) => updateEdge(edgeId, { tiredIndex: Number(e.target.value) })}
        />
      </label>
      <div className="row wrap">
        {Object.entries(TIRED_INDEX).map(([name, value]) => (
          <button
            key={name}
            type="button"
            className={edge.tiredIndex === value ? 'chip active' : 'chip'}
            onClick={() => updateEdge(edgeId, { tiredIndex: value })}
          >
            {name} {value}
          </button>
        ))}
      </div>
      {(edge.tiredIndex !== defaultTiredIndex(kind) ||
        edge.wheelchair !== defaultWheelchair(kind)) && (
        <p className="hint">
          <button
            type="button"
            className="link"
            onClick={() =>
              updateEdge(edgeId, {
                tiredIndex: defaultTiredIndex(kind),
                wheelchair: defaultWheelchair(kind),
              })
            }
          >
            Use the usual values for {kind}
          </button>{' '}
          (tiredness {defaultTiredIndex(kind)}, {defaultWheelchair(kind) ? 'accessible' : 'not accessible'})
        </p>
      )}

      <label className="check">
        <input
          type="checkbox"
          checked={edge.wheelchair}
          onChange={(e) => updateEdge(edgeId, { wheelchair: e.target.checked })}
        />
        Wheelchair accessible
      </label>

      <label className="check">
        <input
          type="checkbox"
          checked={edge.bidirectional}
          onChange={(e) => updateEdge(edgeId, { bidirectional: e.target.checked })}
        />
        Two-way
      </label>

      <p className="hint">
        ≈ {formatDuration(estimateSeconds(edge.distanceM, kind))} at {kind} speed — estimated for
        display, never stored.
      </p>

      <button type="button" className="danger" onClick={() => deleteEdges([edgeId])}>
        Delete edge
      </button>
    </div>
  )
}

/* ------------------------------- bulk ------------------------------- */

function BulkEditor({ nodeIds, edgeIds }: { nodeIds: string[]; edgeIds: string[] }) {
  const updateNode = useProjectStore((s) => s.updateNode)
  const updateEdge = useProjectStore((s) => s.updateEdge)
  const deleteNodes = useProjectStore((s) => s.deleteNodes)
  const deleteEdges = useProjectStore((s) => s.deleteEdges)

  return (
    <div className="panel">
      <header>
        <h3>
          {nodeIds.length} point{nodeIds.length === 1 ? '' : 's'}, {edgeIds.length} edge
          {edgeIds.length === 1 ? '' : 's'}
        </h3>
        <code>bulk edit</code>
      </header>

      {nodeIds.length > 0 && (
        <label>
          Set all point kinds to
          <select
            defaultValue=""
            onChange={(e) => {
              const kind = e.target.value
              if (!kind) return
              for (const id of nodeIds) updateNode(id, { kind: kind as never })
              e.target.value = ''
            }}
          >
            <option value="">— choose —</option>
            {NODE_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
      )}

      {edgeIds.length > 0 && (
        <>
          <div className="row wrap">
            <button
              type="button"
              onClick={() => edgeIds.forEach((id) => updateEdge(id, { wheelchair: true }))}
            >
              Mark accessible
            </button>
            <button
              type="button"
              onClick={() => edgeIds.forEach((id) => updateEdge(id, { wheelchair: false }))}
            >
              Mark inaccessible
            </button>
          </div>
          <label>
            Set all kinds to
            <select
              defaultValue=""
              onChange={(e) => {
                if (!e.target.value) return
                for (const id of edgeIds) updateEdge(id, { kind: e.target.value as EdgeKind })
                e.target.value = ''
              }}
            >
              <option value="">— choose —</option>
              {EdgeKind.options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label>
            Set all tired indexes to
            <select
              defaultValue=""
              onChange={(e) => {
                const value = Number(e.target.value)
                if (!e.target.value) return
                for (const id of edgeIds) updateEdge(id, { tiredIndex: value })
                e.target.value = ''
              }}
            >
              <option value="">— choose —</option>
              {Object.entries(TIRED_INDEX).map(([name, value]) => (
                <option key={name} value={value}>
                  {name} ({value})
                </option>
              ))}
            </select>
          </label>
        </>
      )}

      <button
        type="button"
        className="danger"
        onClick={() => {
          deleteEdges(edgeIds)
          deleteNodes(nodeIds)
        }}
      >
        Delete selection
      </button>
    </div>
  )
}

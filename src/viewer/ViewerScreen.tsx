/**
 * The public screen: type where you are and where you are going, tune the tiredness
 * dial, and see the route drawn through the 3D stack — or drop into one floor at a time.
 */
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { formatDistance, formatDuration } from '../model/edges'
import { createLabeler } from '../model/labels'
import { findFloor } from '../model/types'
import { defaultRouteOptions, findRoute, type RouteOptions } from '../routing/route'
import { useProjectStore } from '../state/projectStore'
import { StackScene } from '../viewer3d/StackScene'
import { BuildingMap } from './BuildingMap'
import { FilterPanel } from './FilterPanel'
import { SearchField } from './SearchField'
import { NARROW_QUERY, useMediaQuery } from './useMediaQuery'

export function ViewerScreen() {
  const project = useProjectStore((s) => s.project)
  const status = useProjectStore((s) => s.status)
  const error = useProjectStore((s) => s.error)
  const load = useProjectStore((s) => s.load)

  const [fromId, setFromId] = useState<string | null>(null)
  const [toId, setToId] = useState<string | null>(null)
  const [options, setOptions] = useState<RouteOptions>(defaultRouteOptions)
  const [exaggeration, setExaggeration] = useState(2.5)
  const [viewMode, setViewMode] = useState<'3d' | '2d'>('3d')

  const isNarrow = useMediaQuery(NARROW_QUERY)
  /**
   * Null until the user says otherwise, so the panel follows the layout by default —
   * open as a column on a wide screen, closed as a drawer over the map on a phone —
   * and only then honours an explicit choice.
   */
  const [panelChoice, setPanelChoice] = useState<boolean | null>(null)
  const panelOpen = panelChoice ?? !isNarrow

  useEffect(() => {
    void load()
  }, [load])

  const labeler = useMemo(() => createLabeler(project), [project])

  const result = useMemo(() => {
    if (!fromId || !toId) return null
    return findRoute(project, fromId, toId, options)
  }, [project, fromId, toId, options])

  const route = result?.ok ? result.route : null

  /** The same query with tiredness off, to show what comfort is costing. */
  const shortest = useMemo(() => {
    if (!fromId || !toId || options.tirednessWeight === 0) return null
    const r = findRoute(project, fromId, toId, { ...options, tirednessWeight: 0 })
    return r.ok ? r.route : null
  }, [project, fromId, toId, options])

  if (status === 'loading' || status === 'idle') {
    return <div className="screen-message">Loading map…</div>
  }
  if (status === 'error') {
    return (
      <div className="screen-message error">
        <p>Could not load the map: {error}</p>
        <p className="hint">
          Start both processes with <code>npm run dev</code>, then seed data with{' '}
          <code>npm run seed</code>.
        </p>
      </div>
    )
  }

  return (
    <div className={panelOpen ? 'viewer-screen' : 'viewer-screen panel-collapsed'}>
      <aside className="viewer-panel" id="viewer-panel" inert={!panelOpen}>
        <header className="viewer-header">
          <h1>CMU Nav</h1>
          <Link to="/entry" className="link">
            Data entry →
          </Link>
          <button
            type="button"
            className="panel-close"
            aria-label="Hide the route panel"
            onClick={() => setPanelChoice(false)}
          >
            ✕
          </button>
        </header>

        <SearchField
          label="Where are you?"
          placeholder="room number, building, or landmark"
          project={project}
          labeler={labeler}
          selectedId={fromId}
          onSelect={setFromId}
        />
        <SearchField
          label="Where are you going?"
          placeholder="e.g. 4401, Rashid, helix"
          project={project}
          labeler={labeler}
          selectedId={toId}
          onSelect={setToId}
        />
        <button
          type="button"
          className="swap"
          disabled={!fromId && !toId}
          onClick={() => {
            setFromId(toId)
            setToId(fromId)
          }}
        >
          ⇅ Swap
        </button>

        <FilterPanel options={options} onChange={setOptions} />

        {result && !result.ok && <p className="no-route">{result.error}</p>}

        {route && (
          <section className="route-readout">
            <div className="stat-row">
              <Stat label="Distance" value={formatDistance(route.distanceM)} />
              <Stat label="Time" value={formatDuration(route.seconds)} />
            </div>
            <div className="stat-row">
              <Stat label="Floors" value={String(route.floorChanges)} />
              <Stat
                label="Vertical"
                value={
                  route.stairsCount > 0 && route.elevatorCount > 0
                    ? 'stairs + lift'
                    : route.stairsCount > 0
                      ? `${route.stairsCount} × stairs`
                      : route.elevatorCount > 0
                        ? `${route.elevatorCount} × lift`
                        : 'level'
                }
              />
            </div>
            <p className="hint">Time is estimated from distance — it is never stored data.</p>

            {shortest && shortest.nodeIds.join() !== route.nodeIds.join() && (
              <p className="comparison">
                The shortest route is {formatDistance(shortest.distanceM)} but{' '}
                {Math.round((shortest.tiredness / Math.max(route.tiredness, 0.001) - 1) * 100)}%
                more tiring.
              </p>
            )}

            <ol className="leg-list">
              {route.legs.map((leg, i) => {
                const floor = findFloor(project, leg.floorId)
                return (
                  <li key={`${leg.floorId}-${i}`}>
                    <button
                      type="button"
                      className={viewMode === '2d' ? 'leg active' : 'leg'}
                      onClick={() => {
                        setViewMode('2d')
                        // The drawer is covering the floor they just asked to see.
                        if (isNarrow) setPanelChoice(false)
                      }}
                    >
                      <span className="leg-floor">
                        {leg.floorId.split(':')[0]} {floor?.floorKey ?? ''}
                      </span>
                      <span className="leg-detail">
                        {formatDistance(leg.distanceM)}
                        {leg.exit && (
                          <>
                            {' · '}
                            {leg.exit.kind === 'elevator' ? '🛗' : leg.exit.kind === 'stairs' ? '↕' : '→'}{' '}
                            {leg.exit.kind} to{' '}
                            {findFloor(project, leg.exit.to.floorId)?.floorKey ?? '?'}
                          </>
                        )}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ol>
          </section>
        )}
      </aside>

      {isNarrow && panelOpen && (
        <button
          type="button"
          className="panel-scrim"
          aria-label="Hide the route panel"
          onClick={() => setPanelChoice(false)}
        />
      )}

      <main className="viewer-stage">
        <div className="stage-controls">
          <button
            type="button"
            className="panel-toggle"
            aria-expanded={panelOpen}
            aria-controls="viewer-panel"
            onClick={() => setPanelChoice(!panelOpen)}
          >
            {panelOpen ? '⟨ Hide' : '☰ Route'}
          </button>

          <button
            type="button"
            className={viewMode === '3d' ? 'tab active' : 'tab'}
            onClick={() => setViewMode('3d')}
          >
            3D stack
          </button>
          <button
            type="button"
            className={viewMode === '2d' ? 'tab active' : 'tab'}
            onClick={() => setViewMode('2d')}
          >
            2D map
          </button>

          {viewMode === '3d' && (
            <label className="exaggeration">
              Height ×{exaggeration.toFixed(1)}
              <input
                type="range"
                min="1"
                max="6"
                step="0.5"
                value={exaggeration}
                onChange={(e) => setExaggeration(Number(e.target.value))}
              />
            </label>
          )}
          <span className="camera-help">
            {viewMode === '3d' ? 'Drag to look · two fingers/right drag to move · pinch to explore' : 'Drag to move · pinch or scroll to zoom'}
          </span>
        </div>

        {/* The stage body owns the remaining height, which the 3D canvas needs resolved. */}
        <div className="stage-body">
          {viewMode === '2d' ? (
            <BuildingMap project={project} route={route} />
          ) : (
            <StackScene
              project={project}
              route={route}
              activeFloorId={null}
              verticalExaggeration={exaggeration}
              onSelectFloor={() => setViewMode('2d')}
            />
          )}
        </div>
      </main>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  )
}

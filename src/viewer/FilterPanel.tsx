/**
 * The routing filter panel.
 *
 * The slider sets W in cost = (1 + W * tiredIndex) * distance. At W = 0 the tiredIndex
 * cancels out and you get the plain shortest path, which is why "Shortest" is simply the
 * slider at zero rather than a separate mode.
 */
import type { RouteOptions } from '../routing/route'

interface Preset {
  name: string
  hint: string
  options: RouteOptions
}

const PRESETS: Preset[] = [
  {
    name: 'Shortest',
    hint: 'Pure distance — tiredness ignored',
    options: {
      tirednessWeight: 0,
      requireWheelchair: false,
      avoidStairs: false,
      avoidElevators: false,
    },
  },
  {
    name: 'Wheelchair',
    hint: 'Only edges marked step-free',
    options: {
      tirednessWeight: 0.5,
      requireWheelchair: true,
      // Deliberately NOT avoidStairs. Accessibility is a hand-entered fact about each
      // edge, and this preset honours exactly that. Adding a kind-based filter on top
      // made the route depend on the kind being right, which is how a flat doorway
      // between two buildings managed to exclude itself from step-free routing.
      avoidStairs: false,
      avoidElevators: false,
    },
  },
  {
    name: 'Tired-friendly',
    hint: 'Trades distance for less climbing',
    options: {
      tirednessWeight: 2,
      requireWheelchair: false,
      avoidStairs: false,
      avoidElevators: false,
    },
  },
  {
    name: 'Avoid stairs',
    hint: 'No stairs at all, even if it means no route',
    options: {
      tirednessWeight: 1,
      requireWheelchair: false,
      avoidStairs: true,
      avoidElevators: false,
    },
  },
]

/** Slider stops, labelled the way a person would describe them. */
const WEIGHT_STOPS = [0, 0.25, 0.5, 1, 2, 4]
const WEIGHT_LABELS = ['Don’t care', 'Barely', 'A little', 'Somewhat', 'Quite', 'Very tired']

export function FilterPanel({
  options,
  onChange,
}: {
  options: RouteOptions
  onChange: (options: RouteOptions) => void
}) {
  const stopIndex = nearestStop(options.tirednessWeight)

  return (
    <section className="filter-panel">
      <div className="presets">
        {PRESETS.map((preset) => (
          <button
            key={preset.name}
            type="button"
            className={sameOptions(preset.options, options) ? 'chip active' : 'chip'}
            title={preset.hint}
            onClick={() => onChange(preset.options)}
          >
            {preset.name}
          </button>
        ))}
      </div>

      <label className="slider">
        <span className="slider-head">
          How tired are you? <strong>{WEIGHT_LABELS[stopIndex]}</strong>
        </span>
        <input
          type="range"
          min="0"
          max={WEIGHT_STOPS.length - 1}
          step="1"
          value={stopIndex}
          onChange={(e) => onChange({ ...options, tirednessWeight: WEIGHT_STOPS[Number(e.target.value)] })}
        />
        <span className="hint">
          {options.tirednessWeight === 0
            ? 'Shortest path — stairs and lifts judged only on distance.'
            : `Stairs cost ${(1 + options.tirednessWeight * 2).toFixed(1)}× their length, lifts ${(1 + options.tirednessWeight * 0.25).toFixed(2)}×.`}
        </span>
      </label>

      <label className="check">
        <input
          type="checkbox"
          checked={options.requireWheelchair}
          onChange={(e) => onChange({ ...options, requireWheelchair: e.target.checked })}
        />
        Step-free route only
      </label>

      <fieldset className="avoid">
        <legend>Avoid</legend>
        <label className="check">
          <input
            type="checkbox"
            checked={options.avoidStairs}
            onChange={(e) => onChange({ ...options, avoidStairs: e.target.checked })}
          />
          Stairs
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={options.avoidElevators}
            onChange={(e) => onChange({ ...options, avoidElevators: e.target.checked })}
          />
          Elevators
        </label>
      </fieldset>
    </section>
  )
}

function nearestStop(weight: number): number {
  let best = 0
  let bestDelta = Infinity
  WEIGHT_STOPS.forEach((stop, i) => {
    const delta = Math.abs(stop - weight)
    if (delta < bestDelta) {
      bestDelta = delta
      best = i
    }
  })
  return best
}

function sameOptions(a: RouteOptions, b: RouteOptions): boolean {
  return (
    a.tirednessWeight === b.tirednessWeight &&
    a.requireWheelchair === b.requireWheelchair &&
    a.avoidStairs === b.avoidStairs &&
    a.avoidElevators === b.avoidElevators
  )
}

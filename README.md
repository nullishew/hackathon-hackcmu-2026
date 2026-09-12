# CMU Nav

Indoor navigation for the CMU core-campus maze. Three parts:

1. **Data entry** (`/entry`) — import floor plans from PDF (or images), plot points, connect edges.
2. **Tunable routing** — shortest path, or trade distance for less climbing.
3. **3D stack** (`/`) — floor plans stacked in 3D with the route drawn through them, and a
   flat per-floor view to drop into.

## Quick start

```bash
npm install
```

```bash
npm run seed
```

```bash
npm run dev
```

`npm run dev` starts both the web app (<http://localhost:5173>) and the data API
(<http://localhost:5174>). `npm run seed` writes a Gates fixture — six floors, a stairwell,
an elevator that skips floor 6 — so there is something to route through before any real
plan has been traced. Add `-- --force` to overwrite existing data.

### Node version

Vite 8 wants Node `^20.19` or `>=22.12`. It does run on Node 20.13 with a warning, but
**installing Node 22 LTS is recommended.** On an ARM64 Windows machine, npm 10.x can also
skip the native Rolldown binary; if a build fails with
`Cannot find module '@rolldown/binding-win32-arm64-msvc'`, install it explicitly:

```bash
npm install --no-save @rolldown/binding-win32-arm64-msvc
```

## Data model

Positions are stored as **pixels on a floor plan image**, plus a per-floor calibration that
converts pixels to metres. Nothing is geo-referenced; there is no basemap.

An **edge stores exactly three things**:

| field | meaning |
|---|---|
| `distanceM` | 3D distance in metres (horizontal run plus rise) |
| `tiredIndex` | tiredness multiplier — elevator 0.25, walk 1, ramp 1.5, stairs 2 |
| `wheelchair` | boolean |

Two things are deliberately **not** stored:

- **Time.** Estimated at display time as `distanceM / speed`, with speed chosen by edge
  kind. Entering distances is far easier than estimating durations.
- **Edge kind.** Derived from the two node kinds — two stairs nodes on different floors can
  only be a staircase. The nodes already carry it.

### Routing cost

```
cost(edge) = (1 + W × tiredIndex) × distanceM
```

`W` comes from the tiredness slider. At `W = 0` the `tiredIndex` cancels out entirely and
this is the plain shortest path. As `W` rises, stairs (×2) get penalised and elevators
(×0.25) become attractive. Weights stay non-negative at every setting, so Dijkstra is
always valid.

Hard filters (step-free only, avoid stairs, avoid elevators) drop edges before the search,
so an impossible request reports *"no route with these settings"* rather than quietly
returning something unusable.

### Calibration does the measuring

Per floor, draw one line along something of known length and type that length. After that
**every edge distance computes itself** — pixel distance for same-floor edges, and
`√(horizontal² + rise²)` across floors. Override per edge when a plan is distorted.

One special case: stairwell nodes are plotted at the same spot on every floor, so their
straight-line distance is just the rise, which would make stairs look artificially cheap.
Stairs distance is therefore estimated from the rise at a 2:1 run (`src/model/autoDistance.ts`).

## Naming

Point labels are **derived, never typed** — `labelFor(node)` in `src/model/labels.ts`.

The trick is to **name features, not nodes**. Nobody will name twenty thousand hallway
corners; naming ~150 corridors, stairwells and exits plus ~20 zones is an afternoon, and
every nearby node then labels itself.

| case | result |
|---|---|
| room | `Rashid Auditorium (Gates 4401)` |
| hallway at a room | `hallway outside Doherty 2315` |
| hallway at an exit | `hallway by the exit to Frew Street` |
| on a named feature | `Gates 4 — the Helix` |
| landing between levels | `Gates — the Helix, between 4 and 5` |
| entrance | `Porter Hall — the Mall entrance` |

Landmarks are found by **graph** distance, not straight line — a room on the far side of a
wall is not a useful landmark. Colliding labels get a compass disambiguator, so search
never shows two identical results: `hallway outside Gates 4401 (east)` vs `(west)`.

IDs stay readable: `GHC-4-H07` is hallway junction 7 on Gates 4. Elevator is `V` (vertical
lift) so it does not collide with entrance `E`.

## Data entry

| key | action |
|---|---|
| `V` / `P` / `C` / `K` | select / plot / connect / calibrate |
| `1`–`9` | pick the point kind (sticky — `1` is corner, the most common) |
| `Ctrl+Z` / `Ctrl+Shift+Z` | undo / redo |
| `Delete` | delete selection |
| `Esc` | cancel the current gesture |
| shift-drag or middle-drag | pan; wheel zooms |

Speed comes from three behaviours:

- the plot kind is **sticky**, so fifteen corridor corners are fifteen clicks
- **chain mode** connects each new point to the last, so a corridor is one pass
- edge properties **fill themselves** from calibration and the two point kinds, so most
  edges need no data entry at all

Two bulk tools matter more than anything else, because CMU towers repeat:

- **Link through floors** — select a stairwell node, pick a floor range, and matching nodes
  plus their connecting edges are created up the whole stack in one action.
- **Stamp floor** — copy a traced floor onto another. Room numbers are re-prefixed
  (`4401` → `5401`), which is how CMU actually numbers rooms.

The **validation panel** is part of the workflow, not decoration. It catches the quiet
failures: orphan points, floors with no vertical link, disconnected components,
uncalibrated floors, and buildings with no edge to any other building — that last one is
the check that catches *"you can't get from Gates to Doherty."*

## Layout

```
data/
  buildings.json        buildings, floors, calibration, named features
  graph/GHC/4.json      one file per floor — nodes, plus edges owned by their `from` floor
  floorplans/GHC/4.svg  uploaded plan images
  sources/              gitignored: raw downloaded PDFs
src/
  model/                types, calibration, cost model, labelFor(), validation
  routing/              Dijkstra + filters
  entry/                data entry screen
  floor2d/              shared SVG canvas (used by BOTH the editor and the viewer)
  viewer/ viewer3d/     public screen, 3D stack
server/                 Express: reads and writes data/
```

Per-floor files mean two people editing different floors never conflict, and everything is
written sorted and pretty-printed so `git diff` shows the change you actually made.

`src/floor2d` is shared between the editor and the viewer deliberately — the same overlay
renders nodes-and-edges for editing and a route leg for navigating, so they cannot drift.

## Floor plans we still need

The app ships with placeholder schematics. Real plans are Andrew-ID gated (verified: each
returns a ~1.7 KB SSO login page, not the file), so they have to be downloaded by hand.

**Dropping files into `data/sources/` does nothing on its own** — no code reads that
directory; it is only a gitignored holding area so raw downloads never get committed. Plans
enter the app through the data entry screen:

1. `/entry` → **New building** (code + name) if it does not exist yet
2. **add floor** for each floor, in the building's own numbering
3. select a floor → **Import from PDF…** → pick the PDF → assign pages to floors → Import

PDFs are rasterised in the browser at 2200 px wide and stored under
`data/floorplans/<BLDG>/<floor>.png`. A multi-page evacuation map set is one pass: assign
page 3 to floor 4, page 4 to floor 5, and so on. Plain images can be uploaded directly
instead.

Each imported floor still needs **calibrating** (press `K`, draw a line along something of
known length, type the length) before distances mean anything — the floor list flags
`no scale` until you do.

1. **ESIM academic/admin plans** —
   <https://www.cmu.edu/enterprise-space/esim/services/floor-plans/acad-admin/index.html>.
   Priority: **GHC all 9 floors**, then WEH, DH, NSH, HH, SH, SCOT, BH/PH, ANSYS.
2. **Evacuation plans** — `https://www.cmu.edu/erm/restrict/evacplans/<file>.pdf`. Best
   ground truth for stairwells and exits:
   `gates-hillman-maps-20181219.pdf`, `wean-hall-maps-20181214.pdf`, `doherty-hall.pdf`,
   `newell-simon-maps-201090108.pdf`, `hamerschlag-maps-20181026.pdf`,
   `scaife-full-map-set.pdf`, `scott-hall-maps-20190227.pdf`,
   `porter-baker-maps-20190328.pdf`, `ansys-hall.pdf`.
3. **ESIM CADD Drawing Request** — worth filing; real DWG for Gates would be the best
   possible source.

`data/sources/` is gitignored: restricted plans should not be committed or republished.
The graph we derive from them is ours.

Useful public data, no auth needed, if building placement in 3D ever needs to be accurate:
CMU publishes survey-grade footprints for 134 buildings as GeoJSON at
`https://services3.arcgis.com/Ew9YqyisUrOy56R6/arcgis/rest/services/CMU_Building_Features_Public_View/FeatureServer/2/query?where=1=1&outFields=*&f=geojson`.

## Deploying the public site

See **[DEPLOY.md](DEPLOY.md)** for a step-by-step runbook aimed at someone setting this up on
a fresh machine, including troubleshooting. The short version follows.

The viewer needs no server. Searching, routing and drawing all happen in the browser, and
only the editor writes — so the graph is baked into the build as a plain file and the whole
thing deploys as static files, free, anywhere.

```bash
npm run build:static
```

That runs the normal build, then writes into `dist/`:

- `map-data.json` — the whole graph (~500 KB), validated by the same schema the app uses
- `floorplans/` — the plan images (~10 MB)
- `_redirects` — SPA fallback, so a refresh on `/entry` does not 404

Then publish `dist/` by whichever route is quickest:

**Netlify Drop** — no install, no CLI. Open <https://app.netlify.com/drop> and drag the
`dist` folder in. You get a URL immediately; sign in afterwards to keep it.

**Netlify CLI** — repeatable, better for redeploys:

```bash
npx netlify-cli deploy --prod --dir=dist
```

**Cloudflare Pages** — also reads `_redirects`:

```bash
npx wrangler pages deploy dist
```

Vercel works too but ignores `_redirects`; it needs a `vercel.json` with a catch-all rewrite
to `/index.html`. GitHub Pages is awkward here: the repo is private, which Pages does not
serve on the free plan, and it would need a `base` path set in `vite.config.ts`.

### What the deployed site does and does not do

`/` is fully working: search, routing, the tiredness dial, the 3D stack, the 2D map and
pick-on-map all run client-side against the baked data.

`/entry` loads and is explorable but **read-only** — it says so in a banner, and edits are
not queued rather than failing one by one. Editing needs the local API (`npm run dev`).

The data is a snapshot taken at build time. To publish newer tracing, re-run
`npm run build:static` and redeploy.

### Before you share the link

The plan images are derived from Andrew-ID-restricted CMU documents, and a public URL
republishes them to anyone who has it. A random `*.netlify.app` subdomain is obscurity, not
access control. That may well be fine for a demo — but it is worth a deliberate decision
rather than a surprise, and if it is not fine, the options are to password-protect the site
(a paid feature on most hosts) or to deploy with the placeholder schematics instead of the
real plans.

## Tests

```bash
npm test
```

52 tests over the cost model, calibration, label derivation, routing, filters, leg
decomposition and 3D placement. The ones worth knowing about:

- `W = 0` returns the shortest-distance route; raising `W` monotonically reduces total
  tiredness, and trades distance for it rather than improving both
- Gates 4 → Gates 9 returns **different routes** at `W = 0` (stairs, 56 m) than at `W = 1`
  (the elevator, 63 m) — the clearest single proof the tiredness model works
- step-free routing never returns a stairs edge; avoid-stairs to floor 6 (which the
  elevator skips) reports no route rather than cheating
- floor planes are sized from calibration, stacked in elevation order, and route points
  land exactly where their nodes are

## Known limitations

- **Elevator wait time is not modelled.** Because time is estimated purely from distance,
  the elevator can appear *faster* than the stairs (51 s vs 2 min for Gates 4 → 9), which
  anyone who has waited for a Gates elevator will dispute. Routing is unaffected — cost
  uses distance and tiredness, not time — but the displayed duration is optimistic.
- The 3D stack has not been verified visually in a headless environment; its placement math
  is covered by tests instead. Worth a look in a real browser.
- **Anything depending on `requestAnimationFrame` cannot run in a hidden tab**, which is how
  the 3D canvas and PDF rendering both first failed. PDF rasterising therefore renders with
  `intent: 'print'`, which makes pdf.js render synchronously instead of scheduling
  continuations through rAF — do not "fix" that back to display intent.
- Building placement in the shared world is manual (`placement` in `buildings.json`); there
  is no site-layout drag UI yet, which only matters once a second building exists.

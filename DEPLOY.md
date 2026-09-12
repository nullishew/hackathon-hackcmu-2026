# Deploying the public site

A runbook for getting the map online from a fresh machine. Start to finish is about ten
minutes, most of which is `npm install`.

**You do not need an Andrew ID, and you do not need to download any floor plans.** The map
data and all 39 plan images are committed to this repo, so a clone has everything. Do not
run `npm run seed` — that writes the small demo fixture, not the real data.

## TL;DR

```bash
git clone https://github.com/nullishew/hackathon-hackcmu-2026.git
```

```bash
cd hackathon-hackcmu-2026 && npm install
```

```bash
npm run build:static
```

Then drag the `dist` folder onto <https://app.netlify.com/drop>. That is the whole job.

## What you need first

- **Node 22 LTS** (or 20.19+). Get it from <https://nodejs.org>. Check with `node --version`.
  Older versions will fail the build with a message about the Node version — see
  troubleshooting.
- **git**, and read access to this private repo.

Nothing else. No database, no API keys, no accounts until the deploy step.

## Step by step

### 1. Clone and install

```bash
git clone https://github.com/nullishew/hackathon-hackcmu-2026.git
```

```bash
cd hackathon-hackcmu-2026
```

```bash
npm install
```

### 2. Check it works before you deploy

Optional but worth the 30 seconds:

```bash
npm test
```

You should see `Tests  67 passed (67)`. If that passes, the routing engine and data model
are sound on your machine.

### 3. Build the static site

```bash
npm run build:static
```

Expected output ends with something like:

```
map-data.json   495 KB
                4 buildings, 1751 nodes, 1883 edges
floorplans      39 files, 10 MB
_redirects      SPA fallback written

dist/ is ready to deploy as a static site.
```

If the building/node counts are much smaller than that, you are probably looking at the
demo fixture rather than the real data — check that `data/graph/` has `GHC`, `WEH`, `NSH`
and `DH` folders.

### 4. Look at it locally (optional)

```bash
npm run preview
```

Open the URL it prints (usually <http://localhost:4173>). This serves `dist/` exactly as a
static host would, with no API running — so if it works here, it will work deployed.

### 5. Publish

**Netlify Drop** is the fastest and needs no install: open <https://app.netlify.com/drop>
and drag the `dist` folder into the page. You get a live URL in seconds. Sign in afterwards
to claim the site so it does not expire.

**Netlify CLI** if you expect to redeploy more than once:

```bash
npx netlify-cli deploy --prod --dir=dist
```

It opens a browser to log in the first time, then prints the URL.

**Cloudflare Pages** also works — it reads the same `_redirects` file:

```bash
npx wrangler pages deploy dist
```

Vercel works but ignores `_redirects`; it needs a `vercel.json` with a catch-all rewrite to
`/index.html`, or deep links like `/entry` will 404 on refresh. GitHub Pages is not worth
the trouble here: the repo is private, which Pages does not serve on the free plan.

## Redeploying after someone traces more floors

```bash
git pull && npm run build:static
```

Then drag `dist` in again (or re-run the CLI command). The deployed site holds a snapshot
taken at build time — it does not update itself when someone edits the map.

If the pull brought in newly traced floors, run the backfill first so every edge has a
`kind` set, otherwise the build will refuse the data:

```bash
npx tsx scripts/backfill-edge-kinds.ts
```

It only fills edges that have no kind yet, so it is safe to run any time and will not
overwrite anyone's hand corrections.

## What the deployed site does

`/` is fully working — search, routing, the tiredness dial, the 3D stack, the 2D map, and
picking endpoints by tapping the map. All of it runs in the browser against the baked data,
which is why no server is needed.

`/entry` (the editor) loads and can be explored, but it is **read-only** and says so in a
banner. Editing needs the local API. To actually edit the map:

```bash
npm run dev
```

That starts the app on <http://localhost:5173> and the data API on
<http://localhost:5174>, and saves write straight into `data/` as files you then commit.

## Before you share the link

The plan images are derived from Andrew-ID-restricted CMU documents, and a public URL
republishes them to anyone who has it. A random `*.netlify.app` subdomain is obscurity, not
access control. That is probably fine for a demo, but make it a deliberate choice rather
than a surprise. If it is not fine, the options are password protection (a paid feature on
most hosts) or deploying with the placeholder schematics instead of the real plans.

## Troubleshooting

**"You are using Node.js 20.13. Vite requires Node.js version 20.19+ or 22.12+"**
Install Node 22 LTS. On Windows, `winget install OpenJS.NodeJS.LTS`; on macOS,
`brew install node`; or use the installer from nodejs.org. Then delete `node_modules` and
`npm install` again.

**`Cannot find module '@rolldown/binding-<platform>'`**
npm 10.x sometimes skips the native binary for your platform. Install it explicitly — copy
the exact package name from the error message:

```bash
npm install --no-save @rolldown/binding-win32-arm64-msvc
```

Or upgrade npm (`npm install -g npm@latest`) and reinstall, which also fixes it.

**`dist/ not found`**
You ran the export on its own. Use `npm run build:static`, which builds first.

**`data/graph for floor NSH:4 is invalid: Invalid option: expected one of "walk"|"stairs"|"elevator"|"ramp"`**
Someone committed edges without a `kind`. The message names the floor. The front end builds
fine and only the data export fails, so `dist/` will exist but have no `map-data.json` —
do not deploy it. Run the backfill, then build again:

```bash
npx tsx scripts/backfill-edge-kinds.ts
```

**Dev shows "Could not load the map"**
The data API is not running. `npm run dev` starts both processes; `npm run dev:web` alone
starts only the front end.

**Port already in use**
Something is already on 5173/5174/4173. Stop it, or pass a different port:
`npx vite --port 5180`.

**`git status` shows files changed that you did not touch**
Line endings. The server writes files with LF and git checks them out with CRLF on Windows,
so any file the editor saves looks modified with an empty diff. Harmless, and fixable with
a `.gitattributes` containing `* text=auto eol=lf` — but that rewrites every file, so
coordinate with the team before doing it.

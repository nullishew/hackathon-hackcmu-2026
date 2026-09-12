/**
 * Bake the map into the static build so the public site needs no server.
 *
 *   npm run build:static      # vite build, then this
 *
 * The viewer only ever READS the graph — searching, routing and drawing all happen in the
 * browser. Only the editor writes. So production can ship the data as a plain file and
 * skip the API entirely, which is what makes this deployable to any static host for free.
 *
 * Writes into dist/ after the Vite build rather than into public/, deliberately: anything
 * in public/ is also served in development, where it would shadow the live API and quietly
 * show you stale data while you were editing.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { loadProject, FLOORPLANS_DIR } from '../server/storage'

const DIST = path.resolve(process.cwd(), 'dist')

async function main(): Promise<void> {
  if (!(await exists(DIST))) {
    throw new Error('dist/ not found — run "vite build" first (or use "npm run build:static").')
  }

  // Going through loadProject means the export is validated by the same schema the app
  // uses, so a bad file fails here rather than on someone's phone.
  const project = await loadProject()
  const snapshot = path.join(DIST, 'map-data.json')
  await fs.writeFile(snapshot, JSON.stringify(project), 'utf8')

  const plans = await copyDir(FLOORPLANS_DIR, path.join(DIST, 'floorplans'))

  // Single-page app: every route must fall back to index.html or a refresh on /entry 404s.
  // This format is understood by Netlify and Cloudflare Pages.
  await fs.writeFile(path.join(DIST, '_redirects'), '/*  /index.html  200\n', 'utf8')

  const snapshotKb = Math.round((await fs.stat(snapshot)).size / 1024)
  console.log(`map-data.json   ${snapshotKb} KB`)
  console.log(`                ${project.buildings.length} buildings, ${Object.keys(project.nodes).length} nodes, ${Object.keys(project.edges).length} edges`)
  console.log(`floorplans      ${plans.files} files, ${Math.round(plans.bytes / 1024 / 1024)} MB`)
  console.log(`_redirects      SPA fallback written`)
  console.log(`\ndist/ is ready to deploy as a static site.`)
}

async function copyDir(from: string, to: string): Promise<{ files: number; bytes: number }> {
  let files = 0
  let bytes = 0
  await fs.mkdir(to, { recursive: true })
  for (const entry of await fs.readdir(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name)
    const target = path.join(to, entry.name)
    if (entry.isDirectory()) {
      const nested = await copyDir(source, target)
      files += nested.files
      bytes += nested.bytes
      continue
    }
    await fs.copyFile(source, target)
    files++
    bytes += (await fs.stat(target)).size
  }
  return { files, bytes }
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

main().catch((err) => {
  console.error(String(err instanceof Error ? err.message : err))
  process.exit(1)
})

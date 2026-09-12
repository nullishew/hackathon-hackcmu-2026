/**
 * Seed data/ with the Gates fixture, plus a schematic placeholder plan per floor so the
 * app has something to render before any real floor plan has been downloaded and traced.
 *
 *   npm run seed          # writes only if data/buildings.json is absent
 *   npm run seed -- --force
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { gatesFixture } from '../src/model/fixtures'
import { FLOORPLANS_DIR, DATA_DIR, saveProject } from '../server/storage'
import type { Floor, Project } from '../src/model/types'

const force = process.argv.includes('--force')

async function main(): Promise<void> {
  const buildingsFile = path.join(DATA_DIR, 'buildings.json')
  if (!force && (await exists(buildingsFile))) {
    console.log('data/buildings.json already exists — nothing written. Use --force to overwrite.')
    return
  }

  const project = gatesFixture()
  await writePlaceholderPlans(project)
  await saveProject(project)

  const floors = project.buildings.flatMap((b) => b.floors).length
  console.log(
    `Seeded ${project.buildings.length} building, ${floors} floors, ` +
      `${Object.keys(project.nodes).length} nodes, ${Object.keys(project.edges).length} edges.`,
  )
}

async function writePlaceholderPlans(project: Project): Promise<void> {
  for (const building of project.buildings) {
    const dir = path.join(FLOORPLANS_DIR, building.id)
    await fs.mkdir(dir, { recursive: true })

    for (const floor of building.floors) {
      const file = path.join(dir, `${floor.floorKey}.svg`)
      await fs.writeFile(file, placeholderPlanSvg(building.id, floor), 'utf8')
      // Point the floor at the plan we just wrote.
      floor.image = { src: `/floorplans/${building.id}/${floor.floorKey}.svg`, widthPx: 1000, heightPx: 600 }
    }
  }
}

/**
 * A schematic plan matching the fixture layout: a corridor band with rooms off it and
 * the stair/elevator cores marked. Obviously a placeholder, which is the point — nobody
 * should mistake it for a real plan.
 */
function placeholderPlanSvg(buildingId: string, floor: Floor): string {
  const hasElevator = floor.ordinal !== 6 // the fixture elevator skips floor 6
  const roomNumber = floor.ordinal === 4 ? '4401' : `${floor.ordinal}301`

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 600" width="1000" height="600">
  <rect width="1000" height="600" fill="#f6f5f2"/>
  <g stroke="#c9c5bd" stroke-width="2" fill="none">
    <rect x="60" y="120" width="880" height="360"/>
  </g>
  <!-- corridor band -->
  <rect x="80" y="280" width="840" height="40" fill="#ffffff" stroke="#d8d4cc" stroke-width="2"/>
  <!-- rooms off the corridor -->
  <rect x="120" y="170" width="160" height="100" fill="#e9eefb" stroke="#9eabcd" stroke-width="2"/>
  <text x="200" y="225" font-family="system-ui, sans-serif" font-size="20" fill="#53627f" text-anchor="middle">${roomNumber}</text>
  <rect x="320" y="170" width="140" height="100" fill="#f1efe9" stroke="#cfcabf" stroke-width="2"/>
  <rect x="500" y="170" width="140" height="100" fill="#f1efe9" stroke="#cfcabf" stroke-width="2"/>
  <rect x="680" y="170" width="160" height="100" fill="#f1efe9" stroke="#cfcabf" stroke-width="2"/>
  <rect x="120" y="330" width="200" height="110" fill="#f1efe9" stroke="#cfcabf" stroke-width="2"/>
  <rect x="420" y="330" width="200" height="110" fill="#f1efe9" stroke="#cfcabf" stroke-width="2"/>
  <!-- stair core -->
  <rect x="100" y="270" width="60" height="60" fill="#cfe0e6" stroke="#7a9aa4" stroke-width="2"/>
  <text x="130" y="306" font-family="system-ui, sans-serif" font-size="16" fill="#3c5860" text-anchor="middle">S</text>
  ${
    hasElevator
      ? `<rect x="330" y="270" width="60" height="60" fill="#cfe0e6" stroke="#7a9aa4" stroke-width="2"/>
  <text x="360" y="306" font-family="system-ui, sans-serif" font-size="16" fill="#3c5860" text-anchor="middle">E</text>`
      : `<text x="360" y="306" font-family="system-ui, sans-serif" font-size="13" fill="#9a958c" text-anchor="middle">no elevator stop</text>`
  }
  <text x="80" y="100" font-family="system-ui, sans-serif" font-size="26" fill="#6b665d">${buildingId} — floor ${floor.floorKey}</text>
  <text x="80" y="540" font-family="system-ui, sans-serif" font-size="15" fill="#a8a29a">Placeholder schematic — replace with the real floor plan</text>
</svg>
`
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

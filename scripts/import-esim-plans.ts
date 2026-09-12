/**
 * Import a building's ESIM floor plan PDFs as the plan images the editor traces over.
 *
 *   npx tsx scripts/import-esim-plans.ts --dir ~/Downloads/gates-floor-plan \
 *     --building GHC --pattern "GATES-{floor}-ESIM-Base.pdf" --floors 1,2,3,4,5,6,7,8,9
 *
 * The in-app PDF import (Import from PDF…) handles one plan at a time and is the right
 * tool for a one-off. A whole building is different: every sheet has to be cropped to the
 * SAME rectangle, because a node's position is stored in the pixels of its own floor's
 * image. Crop two floors differently and the stairwell that is one shaft in the building
 * lands in two different places in the 3D stack. So this does the set in one pass:
 *
 *  1. Measure where the drawing sits on each sheet, and crop them all to the union.
 *     CMU's evacuation sheets are plotted from one drawing with one plot window, so the
 *     same page rectangle is the same place in the world on every floor.
 *  2. Drop the printed footer (logo, rule, title, report date), which is not the plan.
 *  3. Set each floor's calibration from the plot scale, so distances are real metres
 *     without anyone dragging a reference line on nine floors.
 *
 * Needs poppler's pdftoppm on PATH, or POPPLER_BIN pointing at the folder holding it.
 * (A MiKTeX or TeX Live install has one; so does `winget install poppler`.)
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { BuildingsFile, type Building, type Floor } from '../src/model/types'
import { DATA_DIR, FLOORPLANS_DIR } from '../server/storage'

/** Output resolution. 3 px per PDF point keeps room numbers legible when zoomed in. */
const DPI = 216
/** Plot scale of the ESIM sheets: one inch of paper is fifty feet of building. */
const DEFAULT_FEET_PER_INCH = 50
const METRES_PER_FOOT = 0.3048
/** Floor-to-floor height used only for floors this script has to invent. */
const FLOOR_HEIGHT_M = 4.5
const PAD_PT = 8
/** Resolution used for the cheap measuring pass. */
const PROBE_DPI = 100

interface Args {
  dir: string
  building: string
  pattern: string
  floors: string[]
  feetPerInch: number
  crop?: Box
}

interface Box {
  x1: number
  y1: number
  x2: number
  y2: number
}

interface Gray {
  w: number
  h: number
  data: Buffer
}

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const dir = get('dir')
  const building = get('building')
  if (!dir || !building) {
    throw new Error(
      'Usage: import-esim-plans --dir <pdf folder> --building <code> ' +
        '[--pattern "GATES-{floor}-ESIM-Base.pdf"] [--floors 1,2,3] [--feet-per-inch 50] ' +
        '[--crop x1,y1,x2,y2]',
    )
  }
  const cropRaw = get('crop')?.split(',').map(Number)
  return {
    dir: dir.replace(/^~/, os.homedir()),
    building,
    pattern: get('pattern') ?? `${building}-{floor}.pdf`,
    floors: (get('floors') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    feetPerInch: Number(get('feet-per-inch') ?? DEFAULT_FEET_PER_INCH),
    crop:
      cropRaw?.length === 4
        ? { x1: cropRaw[0], y1: cropRaw[1], x2: cropRaw[2], y2: cropRaw[3] }
        : undefined,
  }
}

function popplerTool(name: string): string {
  const exe = process.platform === 'win32' ? `${name}.exe` : name
  const candidates = [
    process.env.POPPLER_BIN && path.join(process.env.POPPLER_BIN, exe),
    path.join(os.homedir(), 'AppData/Local/Programs/MiKTeX/miktex/bin/x64', exe),
  ].filter((p): p is string => Boolean(p))

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  try {
    execFileSync(exe, ['-v'], { stdio: 'ignore' })
    return exe
  } catch {
    throw new Error(
      `Could not find poppler's ${name}. Install poppler and put it on PATH, or set ` +
        'POPPLER_BIN to the folder containing it. Or import the plans one at a time with ' +
        'the in-app "Import from PDF…" button, which needs no native tools.',
    )
  }
}

const PDFTOPPM = popplerTool('pdftoppm')

/** Netpbm P5: "P5 <w> <h> <max>" then one byte per pixel. */
function readPgm(file: string): Gray {
  const buf = fs.readFileSync(file)
  let pos = 0
  const token = (): string => {
    while ([0x20, 0x0a, 0x0d, 0x09].includes(buf[pos])) pos++
    const start = pos
    while (pos < buf.length && ![0x20, 0x0a, 0x0d, 0x09].includes(buf[pos])) pos++
    return buf.subarray(start, pos).toString('ascii')
  }
  if (token() !== 'P5') throw new Error(`${file} is not a P5 PGM`)
  const w = Number(token())
  const h = Number(token())
  token()
  pos++
  return { w, h, data: buf.subarray(pos) }
}

function renderProbe(pdf: string, out: string): Gray {
  execFileSync(
    PDFTOPPM,
    ['-gray', '-r', String(PROBE_DPI), '-singlefile', '-f', '1', '-l', '1', pdf, out],
    { stdio: 'ignore' },
  )
  return readPgm(`${out}.pgm`)
}

/**
 * The drawing's bounding box on one sheet, in PDF points.
 *
 * Two things are not the drawing. The printed footer, which announces itself as a rule
 * running the full width of the sheet — everything below that is furniture. And stray
 * site marks (bollards, light standards) scattered out in the margins, which would
 * otherwise stretch the crop across empty paper; trimming to the columns and rows that
 * hold all but a thousandth of the ink drops them and keeps the building.
 */
function drawingBox(img: Gray, keepFraction = 0.999): Box {
  const s = PROBE_DPI / 72
  const ink = (i: number) => img.data[i] < 220

  let footerTop = img.h
  for (let y = Math.round(img.h * 0.6); y < img.h; y++) {
    let n = 0
    for (let x = 0; x < img.w; x++) if (ink(y * img.w + x)) n++
    if (n > img.w * 0.6) {
      // Back off above the rule to clear the logo block, which rises above it.
      footerTop = Math.max(0, y - Math.round(24 * s))
      break
    }
  }

  const cols = new Float64Array(img.w)
  const rows = new Float64Array(img.h)
  let total = 0
  for (let y = 0; y < Math.min(img.h, footerTop); y++) {
    for (let x = 0; x < img.w; x++) {
      if (!ink(y * img.w + x)) continue
      cols[x]++
      rows[y]++
      total++
    }
  }
  if (total === 0) throw new Error('Sheet appears blank')

  const trim = (profile: Float64Array): [number, number] => {
    const budget = (total * (1 - keepFraction)) / 2
    let lo = 0
    let hi = profile.length - 1
    let spent = 0
    while (lo < hi && spent + profile[lo] <= budget) spent += profile[lo++]
    spent = 0
    while (hi > lo && spent + profile[hi] <= budget) spent += profile[hi--]
    return [lo, hi]
  }

  const [x1, x2] = trim(cols)
  const [y1, y2] = trim(rows)
  return { x1: x1 / s, y1: y1 / s, x2: x2 / s, y2: y2 / s }
}

function union(boxes: Box[]): Box {
  return {
    x1: Math.min(...boxes.map((b) => b.x1)),
    y1: Math.min(...boxes.map((b) => b.y1)),
    x2: Math.max(...boxes.map((b) => b.x2)),
    y2: Math.max(...boxes.map((b) => b.y2)),
  }
}

/** Width and height straight out of the PNG header. */
function pngSize(file: string): { widthPx: number; heightPx: number } {
  const buf = fs.readFileSync(file)
  if (buf.subarray(12, 16).toString('ascii') !== 'IHDR') throw new Error(`${file} is not a PNG`)
  return { widthPx: buf.readUInt32BE(16), heightPx: buf.readUInt32BE(20) }
}

function renderCropped(pdf: string, out: string, crop: Box): void {
  const s = DPI / 72
  const args = [
    '-gray',
    '-png',
    '-r',
    String(DPI),
    '-singlefile',
    '-f',
    '1',
    '-l',
    '1',
    '-x',
    String(Math.round(crop.x1 * s)),
    '-y',
    String(Math.round(crop.y1 * s)),
    '-W',
    String(Math.round((crop.x2 - crop.x1) * s)),
    '-H',
    String(Math.round((crop.y2 - crop.y1) * s)),
    pdf,
    out,
  ]
  execFileSync(PDFTOPPM, args, { stdio: 'ignore' })
}

function main(): void {
  const args = parseArgs(process.argv.slice(2))

  const sheets = args.floors.map((floorKey) => ({
    floorKey,
    pdf: path.join(args.dir, args.pattern.replace('{floor}', floorKey)),
  }))
  const missing = sheets.filter((s) => !fs.existsSync(s.pdf))
  if (missing.length > 0) {
    throw new Error(`Missing PDFs:\n  ${missing.map((m) => m.pdf).join('\n  ')}`)
  }

  const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esim-'))
  let crop = args.crop
  if (!crop) {
    console.log('Measuring the drawing on each sheet…')
    const boxes = sheets.map(({ floorKey, pdf }) => {
      const box = drawingBox(renderProbe(pdf, path.join(probeDir, `f${floorKey}`)))
      console.log(
        `  floor ${floorKey}: x ${box.x1.toFixed(0)}..${box.x2.toFixed(0)}` +
          `  y ${box.y1.toFixed(0)}..${box.y2.toFixed(0)} pt`,
      )
      return box
    })
    const u = union(boxes)
    crop = {
      x1: Math.max(0, u.x1 - PAD_PT),
      y1: Math.max(0, u.y1 - PAD_PT),
      x2: u.x2 + PAD_PT,
      y2: u.y2 + PAD_PT,
    }
  }
  console.log(
    `\nShared crop: x ${crop.x1.toFixed(0)}..${crop.x2.toFixed(0)} y ${crop.y1.toFixed(0)}..${crop.y2.toFixed(0)} pt ` +
      `(${(crop.x2 - crop.x1).toFixed(0)} x ${(crop.y2 - crop.y1).toFixed(0)} pt) at ${DPI} dpi\n`,
  )

  const outDir = path.join(FLOORPLANS_DIR, args.building)
  fs.mkdirSync(outDir, { recursive: true })

  const imported: Array<{ floorKey: string; src: string; widthPx: number; heightPx: number }> = []
  for (const { floorKey, pdf } of sheets) {
    const out = path.join(outDir, floorKey)
    renderCropped(pdf, out, crop)
    const size = pngSize(`${out}.png`)
    imported.push({
      floorKey,
      src: `/floorplans/${args.building}/${floorKey}.png`,
      ...size,
    })
    const kb = Math.round(fs.statSync(`${out}.png`).size / 1024)
    console.log(`floor ${floorKey}: ${size.widthPx}x${size.heightPx} px, ${kb} kB`)
  }

  // One inch of paper is `feetPerInch` feet of building, and one inch of paper is DPI px.
  const pixelsPerMeter = DPI / (args.feetPerInch * METRES_PER_FOOT)
  console.log(
    `\nCalibration: ${pixelsPerMeter.toFixed(4)} px/m ` +
      `(1 in = ${args.feetPerInch} ft at ${DPI} dpi)`,
  )

  updateBuildings(args.building, imported, pixelsPerMeter)
  fs.rmSync(probeDir, { recursive: true, force: true })
}

function updateBuildings(
  buildingId: string,
  imported: Array<{ floorKey: string; src: string; widthPx: number; heightPx: number }>,
  pixelsPerMeter: number,
): void {
  const file = path.join(DATA_DIR, 'buildings.json')
  const parsed = BuildingsFile.safeParse(JSON.parse(fs.readFileSync(file, 'utf8')))
  if (!parsed.success) {
    throw new Error(`data/buildings.json is invalid: ${parsed.error.issues[0]?.message}`)
  }
  const { buildings, features } = parsed.data

  let building = buildings.find((b) => b.id === buildingId)
  if (!building) {
    building = {
      id: buildingId,
      name: buildingId,
      placement: { x: buildings.length * 160, y: 0, rotationDeg: 0 },
      floors: [],
    } satisfies Building
    buildings.push(building)
  }

  // Keep the elevations already on disk, and hang new floors off one of them so adding a
  // floor below does not shift every floor that was already placed.
  const anchor = [...building.floors].sort((a, b) => a.ordinal - b.ordinal)[0]

  for (const plan of imported) {
    const id = `${buildingId}:${plan.floorKey}`
    const ordinal = floorOrdinal(plan.floorKey)
    const existing = building.floors.find((f) => f.id === id)

    if (existing?.image && existing.image.src !== plan.src) {
      // The floor pointed at a different file (a placeholder, or another format).
      const stale = path.join(DATA_DIR, existing.image.src.replace(/^\//, ''))
      if (fs.existsSync(stale)) {
        fs.rmSync(stale)
        console.log(`removed stale ${path.relative(DATA_DIR, stale)}`)
      }
    }

    const image = { src: plan.src, widthPx: plan.widthPx, heightPx: plan.heightPx }
    const calibration = { pixelsPerMeter, originX: 0, originY: 0, rotationDeg: 0 }

    if (existing) {
      existing.image = image
      existing.calibration = calibration
    } else {
      if (!Number.isFinite(ordinal)) {
        console.warn(
          `floor key "${plan.floorKey}" is not a number or a letter — check its ordinal and elevation by hand`,
        )
      }
      const safeOrdinal = Number.isFinite(ordinal) ? ordinal : building.floors.length + 1
      building.floors.push({
        id,
        buildingId,
        floorKey: plan.floorKey,
        ordinal: safeOrdinal,
        elevationM: anchor
          ? anchor.elevationM + (safeOrdinal - anchor.ordinal) * FLOOR_HEIGHT_M
          : (safeOrdinal - 1) * FLOOR_HEIGHT_M,
        image,
        calibration,
      } satisfies Floor)
    }
  }

  building.floors.sort((a, b) => a.ordinal - b.ordinal)
  fs.writeFileSync(
    file,
    `${JSON.stringify({ buildings: [...buildings].sort(byId), features: [...features].sort(byId) }, null, 2)}\n`,
    'utf8',
  )
  console.log(
    `\nWrote data/buildings.json — ${buildingId} now has ${building.floors.length} floors: ` +
      building.floors.map((f) => f.floorKey).join(', '),
  )
}

/**
 * Numeric floors keep their number. A single letter is a basement: A sits just below 1
 * (ordinal 0), B below that (−1), and so on. A trailing M is a mezzanine halfway to the
 * next floor (1M = 1.5, AM = 0.5) — those are the ramp landings, not extra storeys.
 */
function floorOrdinal(floorKey: string): number {
  const key = floorKey.toUpperCase()
  const mezz = key.length > 1 && key.endsWith('M') ? key.slice(0, -1) : null
  const base = mezz ?? key
  const n = Number(base)
  let ordinal: number
  if (Number.isFinite(n)) ordinal = n
  else if (/^[A-Z]$/.test(base)) ordinal = 'A'.charCodeAt(0) - base.charCodeAt(0)
  else return Number.NaN
  return mezz ? ordinal + 0.5 : ordinal
}

function byId(a: { id: string }, b: { id: string }): number {
  return a.id.localeCompare(b.id)
}

main()

/**
 * Put the three existing buildings on one vertical datum:
 *   NSH:4 = WEH:4 = 0
 *   DH:2  = WEH:7
 *
 * Mezzanine floors (*M) sit halfway to the next storey — those are the ramp landings.
 */
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from '../server/storage'

const STEP = 4.5
const file = path.join(DATA_DIR, 'buildings.json')
const data = JSON.parse(fs.readFileSync(file, 'utf8')) as {
  buildings: Array<{
    id: string
    name: string
    shortName?: string
    placement: { x: number; y: number; rotationDeg: number }
    floors: Array<{ floorKey: string; ordinal: number; elevationM: number }>
  }>
  features: Array<{ id: string; kind: string; name: string; buildingId?: string; aliases?: string[] }>
}

const weh = data.buildings.find((b) => b.id === 'WEH')
if (!weh) throw new Error('WEH missing')
for (const floor of weh.floors) floor.elevationM = (floor.ordinal - 4) * STEP

const weh7 = weh.floors.find((f) => f.floorKey === '7')
if (!weh7) throw new Error('WEH:7 missing')

const dh = data.buildings.find((b) => b.id === 'DH')
if (!dh) throw new Error('DH missing')
dh.name = 'Doherty Hall'
dh.shortName = 'Doherty'
for (const floor of dh.floors) floor.elevationM = weh7.elevationM + (floor.ordinal - 2) * STEP

if (!data.features.some((f) => f.id === 'feat-dh-ramps')) {
  data.features.push({
    id: 'feat-dh-ramps',
    kind: 'ramp',
    name: 'Doherty mezzanine ramps',
    buildingId: 'DH',
    aliases: ['mezzanine'],
  })
}

fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`)

const nsh4 = data.buildings.find((b) => b.id === 'NSH')?.floors.find((f) => f.floorKey === '4')
const weh4 = weh.floors.find((f) => f.floorKey === '4')
const dh2 = dh.floors.find((f) => f.floorKey === '2')
console.log(`NSH:4 ${nsh4?.elevationM}  WEH:4 ${weh4?.elevationM}  WEH:7 ${weh7.elevationM}  DH:2 ${dh2?.elevationM}`)
console.log(`WEH ${weh.floors.map((f) => `${f.floorKey}:${f.elevationM}`).join(' ')}`)
console.log(`DH  ${dh.floors.map((f) => `${f.floorKey}:${f.elevationM}`).join(' ')}`)

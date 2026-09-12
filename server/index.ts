/**
 * Local persistence API for the editor. Deliberately small: it reads and writes the
 * JSON files under data/ and serves uploaded floor plan images. No database, because
 * git is already a better change log for this kind of data than a DB would be.
 */
import cors from 'cors'
import express from 'express'
import multer from 'multer'
import fs from 'node:fs/promises'
import path from 'node:path'
import { GraphEdge, GraphNode, Building, Feature } from '../src/model/types'
import {
  FLOORPLANS_DIR,
  loadProject,
  saveBuildings,
  saveFloorGraph,
  splitFloorId,
} from './storage'

const PORT = Number(process.env.PORT ?? 5174)
const MAX_IMAGE_BYTES = 32 * 1024 * 1024

const app = express()
app.use(cors())
app.use(express.json({ limit: '64mb' }))

/** Uploaded plans are served back to the browser from here. */
app.use('/floorplans', express.static(FLOORPLANS_DIR))

app.get('/api/project', async (_req, res) => {
  try {
    res.json(await loadProject())
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.put('/api/buildings', async (req, res) => {
  const parsed = parseBuildings(req.body)
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error })
    return
  }
  try {
    await saveBuildings(parsed.buildings, parsed.features)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.put('/api/floor', async (req, res) => {
  const body = req.body as { floorId?: unknown; nodes?: unknown; edges?: unknown }
  if (typeof body.floorId !== 'string') {
    res.status(400).json({ error: 'floorId is required.' })
    return
  }

  const nodes = GraphNode.array().safeParse(body.nodes ?? [])
  const edges = GraphEdge.array().safeParse(body.edges ?? [])
  if (!nodes.success) {
    res.status(400).json({ error: `Invalid nodes: ${nodes.error.issues[0]?.message}` })
    return
  }
  if (!edges.success) {
    res.status(400).json({ error: `Invalid edges: ${edges.error.issues[0]?.message}` })
    return
  }

  // A floor file must only contain its own nodes, or a save would silently relocate them.
  const stray = nodes.data.find((n) => n.floorId !== body.floorId)
  if (stray) {
    res.status(400).json({ error: `Node ${stray.id} belongs to ${stray.floorId}, not ${body.floorId}.` })
    return
  }

  try {
    await saveFloorGraph(body.floorId, nodes.data, edges.data)
    res.json({ ok: true, nodes: nodes.data.length, edges: edges.data.length })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

/* ---------------- floor plan image upload ---------------- */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES },
})

const ALLOWED_IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif'])

app.post('/api/floorplan', upload.single('file'), async (req, res) => {
  const { floorId } = req.body as { floorId?: string }
  if (!floorId || !req.file) {
    res.status(400).json({ error: 'floorId and a file are both required.' })
    return
  }

  const ext = path.extname(req.file.originalname).toLowerCase()
  if (!ALLOWED_IMAGE_EXT.has(ext)) {
    res.status(400).json({ error: `Unsupported image type "${ext}".` })
    return
  }

  try {
    const { buildingId, floorKey } = splitFloorId(floorId)
    const dir = path.join(FLOORPLANS_DIR, sanitize(buildingId))
    await fs.mkdir(dir, { recursive: true })

    const filename = `${sanitize(floorKey)}${ext}`
    await fs.writeFile(path.join(dir, filename), req.file.buffer)

    res.json({ ok: true, src: `/floorplans/${sanitize(buildingId)}/${filename}` })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

function sanitize(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]/g, '_')
  if (!cleaned || cleaned === '.' || cleaned === '..') throw new Error(`Unsafe name: ${value}`)
  return cleaned
}

function parseBuildings(
  body: unknown,
): { ok: true; buildings: Building[]; features: Feature[] } | { ok: false; error: string } {
  const raw = body as { buildings?: unknown; features?: unknown }
  const buildings = Building.array().safeParse(raw?.buildings ?? [])
  if (!buildings.success) {
    return { ok: false, error: `Invalid buildings: ${buildings.error.issues[0]?.message}` }
  }
  const features = Feature.array().safeParse(raw?.features ?? [])
  if (!features.success) {
    return { ok: false, error: `Invalid features: ${features.error.issues[0]?.message}` }
  }
  return { ok: true, buildings: buildings.data, features: features.data }
}

app.listen(PORT, () => {
  console.log(`[cmu-nav] data API on http://localhost:${PORT}`)
})

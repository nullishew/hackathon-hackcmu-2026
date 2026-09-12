/**
 * Thin wrapper over the data API, with a static fallback.
 *
 * The public build has no server: the graph is baked into dist/map-data.json at build time
 * (see scripts/export-static.ts), because the viewer only ever reads it. Where the data came
 * from decides whether the editor can save, so that is reported back rather than guessed at.
 */
import { GraphEdge, GraphNode, type Building, type Feature, type Project } from '../model/types'
import { z } from 'zod'

const ProjectResponse = z.object({
  buildings: z.array(z.unknown()),
  features: z.array(z.unknown()),
  nodes: z.record(z.string(), GraphNode),
  edges: z.record(z.string(), GraphEdge),
})

async function expectOk(res: Response): Promise<unknown> {
  if (res.ok) return res.json()
  let detail = res.statusText
  try {
    const body = (await res.json()) as { error?: string }
    if (body.error) detail = body.error
  } catch {
    /* response had no JSON body */
  }
  throw new Error(detail)
}

/** Where the loaded graph came from. 'snapshot' means there is nothing to save to. */
export type ProjectSource = 'api' | 'snapshot'

const SNAPSHOT_URL = '/map-data.json'
const API_URL = '/api/project'

/**
 * Try the live API first in development and the baked snapshot first in production, but
 * always fall back to the other. That way a production build still works against a local
 * API if someone runs one, and dev still works if the API is not up yet.
 */
const SOURCES: Array<{ source: ProjectSource; url: string }> = import.meta.env.PROD
  ? [
      { source: 'snapshot', url: SNAPSHOT_URL },
      { source: 'api', url: API_URL },
    ]
  : [
      { source: 'api', url: API_URL },
      { source: 'snapshot', url: SNAPSHOT_URL },
    ]

export async function fetchProject(): Promise<{ project: Project; source: ProjectSource }> {
  const failures: string[] = []

  for (const { source, url } of SOURCES) {
    let raw: unknown
    try {
      raw = await expectOk(await fetch(url))
    } catch (err) {
      failures.push(`${url}: ${(err as Error).message}`)
      continue
    }

    const parsed = ProjectResponse.safeParse(raw)
    if (!parsed.success) {
      // Reachable but malformed is a real error, not a reason to try the other source.
      throw new Error(`Map data from ${url} is not valid: ${parsed.error.issues[0]?.message}`)
    }
    return { project: raw as Project, source }
  }

  throw new Error(`Could not load the map. ${failures.join('; ')}`)
}

export async function putFloor(
  floorId: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
): Promise<void> {
  await expectOk(
    await fetch('/api/floor', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ floorId, nodes, edges }),
    }),
  )
}

export async function putBuildings(buildings: Building[], features: Feature[]): Promise<void> {
  await expectOk(
    await fetch('/api/buildings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ buildings, features }),
    }),
  )
}

export async function uploadFloorplan(floorId: string, file: File): Promise<{ src: string }> {
  const form = new FormData()
  form.append('floorId', floorId)
  form.append('file', file)
  const raw = (await expectOk(
    await fetch('/api/floorplan', { method: 'POST', body: form }),
  )) as { src: string }
  return raw
}

/** Thin wrapper over the local data API. */
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

export async function fetchProject(): Promise<Project> {
  const raw = await expectOk(await fetch('/api/project'))
  const parsed = ProjectResponse.safeParse(raw)
  if (!parsed.success) {
    throw new Error(`Data on disk is not valid: ${parsed.error.issues[0]?.message}`)
  }
  return raw as Project
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

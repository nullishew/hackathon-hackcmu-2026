/**
 * Text search over points. Indoor GPS does not work, so typing is the real interface for
 * both "where am I" and "where am I going" — not a fallback.
 *
 * Searchable text includes the DERIVED label, so typing 2315 finds both "Doherty 2315"
 * and "hallway outside Doherty 2315", which is what makes unnamed corridors addressable
 * at all.
 */
import type { Labeler } from '../model/labels'
import { buildingOfFloor, findFloor, type GraphNode, type Project } from '../model/types'

export interface SearchHit {
  node: GraphNode
  label: string
  /** Secondary line: building and floor. */
  context: string
  score: number
}

export function searchNodes(
  project: Project,
  labeler: Labeler,
  query: string,
  limit = 10,
): SearchHit[] {
  const q = query.trim().toLowerCase()
  if (q.length === 0) return []

  const hits: SearchHit[] = []
  for (const node of Object.values(project.nodes)) {
    const label = labeler.labelFor(node)
    const score = scoreNode(node, label, q, project)
    if (score > 0) {
      hits.push({ node, label, context: contextOf(project, node), score })
    }
  }

  hits.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
  return hits.slice(0, limit)
}

function scoreNode(node: GraphNode, label: string, q: string, project: Project): number {
  const building = buildingOfFloor(project, node.floorId)

  // An exact room number is almost always what someone typing digits wants.
  if (node.roomNumber) {
    const room = node.roomNumber.toLowerCase()
    if (room === q) return 1000
    if (room.startsWith(q)) return 700
    // "ghc 4401" / "gates 4401"
    const qualified = [building?.id, building?.shortName]
      .filter(Boolean)
      .map((prefix) => `${String(prefix).toLowerCase()} ${room}`)
    if (qualified.some((text) => text.startsWith(q))) return 650
  }

  if (node.name) {
    const name = node.name.toLowerCase()
    if (name === q) return 900
    if (name.startsWith(q)) return 600
    if (name.includes(q)) return 400
  }

  for (const alias of node.aliases ?? []) {
    const a = alias.toLowerCase()
    if (a === q) return 850
    if (a.includes(q)) return 380
  }

  const lowered = label.toLowerCase()
  if (lowered.startsWith(q)) return 300
  if (lowered.includes(q)) return 200

  // Named rooms and real destinations should outrank bare corridor corners, so
  // unnamed points only match when the query actually looks like their label.
  return 0
}

function contextOf(project: Project, node: GraphNode): string {
  const building = buildingOfFloor(project, node.floorId)
  const floor = findFloor(project, node.floorId)
  const parts = [building?.name ?? node.floorId.split(':')[0]]
  if (floor) parts.push(`floor ${floor.floorKey}`)
  parts.push(node.kind)
  return parts.join(' · ')
}

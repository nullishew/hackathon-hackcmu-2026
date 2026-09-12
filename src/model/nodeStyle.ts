/**
 * One palette for point kinds, shared by the editor canvas and the viewer map.
 *
 * These colours also exist as `.dot.<kind>` rules in the stylesheet for the toolbar
 * swatches. Keep the two in step — a stairwell that is blue in the editor and something
 * else on the map is the kind of small inconsistency that quietly erodes trust in a tool.
 */
import type { NodeKind } from './types'

export interface NodeStyle {
  fill: string
  /** Radius in CSS pixels at 1:1 zoom; callers divide by their scale. */
  r: number
}

export const NODE_STYLE: Record<NodeKind, NodeStyle> = {
  room: { fill: '#7082b3', r: 6 },
  corner: { fill: '#8d8a84', r: 4.5 },
  stairs: { fill: '#3b92f0', r: 7 },
  elevator: { fill: '#7a5cf0', r: 7 },
  ramp: { fill: '#2aa9a0', r: 6 },
  door: { fill: '#b08a4a', r: 5 },
  entrance: { fill: '#e0851f', r: 7 },
  restroom: { fill: '#c39dff', r: 6 },
  poi: { fill: '#d1605e', r: 6 },
}

export function nodeStyle(kind: NodeKind): NodeStyle {
  return NODE_STYLE[kind] ?? NODE_STYLE.corner
}

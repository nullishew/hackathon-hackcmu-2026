/**
 * Pan/zoom for the floor canvas, kept in image-pixel space.
 *
 * Everything upstream (nodes, calibration, distances) is in plan-image pixels, so the
 * viewport is the only place that knows about screen coordinates. That keeps the
 * conversion in exactly one place instead of smeared across event handlers.
 */
import { useCallback, useRef, useState } from 'react'

export interface Viewport {
  /** Screen pixels per image pixel. */
  scale: number
  tx: number
  ty: number
}

export interface Point {
  x: number
  y: number
}

const MIN_SCALE = 0.05
const MAX_SCALE = 12

export function useViewport(initial?: Partial<Viewport>) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [viewport, setViewport] = useState<Viewport>({
    scale: initial?.scale ?? 1,
    tx: initial?.tx ?? 0,
    ty: initial?.ty ?? 0,
  })

  /** Screen (client) coordinates -> image pixels. */
  const toImage = useCallback(
    (clientX: number, clientY: number): Point => {
      const rect = svgRef.current?.getBoundingClientRect()
      if (!rect) return { x: 0, y: 0 }
      return {
        x: (clientX - rect.left - viewport.tx) / viewport.scale,
        y: (clientY - rect.top - viewport.ty) / viewport.scale,
      }
    },
    [viewport],
  )

  /** Zoom about a screen point, so the pixel under the cursor stays put. */
  const zoomAt = useCallback((clientX: number, clientY: number, factor: number) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    setViewport((v) => {
      const scale = clamp(v.scale * factor, MIN_SCALE, MAX_SCALE)
      const sx = clientX - rect.left
      const sy = clientY - rect.top
      // Solve for the translation that keeps (sx, sy) over the same image point.
      const imgX = (sx - v.tx) / v.scale
      const imgY = (sy - v.ty) / v.scale
      return { scale, tx: sx - imgX * scale, ty: sy - imgY * scale }
    })
  }, [])

  const panBy = useCallback((dx: number, dy: number) => {
    setViewport((v) => ({ ...v, tx: v.tx + dx, ty: v.ty + dy }))
  }, [])

  /** Fit an image of the given size into the current element, with a little margin. */
  const fit = useCallback((widthPx: number, heightPx: number) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || widthPx <= 0 || heightPx <= 0) return
    const margin = 0.94
    const scale = clamp(
      Math.min(rect.width / widthPx, rect.height / heightPx) * margin,
      MIN_SCALE,
      MAX_SCALE,
    )
    setViewport({
      scale,
      tx: (rect.width - widthPx * scale) / 2,
      ty: (rect.height - heightPx * scale) / 2,
    })
  }, [])

  return { svgRef, viewport, setViewport, toImage, zoomAt, panBy, fit }
}

export type ViewportApi = ReturnType<typeof useViewport>

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

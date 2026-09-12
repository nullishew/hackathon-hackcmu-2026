/**
 * Import floor plans straight from a PDF.
 *
 * This exists because every plan CMU actually hands out is a PDF, and the evacuation sets
 * are one multi-page PDF per building covering every floor. Converting those by hand
 * outside the app was the worst part of the workflow.
 *
 * Rendering happens in the browser with pdf.js rather than on the server: it needs no
 * native image libraries, and a human has to decide which page is which floor anyway, so
 * the page thumbnails have to be on screen regardless.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Floor } from '../model/types'

/** Width in pixels we rasterise pages to. Generous, since plans get zoomed into hard. */
const IMPORT_WIDTH_PX = 2200
const THUMBNAIL_WIDTH_PX = 190

interface PdfPage {
  pageNumber: number
  thumbnail: string
  widthPt: number
  heightPt: number
}

type PdfDocument = Awaited<ReturnType<typeof loadPdfDocument>>

/**
 * pdf.js is loaded on demand and its worker URL resolved through Vite, so the ~1 MB
 * library is not in the main bundle for people who never import a PDF.
 */
async function loadPdfjs() {
  const pdfjs = await import('pdfjs-dist')
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  return pdfjs
}

async function loadPdfDocument(data: ArrayBuffer) {
  const pdfjs = await loadPdfjs()
  return pdfjs.getDocument({ data }).promise
}

export function PdfImport({
  floors,
  onImport,
  onClose,
}: {
  floors: Floor[]
  /** Called once per assigned page. Returns when the upload has finished. */
  onImport: (floorId: string, file: File) => Promise<void>
  onClose: () => void
}) {
  const [doc, setDoc] = useState<PdfDocument | null>(null)
  const [fileName, setFileName] = useState('')
  const [pages, setPages] = useState<PdfPage[]>([])
  const [assignments, setAssignments] = useState<Record<number, string>>({})
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const cancelled = useRef(false)

  useEffect(() => {
    cancelled.current = false
    return () => {
      cancelled.current = true
    }
  }, [])

  const openPdf = useCallback(async (file: File) => {
    setBusy(true)
    setStatus('Reading PDF…')
    setPages([])
    setAssignments({})
    try {
      const buffer = await file.arrayBuffer()
      const document = await loadPdfDocument(buffer)
      if (cancelled.current) return
      setDoc(document)
      setFileName(file.name)

      const rendered: PdfPage[] = []
      for (let n = 1; n <= document.numPages; n++) {
        setStatus(`Rendering page ${n} of ${document.numPages}…`)
        const page = await document.getPage(n)
        const base = page.getViewport({ scale: 1 })
        const canvas = await renderPage(page, THUMBNAIL_WIDTH_PX / base.width)
        if (cancelled.current) return
        rendered.push({
          pageNumber: n,
          thumbnail: canvas.toDataURL('image/png'),
          widthPt: base.width,
          heightPt: base.height,
        })
        setPages([...rendered])
      }
      setStatus(
        document.numPages === 1
          ? 'One page. Pick the floor it belongs to.'
          : `${document.numPages} pages. Assign the ones you want — the rest are ignored.`,
      )
    } catch (err) {
      setStatus(`Could not read that PDF: ${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }, [])

  const assignedCount = Object.values(assignments).filter(Boolean).length

  async function runImport() {
    if (!doc || assignedCount === 0) return
    setBusy(true)
    try {
      for (const [pageNumber, floorId] of Object.entries(assignments)) {
        if (!floorId) continue
        const floor = floors.find((f) => f.id === floorId)
        setStatus(`Importing page ${pageNumber} as floor ${floor?.floorKey ?? floorId}…`)

        const page = await doc.getPage(Number(pageNumber))
        const base = page.getViewport({ scale: 1 })
        const canvas = await renderPage(page, IMPORT_WIDTH_PX / base.width)
        const blob = await canvasToBlob(canvas)
        const name = `${fileName.replace(/\.pdf$/i, '')}-p${pageNumber}.png`
        await onImport(floorId, new File([blob], name, { type: 'image/png' }))
      }
      setStatus('Done.')
      onClose()
    } catch (err) {
      setStatus(`Import failed: ${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  /** Floors already claimed by another page, so one plan cannot land on two floors. */
  const claimed = new Set(Object.values(assignments).filter(Boolean))

  return (
    <div className="modal-backdrop" onPointerDown={onClose}>
      <div className="modal" onPointerDown={(e) => e.stopPropagation()}>
        <header>
          <h3>Import floor plans from a PDF</h3>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </header>

        {pages.length === 0 && (
          <label className="upload big">
            Choose a PDF
            <input
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void openPdf(file)
              }}
            />
            <span className="hint">
              Evacuation map sets are one PDF per building covering every floor — import them
              in a single pass.
            </span>
          </label>
        )}

        {status && <p className="hint status">{status}</p>}

        {pages.length > 0 && (
          <>
            <ul className="pdf-pages">
              {pages.map((page) => {
                const assigned = assignments[page.pageNumber] ?? ''
                return (
                  <li key={page.pageNumber} className={assigned ? 'assigned' : undefined}>
                    <img src={page.thumbnail} alt={`Page ${page.pageNumber}`} />
                    <div className="pdf-page-meta">
                      <span>Page {page.pageNumber}</span>
                      <select
                        value={assigned}
                        onChange={(e) =>
                          setAssignments((prev) => ({
                            ...prev,
                            [page.pageNumber]: e.target.value,
                          }))
                        }
                      >
                        <option value="">— skip —</option>
                        {floors.map((floor) => (
                          <option
                            key={floor.id}
                            value={floor.id}
                            disabled={claimed.has(floor.id) && assigned !== floor.id}
                          >
                            floor {floor.floorKey}
                            {floor.image ? ' (replace)' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  </li>
                )
              })}
            </ul>

            <footer>
              <span className="hint">
                {assignedCount === 0
                  ? 'Nothing assigned yet.'
                  : `${assignedCount} page${assignedCount === 1 ? '' : 's'} will be imported at ${IMPORT_WIDTH_PX}px wide.`}
              </span>
              <button
                type="button"
                className="primary"
                disabled={busy || assignedCount === 0}
                onClick={() => void runImport()}
              >
                Import {assignedCount || ''}
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  )
}

/* -------------------------------- rendering -------------------------------- */

type PdfPageProxy = Awaited<ReturnType<PdfDocument['getPage']>>

async function renderPage(page: PdfPageProxy, scale: number): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.floor(viewport.width))
  canvas.height = Math.max(1, Math.floor(viewport.height))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Could not get a 2D canvas context.')
  // Plans are line art on white; without this, transparent areas render black.
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  // Print intent, deliberately: it is the right intent for rasterising to a static image,
  // and it also makes pdf.js render synchronously instead of scheduling continuations
  // through requestAnimationFrame — which never fires in a background tab, so display
  // intent hangs forever if the window is not visible.
  await page.render({ canvas, canvasContext: context, viewport, intent: 'print' }).promise
  return canvas
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('Could not encode the page as PNG.'))
    }, 'image/png')
  })
}

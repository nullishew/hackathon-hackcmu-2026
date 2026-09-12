/** A text field that resolves free text to a point in the graph. */
import { useMemo, useState } from 'react'
import type { Labeler } from '../model/labels'
import type { Project } from '../model/types'
import { searchNodes } from './search'

export function SearchField({
  label,
  placeholder,
  project,
  labeler,
  selectedId,
  onSelect,
}: {
  label: string
  placeholder: string
  project: Project
  labeler: Labeler
  selectedId: string | null
  onSelect: (nodeId: string | null) => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  const hits = useMemo(
    () => (open && query ? searchNodes(project, labeler, query) : []),
    [open, query, project, labeler],
  )

  const selected = selectedId ? project.nodes[selectedId] : undefined

  return (
    <div className="search-field">
      <span className="field-label">{label}</span>

      {selected ? (
        <div className="chosen">
          <span>{labeler.labelFor(selected)}</span>
          <button
            type="button"
            className="link"
            onClick={() => {
              onSelect(null)
              setQuery('')
            }}
          >
            change
          </button>
        </div>
      ) : (
        <>
          <input
            value={query}
            placeholder={placeholder}
            onChange={(e) => {
              setQuery(e.target.value)
              setOpen(true)
            }}
            onFocus={() => setOpen(true)}
            // Delay so a click on a result lands before the list unmounts.
            onBlur={() => setTimeout(() => setOpen(false), 150)}
          />
          {open && query.length > 0 && (
            <ul className="results">
              {hits.length === 0 && <li className="empty">Nothing matches “{query}”.</li>}
              {hits.map((hit) => (
                <li key={hit.node.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(hit.node.id)
                      setOpen(false)
                      setQuery('')
                    }}
                  >
                    <span className="hit-label">{hit.label}</span>
                    <span className="hit-context">{hit.context}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

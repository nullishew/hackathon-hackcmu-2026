/**
 * Read a CSS media query from React, so layout state that the stylesheet already knows
 * about (is the side panel a column or a drawer?) is decided by the same breakpoint
 * rather than a second, drifting copy of it in JS.
 */
import { useCallback, useSyncExternalStore } from 'react'

/** The width at which the side panel stops being a column and becomes a drawer. */
export const NARROW_QUERY = '(max-width: 760px)'

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    [query],
  )

  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches)
}

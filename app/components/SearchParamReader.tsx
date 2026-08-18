'use client'

import { useEffect } from 'react'
import { useSearchParams } from 'next/navigation'

type SearchParamReaderProps = {
  /** Query-string key to watch, e.g. 'feed' or 'q'. */
  name: string
  /** Called on mount and whenever the value changes. '' when absent. */
  onValue: (value: string) => void
}

/**
 * Reads one query-string parameter and reports it upward.
 *
 * Exists so that useSearchParams -- which forces its component to render on the
 * client -- can be confined to a component that renders nothing. Calling the
 * hook in a page component means wrapping that whole page in <Suspense>, and
 * the page then prerenders as the fallback: the entire static HTML disappears
 * and everything waits for JS. Wrapping THIS in Suspense costs nothing, because
 * it has no markup to lose.
 *
 * Also fixes what the raw window.location.search read could not: a same-route
 * push (the sidebar linking to /?feed=following from the feed itself) updates
 * these params without remounting anything.
 */
const SearchParamReader = ({ name, onValue }: SearchParamReaderProps) => {
  const searchParams = useSearchParams()
  const value = searchParams.get(name) ?? ''

  useEffect(() => {
    onValue(value)
    // onValue is expected to be stable (useCallback) or tolerant of re-runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  return null
}

export default SearchParamReader

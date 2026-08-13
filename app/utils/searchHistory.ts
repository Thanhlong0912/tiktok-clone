/**
 * Recent searches, stored per browser.
 *
 * Deliberately local-only: a search history is the kind of thing people expect
 * to be able to clear, and keeping it off the server means there is nothing to
 * leak and nothing to moderate. If it ever needs to sync across devices it
 * wants its own table and an explicit opt-in, not a silent upgrade.
 */

const STORAGE_KEY = 'tt-recent-searches'
const MAX_ENTRIES = 8

const read = (): string[] => {
  if (typeof window === 'undefined') return []

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []

    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []

    return parsed.filter((entry) => typeof entry === 'string' && entry.length > 0).slice(0, MAX_ENTRIES)
  } catch {
    return []
  }
}

const write = (entries: string[]): string[] => {
  if (typeof window === 'undefined') return entries

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // Private mode or a full quota. The list is a convenience, not state we
    // can fail a search over.
  }

  return entries
}

export function getRecentSearches(): string[] {
  return read()
}

/** Most recent first, case-insensitively deduped, capped at MAX_ENTRIES. */
export function addRecentSearch(term: string): string[] {
  const clean = term.trim().slice(0, 80)
  if (!clean) return read()

  const lower = clean.toLowerCase()
  const rest = read().filter((entry) => entry.toLowerCase() !== lower)

  return write([clean].concat(rest).slice(0, MAX_ENTRIES))
}

export function removeRecentSearch(term: string): string[] {
  const lower = term.trim().toLowerCase()
  return write(read().filter((entry) => entry.toLowerCase() !== lower))
}

export function clearRecentSearches(): string[] {
  return write([])
}

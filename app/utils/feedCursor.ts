/**
 * Cursor for the ranked For You feed.
 *
 * A ranked feed cannot be paginated by score alone: scores move while the user
 * scrolls, so a post whose score rose would repeat on the next page and one
 * whose score fell would be skipped forever. Correctness therefore comes from
 * `feed_seen`, which get_feed writes server-side in the same statement that
 * selects a page. The score/id pair carried here is only a monotonicity guard
 * -- it keeps page N+1 from opening above the last row of page N.
 *
 * `score` is kept as the EXACT decimal STRING the server sent. get_feed rounds
 * to 9 decimal places for this reason: parsing to a JS number and re-printing
 * it would change the value, and the server compares (score, id) as a numeric
 * tuple. Never parseFloat it.
 */

export const FEED_CURSOR_VERSION = 1

export interface FeedCursor {
  v: number
  /** Feed session; one per mount, re-minted on pull-to-refresh. */
  s: string
  /** Page index. Diagnostics only -- the server ignores it. */
  p: number
  /** Last row's score, verbatim. */
  sc: string
  /** Last row's post id. */
  id: string
  /** Session start, ISO. Used to expire a cursor left open overnight. */
  t: string
}

/** Shape of what get_feed hands back, narrowed to what the cursor needs. */
export interface CursorSource {
  id: string
  score: string | number | null
}

export function createFeedSession(): string {
  // randomUUID is unavailable on http:// origins in some browsers, and this
  // value only has to be unique per client, not unguessable.
  const cryptoRef = typeof globalThis !== 'undefined' ? (globalThis as any).crypto : undefined
  if (cryptoRef && typeof cryptoRef.randomUUID === 'function') {
    return cryptoRef.randomUUID()
  }

  const hex = '0123456789abcdef'
  let out = ''
  for (let i = 0; i < 36; i += 1) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      out += '-'
    } else if (i === 14) {
      out += '4'
    } else {
      out += hex[Math.floor(Math.random() * 16)]
    }
  }
  return out
}

/**
 * Builds the cursor for the next page from the last row of this one.
 * Returns null when the page was empty, which callers treat as "end of feed".
 */
export function nextFeedCursor(
  previous: FeedCursor | null,
  session: string,
  page: CursorSource[],
  startedAt: string
): FeedCursor | null {
  if (page.length < 1) return null

  const last = page[page.length - 1]
  if (!last || !last.id) return null

  return {
    v: FEED_CURSOR_VERSION,
    s: session,
    p: (previous ? previous.p : 0) + 1,
    sc: last.score === null || last.score === undefined ? '' : String(last.score),
    id: last.id,
    t: startedAt,
  }
}

/** What get_feed expects as its p_cursor jsonb argument. */
export function toRpcCursor(cursor: FeedCursor | null): Record<string, string> | null {
  if (!cursor) return null
  return { s: cursor.s, sc: cursor.sc, id: cursor.id }
}

export function encodeFeedCursor(cursor: FeedCursor): string {
  return JSON.stringify(cursor)
}

/**
 * Rejects anything it did not write: a different version, a malformed payload,
 * or a session older than maxAgeMs. Returning null makes the caller start a
 * fresh session, which is always safe.
 */
export function decodeFeedCursor(
  raw: string | null | undefined,
  now: number,
  maxAgeMs = 6 * 60 * 60 * 1000
): FeedCursor | null {
  if (!raw) return null

  let parsed: any
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (!parsed || typeof parsed !== 'object') return null
  if (parsed.v !== FEED_CURSOR_VERSION) return null
  if (typeof parsed.s !== 'string' || !parsed.s) return null
  if (typeof parsed.id !== 'string' || !parsed.id) return null
  if (typeof parsed.sc !== 'string') return null
  if (typeof parsed.t !== 'string') return null

  const started = Date.parse(parsed.t)
  if (isNaN(started) || now - started > maxAgeMs) return null

  return {
    v: FEED_CURSOR_VERSION,
    s: parsed.s,
    p: typeof parsed.p === 'number' ? parsed.p : 0,
    sc: parsed.sc,
    id: parsed.id,
    t: parsed.t,
  }
}

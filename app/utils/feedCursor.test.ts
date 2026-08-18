import { describe, expect, it } from 'vitest'
import {
  createFeedSession,
  decodeFeedCursor,
  encodeFeedCursor,
  nextFeedCursor,
  toChronoCursor,
  toRpcCursor,
  type FeedCursor,
} from './feedCursor'

const START = '2026-08-13T10:00:00.000Z'
const NOW = Date.parse('2026-08-13T10:05:00.000Z')

describe('nextFeedCursor', () => {
  it('returns null for an empty page so the caller can stop paginating', () => {
    expect(nextFeedCursor(null, 'sess', [], START)).toBeNull()
  })

  it('takes its position from the last row of the page', () => {
    const cursor = nextFeedCursor(
      null,
      'sess',
      [
        { id: 'a', score: '9.5', created_at: '2026-08-13T09:00:00.000Z' },
        { id: 'b', score: '4.25', created_at: '2026-08-13T08:00:00.000Z' },
      ],
      START
    )

    expect(cursor).toEqual({
      v: 1,
      s: 'sess',
      p: 1,
      sc: '4.25',
      ts: '2026-08-13T08:00:00.000Z',
      id: 'b',
      t: START,
    })
  })

  it('increments the page counter across calls', () => {
    const first = nextFeedCursor(null, 'sess', [{ id: 'a', score: '9' }], START)
    const second = nextFeedCursor(first, 'sess', [{ id: 'b', score: '8' }], START)

    expect(first?.p).toBe(1)
    expect(second?.p).toBe(2)
  })

  it('preserves the score verbatim rather than reformatting it', () => {
    // get_feed rounds to 9dp, so it really does send trailing zeros. Parsing
    // to a JS number and re-printing collapses "1.000000000" to "1", which
    // changes the numeric tuple the server compares against.
    const fromServer = '1.000000000'
    const cursor = nextFeedCursor(null, 'sess', [{ id: 'a', score: fromServer }], START)

    expect(cursor?.sc).toBe(fromServer)
    expect(String(Number(fromServer))).toBe('1')
  })

  it('handles a null score without producing the string "null"', () => {
    const cursor = nextFeedCursor(null, 'sess', [{ id: 'a', score: null }], START)
    expect(cursor?.sc).toBe('')
  })

  it('returns null when the last row has no id', () => {
    expect(nextFeedCursor(null, 'sess', [{ id: '', score: '1' }], START)).toBeNull()
  })

  it('carries created_at, which is what the chronological feeds key on', () => {
    // get_following_feed returns a constant 0 for score and keysets on
    // (created_at, id). Without ts the client sent the string "0" as the
    // timestamp, and the Following feed never got past its first page.
    const cursor = nextFeedCursor(
      null,
      'sess',
      [{ id: 'a', score: 0, created_at: '2026-08-13T09:30:00.000Z' }],
      START
    )

    expect(cursor?.ts).toBe('2026-08-13T09:30:00.000Z')
    expect(cursor?.sc).toBe('0')
  })

  it('leaves ts empty when the row has no created_at', () => {
    const cursor = nextFeedCursor(null, 'sess', [{ id: 'a', score: '1' }], START)
    expect(cursor?.ts).toBe('')
  })
})

describe('toChronoCursor', () => {
  it('sends the (created_at, id) keyset the chronological feeds read', () => {
    const cursor: FeedCursor = {
      v: 1, s: 'sess', p: 1, sc: '0', ts: '2026-08-13T09:00:00.000Z', id: 'abc', t: START,
    }

    expect(toChronoCursor(cursor)).toEqual({ ts: '2026-08-13T09:00:00.000Z', id: 'abc' })
  })

  it('maps a null cursor to null so the first page asks for no position', () => {
    expect(toChronoCursor(null)).toBeNull()
  })

  it('refuses to send an empty timestamp', () => {
    // Null means "first page", which is recoverable. An empty or non-timestamp
    // ts is a hard cast error inside the RPC.
    const cursor: FeedCursor = { v: 1, s: 'sess', p: 1, sc: '0', ts: '', id: 'abc', t: START }
    expect(toChronoCursor(cursor)).toBeNull()
  })
})

describe('toRpcCursor', () => {
  it('sends only the three fields get_feed reads', () => {
    const cursor: FeedCursor = { v: 1, s: 'sess', p: 3, sc: '2.5', ts: START, id: 'abc', t: START }
    expect(toRpcCursor(cursor)).toEqual({ s: 'sess', sc: '2.5', id: 'abc' })
  })

  it('maps a null cursor to null so the first page asks for no position', () => {
    expect(toRpcCursor(null)).toBeNull()
  })
})

describe('decodeFeedCursor', () => {
  const valid: FeedCursor = { v: 1, s: 'sess', p: 2, sc: '3.5', ts: START, id: 'abc', t: START }

  it('round-trips a cursor it wrote', () => {
    expect(decodeFeedCursor(encodeFeedCursor(valid), NOW)).toEqual(valid)
  })

  it('rejects a cursor from a different version', () => {
    const stale = JSON.stringify({ ...valid, v: 99 })
    expect(decodeFeedCursor(stale, NOW)).toBeNull()
  })

  it('rejects a session older than the max age', () => {
    const old = Date.parse('2026-08-14T10:00:00.000Z')
    expect(decodeFeedCursor(encodeFeedCursor(valid), old)).toBeNull()
  })

  it('accepts a session inside the max age', () => {
    const justInside = Date.parse(START) + 6 * 60 * 60 * 1000
    expect(decodeFeedCursor(encodeFeedCursor(valid), justInside)).not.toBeNull()
  })

  it.each([
    ['not json at all', 'not json'],
    ['null', 'null'],
    ['an array', '[]'],
    ['a missing session', JSON.stringify({ v: 1, p: 1, sc: '1', id: 'a', t: START })],
    ['a missing id', JSON.stringify({ v: 1, s: 's', p: 1, sc: '1', t: START })],
    ['a numeric score', JSON.stringify({ v: 1, s: 's', p: 1, sc: 1, id: 'a', t: START })],
    ['an unparseable timestamp', JSON.stringify({ ...valid, t: 'whenever' })],
  ])('returns null for %s', (_label, raw) => {
    expect(decodeFeedCursor(raw, NOW)).toBeNull()
  })

  it('returns null for empty input rather than throwing', () => {
    expect(decodeFeedCursor(null, NOW)).toBeNull()
    expect(decodeFeedCursor(undefined, NOW)).toBeNull()
    expect(decodeFeedCursor('', NOW)).toBeNull()
  })

  it('defaults a missing page counter instead of rejecting the cursor', () => {
    const raw = JSON.stringify({ v: 1, s: 's', sc: '1', id: 'a', t: START })
    expect(decodeFeedCursor(raw, NOW)?.p).toBe(0)
  })
})

describe('createFeedSession', () => {
  it('produces distinct uuid-shaped values', () => {
    const a = createFeedSession()
    const b = createFeedSession()

    expect(a).toMatch(/^[0-9a-f-]{36}$/)
    expect(a).not.toBe(b)
  })
})

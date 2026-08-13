import { describe, expect, it } from 'vitest'
import { WatchSession, type WatchFlush } from './watchSession'

/** Controllable clock + a recording sender, so no browser or DB is involved. */
function harness(overrides: { skipBelowMs?: number; maxSampleGapMs?: number } = {}) {
  let clock = 0
  const sent: WatchFlush[] = []

  const session = new WatchSession({
    now: () => clock,
    send: (flush) => sent.push(flush),
    ...overrides,
  })

  return {
    session,
    sent,
    advance: (ms: number) => {
      clock += ms
    },
  }
}

describe('WatchSession', () => {
  it('sends nothing for a post that was never played', () => {
    const { session, sent } = harness()

    session.start('a')
    session.flush()

    expect(sent).toEqual([])
  })

  it('accrues wall-clock time between samples', () => {
    const { session, sent, advance } = harness()

    session.start('a')
    advance(250)
    session.sample('a', { currentTime: 0.25, duration: 10 })
    advance(250)
    session.sample('a', { currentTime: 0.5, duration: 10 })
    session.flush()

    expect(sent).toHaveLength(1)
    expect(sent[0].watchMs).toBe(500)
    expect(sent[0].postId).toBe('a')
  })

  it('ignores a gap larger than maxSampleGapMs so a backgrounded tab banks nothing', () => {
    const { session, sent, advance } = harness()

    session.start('a')
    advance(250)
    session.sample('a', { currentTime: 0.25, duration: 10 })
    // Tab hidden for two minutes: the video was not playing.
    advance(120000)
    session.sample('a', { currentTime: 0.5, duration: 10 })
    session.flush()

    expect(sent[0].watchMs).toBe(250)
  })

  it('tracks the best completion reached, not the last one', () => {
    const { session, sent, advance } = harness()

    session.start('a')
    advance(100)
    session.sample('a', { currentTime: 9, duration: 10 })
    advance(100)
    // Viewer scrubs back to the start; the 90% they reached still counts.
    session.sample('a', { currentTime: 1, duration: 10 })
    session.flush()

    expect(sent[0].completion).toBeCloseTo(0.9, 5)
  })

  it('clamps completion to 0..1 when currentTime overruns duration', () => {
    const { session, sent, advance } = harness()

    session.start('a')
    advance(100)
    session.sample('a', { currentTime: 12, duration: 10 })
    session.flush()

    expect(sent[0].completion).toBe(1)
  })

  it('ignores completion while duration is still unknown', () => {
    const { session, sent, advance } = harness()

    session.start('a')
    advance(1000)
    session.sample('a', { currentTime: 1, duration: NaN })
    advance(1000)
    session.sample('a', { currentTime: 2, duration: 0 })
    session.flush()

    expect(sent[0].watchMs).toBe(2000)
    expect(sent[0].completion).toBe(0)
  })

  it('counts a loop when playback position jumps backwards', () => {
    const { session, sent, advance } = harness()

    session.start('a')
    advance(100)
    session.sample('a', { currentTime: 9.5, duration: 10 })
    advance(100)
    session.sample('a', { currentTime: 0.1, duration: 10 })
    advance(100)
    session.sample('a', { currentTime: 9.5, duration: 10 })
    advance(100)
    session.sample('a', { currentTime: 0.1, duration: 10 })
    session.flush()

    expect(sent[0].loops).toBe(2)
  })

  it('marks a short, low-completion view as a skip', () => {
    const { session, sent, advance } = harness()

    session.start('a')
    advance(400)
    session.sample('a', { currentTime: 0.4, duration: 30 })
    session.flush()

    expect(sent[0].skipped).toBe(true)
  })

  it('does not mark a short view as a skip when most of a short clip was seen', () => {
    const { session, sent, advance } = harness()

    session.start('a')
    advance(900)
    // A 1s clip watched almost fully: brief, but not a skip.
    session.sample('a', { currentTime: 0.9, duration: 1 })
    session.flush()

    expect(sent[0].skipped).toBe(false)
  })

  it('does not mark a long view as a skip', () => {
    const { session, sent, advance } = harness()

    session.start('a')
    for (let i = 0; i < 20; i += 1) {
      advance(250)
      session.sample('a', { currentTime: i * 0.25, duration: 30 })
    }
    session.flush()

    expect(sent[0].watchMs).toBe(5000)
    expect(sent[0].skipped).toBe(false)
  })

  it('treats reaching the end as full completion even without a final sample', () => {
    const { session, sent, advance } = harness()

    session.start('a')
    advance(500)
    session.sample('a', { currentTime: 4, duration: 10 })
    session.complete('a')
    session.flush()

    expect(sent[0].completion).toBe(1)
    expect(sent[0].loops).toBe(1)
  })

  it('flushes the previous post when a new one becomes active', () => {
    const { session, sent, advance } = harness()

    session.start('a')
    advance(3000)
    session.sample('a', { currentTime: 3, duration: 10 })
    session.start('b')

    expect(sent).toHaveLength(1)
    expect(sent[0].postId).toBe('a')
    expect(session.activePostId()).toBe('b')
  })

  it('is idempotent: a second flush sends nothing more', () => {
    const { session, sent, advance } = harness()

    session.start('a')
    advance(3000)
    session.sample('a', { currentTime: 3, duration: 10 })
    session.flush()
    session.flush()

    expect(sent).toHaveLength(1)
  })

  it('starting the same post again does not double-report it', () => {
    const { session, sent, advance } = harness()

    session.start('a')
    advance(3000)
    session.sample('a', { currentTime: 3, duration: 10 })
    session.start('a')

    expect(sent).toEqual([])
    expect(session.activePostId()).toBe('a')
  })

  it('ignores samples for a post that is not the active one', () => {
    const { session, sent, advance } = harness()

    session.start('a')
    advance(250)
    // A stale timeupdate from the post that just scrolled away.
    session.sample('stale', { currentTime: 5, duration: 10 })
    session.sample('a', { currentTime: 0.25, duration: 10 })
    session.flush()

    expect(sent[0].watchMs).toBe(250)
  })

  it('rounds watchMs to an integer because record_watch takes an integer', () => {
    const { session, sent, advance } = harness()

    session.start('a')
    advance(1)
    session.sample('a', { currentTime: 0.1, duration: 10 })
    advance(1)
    session.sample('a', { currentTime: 0.2, duration: 10 })
    session.flush()

    expect(Number.isInteger(sent[0].watchMs)).toBe(true)
  })
})

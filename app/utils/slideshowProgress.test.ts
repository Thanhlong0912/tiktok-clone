import { describe, expect, it } from 'vitest'
import { slideshowProgress } from './slideshowProgress'
import { IMAGE_SLIDE_DURATION_MS } from './postMedia'
import { WatchSession, type WatchFlush } from './watchSession'

describe('slideshowProgress', () => {
  it('spans one full pass over every slide', () => {
    // 3 slides at 3s each.
    expect(slideshowProgress(0, 3, 1)).toEqual({ currentTime: 0, duration: 9 })
    expect(slideshowProgress(4500, 3, 1).currentTime).toBe(4.5)
  })

  it('scales the cycle by playback speed, as the slideshow itself does', () => {
    expect(slideshowProgress(0, 4, 2).duration).toBe(6)
    expect(slideshowProgress(0, 4, 0.5).duration).toBe(24)
  })

  it('wraps at the end of a cycle so a repeat reads as a loop', () => {
    const { duration } = slideshowProgress(0, 2, 1)
    expect(duration).toBe(6)
    // One full cycle plus a second.
    expect(slideshowProgress(7000, 2, 1).currentTime).toBe(1)
  })

  it('reports nothing for a post with no slides', () => {
    expect(slideshowProgress(1000, 0, 1)).toEqual({ currentTime: 0, duration: 0 })
  })

  it('treats a zero or negative speed as normal rate', () => {
    const normal = slideshowProgress(1000, 3, 1)
    expect(slideshowProgress(1000, 3, 0)).toEqual(normal)
    expect(slideshowProgress(1000, 3, -2)).toEqual(normal)
  })

  it('never returns a negative or NaN position', () => {
    expect(slideshowProgress(-500, 3, 1).currentTime).toBe(0)
    expect(slideshowProgress(Number.NaN, 3, 1).currentTime).toBe(0)
  })

  it('uses the same slide duration the slideshow renders with', () => {
    expect(slideshowProgress(0, 1, 1).duration).toBe(IMAGE_SLIDE_DURATION_MS / 1000)
  })
})

/**
 * The end-to-end point of the module: a photo post must now produce a flush,
 * where before it produced none at all.
 */
describe('a sampled slideshow reaches WatchSession', () => {
  const run = (sampleEveryMs: number, forMs: number): WatchFlush | null => {
    let now = 0
    let flushed: WatchFlush | null = null

    const session = new WatchSession({
      now: () => now,
      send: (flush) => {
        flushed = flush
      },
    })

    session.start('post-1')
    for (let elapsed = sampleEveryMs; elapsed <= forMs; elapsed += sampleEveryMs) {
      now = elapsed
      session.sample('post-1', slideshowProgress(elapsed, 3, 1))
    }
    session.flush()

    return flushed
  }

  it('accrues watch time at the sampler interval the hook uses', () => {
    const flush = run(500, 4000)

    expect(flush).not.toBeNull()
    expect(flush!.watchMs).toBe(4000)
    expect(flush!.skipped).toBe(false)
    // 4s into a 9s cycle.
    expect(flush!.completion).toBeCloseTo(4 / 9, 2)
  })

  it('accrues NOTHING if sampled slower than the max gap, which is why the interval is 500ms', () => {
    // WatchSession ignores gaps over 1500ms so a backgrounded tab cannot bank
    // wall-clock time. Sampling once per 3s slide change would have hit that
    // rule on every sample and recorded a permanent zero.
    const flush = run(3000, 9000)

    expect(flush!.watchMs).toBe(0)
  })

  it('counts a loop when the cycle wraps', () => {
    const flush = run(500, 12_000)
    expect(flush!.loops).toBeGreaterThanOrEqual(1)
  })
})

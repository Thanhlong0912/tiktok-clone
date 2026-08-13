import { describe, expect, it } from 'vitest'
import {
  defaultPosterTime,
  pickPosterMimeType,
  POSTER_MAX_EDGE,
  posterDimensions,
} from './posterFrame'

describe('posterDimensions', () => {
  it('leaves an already-small frame alone rather than upscaling it', () => {
    expect(posterDimensions(320, 480)).toEqual({ width: 320, height: 480 })
  })

  it('scales a portrait phone video down by its longest edge', () => {
    expect(posterDimensions(1080, 1920)).toEqual({ width: 405, height: 720 })
  })

  it('scales a landscape video by its longest edge too', () => {
    expect(posterDimensions(1920, 1080)).toEqual({ width: 720, height: 405 })
  })

  it('never exceeds the max edge', () => {
    const cases: Array<[number, number]> = [
      [4000, 2250],
      [2250, 4000],
      [8000, 8000],
      [721, 100],
    ]

    cases.forEach(([w, h]) => {
      const size = posterDimensions(w, h)
      expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(POSTER_MAX_EDGE)
    })
  })

  it('preserves aspect ratio within a pixel of rounding', () => {
    const size = posterDimensions(1080, 1920)
    expect(Math.abs(size.width / size.height - 1080 / 1920)).toBeLessThan(0.01)
  })

  it('never rounds a very thin frame down to zero', () => {
    const size = posterDimensions(4000, 3)
    expect(size.width).toBeGreaterThan(0)
    expect(size.height).toBeGreaterThan(0)
  })

  it('returns zeroes for dimensions the browser could not determine', () => {
    expect(posterDimensions(0, 0)).toEqual({ width: 0, height: 0 })
    expect(posterDimensions(NaN, 100)).toEqual({ width: 0, height: 0 })
    expect(posterDimensions(-10, 100)).toEqual({ width: 0, height: 0 })
  })

  it('honours a custom max edge', () => {
    expect(posterDimensions(1000, 500, 100)).toEqual({ width: 100, height: 50 })
  })
})

describe('defaultPosterTime', () => {
  it('takes the frame 1s in for a normal clip, skipping the opening frame', () => {
    expect(defaultPosterTime(30)).toBe(1)
  })

  it('scales back for a short clip so it never seeks past the end', () => {
    expect(defaultPosterTime(5)).toBeCloseTo(0.5, 5)
  })

  it('uses the midpoint of a sub-second clip', () => {
    expect(defaultPosterTime(0.8)).toBeCloseTo(0.4, 5)
  })

  it('returns 0 when duration is unknown', () => {
    expect(defaultPosterTime(NaN)).toBe(0)
    expect(defaultPosterTime(0)).toBe(0)
    expect(defaultPosterTime(Infinity)).toBe(0)
  })

  it('always stays inside the clip', () => {
    const durations = [0.2, 0.9, 1, 2, 10, 600]
    durations.forEach((duration) => {
      expect(defaultPosterTime(duration)).toBeLessThanOrEqual(duration)
    })
  })
})

describe('pickPosterMimeType', () => {
  it('prefers webp', () => {
    expect(pickPosterMimeType(false)).toBe('image/webp')
  })

  it('falls back to jpeg where the canvas cannot encode webp', () => {
    expect(pickPosterMimeType(true)).toBe('image/jpeg')
  })
})

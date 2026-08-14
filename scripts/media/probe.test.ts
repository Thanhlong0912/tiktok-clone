import { describe, expect, it } from 'vitest'
import {
    pickSharpest,
    posterCandidateTimes,
    POSTER_CANDIDATE_FRACTIONS,
    posterTimeSeconds,
} from './probe'

describe('posterTimeSeconds', () => {
    it('takes a tenth in, matching the browser upload path', () => {
        expect(posterTimeSeconds(20000)).toBe(1)
        expect(posterTimeSeconds(5000)).toBeCloseTo(0.5)
    })

    it('halves a sub-second clip rather than seeking past its end', () => {
        expect(posterTimeSeconds(800)).toBeCloseTo(0.4)
    })

    it('returns 0 for an unreadable duration instead of NaN', () => {
        expect(posterTimeSeconds(0)).toBe(0)
        expect(posterTimeSeconds(Number.NaN)).toBe(0)
    })
})

describe('posterCandidateTimes', () => {
    it('spreads candidates across the clip', () => {
        expect(posterCandidateTimes(20000)).toEqual(
            POSTER_CANDIDATE_FRACTIONS.map((fraction) => 20 * fraction)
        )
    })

    it('never seeks past the end of a short clip', () => {
        for (const at of posterCandidateTimes(2000)) {
            expect(at).toBeLessThanOrEqual(2 - 0.2)
        }
    })

    it('collapses candidates that clamp onto the same instant', () => {
        const times = posterCandidateTimes(1500)
        expect(new Set(times).size).toBe(times.length)
    })

    it('falls back to a single frame for a sub-second clip', () => {
        expect(posterCandidateTimes(800)).toEqual([0.4])
    })

    it('returns a usable time even when the duration is unreadable', () => {
        expect(posterCandidateTimes(0)).toEqual([0])
    })
})

describe('pickSharpest', () => {
    it('keeps the frame with the most encoded detail', () => {
        const blurred = Buffer.alloc(100)
        const sharp = Buffer.alloc(400)

        expect(pickSharpest([blurred, sharp, Buffer.alloc(250)])).toBe(sharp)
    })

    it('keeps the first frame when every candidate ties', () => {
        const first = Buffer.alloc(100)
        expect(pickSharpest([first, Buffer.alloc(100)])).toBe(first)
    })

    it('refuses an empty candidate list rather than returning undefined', () => {
        expect(() => pickSharpest([])).toThrow(/no frames/)
    })
})

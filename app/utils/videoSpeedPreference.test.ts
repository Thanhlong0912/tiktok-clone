import { describe, expect, it } from 'vitest'
import { DEFAULT_VIDEO_SPEED, normalizeSpeed, PLAYBACK_SPEEDS } from './videoSpeedPreference'

describe('normalizeSpeed', () => {
    it('accepts every rate the menu offers', () => {
        for (const speed of PLAYBACK_SPEEDS) {
            expect(normalizeSpeed(speed)).toBe(speed)
        }
    })

    it('parses the string localStorage hands back', () => {
        expect(normalizeSpeed('1.5')).toBe(1.5)
        expect(normalizeSpeed('0.75')).toBe(0.75)
    })

    it('rejects a rate that is not on the menu', () => {
        // Otherwise the playing rate and the highlighted pill disagree.
        expect(normalizeSpeed(1.1)).toBe(DEFAULT_VIDEO_SPEED)
        expect(normalizeSpeed(3)).toBe(DEFAULT_VIDEO_SPEED)
        expect(normalizeSpeed(0)).toBe(DEFAULT_VIDEO_SPEED)
        expect(normalizeSpeed(-1)).toBe(DEFAULT_VIDEO_SPEED)
    })

    it('falls back to 1 for junk', () => {
        expect(normalizeSpeed('fast')).toBe(DEFAULT_VIDEO_SPEED)
        expect(normalizeSpeed(null)).toBe(DEFAULT_VIDEO_SPEED)
        expect(normalizeSpeed(undefined)).toBe(DEFAULT_VIDEO_SPEED)
    })
})

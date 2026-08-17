import { describe, expect, it } from 'vitest'
import { clampVolume, DEFAULT_VIDEO_VOLUME } from './videoVolumePreference'

describe('clampVolume', () => {
    it('keeps a level inside the range', () => {
        expect(clampVolume(0.35)).toBe(0.35)
        expect(clampVolume(0)).toBe(0)
        expect(clampVolume(1)).toBe(1)
    })

    it('parses the string localStorage hands back', () => {
        expect(clampVolume('0.5')).toBe(0.5)
    })

    it('clamps out-of-range values instead of passing them to HTMLMediaElement', () => {
        // Assigning volume > 1 throws an IndexSizeError in the browser.
        expect(clampVolume(4)).toBe(1)
        expect(clampVolume(-2)).toBe(0)
    })

    it('falls back to the default for junk', () => {
        expect(clampVolume('loud')).toBe(DEFAULT_VIDEO_VOLUME)
        expect(clampVolume(null)).toBe(DEFAULT_VIDEO_VOLUME)
        expect(clampVolume(undefined)).toBe(DEFAULT_VIDEO_VOLUME)
        expect(clampVolume(Number.NaN)).toBe(DEFAULT_VIDEO_VOLUME)
        expect(clampVolume(Number.POSITIVE_INFINITY)).toBe(DEFAULT_VIDEO_VOLUME)
    })
})

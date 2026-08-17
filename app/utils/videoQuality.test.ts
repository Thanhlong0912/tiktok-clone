import { describe, expect, it } from 'vitest'
import { resolutionLabel } from './videoQuality'

describe('resolutionLabel', () => {
    it('names a portrait upload by its short side', () => {
        // The whole point: 1080x1920 is "1080P", not "1920P".
        expect(resolutionLabel(1080, 1920)).toBe('1080P')
    })

    it('names a landscape upload by its short side too', () => {
        expect(resolutionLabel(1920, 1080)).toBe('1080P')
    })

    it('reports the rung below an off-standard size', () => {
        expect(resolutionLabel(900, 1600)).toBe('720P')
    })

    it('handles the rungs exactly', () => {
        expect(resolutionLabel(720, 1280)).toBe('720P')
        expect(resolutionLabel(2160, 3840)).toBe('2160P')
    })

    it('falls back to the raw short side below the lowest rung', () => {
        expect(resolutionLabel(120, 160)).toBe('120P')
    })

    it('returns null when the post has no stored dimensions', () => {
        expect(resolutionLabel(null, null)).toBeNull()
        expect(resolutionLabel(undefined, undefined)).toBeNull()
        expect(resolutionLabel(0, 1920)).toBeNull()
        expect(resolutionLabel(-1080, 1920)).toBeNull()
    })
})

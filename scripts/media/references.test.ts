import { describe, expect, it } from 'vitest'
import { buildReferencedKeys } from './references'

describe('buildReferencedKeys', () => {
    it('collects bare video ids', () => {
        const referenced = buildReferencedKeys(
            [{ video_url: 'video1' }],
            [],
            'placeholder-avatar.png'
        )

        expect(referenced.has('video1')).toBe(true)
    })

    it('expands encoded image posts into every constituent file', () => {
        const referenced = buildReferencedKeys(
            [{ video_url: 'images:img1,img2|audio:aud1' }],
            [],
            'placeholder-avatar.png'
        )

        expect(referenced.has('img1')).toBe(true)
        expect(referenced.has('img2')).toBe(true)
        expect(referenced.has('aud1')).toBe(true)
        expect(referenced.has('images:img1,img2|audio:aud1')).toBe(false)
    })

    it('expands image posts that have no audio track', () => {
        const referenced = buildReferencedKeys(
            [{ video_url: 'images:img1,img2' }],
            [],
            'placeholder-avatar.png'
        )

        expect(referenced.has('img1')).toBe(true)
        expect(referenced.has('img2')).toBe(true)
    })

    it('includes profile images and the placeholder avatar', () => {
        const referenced = buildReferencedKeys(
            [{ video_url: 'video1' }],
            [{ image: 'avatar1' }],
            'placeholder-avatar.png'
        )

        expect(referenced.has('avatar1')).toBe(true)
        expect(referenced.has('placeholder-avatar.png')).toBe(true)
    })

    it('tolerates null media values', () => {
        const referenced = buildReferencedKeys(
            [{ video_url: null }],
            [{ image: null }],
            'placeholder-avatar.png'
        )

        expect(referenced.has('placeholder-avatar.png')).toBe(true)
        expect(referenced.size).toBe(1)
    })

    it('refuses to build a set from zero rows', () => {
        expect(() => buildReferencedKeys([], [], 'placeholder-avatar.png')).toThrow(
            /returned no rows/
        )
    })
})

import { describe, expect, it } from 'vitest'
import { buildPublicUrl } from './publicUrl'

describe('buildPublicUrl', () => {
    const base = 'https://abcdefghijkl.supabase.co/storage/v1/object/public/media'

    it('joins the base and the key', () => {
        expect(buildPublicUrl(base, 'abc123')).toBe(`${base}/abc123`)
    })

    it('returns an empty string for a missing key', () => {
        expect(buildPublicUrl(base, '')).toBe('')
    })

    it('returns an empty string for a missing base', () => {
        expect(buildPublicUrl('', 'abc123')).toBe('')
    })

    it('encodes characters that are unsafe in a url path', () => {
        expect(buildPublicUrl(base, 'a b#c')).toBe(`${base}/a%20b%23c`)
    })

    // Uploads are foldered (video/, image/, music/, avatar/), so a key
    // separator must stay a separator. encodeURIComponent on the whole key
    // would turn it into %2F and break every rendered image and video.
    it('keeps folder separators in a prefixed key', () => {
        expect(buildPublicUrl(base, 'video/abc123')).toBe(`${base}/video/abc123`)
    })

    it('still encodes unsafe characters inside a prefixed key', () => {
        expect(buildPublicUrl(base, 'image/a b#c')).toBe(`${base}/image/a%20b%23c`)
    })

    it('leaves an unprefixed legacy key working', () => {
        expect(buildPublicUrl(base, 'hb8q1ftl44')).toBe(`${base}/hb8q1ftl44`)
    })
})

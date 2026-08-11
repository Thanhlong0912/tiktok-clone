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
})

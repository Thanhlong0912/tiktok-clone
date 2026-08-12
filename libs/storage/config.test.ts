import { afterEach, describe, expect, it } from 'vitest'
import { getProjectRef, getRegion, getS3Endpoint, getPublicBaseUrl } from './config'

describe('getProjectRef', () => {
    it('takes the first host label of a hosted project url', () => {
        expect(getProjectRef('https://abcdefghijkl.supabase.co')).toBe('abcdefghijkl')
    })

    it('ignores paths and trailing slashes', () => {
        expect(getProjectRef('https://abcdefghijkl.supabase.co/')).toBe('abcdefghijkl')
    })

    it('throws a clear error for a host that is not a hosted supabase project', () => {
        expect(() => getProjectRef('http://127.0.0.1:54321')).toThrow(/hosted Supabase project/)
    })

    it('throws the same crafted error for a value that is not a url at all', () => {
        expect(() => getProjectRef('your-project.supabase.co')).toThrow(/hosted Supabase project/)
        expect(() => getProjectRef('')).toThrow(/hosted Supabase project/)
    })
})

describe('getS3Endpoint', () => {
    it('uses the direct storage hostname', () => {
        expect(getS3Endpoint('https://abcdefghijkl.supabase.co')).toBe(
            'https://abcdefghijkl.storage.supabase.co/storage/v1/s3'
        )
    })
})

describe('getPublicBaseUrl', () => {
    it('defaults to the supabase public object path', () => {
        expect(getPublicBaseUrl('https://abcdefghijkl.supabase.co', 'media')).toBe(
            'https://abcdefghijkl.supabase.co/storage/v1/object/public/media'
        )
    })

    it('prefers an override and strips trailing slashes', () => {
        expect(getPublicBaseUrl('https://abcdefghijkl.supabase.co', 'media', 'https://cdn.example.com/m/')).toBe(
            'https://cdn.example.com/m'
        )
    })

    it('ignores an empty override', () => {
        expect(getPublicBaseUrl('https://abcdefghijkl.supabase.co', 'media', '')).toBe(
            'https://abcdefghijkl.supabase.co/storage/v1/object/public/media'
        )
    })
})

describe('getRegion', () => {
    const original = process.env.NEXT_PUBLIC_SUPABASE_REGION

    afterEach(() => {
        // Restored so these tests do not depend on, or leak into, the order
        // the rest of the suite runs in.
        if (original === undefined) {
            delete process.env.NEXT_PUBLIC_SUPABASE_REGION
        } else {
            process.env.NEXT_PUBLIC_SUPABASE_REGION = original
        }
    })

    it('returns the configured region', () => {
        process.env.NEXT_PUBLIC_SUPABASE_REGION = 'eu-central-1'

        expect(getRegion()).toBe('eu-central-1')
    })

    it('throws a setup hint when the region is unset', () => {
        delete process.env.NEXT_PUBLIC_SUPABASE_REGION

        expect(() => getRegion()).toThrow(/Missing NEXT_PUBLIC_SUPABASE_REGION/)
    })

    it('treats an explicitly empty region as unset', () => {
        process.env.NEXT_PUBLIC_SUPABASE_REGION = ''

        expect(() => getRegion()).toThrow(/Missing NEXT_PUBLIC_SUPABASE_REGION/)
    })
})

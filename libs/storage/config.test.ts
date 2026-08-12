import { afterEach, describe, expect, it } from 'vitest'
import {
    getProjectRef,
    getRegion,
    getS3Endpoint,
    getPublicBaseUrl,
    getS3SecretAccessKey,
} from './config'

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

describe('getS3SecretAccessKey', () => {
    const original = process.env.NEXT_PUBLIC_SUPABASE_LEGACY_ANON_KEY

    afterEach(() => {
        if (original === undefined) {
            delete process.env.NEXT_PUBLIC_SUPABASE_LEGACY_ANON_KEY
        } else {
            process.env.NEXT_PUBLIC_SUPABASE_LEGACY_ANON_KEY = original
        }
    })

    it('returns a legacy anon jwt', () => {
        process.env.NEXT_PUBLIC_SUPABASE_LEGACY_ANON_KEY = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.sig'

        expect(getS3SecretAccessKey()).toBe('eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.sig')
    })

    it('throws a setup hint when unset', () => {
        delete process.env.NEXT_PUBLIC_SUPABASE_LEGACY_ANON_KEY

        expect(getS3SecretAccessKey).toThrow(/Missing NEXT_PUBLIC_SUPABASE_LEGACY_ANON_KEY/)
    })

    it('treats an explicitly empty value as unset', () => {
        process.env.NEXT_PUBLIC_SUPABASE_LEGACY_ANON_KEY = ''

        expect(getS3SecretAccessKey).toThrow(/Missing NEXT_PUBLIC_SUPABASE_LEGACY_ANON_KEY/)
    })

    // The whole reason this setting exists. Signing with a publishable key
    // fails inside the AWS SDK as an opaque signature mismatch, on every
    // request regardless of file size, with nothing pointing at the key.
    it('rejects a publishable key by name', () => {
        process.env.NEXT_PUBLIC_SUPABASE_LEGACY_ANON_KEY = 'sb_publishable_abc123'

        expect(getS3SecretAccessKey).toThrow(/publishable key/)
        expect(getS3SecretAccessKey).toThrow(/legacy/)
    })

    it('refuses a secret key outright', () => {
        process.env.NEXT_PUBLIC_SUPABASE_LEGACY_ANON_KEY = 'sb_secret_abc123'

        expect(getS3SecretAccessKey).toThrow(/secret key/)
    })

    it('rejects anything that is not a jwt', () => {
        process.env.NEXT_PUBLIC_SUPABASE_LEGACY_ANON_KEY = 'not-a-key'

        expect(getS3SecretAccessKey).toThrow(/legacy anon key/)
    })
})

import { describe, expect, it, vi } from 'vitest'
import { createSessionCredentialProvider, decodeJwtExpiry } from './credentials'

const makeJwt = (payload: object): string => {
    const encode = (value: object) =>
        Buffer.from(JSON.stringify(value)).toString('base64url')
    return `${encode({ alg: 'HS256' })}.${encode(payload)}.signature`
}

describe('decodeJwtExpiry', () => {
    it('reads the exp claim as milliseconds', () => {
        const token = makeJwt({ exp: 1_700_000_000 })
        expect(decodeJwtExpiry(token)).toEqual(new Date(1_700_000_000_000))
    })

    it('returns undefined when there is no exp claim', () => {
        expect(decodeJwtExpiry(makeJwt({ sub: 'user' }))).toBeUndefined()
    })

    it('returns undefined for a malformed token instead of throwing', () => {
        expect(decodeJwtExpiry('not-a-jwt')).toBeUndefined()
        expect(decodeJwtExpiry('a.!!!not-base64!!!.c')).toBeUndefined()
    })
})

describe('createSessionCredentialProvider', () => {
    const session = (accessToken: string) => ({
        data: { session: { access_token: accessToken } },
    })

    it('maps a session onto s3 session-token credentials', async () => {
        const token = makeJwt({ exp: 1_700_000_000 })
        const provider = createSessionCredentialProvider({
            projectRef: 'abcdefghijkl',
            anonKey: 'anon-key',
            getSession: async () => session(token),
        })

        await expect(provider()).resolves.toEqual({
            accessKeyId: 'abcdefghijkl',
            secretAccessKey: 'anon-key',
            sessionToken: token,
            expiration: new Date(1_700_000_000_000),
        })
    })

    it('re-reads the session on every call so refreshed tokens are picked up', async () => {
        const first = makeJwt({ exp: 1_700_000_000 })
        const second = makeJwt({ exp: 1_700_003_600 })
        const getSession = vi.fn()
            .mockResolvedValueOnce(session(first))
            .mockResolvedValueOnce(session(second))

        const provider = createSessionCredentialProvider({
            projectRef: 'abcdefghijkl',
            anonKey: 'anon-key',
            getSession,
        })

        expect((await provider()).sessionToken).toBe(first)
        expect((await provider()).sessionToken).toBe(second)
        expect(getSession).toHaveBeenCalledTimes(2)
    })

    it('throws the existing logged-out message when there is no session', async () => {
        const provider = createSessionCredentialProvider({
            projectRef: 'abcdefghijkl',
            anonKey: 'anon-key',
            getSession: async () => ({ data: { session: null } }),
        })

        await expect(provider()).rejects.toThrow('You must be logged in to upload files')
    })
})

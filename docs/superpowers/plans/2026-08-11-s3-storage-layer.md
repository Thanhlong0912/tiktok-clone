# S3 Storage Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the app's direct Supabase Storage calls with a provider-agnostic storage abstraction over Supabase's S3-compatible endpoint, and add tested tooling for finding orphaned bucket objects.

**Architecture:** A new `libs/storage/` module exposes a three-method `StorageAdapter` interface (`upload`, `remove`, `publicUrl`) implemented against the AWS SDK. Browser uploads authenticate with Supabase's session-token mode, which is RLS-enforced and needs no server route. Bulk copy operations are delegated to `rclone` via a documented runbook; only orphan detection, which must join bucket contents against database rows, gets custom code.

**Tech Stack:** TypeScript, Next.js 13 (App Router, client-side only — no API routes), `@aws-sdk/client-s3`, `@aws-sdk/lib-storage`, Vitest, `tsx`.

**Spec:** `docs/superpowers/specs/2026-08-11-s3-storage-design.md`

## Global Constraints

- **Prerequisite:** the "S3 connection" toggle must be enabled in the Supabase project's Storage settings. Nothing in this plan functions until it is on.
- S3 endpoint format: `https://<project-ref>.storage.supabase.co/storage/v1/s3`. The `.storage.` host is required — it is the direct storage hostname Supabase recommends for large uploads.
- Session-token credentials are: `accessKeyId` = project ref, `secretAccessKey` = anon key, `sessionToken` = user JWT. These are RLS-enforced and safe in the browser.
- S3 access keys bypass RLS and are **server-only**. They must never be exposed through a `NEXT_PUBLIC_` variable.
- Multipart part size: 8 MB. Queue size: 4.
- Orphan deletion defaults: report-only unless `--delete` is passed; `--min-age` defaults to 24 hours.
- The AWS SDK must be behind a dynamic `import()` so it stays out of routes that never upload.
- `useCreateBucketUrl`'s exported signature must not change — 14 files import it.
- Tests import from `vitest` explicitly rather than relying on globals, so no `tsconfig.json` changes are needed.
- **Known limitation:** project-ref derivation assumes a hosted `<ref>.supabase.co` URL. Local Supabase (`http://127.0.0.1:54321`) is not supported by this plan and will throw a clear error rather than silently produce a wrong ref.
- `tsconfig.json` sets `"target": "es5"` without `downlevelIteration`. Do not iterate a `Set` or `Map` directly (`for...of`, spread) — it will not compile. Arrays are fine. Use `.has()` / `.add()` / `.size` on sets, as every code block in this plan does.
- `tsconfig.json` has `"include": ["**/*.ts"]`, so `npx tsc --noEmit` typechecks test files and `vitest.config.ts` too. Both must compile cleanly, not just app code.

---

## File Structure

**Created:**
| File | Responsibility |
| --- | --- |
| `libs/storage/types.ts` | The `StorageAdapter` interface and `UploadOptions` type |
| `libs/storage/config.ts` | Derives project ref, S3 endpoint, and public base URL from env |
| `libs/storage/credentials.ts` | JWT expiry decoding and the async session-token credential provider |
| `libs/storage/s3Adapter.ts` | `StorageAdapter` implementation over the AWS SDK |
| `libs/storage/index.ts` | Constructs and exports the configured singleton |
| `scripts/media/references.ts` | Builds the referenced-key set from database rows |
| `scripts/media/planOrphans.ts` | Pure diff of bucket objects against referenced keys |
| `scripts/media/orphans.ts` | CLI entry point: lists the bucket, reads the DB, reports or deletes |
| `docs/media-operations.md` | rclone runbook for backup, sync, and migrate |
| `vitest.config.ts` | Vitest config with the `@/*` path alias |

**Modified:**
| File | Change |
| --- | --- |
| `app/hooks/useCreateBucketUrl.tsx` | Body delegates to `storage.publicUrl`; signature unchanged |
| `app/hooks/useCreatePost.tsx:2,19,58` | Swap to `storage.upload` / `storage.remove` |
| `app/hooks/useChangeUserImage.tsx:1,23,31` | Replace direct `supabase.storage` calls |
| `app/hooks/useDeletePostById.tsx:2,20` | Swap `deleteFiles` for `storage.remove` |
| `package.json` | Add dependencies and the `test` script |
| `.env.example` | Add region, optional media base URL, and server-only script vars |

**Deleted:**
| File | Reason |
| --- | --- |
| `libs/uploadWithProgress.ts` | Both exports subsumed by the adapter |

---

## Task 1: Test infrastructure and storage config

**Files:**
- Create: `vitest.config.ts`, `libs/storage/config.ts`, `libs/storage/config.test.ts`
- Modify: `package.json`, `.env.example`

**Interfaces:**
- Consumes: `SUPABASE_URL`, `BUCKET` from `libs/supabase.ts`
- Produces: `getProjectRef(url: string): string`, `getS3Endpoint(url: string): string`, `getPublicBaseUrl(supabaseUrl: string, bucket: string, override?: string): string`, `getRegion(): string`

- [ ] **Step 1: Install dependencies**

```bash
npm install @aws-sdk/client-s3 @aws-sdk/lib-storage
npm install -D vitest tsx
```

- [ ] **Step 2: Create the Vitest config**

Create `vitest.config.ts`:

```ts
import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
    resolve: {
        alias: { '@': path.resolve(__dirname, './') },
    },
    test: {
        environment: 'node',
        include: ['**/*.test.ts'],
        exclude: ['node_modules/**', '.next/**'],
    },
})
```

- [ ] **Step 3: Add the test script**

In `package.json`, add to `"scripts"`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Write the failing test**

Create `libs/storage/config.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { getProjectRef, getS3Endpoint, getPublicBaseUrl } from './config'

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
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npx vitest run libs/storage/config.test.ts`
Expected: FAIL — cannot resolve `./config`.

- [ ] **Step 6: Write the implementation**

Create `libs/storage/config.ts`:

```ts
export const getProjectRef = (supabaseUrl: string): string => {
    const { hostname } = new URL(supabaseUrl)

    if (!hostname.endsWith('.supabase.co')) {
        throw new Error(
            `Cannot derive a project ref from "${supabaseUrl}". ` +
            'The S3 storage layer requires a hosted Supabase project url of the ' +
            'form https://<project-ref>.supabase.co'
        )
    }

    return hostname.split('.')[0]
}

export const getS3Endpoint = (supabaseUrl: string): string => {
    return `https://${getProjectRef(supabaseUrl)}.storage.supabase.co/storage/v1/s3`
}

export const getPublicBaseUrl = (
    supabaseUrl: string,
    bucket: string,
    override?: string
): string => {
    if (override) {
        return override.replace(/\/+$/, '')
    }

    return `${supabaseUrl}/storage/v1/object/public/${bucket}`
}

export const getRegion = (): string => {
    const region = process.env.NEXT_PUBLIC_SUPABASE_REGION

    if (!region) {
        throw new Error(
            'Missing NEXT_PUBLIC_SUPABASE_REGION. Copy it from Supabase → ' +
            'Project settings → Storage → S3 connection.'
        )
    }

    return region
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run libs/storage/config.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 8: Update `.env.example`**

Append:

```bash
# Supabase → Project settings → Storage → S3 connection.
# The "S3 connection" toggle on that page must be enabled.
NEXT_PUBLIC_SUPABASE_REGION=us-east-1

# Optional. Overrides where public media urls are read from (e.g. a CDN).
# Defaults to <NEXT_PUBLIC_SUPABASE_URL>/storage/v1/object/public/<bucket>.
# NEXT_PUBLIC_MEDIA_BASE_URL=
```

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json vitest.config.ts libs/storage/config.ts libs/storage/config.test.ts .env.example
git commit -m "add vitest and storage config module"
```

---

## Task 2: Storage interface and public URLs

**Files:**
- Create: `libs/storage/types.ts`, `libs/storage/publicUrl.ts`, `libs/storage/publicUrl.test.ts`
- Modify: `app/hooks/useCreateBucketUrl.tsx`

**Interfaces:**
- Consumes: `getPublicBaseUrl` from Task 1
- Produces: `StorageAdapter` and `UploadOptions` types; `buildPublicUrl(baseUrl: string, key: string): string`

- [ ] **Step 1: Create the interface**

Create `libs/storage/types.ts`:

```ts
export type UploadOptions = {
    onProgress?: (percent: number) => void
    signal?: AbortSignal
}

export interface StorageAdapter {
    upload(key: string, file: File, options?: UploadOptions): Promise<void>
    remove(keys: string[]): Promise<void>
    publicUrl(key: string): string
}
```

- [ ] **Step 2: Write the failing test**

Create `libs/storage/publicUrl.test.ts`:

```ts
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
```

The empty-string returns preserve the current behavior of `createBucketUrl`, which returns `''` when anything is missing. Call sites feed the result straight into `src` attributes and rely on that.

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run libs/storage/publicUrl.test.ts`
Expected: FAIL — cannot resolve `./publicUrl`.

- [ ] **Step 4: Write the implementation**

Create `libs/storage/publicUrl.ts`:

```ts
export const buildPublicUrl = (baseUrl: string, key: string): string => {
    if (!baseUrl || !key) {
        return ''
    }

    return `${baseUrl}/${encodeURIComponent(key)}`
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run libs/storage/publicUrl.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 6: Rewire `useCreateBucketUrl`**

Replace the whole body of `app/hooks/useCreateBucketUrl.tsx`. The exported names and signature must stay identical — 14 files import this.

```tsx
import { getPublicBaseUrl } from '@/libs/storage/config'
import { buildPublicUrl } from '@/libs/storage/publicUrl'

export const createBucketUrl = (fileId: string) => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const bucket = process.env.NEXT_PUBLIC_SUPABASE_BUCKET

  if (!url || !bucket || !fileId) return ''

  return buildPublicUrl(
    getPublicBaseUrl(url, bucket, process.env.NEXT_PUBLIC_MEDIA_BASE_URL),
    fileId
  )
}

const useCreateBucketUrl = createBucketUrl

export default useCreateBucketUrl
```

- [ ] **Step 7: Verify the app still typechecks and builds**

Run: `npx tsc --noEmit && npm run build`
Expected: both succeed.

- [ ] **Step 8: Commit**

```bash
git add libs/storage/types.ts libs/storage/publicUrl.ts libs/storage/publicUrl.test.ts app/hooks/useCreateBucketUrl.tsx
git commit -m "add storage interface and route public urls through it"
```

---

## Task 3: Session-token credential provider

**Files:**
- Create: `libs/storage/credentials.ts`, `libs/storage/credentials.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces: `decodeJwtExpiry(token: string): Date | undefined`, `createSessionCredentialProvider(options: { projectRef: string; anonKey: string; getSession: GetSession }): () => Promise<AwsCredentialIdentity>`, and the `GetSession` type

**Why the expiration matters:** the AWS SDK caches credentials and only re-invokes the provider when they are near expiry. A Supabase JWT lives about an hour; a large video upload can outlive it. Returning `expiration` lets the SDK refresh mid-multipart. Omitting it produces `SignatureDoesNotMatch` an hour in, on the largest uploads only.

- [ ] **Step 1: Write the failing test**

Create `libs/storage/credentials.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run libs/storage/credentials.test.ts`
Expected: FAIL — cannot resolve `./credentials`.

- [ ] **Step 3: Write the implementation**

Create `libs/storage/credentials.ts`:

```ts
import type { AwsCredentialIdentity } from '@aws-sdk/types'

export type GetSession = () => Promise<{
    data: { session: { access_token: string } | null }
}>

export const decodeJwtExpiry = (token: string): Date | undefined => {
    const payload = token.split('.')[1]

    if (!payload) {
        return undefined
    }

    try {
        const decoded = JSON.parse(
            Buffer.from(payload, 'base64url').toString('utf8')
        )

        return typeof decoded.exp === 'number'
            ? new Date(decoded.exp * 1000)
            : undefined
    } catch {
        return undefined
    }
}

export const createSessionCredentialProvider = (options: {
    projectRef: string
    anonKey: string
    getSession: GetSession
}) => {
    return async (): Promise<AwsCredentialIdentity> => {
        const { data: { session } } = await options.getSession()

        if (!session) {
            throw new Error('You must be logged in to upload files')
        }

        return {
            accessKeyId: options.projectRef,
            secretAccessKey: options.anonKey,
            sessionToken: session.access_token,
            expiration: decodeJwtExpiry(session.access_token),
        }
    }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run libs/storage/credentials.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Replace `Buffer` with a browser-safe decoder**

`Buffer` does not exist in the browser. Next.js does not polyfill it in client components. Replace the `decodeJwtExpiry` body's decoding line with `atob`, which exists in both the browser and Node 16+:

```ts
        const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
        const decoded = JSON.parse(
            decodeURIComponent(
                atob(normalized)
                    .split('')
                    .map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`)
                    .join('')
            )
        )
```

The percent-encoding dance handles multi-byte UTF-8 in claims, which raw `atob` mangles.

- [ ] **Step 6: Run the test again to verify it still passes**

Run: `npx vitest run libs/storage/credentials.test.ts`
Expected: PASS — 6 tests. The `makeJwt` helper still uses `Buffer` because tests run in Node; only the implementation must be browser-safe.

- [ ] **Step 7: Commit**

```bash
git add libs/storage/credentials.ts libs/storage/credentials.test.ts
git commit -m "add session-token credential provider with jwt expiry"
```

---

## Task 4: S3 adapter

**Files:**
- Create: `libs/storage/s3Adapter.ts`, `libs/storage/s3Adapter.test.ts`, `libs/storage/index.ts`

**Interfaces:**
- Consumes: `StorageAdapter`, `UploadOptions` (Task 2); `buildPublicUrl` (Task 2); `getS3Endpoint`, `getPublicBaseUrl`, `getRegion`, `getProjectRef` (Task 1); `createSessionCredentialProvider` (Task 3)
- Produces: `createS3Adapter(options: S3AdapterOptions): StorageAdapter`, and a default `storage` singleton exported from `libs/storage/index.ts`

- [ ] **Step 1: Write the failing test**

Create `libs/storage/s3Adapter.test.ts`. The SDK loader is injected so the test never touches the network.

Note how progress events are emitted from inside the fake's `done()` rather than from the test body. The adapter `await`s the dynamic SDK import before constructing `Upload`, so the instance does not exist yet at the moment `adapter.upload()` is called — a test that reaches for `uploads[0]` synchronously gets `undefined`.

```ts
import { describe, expect, it, vi } from 'vitest'
import { createS3Adapter } from './s3Adapter'

type ProgressEvent = { loaded?: number; total?: number }

const makeAdapter = (overrides: {
    progressEvents?: ProgressEvent[]
    failWith?: Error
} = {}) => {
    const sent: any[] = []
    const uploads: any[] = []

    class FakeS3Client {
        constructor(public config: any) {}
        async send(command: any) {
            sent.push(command)
            return {}
        }
    }

    class FakeDeleteObjectsCommand {
        constructor(public input: any) {}
    }

    class FakeUpload {
        handlers: Record<string, (event: any) => void> = {}
        abort = vi.fn().mockResolvedValue(undefined)

        constructor(public params: any) {
            uploads.push(this)
        }

        on(event: string, handler: (event: any) => void) {
            this.handlers[event] = handler
        }

        async done() {
            for (const event of overrides.progressEvents ?? []) {
                this.handlers.httpUploadProgress?.(event)
            }
            if (overrides.failWith) {
                throw overrides.failWith
            }
            return {}
        }
    }

    const adapter = createS3Adapter({
        bucket: 'media',
        region: 'us-east-1',
        endpoint: 'https://ref.storage.supabase.co/storage/v1/s3',
        publicBaseUrl: 'https://ref.supabase.co/storage/v1/object/public/media',
        credentials: async () => ({ accessKeyId: 'a', secretAccessKey: 'b' }),
        loadSdk: async () => ({
            S3Client: FakeS3Client as any,
            DeleteObjectsCommand: FakeDeleteObjectsCommand as any,
            Upload: FakeUpload as any,
        }),
    })

    return { adapter, sent, uploads }
}

const file = (name = 'clip.mp4', type = 'video/mp4') =>
    new File([new Uint8Array([1, 2, 3])], name, { type })

describe('createS3Adapter.upload', () => {
    it('uploads to the configured bucket and key with the file content type', async () => {
        const { adapter, uploads } = makeAdapter()

        await adapter.upload('abc123', file())

        expect(uploads).toHaveLength(1)
        expect(uploads[0].params.params).toMatchObject({
            Bucket: 'media',
            Key: 'abc123',
            ContentType: 'video/mp4',
        })
    })

    it('uses 8mb parts and a queue size of 4', async () => {
        const { adapter, uploads } = makeAdapter()

        await adapter.upload('abc123', file())

        expect(uploads[0].params.partSize).toBe(8 * 1024 * 1024)
        expect(uploads[0].params.queueSize).toBe(4)
    })

    it('omits the content type when the file has none', async () => {
        const { adapter, uploads } = makeAdapter()

        await adapter.upload('abc123', file('blob', ''))

        expect(uploads[0].params.params.ContentType).toBeUndefined()
    })

    it('converts byte progress into a percentage', async () => {
        const onProgress = vi.fn()
        const { adapter } = makeAdapter({
            progressEvents: [
                { loaded: 25, total: 100 },
                { loaded: 50, total: 100 },
            ],
        })

        await adapter.upload('abc123', file(), { onProgress })

        expect(onProgress).toHaveBeenCalledWith(25)
        expect(onProgress).toHaveBeenCalledWith(50)
        expect(onProgress).toHaveBeenLastCalledWith(100)
    })

    it('ignores progress events with no total', async () => {
        const onProgress = vi.fn()
        const { adapter } = makeAdapter({ progressEvents: [{ loaded: 25 }] })

        await adapter.upload('abc123', file(), { onProgress })

        expect(onProgress).toHaveBeenCalledTimes(1)
        expect(onProgress).toHaveBeenCalledWith(100)
    })

    it('aborts the multipart upload when it fails, then rethrows', async () => {
        const { adapter, uploads } = makeAdapter({
            failWith: new Error('network down'),
        })

        await expect(adapter.upload('abc123', file())).rejects.toThrow('network down')
        expect(uploads[0].abort).toHaveBeenCalled()
    })
})

describe('createS3Adapter.remove', () => {
    it('deletes every key in one request', async () => {
        const { adapter, sent } = makeAdapter()

        await adapter.remove(['a', 'b'])

        expect(sent).toHaveLength(1)
        expect(sent[0].input).toMatchObject({
            Bucket: 'media',
            Delete: { Objects: [{ Key: 'a' }, { Key: 'b' }], Quiet: true },
        })
    })

    it('chunks batches larger than the s3 limit of 1000 keys', async () => {
        const { adapter, sent } = makeAdapter()

        await adapter.remove(Array.from({ length: 1001 }, (_, i) => `k${i}`))

        expect(sent).toHaveLength(2)
        expect(sent[0].input.Delete.Objects).toHaveLength(1000)
        expect(sent[1].input.Delete.Objects).toHaveLength(1)
    })

    it('does nothing for an empty list', async () => {
        const { adapter, sent } = makeAdapter()

        await adapter.remove([])

        expect(sent).toHaveLength(0)
    })
})

describe('createS3Adapter.publicUrl', () => {
    it('builds a url from the configured public base', async () => {
        const { adapter } = makeAdapter()

        expect(adapter.publicUrl('abc123')).toBe(
            'https://ref.supabase.co/storage/v1/object/public/media/abc123'
        )
    })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run libs/storage/s3Adapter.test.ts`
Expected: FAIL — cannot resolve `./s3Adapter`.

- [ ] **Step 3: Write the implementation**

Create `libs/storage/s3Adapter.ts`:

```ts
import type { AwsCredentialIdentity } from '@aws-sdk/types'
import { buildPublicUrl } from './publicUrl'
import type { StorageAdapter, UploadOptions } from './types'

const PART_SIZE = 8 * 1024 * 1024
const QUEUE_SIZE = 4
const DELETE_BATCH_LIMIT = 1000

type Sdk = {
    S3Client: typeof import('@aws-sdk/client-s3').S3Client
    DeleteObjectsCommand: typeof import('@aws-sdk/client-s3').DeleteObjectsCommand
    Upload: typeof import('@aws-sdk/lib-storage').Upload
}

export type S3AdapterOptions = {
    bucket: string
    region: string
    endpoint: string
    publicBaseUrl: string
    credentials: () => Promise<AwsCredentialIdentity>
    loadSdk?: () => Promise<Sdk>
}

// Loaded on demand so the SDK never reaches bundles for routes that
// only read media.
const loadSdkDefault = async (): Promise<Sdk> => {
    const [clientS3, libStorage] = await Promise.all([
        import('@aws-sdk/client-s3'),
        import('@aws-sdk/lib-storage'),
    ])

    return {
        S3Client: clientS3.S3Client,
        DeleteObjectsCommand: clientS3.DeleteObjectsCommand,
        Upload: libStorage.Upload,
    }
}

const chunk = <T,>(items: T[], size: number): T[][] => {
    const chunks: T[][] = []

    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size))
    }

    return chunks
}

export const createS3Adapter = (options: S3AdapterOptions): StorageAdapter => {
    const loadSdk = options.loadSdk ?? loadSdkDefault

    const createClient = async () => {
        const sdk = await loadSdk()

        const client = new sdk.S3Client({
            forcePathStyle: true,
            region: options.region,
            endpoint: options.endpoint,
            credentials: options.credentials,
        })

        return { sdk, client }
    }

    return {
        async upload(key: string, file: File, uploadOptions?: UploadOptions) {
            const { sdk, client } = await createClient()

            const upload = new sdk.Upload({
                client,
                params: {
                    Bucket: options.bucket,
                    Key: key,
                    Body: file,
                    ContentType: file.type || undefined,
                },
                partSize: PART_SIZE,
                queueSize: QUEUE_SIZE,
                leavePartsOnError: false,
            })

            upload.on('httpUploadProgress', (progress) => {
                if (!progress.total) return
                uploadOptions?.onProgress?.((progress.loaded ?? 0) / progress.total * 100)
            })

            uploadOptions?.signal?.addEventListener(
                'abort',
                () => { void upload.abort() },
                { once: true }
            )

            try {
                await upload.done()
                uploadOptions?.onProgress?.(100)
            } catch (error) {
                // Incomplete multipart uploads stay billable and are invisible
                // in object listings, so clean up before surfacing the error.
                await upload.abort().catch(() => {})
                throw error
            }
        },

        async remove(keys: string[]) {
            if (keys.length === 0) return

            const { sdk, client } = await createClient()

            for (const batch of chunk(keys, DELETE_BATCH_LIMIT)) {
                await client.send(
                    new sdk.DeleteObjectsCommand({
                        Bucket: options.bucket,
                        Delete: {
                            Objects: batch.map((Key) => ({ Key })),
                            Quiet: true,
                        },
                    })
                )
            }
        },

        publicUrl(key: string) {
            return buildPublicUrl(options.publicBaseUrl, key)
        },
    }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run libs/storage/s3Adapter.test.ts`
Expected: PASS — 11 tests.

- [ ] **Step 5: Create the configured singleton**

Create `libs/storage/index.ts`:

```ts
import { BUCKET, SUPABASE_ANON_KEY, SUPABASE_URL, supabase } from '@/libs/supabase'
import { getProjectRef, getPublicBaseUrl, getRegion, getS3Endpoint } from './config'
import { createSessionCredentialProvider } from './credentials'
import { createS3Adapter } from './s3Adapter'
import type { StorageAdapter } from './types'

export type { StorageAdapter, UploadOptions } from './types'

export const storage: StorageAdapter = createS3Adapter({
    bucket: BUCKET,
    region: getRegion(),
    endpoint: getS3Endpoint(SUPABASE_URL),
    publicBaseUrl: getPublicBaseUrl(
        SUPABASE_URL,
        BUCKET,
        process.env.NEXT_PUBLIC_MEDIA_BASE_URL
    ),
    credentials: createSessionCredentialProvider({
        projectRef: getProjectRef(SUPABASE_URL),
        anonKey: SUPABASE_ANON_KEY,
        getSession: () => supabase.auth.getSession(),
    }),
})
```

- [ ] **Step 6: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: success.

- [ ] **Step 7: Commit**

```bash
git add libs/storage/s3Adapter.ts libs/storage/s3Adapter.test.ts libs/storage/index.ts
git commit -m "add s3 storage adapter"
```

---

## Task 5: Rewire the app's upload and delete call sites

**Files:**
- Modify: `app/hooks/useCreatePost.tsx`, `app/hooks/useChangeUserImage.tsx`, `app/hooks/useDeletePostById.tsx`
- Delete: `libs/uploadWithProgress.ts`

**Interfaces:**
- Consumes: `storage` from `libs/storage/index.ts` (Task 4)
- Produces: nothing new — this task only moves existing call sites onto the adapter

Behavior that must be preserved exactly: `useCreatePost` still deletes already-uploaded files when a later step fails, and its progress percentage still aggregates across multiple files the same way.

- [ ] **Step 1: Rewire `useCreatePost`**

In `app/hooks/useCreatePost.tsx`, replace line 2:

```tsx
import { storage } from "@/libs/storage"
```

Replace the `uploadFile` helper body's first statement (line 19) so it calls the adapter:

```tsx
        await storage.upload(fileId, file, {
            onProgress: (percent) => {
                onProgress?.(Math.round(((completedFiles + percent / 100) / totalFiles) * 100))
            },
        })
```

Replace the cleanup call on line 58:

```tsx
        await storage.remove(uploadedFileIds).catch(() => {})
```

- [ ] **Step 2: Rewire `useChangeUserImage`**

In `app/hooks/useChangeUserImage.tsx`, replace line 1:

```tsx
import { storage } from "@/libs/storage"
```

`BUCKET` and `supabase` are no longer needed there. Replace the upload block (lines 23–27):

```tsx
    await storage.upload(imageId, finalFile)
```

And the delete block (line 31):

```tsx
        await storage.remove([currentImage]);
```

Note the error handling changes shape: `supabase.storage.upload` returned `{ error }` and the hook threw manually, whereas `storage.upload` throws directly. The explicit `if (error) throw error` line goes away.

- [ ] **Step 3: Rewire `useDeletePostById`**

In `app/hooks/useDeletePostById.tsx`, replace line 2:

```tsx
import { storage } from "@/libs/storage";
```

And line 20:

```tsx
    await storage.remove(getPostStorageFileIds(currentMedia)).catch(() => {})
```

- [ ] **Step 4: Delete the old module**

```bash
git rm libs/uploadWithProgress.ts
```

- [ ] **Step 5: Verify nothing still references it**

Run: `grep -rn "uploadWithProgress\|supabase\.storage" --include="*.ts" --include="*.tsx" . --exclude-dir=node_modules`
Expected: no output. Any hit is a call site this task missed.

- [ ] **Step 6: Verify typecheck, tests, and build**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: all three succeed.

- [ ] **Step 7: Verify in the browser**

This step cannot be replaced by unit tests — it is the only thing that proves CORS and the S3 toggle are configured correctly.

1. Confirm the "S3 connection" toggle is enabled in Storage settings and `NEXT_PUBLIC_SUPABASE_REGION` matches that page.
2. Start the dev server and log in.
3. Upload a **video larger than 8 MB** so the multipart path actually runs. Watch the progress bar advance, and confirm the post appears in the feed and plays.
4. Open devtools → Network and confirm the multipart requests return an `ETag` response header. Multipart cannot complete without `ETag` being CORS-exposed; if it is missing, the upload fails at the final `CompleteMultipartUpload`.
5. Upload a small avatar image and confirm it renders — this exercises the single-shot `PutObject` path.
6. Delete a post and confirm its objects disappear from the bucket.

- [ ] **Step 8: Confirm the bundle did not grow**

Compare the `npm run build` route table against a build from before this branch. The feed route's First Load JS should be unchanged, since the SDK is only reachable through the dynamic import in the upload path.

- [ ] **Step 9: Commit**

```bash
git add app/hooks/useCreatePost.tsx app/hooks/useChangeUserImage.tsx app/hooks/useDeletePostById.tsx
git commit -m "move app uploads and deletes onto the s3 adapter"
```

---

## Task 6: Orphan detection logic

**Files:**
- Create: `scripts/media/references.ts`, `scripts/media/references.test.ts`, `scripts/media/planOrphans.ts`, `scripts/media/planOrphans.test.ts`

**Interfaces:**
- Consumes: `getPostStorageFileIds` from `app/utils/postMedia.ts`
- Produces: `buildReferencedKeys(posts, profiles, placeholderImageId): Set<string>`, `planOrphans(objects, referenced, options): { orphans: string[]; skipped: string[] }`, and the `BucketObject` type

This task is pure logic with no I/O, which is what makes it testable. Task 7 wires it to the network.

- [ ] **Step 1: Write the failing test for the reference set**

Create `scripts/media/references.test.ts`:

```ts
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
```

The zero-row guard is the most important test here. An empty reference set makes every object in the bucket look like an orphan, so a misconfigured database connection would otherwise mean "delete everything".

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run scripts/media/references.test.ts`
Expected: FAIL — cannot resolve `./references`.

- [ ] **Step 3: Write the reference set implementation**

Create `scripts/media/references.ts`:

```ts
import { getPostStorageFileIds } from '@/app/utils/postMedia'

export type PostRow = { video_url: string | null }
export type ProfileRow = { image: string | null }

export const buildReferencedKeys = (
    posts: PostRow[],
    profiles: ProfileRow[],
    placeholderImageId: string
): Set<string> => {
    if (posts.length === 0 && profiles.length === 0) {
        throw new Error(
            'The database returned no rows for posts or profiles. Refusing to ' +
            'continue, because an empty reference set would classify every ' +
            'object in the bucket as an orphan. Check SUPABASE_SERVICE_ROLE_KEY ' +
            'and the project url.'
        )
    }

    const referenced = new Set<string>()

    if (placeholderImageId) {
        referenced.add(placeholderImageId)
    }

    for (const post of posts) {
        for (const fileId of getPostStorageFileIds(post.video_url)) {
            referenced.add(fileId)
        }
    }

    for (const profile of profiles) {
        if (profile.image) {
            referenced.add(profile.image)
        }
    }

    return referenced
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run scripts/media/references.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Write the failing test for the planner**

Create `scripts/media/planOrphans.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { planOrphans } from './planOrphans'

const HOUR = 60 * 60 * 1000
const now = new Date('2026-08-11T12:00:00Z')
const ago = (ms: number) => new Date(now.getTime() - ms)

describe('planOrphans', () => {
    it('flags objects no row references', () => {
        const result = planOrphans(
            [{ key: 'orphan', lastModified: ago(48 * HOUR) }],
            new Set(['live']),
            { minAgeMs: 24 * HOUR, now }
        )

        expect(result.orphans).toEqual(['orphan'])
        expect(result.skipped).toEqual([])
    })

    it('never flags a referenced object', () => {
        const result = planOrphans(
            [{ key: 'live', lastModified: ago(48 * HOUR) }],
            new Set(['live']),
            { minAgeMs: 24 * HOUR, now }
        )

        expect(result.orphans).toEqual([])
        expect(result.skipped).toEqual([])
    })

    it('skips unreferenced objects younger than the minimum age', () => {
        const result = planOrphans(
            [{ key: 'in-flight', lastModified: ago(1 * HOUR) }],
            new Set(['live']),
            { minAgeMs: 24 * HOUR, now }
        )

        expect(result.orphans).toEqual([])
        expect(result.skipped).toEqual(['in-flight'])
    })

    it('treats an object exactly at the minimum age as old enough', () => {
        const result = planOrphans(
            [{ key: 'borderline', lastModified: ago(24 * HOUR) }],
            new Set(),
            { minAgeMs: 24 * HOUR, now }
        )

        expect(result.orphans).toEqual(['borderline'])
    })

    it('separates a mixed bucket correctly', () => {
        const result = planOrphans(
            [
                { key: 'live', lastModified: ago(48 * HOUR) },
                { key: 'orphan', lastModified: ago(48 * HOUR) },
                { key: 'in-flight', lastModified: ago(1 * HOUR) },
            ],
            new Set(['live']),
            { minAgeMs: 24 * HOUR, now }
        )

        expect(result.orphans).toEqual(['orphan'])
        expect(result.skipped).toEqual(['in-flight'])
    })

    it('returns empty results for an empty bucket', () => {
        const result = planOrphans([], new Set(['live']), { minAgeMs: 24 * HOUR, now })

        expect(result).toEqual({ orphans: [], skipped: [] })
    })
})
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run scripts/media/planOrphans.test.ts`
Expected: FAIL — cannot resolve `./planOrphans`.

- [ ] **Step 7: Write the planner implementation**

Create `scripts/media/planOrphans.ts`:

```ts
export type BucketObject = {
    key: string
    lastModified: Date
}

export type OrphanPlan = {
    orphans: string[]
    skipped: string[]
}

export const planOrphans = (
    objects: BucketObject[],
    referenced: Set<string>,
    options: { minAgeMs: number; now: Date }
): OrphanPlan => {
    const orphans: string[] = []
    const skipped: string[] = []

    for (const object of objects) {
        if (referenced.has(object.key)) {
            continue
        }

        const age = options.now.getTime() - object.lastModified.getTime()

        // An object uploaded between the bucket listing and the database read
        // looks exactly like an orphan, so recent objects are always spared.
        if (age < options.minAgeMs) {
            skipped.push(object.key)
        } else {
            orphans.push(object.key)
        }
    }

    return { orphans, skipped }
}
```

- [ ] **Step 8: Run it to verify it passes**

Run: `npx vitest run scripts/media/planOrphans.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 9: Commit**

```bash
git add scripts/media/references.ts scripts/media/references.test.ts scripts/media/planOrphans.ts scripts/media/planOrphans.test.ts
git commit -m "add orphan detection logic"
```

---

## Task 7: Orphans CLI and the rclone runbook

**Files:**
- Create: `scripts/media/orphans.ts`, `docs/media-operations.md`
- Modify: `package.json`, `.env.example`

**Interfaces:**
- Consumes: `buildReferencedKeys`, `planOrphans`, `BucketObject` (Task 6); `getS3Endpoint` (Task 1)
- Produces: the `media:orphans` npm script

This task uses **S3 access keys and the service role key**, which bypass RLS. They are read from non-`NEXT_PUBLIC_` variables and must never be imported by app code.

- [ ] **Step 1: Add the server-only env vars to `.env.example`**

```bash
# Server-only. Used by scripts/media/*, never by the app.
# These bypass Row Level Security -- do not prefix them with NEXT_PUBLIC_.
# Generate the S3 pair at Supabase → Project settings → Storage → S3 connection.
SUPABASE_S3_ACCESS_KEY_ID=
SUPABASE_S3_SECRET_ACCESS_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

- [ ] **Step 2: Write the CLI**

Create `scripts/media/orphans.ts`:

```ts
import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3'
import { createClient } from '@supabase/supabase-js'
import { getS3Endpoint } from '@/libs/storage/config'
import { buildReferencedKeys } from './references'
import { planOrphans, type BucketObject } from './planOrphans'

const HOUR_MS = 60 * 60 * 1000
const DELETE_BATCH_LIMIT = 1000

const requireEnv = (name: string): string => {
    const value = process.env[name]
    if (!value) throw new Error(`Missing required environment variable ${name}`)
    return value
}

const parseArgs = (argv: string[]) => {
    const minAgeArg = argv.find((arg) => arg.startsWith('--min-age='))

    return {
        shouldDelete: argv.includes('--delete'),
        minAgeHours: minAgeArg ? Number(minAgeArg.split('=')[1]) : 24,
    }
}

const listAllObjects = async (client: S3Client, bucket: string): Promise<BucketObject[]> => {
    const objects: BucketObject[] = []
    let continuationToken: string | undefined

    do {
        const response = await client.send(
            new ListObjectsV2Command({
                Bucket: bucket,
                ContinuationToken: continuationToken,
            })
        )

        for (const item of response.Contents ?? []) {
            if (item.Key && item.LastModified) {
                objects.push({ key: item.Key, lastModified: item.LastModified })
            }
        }

        continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined
    } while (continuationToken)

    return objects
}

const main = async () => {
    const { shouldDelete, minAgeHours } = parseArgs(process.argv.slice(2))

    if (!Number.isFinite(minAgeHours) || minAgeHours < 0) {
        throw new Error('--min-age must be a non-negative number of hours')
    }

    const supabaseUrl = requireEnv('NEXT_PUBLIC_SUPABASE_URL')
    const bucket = process.env.NEXT_PUBLIC_SUPABASE_BUCKET || 'media'
    const placeholder = process.env.NEXT_PUBLIC_PLACEHOLDER_DEAFULT_IMAGE_ID || ''

    const s3 = new S3Client({
        forcePathStyle: true,
        region: requireEnv('NEXT_PUBLIC_SUPABASE_REGION'),
        endpoint: getS3Endpoint(supabaseUrl),
        credentials: {
            accessKeyId: requireEnv('SUPABASE_S3_ACCESS_KEY_ID'),
            secretAccessKey: requireEnv('SUPABASE_S3_SECRET_ACCESS_KEY'),
        },
    })

    const db = createClient(supabaseUrl, requireEnv('SUPABASE_SERVICE_ROLE_KEY'))

    const objects = await listAllObjects(s3, bucket)
    console.log(`Bucket "${bucket}": ${objects.length} objects.`)

    const [posts, profiles] = await Promise.all([
        db.from('posts').select('video_url'),
        db.from('profiles').select('image'),
    ])

    if (posts.error) throw posts.error
    if (profiles.error) throw profiles.error

    const referenced = buildReferencedKeys(
        posts.data ?? [],
        profiles.data ?? [],
        placeholder
    )
    console.log(`Referenced by the database: ${referenced.size} keys.`)

    const { orphans, skipped } = planOrphans(objects, referenced, {
        minAgeMs: minAgeHours * HOUR_MS,
        now: new Date(),
    })

    console.log(`Skipped (newer than ${minAgeHours}h): ${skipped.length}`)
    console.log(`Orphans: ${orphans.length}`)
    for (const key of orphans) console.log(`  ${key}`)

    if (!shouldDelete) {
        console.log('\nReport only. Re-run with --delete to remove these objects.')
        return
    }

    if (orphans.length === 0) return

    for (let index = 0; index < orphans.length; index += DELETE_BATCH_LIMIT) {
        const batch = orphans.slice(index, index + DELETE_BATCH_LIMIT)
        await s3.send(
            new DeleteObjectsCommand({
                Bucket: bucket,
                Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
            })
        )
    }

    console.log(`\nDeleted ${orphans.length} objects.`)
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
})
```

- [ ] **Step 3: Add the npm script**

In `package.json`, add to `"scripts"`:

```json
"media:orphans": "tsx --env-file=.env scripts/media/orphans.ts"
```

`--env-file` requires Node 20.6 or newer. If the local Node is older, use `dotenv-cli` instead.

- [ ] **Step 4: Verify it typechecks and all tests still pass**

Run: `npx tsc --noEmit && npm test`
Expected: both succeed.

- [ ] **Step 5: Run it in report mode against a real bucket**

```bash
npm run media:orphans
```

Expected: prints object count, referenced-key count, skip count, and an orphan list. Sanity-check the numbers before ever passing `--delete` — if the orphan count is close to the total object count, something is misconfigured.

- [ ] **Step 6: Write the rclone runbook**

Create `docs/media-operations.md`:

````markdown
# Media bucket operations

Backup, sync, and migration are handled by [rclone](https://rclone.org), which
already does concurrent transfer, resume, and checksum comparison against
Supabase's S3-compatible endpoint. Only orphan detection needs custom code,
because it has to join bucket contents against application tables.

## Prerequisites

- The "S3 connection" toggle enabled at Supabase → Project settings → Storage.
- An S3 access key pair from that same page. **These bypass Row Level Security.**
- `rclone` installed (`brew install rclone`).

## Configure a remote

Add to `~/.config/rclone/rclone.conf`:

```ini
[supabase-prod]
type = s3
provider = Other
endpoint = https://<project-ref>.storage.supabase.co/storage/v1/s3
region = <project-region>
access_key_id = <access-key-id>
secret_access_key = <secret-access-key>
force_path_style = true
```

Verify: `rclone ls supabase-prod:media | head`

## Backup to a local mirror

Dry run first:

```bash
rclone sync supabase-prod:media ./media-backup --dry-run --progress
```

Then for real:

```bash
rclone sync supabase-prod:media ./media-backup --progress
```

`sync` makes the destination match the source, which means it **deletes local
files no longer in the bucket**. Use `rclone copy` instead if you want an
append-only archive that never removes anything.

## Sync one project to another

Define a second remote (`[supabase-staging]`) the same way, then:

```bash
rclone sync supabase-prod:media supabase-staging:media --dry-run --progress
rclone sync supabase-prod:media supabase-staging:media --progress
```

## Migrate to another S3 provider

Define the destination remote (R2, MinIO, AWS), then:

```bash
rclone copy supabase-prod:media r2-media --dry-run --progress
rclone copy supabase-prod:media r2-media --progress
```

`copy` rather than `sync`, so nothing at the destination is ever deleted.

After the objects are in place, point the app at the new host by setting
`NEXT_PUBLIC_MEDIA_BASE_URL` to the new public base url. Uploads still go to
Supabase until `libs/storage/index.ts` is repointed as well.

## Find orphaned objects

Objects that no post or profile row references — left behind by failed uploads
or by deletes that only removed the database row.

```bash
npm run media:orphans
```

Report-only by default. To actually delete:

```bash
npm run media:orphans -- --delete
```

Objects newer than 24 hours are never deleted, because an upload that lands
between the bucket listing and the database read is indistinguishable from an
orphan. Adjust with `--min-age=48`.

The script refuses to run if the database returns zero rows, since an empty
reference set would classify the entire bucket as orphaned.
````

- [ ] **Step 7: Commit**

```bash
git add scripts/media/orphans.ts docs/media-operations.md package.json .env.example
git commit -m "add orphans cli and media operations runbook"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
| --- | --- |
| Storage abstraction (`libs/storage/`, delete `uploadWithProgress`) | 2, 4, 5 |
| Credentials (async provider, `expiration`, project ref derivation) | 1, 3 |
| New env vars, `.env.example` | 1, 7 |
| Upload path (`lib-storage`, 8 MB / queue 4, dynamic import, progress) | 4 |
| Call-site changes (4 files, `useCreateBucketUrl` signature preserved) | 2, 5 |
| Error handling (cleanup preserved, logged-out message, multipart abort) | 3, 4, 5 |
| rclone runbook | 7 |
| `orphans` script + three safety properties | 6, 7 |
| Testing (Vitest, `planOrphans`, credentials, adapter, `publicUrl`) | 1–6 |
| Verification (S3 toggle, ETag/CORS, progress, bundle size) | 5, 7 |

No spec requirement is unassigned.

**Known deviations from the spec:**

1. The spec described `planOrphans` as taking the reference set and mentioned the zero-row guard alongside it. The plan splits reference-set construction into `references.ts` (which owns the guard) and the diff into `planOrphans.ts`. This matches the spec's own corrected testing section.
2. The spec did not mention chunking `DeleteObjects` at 1000 keys. That is a hard S3 API limit; without chunking, orphan cleanup on a large bucket would fail. Added in Tasks 4 and 7.
3. The spec did not specify local Supabase support. `getProjectRef` throws a clear error rather than silently deriving `127` from `127.0.0.1`. Recorded in Global Constraints.
4. The spec named `aws-sdk-client-mock` for adapter tests. The plan injects a `loadSdk` seam instead and uses hand-rolled fakes, because `aws-sdk-client-mock` patches a client instance and cannot intercept one constructed behind a dynamic `import()`. The dependency is not installed.

**Type consistency:** `StorageAdapter` (Task 2) is implemented in Task 4 and consumed in Task 5 with matching signatures. `BucketObject` is defined in `planOrphans.ts` (Task 6) and imported by `orphans.ts` (Task 7). `getS3Endpoint` (Task 1) is used in Tasks 4 and 7 with the same single-string signature. `buildPublicUrl` (Task 2) is consumed in Task 4. `createSessionCredentialProvider` takes the same options object in Tasks 3 and 4.

**Placeholder scan:** no TBD/TODO markers, no "similar to Task N" references, every code step contains complete runnable content.

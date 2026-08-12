import { describe, expect, it, vi } from 'vitest'
import { createS3Adapter } from './s3Adapter'

type ProgressEvent = { loaded?: number; total?: number }

type DeleteError = { Key?: string; Code?: string; Message?: string }

const makeAdapter = (overrides: {
    progressEvents?: ProgressEvent[]
    failWith?: Error
    abortFailsWith?: Error
    deleteErrors?: DeleteError[]
} = {}) => {
    const sent: any[] = []
    const uploads: any[] = []
    const clients: any[] = []

    class FakeXhrHttpHandler {
        constructor(public config: any) {}
    }

    class FakeS3Client {
        constructor(public config: any) {
            clients.push(this)
        }
        async send(command: any) {
            sent.push(command)
            return overrides.deleteErrors ? { Errors: overrides.deleteErrors } : {}
        }
    }

    class FakeDeleteObjectsCommand {
        constructor(public input: any) {}
    }

    class FakeUpload {
        handlers: Record<string, (event: any) => void> = {}
        abort = vi.fn().mockImplementation(async () => {
            if (overrides.abortFailsWith) {
                throw overrides.abortFailsWith
            }
        })

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
            XhrHttpHandler: FakeXhrHttpHandler as any,
        }),
    })

    return { adapter, sent, uploads, clients, FakeXhrHttpHandler }
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

    it('surfaces the original error when the cleanup abort also fails', async () => {
        const { adapter } = makeAdapter({
            failWith: new Error('network down'),
            abortFailsWith: new Error('abort failed'),
        })

        await expect(adapter.upload('abc123', file())).rejects.toThrow('network down')
    })

    it('refuses to start when the signal is already aborted', async () => {
        const { adapter, uploads } = makeAdapter()
        const controller = new AbortController()
        controller.abort()

        await expect(
            adapter.upload('abc123', file(), { signal: controller.signal })
        ).rejects.toThrow('Upload aborted')
        expect(uploads).toHaveLength(0)
    })
})

describe('createS3Adapter client configuration', () => {
    it('uses an xhr request handler so progress is reported byte by byte', async () => {
        const { adapter, clients, FakeXhrHttpHandler } = makeAdapter()

        await adapter.upload('abc123', file())

        expect(clients[0].config.requestHandler).toBeInstanceOf(FakeXhrHttpHandler)
    })

    it('only sends checksums when the operation requires them', async () => {
        const { adapter, clients } = makeAdapter()

        await adapter.upload('abc123', file())

        expect(clients[0].config.requestChecksumCalculation).toBe('WHEN_REQUIRED')
        expect(clients[0].config.responseChecksumValidation).toBe('WHEN_REQUIRED')
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

    it('resolves when the response carries no per-key errors', async () => {
        const { adapter } = makeAdapter()

        await expect(adapter.remove(['a', 'b'])).resolves.toBeUndefined()
    })

    it('throws when a 200 response carries per-key errors, naming keys and codes', async () => {
        const { adapter } = makeAdapter({
            deleteErrors: [
                { Key: 'a', Code: 'AccessDenied', Message: 'denied' },
                { Key: 'b', Code: 'InternalError', Message: 'boom' },
            ],
        })

        await expect(adapter.remove(['a', 'b'])).rejects.toThrow(
            'Failed to delete 2 of 2 object(s): a (AccessDenied), b (InternalError)'
        )
    })

    it('aggregates per-key errors across chunked batches', async () => {
        const { adapter } = makeAdapter({
            deleteErrors: [{ Key: 'x', Code: 'AccessDenied' }],
        })

        // 1001 keys is two requests, each returning one error.
        await expect(
            adapter.remove(Array.from({ length: 1001 }, (_, i) => `k${i}`))
        ).rejects.toThrow('Failed to delete 2 of 1001 object(s)')
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

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

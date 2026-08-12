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
    XhrHttpHandler: typeof import('@aws-sdk/xhr-http-handler').XhrHttpHandler
}

type DeleteError = { Key?: string; Code?: string; Message?: string }

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
    const [clientS3, libStorage, xhrHandler] = await Promise.all([
        import('@aws-sdk/client-s3'),
        import('@aws-sdk/lib-storage'),
        import('@aws-sdk/xhr-http-handler'),
    ])

    return {
        S3Client: clientS3.S3Client,
        DeleteObjectsCommand: clientS3.DeleteObjectsCommand,
        Upload: libStorage.Upload,
        XhrHttpHandler: xhrHandler.XhrHttpHandler,
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
            // lib-storage only emits incremental httpUploadProgress when the
            // client's requestHandler is an EventEmitter it can subscribe to
            // xhr.upload.progress on. The browser default, FetchHttpHandler, is
            // not one: without this every file under the 8MB part size reports
            // progress exactly once, after the upload has already finished.
            requestHandler: new sdk.XhrHttpHandler({}),
            // Preventive, not a fix for an observed failure: AWS SDK v3.7xx+
            // defaults to WHEN_SUPPORTED, which attaches x-amz-checksum-crc32
            // and x-amz-sdk-checksum-algorithm headers to every PutObject and
            // UploadPart. Those have to be accepted by Supabase's S3
            // implementation and allowed in the bucket's CORS allowedHeaders,
            // which is the most common breakage class for AWS SDK v3 against
            // non-AWS S3 backends, and cannot be verified from here.
            requestChecksumCalculation: 'WHEN_REQUIRED',
            responseChecksumValidation: 'WHEN_REQUIRED',
        })

        return { sdk, client }
    }

    return {
        async upload(key: string, file: File, uploadOptions?: UploadOptions) {
            // addEventListener('abort', ...) never fires for a signal that is
            // already aborted, so an upload started with one would run to
            // completion instead of being cancelled.
            if (uploadOptions?.signal?.aborted) {
                throw new Error('Upload aborted')
            }

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

            const handleAbortSignal = () => {
                void upload.abort().catch(() => {})
            }

            uploadOptions?.signal?.addEventListener('abort', handleAbortSignal)

            try {
                await upload.done()
                uploadOptions?.onProgress?.(100)
            } catch (error) {
                // Incomplete multipart uploads stay billable and are invisible
                // in object listings, so clean up before surfacing the error.
                await upload.abort().catch(() => {})
                throw error
            } finally {
                uploadOptions?.signal?.removeEventListener('abort', handleAbortSignal)
            }
        },

        async remove(keys: string[]) {
            if (keys.length === 0) return

            const { sdk, client } = await createClient()
            const failures: DeleteError[] = []

            for (const batch of chunk(keys, DELETE_BATCH_LIMIT)) {
                const response = await client.send(
                    new sdk.DeleteObjectsCommand({
                        Bucket: options.bucket,
                        Delete: {
                            Objects: batch.map((Key) => ({ Key })),
                            Quiet: true,
                        },
                    })
                )

                // Quiet suppresses the per-key success entries but not the
                // failures: a 200 response can still carry an Errors array,
                // e.g. when RLS denies some of the keys.
                for (const error of response.Errors ?? []) {
                    failures.push(error)
                }
            }

            if (failures.length > 0) {
                const detail = failures
                    .map((error) => `${error.Key ?? '<unknown key>'} (${error.Code ?? 'unknown'})`)
                    .join(', ')

                throw new Error(
                    `Failed to delete ${failures.length} of ${keys.length} object(s): ${detail}`
                )
            }
        },

        publicUrl(key: string) {
            return buildPublicUrl(options.publicBaseUrl, key)
        },
    }
}

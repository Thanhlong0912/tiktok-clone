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

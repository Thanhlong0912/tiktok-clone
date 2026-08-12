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

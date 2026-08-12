import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3'
import { createClient } from '@supabase/supabase-js'
import { getS3Endpoint } from '@/libs/storage/config'
import { parseArgs, parseMinAgeHours } from './args'
import { fetchAllRows } from './fetchAllRows'
import { buildReferencedKeys, type PostRow, type ProfileRow } from './references'
import { planOrphans, type BucketObject } from './planOrphans'

const HOUR_MS = 60 * 60 * 1000
const DELETE_BATCH_LIMIT = 1000

// If more than half the bucket looks orphaned, the reference set is far more
// likely to be incomplete than the bucket to be half garbage. Cheap insurance
// against the whole family of "the join lost rows" bugs.
const MAX_ORPHAN_RATIO = 0.5

const requireEnv = (name: string): string => {
    const value = process.env[name]
    if (!value) throw new Error(`Missing required environment variable ${name}`)
    return value
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
    const { shouldDelete, minAgeRaw } = parseArgs(process.argv.slice(2))
    const minAgeHours = parseMinAgeHours(minAgeRaw)

    const supabaseUrl = requireEnv('NEXT_PUBLIC_SUPABASE_URL')
    // `??` rather than `||`: an explicitly empty value is a misconfiguration,
    // and silently falling back to a default here would point the run at the
    // wrong bucket.
    const bucket = process.env.NEXT_PUBLIC_SUPABASE_BUCKET ?? 'media'
    // Required, not optional. The default avatar is referenced by no row, so
    // without it every profile on the placeholder loses its image the first
    // time this runs from an environment that only has the server-side vars.
    const placeholder = requireEnv('NEXT_PUBLIC_PLACEHOLDER_DEAFULT_IMAGE_ID')

    const s3 = new S3Client({
        forcePathStyle: true,
        region: requireEnv('NEXT_PUBLIC_SUPABASE_REGION'),
        endpoint: getS3Endpoint(supabaseUrl),
        credentials: {
            accessKeyId: requireEnv('SUPABASE_S3_ACCESS_KEY_ID'),
            secretAccessKey: requireEnv('SUPABASE_S3_SECRET_ACCESS_KEY'),
        },
        // Preventive, not a fix for an observed failure: AWS SDK v3.7xx+
        // defaults to WHEN_SUPPORTED, which attaches x-amz-checksum-crc32 and
        // x-amz-sdk-checksum-algorithm headers to every write. Those have to be
        // accepted by Supabase's S3 implementation, and this is the most common
        // breakage class for AWS SDK v3 against non-AWS S3 backends. Kept in
        // step with the browser adapter so both clients behave the same way.
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
    })

    const db = createClient(supabaseUrl, requireEnv('SUPABASE_SERVICE_ROLE_KEY'))

    const objects = await listAllObjects(s3, bucket)
    console.log(`Bucket "${bucket}": ${objects.length} objects.`)

    // Paged: an unpaged select is capped at max_rows and truncated silently.
    const [posts, profiles] = await Promise.all([
        fetchAllRows<PostRow>((from, to) =>
            db.from('posts').select('video_url').range(from, to)
        ),
        fetchAllRows<ProfileRow>((from, to) =>
            db.from('profiles').select('image').range(from, to)
        ),
    ])

    const referenced = buildReferencedKeys(posts, profiles, placeholder)
    console.log(`Rows read: ${posts.length} posts, ${profiles.length} profiles.`)
    console.log(`Referenced by the database: ${referenced.size} keys.`)
    console.log(`Protected placeholder key: ${placeholder}`)

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

    if (orphans.length > objects.length * MAX_ORPHAN_RATIO) {
        const ratio = ((orphans.length / objects.length) * 100).toFixed(1)
        console.error(
            `\nRefusing to delete: ${orphans.length} of ${objects.length} listed ` +
            `objects (${ratio}%) look orphaned, over the ${MAX_ORPHAN_RATIO * 100}% ` +
            'safety limit. A reference set that lost rows looks exactly like this. ' +
            'Verify the report above before deleting anything.'
        )
        process.exit(1)
    }

    const deleteErrors: { Key?: string; Code?: string; Message?: string }[] = []

    for (let index = 0; index < orphans.length; index += DELETE_BATCH_LIMIT) {
        const batch = orphans.slice(index, index + DELETE_BATCH_LIMIT)
        const response = await s3.send(
            new DeleteObjectsCommand({
                Bucket: bucket,
                Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
            })
        )

        // Quiet suppresses the success entries but not the failures, so a 200
        // can still carry per-key errors.
        for (const error of response.Errors ?? []) {
            deleteErrors.push(error)
        }
    }

    const deletedCount = orphans.length - deleteErrors.length
    console.log(`\nDeleted ${deletedCount} of ${orphans.length} objects.`)

    if (deleteErrors.length > 0) {
        console.error(`${deleteErrors.length} object(s) failed to delete:`)
        for (const error of deleteErrors) {
            console.error(`  ${error.Key}: ${error.Code} ${error.Message}`)
        }
        process.exit(1)
    }
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
})

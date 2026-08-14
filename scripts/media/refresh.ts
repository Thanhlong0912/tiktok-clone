/**
 * Repoints every post at real media that exists in the bucket.
 *
 * Seeded posts were created by borrowing one media key from an existing post
 * and cycling it across all of them (scripts/seed/plan.ts). When that single
 * object later left the bucket, every post in the database became a dead
 * reference at once -- and because poster_key was never populated either,
 * Explore had nothing to paint but partial video downloads.
 *
 * This spreads the clips actually present in the bucket across those posts,
 * generates the poster frames the browser upload path would have produced,
 * fills in duration/width/height, rewrites captions to match what is on screen,
 * and gives seeded profiles a face instead of 27 copies of one placeholder.
 *
 *   npm run media:refresh             -- report what would change
 *   npm run media:refresh -- --apply  -- write it
 *
 * Report-only by default, and --apply writes a full before-state backup to
 * disk first. Uses the service role key, so it bypasses RLS: development only.
 */

import { writeFile } from 'node:fs/promises'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from './fetchAllRows'
import {
    assertFfmpegAvailable,
    captureAvatar,
    capturePoster,
    mapWithConcurrency,
    probeImage,
    probeVideo,
} from './probe'
import {
    assignVideos,
    countUsage,
    createRng,
    EXCLUDED_IMAGES,
    isSuitableVideo,
    planAvatars,
    planBios,
    planImagePost,
    type PostInput,
    type VideoAsset,
} from './refreshPlan'

const SEED_EMAIL_DOMAIN = 'seed.local.test'
const DEFAULT_SEED = 20260814
const PROBE_CONCURRENCY = 6
const UPLOAD_CONCURRENCY = 4
const WRITE_CONCURRENCY = 8

const requireEnv = (name: string): string => {
    const value = process.env[name]
    if (!value) throw new Error(`Missing required environment variable ${name}`)
    return value
}

const parseArgs = (argv: string[]) => {
    const seedArg = argv.find((arg) => arg.startsWith('--seed='))
    const seed = seedArg ? Number(seedArg.slice('--seed='.length)) : DEFAULT_SEED

    if (!Number.isFinite(seed)) {
        throw new Error(`--seed must be a number, got "${seedArg}".`)
    }

    return {
        apply: argv.includes('--apply'),
        skipAvatars: argv.includes('--skip-avatars'),
        seed,
    }
}

type BucketFile = { key: string; mimeType: string }

/** Walks one level of folders; the bucket has no deeper nesting. */
const listBucket = async (db: SupabaseClient, bucket: string): Promise<BucketFile[]> => {
    const readFolder = async (prefix: string): Promise<BucketFile[]> => {
        const found: BucketFile[] = []
        let offset = 0

        for (;;) {
            const { data, error } = await db.storage
                .from(bucket)
                .list(prefix, { limit: 100, offset, sortBy: { column: 'name', order: 'asc' } })

            if (error) throw error
            if (!data || data.length === 0) break

            for (const entry of data) {
                const key = prefix ? `${prefix}/${entry.name}` : entry.name
                const mimeType = (entry as any).metadata?.mimetype

                // A listing row with no metadata is a folder, not an object.
                if (!mimeType) {
                    found.push(...(await readFolder(key)))
                } else {
                    found.push({ key, mimeType })
                }
            }

            if (data.length < 100) break
            offset += data.length
        }

        return found
    }

    return readFolder('')
}

const listSeedUserIds = async (db: SupabaseClient): Promise<Set<string>> => {
    const seeded = new Set<string>()
    let page = 1

    for (;;) {
        const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 })
        if (error) throw error

        for (const user of data.users) {
            if (user.email?.endsWith(`@${SEED_EMAIL_DOMAIN}`)) seeded.add(user.id)
        }

        if (data.users.length < 200) break
        page += 1
    }

    return seeded
}

const main = async () => {
    const { apply, seed, skipAvatars } = parseArgs(process.argv.slice(2))

    const supabaseUrl = requireEnv('NEXT_PUBLIC_SUPABASE_URL')
    const bucket = process.env.NEXT_PUBLIC_SUPABASE_BUCKET ?? 'media'
    const publicBase = `${supabaseUrl}/storage/v1/object/public/${bucket}`

    await assertFfmpegAvailable()

    const db = createClient(supabaseUrl, requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
        auth: { autoRefreshToken: false, persistSession: false },
    })

    // ---------------------------------------------------------------- catalog
    const files = await listBucket(db, bucket)
    const videoFiles = files.filter((file) => file.mimeType.startsWith('video/'))
    const imageFiles = files.filter(
        (file) =>
            file.key.startsWith('image/') &&
            file.mimeType.startsWith('image/') &&
            // Posters this script generated on an earlier run are bucket
            // furniture, not postable content.
            !file.key.startsWith('image/poster-')
    )

    console.log(`Bucket "${bucket}": ${files.length} objects (${videoFiles.length} video, ${imageFiles.length} image).`)
    console.log('Probing videos...')

    const probed = await mapWithConcurrency(videoFiles, PROBE_CONCURRENCY, (file) =>
        probeVideo(`${publicBase}/${file.key}`, file.key)
    )

    const suitable: VideoAsset[] = []
    const rejected: Array<{ key: string; reason: string }> = []

    for (const asset of probed) {
        const verdict = isSuitableVideo(asset)
        if (verdict.suitable) suitable.push(asset)
        else rejected.push({ key: asset.key, reason: verdict.reason })
    }

    console.log(`\nUsable videos: ${suitable.length}`)
    console.log(`Rejected: ${rejected.length}`)
    for (const item of rejected) console.log(`  ${item.key} -- ${item.reason}`)

    const keptImages = imageFiles
        .map((file) => file.key)
        .filter((key) => !EXCLUDED_IMAGES[key])
    console.log(`\nUsable images: ${keptImages.length}`)
    for (const [key, reason] of Object.entries(EXCLUDED_IMAGES)) {
        console.log(`  excluded ${key} -- ${reason}`)
    }

    // ------------------------------------------------------------------ rows
    const rows = await fetchAllRows<{
        id: string
        user_id: string
        video_url: string
        poster_key: string
        text: string
        duration_ms: number | null
        width: number | null
        height: number | null
    }>((from, to) =>
        db
            .from('posts')
            .select('id, user_id, video_url, poster_key, text, duration_ms, width, height')
            .is('deleted_at', null)
            .order('id', { ascending: true })
            .range(from, to)
    )

    if (rows.length === 0) {
        throw new Error('No posts found. Nothing to refresh.')
    }

    const profiles = await fetchAllRows<{ user_id: string; image: string | null }>((from, to) =>
        db.from('profiles').select('user_id, image').order('user_id', { ascending: true }).range(from, to)
    )

    const seededUsers = await listSeedUserIds(db)
    console.log(`\nPosts: ${rows.length} | profiles: ${profiles.length} | seeded accounts: ${seededUsers.size}`)

    // ------------------------------------------------------------------ plan
    const rng = createRng(seed)
    const allPosts: PostInput[] = rows.map((row) => ({ id: row.id, userId: row.user_id }))

    // One post becomes the image carousel. Restricted to seeded accounts so a
    // real user's post is never retyped into something they did not upload.
    const carouselCandidates = allPosts.filter((post) => seededUsers.has(post.userId))
    const carouselPost =
        keptImages.length > 0 && carouselCandidates.length > 0
            ? carouselCandidates[Math.floor(rng() * carouselCandidates.length)]
            : undefined

    const videoPosts = allPosts.filter((post) => post.id !== carouselPost?.id)
    const assignments = assignVideos(videoPosts, suitable, rng)

    const imagePosts = []
    if (carouselPost) {
        const dimensions = await probeImage(`${publicBase}/${keptImages[0]}`)
        imagePosts.push(
            planImagePost(
                carouselPost,
                keptImages,
                dimensions,
                'flower series, pick your favourite #beauty #aesthetic'
            )
        )
    }

    const postsByAuthor: Record<string, string[]> = {}
    for (const assignment of assignments) {
        if (!seededUsers.has(assignment.userId)) continue
        if (!postsByAuthor[assignment.userId]) postsByAuthor[assignment.userId] = []
        postsByAuthor[assignment.userId].push(assignment.videoKey)
    }

    const avatars = skipAvatars ? [] : planAvatars(postsByAuthor, rng)
    const bios = planBios(postsByAuthor)
    const usage = countUsage(assignments)
    const usageCounts = Object.values(usage)

    console.log('\n--- Plan ---')
    console.log(`Video posts:    ${assignments.length}`)
    console.log(`Image posts:    ${imagePosts.length}`)
    console.log(`Posters:        ${suitable.length} (one per clip)`)
    console.log(`Avatars:        ${avatars.length}`)
    console.log(`Bios retopiced: ${bios.length}`)
    console.log(
        `Spread:         each clip used ${Math.min(...usageCounts)}-${Math.max(...usageCounts)} times`
    )

    console.log('\nSample captions:')
    for (const assignment of assignments.slice(0, 8)) {
        console.log(`  ${assignment.videoKey.padEnd(16)} ${assignment.text}`)
    }

    if (!apply) {
        console.log('\nReport only. Re-run with --apply to write these changes.')
        return
    }

    // ---------------------------------------------------------------- backup
    const backupPath = `media-refresh-backup-${Date.now()}.json`
    await writeFile(
        backupPath,
        JSON.stringify({ posts: rows, profiles }, null, 2),
        'utf8'
    )
    console.log(`\nBefore-state written to ${backupPath}`)

    // --------------------------------------------------------------- posters
    console.log('Generating and uploading posters...')
    await mapWithConcurrency(suitable, UPLOAD_CONCURRENCY, async (asset) => {
        const frame = await capturePoster(`${publicBase}/${asset.key}`, asset.durationMs)
        const posterKey = assignments.find((a) => a.videoKey === asset.key)?.posterKey

        if (!posterKey) return

        const { error } = await db.storage
            .from(bucket)
            .upload(posterKey, frame, { contentType: 'image/webp', upsert: true })

        if (error) throw new Error(`${posterKey}: ${error.message}`)
    })
    console.log(`  ${suitable.length} posters uploaded.`)

    // --------------------------------------------------------------- avatars
    if (avatars.length > 0) {
        console.log('Generating and uploading avatars...')
        const byKey: Record<string, VideoAsset> = {}
        for (const asset of suitable) byKey[asset.key] = asset

        await mapWithConcurrency(avatars, UPLOAD_CONCURRENCY, async (plan) => {
            const asset = byKey[plan.sourceVideoKey]
            const frame = await captureAvatar(`${publicBase}/${plan.sourceVideoKey}`, asset.durationMs)

            const { error } = await db.storage
                .from(bucket)
                .upload(plan.avatarKey, frame, { contentType: 'image/webp', upsert: true })

            if (error) throw new Error(`${plan.avatarKey}: ${error.message}`)
        })
        console.log(`  ${avatars.length} avatars uploaded.`)
    }

    // ------------------------------------------------------------------ rows
    console.log('Updating posts...')
    const writes = [
        ...assignments.map((assignment) => ({
            id: assignment.id,
            video_url: assignment.videoKey,
            poster_key: assignment.posterKey,
            duration_ms: assignment.durationMs,
            width: assignment.width,
            height: assignment.height,
            text: assignment.text,
        })),
        ...imagePosts.map((post) => ({
            id: post.id,
            video_url: post.videoKey,
            poster_key: post.posterKey,
            duration_ms: post.durationMs,
            width: post.width,
            height: post.height,
            text: post.text,
        })),
    ]

    await mapWithConcurrency(writes, WRITE_CONCURRENCY, async (write) => {
        const { id, ...columns } = write
        const { error } = await db.from('posts').update(columns).eq('id', id)
        if (error) throw new Error(`post ${id}: ${error.message}`)
    })
    console.log(`  ${writes.length} posts updated.`)

    // Avatar and bio are one write per profile: two updates to the same row
    // would just be a second round trip.
    const profileWrites: Record<string, { image?: string; bio?: string }> = {}
    for (const plan of avatars) {
        profileWrites[plan.userId] = { ...profileWrites[plan.userId], image: plan.avatarKey }
    }
    for (const plan of bios) {
        profileWrites[plan.userId] = { ...profileWrites[plan.userId], bio: plan.bio }
    }

    const profileEntries = Object.keys(profileWrites)
    if (profileEntries.length > 0) {
        console.log('Updating profiles...')
        await mapWithConcurrency(profileEntries, WRITE_CONCURRENCY, async (userId) => {
            const { error } = await db
                .from('profiles')
                .update(profileWrites[userId])
                .eq('user_id', userId)
            if (error) throw new Error(`profile ${userId}: ${error.message}`)
        })
        console.log(`  ${profileEntries.length} profiles updated.`)
    }

    console.log('\nDone. Run `npm run media:verify` to check every reference resolves.')
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
})

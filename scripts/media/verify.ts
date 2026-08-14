/**
 * Checks that every media key the database references actually resolves.
 *
 * The failure this exists to catch is silent: a post row pointing at a key that
 * is not in the bucket looks completely healthy in SQL, and only shows up as a
 * black rectangle in the feed. So the check is a real HTTP request per distinct
 * key, asserting both the status and that the content type matches the way the
 * app is going to use it -- a poster_key that resolves to a video, or a
 * video_url that resolves to an image, renders just as broken as a 404.
 *
 *   npm run media:verify
 *
 * Exits non-zero if anything is unresolvable, so it can gate a deploy.
 */

import { createClient } from '@supabase/supabase-js'
import { fetchAllRows } from './fetchAllRows'
import { mapWithConcurrency } from './probe'
import { getImagePostAudioId, getImagePostIds, isImagePost } from '@/app/utils/postMedia'

const CHECK_CONCURRENCY = 8

type Expectation = 'video' | 'image' | 'audio'

const requireEnv = (name: string): string => {
    const value = process.env[name]
    if (!value) throw new Error(`Missing required environment variable ${name}`)
    return value
}

const contentTypeMatches = (expectation: Expectation, contentType: string): boolean => {
    if (expectation === 'video') return contentType.startsWith('video/')
    if (expectation === 'image') return contentType.startsWith('image/')
    return contentType.startsWith('audio/') || contentType.startsWith('video/')
}

const main = async () => {
    const supabaseUrl = requireEnv('NEXT_PUBLIC_SUPABASE_URL')
    const bucket = process.env.NEXT_PUBLIC_SUPABASE_BUCKET ?? 'media'
    const publicBase = `${supabaseUrl}/storage/v1/object/public/${bucket}`

    const db = createClient(supabaseUrl, requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
        auth: { autoRefreshToken: false, persistSession: false },
    })

    const posts = await fetchAllRows<{
        id: string
        video_url: string
        poster_key: string
        duration_ms: number | null
        width: number | null
        height: number | null
    }>((from, to) =>
        db
            .from('posts')
            .select('id, video_url, poster_key, duration_ms, width, height')
            .is('deleted_at', null)
            .order('id', { ascending: true })
            .range(from, to)
    )

    const profiles = await fetchAllRows<{ user_id: string; image: string | null }>((from, to) =>
        db.from('profiles').select('user_id, image').order('user_id', { ascending: true }).range(from, to)
    )

    // Distinct keys only: 251 posts share ~36 clips, so checking per row would
    // be 200 redundant requests.
    const expectations = new Map<string, Expectation>()
    const referencedBy = new Map<string, number>()

    const note = (key: string, expectation: Expectation) => {
        if (!key) return
        expectations.set(key, expectation)
        referencedBy.set(key, (referencedBy.get(key) ?? 0) + 1)
    }

    const missingMetadata: string[] = []
    const emptyPosters: string[] = []

    for (const post of posts) {
        if (isImagePost(post.video_url)) {
            for (const imageId of getImagePostIds(post.video_url)) note(imageId, 'image')
            const audioId = getImagePostAudioId(post.video_url)
            if (audioId) note(audioId, 'audio')
        } else {
            note(post.video_url, 'video')
        }

        note(post.poster_key, 'image')

        if (!post.poster_key) emptyPosters.push(post.id)
        if (post.duration_ms == null || post.width == null || post.height == null) {
            missingMetadata.push(post.id)
        }
    }

    for (const profile of profiles) {
        if (profile.image) note(profile.image, 'image')
    }

    console.log(
        `Checking ${expectations.size} distinct keys referenced by ` +
        `${posts.length} posts and ${profiles.length} profiles...`
    )

    const keys = Array.from(expectations.keys())
    const failures: string[] = []

    await mapWithConcurrency(keys, CHECK_CONCURRENCY, async (key) => {
        const expectation = expectations.get(key)!
        const uses = referencedBy.get(key) ?? 0

        let response: Response
        try {
            response = await fetch(`${publicBase}/${key.split('/').map(encodeURIComponent).join('/')}`, {
                method: 'HEAD',
            })
        } catch (error) {
            failures.push(`${key} (${uses} refs) -- request failed: ${String(error)}`)
            return
        }

        if (!response.ok) {
            failures.push(`${key} (${uses} refs) -- HTTP ${response.status}`)
            return
        }

        const contentType = response.headers.get('content-type') ?? ''
        if (!contentTypeMatches(expectation, contentType)) {
            failures.push(
                `${key} (${uses} refs) -- expected ${expectation}, got content-type "${contentType}"`
            )
        }
    })

    const distinctVideos = new Set(
        posts.filter((post) => !isImagePost(post.video_url)).map((post) => post.video_url)
    )

    console.log(`\nDistinct post media: ${distinctVideos.size} clips across ${posts.length} posts.`)
    console.log(`Posts missing a poster:   ${emptyPosters.length}`)
    console.log(`Posts missing dimensions: ${missingMetadata.length}`)

    if (failures.length > 0) {
        console.error(`\n${failures.length} unresolvable reference(s):`)
        for (const failure of failures) console.error(`  ${failure}`)
        process.exit(1)
    }

    console.log(`\nAll ${keys.length} referenced keys resolve.`)

    // Not fatal -- a post can render without them -- but both mean Explore is
    // downloading video bytes to paint a thumbnail, so they are worth surfacing.
    if (emptyPosters.length > 0 || missingMetadata.length > 0) {
        console.warn('Some posts still lack a poster or dimensions; re-run media:refresh.')
    }
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
})

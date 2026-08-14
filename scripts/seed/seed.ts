/**
 * Populates a DEVELOPMENT database with a synthetic social graph so the ranked
 * feed, trending and search have something real to work on.
 *
 * Uses the service role key, so it bypasses RLS and can write post_views and
 * counters directly. Never point it at production.
 *
 *   npm run seed          -- create ~25 users and ~250 posts
 *   npm run seed -- --clean   -- delete everything it previously created
 *
 * Seeded accounts all live on @seed.local.test, which is how --clean knows
 * exactly what to remove without touching real accounts.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { planSeed, type SeedMedia, type SeedPlan } from './plan'

const SEED_EMAIL_DOMAIN = 'seed.local.test'
const CHUNK = 500

const requireEnv = (name: string): string => {
    const value = process.env[name]
    if (!value) throw new Error(`Missing required environment variable ${name}`)
    return value
}

/** Splits into batches: a single insert of ~20k rows exceeds the request limit. */
const chunk = <T>(rows: T[], size: number): T[][] => {
    const out: T[][] = []
    for (let i = 0; i < rows.length; i += size) {
        out.push(rows.slice(i, i + size))
    }
    return out
}

/**
 * `onConflict` must name the real unique constraint. supabase-js otherwise
 * targets the primary key, which for these tables is a generated uuid that can
 * never collide -- so the insert reaches the database and trips the *other*
 * unique constraint instead.
 */
const insertAll = async (
    db: SupabaseClient,
    table: string,
    rows: any[],
    onConflict: string,
    merge = false
) => {
    if (rows.length < 1) {
        console.log(`  ${table}: 0 rows`)
        return
    }

    const batches = chunk(rows, CHUNK)
    for (let i = 0; i < batches.length; i += 1) {
        const { error } = await db
            .from(table)
            .upsert(batches[i], { onConflict, ignoreDuplicates: !merge })
        if (error) throw new Error(`${table}: ${error.message}`)
    }
    console.log(`  ${table}: ${rows.length} rows`)
}

const listSeedUsers = async (db: SupabaseClient) => {
    const found: Array<{ id: string; email: string }> = []
    let page = 1

    // The admin API pages at 50 by default and gives no total, so keep going
    // until a short page comes back.
    for (;;) {
        const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 })
        if (error) throw error
        for (const user of data.users) {
            if (user.email && user.email.endsWith(`@${SEED_EMAIL_DOMAIN}`)) {
                found.push({ id: user.id, email: user.email })
            }
        }
        if (data.users.length < 200) break
        page += 1
    }

    return found
}

const clean = async (db: SupabaseClient) => {
    const seeded = await listSeedUsers(db)
    console.log(`Deleting ${seeded.length} seeded accounts...`)

    for (const user of seeded) {
        // Posts, likes, follows and post_views all cascade from auth.users.
        const { error } = await db.auth.admin.deleteUser(user.id)
        if (error) console.warn(`  ${user.email}: ${error.message}`)
    }

    console.log('Done. Real accounts and their content were left alone.')
}

const main = async () => {
    const args = process.argv.slice(2)
    const supabaseUrl = requireEnv('NEXT_PUBLIC_SUPABASE_URL')
    const db = createClient(supabaseUrl, requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
        auth: { autoRefreshToken: false, persistSession: false },
    })

    if (args.indexOf('--clean') !== -1) {
        await clean(db)
        return
    }

    const userCount = 25
    const postCount = 250

    // Reuse whatever media already exists in the bucket. Seeded posts then
    // actually play instead of rendering a black rectangle -- which matters,
    // because a poster/playback regression is invisible against dead keys.
    //
    // The poster and dimensions come along with the key: copying the key alone
    // produces posts that play but have no thumbnail, so every Explore tile
    // downloads video to paint its first frame.
    const { data: existingPosts, error: postsError } = await db
        .from('posts')
        .select('video_url, poster_key, duration_ms, width, height')
        .not('video_url', 'like', 'images:%')
        .is('deleted_at', null)
        .limit(100)
    if (postsError) throw postsError

    // Distinct keys only. Borrowing rows would inherit the existing
    // distribution, so a database where one clip is over-represented would
    // reproduce that skew in every future seed.
    const seenKeys: Record<string, boolean> = {}
    const media: SeedMedia[] = []
    for (const row of existingPosts ?? []) {
        const key = row.video_url as string
        if (!key || seenKeys[key]) continue
        seenKeys[key] = true
        media.push({
            key,
            posterKey: (row.poster_key as string) ?? '',
            durationMs: row.duration_ms as number | null,
            width: row.width as number | null,
            height: row.height as number | null,
        })
    }

    if (media.length < 1) {
        throw new Error(
            'No existing video posts to borrow media from. Upload one video through ' +
            'the app first, or run `npm run media:refresh -- --apply`.'
        )
    }

    const { data: realProfiles, error: profilesError } = await db
        .from('profiles')
        .select('user_id')
        .limit(50)
    if (profilesError) throw profilesError
    const existingUserIds = (realProfiles ?? []).map((row) => row.user_id as string)

    const plan: SeedPlan = planSeed({
        seed: 20260813,
        now: Date.now(),
        userCount,
        postCount,
        media,
        existingUserIds,
    })

    console.log(`Borrowing ${media.length} distinct clips from existing posts.`)

    console.log(`Creating ${plan.users.length} accounts...`)
    const createdIds: string[] = []
    for (const user of plan.users) {
        const { data, error } = await db.auth.admin.createUser({
            email: user.email,
            password: user.password,
            email_confirm: true,
            user_metadata: { name: user.name },
        })

        if (error) {
            // Already exists from a previous run -- reuse it.
            const existing = (await listSeedUsers(db)).filter((u) => u.email === user.email)[0]
            if (!existing) throw error
            createdIds.push(existing.id)
            continue
        }

        createdIds.push(data.user.id)
    }

    // handle_new_user creates the profile row; fill in the bio it cannot know.
    await insertAll(
        db,
        'profiles',
        plan.users.map((user, i) => ({
            user_id: createdIds[i],
            name: user.name,
            image: 'placeholder-avatar.png',
            bio: user.bio,
        })),
        'user_id',
        true
    )

    // Authors are seeded accounts only (so --clean cascades everything away);
    // actors additionally include real accounts, which follow and watch.
    const authorIds = createdIds
    const actorIds = createdIds.concat(existingUserIds)

    console.log('Inserting posts...')
    const postRows = plan.posts.map((post) => ({
        user_id: authorIds[post.authorIndex],
        text: post.text,
        video_url: post.videoUrl,
        poster_key: post.posterKey,
        duration_ms: post.durationMs,
        width: post.width,
        height: post.height,
        created_at: post.createdAt,
    }))

    // Needs the generated ids back to attach engagement, so insert and select.
    const postIds: string[] = []
    for (const batch of chunk(postRows, CHUNK)) {
        const { data, error } = await db.from('posts').insert(batch).select('id')
        if (error) throw new Error(`posts: ${error.message}`)
        for (const row of data ?? []) postIds.push(row.id as string)
    }
    console.log(`  posts: ${postIds.length} rows`)

    await insertAll(
        db,
        'follows',
        plan.follows
            .filter((edge) => actorIds[edge.fromIndex] && authorIds[edge.toIndex])
            .map((edge) => ({
                user_id: actorIds[edge.fromIndex],
                to_user_id: authorIds[edge.toIndex],
            })),
        'user_id,to_user_id'
    )

    const likes: any[] = []
    const saves: any[] = []
    const reposts: any[] = []
    const comments: any[] = []
    const views: any[] = []

    for (const item of plan.engagements) {
        const userId = actorIds[item.userIndex]
        const postId = postIds[item.postIndex]
        if (!userId || !postId) continue

        if (item.liked) likes.push({ user_id: userId, post_id: postId })
        if (item.saved) saves.push({ user_id: userId, post_id: postId })
        if (item.reposted) reposts.push({ user_id: userId, post_id: postId })
        if (item.commented) {
            comments.push({ user_id: userId, post_id: postId, text: item.commented })
        }

        views.push({
            user_id: userId,
            post_id: postId,
            watch_ms: item.watchMs,
            max_completion: item.completion,
            loops: item.completion > 0.95 ? 1 : 0,
            impressions: 1,
            skipped: item.skipped,
        })
    }

    console.log('Inserting engagement...')
    await insertAll(db, 'likes', likes, 'user_id,post_id')
    await insertAll(db, 'saves', saves, 'user_id,post_id')
    await insertAll(db, 'reposts', reposts, 'user_id,post_id')
    // comments has no natural unique key -- one person may comment twice.
    await insertAll(db, 'comments', comments, 'id')
    await insertAll(db, 'post_views', views, 'user_id,post_id')

    // post_views was written directly rather than through record_watch, so the
    // RPC's first-insert guard never ran and view_count/share_count are still
    // zero. Counter triggers covered likes/comments/saves/reposts already;
    // this reconciles the rest from ground truth.
    const { error: reconcileError } = await db.rpc('reconcile_counters')
    if (reconcileError) throw reconcileError

    const { data: refreshed, error: refreshError } = await db.rpc('refresh_post_scores', {
        p_since: '3650 days',
    })
    if (refreshError) throw refreshError
    console.log(`Refreshed ${refreshed} post scores.`)

    console.log('\nSeed complete. Log in as any seeded account with:')
    console.log(`  email:    ${plan.users[0].email}`)
    console.log(`  password: ${plan.users[0].password}`)
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})

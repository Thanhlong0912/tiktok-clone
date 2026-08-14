/**
 * Deterministic planning for the media refresh.
 *
 * Pure: no IO, no Date.now(), no Math.random(). The orchestrator in refresh.ts
 * probes the bucket and writes the database; everything decided here -- which
 * clip lands on which post, what its caption says, which profile gets which
 * avatar -- derives from the seed, so a report run and the --apply run that
 * follows it produce byte-identical plans.
 */

/**
 * The topics that actually exist in the bucket. Deliberately NOT the generic
 * TikTok topic list: captions are generated from whichever topic a clip was
 * tagged with, so a vocabulary wider than the footage is what produced the
 * "cat nap #pets" caption over a street-market clip that this refresh fixes.
 */
export type Topic = 'ootd' | 'travel' | 'cafe' | 'beauty' | 'dance' | 'daily' | 'vibes'

/**
 * Hand-tagged from a frame sampled out of every clip. A map rather than
 * anything inferred: there is no classifier here, and a wrong guess is exactly
 * the caption/footage mismatch being repaired.
 */
export const VIDEO_TOPICS: Record<string, Topic> = {
    'video/1.mp4': 'travel',
    'video/2.mp4': 'vibes',
    'video/3.mp4': 'ootd',
    'video/4.mp4': 'cafe',
    'video/5.mp4': 'ootd',
    'video/6.mp4': 'beauty',
    'video/7.mp4': 'travel',
    'video/8.mp4': 'ootd',
    'video/9.mp4': 'travel',
    'video/10.mp4': 'travel',
    'video/11.mp4': 'ootd',
    'video/12.mp4': 'daily',
    'video/13.mp4': 'daily',
    'video/14.mp4': 'beauty',
    'video/15.mp4': 'vibes',
    'video/16.mp4': 'travel',
    'video/17.mp4': 'ootd',
    'video/18.mp4': 'beauty',
    'video/19.mp4': 'cafe',
    'video/20.mp4': 'cafe',
    'video/21.mp4': 'cafe',
    'video/22.mp4': 'daily',
    'video/24.mp4': 'ootd',
    'video/25.mp4': 'vibes',
    'video/26.mp4': 'travel',
    'video/27.mp4': 'dance',
    'video/28.mp4': 'dance',
    'video/29.mp4': 'dance',
    'video/30.mp4': 'ootd',
    'video/31.mp4': 'ootd',
    'video/32.mp4': 'vibes',
    'video/33.mp4': 'travel',
    'video/34.mp4': 'travel',
    'video/35.mp4': 'cafe',
    'video/36.mp4': 'beauty',
    'video/37.mp4': 'beauty',
}

/**
 * Excluded by hand, for reasons a probe cannot see. Codec and orientation are
 * checked separately in isSuitableVideo -- this list is only for clips that
 * decode fine but do not belong in a feed.
 */
export const EXCLUDED_VIDEOS: Record<string, string> = {
    'video/23.mp4': 'screen recording of another app\'s UI, not feed content',
}

/** Images carrying a third-party watermark. Excluded from slideshow posts. */
export const EXCLUDED_IMAGES: Record<string, string> = {
    'image/47dd47b0d66c2fa641e03e370bcb5433.jpg': 'Xiaohongshu watermark (小红书号: 270798371)',
    'image/84dc62de850a34a9d420c97f3a2d58f4.jpg': 'Weibo watermark (@壁纸朵朵)',
}

export type VideoAsset = {
    key: string
    width: number
    height: number
    durationMs: number
    codec: string
}

export type SuitabilityVerdict = { suitable: true } | { suitable: false; reason: string }

/**
 * Browsers are the constraint, not the file. h264 is the only codec every
 * target browser decodes in a <video> tag -- Chrome and Firefox refuse hevc --
 * and a landscape clip letterboxes into black bars in a 9:16 feed, so both
 * failures are silent at the database level and only visible on screen.
 */
export const isSuitableVideo = (asset: VideoAsset): SuitabilityVerdict => {
    const excluded = EXCLUDED_VIDEOS[asset.key]
    if (excluded) {
        return { suitable: false, reason: excluded }
    }

    if (asset.codec !== 'h264') {
        return {
            suitable: false,
            reason: `codec ${asset.codec} does not decode in Chrome or Firefox`,
        }
    }

    if (asset.width <= 0 || asset.height <= 0) {
        return { suitable: false, reason: 'unreadable dimensions' }
    }

    if (asset.width >= asset.height) {
        return {
            suitable: false,
            reason: `landscape ${asset.width}x${asset.height}, letterboxes in a 9:16 feed`,
        }
    }

    if (!VIDEO_TOPICS[asset.key]) {
        return { suitable: false, reason: 'untagged: no topic, so no caption can match it' }
    }

    return { suitable: true }
}

/** mulberry32 -- same generator as scripts/seed/plan.ts, same reasons. */
export const createRng = (seed: number): (() => number) => {
    let a = seed >>> 0
    return function next() {
        a = (a + 0x6d2b79f5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

/** Fisher-Yates, in place on a copy. */
export const shuffle = <T,>(items: T[], rng: () => number): T[] => {
    const out = items.slice()
    for (let i = out.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1))
        const swap = out[i]
        out[i] = out[j]
        out[j] = swap
    }
    return out
}

const PHRASES: Record<Topic, string[]> = {
    ootd: [
        'fit check', 'this dress spins so well', 'white on white kind of day',
        'styling one dress three ways', 'thrifted the whole look',
        'lace season is back', 'the sleeves made this fit',
    ],
    travel: [
        'found this spot by accident', 'sunset was worth the drive',
        'walking the old town at golden hour', 'sea air fixes everything',
        'the view up here is unreal', 'day trip, no plan',
        'somewhere between the mountains and the clouds',
    ],
    cafe: [
        'iced latte and nowhere to be', 'this cafe has the best corner seat',
        'coffee run before work', 'flowers on every table here',
        'the little cafe on the corner', 'street food and cold brew',
    ],
    beauty: [
        'soft glam for once', 'this lip shade lives in my bag',
        'no filter needed today', 'trying a warmer base',
        'hair finally cooperated', 'glow check',
    ],
    dance: [
        'learned this in ten minutes', 'the chorus hits different',
        'trying the trend one more time', 'my version of the routine',
        'hands were doing their own thing', 'one take, no notes',
    ],
    daily: [
        'a normal day in my life', 'study with me for a bit',
        'romanticizing the small stuff', 'slow morning kind of energy',
        'writing it all down again', 'nothing happened and that was nice',
    ],
    vibes: [
        'the song stayed in my head all day', 'quiet moment',
        'sound on for this one', 'this light lasted about a minute',
        'saving this feeling for later', 'close your eyes and listen',
    ],
}

/** Secondary hashtags that read naturally on any of the topics above. */
const SECOND_TAGS = ['fyp', 'viral', 'aesthetic', 'trending', 'foryou', 'vlog']

export const captionFor = (topic: Topic, rng: () => number): string => {
    const phrases = PHRASES[topic]
    const phrase = phrases[Math.floor(rng() * phrases.length)]
    const second = SECOND_TAGS[Math.floor(rng() * SECOND_TAGS.length)]
    return `${phrase} #${topic} #${second}`
}

export type PostInput = {
    id: string
    userId: string
}

export type PostAssignment = {
    id: string
    userId: string
    videoKey: string
    posterKey: string
    durationMs: number
    width: number
    height: number
    text: string
}

export type ImagePostPlan = {
    id: string
    videoKey: string
    posterKey: string
    durationMs: number
    width: number
    height: number
    text: string
}

export type AvatarPlan = {
    userId: string
    /** Clip the face crop is taken from -- one the profile actually authored. */
    sourceVideoKey: string
    avatarKey: string
}

export type RefreshPlan = {
    posts: PostAssignment[]
    imagePosts: ImagePostPlan[]
    avatars: AvatarPlan[]
    /** videoKey -> how many posts landed on it, for the even-spread report. */
    usage: Record<string, number>
}

/**
 * Round-robin over a shuffled catalogue rather than an independent random draw
 * per post. A uniform draw over 36 clips and 250 posts leaves some clips used
 * twice and others fifteen times purely by chance, which reads as "the seed
 * data is broken" when scrolling. This keeps every clip within one use of
 * every other.
 */
export const assignVideos = (
    posts: PostInput[],
    videos: VideoAsset[],
    rng: () => number
): PostAssignment[] => {
    if (videos.length === 0) {
        throw new Error(
            'No suitable videos to assign. Every post would keep its current ' +
            'reference, so refusing to plan rather than writing a broken feed.'
        )
    }

    // Enough copies to cover every post, reshuffled per cycle so the running
    // order differs between passes instead of repeating 1..36, 1..36.
    const pool: string[] = []
    while (pool.length < posts.length) {
        for (const key of shuffle(videos.map((video) => video.key), rng)) {
            pool.push(key)
        }
    }

    const byKey: Record<string, VideoAsset> = {}
    for (const video of videos) byKey[video.key] = video

    const lastByAuthor: Record<string, string> = {}
    const assignments: PostAssignment[] = []

    for (let i = 0; i < posts.length; i += 1) {
        const post = posts[i]

        // Two posts in a row from the same creator showing the same clip is the
        // most visible artefact of seeded data on a profile grid, so swap it
        // forward with the next pool entry that differs.
        if (pool[i] === lastByAuthor[post.userId]) {
            for (let j = i + 1; j < pool.length; j += 1) {
                if (pool[j] !== pool[i]) {
                    const swap = pool[i]
                    pool[i] = pool[j]
                    pool[j] = swap
                    break
                }
            }
        }

        const videoKey = pool[i]
        const asset = byKey[videoKey]
        const topic = VIDEO_TOPICS[videoKey]

        assignments.push({
            id: post.id,
            userId: post.userId,
            videoKey,
            posterKey: posterKeyFor(videoKey),
            durationMs: asset.durationMs,
            width: asset.width,
            height: asset.height,
            text: captionFor(topic, rng),
        })

        lastByAuthor[post.userId] = videoKey
    }

    return assignments
}

/**
 * Derived from the video key rather than random, so re-running the refresh
 * overwrites the same poster object instead of uploading a second copy and
 * orphaning the first.
 */
export const posterKeyFor = (videoKey: string): string => {
    const slug = videoKey.replace(/^video\//, '').replace(/\.[^.]+$/, '')
    return `image/poster-${slug}.webp`
}

/** Same reasoning as posterKeyFor: stable across runs, so re-runs are idempotent. */
export const avatarKeyFor = (userId: string): string => `avatar/seed-${userId}.webp`

export const IMAGE_SLIDE_MS = 3000

/**
 * Turns one post into an image carousel.
 *
 * `media_kind` is a generated column keyed off the 'images:' prefix, so writing
 * this value is all it takes to move the post onto the ImageSlideshow path in
 * the feed and Explore -- no separate flag to keep in sync.
 */
export const planImagePost = (
    post: PostInput,
    imageKeys: string[],
    dimensions: { width: number; height: number },
    text: string
): ImagePostPlan => {
    if (imageKeys.length === 0) {
        throw new Error('An image post needs at least one image key.')
    }

    return {
        id: post.id,
        videoKey: `images:${imageKeys.join(',')}`,
        // Notifications and the activity feed read poster_key directly and have
        // no slideshow to fall back on, so the first slide stands in as cover.
        posterKey: imageKeys[0],
        durationMs: imageKeys.length * IMAGE_SLIDE_MS,
        width: dimensions.width,
        height: dimensions.height,
        text,
    }
}

/**
 * How tightly each topic frames its subject, best first.
 *
 * The avatar crop is a fixed geometric square with no face detection behind it,
 * so the shot type decides whether it lands on a face: a 'beauty' close-up
 * fills the frame, while a 'travel' wide shot puts the subject far from centre
 * and crops to scenery. Choosing the source clip by topic is what keeps that
 * from happening, since every author here posts across several topics anyway.
 */
const AVATAR_TOPIC_PREFERENCE: Topic[] = [
    'beauty', 'daily', 'dance', 'cafe', 'ootd', 'vibes', 'travel',
]

/**
 * One avatar per profile, cropped from a clip that profile actually authored,
 * so the face in the bubble matches the face in their posts.
 *
 * Sources are kept unique across profiles. Every clip is posted by six or seven
 * different authors, so picking each author's best clip independently hands the
 * same face to several profiles at once -- which is far more obvious in a
 * comment thread than a slightly worse crop is.
 */
export const planAvatars = (
    postsByAuthor: Record<string, string[]>,
    rng: () => number
): AvatarPlan[] => {
    const rank = (key: string) => {
        const index = AVATAR_TOPIC_PREFERENCE.indexOf(VIDEO_TOPICS[key])
        return index === -1 ? AVATAR_TOPIC_PREFERENCE.length : index
    }

    const candidatesFor = (userId: string) => {
        const distinct = Array.from(new Set(postsByAuthor[userId]))
        // Shuffled before the sort so authors whose clips tie on topic do not
        // all settle on whichever key happens to sort first.
        return shuffle(distinct, rng).sort((a, b) => rank(a) - rank(b))
    }

    const authors = Object.keys(postsByAuthor).sort()
    const options: Record<string, string[]> = {}
    for (const userId of authors) options[userId] = candidatesFor(userId)

    // Fewest options first: an author with two clips to choose from can be left
    // with nothing if the authors with ten pick first.
    const order = authors
        .slice()
        .sort((a, b) => options[a].length - options[b].length || a.localeCompare(b))

    const taken: Record<string, boolean> = {}
    const chosen: Record<string, string> = {}

    for (const userId of order) {
        const candidates = options[userId]
        if (candidates.length === 0) continue

        // Falls back to a duplicate only when every clip this author posted is
        // already spoken for -- better a repeated face than no face.
        const pick = candidates.filter((key) => !taken[key])[0] ?? candidates[0]
        taken[pick] = true
        chosen[userId] = pick
    }

    return authors
        .filter((userId) => chosen[userId])
        .map((userId) => ({
            userId,
            sourceVideoKey: chosen[userId],
            avatarKey: avatarKeyFor(userId),
        }))
}

export type BioPlan = {
    userId: string
    topic: Topic
    bio: string
}

/**
 * Rewrites each seeded bio to the topic that profile actually posts.
 *
 * The existing bios were generated from the old topic list, so accounts
 * introduce themselves as "gaming creator" or "music creator" above a grid of
 * outfit and travel clips -- and neither topic has a single video behind it.
 * Keeps the original "<topic> creator. seeded account." wording so the bios
 * stay obviously synthetic.
 */
export const planBios = (postsByAuthor: Record<string, string[]>): BioPlan[] => {
    const plans: BioPlan[] = []

    for (const userId of Object.keys(postsByAuthor).sort()) {
        const counts: Partial<Record<Topic, number>> = {}

        for (const key of postsByAuthor[userId]) {
            const topic = VIDEO_TOPICS[key]
            if (topic) counts[topic] = (counts[topic] ?? 0) + 1
        }

        const ranked = (Object.keys(counts) as Topic[]).sort(
            // Alphabetical tiebreak, so the result does not depend on the order
            // posts happened to be assigned in.
            (a, b) => (counts[b] ?? 0) - (counts[a] ?? 0) || a.localeCompare(b)
        )

        if (ranked.length === 0) continue

        plans.push({
            userId,
            topic: ranked[0],
            bio: `${ranked[0]} creator. seeded account.`,
        })
    }

    return plans
}

export const countUsage = (assignments: PostAssignment[]): Record<string, number> => {
    const usage: Record<string, number> = {}
    for (const assignment of assignments) {
        usage[assignment.videoKey] = (usage[assignment.videoKey] ?? 0) + 1
    }
    return usage
}

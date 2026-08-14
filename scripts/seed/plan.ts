/**
 * Deterministic generation of a synthetic social graph.
 *
 * Pure: no IO, no Date.now(), no Math.random(). Everything derives from the
 * seed and the `now` passed in, so a run is reproducible and the shape of the
 * data can be asserted in tests without touching a database.
 */

import { captionFor, VIDEO_TOPICS, type Topic } from '../media/refreshPlan'

/**
 * A clip to hand out, carried with the metadata the post row needs.
 *
 * Not just the key: a seeded post that copies the key but leaves poster_key
 * empty puts a thumbnail-less tile on Explore, which then downloads video bytes
 * to paint its first frame.
 */
export interface SeedMedia {
  key: string
  posterKey: string
  durationMs: number | null
  width: number | null
  height: number | null
}

export interface SeedOptions {
  seed: number
  /** Reference time; all created_at values are offsets back from this. */
  now: number
  userCount: number
  postCount: number
  /** Clips to cycle through for post media. */
  media: SeedMedia[]
  /** Existing user ids to weave into the graph so real accounts get content. */
  existingUserIds?: string[]
}

export interface PlannedUser {
  index: number
  email: string
  password: string
  name: string
  bio: string
}

export interface PlannedPost {
  /**
   * Index into the PLANNED users only. Real accounts never author seeded
   * posts, so deleting the seeded accounts cascades every seeded post away and
   * `--clean` is a complete undo.
   */
  authorIndex: number
  text: string
  videoUrl: string
  posterKey: string
  durationMs: number | null
  width: number | null
  height: number | null
  createdAt: string
  /** 0..1 intrinsic appeal, drives how much synthetic engagement it attracts. */
  appeal: number
}

export interface PlannedEdge {
  fromIndex: number
  toIndex: number
}

export interface PlannedEngagement {
  userIndex: number
  postIndex: number
  liked: boolean
  saved: boolean
  reposted: boolean
  commented: string | null
  watchMs: number
  completion: number
  skipped: boolean
}

export interface SeedPlan {
  users: PlannedUser[]
  posts: PlannedPost[]
  follows: PlannedEdge[]
  engagements: PlannedEngagement[]
}

/** mulberry32 -- small, fast, good enough, and identical across runs. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Shared with the media refresh rather than defined twice.
 *
 * These are the topics the bucket's footage actually covers. A wider list --
 * pets, gaming, cooking -- generates captions with no clip behind them, which
 * is how "cat nap #pets" ended up over a street-market video.
 */
const TOPICS: Topic[] = ['ootd', 'travel', 'cafe', 'beauty', 'dance', 'daily', 'vibes']

const FIRST_NAMES = [
  'Mai', 'Linh', 'Duc', 'Huy', 'Trang', 'Nam', 'Thao', 'Khanh', 'Quan', 'Ngoc',
  'Riley', 'Jordan', 'Casey', 'Avery', 'Rowan', 'Skyler', 'Devon', 'Emerson',
]
const LAST_NAMES = [
  'Pham', 'Vo', 'Dang', 'Bui', 'Ho', 'Ly', 'Duong', 'Cao',
  'Reyes', 'Okafor', 'Silva', 'Haddad', 'Novak', 'Ito',
]

const COMMENTS = [
  'this is unreal',
  'how did you do that',
  'saving this for later',
  'first!',
  'the transition though',
  'need a part 2',
  'okay this is actually helpful',
  'sound on was the right call',
]

function pick<T>(rng: () => number, items: T[]): T {
  return items[Math.floor(rng() * items.length)]
}

export function planSeed(options: SeedOptions): SeedPlan {
  const rng = createRng(options.seed)
  const existing = options.existingUserIds ?? []

  if (options.media.length === 0) {
    throw new Error('planSeed needs at least one clip to hand out.')
  }

  const users: PlannedUser[] = []
  for (let i = 0; i < options.userCount; i += 1) {
    const first = pick(rng, FIRST_NAMES)
    const last = pick(rng, LAST_NAMES)
    const topic = TOPICS[i % TOPICS.length]
    users.push({
      index: i,
      // The seed.local.test domain is reserved for these accounts so the
      // script can find and delete exactly what it created.
      email: `seed${i}@seed.local.test`,
      password: `seed-pw-${options.seed}-${i}`,
      name: `${first} ${last}`,
      bio: `${topic} creator. seeded account.`,
    })
  }

  // Real accounts participate as viewers and followers -- which is what a
  // personalised feed needs -- but never as authors.
  const authorCount = users.length
  const actorCount = users.length + existing.length

  const posts: PlannedPost[] = []
  for (let i = 0; i < options.postCount; i += 1) {
    const authorIndex = Math.floor(rng() * authorCount)
    const media = options.media[i % options.media.length]

    // The caption follows the CLIP, not the author. Deriving it from the author
    // is what let a post describe something the video never shows; an untagged
    // clip falls back to a topic so the text at least stays generic rather than
    // asserting something specific and wrong.
    const topic = VIDEO_TOPICS[media.key] ?? pick(rng, TOPICS)

    // Spread over 21 days, skewed towards recent so freshness decay and the
    // under-6h exploration bonus both have something to act on.
    const ageHours = Math.floor(Math.pow(rng(), 2) * 21 * 24)

    posts.push({
      authorIndex,
      text: captionFor(topic, rng),
      videoUrl: media.key,
      posterKey: media.posterKey,
      durationMs: media.durationMs,
      width: media.width,
      height: media.height,
      createdAt: new Date(options.now - ageHours * 3600 * 1000).toISOString(),
      // Long tail: most posts are unremarkable, a few are hits.
      appeal: Math.pow(rng(), 3),
    })
  }

  // Follows: everyone follows a handful of others, biased towards low indices
  // so the graph has hubs rather than being uniform.
  const follows: PlannedEdge[] = []
  const seenEdges: Record<string, boolean> = {}
  for (let from = 0; from < actorCount; from += 1) {
    const degree = 2 + Math.floor(rng() * 6)
    for (let n = 0; n < degree; n += 1) {
      // Only creators are worth following, and the square biases towards low
      // indices so the graph grows hubs instead of being uniform.
      const to = Math.floor(Math.pow(rng(), 2) * authorCount)
      const key = `${from}:${to}`
      if (from === to || seenEdges[key]) continue
      seenEdges[key] = true
      follows.push({ fromIndex: from, toIndex: to })
    }
  }

  // Engagement: a sample of viewers per post, with watch behaviour correlated
  // to appeal so the ranking has a real signal to find rather than noise.
  const engagements: PlannedEngagement[] = []
  for (let postIndex = 0; postIndex < posts.length; postIndex += 1) {
    const post = posts[postIndex]
    const viewers = 3 + Math.floor(rng() * 12 + post.appeal * 25)

    for (let v = 0; v < viewers; v += 1) {
      const userIndex = Math.floor(rng() * actorCount)
      if (userIndex === post.authorIndex) continue

      const engaged = rng() < 0.15 + post.appeal * 0.6
      const completion = engaged
        ? Math.min(1, 0.5 + rng() * 0.5 + post.appeal * 0.3)
        : rng() * 0.35

      engagements.push({
        userIndex,
        postIndex,
        liked: engaged && rng() < 0.55,
        saved: engaged && rng() < 0.12,
        reposted: engaged && rng() < 0.06,
        commented: engaged && rng() < 0.18 ? pick(rng, COMMENTS) : null,
        watchMs: Math.round(completion * (8000 + rng() * 20000)),
        completion,
        skipped: !engaged && completion < 0.15,
      })
    }
  }

  return { users, posts, follows, engagements }
}

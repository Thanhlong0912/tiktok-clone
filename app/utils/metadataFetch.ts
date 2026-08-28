import type { Metadata } from 'next'
import { createBucketUrl } from '../hooks/useCreateBucketUrl'
import { postCard, profileCard, type SocialCard } from './socialCard'

/**
 * Server-side reads for link previews, and nothing else.
 *
 * This is the one place the app talks to Postgres from a server. It exists
 * because every interactive page is a client component, so a crawler that
 * fetches a post or profile URL receives markup with no post and no profile in
 * it -- which is why every shared link used to unfurl to the same generic card.
 *
 * It does NOT reopen the no-server-tier decision. There is no server client, no
 * session, and no service-role key: these are plain POSTs to the same
 * SECURITY DEFINER RPCs the browser calls, executed as `anon`, which
 * 0003 and 0011 already grant. The definer functions' own `deleted_at is null`
 * and block predicates still apply, so this can only ever see what a logged-out
 * visitor could see -- exactly the right audience for a public preview.
 *
 * Never throws. A metadata failure must degrade to the generic app card, never
 * take a page down: generateMetadata runs on the request path for real viewers,
 * not only for crawlers.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

/** Long enough that a link doing the rounds does not hammer the database,
 *  short enough that a fresh post's counts are not badly stale in a card. */
const REVALIDATE_SECONDS = 300

async function callRpc<T>(fn: string, body: Record<string, unknown>): Promise<T | null> {
  if (!SUPABASE_URL || !ANON_KEY) return null

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      next: { revalidate: REVALIDATE_SECONDS },
    })

    if (!response.ok) return null
    return (await response.json()) as T
  } catch {
    // Network, DNS, timeout. The caller falls back to the generic card.
    return null
  }
}

interface FeedPostRow {
  text: string | null
  poster_key: string | null
  profile_name: string | null
  like_count: number | null
  comment_count: number | null
}

interface ProfileRow {
  name: string | null
  handle: string | null
  bio: string | null
  image: string | null
  follower_count: number | null
  total_likes: number | string | null
}

/**
 * Turns a card into the tags a crawler reads, or hands back the caller's
 * fallback when there was nothing to build one from -- a deleted post, a bad
 * id, an unreachable database. `summary_large_image` is claimed only when
 * there is actually a large image to show; promising one and supplying none
 * renders as an empty box on Twitter and Slack.
 */
export function toMetadata(card: SocialCard | null, fallback: Metadata): Metadata {
  if (!card) return fallback

  const images = card.image ? [card.image] : undefined

  return {
    title: card.title,
    description: card.description,
    openGraph: {
      title: card.title,
      description: card.description,
      images,
    },
    twitter: {
      card: card.image ? 'summary_large_image' : 'summary',
      title: card.title,
      description: card.description,
      images,
    },
  }
}

/** A uuid, checked before it reaches the database: these ids come straight
 *  from the URL, and a malformed one makes the RPC raise rather than return
 *  empty -- a 500 in the logs for what is really just a bad link. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function fetchPostCard(postId: string): Promise<SocialCard | null> {
  if (!UUID.test(postId)) return null

  const rows = await callRpc<FeedPostRow[]>('get_post', { p_post_id: postId })
  const row = rows?.[0]
  if (!row) return null

  return postCard({
    text: row.text ?? '',
    authorName: row.profile_name ?? '',
    likeCount: row.like_count ?? 0,
    commentCount: row.comment_count ?? 0,
    posterUrl: row.poster_key ? createBucketUrl(row.poster_key) : '',
  })
}

export async function fetchProfileCard(userId: string): Promise<SocialCard | null> {
  if (!UUID.test(userId)) return null

  const rows = await callRpc<ProfileRow[]>('get_profile', { p_user_id: userId })
  const row = rows?.[0]
  if (!row) return null

  return profileCard({
    name: row.name ?? '',
    handle: row.handle ?? '',
    bio: row.bio ?? '',
    followerCount: row.follower_count ?? 0,
    // bigint, so PostgREST may serialise it as a string.
    totalLikes: Number(row.total_likes ?? 0),
    imageUrl: row.image ? createBucketUrl(row.image) : '',
  })
}

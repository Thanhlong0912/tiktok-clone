import { supabase } from '@/libs/supabase'
import { toRpcCursor, type FeedCursor } from './feedCursor'
import type { PostWithProfile } from '../types'

/**
 * Access layer for the feed RPCs.
 *
 * Every function here is ONE round trip. That is the whole point: the previous
 * implementation fetched 100 posts, then one profile per post, then five more
 * requests per rendered card -- roughly 900 requests to paint a desktop feed.
 * get_feed returns the posts, their authors, their counters and this viewer's
 * like/save/repost/follow flags in a single call.
 */

/** Raw shape of public.feed_post as PostgREST serialises it. */
interface FeedPostRow {
  id: string
  user_id: string
  video_url: string
  poster_key: string | null
  media_kind: string | null
  text: string | null
  duration_ms: number | null
  width: number | null
  height: number | null
  created_at: string
  like_count: number
  comment_count: number
  save_count: number
  repost_count: number
  share_count: number
  view_count: number
  profile_name: string | null
  profile_image: string | null
  is_liked: boolean
  is_saved: boolean
  is_reposted: boolean
  is_following: boolean
  score: string | number | null
}

/**
 * Flattens a feed_post row into the nested shape the components already use.
 * Keeping `profile` nested means PostMain, the profile grid and the detail
 * page did not have to change how they read an author.
 */
export function toPostWithProfile(row: FeedPostRow): PostWithProfile {
  return {
    id: row.id,
    user_id: row.user_id,
    video_url: row.video_url,
    text: row.text ?? '',
    created_at: row.created_at,
    poster_key: row.poster_key ?? '',
    media_kind: row.media_kind === 'image' ? 'image' : 'video',
    duration_ms: row.duration_ms,
    width: row.width,
    height: row.height,
    like_count: row.like_count ?? 0,
    comment_count: row.comment_count ?? 0,
    save_count: row.save_count ?? 0,
    repost_count: row.repost_count ?? 0,
    share_count: row.share_count ?? 0,
    view_count: row.view_count ?? 0,
    is_liked: Boolean(row.is_liked),
    is_saved: Boolean(row.is_saved),
    is_reposted: Boolean(row.is_reposted),
    is_following: Boolean(row.is_following),
    // Kept as the exact string the server sent -- see app/utils/feedCursor.ts.
    score: row.score === null || row.score === undefined ? '' : String(row.score),
    profile: {
      user_id: row.user_id,
      name: row.profile_name ?? '',
      image: row.profile_image ?? '',
    },
  }
}

const mapRows = (data: unknown): PostWithProfile[] =>
  ((data as FeedPostRow[]) ?? []).map(toPostWithProfile)

export type FeedKind = 'for-you' | 'following'

export interface FeedPage {
  posts: PostWithProfile[]
  /** The session get_feed used, so the next page can dedup against it. */
  session: string
}

export async function fetchFeed(
  kind: FeedKind,
  cursor: FeedCursor | null,
  session: string,
  limit = 8
): Promise<PostWithProfile[]> {
  if (kind === 'following') {
    const { data, error } = await supabase.rpc('get_following_feed', {
      p_cursor: cursor ? { ts: cursor.sc, id: cursor.id } : null,
      p_limit: limit,
    })
    if (error) throw error
    return mapRows(data)
  }

  const { data, error } = await supabase.rpc('get_feed', {
    p_cursor: toRpcCursor(cursor),
    p_limit: limit,
    p_session: session,
  })
  if (error) throw error
  return mapRows(data)
}

export async function fetchPost(postId: string): Promise<PostWithProfile | null> {
  const { data, error } = await supabase.rpc('get_post', { p_post_id: postId })
  if (error) throw error

  const rows = mapRows(data)
  return rows.length > 0 ? rows[0] : null
}

export type ProfileTab = 'posts' | 'liked' | 'saved' | 'reposts'

export async function fetchUserPosts(
  userId: string,
  tab: ProfileTab,
  cursor: { ts: string; id: string } | null,
  limit = 24
): Promise<PostWithProfile[]> {
  const { data, error } = await supabase.rpc('get_user_posts', {
    p_user_id: userId,
    p_tab: tab,
    p_cursor: cursor,
    p_limit: limit,
  })
  if (error) throw error
  return mapRows(data)
}

export interface ProfileSummary {
  user_id: string
  name: string
  image: string
  bio: string
  follower_count: number
  following_count: number
  post_count: number
  total_likes: number
  is_following: boolean
  is_blocked: boolean
  is_self: boolean
}

export async function fetchProfile(userId: string): Promise<ProfileSummary | null> {
  const { data, error } = await supabase.rpc('get_profile', { p_user_id: userId })
  if (error) throw error

  const rows = (data as ProfileSummary[]) ?? []
  return rows.length > 0 ? rows[0] : null
}

/**
 * Fire-and-forget: the feed must never stall or surface an error because a
 * watch sample failed to record. The RPC is a silent no-op for logged-out
 * callers, so there is nothing to check for.
 */
export function recordWatch(input: {
  postId: string
  watchMs: number
  completion: number
  loops: number
  skipped: boolean
}): void {
  void supabase
    .rpc('record_watch', {
      p_post_id: input.postId,
      p_watch_ms: input.watchMs,
      p_completion: input.completion,
      p_loops: input.loops,
      p_skipped: input.skipped,
    })
    .then(({ error }) => {
      if (error) console.error('record_watch', error)
    })
}

export function recordShare(postId: string): void {
  void supabase.rpc('record_share', { p_post_id: postId }).then(({ error }) => {
    if (error) console.error('record_share', error)
  })
}

export async function markNotInterested(postId: string, reason = 'not_interested'): Promise<void> {
  const { error } = await supabase.rpc('mark_not_interested', {
    p_post_id: postId,
    p_reason: reason,
  })
  if (error) throw error
}

export type ReportReason =
  | 'spam'
  | 'nudity'
  | 'violence'
  | 'hate'
  | 'harassment'
  | 'misinformation'
  | 'ip'
  | 'other'

export const REPORT_REASONS: Array<{ value: ReportReason; label: string }> = [
  { value: 'spam', label: 'Spam or scam' },
  { value: 'nudity', label: 'Nudity or sexual content' },
  { value: 'violence', label: 'Violence or dangerous acts' },
  { value: 'hate', label: 'Hate speech or symbols' },
  { value: 'harassment', label: 'Harassment or bullying' },
  { value: 'misinformation', label: 'Misinformation' },
  { value: 'ip', label: 'Intellectual property' },
  { value: 'other', label: 'Something else' },
]

/**
 * Returns the new report id, or null when this user already reported the same
 * target. Null is SUCCESS, not failure -- the UI acknowledges either way.
 */
export async function reportContent(
  targetType: 'post' | 'user' | 'comment',
  targetId: string,
  reason: ReportReason,
  details = ''
): Promise<string | null> {
  const { data, error } = await supabase.rpc('report_content', {
    p_target_type: targetType,
    p_target_id: targetId,
    p_reason: reason,
    p_details: details,
  })
  if (error) throw error
  return (data as string) ?? null
}

export interface TrendingHashtag {
  tag: string
  post_count: number
  recent_count: number
  engagement: number
}

export async function fetchTrendingHashtags(limit = 20): Promise<TrendingHashtag[]> {
  const { data, error } = await supabase.rpc('get_trending_hashtags', { p_limit: limit })
  if (error) throw error
  return (data as TrendingHashtag[]) ?? []
}

export interface TrendingCreator {
  user_id: string
  name: string
  image: string
  bio: string
  follower_count: number
  post_count: number
  recent_engagement: number
  is_following: boolean
}

export async function fetchTrendingCreators(limit = 10): Promise<TrendingCreator[]> {
  const { data, error } = await supabase.rpc('get_trending_creators', { p_limit: limit })
  if (error) throw error
  return (data as TrendingCreator[]) ?? []
}

export interface SearchUserResult {
  user_id: string
  name: string
  image: string
  bio: string
  follower_count: number
  is_following: boolean
  rank: number
}

export interface SearchResults {
  users: SearchUserResult[]
  hashtags: Array<{ tag: string; post_count: number }>
  videos: PostWithProfile[]
}

/** Empty for queries under 2 characters: a trigram index cannot serve those. */
export async function searchAll(query: string): Promise<SearchResults> {
  const clean = query.trim().slice(0, 80)
  if (clean.length < 2) {
    return { users: [], hashtags: [], videos: [] }
  }

  const { data, error } = await supabase.rpc('search_top', { p_query: clean })
  if (error) throw error

  const payload = (data as any) ?? {}
  return {
    users: payload.users ?? [],
    hashtags: payload.hashtags ?? [],
    videos: ((payload.videos ?? []) as FeedPostRow[]).map(toPostWithProfile),
  }
}

export async function fetchPostsByHashtag(
  tag: string,
  cursor: { ts: string; id: string } | null,
  limit = 24
): Promise<PostWithProfile[]> {
  const { data, error } = await supabase.rpc('get_posts_by_hashtag', {
    p_tag: tag,
    p_cursor: cursor,
    p_limit: limit,
  })
  if (error) throw error
  return mapRows(data)
}

export async function searchVideos(
  query: string,
  cursor: { sc: string; id: string } | null,
  limit = 24
): Promise<PostWithProfile[]> {
  const clean = query.trim().slice(0, 80)
  if (clean.length < 2) return []

  const { data, error } = await supabase.rpc('search_videos', {
    p_query: clean,
    p_cursor: cursor,
    p_limit: limit,
  })
  if (error) throw error
  return mapRows(data)
}

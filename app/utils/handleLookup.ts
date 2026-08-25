import { supabase } from '@/libs/supabase'

/**
 * Client-side handle resolution for feed-shaped data.
 *
 * get_feed, get_following_feed, get_post, get_posts_by_hashtag,
 * get_user_posts and search_videos all return SETOF feed_post, and feed_post
 * carries its profile columns through ranking CTEs where `pr` (the join to
 * public.profiles) is not in scope -- threading a handle through that would
 * mean editing ranking logic for a column those RPCs otherwise have no need
 * of. So a post's author handle is resolved here instead, one batched query
 * at a time, rather than in the RPC that returned the post.
 *
 * profiles is publicly readable (see 0006's grants), so this works logged
 * out exactly like the RPCs above it.
 */

const cache = new Map<string, string>()

/**
 * Resolves a batch of user ids to their current handle. Ids already cached
 * are never re-fetched; an id that resolves to nothing (deleted account,
 * bad id) simply stays absent from both the cache and the result, so a
 * caller sees it missing rather than mapped to an empty string.
 */
export async function getHandles(userIds: string[]): Promise<Record<string, string>> {
  const uniqueIds = Array.from(new Set(userIds.filter(Boolean)))
  const missing = uniqueIds.filter((id) => !cache.has(id))

  if (missing.length > 0) {
    const { data, error } = await supabase
      .from('profiles')
      .select('user_id, handle')
      .in('user_id', missing)

    if (!error) {
      (data ?? []).forEach((row: { user_id: string; handle: string | null }) => {
        if (row.user_id && row.handle) cache.set(row.user_id, row.handle)
      })
    }
  }

  const result: Record<string, string> = {}
  uniqueIds.forEach((id) => {
    const handle = cache.get(id)
    if (handle) result[id] = handle
  })
  return result
}

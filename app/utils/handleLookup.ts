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
 * Coalesces every getHandles() call made within the same synchronous flush
 * into one query, so callers do not have to pre-collect ids themselves.
 *
 * This matters because PostMain calls getHandles([post.profile.user_id]) --
 * one id -- from inside its OWN effect, and a feed page mounts many PostMain
 * instances at once. Without coalescing, a feed of N cards would fire N
 * independent `.in('user_id', [id])` queries, turning the "one extra round
 * trip per feed page" this module was built to cost into one round trip PER
 * CARD. React flushes passive effects for every component in a commit
 * synchronously, back to back, with no microtask in between -- so every
 * effect body that runs in that pass adds its ids to the same pending Set
 * before queueMicrotask's callback ever gets a turn. A caller that supplies
 * many ids in one call up front (CaptionComposer's candidate list) still
 * gets exactly the same one round trip; it just fills the batch itself
 * instead of sharing it with siblings.
 */
let pendingIds: Set<string> = new Set()
let pendingBatch: Promise<void> | null = null

async function fetchBatch(ids: string[]): Promise<void> {
  if (ids.length < 1) return

  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, handle')
    .in('user_id', ids)

  // Logged, not swallowed: the caller's effect only depends on the ids it
  // already had (see PostMain), so a dropped request here never retries --
  // this is the one place a failure is visible at all, same discipline as
  // useGetRandomUsers.
  if (error) {
    console.error(error)
    return
  }

  ;(data ?? []).forEach((row: { user_id: string; handle: string | null }) => {
    if (row.user_id && row.handle) cache.set(row.user_id, row.handle)
  })
}

/**
 * Resolves a batch of user ids to their current handle. Ids already cached
 * are never re-fetched; an id that resolves to nothing (deleted account,
 * bad id) simply stays absent from both the cache and the result, so a
 * caller sees it missing rather than mapped to an empty string.
 *
 * A caller that only ever has one id at a time -- the post detail page,
 * where a single PostMain is the only thing on screen -- still resolves
 * correctly; it just ends up as a batch of one, same as before coalescing.
 */
export async function getHandles(userIds: string[]): Promise<Record<string, string>> {
  const uniqueIds = Array.from(new Set(userIds.filter(Boolean)))
  const missing = uniqueIds.filter((id) => !cache.has(id))

  if (missing.length > 0) {
    missing.forEach((id) => pendingIds.add(id))

    if (!pendingBatch) {
      pendingBatch = new Promise<void>((resolve) => {
        queueMicrotask(() => {
          const batch = Array.from(pendingIds)
          pendingIds = new Set()
          pendingBatch = null
          fetchBatch(batch).finally(resolve)
        })
      })
    }

    await pendingBatch
  }

  const result: Record<string, string> = {}
  uniqueIds.forEach((id) => {
    const handle = cache.get(id)
    if (handle) result[id] = handle
  })
  return result
}

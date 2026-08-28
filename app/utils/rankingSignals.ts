import { supabase } from '@/libs/supabase'
import { EMPTY_SIGNALS, sumTagAffinity, type RankingSignals } from './rankingExplain'

/**
 * Reads the three ranking inputs a feed_post row does not carry.
 *
 * No RPC, and deliberately so. get_feed's scoring reads these same tables, but
 * every one of them is already reachable from the browser under RLS that says
 * exactly the right thing:
 *
 *   * post_scores is `for select using (true)` -- aggregate watch quality is
 *     public, and is about the post rather than about any viewer.
 *   * user_creator_affinity and user_topic_affinity carry the `_own` policy
 *     from 0002: `using ((select auth.uid()) = user_id)`. The viewer can read
 *     their own affinity and nobody else's, which is the whole guarantee this
 *     feature needs. A definer function would have had to re-implement that
 *     check by hand, which is strictly worse.
 *
 * So the explainer cannot show you why a post ranked for somebody else, and
 * that is enforced by the database rather than by this file.
 *
 * Called only when the viewer opens the panel -- never on a render path.
 */

/** Cached per post: the answer does not move while a menu is open, and the
 *  feed remounts this menu every time a card scrolls back into the window. */
const cache = new Map<string, Promise<RankingSignals>>()

async function load(postId: string, creatorId: string): Promise<RankingSignals> {
  // Tag affinity is two hops -- the post's hashtags, then the viewer's score
  // for them -- so it is resolved alongside the other two rather than after.
  const [scoreResult, creatorResult, tagIdResult] = await Promise.all([
    supabase.from('post_scores').select('avg_completion').eq('post_id', postId).maybeSingle(),
    supabase
      .from('user_creator_affinity')
      .select('score')
      .eq('creator_id', creatorId)
      .maybeSingle(),
    supabase.from('post_hashtags').select('hashtag_id').eq('post_id', postId),
  ])

  const hashtagIds = ((tagIdResult.data as Array<{ hashtag_id: string }> | null) ?? []).map(
    (row) => row.hashtag_id
  )

  // Skipped entirely for an untagged post: `in ()` on an empty list is a query
  // that can only return nothing.
  let tagAffinity = 0
  if (hashtagIds.length > 0) {
    const { data } = await supabase
      .from('user_topic_affinity')
      .select('score')
      .in('hashtag_id', hashtagIds)

    tagAffinity = sumTagAffinity((data as Array<{ score: number | null }> | null) ?? [])
  }

  return {
    completion: (scoreResult.data as { avg_completion: number } | null)?.avg_completion ?? 0,
    creatorAffinity: (creatorResult.data as { score: number } | null)?.score ?? 0,
    tagAffinity,
  }
}

/**
 * Never rejects. Every one of these reads is legitimately empty for a
 * logged-out viewer (RLS returns no affinity rows) or for a post the score
 * refresh job has not reached yet, so a failure degrades to "no personal
 * signal" -- which explainRanking already renders as its own honest state --
 * rather than turning an informational panel into an error.
 */
export function fetchRankingSignals(postId: string, creatorId: string): Promise<RankingSignals> {
  if (!postId || !creatorId) return Promise.resolve(EMPTY_SIGNALS)

  const key = `${postId}:${creatorId}`
  const cached = cache.get(key)
  if (cached) return cached

  const pending = load(postId, creatorId).catch((error) => {
    console.error('fetchRankingSignals', error)
    // Dropped so the next open retries rather than serving a permanent zero.
    cache.delete(key)
    return EMPTY_SIGNALS
  })

  cache.set(key, pending)
  return pending
}

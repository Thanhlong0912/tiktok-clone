import { supabase } from '@/libs/supabase'

/**
 * Writes for the engagement features that share the same shape as likes:
 * Save/Bookmark and Repost, backed by the `saves` / `reposts` tables.
 *
 * These stay as DIRECT table writes rather than moving to an RPC. RLS already
 * enforces `auth.uid() = user_id` on the insert, and the counter triggers added
 * in 0002 keep posts.save_count / repost_count exact in the same transaction.
 * Wrapping them in a SECURITY DEFINER function would replace that declarative
 * check with hand-written authorization for no benefit.
 *
 * The READ side is gone: getInteractionsByPost/ByUser existed only to count
 * rows and to answer "did I save this", and both now arrive with the post from
 * get_feed. They were responsible for 2 of the 5 requests every feed card made,
 * and re-ran in every mounted card on every save anywhere in the feed.
 */

export type InteractionKind = 'save' | 'repost'

export interface Interaction {
  id: string
  user_id: string
  post_id: string
}

const TABLE: Record<InteractionKind, string> = {
  save: 'saves',
  repost: 'reposts',
}

export const INTERACTION_EVENT = 'tt-interaction-change'

function notifyChange(kind: InteractionKind) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(INTERACTION_EVENT, { detail: { kind } }))
}

export async function createInteraction(
  kind: InteractionKind,
  userId: string,
  postId: string
): Promise<string> {
  const { data, error } = await supabase
    .from(TABLE[kind])
    .insert({ user_id: userId, post_id: postId })
    .select('id')
    .single()

  if (error) throw error

  notifyChange(kind)
  return data.id as string
}

export async function deleteInteraction(
  kind: InteractionKind,
  id: string
): Promise<void> {
  const { error } = await supabase.from(TABLE[kind]).delete().eq('id', id)

  if (error) throw error

  notifyChange(kind)
}

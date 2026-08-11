import { supabase } from '@/libs/supabase'

/**
 * Data layer for the engagement features that share the same shape as likes:
 * Save/Bookmark and Repost. Both are backed by their own table (`saves` /
 * `reposts`) holding a `user_id` and a `post_id`.
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

export async function getInteractionsByPost(
  kind: InteractionKind,
  postId: string
): Promise<Interaction[]> {
  const { data, error } = await supabase
    .from(TABLE[kind])
    .select('id, user_id, post_id')
    .eq('post_id', postId)

  if (error) throw error

  return data ?? []
}

export async function getInteractionsByUser(
  kind: InteractionKind,
  userId: string
): Promise<Interaction[]> {
  const { data, error } = await supabase
    .from(TABLE[kind])
    .select('id, user_id, post_id')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) throw error

  return data ?? []
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

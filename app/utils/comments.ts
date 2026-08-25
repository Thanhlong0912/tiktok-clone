import { supabase } from '@/libs/supabase'
import type { CommentCursor, CommentNode } from './commentThread'

/**
 * Access layer for the threaded comment RPCs added in 0007.
 *
 * What this replaces: a single `from('comments').select(...)` capped at 100
 * rows with no pagination, no like state and no notion of a reply. From the
 * moment 0007 lets a reply exist, that read would have rendered replies as
 * top-level comments -- which is why the two shipped together.
 *
 * Like every other access layer here, one call is one round trip.
 * get_post_comments returns the comment, its author, its counters and this
 * viewer's own like state together, so a row renders without fetching
 * anything of its own.
 *
 * The pure part of this feature -- what a thread looks like after a like, a
 * reply or a page boundary -- lives in ./commentThread so it can be tested
 * without libs/supabase throwing on an unconfigured env.
 */

/** Raw row shape as PostgREST serialises get_post_comments / get_comment_replies. */
interface CommentRow {
  id: string
  post_id: string
  parent_id: string | null
  user_id: string
  text: string | null
  created_at: string
  like_count: number
  reply_count: number
  is_liked: boolean
  is_author_liked: boolean
  is_post_author: boolean
  profile_name: string | null
  profile_image: string | null
  profile_handle: string | null
}

export type { CommentCursor, CommentNode }

/** Matches the server-side clamps, so the client never asks for a page it will not get. */
export const COMMENT_PAGE_SIZE = 20
export const REPLY_PAGE_SIZE = 10

function toCommentNode(row: CommentRow): CommentNode {
  return {
    id: row.id,
    post_id: row.post_id,
    parent_id: row.parent_id,
    user_id: row.user_id,
    text: row.text ?? '',
    created_at: row.created_at,
    like_count: row.like_count ?? 0,
    reply_count: row.reply_count ?? 0,
    is_liked: Boolean(row.is_liked),
    is_author_liked: Boolean(row.is_author_liked),
    is_post_author: Boolean(row.is_post_author),
    profile: {
      user_id: row.user_id,
      name: row.profile_name ?? '',
      image: row.profile_image ?? '',
      handle: row.profile_handle ?? '',
    },
  }
}

const mapRows = (data: unknown): CommentNode[] =>
  ((data as CommentRow[]) ?? []).map(toCommentNode)

/** Top-level comments only, newest first. */
export async function fetchPostComments(
  postId: string,
  cursor: CommentCursor | null = null,
  limit = COMMENT_PAGE_SIZE
): Promise<CommentNode[]> {
  const { data, error } = await supabase.rpc('get_post_comments', {
    p_post_id: postId,
    p_cursor: cursor,
    p_limit: limit,
  })
  if (error) throw error
  return mapRows(data)
}

/** Replies to one top-level comment, OLDEST first -- a thread reads as a conversation. */
export async function fetchCommentReplies(
  parentId: string,
  cursor: CommentCursor | null = null,
  limit = REPLY_PAGE_SIZE
): Promise<CommentNode[]> {
  const { data, error } = await supabase.rpc('get_comment_replies', {
    p_parent_id: parentId,
    p_cursor: cursor,
    p_limit: limit,
  })
  if (error) throw error
  return mapRows(data)
}

/**
 * Writes stay DIRECT table calls rather than moving to an RPC, for the reason
 * app/utils/socialInteractions.ts gives about saves and reposts: RLS already
 * enforces `auth.uid() = user_id` on the insert, 0007's triggers keep
 * comments.like_count and comments.reply_count exact in the same transaction,
 * and 0007's column grants stop the counters being written directly at all.
 * Wrapping that in a definer function would replace a declarative check with
 * hand-written authorization for no gain.
 */
export async function createComment(
  userId: string,
  postId: string,
  text: string,
  parentId: string | null = null
): Promise<void> {
  const { error } = await supabase.from('comments').insert({
    user_id: userId,
    post_id: postId,
    text,
    // Omitted rather than sent as null when absent: the INSERT grant added in
    // 0007 is column-scoped, and there is no reason to name a column we do not
    // set.
    ...(parentId ? { parent_id: parentId } : {}),
  })
  if (error) throw error
}

export async function deleteComment(commentId: string): Promise<void> {
  const { error } = await supabase.from('comments').delete().eq('id', commentId)
  if (error) throw error
}

export async function likeComment(userId: string, commentId: string): Promise<void> {
  const { error } = await supabase
    .from('comment_likes')
    // Upsert, not insert: double-tapping must not surface a primary key
    // violation to somebody who simply wanted the comment liked.
    //
    // ignoreDuplicates is what makes that legal here. Without it PostgREST
    // emits ON CONFLICT DO UPDATE, which requires UPDATE on comment_likes --
    // and 0007 grants none, deliberately, because a like is inserted or
    // deleted and never edited. DO NOTHING needs only INSERT, and the
    // conflicting row is already exactly what the update would have written.
    .upsert(
      { user_id: userId, comment_id: commentId },
      { onConflict: 'user_id,comment_id', ignoreDuplicates: true }
    )
  if (error) throw error
}

export async function unlikeComment(userId: string, commentId: string): Promise<void> {
  const { error } = await supabase
    .from('comment_likes')
    .delete()
    .eq('user_id', userId)
    .eq('comment_id', commentId)
  if (error) throw error
}

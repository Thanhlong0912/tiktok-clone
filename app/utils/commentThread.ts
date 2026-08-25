/**
 * The threading rules, as pure functions.
 *
 * Split from app/utils/comments.ts for the same reason feedCursor.ts is split
 * from feed.ts: importing libs/supabase throws at module load when the env is
 * not configured, so anything that has to run under vitest (environment:
 * 'node', no .env) must not sit downstream of it. The rules that decide what a
 * thread looks like after a like, a reply or a page boundary are exactly the
 * part worth testing, so they live here.
 */

/**
 * One comment at either level. Replies carry the identical shape so a single
 * component renders both -- which is also why get_post_comments and
 * get_comment_replies return the same column list.
 */
export interface CommentNode {
  id: string
  post_id: string
  parent_id: string | null
  user_id: string
  text: string
  created_at: string
  like_count: number
  reply_count: number
  is_liked: boolean
  /** The post's creator liked this comment. TikTok renders it as a small heart. */
  is_author_liked: boolean
  is_post_author: boolean
  profile: {
    user_id: string
    name: string
    image: string
  }
}

export interface CommentCursor {
  ts: string
  id: string
}

/**
 * The cursor for the NEXT page is always built from the LAST item of the page
 * as the server ordered it -- never from a re-sorted copy. That holds for both
 * reads even though one is descending and the other ascending: "last" means
 * "furthest along in the direction we are paging", which is exactly what the
 * keyset comparison continues from.
 */
export function nextCommentCursor(items: CommentNode[]): CommentCursor | null {
  if (items.length < 1) return null
  const last = items[items.length - 1]
  return { ts: last.created_at, id: last.id }
}

/**
 * Applies a like toggle to whichever node carries the id, at either level.
 * Returns a new array; untouched nodes keep their identity so React can skip
 * re-rendering them.
 */
export function applyCommentLike(
  items: CommentNode[],
  commentId: string,
  liked: boolean
): CommentNode[] {
  let changed = false

  const next = items.map((item) => {
    if (item.id !== commentId) return item
    // Idempotent: re-applying the state a node already has must not move the
    // counter, or a rolled-back optimistic update would double-count.
    if (item.is_liked === liked) return item

    changed = true
    return {
      ...item,
      is_liked: liked,
      // Floored for the same reason the SQL trigger floors it: a counter that
      // renders as -1 is worse than one that is briefly stale.
      like_count: Math.max(liked ? item.like_count + 1 : item.like_count - 1, 0),
    }
  })

  return changed ? next : items
}

/**
 * Bumps a parent's reply_count after a reply is posted or removed. The reply
 * list itself is held separately by the component, because a thread is only
 * loaded once the viewer expands it.
 */
export function bumpReplyCount(
  items: CommentNode[],
  parentId: string,
  delta: number
): CommentNode[] {
  let changed = false

  const next = items.map((item) => {
    if (item.id !== parentId) return item
    changed = true
    return { ...item, reply_count: Math.max(item.reply_count + delta, 0) }
  })

  return changed ? next : items
}

/** Removes a comment by id. */
export function removeComment(items: CommentNode[], commentId: string): CommentNode[] {
  const next = items.filter((item) => item.id !== commentId)
  return next.length === items.length ? items : next
}

/**
 * Merges a freshly fetched page into an existing list, dropping ids already
 * held. Two comments written in the same clock tick share a created_at, so a
 * keyset page boundary can legitimately re-serve a row the previous page
 * already showed.
 */
export function mergeCommentPage(
  existing: CommentNode[],
  page: CommentNode[]
): CommentNode[] {
  if (page.length < 1) return existing

  const seen = new Set(existing.map((item) => item.id))
  const fresh = page.filter((item) => !seen.has(item.id))

  return fresh.length < 1 ? existing : [...existing, ...fresh]
}

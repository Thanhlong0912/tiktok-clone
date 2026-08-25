import { describe, expect, it } from 'vitest'
import {
  applyCommentLike,
  bumpReplyCount,
  mergeCommentPage,
  nextCommentCursor,
  removeComment,
  type CommentNode,
} from './commentThread'

const node = (over: Partial<CommentNode> & { id: string }): CommentNode => ({
  post_id: 'post-1',
  parent_id: null,
  user_id: 'user-1',
  text: 'hello',
  created_at: '2026-08-25T10:00:00.000Z',
  like_count: 0,
  reply_count: 0,
  is_liked: false,
  is_author_liked: false,
  is_post_author: false,
  profile: { user_id: 'user-1', name: 'alice', image: 'a.png', handle: 'alice' },
  ...over,
})

describe('nextCommentCursor', () => {
  it('is null for an empty page, which is how the pager learns it is done', () => {
    expect(nextCommentCursor([])).toBeNull()
  })

  it('reads the LAST item, not the newest one', () => {
    // The top-level read is descending, so the last item is the OLDEST. Taking
    // the newest here would hand back the cursor the page started from and
    // page 2 would repeat page 1 forever.
    const cursor = nextCommentCursor([
      node({ id: 'a', created_at: '2026-08-25T12:00:00.000Z' }),
      node({ id: 'b', created_at: '2026-08-25T09:00:00.000Z' }),
    ])

    expect(cursor).toEqual({ ts: '2026-08-25T09:00:00.000Z', id: 'b' })
  })

  it('works for an ascending page too, where the last item is the newest', () => {
    // Replies come back oldest-first, and "last" still means "furthest along
    // in the direction we are paging".
    const cursor = nextCommentCursor([
      node({ id: 'a', created_at: '2026-08-25T09:00:00.000Z' }),
      node({ id: 'b', created_at: '2026-08-25T12:00:00.000Z' }),
    ])

    expect(cursor).toEqual({ ts: '2026-08-25T12:00:00.000Z', id: 'b' })
  })

  it('handles a single-item page', () => {
    expect(nextCommentCursor([node({ id: 'only' })])).toEqual({
      ts: '2026-08-25T10:00:00.000Z',
      id: 'only',
    })
  })
})

describe('applyCommentLike', () => {
  const list = [
    node({ id: 'a', like_count: 3 }),
    node({ id: 'b', like_count: 0, is_liked: true }),
  ]

  it('likes a comment and increments its count', () => {
    const next = applyCommentLike(list, 'a', true)
    expect(next[0]).toMatchObject({ is_liked: true, like_count: 4 })
  })

  it('unlikes a comment and decrements its count', () => {
    const liked = applyCommentLike(list, 'a', true)
    const next = applyCommentLike(liked, 'a', false)
    expect(next[0]).toMatchObject({ is_liked: false, like_count: 3 })
  })

  it('never drives the count below zero', () => {
    // b is flagged liked with a count of 0, which a mid-flight rollback can
    // produce. Unliking must not render "-1".
    const next = applyCommentLike(list, 'b', false)
    expect(next[1].like_count).toBe(0)
  })

  it('is idempotent, so a rolled-back optimistic update cannot double-count', () => {
    const once = applyCommentLike(list, 'a', true)
    const twice = applyCommentLike(once, 'a', true)
    expect(twice[0].like_count).toBe(4)
    expect(twice).toBe(once)
  })

  it('leaves the array identity alone when nothing matches', () => {
    expect(applyCommentLike(list, 'missing', true)).toBe(list)
  })

  it('does not touch sibling comments', () => {
    const next = applyCommentLike(list, 'a', true)
    expect(next[1]).toBe(list[1])
  })
})

describe('bumpReplyCount', () => {
  const list = [node({ id: 'parent', reply_count: 2 }), node({ id: 'other' })]

  it('increments the parent after a reply is posted', () => {
    expect(bumpReplyCount(list, 'parent', 1)[0].reply_count).toBe(3)
  })

  it('decrements after a reply is deleted', () => {
    expect(bumpReplyCount(list, 'parent', -1)[0].reply_count).toBe(1)
  })

  it('floors at zero', () => {
    // `other` starts at 0; decrementing must not render "-1 replies".
    expect(bumpReplyCount(list, 'other', -1)[1].reply_count).toBe(0)
  })

  it('is a no-op for an unknown parent', () => {
    expect(bumpReplyCount(list, 'nobody', 1)).toBe(list)
  })
})

describe('removeComment', () => {
  const list = [node({ id: 'a' }), node({ id: 'b' })]

  it('removes the matching comment', () => {
    expect(removeComment(list, 'a').map((c) => c.id)).toEqual(['b'])
  })

  it('returns the same array when nothing matched', () => {
    expect(removeComment(list, 'zzz')).toBe(list)
  })
})

describe('mergeCommentPage', () => {
  const existing = [node({ id: 'a' }), node({ id: 'b' })]

  it('appends genuinely new rows', () => {
    const merged = mergeCommentPage(existing, [node({ id: 'c' })])
    expect(merged.map((c) => c.id)).toEqual(['a', 'b', 'c'])
  })

  it('drops ids already held', () => {
    // Two comments written in the same clock tick share a created_at, so a
    // keyset boundary can legitimately re-serve a row page 1 already showed.
    const merged = mergeCommentPage(existing, [node({ id: 'b' }), node({ id: 'c' })])
    expect(merged.map((c) => c.id)).toEqual(['a', 'b', 'c'])
  })

  it('returns the same array for an empty or fully duplicate page', () => {
    expect(mergeCommentPage(existing, [])).toBe(existing)
    expect(mergeCommentPage(existing, [node({ id: 'a' })])).toBe(existing)
  })
})

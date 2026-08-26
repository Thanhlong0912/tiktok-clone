import { describe, expect, it } from 'vitest'
import {
  applyFollowState,
  mergeAccountPage,
  nextAccountCursor,
  type AccountSummary,
} from './accountList'

const account = (over: Partial<AccountSummary> & { user_id: string }): AccountSummary => ({
  name: 'alice',
  image: 'a.png',
  bio: '',
  follower_count: 0,
  is_following: false,
  is_self: false,
  followed_at: '2026-08-25T10:00:00.000Z',
  handle: 'alice',
  ...over,
})

describe('nextAccountCursor', () => {
  it('is null for an empty page', () => {
    expect(nextAccountCursor([])).toBeNull()
  })

  it('keys on followed_at and the listed account user_id', () => {
    // Not the follows row id: the RPC does not return it, and (user_id,
    // to_user_id) is unique, so once the server has pinned one side the other
    // is a valid tiebreaker.
    const cursor = nextAccountCursor([
      account({ user_id: 'u1', followed_at: '2026-08-25T12:00:00.000Z' }),
      account({ user_id: 'u2', followed_at: '2026-08-25T09:00:00.000Z' }),
    ])

    expect(cursor).toEqual({ ts: '2026-08-25T09:00:00.000Z', id: 'u2' })
  })
})

describe('mergeAccountPage', () => {
  const existing = [account({ user_id: 'u1' }), account({ user_id: 'u2' })]

  it('appends new accounts', () => {
    const merged = mergeAccountPage(existing, [account({ user_id: 'u3' })])
    expect(merged.map((a) => a.user_id)).toEqual(['u1', 'u2', 'u3'])
  })

  it('dedupes a row re-served at a page boundary', () => {
    // Seeded follows share a created_at, so this is not hypothetical.
    const merged = mergeAccountPage(existing, [
      account({ user_id: 'u2' }),
      account({ user_id: 'u3' }),
    ])
    expect(merged.map((a) => a.user_id)).toEqual(['u1', 'u2', 'u3'])
  })

  it('returns the same array when there is nothing to add', () => {
    expect(mergeAccountPage(existing, [])).toBe(existing)
  })
})

describe('applyFollowState', () => {
  const existing = [
    account({ user_id: 'u1', is_following: false }),
    account({ user_id: 'u2', is_following: true }),
  ]

  it('flips one row', () => {
    expect(applyFollowState(existing, 'u1', true)[0].is_following).toBe(true)
  })

  it('leaves siblings untouched by identity', () => {
    expect(applyFollowState(existing, 'u1', true)[1]).toBe(existing[1])
  })

  it('is a no-op when the row already has that state, so a rollback is safe', () => {
    expect(applyFollowState(existing, 'u2', true)).toBe(existing)
  })

  it('is a no-op for an unknown account', () => {
    expect(applyFollowState(existing, 'nobody', true)).toBe(existing)
  })
})

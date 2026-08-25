/**
 * Pure list/cursor rules for the account lists. Split from
 * app/utils/accounts.ts for the reason feedCursor.ts is split from feed.ts:
 * libs/supabase throws at module load on an unconfigured env, and vitest runs
 * without one.
 */

export interface AccountSummary {
  user_id: string
  name: string
  image: string
  bio: string
  follower_count: number
  /** Whether the VIEWER follows this account -- not the profile being browsed. */
  is_following: boolean
  is_self: boolean
  followed_at: string
}

export interface AccountCursor {
  ts: string
  id: string
}

export type FollowListKind = 'followers' | 'following'

export const ACCOUNT_PAGE_SIZE = 24

/**
 * The cursor is the LAST row of the page as the server ordered it. `id` is the
 * listed account's user_id, not the follow row's id: 0001 makes
 * (user_id, to_user_id) unique, so once the RPC has pinned one side the other
 * is a unique tiebreaker -- and unlike follows.id it is a column the client
 * actually receives.
 */
export function nextAccountCursor(items: AccountSummary[]): AccountCursor | null {
  if (items.length < 1) return null
  const last = items[items.length - 1]
  return { ts: last.followed_at, id: last.user_id }
}

/** Drops ids already held: a page boundary can re-serve a row when timestamps tie. */
export function mergeAccountPage(
  existing: AccountSummary[],
  page: AccountSummary[]
): AccountSummary[] {
  if (page.length < 1) return existing

  const seen = new Set(existing.map((item) => item.user_id))
  const fresh = page.filter((item) => !seen.has(item.user_id))

  return fresh.length < 1 ? existing : [...existing, ...fresh]
}

/** Applies a follow toggle to one row, keeping the rest of the array identical. */
export function applyFollowState(
  items: AccountSummary[],
  userId: string,
  isFollowing: boolean
): AccountSummary[] {
  let changed = false

  const next = items.map((item) => {
    if (item.user_id !== userId || item.is_following === isFollowing) return item
    changed = true
    return { ...item, is_following: isFollowing }
  })

  return changed ? next : items
}

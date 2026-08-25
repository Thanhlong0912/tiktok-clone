import { supabase } from '@/libs/supabase'
import {
  ACCOUNT_PAGE_SIZE,
  type AccountCursor,
  type AccountSummary,
  type FollowListKind,
} from './accountList'

/**
 * Access layer for the account lists added in 0007: followers, following, and
 * the two moderation lists.
 *
 * These have to be RPCs rather than PostgREST embeds. follows.to_user_id,
 * blocks.blocked_id and mutes.muted_id all reference auth.users, not
 * public.profiles, so there is no foreign key for an embed to traverse --
 * exactly the constraint app/hooks/useGetFollowing.tsx works around with two
 * capped queries and a client-side re-order. That workaround is fine for a
 * five-row sidebar and cannot page a real follower list, which is why these
 * exist.
 */

export type { AccountCursor, AccountSummary, FollowListKind }

const RPC_FOR: Record<FollowListKind, string> = {
  followers: 'get_followers',
  following: 'get_following_accounts',
}

/**
 * Both lists are ordered by when the FOLLOW was created, so `followed_at`
 * means different things either side: when this account followed the profile,
 * or when the profile followed them. A cursor is therefore not interchangeable
 * between the two kinds.
 */
export async function fetchFollowList(
  kind: FollowListKind,
  userId: string,
  cursor: AccountCursor | null = null,
  limit = ACCOUNT_PAGE_SIZE
): Promise<AccountSummary[]> {
  const { data, error } = await supabase.rpc(RPC_FOR[kind], {
    p_user_id: userId,
    p_cursor: cursor,
    p_limit: limit,
  })
  if (error) throw error

  return ((data as AccountSummary[]) ?? []).map((row) => ({
    ...row,
    name: row.name ?? '',
    image: row.image ?? '',
    bio: row.bio ?? '',
    follower_count: row.follower_count ?? 0,
    is_following: Boolean(row.is_following),
    is_self: Boolean(row.is_self),
  }))
}

// ---------------------------------------------------------------------------
// Moderation lists.
// ---------------------------------------------------------------------------

export interface ModeratedAccount {
  user_id: string
  name: string
  image: string
  bio: string
  created_at: string
}

/**
 * Neither RPC takes a user argument: the subject is auth.uid() server-side and
 * cannot be pointed at anybody else. Both require a session.
 */
export async function fetchBlockedAccounts(limit = 100): Promise<ModeratedAccount[]> {
  const { data, error } = await supabase.rpc('get_blocked_accounts', { p_limit: limit })
  if (error) throw error
  return (data as ModeratedAccount[]) ?? []
}

export async function fetchMutedAccounts(limit = 100): Promise<ModeratedAccount[]> {
  const { data, error } = await supabase.rpc('get_muted_accounts', { p_limit: limit })
  if (error) throw error
  return (data as ModeratedAccount[]) ?? []
}

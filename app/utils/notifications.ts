import { supabase } from '@/libs/supabase'

/**
 * Notifications now come from a real `notifications` table, written by triggers
 * on likes/comments/follows/reposts.
 *
 * The previous implementation synthesised this list client-side on every visit:
 * it fetched all of your post ids, then queried likes, comments and follows
 * separately, then fetched one profile per actor. It had no read state, no
 * pagination, and applied its 50-row cap per source BEFORE merging -- so a
 * burst of likes could starve follows and comments out of the list entirely.
 */

export type NotificationType = 'like' | 'comment' | 'follow' | 'repost' | 'mention'

export interface NotificationItem {
  id: string
  type: NotificationType
  created_at: string
  read_at: string | null
  actor_id: string
  actor_name: string
  actor_image: string
  actor_handle: string
  post_id: string | null
  post_poster_key: string
  post_media: string
  preview: string
}

export interface NotificationCursor {
  ts: string
  id: string
}

/**
 * `type` filters SERVER-side. The Activity page used to fetch one page and
 * .filter() it per tab, so a burst of likes made the Comments and Followers
 * tabs read "nothing yet" while their rows sat unreachable on page 2.
 */
export async function fetchNotifications(
  cursor: NotificationCursor | null,
  limit = 30,
  type: NotificationType | null = null
): Promise<NotificationItem[]> {
  const { data, error } = await supabase.rpc('get_notifications', {
    p_cursor: cursor,
    p_limit: limit,
    p_type: type,
  })
  if (error) throw error
  return (data as NotificationItem[]) ?? []
}

export async function fetchUnreadNotificationCount(): Promise<number> {
  const { data, error } = await supabase.rpc('get_unread_notification_count')
  if (error) throw error
  return (data as number) ?? 0
}

/** Passing no ids marks everything unread as read. Returns how many changed. */
export async function markNotificationsRead(ids?: string[]): Promise<number> {
  const { data, error } = await supabase.rpc('mark_notifications_read', {
    p_ids: ids && ids.length > 0 ? ids : null,
  })
  if (error) throw error
  return (data as number) ?? 0
}

export function nextNotificationCursor(
  items: NotificationItem[]
): NotificationCursor | null {
  if (items.length < 1) return null
  const last = items[items.length - 1]
  return { ts: last.created_at, id: last.id }
}

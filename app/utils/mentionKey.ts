/**
 * The two pure key functions mentions are compared with. They live apart from
 * mentions.ts because that module reaches the supabase client at import time,
 * which makes it unloadable without env -- and mentionKey has to be testable,
 * since public.mention_key in 0010_mention_notifications.sql must agree with
 * it character for character. See app/utils/mentions.test.ts.
 */

/** Canonical comparison key for a display name or mention. */
export const mentionKey = (name: string) => name.replace(/[\s@]+/g, '').toLowerCase()

/** Accent-insensitive key so "thanh" matches "Thành" while filtering. */
export const foldName = (name: string) =>
  mentionKey(name)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

/**
 * Hashtags are written TikTok-style as #tags inside the post caption
 * (`posts.text`). They are now ALSO extracted into the `hashtags` /
 * `post_hashtags` tables by the sync_post_hashtags trigger, which is what
 * search and trending read.
 *
 * What remains here is the compose-time half: parsing what the user typed
 * before the post exists. `normalizeTag` must stay byte-identical to
 * public.normalize_tag in supabase/migrations/0002_feed_and_signals.sql --
 * postTags.test.ts pins the shared fixture that keeps them in step.
 *
 * The old countTags/getTrendingTags/searchTags helpers are gone: they scanned
 * the cached 100-post feed array, so they could only ever see tags from the
 * newest 100 posts in the entire app. Use the search_hashtags and
 * get_trending_hashtags RPCs instead.
 */

export const MAX_TAGS_PER_POST = 10
export const MAX_TAG_LENGTH = 30

/** Lowercases and strips '#', whitespace, and punctuation so tags compare reliably. */
export function normalizeTag(raw: string): string {
  return raw
    .replace(/#/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[.,!?;:()\[\]{}'"`~@$%^&*+=\\/|<>]/g, '')
    .slice(0, MAX_TAG_LENGTH)
}

/** All unique tags found in a caption, normalized. */
export function extractHashtags(text?: string | null): string[] {
  if (!text) return []

  const matches = text.match(/#[^\s#]+/g) || []
  const seen: Record<string, boolean> = {}
  const tags: string[] = []

  matches.forEach((match) => {
    const tag = normalizeTag(match)
    if (tag && !seen[tag]) {
      seen[tag] = true
      tags.push(tag)
    }
  })

  return tags
}

export function appendTagsToCaption(caption: string, tags: string[]): string {
  const cleanCaption = caption.trim()
  if (tags.length < 1) return cleanCaption

  const hashtags = tags.map((tag) => `#${tag}`).join(' ')
  return cleanCaption ? `${cleanCaption} ${hashtags}` : hashtags
}

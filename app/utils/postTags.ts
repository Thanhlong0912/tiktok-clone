/**
 * Tags are stored TikTok-style as #hashtags appended to the post caption
 * (`text` attribute). This avoids any Appwrite schema change: old posts keep
 * working and Explore/search can filter by parsing the caption.
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

type Tagged = { text?: string | null }

function countTags(posts: Tagged[]): Map<string, number> {
  const counts = new Map<string, number>()
  posts.forEach((post) => {
    extractHashtags(post.text).forEach((tag) => {
      counts.set(tag, (counts.get(tag) || 0) + 1)
    })
  })
  return counts
}

/** Most-used tags across the given posts, most frequent first. */
export function getTrendingTags(posts: Tagged[], limit = 10): string[] {
  const entries: Array<[string, number]> = []
  countTags(posts).forEach((count, tag) => entries.push([tag, count]))
  return entries
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map((entry) => entry[0])
}

/** Tags matching a partial query, for autocomplete. Most frequent first. */
export function searchTags(posts: Tagged[], query: string, limit = 6): string[] {
  const clean = normalizeTag(query)
  if (!clean) return []

  const entries: Array<[string, number]> = []
  countTags(posts).forEach((count, tag) => {
    if (tag.includes(clean)) entries.push([tag, count])
  })

  return entries
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map((entry) => entry[0])
}

import useSearchProfilesByName from '../hooks/useSearchProfilesByName'
import { usePostStore } from '../stores/post'

/**
 * Resolves an @mention (as stored in a caption, spaces stripped) back to the
 * mentioned user's id so mentions can link to the profile page.
 *
 * Resolution order:
 *  1. Local mention registry — recorded when a mention is picked in the
 *     upload composer, so self-created mentions always resolve.
 *  2. Profiles already present in the cached feed.
 *  3. Appwrite profile search (matches names without spaces; multi-word
 *     names may not be findable this way since mentions strip spaces).
 */

const REGISTRY_KEY = 'tt_mention_registry'
const resolutionCache = new Map<string, Promise<string | null>>()

/** Canonical comparison key for a display name or mention. */
export const mentionKey = (name: string) => name.replace(/[\s@]+/g, '').toLowerCase()

export function rememberMention(name: string, userId: string) {
  if (typeof window === 'undefined') return
  try {
    const raw = window.localStorage.getItem(REGISTRY_KEY)
    const map = raw ? JSON.parse(raw) : {}
    map[mentionKey(name)] = userId
    window.localStorage.setItem(REGISTRY_KEY, JSON.stringify(map))
  } catch {
    // Registry is best-effort only.
  }
}

function registryLookup(key: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(REGISTRY_KEY)
    const map = raw ? JSON.parse(raw) : {}
    return typeof map[key] === 'string' ? map[key] : null
  } catch {
    return null
  }
}

export function resolveMentionUserId(name: string): Promise<string | null> {
  const key = mentionKey(name)
  if (!key) return Promise.resolve(null)

  const cached = resolutionCache.get(key)
  if (cached) return cached

  const promise = (async () => {
    const fromRegistry = registryLookup(key)
    if (fromRegistry) return fromRegistry

    const { allPosts } = usePostStore.getState()
    const fromFeed = allPosts.find((post) => mentionKey(post.profile?.name || '') === key)
    if (fromFeed) return fromFeed.profile.user_id

    try {
      const results = await useSearchProfilesByName(name)
      const match = (results || []).find((profile) => mentionKey(profile.name) === key)
      if (match) return match.id
    } catch {
      // Fall through to unresolved.
    }

    return null
  })()

  resolutionCache.set(key, promise)
  return promise
}

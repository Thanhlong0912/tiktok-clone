import useSearchProfilesByName from '../hooks/useSearchProfilesByName'
import { mentionKey } from './mentionKey'
import { usePostStore } from '../stores/post'

/**
 * Resolves an @mention (as stored in a caption, spaces stripped) back to the
 * mentioned user's id so mentions can link to the profile page.
 *
 * Resolution order:
 *  1. Local mention registry — recorded when a mention is picked in the
 *     upload composer, so self-created mentions always resolve.
 *  2. Profiles already present in the cached feed.
 *  3. Supabase profile search (matches names without spaces; multi-word
 *     names may not be findable this way since mentions strip spaces).
 */

const REGISTRY_KEY = 'tt_mention_registry'
const resolutionCache = new Map<string, Promise<string | null>>()

// mentionKey and foldName live in ./mentionKey so they can be imported
// without pulling in the supabase client below. Re-exported here because
// this is where callers have always found them.
export { foldName, mentionKey } from './mentionKey'

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

/** How long an unresolved mention stays unresolved before we look again. */
const NEGATIVE_TTL_MS = 5 * 60 * 1000
const negativeUntil = new Map<string, number>()

export function resolveMentionUserId(name: string): Promise<string | null> {
  const key = mentionKey(name)
  if (!key) return Promise.resolve(null)

  const cached = resolutionCache.get(key)
  if (cached) return cached

  // A miss used to be cached forever, so a mention of an account that had not
  // loaded yet stayed plain text for the rest of the session no matter how many
  // times it was rendered afterwards.
  const suppressedUntil = negativeUntil.get(key)
  if (suppressedUntil && Date.now() < suppressedUntil) {
    return Promise.resolve(null)
  }

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

  // Only successes are cached permanently; a null is retried after the TTL.
  resolutionCache.set(key, promise)
  void promise.then((userId) => {
    if (userId) return
    resolutionCache.delete(key)
    negativeUntil.set(key, Date.now() + NEGATIVE_TTL_MS)
  })

  return promise
}

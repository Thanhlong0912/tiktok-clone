import { supabase } from '@/libs/supabase'
import { mentionKey } from './mentionKey'

/**
 * Resolves an @mention (as stored in a caption, spaces stripped) back to the
 * mentioned user's id so mentions can link to the profile page.
 *
 * This used to be a three-tier fallback -- a localStorage registry recorded
 * when a mention was picked in the composer, then a scan of the cached feed,
 * then a name search -- with a negative TTL on top so a miss wasn't retried
 * on every render. All of that existed because the lookup ran against
 * profiles.name, which had no uniqueness constraint: two accounts could
 * fold to the same mention_key, a multi-word name couldn't be found once
 * spaces were stripped, and a real match could still come back empty because
 * the feed cache or search results simply didn't happen to include that
 * profile yet. None of those failure modes apply to a lookup by handle.
 * profiles.handle is unique and indexed (0011_unique_handles.sql), so a
 * single indexed point lookup either finds the one account that owns that
 * handle or correctly finds none -- there is nothing left for a fallback
 * chain or a retry timer to compensate for.
 */

// Successes only. A miss is not cached: unlike the old negative TTL, there is
// no unreliable multi-source lookup here to shield from repeated retries --
// just one indexed query -- so caching "not found" would only risk serving a
// stale null for an account that signs up moments later.
const resolutionCache = new Map<string, Promise<string | null>>()

// mentionKey and foldName live in ./mentionKey so they can be imported
// without pulling in the supabase client below. Re-exported here because
// this is where callers have always found them.
export { foldName, mentionKey } from './mentionKey'

export function resolveMentionUserId(name: string): Promise<string | null> {
  const key = mentionKey(name)
  if (!key) return Promise.resolve(null)

  const cached = resolutionCache.get(key)
  if (cached) return cached

  const promise = (async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('user_id')
      .eq('handle', key)
      .maybeSingle()

    if (error || !data) return null
    return data.user_id
  })()

  resolutionCache.set(key, promise)
  // A miss is not worth remembering (see the comment above) -- only keep the
  // cache entry around when it resolved to somebody.
  void promise.then((userId) => {
    if (!userId) resolutionCache.delete(key)
  })

  return promise
}

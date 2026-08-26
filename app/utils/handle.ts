/**
 * Handle rules, mirrored by the profiles_handle_format CHECK in
 * supabase/migrations/0011_unique_handles.sql. app/utils/handle.test.ts pins
 * the shared fixture, the same way postTags.test.ts does for normalize_tag and
 * mentions.test.ts does for mention_key.
 *
 * This is NOT mentionKey, and the difference is the whole reason both exist.
 * mentionKey normalises a TOKEN found in a caption and deliberately preserves
 * punctuation and accents, because @O'Brien and @OBrien are two different
 * people to a resolver. This validates a STORED value, whose charset is much
 * narrower precisely so that a handle is unambiguous wherever it appears.
 *
 * Lowercase-only is load-bearing rather than stylistic: it makes the column its
 * own canonical form, so uniqueness needs no lower() expression index and no
 * citext, and the unique index means exactly what it says.
 */

export const MIN_HANDLE_LENGTH = 2
export const MAX_HANDLE_LENGTH = 24
export const HANDLE_PATTERN = /^[a-z0-9._]{2,24}$/

export function isValidHandle(value: string): boolean {
  return HANDLE_PATTERN.test(value)
}

/**
 * A specific, actionable message, or null when the handle is fine.
 *
 * The checks are ordered most-specific first on purpose. Falling straight
 * through to the pattern would answer every mistake with the same sentence,
 * and a field that replies "handles must match ^[a-z0-9._]{2,24}$" has told
 * the user nothing they can act on.
 */
export function handleError(value: string): string | null {
  if (!value) return 'A handle is required'
  if (value.length < MIN_HANDLE_LENGTH) return `Handles are at least ${MIN_HANDLE_LENGTH} characters`
  if (value.length > MAX_HANDLE_LENGTH) return `Handles are at most ${MAX_HANDLE_LENGTH} characters`
  if (/[A-Z]/.test(value)) return 'Handles are lowercase'
  if (!HANDLE_PATTERN.test(value)) return 'Handles use letters, numbers, dots and underscores only'
  return null
}

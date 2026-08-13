/**
 * Client-side email shape check for the auth forms.
 *
 * Deliberately permissive. The previous pattern was
 *   /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/
 * whose `\w{2,3}` capped the final label at three characters, so it rejected
 * every address on a modern TLD -- .info, .store, .email, .online, .design --
 * and told the user "log in with your email address, not your username".
 *
 * This only catches obvious typos before a round trip. The server is the real
 * validator, and an over-strict client check locks out valid users, which is a
 * far worse failure than letting a malformed address reach the API.
 */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function isValidEmail(value: string): boolean {
  const trimmed = (value ?? '').trim()
  if (trimmed.length < 3 || trimmed.length > 254) return false
  return EMAIL_PATTERN.test(trimmed)
}

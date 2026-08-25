import { describe, expect, it } from 'vitest'
import { foldName, mentionKey } from './mentionKey'

/**
 * Shared fixture: the SAME inputs and expected outputs are verified against
 * public.mention_key in Postgres, added in
 * supabase/migrations/0010_mention_notifications.sql. If you change the key on
 * either side, run this against the database too:
 *
 *   select raw, public.mention_key(raw) from (values ...) v(raw);
 *
 * They diverge silently otherwise, and the failure is invisible rather than
 * loud: the client would linkify `@Name` to a profile while the trigger
 * resolved the same token to nobody, so the mention would look live and
 * notify no one -- exactly the bug 0010 exists to fix.
 *
 * Note this is a DIFFERENT normalizer from normalizeTag in postTags.ts, and
 * deliberately so: a hashtag strips punctuation because a tag is a slug, while
 * a mention must preserve it because it has to match a display name character
 * for character. `@O'Brien` and `@OBrien` are two different people.
 */
export const MENTION_KEY_PARITY: Array<[string, string]> = [
  ['Rowan Bui', 'rowanbui'],
  ['@Rowan Bui', 'rowanbui'],
  ['RowanBui', 'rowanbui'],
  ['  spaced  out  ', 'spacedout'],
  ['@@doubled', 'doubled'],
  ['MiXeD CaSe', 'mixedcase'],
  ["O'Brien", "o'brien"],
  ['dot.name', 'dot.name'],
  ['under_score', 'under_score'],
  ['dash-name', 'dash-name'],
  ['Ünïcode Nàme', 'ünïcode nàme'.replace(/\s+/g, '')],
  ['emoji😀name', 'emoji😀name'],
  ['tab\tseparated', 'tabseparated'],
  ['new\nline', 'newline'],
  ['', ''],
  ['@', ''],
  ['   ', ''],
]

describe('mentionKey', () => {
  it.each(MENTION_KEY_PARITY)('keys %j to %j (verified against SQL)', (raw, expected) => {
    expect(mentionKey(raw)).toBe(expected)
  })

  it('is idempotent, so re-keying a stored key is a no-op', () => {
    MENTION_KEY_PARITY.forEach(([raw]) => {
      const once = mentionKey(raw)
      expect(mentionKey(once)).toBe(once)
    })
  })

  it('collapses a name and its spaceless spelling onto one key', () => {
    // This is the whole reason mentions can be written without spaces: the
    // caption stores @RowanBui and the profile is named "Rowan Bui".
    expect(mentionKey('Rowan Bui')).toBe(mentionKey('RowanBui'))
  })

  it('keeps punctuation, unlike normalizeTag', () => {
    // Two accounts differing only by an apostrophe are two accounts. A tag
    // normalizer would fold them together; a mention resolver must not.
    expect(mentionKey("O'Brien")).not.toBe(mentionKey('OBrien'))
  })

  it('does not fold accents -- foldName is the separate, lossier key', () => {
    // mention_key in SQL matches this one. foldName exists only to make the
    // client-side suggestion list forgiving while typing, and is deliberately
    // NOT what the trigger resolves against.
    expect(mentionKey('Thành')).not.toBe(mentionKey('Thanh'))
    expect(foldName('Thành')).toBe(foldName('Thanh'))
  })
})

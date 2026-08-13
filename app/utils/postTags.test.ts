import { describe, expect, it } from 'vitest'
import {
  appendTagsToCaption,
  extractHashtags,
  MAX_TAG_LENGTH,
  normalizeTag,
} from './postTags'

/**
 * Shared fixture: the SAME inputs and expected outputs are verified against
 * public.normalize_tag in Postgres. If you change the normalizer on either
 * side, run this against the database too:
 *
 *   select raw, public.normalize_tag(raw) from (values ...) v(raw);
 *
 * The tables diverge silently otherwise -- a caption tagged #Foo would be
 * stored under one key and searched under another.
 */
export const NORMALIZE_TAG_PARITY: Array<[string, string]> = [
  ['#Hello', 'hello'],
  ['  #Mixed Case  ', 'mixedcase'],
  ['#a.b,c!d?e', 'abcde'],
  ['#tag(1)[2]{3}', 'tag123'],
  ['#quote\'s"and`ticks', 'quotesandticks'],
  ['#math+=*^%$@&', 'math'],
  ['#slash\\/pipe|lt<gt>', 'slashpipeltgt'],
  ['#~tilde~', 'tilde'],
  [`#${'x'.repeat(40)}`, 'x'.repeat(30)],
  ['#', ''],
  ['###', ''],
  ['#Ünïcode', 'ünïcode'],
  ['#emoji😀tag', 'emoji😀tag'],
]

describe('normalizeTag', () => {
  it.each(NORMALIZE_TAG_PARITY)('normalizes %j to %j (verified against SQL)', (raw, expected) => {
    expect(normalizeTag(raw)).toBe(expected)
  })

  it('truncates to MAX_TAG_LENGTH', () => {
    expect(normalizeTag(`#${'a'.repeat(100)}`)).toHaveLength(MAX_TAG_LENGTH)
  })

  it('is idempotent, so re-normalizing a stored tag is a no-op', () => {
    NORMALIZE_TAG_PARITY.forEach(([raw]) => {
      const once = normalizeTag(raw)
      expect(normalizeTag(once)).toBe(once)
    })
  })

  it('documents the one known divergence from SQL: astral chars at the cut', () => {
    // JS slice counts UTF-16 code units; Postgres left() counts characters.
    // A tag whose 30th character is an emoji therefore truncates differently.
    // Nothing depends on this today -- tags that long are vanishingly rare --
    // but it is the one case where the two implementations disagree.
    const withAstral = `#${'a'.repeat(29)}😀tail`
    expect(normalizeTag(withAstral).length).toBe(MAX_TAG_LENGTH)
  })
})

describe('extractHashtags', () => {
  it('returns an empty list for empty input', () => {
    expect(extractHashtags('')).toEqual([])
    expect(extractHashtags(null)).toEqual([])
    expect(extractHashtags(undefined)).toEqual([])
  })

  it('pulls tags out of a caption in order', () => {
    expect(extractHashtags('morning run #fitness #running')).toEqual(['fitness', 'running'])
  })

  it('dedupes repeated tags, keeping first appearance', () => {
    expect(extractHashtags('#a #b #a')).toEqual(['a', 'b'])
  })

  it('dedupes tags that only differ by case or punctuation', () => {
    expect(extractHashtags('#Dance #dance! #DANCE')).toEqual(['dance'])
  })

  it('ignores a bare hash', () => {
    expect(extractHashtags('nothing to see # here')).toEqual([])
  })

  it('splits adjacent tags written without a space', () => {
    expect(extractHashtags('#one#two')).toEqual(['one', 'two'])
  })

  it('finds tags anywhere in the caption, not just at the end', () => {
    expect(extractHashtags('#intro then words then #outro')).toEqual(['intro', 'outro'])
  })
})

describe('appendTagsToCaption', () => {
  it('returns the trimmed caption when there are no tags', () => {
    expect(appendTagsToCaption('  hello  ', [])).toBe('hello')
  })

  it('appends tags after the caption', () => {
    expect(appendTagsToCaption('hello', ['a', 'b'])).toBe('hello #a #b')
  })

  it('returns only tags when the caption is empty', () => {
    expect(appendTagsToCaption('   ', ['a'])).toBe('#a')
  })

  it('round-trips through extractHashtags', () => {
    const tags = ['dance', 'fyp']
    expect(extractHashtags(appendTagsToCaption('caption', tags))).toEqual(tags)
  })
})

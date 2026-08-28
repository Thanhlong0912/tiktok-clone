import { describe, expect, it } from 'vitest'
import { countLabel, formatCount } from './formatNumber'

describe('formatCount', () => {
  it('leaves values under a thousand alone', () => {
    expect(formatCount(0)).toBe('0')
    expect(formatCount(999)).toBe('999')
  })

  it('abbreviates thousands, millions and billions', () => {
    expect(formatCount(1200)).toBe('1.2K')
    expect(formatCount(3_400_000)).toBe('3.4M')
    expect(formatCount(2_000_000_000)).toBe('2B')
  })

  it('drops a trailing .0', () => {
    expect(formatCount(2000)).toBe('2K')
  })

  it('treats null, undefined and NaN as zero', () => {
    expect(formatCount(null)).toBe('0')
    expect(formatCount(undefined)).toBe('0')
    expect(formatCount(Number.NaN)).toBe('0')
  })
})

describe('countLabel', () => {
  it('uses the singular for exactly one', () => {
    expect(countLabel(1, 'like')).toBe('1 like')
    expect(countLabel(1, 'comment')).toBe('1 comment')
  })

  it('uses the plural for zero and for many', () => {
    expect(countLabel(0, 'like')).toBe('0 likes')
    expect(countLabel(2, 'like')).toBe('2 likes')
  })

  it('pluralises on the raw count, not the abbreviated one', () => {
    // "1.2K" starts with a 1 but is not the number 1.
    expect(countLabel(1200, 'like')).toBe('1.2K likes')
    // 1,000,000 abbreviates to "1M" -- still plural.
    expect(countLabel(1_000_000, 'follower')).toBe('1M followers')
  })

  it('treats a missing count as zero rather than printing NaN', () => {
    expect(countLabel(null, 'like')).toBe('0 likes')
    expect(countLabel(undefined, 'comment')).toBe('0 comments')
  })
})

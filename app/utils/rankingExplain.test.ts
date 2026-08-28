import { describe, expect, it } from 'vitest'
import {
  ageHoursSince,
  EMPTY_SIGNALS,
  explainPost,
  sumTagAffinity,
  type RankingPostFacts,
} from './rankingExplain'
import { FRESH_BONUS_MAX_AGE_HOURS } from './feedScoreConfig'

describe('ageHoursSince', () => {
  const now = Date.parse('2026-08-28T12:00:00.000Z')

  it('measures whole and fractional hours', () => {
    expect(ageHoursSince('2026-08-28T09:00:00.000Z', now)).toBe(3)
    expect(ageHoursSince('2026-08-28T11:30:00.000Z', now)).toBe(0.5)
  })

  it('clamps a future timestamp to zero the way the SQL does', () => {
    // A client clock ahead of the server would otherwise produce a negative
    // age, which reads as "fresher than new" everywhere downstream.
    expect(ageHoursSince('2026-08-28T18:00:00.000Z', now)).toBe(0)
  })

  it('treats an unparseable timestamp as infinitely old, not brand new', () => {
    // Returning 0 here would hand a broken row the freshness bonus.
    expect(ageHoursSince('not a date', now)).toBe(Number.POSITIVE_INFINITY)
    expect(ageHoursSince('', now)).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('sumTagAffinity', () => {
  it('adds the scores rather than averaging them', () => {
    // get_feed uses sum(), so three liked tags beat one liked tag.
    expect(sumTagAffinity([{ score: 0.4 }, { score: 0.5 }, { score: 0.3 }])).toBeCloseTo(1.2)
  })

  it('is zero for a post with no tags the viewer has affinity for', () => {
    expect(sumTagAffinity([])).toBe(0)
  })

  it('coalesces nulls and keeps negative affinity negative', () => {
    expect(sumTagAffinity([{ score: null }, { score: -0.75 }])).toBe(-0.75)
  })
})

describe('explainPost', () => {
  const now = Date.parse('2026-08-28T12:00:00.000Z')

  const facts: RankingPostFacts = {
    createdAt: '2026-08-20T12:00:00.000Z',
    likeCount: 0,
    commentCount: 0,
    isFollowing: false,
  }

  it('has nothing to say about a cold post shown to a logged-out viewer', () => {
    // The honest answer, and a state the UI has to render as itself.
    expect(explainPost(facts, EMPTY_SIGNALS, now)).toEqual([])
  })

  it('reads the four row-derived facts straight through', () => {
    const reasons = explainPost(
      { ...facts, isFollowing: true, likeCount: 12, commentCount: 3 },
      EMPTY_SIGNALS,
      now
    )

    const labels = reasons.map((reason) => reason.label)
    expect(labels).toContain('You follow this creator')
    expect(labels).toContain('Popular with other viewers')
  })

  it('reads the three fetched signals straight through', () => {
    const reasons = explainPost(
      facts,
      { completion: 0.9, creatorAffinity: 1.5, tagAffinity: 1.2 },
      now
    )

    const labels = reasons.map((reason) => reason.label)
    expect(labels).toContain('Most viewers watch it through')
    expect(labels).toContain('You watch this creator a lot')
    expect(labels).toContain('Matches topics you watch')
  })

  it('derives freshness from createdAt against the same threshold as the feed', () => {
    const fresh = explainPost(
      { ...facts, createdAt: '2026-08-28T10:00:00.000Z' },
      EMPTY_SIGNALS,
      now
    )
    const stale = explainPost(facts, EMPTY_SIGNALS, now)

    expect(fresh.map((r) => r.label)).toContain('Recently posted')
    expect(stale.map((r) => r.label)).not.toContain('Recently posted')
    // Pinned so a change to the SQL's 6-hour window cannot silently leave this
    // explaining a bonus the post no longer receives.
    expect(FRESH_BONUS_MAX_AGE_HOURS).toBe(6)
  })

  it('defaults to no signals, so a failed lookup degrades instead of throwing', () => {
    expect(() => explainPost({ ...facts, isFollowing: true })).not.toThrow()
    expect(explainPost({ ...facts, isFollowing: true }).length).toBeGreaterThan(0)
  })

  it('keeps the strongest reason first', () => {
    const reasons = explainPost(
      { ...facts, isFollowing: true, createdAt: '2026-08-28T11:00:00.000Z' },
      { completion: 0.95, creatorAffinity: 0, tagAffinity: 0 },
      now
    )

    expect(reasons[0].label).toBe('Most viewers watch it through')
  })
})

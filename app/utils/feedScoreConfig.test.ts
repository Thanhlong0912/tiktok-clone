import { describe, expect, it } from 'vitest'
import {
  DECAY_PER_HOUR,
  ENGAGEMENT_PRIOR_VIEWS,
  explainRanking,
  FEED_SCORE_WEIGHTS,
  FRESH_BONUS_MAX_AGE_HOURS,
  WATCH_TIME_SATURATION_MS,
} from './feedScoreConfig'

describe('FEED_SCORE_WEIGHTS', () => {
  /**
   * Pinned to the values in public.feed_rank_score
   * (supabase/migrations/0003_feed_rpcs.sql). This test failing means the two
   * have drifted -- update BOTH, not just whichever one is convenient.
   */
  it('matches the weights the SQL ranking function was written with', () => {
    expect(FEED_SCORE_WEIGHTS).toEqual({
      like: 6,
      comment: 9,
      save: 8,
      repost: 10,
      share: 7,
      completion: 14,
      watchTime: 4,
      creatorAffinity: 5,
      tagAffinity: 4,
      following: 3,
      freshBonus: 1.5,
      skipPenalty: 8,
      notInterestedPenalty: 6,
      negativeTagPenalty: 3,
    })

    expect(ENGAGEMENT_PRIOR_VIEWS).toBe(40)
    expect(DECAY_PER_HOUR).toBe(0.045)
    expect(FRESH_BONUS_MAX_AGE_HOURS).toBe(6)
    expect(WATCH_TIME_SATURATION_MS).toBe(15000)
  })

  it('weights completion above any single engagement action', () => {
    // The point of the formula: this is a video feed, not a like-ranked feed.
    const engagement = [
      FEED_SCORE_WEIGHTS.like,
      FEED_SCORE_WEIGHTS.comment,
      FEED_SCORE_WEIGHTS.save,
      FEED_SCORE_WEIGHTS.repost,
      FEED_SCORE_WEIGHTS.share,
    ]
    engagement.forEach((weight) => {
      expect(FEED_SCORE_WEIGHTS.completion).toBeGreaterThan(weight)
    })
  })

  it('gives a decay half-life of roughly 15 hours', () => {
    const halfLife = Math.log(2) / DECAY_PER_HOUR
    expect(halfLife).toBeGreaterThan(14)
    expect(halfLife).toBeLessThan(16)
  })
})

describe('explainRanking', () => {
  const base = {
    isFollowing: false,
    creatorAffinity: 0,
    tagAffinity: 0,
    ageHours: 100,
    completion: 0,
    likeCount: 0,
    commentCount: 0,
  }

  it('explains nothing when there is nothing to explain', () => {
    expect(explainRanking(base)).toEqual([])
  })

  it('reports following as a reason', () => {
    const reasons = explainRanking({ ...base, isFollowing: true })
    expect(reasons.map((r) => r.label)).toContain('You follow this creator')
  })

  it('reports freshness only for recent posts', () => {
    const fresh = explainRanking({ ...base, ageHours: 1 }).map((r) => r.label)
    const old = explainRanking({ ...base, ageHours: 50 }).map((r) => r.label)

    expect(fresh).toContain('Recently posted')
    expect(old).not.toContain('Recently posted')
  })

  it('orders reasons by how much they contributed', () => {
    const reasons = explainRanking({
      ...base,
      isFollowing: true,
      completion: 0.9,
      ageHours: 1,
    })

    const weights = reasons.map((r) => Math.abs(r.weight))
    const sorted = weights.slice().sort((a, b) => b - a)
    expect(weights).toEqual(sorted)
    expect(reasons[0].label).toBe('Most viewers watch it through')
  })

  it('caps affinity contributions the same way the SQL clamps them', () => {
    const huge = explainRanking({ ...base, creatorAffinity: 99 })
    const atCap = explainRanking({ ...base, creatorAffinity: 3 })

    expect(huge[0].weight).toBe(atCap[0].weight)
  })

  it('ignores weak affinity signals rather than listing noise', () => {
    expect(explainRanking({ ...base, creatorAffinity: 0.1, tagAffinity: 0.1 })).toEqual([])
  })

  it('includes the actual counts in the popularity detail', () => {
    const reasons = explainRanking({ ...base, likeCount: 12, commentCount: 3 })
    expect(reasons[0].detail).toBe('12 likes, 3 comments.')
  })

  it('pluralises the counts it prints', () => {
    // This string is read by users in the "Why this content?" panel, where
    // "1 likes" reads as a bug.
    expect(explainRanking({ ...base, likeCount: 1, commentCount: 0 })[0].detail)
      .toBe('1 like, 0 comments.')
    expect(explainRanking({ ...base, likeCount: 0, commentCount: 1 })[0].detail)
      .toBe('0 likes, 1 comment.')
  })
})

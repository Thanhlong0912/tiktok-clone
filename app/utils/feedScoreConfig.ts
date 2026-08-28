import { countLabel } from './formatNumber'

/**
 * The ranking weights, mirrored from public.feed_rank_score in
 * supabase/migrations/0003_feed_rpcs.sql.
 *
 * Ranking runs in Postgres -- this module does NOT rank anything. It exists so
 * the weights are reviewable and diffable in TypeScript alongside the rest of
 * the product, and so "Why this content?" can explain a score to a user using
 * the same numbers the server used.
 *
 * If you change a weight here, change the SQL too. feedScoreConfig.test.ts
 * pins the values that the accompanying migration was written with, so an
 * unsynchronised edit on either side shows up as a failing test rather than a
 * silently different feed.
 */

export interface FeedScoreWeights {
  like: number
  comment: number
  save: number
  repost: number
  share: number
  completion: number
  watchTime: number
  creatorAffinity: number
  tagAffinity: number
  following: number
  freshBonus: number
  skipPenalty: number
  notInterestedPenalty: number
  negativeTagPenalty: number
}

export const FEED_SCORE_WEIGHTS: FeedScoreWeights = {
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
}

/** Pseudo-views added to every rate denominator so a 1-view post cannot spike. */
export const ENGAGEMENT_PRIOR_VIEWS = 40

/** exp(-DECAY_PER_HOUR * ageHours). 0.045 is roughly a 15-hour half-life. */
export const DECAY_PER_HOUR = 0.045

/** Posts younger than this get the exploration bonus. */
export const FRESH_BONUS_MAX_AGE_HOURS = 6

/** Watch time is credited up to this, then flattens. */
export const WATCH_TIME_SATURATION_MS = 15000

export interface ScoreContribution {
  label: string
  weight: number
  detail: string
}

/**
 * Human-readable breakdown of why a post ranked where it did, for the
 * "Why this content?" panel in app/components/VideoOptionsMenu.tsx. Ordered by
 * absolute contribution.
 *
 * Assembled from a post row plus app/utils/rankingSignals.ts by explainPost()
 * in app/utils/rankingExplain.ts, which is what callers should reach for.
 */
export function explainRanking(input: {
  isFollowing: boolean
  creatorAffinity: number
  tagAffinity: number
  ageHours: number
  completion: number
  likeCount: number
  commentCount: number
}): ScoreContribution[] {
  const out: ScoreContribution[] = []

  if (input.isFollowing) {
    out.push({
      label: 'You follow this creator',
      weight: FEED_SCORE_WEIGHTS.following,
      detail: 'Posts from creators you follow rank higher.',
    })
  }

  if (input.creatorAffinity > 0.2) {
    out.push({
      label: 'You watch this creator a lot',
      weight: FEED_SCORE_WEIGHTS.creatorAffinity * Math.min(input.creatorAffinity, 3),
      detail: 'Built from how much of their videos you have watched.',
    })
  }

  if (input.tagAffinity > 0.2) {
    out.push({
      label: 'Matches topics you watch',
      weight: FEED_SCORE_WEIGHTS.tagAffinity * Math.min(input.tagAffinity, 3),
      detail: 'Based on the hashtags on videos you finish.',
    })
  }

  if (input.completion > 0.5) {
    out.push({
      label: 'Most viewers watch it through',
      weight: FEED_SCORE_WEIGHTS.completion * input.completion,
      detail: 'Completion rate is the strongest signal in the feed.',
    })
  }

  if (input.ageHours < FRESH_BONUS_MAX_AGE_HOURS) {
    out.push({
      label: 'Recently posted',
      weight: FEED_SCORE_WEIGHTS.freshBonus,
      detail: 'New posts get a temporary boost so they can find an audience.',
    })
  }

  if (input.likeCount + input.commentCount > 0) {
    out.push({
      label: 'Popular with other viewers',
      weight: FEED_SCORE_WEIGHTS.like,
      // countLabel rather than a local helper: this string is read by users,
      // and it should both pluralise ("1 like") and abbreviate ("1.2K likes")
      // the same way every other count in the app does.
      detail: `${countLabel(input.likeCount, 'like')}, ${countLabel(input.commentCount, 'comment')}.`,
    })
  }

  return out.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
}

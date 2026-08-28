import { explainRanking, type ScoreContribution } from './feedScoreConfig'

/**
 * Assembles the input explainRanking() wants out of the two places its parts
 * actually live.
 *
 * Pure, and deliberately free of the supabase import: the fetching half is
 * app/utils/rankingSignals.ts, the same split feedCursor/feed, accountList/
 * accounts and commentThread/comments already use, so vitest can exercise this
 * without an env.
 *
 * The division is not arbitrary. Four of the seven ranking inputs ride along on
 * every feed_post row the client already has; the other three are the viewer's
 * own signals and the post's aggregate watch quality, which have to be read
 * from tables. Keeping the assembly here means the UI never has to know which
 * is which.
 */

export type { ScoreContribution }

/** The three inputs that are NOT on a feed_post row. */
export interface RankingSignals {
  /** post_scores.avg_completion -- how much of it viewers generally watch. */
  completion: number
  /** user_creator_affinity.score for (viewer, author). May be negative. */
  creatorAffinity: number
  /** Summed user_topic_affinity over the post's hashtags. May be negative. */
  tagAffinity: number
}

/** The four inputs that ARE on a feed_post row. */
export interface RankingPostFacts {
  createdAt: string
  likeCount: number
  commentCount: number
  isFollowing: boolean
}

/**
 * What a logged-out viewer, an unranked post, or a failed lookup resolves to.
 * All three affinity/quality signals absent is a legitimate state, not an
 * error: explainRanking simply omits their rows.
 */
export const EMPTY_SIGNALS: RankingSignals = {
  completion: 0,
  creatorAffinity: 0,
  tagAffinity: 0,
}

/**
 * Hours since a post was created, as get_feed computes it.
 *
 * Never negative -- the SQL clamps with greatest(..., 0) and a clock skewed
 * ahead of the server would otherwise read as a negative age. An unparseable
 * timestamp yields Infinity rather than 0, so a broken date can never be
 * mistaken for a brand new post and claim the freshness bonus it did not get.
 */
export function ageHoursSince(createdAt: string, now: number = Date.now()): number {
  const created = Date.parse(createdAt)
  if (!Number.isFinite(created)) return Number.POSITIVE_INFINITY

  return Math.max(0, (now - created) / 3_600_000)
}

/**
 * Mirrors get_feed's `coalesce(sum(t.score), 0)` over the post's hashtags: the
 * affinities ADD UP rather than averaging, so a post carrying three tags the
 * viewer likes outranks one carrying a single tag they like.
 */
export function sumTagAffinity(rows: Array<{ score: number | null }>): number {
  return rows.reduce((total, row) => total + (row.score ?? 0), 0)
}

/**
 * The reasons this post ranked where it did, strongest first.
 *
 * Returns an empty array when nothing crossed a threshold worth naming, which
 * the caller must render as its own state rather than as a failure -- see the
 * "explains nothing when there is nothing to explain" case in
 * feedScoreConfig.test.ts. A cold post shown to a logged-out viewer genuinely
 * has no personal reason behind it, and saying so is the honest answer.
 */
export function explainPost(
  facts: RankingPostFacts,
  signals: RankingSignals = EMPTY_SIGNALS,
  now: number = Date.now()
): ScoreContribution[] {
  return explainRanking({
    isFollowing: facts.isFollowing,
    creatorAffinity: signals.creatorAffinity,
    tagAffinity: signals.tagAffinity,
    ageHours: ageHoursSince(facts.createdAt, now),
    completion: signals.completion,
    likeCount: facts.likeCount,
    commentCount: facts.commentCount,
  })
}

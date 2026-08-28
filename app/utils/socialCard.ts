import { countLabel } from './formatNumber'

/**
 * Builds the title / description / image a link preview shows.
 *
 * Pure, and free of the supabase import for the reason feedCursor, accountList
 * and rankingExplain are: vitest runs without an env. The fetching half is
 * app/utils/metadataFetch.ts, which runs on the server.
 *
 * These strings are the ONLY part of this app a crawler ever sees. Every page
 * is a client component, so there is no rendered markup behind them to fall
 * back on -- if a value is wrong or empty here, the card is wrong or empty
 * everywhere the link is pasted.
 */

export interface SocialCard {
  title: string
  description: string
  /** Absolute URL, or '' when the subject has no usable image. */
  image: string
}

/** Longest a title can be before Slack, iMessage and Twitter clip it anyway. */
export const MAX_TITLE = 70
export const MAX_DESCRIPTION = 200

/**
 * Trims on a word boundary and appends an ellipsis, so a clipped caption does
 * not end mid-word. Collapses whitespace first: captions are free text and a
 * newline inside a preview title renders as a stray space or worse.
 */
export function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean

  const cut = clean.slice(0, max - 1)
  const lastSpace = cut.lastIndexOf(' ')

  // A single very long word has no boundary to break on; a hard cut is the
  // only option that still respects the limit.
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

export interface PostCardInput {
  text: string
  authorName: string
  likeCount: number
  commentCount: number
  /** Public URL of the creator-chosen cover frame, or '' when there is none. */
  posterUrl: string
}

/**
 * The caption carries the title, the way it does on TikTok itself -- it is the
 * only part of a post that says what the post IS. A captionless post (seeded,
 * or predating the required-caption rule) falls back to naming the creator.
 *
 * `authorName` is the display name, deliberately unprefixed. `@` means the
 * handle everywhere in this app, and get_post returns SETOF feed_post, which
 * carries no handle -- so this says "Jane Doe" rather than inventing "@Jane
 * Doe" or spending a second round trip on a preview card.
 */
export function postCard(input: PostCardInput): SocialCard {
  const caption = input.text.trim()

  return {
    title: caption
      ? truncate(caption, MAX_TITLE)
      : `Video by ${truncate(input.authorName, 40) || 'a creator'}`,
    description: truncate(
      `${input.authorName ? `${input.authorName} · ` : ''}` +
        `${countLabel(input.likeCount, 'like')} · ${countLabel(input.commentCount, 'comment')}`,
      MAX_DESCRIPTION
    ),
    image: input.posterUrl,
  }
}

export interface ProfileCardInput {
  name: string
  handle: string
  bio: string
  followerCount: number
  totalLikes: number
  imageUrl: string
}

/**
 * Both names, because they do different jobs: the display name is who they
 * are and the handle is the identity you would search for. The bio leads the
 * description when there is one -- it is the creator's own summary of
 * themselves, and beats a stat line.
 */
export function profileCard(input: ProfileCardInput): SocialCard {
  const name = input.name.trim()
  const handle = input.handle.trim()
  const bio = input.bio.trim()

  const stats =
    `${countLabel(input.followerCount, 'follower')} · ${countLabel(input.totalLikes, 'like')}`

  return {
    title: truncate(
      handle ? (name ? `${name} (@${handle})` : `@${handle}`) : name || 'Profile',
      MAX_TITLE
    ),
    description: truncate(bio ? `${bio} · ${stats}` : stats, MAX_DESCRIPTION),
    image: input.imageUrl,
  }
}

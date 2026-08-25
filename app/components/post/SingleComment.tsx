'use client'

import Link from 'next/link'
import moment from 'moment'
import { AiFillHeart, AiOutlineHeart } from 'react-icons/ai'
import { BiLoaderCircle } from 'react-icons/bi'
import { BsTrash3 } from 'react-icons/bs'
import { FaHeart } from 'react-icons/fa'
import CaptionText from '../CaptionText'
import { createBucketUrl } from '@/app/hooks/useCreateBucketUrl'
import { formatCount } from '@/app/utils/formatNumber'
import type { CommentNode } from '@/app/utils/commentThread'

type SingleCommentProps = {
  comment: CommentNode
  /** The signed-in viewer, or null. Drives delete and the like button target. */
  viewerId: string | null
  /** Replies are inset and drop the reply affordance -- threads are two deep. */
  isReply?: boolean
  isDeleting?: boolean
  isRepliesOpen?: boolean
  isRepliesLoading?: boolean
  onToggleLike: (comment: CommentNode) => void
  onReply?: (comment: CommentNode) => void
  onDelete: (comment: CommentNode) => void
  onToggleReplies?: (comment: CommentNode) => void
}

/**
 * One comment, at either level.
 *
 * Deliberately one component for both: get_post_comments and
 * get_comment_replies return the identical column list precisely so a reply
 * needs no separate renderer, and the two can never drift the way the feed
 * drawer and the detail page had.
 *
 * Two behaviours worth keeping:
 *
 *   * The body goes through CaptionText, so #hashtags and @mentions inside a
 *     comment are links. They used to render as inert text here while the same
 *     tokens in the post caption directly above were clickable.
 *   * Deletion is confirmed by the caller, not by window.confirm() -- the old
 *     implementation used a native confirm() and a native alert() on failure,
 *     which are unstyled, unblockable and untestable.
 */
const SingleComment = ({
  comment,
  viewerId,
  isReply = false,
  isDeleting = false,
  isRepliesOpen = false,
  isRepliesLoading = false,
  onToggleLike,
  onReply,
  onDelete,
  onToggleReplies,
}: SingleCommentProps) => {
  const isOwn = Boolean(viewerId) && viewerId === comment.user_id
  const canExpand = !isReply && comment.reply_count > 0

  return (
    <div
      className={`flex items-start gap-3 px-4 py-3 lg:px-6 ${isReply ? 'pl-12 lg:pl-16' : ''}`}
    >
      <Link href={`/profile/${comment.profile.user_id}`} className="shrink-0">
        <img
          className={`rounded-full object-cover ${isReply ? 'h-8 w-8' : 'h-10 w-10'}`}
          src={createBucketUrl(comment.profile.image)}
          alt={`${comment.profile.name} avatar`}
        />
      </Link>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <Link
            href={`/profile/${comment.profile.user_id}`}
            className="max-w-full truncate text-[14px] font-semibold text-ink-soft hover:underline lg:text-[15px]"
          >
            {comment.profile.name}
          </Link>
          {comment.is_post_author ? (
            <span className="shrink-0 rounded bg-surface-subtle px-1.5 py-0.5 text-[11px] font-semibold text-ink-soft">
              Creator
            </span>
          ) : null}
        </div>

        <CaptionText
          text={comment.text}
          className="mt-1 block break-words text-[15px] leading-6 text-ink lg:text-[16px]"
        />

        <div className="mt-2 flex items-center gap-4 text-[13px] font-semibold text-ink-soft lg:text-[14px]">
          <span>{moment(comment.created_at).fromNow()}</span>

          {!isReply && onReply ? (
            <button onClick={() => onReply(comment)} className="hover:text-ink">
              Reply
            </button>
          ) : null}

          {/* The creator's heart. Only rendered when true -- an empty slot on
              every other comment would be noise. */}
          {comment.is_author_liked ? (
            <span
              className="inline-flex items-center gap-1 text-tiktok"
              title="Liked by the creator"
            >
              <FaHeart size={11} />
            </span>
          ) : null}

          {isOwn ? (
            <button
              disabled={isDeleting}
              onClick={() => onDelete(comment)}
              aria-label="Delete comment"
              className="inline-flex items-center text-ink-soft hover:text-ink disabled:opacity-60"
            >
              {isDeleting ? (
                <BiLoaderCircle className="animate-spin" size={15} />
              ) : (
                <BsTrash3 size={14} />
              )}
            </button>
          ) : null}
        </div>

        {canExpand ? (
          <button
            onClick={() => onToggleReplies?.(comment)}
            aria-expanded={isRepliesOpen}
            className="mt-2 inline-flex items-center gap-2 text-[13px] font-semibold text-ink-soft hover:text-ink lg:text-[14px]"
          >
            <span className="h-px w-6 bg-line" aria-hidden="true" />
            {isRepliesOpen
              ? 'Hide replies'
              : `View ${formatCount(comment.reply_count)} ${
                  comment.reply_count === 1 ? 'reply' : 'replies'
                }`}
            {isRepliesLoading ? <BiLoaderCircle className="animate-spin" size={13} /> : null}
          </button>
        ) : null}
      </div>

      {/* The like column sits outside the text block so long comments do not
          push it off the row, which is where TikTok puts it too. */}
      <button
        onClick={() => onToggleLike(comment)}
        aria-pressed={comment.is_liked}
        aria-label={comment.is_liked ? 'Unlike comment' : 'Like comment'}
        className="mt-1 flex w-8 shrink-0 flex-col items-center gap-0.5 text-ink-soft transition-colors hover:text-ink"
      >
        {comment.is_liked ? (
          <AiFillHeart size={18} className="tt-pop text-tiktok" />
        ) : (
          <AiOutlineHeart size={18} />
        )}
        <span className="text-[12px] font-semibold tabular-nums">
          {comment.like_count > 0 ? formatCount(comment.like_count) : ''}
        </span>
      </button>
    </div>
  )
}

export default SingleComment

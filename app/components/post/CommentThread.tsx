'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { BiLoaderCircle } from 'react-icons/bi'
import { BsChatDots } from 'react-icons/bs'
import { IoClose } from 'react-icons/io5'
import SingleComment from './SingleComment'
import ClientOnly from '../ClientOnly'
import { useUser } from '@/app/context/user'
import { useGeneralStore } from '@/app/stores/general'
import { showToast } from '@/app/utils/toast'
import {
  COMMENT_PAGE_SIZE,
  createComment,
  deleteComment,
  fetchCommentReplies,
  fetchPostComments,
  likeComment,
  REPLY_PAGE_SIZE,
  unlikeComment,
} from '@/app/utils/comments'
import {
  applyCommentLike,
  bumpReplyCount,
  mergeCommentPage,
  nextCommentCursor,
  removeComment,
  type CommentCursor,
  type CommentNode,
} from '@/app/utils/commentThread'

type CommentThreadProps = {
  postId: string
  /**
   * 'sheet' is the feed drawer, which supplies its own header and lives inside
   * a fixed-height panel. 'page' is the post detail column, which owns the
   * heading itself.
   */
  variant?: 'sheet' | 'page'
  autoFocusInput?: boolean
  /** Lets the parent keep its own optimistic comment counter in step. */
  onCountChange?: (delta: number) => void
  /** Rendered above the list on the detail page. */
  heading?: boolean
  className?: string
}

interface ReplyState {
  items: CommentNode[]
  cursor: CommentCursor | null
  hasMore: boolean
  isLoading: boolean
}

const EMPTY_REPLIES: ReplyState = { items: [], cursor: null, hasMore: true, isLoading: false }

/**
 * The comment section, shared by the feed drawer and the post detail page.
 *
 * There used to be two: PostMain rendered its own inline list and Comments.tsx
 * rendered another, and they had already drifted -- only one linkified, only
 * one had a delete button in the right place, neither paginated. One component
 * for both, the same reasoning that produced ActionRail.
 *
 * State is local rather than in a store. The feed mounts several PostMain
 * cards at once, so a single global "the comments" list would be wrong for all
 * but one of them -- which is why PostMain already kept its comment state
 * local, and why app/stores/comment.tsx (whose own comment documented the
 * stale-thread problem) is gone.
 */
const CommentThread = ({
  postId,
  variant = 'page',
  autoFocusInput = false,
  onCountChange,
  heading = false,
  className = '',
}: CommentThreadProps) => {
  const { user } = useUser() || {}
  const { setIsLoginOpen } = useGeneralStore()

  const [comments, setComments] = useState<CommentNode[]>([])
  const [cursor, setCursor] = useState<CommentCursor | null>(null)
  const [hasMore, setHasMore] = useState<boolean>(true)
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [isPaging, setIsPaging] = useState<boolean>(false)
  const [hasError, setHasError] = useState<boolean>(false)
  const [reloadKey, setReloadKey] = useState<number>(0)

  const [replies, setReplies] = useState<Record<string, ReplyState>>({})
  const [openThreads, setOpenThreads] = useState<Record<string, boolean>>({})

  const [draft, setDraft] = useState<string>('')
  const [replyTarget, setReplyTarget] = useState<CommentNode | null>(null)
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const inputRef = useRef<HTMLInputElement | null>(null)
  const viewerId = user?.id ?? null

  // ------------------------------------------------------------ top level

  useEffect(() => {
    let active = true

    // Reset everything on a post change: this component is reused as the feed
    // drawer follows the viewer from card to card, so leaving the previous
    // thread on screen would attribute one video's comments to another.
    setComments([])
    setCursor(null)
    setHasMore(true)
    setReplies({})
    setOpenThreads({})
    setReplyTarget(null)
    setHasError(false)
    setIsLoading(true)

    fetchPostComments(postId, null, COMMENT_PAGE_SIZE)
      .then((page) => {
        if (!active) return
        setComments(page)
        setCursor(nextCommentCursor(page))
        setHasMore(page.length >= COMMENT_PAGE_SIZE)
      })
      .catch((error) => {
        if (!active) return
        console.error(error)
        setHasError(true)
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })

    return () => {
      active = false
    }
  }, [postId, reloadKey])

  const loadMore = useCallback(async () => {
    if (isPaging || !hasMore || !cursor) return

    setIsPaging(true)
    try {
      const page = await fetchPostComments(postId, cursor, COMMENT_PAGE_SIZE)
      setComments((current) => mergeCommentPage(current, page))
      setCursor(nextCommentCursor(page))
      setHasMore(page.length >= COMMENT_PAGE_SIZE)
    } catch (error) {
      console.error(error)
      showToast('Could not load more comments', 'error')
    } finally {
      setIsPaging(false)
    }
  }, [cursor, hasMore, isPaging, postId])

  // --------------------------------------------------------------- replies

  const loadReplies = useCallback(
    async (parentId: string, replace: boolean) => {
      const current = replies[parentId] ?? EMPTY_REPLIES
      if (current.isLoading) return
      if (!replace && !current.hasMore) return

      setReplies((state) => ({
        ...state,
        [parentId]: { ...(state[parentId] ?? EMPTY_REPLIES), isLoading: true },
      }))

      try {
        const from = replace ? null : current.cursor
        const page = await fetchCommentReplies(parentId, from, REPLY_PAGE_SIZE)

        setReplies((state) => {
          const prev = replace ? EMPTY_REPLIES : state[parentId] ?? EMPTY_REPLIES
          const items = mergeCommentPage(prev.items, page)

          return {
            ...state,
            [parentId]: {
              items,
              cursor: nextCommentCursor(page) ?? prev.cursor,
              hasMore: page.length >= REPLY_PAGE_SIZE,
              isLoading: false,
            },
          }
        })
      } catch (error) {
        console.error(error)
        showToast('Could not load replies', 'error')
        setReplies((state) => ({
          ...state,
          [parentId]: { ...(state[parentId] ?? EMPTY_REPLIES), isLoading: false },
        }))
      }
    },
    [replies]
  )

  const toggleReplies = useCallback(
    (comment: CommentNode) => {
      const isOpen = Boolean(openThreads[comment.id])
      setOpenThreads((state) => ({ ...state, [comment.id]: !isOpen }))

      // Fetched on first expand only. Collapsing keeps what was loaded so
      // re-opening is instant and does not re-query.
      if (!isOpen && (replies[comment.id]?.items.length ?? 0) < 1) {
        void loadReplies(comment.id, true)
      }
    },
    [loadReplies, openThreads, replies]
  )

  // ------------------------------------------------------------------ like

  /**
   * Optimistic with rollback, the same pattern the action rail and the follow
   * button use. The counter and the flag move together in one pure reducer so
   * a failed round trip restores exactly what was there.
   */
  const toggleLike = useCallback(
    async (comment: CommentNode) => {
      if (!viewerId) {
        setIsLoginOpen(true)
        return
      }

      const next = !comment.is_liked
      const parentId = comment.parent_id

      const patch = (liked: boolean) => {
        if (parentId) {
          setReplies((state) => {
            const thread = state[parentId]
            if (!thread) return state
            return {
              ...state,
              [parentId]: { ...thread, items: applyCommentLike(thread.items, comment.id, liked) },
            }
          })
        } else {
          setComments((current) => applyCommentLike(current, comment.id, liked))
        }
      }

      patch(next)

      try {
        if (next) {
          await likeComment(viewerId, comment.id)
        } else {
          await unlikeComment(viewerId, comment.id)
        }
      } catch (error) {
        console.error(error)
        patch(!next)
        showToast('Could not update that like', 'error')
      }
    },
    [setIsLoginOpen, viewerId]
  )

  // ---------------------------------------------------------------- delete

  const removeOne = useCallback(
    async (comment: CommentNode) => {
      if (deletingId) return

      setDeletingId(comment.id)
      try {
        await deleteComment(comment.id)

        if (comment.parent_id) {
          const parentId = comment.parent_id
          setReplies((state) => {
            const thread = state[parentId]
            if (!thread) return state
            return { ...state, [parentId]: { ...thread, items: removeComment(thread.items, comment.id) } }
          })
          setComments((current) => bumpReplyCount(current, parentId, -1))
          onCountChange?.(-1)
        } else {
          // The cascade in 0007 takes the replies with it, so the post's
          // comment_count drops by the whole thread, not by one.
          setComments((current) => removeComment(current, comment.id))
          onCountChange?.(-(1 + comment.reply_count))
          setReplies((state) => {
            const { [comment.id]: _dropped, ...rest } = state
            return rest
          })
        }

        showToast('Comment deleted')
      } catch (error) {
        console.error(error)
        showToast('Could not delete that comment', 'error')
      } finally {
        setDeletingId(null)
      }
    },
    [deletingId, onCountChange]
  )

  // ------------------------------------------------------------------ post

  useEffect(() => {
    if (!autoFocusInput) return

    const timer = setTimeout(() => inputRef.current?.focus(), 60)
    return () => clearTimeout(timer)
  }, [autoFocusInput, postId])

  const startReply = useCallback((comment: CommentNode) => {
    setReplyTarget(comment)
    setTimeout(() => inputRef.current?.focus(), 40)
  }, [])

  const submit = useCallback(async () => {
    if (!viewerId) {
      setIsLoginOpen(true)
      return
    }

    const text = draft.trim()
    if (!text || isSubmitting) return

    const parent = replyTarget
    setIsSubmitting(true)
    try {
      await createComment(viewerId, postId, text, parent?.id ?? null)
      setDraft('')
      setReplyTarget(null)
      onCountChange?.(1)

      if (parent) {
        setComments((current) => bumpReplyCount(current, parent.id, 1))
        // Force the thread open and re-read it, so the new reply is visible
        // where it was written rather than behind a "View replies" button.
        setOpenThreads((state) => ({ ...state, [parent.id]: true }))
        await loadReplies(parent.id, true)
      } else {
        // Re-read the first page rather than splicing a synthetic row in:
        // the server owns created_at, the counters and the Creator badge, and
        // a hand-built row would get at least one of them wrong.
        const page = await fetchPostComments(postId, null, COMMENT_PAGE_SIZE)
        setComments(page)
        setCursor(nextCommentCursor(page))
        setHasMore(page.length >= COMMENT_PAGE_SIZE)
      }
    } catch (error) {
      console.error(error)
      showToast('Could not post your comment', 'error')
    } finally {
      setIsSubmitting(false)
    }
  }, [draft, isSubmitting, loadReplies, onCountChange, postId, replyTarget, setIsLoginOpen, viewerId])

  // ----------------------------------------------------------------- render

  const isSheet = variant === 'sheet'

  const list = (
    <>
      {isLoading ? (
        <div className="space-y-4 px-4 py-4 lg:px-6">
          {[...Array(4)].map((_, index) => (
            <div key={index} className="flex items-start gap-3">
              <div className="tt-shimmer h-10 w-10 shrink-0 rounded-full" />
              <div className="flex-1">
                <div className="tt-shimmer h-3 w-24 rounded" />
                <div className="tt-shimmer mt-2 h-3 w-3/4 rounded" />
                <div className="tt-shimmer mt-2 h-3 w-1/3 rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : hasError ? (
        <div className="px-4 py-10 text-center">
          <p className="text-[15px] font-semibold text-ink">Couldn&apos;t load comments.</p>
          <button
            onClick={() => setReloadKey((key) => key + 1)}
            className="mt-3 rounded-full bg-surface-subtle px-5 py-2 text-[13px] font-semibold text-ink"
          >
            Try again
          </button>
        </div>
      ) : comments.length < 1 ? (
        <div className="px-4 py-12 text-center">
          <p className="text-[15px] font-semibold text-ink">No comments yet</p>
          <p className="mt-1 text-[13px] text-ink-soft">Be the first to say something.</p>
        </div>
      ) : (
        <div>
          {comments.map((comment) => {
            const thread = replies[comment.id] ?? EMPTY_REPLIES
            const isOpen = Boolean(openThreads[comment.id])

            return (
              <div key={comment.id}>
                <SingleComment
                  comment={comment}
                  viewerId={viewerId}
                  isDeleting={deletingId === comment.id}
                  isRepliesOpen={isOpen}
                  isRepliesLoading={thread.isLoading}
                  onToggleLike={toggleLike}
                  onReply={startReply}
                  onDelete={removeOne}
                  onToggleReplies={toggleReplies}
                />

                {isOpen ? (
                  <div>
                    {thread.items.map((reply) => (
                      <SingleComment
                        key={reply.id}
                        comment={reply}
                        viewerId={viewerId}
                        isReply
                        isDeleting={deletingId === reply.id}
                        onToggleLike={toggleLike}
                        onDelete={removeOne}
                      />
                    ))}

                    {thread.hasMore && thread.items.length > 0 ? (
                      <button
                        onClick={() => loadReplies(comment.id, false)}
                        disabled={thread.isLoading}
                        className="pb-3 pl-12 text-[13px] font-semibold text-ink-soft hover:text-ink disabled:opacity-60 lg:pl-16"
                      >
                        {thread.isLoading ? 'Loading...' : 'View more replies'}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )
          })}

          {hasMore ? (
            <div className="px-4 py-4 text-center lg:px-6">
              <button
                onClick={loadMore}
                disabled={isPaging}
                className="rounded-full bg-surface-subtle px-6 py-2 text-[13px] font-semibold text-ink disabled:opacity-60"
              >
                {isPaging ? 'Loading...' : 'Load more comments'}
              </button>
            </div>
          ) : null}
        </div>
      )}
    </>
  )

  return (
    <div className={`relative flex h-full min-h-0 w-full flex-col bg-surface text-ink ${className}`}>
      {heading ? (
        <div className="shrink-0 px-4 pb-2 pt-1 lg:px-8">
          <p className="text-[26px] font-semibold tracking-tight md:text-[20px] lg:text-[28px]">
            Comments
          </p>
        </div>
      ) : null}

      <div
        className={`relative z-0 min-h-0 w-full flex-1 overflow-auto bg-surface ${
          isSheet ? '' : 'border-t border-line'
        }`}
      >
        <ClientOnly>{list}</ClientOnly>
      </div>

      <div
        className={`w-full shrink-0 border-t border-line bg-surface px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+12px)] ${
          isSheet ? '' : 'lg:px-8'
        }`}
      >
        {replyTarget ? (
          <div className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-surface-subtle px-3 py-1.5">
            <span className="truncate text-[13px] text-ink-soft">
              Replying to <span className="font-semibold text-ink">@{replyTarget.profile.handle}</span>
            </span>
            <button
              onClick={() => setReplyTarget(null)}
              aria-label="Cancel reply"
              className="shrink-0 text-ink-soft hover:text-ink"
            >
              <IoClose size={17} />
            </button>
          </div>
        ) : null}

        {!viewerId ? (
          <button
            onClick={() => setIsLoginOpen(true)}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-tiktok py-3 text-[15px] font-semibold text-white hover:bg-tiktok-hover"
          >
            <BsChatDots size={18} />
            Log in to comment
          </button>
        ) : (
          <div className="flex items-center gap-3">
            <label className="sr-only" htmlFor={`comment-input-${postId}`}>
              {replyTarget ? `Reply to ${replyTarget.profile.name}` : 'Add comment'}
            </label>
            <input
              id={`comment-input-${postId}`}
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void submit()
                if (event.key === 'Escape' && replyTarget) setReplyTarget(null)
              }}
              className="w-full rounded-full border border-transparent bg-surface-subtle px-4 py-2.5 text-[15px] text-ink outline-none placeholder:text-ink-soft focus:border-line"
              type="text"
              placeholder={replyTarget ? 'Add a reply...' : 'Add comment...'}
            />

            {!isSubmitting ? (
              <button
                disabled={!draft.trim()}
                onClick={() => void submit()}
                className={`shrink-0 text-sm font-semibold ${
                  draft.trim() ? 'text-tiktok' : 'text-ink-soft'
                }`}
              >
                Post
              </button>
            ) : (
              <BiLoaderCircle className="shrink-0 animate-spin text-tiktok" size={20} />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default CommentThread

import React, { useEffect, useRef, useState } from 'react'
import ClientOnly from '../ClientOnly'
import { CommentsCompTypes } from '@/app/types'
import { BiLoaderCircle } from "react-icons/bi"
import { BsChatDots } from 'react-icons/bs'
import SingleComment from './SingleComment'
import { useCommentStore } from '@/app/stores/comment'
import { useGeneralStore } from '@/app/stores/general'
import useCreateComment from '@/app/hooks/useCreateComment'
import { useUser } from '@/app/context/user'
import { showToast } from '@/app/utils/toast'

const Comments = ({ params, isMobileDetail = false, autoFocusInput = false }: CommentsCompTypes) => {

  let { commentsByPost, setCommentsByPost } = useCommentStore()
  let { setIsLoginOpen } = useGeneralStore()

  const contextUser = useUser()
  const [comment, setComment] = useState<string>('')
  const [inputFocused, setInputFocused] = useState<boolean>(false)
  const [isUploading, setIsUploading] = useState<boolean>(false)
  const commentInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!autoFocusInput) {
      return
    }

    const timer = setTimeout(() => {
      commentInputRef.current?.focus()
    }, 60)

    return () => clearTimeout(timer)
  }, [autoFocusInput, params.postId])

  const addComment = async () => {
    if (!contextUser?.user) return setIsLoginOpen(true)
    if (!comment.trim()) return

    try {
      setIsUploading(true)
      await useCreateComment(contextUser?.user?.id, params?.postId, comment.trim())
      setCommentsByPost(params?.postId)
      setComment('')
    } catch (error) {
      console.log(error)
      showToast('Could not post comment', 'error')
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <>
      <div className="relative flex h-full min-h-0 w-full flex-col bg-surface text-ink">
        <div
          className={`shrink-0 px-4 pb-2 pt-1 lg:px-8 ${isMobileDetail ? 'pt-0' : ''}`}
        >
          <p className="text-[26px] font-semibold tracking-tight md:text-[20px] lg:text-[28px]">
            Comments <span className="text-ink-soft">{commentsByPost.length}</span>
          </p>
        </div>

        <div
          id="Comments"
          className={`
            relative z-0 min-h-0 w-full flex-1 overflow-auto border-t border-line bg-surface
            px-0
          `}
        >
          <div className="pt-1" />

          <ClientOnly>
            {commentsByPost.length < 1 ? (
              <div className="mt-10 text-center text-[15px] text-ink-soft">No comments yet</div>
            ) : (
              <div>
                {commentsByPost.map((singleComment) => (
                  <SingleComment key={singleComment.id} comment={singleComment} params={params} />
                ))}
              </div>
            )}
          </ClientOnly>

          <div className={isMobileDetail ? 'mb-6' : 'mb-4'} />
        </div>

        <div
          id="CreateComment"
          className={`
            w-full shrink-0 border-t border-line bg-surface px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+12px)] lg:px-8
          `}
        >
          {!contextUser?.user ? (
            <button
              onClick={() => setIsLoginOpen(true)}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-[#F02C56] py-3 text-[16px] font-semibold text-white hover:bg-[#e61f4b]"
            >
              <BsChatDots size={19} />
              Log in to comment
            </button>
          ) : (
            <div className="flex items-center gap-3">
              <div
                className={`
                  flex w-full items-center rounded-full border bg-surface-subtle
                  ${inputFocused ? 'border-line' : 'border-transparent'}
                `}
              >
                <input
                  ref={commentInputRef}
                  onFocus={() => setInputFocused(true)}
                  onBlur={() => setInputFocused(false)}
                  onChange={e => setComment(e.target.value)}
                  value={comment || ''}
                  className="w-full rounded-full bg-transparent p-3 text-[15px] text-ink placeholder:text-ink-soft focus:outline-none"
                  type="text"
                  placeholder="Add comment..."
                />
              </div>

              {!isUploading ? (
                <button
                  disabled={!comment.trim()}
                  onClick={() => addComment()}
                  className={`
                    text-sm font-semibold
                    ${comment.trim() ? 'text-tiktok' : 'text-ink-soft'}
                  `}
                >
                  Post
                </button>
              ) : (
                <BiLoaderCircle className="animate-spin text-[#F02C56]" size={20} />
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

export default Comments

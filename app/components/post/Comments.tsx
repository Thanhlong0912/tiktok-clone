import React, { useEffect, useRef, useState } from 'react'
import ClientOnly from '../ClientOnly'
import { CommentsCompTypes } from '@/app/types'
import { BiLoaderCircle } from "react-icons/bi"
import SingleComment from './SingleComment'
import { useCommentStore } from '@/app/stores/comment'
import { useGeneralStore } from '@/app/stores/general'
import useCreateComment from '@/app/hooks/useCreateComment'
import { useUser } from '@/app/context/user'

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

    try {
        setIsUploading(true)
        await useCreateComment(contextUser?.user?.id, params?.postId, comment)
        setCommentsByPost(params?.postId)
        setComment('')
        setIsUploading(false)
    } catch (error) {
        console.log(error)
        alert(error)
    }
  }

  return (
    <>
      <div className="relative flex h-full w-full flex-col">
      <div
          id="Comments"
          className={`
            relative z-0 w-full flex-1 overflow-auto border-t-2 bg-[#F8F8F8] dark:bg-dark
            ${isMobileDetail ? 'px-0' : ''}
          `}
      >

          <div className="pt-2"/>

          <ClientOnly>
              {commentsByPost.length < 1 ? (
                  <div className="text-center mt-6 text-xl text-gray-500 dark:text-white">No comments...</div>
              ) : (
                  <div>
                      {commentsByPost.map((comment, index) => (
                          <SingleComment key={index} comment={comment} params={params} />
                      ))}
                  </div>
              )}
          </ClientOnly>

          <div className={isMobileDetail ? 'mb-6' : 'mb-28'} />

      </div>

      <div
          id="CreateComment"
          className={`
            flex items-center justify-between border-t-2 bg-white dark:bg-dark w-full
            px-4 lg:px-8 lg:py-5 py-3 lg:pb-5 pb-[calc(env(safe-area-inset-bottom)+8px)]
          `}
      >
          <div
              className={`
                  bg-[#F1F1F2] flex items-center rounded-lg w-full
                  ${inputFocused ? 'border-2 border-gray-400' : 'border-2 border-[#F1F1F2]'}
              `}
          >
              <input
                  ref={commentInputRef}
                  onFocus={() => setInputFocused(true)}
                  onBlur={() => setInputFocused(false)}
                  onChange={e => setComment(e.target.value)}
                  value={comment || ''}
                  className="bg-[#F1F1F2] text-[14px] focus:outline-none w-full p-2 rounded-lg"
                  type="text"
                  placeholder="Add comment..."
              />
          </div>
          {!isUploading ? (
              <button
                  disabled={!comment}
                  onClick={() => addComment()}
                  className={`
                      font-semibold text-sm ml-5 pr-1
                      ${comment ? 'text-[#F02C56] cursor-pointer' : 'text-gray-400 dark:text-white'}
                  `}
              >
                  Post
              </button>
          ) : (
              <BiLoaderCircle className="animate-spin" color="#E91E62" size="20" />
          )}
      </div>
      </div>
    </>
  )
}

export default Comments

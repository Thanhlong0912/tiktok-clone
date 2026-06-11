import { SingleCommentCompTypes } from '@/app/types'
import Link from 'next/link'
import React, { useState } from 'react'
import moment from "moment"
import { BiLoaderCircle } from 'react-icons/bi'
import { BsTrash3 } from 'react-icons/bs'
import { AiOutlineHeart } from 'react-icons/ai'
import { useUser } from '@/app/context/user'
import { useCommentStore } from '@/app/stores/comment'
import useDeleteComment from '@/app/hooks/useDeleteComment'
import useCreateBucketUrl from '@/app/hooks/useCreateBucketUrl'

const SingleComment = ({ comment, params }: SingleCommentCompTypes) => {
    const contextUser = useUser()
    let { setCommentsByPost } = useCommentStore()
    const [isDeleting, setIsDeleting] = useState(false)

    const deleteThisComment = async () => {
        let res = confirm("Are you sure you want to delete this comment?")
        if (!res) return

        try {
            setIsDeleting(true)
            await useDeleteComment(comment?.id)
            setCommentsByPost(params?.postId)
        } catch (error) {
            console.log(error)
            alert(error)
        } finally {
            setIsDeleting(false)
        }
    }

  return (
    <>
      <div id="SingleComment" className="flex items-start gap-3 px-4 py-3 lg:px-6">
        <Link href={`/profile/${comment.profile.user_id}`} className="shrink-0">
          <img
            className="h-10 w-10 rounded-full object-cover"
            src={useCreateBucketUrl(comment.profile.image)}
            alt={comment.profile.name}
          />
        </Link>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Link
                href={`/profile/${comment.profile.user_id}`}
                className="max-w-full truncate text-[17px] font-semibold text-gray-500 hover:underline dark:text-[#9CA0AA]"
              >
                {comment?.profile?.name}
              </Link>

              <p className="mt-1 break-words text-[16px] leading-6 text-gray-900 dark:text-white lg:text-[17px]">
                {comment.text}
              </p>

              <div className="mt-2 flex items-center gap-4 text-[14px] font-semibold text-gray-500 dark:text-[#9CA0AA]">
                <span>{moment(comment?.created_at).fromNow()}</span>
                <button className="hover:text-gray-900 dark:hover:text-white">Reply</button>

                {contextUser?.user?.id == comment.profile.user_id ? (
                  <button
                    disabled={isDeleting}
                    onClick={() => deleteThisComment()}
                    className="inline-flex items-center text-gray-500 hover:text-gray-900 disabled:opacity-60 dark:text-[#9CA0AA] dark:hover:text-white"
                  >
                    {isDeleting ? (
                      <BiLoaderCircle className="animate-spin" size="16" />
                    ) : (
                      <BsTrash3 size="15" />
                    )}
                  </button>
                ) : null}
              </div>
            </div>

            <button className="mt-1 inline-flex min-w-[40px] flex-col items-center text-gray-500 hover:text-gray-900 dark:text-[#9CA0AA] dark:hover:text-white">
              <AiOutlineHeart size={22} />
              <span className="text-[13px]">0</span>
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

export default SingleComment

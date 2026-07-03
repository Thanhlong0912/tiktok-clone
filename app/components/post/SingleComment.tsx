import { SingleCommentCompTypes } from '@/app/types'
import Link from 'next/link'
import React, { useState } from 'react'
import moment from "moment"
import { BiLoaderCircle } from 'react-icons/bi'
import { BsTrash3 } from 'react-icons/bs'
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
                className="max-w-full truncate text-[17px] font-semibold text-ink-soft hover:underline"
              >
                {comment?.profile?.name}
              </Link>

              <p className="mt-1 break-words text-[16px] leading-6 text-ink lg:text-[17px]">
                {comment.text}
              </p>

              <div className="mt-2 flex items-center gap-4 text-[14px] font-semibold text-ink-soft">
                <span>{moment(comment?.created_at).fromNow()}</span>

                {contextUser?.user?.id == comment.profile.user_id ? (
                  <button
                    disabled={isDeleting}
                    onClick={() => deleteThisComment()}
                    className="inline-flex items-center text-ink-soft hover:text-ink disabled:opacity-60"
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
          </div>
        </div>
      </div>
    </>
  )
}

export default SingleComment

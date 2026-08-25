import React from 'react'
import CommentThread from './CommentThread'
import { CommentsCompTypes } from '@/app/types'

/**
 * The post detail page's comment column.
 *
 * Now a wrapper: the list, the composer, replies and comment likes all live in
 * CommentThread, which the feed drawer renders too. Keeping the props exactly
 * as they were means app/post/[postId]/[userId]/page.tsx did not have to change
 * to get threading.
 */
const Comments = ({ params, isMobileDetail = false, autoFocusInput = false }: CommentsCompTypes) => (
  <CommentThread
    postId={params.postId}
    variant="page"
    heading
    autoFocusInput={autoFocusInput}
    className={isMobileDetail ? 'pt-0' : ''}
  />
)

export default Comments

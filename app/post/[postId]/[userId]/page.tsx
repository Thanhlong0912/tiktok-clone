"use client"

import ClientOnly from '@/app/components/ClientOnly'
import Comments from '@/app/components/post/Comments'
import CommentsHeader from '@/app/components/post/CommentsHeader'
import useCreateBucketUrl from '@/app/hooks/useCreateBucketUrl'
import { useCommentStore } from '@/app/stores/comment'
import { useLikeStore } from '@/app/stores/like'
import { usePostStore } from '@/app/stores/post'
import { PostPageTypes } from '@/app/types'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { AiOutlineClose } from "react-icons/ai"
import { BiChevronDown, BiChevronUp } from "react-icons/bi"

const Post = ({ params }: PostPageTypes) => {

    let { postById, postsByUser, setPostById, setPostsByUser } = usePostStore()
    let { setLikesByPost } = useLikeStore()
    let { setCommentsByPost } = useCommentStore()

    const router = useRouter()

    useEffect(() => {
        setPostById(params.postId)
        setCommentsByPost(params.postId)
        setLikesByPost(params.postId)
        setPostsByUser(params.userId)
    }, [params.postId, params.userId])

    const loopThroughPostsUp = () => {
        const currentIndex = postsByUser.findIndex(post => post.id === params.postId);
        if (currentIndex > 0) {
            const nextPost = postsByUser[currentIndex - 1];
            router.push(`/post/${nextPost.id}/${params.userId}`)
        }
    }

    const loopThroughPostsDown = () => {
        const currentIndex = postsByUser.findIndex(post => post.id === params.postId);
        if (currentIndex !== -1 && currentIndex < postsByUser.length - 1) {
            const prevPost = postsByUser[currentIndex + 1];
            router.push(`/post/${prevPost.id}/${params.userId}`)
        }
    }
  return (
    <>
      <div
          id="PostPage"
          className="lg:flex justify-between w-full h-screen bg-black overflow-auto"
      >
          <div className="lg:w-[calc(100%-540px)] h-full relative">
              <button
                  onClick={()=> {router.push(`/profile/${params.userId}`)}}
                  className="absolute text-white z-20 m-5 rounded-full bg-gray-700 p-1.5 hover:bg-gray-800"
              >
                  <AiOutlineClose size="27"/>
              </button>

              <div >
                  {postsByUser.findIndex(post => post.id === params.postId) > 0 && (
                      <button
                          onClick={() => loopThroughPostsUp()}
                          className="absolute z-20 right-4 top-[45%] flex items-center justify-center rounded-full bg-gray-700 p-1.5 hover:bg-gray-800"
                      >
                          <BiChevronUp size="30" color="#FFFFFF"/>
                      </button>
                  )}

                  {postsByUser.findIndex(post => post.id === params.postId) < postsByUser.length - 1 && (
                      <button
                          onClick={() => loopThroughPostsDown()}
                          className="absolute z-20 right-4 top-[55%] flex items-center justify-center rounded-full bg-gray-700 p-1.5 hover:bg-gray-800"
                      >
                          <BiChevronDown size="30" color="#FFFFFF"/>
                      </button>
                  )}
              </div>

              <img
                  className="absolute z-20 top-[18px] left-[70px] rounded-full lg:mx-0 mx-auto"
                  width="45"
                  src="/images/tiktok-logo-small.png"
              />

              <ClientOnly>
                  <div className="bg-black lg:min-w-[480px] z-10 relative">
                    {postById?.video_url ? (
                        <video
                            key={postById.video_url}
                            autoPlay
                            controls
                            loop
                            className="h-screen mx-auto"
                            src={useCreateBucketUrl(postById.video_url)}
                        />
                    ) : (
                        <div className="h-screen bg-black flex items-center justify-center">
                            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white"></div>
                        </div>
                    )}
                  </div>
              </ClientOnly>

          </div>

          <div id="InfoSection" className="lg:max-w-[550px] relative w-full h-full bg-white dark:bg-dark">
            <div className="py-7" />

                <ClientOnly>
                    {postById?.video_url ? (
                        <CommentsHeader post={postById} params={params}/>
                    ) : null}
                </ClientOnly>
                <Comments params={params}/>
          </div>
      </div>
    </>
  )
}

export default Post

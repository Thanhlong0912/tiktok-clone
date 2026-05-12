import { useUser } from '@/app/context/user'
import useCreateBucketUrl from '@/app/hooks/useCreateBucketUrl'
import useCreateLike from '@/app/hooks/useCreateLike'
import useDeleteLike from '@/app/hooks/useDeleteLike'
import useDeletePostById from '@/app/hooks/useDeletePostById'
import useIsLiked from '@/app/hooks/useIsLiked'
import { useCommentStore } from '@/app/stores/comment'
import { useGeneralStore } from '@/app/stores/general'
import { useLikeStore } from '@/app/stores/like'
import { CommentsHeaderCompTypes } from '@/app/types'
import moment from 'moment'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { AiFillHeart } from "react-icons/ai"
import { BiLoaderCircle } from "react-icons/bi"
import { BsChatDots, BsTrash3 } from "react-icons/bs"
import { ImMusic } from "react-icons/im"
import ClientOnly from '../ClientOnly'

const CommentsHeader = ({ post, params, isMobileDetail = false }: CommentsHeaderCompTypes) => {

    let { setLikesByPost, likesByPost } = useLikeStore()
    let { commentsByPost, setCommentsByPost } = useCommentStore()
    let { setIsLoginOpen } = useGeneralStore()

    const contextUser = useUser()
    const router = useRouter();
    const [hasClickedLike, setHasClickedLike] = useState<boolean>(false)
    const [isDeleteing, setIsDeleteing] = useState<boolean>(false)
    const [userLiked, setUserLiked] = useState<boolean>(false)

    useEffect(() => {
        setCommentsByPost(params?.postId)
        setLikesByPost(params?.postId)
    }, [post])

    useEffect(() => { hasUserLikedPost() }, [likesByPost])

    const hasUserLikedPost = () => {
        if (likesByPost.length < 1 || !contextUser?.user?.id) {
            setUserLiked(false)
            return
        }
        let res = useIsLiked(contextUser.user.id, params.postId, likesByPost)
        setUserLiked(res ? true : false)
    }

    const like = async () => {
        try {
            setHasClickedLike(true)
            await useCreateLike(contextUser?.user?.id || '', params.postId)
            setLikesByPost(params.postId)
            setHasClickedLike(false)
        } catch (error) {
            console.log(error)
            alert(error)
            setHasClickedLike(false)
        }
    }

    const unlike = async (id: string) => {
        try {
            setHasClickedLike(true)
            await useDeleteLike(id)
            setLikesByPost(params.postId)
            setHasClickedLike(false)
        } catch (error) {
            console.log(error)
            alert(error)
            setHasClickedLike(false)
        }
    }

    const likeOrUnlike = () => {
        if (!contextUser?.user) return setIsLoginOpen(true)

        let res = useIsLiked(contextUser.user.id, params.postId, likesByPost)
        if (!res) {
            like()
        } else {
            likesByPost.forEach(like => {
                if (contextUser?.user?.id && contextUser.user.id == like.user_id && like.post_id == params.postId) {
                    unlike(like.id)
                }
            })
        }
    }

    const deletePost = async () => {
        let res = confirm('Are you sure you want to delete this post?')
        if (!res) return

        setIsDeleteing(true)

        try {
            await useDeletePostById(params?.postId, post?.video_url)
            router.push(`/profile/${params.userId}`)
            setIsDeleteing(false)
        } catch (error) {
            console.log(error)
            setIsDeleteing(false)
            alert(error)
        }
    }

  return (
    <>
      <div className="flex items-center justify-between px-4 lg:px-8 text-white">
        <div className="flex items-center">
            <Link href={`/profile/${post?.user_id}`}>
                {post?.profile.image ? (
                    <img className="rounded-full lg:mx-0 mx-auto h-9 w-9 lg:h-10 lg:w-10 object-cover" src={useCreateBucketUrl(post?.profile.image)} />
                ) : (
                    <div className="w-9 h-9 lg:w-10 lg:h-10 bg-gray-200 rounded-full"></div>
                )}
            </Link>
            <div className="ml-3">

                <Link
                    href={`/profile/${post?.user_id}`}
                    className="relative z-10 text-[15px] font-semibold hover:underline lg:text-[17px]"
                >
                    {post?.profile.name}
                </Link>

                <div className="relative z-0 text-[12px] text-[#9CA0AA] lg:text-[13px]">
                    {isMobileDetail ? `@${post?.profile.name}` : post?.profile.name}
                    <span className="px-1">.</span>
                    <span className="font-medium">{moment(post?.created_at).calendar()}</span>
                </div>
            </div>
        </div>

        {contextUser?.user?.id == post?.user_id ? (
            <div>
                {isDeleteing ? (
                    <BiLoaderCircle className="animate-spin" size="25"/>
                ) : (
                    <button className='text-[#9CA0AA] hover:text-white' disabled={isDeleteing} onClick={() => deletePost()}>
                        <BsTrash3 className="cursor-pointer" size="25"/>
                    </button>
                )}
            </div>
        ) : null}
      </div>

      <p className={`px-4 text-sm text-white lg:px-8 ${isMobileDetail ? 'mt-2' : 'mt-3 lg:mt-4'}`}>{post?.text}</p>

      <p className={`flex item-center gap-2 px-4 text-sm font-bold text-[#D5D8DF] lg:px-8 ${isMobileDetail ? 'mt-2' : 'mt-3 lg:mt-4'}`}>
          <ImMusic size="17"/>
          original sound - {post?.profile.name}
      </p>

      <div className={`flex items-center px-4 text-white lg:px-8 ${isMobileDetail ? 'mt-2' : 'mt-4 lg:mt-8'}`}>
          <ClientOnly>
              <div className="pb-4 text-center flex items-center">
                  <button
                      disabled={hasClickedLike}
                      onClick={() => likeOrUnlike()}
                      className="cursor-pointer rounded-full bg-[#23252f] p-2"
                  >
                      {!hasClickedLike ? (
                            <AiFillHeart color={likesByPost.length > 0 && userLiked ? '#ff2626' : ''} size="25"/>
                        ) : (
                            <BiLoaderCircle className="animate-spin" size="25"/>
                        )}
                  </button>
                  <span className="pr-4 pl-2 text-xs font-semibold text-[#D5D8DF]">
                    {likesByPost.length}
                  </span>
              </div>
          </ClientOnly>

          <div className="pb-4 text-center flex items-center">
              <div className="cursor-pointer rounded-full bg-[#23252f] p-2">
                  <BsChatDots size={25} />
              </div>
              <span className="pl-2 text-xs font-semibold text-[#D5D8DF]">{commentsByPost?.length}</span>
          </div>
      </div>
    </>
  )
}

export default CommentsHeader

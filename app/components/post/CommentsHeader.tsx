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
import {
  INTERACTION_EVENT,
  createInteraction,
  deleteInteraction,
  getInteractionsByPost,
} from '@/app/utils/socialInteractions'
import { showToast } from '@/app/utils/toast'
import moment from 'moment'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { AiFillHeart, AiOutlineRetweet } from "react-icons/ai"
import { BiLoaderCircle } from "react-icons/bi"
import { BsBookmark, BsBookmarkFill, BsChatDots, BsTrash3 } from "react-icons/bs"
import { ImMusic } from "react-icons/im"
import CaptionText from '../CaptionText'
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

    const [userSaved, setUserSaved] = useState<boolean>(false)
    const [saveId, setSaveId] = useState<string | null>(null)
    const [savesCount, setSavesCount] = useState<number>(0)
    const [isSaveLoading, setIsSaveLoading] = useState<boolean>(false)
    const [userReposted, setUserReposted] = useState<boolean>(false)
    const [repostId, setRepostId] = useState<string | null>(null)
    const [repostCount, setRepostCount] = useState<number>(0)
    const [isRepostLoading, setIsRepostLoading] = useState<boolean>(false)

    const userId = contextUser?.user?.id

    const syncInteractions = useCallback(async () => {
        try {
            const [saves, reposts] = await Promise.all([
                getInteractionsByPost('save', params.postId),
                getInteractionsByPost('repost', params.postId),
            ])

            setSavesCount(saves.length)
            setRepostCount(reposts.length)

            const mySave = userId ? saves.find((s) => s.user_id === userId) : undefined
            const myRepost = userId ? reposts.find((r) => r.user_id === userId) : undefined
            setUserSaved(Boolean(mySave))
            setSaveId(mySave?.id || null)
            setUserReposted(Boolean(myRepost))
            setRepostId(myRepost?.id || null)
        } catch (error) {
            console.error(error)
        }
    }, [params.postId, userId])

    useEffect(() => {
        syncInteractions()

        if (typeof window === 'undefined') return

        const handler = () => syncInteractions()
        window.addEventListener(INTERACTION_EVENT, handler)
        return () => window.removeEventListener(INTERACTION_EVENT, handler)
    }, [syncInteractions])

    const toggleSave = useCallback(async () => {
        if (!userId) {
            setIsLoginOpen(true)
            return
        }
        if (isSaveLoading) return

        setIsSaveLoading(true)
        const wasSaved = userSaved
        setUserSaved(!wasSaved)
        setSavesCount((c) => Math.max(0, c + (wasSaved ? -1 : 1)))
        try {
            if (wasSaved && saveId) {
                await deleteInteraction('save', saveId)
                setSaveId(null)
            } else if (!wasSaved) {
                const id = await createInteraction('save', userId, params.postId)
                setSaveId(id)
            }
        } catch (error) {
            console.error(error)
            setUserSaved(wasSaved)
            setSavesCount((c) => Math.max(0, c + (wasSaved ? 1 : -1)))
            showToast(wasSaved ? 'Could not remove from saved' : 'Could not save video', 'error')
        } finally {
            setIsSaveLoading(false)
        }
    }, [isSaveLoading, params.postId, saveId, setIsLoginOpen, userId, userSaved])

    const toggleRepost = useCallback(async () => {
        if (!userId) {
            setIsLoginOpen(true)
            return
        }
        if (isRepostLoading) return

        setIsRepostLoading(true)
        const wasReposted = userReposted
        setUserReposted(!wasReposted)
        setRepostCount((c) => Math.max(0, c + (wasReposted ? -1 : 1)))
        try {
            if (wasReposted && repostId) {
                await deleteInteraction('repost', repostId)
                setRepostId(null)
            } else if (!wasReposted) {
                const id = await createInteraction('repost', userId, params.postId)
                setRepostId(id)
            }
        } catch (error) {
            console.error(error)
            setUserReposted(wasReposted)
            setRepostCount((c) => Math.max(0, c + (wasReposted ? 1 : -1)))
            showToast(wasReposted ? 'Could not remove repost' : 'Could not repost video', 'error')
        } finally {
            setIsRepostLoading(false)
        }
    }, [isRepostLoading, params.postId, repostId, setIsLoginOpen, userId, userReposted])

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
      <div className="flex items-center justify-between px-4 text-ink lg:px-8">
        <div className="flex items-center">
            <Link href={`/profile/${post?.user_id}`}>
                {post?.profile.image ? (
                    <img className="rounded-full lg:mx-0 mx-auto h-9 w-9 lg:h-10 lg:w-10 object-cover" src={useCreateBucketUrl(post?.profile.image)} />
                ) : (
                    <div className="w-9 h-9 lg:w-10 lg:h-10 bg-surface-subtle rounded-full"></div>
                )}
            </Link>
            <div className="ml-3">

                <Link
                    href={`/profile/${post?.user_id}`}
                    className="relative z-10 text-[15px] font-semibold hover:underline lg:text-[17px]"
                >
                    {post?.profile.name}
                </Link>

                <div className="relative z-0 text-[12px] text-ink-soft lg:text-[13px]">
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
                    <button className='text-ink-soft hover:text-ink' disabled={isDeleteing} onClick={() => deletePost()}>
                        <BsTrash3 className="cursor-pointer" size="25"/>
                    </button>
                )}
            </div>
        ) : null}
      </div>

      <p className={`px-4 text-sm text-ink lg:px-8 ${isMobileDetail ? 'mt-2' : 'mt-3 lg:mt-4'}`}>
          <CaptionText text={post?.text} />
      </p>

      <p className={`flex item-center gap-2 px-4 text-sm font-bold text-ink lg:px-8 ${isMobileDetail ? 'mt-2' : 'mt-3 lg:mt-4'}`}>
          <ImMusic size="17"/>
          original sound - {post?.profile.name}
      </p>

      <div className={`flex items-center px-4 text-ink lg:px-8 ${isMobileDetail ? 'mt-2' : 'mt-4 lg:mt-8'}`}>
          <ClientOnly>
              <div className="pb-4 text-center flex items-center">
                  <button
                      disabled={hasClickedLike}
                      onClick={() => likeOrUnlike()}
                      className="cursor-pointer rounded-full bg-surface-subtle p-2"
                  >
                      {!hasClickedLike ? (
                            <AiFillHeart color={likesByPost.length > 0 && userLiked ? '#ff2626' : ''} size="25"/>
                        ) : (
                            <BiLoaderCircle className="animate-spin" size="25"/>
                        )}
                  </button>
                  <span className="pr-4 pl-2 text-xs font-semibold text-ink">
                    {likesByPost.length}
                  </span>
              </div>
          </ClientOnly>

          <div className="pb-4 text-center flex items-center">
              <div className="cursor-pointer rounded-full bg-surface-subtle p-2">
                  <BsChatDots size={25} />
              </div>
              <span className="pr-4 pl-2 text-xs font-semibold text-ink">{commentsByPost?.length}</span>
          </div>

          <ClientOnly>
              <div className="pb-4 text-center flex items-center">
                  <button
                      disabled={isSaveLoading}
                      onClick={() => toggleSave()}
                      aria-label={userSaved ? 'Remove from saved' : 'Save video'}
                      className="cursor-pointer rounded-full bg-surface-subtle p-2 disabled:opacity-60"
                  >
                      {userSaved ? (
                          <BsBookmarkFill color="#ffc60a" size="25" className="tt-pop" />
                      ) : (
                          <BsBookmark size="25" />
                      )}
                  </button>
                  <span className="pr-4 pl-2 text-xs font-semibold text-ink">{savesCount}</span>
              </div>

              <div className="pb-4 text-center flex items-center">
                  <button
                      disabled={isRepostLoading}
                      onClick={() => toggleRepost()}
                      aria-label={userReposted ? 'Remove repost' : 'Repost video'}
                      className="cursor-pointer rounded-full bg-surface-subtle p-2 disabled:opacity-60"
                  >
                      <AiOutlineRetweet color={userReposted ? '#25c2c2' : undefined} size="25" />
                  </button>
                  <span className="pl-2 text-xs font-semibold text-ink">{repostCount}</span>
              </div>
          </ClientOnly>
      </div>
    </>
  )
}

export default CommentsHeader

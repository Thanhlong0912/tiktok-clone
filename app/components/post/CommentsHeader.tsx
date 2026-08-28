import { useUser } from '@/app/context/user'
import useCreateBucketUrl from '@/app/hooks/useCreateBucketUrl'
import useCreateLike from '@/app/hooks/useCreateLike'
import useDeleteLike from '@/app/hooks/useDeleteLike'
import useDeletePostById from '@/app/hooks/useDeletePostById'
import { useGeneralStore } from '@/app/stores/general'
import { CommentsHeaderCompTypes } from '@/app/types'
import { createInteraction, deleteInteraction } from '@/app/utils/socialInteractions'
import { formatCount } from '@/app/utils/formatNumber'
import { getHandles } from '@/app/utils/handleLookup'
import { supabase } from '@/libs/supabase'
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

    const { setIsLoginOpen } = useGeneralStore()

    const contextUser = useUser()
    const router = useRouter();
    const [hasClickedLike, setHasClickedLike] = useState<boolean>(false)
    const [isDeleteing, setIsDeleteing] = useState<boolean>(false)

    // Counters and this viewer's own state arrive on the post row from
    // get_post. This component used to fetch every like row for the post (just
    // to call .length) plus two more requests for saves and reposts, and re-ran
    // the latter pair whenever anyone saved anything anywhere.
    const [userLiked, setUserLiked] = useState<boolean>(Boolean(post?.is_liked))
    const [likesCount, setLikesCount] = useState<number>(post?.like_count ?? 0)
    const [userSaved, setUserSaved] = useState<boolean>(Boolean(post?.is_saved))
    const [saveId, setSaveId] = useState<string | null>(null)
    const [savesCount, setSavesCount] = useState<number>(post?.save_count ?? 0)
    const [isSaveLoading, setIsSaveLoading] = useState<boolean>(false)
    const [userReposted, setUserReposted] = useState<boolean>(Boolean(post?.is_reposted))
    const [repostId, setRepostId] = useState<string | null>(null)
    const [repostCount, setRepostCount] = useState<number>(post?.repost_count ?? 0)
    const [isRepostLoading, setIsRepostLoading] = useState<boolean>(false)

    const userId = contextUser?.user?.id

    // get_post returns SETOF feed_post, which carries no handle -- see
    // app/utils/handleLookup.ts. Empty until the batched lookup resolves.
    const [authorHandle, setAuthorHandle] = useState<string>('')

    useEffect(() => {
        const authorId = post?.user_id
        if (!authorId) return

        let active = true

        getHandles([authorId]).then((handles) => {
            if (active) setAuthorHandle(handles[authorId] ?? '')
        })

        return () => { active = false }
    }, [post?.user_id])

    useEffect(() => {
        setUserLiked(Boolean(post?.is_liked))
        setLikesCount(post?.like_count ?? 0)
        setUserSaved(Boolean(post?.is_saved))
        setSavesCount(post?.save_count ?? 0)
        setUserReposted(Boolean(post?.is_reposted))
        setRepostCount(post?.repost_count ?? 0)
    }, [post?.is_liked, post?.like_count, post?.is_saved, post?.save_count, post?.is_reposted, post?.repost_count])

    // No fetch here: the post page already calls setCommentsByPost for this
    // postId, and doing it in both places issued the same query twice on every
    // post open. This component only reads the count.

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
            if (wasSaved) {
                if (saveId) {
                    await deleteInteraction('save', saveId)
                } else {
                    await supabase.from('saves').delete().eq('user_id', userId).eq('post_id', params.postId)
                }
                setSaveId(null)
            } else {
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
            if (wasReposted) {
                if (repostId) {
                    await deleteInteraction('repost', repostId)
                } else {
                    await supabase.from('reposts').delete().eq('user_id', userId).eq('post_id', params.postId)
                }
                setRepostId(null)
            } else {
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

    const likeOrUnlike = useCallback(async () => {
        if (!userId) {
            setIsLoginOpen(true)
            return
        }
        if (hasClickedLike) return

        const wasLiked = userLiked
        setHasClickedLike(true)
        setUserLiked(!wasLiked)
        setLikesCount((c) => Math.max(0, c + (wasLiked ? -1 : 1)))

        try {
            if (wasLiked) {
                await supabase.from('likes').delete().eq('user_id', userId).eq('post_id', params.postId)
            } else {
                await useCreateLike(userId, params.postId)
            }
        } catch (error) {
            console.error(error)
            setUserLiked(wasLiked)
            setLikesCount((c) => Math.max(0, c + (wasLiked ? 1 : -1)))
            showToast(wasLiked ? 'Could not remove your like' : 'Could not like this video', 'error')
        } finally {
            setHasClickedLike(false)
        }
    }, [hasClickedLike, params.postId, setIsLoginOpen, userId, userLiked])

    const deletePost = async () => {
        if (!confirm('Are you sure you want to delete this post?')) return

        setIsDeleteing(true)

        try {
            await useDeletePostById(params?.postId, post?.video_url)
            router.push(`/profile/${params.userId}`)
        } catch (error) {
            console.error(error)
            showToast('Could not delete this post', 'error')
        } finally {
            setIsDeleteing(false)
        }
    }

    const subtitleLabel = isMobileDetail
        ? (authorHandle ? `@${authorHandle}` : '')
        : post?.profile.name

  return (
    <>
      <div className="flex items-center justify-between px-4 text-ink lg:px-8">
        <div className="flex items-center">
            <Link href={`/profile/${post?.user_id}`}>
                {post?.profile.image ? (
                    <img className="rounded-full lg:mx-0 mx-auto h-9 w-9 lg:h-10 lg:w-10 object-cover" src={useCreateBucketUrl(post?.profile.image)} alt="" />
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

                {/*
                  `@` means the handle, never the display name -- display names
                  are not unique and can contain spaces, so "@Jane Doe" named
                  nobody in particular. Blank rather than a bare "@" while the
                  lookup is in flight, the same convention the feed card uses,
                  and the separator goes with it so the line never opens on a
                  stray dot. Desktop shows the display name and is unchanged.
                */}
                <div className="relative z-0 text-[12px] text-ink-soft lg:text-[13px]">
                    {subtitleLabel ? (
                        <>
                            {subtitleLabel}
                            <span className="px-1">.</span>
                        </>
                    ) : null}
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
                      aria-label={userLiked ? 'Remove like' : 'Like'}
                      aria-pressed={userLiked}
                      className="cursor-pointer rounded-full bg-surface-subtle p-2"
                  >
                      {!hasClickedLike ? (
                            <AiFillHeart color={userLiked ? '#fe2c55' : ''} size="25"/>
                        ) : (
                            <BiLoaderCircle className="animate-spin" size="25"/>
                        )}
                  </button>
                  <span className="pr-4 pl-2 text-xs font-semibold text-ink">
                    {formatCount(likesCount)}
                  </span>
              </div>
          </ClientOnly>

          <div className="pb-4 text-center flex items-center">
              <div className="cursor-pointer rounded-full bg-surface-subtle p-2">
                  <BsChatDots size={25} />
              </div>
              {/* From the post row, not from the length of the loaded list:
                  that list was capped at 100 and is now paginated, so its
                  length stopped being the comment count. post.comment_count is
                  trigger-maintained and already on the row get_post returned. */}
              <span className="pr-4 pl-2 text-xs font-semibold text-ink">{formatCount(post?.comment_count ?? 0)}</span>
          </div>

          <ClientOnly>
              <div className="pb-4 text-center flex items-center">
                  <button
                      disabled={isSaveLoading}
                      onClick={() => toggleSave()}
                      aria-label={userSaved ? 'Remove from saved' : 'Save video'}
                      aria-pressed={userSaved}
                      className="cursor-pointer rounded-full bg-surface-subtle p-2 disabled:opacity-60"
                  >
                      {userSaved ? (
                          <BsBookmarkFill color="#ffc60a" size="25" className="tt-pop" />
                      ) : (
                          <BsBookmark size="25" />
                      )}
                  </button>
                  <span className="pr-4 pl-2 text-xs font-semibold text-ink">{formatCount(savesCount)}</span>
              </div>

              <div className="pb-4 text-center flex items-center">
                  <button
                      disabled={isRepostLoading}
                      onClick={() => toggleRepost()}
                      aria-label={userReposted ? 'Remove repost' : 'Repost video'}
                      aria-pressed={userReposted}
                      className="cursor-pointer rounded-full bg-surface-subtle p-2 disabled:opacity-60"
                  >
                      <AiOutlineRetweet color={userReposted ? '#25f4ee' : undefined} size="25" />
                  </button>
                  <span className="pl-2 text-xs font-semibold text-ink">{formatCount(repostCount)}</span>
              </div>
          </ClientOnly>
      </div>
    </>
  )
}

export default CommentsHeader

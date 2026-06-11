import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AiFillHeart } from 'react-icons/ai'
import { BsFillPlayFill } from 'react-icons/bs'
import { FaCommentDots, FaRegCopy, FaShare } from 'react-icons/fa'
import { ImMusic } from 'react-icons/im'
import { IoClose } from 'react-icons/io5'
import { useUser } from '../context/user'
import useCreateBucketUrl from '../hooks/useCreateBucketUrl'
import useCreateComment from '../hooks/useCreateComment'
import useCreateFollow from '../hooks/useCreateFollow'
import useCreateLike from '../hooks/useCreateLike'
import useDeleteFollow from '../hooks/useDeleteFollow'
import useDeleteLike from '../hooks/useDeleteLike'
import useGetCommentsByPostId from '../hooks/useGetCommentsByPostId'
import useGetLikesByPostId from '../hooks/useGetLikesByPostId'
import useIsFollowing from '../hooks/useIsFollowing'
import { useGeneralStore } from '../stores/general'
import { CommentWithProfile, Like, PostMainCompTypes } from '../types'
import { pauseOtherVideos } from '../utils/videoPlayback'
import { getVideoSoundEnabled, setVideoSoundEnabled, subscribeToVideoSoundPreference } from '../utils/videoSoundPreference'
import PostMainLikes from './PostMainLikes'
import VideoOptionsMenu from './VideoOptionsMenu'

const followStateByPair = new Map<string, string | null>()
const ENGAGEMENT_CACHE_TTL_MS = 20000

type EngagementCacheEntry = {
  likes: Like[]
  comments: CommentWithProfile[]
  updatedAt: number
}

type UserLikeCacheEntry = {
  likeId: string | null
  userLiked: boolean
  updatedAt: number
}

const engagementCacheByPost = new Map<string, EngagementCacheEntry>()
const userLikeCacheByPostUser = new Map<string, UserLikeCacheEntry>()

const PostMain = ({ post, feedIndex, isAutoScrollEnabled, onVideoEnded, onAutoScrollChange }: PostMainCompTypes) => {
  const { user } = useUser() || {}
  const { setIsLoginOpen } = useGeneralStore()
  const router = useRouter()

  const videoRef = useRef<HTMLVideoElement>(null)
  const desktopVideoRef = useRef<HTMLVideoElement>(null)
  const postMainRef = useRef<HTMLDivElement>(null)
  const tapTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastTapRef = useRef<number>(0)
  const commentInputRef = useRef<HTMLInputElement | null>(null)

  const [followId, setFollowId] = useState<string | null>(null)
  const [isVideoPaused, setIsVideoPaused] = useState<boolean>(false)
  const [showHeartBurst, setShowHeartBurst] = useState<boolean>(false)
  const [likesCount, setLikesCount] = useState<number>(0)
  const [commentsCount, setCommentsCount] = useState<number>(0)
  const [mobileComments, setMobileComments] = useState<CommentWithProfile[]>([])
  const [userLiked, setUserLiked] = useState<boolean>(false)
  const [activeLikeId, setActiveLikeId] = useState<string | null>(null)
  const [isLikeLoading, setIsLikeLoading] = useState<boolean>(false)
  const [isCommentsSheetOpen, setIsCommentsSheetOpen] = useState<boolean>(false)
  const [isCommentsLoading, setIsCommentsLoading] = useState<boolean>(false)
  const [commentInput, setCommentInput] = useState<string>('')
  const [isSubmittingComment, setIsSubmittingComment] = useState<boolean>(false)
  const [isShareSheetOpen, setIsShareSheetOpen] = useState<boolean>(false)
  const [videoPreloadMode, setVideoPreloadMode] = useState<'metadata' | 'auto'>('metadata')
  const [isSoundEnabled, setIsSoundEnabledState] = useState<boolean>(false)

  const applyEngagementSnapshot = useCallback((likes: Like[], comments: CommentWithProfile[]) => {
    setLikesCount(likes.length)
    setCommentsCount(comments.length)
    setMobileComments(comments)

    engagementCacheByPost.set(post.id, {
      likes,
      comments,
      updatedAt: Date.now(),
    })

    if (!user?.id) {
      setUserLiked(false)
      setActiveLikeId(null)
      return
    }

    const likeRecord = likes.find((like) => like.user_id === user.id && like.post_id === post.id)
    const userLike = Boolean(likeRecord)

    setUserLiked(userLike)
    setActiveLikeId(likeRecord?.id || null)
    userLikeCacheByPostUser.set(`${user.id}:${post.id}`, {
      likeId: likeRecord?.id || null,
      userLiked: userLike,
      updatedAt: Date.now(),
    })
  }, [post.id, user?.id])

  useEffect(() => {
    const checkFollow = async () => {
      if (!user?.id || !post.profile.user_id || user.id === post.profile.user_id) {
        setFollowId(null)
        return
      }

      const followKey = `${user.id}:${post.profile.user_id}`
      const cachedFollowId = followStateByPair.get(followKey)

      if (cachedFollowId !== undefined) {
        setFollowId(cachedFollowId)
      }

      const id = await useIsFollowing(user.id, post.profile.user_id)
      followStateByPair.set(followKey, id)
      setFollowId(id)
    }

    checkFollow()
  }, [user?.id, post.profile.user_id])

  useEffect(() => {
    const hydrateCounts = async () => {
      const now = Date.now()
      const cacheEntry = engagementCacheByPost.get(post.id)
      const userLikeCache = user?.id ? userLikeCacheByPostUser.get(`${user.id}:${post.id}`) : null

      if (cacheEntry && now - cacheEntry.updatedAt < ENGAGEMENT_CACHE_TTL_MS) {
        setLikesCount(cacheEntry.likes.length)
        setCommentsCount(cacheEntry.comments.length)
        setMobileComments(cacheEntry.comments)

        if (!user?.id) {
          setUserLiked(false)
          setActiveLikeId(null)
          return
        }

        if (userLikeCache && now - userLikeCache.updatedAt < ENGAGEMENT_CACHE_TTL_MS) {
          setUserLiked(userLikeCache.userLiked)
          setActiveLikeId(userLikeCache.likeId)
          return
        }
      }

      const [likes, comments] = await Promise.all([
        useGetLikesByPostId(post.id),
        useGetCommentsByPostId(post.id),
      ])

      applyEngagementSnapshot(likes || [], comments || [])
    }

    hydrateCounts()
  }, [applyEngagementSnapshot, post.id, user?.id])

  useEffect(() => {
    const postMainElement = postMainRef.current

    const observer = new IntersectionObserver(
      (entries) => {
        const isDesktopViewport = typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches
        const activeVideo = isDesktopViewport ? desktopVideoRef.current : videoRef.current

        if (entries[0].isIntersecting) {
          if (!activeVideo) {
            return
          }

          pauseOtherVideos(activeVideo)
          activeVideo.muted = !isSoundEnabled
          activeVideo
            .play()
            .then(() => {
              if (!isDesktopViewport) {
                setIsVideoPaused(false)
              }
            })
            .catch(() => {
              if (!isDesktopViewport) {
                setIsVideoPaused(true)
              }
            })
        } else {
          videoRef.current?.pause()
          desktopVideoRef.current?.pause()
          setIsVideoPaused(true)
        }
      },
      { threshold: 0.6 }
    )

    if (postMainElement) {
      observer.observe(postMainElement)
    }

    return () => {
      if (tapTimeoutRef.current) {
        clearTimeout(tapTimeoutRef.current)
      }

      if (postMainElement) {
        observer.unobserve(postMainElement)
      }
    }
  }, [isSoundEnabled, post.id])

  useEffect(() => {
    const postMainElement = postMainRef.current

    const warmupObserver = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVideoPreloadMode('auto')
          warmupObserver.disconnect()
        }
      },
      { rootMargin: '220% 0px', threshold: 0.01 }
    )

    if (postMainElement) {
      warmupObserver.observe(postMainElement)
    }

    return () => {
      warmupObserver.disconnect()
    }
  }, [post.id])

  const toggleFollow = useCallback(async () => {
    if (!user?.id) {
      setIsLoginOpen(true)
      return
    }

    if (followId) {
      try {
        await useDeleteFollow(followId)
        followStateByPair.set(`${user.id}:${post.profile.user_id}`, null)
        setFollowId(null)
      } catch (error) {
        console.error(error)
      }
      return
    }

    try {
      const id = await useCreateFollow(user.id, post.profile.user_id)
      followStateByPair.set(`${user.id}:${post.profile.user_id}`, id)
      setFollowId(id)
    } catch (error) {
      console.error(error)
    }
  }, [followId, post.profile.user_id, setIsLoginOpen, user?.id])

  const togglePlayPause = useCallback(() => {
    const video = videoRef.current

    if (!video) {
      return
    }

    if (video.paused) {
      video.play().then(() => setIsVideoPaused(false)).catch(() => setIsVideoPaused(true))
      return
    }

    video.pause()
    setIsVideoPaused(true)
  }, [])

  const handleDesktopVideoPlay = useCallback(() => {
    pauseOtherVideos(desktopVideoRef.current)
  }, [])

  const syncSoundState = useCallback((enabled: boolean) => {
    setIsSoundEnabledState(enabled)

    if (videoRef.current) {
      videoRef.current.muted = !enabled
    }

    if (desktopVideoRef.current) {
      desktopVideoRef.current.muted = !enabled
    }
  }, [])

  const enableSound = useCallback(() => {
    setVideoSoundEnabled(true)
    syncSoundState(true)

    const isDesktopViewport = typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches
    const activeVideo = isDesktopViewport ? desktopVideoRef.current : videoRef.current
    activeVideo?.play().catch(() => null)
  }, [syncSoundState])

  const likePost = useCallback(async () => {
    if (!user?.id || isLikeLoading || userLiked) {
      return
    }

    setIsLikeLoading(true)
    try {
      await useCreateLike(user.id, post.id)
      const refreshedLikes = await useGetLikesByPostId(post.id)
      const cachedComments = engagementCacheByPost.get(post.id)?.comments || mobileComments
      applyEngagementSnapshot(refreshedLikes, cachedComments)
    } catch (error) {
      console.error(error)
    } finally {
      setIsLikeLoading(false)
    }
  }, [applyEngagementSnapshot, isLikeLoading, mobileComments, post.id, user?.id, userLiked])

  const unlikePost = useCallback(async () => {
    if (!activeLikeId || isLikeLoading || !user?.id) {
      return
    }

    setIsLikeLoading(true)
    try {
      await useDeleteLike(activeLikeId)
      const refreshedLikes = await useGetLikesByPostId(post.id)
      const cachedComments = engagementCacheByPost.get(post.id)?.comments || mobileComments
      applyEngagementSnapshot(refreshedLikes, cachedComments)
    } catch (error) {
      console.error(error)
    } finally {
      setIsLikeLoading(false)
    }
  }, [activeLikeId, applyEngagementSnapshot, isLikeLoading, mobileComments, post.id, user?.id])

  const likeOrUnlike = useCallback(async () => {
    if (!user?.id) {
      setIsLoginOpen(true)
      return
    }

    if (userLiked) {
      await unlikePost()
      return
    }

    await likePost()
  }, [likePost, setIsLoginOpen, unlikePost, user?.id, userLiked])

  const handleDoubleTapLike = useCallback(async () => {
    if (tapTimeoutRef.current) {
      clearTimeout(tapTimeoutRef.current)
    }

    setShowHeartBurst(true)
    setTimeout(() => setShowHeartBurst(false), 520)

    if (!user?.id) {
      setIsLoginOpen(true)
      return
    }

    if (!userLiked) {
      await likePost()
    }
  }, [likePost, setIsLoginOpen, user?.id, userLiked])

  const handleMobileVideoTap = useCallback(async () => {
    const now = Date.now()

    if (now - lastTapRef.current < 250) {
      await handleDoubleTapLike()
    } else {
      tapTimeoutRef.current = setTimeout(() => {
        togglePlayPause()
      }, 250)
    }

    lastTapRef.current = now
  }, [handleDoubleTapLike, togglePlayPause])

  const copyPostLink = useCallback(async () => {
    await navigator.clipboard.writeText(`${window.location.origin}/post/${post.id}/${post.profile.user_id}`)
    setIsShareSheetOpen(false)
    alert('Copied to clipboard!')
  }, [post.id, post.profile.user_id])

  const openCommentsSheet = useCallback(async () => {
    setIsCommentsSheetOpen(true)

    const now = Date.now()
    const cacheEntry = engagementCacheByPost.get(post.id)

    if (cacheEntry) {
      setMobileComments(cacheEntry.comments)
      setCommentsCount(cacheEntry.comments.length)
      if (now - cacheEntry.updatedAt < ENGAGEMENT_CACHE_TTL_MS) {
        return
      }
    }

    setIsCommentsLoading(true)
    try {
      const comments = await useGetCommentsByPostId(post.id)
      const cachedLikes = engagementCacheByPost.get(post.id)?.likes || []
      applyEngagementSnapshot(cachedLikes, comments || [])
    } catch (error) {
      console.error(error)
      if (!cacheEntry) {
        setMobileComments([])
        setCommentsCount(0)
      }
    } finally {
      setIsCommentsLoading(false)
    }
  }, [applyEngagementSnapshot, post.id])

  useEffect(() => {
    if (!isCommentsSheetOpen) {
      return
    }

    const timer = setTimeout(() => {
      commentInputRef.current?.focus()
    }, 80)

    return () => clearTimeout(timer)
  }, [isCommentsSheetOpen])

  const submitInlineComment = useCallback(async () => {
    if (!user?.id) {
      setIsLoginOpen(true)
      return
    }

    const cleanComment = commentInput.trim()
    if (!cleanComment || isSubmittingComment) {
      return
    }

    setIsSubmittingComment(true)
    try {
      await useCreateComment(user.id, post.id, cleanComment)
      setCommentInput('')

      const comments = await useGetCommentsByPostId(post.id)
      const cachedLikes = engagementCacheByPost.get(post.id)?.likes || []
      applyEngagementSnapshot(cachedLikes, comments || [])
    } catch (error) {
      console.error(error)
    } finally {
      setIsSubmittingComment(false)
    }
  }, [applyEngagementSnapshot, commentInput, isSubmittingComment, post.id, setIsLoginOpen, user?.id])

  useEffect(() => {
    syncSoundState(getVideoSoundEnabled())

    return subscribeToVideoSoundPreference((enabled) => {
      syncSoundState(enabled)
    })
  }, [syncSoundState])

  useEffect(() => {
    return () => {
      videoRef.current?.pause()
      desktopVideoRef.current?.pause()
    }
  }, [])

  return (
    <div
      ref={postMainRef}
      data-feed-index={feedIndex}
      className="snap-start h-[100dvh] md:h-auto md:snap-none"
    >
      <div className="relative h-full w-full overflow-hidden bg-black md:hidden">
        <button
          onClick={handleMobileVideoTap}
          className="relative h-full w-full"
          aria-label="Toggle video"
        >
          <video
            ref={videoRef}
            id={`video-${post.id}`}
            loop={!isAutoScrollEnabled}
            onEnded={() => onVideoEnded(post.id)}
            playsInline
            muted={!isSoundEnabled}
            preload={videoPreloadMode}
            className="h-full w-full object-cover"
            src={useCreateBucketUrl(post.video_url)}
          />

          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-black/65 via-black/20 to-transparent" />

          {showHeartBurst ? (
            <AiFillHeart className="heart-pop pointer-events-none absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 text-[96px] text-white/95" />
          ) : null}

          {isVideoPaused ? (
            <span className="pointer-events-none absolute left-1/2 top-1/2 z-20 inline-flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/35 text-white">
              <BsFillPlayFill size={28} />
            </span>
          ) : null}
        </button>

        {!isSoundEnabled ? (
          <button
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              enableSound()
            }}
            className="absolute left-4 top-[calc(env(safe-area-inset-top)+16px)] z-30 rounded-full bg-black/55 px-3 py-1.5 text-xs font-semibold text-white"
          >
            Tap for sound
          </button>
        ) : null}

        <VideoOptionsMenu
          isAutoScrollEnabled={isAutoScrollEnabled}
          onAutoScrollChange={onAutoScrollChange}
          className="absolute right-4 top-[calc(env(safe-area-inset-top)+16px)]"
        />

        <div className="absolute inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+74px)] z-20 px-4 text-white">
          <div className="mb-2 flex items-center gap-2">
            <img
              className="h-10 w-10 rounded-full border border-white/70"
              src={useCreateBucketUrl(post.profile.image)}
              alt="Profile"
            />
            <Link href={`/profile/${post.profile.user_id}`} className="font-semibold">
              @{post.profile.name}
            </Link>
            {user?.id !== post.profile.user_id ? (
              <button
                onClick={toggleFollow}
                className={`rounded-md border px-3 py-1.5 text-sm font-semibold ${
                  followId
                    ? 'border-white/70 bg-white/15 text-white'
                    : 'border-white bg-white text-black'
                }`}
              >
                {followId ? 'Following' : 'Follow'}
              </button>
            ) : null}
          </div>

          <p className="max-w-[72%] text-[14px] leading-5 text-white/95">{post.text}</p>
          <p className="mt-2 flex items-center text-[13px] font-medium text-white/90">
            <ImMusic size={14} />
            <span className="ml-1 truncate pr-2">original sound - {post.profile.name}</span>
          </p>
        </div>

        <div className="absolute bottom-[calc(env(safe-area-inset-bottom)+84px)] right-3 z-20 flex w-[68px] flex-col items-center gap-4 text-white">
          <button
            onClick={() => router.push(`/profile/${post.profile.user_id}`)}
            className="inline-flex h-12 w-12 items-center justify-center rounded-full border-2 border-white bg-black/10"
          >
            <img
              className="h-10 w-10 rounded-full"
              src={useCreateBucketUrl(post.profile.image)}
              alt="Profile"
            />
          </button>

          <button onClick={likeOrUnlike} className="flex flex-col items-center text-xs font-semibold">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-black/35 backdrop-blur-sm">
              <AiFillHeart size={30} color={userLiked ? '#ff2d55' : '#ffffff'} />
            </span>
            <span className="mt-1 drop-shadow-[0_1px_2px_rgba(0,0,0,0.75)]">{likesCount}</span>
          </button>

          <button
            onClick={openCommentsSheet}
            className="flex flex-col items-center text-xs font-semibold"
          >
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-black/35 backdrop-blur-sm">
              <FaCommentDots size={27} />
            </span>
            <span className="mt-1 drop-shadow-[0_1px_2px_rgba(0,0,0,0.75)]">{commentsCount}</span>
          </button>

          <button
            className="flex flex-col items-center text-xs font-semibold"
            onClick={() => setIsShareSheetOpen(true)}
          >
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-black/35 backdrop-blur-sm">
              <FaShare size={24} />
            </span>
            <span className="mt-1 drop-shadow-[0_1px_2px_rgba(0,0,0,0.75)]">Share</span>
          </button>
        </div>

        {isCommentsSheetOpen ? (
          <div className="fixed inset-0 z-[70] flex items-end bg-black/45 md:hidden">
            <button
              onClick={() => setIsCommentsSheetOpen(false)}
              aria-label="Close comments sheet"
              className="absolute inset-0"
            />
            <div className="relative w-full rounded-t-2xl bg-white px-4 pt-4 text-gray-900 dark:bg-black dark:text-white md:max-w-[520px] md:rounded-2xl md:max-h-[78vh] md:flex md:flex-col">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-semibold">{commentsCount} comments</p>
                <button onClick={() => setIsCommentsSheetOpen(false)} className="rounded-full bg-gray-100 p-1 dark:bg-[#25262d]">
                  <IoClose size={22} />
                </button>
              </div>

              <div className="max-h-[48dvh] overflow-y-auto pb-3 md:max-h-[55vh]">
                {isCommentsLoading ? (
                  <p className="py-8 text-center text-sm text-gray-500 dark:text-[#9CA0AA]">Loading comments...</p>
                ) : mobileComments.length < 1 ? (
                  <p className="py-8 text-center text-sm text-gray-500 dark:text-[#9CA0AA]">No comments yet</p>
                ) : (
                  mobileComments.map((comment) => (
                    <div key={comment.id} className="mb-3 flex items-start gap-3">
                      <img
                        className="h-9 w-9 rounded-full object-cover"
                        src={useCreateBucketUrl(comment.profile.image)}
                        alt="Profile"
                      />
                      <div>
                        <p className="text-[13px] font-semibold">{comment.profile.name}</p>
                        <p className="text-[14px] leading-5">{comment.text}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="border-t border-gray-200 py-3 pb-[calc(env(safe-area-inset-bottom)+12px)] dark:border-white/10">
                <div className="flex items-center gap-3">
                  <input
                    ref={commentInputRef}
                    value={commentInput}
                    onChange={(event) => setCommentInput(event.target.value)}
                    className="w-full rounded-full border border-gray-200 bg-gray-100 px-4 py-2.5 text-sm text-gray-900 outline-none placeholder:text-gray-500 focus:border-gray-400 dark:border-transparent dark:bg-[#161823] dark:text-white dark:placeholder:text-[#9CA0AA] dark:focus:border-[#494A50]"
                    placeholder="Add comment..."
                  />
                  <button
                    onClick={submitInlineComment}
                    disabled={!commentInput.trim() || isSubmittingComment}
                    className={`text-sm font-semibold ${commentInput.trim() && !isSubmittingComment ? 'text-[#F02C56]' : 'text-gray-400'}`}
                  >
                    {isSubmittingComment ? '...' : 'Post'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {isShareSheetOpen ? (
          <div className="absolute inset-0 z-40 flex items-end bg-black/45">
            <button
              onClick={() => setIsShareSheetOpen(false)}
              aria-label="Close share sheet"
              className="absolute inset-0"
            />
            <div className="relative w-full rounded-t-2xl bg-white px-4 pt-4 text-black">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-semibold">Share to</p>
                <button onClick={() => setIsShareSheetOpen(false)} className="rounded-full bg-gray-100 p-1">
                  <IoClose size={22} />
                </button>
              </div>

              <div className="space-y-2 pb-[calc(env(safe-area-inset-bottom)+12px)]">
                <button
                  onClick={copyPostLink}
                  className="flex w-full items-center justify-center gap-2 rounded-full border border-gray-300 px-4 py-2.5 text-sm font-semibold"
                >
                  <FaRegCopy size={14} />
                  Copy link
                </button>
                <button
                  onClick={() => router.push(`/post/${post.id}/${post.profile.user_id}`)}
                  className="w-full rounded-full bg-black px-4 py-2.5 text-sm font-semibold text-white"
                >
                  Go to post
                </button>
                <button
                  onClick={() => setIsShareSheetOpen(false)}
                  className="w-full rounded-full bg-gray-100 px-4 py-2.5 text-sm font-semibold"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="hidden border-b px-4 py-6 md:flex">
        <div className="cursor-pointer">
          <img
            className="max-h-[60px] rounded-full"
            width="60"
            src={useCreateBucketUrl(post?.profile?.image)}
            alt="Profile"
          />
        </div>

        <div className="flex h-full w-full flex-col px-2">
          <div className="flex items-center justify-between pb-0.5">
            <Link
              href={`/profile/${post.profile.user_id}`}
              className="cursor-pointer font-bold hover:underline dark:text-white"
            >
              {post.profile.name}
            </Link>
            {user?.id !== post.profile.user_id && (
              <button
                onClick={toggleFollow}
                className={`mt-3 flex items-center rounded-md px-8 py-1.5 text-[15px] font-semibold ${
                  followId
                    ? 'border border-gray-300 bg-white text-gray-800 hover:bg-gray-100 dark:bg-black dark:text-gray-200 dark:hover:bg-gray-800'
                    : 'bg-rose-500 text-white hover:bg-rose-600'
                }`}
              >
                {followId ? 'Following' : 'Follow'}
              </button>
            )}
          </div>

          <p className="max-w-[300px] break-words pb-0.5 text-[15px] dark:text-white md:max-w-[400px]">
            {post.text}
          </p>
          <p className="pb-0.5 text-[14px] text-gray-500 dark:text-gray-300">#longbi #longkhongmap #longbabe</p>
          <p className="flex items-center pb-0.5 text-[14px] font-semibold dark:text-white">
            <ImMusic size="17" />
            <span className="truncate px-1 text-[13px]">original sound - {post.profile.name}</span>
            <AiFillHeart size="20" />
          </p>

          <div className="mt-2.5 flex flex-1">
            <div
              onClick={() => router.push(`/post/${post.id}/${post.profile.user_id}`)}
              className="relative flex max-h-[625px] min-h-[525px] max-w-[295px] cursor-pointer items-center rounded-xl bg-black"
            >
              <VideoOptionsMenu
                isAutoScrollEnabled={isAutoScrollEnabled}
                onAutoScrollChange={onAutoScrollChange}
                className="absolute right-3 top-3"
              />
              <video
                ref={desktopVideoRef}
                id={`video-desktop-${post.id}`}
                loop={!isAutoScrollEnabled}
                controls
                muted={!isSoundEnabled}
                onEnded={() => onVideoEnded(post.id)}
                onPlay={handleDesktopVideoPlay}
                preload={videoPreloadMode}
                className="mx-auto h-full rounded-xl object-cover"
                src={useCreateBucketUrl(post.video_url)}
              />
              {!isSoundEnabled ? (
                <button
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    enableSound()
                  }}
                  className="absolute left-3 top-3 z-30 rounded-full bg-black/60 px-3 py-1.5 text-xs font-semibold text-white"
                >
                  Click for sound
                </button>
              ) : null}
              <img
                className="absolute bottom-10 right-2"
                width="90"
                src="/images/tiktok-logo-white.png"
                alt="Logo"
              />
            </div>

            <PostMainLikes post={post} onCommentClick={openCommentsSheet} />
          </div>
        </div>
      </div>

      {isCommentsSheetOpen ? (
        <div className="fixed inset-0 z-[80] hidden md:block">
          <button
            onClick={() => setIsCommentsSheetOpen(false)}
            aria-label="Close comments panel"
            className="absolute inset-0 bg-black/55"
          />

          <div className="absolute right-0 top-0 flex h-full w-[460px] max-w-[92vw] flex-col border-l border-gray-200 bg-white text-gray-900 dark:border-white/10 dark:bg-black dark:text-white">
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-white/10">
              <p className="text-[30px] font-semibold tracking-tight">
                Comments <span className="text-gray-500 dark:text-[#9CA0AA]">{commentsCount}</span>
              </p>
              <button
                onClick={() => setIsCommentsSheetOpen(false)}
                className="rounded-full bg-gray-100 p-2 text-gray-600 hover:text-gray-900 dark:bg-[#25262d] dark:text-[#D5D8DF] dark:hover:text-white"
              >
                <IoClose size={21} />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {isCommentsLoading ? (
                <p className="py-8 text-center text-sm text-gray-500 dark:text-[#9CA0AA]">Loading comments...</p>
              ) : mobileComments.length < 1 ? (
                <p className="py-8 text-center text-sm text-gray-500 dark:text-[#9CA0AA]">No comments yet</p>
              ) : (
                mobileComments.map((comment) => (
                  <div key={comment.id} className="flex items-start gap-3 px-4 py-3">
                    <img
                      className="h-10 w-10 rounded-full object-cover"
                      src={useCreateBucketUrl(comment.profile.image)}
                      alt={comment.profile.name}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-semibold text-gray-500 dark:text-[#9CA0AA]">{comment.profile.name}</p>
                      <p className="mt-1 break-words text-[16px] leading-6 text-gray-900 dark:text-white">{comment.text}</p>
                      <div className="mt-2 flex items-center gap-4 text-[14px] font-semibold text-gray-500 dark:text-[#9CA0AA]">
                        <span>Now</span>
                        <button className="hover:text-gray-900 dark:hover:text-white">Reply</button>
                      </div>
                    </div>
                    <button className="mt-1 inline-flex flex-col items-center text-gray-500 hover:text-gray-900 dark:text-[#9CA0AA] dark:hover:text-white">
                      <AiFillHeart size={18} />
                      <span className="text-[12px]">0</span>
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="border-t border-gray-200 px-4 py-3 dark:border-white/10">
              {!user?.id ? (
                <button
                  onClick={() => setIsLoginOpen(true)}
                  className="flex w-full items-center justify-center gap-2 rounded-full bg-[#F02C56] py-3 text-[16px] font-semibold text-white hover:bg-[#e61f4b]"
                >
                  <FaCommentDots size={18} />
                  Log in to comment
                </button>
              ) : (
                <div className="flex items-center gap-3">
                  <input
                    ref={commentInputRef}
                    value={commentInput}
                    onChange={(event) => setCommentInput(event.target.value)}
                    className="w-full rounded-full border border-transparent bg-gray-100 px-4 py-2.5 text-sm text-gray-900 outline-none placeholder:text-gray-500 focus:border-gray-400 dark:bg-[#161823] dark:text-white dark:placeholder:text-[#9CA0AA] dark:focus:border-[#494A50]"
                    placeholder="Add comment..."
                  />
                  <button
                    onClick={submitInlineComment}
                    disabled={!commentInput.trim() || isSubmittingComment}
                    className={`text-sm font-semibold ${commentInput.trim() && !isSubmittingComment ? 'text-[#F02C56]' : 'text-[#6D6E75]'}`}
                  >
                    {isSubmittingComment ? '...' : 'Post'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default PostMain

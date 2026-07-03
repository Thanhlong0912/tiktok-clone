import moment from 'moment'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AiFillHeart, AiOutlineRetweet } from 'react-icons/ai'
import { BiLoaderCircle } from 'react-icons/bi'
import { BsFillPlayFill, BsBookmark, BsBookmarkFill, BsTrash3, BsVolumeMuteFill, BsVolumeUpFill } from 'react-icons/bs'
import { FaCommentDots, FaRegCopy, FaShare } from 'react-icons/fa'
import { FiShare } from 'react-icons/fi'
import { ImMusic } from 'react-icons/im'
import { IoClose } from 'react-icons/io5'
import { formatCount } from '../utils/formatNumber'
import { showToast } from '../utils/toast'
import {
  INTERACTION_EVENT,
  createInteraction,
  deleteInteraction,
  getInteractionsByPost,
} from '../utils/socialInteractions'
import { useUser } from '../context/user'
import useCreateBucketUrl from '../hooks/useCreateBucketUrl'
import useCreateComment from '../hooks/useCreateComment'
import useCreateFollow from '../hooks/useCreateFollow'
import useCreateLike from '../hooks/useCreateLike'
import useDeleteComment from '../hooks/useDeleteComment'
import useDeleteFollow from '../hooks/useDeleteFollow'
import useDeleteLike from '../hooks/useDeleteLike'
import useGetCommentsByPostId from '../hooks/useGetCommentsByPostId'
import useGetLikesByPostId from '../hooks/useGetLikesByPostId'
import useIsFollowing from '../hooks/useIsFollowing'
import { useGeneralStore } from '../stores/general'
import { CommentWithProfile, Like, PostMainCompTypes } from '../types'
import { pauseOtherVideos, pauseVideosDuringNavigation, rememberVideoPlayback } from '../utils/videoPlayback'
import { getVideoSoundEnabled, setVideoSoundEnabled, subscribeToVideoSoundPreference } from '../utils/videoSoundPreference'
import { getImagePostAudioId, getImagePostIds, isImagePost } from '../utils/postMedia'
import ImageSlideshow from './ImageSlideshow'
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
  const isOpeningPostDetailRef = useRef<boolean>(false)

  const [followId, setFollowId] = useState<string | null>(null)
  const [isVideoPaused, setIsVideoPaused] = useState<boolean>(false)
  const [isDesktopPaused, setIsDesktopPaused] = useState<boolean>(false)
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
  const [canNativeShare, setCanNativeShare] = useState<boolean>(false)
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null)
  const [videoPreloadMode, setVideoPreloadMode] = useState<'metadata' | 'auto'>('metadata')
  const [isSoundEnabled, setIsSoundEnabledState] = useState<boolean>(false)
  const [isMediaActive, setIsMediaActive] = useState<boolean>(false)

  const [userSaved, setUserSaved] = useState<boolean>(false)
  const [saveId, setSaveId] = useState<string | null>(null)
  const [savesCount, setSavesCount] = useState<number>(0)
  const [isSaveLoading, setIsSaveLoading] = useState<boolean>(false)
  const [userReposted, setUserReposted] = useState<boolean>(false)
  const [repostId, setRepostId] = useState<string | null>(null)
  const [repostCount, setRepostCount] = useState<number>(0)
  const [isRepostLoading, setIsRepostLoading] = useState<boolean>(false)
  const [videoProgress, setVideoProgress] = useState<number>(0)

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

  const syncInteractions = useCallback(async () => {
    try {
      const [saves, reposts] = await Promise.all([
        getInteractionsByPost('save', post.id),
        getInteractionsByPost('repost', post.id),
      ])

      setSavesCount(saves.length)
      setRepostCount(reposts.length)

      const mySave = user?.id ? saves.find((s) => s.user_id === user.id) : undefined
      const myRepost = user?.id ? reposts.find((r) => r.user_id === user.id) : undefined
      setUserSaved(Boolean(mySave))
      setSaveId(mySave?.id || null)
      setUserReposted(Boolean(myRepost))
      setRepostId(myRepost?.id || null)
    } catch (error) {
      console.error(error)
    }
  }, [post.id, user?.id])

  useEffect(() => {
    syncInteractions()

    if (typeof window === 'undefined') {
      return
    }

    const handler = () => syncInteractions()
    window.addEventListener(INTERACTION_EVENT, handler)
    return () => window.removeEventListener(INTERACTION_EVENT, handler)
  }, [syncInteractions])

  const toggleSave = useCallback(async () => {
    if (!user?.id) {
      setIsLoginOpen(true)
      return
    }
    if (isSaveLoading) return

    setIsSaveLoading(true)
    // optimistic
    const wasSaved = userSaved
    setUserSaved(!wasSaved)
    setSavesCount((c) => Math.max(0, c + (wasSaved ? -1 : 1)))
    try {
      if (wasSaved && saveId) {
        await deleteInteraction('save', saveId)
        setSaveId(null)
      } else if (!wasSaved) {
        const id = await createInteraction('save', user.id, post.id)
        setSaveId(id)
      }
    } catch (error) {
      console.error(error)
      // rollback
      setUserSaved(wasSaved)
      setSavesCount((c) => Math.max(0, c + (wasSaved ? 1 : -1)))
    } finally {
      setIsSaveLoading(false)
    }
  }, [isSaveLoading, post.id, saveId, setIsLoginOpen, user?.id, userSaved])

  const toggleRepost = useCallback(async () => {
    if (!user?.id) {
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
        const id = await createInteraction('repost', user.id, post.id)
        setRepostId(id)
      }
    } catch (error) {
      console.error(error)
      setUserReposted(wasReposted)
      setRepostCount((c) => Math.max(0, c + (wasReposted ? 1 : -1)))
    } finally {
      setIsRepostLoading(false)
    }
  }, [isRepostLoading, post.id, repostId, setIsLoginOpen, user?.id, userReposted])

  const handleVideoProgress = useCallback((event: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget
    if (video.duration > 0) {
      setVideoProgress((video.currentTime / video.duration) * 100)
    }
  }, [])

  useEffect(() => {
    const postMainElement = postMainRef.current

    const observer = new IntersectionObserver(
      (entries) => {
        const isDesktopViewport = typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches
        const activeVideo = isDesktopViewport ? desktopVideoRef.current : videoRef.current
        const isPostImage = isImagePost(post.video_url)

        if (entries[0].isIntersecting) {
          setIsMediaActive(true)

          if (isPostImage) {
            return
          }

          if (!activeVideo || isOpeningPostDetailRef.current) {
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
          setIsMediaActive(false)
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
  }, [isSoundEnabled, post.id, post.video_url])

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
    setIsDesktopPaused(false)
  }, [])

  const toggleDesktopPlay = useCallback(() => {
    const video = desktopVideoRef.current
    if (!video) return

    if (video.paused) {
      video.play().then(() => setIsDesktopPaused(false)).catch(() => setIsDesktopPaused(true))
    } else {
      video.pause()
      setIsDesktopPaused(true)
    }
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

  const toggleSound = useCallback(() => {
    const enabled = !isSoundEnabled
    setVideoSoundEnabled(enabled)
    syncSoundState(enabled)

    if (enabled) {
      const isDesktopViewport = typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches
      const activeVideo = isDesktopViewport ? desktopVideoRef.current : videoRef.current
      activeVideo?.play().catch(() => null)
    }
  }, [isSoundEnabled, syncSoundState])

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
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/post/${post.id}/${post.profile.user_id}`)
      showToast('Link copied to clipboard')
    } catch {
      showToast('Could not copy link', 'error')
    }
    setIsShareSheetOpen(false)
  }, [post.id, post.profile.user_id])

  useEffect(() => {
    setCanNativeShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function')
  }, [])

  const sharePostNative = useCallback(async () => {
    const url = `${window.location.origin}/post/${post.id}/${post.profile.user_id}`
    try {
      await navigator.share({ title: `@${post.profile.name} on TikTok Clone`, text: post.text, url })
      setIsShareSheetOpen(false)
    } catch {
      // User dismissed the native share sheet — nothing to do.
    }
  }, [post.id, post.profile.name, post.profile.user_id, post.text])

  const deleteFeedComment = useCallback(async (commentId: string) => {
    if (deletingCommentId) return
    if (!confirm('Are you sure you want to delete this comment?')) return

    setDeletingCommentId(commentId)
    try {
      await useDeleteComment(commentId)
      const comments = await useGetCommentsByPostId(post.id)
      const cachedLikes = engagementCacheByPost.get(post.id)?.likes || []
      applyEngagementSnapshot(cachedLikes, comments || [])
    } catch (error) {
      console.error(error)
      showToast('Could not delete comment', 'error')
    } finally {
      setDeletingCommentId(null)
    }
  }, [applyEngagementSnapshot, deletingCommentId, post.id])

  const rememberCurrentPlayback = useCallback(() => {
    if (isImagePost(post.video_url)) {
      return
    }

    const isDesktopViewport = typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches
    const activeVideo = isDesktopViewport ? desktopVideoRef.current : videoRef.current

    rememberVideoPlayback({
      postId: post.id,
      userId: post.profile.user_id,
      video: activeVideo,
      source: 'feed',
    })
  }, [post.id, post.profile.user_id, post.video_url])

  const openPostDetail = useCallback(() => {
    isOpeningPostDetailRef.current = true
    rememberCurrentPlayback()
    pauseVideosDuringNavigation()
    router.push(`/post/${post.id}/${post.profile.user_id}`)
  }, [post.id, post.profile.user_id, rememberCurrentPlayback, router])

  const openCommentsSheet = useCallback(async () => {
    if (isCommentsSheetOpen) {
      setIsCommentsSheetOpen(false)
      return
    }

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
  }, [applyEngagementSnapshot, isCommentsSheetOpen, post.id])

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

  const postIsImage = isImagePost(post.video_url)
  const postImageIds = getImagePostIds(post.video_url)
  const postAudioId = getImagePostAudioId(post.video_url)
  const hasImageAudio = postIsImage && Boolean(postAudioId)

  return (
    <div
      ref={postMainRef}
      data-feed-index={feedIndex}
      className="snap-start h-[100dvh] md:h-[calc(100vh-60px)]"
    >
      <div className="relative h-full w-full overflow-hidden bg-black md:hidden">
        {postIsImage ? (
          <div className="relative h-full w-full" onDoubleClick={handleDoubleTapLike}>
            <ImageSlideshow
              imageIds={postImageIds}
              audioId={postAudioId}
              muted={!isSoundEnabled}
              autoPlay={isMediaActive}
              onCycleComplete={() => onVideoEnded(post.id)}
              className="h-full w-full"
              altPrefix={`${post.profile.name} image`}
            />

            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-black/65 via-black/20 to-transparent" />

            {showHeartBurst ? (
              <AiFillHeart className="heart-pop pointer-events-none absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 text-[96px] text-white/95" />
            ) : null}
          </div>
        ) : (
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
              onTimeUpdate={handleVideoProgress}
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
        )}

        {!postIsImage || hasImageAudio ? (
          <button
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              toggleSound()
            }}
            aria-label={isSoundEnabled ? 'Mute' : 'Unmute'}
            className="absolute left-4 top-[calc(env(safe-area-inset-top)+16px)] z-30 flex items-center gap-1.5 rounded-full bg-black/55 px-3 py-1.5 text-xs font-semibold text-white"
          >
            {isSoundEnabled ? <BsVolumeUpFill size={16} /> : <BsVolumeMuteFill size={16} />}
            {!isSoundEnabled ? 'Tap for sound' : null}
          </button>
        ) : null}

        <VideoOptionsMenu
          isAutoScrollEnabled={isAutoScrollEnabled}
          onAutoScrollChange={onAutoScrollChange}
          postId={post.id}
          postUserId={post.profile.user_id}
          className="absolute right-4 top-[calc(env(safe-area-inset-top)+16px)]"
        />

        {!postIsImage ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+56px)] z-20 h-[3px] bg-white/20">
            <div
              className="h-full bg-white transition-[width] duration-150 ease-linear"
              style={{ width: `${videoProgress}%` }}
            />
          </div>
        ) : null}

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

        <div className="absolute bottom-[calc(env(safe-area-inset-bottom)+80px)] right-3 z-20 flex w-[60px] flex-col items-center gap-3.5 text-white">
          <button
            onClick={() => router.push(`/profile/${post.profile.user_id}`)}
            className="relative inline-flex h-12 w-12 items-center justify-center rounded-full border-2 border-white bg-black/10"
          >
            <img
              className="h-10 w-10 rounded-full object-cover"
              src={useCreateBucketUrl(post.profile.image)}
              alt="Profile"
            />
            {user?.id !== post.profile.user_id ? (
              <span
                onClick={(e) => {
                  e.stopPropagation()
                  toggleFollow()
                }}
                className={`absolute -bottom-2 left-1/2 flex h-5 w-5 -translate-x-1/2 items-center justify-center rounded-full text-white ${
                  followId ? 'bg-white/30' : 'bg-tiktok'
                }`}
              >
                {followId ? '✓' : '+'}
              </span>
            ) : null}
          </button>

          <button onClick={likeOrUnlike} className="flex flex-col items-center text-xs font-semibold">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/35 backdrop-blur-sm active:scale-90 transition-transform">
              <AiFillHeart size={30} color={userLiked ? '#fe2c55' : '#ffffff'} className={userLiked ? 'tt-pop' : ''} />
            </span>
            <span className="mt-1 drop-shadow-[0_1px_2px_rgba(0,0,0,0.75)]">{formatCount(likesCount)}</span>
          </button>

          <button
            onClick={openCommentsSheet}
            className="flex flex-col items-center text-xs font-semibold"
          >
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/35 backdrop-blur-sm">
              <FaCommentDots size={26} />
            </span>
            <span className="mt-1 drop-shadow-[0_1px_2px_rgba(0,0,0,0.75)]">{formatCount(commentsCount)}</span>
          </button>

          <button onClick={toggleSave} className="flex flex-col items-center text-xs font-semibold">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/35 backdrop-blur-sm active:scale-90 transition-transform">
              {userSaved ? (
                <BsBookmarkFill size={24} color="#ffc60a" className="tt-pop" />
              ) : (
                <BsBookmark size={24} />
              )}
            </span>
            <span className="mt-1 drop-shadow-[0_1px_2px_rgba(0,0,0,0.75)]">{formatCount(savesCount)}</span>
          </button>

          <button onClick={toggleRepost} className="flex flex-col items-center text-xs font-semibold">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/35 backdrop-blur-sm active:scale-90 transition-transform">
              <AiOutlineRetweet size={26} color={userReposted ? '#25f4ee' : '#ffffff'} />
            </span>
            <span className="mt-1 drop-shadow-[0_1px_2px_rgba(0,0,0,0.75)]">{formatCount(repostCount)}</span>
          </button>

          <button
            className="flex flex-col items-center text-xs font-semibold"
            onClick={() => setIsShareSheetOpen(true)}
          >
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/35 backdrop-blur-sm">
              <FaShare size={23} />
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
            <div className="relative w-full rounded-t-2xl bg-surface px-4 pt-4 text-ink md:max-w-[520px] md:rounded-2xl md:max-h-[78vh] md:flex md:flex-col">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-semibold">{commentsCount} comments</p>
                <button onClick={() => setIsCommentsSheetOpen(false)} className="rounded-full bg-surface-subtle p-1">
                  <IoClose size={22} />
                </button>
              </div>

              <div className="max-h-[48dvh] overflow-y-auto pb-3 md:max-h-[55vh]">
                {isCommentsLoading ? (
                  <p className="py-8 text-center text-sm text-ink-soft">Loading comments...</p>
                ) : mobileComments.length < 1 ? (
                  <p className="py-8 text-center text-sm text-ink-soft">No comments yet</p>
                ) : (
                  mobileComments.map((comment) => (
                    <div key={comment.id} className="mb-3 flex items-start gap-3">
                      <img
                        className="h-9 w-9 rounded-full object-cover"
                        src={useCreateBucketUrl(comment.profile.image)}
                        alt="Profile"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-semibold">{comment.profile.name}</p>
                        <p className="text-[14px] leading-5">{comment.text}</p>
                        <p className="mt-1 text-[12px] font-medium text-ink-soft">
                          {moment(comment.created_at).fromNow()}
                        </p>
                      </div>
                      {user?.id === comment.user_id ? (
                        <button
                          onClick={() => deleteFeedComment(comment.id)}
                          disabled={deletingCommentId === comment.id}
                          aria-label="Delete comment"
                          className="mt-1 text-ink-soft disabled:opacity-60"
                        >
                          {deletingCommentId === comment.id ? (
                            <BiLoaderCircle className="animate-spin" size={15} />
                          ) : (
                            <BsTrash3 size={14} />
                          )}
                        </button>
                      ) : null}
                    </div>
                  ))
                )}
              </div>

              <div className="border-t border-line py-3 pb-[calc(env(safe-area-inset-bottom)+12px)]">
                <div className="flex items-center gap-3">
                  <input
                    ref={commentInputRef}
                    value={commentInput}
                    onChange={(event) => setCommentInput(event.target.value)}
                    className="w-full rounded-full border border-transparent bg-surface-subtle px-4 py-2.5 text-sm text-ink outline-none placeholder:text-ink-soft focus:border-line"
                    placeholder="Add comment..."
                  />
                  <button
                    onClick={submitInlineComment}
                    disabled={!commentInput.trim() || isSubmittingComment}
                    className={`text-sm font-semibold ${commentInput.trim() && !isSubmittingComment ? 'text-tiktok' : 'text-ink-soft'}`}
                  >
                    {isSubmittingComment ? '...' : 'Post'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

      </div>

      {/* Desktop / tablet immersive feed */}
      <div
        className={`hidden h-full w-full items-center justify-center transition-[padding] duration-300 ease-out md:flex ${
          isCommentsSheetOpen ? 'lg:pr-[420px]' : ''
        }`}
      >
        <div className="flex h-full items-end gap-3 py-4">
          <div
            className="relative flex h-full max-h-[calc(100vh-92px)] items-center overflow-hidden rounded-2xl bg-black"
            style={{ aspectRatio: '9 / 16' }}
          >
            <VideoOptionsMenu
              isAutoScrollEnabled={isAutoScrollEnabled}
              onAutoScrollChange={onAutoScrollChange}
              postId={post.id}
              postUserId={post.profile.user_id}
              className="absolute right-3 top-3"
            />

            {postIsImage ? (
              <div className="h-full w-full" onDoubleClick={handleDoubleTapLike}>
                <ImageSlideshow
                  imageIds={postImageIds}
                  audioId={postAudioId}
                  muted={!isSoundEnabled}
                  autoPlay={isMediaActive}
                  onCycleComplete={() => onVideoEnded(post.id)}
                  className="h-full w-full"
                  altPrefix={`${post.profile.name} image`}
                />
              </div>
            ) : (
              <>
                <video
                  ref={desktopVideoRef}
                  id={`video-desktop-${post.id}`}
                  loop={!isAutoScrollEnabled}
                  muted={!isSoundEnabled}
                  onEnded={() => onVideoEnded(post.id)}
                  onPlay={handleDesktopVideoPlay}
                  onPause={() => setIsDesktopPaused(true)}
                  onTimeUpdate={handleVideoProgress}
                  onClick={toggleDesktopPlay}
                  onDoubleClick={handleDoubleTapLike}
                  preload={videoPreloadMode}
                  className="h-full w-full cursor-pointer object-cover"
                  src={useCreateBucketUrl(post.video_url)}
                />
                {isDesktopPaused ? (
                  <button
                    onClick={toggleDesktopPlay}
                    className="pointer-events-auto absolute left-1/2 top-1/2 z-10 inline-flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm"
                  >
                    <BsFillPlayFill size={34} />
                  </button>
                ) : null}
              </>
            )}

            {showHeartBurst ? (
              <AiFillHeart className="heart-pop pointer-events-none absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 text-[110px] text-white/95" />
            ) : null}

            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-black/75 via-black/15 to-transparent" />

            <div className="absolute inset-x-0 bottom-0 z-10 p-5 text-white">
              <div className="mb-2 flex items-center gap-2">
                <Link href={`/profile/${post.profile.user_id}`} className="text-[17px] font-bold hover:underline">
                  @{post.profile.name}
                </Link>
                {user?.id !== post.profile.user_id ? (
                  <button
                    onClick={toggleFollow}
                    className={`rounded-md border px-3 py-1 text-[13px] font-semibold ${
                      followId ? 'border-white/70 bg-white/10' : 'border-white bg-white text-black'
                    }`}
                  >
                    {followId ? 'Following' : 'Follow'}
                  </button>
                ) : null}
              </div>
              <p className="line-clamp-2 max-w-[86%] text-[14px] leading-5 text-white/95">{post.text}</p>
              <p className="mt-2 flex items-center text-[13px] font-medium text-white/90">
                <ImMusic size={14} />
                <span className="ml-1.5 truncate">original sound - {post.profile.name}</span>
              </p>
            </div>

            {!postIsImage || hasImageAudio ? (
              <button
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  toggleSound()
                }}
                aria-label={isSoundEnabled ? 'Mute' : 'Unmute'}
                className="absolute left-3 top-3 z-30 flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-xs font-semibold text-white"
              >
                {isSoundEnabled ? <BsVolumeUpFill size={16} /> : <BsVolumeMuteFill size={16} />}
                {!isSoundEnabled ? 'Click for sound' : null}
              </button>
            ) : null}

            {!postIsImage ? (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-1 bg-white/25">
                <div
                  className="h-full bg-white transition-[width] duration-150 ease-linear"
                  style={{ width: `${videoProgress}%` }}
                />
              </div>
            ) : null}
          </div>

          {/* Action rail */}
          <div className="flex flex-col items-center gap-4 pb-3 text-ink">
            <button
              onClick={() => router.push(`/profile/${post.profile.user_id}`)}
              className="relative mb-1 inline-flex h-12 w-12 items-center justify-center rounded-full"
            >
              <img
                className="h-12 w-12 rounded-full object-cover"
                src={useCreateBucketUrl(post.profile.image)}
                alt={post.profile.name}
              />
              {user?.id !== post.profile.user_id ? (
                <span
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleFollow()
                  }}
                  className={`absolute -bottom-2 left-1/2 flex h-5 w-5 -translate-x-1/2 items-center justify-center rounded-full text-[13px] text-white ${
                    followId ? 'bg-ink-soft' : 'bg-tiktok'
                  }`}
                >
                  {followId ? '✓' : '+'}
                </span>
              ) : null}
            </button>

            <button onClick={likeOrUnlike} className="flex flex-col items-center gap-1">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-subtle transition-transform active:scale-90">
                <AiFillHeart size={26} color={userLiked ? '#fe2c55' : undefined} className={userLiked ? 'tt-pop' : ''} />
              </span>
              <span className="text-xs font-semibold">{formatCount(likesCount)}</span>
            </button>

            <button onClick={openCommentsSheet} className="flex flex-col items-center gap-1">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-subtle">
                <FaCommentDots size={24} />
              </span>
              <span className="text-xs font-semibold">{formatCount(commentsCount)}</span>
            </button>

            <button onClick={toggleSave} className="flex flex-col items-center gap-1">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-subtle transition-transform active:scale-90">
                {userSaved ? <BsBookmarkFill size={22} color="#ffc60a" className="tt-pop" /> : <BsBookmark size={22} />}
              </span>
              <span className="text-xs font-semibold">{formatCount(savesCount)}</span>
            </button>

            <button onClick={toggleRepost} className="flex flex-col items-center gap-1">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-subtle transition-transform active:scale-90">
                <AiOutlineRetweet size={24} color={userReposted ? '#25c2c2' : undefined} />
              </span>
              <span className="text-xs font-semibold">{formatCount(repostCount)}</span>
            </button>

            <button onClick={() => setIsShareSheetOpen(true)} className="flex flex-col items-center gap-1">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-subtle">
                <FaShare size={22} />
              </span>
              <span className="text-xs font-semibold">Share</span>
            </button>
          </div>
        </div>
      </div>

      {isShareSheetOpen ? (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/45 md:items-center">
          <button
            onClick={() => setIsShareSheetOpen(false)}
            aria-label="Close share sheet"
            className="absolute inset-0"
          />
          <div className="tt-sheet-up relative w-full rounded-t-2xl bg-surface px-4 pt-4 text-ink md:w-[400px] md:rounded-2xl md:pb-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold">Share to</p>
              <button onClick={() => setIsShareSheetOpen(false)} className="rounded-full bg-surface-subtle p-1" aria-label="Close">
                <IoClose size={22} />
              </button>
            </div>

            <div className="space-y-2 pb-[calc(env(safe-area-inset-bottom)+12px)] md:pb-0">
              {canNativeShare ? (
                <button
                  onClick={sharePostNative}
                  className="flex w-full items-center justify-center gap-2 rounded-full bg-tiktok px-4 py-2.5 text-sm font-semibold text-white hover:bg-tiktok-hover"
                >
                  <FiShare size={15} />
                  Share via...
                </button>
              ) : null}
              <button
                onClick={copyPostLink}
                className="flex w-full items-center justify-center gap-2 rounded-full border border-line px-4 py-2.5 text-sm font-semibold hover:bg-surface-subtle"
              >
                <FaRegCopy size={14} />
                Copy link
              </button>
              <button
                onClick={openPostDetail}
                className="w-full rounded-full bg-ink px-4 py-2.5 text-sm font-semibold text-surface"
              >
                Go to post
              </button>
              <button
                onClick={() => setIsShareSheetOpen(false)}
                className="w-full rounded-full bg-surface-subtle px-4 py-2.5 text-sm font-semibold"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isCommentsSheetOpen ? (
        <div className="fixed bottom-0 right-0 top-[60px] z-[35] hidden w-[420px] max-w-[92vw] flex-col border-l border-line bg-surface text-ink shadow-rail md:flex">
            <div className="flex items-center justify-between border-b border-line px-6 py-4">
              <p className="text-[22px] font-semibold tracking-tight">
                Comments <span className="text-ink-soft">{commentsCount}</span>
              </p>
              <button
                onClick={() => setIsCommentsSheetOpen(false)}
                className="rounded-full bg-surface-subtle p-2 text-ink-soft hover:text-ink"
              >
                <IoClose size={21} />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {isCommentsLoading ? (
                <p className="py-8 text-center text-sm text-ink-soft">Loading comments...</p>
              ) : mobileComments.length < 1 ? (
                <p className="py-8 text-center text-sm text-ink-soft">No comments yet</p>
              ) : (
                mobileComments.map((comment) => (
                  <div key={comment.id} className="flex items-start gap-3 px-4 py-3">
                    <img
                      className="h-10 w-10 rounded-full object-cover"
                      src={useCreateBucketUrl(comment.profile.image)}
                      alt={comment.profile.name}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-semibold text-ink-soft">{comment.profile.name}</p>
                      <p className="mt-1 break-words text-[16px] leading-6 text-ink">{comment.text}</p>
                      <div className="mt-2 flex items-center gap-4 text-[14px] font-semibold text-ink-soft">
                        <span>{moment(comment.created_at).fromNow()}</span>
                        {user?.id === comment.user_id ? (
                          <button
                            onClick={() => deleteFeedComment(comment.id)}
                            disabled={deletingCommentId === comment.id}
                            aria-label="Delete comment"
                            className="inline-flex items-center hover:text-ink disabled:opacity-60"
                          >
                            {deletingCommentId === comment.id ? (
                              <BiLoaderCircle className="animate-spin" size={16} />
                            ) : (
                              <BsTrash3 size={15} />
                            )}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="border-t border-line px-4 py-3">
              {!user?.id ? (
                <button
                  onClick={() => setIsLoginOpen(true)}
                  className="flex w-full items-center justify-center gap-2 rounded-full bg-tiktok py-3 text-[16px] font-semibold text-white hover:bg-tiktok-hover"
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
                    className="w-full rounded-full border border-transparent bg-surface-subtle px-4 py-2.5 text-sm text-ink outline-none placeholder:text-ink-soft focus:border-line"
                    placeholder="Add comment..."
                  />
                  <button
                    onClick={submitInlineComment}
                    disabled={!commentInput.trim() || isSubmittingComment}
                    className={`text-sm font-semibold ${commentInput.trim() && !isSubmittingComment ? 'text-tiktok' : 'text-ink-soft'}`}
                  >
                    {isSubmittingComment ? '...' : 'Post'}
                  </button>
                </div>
              )}
            </div>
          </div>
      ) : null}
    </div>
  )
}

export default PostMain

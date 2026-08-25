import moment from 'moment'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AiFillHeart, AiOutlineRetweet } from 'react-icons/ai'
import { BsFillPlayFill, BsBookmark, BsBookmarkFill } from 'react-icons/bs'
import { FaCommentDots, FaRegCopy, FaShare } from 'react-icons/fa'
import { FiShare } from 'react-icons/fi'
import { ImMusic } from 'react-icons/im'
import { IoClose } from 'react-icons/io5'
import { formatCount } from '../utils/formatNumber'
import { showToast } from '../utils/toast'
import { createInteraction, deleteInteraction } from '../utils/socialInteractions'
import { recordShare } from '../utils/feed'
import { feedWatchSession } from '../utils/feedWatch'
import { useUser } from '../context/user'
import { createBucketUrl } from '../hooks/useCreateBucketUrl'
import useCreateFollow from '../hooks/useCreateFollow'
import useCreateLike from '../hooks/useCreateLike'
import useDeleteFollow from '../hooks/useDeleteFollow'
import useDeleteLike from '../hooks/useDeleteLike'
import useIsFollowing from '../hooks/useIsFollowing'
import CommentThread from './post/CommentThread'
import { useGeneralStore } from '../stores/general'
import { PostMainCompTypes } from '../types'
import { isFloatingVideo, pauseOtherVideos, pauseVideosDuringNavigation, rememberVideoPlayback } from '../utils/videoPlayback'
import { getImagePostAudioId, getImagePostIds, isImagePost } from '../utils/postMedia'
import { resolutionLabel } from '../utils/videoQuality'
import { createCaptionObjectUrl, fetchPostCaptions } from '../utils/captions'
import {
  getVideoCaptionsEnabled,
  setVideoCaptionsEnabled,
  subscribeToVideoCaptionsPreference,
} from '../utils/videoCaptionsPreference'
import useVideoPlayerPreferences from '../hooks/useVideoPlayerPreferences'
import CaptionText from './CaptionText'
import ImageSlideshow from './ImageSlideshow'
import VideoOptionsMenu, { type CaptionsState } from './VideoOptionsMenu'
import VolumeControl from './VolumeControl'

/**
 * A single feed card.
 *
 * Two structural rules, both of which the previous version broke:
 *
 * 1. ONE media element. It used to render a mobile <video> and a desktop
 *    <video> for every post and hide one with `display:none` -- which does not
 *    stop a download, so a 100-post desktop feed created 200 media elements and
 *    fetched everything twice. Image posts were worse: two ImageSlideshows each
 *    with their own <audio>, so music played twice, overlapping.
 * 2. NO per-card fetching. Counters and this viewer's like/save/repost/follow
 *    state arrive on `post` from get_feed. The card used to issue 5 + one-per-
 *    comment requests of its own on mount, and re-run two of them in EVERY
 *    mounted card whenever anyone saved anything.
 *
 * Mobile and desktop share one DOM tree and diverge with responsive classes.
 */

// Follow state is the one thing not carried on the post row for the detail
// page's sake, so keep a small session cache keyed by both users.
const followStateByPair = new Map<string, string | null>()

const PostMain = ({
  post,
  feedIndex,
  isAutoScrollEnabled,
  onVideoEnded,
  onAutoScrollChange,
  onRemove,
  onPostChange,
  onFloatingPlayerChange,
}: PostMainCompTypes) => {
  const { user } = useUser() || {}
  const {
    setIsLoginOpen,
    isFeedCommentsOpen,
    setIsFeedCommentsOpen,
    activeFeedPostId,
    setActiveFeedPostId,
  } = useGeneralStore()
  const router = useRouter()

  const videoRef = useRef<HTMLVideoElement>(null)
  const postMainRef = useRef<HTMLDivElement>(null)
  const tapTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastTapRef = useRef<number>(0)
  // Only the card the viewer actually clicked should pull focus into the input.
  // Without this, every swipe with the panel open would refocus (and on mobile
  // reopen the keyboard) on whichever card scrolled into place. A ref, not
  // state: clearing it must not re-run the focus effect and cancel its timer.
  const pendingCommentFocusRef = useRef<boolean>(false)
  const isOpeningPostDetailRef = useRef<boolean>(false)

  const [followId, setFollowId] = useState<string | null>(post.is_following ? 'known' : null)
  const [isVideoPaused, setIsVideoPaused] = useState<boolean>(false)
  const [showHeartBurst, setShowHeartBurst] = useState<boolean>(false)

  // Seeded from the post row -- no fetch.
  const [likesCount, setLikesCount] = useState<number>(post.like_count)
  const [commentsCount, setCommentsCount] = useState<number>(post.comment_count)
  const [savesCount, setSavesCount] = useState<number>(post.save_count)
  const [repostCount, setRepostCount] = useState<number>(post.repost_count)
  const [userLiked, setUserLiked] = useState<boolean>(post.is_liked)
  const [userSaved, setUserSaved] = useState<boolean>(post.is_saved)
  const [userReposted, setUserReposted] = useState<boolean>(post.is_reposted)

  const [activeLikeId, setActiveLikeId] = useState<string | null>(null)
  const [saveId, setSaveId] = useState<string | null>(null)
  const [repostId, setRepostId] = useState<string | null>(null)
  const [isLikeLoading, setIsLikeLoading] = useState<boolean>(false)
  const [isSaveLoading, setIsSaveLoading] = useState<boolean>(false)
  const [isRepostLoading, setIsRepostLoading] = useState<boolean>(false)

  const [isShareSheetOpen, setIsShareSheetOpen] = useState<boolean>(false)
  const [canNativeShare, setCanNativeShare] = useState<boolean>(false)
  const [videoPreloadMode, setVideoPreloadMode] = useState<'metadata' | 'auto'>('metadata')
  const [isMediaActive, setIsMediaActive] = useState<boolean>(false)
  const [videoProgress, setVideoProgress] = useState<number>(0)
  const [mediaFailed, setMediaFailed] = useState<boolean>(false)

  const [isFloatingPlayerSupported, setIsFloatingPlayerSupported] = useState<boolean>(false)
  const [isFloatingPlayerActive, setIsFloatingPlayerActive] = useState<boolean>(false)
  const [captionsState, setCaptionsState] = useState<CaptionsState>('unknown')
  const [captionTrackUrl, setCaptionTrackUrl] = useState<string>('')
  const [isCaptionsEnabled, setIsCaptionsEnabled] = useState<boolean>(false)

  // muted / volume / playbackRate, shared with the detail page's two players.
  const { isSoundEnabled, volume, speed, applyPreferences } = useVideoPlayerPreferences(videoRef)

  const postIsImage = isImagePost(post.video_url)
  const postImageIds = useMemo(() => getImagePostIds(post.video_url), [post.video_url])
  const postAudioId = useMemo(() => getImagePostAudioId(post.video_url), [post.video_url])
  const hasImageAudio = postIsImage && Boolean(postAudioId)
  const posterUrl = post.poster_key ? createBucketUrl(post.poster_key) : undefined
  const mediaUrl = useMemo(
    () => (postIsImage ? '' : createBucketUrl(post.video_url)),
    [post.video_url, postIsImage]
  )

  // Keep local state in step when the store replaces the row (refresh, patch).
  useEffect(() => {
    setLikesCount(post.like_count)
    setCommentsCount(post.comment_count)
    setSavesCount(post.save_count)
    setRepostCount(post.repost_count)
    setUserLiked(post.is_liked)
    setUserSaved(post.is_saved)
    setUserReposted(post.is_reposted)
  }, [
    post.like_count,
    post.comment_count,
    post.save_count,
    post.repost_count,
    post.is_liked,
    post.is_saved,
    post.is_reposted,
  ])

  useEffect(() => {
    const checkFollow = async () => {
      if (!user?.id || !post.profile.user_id || user.id === post.profile.user_id) {
        setFollowId(null)
        return
      }

      const followKey = `${user.id}:${post.profile.user_id}`
      const cached = followStateByPair.get(followKey)
      if (cached !== undefined) {
        setFollowId(cached)
        return
      }

      // get_feed already told us whether we follow them; only the row id is
      // missing, and that is only needed to unfollow.
      if (!post.is_following) {
        followStateByPair.set(followKey, null)
        setFollowId(null)
        return
      }

      const id = await useIsFollowing(user.id, post.profile.user_id)
      followStateByPair.set(followKey, id)
      setFollowId(id)
    }

    checkFollow()
  }, [user?.id, post.profile.user_id, post.is_following])

  const patchUp = useCallback(
    (patch: Parameters<NonNullable<PostMainCompTypes['onPostChange']>>[1]) => {
      onPostChange?.(post.id, patch)
    },
    [onPostChange, post.id]
  )

  // ---------------------------------------------------------------- playback

  const handleVideoProgress = useCallback((event: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget
    if (video.duration > 0) {
      setVideoProgress((video.currentTime / video.duration) * 100)
    }

    feedWatchSession.sample(post.id, {
      currentTime: video.currentTime,
      duration: video.duration,
    })
  }, [post.id])

  const seekVideoFromPointer = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const targetVideo = videoRef.current
      if (!targetVideo || !isFinite(targetVideo.duration) || targetVideo.duration <= 0) {
        return
      }

      const rect = event.currentTarget.getBoundingClientRect()
      const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))

      targetVideo.currentTime = fraction * targetVideo.duration
      setVideoProgress(fraction * 100)
    },
    []
  )

  /** Keyboard seeking, so the progress bar is usable without a pointer. */
  const seekFromKeyboard = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const video = videoRef.current
    if (!video || !isFinite(video.duration) || video.duration <= 0) return

    let next: number | null = null
    if (event.key === 'ArrowLeft') next = Math.max(0, video.currentTime - 5)
    if (event.key === 'ArrowRight') next = Math.min(video.duration, video.currentTime + 5)
    if (event.key === 'Home') next = 0
    if (event.key === 'End') next = video.duration

    if (next === null) return
    event.preventDefault()
    event.stopPropagation()
    video.currentTime = next
    setVideoProgress((next / video.duration) * 100)
  }, [])

  /**
   * The observer below reads the sound preference but must not DEPEND on it.
   *
   * With isSoundEnabled in the dependency array, toggling sound tore down and
   * rebuilt the IntersectionObserver in every mounted card, and each rebuild
   * re-fired the intersecting branch -- calling play() again on cards the
   * viewer had already paused.
   */
  const isSoundEnabledRef = useRef<boolean>(isSoundEnabled)
  useEffect(() => {
    isSoundEnabledRef.current = isSoundEnabled
  }, [isSoundEnabled])

  useEffect(() => {
    const postMainElement = postMainRef.current

    const observer = new IntersectionObserver(
      (entries) => {
        const activeVideo = videoRef.current

        if (entries[0].isIntersecting) {
          setIsMediaActive(true)
          setActiveFeedPostId(post.id)
          feedWatchSession.start(post.id)

          if (postIsImage || !activeVideo || isOpeningPostDetailRef.current) {
            return
          }

          pauseOtherVideos(activeVideo)
          activeVideo.muted = !isSoundEnabledRef.current
          activeVideo
            .play()
            .then(() => setIsVideoPaused(false))
            .catch(() => {
              // Autoplay with sound is blocked until the user has interacted
              // with the page. Without this retry the very first video of a
              // session silently never plays whenever the stored sound
              // preference is "on".
              if (!activeVideo.muted) {
                activeVideo.muted = true
                activeVideo
                  .play()
                  .then(() => setIsVideoPaused(false))
                  .catch(() => setIsVideoPaused(true))
                return
              }
              setIsVideoPaused(true)
            })
        } else {
          setIsMediaActive(false)

          // The floating player exists precisely so this video survives being
          // scrolled past: pausing it here would close the feature the moment
          // it was used. Its watch session keeps running for the same reason.
          if (isFloatingVideo(videoRef.current)) {
            return
          }

          videoRef.current?.pause()
          setIsVideoPaused(true)
          // Scrolled away: report what was actually watched.
          if (feedWatchSession.activePostId() === post.id) {
            feedWatchSession.flush()
          }
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
  }, [post.id, postIsImage, setActiveFeedPostId])

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

    return () => warmupObserver.disconnect()
  }, [post.id])

  const togglePlayPause = useCallback(() => {
    const video = videoRef.current
    if (!video) return

    if (video.paused) {
      video.play().then(() => setIsVideoPaused(false)).catch(() => setIsVideoPaused(true))
      return
    }

    video.pause()
    setIsVideoPaused(true)
  }, [])

  /** Unmuting is a user gesture, so it is also the moment a video that autoplay
   *  refused to start can finally be played. */
  const resumeAfterUnmute = useCallback(() => {
    videoRef.current?.play().catch(() => null)
  }, [])

  // ---------------------------------------------------------- floating player

  useEffect(() => {
    if (typeof document === 'undefined') return

    const video = videoRef.current
    setIsFloatingPlayerSupported(
      Boolean(document.pictureInPictureEnabled) && !video?.disablePictureInPicture
    )
  }, [postIsImage])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    // The feed virtualizes to a 5-card window, and unmounting this element
    // would tear the floating window down with it -- so the feed is told which
    // post is floating and keeps that one card mounted.
    const onEnter = () => {
      setIsFloatingPlayerActive(true)
      onFloatingPlayerChange?.(post.id)
    }
    const onLeave = () => {
      setIsFloatingPlayerActive(false)
      onFloatingPlayerChange?.(null)
    }

    video.addEventListener('enterpictureinpicture', onEnter)
    video.addEventListener('leavepictureinpicture', onLeave)

    return () => {
      video.removeEventListener('enterpictureinpicture', onEnter)
      video.removeEventListener('leavepictureinpicture', onLeave)
    }
  }, [onFloatingPlayerChange, post.id, postIsImage])

  const toggleFloatingPlayer = useCallback(async () => {
    const video = videoRef.current
    if (!video || typeof document === 'undefined') return

    try {
      if (document.pictureInPictureElement === video) {
        await document.exitPictureInPicture()
        return
      }

      await video.requestPictureInPicture()
    } catch (error) {
      console.error(error)
      showToast('Could not open the floating player', 'error')
    }
  }, [])

  // ----------------------------------------------------------------- captions

  useEffect(() => {
    setIsCaptionsEnabled(getVideoCaptionsEnabled())
    return subscribeToVideoCaptionsPreference(setIsCaptionsEnabled)
  }, [])

  /**
   * One query per post per session, cached in app/utils/captions.ts. Triggered
   * by opening the menu or by a card going active while captions are already
   * on -- never for every card of every page.
   */
  const loadCaptions = useCallback(async () => {
    if (postIsImage || captionsState !== 'unknown') return

    try {
      const captions = await fetchPostCaptions(post.id)
      if (captions.length < 1) {
        setCaptionsState('none')
        return
      }

      setCaptionsState('available')
      setCaptionTrackUrl(await createCaptionObjectUrl(captions[0].storage_key))
    } catch (error) {
      console.error(error)
      setCaptionsState('none')
    }
  }, [captionsState, post.id, postIsImage])

  useEffect(() => {
    if (isCaptionsEnabled && isMediaActive) void loadCaptions()
  }, [isCaptionsEnabled, isMediaActive, loadCaptions])

  // The blob is this component's to release -- see createCaptionObjectUrl.
  useEffect(() => {
    if (!captionTrackUrl) return
    return () => URL.revokeObjectURL(captionTrackUrl)
  }, [captionTrackUrl])

  useEffect(() => {
    const track = videoRef.current?.textTracks?.[0]
    if (!track) return

    track.mode = isCaptionsEnabled ? 'showing' : 'hidden'
  }, [captionTrackUrl, isCaptionsEnabled])

  useEffect(() => {
    const postId = post.id
    return () => {
      videoRef.current?.pause()
      if (feedWatchSession.activePostId() === postId) {
        feedWatchSession.flush()
      }
    }
  }, [post.id])

  // -------------------------------------------------------------- engagement

  const toggleFollow = useCallback(async () => {
    if (!user?.id) {
      setIsLoginOpen(true)
      return
    }

    const key = `${user.id}:${post.profile.user_id}`

    if (followId) {
      const previous = followId
      setFollowId(null)
      followStateByPair.set(key, null)
      patchUp({ is_following: false })

      try {
        // 'known' is the placeholder used when get_feed said we follow them but
        // we never needed the row id; resolve it before deleting.
        const id = previous === 'known' ? await useIsFollowing(user.id, post.profile.user_id) : previous
        if (id) await useDeleteFollow(id)
      } catch (error) {
        console.error(error)
        setFollowId(previous)
        followStateByPair.set(key, previous)
        patchUp({ is_following: true })
        showToast('Could not unfollow', 'error')
      }
      return
    }

    setFollowId('known')
    followStateByPair.set(key, 'known')
    patchUp({ is_following: true })

    try {
      const id = await useCreateFollow(user.id, post.profile.user_id)
      followStateByPair.set(key, id)
      setFollowId(id)
    } catch (error) {
      console.error(error)
      setFollowId(null)
      followStateByPair.set(key, null)
      patchUp({ is_following: false })
      showToast('Could not follow', 'error')
    }
  }, [followId, patchUp, post.profile.user_id, setIsLoginOpen, user?.id])

  /** Optimistic, so like matches the latency of save and repost beside it. */
  const likeOrUnlike = useCallback(async () => {
    if (!user?.id) {
      setIsLoginOpen(true)
      return
    }
    if (isLikeLoading) return

    const wasLiked = userLiked
    setIsLikeLoading(true)
    setUserLiked(!wasLiked)
    setLikesCount((count) => Math.max(0, count + (wasLiked ? -1 : 1)))
    patchUp({ is_liked: !wasLiked, like_count: Math.max(0, likesCount + (wasLiked ? -1 : 1)) })

    try {
      if (wasLiked) {
        const id = activeLikeId
        if (id) {
          await useDeleteLike(id)
        } else {
          // Liked in a previous session, so we never held the row id.
          const { supabase } = await import('@/libs/supabase')
          await supabase.from('likes').delete().eq('user_id', user.id).eq('post_id', post.id)
        }
        setActiveLikeId(null)
      } else {
        await useCreateLike(user.id, post.id)
      }
    } catch (error) {
      console.error(error)
      setUserLiked(wasLiked)
      setLikesCount((count) => Math.max(0, count + (wasLiked ? 1 : -1)))
      patchUp({ is_liked: wasLiked, like_count: likesCount })
      showToast(wasLiked ? 'Could not remove your like' : 'Could not like this video', 'error')
    } finally {
      setIsLikeLoading(false)
    }
  }, [activeLikeId, isLikeLoading, likesCount, patchUp, post.id, setIsLoginOpen, user?.id, userLiked])

  const toggleSave = useCallback(async () => {
    if (!user?.id) {
      setIsLoginOpen(true)
      return
    }
    if (isSaveLoading) return

    setIsSaveLoading(true)
    const wasSaved = userSaved
    setUserSaved(!wasSaved)
    setSavesCount((c) => Math.max(0, c + (wasSaved ? -1 : 1)))
    patchUp({ is_saved: !wasSaved, save_count: Math.max(0, savesCount + (wasSaved ? -1 : 1)) })

    try {
      if (wasSaved) {
        if (saveId) {
          await deleteInteraction('save', saveId)
        } else {
          const { supabase } = await import('@/libs/supabase')
          await supabase.from('saves').delete().eq('user_id', user.id).eq('post_id', post.id)
        }
        setSaveId(null)
      } else {
        const id = await createInteraction('save', user.id, post.id)
        setSaveId(id)
      }
    } catch (error) {
      console.error(error)
      setUserSaved(wasSaved)
      setSavesCount((c) => Math.max(0, c + (wasSaved ? 1 : -1)))
      patchUp({ is_saved: wasSaved, save_count: savesCount })
      showToast(wasSaved ? 'Could not remove from saved' : 'Could not save video', 'error')
    } finally {
      setIsSaveLoading(false)
    }
  }, [isSaveLoading, patchUp, post.id, saveId, savesCount, setIsLoginOpen, user?.id, userSaved])

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
    patchUp({ is_reposted: !wasReposted, repost_count: Math.max(0, repostCount + (wasReposted ? -1 : 1)) })

    try {
      if (wasReposted) {
        if (repostId) {
          await deleteInteraction('repost', repostId)
        } else {
          const { supabase } = await import('@/libs/supabase')
          await supabase.from('reposts').delete().eq('user_id', user.id).eq('post_id', post.id)
        }
        setRepostId(null)
      } else {
        const id = await createInteraction('repost', user.id, post.id)
        setRepostId(id)
      }
    } catch (error) {
      console.error(error)
      setUserReposted(wasReposted)
      setRepostCount((c) => Math.max(0, c + (wasReposted ? 1 : -1)))
      patchUp({ is_reposted: wasReposted, repost_count: repostCount })
      showToast(wasReposted ? 'Could not remove repost' : 'Could not repost video', 'error')
    } finally {
      setIsRepostLoading(false)
    }
  }, [isRepostLoading, patchUp, post.id, repostCount, repostId, setIsLoginOpen, user?.id, userReposted])

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
      await likeOrUnlike()
    }
  }, [likeOrUnlike, setIsLoginOpen, user?.id, userLiked])

  const handleMobileVideoTap = useCallback(async () => {
    const now = Date.now()

    if (now - lastTapRef.current < 250) {
      lastTapRef.current = 0
      await handleDoubleTapLike()
      return
    }

    tapTimeoutRef.current = setTimeout(() => togglePlayPause(), 250)
    lastTapRef.current = now
  }, [handleDoubleTapLike, togglePlayPause])

  // ------------------------------------------------------------------ share

  useEffect(() => {
    setCanNativeShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function')
  }, [])

  const postUrl = () => `${window.location.origin}/post/${post.id}/${post.profile.user_id}`

  const copyPostLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(postUrl())
      recordShare(post.id)
      showToast('Link copied to clipboard')
    } catch {
      showToast('Could not copy link', 'error')
    }
    setIsShareSheetOpen(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post.id, post.profile.user_id])

  const sharePostNative = useCallback(async () => {
    try {
      await navigator.share({
        title: `@${post.profile.name} on TikTok Clone`,
        text: post.text,
        url: postUrl(),
      })
      recordShare(post.id)
      setIsShareSheetOpen(false)
    } catch {
      // Dismissed the native sheet -- not an error.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post.id, post.profile.name, post.profile.user_id, post.text])

  // --------------------------------------------------------------- comments

  /**
   * The panel is open feed-wide, but only the active card draws it. That is
   * what makes it follow the viewer from video to video instead of staying
   * stuck on the card it was opened from.
   */
  const isCommentsSheetOpen = isFeedCommentsOpen && activeFeedPostId === post.id

  const openCommentsSheet = useCallback(() => {
    if (isCommentsSheetOpen) {
      setIsFeedCommentsOpen(false)
      return
    }

    pendingCommentFocusRef.current = true
    setIsFeedCommentsOpen(true)
  }, [isCommentsSheetOpen, setIsFeedCommentsOpen])

  useEffect(() => {
    if (!isCommentsSheetOpen) return

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsFeedCommentsOpen(false)
    }
    document.addEventListener('keydown', onKey)

    return () => document.removeEventListener('keydown', onKey)
  }, [isCommentsSheetOpen, setIsFeedCommentsOpen])

  /**
   * Consumed once, on the render that opens the panel, and handed to
   * CommentThread as autoFocus. It stays a ref rather than state so that
   * scrolling to the next card with the panel already open does NOT steal
   * focus into the composer -- only the click that opened it should.
   */
  const shouldFocusComposer = isCommentsSheetOpen && pendingCommentFocusRef.current
  useEffect(() => {
    if (shouldFocusComposer) pendingCommentFocusRef.current = false
  }, [shouldFocusComposer])

  /**
   * CommentThread owns the thread and reports what it did; the card owns the
   * counter under the speech bubble and the write-back into the feed store, so
   * the number stays correct when the viewer scrolls away and back.
   *
   * The delta is not always 1: deleting a top-level comment takes its replies
   * with it via the cascade added in 0007.
   */
  const applyCommentDelta = useCallback((delta: number) => {
    setCommentsCount((count) => {
      const next = Math.max(0, count + delta)
      patchUp({ comment_count: next })
      return next
    })
  }, [patchUp])

  // ----------------------------------------------------------------- detail

  const rememberCurrentPlayback = useCallback(() => {
    if (postIsImage) return

    rememberVideoPlayback({
      postId: post.id,
      userId: post.profile.user_id,
      video: videoRef.current,
      source: 'feed',
    })
  }, [post.id, post.profile.user_id, postIsImage])

  const openPostDetail = useCallback(() => {
    isOpeningPostDetailRef.current = true
    rememberCurrentPlayback()
    feedWatchSession.flush()
    pauseVideosDuringNavigation()
    router.push(`/post/${post.id}/${post.profile.user_id}`)
  }, [post.id, post.profile.user_id, rememberCurrentPlayback, router])

  // ------------------------------------------------------------------ render

  const railButton =
    'flex flex-col items-center gap-1 text-xs font-semibold text-white md:text-ink'
  const railIcon =
    'inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/35 backdrop-blur-sm transition-transform active:scale-90 md:h-12 md:w-12 md:bg-surface-subtle md:backdrop-blur-none'

  return (
    <div
      ref={postMainRef}
      data-feed-index={feedIndex}
      className="snap-start h-[100dvh] md:flex md:h-[calc(100vh-60px)] md:items-center md:justify-center"
    >
      {/*
        Every card makes room for the drawer, not just the active one: the panel
        stays put while the feed scrolls under it, so a card that shifted only
        once it became active would slide sideways mid-scroll.
      */}
      <div
        className={`flex h-full w-full md:h-auto md:w-auto md:items-end md:gap-3 md:py-4 ${
          isFeedCommentsOpen ? 'md:lg:pr-[420px]' : ''
        }`}
      >
        {/* Media card. Full-bleed on mobile, a 9:16 rounded card on desktop. */}
        <div
          className="relative h-full w-full overflow-hidden bg-black md:h-[calc(100vh-92px)] md:w-auto md:rounded-2xl"
          style={{ aspectRatio: undefined }}
        >
          <div className="relative h-full w-full md:aspect-[9/16]">
            {postIsImage ? (
              <div className="relative h-full w-full" onDoubleClick={handleDoubleTapLike}>
                <ImageSlideshow
                  imageIds={postImageIds}
                  audioId={postAudioId}
                  muted={!isSoundEnabled}
                  volume={volume}
                  speed={speed}
                  autoPlay={isMediaActive}
                  onCycleComplete={() => onVideoEnded(post.id)}
                  className="h-full w-full"
                  altPrefix={`${post.profile.name} image`}
                />
              </div>
            ) : (
              <>
                {/*
                  A <video> is interactive, so it must not live inside a
                  <button> the way it used to -- that is invalid HTML and gave
                  screen readers a control with a static "Toggle video" label.
                */}
                <video
                  ref={videoRef}
                  id={`video-${post.id}`}
                  loop={!isAutoScrollEnabled}
                  playsInline
                  muted={!isSoundEnabled}
                  preload={videoPreloadMode}
                  poster={posterUrl}
                  className="h-full w-full cursor-pointer object-cover"
                  src={mediaUrl}
                  onEnded={() => {
                    feedWatchSession.complete(post.id)
                    onVideoEnded(post.id)
                  }}
                  onTimeUpdate={handleVideoProgress}
                  // A fresh src resets playbackRate to defaultPlaybackRate in
                  // several browsers, which silently dropped the chosen speed.
                  onLoadedMetadata={applyPreferences}
                  onPlay={() => {
                    pauseOtherVideos(videoRef.current)
                    setIsVideoPaused(false)
                  }}
                  onPause={() => setIsVideoPaused(true)}
                  onError={() => setMediaFailed(true)}
                  onClick={handleMobileVideoTap}
                  onDoubleClick={handleDoubleTapLike}
                >
                  {captionTrackUrl ? (
                    <track kind="captions" srcLang="en" label="Captions" src={captionTrackUrl} default />
                  ) : null}
                </video>

                {mediaFailed ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-black px-8 text-center text-sm text-white/80">
                    This video could not be loaded.
                  </div>
                ) : null}

                {isVideoPaused && !mediaFailed ? (
                  <button
                    onClick={togglePlayPause}
                    aria-label="Play video"
                    className="absolute left-1/2 top-1/2 z-20 inline-flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm"
                  >
                    <BsFillPlayFill size={30} />
                  </button>
                ) : null}
              </>
            )}

            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />

            {showHeartBurst ? (
              <AiFillHeart className="heart-pop pointer-events-none absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 text-[96px] text-white/95 md:text-[110px]" />
            ) : null}

            {!postIsImage || hasImageAudio ? (
              <VolumeControl
                isSoundEnabled={isSoundEnabled}
                volume={volume}
                onUnmute={postIsImage ? undefined : resumeAfterUnmute}
                className="absolute left-4 top-[calc(env(safe-area-inset-top)+16px)] md:left-3 md:top-3"
              />
            ) : null}

            <VideoOptionsMenu
              isAutoScrollEnabled={isAutoScrollEnabled}
              onAutoScrollChange={onAutoScrollChange}
              postId={post.id}
              postUserId={post.profile.user_id}
              onGoToPost={openPostDetail}
              onNotInterested={onRemove}
              mediaKind={postIsImage ? 'image' : 'video'}
              qualityLabel={resolutionLabel(post.width, post.height)}
              isFloatingPlayerSupported={isFloatingPlayerSupported}
              isFloatingPlayerActive={isFloatingPlayerActive}
              onToggleFloatingPlayer={toggleFloatingPlayer}
              captionsState={captionsState}
              isCaptionsEnabled={isCaptionsEnabled}
              onCaptionsChange={setVideoCaptionsEnabled}
              onOpenChange={(menuIsOpen) => {
                if (menuIsOpen) void loadCaptions()
              }}
              className="absolute right-4 top-[calc(env(safe-area-inset-top)+16px)] md:right-3 md:top-3"
            />

            {/* Caption block */}
            <div className="absolute inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+74px)] z-20 px-4 text-white md:bottom-0 md:p-5">
              <div className="mb-2 flex items-center gap-2">
                <img
                  className="h-10 w-10 rounded-full border border-white/70 object-cover md:hidden"
                  src={createBucketUrl(post.profile.image)}
                  alt=""
                />
                <Link
                  href={`/profile/${post.profile.user_id}`}
                  className="font-semibold md:text-[17px] md:font-bold md:hover:underline"
                >
                  @{post.profile.name}
                </Link>
                {user?.id !== post.profile.user_id ? (
                  <button
                    onClick={toggleFollow}
                    aria-pressed={Boolean(followId)}
                    className={`rounded-md border px-3 py-1.5 text-sm font-semibold md:py-1 md:text-[13px] ${
                      followId
                        ? 'border-white/70 bg-white/15 text-white'
                        : 'border-white bg-white text-black'
                    }`}
                  >
                    {followId ? 'Following' : 'Follow'}
                  </button>
                ) : null}
              </div>

              <p className="max-w-[72%] text-[14px] leading-5 text-white/95 md:line-clamp-2 md:max-w-[86%]">
                <CaptionText text={post.text} />
              </p>

              <div className="mt-2 flex items-center gap-3 text-[13px] font-medium text-white/90">
                <span className="flex min-w-0 items-center">
                  <ImMusic size={14} />
                  <span className="ml-1.5 truncate">original sound - {post.profile.name}</span>
                </span>
                {post.view_count > 0 ? (
                  <span className="shrink-0 text-white/75">{formatCount(post.view_count)} views</span>
                ) : null}
              </div>
            </div>

            {/* Progress bar: a real slider, keyboard-seekable. */}
            {!postIsImage ? (
              <div
                role="slider"
                tabIndex={0}
                aria-label="Seek video"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(videoProgress)}
                aria-valuetext={`${Math.round(videoProgress)} percent`}
                className="absolute inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+56px)] z-20 flex h-6 cursor-pointer touch-none items-end outline-none focus-visible:ring-2 focus-visible:ring-white/70 md:bottom-0 md:h-5"
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId)
                  seekVideoFromPointer(event)
                }}
                onPointerMove={(event) => {
                  if (event.buttons > 0) seekVideoFromPointer(event)
                }}
                onKeyDown={seekFromKeyboard}
              >
                <div className="h-[3px] w-full bg-white/25 md:h-1">
                  <div
                    className="h-full bg-tiktok transition-[width] duration-150 ease-linear"
                    style={{ width: `${videoProgress}%` }}
                  />
                </div>
              </div>
            ) : null}
          </div>

          {/* Mobile action rail sits over the video; on desktop it moves out. */}
          <div className="absolute bottom-[calc(env(safe-area-inset-bottom)+80px)] right-3 z-20 flex w-[60px] flex-col items-center gap-3.5 md:hidden">
            <ActionRail
              post={post}
              user={user}
              followId={followId}
              userLiked={userLiked}
              userSaved={userSaved}
              userReposted={userReposted}
              likesCount={likesCount}
              commentsCount={commentsCount}
              savesCount={savesCount}
              repostCount={repostCount}
              railButton={railButton}
              railIcon={railIcon}
              onAvatar={() => router.push(`/profile/${post.profile.user_id}`)}
              onFollow={toggleFollow}
              onLike={likeOrUnlike}
              onComment={openCommentsSheet}
              onSave={toggleSave}
              onRepost={toggleRepost}
              onShare={() => setIsShareSheetOpen(true)}
            />
          </div>
        </div>

        {/* Desktop action rail, beside the card. */}
        <div className="hidden flex-col items-center gap-4 pb-3 md:flex">
          <ActionRail
            post={post}
            user={user}
            followId={followId}
            userLiked={userLiked}
            userSaved={userSaved}
            userReposted={userReposted}
            likesCount={likesCount}
            commentsCount={commentsCount}
            savesCount={savesCount}
            repostCount={repostCount}
            railButton={railButton}
            railIcon={railIcon}
            onAvatar={() => router.push(`/profile/${post.profile.user_id}`)}
            onFollow={toggleFollow}
            onLike={likeOrUnlike}
            onComment={openCommentsSheet}
            onSave={toggleSave}
            onRepost={toggleRepost}
            onShare={() => setIsShareSheetOpen(true)}
          />
        </div>
      </div>

      {/* Share sheet. Explicitly light so it stays legible over dark video. */}
      {isShareSheetOpen ? (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/45 md:items-center">
          <button onClick={() => setIsShareSheetOpen(false)} aria-label="Close share sheet" className="absolute inset-0" />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Share to"
            className="tt-sheet-up relative w-full rounded-t-2xl bg-white px-4 pt-4 text-[#161823] shadow-[0_12px_48px_rgba(0,0,0,0.4)] md:w-[400px] md:rounded-2xl md:pb-4"
          >
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold">Share to</p>
              <button onClick={() => setIsShareSheetOpen(false)} className="rounded-full bg-[#f1f1f2] p-1" aria-label="Close">
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
                className="flex w-full items-center justify-center gap-2 rounded-full border border-[#e3e3e4] px-4 py-2.5 text-sm font-semibold hover:bg-[#f1f1f2]"
              >
                <FaRegCopy size={14} />
                Copy link
              </button>
              <button
                onClick={() => setIsShareSheetOpen(false)}
                className="w-full rounded-full bg-[#f1f1f2] px-4 py-2.5 text-sm font-semibold"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/*
        ONE comments panel: a bottom sheet on mobile, a right drawer on desktop.
        It used to be two, both mounted at once, so the single commentInputRef
        landed on the hidden desktop input and the mobile keyboard never opened.
      */}
      {isCommentsSheetOpen ? (
        <div className="fixed inset-0 z-[70] flex items-end bg-black/45 md:inset-auto md:bottom-0 md:right-0 md:top-[60px] md:block md:bg-transparent">
          <button
            onClick={() => setIsFeedCommentsOpen(false)}
            aria-label="Close comments"
            className="absolute inset-0 md:hidden"
          />

          <div
            role="dialog"
            aria-modal="true"
            aria-label="Comments"
            className="relative flex w-full flex-col rounded-t-2xl bg-surface px-4 pt-4 text-ink md:h-full md:w-[420px] md:max-w-[92vw] md:rounded-none md:border-l md:border-line md:px-0 md:pt-0 md:shadow-rail"
          >
            <div className="mb-3 flex items-center justify-between md:mb-0 md:border-b md:border-line md:px-6 md:py-4">
              <p className="text-sm font-semibold md:text-[22px] md:tracking-tight">
                {commentsCount} comments
              </p>
              <button
                onClick={() => setIsFeedCommentsOpen(false)}
                className="rounded-full bg-surface-subtle p-1 md:p-2"
                aria-label="Close comments"
              >
                <IoClose size={22} />
              </button>
            </div>

            {/*
              The list, the composer, replies and comment likes come from
              CommentThread, which the post detail page renders too. This card
              keeps only the sheet/drawer chrome around it -- the two surfaces
              used to have separate copies of the list and had already drifted.
            */}
            <div className="flex max-h-[60dvh] min-h-0 flex-col md:max-h-none md:flex-1">
              <CommentThread
                postId={post.id}
                variant="sheet"
                autoFocusInput={shouldFocusComposer}
                onCountChange={applyCommentDelta}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/** Extracted so the mobile and desktop rails cannot drift apart again. */
function ActionRail(props: {
  post: PostMainCompTypes['post']
  user: { id: string } | null | undefined
  followId: string | null
  userLiked: boolean
  userSaved: boolean
  userReposted: boolean
  likesCount: number
  commentsCount: number
  savesCount: number
  repostCount: number
  railButton: string
  railIcon: string
  onAvatar: () => void
  onFollow: () => void
  onLike: () => void
  onComment: () => void
  onSave: () => void
  onRepost: () => void
  onShare: () => void
}) {
  const isOwnPost = props.user?.id === props.post.profile.user_id

  return (
    <>
      {/*
        The avatar and the follow badge are SIBLINGS, not nested. The badge used
        to be a <span onClick> inside the avatar <button>: unfocusable, unlabelled,
        and a click on it also fired the parent's navigation.
      */}
      <div className="relative mb-1 inline-flex h-12 w-12 items-center justify-center">
        <button
          onClick={props.onAvatar}
          aria-label={`Open ${props.post.profile.name}'s profile`}
          className="h-12 w-12 overflow-hidden rounded-full border-2 border-white md:border-0"
        >
          <img
            className="h-full w-full object-cover"
            src={createBucketUrl(props.post.profile.image)}
            alt=""
          />
        </button>
        {!isOwnPost ? (
          <button
            onClick={props.onFollow}
            aria-label={props.followId ? `Unfollow ${props.post.profile.name}` : `Follow ${props.post.profile.name}`}
            aria-pressed={Boolean(props.followId)}
            className={`absolute -bottom-2 left-1/2 flex h-5 w-5 -translate-x-1/2 items-center justify-center rounded-full text-[13px] leading-none text-white ${
              props.followId ? 'bg-white/40 md:bg-ink-soft' : 'bg-tiktok'
            }`}
          >
            {props.followId ? '✓' : '+'}
          </button>
        ) : null}
      </div>

      <button onClick={props.onLike} className={props.railButton} aria-pressed={props.userLiked} aria-label="Like">
        <span className={props.railIcon}>
          <AiFillHeart
            size={28}
            color={props.userLiked ? '#fe2c55' : undefined}
            className={props.userLiked ? 'tt-pop' : 'text-white md:text-ink'}
          />
        </span>
        <span className="drop-shadow-[0_1px_2px_rgba(0,0,0,0.75)] md:drop-shadow-none">
          {formatCount(props.likesCount)}
        </span>
      </button>

      <button onClick={props.onComment} className={props.railButton} aria-label="Comments">
        <span className={props.railIcon}>
          <FaCommentDots size={24} className="text-white md:text-ink" />
        </span>
        <span className="drop-shadow-[0_1px_2px_rgba(0,0,0,0.75)] md:drop-shadow-none">
          {formatCount(props.commentsCount)}
        </span>
      </button>

      <button onClick={props.onSave} className={props.railButton} aria-pressed={props.userSaved} aria-label="Save">
        <span className={props.railIcon}>
          {props.userSaved ? (
            <BsBookmarkFill size={22} color="#ffc60a" className="tt-pop" />
          ) : (
            <BsBookmark size={22} className="text-white md:text-ink" />
          )}
        </span>
        <span className="drop-shadow-[0_1px_2px_rgba(0,0,0,0.75)] md:drop-shadow-none">
          {formatCount(props.savesCount)}
        </span>
      </button>

      <button onClick={props.onRepost} className={props.railButton} aria-pressed={props.userReposted} aria-label="Repost">
        <span className={props.railIcon}>
          <AiOutlineRetweet
            size={24}
            color={props.userReposted ? '#25f4ee' : undefined}
            className={props.userReposted ? '' : 'text-white md:text-ink'}
          />
        </span>
        <span className="drop-shadow-[0_1px_2px_rgba(0,0,0,0.75)] md:drop-shadow-none">
          {formatCount(props.repostCount)}
        </span>
      </button>

      <button onClick={props.onShare} className={props.railButton} aria-label="Share">
        <span className={props.railIcon}>
          <FaShare size={22} className="text-white md:text-ink" />
        </span>
        <span className="drop-shadow-[0_1px_2px_rgba(0,0,0,0.75)] md:drop-shadow-none">
          {formatCount(props.post.share_count) || 'Share'}
        </span>
      </button>
    </>
  )
}

export default PostMain

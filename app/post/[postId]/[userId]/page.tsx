"use client"

import ClientOnly from '@/app/components/ClientOnly'
import ImageSlideshow from '@/app/components/ImageSlideshow'
import Comments from '@/app/components/post/Comments'
import CommentsHeader from '@/app/components/post/CommentsHeader'
import VideoOptionsMenu from '@/app/components/VideoOptionsMenu'
import useCreateBucketUrl from '@/app/hooks/useCreateBucketUrl'
import { useCommentStore } from '@/app/stores/comment'
import { useLikeStore } from '@/app/stores/like'
import { usePostStore } from '@/app/stores/post'
import { PostPageTypes } from '@/app/types'
import {
  getVideoAutoScrollEnabled,
  setVideoAutoScrollEnabled,
  subscribeToVideoAutoScrollPreference,
} from '@/app/utils/videoAutoScrollPreference'
import { getImagePostAudioId, getImagePostIds, isImagePost } from '@/app/utils/postMedia'
import {
  clearRememberedVideoPlayback,
  getRememberedVideoPlayback,
  pauseOtherVideos,
  pauseVideosDuringNavigation,
  type VideoPlaybackSnapshot,
} from '@/app/utils/videoPlayback'
import { getVideoSoundEnabled, setVideoSoundEnabled, subscribeToVideoSoundPreference } from '@/app/utils/videoSoundPreference'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AiOutlineClose } from 'react-icons/ai'
import { BiChevronDown, BiChevronUp } from 'react-icons/bi'

const Post = ({ params }: PostPageTypes) => {
  const { postById, postsByUser, setPostById, setPostsByUser } = usePostStore()
  const { setLikesByPost } = useLikeStore()
  const { commentsByPost, setCommentsByPost } = useCommentStore()

  const [isMobileSheetExpanded, setIsMobileSheetExpanded] = useState<boolean>(false)
  const [isSheetDragging, setIsSheetDragging] = useState<boolean>(false)
  const [sheetDragOffsetY, setSheetDragOffsetY] = useState<number>(0)
  const [isSoundEnabled, setIsSoundEnabledState] = useState<boolean>(false)
  const [isAutoScrollEnabled, setIsAutoScrollEnabled] = useState<boolean>(false)
  const [isDesktopViewport, setIsDesktopViewport] = useState<boolean | null>(null)
  const [videoAspectRatio, setVideoAspectRatio] = useState<number | null>(null)
  const sheetDragStartYRef = useRef<number | null>(null)
  const mobileVideoRef = useRef<HTMLVideoElement | null>(null)
  const desktopVideoRef = useRef<HTMLVideoElement | null>(null)
  const isAutoScrollEnabledRef = useRef<boolean>(false)
  const postsByUserRef = useRef(postsByUser)
  const currentPostIdRef = useRef<string>(params.postId)
  const lastAutoNavigatedPostRef = useRef<{ postId: string; handledAt: number } | null>(null)
  const playbackSnapshotRef = useRef<VideoPlaybackSnapshot | null>(null)

  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const shouldOpenCommentsMode = searchParams.get('comments') === '1'

  useEffect(() => {
    setPostById(params.postId)
    setCommentsByPost(params.postId)
    setLikesByPost(params.postId)
    setPostsByUser(params.userId)
  }, [params.postId, params.userId, setCommentsByPost, setLikesByPost, setPostById, setPostsByUser])

  useEffect(() => {
    if (shouldOpenCommentsMode) {
      setIsMobileSheetExpanded(true)
    }
  }, [params.postId, shouldOpenCommentsMode])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const media = window.matchMedia('(min-width: 1024px)')
    const syncViewport = () => setIsDesktopViewport(media.matches)

    syncViewport()
    media.addEventListener('change', syncViewport)

    return () => {
      media.removeEventListener('change', syncViewport)
    }
  }, [])

  const currentIndex = useMemo(
    () => postsByUser.findIndex((post) => post.id === params.postId),
    [params.postId, postsByUser]
  )

  const pauseCurrentVideos = useCallback((lockDuringNavigation = false) => {
    if (lockDuringNavigation) {
      pauseVideosDuringNavigation()
    }

    mobileVideoRef.current?.pause()
    desktopVideoRef.current?.pause()
  }, [])

  const syncSoundState = useCallback((enabled: boolean) => {
    setIsSoundEnabledState(enabled)

    if (mobileVideoRef.current) {
      mobileVideoRef.current.muted = !enabled
    }

    if (desktopVideoRef.current) {
      desktopVideoRef.current.muted = !enabled
    }
  }, [])

  const getActiveVideo = useCallback(() => {
    if (isDesktopViewport === null) {
      return desktopVideoRef.current || mobileVideoRef.current
    }

    return isDesktopViewport ? desktopVideoRef.current : mobileVideoRef.current
  }, [isDesktopViewport])

  const enableSound = () => {
    setVideoSoundEnabled(true)
    syncSoundState(true)
    const activeVideo = getActiveVideo()
    activeVideo?.play().catch(() => null)
  }

  const playDetailVideo = useCallback((video: HTMLVideoElement | null) => {
    if (!video) {
      return
    }

    pauseOtherVideos(video)

    video.play().catch(() => {
      if (!video.muted) {
        setVideoSoundEnabled(false)
        syncSoundState(false)
        video.muted = true
        video.play().catch(() => null)
      }
    })
  }, [syncSoundState])

  const initializeDetailVideo = useCallback((video: HTMLVideoElement | null) => {
    if (!video) {
      return
    }

    if (video.videoWidth > 0 && video.videoHeight > 0) {
      setVideoAspectRatio(video.videoWidth / video.videoHeight)
    }

    const snapshot = playbackSnapshotRef.current
    if (snapshot?.currentTime) {
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : snapshot.duration
      const latestSafeTime = duration ? Math.max(duration - 0.2, 0) : snapshot.currentTime
      try {
        video.currentTime = Math.min(snapshot.currentTime, latestSafeTime)
      } catch {
        // Some remote streams delay seeking until more data is buffered.
      }
      playbackSnapshotRef.current = null
      clearRememberedVideoPlayback(params.postId)
    }

    playDetailVideo(video)
  }, [params.postId, playDetailVideo])

  const loopThroughPostsUp = () => {
    if (currentIndex <= 0) {
      return
    }

    pauseCurrentVideos(true)
    const nextPost = postsByUser[currentIndex - 1]
    router.push(`/post/${nextPost.id}/${params.userId}`)
  }

  const loopThroughPostsDown = () => {
    if (currentIndex === -1 || currentIndex >= postsByUser.length - 1) {
      return
    }

    pauseCurrentVideos(true)
    const prevPost = postsByUser[currentIndex + 1]
    router.push(`/post/${prevPost.id}/${params.userId}`)
  }

  const handleAutoScrollChange = (enabled: boolean) => {
    isAutoScrollEnabledRef.current = enabled
    setVideoAutoScrollEnabled(enabled)
  }

  const handleVideoEnded = () => {
    if (!isAutoScrollEnabledRef.current) {
      return
    }

    const currentPostId = currentPostIdRef.current
    const lastAutoNavigatedPost = lastAutoNavigatedPostRef.current
    if (lastAutoNavigatedPost?.postId === currentPostId && Date.now() - lastAutoNavigatedPost.handledAt < 1000) {
      return
    }

    const posts = postsByUserRef.current
    const activeIndex = posts.findIndex((post) => post.id === currentPostId)
    if (activeIndex === -1 || activeIndex >= posts.length - 1) {
      return
    }

    pauseCurrentVideos(true)
    lastAutoNavigatedPostRef.current = { postId: currentPostId, handledAt: Date.now() }

    const nextPost = posts[activeIndex + 1]
    router.push(`/post/${nextPost.id}/${nextPost.user_id || params.userId}`)
  }

  const closePostDetail = useCallback(() => {
    pauseCurrentVideos(true)
    router.push(`/profile/${params.userId}`)
  }, [params.userId, pauseCurrentVideos, router])

  useEffect(() => {
    const enabled = getVideoAutoScrollEnabled()
    isAutoScrollEnabledRef.current = enabled
    setIsAutoScrollEnabled(enabled)

    return subscribeToVideoAutoScrollPreference((enabled) => {
      isAutoScrollEnabledRef.current = enabled
      setIsAutoScrollEnabled(enabled)
    })
  }, [])

  useEffect(() => {
    if (postsByUser.length > 0) {
      postsByUserRef.current = postsByUser
    }
  }, [postsByUser])

  useEffect(() => {
    currentPostIdRef.current = params.postId
    playbackSnapshotRef.current = getRememberedVideoPlayback(params.postId)
    setVideoAspectRatio(null)
  }, [params.postId])

  useEffect(() => {
    syncSoundState(getVideoSoundEnabled())

    return subscribeToVideoSoundPreference((enabled) => {
      syncSoundState(enabled)
    })
  }, [syncSoundState])

  useEffect(() => {
    return () => {
      pauseCurrentVideos(true)
    }
  }, [pathname, pauseCurrentVideos])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const pauseBeforeDocumentExit = () => {
      pauseCurrentVideos(true)
    }

    window.addEventListener('pagehide', pauseBeforeDocumentExit)
    window.addEventListener('beforeunload', pauseBeforeDocumentExit)

    return () => {
      window.removeEventListener('pagehide', pauseBeforeDocumentExit)
      window.removeEventListener('beforeunload', pauseBeforeDocumentExit)
    }
  }, [pauseCurrentVideos])

  const onSheetDragStart = (clientY: number) => {
    sheetDragStartYRef.current = clientY
    setIsSheetDragging(true)
    setSheetDragOffsetY(0)
  }

  const onSheetDragMove = (clientY: number) => {
    if (sheetDragStartYRef.current === null) {
      return
    }

    const deltaY = clientY - sheetDragStartYRef.current
    setSheetDragOffsetY(deltaY)
  }

  const onSheetDragEnd = () => {
    if (sheetDragStartYRef.current === null) {
      return
    }

    if (sheetDragOffsetY > 55) {
      setIsMobileSheetExpanded(false)
    } else if (sheetDragOffsetY < -55) {
      setIsMobileSheetExpanded(true)
    }

    sheetDragStartYRef.current = null
    setIsSheetDragging(false)
    setSheetDragOffsetY(0)
  }

  const desktopVideoClassName = videoAspectRatio !== null && videoAspectRatio < 1
    ? 'h-full max-h-[calc(100dvh-64px)] w-auto max-w-full rounded-sm object-contain'
    : 'h-auto max-h-[calc(100dvh-64px)] w-full max-w-[1120px] rounded-sm object-contain'
  const desktopVideoStyle = videoAspectRatio ? { aspectRatio: String(videoAspectRatio) } : undefined
  const postIsImage = isImagePost(postById?.video_url)
  const postImageIds = getImagePostIds(postById?.video_url)
  const postAudioId = getImagePostAudioId(postById?.video_url)
  const hasImageAudio = postIsImage && Boolean(postAudioId)

  return (
    <>
      <div id="PostPage" className="h-[100dvh] w-full overflow-hidden bg-black">
        <div className="relative h-full w-full lg:hidden">
          <ClientOnly>
            <div className="h-full w-full bg-black">
              {isDesktopViewport === false && postById?.video_url ? (
                postIsImage ? (
                  <ImageSlideshow
                    key={postById.video_url}
                    imageIds={postImageIds}
                    audioId={postAudioId}
                    muted={!isSoundEnabled}
                    autoPlay
                    onCycleComplete={handleVideoEnded}
                    className="h-full w-full"
                    altPrefix={`${postById.profile.name} image`}
                  />
                ) : (
                  <video
                    ref={mobileVideoRef}
                    key={postById.video_url}
                    playsInline
                    preload="auto"
                    loop={!isAutoScrollEnabled}
                    muted={!isSoundEnabled}
                    onEnded={handleVideoEnded}
                    onLoadedMetadata={() => initializeDetailVideo(mobileVideoRef.current)}
                    onPlay={() => pauseOtherVideos(mobileVideoRef.current)}
                    className="h-full w-full object-contain"
                    src={useCreateBucketUrl(postById.video_url)}
                  />
                )
              ) : (
                <div className="h-full bg-black flex items-center justify-center">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white" />
                </div>
              )}
            </div>
          </ClientOnly>

          {(!postIsImage || hasImageAudio) && !isSoundEnabled ? (
            <button
              onClick={() => enableSound()}
              className="absolute right-4 top-[calc(env(safe-area-inset-top)+12px)] z-30 rounded-full bg-black/60 px-3 py-1.5 text-xs font-semibold text-white"
            >
              Tap for sound
            </button>
          ) : null}

          <VideoOptionsMenu
            isAutoScrollEnabled={isAutoScrollEnabled}
            onAutoScrollChange={handleAutoScrollChange}
            className="absolute right-4 top-[calc(env(safe-area-inset-top)+54px)]"
          />

          <button
            onClick={closePostDetail}
            className="absolute z-30 left-4 top-[calc(env(safe-area-inset-top)+12px)] text-white rounded-full bg-gray-700/90 p-1.5 hover:bg-gray-800"
          >
            <AiOutlineClose size="27" />
          </button>

          <img
            className="absolute z-30 top-[18px] left-[64px] rounded-full"
            width="45"
            src="/images/tiktok-logo-small.png"
            alt="TikTok"
          />

          <div>
            {currentIndex > 0 && (
              <button
                onClick={loopThroughPostsUp}
                className="absolute z-30 right-3 top-[46%] flex items-center justify-center rounded-full bg-gray-700/90 p-2 hover:bg-gray-800"
              >
                <BiChevronUp size="26" color="#FFFFFF" />
              </button>
            )}

            {currentIndex < postsByUser.length - 1 && (
              <button
                onClick={loopThroughPostsDown}
                className="absolute z-30 right-3 top-[54%] flex items-center justify-center rounded-full bg-gray-700/90 p-2 hover:bg-gray-800"
              >
                <BiChevronDown size="26" color="#FFFFFF" />
              </button>
            )}
          </div>

          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-44 bg-gradient-to-t from-black/70 via-black/35 to-transparent" />

          <div
            className={`absolute inset-x-0 bottom-0 z-40 overflow-hidden rounded-t-3xl bg-surface text-ink transition-[height] duration-300 ${
              isMobileSheetExpanded ? 'h-[66dvh]' : 'h-[28dvh]'
            }`}
            style={{
              transform: `translateY(${isSheetDragging ? Math.max(-80, Math.min(120, sheetDragOffsetY)) : 0}px)`,
              transition: isSheetDragging ? 'none' : undefined,
            }}
          >
            <div className="relative h-full flex flex-col">
              <div
                className="flex justify-center pt-2 pb-1 cursor-grab active:cursor-grabbing"
                onTouchStart={(event) => onSheetDragStart(event.touches[0].clientY)}
                onTouchMove={(event) => onSheetDragMove(event.touches[0].clientY)}
                onTouchEnd={onSheetDragEnd}
                onMouseDown={(event) => onSheetDragStart(event.clientY)}
                onMouseMove={(event) => {
                  if (!isSheetDragging) {
                    return
                  }
                  onSheetDragMove(event.clientY)
                }}
                onMouseUp={onSheetDragEnd}
                onMouseLeave={onSheetDragEnd}
              >
                <button
                  onClick={() => setIsMobileSheetExpanded((prev) => !prev)}
                  className="h-1.5 w-14 rounded-full bg-line"
                  aria-label="Toggle details panel"
                />
              </div>

                <div className="min-h-0 flex-1 flex flex-col">
                  <div className="pt-1">
                    <ClientOnly>
                      {postById?.video_url ? <CommentsHeader post={postById} params={params} isMobileDetail /> : null}
                    </ClientOnly>
                  </div>

                  {isMobileSheetExpanded ? (
                    <div className="flex-1 min-h-0">
                      <Comments params={params} isMobileDetail autoFocusInput={shouldOpenCommentsMode} />
                    </div>
                  ) : (
                    <button
                      onClick={() => setIsMobileSheetExpanded(true)}
                      className="mx-4 mt-2 rounded-xl border border-line bg-surface-subtle py-3 text-sm font-semibold text-ink-soft"
                    >
                      View comments ({commentsByPost.length})
                    </button>
                  )}
                </div>
              </div>
            </div>
        </div>

        <div className="hidden h-full w-full overflow-hidden bg-black lg:grid lg:grid-cols-[minmax(0,1fr)_540px]">
          <div className="relative h-full min-w-0 overflow-hidden">
            <button
              onClick={closePostDetail}
              className="absolute z-20 top-5 left-5 text-white rounded-full bg-gray-700 p-1.5 hover:bg-gray-800"
            >
              <AiOutlineClose size="27" />
            </button>

            <div>
              {currentIndex > 0 && (
                <button
                  onClick={loopThroughPostsUp}
                  className="absolute z-20 right-4 top-[45%] flex items-center justify-center rounded-full bg-gray-700 p-1.5 hover:bg-gray-800"
                >
                  <BiChevronUp size="30" color="#FFFFFF" />
                </button>
              )}

              {currentIndex < postsByUser.length - 1 && (
                <button
                  onClick={loopThroughPostsDown}
                  className="absolute z-20 right-4 top-[55%] flex items-center justify-center rounded-full bg-gray-700 p-1.5 hover:bg-gray-800"
                >
                  <BiChevronDown size="30" color="#FFFFFF" />
                </button>
              )}
            </div>

            <img
              className="absolute z-20 top-[18px] left-[70px] rounded-full"
              width="45"
              src="/images/tiktok-logo-small.png"
              alt="TikTok"
            />

            <ClientOnly>
              <div className="relative z-10 flex h-full min-h-0 items-center justify-center bg-black px-6 py-8">
                <>
                  <VideoOptionsMenu
                    isAutoScrollEnabled={isAutoScrollEnabled}
                    onAutoScrollChange={handleAutoScrollChange}
                    className="absolute right-5 top-5"
                  />

                  {isDesktopViewport === true && postById?.video_url ? (
                    <>
                    {postIsImage ? (
                      <>
                      <ImageSlideshow
                        key={postById.video_url}
                        imageIds={postImageIds}
                        audioId={postAudioId}
                        muted={!isSoundEnabled}
                        autoPlay
                        onCycleComplete={handleVideoEnded}
                        className="h-full max-h-[calc(100dvh-64px)] w-full max-w-[1120px] rounded-sm"
                        imageClassName="rounded-sm"
                        altPrefix={`${postById.profile.name} image`}
                      />
                      {hasImageAudio && !isSoundEnabled ? (
                        <button
                          onClick={() => enableSound()}
                          className="absolute left-5 top-16 z-30 rounded-full bg-black/60 px-3 py-1.5 text-xs font-semibold text-white"
                        >
                          Click for sound
                        </button>
                      ) : null}
                      </>
                    ) : (
                      <>
                        <video
                          ref={desktopVideoRef}
                          key={postById.video_url}
                          controls
                          preload="auto"
                          loop={!isAutoScrollEnabled}
                          muted={!isSoundEnabled}
                          onEnded={handleVideoEnded}
                          onLoadedMetadata={() => initializeDetailVideo(desktopVideoRef.current)}
                          onPlay={() => pauseOtherVideos(desktopVideoRef.current)}
                          className={desktopVideoClassName}
                          style={desktopVideoStyle}
                          src={useCreateBucketUrl(postById.video_url)}
                        />
                        {!isSoundEnabled ? (
                          <button
                            onClick={() => enableSound()}
                            className="absolute left-5 top-16 z-30 rounded-full bg-black/60 px-3 py-1.5 text-xs font-semibold text-white"
                          >
                            Click for sound
                          </button>
                        ) : null}
                      </>
                    )}
                    </>
                  ) : (
                    <div className="h-full bg-black flex items-center justify-center">
                      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white" />
                    </div>
                  )}
                </>
              </div>
            </ClientOnly>
          </div>

          <div id="InfoSection" className="relative flex h-full min-h-0 w-full flex-col border-l border-line bg-surface">
            <div className="pt-7" />
            <div className="shrink-0">
              <ClientOnly>
                {postById?.video_url ? <CommentsHeader post={postById} params={params} /> : null}
              </ClientOnly>
            </div>
            <div className="min-h-0 flex-1">
              <Comments params={params} autoFocusInput={shouldOpenCommentsMode} />
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

export default Post

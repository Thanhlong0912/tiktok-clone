"use client"

import ClientOnly from '@/app/components/ClientOnly'
import Comments from '@/app/components/post/Comments'
import CommentsHeader from '@/app/components/post/CommentsHeader'
import useCreateBucketUrl from '@/app/hooks/useCreateBucketUrl'
import { useCommentStore } from '@/app/stores/comment'
import { useLikeStore } from '@/app/stores/like'
import { usePostStore } from '@/app/stores/post'
import { PostPageTypes } from '@/app/types'
import { pauseOtherVideos } from '@/app/utils/videoPlayback'
import { getVideoSoundEnabled, setVideoSoundEnabled, subscribeToVideoSoundPreference } from '@/app/utils/videoSoundPreference'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
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
  const sheetDragStartYRef = useRef<number | null>(null)
  const mobileVideoRef = useRef<HTMLVideoElement | null>(null)
  const desktopVideoRef = useRef<HTMLVideoElement | null>(null)

  const router = useRouter()
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

  const currentIndex = useMemo(
    () => postsByUser.findIndex((post) => post.id === params.postId),
    [params.postId, postsByUser]
  )

  const pauseCurrentVideos = () => {
    mobileVideoRef.current?.pause()
    desktopVideoRef.current?.pause()
  }

  const syncSoundState = (enabled: boolean) => {
    setIsSoundEnabledState(enabled)

    if (mobileVideoRef.current) {
      mobileVideoRef.current.muted = !enabled
    }

    if (desktopVideoRef.current) {
      desktopVideoRef.current.muted = !enabled
    }
  }

  const enableSound = () => {
    setVideoSoundEnabled(true)
    syncSoundState(true)
    const isDesktopViewport = typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches
    const activeVideo = isDesktopViewport ? desktopVideoRef.current : mobileVideoRef.current
    activeVideo?.play().catch(() => null)
  }

  const loopThroughPostsUp = () => {
    if (currentIndex <= 0) {
      return
    }

    pauseCurrentVideos()
    const nextPost = postsByUser[currentIndex - 1]
    router.push(`/post/${nextPost.id}/${params.userId}`)
  }

  const loopThroughPostsDown = () => {
    if (currentIndex === -1 || currentIndex >= postsByUser.length - 1) {
      return
    }

    pauseCurrentVideos()
    const prevPost = postsByUser[currentIndex + 1]
    router.push(`/post/${prevPost.id}/${params.userId}`)
  }

  useEffect(() => {
    syncSoundState(getVideoSoundEnabled())

    return subscribeToVideoSoundPreference((enabled) => {
      syncSoundState(enabled)
    })
  }, [])

  useEffect(() => {
    return () => {
      pauseCurrentVideos()
    }
  }, [])

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

  return (
    <>
      <div id="PostPage" className="w-full h-[100dvh] bg-black overflow-hidden">
        <div className="relative h-full w-full lg:hidden">
          <ClientOnly>
            <div className="h-full w-full bg-black">
              {postById?.video_url ? (
                <video
                  ref={mobileVideoRef}
                  key={postById.video_url}
                  autoPlay
                  playsInline
                  loop
                  muted={!isSoundEnabled}
                  onPlay={() => pauseOtherVideos(mobileVideoRef.current)}
                  className="h-full w-full object-cover"
                  src={useCreateBucketUrl(postById.video_url)}
                />
              ) : (
                <div className="h-full bg-black flex items-center justify-center">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white" />
                </div>
              )}
            </div>
          </ClientOnly>

          {!isSoundEnabled ? (
            <button
              onClick={() => enableSound()}
              className="absolute right-4 top-[calc(env(safe-area-inset-top)+12px)] z-30 rounded-full bg-black/60 px-3 py-1.5 text-xs font-semibold text-white"
            >
              Tap for sound
            </button>
          ) : null}

          <button
            onClick={() => {
              router.push(`/profile/${params.userId}`)
            }}
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
            className={`absolute inset-x-0 bottom-0 z-40 rounded-t-3xl bg-white dark:bg-dark overflow-hidden transition-[height] duration-300 ${
              isMobileSheetExpanded ? 'h-[64dvh]' : 'h-[24dvh]'
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
                  className="h-1.5 w-14 rounded-full bg-gray-300 dark:bg-gray-600"
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
                      className="mx-4 mt-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#1A1A1A] py-3 text-sm font-semibold text-gray-700 dark:text-gray-200"
                    >
                      View comments ({commentsByPost.length})
                    </button>
                  )}
                </div>
              </div>
            </div>
        </div>

        <div className="hidden lg:flex justify-between w-full h-full bg-black overflow-auto">
          <div className="lg:w-[calc(100%-540px)] h-full relative">
            <button
              onClick={() => {
                router.push(`/profile/${params.userId}`)
              }}
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
              <div className="bg-black lg:min-w-[480px] z-10 relative h-full">
                {postById?.video_url ? (
                  <>
                    <video
                      ref={desktopVideoRef}
                      key={postById.video_url}
                      autoPlay
                      controls
                      loop
                      muted={!isSoundEnabled}
                      onPlay={() => pauseOtherVideos(desktopVideoRef.current)}
                      className="h-full mx-auto object-contain"
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
                ) : (
                  <div className="h-full bg-black flex items-center justify-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white" />
                  </div>
                )}
              </div>
            </ClientOnly>
          </div>

          <div id="InfoSection" className="max-w-[550px] relative w-full h-full bg-white dark:bg-dark">
            <div className="py-7" />

            <ClientOnly>
              {postById?.video_url ? <CommentsHeader post={postById} params={params} /> : null}
            </ClientOnly>
            <Comments params={params} autoFocusInput={shouldOpenCommentsMode} />
          </div>
        </div>
      </div>
    </>
  )
}

export default Post

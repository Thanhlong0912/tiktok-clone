"use client"

import { useUser } from "@/app/context/user"
import useGetFollowing from "@/app/hooks/useGetFollowing"
import { useGeneralStore } from "@/app/stores/general"
import { usePostStore } from "@/app/stores/post"
import { useRouter } from "next/navigation"
import { TouchEvent, UIEvent, useCallback, useEffect, useMemo, useRef, useState } from "react"
import ClientOnly from "./components/ClientOnly"
import PostMain from "./components/PostMain"
import MainLayout from "./layouts/MainLayout"
import { AiOutlineHome } from "react-icons/ai"
import { BiMessageMinus } from "react-icons/bi"
import { IoAdd, IoCompassOutline, IoPersonOutline } from "react-icons/io5"
import {
  getVideoAutoScrollEnabled,
  setVideoAutoScrollEnabled,
  subscribeToVideoAutoScrollPreference,
} from "./utils/videoAutoScrollPreference"

export default function Home() {
  type MobileFeedTab = 'for-you' | 'following'
  const MOBILE_WINDOW_RADIUS = 2
  const router = useRouter()
  const { user } = useUser() || {}
  const { setIsLoginOpen } = useGeneralStore()
  const [mobileFeedTab, setMobileFeedTab] = useState<MobileFeedTab>('for-you')
  const [followingUserIds, setFollowingUserIds] = useState<string[]>([])
  const [isMobileViewport, setIsMobileViewport] = useState<boolean>(false)
  const [mobileViewportHeight, setMobileViewportHeight] = useState<number>(0)
  const [mobileVisibleIndex, setMobileVisibleIndex] = useState<number>(0)
  const [isAutoScrollEnabled, setIsAutoScrollEnabled] = useState<boolean>(false)
  const touchStartXRef = useRef<number | null>(null)
  const touchStartYRef = useRef<number | null>(null)
  const autoScrollLockRef = useRef<boolean>(false)
  const autoScrollUnlockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const feedContainerRef = useRef<HTMLDivElement | null>(null)
  const lastTabRef = useRef<MobileFeedTab>('for-you')
  const pendingTabRestoreRef = useRef<boolean>(false)
  const tabScrollMemoryRef = useRef<Record<MobileFeedTab, { scrollTop: number; visibleIndex: number }>>({
    'for-you': { scrollTop: 0, visibleIndex: 0 },
    'following': { scrollTop: 0, visibleIndex: 0 },
  })
  let { allPosts, setAllPosts } = usePostStore();

  useEffect(() => { setAllPosts()}, [])

  useEffect(() => {
    const hydrateFollowing = async () => {
      if (!user?.id) {
        setFollowingUserIds([])
        return
      }

      try {
        const followingDocs = await useGetFollowing(user.id)
        const ids = (followingDocs || []).map((doc) => doc?.to_user_id).filter(Boolean)
        setFollowingUserIds(ids)
      } catch (error) {
        console.error(error)
        setFollowingUserIds([])
      }
    }

    hydrateFollowing()
  }, [user?.id])

  const displayedPosts = useMemo(() => {
    if (mobileFeedTab === 'for-you') {
      return allPosts
    }

    if (!user?.id) {
      return []
    }

    return allPosts.filter((post) => followingUserIds.includes(post.user_id))
  }, [allPosts, followingUserIds, mobileFeedTab, user?.id])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const media = window.matchMedia('(max-width: 767px)')
    const syncViewport = () => {
      setIsMobileViewport(media.matches)
      setMobileViewportHeight(window.innerHeight)
    }

    syncViewport()
    media.addEventListener('change', syncViewport)
    window.addEventListener('resize', syncViewport)

    return () => {
      media.removeEventListener('change', syncViewport)
      window.removeEventListener('resize', syncViewport)
    }
  }, [])

  useEffect(() => {
    setIsAutoScrollEnabled(getVideoAutoScrollEnabled())

    return subscribeToVideoAutoScrollPreference((enabled) => {
      setIsAutoScrollEnabled(enabled)
    })
  }, [])

  const saveTabPosition = useCallback((tab: MobileFeedTab) => {
    const feedElement = feedContainerRef.current

    if (!feedElement) {
      return
    }

    tabScrollMemoryRef.current[tab] = {
      scrollTop: feedElement.scrollTop,
      visibleIndex: mobileVisibleIndex,
    }
  }, [mobileVisibleIndex])

  useEffect(() => {
    const previousTab = lastTabRef.current

    if (previousTab !== mobileFeedTab) {
      saveTabPosition(previousTab)
      pendingTabRestoreRef.current = true
      lastTabRef.current = mobileFeedTab
    }
  }, [mobileFeedTab, saveTabPosition])

  useEffect(() => {
    setMobileVisibleIndex((prev) => Math.min(prev, Math.max(displayedPosts.length - 1, 0)))
  }, [displayedPosts.length])

  const shouldVirtualize = isMobileViewport && displayedPosts.length > 6 && mobileViewportHeight > 0
  const virtualStartIndex = shouldVirtualize ? Math.max(0, mobileVisibleIndex - MOBILE_WINDOW_RADIUS) : 0
  const virtualEndIndex = shouldVirtualize
    ? Math.min(displayedPosts.length - 1, mobileVisibleIndex + MOBILE_WINDOW_RADIUS)
    : Math.max(displayedPosts.length - 1, 0)
  const virtualizedPosts = shouldVirtualize
    ? displayedPosts.slice(virtualStartIndex, virtualEndIndex + 1)
    : displayedPosts
  const topSpacerHeight = shouldVirtualize ? virtualStartIndex * mobileViewportHeight : 0
  const bottomSpacerHeight = shouldVirtualize
    ? Math.max(displayedPosts.length - virtualEndIndex - 1, 0) * mobileViewportHeight
    : 0

  useEffect(() => {
    if (!pendingTabRestoreRef.current) {
      return
    }

    const feedElement = feedContainerRef.current

    if (!feedElement) {
      return
    }

    const { scrollTop, visibleIndex } = tabScrollMemoryRef.current[mobileFeedTab]
    requestAnimationFrame(() => {
      feedElement.scrollTo({ top: scrollTop, behavior: 'auto' })
      setMobileVisibleIndex(visibleIndex)
    })
    pendingTabRestoreRef.current = false
  }, [displayedPosts.length, mobileFeedTab])

  useEffect(() => {
    return () => {
      saveTabPosition(lastTabRef.current)
      if (autoScrollUnlockTimerRef.current) {
        clearTimeout(autoScrollUnlockTimerRef.current)
      }
    }
  }, [saveTabPosition])

  const switchToForYou = () => setMobileFeedTab('for-you')
  const switchToFollowing = () => {
    if (!user?.id) {
      setIsLoginOpen(true)
      return
    }
    setMobileFeedTab('following')
  }

  const handleTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    touchStartXRef.current = event.touches[0].clientX
    touchStartYRef.current = event.touches[0].clientY
  }

  const handleTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    if (touchStartXRef.current === null || touchStartYRef.current === null) {
      return
    }

    const deltaX = event.changedTouches[0].clientX - touchStartXRef.current
    const deltaY = event.changedTouches[0].clientY - touchStartYRef.current

    touchStartXRef.current = null
    touchStartYRef.current = null

    if (Math.abs(deltaX) < 60 || Math.abs(deltaX) < Math.abs(deltaY)) {
      return
    }

    if (deltaX > 0) {
      switchToFollowing()
      return
    }

    switchToForYou()
  }

  const handleFeedScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    if (!shouldVirtualize) {
      return
    }

    const container = event.currentTarget
    const height = mobileViewportHeight || container.clientHeight
    if (!height) {
      return
    }

    const nextIndex = Math.round(container.scrollTop / height)
    setMobileVisibleIndex((prev) => (prev === nextIndex ? prev : nextIndex))
  }, [mobileViewportHeight, shouldVirtualize])

  const handleAutoScrollChange = useCallback((enabled: boolean) => {
    setVideoAutoScrollEnabled(enabled)
  }, [])

  const handleVideoEnded = useCallback((postId: string) => {
    if (!isAutoScrollEnabled || !isMobileViewport || autoScrollLockRef.current) {
      return
    }

    const currentIndex = displayedPosts.findIndex((post) => post.id === postId)
    if (currentIndex < 0) {
      return
    }

    const nextIndex = currentIndex + 1
    if (nextIndex >= displayedPosts.length) {
      return
    }

    const feedElement = feedContainerRef.current
    if (!feedElement) {
      return
    }

    const viewportHeight = mobileViewportHeight || feedElement.clientHeight
    if (!viewportHeight) {
      return
    }

    autoScrollLockRef.current = true
    if (autoScrollUnlockTimerRef.current) {
      clearTimeout(autoScrollUnlockTimerRef.current)
    }

    setMobileVisibleIndex(nextIndex)
    feedElement.scrollTo({
      top: nextIndex * viewportHeight,
      behavior: 'smooth',
    })

    autoScrollUnlockTimerRef.current = setTimeout(() => {
      autoScrollLockRef.current = false
    }, 650)
  }, [displayedPosts, isAutoScrollEnabled, isMobileViewport, mobileViewportHeight])

  return (
    <>
      <MainLayout>
        <div className="fixed inset-x-0 top-0 z-30 flex items-center justify-center md:hidden px-6 pb-3 pt-[calc(env(safe-area-inset-top)+8px)] text-white">
          <div className="flex items-center gap-5 text-[17px] font-semibold drop-shadow-[0_1px_2px_rgba(0,0,0,0.55)]">
            <button onClick={switchToFollowing} className={`relative transition-opacity ${mobileFeedTab === 'following' ? 'opacity-100' : 'opacity-70'}`}>
              Following
              {mobileFeedTab === 'following' ? (
                <span className="absolute left-1/2 top-7 h-[3px] w-9 -translate-x-1/2 rounded-full bg-white" />
              ) : null}
            </button>
            <button onClick={switchToForYou} className="relative">
              For You
              {mobileFeedTab === 'for-you' ? (
                <span className="absolute left-1/2 top-7 h-[3px] w-9 -translate-x-1/2 rounded-full bg-white" />
              ) : null}
            </button>
          </div>
        </div>

        <div className="fixed inset-x-0 bottom-0 z-30 md:hidden border-t border-white/20 bg-black/80 px-3 pb-[calc(env(safe-area-inset-bottom)+8px)] pt-2 text-white backdrop-blur-sm">
          <div className="grid grid-cols-5 items-end text-center">
            <button className="flex flex-col items-center gap-0.5 text-[11px] font-semibold">
              <AiOutlineHome size={21} />
              <span>Home</span>
            </button>
            <button
              onClick={() => router.push('/')}
              className="flex flex-col items-center gap-0.5 text-[11px] opacity-80"
            >
              <IoCompassOutline size={21} />
              <span>Discover</span>
            </button>
            <button
              onClick={() => {
                if (!user?.id) {
                  setIsLoginOpen(true)
                  return
                }
                router.push('/upload')
              }}
              className="flex justify-center pb-1"
            >
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/30 bg-white text-black">
                <IoAdd size={18} />
              </span>
            </button>
            <button
              onClick={() => {
                if (!user?.id) {
                  setIsLoginOpen(true)
                  return
                }
                router.push(`/profile/${user.id}`)
              }}
              className="flex flex-col items-center gap-0.5 text-[11px] opacity-80"
            >
              <BiMessageMinus size={21} />
              <span>Inbox</span>
            </button>
            <button
              onClick={() => {
                if (!user?.id) {
                  setIsLoginOpen(true)
                  return
                }
                router.push(`/profile/${user.id}`)
              }}
              className="flex flex-col items-center gap-0.5 text-[11px] opacity-80"
            >
              <IoPersonOutline size={21} />
              <span>Profile</span>
            </button>
          </div>
        </div>

        <div
          ref={feedContainerRef}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onScroll={handleFeedScroll}
          className="w-full h-[100dvh] overflow-y-scroll snap-y snap-mandatory scroll-smooth no-scrollbar md:mt-[60px] md:ml-auto md:h-[calc(100vh-60px)] md:max-w-[690px]"
        >
          <ClientOnly>
            {displayedPosts.length < 1 ? (
              <div className="flex h-[100dvh] snap-start items-center justify-center bg-black px-8 text-center text-white md:h-[calc(100vh-60px)] md:bg-transparent md:text-black dark:md:text-white">
                {mobileFeedTab === 'following' ? (
                  <div>
                    <p className="text-lg font-semibold">No posts from followed creators yet.</p>
                    <p className="mt-2 text-sm text-white/80 md:text-gray-500">Switch to For You to discover more videos.</p>
                  </div>
                ) : (
                  <p className="text-lg font-semibold">No posts available yet.</p>
                )}
              </div>
            ) : (
              <>
                {shouldVirtualize && topSpacerHeight > 0 ? (
                  <div aria-hidden="true" style={{ height: `${topSpacerHeight}px` }} />
                ) : null}

                {virtualizedPosts.map((post, index) => (
                  <PostMain
                    post={post}
                    key={`${post.id}-${virtualStartIndex + index}`}
                    isAutoScrollEnabled={isAutoScrollEnabled}
                    onVideoEnded={handleVideoEnded}
                    onAutoScrollChange={handleAutoScrollChange}
                  />
                ))}

                {shouldVirtualize && bottomSpacerHeight > 0 ? (
                  <div aria-hidden="true" style={{ height: `${bottomSpacerHeight}px` }} />
                ) : null}
              </>
            )}
          </ClientOnly>
        </div>
      </MainLayout>
    </>
  )
}

"use client"

import { useUser } from "@/app/context/user"
import { useGeneralStore } from "@/app/stores/general"
import { usePostStore } from "@/app/stores/post"
import { TouchEvent, UIEvent, useCallback, useEffect, useRef, useState } from "react"
import ClientOnly from "./components/ClientOnly"
import PostMain from "./components/PostMain"
import PostSkeleton from "./components/PostSkeleton"
import MobileBottomNav from "./components/MobileBottomNav"
import MainLayout from "./layouts/MainLayout"
import {
  getVideoAutoScrollEnabled,
  setVideoAutoScrollEnabled,
  subscribeToVideoAutoScrollPreference,
} from "./utils/videoAutoScrollPreference"
import { getVideoSoundEnabled, setVideoSoundEnabled } from "./utils/videoSoundPreference"

export default function Home() {
  type MobileFeedTab = 'for-you' | 'following'
  const MOBILE_WINDOW_RADIUS = 2
  const { user } = useUser() || {}
  const { setIsLoginOpen } = useGeneralStore()
  const [isMobileViewport, setIsMobileViewport] = useState<boolean>(false)
  const [mobileViewportHeight, setMobileViewportHeight] = useState<number>(0)
  const [mobileVisibleIndex, setMobileVisibleIndex] = useState<number>(0)
  const [isAutoScrollEnabled, setIsAutoScrollEnabled] = useState<boolean>(false)
  const isAutoScrollEnabledRef = useRef<boolean>(false)
  const touchStartXRef = useRef<number | null>(null)
  const touchStartYRef = useRef<number | null>(null)
  const lastAutoScrolledPostRef = useRef<{ postId: string; handledAt: number } | null>(null)
  const feedContainerRef = useRef<HTMLDivElement | null>(null)
  const lastTabRef = useRef<MobileFeedTab>('for-you')
  const pendingTabRestoreRef = useRef<boolean>(false)
  const tabScrollMemoryRef = useRef<Record<MobileFeedTab, { scrollTop: number; visibleIndex: number }>>({
    'for-you': { scrollTop: 0, visibleIndex: 0 },
    'following': { scrollTop: 0, visibleIndex: 0 },
  })
  const {
    allPosts: displayedPosts,
    setAllPosts,
    loadMorePosts,
    refreshFeed,
    removePost,
    patchPost,
    setFeedKind,
    feedKind,
    isFeedLoading,
    isPageLoading,
    feedError,
    hasMore,
  } = usePostStore();

  const mobileFeedTab: MobileFeedTab = feedKind === 'following' ? 'following' : 'for-you'

  useEffect(() => { void setAllPosts() }, [setAllPosts])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (params.get('feed') === 'following' && user?.id) {
      setFeedKind('following')
    }
  }, [setFeedKind, user?.id])

  // The Following feed is now its own server query. It used to filter the
  // globally-newest 100 posts client-side, so a followed creator's posts simply
  // vanished once they fell outside that window.

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const media = window.matchMedia('(max-width: 767px)')
    const syncViewport = () => {
      setIsMobileViewport(media.matches)
      // Desktop cards are 60px shorter than the viewport (the top nav), and
      // the spacer maths has to match or scroll position drifts.
      setMobileViewportHeight(media.matches ? window.innerHeight : window.innerHeight - 60)
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
    const enabled = getVideoAutoScrollEnabled()
    isAutoScrollEnabledRef.current = enabled
    setIsAutoScrollEnabled(enabled)

    return subscribeToVideoAutoScrollPreference((enabled) => {
      isAutoScrollEnabledRef.current = enabled
      setIsAutoScrollEnabled(enabled)
    })
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const container = feedContainerRef.current
      if (!container) return

      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return

      // behavior:'auto', not 'smooth'. Chromium cancels a smooth programmatic
      // scroll inside a `scroll-snap-type: mandatory` container and snaps back
      // to where it started, so keyboard navigation silently did nothing.
      if (event.key === 'ArrowDown' || event.key === 'j') {
        event.preventDefault()
        container.scrollBy({ top: container.clientHeight, behavior: 'auto' })
      } else if (event.key === 'ArrowUp' || event.key === 'k') {
        event.preventDefault()
        container.scrollBy({ top: -container.clientHeight, behavior: 'auto' })
      } else if (event.key === 'm') {
        event.preventDefault()
        setVideoSoundEnabled(!getVideoSoundEnabled())
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
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

  /**
   * Virtualization.
   *
   * Every post keeps a full-height slot in the DOM; only those inside the
   * window mount a real PostMain (and therefore a <video>). The rest render an
   * empty placeholder of the same height.
   *
   * The obvious implementation -- collapse the off-window posts into two big
   * spacer divs -- is broken under `snap-mandatory`: a spacer contains no snap
   * points, so the browser refuses to leave the last real one and yanks the
   * scroll back. Because the scroll never lands, the handler that advances the
   * window never runs either, and the feed deadlocks after the first few posts.
   * Keeping one snap-start slot per post is what avoids that.
   */
  const shouldVirtualize = displayedPosts.length > 6 && mobileViewportHeight > 0
  const windowStart = shouldVirtualize ? Math.max(0, mobileVisibleIndex - MOBILE_WINDOW_RADIUS) : 0
  const windowEnd = shouldVirtualize
    ? Math.min(displayedPosts.length - 1, mobileVisibleIndex + MOBILE_WINDOW_RADIUS)
    : displayedPosts.length - 1

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
    }
  }, [saveTabPosition])

  const switchToForYou = () => setFeedKind('for-you')
  const switchToFollowing = () => {
    if (!user?.id) {
      setIsLoginOpen(true)
      return
    }
    setFeedKind('following')
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
    const container = event.currentTarget

    // Fetch the next page while there is still a screen or two of runway, so
    // the viewer never reaches the end of the loaded list.
    const remaining = container.scrollHeight - container.scrollTop - container.clientHeight
    if (remaining < container.clientHeight * 2) {
      void loadMorePosts()
    }

    if (!shouldVirtualize) {
      return
    }

    const height = mobileViewportHeight || container.clientHeight
    if (!height) {
      return
    }

    const nextIndex = Math.round(container.scrollTop / height)
    setMobileVisibleIndex((prev) => (prev === nextIndex ? prev : nextIndex))
  }, [loadMorePosts, mobileViewportHeight, shouldVirtualize])

  const handleAutoScrollChange = useCallback((enabled: boolean) => {
    isAutoScrollEnabledRef.current = enabled
    setVideoAutoScrollEnabled(enabled)
  }, [])

  const handleVideoEnded = useCallback((postId: string) => {
    if (!isAutoScrollEnabledRef.current) {
      return
    }

    const lastAutoScrolledPost = lastAutoScrolledPostRef.current
    if (lastAutoScrolledPost?.postId === postId && Date.now() - lastAutoScrolledPost.handledAt < 1000) {
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

    const nextPostElement = feedElement.querySelector<HTMLElement>(`[data-feed-index="${nextIndex}"]`)
    const targetScrollTop = nextPostElement
      ? nextPostElement.getBoundingClientRect().top - feedElement.getBoundingClientRect().top + feedElement.scrollTop
      : nextIndex * (mobileViewportHeight || feedElement.clientHeight)

    lastAutoScrolledPostRef.current = { postId, handledAt: Date.now() }
    setMobileVisibleIndex(nextIndex)
    // See the keyboard handler above: mandatory snap cancels smooth scrolls,
    // which is why auto-advance never actually advanced.
    feedElement.scrollTo({
      top: targetScrollTop,
      behavior: 'auto',
    })
  }, [displayedPosts, mobileViewportHeight])

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

        <MobileBottomNav variant="overlay" />

        <div
          ref={feedContainerRef}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onScroll={handleFeedScroll}
          className="w-full h-[100dvh] overflow-y-scroll snap-y snap-mandatory no-scrollbar md:mt-[60px] md:h-[calc(100vh-60px)] lg:pl-[300px]"
        >
          <ClientOnly>
            {displayedPosts.length < 1 && isFeedLoading ? (
              <PostSkeleton />
            ) : displayedPosts.length < 1 ? (
              <div className="flex h-[100dvh] snap-start items-center justify-center bg-black px-8 text-center text-white md:h-[calc(100vh-60px)] md:bg-transparent md:text-black dark:md:text-white">
                {feedError && mobileFeedTab === 'for-you' ? (
                  <div>
                    <p className="text-lg font-semibold">Couldn&apos;t load the feed.</p>
                    <p className="mt-2 text-sm text-white/80 md:text-gray-500">Check your connection and try again.</p>
                    <button
                      onClick={() => void refreshFeed()}
                      className="mt-4 rounded-full bg-tiktok px-6 py-2 text-sm font-semibold text-white hover:bg-tiktok-hover"
                    >
                      Retry
                    </button>
                  </div>
                ) : mobileFeedTab === 'following' ? (
                  <div>
                    <p className="text-lg font-semibold">No posts from followed creators yet.</p>
                    <p className="mt-2 text-sm text-white/80 md:text-gray-500">Switch to For You to discover more posts.</p>
                  </div>
                ) : (
                  <p className="text-lg font-semibold">No posts available yet.</p>
                )}
              </div>
            ) : (
              <>
                {displayedPosts.map((post, index) =>
                  index >= windowStart && index <= windowEnd ? (
                    <PostMain
                      post={post}
                      key={post.id}
                      feedIndex={index}
                      isAutoScrollEnabled={isAutoScrollEnabled}
                      onVideoEnded={handleVideoEnded}
                      onAutoScrollChange={handleAutoScrollChange}
                      onRemove={removePost}
                      onPostChange={patchPost}
                    />
                  ) : (
                    <div
                      key={post.id}
                      aria-hidden="true"
                      data-feed-placeholder={index}
                      className="snap-start h-[100dvh] md:h-[calc(100vh-60px)]"
                    />
                  )
                )}

                {isPageLoading ? (
                  <div className="flex h-24 items-center justify-center text-sm text-white/70 md:text-ink-soft">
                    Loading more...
                  </div>
                ) : null}

                {!hasMore ? (
                  <div className="flex h-32 snap-start items-center justify-center px-8 text-center text-sm text-white/70 md:text-ink-soft">
                    <div>
                      <p>You are all caught up.</p>
                      <button
                        onClick={() => void refreshFeed()}
                        className="mt-3 rounded-full bg-tiktok px-5 py-2 text-sm font-semibold text-white hover:bg-tiktok-hover"
                      >
                        Refresh feed
                      </button>
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </ClientOnly>
        </div>
      </MainLayout>
    </>
  )
}

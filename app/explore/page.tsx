'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { debounce } from 'debounce'
import { BiSearch } from 'react-icons/bi'
import { AiFillHeart, AiFillPlayCircle } from 'react-icons/ai'
import { BsImages, BsHash } from 'react-icons/bs'
import { IoClose } from 'react-icons/io5'
import CaptionText from '../components/CaptionText'
import ClientOnly from '../components/ClientOnly'
import ImageSlideshow from '../components/ImageSlideshow'
import MobileBottomNav from '../components/MobileBottomNav'
import MainLayout from '../layouts/MainLayout'
import useCreateBucketUrl, { createBucketUrl } from '../hooks/useCreateBucketUrl'
import { getImagePostAudioId, getImagePostIds, isImagePost } from '../utils/postMedia'
import { normalizeTag } from '../utils/postTags'
import { pauseOtherVideos } from '../utils/videoPlayback'
import { formatCount } from '../utils/formatNumber'
import {
  fetchFeed,
  fetchPostsByHashtag,
  fetchTrendingCreators,
  fetchTrendingHashtags,
  searchAll,
  type SearchResults,
  type TrendingCreator,
  type TrendingHashtag,
} from '../utils/feed'
import { createFeedSession } from '../utils/feedCursor'
import {
  addRecentSearch,
  clearRecentSearches,
  getRecentSearches,
  removeRecentSearch,
} from '../utils/searchHistory'
import { PostWithProfile } from '../types'

type ResultTab = 'top' | 'users' | 'videos' | 'hashtags'

const RESULT_TABS: Array<{ key: ResultTab; label: string }> = [
  { key: 'top', label: 'Top' },
  { key: 'users', label: 'Accounts' },
  { key: 'videos', label: 'Videos' },
  { key: 'hashtags', label: 'Hashtags' },
]

/**
 * Discovery.
 *
 * Everything here used to run over `allPosts` -- the cached feed array -- so
 * search, trending and "categories" could only ever see the newest 100 posts in
 * the entire app. The categories were also fake: selecting "Music" filtered
 * captions containing the literal word "music". Both are now server queries
 * against the hashtags tables and the trigram indexes added in 0002.
 */
export default function ExplorePage() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [query, setQuery] = useState('')
  const [activeTab, setActiveTab] = useState<ResultTab>('top')
  const [results, setResults] = useState<SearchResults>({ users: [], hashtags: [], videos: [] })
  const [isSearchLoading, setIsSearchLoading] = useState(false)

  const [discoverPosts, setDiscoverPosts] = useState<PostWithProfile[]>([])
  const [tagPosts, setTagPosts] = useState<PostWithProfile[]>([])
  const [trendingTags, setTrendingTags] = useState<TrendingHashtag[]>([])
  const [trendingCreators, setTrendingCreators] = useState<TrendingCreator[]>([])
  const [recentSearches, setRecentSearches] = useState<string[]>([])

  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Explore gets its own feed session so browsing here does not consume the
  // main feed's dedup window.
  const sessionRef = useRef<string>('')

  const cleanQuery = query.trim()
  const isTagQuery = cleanQuery.startsWith('#')
  const activeTag = isTagQuery ? normalizeTag(cleanQuery) : ''
  const isSearching = cleanQuery.length > 0

  const loadDiscover = useCallback(async () => {
    setIsLoading(true)
    setLoadError(false)
    try {
      if (!sessionRef.current) sessionRef.current = createFeedSession()

      const [posts, tags, creators] = await Promise.all([
        fetchFeed('for-you', null, sessionRef.current, 24),
        fetchTrendingHashtags(12),
        fetchTrendingCreators(8),
      ])

      setDiscoverPosts(posts)
      setTrendingTags(tags)
      setTrendingCreators(creators)
    } catch (error) {
      console.error(error)
      setLoadError(true)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadDiscover()
    setRecentSearches(getRecentSearches())

    return () => {
      if (blurTimerRef.current) clearTimeout(blurTimerRef.current)
    }
  }, [loadDiscover])

  const runSearch = useMemo(
    () =>
      debounce(async (value: string) => {
        const clean = value.trim()
        if (!clean || clean.startsWith('#')) {
          setResults({ users: [], hashtags: [], videos: [] })
          setIsSearchLoading(false)
          return
        }

        try {
          setResults(await searchAll(clean))
        } catch (error) {
          console.error(error)
          setResults({ users: [], hashtags: [], videos: [] })
        } finally {
          setIsSearchLoading(false)
        }
      }, 350),
    []
  )

  const onQueryChange = (value: string) => {
    setQuery(value)
    setShowSuggestions(true)
    if (value.trim() && !value.trim().startsWith('#')) setIsSearchLoading(true)
    runSearch(value)
  }

  // Hashtag pages are a real server query rather than a filter over cached posts.
  useEffect(() => {
    if (!activeTag) {
      setTagPosts([])
      return
    }

    let active = true
    setIsSearchLoading(true)

    fetchPostsByHashtag(activeTag, null, 30)
      .then((posts) => { if (active) setTagPosts(posts) })
      .catch((error) => { console.error(error); if (active) setTagPosts([]) })
      .finally(() => { if (active) setIsSearchLoading(false) })

    return () => { active = false }
  }, [activeTag])

  // Search launched from the header lands here as /explore?q=...
  useEffect(() => {
    const incoming = searchParams.get('q') || ''
    if (incoming && incoming !== query) {
      setQuery(incoming)
      setShowSuggestions(false)
      runSearch(incoming)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  const commitSearch = (value: string) => {
    const clean = value.trim()
    if (!clean) return
    setRecentSearches(addRecentSearch(clean))
    setShowSuggestions(false)
  }

  const applyTag = (tag: string) => {
    setShowSuggestions(false)
    const next = activeTag === tag ? '' : `#${tag}`
    setQuery(next)
    if (next) setRecentSearches(addRecentSearch(next))
  }

  const gridPosts = activeTag ? tagPosts : isSearching ? results.videos : discoverPosts
  const hasSuggestions =
    showSuggestions && isSearching && (results.hashtags.length > 0 || results.users.length > 0)

  const openPost = (post: PostWithProfile) =>
    router.push(`/post/${post.id}/${post.profile.user_id}`)

  return (
    <MainLayout>
      <div className="mx-auto w-full max-w-[1140px] px-3 pb-24 pt-[76px] md:pl-[80px] lg:pl-[240px]">
        {/* Search */}
        <div className="relative mx-auto max-w-[520px]">
          <div className="flex items-center gap-2 rounded-full bg-surface-subtle px-4 py-2.5">
            <BiSearch size={20} className="text-ink-soft" />
            <input
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') commitSearch(query) }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => {
                blurTimerRef.current = setTimeout(() => setShowSuggestions(false), 150)
              }}
              placeholder="Search creators, videos and #tags"
              aria-label="Search"
              className="w-full bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-soft"
            />
            {query ? (
              <button onClick={() => setQuery('')} aria-label="Clear search" className="text-ink-soft hover:text-ink">
                <IoClose size={18} />
              </button>
            ) : null}
          </div>

          {/* Autocomplete */}
          {hasSuggestions ? (
            <div className="absolute left-0 top-[52px] z-30 w-full overflow-hidden rounded-xl border border-line bg-surface-elevated shadow-rail">
              {results.hashtags.length > 0 ? (
                <>
                  <p className="border-b border-line px-4 py-2 text-[13px] font-semibold text-ink-soft">Tags</p>
                  {results.hashtags.map((tag) => (
                    <button
                      key={tag.tag}
                      onClick={() => applyTag(tag.tag)}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-subtle"
                    >
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-subtle text-ink-soft">
                        <BsHash size={18} />
                      </span>
                      <span className="flex-1 text-[15px] font-semibold text-ink">#{tag.tag}</span>
                      <span className="text-[13px] text-ink-soft">{formatCount(tag.post_count)} posts</span>
                    </button>
                  ))}
                </>
              ) : null}

              {results.users.length > 0 ? (
                <>
                  <p className="border-b border-t border-line px-4 py-2 text-[13px] font-semibold text-ink-soft">Accounts</p>
                  {results.users.map((p) => (
                    <button
                      key={p.user_id}
                      onClick={() => { commitSearch(query); router.push(`/profile/${p.user_id}`) }}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-subtle"
                    >
                      <img src={createBucketUrl(p.image)} className="h-9 w-9 rounded-full object-cover" alt="" />
                      <span className="flex-1 text-[15px] font-semibold text-ink">@{p.name}</span>
                      <span className="text-[13px] text-ink-soft">{formatCount(p.follower_count)}</span>
                    </button>
                  ))}
                </>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Recent searches */}
        <ClientOnly>
          {!isSearching && recentSearches.length > 0 ? (
            <div className="mt-5">
              <div className="flex items-center justify-between">
                <p className="text-[15px] font-semibold text-ink">Recent searches</p>
                <button
                  onClick={() => { clearRecentSearches(); setRecentSearches([]) }}
                  className="text-[13px] font-semibold text-ink-soft hover:text-ink"
                >
                  Clear all
                </button>
              </div>
              <div className="no-scrollbar mt-2 flex gap-2 overflow-x-auto pb-1">
                {recentSearches.map((term) => (
                  <span
                    key={term}
                    className="flex items-center gap-1.5 whitespace-nowrap rounded-full bg-surface-subtle px-3.5 py-1.5 text-[13px] font-semibold text-ink"
                  >
                    <button onClick={() => onQueryChange(term)}>{term}</button>
                    <button
                      onClick={() => setRecentSearches(removeRecentSearch(term))}
                      aria-label={`Remove ${term} from recent searches`}
                      className="text-ink-soft hover:text-ink"
                    >
                      <IoClose size={14} />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </ClientOnly>

        {/* Trending hashtags. Real tags ranked by engagement, replacing the
            hardcoded category list that filtered captions by keyword. */}
        {trendingTags.length > 0 ? (
          <div className="no-scrollbar mt-4 flex gap-2 overflow-x-auto pb-1">
            {trendingTags.map((tag) => (
              <button
                key={tag.tag}
                onClick={() => applyTag(tag.tag)}
                className={`whitespace-nowrap rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${
                  activeTag === tag.tag
                    ? 'border-tiktok bg-tiktok/10 text-tiktok'
                    : 'border-line text-ink-soft hover:text-ink'
                }`}
              >
                #{tag.tag}
              </button>
            ))}
          </div>
        ) : null}

        {/* Result tabs, only while searching */}
        {isSearching && !activeTag ? (
          <div role="tablist" className="mt-4 flex gap-1 border-b border-line">
            {RESULT_TABS.map((tab) => (
              <button
                key={tab.key}
                role="tab"
                aria-selected={activeTab === tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-4 py-2 text-[15px] font-semibold transition-colors ${
                  activeTab === tab.key
                    ? 'border-b-2 border-ink text-ink'
                    : 'text-ink-soft hover:text-ink'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        ) : null}

        {activeTag ? (
          <h1 className="mt-5 text-[22px] font-bold text-ink">#{activeTag}</h1>
        ) : null}

        {/* Suggested creators, shown on the Top tab and the default state */}
        {(!isSearching || activeTab === 'top' || activeTab === 'users') && !activeTag ? (
          <SuggestedCreators
            creators={isSearching ? [] : trendingCreators}
            users={isSearching ? results.users : []}
            onOpen={(id) => router.push(`/profile/${id}`)}
          />
        ) : null}

        {/* Grid */}
        <ClientOnly>
          {isLoading || isSearchLoading ? (
            <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {[...Array(10)].map((_, i) => (
                <div key={i}>
                  <div className="tt-shimmer aspect-[9/13] w-full rounded-lg" />
                  <div className="tt-shimmer mt-2 h-3 w-3/4 rounded" />
                </div>
              ))}
            </div>
          ) : loadError ? (
            <div className="py-24 text-center text-ink-soft">
              <p className="text-lg font-semibold text-ink">Couldn&apos;t load videos.</p>
              <p className="mt-1 text-sm">Check your connection and try again.</p>
              <button
                onClick={loadDiscover}
                className="mt-4 rounded-full bg-tiktok px-6 py-2 text-sm font-semibold text-white hover:bg-tiktok-hover"
              >
                Retry
              </button>
            </div>
          ) : isSearching && activeTab === 'users' && !activeTag ? (
            results.users.length < 1 ? (
              <EmptyState title="No accounts found" detail={`Nothing matches "${cleanQuery}".`} />
            ) : null
          ) : isSearching && activeTab === 'hashtags' && !activeTag ? (
            results.hashtags.length < 1 ? (
              <EmptyState title="No hashtags found" detail={`Nothing matches "${cleanQuery}".`} />
            ) : (
              <div className="mt-5 space-y-1">
                {results.hashtags.map((tag) => (
                  <button
                    key={tag.tag}
                    onClick={() => applyTag(tag.tag)}
                    className="flex w-full items-center gap-3 rounded-lg px-2 py-3 text-left hover:bg-surface-subtle"
                  >
                    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-subtle text-ink-soft">
                      <BsHash size={20} />
                    </span>
                    <span className="flex-1 text-[15px] font-semibold text-ink">#{tag.tag}</span>
                    <span className="text-[13px] text-ink-soft">{formatCount(tag.post_count)} posts</span>
                  </button>
                ))}
              </div>
            )
          ) : gridPosts.length < 1 ? (
            <EmptyState
              title={isSearching ? 'No videos found' : 'Nothing to explore yet'}
              detail={isSearching ? `Nothing matches "${cleanQuery}".` : 'New videos will show up here.'}
            />
          ) : (
            <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {gridPosts.map((post) => (
                <ExploreThumb key={post.id} post={post} onClick={() => openPost(post)} />
              ))}
            </div>
          )}
        </ClientOnly>
      </div>

      <MobileBottomNav />
    </MainLayout>
  )
}

const EmptyState = ({ title, detail }: { title: string; detail: string }) => (
  <div className="py-24 text-center text-ink-soft">
    <p className="text-lg font-semibold text-ink">{title}</p>
    <p className="mt-1 text-sm">{detail}</p>
  </div>
)

const SuggestedCreators = ({
  creators,
  users,
  onOpen,
}: {
  creators: TrendingCreator[]
  users: SearchResults['users']
  onOpen: (userId: string) => void
}) => {
  const rows = users.length > 0
    ? users.map((u) => ({ id: u.user_id, name: u.name, image: u.image, followers: u.follower_count }))
    : creators.map((c) => ({ id: c.user_id, name: c.name, image: c.image, followers: c.follower_count }))

  if (rows.length < 1) return null

  return (
    <div className="mt-5">
      <p className="text-[15px] font-semibold text-ink">
        {users.length > 0 ? 'Accounts' : 'Creators to follow'}
      </p>
      <div className="no-scrollbar mt-3 flex gap-3 overflow-x-auto pb-1">
        {rows.map((row) => (
          <button
            key={row.id}
            onClick={() => onOpen(row.id)}
            className="flex w-[132px] shrink-0 flex-col items-center rounded-xl border border-line p-3 hover:bg-surface-subtle"
          >
            <img src={createBucketUrl(row.image)} className="h-14 w-14 rounded-full object-cover" alt="" />
            <span className="mt-2 w-full truncate text-center text-[14px] font-semibold text-ink">
              @{row.name}
            </span>
            <span className="text-[12px] text-ink-soft">{formatCount(row.followers)} followers</span>
          </button>
        ))}
      </div>
    </div>
  )
}

const ExploreThumb = ({
  post,
  onClick,
}: {
  post: PostWithProfile
  onClick: () => void
}) => {
  // Comes with the row now; every tile used to fetch its own like count.
  const likeCount = post.like_count
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [isHovering, setIsHovering] = useState(false)

  const postIsImage = isImagePost(post.video_url)
  const postImageIds = getImagePostIds(post.video_url)
  const postAudioId = getImagePostAudioId(post.video_url)
  const videoUrl = createBucketUrl(postIsImage ? '' : post.video_url)
  const posterUrl = post.poster_key ? createBucketUrl(post.poster_key) : undefined

  // Hover previews play with music; retry muted when the browser blocks
  // unmuted autoplay.
  const handleHoverStart = () => {
    setIsHovering(true)

    const video = videoRef.current
    if (!video) return

    pauseOtherVideos(video)
    video.muted = false
    video.play().catch(() => {
      video.muted = true
      video.play().catch(() => null)
    })
  }

  const handleHoverEnd = () => {
    setIsHovering(false)

    const video = videoRef.current
    if (!video) return

    video.pause()
    video.muted = true
  }

  useEffect(() => {
    return () => {
      videoRef.current?.pause()
    }
  }, [])

  return (
    <button
      onClick={onClick}
      onMouseEnter={handleHoverStart}
      onMouseLeave={handleHoverEnd}
      className="group relative block overflow-hidden rounded-lg bg-black"
    >
      <div className="relative aspect-[9/13] w-full">
        {postIsImage ? (
          <ImageSlideshow
            imageIds={postImageIds}
            audioId={postAudioId}
            muted={false}
            autoPlay={isHovering}
            showControls={false}
            showDots={false}
            className="h-full w-full"
            imageClassName="!object-cover"
            altPrefix={post.text || 'Explore image'}
          />
        ) : (
          <video
            ref={videoRef}
            src={videoUrl}
            muted
            loop
            playsInline
            preload="metadata"
            poster={posterUrl}
            className="h-full w-full object-cover"
          />
        )}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
        <span className="pointer-events-none absolute right-2 top-2 text-white/90 drop-shadow">
          {postIsImage ? <BsImages size={16} /> : <AiFillPlayCircle size={18} />}
        </span>
        {likeCount > 0 ? (
          <div className="pointer-events-none absolute inset-x-2 bottom-2 flex items-center gap-1 text-[13px] font-semibold text-white drop-shadow">
            <AiFillHeart size={15} />
            {formatCount(likeCount)}
          </div>
        ) : null}
      </div>
      <p className="truncate px-1.5 py-1.5 text-left text-[13px] text-ink">
        <CaptionText text={post.text || `@${post.profile.name}`} linkify={false} />
      </p>
    </button>
  )
}

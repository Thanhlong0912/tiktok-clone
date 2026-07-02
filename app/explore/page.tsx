'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { debounce } from 'debounce'
import { BiSearch } from 'react-icons/bi'
import { AiFillHeart, AiFillPlayCircle } from 'react-icons/ai'
import { BsImages } from 'react-icons/bs'
import ClientOnly from '../components/ClientOnly'
import MobileBottomNav from '../components/MobileBottomNav'
import MainLayout from '../layouts/MainLayout'
import { usePostStore } from '../stores/post'
import useCreateBucketUrl from '../hooks/useCreateBucketUrl'
import useSearchProfilesByName from '../hooks/useSearchProfilesByName'
import { getImagePostIds, isImagePost } from '../utils/postMedia'
import { formatCount } from '../utils/formatNumber'
import { PostWithProfile, RandomUsers } from '../types'

const CATEGORIES = ['All', 'Trending', 'Music', 'Dance', 'Comedy', 'Gaming', 'Food', 'Sports', 'DIY']

export default function ExplorePage() {
  const router = useRouter()
  const { allPosts, setAllPosts } = usePostStore()
  const [activeCategory, setActiveCategory] = useState('All')
  const [query, setQuery] = useState('')
  const [profileResults, setProfileResults] = useState<RandomUsers[]>([])

  useEffect(() => {
    if (allPosts.length < 1) setAllPosts()
  }, [])

  const handleSearch = useMemo(
    () =>
      debounce(async (value: string) => {
        if (!value.trim()) {
          setProfileResults([])
          return
        }
        try {
          const res = await useSearchProfilesByName(value)
          setProfileResults(res || [])
        } catch {
          setProfileResults([])
        }
      }, 400),
    []
  )

  return (
    <MainLayout>
      <div className="mx-auto w-full max-w-[1140px] px-3 pb-24 pt-[76px] md:pl-[80px] lg:pl-[240px]">
        {/* Search */}
        <div className="mx-auto flex max-w-[520px] items-center gap-2 rounded-full bg-surface-subtle px-4 py-2.5">
          <BiSearch size={20} className="text-ink-soft" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              handleSearch(e.target.value)
            }}
            placeholder="Search creators and videos"
            className="w-full bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-soft"
          />
        </div>

        {profileResults.length > 0 ? (
          <div className="mx-auto mt-3 max-w-[520px] overflow-hidden rounded-xl border border-line bg-surface-elevated">
            {profileResults.map((p) => (
              <button
                key={p.id}
                onClick={() => router.push(`/profile/${p.id}`)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-subtle"
              >
                <img src={useCreateBucketUrl(p.image)} className="h-9 w-9 rounded-full object-cover" alt={p.name} />
                <span className="text-[15px] font-semibold text-ink">@{p.name}</span>
              </button>
            ))}
          </div>
        ) : null}

        {/* Category chips */}
        <div className="no-scrollbar mt-5 flex gap-2 overflow-x-auto pb-1">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] font-semibold transition-colors ${
                activeCategory === cat
                  ? 'bg-tiktok text-white'
                  : 'bg-surface-subtle text-ink hover:bg-surface-subtle/70'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Grid */}
        <ClientOnly>
          {allPosts.length < 1 ? (
            <div className="py-24 text-center text-ink-soft">
              <p className="text-lg font-semibold">Nothing to explore yet</p>
              <p className="mt-1 text-sm">New videos will show up here.</p>
            </div>
          ) : (
            <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {allPosts.map((post) => (
                <ExploreThumb key={post.id} post={post} onClick={() => router.push(`/post/${post.id}/${post.profile.user_id}`)} />
              ))}
            </div>
          )}
        </ClientOnly>
      </div>

      <MobileBottomNav />
    </MainLayout>
  )
}

const ExploreThumb = ({ post, onClick }: { post: PostWithProfile; onClick: () => void }) => {
  const postIsImage = isImagePost(post.video_url)
  const firstImageId = postIsImage ? getImagePostIds(post.video_url)[0] : ''
  const mediaUrl = useCreateBucketUrl(postIsImage ? firstImageId : post.video_url)

  return (
    <button onClick={onClick} className="group relative block overflow-hidden rounded-lg bg-black">
      <div className="relative aspect-[9/13] w-full">
        {postIsImage ? (
          <img src={mediaUrl} className="h-full w-full object-cover" alt={post.text} />
        ) : (
          <video
            src={mediaUrl}
            muted
            playsInline
            preload="metadata"
            className="h-full w-full object-cover"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
        <span className="absolute right-2 top-2 text-white/90 drop-shadow">
          {postIsImage ? <BsImages size={16} /> : <AiFillPlayCircle size={18} />}
        </span>
        <div className="absolute inset-x-2 bottom-2 flex items-center gap-1 text-[13px] font-semibold text-white drop-shadow">
          <AiFillHeart size={15} />
          {formatCount(Math.floor((post.id.charCodeAt(0) || 20) * 137) % 90000)}
        </div>
      </div>
      <p className="truncate px-1.5 py-1.5 text-left text-[13px] text-ink">{post.text || `@${post.profile.name}`}</p>
    </button>
  )
}

'use client'

import moment from 'moment'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { AiFillHeart } from 'react-icons/ai'
import { FaCommentDots, FaUserPlus } from 'react-icons/fa'
import { BiBell } from 'react-icons/bi'
import ClientOnly from '../components/ClientOnly'
import MainLayout from '../layouts/MainLayout'
import MobileBottomNav from '../components/MobileBottomNav'
import { useUser } from '../context/user'
import { useGeneralStore } from '../stores/general'
import useCreateBucketUrl from '../hooks/useCreateBucketUrl'
import useGetActivity, { ActivityItem, ActivityType } from '../hooks/useGetActivity'

const TABS = [
  { id: 'all', label: 'All activity', icon: BiBell },
  { id: 'likes', label: 'Likes', icon: AiFillHeart },
  { id: 'comments', label: 'Comments', icon: FaCommentDots },
  { id: 'followers', label: 'Followers', icon: FaUserPlus },
] as const

const TAB_TYPE: Record<string, ActivityType | null> = {
  all: null,
  likes: 'like',
  comments: 'comment',
  followers: 'follow',
}

const TYPE_META: Record<ActivityType, { icon: typeof AiFillHeart; iconClass: string; label: string }> = {
  like: { icon: AiFillHeart, iconClass: 'text-tiktok', label: 'liked your video' },
  comment: { icon: FaCommentDots, iconClass: 'text-tiktok-cyan', label: 'commented on your video' },
  follow: { icon: FaUserPlus, iconClass: 'text-ink', label: 'started following you' },
}

export default function ActivityPage() {
  const { user } = useUser() || {}
  const { setIsLoginOpen } = useGeneralStore()
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('all')
  const [items, setItems] = useState<ActivityItem[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [hasError, setHasError] = useState<boolean>(false)
  const [reloadKey, setReloadKey] = useState<number>(0)
  const active = TABS.find((t) => t.id === tab)!

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      if (!user?.id) {
        setItems([])
        return
      }

      setIsLoading(true)
      setHasError(false)
      try {
        const activity = await useGetActivity(user.id)
        if (!cancelled) setItems(activity)
      } catch (error) {
        console.error(error)
        if (!cancelled) setHasError(true)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [user?.id, reloadKey])

  const visibleItems = useMemo(() => {
    const type = TAB_TYPE[tab]
    return type ? items.filter((item) => item.type === type) : items
  }, [items, tab])

  return (
    <MainLayout>
      <div className="mx-auto w-full max-w-[720px] px-4 pb-24 pt-[76px] md:pl-[80px] lg:pl-[240px]">
        <h1 className="text-[24px] font-bold text-ink">Activity</h1>

        <div className="no-scrollbar mt-4 flex gap-2 overflow-x-auto">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-4 py-2 text-[14px] font-semibold transition-colors ${
                tab === id ? 'bg-tiktok text-white' : 'bg-surface-subtle text-ink'
              }`}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </div>

        <ClientOnly>
          {!user?.id ? (
            <div className="mt-16 flex flex-col items-center text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-subtle text-ink-soft">
                <BiBell size={30} />
              </div>
              <p className="mt-4 text-lg font-semibold text-ink">Log in to see your activity</p>
              <p className="mt-1 max-w-xs text-sm text-ink-soft">
                Likes, comments, and new followers will appear here.
              </p>
              <button
                onClick={() => setIsLoginOpen(true)}
                className="mt-5 rounded-md bg-tiktok px-8 py-2.5 text-[15px] font-semibold text-white hover:bg-tiktok-hover"
              >
                Log in
              </button>
            </div>
          ) : isLoading ? (
            <div className="mt-6 space-y-4">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="tt-shimmer h-12 w-12 rounded-full" />
                  <div className="flex-1">
                    <div className="tt-shimmer h-3.5 w-2/3 rounded" />
                    <div className="tt-shimmer mt-2 h-3 w-1/3 rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : hasError ? (
            <div className="mt-16 flex flex-col items-center text-center">
              <p className="text-lg font-semibold text-ink">Couldn&apos;t load activity.</p>
              <p className="mt-1 max-w-xs text-sm text-ink-soft">Check your connection and try again.</p>
              <button
                onClick={() => setReloadKey((key) => key + 1)}
                className="mt-4 rounded-full bg-tiktok px-6 py-2 text-sm font-semibold text-white hover:bg-tiktok-hover"
              >
                Retry
              </button>
            </div>
          ) : visibleItems.length < 1 ? (
            <div className="mt-16 flex flex-col items-center text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-subtle text-ink-soft">
                <active.icon size={30} />
              </div>
              <p className="mt-4 text-lg font-semibold text-ink">No {active.label.toLowerCase()} yet</p>
              <p className="mt-1 max-w-xs text-sm text-ink-soft">
                When people interact with your videos, you&apos;ll see it here.
              </p>
            </div>
          ) : (
            <div className="mt-4 divide-y divide-line">
              {visibleItems.map((item) => {
                const meta = TYPE_META[item.type]
                const TypeIcon = meta.icon
                const href = item.type === 'follow'
                  ? `/profile/${item.actor.user_id}`
                  : `/post/${item.postId}/${item.postUserId}`

                return (
                  <Link key={item.id} href={href} className="flex items-center gap-3 py-3 hover:bg-surface-subtle">
                    <span className="relative shrink-0">
                      <img
                        className="h-12 w-12 rounded-full object-cover"
                        src={useCreateBucketUrl(item.actor.image)}
                        alt={item.actor.name}
                      />
                      <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-surface shadow">
                        <TypeIcon size={11} className={meta.iconClass} />
                      </span>
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] text-ink">
                        <span className="font-semibold">@{item.actor.name}</span>{' '}
                        <span className="text-ink-soft">{meta.label}</span>
                      </p>
                      {item.commentText ? (
                        <p className="mt-0.5 truncate text-[14px] text-ink">“{item.commentText}”</p>
                      ) : null}
                      <p className="mt-0.5 text-[13px] text-ink-soft">{moment(item.createdAt).fromNow()}</p>
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </ClientOnly>
      </div>

      <MobileBottomNav />
    </MainLayout>
  )
}

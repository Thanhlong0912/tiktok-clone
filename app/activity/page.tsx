'use client'

import moment from 'moment'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { AiFillHeart, AiOutlineRetweet } from 'react-icons/ai'
import { FaCommentDots, FaUserPlus, FaAt } from 'react-icons/fa'
import { BiBell } from 'react-icons/bi'
import ClientOnly from '../components/ClientOnly'
import MainLayout from '../layouts/MainLayout'
import MobileBottomNav from '../components/MobileBottomNav'
import { useUser } from '../context/user'
import { useGeneralStore } from '../stores/general'
import { createBucketUrl } from '../hooks/useCreateBucketUrl'
import {
  fetchNotifications,
  markNotificationsRead,
  nextNotificationCursor,
  type NotificationCursor,
  type NotificationItem,
  type NotificationType,
} from '../utils/notifications'

const TABS = [
  { id: 'all', label: 'All activity', icon: BiBell },
  { id: 'likes', label: 'Likes', icon: AiFillHeart },
  { id: 'comments', label: 'Comments', icon: FaCommentDots },
  // Next to Comments rather than after Followers: a mention arrives from a
  // caption or a comment body, so it belongs with the conversational half.
  { id: 'mentions', label: 'Mentions', icon: FaAt },
  { id: 'followers', label: 'Followers', icon: FaUserPlus },
] as const

const TAB_TYPE: Record<string, NotificationType | null> = {
  all: null,
  likes: 'like',
  comments: 'comment',
  mentions: 'mention',
  followers: 'follow',
}

const TYPE_META: Record<NotificationType, { icon: typeof AiFillHeart; iconClass: string; label: string }> = {
  like: { icon: AiFillHeart, iconClass: 'text-tiktok', label: 'liked your video' },
  comment: { icon: FaCommentDots, iconClass: 'text-tiktok-cyan', label: 'commented on your video' },
  follow: { icon: FaUserPlus, iconClass: 'text-ink', label: 'started following you' },
  repost: { icon: AiOutlineRetweet, iconClass: 'text-tiktok-cyan', label: 'reposted your video' },
  mention: { icon: FaAt, iconClass: 'text-ink', label: 'mentioned you' },
}

export default function ActivityPage() {
  const { user } = useUser() || {}
  const { setIsLoginOpen } = useGeneralStore()
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('all')
  const [items, setItems] = useState<NotificationItem[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [isPaging, setIsPaging] = useState<boolean>(false)
  const [hasError, setHasError] = useState<boolean>(false)
  const [hasMore, setHasMore] = useState<boolean>(true)
  const [cursor, setCursor] = useState<NotificationCursor | null>(null)
  const [reloadKey, setReloadKey] = useState<number>(0)
  const active = TABS.find((t) => t.id === tab)!

  /**
   * Reads the notifications table written by the triggers in 0002.
   *
   * This page used to synthesise the list on every visit: fetch all of your
   * post ids, then query likes, comments and follows separately, then fetch one
   * profile per actor. It also applied its 50-row cap to each source BEFORE
   * merging them, so a burst of likes could push every follow and comment out
   * of the list entirely.
   */
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
        const page = await fetchNotifications(null, 30, TAB_TYPE[tab])
        if (cancelled) return

        setItems(page)
        setCursor(nextNotificationCursor(page))
        setHasMore(page.length >= 30)

        // Opening the page is what marks them read.
        if (page.some((item) => !item.read_at)) {
          await markNotificationsRead()
          if (!cancelled) {
            setItems((current) =>
              current.map((item) => (item.read_at ? item : { ...item, read_at: new Date().toISOString() }))
            )
          }
        }
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
  }, [user?.id, reloadKey, tab])

  const loadMore = useCallback(async () => {
    if (!cursor || isPaging || !hasMore) return

    setIsPaging(true)
    try {
      const page = await fetchNotifications(cursor, 30, TAB_TYPE[tab])
      setItems((current) => current.concat(page))
      setCursor(nextNotificationCursor(page))
      setHasMore(page.length >= 30)
    } catch (error) {
      console.error(error)
    } finally {
      setIsPaging(false)
    }
  }, [cursor, hasMore, isPaging, tab])

  // The server already returned only this tab's type -- no client filter.
  const visibleItems = items

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
                const href = item.type === 'follow' || !item.post_id
                  ? `/profile/${item.actor_id}`
                  : `/post/${item.post_id}/${user?.id}`

                return (
                  <Link key={item.id} href={href} className="flex items-center gap-3 py-3 hover:bg-surface-subtle">
                    <span className="relative shrink-0">
                      <img
                        className="h-12 w-12 rounded-full object-cover"
                        src={createBucketUrl(item.actor_image)}
                        alt=""
                      />
                      <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-surface shadow">
                        <TypeIcon size={11} className={meta.iconClass} />
                      </span>
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] text-ink">
                        <span className="font-semibold">@{item.actor_name}</span>{' '}
                        <span className="text-ink-soft">{meta.label}</span>
                      </p>
                      {item.preview ? (
                        <p className="mt-0.5 truncate text-[14px] text-ink">“{item.preview}”</p>
                      ) : null}
                      <p className="mt-0.5 text-[13px] text-ink-soft">{moment(item.created_at).fromNow()}</p>
                    </div>

                    {item.post_poster_key ? (
                      <img
                        className="h-14 w-10 shrink-0 rounded object-cover"
                        src={createBucketUrl(item.post_poster_key)}
                        alt=""
                      />
                    ) : null}
                  </Link>
                )
              })}

              {hasMore ? (
                <div className="py-4 text-center">
                  <button
                    onClick={loadMore}
                    disabled={isPaging}
                    className="rounded-full bg-surface-subtle px-6 py-2 text-sm font-semibold text-ink disabled:opacity-60"
                  >
                    {isPaging ? 'Loading...' : 'Load more'}
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </ClientOnly>
      </div>

      <MobileBottomNav />
    </MainLayout>
  )
}

'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Suspense, useCallback, useEffect, useState } from 'react'
import { BsPeople } from 'react-icons/bs'
import { IoArrowBack } from 'react-icons/io5'
import ClientOnly from '@/app/components/ClientOnly'
import MobileBottomNav from '@/app/components/MobileBottomNav'
import SearchParamReader from '@/app/components/SearchParamReader'
import MainLayout from '@/app/layouts/MainLayout'
import { useUser } from '@/app/context/user'
import { useGeneralStore } from '@/app/stores/general'
import { createBucketUrl } from '@/app/hooks/useCreateBucketUrl'
import useCreateFollow from '@/app/hooks/useCreateFollow'
import useDeleteFollow from '@/app/hooks/useDeleteFollow'
import useIsFollowing from '@/app/hooks/useIsFollowing'
import { fetchFollowList } from '@/app/utils/accounts'
import {
  ACCOUNT_PAGE_SIZE,
  applyFollowState,
  mergeAccountPage,
  nextAccountCursor,
  type AccountCursor,
  type AccountSummary,
  type FollowListKind,
} from '@/app/utils/accountList'
import { fetchProfile } from '@/app/utils/feed'
import { formatCount } from '@/app/utils/formatNumber'
import { showToast } from '@/app/utils/toast'

const TABS: Array<{ id: FollowListKind; label: string }> = [
  { id: 'followers', label: 'Followers' },
  { id: 'following', label: 'Following' },
]

/**
 * Follower and following lists.
 *
 * The counts on a profile header have always been plain text: there was no
 * route, no RPC and no way to get from one account to another. This is the
 * missing half of the social graph.
 *
 * It has to be a pair of RPCs rather than a PostgREST query, because
 * follows.to_user_id references auth.users and not public.profiles, so there
 * is no foreign key for an embed to traverse -- see app/utils/accounts.ts.
 */
const FollowersPage = ({ params }: { params: { id: string } }) => {
  const router = useRouter()
  const { user } = useUser() || {}
  const { setIsLoginOpen } = useGeneralStore()

  const [tab, setTab] = useState<FollowListKind>('followers')
  const [profileName, setProfileName] = useState<string>('')
  const [counts, setCounts] = useState<{ followers: number; following: number } | null>(null)

  const [items, setItems] = useState<AccountSummary[]>([])
  const [cursor, setCursor] = useState<AccountCursor | null>(null)
  const [hasMore, setHasMore] = useState<boolean>(true)
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [isPaging, setIsPaging] = useState<boolean>(false)
  const [hasError, setHasError] = useState<boolean>(false)
  const [reloadKey, setReloadKey] = useState<number>(0)
  const [pendingId, setPendingId] = useState<string | null>(null)

  // Header only. One row, and it also tells us whether the account exists.
  useEffect(() => {
    let active = true

    fetchProfile(params.id)
      .then((profile) => {
        if (!active || !profile) return
        setProfileName(profile.name)
        setCounts({ followers: profile.follower_count, following: profile.following_count })
      })
      .catch((error) => console.error(error))

    return () => {
      active = false
    }
  }, [params.id])

  /**
   * Read through SearchParamReader rather than useSearchParams here: calling
   * the hook in the page component would force the whole page to prerender as
   * its Suspense fallback. See that component's own note.
   */
  const readTabParam = useCallback((value: string) => {
    setTab(value === 'following' ? 'following' : 'followers')
  }, [])

  useEffect(() => {
    let active = true

    setItems([])
    setCursor(null)
    setHasMore(true)
    setHasError(false)
    setIsLoading(true)

    fetchFollowList(tab, params.id, null, ACCOUNT_PAGE_SIZE)
      .then((page) => {
        if (!active) return
        setItems(page)
        setCursor(nextAccountCursor(page))
        setHasMore(page.length >= ACCOUNT_PAGE_SIZE)
      })
      .catch((error) => {
        if (!active) return
        console.error(error)
        setHasError(true)
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })

    return () => {
      active = false
    }
  }, [params.id, tab, reloadKey])

  const loadMore = useCallback(async () => {
    if (isPaging || !hasMore || !cursor) return

    setIsPaging(true)
    try {
      const page = await fetchFollowList(tab, params.id, cursor, ACCOUNT_PAGE_SIZE)
      setItems((current) => mergeAccountPage(current, page))
      setCursor(nextAccountCursor(page))
      setHasMore(page.length >= ACCOUNT_PAGE_SIZE)
    } catch (error) {
      console.error(error)
      showToast('Could not load more accounts', 'error')
    } finally {
      setIsPaging(false)
    }
  }, [cursor, hasMore, isPaging, params.id, tab])

  const changeTab = useCallback(
    (next: FollowListKind) => {
      if (next === tab) return
      setTab(next)
      // Keeps the URL shareable and the back button meaningful, matching how
      // the home feed handles ?feed=.
      router.replace(`/profile/${params.id}/followers?tab=${next}`, { scroll: false })
    },
    [params.id, router, tab]
  )

  /**
   * Optimistic with rollback, the same pattern the profile header and the
   * action rail use. The follow row id is not in the list payload -- adding it
   * would mean returning a row a viewer has no other use for -- so an unfollow
   * looks the id up first.
   */
  const toggleFollow = useCallback(
    async (account: AccountSummary) => {
      if (!user?.id) {
        setIsLoginOpen(true)
        return
      }
      if (pendingId) return

      const next = !account.is_following
      setPendingId(account.user_id)
      setItems((current) => applyFollowState(current, account.user_id, next))

      try {
        if (next) {
          await useCreateFollow(user.id, account.user_id)
        } else {
          const existing = await useIsFollowing(user.id, account.user_id)
          if (existing?.id) await useDeleteFollow(existing.id)
        }
      } catch (error) {
        console.error(error)
        setItems((current) => applyFollowState(current, account.user_id, !next))
        showToast(next ? 'Could not follow' : 'Could not unfollow', 'error')
      } finally {
        setPendingId(null)
      }
    },
    [pendingId, setIsLoginOpen, user?.id]
  )

  const activeCount = counts ? (tab === 'followers' ? counts.followers : counts.following) : null

  return (
    <MainLayout>
      <Suspense fallback={null}>
        <SearchParamReader name="tab" onValue={readTabParam} />
      </Suspense>

      <div className="mx-auto w-full max-w-[700px] px-4 pb-24 pt-[80px] md:pl-[100px] lg:pl-[260px]">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push(`/profile/${params.id}`)}
            aria-label="Back to profile"
            className="rounded-full p-1.5 text-ink hover:bg-surface-subtle"
          >
            <IoArrowBack size={22} />
          </button>
          <h1 className="truncate text-[20px] font-bold text-ink">
            {profileName ? `@${profileName}` : 'Account'}
          </h1>
        </div>

        <div role="tablist" aria-label="Follow lists" className="mt-4 flex w-full border-b border-line">
          {TABS.map((item) => (
            <button
              key={item.id}
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => changeTab(item.id)}
              className={`flex-1 py-2.5 text-center text-[16px] font-semibold transition-colors ${
                tab === item.id
                  ? 'border-b-2 border-b-ink text-ink'
                  : 'text-ink-soft hover:text-ink'
              }`}
            >
              {item.label}
              {counts ? (
                <span className="pl-1.5 font-normal text-ink-soft">
                  {formatCount(item.id === 'followers' ? counts.followers : counts.following)}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        <ClientOnly>
          {isLoading ? (
            <div className="mt-6 space-y-4">
              {[...Array(6)].map((_, index) => (
                <div key={index} className="flex items-center gap-3">
                  <div className="tt-shimmer h-12 w-12 rounded-full" />
                  <div className="flex-1">
                    <div className="tt-shimmer h-3.5 w-1/3 rounded" />
                    <div className="tt-shimmer mt-2 h-3 w-1/2 rounded" />
                  </div>
                  <div className="tt-shimmer h-8 w-20 rounded-md" />
                </div>
              ))}
            </div>
          ) : hasError ? (
            <div className="mt-16 flex flex-col items-center text-center">
              <p className="text-lg font-semibold text-ink">Couldn&apos;t load this list.</p>
              <p className="mt-1 max-w-xs text-sm text-ink-soft">
                Check your connection and try again.
              </p>
              <button
                onClick={() => setReloadKey((key) => key + 1)}
                className="mt-4 rounded-full bg-tiktok px-6 py-2 text-sm font-semibold text-white hover:bg-tiktok-hover"
              >
                Retry
              </button>
            </div>
          ) : items.length < 1 ? (
            <div className="mt-16 flex flex-col items-center text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-subtle text-ink-soft">
                <BsPeople size={30} />
              </div>
              <p className="mt-4 text-lg font-semibold text-ink">
                {tab === 'followers' ? 'No followers yet' : 'Not following anyone yet'}
              </p>
              <p className="mt-1 max-w-xs text-sm text-ink-soft">
                {tab === 'followers'
                  ? 'When someone follows this account, they will show up here.'
                  : 'Accounts this profile follows will show up here.'}
              </p>
            </div>
          ) : (
            <div className="mt-2 divide-y divide-line">
              {items.map((account) => (
                <div key={account.user_id} className="flex items-center gap-3 py-3">
                  <Link href={`/profile/${account.user_id}`} className="shrink-0">
                    <img
                      className="h-12 w-12 rounded-full object-cover"
                      src={createBucketUrl(account.image)}
                      alt={`${account.name} avatar`}
                    />
                  </Link>

                  <Link href={`/profile/${account.user_id}`} className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-semibold text-ink">{account.name}</p>
                    <p className="truncate text-[13px] text-ink-soft">
                      {formatCount(account.follower_count)} followers
                      {account.bio ? ` · ${account.bio}` : ''}
                    </p>
                  </Link>

                  {/* Nothing to press on your own row -- following yourself is
                      not a thing the schema allows either. */}
                  {account.is_self ? (
                    <span className="shrink-0 text-[13px] font-semibold text-ink-soft">You</span>
                  ) : (
                    <button
                      onClick={() => toggleFollow(account)}
                      disabled={pendingId === account.user_id}
                      aria-pressed={account.is_following}
                      className={`shrink-0 rounded-md px-4 py-1.5 text-[14px] font-semibold transition-colors disabled:opacity-60 ${
                        account.is_following
                          ? 'border border-line text-ink hover:bg-surface-subtle'
                          : 'bg-tiktok text-white hover:bg-tiktok-hover'
                      }`}
                    >
                      {account.is_following ? 'Following' : 'Follow'}
                    </button>
                  )}
                </div>
              ))}

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
              ) : activeCount && activeCount > items.length ? (
                // The counter is global; the list is filtered for this viewer,
                // so blocked accounts legitimately make these disagree.
                <p className="py-4 text-center text-[13px] text-ink-soft">
                  Some accounts are hidden.
                </p>
              ) : null}
            </div>
          )}
        </ClientOnly>
      </div>

      <MobileBottomNav />
    </MainLayout>
  )
}

export default FollowersPage

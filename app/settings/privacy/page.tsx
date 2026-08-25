'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { MdBlock, MdVolumeOff } from 'react-icons/md'
import { IoArrowBack } from 'react-icons/io5'
import ClientOnly from '@/app/components/ClientOnly'
import MobileBottomNav from '@/app/components/MobileBottomNav'
import MainLayout from '@/app/layouts/MainLayout'
import { useUser } from '@/app/context/user'
import { useGeneralStore } from '@/app/stores/general'
import { createBucketUrl } from '@/app/hooks/useCreateBucketUrl'
import {
  fetchBlockedAccounts,
  fetchMutedAccounts,
  type ModeratedAccount,
} from '@/app/utils/accounts'
import { unblockUser, unmuteUser } from '@/app/utils/feed'
import { showToast } from '@/app/utils/toast'

type ListKind = 'blocked' | 'muted'

const COPY: Record<
  ListKind,
  { title: string; blurb: string; empty: string; action: string; icon: typeof MdBlock }
> = {
  blocked: {
    title: 'Blocked accounts',
    blurb:
      'Blocked accounts cannot see your videos in their feed, and you will not see theirs anywhere.',
    empty: 'You have not blocked anyone.',
    action: 'Unblock',
    icon: MdBlock,
  },
  muted: {
    title: 'Muted accounts',
    blurb:
      'Muted accounts stop being recommended in For You. They still appear in Following, search and on their own profile.',
    empty: 'You have not muted anyone.',
    action: 'Unmute',
    icon: MdVolumeOff,
  },
}

/**
 * Privacy settings: the undo side of Block and Mute.
 *
 * Both actions were one-way. blockUser() had a button and unblockUser() had no
 * caller at all, so a block could not be reversed from anywhere in the app;
 * mute had neither, which is why public.mutes could only ever be empty even
 * though get_feed has filtered it since 0002.
 *
 * Both lists come from RPCs that take no user argument -- the subject is
 * auth.uid() server-side, so this screen cannot be pointed at anybody else's
 * block list.
 */
const PrivacySettingsPage = () => {
  const { user, isCheckingUser } = useUser() || {}
  const { setIsLoginOpen } = useGeneralStore()

  const [blocked, setBlocked] = useState<ModeratedAccount[]>([])
  const [muted, setMuted] = useState<ModeratedAccount[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [hasError, setHasError] = useState<boolean>(false)
  const [reloadKey, setReloadKey] = useState<number>(0)
  const [pendingId, setPendingId] = useState<string | null>(null)

  useEffect(() => {
    // Waits for the auth check to settle: `user` is null both before and after
    // it, so acting on "logged out" early would show the sign-in prompt to
    // somebody who is signed in. Same guard the upload page uses.
    if (isCheckingUser) return

    if (!user?.id) {
      setBlocked([])
      setMuted([])
      setIsLoading(false)
      return
    }

    let active = true
    setIsLoading(true)
    setHasError(false)

    Promise.all([fetchBlockedAccounts(), fetchMutedAccounts()])
      .then(([blockedRows, mutedRows]) => {
        if (!active) return
        setBlocked(blockedRows)
        setMuted(mutedRows)
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
  }, [isCheckingUser, user?.id, reloadKey])

  /**
   * Optimistic removal with rollback, matching every other mutation in the
   * app. The row is spliced back at its original index on failure, so a failed
   * unblock does not silently reorder the list.
   */
  const remove = useCallback(
    async (kind: ListKind, account: ModeratedAccount) => {
      if (pendingId) return

      const setList = kind === 'blocked' ? setBlocked : setMuted
      const source = kind === 'blocked' ? blocked : muted
      const index = source.findIndex((item) => item.user_id === account.user_id)

      setPendingId(account.user_id)
      setList((current) => current.filter((item) => item.user_id !== account.user_id))

      try {
        if (kind === 'blocked') {
          await unblockUser(account.user_id)
          showToast(`Unblocked @${account.name}`)
        } else {
          await unmuteUser(account.user_id)
          showToast(`Unmuted @${account.name}`)
        }
      } catch (error) {
        console.error(error)
        setList((current) => {
          const restored = [...current]
          restored.splice(Math.max(index, 0), 0, account)
          return restored
        })
        showToast(
          kind === 'blocked' ? 'Could not unblock that account' : 'Could not unmute that account',
          'error'
        )
      } finally {
        setPendingId(null)
      }
    },
    [blocked, muted, pendingId]
  )

  const section = (kind: ListKind, accounts: ModeratedAccount[]) => {
    const copy = COPY[kind]
    const Icon = copy.icon

    return (
      <section className="mt-8 first:mt-6">
        <div className="flex items-center gap-2">
          <Icon size={19} className="text-ink-soft" />
          <h2 className="text-[17px] font-semibold text-ink">{copy.title}</h2>
          <span className="text-[14px] text-ink-soft">{accounts.length}</span>
        </div>
        <p className="mt-1 text-[13px] leading-5 text-ink-soft">{copy.blurb}</p>

        {accounts.length < 1 ? (
          <p className="mt-4 rounded-xl border border-line bg-surface-subtle px-4 py-6 text-center text-[14px] text-ink-soft">
            {copy.empty}
          </p>
        ) : (
          <div className="mt-3 divide-y divide-line border-t border-line">
            {accounts.map((account) => (
              <div key={account.user_id} className="flex items-center gap-3 py-3">
                <Link href={`/profile/${account.user_id}`} className="shrink-0">
                  <img
                    className="h-11 w-11 rounded-full object-cover"
                    src={createBucketUrl(account.image)}
                    alt={`${account.name} avatar`}
                  />
                </Link>
                <Link href={`/profile/${account.user_id}`} className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold text-ink">{account.name}</p>
                  {account.bio ? (
                    <p className="truncate text-[13px] text-ink-soft">{account.bio}</p>
                  ) : null}
                </Link>
                <button
                  onClick={() => remove(kind, account)}
                  disabled={pendingId === account.user_id}
                  className="shrink-0 rounded-md border border-line px-4 py-1.5 text-[14px] font-semibold text-ink hover:bg-surface-subtle disabled:opacity-60"
                >
                  {pendingId === account.user_id ? '...' : copy.action}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    )
  }

  return (
    <MainLayout>
      <div className="mx-auto w-full max-w-[700px] px-4 pb-24 pt-[80px] md:pl-[100px] lg:pl-[260px]">
        <div className="flex items-center gap-3">
          <Link
            href={user?.id ? `/profile/${user.id}` : '/'}
            aria-label="Back"
            className="rounded-full p-1.5 text-ink hover:bg-surface-subtle"
          >
            <IoArrowBack size={22} />
          </Link>
          <h1 className="text-[20px] font-bold text-ink">Privacy</h1>
        </div>

        <ClientOnly>
          {isCheckingUser || isLoading ? (
            <div className="mt-8 space-y-4">
              {[...Array(4)].map((_, index) => (
                <div key={index} className="flex items-center gap-3">
                  <div className="tt-shimmer h-11 w-11 rounded-full" />
                  <div className="flex-1">
                    <div className="tt-shimmer h-3.5 w-1/3 rounded" />
                    <div className="tt-shimmer mt-2 h-3 w-1/2 rounded" />
                  </div>
                  <div className="tt-shimmer h-8 w-20 rounded-md" />
                </div>
              ))}
            </div>
          ) : !user?.id ? (
            <div className="mt-16 flex flex-col items-center text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-subtle text-ink-soft">
                <MdBlock size={30} />
              </div>
              <p className="mt-4 text-lg font-semibold text-ink">Log in to manage privacy</p>
              <p className="mt-1 max-w-xs text-sm text-ink-soft">
                Accounts you block or mute will be listed here.
              </p>
              <button
                onClick={() => setIsLoginOpen(true)}
                className="mt-5 rounded-md bg-tiktok px-8 py-2.5 text-[15px] font-semibold text-white hover:bg-tiktok-hover"
              >
                Log in
              </button>
            </div>
          ) : hasError ? (
            <div className="mt-16 flex flex-col items-center text-center">
              <p className="text-lg font-semibold text-ink">Couldn&apos;t load your settings.</p>
              <button
                onClick={() => setReloadKey((key) => key + 1)}
                className="mt-4 rounded-full bg-tiktok px-6 py-2 text-sm font-semibold text-white hover:bg-tiktok-hover"
              >
                Retry
              </button>
            </div>
          ) : (
            <>
              {section('blocked', blocked)}
              {section('muted', muted)}
            </>
          )}
        </ClientOnly>
      </div>

      <MobileBottomNav />
    </MainLayout>
  )
}

export default PrivacySettingsPage

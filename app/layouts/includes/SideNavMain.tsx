import ClientOnly from '@/app/components/ClientOnly'
import { useUser } from '@/app/context/user'
import { useGeneralStore } from '@/app/stores/general'
import { usePostStore } from '@/app/stores/post'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import useGetFollowing from '@/app/hooks/useGetFollowing'
import { RandomUsers } from '@/app/types'
import { AiFillHome, AiOutlineHome } from 'react-icons/ai'
import { BsPerson, BsPersonFill } from 'react-icons/bs'
import { IoCompass, IoCompassOutline, IoSettings, IoSettingsOutline } from 'react-icons/io5'
import { RiUserFollowFill, RiUserFollowLine } from 'react-icons/ri'
import MenuItem from './MenuItem'
import MenuItemFollow from './MenuItemFollow'

const SideNavMain = () => {
  let { setRandomUsers, randomUsers } = useGeneralStore()

  const contextUser = useUser()
  const pathname = usePathname()
  const router = useRouter()
  const feedKind = usePostStore((state) => state.feedKind)
  const [followingUsers, setFollowingUsers] = useState<RandomUsers[]>([])

  useEffect(() => { setRandomUsers() }, [])

  useEffect(() => {
    const userId = contextUser?.user?.id
    if (!userId) {
      setFollowingUsers([])
      return
    }

    let active = true
    useGetFollowing(userId).then((users) => { if (active) setFollowingUsers(users) })

    return () => { active = false }
  }, [contextUser?.user?.id])

  /**
   * Switches the store directly instead of relying on the ?feed=following push
   * alone: from the home page that is a same-route navigation, which used to
   * leave this link doing nothing at all. The push still happens so the URL
   * stays shareable and the back button works.
   */
  const goToFollowingFeed = () => {
    if (!contextUser?.user?.id) {
      useGeneralStore.getState().setIsLoginOpen(true)
      return
    }

    usePostStore.getState().setFeedKind('following')

    if (pathname !== '/') {
      router.push('/?feed=following')
    }
  }

  return (
    <div
      id="SideNavMain"
      className={`
        fixed z-20 h-full overflow-auto border-r border-line bg-surface pt-[70px]
        lg:border-r-0
        ${pathname === '/' ? 'w-0 lg:w-[300px]' : 'lg:w-[220px]'}
      `}
    >
      <div className="mx-auto w-[55px] pb-24 lg:w-full lg:px-2">
        <MenuItem
          label="For You"
          href="/"
          icon={AiOutlineHome}
          iconActive={AiFillHome}
          active={pathname === '/' && feedKind !== 'following'}
          onClick={() => {
            usePostStore.getState().setFeedKind('for-you')
            if (pathname !== '/') router.push('/')
          }}
        />
        <MenuItem
          label="Explore"
          href="/explore"
          icon={IoCompassOutline}
          iconActive={IoCompass}
          active={pathname === '/explore'}
        />
        <MenuItem
          label="Following"
          href="/"
          icon={RiUserFollowLine}
          iconActive={RiUserFollowFill}
          active={pathname === '/' && feedKind === 'following'}
          onClick={goToFollowingFeed}
        />
        {contextUser?.user?.id ? (
          <>
            <MenuItem
              label="Profile"
              href={`/profile/${contextUser.user.id}`}
              icon={BsPerson}
              iconActive={BsPersonFill}
              active={pathname === `/profile/${contextUser.user.id}`}
            />
            {/* The only route to the blocked and muted lists. Without it a
                block was irreversible from anywhere in the app. */}
            <MenuItem
              label="Privacy"
              href="/settings/privacy"
              icon={IoSettingsOutline}
              iconActive={IoSettings}
              active={pathname.startsWith('/settings')}
            />
          </>
        ) : null}

        <div className="my-2 border-b border-line lg:mx-2" />

        {!contextUser?.user?.id ? (
          <div className="hidden px-2 py-2 lg:block">
            <p className="text-[13px] leading-5 text-ink-soft">
              Log in to follow creators, like videos, and view comments.
            </p>
            <button
              onClick={() => useGeneralStore.getState().setIsLoginOpen(true)}
              className="mt-3 w-full rounded-md border border-tiktok py-2 text-[15px] font-semibold text-tiktok transition-colors hover:bg-tiktok/5"
            >
              Log in
            </button>
          </div>
        ) : null}

        <h3 className="hidden px-2 pb-2 pt-4 text-[13px] font-semibold text-ink-soft lg:block">
          Suggested accounts
        </h3>
        <div className="block pt-3 lg:hidden" />
        <ClientOnly>
          <div className="cursor-pointer">
            {randomUsers?.map((user, index) => (
              <MenuItemFollow key={index} user={user} />
            ))}
          </div>
        </ClientOnly>
        <Link
          href="/explore"
          className="hidden pl-2 pt-1.5 text-[13px] font-semibold text-tiktok lg:block"
        >
          See all
        </Link>

        {/*
          Real follows now. This section used to render the same trending
          creators as "Suggested accounts" above it, under a heading that
          promised the opposite -- and it rendered even when you followed nobody.
        */}
        {contextUser?.user?.id && followingUsers.length > 0 ? (
          <div>
            <h3 className="hidden px-2 pb-2 pt-4 text-[13px] font-semibold text-ink-soft lg:block">
              Following accounts
            </h3>
            <div className="block pt-3 lg:hidden" />
            <ClientOnly>
              <div className="cursor-pointer">
                {followingUsers.map((user) => (
                  <MenuItemFollow key={user.id} user={user} />
                ))}
              </div>
            </ClientOnly>
            <button
              onClick={goToFollowingFeed}
              className="hidden pl-2 pt-1.5 text-[13px] font-semibold text-tiktok lg:block"
            >
              See more
            </button>
          </div>
        ) : null}

        <div className="mt-2 hidden border-b border-line lg:block lg:mx-2" />

        <div className="hidden px-2 text-[11px] leading-4 text-ink-soft lg:block">
          <p className="pt-4">About Newsroom TikTok Shop Contact Careers ByteDance</p>
          <p className="pt-3">TikTok for Good Advertise Developers Transparency TikTok Rewards</p>
          <p className="pt-3">Help Safety Terms Privacy Creator Portal Community Guidelines</p>
          <p className="pt-4">© {new Date().getFullYear()} TikTok Clone</p>
        </div>
      </div>
    </div>
  )
}

export default SideNavMain

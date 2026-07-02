import React, { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { AiFillHome, AiOutlineHome } from 'react-icons/ai'
import { IoCompass, IoCompassOutline } from 'react-icons/io5'
import { RiUserFollowFill, RiUserFollowLine, RiLiveFill, RiLiveLine } from 'react-icons/ri'
import { FaUserFriends } from 'react-icons/fa'
import { BsPersonFill, BsPerson } from 'react-icons/bs'
import MenuItem from './MenuItem'
import ClientOnly from '@/app/components/ClientOnly'
import MenuItemFollow from './MenuItemFollow'
import { useGeneralStore } from '@/app/stores/general'
import { useUser } from '@/app/context/user'

const SideNavMain = () => {
  let { setRandomUsers, randomUsers } = useGeneralStore()

  const contextUser = useUser()
  const pathname = usePathname()
  const router = useRouter()

  useEffect(() => { setRandomUsers() }, [])

  const requireAuth = (action: () => void) => {
    if (!contextUser?.user?.id) {
      useGeneralStore.getState().setIsLoginOpen(true)
      return
    }
    action()
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
          active={pathname === '/'}
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
          onClick={() => router.push('/?feed=following')}
        />
        <MenuItem
          label="Friends"
          href="/explore"
          icon={FaUserFriends}
          onClick={() => requireAuth(() => router.push('/explore'))}
        />
        <MenuItem
          label="LIVE"
          href="/live"
          icon={RiLiveLine}
          iconActive={RiLiveFill}
          active={pathname === '/live'}
        />
        {contextUser?.user?.id ? (
          <MenuItem
            label="Profile"
            href={`/profile/${contextUser.user.id}`}
            icon={BsPerson}
            iconActive={BsPersonFill}
            active={pathname === `/profile/${contextUser.user.id}`}
          />
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

        {contextUser?.user?.id ? (
          <div>
            <h3 className="hidden px-2 pb-2 pt-4 text-[13px] font-semibold text-ink-soft lg:block">
              Following accounts
            </h3>
            <div className="block pt-3 lg:hidden" />
            <ClientOnly>
              <div className="cursor-pointer">
                {randomUsers?.map((user, index) => (
                  <MenuItemFollow key={index} user={user} />
                ))}
              </div>
            </ClientOnly>
            <button className="hidden pl-2 pt-1.5 text-[13px] font-semibold text-tiktok lg:block">
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

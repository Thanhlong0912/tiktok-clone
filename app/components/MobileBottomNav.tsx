'use client'

import { usePathname, useRouter } from 'next/navigation'
import { AiFillHome, AiOutlineHome } from 'react-icons/ai'
import { IoCompass, IoCompassOutline, IoAdd } from 'react-icons/io5'
import { BiBell, BiSolidBell } from 'react-icons/bi'
import { BsPersonFill, BsPerson } from 'react-icons/bs'
import { useEffect, useState } from 'react'
import { useUser } from '../context/user'
import { useGeneralStore } from '../stores/general'
import { fetchUnreadNotificationCount } from '../utils/notifications'

interface MobileBottomNavProps {
  /** Rendered over a dark video feed (transparent bg) vs. a normal page (solid bg). */
  variant?: 'overlay' | 'solid'
}

const MobileBottomNav = ({ variant = 'solid' }: MobileBottomNavProps) => {
  const router = useRouter()
  const pathname = usePathname()
  const { user, isCheckingUser } = useUser() || {}
  const { setIsLoginOpen } = useGeneralStore()

  /**
   * Same race as TopNav's Upload button: `user` is null before the auth check
   * settles as well as after it, so a tap landing in that window prompted a
   * signed-in visitor to log in.
   *
   * Only safe for a fixed target. `/profile/${user?.id}` cannot be built until
   * the check resolves -- routing early would navigate to /profile/undefined.
   */
  const requireAuth = (target: string) => {
    if (!user?.id) {
      // Mid-check there is nothing to prompt about yet and no id to route
      // with, so the tap is ignored rather than guessing wrong.
      if (!isCheckingUser) setIsLoginOpen(true)
      return
    }
    router.push(target)
  }

  /** The upload page waits for the same flag, so it can settle this itself. */
  const goToUpload = () => {
    if (!user?.id && !isCheckingUser) {
      setIsLoginOpen(true)
      return
    }
    router.push('/upload')
  }

  const [unreadCount, setUnreadCount] = useState<number>(0)

  useEffect(() => {
    if (!user?.id) {
      setUnreadCount(0)
      return
    }

    let active = true
    fetchUnreadNotificationCount()
      .then((count) => { if (active) setUnreadCount(count) })
      .catch(() => null)

    return () => { active = false }
  }, [user?.id, pathname])

  const isHome = pathname === '/'
  const isExplore = pathname === '/explore'
  const isActivity = pathname === '/activity'
  const isProfile = pathname?.startsWith('/profile')

  const isOverlay = variant === 'overlay'
  const shell = isOverlay
    ? 'border-t border-white/10 bg-black/85 text-white backdrop-blur-md'
    : 'border-t border-line bg-surface text-ink'
  const inactive = isOverlay ? 'text-white/70' : 'text-ink-soft'

  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-40 px-2 pb-[calc(env(safe-area-inset-bottom)+6px)] pt-1.5 md:hidden ${shell}`}
    >
      <div className="grid grid-cols-5 items-end">
        <NavButton
          label="Home"
          active={isHome}
          inactiveClass={inactive}
          onClick={() => router.push('/')}
          Icon={isHome ? AiFillHome : AiOutlineHome}
        />
        <NavButton
          label="Explore"
          active={isExplore}
          inactiveClass={inactive}
          onClick={() => router.push('/explore')}
          Icon={isExplore ? IoCompass : IoCompassOutline}
        />

        <button
          onClick={() => goToUpload()}
          className="flex justify-center pb-1"
          aria-label="Upload"
        >
          <span className="relative inline-flex h-8 w-[46px] items-center justify-center rounded-lg bg-white">
            <span className="absolute -left-1 h-full w-full rounded-lg bg-tiktok-cyan" />
            <span className="absolute -right-1 h-full w-full rounded-lg bg-tiktok" />
            <span className="relative inline-flex h-full w-[46px] items-center justify-center rounded-lg bg-white text-black">
              <IoAdd size={22} />
            </span>
          </span>
        </button>

        {/*
          Was labelled "Inbox" with message-bubble icons while routing to
          notifications. There is no messaging in this app, so the label now
          matches the destination.
        */}
        <NavButton
          label="Activity"
          active={isActivity}
          inactiveClass={inactive}
          onClick={() => requireAuth('/activity')}
          Icon={isActivity ? BiSolidBell : BiBell}
          badge={unreadCount}
        />
        <NavButton
          label="Profile"
          active={!!isProfile}
          inactiveClass={inactive}
          onClick={() => requireAuth(`/profile/${user?.id}`)}
          Icon={isProfile ? BsPersonFill : BsPerson}
        />
      </div>
    </div>
  )
}

const NavButton = ({
  label,
  Icon,
  active,
  inactiveClass,
  onClick,
  badge = 0,
}: {
  label: string
  Icon: React.ComponentType<{ size?: number }>
  active: boolean
  inactiveClass: string
  onClick: () => void
  badge?: number
}) => (
  <button
    onClick={onClick}
    // aria-current is the only thing that conveyed the active tab to assistive
    // tech; it used to be signalled by font weight alone.
    aria-current={active ? 'page' : undefined}
    className={`flex flex-col items-center gap-0.5 text-[10px] font-medium ${
      active ? 'font-semibold' : inactiveClass
    }`}
  >
    <span className="relative">
      <Icon size={22} />
      {badge > 0 ? (
        <span
          aria-label={`${badge} unread`}
          className="absolute -right-2 -top-1 min-w-[16px] rounded-full bg-tiktok px-1 text-[10px] font-bold leading-4 text-white"
        >
          {badge > 99 ? '99+' : badge}
        </span>
      ) : null}
    </span>
    <span>{label}</span>
  </button>
)

export default MobileBottomNav

'use client'

import { usePathname, useRouter } from 'next/navigation'
import { AiFillHome, AiOutlineHome } from 'react-icons/ai'
import { IoCompass, IoCompassOutline, IoAdd } from 'react-icons/io5'
import { BiMessageDetail, BiMessageRounded } from 'react-icons/bi'
import { BsPersonFill, BsPerson } from 'react-icons/bs'
import { useUser } from '../context/user'
import { useGeneralStore } from '../stores/general'

interface MobileBottomNavProps {
  /** Rendered over a dark video feed (transparent bg) vs. a normal page (solid bg). */
  variant?: 'overlay' | 'solid'
}

const MobileBottomNav = ({ variant = 'solid' }: MobileBottomNavProps) => {
  const router = useRouter()
  const pathname = usePathname()
  const { user } = useUser() || {}
  const { setIsLoginOpen } = useGeneralStore()

  const requireAuth = (target: string) => {
    if (!user?.id) {
      setIsLoginOpen(true)
      return
    }
    router.push(target)
  }

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
          onClick={() => requireAuth('/upload')}
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

        <NavButton
          label="Inbox"
          active={isActivity}
          inactiveClass={inactive}
          onClick={() => requireAuth('/activity')}
          Icon={isActivity ? BiMessageDetail : BiMessageRounded}
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
}: {
  label: string
  Icon: React.ComponentType<{ size?: number }>
  active: boolean
  inactiveClass: string
  onClick: () => void
}) => (
  <button
    onClick={onClick}
    className={`flex flex-col items-center gap-0.5 text-[10px] font-medium ${
      active ? 'font-semibold' : inactiveClass
    }`}
  >
    <Icon size={22} />
    <span>{label}</span>
  </button>
)

export default MobileBottomNav

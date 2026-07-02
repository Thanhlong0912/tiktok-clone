'use client'

import { useState } from 'react'
import { AiFillHeart } from 'react-icons/ai'
import { FaCommentDots, FaUserPlus } from 'react-icons/fa'
import { BiBell } from 'react-icons/bi'
import MainLayout from '../layouts/MainLayout'
import MobileBottomNav from '../components/MobileBottomNav'
import { useUser } from '../context/user'
import { useGeneralStore } from '../stores/general'

const TABS = [
  { id: 'all', label: 'All activity', icon: BiBell },
  { id: 'likes', label: 'Likes', icon: AiFillHeart },
  { id: 'comments', label: 'Comments', icon: FaCommentDots },
  { id: 'followers', label: 'Followers', icon: FaUserPlus },
] as const

export default function ActivityPage() {
  const { user } = useUser() || {}
  const { setIsLoginOpen } = useGeneralStore()
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('all')
  const active = TABS.find((t) => t.id === tab)!

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
        ) : (
          <div className="mt-16 flex flex-col items-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-subtle text-ink-soft">
              <active.icon size={30} />
            </div>
            <p className="mt-4 text-lg font-semibold text-ink">No {active.label.toLowerCase()} yet</p>
            <p className="mt-1 max-w-xs text-sm text-ink-soft">
              When people interact with your videos, you&apos;ll see it here.
            </p>
          </div>
        )}
      </div>

      <MobileBottomNav />
    </MainLayout>
  )
}

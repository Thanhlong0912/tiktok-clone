'use client'

import { RiLiveFill } from 'react-icons/ri'
import MainLayout from '../layouts/MainLayout'
import MobileBottomNav from '../components/MobileBottomNav'

export default function LivePage() {
  return (
    <MainLayout>
      <div className="mx-auto w-full max-w-[1140px] px-4 pb-24 pt-[76px] md:pl-[80px] lg:pl-[240px]">
        <div className="flex items-center gap-2">
          <RiLiveFill className="text-tiktok" size={26} />
          <h1 className="text-[24px] font-bold text-ink">LIVE</h1>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="overflow-hidden rounded-xl bg-surface-subtle">
              <div className="relative aspect-[9/13] w-full animate-pulse bg-gradient-to-br from-surface-subtle to-line">
                <span className="absolute left-2 top-2 rounded bg-tiktok px-1.5 py-0.5 text-[10px] font-bold text-white">
                  LIVE
                </span>
              </div>
              <div className="px-2 py-2">
                <div className="h-3 w-3/4 rounded bg-line" />
                <div className="mt-2 h-2 w-1/2 rounded bg-line" />
              </div>
            </div>
          ))}
        </div>

        <p className="mt-10 text-center text-sm text-ink-soft">
          Live streaming is coming soon to this clone.
        </p>
      </div>

      <MobileBottomNav />
    </MainLayout>
  )
}

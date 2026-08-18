import Link from 'next/link'
import { BiSearchAlt } from 'react-icons/bi'

export const metadata = { title: 'Page not found' }

/** Reached by an unmatched route and by notFound() calls from the app. */
export default function NotFound() {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-surface px-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-subtle text-ink-soft">
        <BiSearchAlt size={32} />
      </div>

      <h1 className="mt-5 text-[22px] font-bold text-ink">This page isn&apos;t available.</h1>
      <p className="mt-2 max-w-sm text-[15px] text-ink-soft">
        The link may be broken, or the video or account may have been removed.
      </p>

      <div className="mt-6 flex items-center gap-3">
        <Link
          href="/"
          className="rounded-md bg-tiktok px-6 py-2.5 text-[15px] font-semibold text-white transition-colors hover:bg-tiktok-hover"
        >
          Go to feed
        </Link>
        <Link
          href="/explore"
          className="rounded-md border border-line px-6 py-2.5 text-[15px] font-semibold text-ink transition-colors hover:bg-surface-subtle"
        >
          Explore
        </Link>
      </div>
    </div>
  )
}

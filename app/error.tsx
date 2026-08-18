'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { BiErrorCircle } from 'react-icons/bi'

/**
 * Root error boundary. Without one, any render throw anywhere in the app showed
 * the framework's default error screen -- unbranded, unthemed, and with no way
 * back other than the browser's back button.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-surface px-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-subtle text-ink-soft">
        <BiErrorCircle size={32} />
      </div>

      <h1 className="mt-5 text-[22px] font-bold text-ink">Something went wrong.</h1>
      <p className="mt-2 max-w-sm text-[15px] text-ink-soft">
        This page didn&apos;t load. Try again, and if it keeps happening head back to the feed.
      </p>

      <div className="mt-6 flex items-center gap-3">
        <button
          onClick={reset}
          className="rounded-md bg-tiktok px-6 py-2.5 text-[15px] font-semibold text-white transition-colors hover:bg-tiktok-hover"
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded-md border border-line px-6 py-2.5 text-[15px] font-semibold text-ink transition-colors hover:bg-surface-subtle"
        >
          Go to feed
        </Link>
      </div>

      {error.digest ? (
        <p className="mt-6 font-mono text-[12px] text-ink-soft">Reference: {error.digest}</p>
      ) : null}
    </div>
  )
}

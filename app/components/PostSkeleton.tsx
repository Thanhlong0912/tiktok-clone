'use client'

/**
 * Placeholder shown while the video feed is loading.
 * Mobile: full-screen dark placeholder. Desktop: 9/16 card with shimmer rail.
 */
const PostSkeleton = () => (
  <div className="snap-start h-[100dvh] md:h-[calc(100vh-60px)]">
    {/* Mobile */}
    <div className="relative h-full w-full bg-black md:hidden">
      <div className="absolute inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+74px)] px-4">
        <div className="mb-3 flex items-center gap-2">
          <div className="tt-shimmer h-10 w-10 rounded-full" />
          <div className="tt-shimmer h-4 w-28 rounded" />
        </div>
        <div className="tt-shimmer h-3 w-2/3 rounded" />
        <div className="tt-shimmer mt-2 h-3 w-1/3 rounded" />
      </div>
      <div className="absolute bottom-[calc(env(safe-area-inset-bottom)+80px)] right-3 flex w-[60px] flex-col items-center gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="tt-shimmer h-11 w-11 rounded-full" />
        ))}
      </div>
    </div>

    {/* Desktop */}
    <div className="hidden h-full w-full items-center justify-center md:flex">
      <div className="flex h-full items-end gap-3 py-4">
        <div
          className="tt-shimmer relative h-full max-h-[calc(100vh-92px)] rounded-2xl"
          style={{ aspectRatio: '9 / 16' }}
        />
        <div className="flex flex-col items-center gap-4 pb-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="tt-shimmer h-12 w-12 rounded-full" />
          ))}
        </div>
      </div>
    </div>
  </div>
)

export default PostSkeleton

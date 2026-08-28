import { useEffect } from 'react'
import { feedWatchSession } from '../utils/feedWatch'
import { slideshowProgress } from '../utils/slideshowProgress'

/**
 * Interval between samples, in ms.
 *
 * Load-bearing, and the reason this is a ticker rather than a callback on slide
 * change. WatchSession ignores any gap longer than its maxSampleGapMs (1500ms)
 * so a backgrounded tab cannot bank wall-clock time as watch time -- so
 * sampling once per 3-second slide would be discarded on every single sample
 * and record a permanent zero. Pinned by a test in slideshowProgress.test.ts.
 */
const SAMPLE_INTERVAL_MS = 500

interface SlideshowWatchSampler {
  postId: string
  /** True only while this slideshow is the one actually playing. */
  isActive: boolean
  slideCount: number
  /** The Speed preference, which stretches or compresses the cycle. */
  speed: number
}

/**
 * Feeds a photo post's progress to the shared watch session, so it earns a
 * view, a completion and creator/topic affinity the way a video does.
 *
 * Does NOT call start() or flush(): exactly one post is active at a time and
 * the surface that decides which one owns that lifecycle, the same as it does
 * for video.
 */
export default function useSlideshowWatchSampler({
  postId,
  isActive,
  slideCount,
  speed,
}: SlideshowWatchSampler): void {
  useEffect(() => {
    if (!isActive || slideCount < 1 || !postId) return

    // Measured from when this slideshow became active rather than from a
    // mount: a card can be mounted well before it is the one on screen.
    const startedAt = Date.now()

    const timer = setInterval(() => {
      feedWatchSession.sample(
        postId,
        slideshowProgress(Date.now() - startedAt, slideCount, speed)
      )
    }, SAMPLE_INTERVAL_MS)

    return () => clearInterval(timer)
  }, [postId, isActive, slideCount, speed])
}

import { IMAGE_SLIDE_DURATION_MS } from './postMedia'

/**
 * Where a photo post is up to, in the shape WatchSession already speaks.
 *
 * A slideshow has no media element, so there is no `timeupdate` and no
 * `currentTime` to read -- which is why image posts recorded no watch at all:
 * WatchSession.start() ran for them, nothing ever called sample(), and flush()
 * then dropped the session on its "nothing observed" guard. No view, no
 * completion, no affinity, and no row in post_views, so get_feed's permanent
 * "already watched" exclusion never applied and a photo post the viewer had
 * seen kept coming back.
 *
 * Expressing progress as seconds-into-a-duration means the sampling path is
 * identical for both media types rather than a second code path.
 */

export interface SlideshowProgress {
  /** Seconds into the current cycle. */
  currentTime: number
  /** Seconds for one full pass over every slide. */
  duration: number
}

/**
 * Wraps at the end of a cycle rather than running past it, so a looping
 * slideshow reads as a repeat. WatchSession sees currentTime jump backwards
 * and counts a loop, exactly as it does for a looping <video>.
 */
export function slideshowProgress(
  elapsedMs: number,
  slideCount: number,
  speed: number,
  slideDurationMs: number = IMAGE_SLIDE_DURATION_MS
): SlideshowProgress {
  const slides = Math.max(Math.floor(slideCount), 0)
  // A zero or negative rate would divide the cycle to nothing or to a negative
  // duration; the players treat it the same way.
  const rate = speed > 0 ? speed : 1
  const totalMs = (slides * slideDurationMs) / rate

  if (slides < 1 || totalMs <= 0) {
    return { currentTime: 0, duration: 0 }
  }

  const elapsed = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0

  return {
    currentTime: (elapsed % totalMs) / 1000,
    duration: totalMs / 1000,
  }
}

/**
 * Accumulates how a viewer actually watched a post and flushes it as ONE
 * record_watch call, rather than one call per timeupdate event.
 *
 * The feed fires timeupdate roughly 4x a second per playing video; sending
 * those straight through would be thousands of writes per session. This batches
 * them into a single call when the post stops being active.
 *
 * Pure and injectable: the clock and the sender are constructor arguments, so
 * the batching rules can be tested without a browser or a database.
 */

export interface WatchSample {
  /** Playback position in seconds. */
  currentTime: number
  /** Media duration in seconds. NaN/0 while metadata is still loading. */
  duration: number
}

export interface WatchFlush {
  postId: string
  watchMs: number
  completion: number
  loops: number
  skipped: boolean
}

export interface WatchSessionOptions {
  now: () => number
  send: (flush: WatchFlush) => void
  /**
   * Below this, a view is treated as a skip rather than a watch. Matches the
   * 2000ms threshold get_feed uses to decide a post was really seen.
   */
  skipBelowMs?: number
  /**
   * Ignores gaps larger than this between samples. A backgrounded tab or a
   * paused video would otherwise bank the whole wall-clock gap as watch time.
   */
  maxSampleGapMs?: number
}

interface ActiveWatch {
  postId: string
  lastAt: number
  watchMs: number
  maxCompletion: number
  loops: number
  lastTime: number
  /** Whether a short watch on this surface means "skipped". See start(). */
  canSkip: boolean
}

const DEFAULT_SKIP_BELOW_MS = 2000
const DEFAULT_MAX_GAP_MS = 1500

export class WatchSession {
  private active: ActiveWatch | null = null
  private readonly options: Required<WatchSessionOptions>

  constructor(options: WatchSessionOptions) {
    this.options = {
      skipBelowMs: DEFAULT_SKIP_BELOW_MS,
      maxSampleGapMs: DEFAULT_MAX_GAP_MS,
      ...options,
    }
  }

  /**
   * Called when a post becomes the active one. Flushes any previous post.
   *
   * `canSkip` says whether a short watch means anything here. In the feed it
   * does: the viewer was shown this post and moved past it, which is the whole
   * basis of the skip signal. On a surface the viewer navigated to on purpose
   * -- a permalink, a shared link -- it does not. There, a short watch is at
   * least as likely to be the browser suspending an unmuted autoplay as it is
   * disinterest, and reporting it would apply the ranking skip penalty to a
   * post somebody deliberately opened.
   */
  start(postId: string, options: { canSkip?: boolean } = {}): void {
    if (this.active && this.active.postId === postId) return

    this.flush()
    this.active = {
      postId,
      lastAt: this.options.now(),
      watchMs: 0,
      maxCompletion: 0,
      loops: 0,
      lastTime: 0,
      canSkip: options.canSkip ?? true,
    }
  }

  /**
   * Called on timeupdate. Accrues wall-clock time between samples rather than
   * trusting currentTime deltas, which jump on seek.
   */
  sample(postId: string, sample: WatchSample): void {
    if (!this.active || this.active.postId !== postId) return

    const at = this.options.now()
    const gap = at - this.active.lastAt
    this.active.lastAt = at

    if (gap > 0 && gap <= this.options.maxSampleGapMs) {
      this.active.watchMs += gap
    }

    const duration = sample.duration
    if (isFinite(duration) && duration > 0) {
      const completion = Math.max(0, Math.min(1, sample.currentTime / duration))
      if (completion > this.active.maxCompletion) {
        this.active.maxCompletion = completion
      }
    }

    // currentTime jumping backwards while playing means the video looped.
    if (sample.currentTime + 0.5 < this.active.lastTime) {
      this.active.loops += 1
    }
    this.active.lastTime = sample.currentTime
  }

  /** Called when a video runs to its end, which is a completion regardless of sampling. */
  complete(postId: string): void {
    if (!this.active || this.active.postId !== postId) return
    this.active.maxCompletion = 1
    this.active.loops += 1
    this.active.lastTime = 0
  }

  /**
   * Emits the accumulated watch for the active post and clears it.
   * A no-op when nothing is active, so it is safe to call from cleanup paths.
   */
  flush(): void {
    const active = this.active
    this.active = null
    if (!active) return

    // Nothing observed at all -- an impression that never played. Recording it
    // would inflate view_count without any signal to show for it.
    if (active.watchMs < 1 && active.maxCompletion < 0.01) return

    this.options.send({
      postId: active.postId,
      watchMs: Math.round(active.watchMs),
      completion: active.maxCompletion,
      loops: active.loops,
      skipped:
        active.canSkip &&
        active.watchMs < this.options.skipBelowMs &&
        active.maxCompletion < 0.4,
    })
  }

  /** The post currently being measured, for tests and debugging. */
  activePostId(): string | null {
    return this.active ? this.active.postId : null
  }
}

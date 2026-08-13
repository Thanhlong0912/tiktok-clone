import { recordWatch } from './feed'
import { WatchSession } from './watchSession'

/**
 * One shared watch session for the whole app.
 *
 * Exactly one post is the active one at a time, and WatchSession.start()
 * flushes the previous post automatically -- so a single instance both measures
 * correctly and guarantees a card can never leave the viewport without
 * reporting what was watched.
 */
export const feedWatchSession = new WatchSession({
  now: () => Date.now(),
  send: (flush) => {
    recordWatch({
      postId: flush.postId,
      watchMs: flush.watchMs,
      completion: flush.completion,
      loops: flush.loops,
      skipped: flush.skipped,
    })
  },
})

if (typeof window !== 'undefined') {
  // A closed tab or a backgrounded app would otherwise lose the current post's
  // watch entirely. visibilitychange is the one that actually fires on mobile.
  const flush = () => feedWatchSession.flush()
  window.addEventListener('pagehide', flush)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush()
  })
}

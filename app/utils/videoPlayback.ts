const VIDEO_PLAYBACK_SNAPSHOT_KEY = 'tiktok-clone-video-playback-snapshot'
const VIDEO_PLAYBACK_SNAPSHOT_MAX_AGE_MS = 5 * 60 * 1000
const VIDEO_NAVIGATION_PAUSE_MS = 1600

type VideoPlaybackSnapshotInput = {
  postId: string
  userId?: string
  video: HTMLVideoElement | null
  source: 'feed' | 'profile' | 'detail'
}

export type VideoPlaybackSnapshot = {
  postId: string
  userId?: string
  currentTime: number
  duration?: number
  wasPlaying: boolean
  source: 'feed' | 'profile' | 'detail'
  savedAt: number
}

const canUseSessionStorage = () => {
  if (typeof window === 'undefined') {
    return false
  }

  try {
    return Boolean(window.sessionStorage)
  } catch {
    return false
  }
}

const isRenderableVideo = (video: HTMLVideoElement) => {
  if (typeof window === 'undefined') {
    return true
  }

  return video.getClientRects().length > 0 && window.getComputedStyle(video).visibility !== 'hidden'
}

const getFiniteVideoTime = (time: number) => (Number.isFinite(time) && time > 0 ? time : 0)

export const pauseOtherVideos = (currentVideo: HTMLVideoElement | null, selector = 'video') => {
  if (typeof document === 'undefined' || !currentVideo) {
    return
  }

  if (!isRenderableVideo(currentVideo)) {
    currentVideo.pause()
    return
  }

  const videos = document.querySelectorAll<HTMLVideoElement>(selector)

  videos.forEach((video) => {
    if (video !== currentVideo && !video.paused) {
      video.pause()
    }
  })
}

export const pauseAllVideos = (selector = 'video') => {
  if (typeof document === 'undefined') {
    return
  }

  document.querySelectorAll<HTMLVideoElement>(selector).forEach((video) => {
    video.pause()
  })
}

export const pauseVideosDuringNavigation = (selector = 'video', durationMs = VIDEO_NAVIGATION_PAUSE_MS) => {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return
  }

  const videos = Array.from(document.querySelectorAll<HTMLVideoElement>(selector))
  if (videos.length < 1) {
    return
  }

  const pauseTrackedVideos = () => {
    videos.forEach((video) => {
      if (!video.paused) {
        video.pause()
      }
    })
  }

  const pauseOnPlay = (event: Event) => {
    const video = event.currentTarget as HTMLVideoElement | null
    if (!video) {
      return
    }

    window.requestAnimationFrame(() => {
      if (!video.paused) {
        video.pause()
      }
    })
  }

  videos.forEach((video) => {
    video.addEventListener('play', pauseOnPlay)
  })
  pauseTrackedVideos()

  const intervalId = window.setInterval(pauseTrackedVideos, 80)
  window.setTimeout(() => {
    window.clearInterval(intervalId)
    videos.forEach((video) => {
      video.removeEventListener('play', pauseOnPlay)
    })
  }, durationMs)
}

export const rememberVideoPlayback = ({ postId, userId, video, source }: VideoPlaybackSnapshotInput) => {
  if (!video || !postId || !canUseSessionStorage()) {
    return
  }

  const currentTime = getFiniteVideoTime(video.currentTime)
  const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : undefined

  const snapshot: VideoPlaybackSnapshot = {
    postId,
    userId,
    currentTime,
    duration,
    wasPlaying: !video.paused && !video.ended,
    source,
    savedAt: Date.now(),
  }

  try {
    window.sessionStorage.setItem(VIDEO_PLAYBACK_SNAPSHOT_KEY, JSON.stringify(snapshot))
  } catch {
    // Ignore storage failures; playback should still navigate normally.
  }
}

export const getRememberedVideoPlayback = (postId: string) => {
  if (!postId || !canUseSessionStorage()) {
    return null
  }

  const rawSnapshot = window.sessionStorage.getItem(VIDEO_PLAYBACK_SNAPSHOT_KEY)
  if (!rawSnapshot) {
    return null
  }

  try {
    const snapshot = JSON.parse(rawSnapshot) as VideoPlaybackSnapshot
    if (
      snapshot.postId !== postId ||
      !Number.isFinite(snapshot.currentTime) ||
      !Number.isFinite(snapshot.savedAt) ||
      Date.now() - snapshot.savedAt > VIDEO_PLAYBACK_SNAPSHOT_MAX_AGE_MS
    ) {
      window.sessionStorage.removeItem(VIDEO_PLAYBACK_SNAPSHOT_KEY)
      return null
    }

    return snapshot
  } catch {
    window.sessionStorage.removeItem(VIDEO_PLAYBACK_SNAPSHOT_KEY)
    return null
  }
}

export const clearRememberedVideoPlayback = (postId: string) => {
  if (!postId || !canUseSessionStorage()) {
    return
  }

  const snapshot = getRememberedVideoPlayback(postId)
  if (snapshot?.postId === postId) {
    window.sessionStorage.removeItem(VIDEO_PLAYBACK_SNAPSHOT_KEY)
  }
}

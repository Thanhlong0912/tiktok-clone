const VIDEO_SPEED_PREF_KEY = 'tiktok-clone-video-speed'
const VIDEO_SPEED_CHANGE_EVENT = 'tiktok-clone-video-speed-change'

export const DEFAULT_VIDEO_SPEED = 1

/** The five rates offered in the options menu, in menu order. */
export const PLAYBACK_SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const

export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number]

/**
 * Snaps to one of PLAYBACK_SPEEDS. A rate that is not on the list can only come
 * from a hand-edited or stale localStorage value, and handing an arbitrary
 * number to playbackRate makes the menu's selected pill disagree with what is
 * actually playing -- fall back to 1 rather than show a lie.
 */
export const normalizeSpeed = (value: unknown): PlaybackSpeed => {
  const parsed = typeof value === 'string' ? Number.parseFloat(value) : Number(value)

  if (!Number.isFinite(parsed)) {
    return DEFAULT_VIDEO_SPEED
  }

  return PLAYBACK_SPEEDS.find((speed) => speed === parsed) ?? DEFAULT_VIDEO_SPEED
}

export const getVideoSpeed = (): PlaybackSpeed => {
  if (typeof window === 'undefined') {
    return DEFAULT_VIDEO_SPEED
  }

  return normalizeSpeed(window.localStorage.getItem(VIDEO_SPEED_PREF_KEY))
}

export const setVideoSpeed = (speed: number) => {
  if (typeof window === 'undefined') {
    return
  }

  const normalized = normalizeSpeed(speed)
  window.localStorage.setItem(VIDEO_SPEED_PREF_KEY, String(normalized))
  window.dispatchEvent(new CustomEvent<number>(VIDEO_SPEED_CHANGE_EVENT, { detail: normalized }))
}

export const subscribeToVideoSpeed = (onChange: (speed: PlaybackSpeed) => void) => {
  if (typeof window === 'undefined') {
    return () => {}
  }

  const handler = (event: Event) => {
    const customEvent = event as CustomEvent<number>
    onChange(normalizeSpeed(customEvent.detail))
  }

  window.addEventListener(VIDEO_SPEED_CHANGE_EVENT, handler)
  return () => window.removeEventListener(VIDEO_SPEED_CHANGE_EVENT, handler)
}

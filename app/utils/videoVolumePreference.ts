const VIDEO_VOLUME_PREF_KEY = 'tiktok-clone-video-volume'
const VIDEO_VOLUME_CHANGE_EVENT = 'tiktok-clone-video-volume-change'

export const DEFAULT_VIDEO_VOLUME = 1

/**
 * Volume is stored separately from the mute flag in videoSoundPreference: muting
 * must not lose the level the viewer had chosen, so unmuting can restore it.
 * Pure, so the parsing of a hand-edited localStorage value is testable.
 */
export const clampVolume = (value: unknown): number => {
  // Number(null) is 0 and Number('') is 0, so an absent value would otherwise
  // read as "silent" rather than "unset".
  if (value === null || value === undefined || value === '') {
    return DEFAULT_VIDEO_VOLUME
  }

  const parsed = typeof value === 'string' ? Number.parseFloat(value) : Number(value)

  if (!Number.isFinite(parsed)) {
    return DEFAULT_VIDEO_VOLUME
  }

  return Math.min(1, Math.max(0, parsed))
}

export const getVideoVolume = () => {
  if (typeof window === 'undefined') {
    return DEFAULT_VIDEO_VOLUME
  }

  const stored = window.localStorage.getItem(VIDEO_VOLUME_PREF_KEY)
  if (stored === null) {
    return DEFAULT_VIDEO_VOLUME
  }

  return clampVolume(stored)
}

export const setVideoVolume = (volume: number) => {
  if (typeof window === 'undefined') {
    return
  }

  const clamped = clampVolume(volume)
  window.localStorage.setItem(VIDEO_VOLUME_PREF_KEY, String(clamped))
  window.dispatchEvent(new CustomEvent<number>(VIDEO_VOLUME_CHANGE_EVENT, { detail: clamped }))
}

export const subscribeToVideoVolume = (onChange: (volume: number) => void) => {
  if (typeof window === 'undefined') {
    return () => {}
  }

  const handler = (event: Event) => {
    const customEvent = event as CustomEvent<number>
    onChange(clampVolume(customEvent.detail))
  }

  window.addEventListener(VIDEO_VOLUME_CHANGE_EVENT, handler)
  return () => window.removeEventListener(VIDEO_VOLUME_CHANGE_EVENT, handler)
}

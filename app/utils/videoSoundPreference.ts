const VIDEO_SOUND_PREF_KEY = 'tiktok-clone-video-sound-enabled'
const VIDEO_SOUND_CHANGE_EVENT = 'tiktok-clone-video-sound-change'

export const getVideoSoundEnabled = () => {
  if (typeof window === 'undefined') {
    return false
  }

  return window.localStorage.getItem(VIDEO_SOUND_PREF_KEY) === '1'
}

export const setVideoSoundEnabled = (enabled: boolean) => {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(VIDEO_SOUND_PREF_KEY, enabled ? '1' : '0')
  window.dispatchEvent(new CustomEvent<boolean>(VIDEO_SOUND_CHANGE_EVENT, { detail: enabled }))
}

export const subscribeToVideoSoundPreference = (onChange: (enabled: boolean) => void) => {
  if (typeof window === 'undefined') {
    return () => {}
  }

  const handler = (event: Event) => {
    const customEvent = event as CustomEvent<boolean>
    onChange(Boolean(customEvent.detail))
  }

  window.addEventListener(VIDEO_SOUND_CHANGE_EVENT, handler)
  return () => window.removeEventListener(VIDEO_SOUND_CHANGE_EVENT, handler)
}

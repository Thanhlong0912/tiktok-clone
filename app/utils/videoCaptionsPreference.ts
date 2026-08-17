const VIDEO_CAPTIONS_PREF_KEY = 'tiktok-clone-video-captions-enabled'
const VIDEO_CAPTIONS_CHANGE_EVENT = 'tiktok-clone-video-captions-change'

export const getVideoCaptionsEnabled = () => {
  if (typeof window === 'undefined') {
    return false
  }

  return window.localStorage.getItem(VIDEO_CAPTIONS_PREF_KEY) === '1'
}

export const setVideoCaptionsEnabled = (enabled: boolean) => {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(VIDEO_CAPTIONS_PREF_KEY, enabled ? '1' : '0')
  window.dispatchEvent(new CustomEvent<boolean>(VIDEO_CAPTIONS_CHANGE_EVENT, { detail: enabled }))
}

export const subscribeToVideoCaptionsPreference = (onChange: (enabled: boolean) => void) => {
  if (typeof window === 'undefined') {
    return () => {}
  }

  const handler = (event: Event) => {
    const customEvent = event as CustomEvent<boolean>
    onChange(Boolean(customEvent.detail))
  }

  window.addEventListener(VIDEO_CAPTIONS_CHANGE_EVENT, handler)
  return () => window.removeEventListener(VIDEO_CAPTIONS_CHANGE_EVENT, handler)
}

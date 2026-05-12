const VIDEO_AUTO_SCROLL_PREF_KEY = 'tiktok-clone-video-auto-scroll-enabled'
const VIDEO_AUTO_SCROLL_CHANGE_EVENT = 'tiktok-clone-video-auto-scroll-change'

export const getVideoAutoScrollEnabled = () => {
  if (typeof window === 'undefined') {
    return false
  }

  return window.localStorage.getItem(VIDEO_AUTO_SCROLL_PREF_KEY) === '1'
}

export const setVideoAutoScrollEnabled = (enabled: boolean) => {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(VIDEO_AUTO_SCROLL_PREF_KEY, enabled ? '1' : '0')
  window.dispatchEvent(new CustomEvent<boolean>(VIDEO_AUTO_SCROLL_CHANGE_EVENT, { detail: enabled }))
}

export const subscribeToVideoAutoScrollPreference = (onChange: (enabled: boolean) => void) => {
  if (typeof window === 'undefined') {
    return () => {}
  }

  const handler = (event: Event) => {
    const customEvent = event as CustomEvent<boolean>
    onChange(Boolean(customEvent.detail))
  }

  window.addEventListener(VIDEO_AUTO_SCROLL_CHANGE_EVENT, handler)
  return () => window.removeEventListener(VIDEO_AUTO_SCROLL_CHANGE_EVENT, handler)
}

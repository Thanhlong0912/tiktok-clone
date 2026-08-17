import { RefObject, useCallback, useEffect, useState } from 'react'
import {
  getVideoSoundEnabled,
  subscribeToVideoSoundPreference,
} from '../utils/videoSoundPreference'
import {
  DEFAULT_VIDEO_VOLUME,
  getVideoVolume,
  subscribeToVideoVolume,
} from '../utils/videoVolumePreference'
import {
  DEFAULT_VIDEO_SPEED,
  getVideoSpeed,
  subscribeToVideoSpeed,
  type PlaybackSpeed,
} from '../utils/videoSpeedPreference'

/**
 * Mirrors the three playback preferences onto one media element.
 *
 * There are three players in the app (the feed card plus the detail page's
 * mobile and desktop videos) and they used to duplicate the mute wiring, which
 * is how they drifted. One hook, so a preference added here reaches all of them.
 */
export const useVideoPlayerPreferences = (
  mediaRef: RefObject<HTMLMediaElement | null>
) => {
  const [isSoundEnabled, setIsSoundEnabled] = useState<boolean>(false)
  const [volume, setVolume] = useState<number>(DEFAULT_VIDEO_VOLUME)
  const [speed, setSpeed] = useState<PlaybackSpeed>(DEFAULT_VIDEO_SPEED)

  /**
   * Exposed so callers can re-apply from onLoadedMetadata: a new `src` resets
   * playbackRate to defaultPlaybackRate in several browsers, which silently
   * dropped the chosen speed every time the detail page navigated.
   */
  const applyPreferences = useCallback(() => {
    const media = mediaRef.current
    if (!media) return

    media.muted = !isSoundEnabled
    // iOS Safari makes volume read-only and throws nothing -- it simply keeps
    // 1. Mute stays the effective control there, which is also why the slider
    // is desktop-only.
    try {
      media.volume = volume
    } catch {
      // IndexSizeError can only come from an out-of-range value; clampVolume
      // rules that out, so there is nothing to recover from.
    }
    media.playbackRate = speed
  }, [isSoundEnabled, mediaRef, speed, volume])

  useEffect(() => {
    setIsSoundEnabled(getVideoSoundEnabled())
    setVolume(getVideoVolume())
    setSpeed(getVideoSpeed())

    const unsubscribers = [
      subscribeToVideoSoundPreference(setIsSoundEnabled),
      subscribeToVideoVolume(setVolume),
      subscribeToVideoSpeed(setSpeed),
    ]

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe())
  }, [])

  useEffect(() => {
    applyPreferences()
  }, [applyPreferences])

  return { isSoundEnabled, volume, speed, applyPreferences }
}

export default useVideoPlayerPreferences

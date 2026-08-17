import { useCallback, useEffect, useRef, useState } from 'react'
import { BsVolumeDownFill, BsVolumeMuteFill, BsVolumeUpFill } from 'react-icons/bs'
import { setVideoSoundEnabled } from '../utils/videoSoundPreference'
import { clampVolume, setVideoVolume } from '../utils/videoVolumePreference'

/** How long the bar stays open after the pointer leaves, in ms. */
const CLOSE_DELAY_MS = 250

type VolumeControlProps = {
  isSoundEnabled: boolean
  volume: number
  /** Called after unmuting, so the caller can resume a video autoplay blocked. */
  onUnmute?: () => void
  /** Shown beside the icon while muted. Hidden once sound is on. */
  hint?: string
  className?: string
}

/**
 * Speaker icon that reveals a draggable volume bar on hover or focus.
 *
 * Replaces the three copies of a bare mute button that PostMain and the post
 * detail page each had. The level lives in videoVolumePreference and the mute
 * flag in videoSoundPreference -- kept separate so muting does not destroy the
 * level, and unmuting can restore exactly what the viewer had chosen.
 *
 * The bar is md+ only: on mobile the hardware keys own volume, and iOS Safari
 * ignores HTMLMediaElement.volume entirely.
 */
const VolumeControl = ({
  isSoundEnabled,
  volume,
  onUnmute,
  hint = 'Tap for sound',
  className = '',
}: VolumeControlProps) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isDraggingRef = useRef<boolean>(false)
  const [isBarOpen, setIsBarOpen] = useState<boolean>(false)

  // Muted reads as 0 on the bar, the way every player behaves, while the stored
  // level is left untouched for the restore.
  const displayedVolume = isSoundEnabled ? volume : 0

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }, [])

  const openBar = useCallback(() => {
    cancelClose()
    setIsBarOpen(true)
  }, [cancelClose])

  /**
   * Delayed, because the pointer has to cross a few pixels of gap travelling
   * from the icon to the thumb -- closing instantly on pointerleave made the
   * bar impossible to actually grab. Never closes mid-drag.
   */
  const scheduleClose = useCallback(() => {
    if (isDraggingRef.current) return

    cancelClose()
    closeTimerRef.current = setTimeout(() => setIsBarOpen(false), CLOSE_DELAY_MS)
  }, [cancelClose])

  useEffect(() => cancelClose, [cancelClose])

  useEffect(() => {
    if (typeof document === 'undefined') return

    // A drag that ends outside the pill still has to release the "keep open"
    // lock, and pointerup only lands on the input while the pointer is over it.
    const endDrag = () => {
      if (!isDraggingRef.current) return

      isDraggingRef.current = false
      if (!containerRef.current?.matches(':hover')) {
        scheduleClose()
      }
    }

    document.addEventListener('pointerup', endDrag)
    document.addEventListener('pointercancel', endDrag)

    return () => {
      document.removeEventListener('pointerup', endDrag)
      document.removeEventListener('pointercancel', endDrag)
    }
  }, [scheduleClose])

  const toggleMute = () => {
    const enabled = !isSoundEnabled

    if (enabled) {
      // A stored 0 can only come from an older build; unmuting to silence would
      // look like the button is broken.
      if (volume === 0) setVideoVolume(1)
      setVideoSoundEnabled(true)
      onUnmute?.()
      return
    }

    setVideoSoundEnabled(false)
  }

  /** Fires on every pointer move of the drag, so the level follows the thumb. */
  const changeVolume = (next: number) => {
    const level = clampVolume(next)

    if (level === 0) {
      // Deliberately does NOT write the level: dragging to the bottom is a
      // mute, and the icon has to be able to bring back the previous level.
      setVideoSoundEnabled(false)
      return
    }

    setVideoVolume(level)

    if (!isSoundEnabled) {
      setVideoSoundEnabled(true)
      onUnmute?.()
    }
  }

  const VolumeIcon = !isSoundEnabled
    ? BsVolumeMuteFill
    : volume < 0.5
      ? BsVolumeDownFill
      : BsVolumeUpFill

  return (
    <div
      ref={containerRef}
      onPointerEnter={openBar}
      onPointerLeave={scheduleClose}
      // Mouse events as well as pointer events: they are redundant in any
      // browser that fires both, and they keep the reveal working where only
      // the legacy mouse event arrives.
      onMouseEnter={openBar}
      onMouseLeave={scheduleClose}
      onFocusCapture={openBar}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          scheduleClose()
        }
      }}
      className={`z-30 flex items-center gap-1.5 rounded-full bg-black/55 px-3 py-1.5 text-white ${className}`}
    >
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          toggleMute()
        }}
        aria-label={isSoundEnabled ? 'Mute video' : 'Unmute video'}
        aria-pressed={isSoundEnabled}
        className="flex items-center gap-1.5 text-xs font-semibold"
      >
        <VolumeIcon size={16} />
        {/* The muted-state prompt is the only cue that sound exists at all, so
            it stays on every viewport, exactly as before. */}
        {!isSoundEnabled && hint ? <span>{hint}</span> : null}
      </button>

      <div
        className={`hidden overflow-hidden transition-[width,opacity] duration-200 md:block ${
          isBarOpen ? 'w-24 opacity-100' : 'w-0 opacity-0'
        }`}
      >
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={displayedVolume}
          onPointerDown={() => {
            isDraggingRef.current = true
          }}
          onChange={(event) => changeVolume(event.target.valueAsNumber)}
          onClick={(event) => event.stopPropagation()}
          aria-label="Volume"
          aria-valuetext={`${Math.round(displayedVolume * 100)} percent`}
          className="tt-volume-range w-24 align-middle"
          style={{ ['--tt-volume-fill' as string]: `${displayedVolume * 100}%` }}
        />
      </div>
    </div>
  )
}

export default VolumeControl

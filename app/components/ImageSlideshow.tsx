"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { IoChevronBack, IoChevronForward } from 'react-icons/io5'
import { createBucketUrl } from '../hooks/useCreateBucketUrl'
import { IMAGE_SLIDE_DURATION_MS } from '../utils/postMedia'

type ImageSlideshowProps = {
  imageIds?: string[]
  imageUrls?: string[]
  audioId?: string
  audioUrl?: string
  muted?: boolean
  className?: string
  imageClassName?: string
  altPrefix?: string
  autoPlay?: boolean
  slideDurationMs?: number
  showControls?: boolean
  showDots?: boolean
  onCycleComplete?: () => void
}

const ImageSlideshow = ({
  imageIds = [],
  imageUrls = [],
  audioId = '',
  audioUrl = '',
  muted = false,
  className = '',
  imageClassName = '',
  altPrefix = 'Post image',
  autoPlay = true,
  slideDurationMs = IMAGE_SLIDE_DURATION_MS,
  showControls = true,
  showDots = true,
  onCycleComplete,
}: ImageSlideshowProps) => {
  const [activeIndex, setActiveIndex] = useState<number>(0)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const slides = useMemo(() => {
    if (imageUrls.length > 0) {
      return imageUrls
    }

    return imageIds.map((imageId) => createBucketUrl(imageId)).filter(Boolean)
  }, [imageIds, imageUrls])

  const audioSrc = useMemo(() => {
    if (audioUrl) {
      return audioUrl
    }

    return audioId ? createBucketUrl(audioId) : ''
  }, [audioId, audioUrl])

  useEffect(() => {
    setActiveIndex(0)
  }, [slides.length])

  const goToPrevious = useCallback(() => {
    setActiveIndex((current) => (current <= 0 ? Math.max(slides.length - 1, 0) : current - 1))
  }, [slides.length])

  const goToNext = useCallback(() => {
    setActiveIndex((current) => (current >= slides.length - 1 ? 0 : current + 1))
  }, [slides.length])

  const advanceFromTimer = useCallback(() => {
    const isLastSlide = activeIndex >= slides.length - 1

    if (isLastSlide) {
      onCycleComplete?.()
    }

    setActiveIndex(isLastSlide ? 0 : activeIndex + 1)
  }, [activeIndex, onCycleComplete, slides.length])

  useEffect(() => {
    if (!autoPlay || slides.length < 1) {
      return
    }

    const timer = window.setTimeout(advanceFromTimer, slideDurationMs)
    return () => window.clearTimeout(timer)
  }, [advanceFromTimer, autoPlay, slideDurationMs, slides.length])

  useEffect(() => {
    const audio = audioRef.current

    if (!audio || !audioSrc) {
      return
    }

    audio.muted = muted

    if (autoPlay) {
      audio.play().catch(() => {
        if (!audio.muted) {
          audio.muted = true
          audio.play().catch(() => null)
        }
      })
    } else {
      audio.pause()
      audio.currentTime = 0
    }
  }, [audioSrc, autoPlay, muted])

  if (slides.length < 1) {
    return (
      <div className={`flex h-full w-full items-center justify-center bg-black text-sm text-white/70 ${className}`}>
        Images unavailable
      </div>
    )
  }

  const canNavigate = slides.length > 1

  return (
    <div className={`relative h-full w-full overflow-hidden bg-black ${className}`}>
      <img
        src={slides[activeIndex]}
        alt={`${altPrefix} ${activeIndex + 1}`}
        className={`h-full w-full object-contain ${imageClassName}`}
      />

      {audioSrc ? (
        <audio ref={audioRef} src={audioSrc} loop preload="auto" />
      ) : null}

      {canNavigate && showControls ? (
        <div className="absolute inset-x-0 bottom-6 z-20 flex justify-center px-5">
          <div className="flex min-h-[44px] max-w-[82%] items-center gap-4 rounded-sm bg-black/35 px-5 text-white backdrop-blur-sm">
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                goToPrevious()
              }}
              className="flex h-8 w-8 items-center justify-center rounded-full text-white/90 hover:bg-white/15 hover:text-white"
              aria-label="Previous image"
            >
              <IoChevronBack size={26} />
            </button>

            {showDots ? (
              <div className="flex items-center gap-2">
                {slides.map((_, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      setActiveIndex(index)
                    }}
                    className={`h-2.5 w-2.5 rounded-full transition ${
                      index === activeIndex ? 'bg-white' : 'bg-white/45 hover:bg-white/70'
                    }`}
                    aria-label={`Show image ${index + 1}`}
                  />
                ))}
              </div>
            ) : null}

            <button
              type="button"
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                goToNext()
              }}
              className="flex h-8 w-8 items-center justify-center rounded-full text-white/90 hover:bg-white/15 hover:text-white"
              aria-label="Next image"
            >
              <IoChevronForward size={26} />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default ImageSlideshow

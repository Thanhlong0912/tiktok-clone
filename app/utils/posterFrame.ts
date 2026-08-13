/**
 * Cover-frame capture, done in the browser at upload time.
 *
 * Without a poster, every grid tile and every feed card has to download video
 * bytes just to paint its first frame -- on Explore that is dozens of partial
 * video downloads to render one screen of thumbnails. There is no transcoding
 * pipeline here (raw mp4 in, raw mp4 out), so capturing a frame to canvas is
 * the one place a poster can come from without new infrastructure.
 *
 * The pure geometry/format helpers live here so they can be tested; the DOM
 * work is isolated in captureVideoFrame.
 */

export const POSTER_MAX_EDGE = 720
export const POSTER_QUALITY = 0.72

export interface VideoMetadata {
  durationMs: number
  width: number
  height: number
}

export interface PosterCapture {
  file: File
  metadata: VideoMetadata
}

/**
 * Scales to fit inside POSTER_MAX_EDGE without upscaling. A 1080x1920 phone
 * video becomes 405x720; anything already smaller is left alone.
 */
export function posterDimensions(
  width: number,
  height: number,
  maxEdge = POSTER_MAX_EDGE
): { width: number; height: number } {
  if (!isFinite(width) || !isFinite(height) || width <= 0 || height <= 0) {
    return { width: 0, height: 0 }
  }

  const longest = Math.max(width, height)
  if (longest <= maxEdge) {
    return { width: Math.round(width), height: Math.round(height) }
  }

  const scale = maxEdge / longest
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/**
 * Where to grab the cover from. One second in avoids the black or blurred
 * first frame most videos open on, but never past the end of a short clip.
 */
export function defaultPosterTime(durationSeconds: number): number {
  if (!isFinite(durationSeconds) || durationSeconds <= 0) return 0
  if (durationSeconds <= 1) return durationSeconds / 2
  return Math.min(1, durationSeconds * 0.1)
}

/** WebP where supported, JPEG otherwise. Safari only got WebP encoding in 14. */
export function pickPosterMimeType(canPngOnly: boolean): string {
  return canPngOnly ? 'image/jpeg' : 'image/webp'
}

const canvasSupportsWebp = (canvas: HTMLCanvasElement): boolean => {
  try {
    return canvas.toDataURL('image/webp').indexOf('data:image/webp') === 0
  } catch {
    return false
  }
}

/**
 * Loads the file into an offscreen <video>, seeks, and draws one frame.
 *
 * Resolves to null rather than throwing: a missing cover is a degraded
 * thumbnail, not a failed upload, and some codecs the browser can play cannot
 * be drawn to a canvas at all.
 */
export function captureVideoFrame(
  file: File,
  atSeconds?: number
): Promise<PosterCapture | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve(null)
      return
    }

    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    let settled = false

    const finish = (result: PosterCapture | null) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      video.removeAttribute('src')
      video.load()
      URL.revokeObjectURL(url)
      resolve(result)
    }

    // A file the browser can neither decode nor seek would otherwise hang the
    // publish button forever.
    const timeout = setTimeout(() => finish(null), 10000)

    video.preload = 'metadata'
    video.muted = true
    video.playsInline = true
    video.crossOrigin = 'anonymous'

    video.onloadedmetadata = () => {
      const target = atSeconds === undefined ? defaultPosterTime(video.duration) : atSeconds
      try {
        video.currentTime = Math.max(0, Math.min(target, Math.max(0, video.duration - 0.05)))
      } catch {
        finish(null)
      }
    }

    video.onseeked = () => {
      const sourceWidth = video.videoWidth
      const sourceHeight = video.videoHeight

      if (!sourceWidth || !sourceHeight) {
        finish(null)
        return
      }

      const size = posterDimensions(sourceWidth, sourceHeight)
      const canvas = document.createElement('canvas')
      canvas.width = size.width
      canvas.height = size.height

      const context = canvas.getContext('2d')
      if (!context) {
        finish(null)
        return
      }

      try {
        context.drawImage(video, 0, 0, size.width, size.height)
      } catch {
        finish(null)
        return
      }

      const mimeType = pickPosterMimeType(!canvasSupportsWebp(canvas))
      const extension = mimeType === 'image/webp' ? 'webp' : 'jpg'

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            finish(null)
            return
          }

          finish({
            file: new File([blob], `poster.${extension}`, { type: mimeType }),
            metadata: {
              durationMs: Math.round((video.duration || 0) * 1000),
              width: sourceWidth,
              height: sourceHeight,
            },
          })
        },
        mimeType,
        POSTER_QUALITY
      )
    }

    video.onerror = () => finish(null)
    video.src = url
  })
}

/** Reads duration/dimensions without drawing, for validation before upload. */
export function readVideoMetadata(file: File): Promise<VideoMetadata | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve(null)
      return
    }

    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    let settled = false

    const finish = (result: VideoMetadata | null) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      URL.revokeObjectURL(url)
      resolve(result)
    }

    const timeout = setTimeout(() => finish(null), 8000)

    video.preload = 'metadata'
    video.onloadedmetadata = () =>
      finish({
        durationMs: Math.round((video.duration || 0) * 1000),
        width: video.videoWidth,
        height: video.videoHeight,
      })
    video.onerror = () => finish(null)
    video.src = url
  })
}

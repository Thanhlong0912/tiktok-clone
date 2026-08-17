/**
 * Quality labelling for the options menu.
 *
 * There is exactly ONE file per post -- no transcoded renditions exist -- so the
 * menu reports the resolution the creator uploaded and offers nothing to switch
 * to. `posts.width` / `posts.height` are captured at upload time by
 * app/utils/posterFrame.ts and are null for posts that predate that.
 */

/** Rungs a viewer recognises. Anything between two rungs reports the lower one. */
const QUALITY_RUNGS = [144, 240, 360, 480, 720, 1080, 1440, 2160]

/**
 * Feed videos are portrait, so the vertical dimension is the LONG side and
 * would report a 1080x1920 upload as "1920P". Broadcast convention names a
 * format by its short side, which is what the player menu shows.
 */
export const resolutionLabel = (
  width?: number | null,
  height?: number | null
): string | null => {
  if (!width || !height || width <= 0 || height <= 0) {
    return null
  }

  const shortSide = Math.min(width, height)
  const rung = [...QUALITY_RUNGS].reverse().find((step) => shortSide >= step)

  return rung ? `${rung}P` : `${Math.round(shortSide)}P`
}

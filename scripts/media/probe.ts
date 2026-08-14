/**
 * ffmpeg/ffprobe wrappers for the media refresh.
 *
 * There is no transcoding pipeline in this project -- raw mp4 in, raw mp4 out
 * -- and posters are normally captured in the browser at upload time
 * (app/utils/posterFrame.ts). Seeded posts never went through that path, so
 * this is the server-side equivalent: same frame time, same max edge, same
 * quality, so a seeded poster is indistinguishable from an uploaded one.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { VideoAsset } from './refreshPlan'

const run = promisify(execFile)

// Matches POSTER_MAX_EDGE / POSTER_QUALITY in app/utils/posterFrame.ts. ffmpeg
// takes webp quality as 0-100 where the browser's toBlob takes 0-1.
export const POSTER_MAX_EDGE = 720
export const POSTER_QUALITY = 72
export const AVATAR_SIZE = 200

/** Large enough for the biggest poster; nothing here streams to a file. */
const MAX_BUFFER = 64 * 1024 * 1024

export const assertFfmpegAvailable = async (): Promise<void> => {
    for (const binary of ['ffmpeg', 'ffprobe']) {
        try {
            await run(binary, ['-version'], { maxBuffer: MAX_BUFFER })
        } catch {
            throw new Error(
                `${binary} was not found on PATH. The refresh generates poster ` +
                'frames and avatar crops from the videos already in the bucket, ' +
                'which needs ffmpeg locally: brew install ffmpeg'
            )
        }
    }
}

/**
 * Probes over HTTP rather than downloading. ffprobe range-requests the moov
 * atom, so this costs a few KB per clip instead of the whole file.
 */
export const probeVideo = async (url: string, key: string): Promise<VideoAsset> => {
    const { stdout } = await run(
        'ffprobe',
        [
            '-v', 'error',
            '-select_streams', 'v:0',
            '-show_entries', 'stream=width,height,codec_name',
            '-show_entries', 'format=duration',
            '-of', 'json',
            url,
        ],
        { maxBuffer: MAX_BUFFER }
    )

    const parsed = JSON.parse(stdout)
    const stream = parsed.streams?.[0]

    if (!stream) {
        throw new Error(`${key}: ffprobe found no video stream`)
    }

    const duration = Number(parsed.format?.duration)

    return {
        key,
        width: Number(stream.width) || 0,
        height: Number(stream.height) || 0,
        codec: String(stream.codec_name ?? 'unknown'),
        durationMs: Number.isFinite(duration) ? Math.round(duration * 1000) : 0,
    }
}

/**
 * Same rule as defaultPosterTime(): one tenth in, capped at one second, which
 * skips the black or motion-blurred frame most clips open on.
 */
export const posterTimeSeconds = (durationMs: number): number => {
    const seconds = durationMs / 1000
    if (!Number.isFinite(seconds) || seconds <= 0) return 0
    if (seconds <= 1) return seconds / 2
    return Math.min(1, seconds * 0.1)
}

/** Where in the clip to look for a cover, as fractions of its duration. */
export const POSTER_CANDIDATE_FRACTIONS = [0.1, 0.25, 0.4, 0.55, 0.7]

/**
 * Candidate cover times.
 *
 * One fixed frame is a coin flip: a clip that happens to be mid-pan or
 * mid-transition at that instant gets a smeared cover, and on Explore the
 * cover is the whole tile. The browser upload path sidesteps this by offering
 * the user several covers to choose between (app/upload/page.tsx); this is the
 * same idea with pickSharpest standing in for the human eye.
 */
export const posterCandidateTimes = (durationMs: number): number[] => {
    const seconds = durationMs / 1000

    if (!Number.isFinite(seconds) || seconds <= 0) return [0]
    if (seconds <= 1) return [seconds / 2]

    const times: number[] = []
    for (const fraction of POSTER_CANDIDATE_FRACTIONS) {
        // Never past the end, and never so close to it that the seek lands on
        // the final frame of a short clip.
        const at = Math.min(seconds * fraction, Math.max(0, seconds - 0.2))
        if (!times.some((existing) => Math.abs(existing - at) < 0.05)) times.push(at)
    }

    return times
}

/**
 * Picks the frame with the most detail, approximated by encoded size.
 *
 * Blur is exactly what a lossy encoder discards, so at a fixed quality the
 * smeared frames come back materially smaller than the sharp ones. It is a
 * proxy, not a focus measure -- a busy background can beat a clean portrait --
 * but it reliably separates "motion blur" from "in focus", which is the only
 * distinction being made here.
 */
export const pickSharpest = (frames: Buffer[]): Buffer => {
    if (frames.length === 0) {
        throw new Error('pickSharpest was given no frames to choose between.')
    }

    let best = frames[0]
    for (const frame of frames) {
        if (frame.length > best.length) best = frame
    }

    return best
}

const captureFrame = async (
    url: string,
    atSeconds: number,
    filter: string,
    quality: number
): Promise<Buffer> => {
    // -ss before -i seeks by keyframe without decoding everything up to it, and
    // pipes the single frame back on stdout so nothing touches the filesystem.
    const { stdout } = await run(
        'ffmpeg',
        [
            '-v', 'error',
            '-ss', String(atSeconds),
            '-i', url,
            '-frames:v', '1',
            '-vf', filter,
            '-quality', String(quality),
            '-f', 'webp',
            'pipe:1',
        ],
        { maxBuffer: MAX_BUFFER, encoding: 'buffer' }
    )

    const frame = stdout as unknown as Buffer

    if (!frame || frame.length === 0) {
        throw new Error(`Captured an empty frame from ${url} at ${atSeconds}s`)
    }

    return frame
}

/** Cover frame, scaled to fit POSTER_MAX_EDGE without upscaling. */
export const capturePoster = async (
    url: string,
    durationMs: number,
    maxEdge = POSTER_MAX_EDGE
): Promise<Buffer> => {
    // force_original_aspect_ratio=decrease keeps the 9:16 shape; the
    // min(iw,..) guards stop a clip already under the cap being upscaled.
    const filter =
        `scale='min(${maxEdge},iw)':'min(${maxEdge},ih)':force_original_aspect_ratio=decrease`

    const frames: Buffer[] = []
    // Serial: the caller already runs several clips at once, and fanning every
    // candidate out on top of that just gets the range requests throttled.
    for (const at of posterCandidateTimes(durationMs)) {
        frames.push(await captureFrame(url, at, filter, POSTER_QUALITY))
    }

    return pickSharpest(frames)
}

/**
 * Square avatar crop.
 *
 * Takes the widest square the frame allows and anchors it to the upper third
 * rather than the centre: these are handheld vertical selfie clips, where a
 * centre crop of a 9:16 frame reliably lands on the torso instead of the face.
 */
export const captureAvatar = async (
    url: string,
    durationMs: number,
    size = AVATAR_SIZE
): Promise<Buffer> => {
    const filter =
        `crop=min(iw\\,ih):min(iw\\,ih):(iw-min(iw\\,ih))/2:(ih-min(iw\\,ih))/4,scale=${size}:${size}`

    // Same sharpest-of-several rule as the poster: a blurred avatar is worse
    // here, because it is shown small and never gets a second look.
    const frames: Buffer[] = []
    for (const at of posterCandidateTimes(durationMs)) {
        frames.push(await captureFrame(url, at, filter, 90))
    }

    return pickSharpest(frames)
}

/** Dimensions of a still image, for the slideshow post's width/height. */
export const probeImage = async (
    url: string
): Promise<{ width: number; height: number }> => {
    const { stdout } = await run(
        'ffprobe',
        [
            '-v', 'error',
            '-select_streams', 'v:0',
            '-show_entries', 'stream=width,height',
            '-of', 'json',
            url,
        ],
        { maxBuffer: MAX_BUFFER }
    )

    const stream = JSON.parse(stdout).streams?.[0]

    return {
        width: Number(stream?.width) || 0,
        height: Number(stream?.height) || 0,
    }
}

/**
 * Bounded concurrency. ffprobe over HTTP is latency-bound, so serial runs are
 * needlessly slow, but 38 simultaneous range requests get throttled.
 */
export const mapWithConcurrency = async <T, R>(
    items: T[],
    limit: number,
    worker: (item: T, index: number) => Promise<R>
): Promise<R[]> => {
    const results: R[] = new Array(items.length)
    let cursor = 0

    const runners = new Array(Math.min(limit, items.length)).fill(null).map(async () => {
        for (;;) {
            const index = cursor
            cursor += 1
            if (index >= items.length) return
            results[index] = await worker(items[index], index)
        }
    })

    await Promise.all(runners)
    return results
}

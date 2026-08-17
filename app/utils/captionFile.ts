/**
 * Validation for a creator-supplied subtitle file.
 *
 * Kept apart from app/utils/captions.ts on purpose: that module imports the
 * Supabase client, which throws at import time when the env vars are absent, so
 * anything importable by a unit test has to live outside it.
 */

export const MAX_CAPTION_FILE_BYTES = 512 * 1024
export const MAX_CAPTION_FILE_LABEL = '512 KB'

export const hasVttExtension = (fileName: string) =>
  fileName.trim().toLowerCase().endsWith('.vtt')

/**
 * The WebVTT spec requires the file to start with the signature "WEBVTT",
 * optionally behind a byte order mark, followed by whitespace or EOF. A
 * mislabelled .srt passes the extension check and then renders no cues at all,
 * so the upload path checks the bytes rather than the file name.
 */
export const isWebVtt = (text: string) => {
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text

  if (!withoutBom.startsWith('WEBVTT')) {
    return false
  }

  const next = withoutBom.charAt(6)
  return next === '' || next === ' ' || next === '\t' || next === '\n' || next === '\r'
}

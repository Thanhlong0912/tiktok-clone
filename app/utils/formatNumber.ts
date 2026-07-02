/**
 * Formats a count the way TikTok does: 1200 -> "1.2K", 3_400_000 -> "3.4M".
 * Values under 1000 are returned as-is.
 */
export function formatCount(value: number | null | undefined): string {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0

  if (n < 1000) {
    return String(n)
  }

  if (n < 1_000_000) {
    return trimZero(n / 1000) + 'K'
  }

  if (n < 1_000_000_000) {
    return trimZero(n / 1_000_000) + 'M'
  }

  return trimZero(n / 1_000_000_000) + 'B'
}

function trimZero(value: number): string {
  // One decimal place, but drop a trailing ".0" (e.g. 2.0K -> 2K)
  const rounded = Math.floor(value * 10) / 10
  return rounded % 1 === 0 ? String(rounded) : rounded.toFixed(1)
}

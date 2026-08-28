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

/**
 * A count with its noun, pluralised: 1 -> "1 like", 0 -> "0 likes",
 * 1200 -> "1.2K likes".
 *
 * Lives here rather than at the call sites because "1 likes" has now been
 * written twice independently -- once in the ranking explainer's detail line
 * and once in link-preview descriptions. Both are strings users read.
 *
 * Pluralisation is decided by the RAW count, not the formatted one: "1.2K"
 * is not the number 1, and only the original tells you whether the noun is
 * singular.
 */
export function countLabel(value: number | null | undefined, noun: string): string {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0
  return `${formatCount(n)} ${noun}${n === 1 ? '' : 's'}`
}

function trimZero(value: number): string {
  // One decimal place, but drop a trailing ".0" (e.g. 2.0K -> 2K)
  const rounded = Math.floor(value * 10) / 10
  return rounded % 1 === 0 ? String(rounded) : rounded.toFixed(1)
}

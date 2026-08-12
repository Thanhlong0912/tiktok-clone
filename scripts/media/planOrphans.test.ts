import { describe, expect, it } from 'vitest'
import { planOrphans } from './planOrphans'

const HOUR = 60 * 60 * 1000
const now = new Date('2026-08-11T12:00:00Z')
const ago = (ms: number) => new Date(now.getTime() - ms)

describe('planOrphans', () => {
    it('flags objects no row references', () => {
        const result = planOrphans(
            [{ key: 'orphan', lastModified: ago(48 * HOUR) }],
            new Set(['live']),
            { minAgeMs: 24 * HOUR, now }
        )

        expect(result.orphans).toEqual(['orphan'])
        expect(result.skipped).toEqual([])
    })

    it('never flags a referenced object', () => {
        const result = planOrphans(
            [{ key: 'live', lastModified: ago(48 * HOUR) }],
            new Set(['live']),
            { minAgeMs: 24 * HOUR, now }
        )

        expect(result.orphans).toEqual([])
        expect(result.skipped).toEqual([])
    })

    it('skips unreferenced objects younger than the minimum age', () => {
        const result = planOrphans(
            [{ key: 'in-flight', lastModified: ago(1 * HOUR) }],
            new Set(['live']),
            { minAgeMs: 24 * HOUR, now }
        )

        expect(result.orphans).toEqual([])
        expect(result.skipped).toEqual(['in-flight'])
    })

    it('skips an object one millisecond younger than the threshold', () => {
        const result = planOrphans(
            [{ key: 'borderline', lastModified: ago(24 * HOUR - 1) }],
            new Set(),
            { minAgeMs: 24 * HOUR, now }
        )

        expect(result.orphans).toEqual([])
        expect(result.skipped).toEqual(['borderline'])
    })

    it('treats an object exactly at the minimum age as old enough', () => {
        const result = planOrphans(
            [{ key: 'borderline', lastModified: ago(24 * HOUR) }],
            new Set(),
            { minAgeMs: 24 * HOUR, now }
        )

        expect(result.orphans).toEqual(['borderline'])
    })

    it('separates a mixed bucket correctly', () => {
        const result = planOrphans(
            [
                { key: 'live', lastModified: ago(48 * HOUR) },
                { key: 'orphan', lastModified: ago(48 * HOUR) },
                { key: 'in-flight', lastModified: ago(1 * HOUR) },
            ],
            new Set(['live']),
            { minAgeMs: 24 * HOUR, now }
        )

        expect(result.orphans).toEqual(['orphan'])
        expect(result.skipped).toEqual(['in-flight'])
    })

    it('returns empty results for an empty bucket', () => {
        const result = planOrphans([], new Set(['live']), { minAgeMs: 24 * HOUR, now })

        expect(result).toEqual({ orphans: [], skipped: [] })
    })
})

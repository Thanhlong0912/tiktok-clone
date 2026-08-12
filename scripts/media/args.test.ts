import { describe, expect, it } from 'vitest'
import { parseArgs, parseMinAgeHours } from './args'

describe('parseArgs', () => {
    it('defaults to report mode with no min-age override', () => {
        expect(parseArgs([])).toEqual({ shouldDelete: false, minAgeRaw: undefined })
    })

    it('recognises --delete', () => {
        expect(parseArgs(['--delete']).shouldDelete).toBe(true)
    })

    it('extracts the raw --min-age value, including an empty one', () => {
        expect(parseArgs(['--min-age=48']).minAgeRaw).toBe('48')
        expect(parseArgs(['--min-age=']).minAgeRaw).toBe('')
    })
})

describe('parseMinAgeHours', () => {
    it('defaults to 24 hours when the flag is absent', () => {
        expect(parseMinAgeHours(undefined)).toBe(24)
    })

    it('throws when the flag is given no value', () => {
        expect(() => parseMinAgeHours('')).toThrow(/--min-age was given no value/)
    })

    it('throws for whitespace rather than reading it as zero', () => {
        expect(() => parseMinAgeHours('  ')).toThrow(/--min-age was given no value/)
    })

    it('throws for a non-numeric value', () => {
        expect(() => parseMinAgeHours('abc')).toThrow(/non-negative number of hours/)
    })

    it('throws for a negative value', () => {
        expect(() => parseMinAgeHours('-5')).toThrow(/non-negative number of hours/)
    })

    it('accepts zero, which disables the grace window', () => {
        expect(parseMinAgeHours('0')).toBe(0)
    })

    it('accepts an explicit number of hours', () => {
        expect(parseMinAgeHours('48')).toBe(48)
    })
})

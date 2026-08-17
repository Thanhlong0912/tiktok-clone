import { describe, expect, it } from 'vitest'
import { hasVttExtension, isWebVtt } from './captionFile'

describe('isWebVtt', () => {
    it('accepts a minimal file', () => {
        expect(isWebVtt('WEBVTT')).toBe(true)
    })

    it('accepts the usual header forms', () => {
        expect(isWebVtt('WEBVTT\n\n00:00.000 --> 00:02.000\nHello')).toBe(true)
        expect(isWebVtt('WEBVTT\r\n\r\n00:00.000 --> 00:02.000\r\nHello')).toBe(true)
        expect(isWebVtt('WEBVTT - Vietnamese subtitles\n')).toBe(true)
    })

    it('accepts a file saved with a byte order mark', () => {
        expect(isWebVtt('﻿WEBVTT\n')).toBe(true)
    })

    it('rejects an .srt renamed to .vtt', () => {
        // Passes the extension check, renders zero cues -- the case worth catching.
        expect(isWebVtt('1\n00:00:00,000 --> 00:00:02,000\nHello\n')).toBe(false)
    })

    it('rejects near misses and empty input', () => {
        expect(isWebVtt('WEBVTTX')).toBe(false)
        expect(isWebVtt('webvtt')).toBe(false)
        expect(isWebVtt(' WEBVTT')).toBe(false)
        expect(isWebVtt('')).toBe(false)
    })
})

describe('hasVttExtension', () => {
    it('is case and whitespace insensitive', () => {
        expect(hasVttExtension('subtitles.vtt')).toBe(true)
        expect(hasVttExtension('SUBTITLES.VTT')).toBe(true)
        expect(hasVttExtension('  subtitles.vtt  ')).toBe(true)
    })

    it('rejects other subtitle formats', () => {
        expect(hasVttExtension('subtitles.srt')).toBe(false)
        expect(hasVttExtension('subtitles')).toBe(false)
        expect(hasVttExtension('vtt')).toBe(false)
    })
})

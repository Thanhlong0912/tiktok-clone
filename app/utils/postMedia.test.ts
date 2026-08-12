import { describe, expect, it } from 'vitest'
import {
    createImagePostValue,
    createStorageKey,
    getImagePostAudioId,
    getImagePostIds,
    getPostStorageFileIds,
    isImagePost,
} from './postMedia'

describe('createStorageKey', () => {
    it('puts each media kind under its own folder', () => {
        expect(createStorageKey('video')).toMatch(/^video\/[a-z0-9]+$/)
        expect(createStorageKey('image')).toMatch(/^image\/[a-z0-9]+$/)
        expect(createStorageKey('music')).toMatch(/^music\/[a-z0-9]+$/)
        expect(createStorageKey('avatar')).toMatch(/^avatar\/[a-z0-9]+$/)
    })

    it('generates a distinct key each call', () => {
        const keys = Array.from({ length: 50 }, () => createStorageKey('image'))

        expect(new Set(keys).size).toBe(50)
    })
})

// posts.video_url encodes several file ids into one string. Now that ids
// contain a slash, the encoding has to survive the round trip unchanged --
// a parser that split on "/" would hand deletion the wrong keys.
describe('encoded media values with foldered keys', () => {
    it('round-trips an image post with audio', () => {
        const value = createImagePostValue(['image/a1', 'image/b2'], 'music/c3')

        expect(isImagePost(value)).toBe(true)
        expect(getImagePostIds(value)).toEqual(['image/a1', 'image/b2'])
        expect(getImagePostAudioId(value)).toBe('music/c3')
        expect(getPostStorageFileIds(value)).toEqual(['image/a1', 'image/b2', 'music/c3'])
    })

    it('round-trips an image post without audio', () => {
        const value = createImagePostValue(['image/a1', 'image/b2'])

        expect(getPostStorageFileIds(value)).toEqual(['image/a1', 'image/b2'])
        expect(getImagePostAudioId(value)).toBe('')
    })

    it('treats a foldered video key as a bare value, not an image post', () => {
        expect(isImagePost('video/a1')).toBe(false)
        expect(getPostStorageFileIds('video/a1')).toEqual(['video/a1'])
    })

    it('still handles legacy unprefixed values', () => {
        expect(getPostStorageFileIds('hb8q1ftl44')).toEqual(['hb8q1ftl44'])
        expect(getPostStorageFileIds('images:a1,b2|audio:c3')).toEqual(['a1', 'b2', 'c3'])
    })

    it('handles a mix of legacy and foldered ids in one value', () => {
        expect(getPostStorageFileIds('images:a1,image/b2|audio:music/c3')).toEqual([
            'a1',
            'image/b2',
            'music/c3',
        ])
    })
})

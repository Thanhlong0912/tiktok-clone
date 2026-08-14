import { describe, expect, it } from 'vitest'
import {
    assignVideos,
    avatarKeyFor,
    captionFor,
    countUsage,
    createRng,
    isSuitableVideo,
    planAvatars,
    planBios,
    planImagePost,
    posterKeyFor,
    VIDEO_TOPICS,
    type PostInput,
    type VideoAsset,
} from './refreshPlan'

const video = (key: string, overrides: Partial<VideoAsset> = {}): VideoAsset => ({
    key,
    width: 576,
    height: 1024,
    durationMs: 15000,
    codec: 'h264',
    ...overrides,
})

/** Tagged keys, so the catalogue-membership rule is satisfied. */
const taggedKeys = Object.keys(VIDEO_TOPICS)

const posts = (count: number, authors = 5): PostInput[] =>
    new Array(count).fill(null).map((_, index) => ({
        id: `post-${index}`,
        userId: `user-${index % authors}`,
    }))

describe('isSuitableVideo', () => {
    it('accepts a tagged portrait h264 clip', () => {
        expect(isSuitableVideo(video(taggedKeys[0]))).toEqual({ suitable: true })
    })

    it('rejects codecs Chrome and Firefox cannot decode', () => {
        const verdict = isSuitableVideo(video(taggedKeys[0], { codec: 'hevc' }))

        expect(verdict.suitable).toBe(false)
        expect(verdict).toHaveProperty('reason', expect.stringContaining('hevc'))
    })

    it('rejects landscape clips that would letterbox in a 9:16 feed', () => {
        const verdict = isSuitableVideo(video(taggedKeys[0], { width: 1920, height: 1080 }))

        expect(verdict.suitable).toBe(false)
        expect(verdict).toHaveProperty('reason', expect.stringContaining('landscape'))
    })

    it('rejects a square clip, which is not portrait either', () => {
        expect(isSuitableVideo(video(taggedKeys[0], { width: 1080, height: 1080 })).suitable).toBe(
            false
        )
    })

    it('rejects the hand-excluded screen recording', () => {
        const verdict = isSuitableVideo(video('video/23.mp4'))

        expect(verdict.suitable).toBe(false)
        expect(verdict).toHaveProperty('reason', expect.stringContaining('screen recording'))
    })

    it('rejects an untagged clip, since no caption could match it', () => {
        const verdict = isSuitableVideo(video('video/brand-new.mp4'))

        expect(verdict.suitable).toBe(false)
        expect(verdict).toHaveProperty('reason', expect.stringContaining('untagged'))
    })

    it('rejects unreadable dimensions rather than treating them as portrait', () => {
        expect(isSuitableVideo(video(taggedKeys[0], { width: 0, height: 0 })).suitable).toBe(false)
    })
})

describe('assignVideos', () => {
    it('spreads clips evenly instead of drawing independently', () => {
        const videos = taggedKeys.slice(0, 10).map((key) => video(key))
        const usage = countUsage(assignVideos(posts(100), videos, createRng(1)))
        const counts = Object.values(usage)

        // 100 posts over 10 clips: a uniform random draw would routinely give
        // one clip 4 uses and another 18. Round-robin keeps the spread at 1.
        expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1)
        expect(Object.keys(usage)).toHaveLength(10)
    })

    it('never repeats a clip back to back for the same author', () => {
        const videos = taggedKeys.slice(0, 6).map((key) => video(key))
        const assignments = assignVideos(posts(120, 4), videos, createRng(7))

        const lastByAuthor: Record<string, string> = {}
        for (const assignment of assignments) {
            expect(assignment.videoKey).not.toBe(lastByAuthor[assignment.userId])
            lastByAuthor[assignment.userId] = assignment.videoKey
        }
    })

    it('is deterministic for a given seed', () => {
        const videos = taggedKeys.slice(0, 8).map((key) => video(key))
        const first = assignVideos(posts(50), videos, createRng(42))
        const second = assignVideos(posts(50), videos, createRng(42))

        expect(first).toEqual(second)
    })

    it('differs between seeds, so a reseed reshuffles', () => {
        const videos = taggedKeys.slice(0, 8).map((key) => video(key))
        const first = assignVideos(posts(50), videos, createRng(1))
        const second = assignVideos(posts(50), videos, createRng(2))

        expect(first).not.toEqual(second)
    })

    it('carries the clip its own dimensions and duration onto the post', () => {
        const asset = video(taggedKeys[0], { width: 1080, height: 1920, durationMs: 23650 })
        const [assignment] = assignVideos(posts(1), [asset], createRng(3))

        expect(assignment.width).toBe(1080)
        expect(assignment.height).toBe(1920)
        expect(assignment.durationMs).toBe(23650)
        expect(assignment.posterKey).toBe(posterKeyFor(asset.key))
    })

    it('captions every post with its own clip topic', () => {
        const videos = taggedKeys.map((key) => video(key))
        const assignments = assignVideos(posts(200), videos, createRng(9))

        for (const assignment of assignments) {
            expect(assignment.text).toContain(`#${VIDEO_TOPICS[assignment.videoKey]}`)
        }
    })

    it('refuses to plan when nothing is usable, rather than writing a broken feed', () => {
        expect(() => assignVideos(posts(10), [], createRng(1))).toThrow(/No suitable videos/)
    })
})

describe('planBios', () => {
    it('describes the profile by what it mostly posts', () => {
        // video/9 and video/34 are travel, video/14 beauty.
        const plans = planBios({ 'user-a': ['video/9.mp4', 'video/34.mp4', 'video/14.mp4'] })

        expect(plans[0].topic).toBe('travel')
        expect(plans[0].bio).toBe('travel creator. seeded account.')
    })

    it('breaks ties without depending on assignment order', () => {
        const forward = planBios({ 'user-a': ['video/14.mp4', 'video/9.mp4'] })
        const reversed = planBios({ 'user-a': ['video/9.mp4', 'video/14.mp4'] })

        expect(forward[0].topic).toBe(reversed[0].topic)
    })

    it('skips a profile whose clips are all untagged', () => {
        expect(planBios({ 'user-a': ['video/unknown.mp4'] })).toEqual([])
    })
})

describe('captionFor', () => {
    it('tags the caption with the topic it was given', () => {
        expect(captionFor('travel', createRng(5))).toContain('#travel')
    })
})

describe('posterKeyFor', () => {
    it('derives a stable key so re-runs overwrite instead of orphaning', () => {
        expect(posterKeyFor('video/12.mp4')).toBe('image/poster-12.webp')
        expect(posterKeyFor('video/12.mp4')).toBe(posterKeyFor('video/12.mp4'))
    })
})

describe('planImagePost', () => {
    it('writes the images: prefix the media_kind column keys off', () => {
        const plan = planImagePost(
            { id: 'p1', userId: 'u1' },
            ['image/a.jpg', 'image/b.jpg'],
            { width: 736, height: 1104 },
            'caption'
        )

        expect(plan.videoKey).toBe('images:image/a.jpg,image/b.jpg')
        expect(plan.posterKey).toBe('image/a.jpg')
        expect(plan.durationMs).toBe(6000)
    })

    it('refuses an empty carousel', () => {
        expect(() =>
            planImagePost({ id: 'p1', userId: 'u1' }, [], { width: 1, height: 1 }, 'x')
        ).toThrow(/at least one image/)
    })
})

describe('planAvatars', () => {
    it('sources each avatar from a clip that profile actually posted', () => {
        const byAuthor = { 'user-a': ['video/1.mp4', 'video/2.mp4'], 'user-b': ['video/9.mp4'] }
        const plans = planAvatars(byAuthor, createRng(4))

        expect(plans).toHaveLength(2)
        for (const plan of plans) {
            expect(byAuthor[plan.userId as keyof typeof byAuthor]).toContain(plan.sourceVideoKey)
            expect(plan.avatarKey).toBe(avatarKeyFor(plan.userId))
        }
    })

    it('skips authors with no posts to crop from', () => {
        expect(planAvatars({ 'user-a': [] }, createRng(1))).toEqual([])
    })

    it('prefers a close-up clip over a wide shot, which crops to scenery', () => {
        // video/14 is tagged beauty, video/9 travel.
        const plans = planAvatars({ 'user-a': ['video/9.mp4', 'video/14.mp4'] }, createRng(1))

        expect(plans[0].sourceVideoKey).toBe('video/14.mp4')
    })

    it('never gives two profiles the same face', () => {
        // Every author posted the same three clips, which is what makes an
        // independent per-author pick collide.
        const shared = ['video/14.mp4', 'video/18.mp4', 'video/36.mp4']
        const byAuthor = { 'user-a': shared, 'user-b': shared, 'user-c': shared }

        const sources = planAvatars(byAuthor, createRng(2)).map((plan) => plan.sourceVideoKey)

        expect(new Set(sources).size).toBe(3)
    })

    it('serves the author with the least choice first', () => {
        const byAuthor = {
            'user-a': ['video/14.mp4', 'video/18.mp4', 'video/36.mp4'],
            'user-b': ['video/14.mp4'],
        }

        const plans = planAvatars(byAuthor, createRng(3))
        const forB = plans.filter((plan) => plan.userId === 'user-b')[0]

        // user-b's only option must not have been taken by user-a first.
        expect(forB.sourceVideoKey).toBe('video/14.mp4')
        expect(new Set(plans.map((plan) => plan.sourceVideoKey)).size).toBe(2)
    })

    it('falls back to a duplicate rather than leaving a profile faceless', () => {
        const byAuthor = { 'user-a': ['video/14.mp4'], 'user-b': ['video/14.mp4'] }
        const plans = planAvatars(byAuthor, createRng(4))

        expect(plans).toHaveLength(2)
    })

    it('returns plans in a stable order regardless of who was served first', () => {
        const byAuthor = {
            'user-c': ['video/14.mp4', 'video/18.mp4'],
            'user-a': ['video/36.mp4'],
            'user-b': ['video/14.mp4', 'video/36.mp4', 'video/18.mp4'],
        }

        expect(planAvatars(byAuthor, createRng(5)).map((plan) => plan.userId)).toEqual([
            'user-a', 'user-b', 'user-c',
        ])
    })

    it('still picks something when the author only has wide shots', () => {
        const plans = planAvatars({ 'user-a': ['video/9.mp4'] }, createRng(1))

        expect(plans[0].sourceVideoKey).toBe('video/9.mp4')
    })
})

import { describe, expect, it } from 'vitest'
import {
  MAX_DESCRIPTION,
  MAX_TITLE,
  postCard,
  profileCard,
  truncate,
} from './socialCard'

describe('truncate', () => {
  it('leaves text that already fits alone', () => {
    expect(truncate('short caption', 40)).toBe('short caption')
  })

  it('collapses the whitespace a free-text caption can contain', () => {
    // A newline inside a preview title renders as a stray space or worse.
    expect(truncate('two\nlines   and  gaps', 40)).toBe('two lines and gaps')
  })

  it('breaks on a word boundary rather than mid-word', () => {
    const out = truncate('walking the old town at golden hour today', 20)
    expect(out).toBe('walking the old…')
    expect(out.length).toBeLessThanOrEqual(20)
  })

  it('hard-cuts a single word with no boundary to break on', () => {
    const out = truncate('a'.repeat(50), 10)
    expect(out).toBe(`${'a'.repeat(9)}…`)
    expect(out.length).toBe(10)
  })

  it('never exceeds the limit it was given', () => {
    const samples = ['x'.repeat(200), 'word '.repeat(60), 'a b c d e f g h i j k l m n']
    samples.forEach((sample) => {
      expect(truncate(sample, MAX_TITLE).length).toBeLessThanOrEqual(MAX_TITLE)
    })
  })
})

describe('postCard', () => {
  const base = {
    text: 'walking the old town at golden hour #travel',
    authorName: 'Khanh Ho',
    likeCount: 1200,
    commentCount: 3,
    posterUrl: 'https://cdn.example.test/poster.jpg',
  }

  it('leads with the caption, which is what says what the post is', () => {
    expect(postCard(base).title).toBe('walking the old town at golden hour #travel')
  })

  it('names the creator when a post has no caption', () => {
    expect(postCard({ ...base, text: '   ' }).title).toBe('Video by Khanh Ho')
  })

  it('degrades to something sayable when there is no creator name either', () => {
    expect(postCard({ ...base, text: '', authorName: '' }).title).toBe('Video by a creator')
  })

  it('formats the counts the way the rest of the app does', () => {
    expect(postCard(base).description).toBe('Khanh Ho · 1.2K likes · 3 comments')
  })

  it('pluralises, because a preview card is read by people', () => {
    const card = postCard({ ...base, likeCount: 1, commentCount: 1 })
    expect(card.description).toBe('Khanh Ho · 1 like · 1 comment')
  })

  it('does not prefix the display name with @', () => {
    // `@` means the handle everywhere in this app, and get_post carries none.
    expect(postCard(base).description).not.toContain('@')
    expect(postCard({ ...base, text: '' }).title).not.toContain('@')
  })

  it('passes the cover frame through, and tolerates not having one', () => {
    expect(postCard(base).image).toBe('https://cdn.example.test/poster.jpg')
    expect(postCard({ ...base, posterUrl: '' }).image).toBe('')
  })

  it('keeps a long caption inside the title limit', () => {
    const card = postCard({ ...base, text: 'a really long caption '.repeat(20) })
    expect(card.title.length).toBeLessThanOrEqual(MAX_TITLE)
  })
})

describe('profileCard', () => {
  const base = {
    name: 'Khanh Ho',
    handle: 'khanhho',
    bio: 'cafe creator',
    followerCount: 16,
    totalLikes: 2400,
    imageUrl: 'https://cdn.example.test/avatar.jpg',
  }

  it('carries both names, because they do different jobs', () => {
    expect(profileCard(base).title).toBe('Khanh Ho (@khanhho)')
  })

  it('leads the description with the bio when there is one', () => {
    expect(profileCard(base).description).toBe('cafe creator · 16 followers · 2.4K likes')
  })

  it('falls back to stats alone for an empty bio', () => {
    expect(profileCard({ ...base, bio: '' }).description).toBe('16 followers · 2.4K likes')
  })

  it('handles an account missing one half of its identity', () => {
    expect(profileCard({ ...base, name: '' }).title).toBe('@khanhho')
    expect(profileCard({ ...base, handle: '' }).title).toBe('Khanh Ho')
    expect(profileCard({ ...base, name: '', handle: '' }).title).toBe('Profile')
  })

  it('keeps a long bio inside the description limit', () => {
    const card = profileCard({ ...base, bio: 'words '.repeat(100) })
    expect(card.description.length).toBeLessThanOrEqual(MAX_DESCRIPTION)
  })
})

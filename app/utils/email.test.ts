import { describe, expect, it } from 'vitest'
import { isValidEmail } from './email'

describe('isValidEmail', () => {
  it.each([
    'a@b.com',
    'first.last@example.com',
    'user+tag@example.co.uk',
    'user_name@sub.domain.org',
    'someone@example.io',
  ])('accepts %s', (value) => {
    expect(isValidEmail(value)).toBe(true)
  })

  it.each([
    ['a modern TLD', 'someone@example.email'],
    ['a commerce TLD', 'shop@example.store'],
    ['a four-letter TLD', 'dev@example.info'],
    ['a six-letter TLD', 'hi@example.design'],
    ['a multi-label host', 'seed0@seed.local.test'],
  ])('accepts %s (the old pattern capped TLDs at 3 characters)', (_label, value) => {
    expect(isValidEmail(value)).toBe(true)
  })

  it.each([
    ['empty', ''],
    ['no at sign', 'not-an-email'],
    ['no domain', 'user@'],
    ['no local part', '@example.com'],
    ['no dot in domain', 'user@example'],
    ['a single-character TLD', 'user@example.c'],
    ['whitespace inside', 'user name@example.com'],
    ['two at signs', 'user@@example.com'],
  ])('rejects %s', (_label, value) => {
    expect(isValidEmail(value)).toBe(false)
  })

  it('trims surrounding whitespace before judging', () => {
    expect(isValidEmail('  a@b.com  ')).toBe(true)
  })

  it('rejects an address longer than the 254-character limit', () => {
    expect(isValidEmail(`${'a'.repeat(250)}@b.com`)).toBe(false)
  })
})

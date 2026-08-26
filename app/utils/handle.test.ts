import { describe, expect, it } from 'vitest'
import { handleError, isValidHandle, MAX_HANDLE_LENGTH } from './handle'

/**
 * Shared fixture: the SAME inputs are verified against the
 * profiles_handle_format CHECK in Postgres, added in
 * supabase/migrations/0011_unique_handles.sql. If the charset changes on
 * either side, run this against the database too:
 *
 *   select v, v ~ '^[a-z0-9._]{2,24}$' from (values ...) t(v);
 *
 * A divergence here is not cosmetic: the client would let someone type a
 * handle the database then refuses, and the failure would surface as a raised
 * constraint rather than as field validation.
 */
export const HANDLE_VALIDITY_PARITY: Array<[string, boolean]> = [
  ['rowanbui', true],
  ['a.b_c', true],
  ['user.1', true],
  ['ab', true],
  ['x'.repeat(MAX_HANDLE_LENGTH), true],
  ['x'.repeat(MAX_HANDLE_LENGTH + 1), false],
  ['a', false],
  ['', false],
  ['Rowan', false],
  ['rowan bui', false],
  ['rowan-bui', false],
  ["o'brien", false],
  ['thành', false],
  ['@rowan', false],
]

describe('isValidHandle', () => {
  it.each(HANDLE_VALIDITY_PARITY)('%j -> %j (verified against SQL)', (value, expected) => {
    expect(isValidHandle(value)).toBe(expected)
  })
})

describe('handleError', () => {
  it('is null for a valid handle', () => {
    expect(handleError('rowanbui')).toBeNull()
  })

  it('names the specific problem rather than restating the pattern', () => {
    // A field that answers "handles must match ^[a-z0-9._]{2,24}$" has told
    // the user nothing they can act on.
    expect(handleError('Rowan')).toMatch(/lowercase/i)
    expect(handleError('a')).toMatch(/2/)
    expect(handleError('x'.repeat(MAX_HANDLE_LENGTH + 1))).toMatch(/24/)
    expect(handleError('rowan bui')).toMatch(/letters, numbers/i)
  })

  it('reports empty as required rather than as too short', () => {
    expect(handleError('')).toMatch(/required/i)
  })

  it('agrees with isValidHandle on every fixture row', () => {
    HANDLE_VALIDITY_PARITY.forEach(([value, valid]) => {
      expect(handleError(value) === null).toBe(valid)
    })
  })
})

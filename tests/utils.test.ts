import { describe, expect, it } from 'vitest'

import { parsePostReference, parseRange } from '../src/utils'

describe('command utilities', () => {
  it('parses indexes and ranges', () => {
    expect(parseRange(undefined, 5)).toEqual({ offset: 0, limit: 5 })
    expect(parseRange('2', 5)).toEqual({ offset: 2, limit: 1 })
    expect(parseRange('2~5', 5)).toEqual({ offset: 2, limit: 4 })
    expect(() => parseRange('5~2', 5)).toThrow('终点')
  })

  it('parses persisted and remote references', () => {
    expect(parsePostReference('#12')).toEqual({ id: 12 })
    expect(parsePostReference('10001:tid-value')).toEqual({ uin: '10001', tid: 'tid-value' })
  })
})

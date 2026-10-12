import { describe, expect, test } from 'claude-code/testing'

import { bandTextOf, countCall } from '../hooks/__NAME__-logic'

describe('__NAME__-logic', () => {
  test('the band is empty until a tool runs', () => {
    expect(bandTextOf(null, 80)).toBe('')
    expect(bandTextOf({ tools: 0, failures: 0 }, 80)).toBe('')
  })

  test('counts calls and failures, and fits the width', () => {
    const turn = countCall(countCall(null, false), true)
    expect(turn).toEqual({ tools: 2, failures: 1 })
    expect(bandTextOf(turn, 80)).toBe('◆ __NAME__  2 tool calls this turn · 1 failed')
    expect(bandTextOf(turn, 10)).toHaveLength(10)
  })
})

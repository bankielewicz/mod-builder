import { describe, expect, test } from 'claude-code/testing'

import { EMPTY, elapsedOf, slowSecondsOf, slowTurnToastOf, statusOf } from '../hooks/__NAME__-logic'

describe('__NAME__-logic', () => {
  test('status is cleared until something happens, then counts', () => {
    expect(statusOf(EMPTY)).toBeUndefined()
    expect(statusOf({ ...EMPTY, turns: 1, tools: 3 })).toBe('◆ 1 turn · 3 tool calls')
    expect(statusOf({ ...EMPTY, turns: 2, tools: 1, failed: 1 })).toBe('◆ 2 turns · 1 tool call · 1 failed')
  })

  test('slow turns toast; quick ones do not', () => {
    expect(slowTurnToastOf(30_000, 120)).toBeNull()
    expect(slowTurnToastOf(725_000, 120)).toBe('That turn took 12m 05s')
    expect(elapsedOf(45_000)).toBe('45s')
  })

  test('the option is read defensively', () => {
    expect(slowSecondsOf({ slowSeconds: 30 })).toBe(30)
    expect(slowSecondsOf({ slowSeconds: 'x' })).toBe(120)
    expect(slowSecondsOf(undefined)).toBe(120)
  })
})

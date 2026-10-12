import { describe, expect, test } from 'claude-code/testing'

import { DEMO_ITEMS, moved, rowsThatFit, summaryOf, toggled } from '../hooks/__NAME__-logic'

describe('__NAME__-logic', () => {
  test('summary counts done items, or says it is empty', () => {
    expect(summaryOf([])).toBe('Nothing here yet.')
    expect(summaryOf(DEMO_ITEMS)).toBe('2 of 4 done')
  })

  test('selection wraps both ways', () => {
    expect(moved(3, 1, 4)).toBe(0)
    expect(moved(0, -1, 4)).toBe(3)
    expect(moved(0, 1, 0)).toBe(0)
  })

  test('toggling flips one item', () => {
    expect(summaryOf(toggled(DEMO_ITEMS, 2))).toBe('3 of 4 done')
  })

  test('rows that fit', () => {
    expect(rowsThatFit(30)).toBe(25)
    expect(rowsThatFit(2)).toBe(1)
  })
})

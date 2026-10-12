import { describe, expect, test } from 'claude-code/testing'

import { actionOf, added, listTextOf, MAX_NOTES, notesOf } from '../hooks/__NAME__-logic'

describe('__NAME__-logic', () => {
  test('parses the arguments', () => {
    expect(actionOf('')).toEqual({ kind: 'list' })
    expect(actionOf('buy milk')).toEqual({ kind: 'add', text: 'buy milk' })
    expect(actionOf('add  ship it ')).toEqual({ kind: 'add', text: 'ship it' })
    expect(actionOf('add')).toEqual({ kind: 'help' })
    expect(actionOf('CLEAR')).toEqual({ kind: 'clear' })
  })

  test('keeps the newest notes and reads the store defensively', () => {
    let notes = notesOf(undefined)
    for (let i = 0; i < MAX_NOTES + 5; i += 1) notes = added(notes, `n${i}`, i)
    expect(notes).toHaveLength(MAX_NOTES)
    expect(notes[0]?.text).toBe('n5')
    expect(notesOf([{ text: 'ok', at: 1 }, { text: 2 }, null])).toEqual([{ text: 'ok', at: 1 }])
  })

  test('lists, or says there is nothing', () => {
    expect(listTextOf([])).toStartWith('__TITLE__: no notes yet.')
    expect(listTextOf([{ text: 'a', at: 0 }, { text: 'b', at: 1 }])).toBe('1. a\n2. b')
  })
})

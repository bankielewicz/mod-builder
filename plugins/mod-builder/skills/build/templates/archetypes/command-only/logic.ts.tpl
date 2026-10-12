/**
 * __TITLE__'s rules, free of `$` so tests can call them.
 */

import type { Note } from '../types'

export type { Note }

export type Action =
  | { kind: 'add'; text: string }
  | { kind: 'list' }
  | { kind: 'clear' }
  | { kind: 'demo' }
  | { kind: 'help' }

export const MAX_NOTES = 50

/** `/__NAME__ <args>` → what to do. Bare text is an add. */
export function actionOf(args: string): Action {
  const trimmed = args.trim()
  const [word = '', ...rest] = trimmed.split(/\s+/)
  const lower = word.toLowerCase()
  if (!trimmed || lower === 'list') return { kind: 'list' }
  if (lower === 'clear') return { kind: 'clear' }
  if (lower === 'demo') return { kind: 'demo' }
  if (lower === 'help') return { kind: 'help' }
  if (lower === 'add') return rest.length ? { kind: 'add', text: rest.join(' ') } : { kind: 'help' }
  return { kind: 'add', text: trimmed }
}

/** The notes with one more, newest last, at most MAX_NOTES. */
export function added(notes: readonly Note[], text: string, at: number): Note[] {
  return [...notes, { text: text.slice(0, 500), at }].slice(-MAX_NOTES)
}

/** Reads what $.store returned, keeping only well-formed notes. */
export function notesOf(stored: unknown): Note[] {
  if (!Array.isArray(stored)) return []
  return stored.filter(
    (note): note is Note => typeof note?.text === 'string' && typeof note?.at === 'number',
  )
}

/** The command's answer for a list. */
export function listTextOf(notes: readonly Note[]): string {
  if (notes.length === 0) return '__TITLE__: no notes yet. Add one with /__NAME__ <text>.'
  return notes.map((note, index) => `${index + 1}. ${note.text}`).join('\n')
}

export const HELP = 'Usage: /__NAME__ <text> | list | clear | demo'

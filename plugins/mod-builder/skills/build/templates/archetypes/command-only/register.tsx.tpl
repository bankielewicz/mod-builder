import type { EngineInterface, Register } from 'claude-code'

import { actionOf, added, HELP, listTextOf, notesOf, type Note } from './__NAME__-logic'

/**
 * __TITLE__: notes that outlive the session, answered as command text.
 * Archetype: command-only. No pane and no band: every answer is the
 * command's `{ text }`, and the data lives in $.store across sessions.
 */

const KEY = '__NAME__:notes'

async function load($: EngineInterface): Promise<Note[]> {
  return notesOf(await $.store.get(KEY))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command
      .register({ name: '__NAME__', description: __DESCRIPTION_JS__, argumentHint: '<text> | list | clear | demo' })
      .catch(() => undefined)
    return next(e)
  })

  on('command.run', { command: '__NAME__' }, async ($, e) => {
    try {
      const action = actionOf(e.args)
      if (action.kind === 'help') return { text: HELP }
      if (action.kind === 'list') return { text: listTextOf(await load($)) }
      if (action.kind === 'clear') {
        await $.store.delete(KEY)
        return { text: '__TITLE__: cleared.' }
      }
      if (action.kind === 'demo') {
        return { text: listTextOf([{ text: 'This is a demo note.', at: 0 }, { text: 'Real notes: /__NAME__ <text>', at: 0 }]) }
      }
      const notes = added(await load($), action.text, await $.clock.now())
      await $.store.set(KEY, notes)
      return { text: `__TITLE__: noted (${notes.length}).` }
    } catch {
      return { text: '__TITLE__: something went wrong; see claude --debug.' }
    }
  })
}

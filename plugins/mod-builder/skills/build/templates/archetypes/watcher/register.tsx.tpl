import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { EMPTY, slowSecondsOf, slowTurnToastOf, statusOf } from './__NAME__-logic'

/**
 * __TITLE__: counts turns and tool calls on the status line, toasts a slow
 * turn, and raises a native notification when one ends.
 * Archetype: watcher. It never blocks or rewrites anything; every hook
 * passes the event on and reacts to the result.
 */

const stats = atom({ plugin: '__NAME__', key: 'stats' } as const, EMPTY)

let slowSeconds = 120

async function showStatus($: EngineInterface): Promise<void> {
  $.ui.status(statusOf(await read($, stats)))
}

export const register: Register = (on, options) => {
  slowSeconds = slowSecondsOf(options)

  on('session.start', async ($, e, next) => {
    await $.command
      .register({ name: '__NAME__', description: __DESCRIPTION_JS__, argumentHint: '[demo | reset]' })
      .catch(() => undefined)
    void showStatus($).catch(() => undefined)
    return next(e)
  })

  on('command.run', { command: '__NAME__' }, async ($, e) => {
    const word = e.args.trim().toLowerCase()
    if (word === 'demo') {
      void (async () => {
        await update($, stats, () => ({ turns: 12, tools: 87, failed: 2, turnStartedAt: null }))
        await showStatus($)
        $.ui.toast(slowTurnToastOf(725_000, slowSeconds) ?? '')
        await $.ui.notify('A long turn just finished', { title: '__TITLE__' }).catch(() => undefined)
      })().catch(() => undefined)
      return { text: '__TITLE__: demo numbers are on the status line, with a toast and a notification.' }
    }
    if (word === 'reset') {
      void (async () => {
        await update($, stats, () => EMPTY)
        await showStatus($)
      })().catch(() => undefined)
      return { text: '__TITLE__: counts reset.' }
    }
    const current = statusOf(await read($, stats))
    return { text: current ?? '__TITLE__: nothing counted yet.' }
  })

  on('prompt.submit', async ($, e, next) => {
    const now = await $.clock.now()
    await update($, stats, current => ({ ...current, turnStartedAt: now }))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (!e.agentId) {
      const isFailed = ran.deny !== undefined || ran.isError === true
      await update($, stats, current => ({ ...current, tools: current.tools + 1, failed: current.failed + (isFailed ? 1 : 0) }))
      await showStatus($)
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      const now = await $.clock.now()
      const before = await read($, stats)
      await update($, stats, current => ({ ...current, turns: current.turns + 1, turnStartedAt: null }))
      await showStatus($)
      const toast = before.turnStartedAt === null ? null : slowTurnToastOf(now - before.turnStartedAt, slowSeconds)
      if (toast) {
        $.ui.toast(toast)
        void $.ui.notify(toast, { title: '__TITLE__' }).catch(() => undefined)
      }
    }
    return next(e)
  })
}

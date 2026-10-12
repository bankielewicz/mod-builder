import { atom, update } from 'claude-code'
import type { Register } from 'claude-code'

import { ALLOW, DENY, denyOf, questionOf, riskOf } from './__NAME__-logic'

/**
 * __TITLE__: holds risky shell commands until the person allows them.
 * Archetype: guard. It judges before calling next, asks with $.ui.ask (a $
 * call, so the wait costs no hook budget), denies with a reason addressed to
 * Claude, and fails closed: if the check itself breaks, the command is denied.
 */

const last = atom({ plugin: '__NAME__', key: 'last' } as const, null)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command
      .register({ name: '__NAME__', description: __DESCRIPTION_JS__, argumentHint: '[demo | test <command>]' })
      .catch(() => undefined)
    return next(e)
  })

  on('command.run', { command: '__NAME__' }, async ($, e) => {
    const [word = '', ...rest] = e.args.trim().split(/\s+/)
    if (word === 'test' && rest.length) {
      const risk = riskOf(rest.join(' '))
      return { text: risk ? `__TITLE__ would hold it: it ${risk.reason}.` : '__TITLE__ would let it run.' }
    }
    if (word === 'demo') {
      void $.ui.ask(questionOf('rm -rf ./build', { reason: 'deletes files recursively' }), [ALLOW, DENY]).catch(() => undefined)
      return { text: '__TITLE__: this is the question Claude would wait on. Nothing runs.' }
    }
    return { text: 'Usage: /__NAME__ demo | /__NAME__ test <command>' }
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const risk = riskOf(e.command)
    if (!risk) return next(e)
    const answer = await $.ui.ask(questionOf(e.command, risk), [ALLOW, DENY])
    const isAllowed = answer === ALLOW
    await update($, last, () => ({ command: e.command, reason: risk.reason, verdict: isAllowed ? 'allowed' : 'denied' }))
    return isAllowed ? next(e) : { deny: denyOf(risk) }
  }).catch(($, e, next) =>
    next.called ? next(e) : { deny: '__NAME__: the safety check failed, so the command was held. Ask the person before retrying.' },
  )
}

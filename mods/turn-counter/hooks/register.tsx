import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { bandTextOf, countCall } from './turn-counter-logic'

/**
 * Turn Counter: a band above the prompt counting this turn's tool calls.
 * Archetype: band. It composes with the bands below, steps aside for a
 * survey, and hides when idle.
 */

const turn = atom({ plugin: 'turn-counter', key: 'turn' } as const, null)
const isHidden = atom({ plugin: 'turn-counter', key: 'isHidden' } as const, false)

async function showDemo($: EngineInterface): Promise<void> {
  await update($, isHidden, () => false)
  await update($, turn, () => ({ tools: 7, failures: 1 }))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command
      .register({ name: 'turn-counter', description: "Counts this turn's tool calls in a band above the prompt.", argumentHint: '[demo | hide | show]' })
      .catch(() => undefined)
    return next(e)
  })

  on('command.run', { command: 'turn-counter' }, async ($, e) => {
    const word = e.args.trim().toLowerCase()
    if (word === 'demo') {
      void showDemo($).catch(() => undefined)
      return { text: 'Turn Counter: a demo band is above the prompt. It clears when the next turn ends.' }
    }
    if (word === 'hide' || word === 'show') {
      void update($, isHidden, () => word === 'hide').catch(() => undefined)
      return { text: `Turn Counter: band ${word === 'hide' ? 'hidden' : 'shown'}.` }
    }
    return { text: 'Usage: /turn-counter [demo | hide | show]' }
  })

  on('prompt.submit', async ($, e, next) => {
    await update($, turn, () => null)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (!e.agentId) await update($, turn, current => countCall(current, ran.deny !== undefined || ran.isError === true))
    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) await update($, turn, () => null)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rest = await next(e)
    try {
      if (e.props.hasSurvey || e.props.maxRows < 1 || (await read($, isHidden))) return rest
      const text = bandTextOf(await read($, turn), e.props.bodyColumns - 2)
      if (!text) return rest
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box flexDirection="column">
          <Box paddingX={1}>
            <Text color="#D97757">{text}</Text>
          </Box>
          {rest}
        </Box>
      )
    } catch {
      return rest
    }
  })
}

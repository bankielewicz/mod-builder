import { describe, expect, mock, test } from 'claude-code/testing'

const COMPOSER = { kind: 'composer' } as const
const PRESENTATION = { isFullscreen: false, columns: 120 } as const

describe('ui', () => {
  test('add, list and clear through the command', async ($, on) => {
    mock.clock(on, { now: 5 })
    mock.store(on, {})
    on('session.start', ($, e) => ({ cwd: e.cwd }) as never)
    on('command.register', () => ({ value: undefined }) as never)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    const run = async (args: string) => (await $.command.run({ command: '__NAME__', args, origin: COMPOSER, presentation: PRESENTATION })).text

    expect(await run('')).toStartWith('__TITLE__: no notes yet.')
    expect(await run('ship the release')).toBe('__TITLE__: noted (1).')
    expect(await run('list')).toBe('1. ship the release')
    expect(await run('clear')).toBe('__TITLE__: cleared.')
    expect(await run('list')).toStartWith('__TITLE__: no notes yet.')
  })
})

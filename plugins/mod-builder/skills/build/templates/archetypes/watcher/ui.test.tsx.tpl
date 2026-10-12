import { describe, expect, mock, test } from 'claude-code/testing'

describe('ui', () => {
  test('a slow turn updates the status line, toasts and notifies', async ($, on) => {
    const clock = mock.clock(on, { now: 0 })
    const status: (string | undefined)[] = []
    const toasts: string[] = []
    const notes: string[] = []
    on('session.start', ($, e) => ({ cwd: e.cwd }) as never)
    on('command.register', () => ({ value: undefined }) as never)
    on('ui.status', ($, e) => (status.push((e as { text?: string }).text), { value: undefined }) as never)
    on('ui.toast', ($, e) => (toasts.push((e as { text: string }).text), { value: undefined }) as never)
    on('ui.notify', ($, e) => (notes.push((e as { text: string }).text), { value: { isSent: true, channel: 'terminal' } }) as never)
    on('prompt.submit', ($, e) => ({ text: e.text }) as never)
    on('turn.complete', () => ({ text: '' }) as never)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })

    await $.prompt.submit({ text: 'go' } as never)
    await clock.advance(150_000)
    await $.turn.complete({ answer: 'done' } as never)
    expect(status.at(-1)).toBe('◆ 1 turn · 0 tool calls')
    expect(toasts).toEqual(['That turn took 2m 30s'])
    expect(notes).toEqual(['That turn took 2m 30s'])
  })
})

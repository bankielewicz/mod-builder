import { describe, expect, mock, test } from 'claude-code/testing'

const PANE = { title: '__TITLE__', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} } as const
const COMPOSER = { kind: 'composer' } as const
const PRESENTATION = { isFullscreen: false, columns: 120 } as const

describe('ui', () => {
  test('demo fills the pane on terminal and desktop; Toggle flips the selected item', async ($, on) => {
    mock.clock(on)
    const opened: string[] = []
    on('session.start', ($, e) => ({ cwd: e.cwd }) as never)
    on('command.register', () => ({ value: undefined }) as never)
    on('ui.open', ($, e) => (opened.push(e.id), { value: { isPlaced: true } }) as never)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    const { text } = await $.command.run({ command: '__NAME__', args: 'demo', origin: COMPOSER, presentation: PRESENTATION })
    expect(text).toBe('__TITLE__: demo items are in the pane.')

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: '__NAME__', surface, component: 'Pane', requestId: '__NAME__', props: PANE, viewport: { columns: 100, rows: 30 } })
      expect(await ui.find({ type: 'Text', text: /2 of 4 done/ })).toBeDefined()
      await ui.unmount()
    }
    expect(opened).toEqual(['__NAME__'])

    const ui = await $.ui.mount({ plugin: '__NAME__', surface: 'terminal', component: 'Pane', requestId: '__NAME__', props: PANE, viewport: { columns: 100, rows: 30 } })
    await ui.press({ key: 'toggle' })
    await ui.unmount()
    const after = await $.ui.mount({ plugin: '__NAME__', surface: 'terminal', component: 'Pane', requestId: '__NAME__', props: PANE, viewport: { columns: 100, rows: 30 } })
    expect(await after.find({ type: 'Text', text: /1 of 4 done/ })).toBeDefined()
  })
})

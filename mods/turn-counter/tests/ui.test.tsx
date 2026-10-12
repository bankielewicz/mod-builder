import { describe, expect, mock, test } from 'claude-code/testing'

const BAND = { hasSurvey: false, isWorking: true, maxRows: 4, bodyColumns: 80, scroll: { offset: 0, bodyRows: 4 }, view: {} } as const
const COMPOSER = { kind: 'composer' } as const
const PRESENTATION = { isFullscreen: false, columns: 120 } as const

describe('ui', () => {
  test('demo draws the band above the band below; idle draws only the band below', async ($, on) => {
    mock.clock(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }) as never)
    on('command.register', () => ({ value: undefined }) as never)
    on('ui.render', ($, e) => $.ui.resolve(e).Text({ children: 'band below' }) as never)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    const mount = () => $.ui.mount({ plugin: 'turn-counter', surface: 'terminal', component: 'AbovePrompt', requestId: 'band', props: BAND, viewport: { columns: 90, rows: 30 } })

    const idle = await mount()
    expect(await idle.find({ type: 'Text', text: /◆ turn-counter/ })).toBeUndefined()
    expect(await idle.find({ type: 'Text', text: /band below/ })).toBeDefined()
    await idle.unmount()

    await $.command.run({ command: 'turn-counter', args: 'demo', origin: COMPOSER, presentation: PRESENTATION })
    for (const surface of ['terminal', 'desktop'] as const) {
      const shown = await $.ui.mount({ plugin: 'turn-counter', surface, component: 'AbovePrompt', requestId: 'band', props: BAND, viewport: { columns: 90, rows: 30 } })
      expect(await shown.find({ type: 'Text', text: /7 tool calls this turn · 1 failed/ })).toBeDefined()
      expect(await shown.find({ type: 'Text', text: /band below/ })).toBeDefined()
      await shown.unmount()
    }
  })
})

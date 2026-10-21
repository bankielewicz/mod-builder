import { describe, expect, mock, test } from 'claude-code/testing'

const BAND = { hasSurvey: false, isWorking: true, maxRows: 4, bodyColumns: 80, scroll: { offset: 0, bodyRows: 4 }, view: {} } as const
const COMPOSER = { kind: 'composer' } as const
const PRESENTATION = { isFullscreen: false, columns: 120 } as const

describe('ui', () => {
  // demo writes `turn`, which this turn's tool.call and turn.complete hooks write too, so it waits for the turn (#119, PR #122 review).
  test('the command waits for the turn to end', async ($, on) => {
    const registered: { name: string; immediate?: true }[] = []
    on('session.start', ($, e) => ({ cwd: e.cwd }) as never)
    on('command.register', ($, e) => (registered.push({ ...e }), { value: undefined }) as never)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    expect(registered.map(r => [r.name, r.immediate])).toEqual([['__NAME__', undefined]])
  })

  test('demo draws the band above the band below; idle draws only the band below', async ($, on) => {
    mock.clock(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }) as never)
    on('command.register', () => ({ value: undefined }) as never)
    on('ui.render', ($, e) => $.ui.resolve(e).Text({ children: 'band below' }) as never)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    const mount = () => $.ui.mount({ plugin: '__NAME__', surface: 'terminal', component: 'AbovePrompt', requestId: 'band', props: BAND, viewport: { columns: 90, rows: 30 } })

    const idle = await mount()
    expect(await idle.find({ type: 'Text', text: /◆ __NAME__/ })).toBeUndefined()
    expect(await idle.find({ type: 'Text', text: /band below/ })).toBeDefined()
    await idle.unmount()

    await $.command.run({ command: '__NAME__', args: 'demo', origin: COMPOSER, presentation: PRESENTATION })
    for (const surface of ['terminal', 'desktop'] as const) {
      const shown = await $.ui.mount({ plugin: '__NAME__', surface, component: 'AbovePrompt', requestId: 'band', props: BAND, viewport: { columns: 90, rows: 30 } })
      expect(await shown.find({ type: 'Text', text: /7 tool calls this turn · 1 failed/ })).toBeDefined()
      expect(await shown.find({ type: 'Text', text: /band below/ })).toBeDefined()
      await shown.unmount()
    }
  })
})

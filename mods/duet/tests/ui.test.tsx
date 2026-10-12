import { describe, expect, mock, test } from 'claude-code/testing'

const PANE = { title: 'Duet', isFocused: true, bodyColumns: 76, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const
const COMPOSER = { kind: 'composer' } as const
const PRESENTATION = { isFullscreen: false, columns: 160 } as const

function engine(on: any, opened: string[]) {
  mock.clock(on)
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }))
  on('ui.open', ($: any, e: any) => (opened.push(e.id), { value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('env.get', () => ({ value: '/home/u' }))
  on('fs.read', ($: any, e: any) =>
    e.path.endsWith('runs.jsonl')
      ? { value: '{"id":"d1","at":0,"provider":"codex","kind":"agent","type":"Explore","model":"","ms":4000,"tokens":900,"ok":true}\n' }
      : { deny: 'ENOENT' })
}

const mount = ($: any, surface: 'terminal' | 'desktop', props: object = PANE) =>
  $.ui.mount({ plugin: 'duet', surface, component: 'Pane', requestId: 'duet', props, viewport: { columns: 120, rows: 40 } })

describe('ui', () => {
  test('empty pane names how to start, with the routes line', { options: { codexAgents: 'code-explorer' } }, async ($, on) => {
    const opened: string[] = []
    engine(on, opened)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    const r = await $.command.run({ command: 'duet', args: '', origin: COMPOSER, presentation: PRESENTATION })
    expect(r.text).toContain('codex ← code-explorer (named, isolated and nested calls stay on Claude)')
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await mount($, surface)
      expect(await ui.find({ type: 'Text', text: /D U E T/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /No Codex tasks yet/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /codex ← code-explorer · named, isolated, nested stay Claude/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /roles   advisor waits · reviewer bg · others bg/ })).toBeDefined()
      await ui.unmount()
    }
    expect(opened).toEqual(['duet'])
  })

  test('demo shows every state on terminal and desktop; Stats swaps the view; narrow is compact', async ($, on) => {
    engine(on, [])
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    const { text } = await $.command.run({ command: 'duet', args: 'demo', origin: COMPOSER, presentation: PRESENTATION })
    expect(text).toMatch(/demo tasks/)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await mount($, surface)
      for (const re of [/running/, /verdict: changes requested/, /✕ codex: not signed in/, /refused/, /code-explorer/, /spec 3fa9c21/]) {
        expect(await ui.find({ type: 'Text', text: re })).toBeDefined()
      }
      await ui.unmount()
    }
    const ui = await mount($, 'terminal')
    await ui.press({ key: 'stats' })
    await ui.unmount()
    const stats = await mount($, 'terminal')
    expect(await stats.find({ type: 'Text', text: /codex · Explore/ })).toBeDefined()
    await stats.unmount()

    const narrow = await mount($, 'terminal', { ...PANE, bodyColumns: 36 })
    expect(await narrow.find({ type: 'Text', text: /DUET/ })).toBeDefined()
    expect(await narrow.find({ type: 'Text', text: /routes/ })).toBeUndefined()
    await narrow.unmount()
  })

  test('/duet stats, routes and a bad review target answer in text', { options: { codexAgents: '' } }, async ($, on) => {
    engine(on, [])
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    const run = (args: string) => $.command.run({ command: 'duet', args, origin: COMPOSER, presentation: PRESENTATION })
    expect((await run('stats')).text).toContain('codex · Explore')
    expect((await run('routes')).text).toContain('nothing routed')
    expect((await run('review --base --x')).text).toMatch(/^Usage/)
  })
})

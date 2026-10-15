import { describe, expect, mock, test } from 'claude-code/testing'

const PANE = { title: 'Duet', isFocused: true, bodyColumns: 76, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const
const COMPOSER = { kind: 'composer' } as const
const PRESENTATION = { isFullscreen: false, columns: 160 } as const

const DATA = '/home/u/.claude/duet-data'
const LEGACY_LOG = `${DATA}/runs.jsonl`
const RUN = (provider: 'codex' | 'claude', type: string) => JSON.stringify({ id: 'd1', at: 0, provider, kind: 'agent', type, model: '', ms: 4000, tokens: 900, ok: true }) + '\n'

/** `sessions`: each session folder's runs.jsonl, by folder name; the legacy log holds one codex Explore run. */
function engine(on: any, opened: string[], sessions: Record<string, string> = {}) {
  mock.clock(on)
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }))
  on('ui.open', ($: any, e: any) => (opened.push(e.id), { value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('env.get', () => ({ value: '/home/u' }))
  on('session.id', () => ({ value: 's1' }))
  // With no session logs the sessions folder is not there, as before a first run: listing it fails.
  on('fs.list', ($: any, e: any) =>
    String(e.path).replace(/\/+$/, '') === `${DATA}/sessions` && Object.keys(sessions).length
      ? { value: Object.keys(sessions).map(name => ({ name, kind: 'dir', size: 0, mtimeMs: 1, isLink: false })) }
      : { deny: 'ENOENT: no such directory' })
  on('fs.read', ($: any, e: any) => {
    if (e.path === LEGACY_LOG) return { value: RUN('codex', 'Explore') }
    const session = Object.keys(sessions).find(name => e.path === `${DATA}/sessions/${name}/runs.jsonl`)
    return session ? { value: sessions[session] } : { deny: 'ENOENT' }
  })
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

  test('/duet stats counts the legacy log and every session\'s log', { options: { codexAgents: '' } }, async ($, on) => {
    engine(on, [], { s1: RUN('codex', 'Explore') + RUN('codex', 'Explore'), s2: RUN('claude', 'Explore') + RUN('codex', 'Explore') })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    const { text } = await $.command.run({ command: 'duet', args: 'stats', origin: COMPOSER, presentation: PRESENTATION })
    expect(text).toMatch(/^codex · Explore\s+4\s/m)
    expect(text).toMatch(/^claude · Explore\s+1\s/m)
  })

  test('the pane\'s Stats view counts every session\'s log too', async ($, on) => {
    engine(on, [], { s2: RUN('claude', 'Explore') })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await $.command.run({ command: 'duet', args: 'demo', origin: COMPOSER, presentation: PRESENTATION })
    const ui = await mount($, 'terminal')
    await ui.press({ key: 'stats' })
    await ui.unmount()
    const stats = await mount($, 'terminal')
    expect(await stats.find({ type: 'Text', text: /claude · Explore/ })).toBeDefined()
    await stats.unmount()
  })

  test('the selection stops at the last drawn row: after more presses than rows, a row is still highlighted (PR #1: 6148aa6)', async ($, on) => {
    engine(on, [])
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await $.command.run({ command: 'duet', args: 'demo', origin: COMPOSER, presentation: PRESENTATION })
    // The demo lists 5 tasks; bodyRows 10 draws 2 of them (d5, d4).
    const props = { ...PANE, scroll: { offset: 0, bodyRows: 10 } }
    let ui = await mount($, 'terminal', props)
    for (let press = 1; press <= 6; press++) {
      await ui.press({ key: 'next' })
      await ui.unmount()
      ui = await mount($, 'terminal', props)
      expect([press, (await ui.find({ type: 'Text', text: /▸ d4 / })) !== undefined]).toEqual([press, true])
    }
    await ui.unmount()
  })
})

import { describe, expect, mock, test } from 'claude-code/testing'
import { demoTasks, rowsThatFit } from '../hooks/duet-logic'

const PANE = { title: 'Duet', isFocused: true, bodyColumns: 76, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const
const COMPOSER = { kind: 'composer' } as const
const PRESENTATION = { isFullscreen: false, columns: 160 } as const

const DATA = '/home/u/.claude/duet-data'
const LEGACY_LOG = `${DATA}/runs.jsonl`
const RUN = (provider: 'codex' | 'claude', type: string) => JSON.stringify({ id: 'd1', at: 0, provider, kind: 'agent', type, model: '', ms: 4000, tokens: 900, ok: true }) + '\n'

/**
 * What the pane stubs list and record (#31). `panes` is what `$.ui.panes()` answers (`isShown: false` is a tab behind another
 * pane, `isPlaced: false` one waiting undrawn; a row is placed unless it says so); a listed pane comes to the front once it was opened while `showOnOpen` is set. `opens` takes every `$.ui.open`
 * whole, `focus` included; `closed` every `$.ui.close`; `toasts` every `$.ui.toast`.
 */
type PaneWorld = { panes?: { id: string; isShown: boolean; isPlaced?: boolean }[]; showOnOpen?: boolean; opens?: any[]; closed?: string[]; toasts?: string[] }

/** `sessions`: each session folder's runs.jsonl, by folder name; the legacy log holds one codex Explore run. Returns the test's clock. */
function engine(on: any, opened: string[], sessions: Record<string, string> = {}, world: PaneWorld = {}) {
  const clock = mock.clock(on)
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }))
  on('ui.open', ($: any, e: any) => (opened.push(e.id), world.opens?.push({ ...e }), { value: { isPlaced: true } }))
  on('ui.panes', () => ({
    value: (world.panes ?? []).map(pane => ({ id: pane.id, title: pane.id, isFocused: false, isPlaced: pane.isPlaced ?? true, isShown: pane.isShown || (world.showOnOpen === true && opened.includes(pane.id)) })),
  }))
  on('ui.close', ($: any, e: any) => (world.closed?.push(e.id), { value: undefined }))
  on('ui.toast', ($: any, e: any) => (world.toasts?.push(e.text), { value: undefined }))
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
  return clock
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
      for (const re of [/running/, /verdict: changes requested/, /✕ codex: not signed in/, /refused/, /stopped: you pressed Esc/, /code-explorer/, /spec 3fa9c21/]) {
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
    const clock = engine(on, [])
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await $.command.run({ command: 'duet', args: 'demo', origin: COMPOSER, presentation: PRESENTATION })
    await clock.settle() // the demo's tasks are set without being awaited
    // The demo lists 6 tasks and bodyRows 10 draws 2 of them (d6, d5), so d5 is the last drawn row. If the demo or the
    // pane's chrome changes, these two fail first and say which.
    expect(demoTasks(0).length).toBe(6)
    expect(rowsThatFit(10)).toBe(2)
    const props = { ...PANE, scroll: { offset: 0, bodyRows: 10 } }
    let ui = await mount($, 'terminal', props)
    for (let press = 1; press <= 6; press++) {
      await ui.press({ key: 'next' })
      await clock.settle()
      await ui.unmount()
      ui = await mount($, 'terminal', props)
      expect([press, (await ui.find({ type: 'Text', text: /▸ d5 / })) !== undefined]).toEqual([press, true])
    }
    await ui.unmount()
  })
})

describe('a pane behind another tab is brought to the front, not closed (#31)', () => {
  const SHOW = 'Bringing the pane to the front; it takes the keyboard if your prompt is empty (Esc gives it back).'
  const STILL_BEHIND = 'Duet is still behind another tab: ctrl+x tab, then again until it shows.'
  const HIDDEN = [{ id: 'duet', isShown: false }]
  /** Open but waiting undrawn: an unasked open on a narrow terminal, or any open with no surface to draw it (d.ts `UiPane.isPlaced`). */
  const WAITING = [{ id: 'duet', isShown: false, isPlaced: false }]
  // The read after the open may come at once or after 500 ms (the probe of #31 decides), so each test lets 1 s pass.
  const SETTLED_MS = 1000

  const world = (extra: PaneWorld = {}) => ({ opens: [] as any[], closed: [] as string[], toasts: [] as string[], ...extra })
  const duet = ($: any, args: string) => $.command.run({ command: 'duet', args, origin: COMPOSER, presentation: PRESENTATION })

  test('a bare /duet answers at once, opens the hidden pane with the keyboard, and closes nothing', async ($, on) => {
    const w = world({ panes: HIDDEN })
    const clock = engine(on, [], {}, w)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    expect((await duet($, '')).text).toBe(SHOW)
    await clock.advance(SETTLED_MS)
    expect(w.closed).toEqual([])
    expect(w.opens.at(-1)).toMatchObject({ id: 'duet', title: 'Duet', columns: 76, focus: true })
  })

  test('a bare /duet by pane state: not listed opens without the keyboard, shown closes, hidden is brought to the front', async ($, on) => {
    const w = world({ panes: [] })
    const clock = engine(on, [], {}, w)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    expect((await duet($, '')).text).toMatch(/^Opened\. /)
    await clock.advance(10)
    expect(w.opens.map(open => open.focus)).toEqual([undefined])
    w.opens.length = 0
    w.panes = [{ id: 'duet', isShown: true }]
    expect((await duet($, '')).text).toBe('Closed. /duet to reopen.')
    await clock.advance(10)
    expect(w.closed).toEqual(['duet'])
    expect(w.opens).toEqual([])
    w.closed.length = 0
    w.panes = HIDDEN
    expect((await duet($, '')).text).toBe(SHOW)
    await clock.advance(SETTLED_MS)
    expect(w.closed).toEqual([])
    expect(w.opens.at(-1)).toMatchObject({ id: 'duet', focus: true })
  })

  test('a pane still behind another tab after the open is named in a toast', async ($, on) => {
    const w = world({ panes: HIDDEN })
    const clock = engine(on, [], {}, w)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await duet($, '')
    await clock.advance(SETTLED_MS)
    expect(w.opens.at(-1)).toMatchObject({ id: 'duet', focus: true })
    expect(w.toasts).toContain(STILL_BEHIND)
  })

  test('a pane that came forward after the open gets no toast', async ($, on) => {
    const w = world({ panes: HIDDEN, showOnOpen: true })
    const clock = engine(on, [], {}, w)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    expect((await duet($, '')).text).toBe(SHOW)
    await clock.advance(SETTLED_MS)
    expect(w.opens.at(-1)).toMatchObject({ id: 'duet', focus: true })
    expect(w.toasts).not.toContain(STILL_BEHIND)
  })

  test('a pane waiting undrawn is no tab behind another: a bare /duet opens it as before, without the keyboard or a "behind" toast (PR #96 review, Codex P2)', async ($, on) => {
    const w = world({ panes: WAITING })
    const clock = engine(on, [], {}, w)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    expect((await duet($, '')).text).toMatch(/^Opened\. /)
    await clock.advance(SETTLED_MS)
    expect(w.opens.map(open => open.focus)).toEqual([undefined])
    expect(w.closed).toEqual([])
    expect(w.toasts).not.toContain(STILL_BEHIND)
  })

  test('/duet demo with its pane waiting undrawn opens it without the keyboard or a "behind" toast (PR #96 review, Codex P2)', async ($, on) => {
    const w = world({ panes: WAITING })
    const clock = engine(on, [], {}, w)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    expect((await duet($, 'demo')).text).toMatch(/demo tasks/)
    await clock.advance(SETTLED_MS)
    expect(w.opens.map(open => open.focus)).toEqual([undefined])
    expect(w.toasts).not.toContain(STILL_BEHIND)
  })

  test('/duet demo with the pane hidden keeps its answer and brings the pane forward with the keyboard; with none listed it opens plain', async ($, on) => {
    const w = world({ panes: HIDDEN })
    const clock = engine(on, [], {}, w)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    expect((await duet($, 'demo')).text).toMatch(/demo tasks/)
    await clock.advance(SETTLED_MS)
    expect(w.opens.at(-1)).toMatchObject({ id: 'duet', title: 'Duet', columns: 76, focus: true })
    expect(w.closed).toEqual([])
    expect(w.toasts).toContain(STILL_BEHIND)
    w.opens.length = 0
    w.panes = []
    await duet($, 'demo')
    await clock.advance(SETTLED_MS)
    expect(w.opens.map(open => open.focus)).toEqual([undefined])
  })

  test('/duet demo asks for the pane before its hook returns, ahead of the demo state it writes (PR #96 review, Codex 4290452262)', async ($, on) => {
    const w = world({ panes: HIDDEN })
    const clock = engine(on, [], {}, w)
    // Once set, every state write waits: an open that comes after the demo's writes has not gone out.
    let writes: Promise<void> | null = null
    let release: () => void = () => undefined
    on('state.set', ($: any, e: any, next: any) => (writes ? writes.then(() => next(e)) : next(e)))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    writes = new Promise<void>(resolve => (release = resolve))
    expect((await duet($, 'demo')).text).toMatch(/demo tasks/)
    expect(w.opens.length).toBe(1)
    expect(w.opens[0]).toMatchObject({ id: 'duet', focus: true })
    release()
    await clock.advance(SETTLED_MS)
    expect(w.opens.length).toBe(1)
  })

  test('/duet demo with the pane hidden gets no toast once the pane came forward', async ($, on) => {
    const w = world({ panes: HIDDEN, showOnOpen: true })
    const clock = engine(on, [], {}, w)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await duet($, 'demo')
    await clock.advance(SETTLED_MS)
    expect(w.opens.at(-1)).toMatchObject({ id: 'duet', focus: true })
    expect(w.toasts).not.toContain(STILL_BEHIND)
  })

  test('the pane hint holds for any tab, and a narrower pane cuts it rather than wrapping it', async ($, on) => {
    engine(on, [])
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    const ui = await mount($, 'terminal')
    const hint = await ui.find({ type: 'Text', text: /^ctrl\+x tab: keys, again: next tab {2}· {2}r review {2}s stats {2}j\/k {2}c close$/ })
    expect(hint).toBeDefined()
    expect(hint?.props.wrap).toBe('truncate')
    expect(await ui.find({ type: 'Text', text: /pane keys/ })).toBeUndefined()
    await ui.unmount()
  })
})

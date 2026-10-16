import { describe, expect, mock, test, type Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const PANE = { title: '__TITLE__', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} } as const
const COMPOSER = { kind: 'composer' } as const
const PRESENTATION = { isFullscreen: false, columns: 120 } as const

/**
 * What the stubs list and record. `panes` is what `$.ui.panes()` answers: `isShown: false` is a tab behind another pane,
 * `isPlaced: false` one waiting undrawn (a row is placed unless it says so).
 * A listed pane comes to the front once it was opened while `showOnOpen` is set.
 */
type World = { panes: { id: string; isShown: boolean; isPlaced?: boolean }[]; showOnOpen: boolean; opens: { id: string; focus?: boolean }[]; closed: string[]; toasts: string[] }

function engine(on: On, w: Partial<World> = {}) {
  const world: World = { panes: [], showOnOpen: false, opens: [], closed: [], toasts: [], ...w }
  const clock = mock.clock(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('ui.open', ($, e) => (world.opens.push({ ...e }), { value: { isPlaced: true } }) as never)
  on('ui.panes', () => ({
    value: world.panes.map(pane => ({ id: pane.id, title: pane.id, isFocused: false, isPlaced: pane.isPlaced ?? true, isShown: pane.isShown || (world.showOnOpen && world.opens.some(open => open.id === pane.id)) })),
  }) as never)
  on('ui.close', ($, e) => (world.closed.push(e.id), { value: undefined }) as never)
  on('ui.toast', ($, e) => (world.toasts.push(e.text), { value: undefined }) as never)
  return { world, clock }
}

const command = ($: Engine, args: string) => $.command.run({ command: '__NAME__', args, origin: COMPOSER, presentation: PRESENTATION })

describe('ui', () => {
  test('demo fills the pane on terminal and desktop; Toggle flips the selected item', async ($, on) => {
    const { world } = engine(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    const { text } = await command($, 'demo')
    expect(text).toBe('__TITLE__: demo items are in the pane.')

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: '__NAME__', surface, component: 'Pane', requestId: '__NAME__', props: PANE, viewport: { columns: 100, rows: 30 } })
      expect(await ui.find({ type: 'Text', text: /2 of 4 done/ })).toBeDefined()
      await ui.unmount()
    }
    // Not listed: a plain open, never the keyboard.
    expect(world.opens).toEqual([{ id: '__NAME__', title: '__TITLE__', columns: 60 }])

    const ui = await $.ui.mount({ plugin: '__NAME__', surface: 'terminal', component: 'Pane', requestId: '__NAME__', props: PANE, viewport: { columns: 100, rows: 30 } })
    await ui.press({ key: 'toggle' })
    await ui.unmount()
    const after = await $.ui.mount({ plugin: '__NAME__', surface: 'terminal', component: 'Pane', requestId: '__NAME__', props: PANE, viewport: { columns: 100, rows: 30 } })
    expect(await after.find({ type: 'Text', text: /1 of 4 done/ })).toBeDefined()
  })
})

// A pane behind another tab is brought to the front, not closed. Each wait is 1 s, past the 500 ms the check takes.
describe('a bare command, by pane state', () => {
  const HIDDEN = [{ id: '__NAME__', isShown: false }]
  /** Open but waiting undrawn: an unasked open on a narrow terminal, or any open with no surface to draw it. */
  const WAITING = [{ id: '__NAME__', isShown: false, isPlaced: false }]

  test('not listed: it opens the pane without the keyboard', async ($, on) => {
    const { world, clock } = engine(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    expect((await command($, '')).text).toBe('__TITLE__ opened.')
    await clock.advance(1000)
    expect(world.opens.map(open => open.focus)).toEqual([undefined])
    expect(world.closed).toEqual([])
  })

  test('waiting undrawn: it is no tab behind another, so it opens as before, without the keyboard or a toast', async ($, on) => {
    const { world, clock } = engine(on, { panes: WAITING })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    expect((await command($, '')).text).toBe('__TITLE__ opened.')
    await clock.advance(1000)
    expect(world.opens.map(open => open.focus)).toEqual([undefined])
    expect(world.closed).toEqual([])
    expect(world.toasts).toEqual([])
  })

  test('demo with the pane waiting undrawn opens it without the keyboard or a toast', async ($, on) => {
    const { world, clock } = engine(on, { panes: WAITING })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    expect((await command($, 'demo')).text).toBe('__TITLE__: demo items are in the pane.')
    await clock.advance(1000)
    expect(world.opens.map(open => open.focus)).toEqual([undefined])
    expect(world.toasts).toEqual([])
  })

  test('shown: it closes the pane', async ($, on) => {
    const { world, clock } = engine(on, { panes: [{ id: '__NAME__', isShown: true }] })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    expect((await command($, '')).text).toBe('__TITLE__ closed. /__NAME__ to reopen.')
    await clock.advance(1000)
    expect(world.closed).toEqual(['__NAME__'])
    expect(world.opens).toEqual([])
  })

  test('behind another tab: it answers at once, brings the pane to the front with the keyboard, and closes nothing', async ($, on) => {
    const { world, clock } = engine(on, { panes: HIDDEN, showOnOpen: true })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    expect((await command($, '')).text).toBe('Bringing __TITLE__ to the front; it takes the keyboard if your prompt is empty (Esc gives it back).')
    await clock.advance(1000)
    expect(world.closed).toEqual([])
    expect(world.opens.at(-1)).toMatchObject({ id: '__NAME__', focus: true })
    // It came forward: nothing to say.
    expect(world.toasts).toEqual([])
  })

  test('behind another tab and still there after the open: a toast says how to reach it', async ($, on) => {
    const { world, clock } = engine(on, { panes: HIDDEN })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await command($, '')
    await clock.advance(1000)
    expect(world.opens.at(-1)).toMatchObject({ id: '__NAME__', focus: true })
    expect(world.toasts).toEqual(['__TITLE__ is still behind another tab: ctrl+x tab, then again until it shows.'])
  })

  test('demo asks for the pane before its hook returns, ahead of the demo items it writes', async ($, on) => {
    const { world, clock } = engine(on, { panes: HIDDEN })
    // Once set, every state write waits: an open that comes after the demo's writes has not gone out.
    let writes: Promise<void> | null = null
    let release: () => void = () => undefined
    on('state.set', (($: unknown, e: unknown, next: (e: unknown) => unknown) => (writes ? writes.then(() => next(e)) : next(e))) as never)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    writes = new Promise<void>(resolve => (release = resolve))
    expect((await command($, 'demo')).text).toBe('__TITLE__: demo items are in the pane.')
    expect(world.opens.length).toBe(1)
    expect(world.opens[0]).toMatchObject({ id: '__NAME__', focus: true })
    release()
    await clock.advance(1000)
    expect(world.opens.length).toBe(1)
  })

  test('demo with the pane behind another tab keeps its answer and brings the pane to the front', async ($, on) => {
    const { world, clock } = engine(on, { panes: HIDDEN, showOnOpen: true })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    expect((await command($, 'demo')).text).toBe('__TITLE__: demo items are in the pane.')
    await clock.advance(1000)
    expect(world.opens.at(-1)).toMatchObject({ id: '__NAME__', focus: true })
    expect(world.closed).toEqual([])
    expect(world.toasts).toEqual([])
  })
})

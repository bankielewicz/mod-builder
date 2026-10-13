import { describe, expect, mock, test } from 'claude-code/testing'

const COMPOSER = { kind: 'composer' } as const
const PRESENTATION = { isFullscreen: false, columns: 160 } as const

/** Stands for the /config menu: duet's rows, and every set the mod asks for. */
const CATALOG = JSON.stringify({ models: [
  { slug: 'gpt-6.1-sol', display_name: 'GPT-6.1-Sol', description: 'Latest workhorse model.', visibility: 'list', base_instructions: 'x'.repeat(2000) },
  { slug: 'gpt-6-sol', display_name: 'GPT-6-Sol', description: '', visibility: 'list' },
  { slug: 'gpt-reserve', display_name: 'GPT-Reserve', description: '', visibility: 'hide' },
] })

function engine(on: any, opts: { deny?: string; opened?: string[]; cutOnce?: boolean; codex?: 'ok' | 'missing' | 'fail'; fetches?: string[][]; panes?: string[] } = {}) {
  const sets: { key: string; value: unknown }[] = []
  on('process.run', ($: any, e: any) => {
    opts.fetches?.push(e.argv)
    if (opts.codex === 'missing') return { deny: 'spawn codex ENOENT' }
    if (opts.codex === 'fail') return { value: { exitCode: 1, stdout: '', stderr: 'Error: not logged in\nmore', isStdoutTruncated: false, isStderrTruncated: false } }
    return { value: { exitCode: 0, stdout: CATALOG, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  let cut = opts.cutOnce ?? false
  mock.clock(on)
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }))
  on('config.list', () => {
    if (cut) { cut = false; throw new Error('reloaded mid-save') }
    return {
    value: ['codexAgents', 'codexSandbox', 'codexModel', 'maxConcurrent', 'timeoutMinutes', 'codexConsent'].map(f => ({
      key: `duet.${f}`, label: f, kind: 'text', value: '', provider: { plugin: 'duet' }, isLocked: false,
    })),
  }})
  on('config.set', ($: any, e: any) => {
    if (opts.deny) return { deny: opts.deny }
    sets.push({ key: e.key, value: e.value })
    return { value: e.value }
  })
  on('ui.open', ($: any, e: any) => (opts.opened?.push(e.id), { value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: (opts.panes ?? []).map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })) }))
  return sets
}

async function run($: any, args: string): Promise<string> {
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
  return (await $.command.run({ command: 'duet', args, origin: COMPOSER, presentation: PRESENTATION })).text
}

describe('/duet config', () => {
  test('with no field lists every option, stored values and defaults', { options: { codexAgents: '*', codexModel: 'gpt-6 sol' } }, async ($, on) => {
    engine(on)
    const text = await run($, 'config list')
    expect(text).toContain('codexModel')
    expect(text).toContain('gpt-6 sol')
    expect(text).toContain('maxConcurrent')
    expect(text).toContain('read-only')
  })

  test('sets a text field by alias, "" clears it', async ($, on) => {
    const sets = engine(on)
    expect(await run($, 'config model gpt-5-codex')).toContain('codexModel = gpt-5-codex')
    expect(await run($, 'config codexModel ""')).toContain('codexModel = (empty)')
    expect(sets).toEqual([{ key: 'duet.codexModel', value: 'gpt-5-codex' }, { key: 'duet.codexModel', value: '' }])
  })

  test('sets a number field as a number', async ($, on) => {
    const sets = engine(on)
    await run($, 'config timeout 45')
    expect(sets).toEqual([{ key: 'duet.timeoutMinutes', value: 45 }])
  })

  test('refuses bad values and unknown fields without writing', async ($, on) => {
    const sets = engine(on)
    expect(await run($, 'config sandbox danger-full-access')).toContain('takes one of read-only, workspace-write')
    expect(await run($, 'config max lots')).toContain('takes a number')
    expect(await run($, 'config nope 1')).toContain('no option "nope"')
    expect(await run($, 'config model')).toContain('needs a value')
    expect(sets).toEqual([])
  })

  test('relays a refusal from the settings writer', async ($, on) => {
    engine(on, { deny: 'locked by policy' })
    expect(await run($, 'config consent allow')).toContain('not changed: locked by policy')
  })
})

const PANE = { title: 'Duet config', isFocused: true, bodyColumns: 76, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const
const mount = ($: any, surface: 'terminal' | 'desktop') =>
  $.ui.mount({ plugin: 'duet', surface, component: 'Pane', requestId: 'duet-config', props: PANE, viewport: { columns: 120, rows: 40 } })

/** Rows: agents, sandbox, model, max, timeout, consent, mode. */
async function goTo(ui: any, row: number) {
  for (let i = 0; i < row; i++) await ui.press({ key: 'cfg-next' })
}

describe('/duet config pane', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`${surface}: every row reachable; edits stay a draft until Save`, { options: { codexModel: 'gpt-6 sol', codexAgents: '*' } }, async ($, on) => {
      const opened: string[] = []
      const sets = engine(on, { opened })
      expect(await run($, 'config')).toContain('Config pane opened')
      expect(opened).toContain('duet-config')
      const ui = await mount($, surface)
      expect(await ui.find({ type: 'Text', text: /▸.*agents\s+\*/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /model\s+gpt-6 sol/ })).toBeDefined()

      await goTo(ui, 1)                                   // sandbox: a choice cycles
      expect(await ui.find({ type: 'Text', text: /▸.*sandbox/ })).toBeDefined()
      await ui.press({ key: 'cfg-change' })
      expect(await ui.find({ type: 'Text', text: /sandbox\s+workspace-write/ })).toBeDefined()

      await goTo(ui, 1)                                   // model: e opens the list, t its text box
      await ui.press({ key: 'cfg-change' })
      await ui.press({ key: 'cfg-type' })
      await ui.input({ key: 'cfg-edit', text: '', kind: 'submit' })
      expect(await ui.find({ type: 'Input' } as never)).toBeUndefined()

      await goTo(ui, 3)                                   // consent, the last row
      await ui.press({ key: 'cfg-change' })
      expect(await ui.find({ type: 'Text', text: /consent\s+allow/ })).toBeDefined()

      expect(sets).toEqual([])
      expect(await ui.find({ type: 'Text', text: /unsaved changes/ })).toBeDefined()
      await ui.press({ key: 'cfg-save' })
      expect(sets).toEqual([
        { key: 'duet.codexSandbox', value: 'workspace-write' },
        { key: 'duet.codexModel', value: '' },
        { key: 'duet.codexConsent', value: 'allow' },
      ])
      expect(await ui.find({ type: 'Text', text: /Saved sandbox, model, consent/ })).toBeDefined()
      await ui.unmount()
    })
  }

  test('k moves the highlight back up', async ($, on) => {
    engine(on)
    await run($, 'config')
    const ui = await mount($, 'terminal')
    await goTo(ui, 2)
    await ui.press({ key: 'cfg-prev' })
    expect(await ui.find({ type: 'Text', text: /▸.*sandbox/ })).toBeDefined()
  })

  test('a value that does not fit blocks the save and says why', async ($, on) => {
    const sets = engine(on)
    await run($, 'config')
    const ui = await mount($, 'terminal')
    await goTo(ui, 4)
    await ui.press({ key: 'cfg-change' })
    await ui.input({ key: 'cfg-edit', text: 'soon', kind: 'submit' })
    await ui.press({ key: 'cfg-save' })
    expect(sets).toEqual([])
    expect(await ui.find({ type: 'Text', text: /timeoutMinutes takes a number/ })).toBeDefined()
  })

  test('revert drops the draft', async ($, on) => {
    const sets = engine(on)
    await run($, 'config')
    const ui = await mount($, 'terminal')
    await goTo(ui, 2)
    await ui.press({ key: 'cfg-change' })
    await ui.press({ key: 'cfg-type' })
    await ui.input({ key: 'cfg-edit', text: 'x', kind: 'submit' })
    await ui.press({ key: 'cfg-revert' })
    await ui.press({ key: 'cfg-save' })
    expect(sets).toEqual([])
    expect(await ui.find({ type: 'Text', text: /Nothing to save/ })).toBeDefined()
  })

  test('a save cut short by a reload finishes at the next session.start', async ($, on) => {
    const sets = engine(on, { cutOnce: true })
    await run($, 'config')
    const ui = await mount($, 'terminal')
    await goTo(ui, 2)
    await ui.press({ key: 'cfg-change' })
    await ui.press({ key: 'cfg-type' })
    await ui.input({ key: 'cfg-edit', text: 'gpt-5-codex', kind: 'submit' })
    await ui.press({ key: 'cfg-save' })
    expect(sets).toEqual([])
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await ui.unmount()
    const again = await mount($, 'terminal')
    expect(sets).toEqual([{ key: 'duet.codexModel', value: 'gpt-5-codex' }])
    expect(await again.find({ type: 'Text', text: /Saved model/ })).toBeDefined()
    await again.unmount()
  })
})

describe('Codex models in /duet config', () => {
  test('/duet config models lists the catalog, hidden ones marked, the current one checked', { options: { codexModel: 'gpt-6-sol' } }, async ($, on) => {
    const fetches: string[][] = []
    engine(on, { fetches })
    const text = await run($, 'config models')
    expect(fetches).toEqual([['codex', 'debug', 'models']])
    expect(text).toContain('gpt-6.1-sol')
    expect(text).toMatch(/✓ gpt-6-sol/)
    expect(text).toContain('gpt-reserve')
    expect(text).toContain('(hidden)')
  })

  test('/duet config models says when codex is missing', async ($, on) => {
    engine(on, { codex: 'missing' })
    expect(await run($, 'config models')).toContain('codex not found on PATH')
  })

  test('/duet config models relays codex\'s error', async ($, on) => {
    engine(on, { codex: 'fail' })
    expect(await run($, 'config models')).toContain('Error: not logged in')
  })

  test('setting a slug Codex does not list still saves, with the nearest slug as a note', async ($, on) => {
    const sets = engine(on)
    const text = await run($, 'config model gpt-6sol')
    expect(sets).toEqual([{ key: 'duet.codexModel', value: 'gpt-6sol' }])
    expect(text).toContain('did you mean gpt-6-sol?')
    expect(await run($, 'config model gpt-6-sol')).not.toContain('Note:')
  })

  test('the model row fetches on arrival; e opens the list, a pick closes it, s saves', { options: { codexModel: 'gpt-6sol' } }, async ($, on) => {
    const fetches: string[][] = []
    const sets = engine(on, { fetches })
    await run($, 'config')
    const ui = await mount($, 'terminal')
    expect(await ui.find({ key: 'cfg-refresh' } as never)).toBeUndefined()
    await goTo(ui, 2)
    expect(fetches.length).toBe(1)
    expect(await ui.find({ type: 'Text', text: /did you mean gpt-6-sol/ })).toBeDefined()
    expect(await ui.find({ key: 'cfg-pick-gpt-6.1-sol' } as never)).toBeUndefined()

    await ui.press({ key: 'cfg-change' })
    expect(fetches.length).toBe(1)
    expect(await ui.find({ key: 'cfg-pick-gpt-6.1-sol' } as never)).toBeDefined()
    expect(await ui.find({ key: 'cfg-pick-gpt-reserve' } as never)).toBeUndefined()
    await ui.press({ key: 'cfg-pick-gpt-6-sol' })
    expect(await ui.find({ key: 'cfg-pick-gpt-6.1-sol' } as never)).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /did you mean/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /model\s+gpt-6-sol/ })).toBeDefined()
    await ui.press({ key: 'cfg-save' })
    expect(sets).toEqual([{ key: 'duet.codexModel', value: 'gpt-6-sol' }])

    await ui.press({ key: 'cfg-refresh' })                // r refetches and opens the list
    expect(fetches.length).toBe(2)
    expect(await ui.find({ key: 'cfg-pick-0' } as never)).toBeDefined()
    await goTo(ui, 1)                                     // moving off closes it
    await ui.press({ key: 'cfg-prev' })
    expect(await ui.find({ key: 'cfg-pick-0' } as never)).toBeUndefined()
    await ui.press({ key: 'cfg-change' })
    await ui.press({ key: 'cfg-pick-0' })
    expect(await ui.find({ type: 'Text', text: /model\s+\(empty\)/ })).toBeDefined()
    await ui.unmount()
  })

  test('a failed fetch shows the reason and r offers it again', async ($, on) => {
    engine(on, { codex: 'fail' })
    await run($, 'config')
    const ui = await mount($, 'terminal')
    await goTo(ui, 2)
    await ui.press({ key: 'cfg-change' })
    expect(await ui.find({ type: 'Text', text: /Could not list Codex's models: Error: not logged in/ })).toBeDefined()
    expect(await ui.find({ key: 'cfg-refresh' } as never)).toBeDefined()
    await ui.unmount()
  })
})

describe('/duet config after a save', () => {
  // $.ui.focus has no stand-in in this harness, so the keys going back to the pane is not asserted here.
  test('the reload a save causes reopens the pane on the same row; a later reload does not', async ($, on) => {
    const opened: string[] = []
    engine(on, { opened })
    await run($, 'config')
    const ui = await mount($, 'terminal')
    await goTo(ui, 4)
    await ui.press({ key: 'cfg-change' })
    await ui.input({ key: 'cfg-edit', text: '30', kind: 'submit' })
    await ui.press({ key: 'cfg-save' })
    expect(await ui.find({ type: 'Text', text: /Saved timeout/ })).toBeDefined()

    opened.length = 0
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })   // the reload
    expect(opened).toEqual(['duet-config'])                                          // ui.panes: none up, so reopened
    expect(await ui.find({ type: 'Text', text: /▸.*timeout/ })).toBeDefined()        // same row still highlighted
    await ui.unmount()

    opened.length = 0
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })   // an unrelated reload
    expect(opened).toEqual([])
  })

  test('a pane still up after the reload is not opened again, and still answers its keys', async ($, on) => {
    const opened: string[] = []
    const sets = engine(on, { opened, panes: ['duet-config'] })
    await run($, 'config')
    const ui = await mount($, 'terminal')
    await ui.press({ key: 'cfg-change' })
    await ui.input({ key: 'cfg-edit', text: 'explorer', kind: 'submit' })
    await ui.press({ key: 'cfg-save' })
    opened.length = 0
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    expect(opened).toEqual([])
    await ui.press({ key: 'cfg-next' })                                              // edit the next option straight away
    await ui.press({ key: 'cfg-change' })
    await ui.press({ key: 'cfg-save' })
    expect(sets).toEqual([{ key: 'duet.codexAgents', value: 'explorer' }, { key: 'duet.codexSandbox', value: 'workspace-write' }])
    await ui.unmount()
  })

  test('picking a model says it is not saved yet', async ($, on) => {
    engine(on)
    await run($, 'config')
    const ui = await mount($, 'terminal')
    await goTo(ui, 2)
    await ui.press({ key: 'cfg-change' })
    await ui.press({ key: 'cfg-pick-gpt-6-sol' })
    expect(await ui.find({ type: 'Text', text: /model → gpt-6-sol, not saved yet: s saves/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /unsaved changes/ })).toBeDefined()
    await ui.unmount()
  })
})

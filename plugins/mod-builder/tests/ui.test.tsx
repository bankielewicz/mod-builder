import { describe, expect, mock, test, type Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { testFail } from './fixtures/test-fail'
import { testPass } from './fixtures/test-pass'
import { validateClean } from './fixtures/validate-clean'
import { validateMissing } from './fixtures/validate-missing'

const MODS = '/m/mods'
const OPTIONS = { options: { modsDir: MODS } }

const paneProps = (bodyColumns = 80) =>
  ({ title: 'Mod Lab', isFocused: true, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 34 }, view: {} }) as const

const bandProps = (maxRows = 4, hasSurvey = false) =>
  ({ hasSurvey, isWorking: true, maxRows, bodyColumns: 120, scroll: { offset: 0, bodyRows: 4 }, view: {} }) as const

const COMPOSER = { kind: 'composer' } as const
const PRESENTATION = { isFullscreen: false, columns: 120 } as const

type Disk = Record<string, string>
type Output = { exitCode: number; stdout: string; throws?: boolean }

/** A mod folder on the in-memory disk: every file of a mod that has reached Register. */
const modFiles = (name: string): Disk => ({
  [`${MODS}/${name}/SPEC.md`]: `# ${name}\n| archetype | REQUIRED | band | x |\nDone.\n`,
  [`${MODS}/${name}/.claude-plugin/plugin.json`]: `{ "name": "${name}", "version": "0.1.0", "description": "The ${name} mod." }`,
  [`${MODS}/${name}/hooks/hooks.json`]: '{ "modules": ["./register.tsx"] }',
  [`${MODS}/${name}/hooks/register.tsx`]: '',
  [`${MODS}/${name}/hooks/${name}-logic.ts`]: '',
  [`${MODS}/${name}/tests/${name}-logic.test.ts`]: '',
})

/**
 * The world beneath Mod Lab: a disk from `disk`, the clock and store from
 * memory, processes answered from `outputs`, and every UI call recorded.
 */
/** Every file's mtime is `ms`, unless `byPath` names its own. */
type Mtimes = { ms: number; byPath?: Record<string, number> }

function world(on: On, disk: Disk, outputs: { validate?: Output; test?: Output } = {}, isPlaced = true, hold?: Promise<void>, mtime: Mtimes = { ms: 1000 }, listHold?: Promise<void>) {
  const seen = {
    toasts: [] as string[],
    status: [] as (string | undefined)[],
    opened: [] as string[],
    argv: [] as string[][],
    filled: [] as string[],
    notified: [] as string[],
  }
  const clock = mock.clock(on, { now: Date.parse('2026-10-12T10:00:00Z') })
  mock.store(on, {})
  const files = Object.keys(disk)
  const entriesOf = (dir: string) => {
    const names = new Map<string, 'file' | 'dir'>()
    for (const path of files) {
      if (!path.startsWith(`${dir}/`)) continue
      const [head, ...tail] = path.slice(dir.length + 1).split('/')
      names.set(head!, tail.length ? 'dir' : 'file')
    }
    return [...names].map(([name, kind]) => ({ name, kind, size: 0, mtimeMs: mtime.byPath?.[`${dir}/${name}`] ?? mtime.ms, isLink: false }))
  }
  on('session.start', ($, e) => ({ cwd: e.cwd }) as never)
  on('turn.complete', () => ({ text: '' }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('tool.register', ($, e) => ({ value: { tool: `mcp__mod-builder__${e.name}` } }) as never)
  let lists = 0
  on('fs.list', async ($, e) => {
    if (listHold && lists++ === 0) await listHold
    return { value: entriesOf((e as { path: string }).path) } as never
  })
  on('fs.read', ($, e) => {
    const path = (e as { path: string }).path
    return path in disk ? ({ value: disk[path] } as never) : { deny: 'ENOENT' }
  })
  on('fs.exists', ($, e) => ({ value: (e as { path: string }).path in disk }) as never)
  // Tests run to the end through process.run: the kit has no stub for the
  // streaming process.spawn, so Mod Lab's fallback answers instead.
  on('process.run', async ($, e) => {
    seen.argv.push([...e.argv])
    if (hold) await hold
    const out = (e.argv.includes('validate') ? outputs.validate : outputs.test) ?? { exitCode: 0, stdout: '' }
    if (out.throws) throw new Error('could not start')
    return { value: { ...out, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.toast', ($, e) => (seen.toasts.push((e as { text: string }).text), { value: undefined }) as never)
  on('ui.status', ($, e) => (seen.status.push((e as { text?: string }).text), { value: undefined }) as never)
  on('ui.notify', ($, e) => (seen.notified.push((e as { text: string }).text), { value: { isSent: true, channel: 'terminal' } }) as never)
  on('ui.open', ($, e) => (seen.opened.push(e.id), { value: isPlaced ? { isPlaced: true } : { isPlaced: false, reason: 'narrow' } }) as never)
  on('ui.panes', () => ({ value: [] }))
  on('prompt.fill', ($, e) => (seen.filled.push(e.text), { isFilled: true, text: e.text, cursor: e.text.length }) as never)
  return { seen, clock }
}

async function start($: Engine) {
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/m' })
}

function mountPane($: Engine, surface: 'terminal' | 'desktop' | 'mobile' = 'terminal', bodyColumns = 80) {
  return $.ui.mount({
    plugin: 'mod-builder',
    surface,
    component: 'Pane',
    requestId: 'modlab',
    props: paneProps(bodyColumns),
    viewport: { columns: bodyColumns + 60, rows: 40 },
  })
}

function mountBand($: Engine, maxRows = 4, hasSurvey = false) {
  return $.ui.mount({ plugin: 'mod-builder', surface: 'terminal', component: 'AbovePrompt', requestId: 'band', props: bandProps(maxRows, hasSurvey), viewport: { columns: 140, rows: 40 } })
}

const command = ($: Engine, args: string) => $.command.run({ command: 'modlab', args, origin: COMPOSER, presentation: PRESENTATION })

describe('pane', () => {
  test('empty (2a): says so on every surface; only New mod and Demo', OPTIONS, async ($, on) => {
    world(on, {})
    await start($)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await mountPane($, surface)
      expect(await ui.find({ type: 'Text', text: /^No mods yet\.$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /M O D {3}L A B/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /S T A N D I N G {3}B Y/ })).toBeDefined()
      expect(await ui.find({ key: 'new' })).toBeDefined()
      expect(await ui.find({ key: 'validate' })).toBeUndefined()
      await ui.unmount()
    }
  })

  test('D starts the demo with a DEMO chip and clock; D again stops it', OPTIONS, async ($, on) => {
    const { clock } = world(on, {})
    await start($)
    const ui = await mountPane($)
    await ui.press({ key: 'demo' })
    await clock.advance(2000)
    await ui.unmount()
    const running = await mountPane($)
    expect(await running.find({ type: 'Text', text: /aurora/ })).toBeDefined()
    expect(await running.find({ type: 'Text', text: /DEMO/ })).toBeDefined()
    expect(await running.find({ type: 'Text', text: /nothing is written to disk/ })).toBeDefined()
    expect(await running.find({ type: 'Text', text: /\/ 0:12/ })).toBeDefined()
    await running.press({ key: 'demo' })
    await clock.advance(10)
    await running.unmount()
    const stopped = await mountPane($)
    expect(await stopped.find({ type: 'Text', text: /^No mods yet\.$/ })).toBeDefined()
  })

  test('two mods (1a): rows, summary, detail header; Validate runs once and the row moves on', OPTIONS, async ($, on) => {
    const { seen, clock } = world(on, { ...modFiles('git-branch'), ...modFiles('inbox-zero') }, { validate: { exitCode: 0, stdout: validateClean } })
    await start($)
    await clock.advance(10)
    const ui = await mountPane($)
    expect(await ui.find({ type: 'Text', text: /git-branch/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^2 mods$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /next: Validate/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /v0\.1\.0 · mods\/git-branch\// })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /The git-branch mod\./ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^ {2}MODS$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^5 $/ })).toBeDefined()
    await ui.press({ key: 'validate' })
    await clock.advance(1000)
    await ui.unmount()
    expect(seen.argv).toEqual([['claude', 'plugin', 'validate', '--json', `${MODS}/git-branch`]])
    expect(seen.toasts.some(text => text.startsWith('✓ git-branch: clean · 8 hooks · '))).toBe(true)
    const after = await mountPane($)
    expect(await after.find({ type: 'Text', text: /next: Test/ })).toBeDefined()
    expect(await after.find({ type: 'Text', text: /^HOOKS$/ })).toBeDefined()
    expect(await after.find({ type: 'Text', text: /^REACHES/ })).toBeDefined()
    expect(seen.status.at(-1)).toBe('◆ 2 mods · 2 in progress')
  })

  test('error (2e): the box quotes the failure; Fix with Claude fills the prompt', OPTIONS, async ($, on) => {
    const { seen, clock } = world(on, modFiles('inbox-zero'), { validate: { exitCode: 0, stdout: validateClean }, test: { exitCode: 1, stdout: testFail } })
    await start($)
    await clock.advance(10)
    const ui = await mountPane($)
    await ui.press({ key: 'validate' })
    await clock.advance(1000)
    await ui.press({ key: 'test' })
    await clock.advance(1000)
    await ui.unmount()
    const after = await mountPane($)
    expect(await after.find({ type: 'Text', text: /1 test failing/ })).toBeDefined()
    expect(await after.find({ type: 'Text', text: /1 {3}F A I L I N G/ })).toBeDefined()
    expect(await after.find({ type: 'Text', text: /try-notes-logic > parses the arguments/ })).toBeDefined()
    await after.press({ key: 'fix' })
    expect(seen.filled[0]).toStartWith('Fix the failing test in mods/inbox-zero. First failure, from Mod Lab:')
    expect(seen.toasts).toContain('✕ inbox-zero: 1 test failing. Press F in Mod Lab to fix')
  })

  test('done (2f): a mod that turns green this session reads ready to share, once', OPTIONS, async ($, on) => {
    const disk = {
      ...modFiles('git-branch'),
      [`${MODS}/git-branch/README.md`]: '# Git branch\n\n## What it reaches\n',
      ['/m/.claude-plugin/marketplace.json']: JSON.stringify({ plugins: [{ name: 'git-branch', source: './mods/git-branch' }] }),
    }
    const { seen, clock } = world(on, disk, { validate: { exitCode: 0, stdout: validateClean }, test: { exitCode: 0, stdout: testPass } })
    await start($)
    await clock.advance(10)
    const ui = await mountPane($)
    await ui.press({ key: 'validate' })
    await clock.advance(1000)
    await ui.press({ key: 'test' })
    await clock.advance(1000)
    await ui.unmount()
    const after = await mountPane($)
    expect(await after.find({ type: 'Text', text: /^ready to share$/ })).toBeDefined()
    expect(await after.find({ type: 'Text', text: /8\/8 stages · 4 tests · validate clean/ })).toBeDefined()
    expect(await after.find({ type: 'Text', text: /A L L {3}G R E E N/ })).toBeDefined()
    expect(seen.notified).toEqual(['git-branch is ready to share'])
  })

  test('README view (2g): header, body, Back', OPTIONS, async ($, on) => {
    const { clock } = world(on, { ...modFiles('git-branch'), [`${MODS}/git-branch/README.md`]: '# Git branch\n\nShows the branch.\n' })
    await start($)
    await clock.advance(10)
    const ui = await mountPane($)
    await ui.press({ key: 'readme' })
    await ui.unmount()
    const doc = await mountPane($)
    expect(await doc.find({ type: 'Text', text: /README\.md/ })).toBeDefined()
    expect(await doc.find({ key: 'back' })).toBeDefined()
    await doc.press({ key: 'back' })
    await doc.unmount()
    const back = await mountPane($)
    expect(await back.find({ key: 'validate' })).toBeDefined()
  })

  test('widths (4b, 4c): medium drops status and HOOKS; compact is one line per mod', OPTIONS, async ($, on) => {
    const { clock } = world(on, modFiles('git-branch'))
    await start($)
    await clock.advance(10)
    const medium = await mountPane($, 'terminal', 50)
    expect(await medium.find({ type: 'Text', text: /next: Validate/ })).toBeUndefined()
    expect(await medium.find({ type: 'Text', text: /^Spec$/ })).toBeDefined()
    await medium.unmount()
    const compact = await mountPane($, 'terminal', 36)
    expect(await compact.find({ type: 'Text', text: /^5\/8 $/ })).toBeDefined()
    expect(await compact.find({ type: 'Text', text: /^Spec$/ })).toBeUndefined()
  })

  test('under 34 columns (3h): nothing is drawn and the toast fires once', OPTIONS, async ($, on) => {
    const { seen, clock } = world(on, modFiles('git-branch'))
    await start($)
    await clock.advance(10)
    for (let i = 0; i < 2; i += 1) {
      const ui = await mountPane($, 'terminal', 30)
      expect(await ui.find({ type: 'Text', text: /git-branch/ })).toBeUndefined()
      await ui.unmount()
      await clock.advance(10)
    }
    expect(seen.toasts.filter(text => text.includes('needs a wider window'))).toHaveLength(1)
  })

  test('mobile (5b): touch buttons, no hotkeys', OPTIONS, async ($, on) => {
    const { clock } = world(on, modFiles('git-branch'))
    await start($)
    await clock.advance(10)
    const ui = await mountPane($, 'mobile', 34)
    const validate = await ui.find({ key: 'validate' })
    expect(validate).toBeDefined()
    expect(validate?.props.hotkey).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /4\/8|5\/8/ })).toBeDefined()
  })
})

describe('progress', () => {
  test('a row in flight reads the live run, not the last scan', OPTIONS, async ($, on) => {
    let release = () => {}
    const hold = new Promise<void>(resolve => (release = resolve))
    const { clock } = world(on, modFiles('git-branch'), { validate: { exitCode: 0, stdout: validateClean } }, true, hold)
    await start($)
    await clock.advance(10)
    const ui = await mountPane($)
    await ui.press({ key: 'validate' })
    await clock.advance(10)
    await ui.unmount()
    const during = await mountPane($)
    expect(await during.find({ type: 'Text', text: /^validating$/ })).toBeDefined()
    await during.unmount()
    release()
    await clock.advance(10)
    const after = await mountPane($)
    expect(await after.find({ type: 'Text', text: /next: Test/ })).toBeDefined()
  })
})

describe('selection', () => {
  test('a running lab_report selects the mod being built', OPTIONS, async ($, on) => {
    const { clock } = world(on, { ...modFiles('git-branch'), ...modFiles('duet') })
    await start($)
    await clock.advance(10)
    const before = await mountPane($)
    expect(await before.find({ type: 'Text', text: /^ git-branch $/ })).toBeDefined()
    await before.unmount()
    await $.tool.call({ tool: 'mcp__mod-builder__lab_report', mod: 'duet', stage: 'Logic', status: 'running' } as never)
    await clock.advance(10)
    const after = await mountPane($)
    expect(await after.find({ type: 'Text', text: /^ duet $/ })).toBeDefined()
    expect(await after.find({ type: 'Text', text: /mods\/duet\// })).toBeDefined()
  })
})

describe('auto re-run', () => {
  test('code changed after a pass: the end of the turn re-runs Validate, then Test', OPTIONS, async ($, on) => {
    const mtime = { ms: 1000 }
    const { seen, clock } = world(on, modFiles('git-branch'), { validate: { exitCode: 0, stdout: validateClean }, test: { exitCode: 0, stdout: testPass } }, true, undefined, mtime)
    await start($)
    await clock.advance(10)
    const ui = await mountPane($)
    await ui.press({ key: 'validate' })
    await clock.advance(500)
    await ui.press({ key: 'test' })
    await clock.advance(500)
    await ui.unmount()
    expect(seen.argv).toHaveLength(2)
    mtime.ms = 5000
    await $.turn.complete({ answer: 'edited' } as never)
    await clock.advance(1000)
    expect(seen.argv.slice(2).map(argv => argv[2])).toEqual(['validate', 'test'])
    const after = await mountPane($)
    expect(await after.find({ type: 'Text', text: /files changed/ })).toBeUndefined()
  })

  test('a file in a subfolder edited after a pass: the end of the turn re-runs Validate, then Test', OPTIONS, async ($, on) => {
    const mtime: Mtimes = { ms: 1000 }
    const disk = { ...modFiles('git-branch'), [`${MODS}/git-branch/hooks/lib/parser.ts`]: '' }
    const { seen, clock } = world(on, disk, { validate: { exitCode: 0, stdout: validateClean }, test: { exitCode: 0, stdout: testPass } }, true, undefined, mtime)
    await start($)
    await clock.advance(10)
    const ui = await mountPane($)
    await ui.press({ key: 'validate' })
    await clock.advance(500)
    await ui.press({ key: 'test' })
    await clock.advance(500)
    await ui.unmount()
    await $.turn.complete({ answer: 'nothing yet' } as never)
    await clock.advance(1000)
    expect(seen.argv).toHaveLength(2)
    mtime.byPath = { [`${MODS}/git-branch/hooks/lib/parser.ts`]: 5000 }
    await $.turn.complete({ answer: 'edited' } as never)
    await clock.advance(1000)
    expect(seen.argv.slice(2).map(argv => argv[2])).toEqual(['validate', 'test'])
  })

  test('nothing changed: the end of the turn runs nothing', OPTIONS, async ($, on) => {
    const { seen, clock } = world(on, modFiles('git-branch'), { validate: { exitCode: 0, stdout: validateClean } })
    await start($)
    await clock.advance(10)
    const ui = await mountPane($)
    await ui.press({ key: 'validate' })
    await clock.advance(500)
    await $.turn.complete({ answer: 'done' } as never)
    await clock.advance(1000)
    expect(seen.argv).toHaveLength(1)
  })
})

describe('edit', () => {
  test('Spec running on a green mod starts an edit: older stages go stale, then green again as they are redone', OPTIONS, async ($, on) => {
    const mtime = { ms: 1000 }
    const disk = {
      ...modFiles('git-branch'),
      [`${MODS}/git-branch/README.md`]: '# Git branch\n\n## What it reaches\n',
      ['/m/.claude-plugin/marketplace.json']: JSON.stringify({ plugins: [{ name: 'git-branch', source: './mods/git-branch', version: '0.1.0' }] }),
    }
    const { clock } = world(on, disk, { validate: { exitCode: 0, stdout: validateClean }, test: { exitCode: 0, stdout: testPass } }, true, undefined, mtime)
    await start($)
    await clock.advance(10)
    const ui = await mountPane($)
    await ui.press({ key: 'validate' })
    await clock.advance(500)
    await ui.press({ key: 'test' })
    await clock.advance(500)
    await ui.unmount()
    const green = await mountPane($)
    expect(await green.find({ type: 'Text', text: /^ready to share$/ })).toBeDefined()
    await green.unmount()

    await clock.advance(5000)
    await $.tool.call({ tool: 'mcp__mod-builder__lab_report', mod: 'git-branch', stage: 'Spec', status: 'running', note: 'revising SPEC.md' } as never)
    await clock.advance(10)
    const editing = await mountPane($)
    expect(await editing.find({ type: 'Text', text: /^revising SPEC\.md$/ })).toBeDefined()
    await editing.unmount()
    await $.tool.call({ tool: 'mcp__mod-builder__lab_report', mod: 'git-branch', stage: 'Spec', status: 'passed' } as never)
    await clock.advance(10)
    const stale = await mountPane($)
    expect(await stale.find({ type: 'Text', text: /^edit · update Spec for this change$/ })).toBeDefined()
  })
})

describe('edit failures', () => {
  async function greenThenEdit($: Engine, on: On, outputs: { validate?: Output; test?: Output }) {
    const disk = {
      ...modFiles('git-branch'),
      [`${MODS}/git-branch/README.md`]: '# Git branch\n\n## What it reaches\n',
      ['/m/.claude-plugin/marketplace.json']: JSON.stringify({ plugins: [{ name: 'git-branch', source: './mods/git-branch', version: '0.1.0' }] }),
    }
    const w = world(on, disk, outputs)
    await start($)
    await w.clock.advance(10)
    const ui = await mountPane($)
    await ui.press({ key: 'validate' })
    await w.clock.advance(500)
    await ui.press({ key: 'test' })
    await w.clock.advance(500)
    await ui.unmount()
    await w.clock.advance(5000)
    await $.tool.call({ tool: 'mcp__mod-builder__lab_report', mod: 'git-branch', stage: 'Spec', status: 'passed' } as never)
    await $.tool.call({ tool: 'mcp__mod-builder__lab_report', mod: 'git-branch', stage: 'Spec', status: 'running' } as never)
    await w.clock.advance(10)
    return w
  }

  test('a Validate that fails during an edit is not re-run after every turn', OPTIONS, async ($, on) => {
    const outputs = { validate: { exitCode: 0, stdout: validateClean }, test: { exitCode: 0, stdout: testPass } }
    const { seen, clock } = await greenThenEdit($, on, outputs)
    outputs.validate = { exitCode: 1, stdout: validateMissing }
    const ui = await mountPane($)
    await ui.press({ key: 'validate' })
    await clock.advance(500)
    await ui.unmount()
    const before = seen.argv.length
    await $.turn.complete({ answer: 'one' } as never)
    await clock.advance(1000)
    await $.turn.complete({ answer: 'two' } as never)
    await clock.advance(1000)
    expect(seen.argv.length).toBe(before)
  })

  test('a run that cannot start during an edit shows as failed, with Fix, not as stale', OPTIONS, async ($, on) => {
    const outputs: { validate?: Output; test?: Output } = { validate: { exitCode: 0, stdout: validateClean }, test: { exitCode: 0, stdout: testPass } }
    const { clock } = await greenThenEdit($, on, outputs)
    outputs.validate = { exitCode: 0, stdout: '', throws: true }
    const ui = await mountPane($)
    await ui.press({ key: 'validate' })
    await clock.advance(500)
    await ui.unmount()
    const after = await mountPane($)
    expect(await after.find({ type: 'Text', text: /validate · could not run/ })).toBeDefined()
    expect(await after.find({ key: 'fix' })).toBeDefined()
  })
})

describe('scan waits', () => {
  test('a command during the startup scan waits for it, and sees the mods', OPTIONS, async ($, on) => {
    let release = () => {}
    const listHold = new Promise<void>(resolve => (release = resolve))
    const { seen, clock } = world(on, modFiles('git-branch'), {}, true, undefined, { ms: 1000 }, listHold)
    await start($)
    const asked = command($, 'git-branch')
    await clock.advance(10)
    release()
    await asked
    await clock.advance(10)
    expect(seen.toasts.filter(text => text.startsWith('No mod named'))).toEqual([])
    expect(seen.opened).toContain('modlab')
  })
})

describe('band', () => {
  test('idle: only the band below; a survey makes it step aside', OPTIONS, async ($, on) => {
    world(on, modFiles('git-branch'))
    on('ui.render', ($, e) => $.ui.resolve(e).Text({ children: 'band below' }) as never)
    await start($)
    await $.tool.call({ tool: 'mcp__mod-builder__lab_report', mod: 'git-branch', stage: 'Logic', status: 'running' } as never)
    const survey = await mountBand($, 4, true)
    expect(await survey.find({ type: 'Text', text: /◆/ })).toBeUndefined()
    expect(await survey.find({ type: 'Text', text: /band below/ })).toBeDefined()
  })

  test('streamed tests fill the bar on real progress, with a detail row when there is room', OPTIONS, async ($, on) => {
    const { clock } = world(on, modFiles('git-branch'), { test: { exitCode: 0, stdout: testPass } })
    on('ui.render', ($, e) => $.ui.resolve(e).Text({ children: 'band below' }) as never)
    await start($)
    await $.tool.call({ tool: 'mcp__mod-builder__lab_report', mod: 'git-branch', stage: 'Logic', status: 'running', note: 'writing tests' } as never)
    const ui = await mountBand($, 4)
    expect(await ui.find({ type: 'Text', text: /^git-branch$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^ {2}Logic $/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /writing tests/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /band below/ })).toBeDefined()
    await ui.unmount()
    const tight = await mountBand($, 1)
    expect(await tight.find({ type: 'Text', text: /writing tests/ })).toBeUndefined()
    await clock.advance(10)
  })
})

describe('lab_report', () => {
  test('a passed Validate report re-runs validate, and the disk wins', OPTIONS, async ($, on) => {
    const { seen, clock } = world(on, modFiles('git-branch'), { validate: { exitCode: 1, stdout: validateMissing } })
    await start($)
    await $.tool.call({ tool: 'mcp__mod-builder__lab_report', mod: 'git-branch', stage: 'Validate', status: 'passed' } as never)
    await clock.advance(1000)
    expect(seen.argv.some(argv => argv.includes('validate'))).toBe(true)
    const ui = await mountPane($)
    expect(await ui.find({ type: 'Text', text: /validate · 1 problem/ })).toBeDefined()
  })

  test('bad input is answered, not thrown', OPTIONS, async ($, on) => {
    world(on, {})
    await start($)
    const { result } = (await $.tool.call({ tool: 'mcp__mod-builder__lab_report', mod: 'Bad Name', stage: 'Logic', status: 'running' } as never)) as { result: string }
    expect(result).toStartWith('Mod Lab: mod must be')
  })
})

describe('command', () => {
  test('/modlab opens the pane; too narrow toasts', OPTIONS, async ($, on) => {
    const { seen, clock } = world(on, {}, {}, false)
    await start($)
    const { text } = await command($, '')
    expect(text).toBe('Mod Lab opened.')
    await clock.advance(10)
    expect(seen.opened).toContain('modlab')
    expect(seen.toasts).toContain('◆ Mod Lab needs a wider window. Widen it, or watch the status line.')
  })

  test('/modlab new fills the prompt; /modlab demo says nothing is written', OPTIONS, async ($, on) => {
    const { seen } = world(on, {})
    await start($)
    expect((await command($, 'new a band for the git branch')).text).toBe('Describe your mod after /mod-builder:build in the prompt box.')
    expect(seen.filled).toEqual(['/mod-builder:build a band for the git branch '])
    expect((await command($, 'demo')).text).toContain('Nothing is written to disk')
  })

  test('the demo walks to green in 12 s, announces once, and returns 3 s later', OPTIONS, async ($, on) => {
    const { seen, clock } = world(on, {})
    await start($)
    await command($, 'demo')
    await clock.advance(13_000)
    expect(seen.toasts).toContain('✕ aurora: 1 test failing. Claude is fixing it')
    expect(seen.toasts.filter(text => text.startsWith('✓ aurora (demo) is ready to share'))).toHaveLength(1)
    expect(seen.notified).toEqual(['aurora (demo) is ready to share'])
    await clock.advance(3_000)
    const ui = await mountPane($)
    expect(await ui.find({ type: 'Text', text: /^No mods yet\.$/ })).toBeDefined()
  })
})

import { describe, expect, mock, test, type Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { testFail } from './fixtures/test-fail'
import { testNone } from './fixtures/test-none'
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
type Output = { exitCode: number; stdout: string; stderr?: string; throws?: boolean }

/** A mod folder on the in-memory disk, under `folder`: every file of a mod that has reached Register. */
const modFiles = (name: string, folder = MODS): Disk => ({
  [`${folder}/${name}/SPEC.md`]: `# ${name}\n| archetype | REQUIRED | band | x |\nDone.\n`,
  [`${folder}/${name}/.claude-plugin/plugin.json`]: `{ "name": "${name}", "version": "0.1.0", "description": "The ${name} mod." }`,
  [`${folder}/${name}/hooks/hooks.json`]: '{ "modules": ["./register.tsx"] }',
  [`${folder}/${name}/hooks/register.tsx`]: '',
  [`${folder}/${name}/hooks/${name}-logic.ts`]: '',
  [`${folder}/${name}/tests/${name}-logic.test.ts`]: '',
})

/**
 * The world beneath Mod Lab: a disk from `disk`, the clock and store from
 * memory, processes answered from `outputs`, and every UI call recorded.
 */
/** Every file's mtime is `ms`, unless `byPath` names its own. */
type Mtimes = { ms: number; byPath?: Record<string, number> }

function world(on: On, disk: Disk, outputs: { validate?: Output; test?: Output } = {}, isPlaced = true, hold?: Promise<void>, mtime: Mtimes = { ms: 1000 }, listHold?: Promise<void>, configRows?: { key: string; plugin: string }[]) {
  const seen = {
    toasts: [] as string[],
    status: [] as (string | undefined)[],
    opened: [] as string[],
    argv: [] as string[][],
    filled: [] as string[],
    notified: [] as string[],
    logs: [] as string[],
    writes: [] as { path: string; text: string }[],
    sets: [] as { key: string; value: unknown }[],
    sessionId: 's1-session',
    cwd: '/m' as string | null,
    failReads: [] as string[],
    denySet: '',
    denyStoreSet: '',
    timeouts: [] as (number | undefined)[],
    /** While set, a test run never ends, as a Test that hangs does. */
    stallTests: false,
  }
  const clock = mock.clock(on, { now: Date.parse('2026-10-12T10:00:00Z') })
  // The store from memory, as mock.store keeps it; `seen.denyStoreSet` makes every set reject.
  const stored = new Map<string, unknown>()
  on('store.get', ($, e) => ({ value: stored.get((e as { key: string }).key) }) as never)
  on('store.set', ($, e) => {
    if (seen.denyStoreSet) return { deny: seen.denyStoreSet }
    stored.set((e as { key: string }).key, JSON.parse(JSON.stringify((e as { value: unknown }).value)))
    return { value: undefined } as never
  })
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
    if (seen.failReads.includes(path)) return { deny: 'EIO: read failed' }
    return path in disk ? ({ value: disk[path] } as never) : { deny: 'ENOENT' }
  })
  on('fs.exists', ($, e) => ({ value: (e as { path: string }).path in disk }) as never)
  on('fs.write', ($, e) => (seen.writes.push({ path: (e as { path: string }).path, text: (e as { text: string }).text }), { value: undefined }) as never)
  on('ui.log', ($, e) => (seen.logs.push((e as { text: string }).text), { value: undefined }) as never)
  on('env.get', ($, e) => ({ value: (e as { name: string }).name === 'HOME' ? '/home/u' : undefined }) as never)
  on('session.cwd', () => (seen.cwd === null ? { deny: 'cwd unavailable' } : ({ value: seen.cwd } as never)))
  on('session.id', () => (seen.sessionId ? ({ value: seen.sessionId } as never) : { deny: 'no session id' }))
  on('session.end', ($, e) => ({ sessionId: (e as { sessionId: string }).sessionId }) as never)
  // Owners as seen live: the plugin name plus its install source.
  const rows = configRows ?? ['modsDir', 'autoOpen', 'autoRerun', 'logging', 'testTimeoutMinutes'].map(f => ({ key: `mod-builder.${f}`, plugin: 'mod-builder@claudemod' }))
  on('config.list', () => ({ value: rows.map(r => ({ key: r.key, label: r.key, kind: 'text', value: '', provider: { plugin: r.plugin }, isLocked: false })) }) as never)
  on('config.set', ($, e) => seen.denySet ? { deny: seen.denySet } : (seen.sets.push({ key: (e as { key: string }).key, value: (e as { value: unknown }).value }), { value: (e as { value: unknown }).value }) as never)
  // Tests run to the end through process.run: the kit has no stub for the
  // streaming process.spawn, so Mod Lab's fallback answers instead.
  on('process.run', async ($, e) => {
    seen.argv.push([...e.argv])
    seen.timeouts.push(e.init?.timeoutMs)
    if (hold) await hold
    if (seen.stallTests && e.argv[2] === 'test') await new Promise<void>(() => undefined)
    const out = (e.argv.includes('validate') ? outputs.validate : outputs.test) ?? { exitCode: 0, stdout: '' }
    if (out.throws) throw new Error('could not start')
    return { value: { ...out, stderr: out.stderr ?? '', isStdoutTruncated: false, isStderrTruncated: false } }
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

describe('test run that never starts', () => {
  /** `git-branch` validated, then Test exits 1 with `testNone` on stderr and nothing on stdout; a pane open on it. */
  async function testNeverStarts($: Engine, on: On) {
    const { seen, clock } = world(on, modFiles('git-branch'), { validate: { exitCode: 0, stdout: validateClean }, test: { exitCode: 1, stdout: '', stderr: testNone } })
    await start($)
    await clock.advance(10)
    const ui = await mountPane($)
    await ui.press({ key: 'validate' })
    await clock.advance(500)
    await ui.press({ key: 'test' })
    await clock.advance(500)
    await ui.unmount()
    return { seen, after: await mountPane($) }
  }

  test('a Test that exits 1 before running (no test files) shows the error and Fix', OPTIONS, async ($, on) => {
    const { after } = await testNeverStarts($, on)
    expect(await after.find({ type: 'Text', text: /no \*\.test\.ts/ })).toBeDefined()
    expect(await after.find({ key: 'fix' })).toBeDefined()
  })

  test('its toast says the tests did not run, not "1 test failing"', OPTIONS, async ($, on) => {
    const { seen } = await testNeverStarts($, on)
    expect(seen.toasts.some(text => text.startsWith('✕ git-branch: ') && text.includes('tests did not run'))).toBe(true)
    expect(seen.toasts.some(text => text.includes('1 test failing'))).toBe(false)
  })

  test('Fix with Claude fills a prompt that says the tests did not run and quotes the error', OPTIONS, async ($, on) => {
    const { seen, after } = await testNeverStarts($, on)
    expect(await after.find({ key: 'fix' })).toBeDefined()
    await after.press({ key: 'fix' })
    expect(seen.filled[0]).toContain('tests did not run')
    expect(seen.filled[0]).toContain('no *.test.ts or *.test.tsx under /m/mods/git-branch')
    expect(seen.filled[0]).not.toContain('0 failing tests')
  })
})

describe('modsDir that is not mods/ under the working directory', () => {
  const ELSEWHERE = '/elsewhere/mods'
  const OTHER = '/m/other'

  /** `inbox-zero` under `modsDir` with its Test failing, and a pane open on it. */
  async function failingTest($: Engine, on: On, modsDir: string) {
    const w = world(on, modFiles('inbox-zero', modsDir), { validate: { exitCode: 0, stdout: validateClean }, test: { exitCode: 1, stdout: testFail } })
    await start($)
    await w.clock.advance(10)
    const ui = await mountPane($)
    await ui.press({ key: 'validate' })
    await w.clock.advance(1000)
    await ui.press({ key: 'test' })
    await w.clock.advance(1000)
    await ui.unmount()
    return { ...w, pane: await mountPane($) }
  }

  test('Fix with Claude names the mod folder in full when it is outside the working directory', { options: { modsDir: ELSEWHERE } }, async ($, on) => {
    const { seen, pane } = await failingTest($, on, ELSEWHERE)
    await pane.press({ key: 'fix' })
    expect(seen.filled[0]).toStartWith(`Fix the failing test in ${ELSEWHERE}/inbox-zero. First failure, from Mod Lab:`)
  })

  test('Fix with Claude names the mod folder relative to the working directory when it is inside', { options: { modsDir: OTHER } }, async ($, on) => {
    const { seen, pane } = await failingTest($, on, OTHER)
    await pane.press({ key: 'fix' })
    expect(seen.filled[0]).toStartWith('Fix the failing test in other/inbox-zero. First failure, from Mod Lab:')
  })

  test('Fix with Claude reads the working directory when pressed, so it follows a /cd', { options: { modsDir: OTHER } }, async ($, on) => {
    const { seen, pane } = await failingTest($, on, OTHER)
    seen.cwd = '/m/other'
    await pane.press({ key: 'fix' })
    expect(seen.filled[0]).toStartWith('Fix the failing test in inbox-zero. First failure, from Mod Lab:')
    await pane.unmount()
    seen.cwd = '/work'
    const again = await mountPane($)
    await again.press({ key: 'fix' })
    expect(seen.filled[1]).toStartWith(`Fix the failing test in ${OTHER}/inbox-zero. First failure, from Mod Lab:`)
  })

  test('the detail header shows the full path of a mod folder outside the working directory', { options: { modsDir: ELSEWHERE } }, async ($, on) => {
    const { clock } = world(on, modFiles('git-branch', ELSEWHERE))
    await start($)
    await clock.advance(10)
    const ui = await mountPane($)
    expect(await ui.find({ type: 'Text', text: /v0\.1\.0 · \/elsewhere\/mods\/git-branch\// })).toBeDefined()
  })

  test('the detail header shows the path relative to the working directory when the folder is inside it', { options: { modsDir: OTHER } }, async ($, on) => {
    const { clock } = world(on, modFiles('git-branch', OTHER))
    await start($)
    await clock.advance(10)
    const ui = await mountPane($)
    expect(await ui.find({ type: 'Text', text: /v0\.1\.0 · other\/git-branch\// })).toBeDefined()
  })

  test('the detail header shows the full path when the working directory cannot be read, and logs that once', { options: { modsDir: OTHER } }, async ($, on) => {
    const { seen, clock } = world(on, modFiles('git-branch', OTHER))
    seen.cwd = null
    await start($)
    await clock.advance(10)
    await command($, 'git-branch')
    await clock.advance(10)
    const ui = await mountPane($)
    expect(await ui.find({ type: 'Text', text: /v0\.1\.0 · \/m\/other\/git-branch\// })).toBeDefined()
    expect(seen.logs.filter(line => line.includes('session.cwd')).length).toBe(1)
  })

  test('a long header path is cut from the start, so the mod folder stays in view', { options: { modsDir: ELSEWHERE } }, async ($, on) => {
    const { clock } = world(on, modFiles('git-branch', ELSEWHERE))
    await start($)
    await clock.advance(10)
    await command($, 'git-branch')
    await clock.advance(10)
    const ui = await mountPane($)
    const header = await ui.find({ type: 'Text', text: /^v0\.1\.0 · \/elsewhere\/mods\/git-branch\/$/ })
    expect(header?.props.wrap).toBe('truncate-start')
  })

  test('the detail header follows a /cd at the next render, without waiting for a scan', { options: { modsDir: OTHER } }, async ($, on) => {
    const { seen, clock } = world(on, modFiles('git-branch', OTHER))
    await start($)
    await clock.advance(10)
    await command($, 'git-branch')
    await clock.advance(10)
    seen.cwd = '/m/other'
    const ui = await mountPane($)
    expect(await ui.find({ type: 'Text', text: /v0\.1\.0 · git-branch\// })).toBeDefined()
  })

  test('the detail header follows a /cd at the next scan', { options: { modsDir: OTHER } }, async ($, on) => {
    const { seen, clock } = world(on, modFiles('git-branch', OTHER))
    await start($)
    await clock.advance(10)
    seen.cwd = '/m/other'
    await command($, 'git-branch')
    await clock.advance(10)
    const ui = await mountPane($)
    expect(await ui.find({ type: 'Text', text: /v0\.1\.0 · git-branch\// })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /v0\.1\.0 · other\/git-branch\// })).toBeUndefined()
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

describe('a run that does not end', () => {
  const MINUTE = 60_000
  /** testTimeoutMinutes 0.1: a 6 s limit keeps these tests quick (the clock ticks every 250 ms). */
  const SHORT = { options: { modsDir: MODS, testTimeoutMinutes: 0.1 } }
  const LIMIT = 6000
  const GRACE = 30_000
  const reportTest = ($: Engine) =>
    $.tool.call({ tool: 'mcp__mod-builder__lab_report', mod: 'git-branch', stage: 'Test', status: 'passed' } as never)

  test('a failure after the tests ran does not leave the row: the next Test starts', OPTIONS, async ($, on) => {
    let release = () => {}
    const hold = new Promise<void>(resolve => (release = resolve))
    const { seen, clock } = world(on, modFiles('git-branch'), { test: { exitCode: 0, stdout: testPass } }, true, hold)
    await start($)
    await clock.advance(10)
    const ui = await mountPane($)
    await ui.press({ key: 'test' })
    await clock.advance(10)
    expect(seen.argv.length).toBe(1)
    seen.denyStoreSet = 'EIO: store write failed'
    release()
    await clock.advance(500)
    seen.denyStoreSet = ''
    await ui.press({ key: 'test' })
    await clock.advance(500)
    expect(seen.argv.length).toBe(2)
  })

  test('a row older than testTimeoutMinutes plus 30 s is an orphan: a new Test replaces it, a younger row still blocks', SHORT, async ($, on) => {
    const hold = new Promise<void>(() => undefined)
    const { seen, clock } = world(on, modFiles('git-branch'), { test: { exitCode: 0, stdout: testPass } }, true, hold)
    await start($)
    await clock.advance(10)
    await reportTest($)
    await clock.advance(10)
    expect(seen.argv.length).toBe(1)
    await clock.advance(LIMIT / 2)
    await reportTest($)
    await clock.advance(10)
    expect(seen.argv.length).toBe(1)
    // Past the time limit but inside the grace: the run may still be ending (its scan, its store write).
    await clock.advance(LIMIT / 2 + 5000)
    await reportTest($)
    await clock.advance(10)
    expect(seen.argv.length).toBe(1)
    await clock.advance(GRACE)
    await reportTest($)
    await clock.advance(10)
    expect(seen.argv.length).toBe(2)
  })

  test('an orphan row leaves the band and the pane: T starts a new Test', SHORT, async ($, on) => {
    const hold = new Promise<void>(() => undefined)
    const { seen, clock } = world(on, modFiles('git-branch'), { test: { exitCode: 0, stdout: testPass } }, true, hold)
    on('ui.render', ($, e) => $.ui.resolve(e).Text({ children: 'band below' }) as never)
    await start($)
    await clock.advance(10)
    const ui = await mountPane($)
    await ui.press({ key: 'test' })
    await clock.advance(10)
    await ui.unmount()
    expect(seen.argv.length).toBe(1)
    const during = await mountBand($)
    expect(await during.find({ type: 'Text', text: /^git-branch$/ })).toBeDefined()
    await during.unmount()
    await clock.advance(LIMIT + GRACE + 5000)
    const after = await mountBand($)
    expect(await after.find({ type: 'Text', text: /^git-branch$/ })).toBeUndefined()
    await after.unmount()
    const pane = await mountPane($)
    await pane.press({ key: 'test' })
    await clock.advance(10)
    expect(seen.argv.length).toBe(2)
  })

  test('an orphan row does not hold back the auto re-run', SHORT, async ($, on) => {
    const mtime = { ms: 1000 }
    const { seen, clock } = world(on, modFiles('git-branch'), { validate: { exitCode: 0, stdout: validateClean }, test: { exitCode: 0, stdout: testPass } }, true, undefined, mtime)
    await start($)
    await clock.advance(10)
    const ui = await mountPane($)
    await ui.press({ key: 'validate' })
    await clock.advance(500)
    await ui.press({ key: 'test' })
    await clock.advance(500)
    seen.stallTests = true
    await ui.press({ key: 'test' })
    await clock.advance(10)
    await ui.unmount()
    expect(seen.argv).toHaveLength(3)
    await clock.advance(LIMIT + GRACE + 5000)
    seen.stallTests = false
    mtime.ms = 5000
    await $.turn.complete({ answer: 'edited' } as never)
    await clock.advance(1000)
    expect(seen.argv.slice(3).map(argv => argv[2])).toEqual(['validate', 'test'])
  })

  test('a run that throws before its result is stored says so, and the pane stops showing it running', OPTIONS, async ($, on) => {
    let release = () => {}
    const hold = new Promise<void>(resolve => (release = resolve))
    const { seen, clock } = world(on, modFiles('git-branch'), { test: { exitCode: 0, stdout: testPass } }, true, hold)
    await start($)
    await clock.advance(10)
    const ui = await mountPane($)
    await ui.press({ key: 'test' })
    await clock.advance(10)
    await ui.unmount()
    seen.denyStoreSet = 'EIO: store write failed'
    release()
    await clock.advance(500)
    seen.denyStoreSet = ''
    expect(seen.toasts.some(text => text.startsWith('✕ git-branch: Test stopped before its result was saved ('))).toBe(true)
    const after = await mountPane($)
    expect(await after.find({ type: 'Text', text: /running tests/ })).toBeUndefined()
  })

  test('a Validate that process.run stops at the time limit reads as timed out; one refused sooner could not run', SHORT, async ($, on) => {
    let release = () => {}
    const hold = new Promise<void>(resolve => (release = resolve))
    const { seen, clock } = world(on, modFiles('git-branch'), { validate: { exitCode: 0, stdout: '', throws: true } }, true, hold)
    await start($)
    await clock.advance(10)
    const ui = await mountPane($)
    await ui.press({ key: 'validate' })
    await clock.advance(LIMIT + 1000)
    release()
    await clock.advance(10)
    expect(seen.toasts).toContain('✕ git-branch: timed out after 0.1 minutes. Press F in Mod Lab to fix')
    await ui.unmount()
    const again = await mountPane($)
    await again.press({ key: 'validate' })
    await clock.advance(10)
    expect(seen.toasts.at(-1)).toBe('✕ git-branch: could not run. Press F in Mod Lab to fix')
  })

  test('a Test run is given testTimeoutMinutes as its time limit', { options: { modsDir: MODS, testTimeoutMinutes: 5 } }, async ($, on) => {
    const { seen, clock } = world(on, modFiles('git-branch'), { test: { exitCode: 0, stdout: testPass } })
    await start($)
    await clock.advance(10)
    const ui = await mountPane($)
    await ui.press({ key: 'test' })
    await clock.advance(500)
    expect(seen.timeouts).toEqual([5 * MINUTE])
  })

  test('the time limit of a Test run stops at the engine\'s ten minutes', { options: { modsDir: MODS, testTimeoutMinutes: 30 } }, async ($, on) => {
    const { seen, clock } = world(on, modFiles('git-branch'), { test: { exitCode: 0, stdout: testPass } })
    await start($)
    await clock.advance(10)
    const ui = await mountPane($)
    await ui.press({ key: 'test' })
    await clock.advance(500)
    expect(seen.timeouts).toEqual([10 * MINUTE])
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

describe('logging (Change 0.2.2)', () => {
  const LOG = /^\/home\/u\/\.claude\/mod-builder-data\/logs\/\d{4}-\d{2}-\d{2}-s1-sessi\.log$/
  const lastLog = (seen: { writes: { path: string; text: string }[] }) => seen.writes.filter(w => LOG.test(w.path)).at(-1)?.text ?? ''

  test('normal: a check that cannot run is logged with its site; expected misses are not', OPTIONS, async ($, on) => {
    const { seen, clock } = world(on, modFiles('git-branch'), { validate: { exitCode: 0, stdout: '', throws: true } })
    await start($)
    await clock.advance(10)
    const ui = await mountPane($)
    await ui.press({ key: 'validate' })
    await clock.advance(3000)
    const text = lastLog(seen)
    expect(text).toContain('NORMAL  session.start  Mod Lab started')
    // A stub that throws is skipped by the kit, so the caller sees "no implementation".
    expect(text).toMatch(/NORMAL  run  \w+: [^\n]+ {2}\{"mod":"git-branch","kind":"Validate"\}/)
    expect(text).toContain('NORMAL  run  git-branch Validate failed')
    expect(text).not.toContain('VERBOSE')
    expect(text).not.toContain('DEBUG')
    expect(seen.logs.some(line => line.includes('NORMAL  run  git-branch Validate failed'))).toBe(true)
  })

  test('after a reload the session file is continued, not replaced', OPTIONS, async ($, on) => {
    const day = new Date().toISOString().slice(0, 10)
    const path = `/home/u/.claude/mod-builder-data/logs/${day}-s1-sessi.log`
    const { seen, clock } = world(on, { ...modFiles('git-branch'), [path]: '2026-10-13T09:00:00.000Z NORMAL  session.start  before the reload\n' })
    await start($)
    await clock.advance(3000)
    const text = lastLog(seen)
    expect(text).toStartWith('2026-10-13T09:00:00.000Z NORMAL  session.start  before the reload\n')
    expect(text).toContain('NORMAL  session.start  Mod Lab started')
  })

  test('/mod-builder config changes only its own row, and says where to go when it has none', OPTIONS, async ($, on) => {
    const { seen, clock } = world(on, modFiles('git-branch'), {}, true, undefined, { ms: 1000 }, undefined, [
      { key: 'mod-builder-extra.logging', plugin: 'mod-builder-extra@claudemod' },
      { key: 'mod-builder.logging', plugin: 'mod-builder@inline' },
    ])
    await start($)
    await clock.advance(10)
    const run = (args: string) => $.command.run({ command: 'mod-builder', args, origin: COMPOSER, presentation: PRESENTATION }) as Promise<{ text?: string }>
    await run('config logging debug')
    expect(seen.sets).toEqual([{ key: 'mod-builder.logging', value: 'debug' }])
    expect((await run('config autoOpen on')).text).toBe(
      'Could not change autoOpen: no /config row mod-builder.autoOpen in this session (headless sessions list no plugin options). Change it in /config, or /plugin → mod-builder → options.',
    )
  })

  test('after /clear the next lines go to the new session file', OPTIONS, async ($, on) => {
    const { seen, clock } = world(on, modFiles('git-branch'))
    await start($)
    await clock.advance(3000)
    await $.session.end({ reason: 'clear', sessionId: 's1-session', resume: { sessionId: 's1-session' } } as never)
    seen.sessionId = 's2-session'
    await $.command.run({ command: 'mod-builder', args: 'config logging debug', origin: COMPOSER, presentation: PRESENTATION })
    await clock.advance(3000)
    const second = seen.writes.filter(w => w.path.includes('-s2-sessi.log')).at(-1)?.text ?? ''
    const first = seen.writes.filter(w => w.path.includes('-s1-sessi.log')).at(-1)?.text ?? ''
    expect(second).toContain('NORMAL  config  logging changing')
    expect(second).not.toContain('Mod Lab started')
    expect(first).toContain('Mod Lab started')
    expect(first).not.toContain('logging changing')
  })

  test('the same error at the same site is logged once', OPTIONS, async ($, on) => {
    const { seen, clock } = world(on, modFiles('git-branch'), { validate: { exitCode: 0, stdout: '', throws: true } })
    await start($)
    await clock.advance(10)
    const ui = await mountPane($)
    await ui.press({ key: 'validate' })
    await clock.advance(1000)
    await ui.press({ key: 'validate' })
    await clock.advance(3000)
    const caught = lastLog(seen).split('\n').filter(line => /NORMAL  run  \w+Error: /.test(line))
    expect(caught).toHaveLength(1)
    expect(lastLog(seen).split('\n').filter(line => line.includes('git-branch Validate failed'))).toHaveLength(2)
  })

  test('a log that exists but cannot be read is never overwritten', OPTIONS, async ($, on) => {
    const day = new Date().toISOString().slice(0, 10)
    const path = `/home/u/.claude/mod-builder-data/logs/${day}-s1-sessi.log`
    const { seen, clock } = world(on, { ...modFiles('git-branch'), [path]: 'earlier lines\n' })
    seen.failReads.push(path)
    await start($)
    await clock.advance(3000)
    expect(seen.writes.filter(w => w.path === path)).toEqual([])
  })

  test('without a session id the log gets its own name; nothing changed means nothing rewritten', OPTIONS, async ($, on) => {
    const { seen, clock } = world(on, modFiles('git-branch'))
    seen.sessionId = ''
    await start($)
    await clock.advance(3000)
    const logs = seen.writes.filter(w => w.path.includes('mod-builder-data'))
    expect(logs.length).toBeGreaterThan(0)
    expect(logs[0]!.path).toMatch(/\/logs\/\d{4}-\d{2}-\d{2}-x[a-z0-9]{1,7}\.log$/)
    const before = seen.writes.length
    await $.turn.complete({ answer: 'nothing new' } as never)
    await clock.advance(3000)
    expect(seen.writes.filter(w => w.path.includes('mod-builder-data')).length).toBe(logs.length)
    expect(seen.writes.length).toBeGreaterThanOrEqual(before)
  })

  test('a refused change is logged as refused, not as made', OPTIONS, async ($, on) => {
    const { seen, clock } = world(on, modFiles('git-branch'))
    seen.denySet = 'the row is locked by policy'
    await start($)
    await clock.advance(10)
    const reply = (await $.command.run({ command: 'mod-builder', args: 'config logging debug', origin: COMPOSER, presentation: PRESENTATION })) as { text?: string }
    await clock.advance(3000)
    expect(reply.text).toBe('Could not change logging: the row is locked by policy')
    expect(lastLog(seen)).toContain('NORMAL  config  logging changing  {"value":"debug"}')
    expect(lastLog(seen)).toContain('NORMAL  config  logging change refused  {"value":"debug","reason":"the row is locked by policy"}')
  })

  test('off: nothing is logged and no file is written', { options: { modsDir: MODS, logging: 'off' } }, async ($, on) => {
    const { seen, clock } = world(on, modFiles('git-branch'), { validate: { exitCode: 0, stdout: '', throws: true } })
    await start($)
    await clock.advance(10)
    const ui = await mountPane($)
    await ui.press({ key: 'validate' })
    await clock.advance(3000)
    expect(seen.logs).toEqual([])
    expect(seen.writes.filter(w => w.path.includes('mod-builder-data'))).toEqual([])
  })

  test('verbose: each scan names the mods folder; debug adds expected misses', { options: { modsDir: MODS, logging: 'debug' } }, async ($, on) => {
    const { seen, clock } = world(on, modFiles('git-branch'))
    await start($)
    await clock.advance(3000)
    const text = lastLog(seen)
    expect(text).toContain('VERBOSE scan  1 folders, 1 mods in')
    expect(text).toContain('{"modsDir":"/m/mods"}')
    expect(text).toContain('DEBUG   fs.read')
    expect(text).toContain('DEBUG   scan.lights  lights per mod')
  })

  test('/mod-builder config lists the options and the log file; setting logging writes its /config row', OPTIONS, async ($, on) => {
    const { seen, clock } = world(on, modFiles('git-branch'))
    await start($)
    await clock.advance(3000)
    const run = (args: string) => $.command.run({ command: 'mod-builder', args, origin: COMPOSER, presentation: PRESENTATION }) as Promise<{ text?: string }>
    const listed = (await run('config')).text ?? ''
    expect(listed).toContain('logging            normal')
    expect(listed).toContain('modsDir            /m/mods')
    expect(listed).toMatch(/Log file: \/home\/u\/\.claude\/mod-builder-data\/logs\/\d{4}-\d{2}-\d{2}-s1-sessi\.log/)
    const changed = (await run('config logging verbose')).text ?? ''
    expect(changed).toStartWith('logging is now verbose.')
    expect(changed).toContain('logging            verbose')
    expect(seen.sets).toEqual([{ key: 'mod-builder.logging', value: 'verbose' }])
    expect((await run('config logging loud')).text).toBe('logging must be one of off · normal · verbose · debug.')
    // The change line reaches the file before the set, which reloads the plugin.
    expect(lastLog(seen)).toContain('NORMAL  config  logging changing  {"value":"verbose"}')
    expect((await run('help')).text).toBe('Usage: /mod-builder config [list] · /mod-builder config <option> <value>')
  })
})

describe('testTimeoutMinutes in /mod-builder config (PR #55 review)', () => {
  test('the listing shows the time limit; a change writes its /config row', { options: { modsDir: MODS, testTimeoutMinutes: 2 } }, async ($, on) => {
    const { seen, clock } = world(on, modFiles('git-branch'))
    await start($)
    await clock.advance(10)
    const run = (args: string) => $.command.run({ command: 'mod-builder', args, origin: COMPOSER, presentation: PRESENTATION }) as Promise<{ text?: string }>
    expect((await run('config')).text).toContain('testTimeoutMinutes 2 minutes')
    const changed = (await run('config testTimeoutMinutes 5')).text ?? ''
    expect(changed).toStartWith('testTimeoutMinutes is now 5.')
    expect(changed).toContain('testTimeoutMinutes 5 minutes')
    expect(seen.sets).toEqual([{ key: 'mod-builder.testTimeoutMinutes', value: 5 }])
  })
})

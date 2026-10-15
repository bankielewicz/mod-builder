import { describe, expect, mock, test, type Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { REPORT_TTL_MS, resultOf, signatureOf } from '../hooks/mod-builder-logic'

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

function world(on: On, disk: Disk, outputs: { validate?: Output; test?: Output } = {}, isPlaced = true, hold?: Promise<void>, mtime: Mtimes = { ms: 1000 }, listHold?: Promise<void>, configRows?: { key: string; plugin: string }[], seeded: Readonly<Record<string, unknown>> = {}) {
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
    /** The session's project root (#92): undefined follows `cwd` (a `/cd` moves both); a string stays put (a Bash `cd` moves only `cwd`); null is refused. */
    root: undefined as string | null | undefined,
    failReads: [] as string[],
    /** Every path `$.fs.exists` was asked about. */
    probed: [] as string[],
    denySet: '',
    /** A store key whose writes are refused. */
    denyStoreSet: '',
    /** A store key whose reads are refused. */
    denyStoreGet: '',
    /** Arm mid-test: the next write of `key` waits for `until`, and sets `isReached`. */
    holdStoreSet: null as { key: string; until: Promise<void>; isReached: boolean } | null,
    /** Arm mid-test: the next read of `key` waits for `until`, and sets `isReached`. */
    holdStoreGet: null as { key: string; until: Promise<void>; isReached: boolean } | null,
    /** Arm mid-test: the next fs.list of `path` waits for `until`, once, and sets `isReached`. */
    holdList: null as { path: string; until: Promise<void>; isReached: boolean } | null,
    timeouts: [] as (number | undefined)[],
    /** While set, a test run never ends, as a Test that hangs does. */
    stallTests: false,
  }
  const clock = mock.clock(on, { now: Date.parse('2026-10-12T10:00:00Z') })
  // The store in memory, as mock.store keeps it (values read back as JSON), with reads and writes that can be refused.
  const stored = new Map<string, string>(Object.entries(seeded).map(([key, value]) => [key, JSON.stringify(value)]))
  on('store.get', async ($, e) => {
    const key = (e as { key: string }).key
    if (seen.denyStoreGet === key) return { deny: 'EIO: store read failed' }
    const held = seen.holdStoreGet
    if (held?.key === key && !held.isReached) {
      held.isReached = true
      await held.until
    }
    const text = stored.get(key)
    return { value: text === undefined ? undefined : JSON.parse(text) } as never
  })
  on('store.set', async ($, e) => {
    const { key, value } = e as { key: string; value: unknown }
    if (seen.denyStoreSet === key) return { deny: 'EIO: store write failed' }
    const held = seen.holdStoreSet
    if (held?.key === key && !held.isReached) {
      held.isReached = true
      await held.until
    }
    stored.set(key, JSON.stringify(value))
    return { value: undefined } as never
  })
  const entriesOf = (dir: string) => {
    const names = new Map<string, 'file' | 'dir'>()
    // The disk as it is now: a test may add files after the world is made.
    for (const path of Object.keys(disk)) {
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
    const path = (e as { path: string }).path
    if (seen.holdList?.path === path && !seen.holdList.isReached) {
      seen.holdList.isReached = true
      await seen.holdList.until
    }
    return { value: entriesOf(path) } as never
  })
  on('fs.read', ($, e) => {
    const path = (e as { path: string }).path
    if (seen.failReads.includes(path)) return { deny: 'EIO: read failed' }
    return path in disk ? ({ value: disk[path] } as never) : { deny: 'ENOENT' }
  })
  on('fs.exists', ($, e) => {
    const path = (e as { path: string }).path
    seen.probed.push(path)
    return { value: path in disk } as never
  })
  on('fs.write', ($, e) => (seen.writes.push({ path: (e as { path: string }).path, text: (e as { text: string }).text }), { value: undefined }) as never)
  on('ui.log', ($, e) => (seen.logs.push((e as { text: string }).text), { value: undefined }) as never)
  on('env.get', ($, e) => ({ value: (e as { name: string }).name === 'HOME' ? '/home/u' : undefined }) as never)
  on('session.cwd', () => (seen.cwd === null ? { deny: 'cwd unavailable' } : ({ value: seen.cwd } as never)))
  on('session.root', () => {
    const root = seen.root === undefined ? seen.cwd : seen.root
    return root === null ? { deny: 'root unavailable' } : ({ value: root } as never)
  })
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
    seen.denyStoreSet = `modlab:results:${MODS}`
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

  test('an orphan row is dropped by the clock and the stage stops reading running, with nothing else happening', SHORT, async ($, on) => {
    const hold = new Promise<void>(() => undefined)
    const { seen, clock } = world(on, modFiles('git-branch'), { test: { exitCode: 0, stdout: testPass } }, true, hold)
    await start($)
    await clock.advance(10)
    const ui = await mountPane($)
    await ui.press({ key: 'test' })
    await clock.advance(10)
    await ui.unmount()
    expect(seen.argv.length).toBe(1)
    const during = await mountPane($)
    expect(await during.find({ type: 'Text', text: /running tests/ })).toBeDefined()
    await during.unmount()
    await clock.advance(LIMIT + GRACE + 5000)
    const after = await mountPane($)
    expect(await after.find({ type: 'Text', text: /running tests/ })).toBeUndefined()
  })

  test('a fresh load clears the rows its module before left: T starts at once', SHORT, async ($, on) => {
    const hold = new Promise<void>(() => undefined)
    const { seen, clock } = world(on, modFiles('git-branch'), { test: { exitCode: 0, stdout: testPass } }, true, hold)
    await start($)
    await clock.advance(10)
    const ui = await mountPane($)
    await ui.press({ key: 'test' })
    await clock.advance(10)
    await ui.unmount()
    expect(seen.argv.length).toBe(1)
    // A reload fires session.start for the fresh module; the old module's continuations went with it.
    await start($)
    await clock.advance(10)
    const pane = await mountPane($)
    await pane.press({ key: 'test' })
    await clock.advance(10)
    expect(seen.argv.length).toBe(2)
  })

  test('a run whose row was replaced while its scan stalled starts no process', SHORT, async ($, on) => {
    const { seen, clock } = world(on, modFiles('git-branch'), { test: { exitCode: 0, stdout: testPass } })
    await start($)
    await clock.advance(10)
    let release = () => {}
    seen.holdList = { path: `${MODS}/git-branch`, until: new Promise<void>(resolve => (release = resolve)), isReached: false }
    const ui = await mountPane($)
    await ui.press({ key: 'test' })
    await clock.advance(10)
    await ui.unmount()
    expect(seen.holdList.isReached).toBe(true)
    await clock.advance(LIMIT + GRACE + 5000)
    const pane = await mountPane($)
    await pane.press({ key: 'test' })
    await clock.advance(10)
    release()
    await clock.advance(500)
    expect(seen.argv.length).toBe(1)
  })

  test('a run whose row was replaced while its result was being saved toasts nothing', SHORT, async ($, on) => {
    const { seen, clock } = world(on, modFiles('git-branch'), { test: { exitCode: 0, stdout: testPass } })
    await start($)
    await clock.advance(10)
    let release = () => {}
    seen.holdStoreSet = { key: `modlab:results:${MODS}`, until: new Promise<void>(resolve => (release = resolve)), isReached: false }
    const ui = await mountPane($)
    await ui.press({ key: 'test' })
    await clock.advance(10)
    await ui.unmount()
    expect(seen.holdStoreSet.isReached).toBe(true)
    await clock.advance(LIMIT + GRACE + 5000)
    const pane = await mountPane($)
    await pane.press({ key: 'test' })
    await clock.advance(10)
    expect(seen.argv.length).toBe(2)
    release()
    await clock.advance(500)
    expect(seen.toasts.filter(text => text.startsWith('✓ git-branch: '))).toHaveLength(1)
  })

  test('a run whose row was replaced while its process ran neither saves nor toasts its result', SHORT, async ($, on) => {
    let release = () => {}
    const hold = new Promise<void>(resolve => (release = resolve))
    const { seen, clock } = world(on, modFiles('git-branch'), { test: { exitCode: 0, stdout: testPass } }, true, hold)
    await start($)
    await clock.advance(10)
    const ui = await mountPane($)
    await ui.press({ key: 'test' })
    await clock.advance(10)
    await ui.unmount()
    await clock.advance(LIMIT + GRACE + 5000)
    const pane = await mountPane($)
    await pane.press({ key: 'test' })
    await clock.advance(10)
    expect(seen.argv.length).toBe(2)
    release()
    await clock.advance(500)
    expect(seen.toasts.filter(text => text.startsWith('✓ git-branch: '))).toHaveLength(1)
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

  test('a run whose scan throws says so, and the pane stops showing it running', OPTIONS, async ($, on) => {
    const { seen, clock } = world(on, modFiles('git-branch'), { test: { exitCode: 0, stdout: testPass } })
    await start($)
    await clock.advance(10)
    // The run's own scan stops at the mod's folder; reading modlab:done after it then fails.
    let release = () => {}
    seen.holdList = { path: `${MODS}/git-branch`, until: new Promise<void>(resolve => (release = resolve)), isReached: false }
    const ui = await mountPane($)
    await ui.press({ key: 'test' })
    await clock.advance(10)
    await ui.unmount()
    expect(seen.holdList.isReached).toBe(true)
    seen.denyStoreGet = `modlab:done:${MODS}`
    release()
    await clock.advance(10)
    seen.denyStoreGet = ''
    await clock.advance(500)
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

describe('a mod reported before its folder exists (#19)', () => {
  const report = ($: Engine, mod: string) =>
    $.tool.call({ tool: 'mcp__mod-builder__lab_report', mod, stage: 'Spec', status: 'running' } as never)
  /** Every row named `new-mod`, picked (` new-mod `) or not (` new-mod`); the detail header is bare, so not counted. */
  const rowsOf = async (ui: Awaited<ReturnType<typeof mountPane>>) => (await ui.findAll({ type: 'Text', text: /^ new-mod ?$/ })).length
  const ACTIONS = ['validate', 'test', 'typecheck', 'readme', 'fix']

  test('a Spec report for a mod with no folder adds its row: folder note, counted as building, no actions', OPTIONS, async ($, on) => {
    const { clock } = world(on, modFiles('git-branch'))
    await start($)
    await clock.advance(10)
    await report($, 'new-mod')
    await clock.advance(10)
    const ui = await mountPane($)
    expect(await ui.find({ type: 'Text', text: /^ new-mod $/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /folder not written yet: .*new-mod\// })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^2 mods$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^1 building$/ })).toBeDefined()
    for (const key of ACTIONS) expect(await ui.find({ key })).toBeUndefined()
  })

  test('/modlab <name> selects the placeholder row instead of saying there is no such mod', OPTIONS, async ($, on) => {
    const { seen, clock } = world(on, modFiles('git-branch'))
    await start($)
    await clock.advance(10)
    await report($, 'new-mod')
    await clock.advance(10)
    await command($, 'git-branch')
    await clock.advance(10)
    const before = await mountPane($)
    expect(await before.find({ type: 'Text', text: /^ git-branch $/ })).toBeDefined()
    await before.unmount()
    await command($, 'new-mod')
    await clock.advance(10)
    expect(seen.toasts.filter(text => text.startsWith('No mod named'))).toEqual([])
    const after = await mountPane($)
    expect(await after.find({ type: 'Text', text: /^ new-mod $/ })).toBeDefined()
    expect(await after.find({ type: 'Text', text: /folder not written yet/ })).toBeDefined()
  })

  test('once the folder has its SPEC, the next scan shows the real row and the placeholder is gone', OPTIONS, async ($, on) => {
    const disk: Disk = modFiles('git-branch')
    const { clock } = world(on, disk)
    await start($)
    await clock.advance(10)
    await report($, 'new-mod')
    await clock.advance(10)
    const placeholder = await mountPane($)
    expect(await placeholder.find({ type: 'Text', text: /folder not written yet/ })).toBeDefined()
    expect(await placeholder.find({ key: 'validate' })).toBeUndefined()
    expect(await rowsOf(placeholder)).toBe(1)
    await placeholder.unmount()
    Object.assign(disk, { [`${MODS}/new-mod/SPEC.md`]: '# new-mod\n| archetype | REQUIRED | band | x |\nDone.\n' })
    await command($, 'new-mod')
    await clock.advance(10)
    const real = await mountPane($)
    expect(await real.find({ type: 'Text', text: /^ new-mod $/ })).toBeDefined()
    expect(await real.find({ type: 'Text', text: /mods\/new-mod\// })).toBeDefined()
    expect(await real.find({ type: 'Text', text: /folder not written yet/ })).toBeUndefined()
    expect(await real.find({ key: 'validate' })).toBeDefined()
    expect(await rowsOf(real)).toBe(1)
  })

  test('a placeholder whose running report expires leaves the list at the next tick, with no turn or command (Codex P2, PR #80)', OPTIONS, async ($, on) => {
    const { clock } = world(on, modFiles('git-branch'))
    await start($)
    await clock.advance(10)
    await report($, 'new-mod')
    await clock.advance(10)
    const before = await mountPane($)
    expect(await rowsOf(before)).toBe(1)
    await before.unmount()
    await clock.advance(REPORT_TTL_MS + 1000)
    await clock.settle()
    const after = await mountPane($)
    expect(await rowsOf(after)).toBe(0)
    expect(await after.find({ type: 'Text', text: /^1 building$/ })).toBeUndefined()
  })

  test('a placeholder is listed only in the mods folder its report was made in, across a /cd (Codex P2, PR #80)', async ($, on) => {
    const marketplaceAt = (folder: string): Disk => ({ [`${folder}/.claude-plugin/marketplace.json`]: '{ "plugins": [] }' })
    const { seen, clock } = world(on, {
      ...marketplaceAt('/w/one'),
      ...modFiles('alpha', '/w/one/mods'),
      ...marketplaceAt('/w/two'),
      ...modFiles('beta', '/w/two/mods'),
    })
    seen.cwd = '/w/one/plugins/x'
    await start($)
    await clock.advance(10)
    await report($, 'new-mod')
    await clock.advance(10)
    seen.cwd = '/w/two/plugins/x'
    await command($, 'beta')
    await clock.advance(10)
    const two = await mountPane($)
    expect(await two.find({ type: 'Text', text: /beta/ })).toBeDefined()
    expect(await rowsOf(two)).toBe(0)
    await two.unmount()
    seen.cwd = '/w/one/plugins/x'
    await command($, 'new-mod')
    await clock.advance(10)
    const one = await mountPane($)
    expect(await rowsOf(one)).toBe(1)
    expect(await one.find({ type: 'Text', text: /folder not written yet: .*one\/mods\/new-mod\// })).toBeDefined()
  })

  test('a report that lands while a tick retires the last one keeps the clock, so its placeholder still expires (Codex P2, PR #80 round 2)', { ...OPTIONS, timeoutMs: 20_000 }, async ($, on) => {
    const { clock } = world(on, modFiles('git-branch'))
    // Once armed, the first read of the rows right after a read of the builds (the tick's expiry check)
    // waits for `until`: a report sent meanwhile lands after the tick took its builds and before it stops the clock.
    const hold = { isArmed: false, isReached: false, until: Promise.resolve() }
    let lastKey = ''
    on('state.get', async (_, e, next) => {
      const { plugin, key } = e as unknown as { plugin: string; key: string }
      if (plugin === 'mod-builder') {
        if (hold.isArmed && key === 'judged' && lastKey === 'building') {
          hold.isArmed = false
          hold.isReached = true
          await hold.until
        }
        lastKey = key
      }
      return next(e)
    })
    const lateRows = async () => {
      const ui = await mountPane($)
      const count = (await ui.findAll({ type: 'Text', text: /^ late-mod ?$/ })).length
      await ui.unmount()
      return count
    }
    await start($)
    await clock.advance(10)
    await report($, 'new-mod')
    await clock.advance(10)
    // Ticks come every 250 ms from the report; the one at REPORT_TTL_MS is the first that finds it expired.
    await clock.advance(REPORT_TTL_MS - 600)
    await clock.advance(500)
    let release = () => {}
    Object.assign(hold, { isArmed: true, until: new Promise<void>(resolve => (release = resolve)) })
    await clock.advance(250)
    expect(hold.isReached).toBe(true)
    await report($, 'late-mod')
    release()
    await clock.advance(10)
    await clock.settle()
    const between = await mountPane($)
    expect(await rowsOf(between)).toBe(0)
    await between.unmount()
    expect(await lateRows()).toBe(1)
    await clock.advance(REPORT_TTL_MS + 1000)
    await clock.settle()
    expect(await lateRows()).toBe(0)
  })

  test('a live running report a fresh module finds at session start keeps a clock, so its placeholder still expires (Codex P2, PR #80 round 3)', { ...OPTIONS, timeoutMs: 20_000 }, async ($, on) => {
    const { clock } = world(on, modFiles('git-branch'))
    // As after a reload: state kept a running report from the module before, and this module has no clock.
    const report = { stage: 'Spec', status: 'running', since: Date.parse('2026-10-12T10:00:00Z'), dir: MODS }
    const restored: Record<string, unknown> = { reported: { 'new-mod': report }, building: { [MODS]: { 'new-mod': report } } }
    const written = new Set<string>()
    on('state.set', (_, e, next) => {
      const { plugin, key } = e as unknown as { plugin: string; key: string }
      if (plugin === 'mod-builder') written.add(key)
      return next(e)
    })
    on('state.get', async (_, e, next) => {
      const { plugin, key } = e as unknown as { plugin: string; key: string }
      if (plugin === 'mod-builder' && key in restored && !written.has(key)) return { value: { version: 1, value: restored[key] } } as never
      return next(e)
    })
    await start($)
    await clock.advance(10)
    const before = await mountPane($)
    expect(await rowsOf(before)).toBe(1)
    await before.unmount()
    await clock.advance(REPORT_TTL_MS + 1000)
    await clock.settle()
    const after = await mountPane($)
    expect(await rowsOf(after)).toBe(0)
    expect(await after.find({ type: 'Text', text: /^1 building$/ })).toBeUndefined()
  })

  test('same-named new mods built in two mods folders each keep their placeholder (Codex P2, PR #80 round 4)', async ($, on) => {
    const marketplaceAt = (folder: string): Disk => ({ [`${folder}/.claude-plugin/marketplace.json`]: '{ "plugins": [] }' })
    const { seen, clock } = world(on, {
      ...marketplaceAt('/w/one'),
      ...modFiles('alpha', '/w/one/mods'),
      ...marketplaceAt('/w/two'),
      ...modFiles('beta', '/w/two/mods'),
    })
    seen.cwd = '/w/one/plugins/x'
    await start($)
    await clock.advance(10)
    await report($, 'new-mod')
    await clock.advance(10)
    seen.cwd = '/w/two/plugins/x'
    await command($, 'beta')
    await clock.advance(10)
    await report($, 'new-mod')
    await clock.advance(10)
    seen.cwd = '/w/one/plugins/x'
    await command($, 'new-mod')
    await clock.advance(10)
    const one = await mountPane($)
    expect(await rowsOf(one)).toBe(1)
    expect(await one.find({ type: 'Text', text: /folder not written yet: .*one\/mods\/new-mod\// })).toBeDefined()
  })

  test('a repeated Spec running for a placeholder starts no edit, so the SPEC written next is not stale', OPTIONS, async ($, on) => {
    const disk: Disk = modFiles('git-branch')
    const { clock } = world(on, disk)
    await start($)
    await clock.advance(10)
    await report($, 'new-mod')
    await clock.advance(10)
    await report($, 'new-mod')
    await clock.advance(10)
    Object.assign(disk, { [`${MODS}/new-mod/SPEC.md`]: '# new-mod\n| archetype | REQUIRED | band | x |\nDone.\n' })
    await $.tool.call({ tool: 'mcp__mod-builder__lab_report', mod: 'new-mod', stage: 'Spec', status: 'passed' } as never)
    await clock.advance(10)
    await command($, 'new-mod')
    await clock.advance(10)
    const ui = await mountPane($)
    expect(await ui.find({ type: 'Text', text: /^ new-mod $/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^edit · / })).toBeUndefined()
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

  // validate also reads these (#17): a file in one, or the root .mcp.json, edited after a pass makes the checks stale.
  for (const file of ['agents/helper.md', 'commands/go.md', 'skills/review/SKILL.md', 'agents/team/lead.md', '.mcp.json']) {
    test(`${file} edited after a pass: the end of the turn re-runs Validate, then Test (#17)`, OPTIONS, async ($, on) => {
      const mtime: Mtimes = { ms: 1000 }
      const disk = { ...modFiles('git-branch'), [`${MODS}/git-branch/${file}`]: '' }
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
      mtime.byPath = { [`${MODS}/git-branch/${file}`]: 5000 }
      await $.turn.complete({ answer: 'edited' } as never)
      await clock.advance(1000)
      expect(seen.argv.slice(2).map(argv => argv[2])).toEqual(['validate', 'test'])
    })
  }

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

describe('edit: Spec running arrives while another hook\'s scan is listing (#10)', () => {
  const ok = (kind: string) => ({ kind, ok: true, stampMs: 5000, atMs: 5000, durationMs: 100, summary: 'ok', errors: [] })
  // Validate and Test passed in an earlier session: the files' mtime is 1000, the results are stamped 5000.
  const seed = { [`modlab:results:${MODS}`]: { 'git-branch': { Validate: ok('Validate'), Test: ok('Test') } } }
  const reportSpec = ($: Engine, status: string) =>
    $.tool.call({ tool: 'mcp__mod-builder__lab_report', mod: 'git-branch', stage: 'Spec', status } as never)

  test('the edit is tracked: a state read after the scan the report waits for sees what that scan wrote', OPTIONS, async ($, on) => {
    const disk: Disk = {
      ...modFiles('inbox-zero'),
      '/m/.claude-plugin/marketplace.json': JSON.stringify({ plugins: [{ name: 'git-branch', source: './mods/git-branch', version: '0.1.0' }] }),
    }
    const { seen, clock } = world(on, disk, {}, true, undefined, { ms: 1000 }, undefined, undefined, seed)
    await start($)
    await clock.advance(10)
    // git-branch, checked in an earlier session, appears on disk after the startup scan ended.
    Object.assign(disk, modFiles('git-branch'), { [`${MODS}/git-branch/README.md`]: '# Git branch\n\n## What it reaches\n' })

    // The end of a turn starts a scan (its own hook), and the scan waits at the mods folder.
    let release = () => {}
    seen.holdList = { path: MODS, until: new Promise<void>(resolve => (release = resolve)), isReached: false }
    await $.turn.complete({ answer: 'created' } as never)
    await clock.advance(10)
    expect(seen.holdList.isReached).toBe(true)

    // Spec running arrives meanwhile: git-branch is in no list yet, so the report waits for that scan.
    const reporting = reportSpec($, 'running')
    await clock.advance(10)
    release()
    await reporting
    await clock.advance(1000)
    await reportSpec($, 'passed')
    await clock.advance(10)

    const ui = await mountPane($)
    expect(await ui.find({ type: 'Text', text: /^edit · update Spec for this change$/ })).toBeDefined()
  })

  test('the edit is tracked when the report lands after the scan has its facts but before it writes its rows (PR #74 review)', OPTIONS, async ($, on) => {
    const disk: Disk = {
      ...modFiles('inbox-zero'),
      '/m/.claude-plugin/marketplace.json': JSON.stringify({ plugins: [{ name: 'git-branch', source: './mods/git-branch', version: '0.1.0' }] }),
    }
    const { seen, clock } = world(on, disk, {}, true, undefined, { ms: 1000 }, undefined, undefined, seed)
    await start($)
    await clock.advance(10)
    Object.assign(disk, modFiles('git-branch'), { [`${MODS}/git-branch/README.md`]: '# Git branch\n\n## What it reaches\n' })

    // The end of a turn starts a scan; it has read every mod folder and waits at its first read after that.
    let release = () => {}
    seen.holdStoreGet = { key: `modlab:done:${MODS}`, until: new Promise<void>(resolve => (release = resolve)), isReached: false }
    await $.turn.complete({ answer: 'created' } as never)
    await clock.advance(10)
    expect(seen.holdStoreGet.isReached).toBe(true)

    // Spec running arrives meanwhile: the scan knows git-branch but hasn't written its rows.
    const reporting = reportSpec($, 'running')
    await clock.advance(10)
    release()
    await reporting
    await clock.advance(1000)
    await reportSpec($, 'passed')
    await clock.advance(10)

    const ui = await mountPane($)
    expect(await ui.find({ type: 'Text', text: /^edit · update Spec for this change$/ })).toBeDefined()
  })
})

describe('nested logic edit during a generation (#15, Codex 4254194992)', () => {
  async function nested($: Engine, on: On, touchTopLevel: boolean) {
    const mtime: Mtimes = { ms: 1000 }
    const manifest = (v: string) => `{ "name": "git-branch", "version": "${v}", "description": "The git-branch mod." }`
    const market = (v: string) => JSON.stringify({ plugins: [{ name: 'git-branch', source: './mods/git-branch', version: v }] })
    const logicPath = `${MODS}/git-branch/hooks/git-branch-logic.ts`
    const testPath = `${MODS}/git-branch/tests/git-branch-logic.test.ts`
    const disk: Disk = {
      ...modFiles('git-branch'),
      [`${MODS}/git-branch/hooks/lib/parser.ts`]: '',
      [`${MODS}/git-branch/README.md`]: '# Git branch\n\n## What it reaches\n',
      '/m/.claude-plugin/marketplace.json': market('0.1.0'),
    }
    const { clock } = world(on, disk, { validate: { exitCode: 0, stdout: validateClean }, test: { exitCode: 0, stdout: testPass } }, true, undefined, mtime)
    let t = Date.parse('2026-10-12T10:00:00Z')
    const adv = async (ms: number) => { t += ms; await clock.advance(ms) }
    await start($)
    await adv(10)
    let ui = await mountPane($)
    await ui.press({ key: 'validate' })
    await adv(500)
    await ui.press({ key: 'test' })
    await adv(500)
    await ui.unmount()
    await adv(5000)
    await $.tool.call({ tool: 'mcp__mod-builder__lab_report', mod: 'git-branch', stage: 'Spec', status: 'running', note: 'editing: parser' } as never)
    await adv(10)
    await $.tool.call({ tool: 'mcp__mod-builder__lab_report', mod: 'git-branch', stage: 'Spec', status: 'passed' } as never)
    disk[`${MODS}/git-branch/.claude-plugin/plugin.json`] = manifest('0.1.1')
    disk['/m/.claude-plugin/marketplace.json'] = market('0.1.1')
    mtime.ms = t + 100
    if (!touchTopLevel) mtime.byPath = { [logicPath]: 1000, [testPath]: 1000 }   // only SPEC, README, manifest and hooks/lib/parser.ts were saved
    await adv(200)
    await $.turn.complete({ answer: 'one' } as never)
    await adv(3000)
    ui = await mountPane($)
    const ready = (await ui.find({ type: 'Text', text: /^ready to share$/ })) !== undefined
    const lines = (await ui.findAll({ type: 'Text', text: /edit ·|ready to share|stale|in progress|update/ })).map((n: any) => String(n.text).trim()).join(' | ')
    await ui.unmount()
    return { ready, lines }
  }

  test('only hooks/lib/parser.ts (plus SPEC, README, manifest) saved -> ready to share', OPTIONS, async ($, on) => {
    const r = await nested($, on, false)
    expect(r.lines).not.toMatch(/update Logic/)
    expect(r.ready).toBe(true)
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

describe('two runs finishing together', () => {
  test('both Validate results are kept', OPTIONS, async ($, on) => {
    let release = () => {}
    const hold = new Promise<void>(resolve => (release = resolve))
    const { clock } = world(on, { ...modFiles('git-branch'), ...modFiles('inbox-zero') }, { validate: { exitCode: 0, stdout: validateClean } }, true, hold)
    await start($)
    await clock.advance(10)
    await $.tool.call({ tool: 'mcp__mod-builder__lab_report', mod: 'git-branch', stage: 'Validate', status: 'passed' } as never)
    await $.tool.call({ tool: 'mcp__mod-builder__lab_report', mod: 'inbox-zero', stage: 'Validate', status: 'passed' } as never)
    await clock.advance(10)
    release()
    await clock.advance(1000)
    const ui = await mountPane($)
    const next = (await ui.findAll({ type: 'Text', text: /^next: / })).map((n: any) => String(n.text).trim())
    expect(next).toEqual(['next: Test', 'next: Test'])
  })
})

describe('a results write that fails', () => {
  test('still ends the run: the row stops showing it, and its result is toasted', OPTIONS, async ($, on) => {
    const { seen, clock } = world(on, modFiles('git-branch'), { validate: { exitCode: 0, stdout: validateClean } })
    await start($)
    await clock.advance(10)
    seen.denyStoreSet = `modlab:results:${MODS}`
    const ui = await mountPane($)
    await ui.press({ key: 'validate' })
    await clock.advance(500)
    expect((await ui.find({ key: 'row-git-branch' }))?.text).toMatch(/ next: Validate$/)
    expect(seen.toasts.some(text => text.startsWith('✓ git-branch: '))).toBe(true)
  })
})

describe('a scan that read the generations before an edit began', () => {
  const manifestOf = (version: string) => `{ "name": "git-branch", "version": "${version}", "description": "The git-branch mod." }`
  const listing = (version: string) => JSON.stringify({ plugins: [{ name: 'git-branch', source: './mods/git-branch', version }] })
  /** Presses V, then T, on the selected mod, each run to its end. */
  const recheck = async ($: Engine, clock: ReturnType<typeof world>['clock']) => {
    const ui = await mountPane($)
    await ui.press({ key: 'validate' })
    await clock.advance(500)
    await ui.press({ key: 'test' })
    await clock.advance(500)
    await ui.unmount()
  }
  const reportSpec = ($: Engine, mod: string, status: string) =>
    $.tool.call({ tool: 'mcp__mod-builder__lab_report', mod, stage: 'Spec', status } as never)

  test('the edit reported while the scan is held is still tracked when it ends', OPTIONS, async ($, on) => {
    const disk: Disk = {
      ...modFiles('git-branch'),
      ...modFiles('inbox-zero'),
      [`${MODS}/git-branch/README.md`]: '# Git branch\n\n## What it reaches\n',
      '/m/.claude-plugin/marketplace.json': listing('0.1.0'),
    }
    // Every file is newer than the edits below, except inbox-zero's SPEC.md.
    const mtime: Mtimes = { ms: Date.parse('2027-01-01T00:00:00Z'), byPath: { [`${MODS}/inbox-zero/SPEC.md`]: 1000 } }
    const { seen, clock } = world(on, disk, { validate: { exitCode: 0, stdout: validateClean }, test: { exitCode: 0, stdout: testPass } }, true, undefined, mtime)
    await start($)
    await clock.advance(10)

    // git-branch is green, then edited, redone and re-listed: every stage is green again, and its edit is about to end.
    await recheck($, clock)
    await clock.advance(5000)
    await reportSpec($, 'git-branch', 'running')
    await reportSpec($, 'git-branch', 'passed')
    await clock.advance(10)
    await recheck($, clock)
    disk[`${MODS}/git-branch/.claude-plugin/plugin.json`] = manifestOf('0.1.1')
    disk['/m/.claude-plugin/marketplace.json'] = listing('0.1.1')

    // The scan that ends it reads the generations, then waits at the first mod folder.
    let release = () => {}
    seen.holdList = { path: `${MODS}/git-branch`, until: new Promise<void>(resolve => (release = resolve)), isReached: false }
    await $.turn.complete({ answer: 'edited' } as never)
    await clock.advance(10)
    expect(seen.holdList.isReached).toBe(true)

    // Meanwhile inbox-zero, built before, starts an edit of its own.
    await reportSpec($, 'inbox-zero', 'running')
    await clock.advance(10)
    release()
    await clock.advance(1000)
    await reportSpec($, 'inbox-zero', 'passed')
    await clock.advance(1000)

    const ui = await mountPane($)
    expect((await ui.find({ key: 'row-inbox-zero' }))?.text).toMatch(/ edit · update Spec for this change$/)
  })

  test('an edit reported while the scan is held starts from the version on disk', OPTIONS, async ($, on) => {
    const disk: Disk = {
      ...modFiles('git-branch'),
      [`${MODS}/git-branch/README.md`]: '# Git branch\n\n## What it reaches\n',
      '/m/.claude-plugin/marketplace.json': listing('0.1.0'),
    }
    // Every file is newer than the edit below.
    const { seen, clock } = world(on, disk, { validate: { exitCode: 0, stdout: validateClean }, test: { exitCode: 0, stdout: testPass } }, true, undefined, { ms: Date.parse('2027-01-01T00:00:00Z') })
    await start($)
    await clock.advance(10)

    // git-branch is green, listed at 0.1.0.
    await recheck($, clock)
    // A scan has started over the mods folder and waits at git-branch's folder.
    let release = () => {}
    seen.holdList = { path: `${MODS}/git-branch`, until: new Promise<void>(resolve => (release = resolve)), isReached: false }
    await $.turn.complete({ answer: 'done' } as never)
    await clock.advance(10)
    expect(seen.holdList.isReached).toBe(true)

    // Meanwhile git-branch's edit begins, at version 0.1.0.
    await reportSpec($, 'git-branch', 'running')
    await clock.advance(10)
    release()
    await clock.advance(1000)
    await reportSpec($, 'git-branch', 'passed')
    await clock.advance(10)
    // Checked again, but neither bumped nor re-listed: Share is what the edit still needs.
    await recheck($, clock)

    const ui = await mountPane($)
    expect((await ui.find({ key: 'row-git-branch' }))?.text).toMatch(/ edit · bump the version and re-list it$/)
  })

  test('a second edit of the mod whose edit the scan ends is still tracked', OPTIONS, async ($, on) => {
    const disk: Disk = {
      ...modFiles('git-branch'),
      [`${MODS}/git-branch/README.md`]: '# Git branch\n\n## What it reaches\n',
      '/m/.claude-plugin/marketplace.json': listing('0.1.0'),
    }
    // Every file is newer than the edits below, until the second edit leaves SPEC.md older than itself.
    const mtime: Mtimes = { ms: Date.parse('2027-01-01T00:00:00Z'), byPath: {} }
    const { seen, clock } = world(on, disk, { validate: { exitCode: 0, stdout: validateClean }, test: { exitCode: 0, stdout: testPass } }, true, undefined, mtime)
    await start($)
    await clock.advance(10)

    // git-branch is green, then edited, redone and re-listed: every stage is green again, and its edit is about to end.
    await recheck($, clock)
    await clock.advance(5000)
    await reportSpec($, 'git-branch', 'running')
    await reportSpec($, 'git-branch', 'passed')
    await clock.advance(10)
    await recheck($, clock)
    disk[`${MODS}/git-branch/.claude-plugin/plugin.json`] = manifestOf('0.1.1')
    disk['/m/.claude-plugin/marketplace.json'] = listing('0.1.1')

    // The scan that ends it reads the generations, then waits at git-branch's folder.
    let release = () => {}
    seen.holdList = { path: `${MODS}/git-branch`, until: new Promise<void>(resolve => (release = resolve)), isReached: false }
    await $.turn.complete({ answer: 'edited' } as never)
    await clock.advance(10)
    expect(seen.holdList.isReached).toBe(true)

    // Meanwhile git-branch's next edit begins.
    await clock.advance(5000)
    await reportSpec($, 'git-branch', 'running')
    await clock.advance(10)
    release()
    await clock.advance(1000)
    // It reports its Spec done without having changed SPEC.md.
    mtime.byPath![`${MODS}/git-branch/SPEC.md`] = 1000
    await reportSpec($, 'git-branch', 'passed')
    await clock.advance(1000)

    const ui = await mountPane($)
    expect((await ui.find({ key: 'row-git-branch' }))?.text).toMatch(/ edit · update Spec for this change$/)
  })

  /**
   * git-branch's edit is bumped to 0.1.1, redone and re-listed, and the scan that ends it is held after
   * reading the generations. The next edit's Spec running arrives meanwhile, then its Spec passed.
   */
  async function secondEditInTheWindow($: Engine, on: On) {
    const disk: Disk = {
      ...modFiles('git-branch'),
      [`${MODS}/git-branch/README.md`]: '# Git branch\n\n## What it reaches\n',
      '/m/.claude-plugin/marketplace.json': listing('0.1.0'),
    }
    // Every file is newer than the edits below.
    const { seen, clock } = world(on, disk, { validate: { exitCode: 0, stdout: validateClean }, test: { exitCode: 0, stdout: testPass } }, true, undefined, { ms: Date.parse('2027-01-01T00:00:00Z') })
    await start($)
    await clock.advance(10)
    await recheck($, clock)
    await clock.advance(5000)
    await reportSpec($, 'git-branch', 'running')
    await reportSpec($, 'git-branch', 'passed')
    await clock.advance(10)
    await recheck($, clock)
    disk[`${MODS}/git-branch/.claude-plugin/plugin.json`] = manifestOf('0.1.1')
    disk['/m/.claude-plugin/marketplace.json'] = listing('0.1.1')

    let release = () => {}
    seen.holdList = { path: `${MODS}/git-branch`, until: new Promise<void>(resolve => (release = resolve)), isReached: false }
    await $.turn.complete({ answer: 'edited' } as never)
    await clock.advance(10)
    expect(seen.holdList.isReached).toBe(true)

    await clock.advance(5000)
    await reportSpec($, 'git-branch', 'running')
    await clock.advance(10)
    release()
    await clock.advance(1000)
    await reportSpec($, 'git-branch', 'passed')
    await clock.advance(1000)
    return clock
  }

  test('a second edit that begins while the scan ends the first starts from the version the first left', OPTIONS, async ($, on) => {
    const clock = await secondEditInTheWindow($, on)
    // Checked again, but not bumped past 0.1.1: Share is what the edit still needs.
    await recheck($, clock)

    const ui = await mountPane($)
    expect((await ui.find({ key: 'row-git-branch' }))?.text).toMatch(/ edit · bump the version and re-list it$/)
  })

  // With autoRerun on, the end of the turn would run the stale checks again before the row is read.
  test('a second edit that begins while the scan ends the first starts at its own report: earlier checks are stale', { options: { modsDir: MODS, autoRerun: false } }, async ($, on) => {
    await secondEditInTheWindow($, on)

    // Validate and Test last ran in the first edit, before this one began.
    const ui = await mountPane($)
    expect((await ui.find({ key: 'row-git-branch' }))?.text).toMatch(/ files changed · re-run Validate$/)
  })

  test('a second edit reported in the same millisecond as the repeat the scan read is still tracked (Codex P2 on PR #73)', OPTIONS, async ($, on) => {
    const disk: Disk = {
      ...modFiles('git-branch'),
      [`${MODS}/git-branch/README.md`]: '# Git branch\n\n## What it reaches\n',
      '/m/.claude-plugin/marketplace.json': listing('0.1.0'),
    }
    // Every file is newer than the edits below.
    const { seen, clock } = world(on, disk, { validate: { exitCode: 0, stdout: validateClean }, test: { exitCode: 0, stdout: testPass } }, true, undefined, { ms: Date.parse('2027-01-01T00:00:00Z') })
    await start($)
    await clock.advance(10)
    await recheck($, clock)
    await clock.advance(5000)
    await reportSpec($, 'git-branch', 'running')
    await reportSpec($, 'git-branch', 'passed')
    await clock.advance(10)
    await recheck($, clock)
    disk[`${MODS}/git-branch/.claude-plugin/plugin.json`] = manifestOf('0.1.1')
    disk['/m/.claude-plugin/marketplace.json'] = listing('0.1.1')
    await clock.advance(5000)

    // From here the clock stands still. The edit's Spec is reported again, and the scan that ends
    // the edit reads that repeat, then waits at git-branch's folder.
    await reportSpec($, 'git-branch', 'running')
    await reportSpec($, 'git-branch', 'passed')
    let release = () => {}
    seen.holdList = { path: `${MODS}/git-branch`, until: new Promise<void>(resolve => (release = resolve)), isReached: false }
    await $.turn.complete({ answer: 'edited' } as never)
    await clock.settle()
    expect(seen.holdList.isReached).toBe(true)

    // The next edit begins in the same millisecond.
    await reportSpec($, 'git-branch', 'running')
    release()
    await clock.advance(1000)
    await reportSpec($, 'git-branch', 'passed')
    await clock.advance(10)
    // Checked again, but not bumped past 0.1.1: Share is what the edit still needs.
    await recheck($, clock)

    const ui = await mountPane($)
    expect((await ui.find({ key: 'row-git-branch' }))?.text).toMatch(/ edit · bump the version and re-list it$/)
  })
  test('an edit that begins before any scan has read a bump starts from the bumped version', OPTIONS, async ($, on) => {
    const disk: Disk = {
      ...modFiles('git-branch'),
      [`${MODS}/git-branch/README.md`]: '# Git branch\n\n## What it reaches\n',
      '/m/.claude-plugin/marketplace.json': listing('0.1.0'),
    }
    // Every file is newer than the edit below.
    const { clock } = world(on, disk, { validate: { exitCode: 0, stdout: validateClean }, test: { exitCode: 0, stdout: testPass } }, true, undefined, { ms: Date.parse('2027-01-01T00:00:00Z') })
    await start($)
    await clock.advance(10)

    // git-branch is green, listed at 0.1.0.
    await recheck($, clock)
    // A bump to 0.1.1 and its listing land on disk, and the next edit begins before any scan reads them.
    disk[`${MODS}/git-branch/.claude-plugin/plugin.json`] = manifestOf('0.1.1')
    disk['/m/.claude-plugin/marketplace.json'] = listing('0.1.1')
    await reportSpec($, 'git-branch', 'running')
    await clock.advance(10)
    await reportSpec($, 'git-branch', 'passed')
    await clock.advance(10)
    // Checked again, but not bumped past 0.1.1: Share is what the edit still needs.
    await recheck($, clock)

    const ui = await mountPane($)
    expect((await ui.find({ key: 'row-git-branch' }))?.text).toMatch(/ edit · bump the version and re-list it$/)
  })
  test('an edit whose plugin.json cannot be read as it begins starts from the version the last scan read', OPTIONS, async ($, on) => {
    const manifest = `${MODS}/git-branch/.claude-plugin/plugin.json`
    const disk: Disk = {
      ...modFiles('git-branch'),
      [`${MODS}/git-branch/README.md`]: '# Git branch\n\n## What it reaches\n',
      '/m/.claude-plugin/marketplace.json': listing('0.1.0'),
    }
    // Every file is newer than the edit below.
    const { seen, clock } = world(on, disk, { validate: { exitCode: 0, stdout: validateClean }, test: { exitCode: 0, stdout: testPass } }, true, undefined, { ms: Date.parse('2027-01-01T00:00:00Z') })
    await start($)
    await clock.advance(10)

    // git-branch is green, listed at 0.1.0.
    await recheck($, clock)
    // Its plugin.json can't be read just as the edit begins.
    seen.failReads.push(manifest)
    await reportSpec($, 'git-branch', 'running')
    seen.failReads.splice(seen.failReads.indexOf(manifest), 1)
    await clock.advance(10)
    await reportSpec($, 'git-branch', 'passed')
    await clock.advance(10)
    // Checked again, but not bumped past 0.1.0: Share is what the edit still needs.
    await recheck($, clock)

    const ui = await mountPane($)
    expect((await ui.find({ key: 'row-git-branch' }))?.text).toMatch(/ edit · bump the version and re-list it$/)
  })
  test('an edit whose plugin.json cannot be read while a scan is held starts from the version the last finished scan read', OPTIONS, async ($, on) => {
    const manifest = `${MODS}/git-branch/.claude-plugin/plugin.json`
    const disk: Disk = {
      ...modFiles('git-branch'),
      [`${MODS}/git-branch/README.md`]: '# Git branch\n\n## What it reaches\n',
      '/m/.claude-plugin/marketplace.json': listing('0.1.0'),
    }
    // Every file is newer than the edit below.
    const { seen, clock } = world(on, disk, { validate: { exitCode: 0, stdout: validateClean }, test: { exitCode: 0, stdout: testPass } }, true, undefined, { ms: Date.parse('2027-01-01T00:00:00Z') })
    await start($)
    await clock.advance(10)

    // git-branch is green, listed at 0.1.0.
    await recheck($, clock)
    // A scan has started over the mods folder and waits at git-branch's folder.
    let release = () => {}
    seen.holdList = { path: `${MODS}/git-branch`, until: new Promise<void>(resolve => (release = resolve)), isReached: false }
    await $.turn.complete({ answer: 'done' } as never)
    await clock.advance(10)
    expect(seen.holdList.isReached).toBe(true)

    // Meanwhile git-branch's edit begins, and its plugin.json can't be read just then.
    seen.failReads.push(manifest)
    await reportSpec($, 'git-branch', 'running')
    seen.failReads.splice(seen.failReads.indexOf(manifest), 1)
    await clock.advance(10)
    release()
    await clock.advance(1000)
    await reportSpec($, 'git-branch', 'passed')
    await clock.advance(10)
    // Checked again, but not bumped past 0.1.0: Share is what the edit still needs.
    await recheck($, clock)

    const ui = await mountPane($)
    expect((await ui.find({ key: 'row-git-branch' }))?.text).toMatch(/ edit · bump the version and re-list it$/)
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

  test('default clears its /config row, and the listing shows the default it then means', OPTIONS, async ($, on) => {
    const { seen, clock } = world(on, modFiles('git-branch'))
    await start($)
    await clock.advance(10)
    const run = (args: string) => $.command.run({ command: 'mod-builder', args, origin: COMPOSER, presentation: PRESENTATION }) as Promise<{ text?: string }>
    const changed = (await run('config testTimeoutMinutes default')).text ?? ''
    expect(changed).toStartWith('testTimeoutMinutes is now default.')
    expect(changed).toContain('testTimeoutMinutes 3 minutes')
    expect(seen.sets).toEqual([{ key: 'mod-builder.testTimeoutMinutes', value: '' }])
  })
})

describe('modsDir set', () => {
  test('a set modsDir is never walked: no marketplace is looked for at start, at a scan or in /mod-builder config (PR #57 review round 2)', OPTIONS, async ($, on) => {
    const { seen, clock } = world(on, { ...modFiles('git-branch'), ['/m/.claude-plugin/marketplace.json']: '{ "plugins": [] }' })
    seen.cwd = '/m/plugins/x'
    await start($)
    await clock.advance(10)
    await $.command.run({ command: 'mod-builder', args: 'config', origin: COMPOSER, presentation: PRESENTATION })
    await $.turn.complete({ answer: 'done' } as never)
    await clock.advance(1000)
    expect(seen.probed.filter(path => path.endsWith('/.claude-plugin/marketplace.json'))).toEqual([])
  })
})

describe('modsDir not set: the mods folder follows the working directory', () => {
  const WT = '/w/wt'
  const marketplaceAt = (folder: string): Disk => ({ [`${folder}/.claude-plugin/marketplace.json`]: '{ "plugins": [] }' })
  const startedLine = (seen: { logs: string[] }) => seen.logs.find(line => line.includes('Mod Lab started')) ?? ''

  test('a session in a worktree lists that worktree\'s mods', async ($, on) => {
    const { seen, clock } = world(on, { ...marketplaceAt(WT), ...modFiles('alpha', `${WT}/mods`) })
    seen.cwd = `${WT}/plugins/x`
    await start($)
    await clock.advance(10)
    const ui = await mountPane($)
    expect(await ui.find({ type: 'Text', text: /alpha/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^No mods yet\.$/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /…\/wt\/mods/ })).toBeDefined()
  })

  test('Validate runs against the worktree\'s mod folder', async ($, on) => {
    const { seen, clock } = world(on, { ...marketplaceAt(WT), ...modFiles('alpha', `${WT}/mods`) }, { validate: { exitCode: 0, stdout: validateClean } })
    seen.cwd = `${WT}/plugins/x`
    await start($)
    await clock.advance(10)
    const ui = await mountPane($)
    expect(await ui.find({ key: 'validate' })).toBeDefined()
    await ui.press({ key: 'validate' })
    await clock.advance(1000)
    expect(seen.argv).toEqual([['claude', 'plugin', 'validate', '--json', `${WT}/mods/alpha`]])
  })

  test('a worktree inside the main checkout lists the worktree\'s mods, not the main checkout\'s', async ($, on) => {
    const inner = '/w/main/scratch/wt'
    const { seen, clock } = world(on, {
      ...marketplaceAt('/w/main'),
      ...modFiles('alpha', '/w/main/mods'),
      ...marketplaceAt(inner),
      ...modFiles('beta', `${inner}/mods`),
    })
    seen.cwd = `${inner}/plugins/x`
    await start($)
    await clock.advance(10)
    const ui = await mountPane($)
    expect(await ui.find({ type: 'Text', text: /beta/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /alpha/ })).toBeUndefined()
  })

  test('a /cd into another worktree takes effect at the next scan', async ($, on) => {
    const { seen, clock } = world(on, {
      ...marketplaceAt('/w/one'),
      ...modFiles('alpha', '/w/one/mods'),
      ...marketplaceAt('/w/two'),
      ...modFiles('beta', '/w/two/mods'),
    })
    seen.cwd = '/w/one/plugins/x'
    await start($)
    await clock.advance(10)
    const before = await mountPane($)
    expect(await before.find({ type: 'Text', text: /alpha/ })).toBeDefined()
    expect(await before.find({ type: 'Text', text: /beta/ })).toBeUndefined()
    await before.unmount()
    seen.cwd = '/w/two/plugins/x'
    await command($, 'beta')
    await clock.advance(10)
    const after = await mountPane($)
    expect(await after.find({ type: 'Text', text: /beta/ })).toBeDefined()
    expect(await after.find({ type: 'Text', text: /alpha/ })).toBeUndefined()
  })

  test('a /cd out of every marketplace goes back to the plugin\'s own mods folder', async ($, on) => {
    const { seen, clock } = world(on, { ...marketplaceAt(WT), ...modFiles('alpha', `${WT}/mods`) })
    seen.cwd = `${WT}/plugins/x`
    await start($)
    await clock.advance(10)
    const inside = await mountPane($)
    expect(await inside.find({ type: 'Text', text: /alpha/ })).toBeDefined()
    await inside.unmount()
    seen.cwd = '/elsewhere'
    await command($, 'alpha')
    await clock.advance(10)
    const outside = await mountPane($)
    expect(await outside.find({ type: 'Text', text: /alpha/ })).toBeUndefined()
    expect(await outside.find({ type: 'Text', text: /^No mods yet\.$/ })).toBeDefined()
  })

  test('the session-start log line names the worktree\'s mods folder', async ($, on) => {
    const { seen, clock } = world(on, { ...marketplaceAt(WT), ...modFiles('alpha', `${WT}/mods`) })
    seen.cwd = `${WT}/plugins/x`
    await start($)
    await clock.advance(10)
    expect(startedLine(seen)).toContain(`"modsDir":"${WT}/mods"`)
  })

  test('the session-start log line names the main checkout\'s mods folder when the session starts there', async ($, on) => {
    const { seen, clock } = world(on, { ...marketplaceAt('/w/main'), ...modFiles('alpha', '/w/main/mods') })
    seen.cwd = '/w/main'
    await start($)
    await clock.advance(10)
    expect(startedLine(seen)).toContain('"modsDir":"/w/main/mods"')
  })

  test('/mod-builder config lists the worktree\'s mods folder as the default', async ($, on) => {
    const { seen, clock } = world(on, { ...marketplaceAt(WT), ...modFiles('alpha', `${WT}/mods`) })
    seen.cwd = `${WT}/plugins/x`
    await start($)
    await clock.advance(10)
    const listed = ((await $.command.run({ command: 'mod-builder', args: 'config', origin: COMPOSER, presentation: PRESENTATION })) as { text?: string }).text ?? ''
    expect(listed).toContain('modsDir            default (…/wt/mods)')
  })
})

describe('modsDir not set: each mods folder keeps its own results', () => {
  // Two worktrees, each with a mod named alpha whose files are alike.
  const ONE = '/w/one'
  const TWO = '/w/two'
  const alphaIn = (folder: string): Disk => ({
    ...modFiles('alpha', `${folder}/mods`),
    [`${folder}/mods/alpha/README.md`]: '# Alpha\n\n## What it reaches\n',
    [`${folder}/.claude-plugin/marketplace.json`]: JSON.stringify({ plugins: [{ name: 'alpha', source: './mods/alpha', version: '0.1.0' }] }),
  })
  const passing = { validate: { exitCode: 0, stdout: validateClean }, test: { exitCode: 0, stdout: testPass } }

  async function cdTo($: Engine, w: ReturnType<typeof world>, folder: string) {
    w.seen.cwd = `${folder}/plugins/x`
    await command($, 'alpha')
    await w.clock.advance(10)
  }

  async function validateAndTest($: Engine, w: ReturnType<typeof world>) {
    const ui = await mountPane($)
    await ui.press({ key: 'validate' })
    await w.clock.advance(500)
    await ui.press({ key: 'test' })
    await w.clock.advance(500)
    await ui.unmount()
  }

  async function shows($: Engine, text: RegExp): Promise<boolean> {
    const ui = await mountPane($)
    const found = await ui.find({ type: 'Text', text })
    await ui.unmount()
    return found !== undefined
  }

  test('the same-named mod in another worktree starts unchecked, and going back finds the first one\'s results', async ($, on) => {
    const w = world(on, { ...alphaIn(ONE), ...alphaIn(TWO) }, passing)
    w.seen.cwd = `${ONE}/plugins/x`
    await start($)
    await w.clock.advance(10)
    await validateAndTest($, w)
    expect(await shows($, /^ready to share$/)).toBe(true)
    await cdTo($, w, TWO)
    expect(await shows($, /^ready to share$/)).toBe(false)
    expect(await shows($, /next: Validate/)).toBe(true)
    await cdTo($, w, ONE)
    expect(await shows($, /^ready to share$/)).toBe(true)
  })

  test('a mod turning green is announced in each worktree, though one of the same name already was', async ($, on) => {
    const w = world(on, { ...alphaIn(ONE), ...alphaIn(TWO) }, passing)
    w.seen.cwd = `${ONE}/plugins/x`
    await start($)
    await w.clock.advance(10)
    await validateAndTest($, w)
    await cdTo($, w, TWO)
    await validateAndTest($, w)
    expect(w.seen.notified).toEqual(['alpha is ready to share', 'alpha is ready to share'])
  })

  test('an edit started in one worktree leaves the same-named mod in another as it was', async ($, on) => {
    const w = world(on, { ...alphaIn(ONE), ...alphaIn(TWO) }, passing)
    w.seen.cwd = `${TWO}/plugins/x`
    await start($)
    await w.clock.advance(10)
    await validateAndTest($, w)
    await cdTo($, w, ONE)
    await validateAndTest($, w)
    await w.clock.advance(5000)
    await $.tool.call({ tool: 'mcp__mod-builder__lab_report', mod: 'alpha', stage: 'Spec', status: 'running' } as never)
    await $.tool.call({ tool: 'mcp__mod-builder__lab_report', mod: 'alpha', stage: 'Spec', status: 'passed' } as never)
    await w.clock.advance(10)
    expect(await shows($, /^edit · update Spec for this change$/)).toBe(true)
    await cdTo($, w, TWO)
    expect(await shows($, /^ready to share$/)).toBe(true)
  })

  test('a run keeps its result with the folder it ran in, after a /cd while it runs', async ($, on) => {
    let release = () => {}
    const hold = new Promise<void>(resolve => (release = resolve))
    const w = world(on, { ...alphaIn(ONE), ...alphaIn(TWO) }, passing, true, hold)
    w.seen.cwd = `${ONE}/plugins/x`
    await start($)
    await w.clock.advance(10)
    const ui = await mountPane($)
    await ui.press({ key: 'validate' })
    await w.clock.advance(10)
    await ui.unmount()
    await cdTo($, w, TWO)
    release()
    await w.clock.advance(500)
    expect(w.seen.argv).toEqual([['claude', 'plugin', 'validate', '--json', `${ONE}/mods/alpha`]])
    expect(await shows($, /next: Validate/)).toBe(true)
    await cdTo($, w, ONE)
    expect(await shows($, /next: Test/)).toBe(true)
  })
})

describe('modsDir not set: what the pane does acts on the folder it shows (PR #57 review)', () => {
  const ONE = '/w/one'
  const TWO = '/w/two'
  const marketplaceOf = (folder: string, plugins: object[]): Disk => ({ [`${folder}/.claude-plugin/marketplace.json`]: JSON.stringify({ plugins }) })
  const ALPHA_ENTRY = { name: 'alpha', source: './mods/alpha', version: '0.1.0' }
  const alphaIn = (folder: string): Disk => ({
    ...modFiles('alpha', `${folder}/mods`),
    [`${folder}/mods/alpha/README.md`]: '# Alpha\n\n## What it reaches\n',
    ...marketplaceOf(folder, [ALPHA_ENTRY]),
  })
  const passing = { validate: { exitCode: 0, stdout: validateClean }, test: { exitCode: 0, stdout: testPass } }

  async function cdTo($: Engine, w: ReturnType<typeof world>, folder: string) {
    w.seen.cwd = `${folder}/plugins/x`
    await command($, 'alpha')
    await w.clock.advance(10)
  }

  async function press($: Engine, w: ReturnType<typeof world>, ...keys: string[]) {
    const ui = await mountPane($)
    for (const key of keys) {
      await ui.press({ key })
      await w.clock.advance(500)
    }
    await ui.unmount()
  }

  async function shows($: Engine, text: RegExp): Promise<boolean> {
    const ui = await mountPane($)
    const found = await ui.find({ type: 'Text', text })
    await ui.unmount()
    return found !== undefined
  }

  test('V after a /cd with no scan since runs the folder the pane shows, and stamps the result from that folder', async ($, on) => {
    const one = alphaIn(ONE)
    const mtime: Mtimes = { ms: 1000, byPath: Object.fromEntries(Object.keys(one).map(path => [path, 2000])) }
    const w = world(on, { ...one, ...alphaIn(TWO) }, passing, true, undefined, mtime)
    w.seen.cwd = `${ONE}/plugins/x`
    await start($)
    await w.clock.advance(10)
    const ui = await mountPane($)
    w.seen.cwd = `${TWO}/plugins/x`
    await ui.press({ key: 'validate' })
    await w.clock.advance(500)
    await ui.unmount()
    expect(w.seen.argv).toEqual([['claude', 'plugin', 'validate', '--json', `${ONE}/mods/alpha`]])
    await cdTo($, w, ONE)
    expect(await shows($, /next: Test/)).toBe(true)
  })

  test('the end-of-turn re-run checks the folder it judged, though a /cd lands during its first run', async ($, on) => {
    const mtime: Mtimes = { ms: 1000 }
    const box: { w?: ReturnType<typeof world>; moveOnRun: boolean } = { moveOnRun: false }
    // Awaited by every process.run: the first one after arming moves the session to TWO.
    const moving = {
      then(resolve: () => void) {
        if (box.moveOnRun && box.w) {
          box.moveOnRun = false
          box.w.seen.cwd = `${TWO}/plugins/x`
        }
        resolve()
      },
    } as unknown as Promise<void>
    const w = world(on, { ...alphaIn(ONE), ...modFiles('beta', `${ONE}/mods`), ...alphaIn(TWO) }, passing, true, moving, mtime)
    box.w = w
    w.seen.cwd = `${ONE}/plugins/x`
    await start($)
    await w.clock.advance(10)
    for (const name of ['alpha', 'beta']) {
      await command($, name)
      await w.clock.advance(10)
      await press($, w, 'validate')
    }
    expect(w.seen.argv.map(argv => argv[4])).toEqual([`${ONE}/mods/alpha`, `${ONE}/mods/beta`])
    mtime.ms = 5000
    box.moveOnRun = true
    await $.turn.complete({ answer: 'edited' } as never)
    await w.clock.advance(1000)
    expect(w.seen.argv.slice(2).map(argv => argv[4])).toEqual([`${ONE}/mods/alpha`, `${ONE}/mods/beta`])
  })

  test('a lab_report after a /cd with no scan since records the edit in the folder the session is in', async ($, on) => {
    const w = world(on, { ...alphaIn(ONE), ...alphaIn(TWO) }, passing)
    w.seen.cwd = `${TWO}/plugins/x`
    await start($)
    await w.clock.advance(10)
    await press($, w, 'validate', 'test')
    await cdTo($, w, ONE)
    await press($, w, 'validate', 'test')
    await w.clock.advance(5000)
    w.seen.cwd = `${TWO}/plugins/x`
    await $.tool.call({ tool: 'mcp__mod-builder__lab_report', mod: 'alpha', stage: 'Spec', status: 'running' } as never)
    await $.tool.call({ tool: 'mcp__mod-builder__lab_report', mod: 'alpha', stage: 'Spec', status: 'passed' } as never)
    await w.clock.advance(10)
    expect(await shows($, /^edit · update Spec for this change$/)).toBe(true)
    await cdTo($, w, ONE)
    expect(await shows($, /^ready to share$/)).toBe(true)
  })

  test('a README open in one folder closes when a scan moves to another', async ($, on) => {
    const w = world(on, { ...alphaIn(ONE), ...alphaIn(TWO) }, passing)
    const isReadmeOpen = async () => {
      const ui = await mountPane($)
      const back = await ui.find({ key: 'back' })
      await ui.unmount()
      return back !== undefined
    }
    w.seen.cwd = `${ONE}/plugins/x`
    await start($)
    await w.clock.advance(10)
    await press($, w, 'readme')
    expect(await isReadmeOpen()).toBe(true)
    w.seen.cwd = `${TWO}/plugins/x`
    await $.turn.complete({ answer: 'moved' } as never)
    await w.clock.advance(1000)
    expect(await isReadmeOpen()).toBe(false)
  })

  test('"ready to share" stays with the folder a mod turned green in: a same-named mod already green elsewhere reads clean', async ($, on) => {
    const disk = { ...alphaIn(ONE), ...alphaIn(TWO), ...marketplaceOf(TWO, []) }
    const w = world(on, disk, passing)
    // In TWO, alpha passes Validate and Test but isn't listed for sharing yet, so it isn't green.
    w.seen.cwd = `${TWO}/plugins/x`
    await start($)
    await w.clock.advance(10)
    await press($, w, 'validate', 'test')
    expect(await shows($, /^ready to share$/)).toBe(false)
    Object.assign(disk, marketplaceOf(TWO, [ALPHA_ENTRY]))
    await cdTo($, w, ONE)
    await press($, w, 'validate', 'test')
    expect(await shows($, /^ready to share$/)).toBe(true)
    // Back in TWO, alpha is now green from a quiet scan, never announced there.
    await cdTo($, w, TWO)
    expect(await shows($, /next: /)).toBe(false)
    expect(await shows($, /^ready to share$/)).toBe(false)
  })
})

describe('upgrade: records kept before 0.2.9, under one key for every folder (PR #57 review)', () => {
  const codeSig = signatureOf(['.claude-plugin/plugin.json', 'hooks/hooks.json', 'hooks/register.tsx', 'hooks/git-branch-logic.ts', 'tests/git-branch-logic.test.ts'].map(name => `${name}@1000`))
  // What 0.2.8 and earlier stored after V and T, for a mod that was announced.
  const legacy = {
    'modlab:results': {
      'git-branch': {
        Validate: { ...resultOf('Validate', 0, validateClean, 1000, 100, 2000), codeSig },
        Test: { ...resultOf('Test', 0, testPass, 1000, 100, 2000), codeSig },
      },
    },
    'modlab:done': { 'git-branch': codeSig },
  }
  const sharedIn = (folder: string): Disk => ({
    ...modFiles('git-branch', `${folder}/mods`),
    [`${folder}/mods/git-branch/README.md`]: '# Git branch\n\n## What it reaches\n',
    [`${folder}/.claude-plugin/marketplace.json`]: JSON.stringify({ plugins: [{ name: 'git-branch', source: './mods/git-branch', version: '0.1.0' }] }),
  })

  test('the folder they described (here a pinned modsDir) reads them: its mods stay checked, nothing re-runs or is announced again', OPTIONS, async ($, on) => {
    const { seen, clock } = world(on, sharedIn('/m'), {}, true, undefined, { ms: 1000 }, undefined, undefined, legacy)
    await start($)
    await clock.advance(10)
    await $.turn.complete({ answer: 'upgraded' } as never)
    await clock.advance(1000)
    const ui = await mountPane($)
    expect(await ui.find({ type: 'Text', text: /next: / })).toBeUndefined()
    expect(seen.argv).toEqual([])
    expect(seen.notified).toEqual([])
  })

  test('a session in another folder does not read them', async ($, on) => {
    const { seen, clock } = world(on, sharedIn('/w/one'), {}, true, undefined, { ms: 1000 }, undefined, undefined, legacy)
    seen.cwd = '/w/one/plugins/x'
    await start($)
    await clock.advance(10)
    const ui = await mountPane($)
    expect(await ui.find({ type: 'Text', text: /next: Validate/ })).toBeDefined()
  })
})

describe('the scan publishes its folder and its mods together (PR #57 review round 2)', () => {
  test('every state write that carries mods carries the folder they were judged in, across a /cd', async ($, on) => {
    const disk: Disk = {
      ['/w/one/.claude-plugin/marketplace.json']: '{ "plugins": [] }',
      ...modFiles('alpha', '/w/one/mods'),
      ['/w/two/.claude-plugin/marketplace.json']: '{ "plugins": [] }',
      ...modFiles('beta', '/w/two/mods'),
    }
    const { seen, clock } = world(on, disk)
    // Watches Mod Lab's writes on their way to the kit's state, which answers beneath.
    const writes: { key: string; value: unknown }[] = []
    on('state.set', ($, e, next) => {
      const { plugin, key, value } = e as unknown as { plugin: string; key: string; value: unknown }
      if (plugin === 'mod-builder') writes.push({ key, value })
      return next(e)
    })
    seen.cwd = '/w/one/plugins/x'
    await start($)
    await clock.advance(10)
    seen.cwd = '/w/two/plugins/x'
    await command($, 'beta')
    await clock.advance(10)
    const carryingMods = writes.filter(({ value }) => Array.isArray(value) ? value.some(one => (one as { lights?: unknown }).lights) : Array.isArray((value as { views?: unknown } | null)?.views))
    expect(carryingMods.length).toBeGreaterThan(1)
    const expected: Record<string, string[]> = { '/w/one/mods': ['alpha'], '/w/two/mods': ['beta'] }
    for (const { value } of carryingMods) {
      const verdict = value as { modsDir?: unknown; views?: { name: string }[] }
      expect(typeof verdict.modsDir).toBe('string')
      expect((verdict.views ?? []).map(view => view.name)).toEqual(expected[verdict.modsDir as string] ?? ['?'])
    }
  })
})

describe('edit: Spec running after a /cd, while another hook\'s scan of the new folder is listing (#79)', () => {
  // Two folders with a mod named alpha: in ONE it has no SPEC yet; in TWO it is built and passed
  // Validate and Test in an earlier session (files at 1000, results stamped 5000).
  const ONE = '/w/one'
  const TWO = '/w/two'
  const ok = (kind: string) => ({ kind, ok: true, stampMs: 5000, atMs: 5000, durationMs: 100, summary: 'ok', errors: [] })
  const seed = { [`modlab:results:${TWO}/mods`]: { alpha: { Validate: ok('Validate'), Test: ok('Test') } } }
  const unspecced = (folder: string): Disk => {
    const files = { ...modFiles('alpha', `${folder}/mods`) }
    delete files[`${folder}/mods/alpha/SPEC.md`]
    return files
  }
  const disk = (): Disk => ({
    ...unspecced(ONE),
    [`${ONE}/.claude-plugin/marketplace.json`]: JSON.stringify({ plugins: [] }),
    ...modFiles('alpha', `${TWO}/mods`),
    [`${TWO}/mods/alpha/README.md`]: '# Alpha\n\n## What it reaches\n',
    [`${TWO}/.claude-plugin/marketplace.json`]: JSON.stringify({ plugins: [{ name: 'alpha', source: './mods/alpha', version: '0.1.0' }] }),
  })
  const reportSpec = ($: Engine, status: string) =>
    $.tool.call({ tool: 'mcp__mod-builder__lab_report', mod: 'alpha', stage: 'Spec', status } as never)

  test('control: with no scan under way, the report scans the new folder itself and the edit is tracked', async ($, on) => {
    const w = world(on, disk(), {}, true, undefined, { ms: 1000 }, undefined, undefined, seed)
    w.seen.cwd = `${ONE}/plugins/x`
    await start($)
    await w.clock.advance(10)
    w.seen.cwd = `${TWO}/plugins/x`
    await reportSpec($, 'running')
    await w.clock.advance(1000)
    await reportSpec($, 'passed')
    await w.clock.advance(10)
    const ui = await mountPane($)
    expect(await ui.find({ type: 'Text', text: /^edit · update Spec for this change$/ })).toBeDefined()
  })

  test('the edit is tracked when the report joins a scan of the new folder that another hook started', async ($, on) => {
    const w = world(on, disk(), {}, true, undefined, { ms: 1000 }, undefined, undefined, seed)
    w.seen.cwd = `${ONE}/plugins/x`
    await start($)
    await w.clock.advance(10)
    // A /cd to TWO; the end of a turn starts a scan (its own hook), which waits at TWO's mods folder.
    w.seen.cwd = `${TWO}/plugins/x`
    let release = () => {}
    w.seen.holdList = { path: `${TWO}/mods`, until: new Promise<void>(resolve => (release = resolve)), isReached: false }
    await $.turn.complete({ answer: 'moved' } as never)
    await w.clock.advance(10)
    expect(w.seen.holdList.isReached).toBe(true)

    // Spec running arrives meanwhile; alpha is a name the last finished scan (ONE's) also listed.
    const reporting = reportSpec($, 'running')
    await w.clock.advance(10)
    release()
    await reporting
    await w.clock.advance(1000)
    await reportSpec($, 'passed')
    await w.clock.advance(10)
    const ui = await mountPane($)
    expect(await ui.find({ type: 'Text', text: /^edit · update Spec for this change$/ })).toBeDefined()
  })
})

describe('a repeated Spec running during an edit (#12)', () => {
  const T0 = Date.parse('2026-10-12T10:00:00Z')
  const manifest = (v: string) => `{ "name": "git-branch", "version": "${v}", "description": "The git-branch mod." }`
  const market = (v: string) => JSON.stringify({ plugins: [{ name: 'git-branch', source: './mods/git-branch', version: v }] })
  const report = ($: Engine, status: string, note?: string) =>
    $.tool.call({ tool: 'mcp__mod-builder__lab_report', mod: 'git-branch', stage: 'Spec', status, ...(note ? { note } : {}) } as never)

  /**
   * A green git-branch is edited, and the Spec report is sent a second time after the file saves
   * (and the bump, when `bump` is set: 0.1.0 to 0.2.0, listed) and before the turn that redoes
   * Validate and Test.
   */
  async function scenario($: Engine, on: On, bump: boolean) {
    const mtime = { ms: 1000 }
    const disk: Disk = {
      ...modFiles('git-branch'),
      [`${MODS}/git-branch/README.md`]: '# Git branch\n\n## What it reaches\n',
      '/m/.claude-plugin/marketplace.json': market('0.1.0'),
    }
    const { clock } = world(on, disk, { validate: { exitCode: 0, stdout: validateClean }, test: { exitCode: 0, stdout: testPass } }, true, undefined, mtime)
    let t = T0
    const adv = async (ms: number) => { t += ms; await clock.advance(ms) }
    await start($)
    await adv(10)
    let ui = await mountPane($)
    await ui.press({ key: 'validate' })
    await adv(500)
    await ui.press({ key: 'test' })
    await adv(500)
    await ui.unmount()
    await adv(5000)
    await report($, 'running', 'editing: x')
    await adv(10)
    await report($, 'passed')
    // the edit: files saved after it began, and the version bumped and listed
    if (bump) {
      disk[`${MODS}/git-branch/.claude-plugin/plugin.json`] = manifest('0.2.0')
      disk['/m/.claude-plugin/marketplace.json'] = market('0.2.0')
    }
    mtime.ms = t + 100
    await adv(200)
    await report($, 'running', 'editing: x (retry)')
    await adv(10)
    await report($, 'passed')
    await adv(10)
    await $.turn.complete({ answer: 'one' } as never)
    await adv(3000)
    ui = await mountPane($)
    const row = (await ui.find({ key: 'row-git-branch' }))?.text
    await ui.unmount()
    return { row }
  }

  test('a second Spec running after the bump keeps the original baseline version', OPTIONS, async ($, on) => {
    const r = await scenario($, on, true)
    expect(r.row).toMatch(/ ready to share$/)
  })

  test('a second Spec running keeps the edit start time: SPEC.md saved after the first report is not stale', OPTIONS, async ($, on) => {
    // No bump, so the one thing left for the edit is Share. The Spec stage is what the second report would break.
    const r = await scenario($, on, false)
    expect(r.row).toMatch(/ edit · bump the version and re-list it$/)
  })
})

describe('a build names its folder, and the session keeps it (#92)', () => {
  const MAIN = '/w/main'
  const WT = '/w/main/scratch/wt'
  const OTHER = '/w/other'
  const marketplaceAt = (folder: string): Disk => ({ [`${folder}/.claude-plugin/marketplace.json`]: '{ "plugins": [] }' })
  // alpha in the main checkout, beta in a worktree under it, gamma in a third marketplace.
  const disk = (): Disk => ({
    ...marketplaceAt(MAIN),
    ...modFiles('alpha', `${MAIN}/mods`),
    ...marketplaceAt(WT),
    ...modFiles('beta', `${WT}/mods`),
    ...marketplaceAt(OTHER),
    ...modFiles('gamma', `${OTHER}/mods`),
  })
  const report = ($: Engine, args: Record<string, unknown>) => $.tool.call({ tool: 'mcp__mod-builder__lab_report', ...args } as never)
  const listed = async ($: Engine) => {
    const ui = await mountPane($)
    const names = []
    for (const name of ['alpha', 'beta', 'gamma']) if (await ui.find({ type: 'Text', text: new RegExp(name) })) names.push(name)
    return { ui, names }
  }

  test('a report with path lists that folder with the report running, and Validate runs there', async ($, on) => {
    const { seen, clock } = world(on, disk(), { validate: { exitCode: 0, stdout: validateClean } })
    seen.cwd = MAIN
    await start($)
    await clock.advance(10)
    await report($, { mod: 'beta', stage: 'Logic', status: 'running', note: 'writing beta', path: `${WT}/mods/beta` })
    await clock.advance(10)
    const { ui, names } = await listed($)
    expect(names).toEqual(['beta'])
    expect(await ui.find({ type: 'Text', text: /writing beta/ })).toBeDefined()
    await ui.press({ key: 'validate' })
    await clock.advance(1000)
    expect(seen.argv).toContainEqual(['claude', 'plugin', 'validate', '--json', `${WT}/mods/beta`])
  })

  test('after a pin, a Bash cd to another marketplace and a report without path stay on the pinned folder', async ($, on) => {
    const { seen, clock } = world(on, disk())
    seen.cwd = MAIN
    seen.root = MAIN
    await start($)
    await report($, { mod: 'beta', stage: 'Logic', status: 'running', path: `${WT}/mods/beta` })
    seen.cwd = OTHER
    await report($, { mod: 'beta', stage: 'Register', status: 'running', note: 'wiring beta' })
    await command($, 'beta')
    await clock.advance(10)
    const { ui, names } = await listed($)
    expect(names).toEqual(['beta'])
    expect(await ui.find({ type: 'Text', text: /wiring beta/ })).toBeDefined()
  })

  test('a new root drops the pin, and the next scan follows the walk', async ($, on) => {
    const { seen, clock } = world(on, disk())
    seen.cwd = MAIN
    await start($)
    await report($, { mod: 'beta', stage: 'Logic', status: 'running', path: `${WT}/mods/beta` })
    await clock.advance(10)
    const before = await listed($)
    expect(before.names).toEqual(['beta'])
    await before.ui.unmount()
    // A /cd: the root moves with the working directory.
    seen.cwd = OTHER
    await command($, 'gamma')
    await clock.advance(10)
    expect((await listed($)).names).toEqual(['gamma'])
  })

  test('a root that cannot be read keeps the pin across a cwd move', async ($, on) => {
    const { seen, clock } = world(on, disk())
    seen.cwd = MAIN
    seen.root = null
    await start($)
    await report($, { mod: 'beta', stage: 'Logic', status: 'running', path: `${WT}/mods/beta` })
    seen.cwd = OTHER
    await command($, 'beta')
    await clock.advance(10)
    expect((await listed($)).names).toEqual(['beta'])
  })

  test('with no pin, a Bash cd into a worktree leaves the pane on the root\'s mods', async ($, on) => {
    const { seen, clock } = world(on, disk())
    seen.cwd = MAIN
    seen.root = MAIN
    await start($)
    await clock.advance(10)
    seen.cwd = WT
    await command($, 'alpha')
    await clock.advance(10)
    expect((await listed($)).names).toEqual(['alpha'])
  })

  test('a pin a fresh module finds at session start is kept, as after a reload', async ($, on) => {
    const { seen, clock } = world(on, disk())
    seen.cwd = MAIN
    const restored: Record<string, unknown> = { pinned: { modsDir: `${WT}/mods`, root: MAIN } }
    on('state.get', async (_, e, next) => {
      const { plugin, key } = e as unknown as { plugin: string; key: string }
      if (plugin === 'mod-builder' && key in restored) return { value: { version: 1, value: restored[key] } } as never
      return next(e)
    })
    await start($)
    await clock.advance(10)
    expect((await listed($)).names).toEqual(['beta'])
  })

  test('guard: with no pin, a /cd still moves the pane', async ($, on) => {
    const { seen, clock } = world(on, disk())
    seen.cwd = MAIN
    await start($)
    await clock.advance(10)
    seen.cwd = WT
    await command($, 'beta')
    await clock.advance(10)
    expect((await listed($)).names).toEqual(['beta'])
  })

  test('guard: a root that cannot be read leaves the walk on the working directory', async ($, on) => {
    const { seen, clock } = world(on, disk())
    seen.cwd = WT
    seen.root = null
    await start($)
    await clock.advance(10)
    expect((await listed($)).names).toEqual(['beta'])
  })
})

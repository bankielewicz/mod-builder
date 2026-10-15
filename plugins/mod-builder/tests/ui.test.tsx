import { describe, expect, mock, test, type Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { resultOf, signatureOf } from '../hooks/mod-builder-logic'

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
    failReads: [] as string[],
    /** Every path `$.fs.exists` was asked about. */
    probed: [] as string[],
    denySet: '',
    /** A store key whose writes are refused. */
    denyStoreSet: '',
    /** Arm mid-test: the next fs.list of `path` waits for `until`, once, and sets `isReached`. */
    holdList: null as { path: string; until: Promise<void>; isReached: boolean } | null,
  }
  const clock = mock.clock(on, { now: Date.parse('2026-10-12T10:00:00Z') })
  // The store in memory, as mock.store keeps it (values read back as JSON), with writes that can be refused.
  const stored = new Map<string, string>(Object.entries(seeded).map(([key, value]) => [key, JSON.stringify(value)]))
  on('store.get', ($, e) => {
    const text = stored.get((e as { key: string }).key)
    return { value: text === undefined ? undefined : JSON.parse(text) } as never
  })
  on('store.set', ($, e) => {
    const { key, value } = e as { key: string; value: unknown }
    if (seen.denyStoreSet === key) return { deny: 'EIO: store write failed' }
    stored.set(key, JSON.stringify(value))
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
  on('session.id', () => (seen.sessionId ? ({ value: seen.sessionId } as never) : { deny: 'no session id' }))
  on('session.end', ($, e) => ({ sessionId: (e as { sessionId: string }).sessionId }) as never)
  // Owners as seen live: the plugin name plus its install source.
  const rows = configRows ?? ['modsDir', 'autoOpen', 'autoRerun', 'logging'].map(f => ({ key: `mod-builder.${f}`, plugin: 'mod-builder@claudemod' }))
  on('config.list', () => ({ value: rows.map(r => ({ key: r.key, label: r.key, kind: 'text', value: '', provider: { plugin: r.plugin }, isLocked: false })) }) as never)
  on('config.set', ($, e) => seen.denySet ? { deny: seen.denySet } : (seen.sets.push({ key: (e as { key: string }).key, value: (e as { value: unknown }).value }), { value: (e as { value: unknown }).value }) as never)
  // Tests run to the end through process.run: the kit has no stub for the
  // streaming process.spawn, so Mod Lab's fallback answers instead.
  on('process.run', async ($, e) => {
    seen.argv.push([...e.argv])
    if (hold) await hold
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
    expect(listed).toContain('logging    normal')
    expect(listed).toContain('modsDir    /m/mods')
    expect(listed).toMatch(/Log file: \/home\/u\/\.claude\/mod-builder-data\/logs\/\d{4}-\d{2}-\d{2}-s1-sessi\.log/)
    const changed = (await run('config logging verbose')).text ?? ''
    expect(changed).toStartWith('logging is now verbose.')
    expect(changed).toContain('logging    verbose')
    expect(seen.sets).toEqual([{ key: 'mod-builder.logging', value: 'verbose' }])
    expect((await run('config logging loud')).text).toBe('logging must be one of off · normal · verbose · debug.')
    // The change line reaches the file before the set, which reloads the plugin.
    expect(lastLog(seen)).toContain('NORMAL  config  logging changing  {"value":"verbose"}')
    expect((await run('help')).text).toBe('Usage: /mod-builder config [list] · /mod-builder config <option> <value>')
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
    expect(listed).toContain('modsDir    default (…/wt/mods)')
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

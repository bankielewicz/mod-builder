// What the driving session's review of step 2 asked of the pane (SPEC.md 8.22), through the hooks module: the
// result beside Verify's test and typecheck rows, the mod's own name in the load's rows before the gate has run,
// a write refused at Done counted and shown, and what `/mod-builder stop` stopped kept in view until the session
// opens another build or edit, the session staying unbound.
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { BUILT, GATE, HOME, MOD, NAME, ROOT, TYPES, TYPES_TEXT, failing, passing, world } from './world'
import type { World } from './world'

const DOT = String.fromCharCode(0xb7)
const RULE = String.fromCharCode(0x2500)
const BUILD = { skill: 'build', text: 'the eight phases', source: 'plugin', pluginName: 'mod-builder', frontmatter: {} } as const
const EDIT = { skill: 'edit', text: 'the phases of an edit', source: 'plugin', pluginName: 'mod-builder', frontmatter: {} } as const
const LATEST = `${HOME}/.claude/mod-builder-data/v2/docs/latest`
const SPEC = `${MOD}/SPEC.md`
const SPEC_TEXT = '# turn-counter\n'
const MANIFEST = `${MOD}/.claude-plugin/plugin.json`
const LOADED = `[DEBUG] hooks module ${NAME}@inline loaded (worker, environment 1, tier user); events: session.start\n`
// The world's clock stands at 1000 ms: the stamp of one second past the start of 1970.
const RESTORE = `${HOME}/.claude/mod-builder-data/v2/restore/s1/1970-01-01T000001Z`
const STOPPED = `${MOD}.stopped-1970-01-01T000001Z`
const KEEP = 'Keep the mod as it is now'
const PUT_BACK = 'Put it back as it was before this edit'
const OTHER = '/work/other-plugin'
const KEY = `build:${MOD}`
const REFUSALS = `refusals:${MOD}`
const CHECKS = `checks:${MOD}`
const LAST = 'stopped:s1'
const PANE = {
  plugin: 'mod-builder', component: 'Pane', requestId: 'mod-builder', surface: 'terminal',
  props: { title: 'mod-builder', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const
const FOUR_PASS = { validate: { exitCode: 0, stdout: 'Validation passed' }, test: { exitCode: 0, stdout: passing(2) }, tsc: { exitCode: 0, stdout: '' }, '--plugin-dir': { exitCode: 0, stdout: '' } } as const

const sha256 = async (text: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
const record = (phase: string, more: Record<string, unknown> = {}) => ({
  modDir: MOD, sessionId: 's1', phase, specApprovedAt: null, spec: null, testsAtScaffold: null, namesAtScaffold: null, testsAtRed: null, testHashes: null, evidence: {}, ...more,
})
// A mod's folder, a session bound to it, and a record at the phase named; at Green and Verify, as the gates
// before would have left it.
const standing = async (on: Parameters<typeof world>[0], phase: string, more: Partial<World> = {}) => {
  const kept = record(phase, {
    specApprovedAt: 1, spec: { length: SPEC_TEXT.length, hash: await sha256(SPEC_TEXT) }, testsAtScaffold: 0, namesAtScaffold: [], testsAtRed: 2,
    testHashes: { 'tests/pane.test.tsx': await sha256(btoa('the first test')) }, evidence: { knowledge: 'snapshot 2026-11-10T151216Z' },
  })
  return world(on, {
    runs: { ...FOUR_PASS, restore: { exitCode: 0, stdout: '' }, putback: { exitCode: 0, stdout: `put back: ${MOD}\nkept: ${STOPPED}\nmoved: .git, node_modules\n` } },
    ...more,
    files: {
      [LATEST]: '2026-11-10T151216Z\n', [SPEC]: phase === 'verify' || phase === 'done' ? `${SPEC_TEXT}${BUILT}` : SPEC_TEXT, [MANIFEST]: `{ "name": "${NAME}", "version": "0.1.0" }`,
      [`${MOD}/hooks/hooks.json`]: '{ "modules": ["./register.tsx"] }', [`${MOD}/hooks/register.tsx`]: 'the code', [`${MOD}/tests/pane.test.tsx`]: 'the first test',
      [`${OTHER}/.claude-plugin/plugin.json`]: '{ "name": "other" }', 'the load log': LOADED, [TYPES]: TYPES_TEXT, ...more.files,
    },
    store: { 'session:s1': { modDir: MOD }, [KEY]: kept, ...more.store },
  })
}
const gate = async ($: Engine, more: Record<string, unknown> = {}) => String((await $.tool.call({ tool: GATE, ...more } as never)).result)
const said = async ($: Engine, args: string) => (await $.command.run({ command: 'mod-builder', args } as never)).text
const write = async ($: Engine, path: string) => (await $.tool.call({ tool: 'Write', file_path: path, content: 'x' } as never)) as { deny?: string }
const kept = (w: World) => w.store[KEY] as Record<string, unknown> & { phase: string }
const results = (w: World) => (w.store[CHECKS] as { results: Record<string, string> }).results
const drawn = async ($: Engine) => {
  const ui = await $.ui.mount(PANE)
  const all = (await ui.findAll({ type: 'Text' })).map((one) => ({ text: one.text, props: one.props as Record<string, unknown> }))
  await ui.unmount()
  const texts = all.map((one) => one.text)
  return { texts, header: all[1], rail: all.slice(2, texts.findIndex((text) => text.startsWith(RULE))), after: (text: string, count: number) => texts.slice(texts.indexOf(text) + 1, texts.indexOf(text) + 1 + count), of: (text: string) => all.find((one) => one.text === text) }
}
// An edit opened on the mod and taken to Describe.
const editing = async ($: Engine, w: World) => {
  delete w.store['session:s1']
  delete w.store[KEY]
  await $.skill.prompt(EDIT)
  await gate($, { mod_dir: 'turn-counter' })
  await gate($)
}

// ------------------------------------------------------------------------------------------- Verify's rows

test('Verify: the test row says how many passed of how many ran, and the typecheck row its errors, once each has ended', async ($, on) => {
  const w = await standing(on, 'verify')
  const seen: string[] = []
  w.whileRunning = (argv) => {
    if (argv.at(-1) === '-v' || argv[0] === 'id') return
    seen.push(JSON.stringify((w.store[CHECKS] as { results: unknown }).results))
  }
  expect(await gate($)).toMatch(/^mod-builder: phase 7 \(Verify\) passed /)
  expect(seen).toEqual(['{}', '{}', '{"test":"2 of 2"}', '{"test":"2 of 2","typecheck":"0 errors"}'])
  expect(results(w)).toEqual({ test: '2 of 2', typecheck: '0 errors' })
})

test('Verify: a failing run and a failing typecheck say what they showed beside their rows, and the pane draws it', async ($, on) => {
  const w = await standing(on, 'verify', { runs: { ...FOUR_PASS, test: { exitCode: 1, stdout: failing(['a'], ['b']) }, tsc: { exitCode: 2, stdout: 'hooks/register.tsx(1,1): error TS1005: x\nhooks/register.tsx(2,1): error TS1005: y\n' } } })
  expect(await gate($)).toMatch(/^mod-builder: still at phase 7 \(Verify\)/)
  expect(results(w)).toEqual({ test: '1 of 2', typecheck: '2 errors' })
  const pane = await drawn($)
  expect(pane.after('Each check is a command mod-builder ran itself', 11)).toEqual([
    '  passed', 'validate', `claude plugin validate --strict ${MOD}`, '  failed', 'test', `claude plugin test ${MOD}`, '1 of 2', '  failed', 'typecheck', 'tsc against the 2.1.322 types', '2 errors',
  ])
  expect(pane.of('1 of 2')?.props).toEqual({ dimColor: true, wrap: 'truncate-end' })
})

test('Verify: a compiler that printed its errors to standard error is counted there, and one that never ran has no result', async ($, on) => {
  const w = await standing(on, 'verify', { runs: { ...FOUR_PASS, tsc: { exitCode: 2, stdout: '', stderr: 'hooks/register.tsx(1,1): error TS1005: x\n' } } })
  await gate($)
  expect(results(w)).toEqual({ test: '2 of 2', typecheck: '1 error' })
  w.runs.tsc = 'never starts'
  await gate($)
  expect(results(w)).toEqual({ test: '2 of 2' })
  // A compiler that failed and printed no error line showed no count.
  w.runs.tsc = { exitCode: 127, stdout: 'npx: command not found\n' }
  await gate($)
  expect(results(w)).toEqual({ test: '2 of 2' })
})

test('Verify: the load\'s rows name the mod from its manifest before the gate has run, and "the mod" when the manifest can\'t be read', async ($, on) => {
  const w = await standing(on, 'verify')
  expect((await drawn($)).after('Headless load: what the debug log must show', 2)).toEqual(['  waiting', `hooks module ${NAME}@inline loaded`])
  for (const manifest of ['not json', '{ "name": 7 }', '{}']) {
    w.files[MANIFEST] = manifest
    expect((await drawn($)).after('Headless load: what the debug log must show', 2)).toEqual(['  waiting', 'hooks module the mod@inline loaded'])
  }
  delete w.files[MANIFEST]
  expect((await drawn($)).after('Headless load: what the debug log must show', 2)).toEqual(['  waiting', 'hooks module the mod@inline loaded'])
})

// --------------------------------------------------------------------------------------- a refusal at Done

test('a write refused at Done is counted and toasted, and Done\'s frame says so in what was checked; its header and cleared status line stay', async ($, on) => {
  const w = await standing(on, 'done', { store: { [REFUSALS]: { sessionId: 's1', counts: { spec: 1 }, last: { phase: 'spec', path: 'hooks/a.ts' }, toasted: ['spec'] } } })
  expect((await write($, `${MOD}/hooks/register.tsx`)).deny).toMatch(/can't be written in phase 8 \(Done\)/)
  expect(w.store[REFUSALS]).toEqual({ sessionId: 's1', counts: { spec: 1, done: 1 }, last: { phase: 'done', path: 'hooks/register.tsx' }, toasted: ['spec', 'done'] })
  expect(w.toasts).toEqual(['refused: hooks/register.tsx, at Done'])
  expect(w.statuses.at(-1) === undefined).toBe(true)
  const pane = await drawn($)
  expect(pane.header?.text).toBe(`turn-counter ${DOT} built and checked`)
  expect(pane.after('What was checked', 2)).toEqual(['  validate, the tests, the typecheck and a headless load', '  2 edits refused along the way, at Spec, Done'])
  expect(pane.texts).toContain(`What each phase may write, under ${MOD}/`)
})

// -------------------------------------------------------------------------------- what was stopped stays in view

test('a stopped build stays in the pane: the header says stopped, the rail is dim, and the session is bound to nothing', async ($, on) => {
  const w = await standing(on, 'green')
  w.store[KEY] = { ...kept(w), evidence: { scaffold: 'validated' } }
  await said($, 'stop')
  expect(w.store[LAST]).toBe(MOD)
  expect(w.store['session:s1']).toBe(null)
  const pane = await drawn($)
  expect(pane.header).toEqual({ text: `turn-counter ${DOT} stopped at Green`, props: { color: 'warning', wrap: 'truncate-end' } })
  expect(pane.rail.length).toBe(8)
  expect(pane.rail.every((one) => one.props.dimColor === true)).toBe(true)
  expect(pane.after('Stopped', 2)).toEqual(['  the folder is left as it is', MOD])
  expect(pane.texts.slice(-3)).toEqual(['4 Scaffold', 'passed', '  validated'])
  expect(w.statuses.at(-1) === undefined).toBe(true)
  // Unbound for the guard and the gate, as before: another plugin's folder and the mod's own are written again.
  expect((await write($, `${OTHER}/hooks/x.ts`)).deny).toBe(undefined)
  expect((await write($, `${MOD}/tests/a.test.ts`)).deny).toBe(undefined)
  expect(await gate($)).toMatch(/^mod-builder: no build is open in this session\./)
  expect(await said($, '')).toMatch(new RegExp(`^mod-builder: turn-counter ${DOT} stopped at Green\\. Docs: `))
})

test('what was stopped leaves the pane when the session opens another build or edit', async ($, on) => {
  const w = await standing(on, 'green')
  await said($, 'stop')
  await $.skill.prompt(BUILD)
  expect(w.store[LAST]).toBe(null)
  expect((await drawn($)).header?.text).toBe(`a new mod ${DOT} its folder is not named yet`)
  await said($, 'stop')
  expect(w.store[LAST]).toBe(null)
  expect((await drawn($)).header?.text).toBe('no build or edit in this session')
  w.store[LAST] = MOD
  await $.skill.prompt(EDIT)
  expect(w.store[LAST]).toBe(null)
  expect((await drawn($)).header?.text).toBe(`an edit ${DOT} its folder is not named yet`)
})

test('a stop that stops no record of this session keeps nothing in view', async ($, on) => {
  const w = await standing(on, 'green')
  w.store[KEY] = { ...kept(w), sessionId: 's2' }
  await said($, 'stop')
  expect(LAST in w.store).toBe(false)
  w.store['session:s1'] = { modDir: MOD }
  w.store[KEY] = { ...kept(w), sessionId: 's1', phase: 'done' }
  await said($, 'stop')
  expect(LAST in w.store).toBe(false)
  expect((await drawn($)).header?.text).toBe('no build or edit in this session')
})

test('another session\'s pane does not show what this one stopped', async ($, on) => {
  const w = await standing(on, 'green')
  await said($, 'stop')
  w.sessionId = 's2'
  expect((await drawn($)).header?.text).toBe('no build or edit in this session')
  w.store['stopped:s2'] = MOD
  expect((await drawn($)).header?.text).toBe('no build or edit in this session')
})

test('a stopped edit kept as it is: the pane says which answer was given, and names the mod and its restore point', async ($, on) => {
  const w = await standing(on, 'green', { answer: KEEP })
  await editing($, w)
  await said($, 'stop')
  expect(kept(w).stop).toEqual({ answer: KEEP, beside: null })
  expect(kept(w).stopped).toBe(true)
  const pane = await drawn($)
  expect(pane.header?.text).toBe(`turn-counter ${DOT} edit of 0.1.0 ${DOT} stopped at Describe`)
  expect(pane.rail.length).toBe(7)
  expect(pane.after('Stopped', 5)).toEqual([`  the person answered "${KEEP}"`, '  the mod, as it is now', MOD, '  its restore point', RESTORE])
})

test('a stopped edit put back: the pane names the mod as before the edit and the folder kept beside it; when nobody answers, it says so', async ($, on) => {
  const w = await standing(on, 'green', { answer: PUT_BACK })
  await editing($, w)
  await said($, 'stop')
  expect(kept(w).stop).toEqual({ answer: PUT_BACK, beside: STOPPED })
  expect((await drawn($)).after('Stopped', 5)).toEqual([`  the person answered "${PUT_BACK}"`, '  the mod, as before the edit', MOD, '  as it was when stopped', STOPPED])
  w.answer = null
  await editing($, w)
  await said($, 'stop')
  expect(kept(w).stop).toEqual({ answer: null, beside: null })
  expect((await drawn($)).after('Stopped', 1)).toEqual(['  nobody answered: the mod is kept as it is now'])
})

test('a mod that could not be put back is not said to be: the pane names no folder beside it', async ($, on) => {
  const w = await standing(on, 'green', { answer: PUT_BACK })
  await editing($, w)
  w.runs.putback = { exitCode: 1, stdout: '', stderr: 'put-back: nothing was changed\n' }
  expect(await said($, 'stop')).toMatch(/It could not be put back/)
  expect(kept(w).stop).toEqual({ answer: PUT_BACK, beside: null })
  expect((await drawn($)).after('Stopped', 3)).toEqual([`  the person answered "${PUT_BACK}"`, '  the mod, as it is now', MOD])
})

test('putting a mod back says its git history is as it is now only when its .git was moved back', async ($, on) => {
  const w = await standing(on, 'green', { answer: PUT_BACK })
  await editing($, w)
  const history = " The mod's git history is as it is now, commits made during the edit included: git shows the restored files as changes against them."
  expect(String(await said($, 'stop')).endsWith(`Moved into the restored mod: .git, node_modules. Nothing was deleted.${history}`)).toBe(true)
  for (const moved of ['node_modules', 'nothing', '.github']) {
    w.runs.putback = { exitCode: 0, stdout: `put back: ${MOD}\nkept: ${STOPPED}\nmoved: ${moved}\n` }
    await editing($, w)
    expect(String(await said($, 'stop')).endsWith('Nothing was deleted.')).toBe(true)
  }
  expect(w.ran.some((argv) => argv[1] === `${ROOT}/scripts/put-back.sh`)).toBe(true)
})

// ------------------------------------------------------------------------------------------------- hashes

test('the pane shows a types hash by its first 12 characters and two types files as their count; the record keeps them whole', async ($, on) => {
  const one = '961c15e9ad38505611e6ab25090b7e935f949a2887922a177e6bd53fccd8c950'
  const two = 'a33c3b254b7c9df7fc777fa7be9c889688a5f1ae787ae516f22ab39ca3727d76'
  const w = await standing(on, 'green')
  const evidence = { scaffold: `2 tests ran; the typecheck passes (types sha256 ${one})`, red: `3 tests ran; the typecheck passes (types sha256 ${one}, ${two})` }
  w.store[KEY] = { ...kept(w), evidence }
  const pane = await drawn($)
  expect(pane.after('4 Scaffold', 3)).toEqual(['passed', '  2 tests ran', '  the typecheck passes (types sha256 961c15e9ad38)'])
  expect(pane.after('5 Red', 3)).toEqual(['passed', '  3 tests ran', '  the typecheck passes (2 types files)'])
  expect(kept(w).evidence).toEqual(evidence)
})

test('while the person is still being asked what becomes of a stopped edit, no answer is kept; the answer is written into the record as it is then', async ($, on) => {
  const w = await standing(on, 'green', { answer: KEEP })
  await editing($, w)
  const during: unknown[] = []
  w.whileAsked = () => {
    during.push(kept(w).stopped, 'stop' in kept(w), w.store[LAST])
    w.store[KEY] = { ...kept(w), evidence: { knowledge: 'written meanwhile' } }
  }
  await said($, 'stop')
  expect(during).toEqual([true, false, MOD])
  expect(kept(w).stop).toEqual({ answer: KEEP, beside: null })
  expect((kept(w).evidence as Record<string, string>).knowledge).toBe('written meanwhile')
})

test('an answer that comes after another session made a record in the folder is not written over it', async ($, on) => {
  const w = await standing(on, 'green', { answer: KEEP })
  await editing($, w)
  for (const theirs of [{ ...record('knowledge'), sessionId: 's2' }, { ...record('spec'), sessionId: 's2', stopped: true }, record('knowledge')]) {
    await editing($, w)
    w.whileAsked = () => {
      w.store[KEY] = theirs
    }
    await said($, 'stop')
    expect(w.store[KEY]).toEqual(theirs)
  }
})

test('a refused gate\'s reason is drawn with its hashes cut, and kept whole in the record and in the gate\'s answer', async ($, on) => {
  const w = await standing(on, 'verify', { files: { [SPEC]: SPEC_TEXT } })
  const whole = await sha256(TYPES_TEXT)
  expect(await gate($)).toMatch(new RegExp(`does not hold the sha256 of the types this gate checks against \\(expected: ${whole}\\)`))
  expect((kept(w).attempt as { reason: string }).reason.endsWith(`(expected: ${whole})`)).toBe(true)
  expect((await drawn($)).texts.at(-1)).toBe(`  not passed: the "Built" block of SPEC.md does not hold the sha256 of the types this gate checks against (expected: ${whole.slice(0, 12)})`)
})

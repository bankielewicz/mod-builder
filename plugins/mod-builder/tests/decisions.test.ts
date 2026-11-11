// SPEC.md 7.7, through the hooks module itself. Decision 1: Green's gate runs every check Verify runs (validate,
// the tests, the typecheck, a headless load), Verify runs them again, and a failed typecheck or load is answered
// with the last 20 lines of what the command said. Decision 2: every file that names itself the build's types must
// agree to the byte, or the gate refuses and names each; the sha256 of the types used is in the gate's evidence.
// And the owner's finding of the same day: a load whose log says a hook of the mod was skipped is no load.
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { BUILT, GATE, HOME, MOD, NAME, TYPES, TYPES_FOLDER, TYPES_SHA, TYPES_TEXT, world } from './world'
import type { World } from './world'

const SPEC = `${MOD}/SPEC.md`
const TEST_FILE = `${MOD}/tests/pane.test.tsx`
const CONFIG = `${HOME}/.claude/mod-builder-data/v2/typecheck/s1/tsconfig.json`
const LOG = `${HOME}/.claude/mod-builder-data/v2/loads/s1.log`
const LOADED = `[DEBUG] hooks module ${NAME}@inline loaded (worker, environment 1, tier user); events: session.start\n`
const OTHER = `${TYPES_FOLDER}/0000/plugin-authoring/types/claude-code.d.ts`
const PANE = {
  plugin: 'mod-builder', component: 'Pane', requestId: 'mod-builder',
  props: { title: 'mod-builder', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const
const FOUR = [
  ['claude', 'plugin', 'validate', '--strict', MOD],
  ['claude', 'plugin', 'test', MOD],
  ['npx', '--no-install', 'tsc', '--noEmit', '--pretty', 'false', '-p', CONFIG],
  ['claude', '--plugin-dir', MOD, '-p', '/cost', '--debug-file', LOG],
]

const sha256 = async (text: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

// A world whose build stands at the phase named, as the gates before it would have left it.
const standing = async (on: Parameters<typeof world>[0], at: 'green' | 'verify', more: Partial<World> = {}) => {
  const spec = '# turn-counter\n'
  const w = world(on, {
    ...more,
    files: {
      [SPEC]: at === 'verify' ? `${spec}${BUILT}` : spec, [`${MOD}/.claude-plugin/plugin.json`]: `{ "name": "${NAME}" }`, [TEST_FILE]: 'the first test', 'the load log': LOADED,
      [TYPES]: TYPES_TEXT, ...more.files,
    },
  })
  w.store['session:s1'] = { modDir: MOD }
  w.store[`build:${MOD}`] = {
    modDir: MOD, sessionId: 's1', phase: at, specApprovedAt: 1, spec: { length: spec.length, hash: await sha256(spec) }, testsAtScaffold: 0,
    namesAtScaffold: [], testsAtRed: 1, testHashes: { 'tests/pane.test.tsx': await sha256(btoa('the first test')) }, evidence: {},
  }
  return w
}
const gate = async ($: Engine) => String((await $.tool.call({ tool: GATE } as never)).result)
const phase = (w: World) => (w.store[`build:${MOD}`] as { phase: string }).phase
const evidence = (w: World) => (w.store[`build:${MOD}`] as { evidence: Record<string, string> }).evidence
// The commands run, without the compiler being asked for its version.
const checks = (w: World) => w.ran.filter((argv) => argv.at(-1) !== '-v')
const numbered = (count: number) => Array.from({ length: count }, (_, index) => `line ${index + 1}`)

test('Green\'s gate runs validate, the tests, the typecheck and a headless load, in that order, and Verify\'s runs the same four again', async ($, on) => {
  const w = await standing(on, 'green')
  expect(await gate($)).toMatch(/^mod-builder: phase 6 \(Green\) passed /)
  expect(checks(w)).toEqual(FOUR)
  expect(phase(w)).toBe('verify')
  w.ran.length = 0
  w.files[SPEC] = `${w.files[SPEC]}${BUILT}`
  expect(await gate($)).toMatch(/^mod-builder: phase 7 \(Verify\) passed /)
  expect(checks(w)).toEqual(FOUR)
  expect(phase(w)).toBe('done')
})

test('Green stays when validate fails, though every test passes', async ($, on) => {
  const w = await standing(on, 'green')
  w.runs.validate = { exitCode: 1, stdout: 'Validation failed' }
  expect(await gate($)).toBe('mod-builder: still at phase 6 (Green). Not passed: claude plugin validate --strict exited 1.\nThe last lines of its output:\nValidation failed')
  expect(phase(w)).toBe('green')
})

test('Green stays when the typecheck fails, and once the code is fixed the same gate passes: the build never reaches Verify with a type error', async ($, on) => {
  const w = await standing(on, 'green')
  w.runs.tsc = { exitCode: 1, stdout: 'hooks/register.tsx(3,7): error TS2322: no\n' }
  expect(await gate($)).toBe(`mod-builder: still at phase 6 (Green). Not passed: the typecheck exited 1.\nThe last lines of its output, against the types file ${TYPES} (sha256 ${TYPES_SHA}):\nhooks/register.tsx(3,7): error TS2322: no`)
  expect(phase(w)).toBe('green')
  expect((await $.tool.call({ tool: 'Write', file_path: `${MOD}/hooks/register.tsx`, content: 'fixed' })).deny).toBeUndefined()
  w.runs.tsc = { exitCode: 0, stdout: '' }
  expect(await gate($)).toMatch(/^mod-builder: phase 6 \(Green\) passed /)
})

test('Green stays when the headless load fails or its log does not show the mod loaded', async ($, on) => {
  const w = await standing(on, 'green')
  w.runs['--plugin-dir'] = { exitCode: 3, stdout: '', stderr: 'error: unknown option\n' }
  expect(await gate($)).toBe('mod-builder: still at phase 6 (Green). Not passed: the headless load exited 3.\nThe last lines of its output:\nerror: unknown option')
  w.runs['--plugin-dir'] = { exitCode: 0, stdout: '' }
  w.files['the load log'] = `[ERROR] hooks module ${NAME}@inline failed to load: ${NAME}: it does not parse\n[DEBUG] hooks module other@inline loaded\n`
  expect(await gate($)).toBe(`mod-builder: still at phase 6 (Green). Not passed: the headless load's debug log does not show the mod loaded and admitted.\nThe last lines of its output:\n[ERROR] hooks module ${NAME}@inline failed to load: ${NAME}: it does not parse`)
  expect(phase(w)).toBe('green')
})

test('a failed typecheck is answered with the last 20 lines of what the compiler printed, and no more', async ($, on) => {
  const w = await standing(on, 'green')
  w.runs.tsc = { exitCode: 2, stdout: `${numbered(25).join('\n')}\n\n`, stderr: 'npm notice\n' }
  const answer = await gate($)
  expect(answer.split('\n')).toEqual(['mod-builder: still at phase 6 (Green). Not passed: the typecheck exited 2.', `The last lines of its output, against the types file ${TYPES} (sha256 ${TYPES_SHA}):`, ...numbered(25).slice(5)])
  w.runs.tsc = { exitCode: 2, stdout: 'one\ntwo\n' }
  expect((await gate($)).split('\n').slice(2)).toEqual(['one', 'two'])
})

test('a compiler that printed nothing is quoted from what it wrote to standard error; with nothing there either, nothing is quoted', async ($, on) => {
  const w = await standing(on, 'verify')
  w.runs.tsc = { exitCode: 1, stdout: '', stderr: 'tsc: out of memory\n' }
  expect(await gate($)).toBe(`mod-builder: still at phase 7 (Verify). Not passed: the typecheck exited 1.\nThe last lines of its output, against the types file ${TYPES} (sha256 ${TYPES_SHA}):\ntsc: out of memory`)
  w.runs.tsc = { exitCode: 1, stdout: '' }
  expect(await gate($)).toBe(`mod-builder: still at phase 7 (Verify). Not passed: the typecheck exited 1.\nIt printed nothing. It ran against the types file ${TYPES} (sha256 ${TYPES_SHA}).`)
})

for (const at of ['green', 'verify'] as const) {
  test(`a load whose log says a hook of the mod was skipped is no load at ${at}, and the answer quotes the line`, async ($, on) => {
    const skipped = `2026-11-10T21:11:41.330Z [ERROR] ${NAME}: session.start hook skipped: threw ${NAME}: $.command.register: "/clear" refused: it is the built-in /clear`
    const w = await standing(on, at)
    w.files['the load log'] = `${LOADED}${skipped}\n[DEBUG] plugin.register: ${NAME} (user, ${NAME}@inline), judged by core alone: admitted\n`
    expect(await gate($)).toBe(`mod-builder: still at ${at === 'green' ? 'phase 6 (Green)' : 'phase 7 (Verify)'}. Not passed: the headless load's debug log does not show the mod loaded and admitted.\nThe last lines of its output:\n${skipped}`)
    expect(phase(w)).toBe(at)
    w.files['the load log'] = `${LOADED}[ERROR] another-mod: session.start hook skipped: threw x\n[ERROR] ${NAME}-two: tool.call hook skipped: threw y\n`
    expect(await gate($)).toMatch(/ passed /)
  })
}

test('every skipped-hook line of the mod is quoted, in the log\'s order, and beside what a load that failed said', async ($, on) => {
  const first = `[ERROR] ${NAME}: session.start hook skipped: threw A`
  const second = `[ERROR] ${NAME}: ui.render hook skipped: returned the wrong shape`
  const w = await standing(on, 'verify')
  w.files['the load log'] = `${LOADED}${first}\n[DEBUG] something else\n${second}\n`
  expect((await gate($)).split('\n').slice(1)).toEqual(['The last lines of its output:', first, second])
  w.runs['--plugin-dir'] = { exitCode: 3, stdout: '', stderr: 'boom\n' }
  expect((await gate($)).split('\n')).toEqual(['mod-builder: still at phase 7 (Verify). Not passed: the headless load exited 3.', 'The last lines of its output:', 'boom', first, second])
})

test('a failed load is answered with the last 20 lines of what it printed, and a load that never ended with nothing made up', async ($, on) => {
  const w = await standing(on, 'green')
  w.runs['--plugin-dir'] = { exitCode: 1, stdout: `${numbered(25).join('\n')}\n` }
  expect((await gate($)).split('\n')).toEqual(['mod-builder: still at phase 6 (Green). Not passed: the headless load exited 1.', 'The last lines of its output:', ...numbered(25).slice(5)])
  w.runs['--plugin-dir'] = 'never starts'
  w.files[`${HOME}/.claude/mod-builder-data/v2/loads/s1.log`] = ''
  delete w.files['the load log']
  expect(await gate($)).toBe('mod-builder: still at phase 6 (Green). Not passed: the headless load ended with no exit code.')
})

test('at Done the pane shows the sha256 of the types Verify used', async ($, on) => {
  await standing(on, 'verify')
  await gate($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const texts = (await ui.findAll({ type: 'Text' })).map((text) => text.text)
  await ui.unmount()
  expect(texts.filter((text) => text.startsWith('Verify: '))).toEqual([`Verify: validate, 1 tests, the typecheck (types sha256 ${await sha256(TYPES_TEXT)}) and a headless load of ${NAME} all pass`])
})

test('the hash recorded is of the file\'s bytes, whatever they are, a byte that is no text included', async ($, on) => {
  const w = await standing(on, 'green')
  w.files[TYPES] = `${TYPES_TEXT}\u00ff\n`
  w.files[OTHER] = `${TYPES_TEXT}\u00fe\n`
  delete w.files[OTHER]
  const bytes = Uint8Array.from(`${TYPES_TEXT}\u00ff\n`, (char) => char.charCodeAt(0))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const sha = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  expect(await gate($)).toMatch(new RegExp(`types sha256 ${sha}\\)`))
})

test('the sha256 of the types used is in the evidence of Green and of Verify, as the file\'s own hash', async ($, on) => {
  const w = await standing(on, 'green')
  const sha = await sha256(TYPES_TEXT)
  expect((await gate($)).split('\n')[0]).toBe(`mod-builder: phase 6 (Green) passed (validate, 1 tests, the typecheck (types sha256 ${sha}) and a headless load of ${NAME} all pass; tests/ and SPEC.md are as recorded). The build is now at phase 7 (Verify).`)
  w.files[SPEC] = `${w.files[SPEC]}${BUILT}`
  expect((await gate($)).split('\n')[0]).toBe(`mod-builder: phase 7 (Verify) passed (validate, 1 tests, the typecheck (types sha256 ${sha}) and a headless load of ${NAME} all pass). The build is now at phase 8 (Done).`)
  expect(evidence(w).green).toMatch(new RegExp(`types sha256 ${sha}`))
  expect(evidence(w).verify).toMatch(new RegExp(`types sha256 ${sha}`))
})

test('the pane shows the sha256 of the types the last gate used', async ($, on) => {
  await standing(on, 'green')
  await gate($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const texts = (await ui.findAll({ type: 'Text' })).map((text) => text.text)
  await ui.unmount()
  expect(texts.filter((text) => text.startsWith('Green: '))).toEqual([`Green: validate, 1 tests, the typecheck (types sha256 ${await sha256(TYPES_TEXT)}) and a headless load of ${NAME} all pass; tests/ and SPEC.md are as recorded`])
})

test('types files that are the same to the byte are one, wherever they sort: the gate passes and records their hash', async ($, on) => {
  const w = await standing(on, 'green')
  w.files[OTHER] = TYPES_TEXT
  w.files[`${TYPES_FOLDER}/zzzz/plugin-authoring/types/claude-code.d.ts`] = TYPES_TEXT
  expect(await gate($)).toMatch(new RegExp(`^mod-builder: phase 6 \\(Green\\) passed .*types sha256 ${await sha256(TYPES_TEXT)}`))
})

test('a file that names another version, or holds no types, is no candidate: it neither is used nor makes the candidates differ', async ($, on) => {
  const w = await standing(on, 'green')
  w.files[OTHER] = '// Written by Claude Code 2.1.321.\nexport type Old = 1\n'
  w.files[`${TYPES_FOLDER}/zzzz/plugin-authoring/types/claude-code.d.ts`] = '<html>not types</html>\n'
  expect(await gate($)).toMatch(/^mod-builder: phase 6 \(Green\) passed /)
  expect((JSON.parse(w.files[CONFIG] ?? '{}') as { include: string[] }).include[0]).toBe(TYPES)
})

test('with no types file Green refuses as Verify does: where it looked, and that loading plugin-authoring writes one', async ($, on) => {
  const w = await standing(on, 'green')
  delete w.files[TYPES]
  expect(await gate($)).toBe(`mod-builder: still at phase 6 (Green). Not passed: the types of Claude Code 2.1.322 are not written yet (looked in ${TYPES_FOLDER}): load the plugin-authoring skill with the Skill tool, which writes them, then ask again.`)
  expect(w.ran).toEqual([])
})

test('Green still refuses a changed test before it runs anything, and a test that fails', async ($, on) => {
  const w = await standing(on, 'green')
  w.files[TEST_FILE] = 'weakened'
  expect(await gate($)).toBe('mod-builder: still at phase 6 (Green). Not passed: not as recorded: tests/pane.test.tsx (changed).')
  expect(w.ran).toEqual([])
  w.files[TEST_FILE] = 'the first test'
  w.runs.test = { exitCode: 1, stdout: '\ntests/pane.test.tsx:\n(fail) test 1 [0.40ms]\n  AssertionError: expect(received).toBe()\n\n 0 pass\n 1 fail\nRan 1 tests across 1 file. [0.20s]\n' }
  expect(await gate($)).toMatch(/^mod-builder: still at phase 6 \(Green\)\. Not passed: /)
  expect(phase(w)).toBe('green')
})

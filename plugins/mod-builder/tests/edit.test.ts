// An edit of a finished mod (SPEC.md 8), through the hooks module itself: what opens it, the folder it may name,
// the baseline taken and the restore point made before anything is written, and each phase's gate, the refactor
// route (8.15) and 8.4's question among them.
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { BUILT, GATE, HOME, MOD, NAME, ROOT, TMP, TYPES, TYPES_FOLDER, TYPES_TEXT, failing, passing, world } from './world'
import type { World } from './world'

const EDIT = { skill: 'edit', text: 'the phases of an edit', source: 'plugin', pluginName: 'mod-builder', frontmatter: {} } as const
const LATEST = `${HOME}/.claude/mod-builder-data/v2/docs/latest`
const SPEC = `${MOD}/SPEC.md`
const MANIFEST = `${MOD}/.claude-plugin/plugin.json`
const TEST = `${MOD}/tests/pane.test.tsx`
const CODE = `${MOD}/hooks/register.tsx`
// The world's clock stands at 1000 ms: the stamp of one second past the start of 1970.
const RESTORE = `${HOME}/.claude/mod-builder-data/v2/restore/s1/1970-01-01T000001Z`
const CONFIG = `${HOME}/.claude/mod-builder-data/v2/typecheck/s1/tsconfig.json`
const LOADED = `[DEBUG] hooks module ${NAME}@inline loaded (worker, environment 1, tier user); events: session.start\n`
const OLD_SPEC = '# turn-counter\n\nCounts turns.\n'
const SECTION = '\n## 0.1.1 (2026-11-11)\n\nCuts each row by display width.\n'
const NO_CHANGE = '\n## 0.1.1 (2026-11-11)\n\nNo behaviour change: the rows are built by one helper.\n'
const NAMES = ['draws its line', 'opens the pane']
const ERR_HOOKS = `${MOD}/hooks/register.tsx(3,7): error TS2322: Type 'string' is not assignable to type 'number'.\n`
const ERR_TESTS = `${MOD}/tests/pane.test.tsx(2,9): error TS2307: Cannot find module './missing'.\n`
const GO_ON = 'Go on with these changes'
const APPROVE_NO_CHANGE = 'Approve: no behaviour change'

const gate = async ($: Engine, more: Record<string, unknown> = {}) => String((await $.tool.call({ tool: GATE, ...more } as never)).result)
const first = (answer: string) => answer.split('\n')[0] as string
const kept = (w: World) => w.store[`build:${MOD}`] as Record<string, unknown> & { phase: string; baseline: Record<string, unknown>; evidence: Record<string, string> }
const write = async ($: Engine, path: string) => (await $.tool.call({ tool: 'Write', file_path: path, content: 'x' } as never)) as { deny?: string }
const words = (w: World) => w.ran.map((argv) => (argv.some((one) => one.endsWith('/restore-point.sh')) ? 'restore' : argv.some((one) => one.endsWith('/put-back.sh')) ? 'putback'
  : argv.includes('--noEmit') ? 'typecheck' : argv.at(-1) === '-v' ? 'compiler?' : argv.includes('--plugin-dir') ? 'load' : (argv[2] as string)))

// A finished mod, as an earlier build left it, and a session in which nothing is open yet.
const mod = (on: Parameters<typeof world>[0], more: Partial<World> = {}) =>
  world(on, {
    runs: { validate: { exitCode: 0, stdout: 'Validation passed' }, test: { exitCode: 0, stdout: passing(2, NAMES) }, tsc: { exitCode: 0, stdout: '' }, '--plugin-dir': { exitCode: 0, stdout: '' }, restore: { exitCode: 0, stdout: `restore point: ${RESTORE}\n` }, putback: { exitCode: 0, stdout: '' } },
    ...more,
    files: {
      [LATEST]: '2026-11-10T151216Z\n',
      [SPEC]: OLD_SPEC,
      [MANIFEST]: `{ "name": "${NAME}", "version": "0.1.0" }`,
      [`${MOD}/hooks/hooks.json`]: '{ "modules": ["./register.tsx"] }',
      [CODE]: 'the code',
      [TEST]: 'the first test',
      'the load log': LOADED,
      ...more.files,
    },
  })

// Opens an edit and names the mod: the baseline is taken. The restore point's copy is laid as the script would.
const open = async ($: Engine, w: World) => {
  await $.skill.prompt(EDIT)
  const answer = await gate($, { mod_dir: 'turn-counter' })
  for (const [path, text] of Object.entries(w.files)) if (path.startsWith(`${MOD}/`)) w.files[`${RESTORE}/${path.slice(MOD.length + 1)}`] = text
  return answer
}
// From a named edit to Spec's gate, the change's section written.
const toSpec = async ($: Engine, w: World, section = SECTION) => {
  await open($, w)
  await gate($)
  await gate($)
  w.files[SPEC] = `${OLD_SPEC}${section}`
}
// Through Red, as an edit whose new test fails by assertion.
const toGreen = async ($: Engine, w: World) => {
  await toSpec($, w)
  await gate($)
  w.files[`${MOD}/tests/width.test.ts`] = 'the new test'
  w.runs.test = { exitCode: 1, stdout: failing(NAMES, ['cuts by width']) }
  await gate($)
}

// --------------------------------------------------------------------------------------- what opens an edit

test('this plugin\'s edit skill opens a pending edit and the pane, and the gate then asks for the mod\'s folder', async ($, on) => {
  const w = mod(on)
  await $.skill.prompt(EDIT)
  expect(w.store['session:s1']).toEqual({ modDir: null, kind: 'edit' })
  expect(w.opened.map((pane) => pane.id)).toEqual(['mod-builder'])
  expect(await gate($)).toBe('mod-builder: this edit has not named its mod\'s folder. Call mod_builder_gate with mod_dir, the folder of the mod to edit.')
  expect(w.ran).toEqual([])
})

test('while the edit is pending, a write into the mod is refused', async ($, on) => {
  const w = mod(on)
  await $.skill.prompt(EDIT)
  expect((await write($, CODE)).deny).toMatch(/has not named its mod's folder/)
  expect(w.reachedTheTool).toEqual([])
})

test('a folder that is no mod, this plugin\'s own, or another session\'s is refused: no check runs and nothing is stored', async ($, on) => {
  const w = mod(on)
  await $.skill.prompt(EDIT)
  delete w.files[`${MOD}/hooks/hooks.json`]
  expect(await gate($, { mod_dir: 'turn-counter' })).toBe(`mod-builder: no edit was opened: ${MOD} holds no hooks/hooks.json: it is not a mod.`)
  w.files[`${MOD}/hooks/hooks.json`] = '{ "hooks": {} }'
  expect(await gate($, { mod_dir: 'turn-counter' })).toBe(`mod-builder: no edit was opened: ${MOD}/hooks/hooks.json has no "modules" key: it is not a mod.`)
  expect(await gate($, { mod_dir: '/work/nothing' })).toBe('mod-builder: no edit was opened: /work/nothing holds no .claude-plugin/plugin.json: it is not a plugin.')
  expect(await gate($, { mod_dir: ROOT })).toBe(`mod-builder: no edit was opened: ${ROOT} is this plugin's own folder: mod-builder does not edit itself.`)
  w.files[`${MOD}/hooks/hooks.json`] = '{ "modules": [] }'
  w.store[`build:${MOD}`] = { modDir: MOD, sessionId: 's2', phase: 'green', specApprovedAt: null, spec: null, testsAtScaffold: null, namesAtScaffold: null, testsAtRed: null, testHashes: null, evidence: {} }
  expect(await gate($, { mod_dir: 'turn-counter' })).toBe(`mod-builder: no edit was opened: ${MOD} is being built by another session (it is at phase 6 (Green)). Name another folder.`)
  expect(w.ran).toEqual([])
  expect(w.store['session:s1']).toEqual({ modDir: null, kind: 'edit' })
})

// --------------------------------------------------------------------------------------------- the baseline

test('naming the mod takes its baseline before anything is written: the four checks, then the restore point', async ($, on) => {
  const w = mod(on)
  const answer = await open($, w)
  expect(words(w)).toEqual(['compiler?', 'validate', 'test', 'typecheck', 'load', 'restore'])
  expect(w.ran.at(-1)).toEqual(['bash', `${ROOT}/scripts/restore-point.sh`, MOD, RESTORE])
  expect(answer).toBe(`mod-builder: the edit's mod folder is ${MOD}. It passes its four checks as it stands (2 tests). Its restore point is ${RESTORE}.\nIt is at phase 1 (Knowledge). Call mod_builder_gate again to ask for the next phase.`)
  expect(w.store['session:s1']).toEqual({ modDir: MOD, kind: 'edit' })
  const record = kept(w)
  expect(record.kind).toBe('edit')
  expect(record.red).toBe('edit')
  expect(record.phase).toBe('knowledge')
  expect(record.baseline.version).toBe('0.1.0')
  expect(record.baseline.tests).toBe(2)
  expect(record.baseline.names).toEqual(NAMES)
  expect(record.baseline.failed).toEqual([])
  expect(record.baseline.restore).toBe(RESTORE)
  expect(Object.keys(record.baseline.hashes as object).sort()).toEqual(['.claude-plugin/plugin.json', 'SPEC.md', 'hooks/hooks.json', 'hooks/register.tsx', 'tests/pane.test.tsx'])
  expect((record.baseline.spec as { length: number }).length).toBe(OLD_SPEC.length)
})

test('the baseline\'s typecheck asks for plain output and names the mod\'s test files, wherever they sit', async ($, on) => {
  const w = mod(on, { files: { [`${MOD}/hooks/x.test.ts`]: 'a stray test', [`${MOD}/node_modules/dep/d.test.ts`]: 'a dependency\'s', [`${MOD}/.git/HEAD`]: 'ref' } })
  await open($, w)
  const typecheck = w.ran.find((argv) => argv.includes('--noEmit')) as string[]
  expect(typecheck.slice(-5)).toEqual(['--noEmit', '--pretty', 'false', '-p', CONFIG])
  expect((JSON.parse(w.files[CONFIG] ?? '{}') as { files: string[] }).files).toEqual([`${MOD}/hooks/x.test.ts`, `${MOD}/tests/pane.test.tsx`])
  // The mod's own .git and node_modules are no part of the baseline.
  expect(Object.keys(kept(w).baseline.hashes as object).some((path) => path.startsWith('.git') || path.startsWith('node_modules'))).toBe(false)
})

test('a mod whose code no longer typechecks, its test files fitting, is a repair with Red skipped; the failing check is quoted', async ($, on) => {
  const w = mod(on, { runs: { validate: { exitCode: 0, stdout: 'Validation passed' }, test: { exitCode: 0, stdout: passing(2, NAMES) }, tsc: { exitCode: 1, stdout: ERR_HOOKS }, '--plugin-dir': { exitCode: 0, stdout: '' }, restore: { exitCode: 0, stdout: '' } } })
  const answer = await open($, w)
  expect(first(answer)).toBe(`mod-builder: the edit's mod folder is ${MOD}. As it stands it does not pass: typecheck. This edit is a repair. Its test files fit this build, so Red is skipped: Spec is followed by Green. Its restore point is ${RESTORE}.`)
  expect(answer).toContain("register.tsx(3,7): error TS2322")
  expect(kept(w).red).toBe('skipped')
  expect(kept(w).skipped).toBe('fit')
  expect(kept(w).baseline.failed).toEqual(['typecheck'])
})

test('a mod whose test file no longer typechecks is a repair with Red entered', async ($, on) => {
  const w = mod(on, { runs: { validate: { exitCode: 0, stdout: 'Validation passed' }, test: { exitCode: 1, stdout: failing([], NAMES, 'TypeError: x') }, tsc: { exitCode: 1, stdout: `${ERR_HOOKS}${ERR_TESTS}` }, '--plugin-dir': { exitCode: 0, stdout: '' }, restore: { exitCode: 0, stdout: '' } } })
  const answer = await open($, w)
  expect(first(answer)).toBe(`mod-builder: the edit's mod folder is ${MOD}. As it stands it does not pass: test, typecheck. This edit is a repair. Red is entered, tests only: it ends when a test file exists and the test files typecheck. Its restore point is ${RESTORE}.`)
  expect(kept(w).red).toBe('repair')
  expect(kept(w).baseline.failed).toEqual(['test', 'typecheck'])
})

test('a mod with no test file, nothing else failing, enters Red as any edit', async ($, on) => {
  const w = mod(on, { runs: { validate: { exitCode: 0, stdout: 'Validation passed' }, test: { exitCode: 1, stdout: `claude plugin test: no *.test.ts or *.test.tsx under ${MOD}\n` }, tsc: { exitCode: 0, stdout: '' }, '--plugin-dir': { exitCode: 0, stdout: '' }, restore: { exitCode: 0, stdout: '' } } })
  delete w.files[TEST]
  w.files[`${MOD}/tests/helpers.ts`] = 'a helper'
  const answer = await open($, w)
  expect(first(answer)).toBe(`mod-builder: the edit's mod folder is ${MOD}. As it stands it does not pass: test. It has no test file, and nothing else fails: Red is entered, and ends as in any edit. Its restore point is ${RESTORE}.`)
  expect(kept(w).red).toBe('edit')
  expect(kept(w).baseline.tests).toBe(null)
})

test('a baseline that can\'t be taken opens no edit: nothing is stored and no restore point is made', async ($, on) => {
  const w = mod(on)
  w.runs.validate = 'never starts'
  await $.skill.prompt(EDIT)
  expect(await gate($, { mod_dir: 'turn-counter' })).toBe('mod-builder: no edit was opened, and nothing was written: the baseline could not be taken: claude plugin validate --strict ended with no exit code.')
  expect(w.store[`build:${MOD}`]).toBe(undefined)
  expect(w.store['session:s1']).toEqual({ modDir: null, kind: 'edit' })
  expect(words(w).includes('restore')).toBe(false)
})

test('when the restore point can\'t be made, or the build\'s types are not written, no edit opens', async ($, on) => {
  const w = mod(on)
  w.runs.restore = { exitCode: 1, stdout: '', stderr: `restore-point: ${RESTORE} is already there and is not an empty folder\n` }
  await $.skill.prompt(EDIT)
  expect(await gate($, { mod_dir: 'turn-counter' })).toBe(`mod-builder: no edit was opened, and nothing was written: the restore point could not be made (restore-point: ${RESTORE} is already there and is not an empty folder).`)
  expect(w.store[`build:${MOD}`]).toBe(undefined)
  for (const path of Object.keys(w.files)) if (path.startsWith('/tmp/claude-1000/')) delete w.files[path]
  w.files['/tmp/claude-1000/keep'] = 'so that the world writes no types'
  expect(await gate($, { mod_dir: 'turn-counter' })).toMatch(/no edit was opened, and nothing was written: the types of Claude Code 2\.1\.322 are not written yet/)
  expect(w.store[`build:${MOD}`]).toBe(undefined)
})

// ------------------------------------------------------------------------------------------------- Spec

test('Spec ends when SPEC.md still begins as it did, holds the change\'s section, and the person approves; Red follows', async ($, on) => {
  const w = mod(on)
  await toSpec($, w)
  expect(await gate($)).toBe('mod-builder: phase 3 (Spec) passed (the person answered "Approve"). The edit is now at phase 4 (Red).')
  expect(w.asked).toEqual([{ question: `Approve this change to the mod? Its section is at the end of ${SPEC}. Nothing but SPEC.md can be written until you approve.`, options: ['Not yet', 'Approve'] }])
  expect(kept(w).phase).toBe('red')
  expect((kept(w).spec as { length: number }).length).toBe(OLD_SPEC.length + SECTION.length)
})

test('a line of the original spec changed, or no section, is refused before the person is asked; "Not yet" keeps the edit at Spec', async ($, on) => {
  const w = mod(on)
  await toSpec($, w)
  w.files[SPEC] = `# turn-counter\n\nCounts TURNS.\n${SECTION}`
  expect(await gate($)).toBe('mod-builder: still at phase 3 (Spec). Not passed: SPEC.md no longer begins as it did before this edit: the change is written as a new section at its end, and nothing above it may change.')
  w.files[SPEC] = OLD_SPEC
  expect(await gate($)).toBe('mod-builder: still at phase 3 (Spec). Not passed: SPEC.md holds no new section for this change yet: write it at the end of the file.')
  expect(w.asked).toEqual([])
  w.files[SPEC] = `${OLD_SPEC}${SECTION}`
  w.answer = 'Not yet'
  expect(await gate($)).toBe('mod-builder: still at phase 3 (Spec). Not passed: the person has not approved the change (answer: "Not yet").')
  expect(kept(w).phase).toBe('spec')
})

test('at Spec only SPEC.md can be written: the code and the tests are refused', async ($, on) => {
  const w = mod(on)
  await toSpec($, w)
  expect((await write($, SPEC)).deny).toBe(undefined)
  expect((await write($, CODE)).deny).toMatch(/can't be written in phase 3 \(Spec\) of this edit, which may write SPEC\.md only, by adding to its end\. Phase 4 \(Red\) opens when the person approves the change/)
  expect((await write($, TEST)).deny).toMatch(/phase 3 \(Spec\) of this edit/)
})

// ---------------------------------------------------------------------------------- the refactor route (8.15)

test('a change put forward as no behaviour change is offered the third answer, and only that answer skips Red', async ($, on) => {
  const w = mod(on)
  await toSpec($, w, NO_CHANGE)
  w.answer = APPROVE_NO_CHANGE
  expect(await gate($, { no_behaviour_change: true })).toBe('mod-builder: phase 3 (Spec) passed (the person answered "Approve: no behaviour change": Red is skipped, every test is kept as it is). Red is skipped (no behaviour change). The edit is now at phase 5 (Green).')
  expect(w.asked[0]?.options).toEqual(['Not yet', 'Approve', APPROVE_NO_CHANGE])
  expect(w.asked[0]?.question).toMatch(/It is put forward as a change with NO BEHAVIOUR CHANGE/)
  expect(kept(w).phase).toBe('green')
  expect(kept(w).red).toBe('skipped')
  expect(kept(w).skipped).toBe('no behaviour change')
})

test('the usual approving answer sends even such a change through Red, and the third answer typed where it was not offered approves nothing', async ($, on) => {
  const w = mod(on)
  await toSpec($, w, NO_CHANGE)
  w.answer = APPROVE_NO_CHANGE
  expect(await gate($)).toBe('mod-builder: still at phase 3 (Spec). Not passed: the person has not approved the change (answer: "Approve: no behaviour change").')
  expect(w.asked[0]?.options).toEqual(['Not yet', 'Approve'])
  w.answer = 'Approve'
  expect(await gate($, { no_behaviour_change: true })).toBe('mod-builder: phase 3 (Spec) passed (the person answered "Approve"). The edit is now at phase 4 (Red).')
  expect(kept(w).red).toBe('edit')
})

test('the route is refused, the person not asked, when the section does not say so or the mod did not pass its baseline', async ($, on) => {
  const w = mod(on)
  await toSpec($, w, SECTION)
  expect(await gate($, { no_behaviour_change: true })).toBe('mod-builder: still at phase 3 (Spec). Not passed: the change is put forward as one with no behaviour change, but its section of SPEC.md does not say "No behaviour change" in its first line.')
  expect(w.asked).toEqual([])
})

test('the route is not offered for a repair: the call is refused and nobody is asked', async ($, on) => {
  const w = mod(on, { runs: { validate: { exitCode: 0, stdout: 'Validation passed' }, test: { exitCode: 1, stdout: failing([], NAMES, 'TypeError: x') }, tsc: { exitCode: 1, stdout: `${ERR_HOOKS}${ERR_TESTS}` }, '--plugin-dir': { exitCode: 0, stdout: '' }, restore: { exitCode: 0, stdout: '' } } })
  await toSpec($, w, NO_CHANGE)
  expect(await gate($, { no_behaviour_change: true })).toMatch(/still at phase 3 \(Spec\)\. Not passed: this edit can't be approved as one with no behaviour change/)
  expect(w.asked).toEqual([])
})

test('on the route Green holds every test file to the baseline and the run to the baseline\'s tests', async ($, on) => {
  const w = mod(on)
  await toSpec($, w, NO_CHANGE)
  w.answer = APPROVE_NO_CHANGE
  await gate($, { no_behaviour_change: true })
  w.files[MANIFEST] = `{ "name": "${NAME}", "version": "0.1.1" }`
  // A test loosened by a shell command: the guard did not see it, the hashes do.
  w.files[TEST] = 'the first test, loosened'
  expect(await gate($)).toBe('mod-builder: still at phase 5 (Green). Not passed: not as recorded: tests/pane.test.tsx (changed).')
  w.files[TEST] = 'the first test'
  w.runs.test = { exitCode: 0, stdout: passing(3, [...NAMES, 'a new one']) }
  expect(first(await gate($))).toBe('mod-builder: still at phase 5 (Green). Not passed: tests run that the mod did not have before this edit, which changes no behaviour: a new one.')
  w.runs.test = { exitCode: 0, stdout: passing(2, NAMES) }
  expect(first(await gate($))).toMatch(/^mod-builder: phase 5 \(Green\) passed \(validate, 2 tests, .* all pass; version 0\.1\.1, after 0\.1\.0; the test files and SPEC\.md are as recorded\)\. The edit is now at phase 6 \(Verify\)\.$/)
  expect((await write($, TEST)).deny).toMatch(/of this edit/)
})

// -------------------------------------------------------------------------------------------------- Red

test('Red of an edit writes test files only, wherever they sit: the code, the manifest and SPEC.md are refused', async ($, on) => {
  const w = mod(on)
  await toSpec($, w)
  await gate($)
  expect((await write($, TEST)).deny).toBe(undefined)
  expect((await write($, `${MOD}/tests/width.test.ts`)).deny).toBe(undefined)
  expect((await write($, `${MOD}/hooks/x.test.ts`)).deny).toBe(undefined)
  for (const path of [CODE, MANIFEST, SPEC, `${MOD}/types/index.d.ts`]) expect((await write($, path)).deny).toMatch(/can't be written in phase 4 \(Red\) of this edit, which may write test files only/)
})

test('Red ends on a new test failing by assertion and the typecheck; the test files are recorded and Green opens', async ($, on) => {
  const w = mod(on)
  await toSpec($, w)
  await gate($)
  w.files[`${MOD}/tests/width.test.ts`] = 'the new test'
  w.files[`${MOD}/lib/y.test.tsx`] = 'a stray new test'
  w.runs.test = { exitCode: 1, stdout: failing(NAMES, ['cuts by width']) }
  expect(await gate($)).toMatch(/^mod-builder: phase 4 \(Red\) passed \(3 tests ran, a new or changed one failing by assertion; the typecheck passes \(types sha256 [0-9a-f]{64}\); 3 test files hashed, not as at the baseline: lib\/y\.test\.tsx, tests\/width\.test\.ts\)\. The edit is now at phase 5 \(Green\)\.$/)
  expect(w.asked.length).toBe(1)
  expect(Object.keys(kept(w).testHashes as object).sort()).toEqual(['lib/y.test.tsx', 'tests/pane.test.tsx', 'tests/width.test.ts'])
  expect((JSON.parse(w.files[CONFIG] ?? '{}') as { files: string[] }).files).toEqual([`${MOD}/lib/y.test.tsx`, `${MOD}/tests/pane.test.tsx`, `${MOD}/tests/width.test.ts`])
})

test('Red refuses a run that passes, a failure that is no assertion, and a test file that does not typecheck', async ($, on) => {
  const w = mod(on)
  await toSpec($, w)
  await gate($)
  expect(first(await gate($))).toBe('mod-builder: still at phase 4 (Red). Not passed: claude plugin test exited 0: no test fails yet.')
  w.files[`${MOD}/tests/width.test.ts`] = 'the new test'
  w.runs.test = { exitCode: 1, stdout: failing(NAMES, ['cuts by width'], 'TypeError: cut is not a function') }
  expect(first(await gate($))).toBe('mod-builder: still at phase 4 (Red). Not passed: not failing by assertion: cuts by width.')
  w.runs.test = { exitCode: 1, stdout: failing(NAMES, ['cuts by width']) }
  w.runs.tsc = { exitCode: 1, stdout: ERR_TESTS }
  const answer = await gate($)
  expect(first(answer)).toBe('mod-builder: still at phase 4 (Red). Not passed: the typecheck exited 1.')
  expect(answer).toContain('error TS2307')
  expect(kept(w).phase).toBe('red')
})

test('an old test failing in a test file that is as it was is no new or changed test', async ($, on) => {
  const w = mod(on)
  await toSpec($, w)
  await gate($)
  w.runs.test = { exitCode: 1, stdout: failing(['opens the pane'], ['draws its line']) }
  expect(first(await gate($))).toBe('mod-builder: still at phase 4 (Red). Not passed: no new or changed test fails: every failing test had its name at the baseline, in a test file that is as it was (draws its line).')
})

// ---------------------------------------------------------------------------------------- 8.4's question

test('a test file the baseline had that changed raises the question, with what it lost; "Not yet" keeps the edit at Red', async ($, on) => {
  const w = mod(on, { files: { [TEST]: "test('draws its line', () => {\n  expect(cut(row)).toBe(40)\n})\n" } })
  await toSpec($, w)
  await gate($)
  w.files[TEST] = "test('draws its line', () => {\n  check(row)\n})\n"
  w.runs.test = { exitCode: 1, stdout: failing(['opens the pane'], ['draws its line']) }
  w.answer = 'Not yet'
  expect(await gate($)).toBe('mod-builder: still at phase 4 (Red). Not passed: the person has not agreed to the changed test files (answer: "Not yet").')
  expect(w.asked.at(-1)).toEqual({
    question: 'These test files are not as they were before this edit:\n- tests/pane.test.tsx: 1 line added, 1 line removed\n    removed: expect(cut(row)).toBe(40)\nGo on with these changes?',
    options: ['Not yet', GO_ON],
  })
  expect(kept(w).phase).toBe('red')
  w.answer = GO_ON
  expect(await gate($)).toMatch(/phase 4 \(Red\) passed \(.*; the person answered "Go on with these changes" for: tests\/pane\.test\.tsx \(changed\)\)\. The edit is now at phase 5 \(Green\)\.$/)
  expect(kept(w).evidence.red).toContain('the person answered "Go on with these changes" for: tests/pane.test.tsx (changed)')
})

test('a test file that is gone is asked about with the names that went; a new test file raises no question', async ($, on) => {
  const w = mod(on, { files: { [`${MOD}/tests/old.test.ts`]: "test('an old one', () => {\n  expect(1).toBe(1)\n})\n" } })
  w.runs.test = { exitCode: 0, stdout: passing(3, [...NAMES, 'an old one']) }
  await toSpec($, w)
  await gate($)
  delete w.files[`${MOD}/tests/old.test.ts`]
  w.files[`${MOD}/tests/width.test.ts`] = 'the new test'
  w.runs.test = { exitCode: 1, stdout: failing(NAMES, ['cuts by width']) }
  w.answer = GO_ON
  expect(await gate($)).toMatch(/phase 4 \(Red\) passed/)
  expect(w.asked.at(-1)?.question).toBe("These test files are not as they were before this edit:\n- tests/old.test.ts: gone (3 lines removed)\n    removed: test('an old one', () => {\n    removed: expect(1).toBe(1)\nThese tests no longer exist: an old one\nGo on with these changes?")
})

test('the question is asked only once Red\'s checks pass, and a question nobody answers keeps the edit at Red', async ($, on) => {
  const w = mod(on)
  await toSpec($, w)
  await gate($)
  w.files[TEST] = 'the first test, changed'
  const before = w.asked.length
  expect(first(await gate($))).toMatch(/no test fails yet/)
  expect(w.asked.length).toBe(before)
  w.runs.test = { exitCode: 1, stdout: failing(['opens the pane'], ['draws its line']) }
  w.answer = null
  expect(await gate($)).toBe('mod-builder: still at phase 4 (Red). Not passed: the person could not be asked about the changed test files (the question was dismissed, or nobody is at this session).')
})

// ------------------------------------------------------------------------------------- Green, Verify, Done

test('Green ends when the four checks pass and the version is greater; the code is open and every test file closed', async ($, on) => {
  const w = mod(on)
  await toGreen($, w)
  expect((await write($, CODE)).deny).toBe(undefined)
  expect((await write($, MANIFEST)).deny).toBe(undefined)
  expect((await write($, `${MOD}/tests/width.test.ts`)).deny).toMatch(/can't be written in phase 5 \(Green\) of this edit, which may write anything but test files and SPEC\.md/)
  w.runs.test = { exitCode: 0, stdout: passing(3, [...NAMES, 'cuts by width']) }
  expect(first(await gate($))).toBe('mod-builder: still at phase 5 (Green). Not passed: plugin.json\'s version is 0.1.0, not greater than the 0.1.0 it had before the edit.')
  w.files[MANIFEST] = `{ "name": "${NAME}", "version": "0.1.1" }`
  expect(first(await gate($))).toMatch(/^mod-builder: phase 5 \(Green\) passed \(validate, 3 tests, .* all pass; version 0\.1\.1, after 0\.1\.0; the test files and SPEC\.md are as recorded\)\. The edit is now at phase 6 \(Verify\)\.$/)
})

test('a test file changed after Red, by any tool, stops Green; so does a failing test', async ($, on) => {
  const w = mod(on)
  await toGreen($, w)
  w.files[MANIFEST] = `{ "name": "${NAME}", "version": "0.2.0" }`
  w.files[`${MOD}/tests/width.test.ts`] = 'the new test, loosened'
  expect(await gate($)).toBe('mod-builder: still at phase 5 (Green). Not passed: not as recorded: tests/width.test.ts (changed).')
  w.files[`${MOD}/tests/width.test.ts`] = 'the new test'
  expect(first(await gate($))).toBe('mod-builder: still at phase 5 (Green). Not passed: claude plugin test exited 1: not every test passes.')
})

test('Verify asks for the change\'s "Built" lines and the version again, and Done follows', async ($, on) => {
  const w = mod(on)
  await toGreen($, w)
  w.files[MANIFEST] = `{ "name": "${NAME}", "version": "0.1.1" }`
  w.runs.test = { exitCode: 0, stdout: passing(3, [...NAMES, 'cuts by width']) }
  await gate($)
  expect(first(await gate($))).toMatch(/still at phase 6 \(Verify\)\. Not passed: the "Built" block of SPEC\.md does not hold the sha256 of the types/)
  w.files[SPEC] = `${w.files[SPEC]}${BUILT}`
  w.files[MANIFEST] = `{ "name": "${NAME}", "version": "0.1.0" }`
  expect(first(await gate($))).toBe('mod-builder: still at phase 6 (Verify). Not passed: plugin.json\'s version is 0.1.0, not greater than the 0.1.0 it had before the edit.')
  w.files[MANIFEST] = `{ "name": "${NAME}", "version": "0.1.1" }`
  expect(first(await gate($))).toMatch(/^mod-builder: phase 6 \(Verify\) passed \(.*\)\. The edit is now at phase 7 \(Done\)\.$/)
  expect(kept(w).phase).toBe('done')
  expect(await gate($)).toBe('mod-builder: still at phase 7 (Done). Not passed: the edit is done: nothing follows phase 7.')
})

// ------------------------------------------------------------------------------------------------ a repair

test('a repair whose test files fit goes from Spec to Green, and Green ends when the mod passes with a greater version', async ($, on) => {
  const w = mod(on, { runs: { validate: { exitCode: 0, stdout: 'Validation passed' }, test: { exitCode: 0, stdout: passing(2, NAMES) }, tsc: { exitCode: 1, stdout: ERR_HOOKS }, '--plugin-dir': { exitCode: 0, stdout: '' }, restore: { exitCode: 0, stdout: '' } } })
  await toSpec($, w)
  expect(await gate($)).toBe('mod-builder: phase 3 (Spec) passed (the person answered "Approve"). Red is skipped (the test files fit this build). The edit is now at phase 5 (Green).')
  expect((await write($, TEST)).deny).toMatch(/of this edit/)
  expect((await write($, CODE)).deny).toBe(undefined)
  expect(first(await gate($))).toBe('mod-builder: still at phase 5 (Green). Not passed: the typecheck exited 1.')
  w.runs.tsc = { exitCode: 0, stdout: '' }
  w.files[MANIFEST] = `{ "name": "${NAME}", "version": "0.1.1" }`
  expect(first(await gate($))).toMatch(/phase 5 \(Green\) passed/)
})

test('a repair\'s Red ends when the test files typecheck, whatever the code still shows, and is tests only', async ($, on) => {
  const w = mod(on, { runs: { validate: { exitCode: 0, stdout: 'Validation passed' }, test: { exitCode: 1, stdout: failing([], NAMES, 'TypeError: x') }, tsc: { exitCode: 1, stdout: `${ERR_HOOKS}${ERR_TESTS}` }, '--plugin-dir': { exitCode: 0, stdout: '' }, restore: { exitCode: 0, stdout: '' } } })
  await toSpec($, w)
  expect(await gate($)).toBe('mod-builder: phase 3 (Spec) passed (the person answered "Approve"). The edit is now at phase 4 (Red).')
  expect((await write($, CODE)).deny).toMatch(/Phase 5 \(Green\) opens when a test file exists, the test files typecheck/)
  const refused = await gate($)
  expect(first(refused)).toBe('mod-builder: still at phase 4 (Red). Not passed: the test files do not typecheck: tests/pane.test.tsx.')
  expect(refused).toContain('error TS2307')
  w.files[TEST] = 'the first test, mended'
  w.runs.tsc = { exitCode: 1, stdout: ERR_HOOKS }
  w.answer = GO_ON
  expect(await gate($)).toMatch(/^mod-builder: phase 4 \(Red\) passed \(the test files typecheck \(types sha256 [0-9a-f]{64}\); 1 test files hashed, not as at the baseline: tests\/pane\.test\.tsx; the person answered "Go on with these changes" for: tests\/pane\.test\.tsx \(changed\)\)\. The edit is now at phase 5 \(Green\)\.$/)
  // No test run is read at a repair's Red: the mod already fails.
  expect(words(w).slice(-3).includes('test')).toBe(false)
})

// ------------------------------------------------------- cases the independent reader of these tests asked for

const BUILD = { skill: 'build', text: 'the eight phases', source: 'plugin', pluginName: 'mod-builder', frontmatter: {} } as const
const NEW_TEST = `${MOD}/tests/width.test.ts`
const typechecks = (w: World) => w.ran.filter((argv) => argv.includes('--noEmit'))
const named = (w: World) => (JSON.parse(w.files[CONFIG] ?? '{}') as { files?: string[] }).files
const REPAIR = { validate: { exitCode: 0, stdout: 'Validation passed' }, test: { exitCode: 0, stdout: passing(2, NAMES) }, tsc: { exitCode: 1, stdout: ERR_HOOKS }, '--plugin-dir': { exitCode: 0, stdout: '' }, restore: { exitCode: 0, stdout: '' } }

test('a question at Spec that nobody answers approves nothing', async ($, on) => {
  const w = mod(on)
  await toSpec($, w)
  w.answer = null
  expect(await gate($)).toBe('mod-builder: still at phase 3 (Spec). Not passed: the person could not be asked (the question was dismissed, or nobody is at this session).')
  expect(kept(w).phase).toBe('spec')
  expect(kept(w).spec).toBe(null)
})

test('the gate tool declares no_behaviour_change, and only true is a claim', async ($, on) => {
  const w = mod(on)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: false })
  const schema = (w.registered[0] as unknown as { inputSchema: { properties: Record<string, { type: string }> } }).inputSchema
  expect(schema.properties.no_behaviour_change?.type).toBe('boolean')
  expect(schema.properties.mod_dir?.type).toBe('string')
  await toSpec($, w, NO_CHANGE)
  w.answer = 'Not yet'
  for (const claim of [false, 'true', 1, null]) {
    await gate($, { no_behaviour_change: claim })
    expect(w.asked.at(-1)?.options).toEqual(['Not yet', 'Approve'])
  }
})

test('the time of the approval is recorded with the approved SPEC.md', async ($, on) => {
  const w = mod(on)
  await toSpec($, w)
  await gate($)
  expect(kept(w).specApprovedAt).toBe(1000)
})

test('a mod that a check of its baseline wrote into opens no edit: no restore point, nothing stored', async ($, on) => {
  const w = mod(on)
  w.whileRunning = (argv) => {
    if (argv.includes('test')) w.files[`${MOD}/.cache/run.json`] = 'written by the test run'
  }
  await $.skill.prompt(EDIT)
  expect(await gate($, { mod_dir: 'turn-counter' })).toBe(`mod-builder: no edit was opened, and nothing was written: ${MOD} changed while its baseline was being taken (not as recorded: .cache/run.json (added)): ask again.`)
  expect(words(w).includes('restore')).toBe(false)
  expect(w.store[`build:${MOD}`]).toBe(undefined)
})

test('with no HOME, or a session id that is no plain name, there is no folder for the restore point and no edit opens', async ($, on) => {
  const w = mod(on, { sessionId: 'a b' })
  await $.skill.prompt(EDIT)
  expect(await gate($, { mod_dir: 'turn-counter' })).toBe('mod-builder: no edit was opened, and nothing was written: the restore point has no folder: HOME is not set, or this session has no plain id.')
  expect(words(w).includes('restore')).toBe(false)
  expect(words(w).includes('validate')).toBe(false)
  expect(w.store[`build:${MOD}`]).toBe(undefined)
})

test('what the baseline showed is kept as the edit\'s first evidence', async ($, on) => {
  const w = mod(on)
  await open($, w)
  expect(kept(w).evidence).toEqual({ baseline: `passes its four checks (2 tests); version 0.1.0; restore point ${RESTORE}` })
})

test('a repair\'s failing checks are its recorded evidence, and a load the log does not show is a failing check', async ($, on) => {
  const w = mod(on, { files: { 'the load log': '[DEBUG] nothing of this mod\n' } })
  const answer = await open($, w)
  expect(first(answer)).toBe(`mod-builder: the edit's mod folder is ${MOD}. As it stands it does not pass: load. This edit is a repair. Its test files fit this build, so Red is skipped: Spec is followed by Green. Its restore point is ${RESTORE}.`)
  expect(kept(w).evidence.baseline).toBe(`fails load; version 0.1.0; restore point ${RESTORE}`)
  expect(kept(w).baseline.failed).toEqual(['load'])
})

test('the baseline typechecks against every distinct types file of the build, none left out when one fails', async ($, on) => {
  const other = `${TYPES_FOLDER}/aaaa/plugin-authoring/types/claude-code.d.ts`
  const w = mod(on, { runs: REPAIR, files: { [TYPES]: TYPES_TEXT, [other]: `${TYPES_TEXT}// another session's\n`, [`${TMP}/keep`]: '' } })
  await open($, w)
  expect(typechecks(w).length).toBe(2)
  expect(kept(w).baseline.failed).toEqual(['typecheck'])
})

test('a test file changed while Red\'s checks ran is not what was checked: nothing is recorded', async ($, on) => {
  const w = mod(on)
  await toSpec($, w)
  await gate($)
  w.files[NEW_TEST] = 'the new test'
  w.runs.test = { exitCode: 1, stdout: failing(NAMES, ['cuts by width']) }
  w.whileRunning = (argv) => {
    if (argv.includes('--noEmit')) w.files[NEW_TEST] = 'changed under the compiler'
  }
  expect(await gate($)).toBe('mod-builder: still at phase 4 (Red). Not passed: the test files changed while Red\'s checks ran (not as recorded: tests/width.test.ts (changed)): ask again.')
  expect(kept(w).phase).toBe('red')
  expect(kept(w).testHashes).toBe(null)
})

test('8.4\'s question comes after the typecheck too: a changed test file that does not typecheck is refused unasked', async ($, on) => {
  const w = mod(on)
  await toSpec($, w)
  await gate($)
  const asked = w.asked.length
  w.files[TEST] = 'the first test, changed'
  w.runs.test = { exitCode: 1, stdout: failing(['opens the pane'], ['draws its line']) }
  w.runs.tsc = { exitCode: 1, stdout: ERR_TESTS }
  w.answer = GO_ON
  expect(first(await gate($))).toBe('mod-builder: still at phase 4 (Red). Not passed: the typecheck exited 1.')
  expect(w.asked.length).toBe(asked)
})

test('SPEC.md changed after its approval, by any tool, stops Red and stops Green', async ($, on) => {
  const w = mod(on)
  await toSpec($, w)
  await gate($)
  const approved = w.files[SPEC] as string
  w.files[NEW_TEST] = 'the new test'
  w.runs.test = { exitCode: 1, stdout: failing(NAMES, ['cuts by width']) }
  w.files[SPEC] = `${approved}a line added by a shell command\n`
  expect(await gate($)).toBe('mod-builder: still at phase 4 (Red). Not passed: not as recorded: SPEC.md (changed).')
  w.files[SPEC] = approved
  await gate($)
  expect(kept(w).phase).toBe('green')
  w.files[SPEC] = 'x'
  expect(await gate($)).toBe('mod-builder: still at phase 5 (Green). Not passed: not as recorded: SPEC.md (changed).')
})

test('a test file that is a link is refused at Red: what it holds can\'t be recorded', async ($, on) => {
  const w = mod(on)
  await toSpec($, w)
  await gate($)
  w.files[`${MOD}/tests/linked.test.ts`] = 'elsewhere'
  w.links = [`${MOD}/tests/linked.test.ts`]
  expect(await gate($)).toBe("mod-builder: still at phase 4 (Red). Not passed: tests/linked.test.ts is a link or no file: a test must be a file of the mod's own, so that what it holds can be recorded.")
})

test('when the restore point\'s copy of a changed test file can\'t be read, the person can\'t be shown what changed, and Red refuses', async ($, on) => {
  const w = mod(on)
  await toSpec($, w)
  await gate($)
  delete w.files[`${RESTORE}/tests/pane.test.tsx`]
  w.files[TEST] = 'the first test, changed'
  w.runs.test = { exitCode: 1, stdout: failing(['opens the pane'], ['draws its line']) }
  const asked = w.asked.length
  expect(await gate($)).toBe(`mod-builder: still at phase 4 (Red). Not passed: tests/pane.test.tsx can't be read in the restore point (${RESTORE}), so the person can't be shown what changed.`)
  expect(w.asked.length).toBe(asked)
})

test('Green and Verify name every test file to the typecheck, as Red did', async ($, on) => {
  const w = mod(on)
  await toGreen($, w)
  w.files[MANIFEST] = `{ "name": "${NAME}", "version": "0.1.1" }`
  w.runs.test = { exitCode: 0, stdout: passing(3, [...NAMES, 'cuts by width']) }
  w.files[CONFIG] = ''
  const answer = await gate($)
  expect(named(w)).toEqual([`${MOD}/tests/pane.test.tsx`, `${MOD}/tests/width.test.ts`])
  expect(answer).toContain('The "Built on" line for the "Built" block of SPEC.md, to copy exactly:\nBuilt on Claude Code 2.1.322, from the docs snapshot 2026-11-10T151216Z')
  w.files[SPEC] = `${w.files[SPEC]}${BUILT}`
  w.files[CONFIG] = ''
  await gate($)
  expect(kept(w).phase).toBe('done')
  expect(named(w)).toEqual([`${MOD}/tests/pane.test.tsx`, `${MOD}/tests/width.test.ts`])
})

test('an edit\'s Green is stopped by a failing validate and by a load that fails or is not shown', async ($, on) => {
  const w = mod(on)
  await toGreen($, w)
  w.files[MANIFEST] = `{ "name": "${NAME}", "version": "0.1.1" }`
  w.runs.test = { exitCode: 0, stdout: passing(3, [...NAMES, 'cuts by width']) }
  w.runs.validate = { exitCode: 1, stdout: 'Validation failed' }
  expect(first(await gate($))).toBe('mod-builder: still at phase 5 (Green). Not passed: claude plugin validate --strict exited 1.')
  w.runs.validate = { exitCode: 0, stdout: 'Validation passed' }
  w.runs['--plugin-dir'] = { exitCode: 1, stdout: 'boom' }
  expect(first(await gate($))).toBe('mod-builder: still at phase 5 (Green). Not passed: the headless load exited 1.')
  w.runs['--plugin-dir'] = { exitCode: 0, stdout: '' }
  w.files['the load log'] = '[DEBUG] nothing of this mod\n'
  expect(first(await gate($))).toBe("mod-builder: still at phase 5 (Green). Not passed: the headless load's debug log does not show the mod loaded and admitted.")
  expect(kept(w).phase).toBe('green')
})

test('Green needs no fewer tests than Red counted', async ($, on) => {
  const w = mod(on)
  await toGreen($, w)
  w.files[MANIFEST] = `{ "name": "${NAME}", "version": "0.1.1" }`
  w.runs.test = { exitCode: 0, stdout: passing(2, NAMES) }
  expect(first(await gate($))).toBe('mod-builder: still at phase 5 (Green). Not passed: the run has 2 tests, fewer than the 3 at Red.')
})

test('a test file changed while Green\'s checks ran stops Green', async ($, on) => {
  const w = mod(on)
  await toGreen($, w)
  w.files[MANIFEST] = `{ "name": "${NAME}", "version": "0.1.1" }`
  w.runs.test = { exitCode: 0, stdout: passing(3, [...NAMES, 'cuts by width']) }
  w.whileRunning = (argv) => {
    if (argv.includes('--plugin-dir')) w.files[NEW_TEST] = 'loosened under the load'
  }
  expect(await gate($)).toBe('mod-builder: still at phase 5 (Green). Not passed: not as recorded: tests/width.test.ts (changed).')
})

test('in a repair whose Red was skipped, Green holds the run to the tests the mod had', async ($, on) => {
  const w = mod(on, { runs: REPAIR })
  await toSpec($, w)
  await gate($)
  w.runs.tsc = { exitCode: 0, stdout: '' }
  w.files[MANIFEST] = `{ "name": "${NAME}", "version": "0.1.1" }`
  w.runs.test = { exitCode: 0, stdout: passing(2, ['draws its line', 'opens another']) }
  expect(first(await gate($))).toBe('mod-builder: still at phase 5 (Green). Not passed: tests the mod had before this edit no longer run: opens the pane.')
  w.runs.test = { exitCode: 0, stdout: passing(2, NAMES) }
  expect(first(await gate($))).toMatch(/phase 5 \(Green\) passed/)
})

test('a repair\'s Red names the test files to the typecheck', async ($, on) => {
  const w = mod(on, { runs: { ...REPAIR, test: { exitCode: 1, stdout: failing([], NAMES, 'TypeError: x') }, tsc: { exitCode: 1, stdout: `${ERR_HOOKS}${ERR_TESTS}` } }, files: { [`${MOD}/lib/y.test.tsx`]: 'a stray test' } })
  await toSpec($, w)
  await gate($)
  w.files[CONFIG] = ''
  await gate($)
  expect(named(w)).toEqual([`${MOD}/lib/y.test.tsx`, `${MOD}/tests/pane.test.tsx`])
})

test('Knowledge of an edit refuses while no snapshot of the documentation exists', async ($, on) => {
  const w = mod(on)
  await open($, w)
  delete w.files[LATEST]
  expect(await gate($)).toBe('mod-builder: still at phase 1 (Knowledge). Not passed: no snapshot of the mod documentation exists yet: run /mod-builder refresh.')
  expect(kept(w).phase).toBe('knowledge')
})

test('the edit skill expanded while a build or an edit is open leaves it as it is', async ($, on) => {
  const w = mod(on)
  await $.skill.prompt(BUILD)
  await gate($, { mod_dir: 'turn-counter' })
  const building = JSON.stringify(w.store)
  await $.skill.prompt(EDIT)
  expect(JSON.stringify(w.store)).toBe(building)
  expect(w.store['session:s1']).toEqual({ modDir: MOD })
})

test('the build skill expanded while an edit is open leaves the edit as it is', async ($, on) => {
  const w = mod(on)
  await open($, w)
  const editing = JSON.stringify(w.store)
  await $.skill.prompt(BUILD)
  expect(JSON.stringify(w.store)).toBe(editing)
  expect(w.store['session:s1']).toEqual({ modDir: MOD, kind: 'edit' })
})

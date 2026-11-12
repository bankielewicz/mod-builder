// SPEC.md 9.11 and 9.30 in an edit, through the hooks module itself: an edit goes back from Green to Red as a
// build does; and an edit whose Red was skipped enters it for the first time, judged against the baseline.
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { GATE, HOME, MOD, NAME, failing, passing, world, readerDone } from './world'
import type { World } from './world'

const EDIT = { skill: 'edit', text: 'the phases of an edit', source: 'plugin', pluginName: 'mod-builder', frontmatter: {} } as const
const LATEST = `${HOME}/.claude/mod-builder-data/v2/docs/latest`
const SPEC = `${MOD}/SPEC.md`
const MANIFEST = `${MOD}/.claude-plugin/plugin.json`
const CODE = `${MOD}/hooks/register.tsx`
const TEST = `${MOD}/tests/pane.test.tsx`
const WIDTH = `${MOD}/tests/width.test.ts`
const RESTORE = `${HOME}/.claude/mod-builder-data/v2/restore/s1/1970-01-01T000001Z`
const LOADED = `[DEBUG] hooks module ${NAME}@inline loaded (worker, environment 1, tier user); events: session.start\n`
const OLD_SPEC = '# turn-counter\n\nCounts turns.\n'
const SECTION = '\n## 0.1.1 (2026-11-11)\n\nCuts each row by display width.\n'
const NO_CHANGE = '\n## 0.1.1 (2026-11-11)\n\nNo behaviour change: the rows are built by one helper.\n'
const NAMES = ['draws its line', 'opens the pane']
const AT_GREEN = 'mod-builder: still at phase 5 (Green)'
const AT_RED = 'mod-builder: still at phase 4 (Red)'
const OFFER = 'If a test is what is wrong, call the gate with back_to_red: true: mod-builder then asks the person whether to go back to Red and change the tests.'
const BACK = 'mod-builder: back at phase 4 (Red): the person answered "Go back to Red" (return 1). Test files are open again and everything else is closed; nothing in the mod was changed. Change the tests that are wrong, then call the gate.'

const gate = async ($: Engine, more: Record<string, unknown> = {}) => readerDone($, String((await $.tool.call({ tool: GATE, ...more } as never)).result))
const first = (answer: string) => answer.split('\n')[0] as string
const kept = (w: World) => w.store[`build:${MOD}`] as Record<string, unknown> & { phase: string; evidence: Record<string, string>; testHashes: Record<string, string> | null }
const write = async ($: Engine, path: string) => (await $.tool.call({ tool: 'Write', file_path: path, content: 'x' } as never)).deny

// A finished mod, as an earlier build left it, and a session in which nothing is open yet.
const mod = (on: Parameters<typeof world>[0], more: Partial<World> = {}) =>
  world(on, {
    runs: { validate: { exitCode: 0, stdout: 'Validation passed' }, test: { exitCode: 0, stdout: passing(2, NAMES) }, tsc: { exitCode: 0, stdout: '' }, '--plugin-dir': { exitCode: 0, stdout: '' }, restore: { exitCode: 0, stdout: `restore point: ${RESTORE}\n` } },
    ...more,
    files: {
      [LATEST]: '2026-11-10T151216Z\n', [SPEC]: OLD_SPEC, [MANIFEST]: `{ "name": "${NAME}", "version": "0.1.0" }`,
      [`${MOD}/hooks/hooks.json`]: '{ "modules": ["./register.tsx"] }', [CODE]: 'the code', [TEST]: 'the first test', 'the load log': LOADED,
      ...more.files,
    },
  })
// From nothing to Spec's gate, the change's section written.
const toSpec = async ($: Engine, w: World, section: string) => {
  await $.skill.prompt(EDIT)
  await gate($, { mod_dir: 'turn-counter' })
  for (const [path, text] of Object.entries(w.files)) if (path.startsWith(`${MOD}/`)) w.files[`${RESTORE}/${path.slice(MOD.length + 1)}`] = text
  await gate($)
  await gate($)
  w.files[SPEC] = `${OLD_SPEC}${section}`
}
// Green refused twice in a row for its test run, then the person's "Go back to Red".
const goBack = async ($: Engine, w: World, fails: { exitCode: number; stdout: string }) => {
  w.runs.test = fails
  await gate($)
  expect(first(await gate($)).endsWith(OFFER)).toBe(true)
  w.answer = 'Go back to Red'
  expect(await gate($, { back_to_red: true })).toBe(BACK)
}

test('an edit goes back as a build does: at its returned Red the person is asked about the test the Red before held, against the copy kept, and the reader reads it against the change\'s section', async ($, on) => {
  const w = mod(on)
  await toSpec($, w, SECTION)
  await gate($)
  w.files[WIDTH] = 'the new test'
  w.runs.test = { exitCode: 1, stdout: failing(NAMES, ['cuts by width']) }
  await gate($)
  expect(kept(w).phase).toBe('green')
  w.files[MANIFEST] = `{ "name": "${NAME}", "version": "0.1.1" }`
  await goBack($, w, { exitCode: 1, stdout: failing(NAMES, ['cuts by width']) })
  expect(kept(w).phase).toBe('red')
  expect(w.store[`redcopy:${MOD}`]).toEqual({ 'tests/pane.test.tsx': 'the first test', 'tests/width.test.ts': 'the new test' })
  expect(await write($, WIDTH)).toBe(undefined)
  expect(String(await write($, CODE)).startsWith('mod-builder: hooks/register.tsx can\'t be written')).toBe(true)
  expect(await gate($)).toBe(`${AT_RED}. Not passed: no test file has changed since Red passed: the work came back to change a test.`)
  w.files[WIDTH] = 'the new test\nexpect(width).toBe(2)\n'
  w.runs.test = { exitCode: 0, stdout: passing(3, [...NAMES, 'cuts by width']) }
  w.answer = 'Go on with these changes'
  const asked = w.asked.length
  expect(first(await gate($))).toMatch(/^mod-builder: phase 4 \(Red\) passed \(3 tests ran, all passing; the typecheck passes \(types sha256 [0-9a-f]{64}\); 2 test files hashed, not as at the Red before: tests\/width\.test\.ts; the person answered "Go on with these changes" for: tests\/width\.test\.ts \(changed\); the test reader passed the tests \(round 1\); back from Green \(return 1\)\)\. The edit is now at phase 5 \(Green\)\.$/)
  expect(w.asked.length).toBe(asked + 1)
  expect((w.asked.at(-1) as { question: string }).question.includes('tests/width.test.ts')).toBe(true)
  const prompt = (w.spawned.at(-1) as { prompt: string }).prompt.split('\n')
  expect(prompt[1]).toBe(`Its specification: ${SPEC}, from line 5 on (the section for this change)`)
  expect(prompt.filter((line) => line.startsWith('- '))).toEqual([`- ${WIDTH}`])
  w.runs.test = { exitCode: 0, stdout: passing(3, [...NAMES, 'cuts by width']) }
  expect(first(await gate($)).startsWith('mod-builder: phase 5 (Green) passed (')).toBe(true)
})

test('an edit whose Red was skipped may go back too: Red is entered for the first time, judged against the baseline, and is skipped no longer', async ($, on) => {
  const w = mod(on)
  await toSpec($, w, NO_CHANGE)
  w.answer = 'Approve: no behaviour change'
  await gate($, { no_behaviour_change: true })
  expect(kept(w).phase).toBe('green')
  expect(kept(w).red).toBe('skipped')
  w.files[MANIFEST] = `{ "name": "${NAME}", "version": "0.1.1" }`
  w.files[CODE] = 'the code, tidied'
  await goBack($, w, { exitCode: 1, stdout: failing(['draws its line'], ['opens the pane']) })
  expect(kept(w).phase).toBe('red')
  expect(kept(w).red).toBe('edit')
  expect('skipped' in kept(w)).toBe(false)
  expect(Object.keys(kept(w).redBefore as object)).toEqual(['tests/pane.test.tsx'])
  expect(await gate($)).toBe(`${AT_RED}. Not passed: no test file has changed since Red passed: the work came back to change a test.`)
  w.files[TEST] = 'the first test, corrected'
  w.runs.test = { exitCode: 0, stdout: passing(2, NAMES) }
  w.answer = 'Go on with these changes'
  expect(first(await gate($))).toMatch(/^mod-builder: phase 4 \(Red\) passed \(2 tests ran, all passing; .*; the person answered "Go on with these changes" for: tests\/pane\.test\.tsx \(changed\); the test reader passed the tests \(round 1\); back from Green \(return 1\)\)\. The edit is now at phase 5 \(Green\)\.$/)
  expect(kept(w).testHashes === null).toBe(false)
  // Green after an entered Red asks nothing about a skipped one.
  const asked = w.asked.length
  expect(first(await gate($)).startsWith('mod-builder: phase 5 (Green) passed (')).toBe(true)
  expect(w.asked.length).toBe(asked)
})

test('at Green of an edit, a refusal for the version alone offers nothing', async ($, on) => {
  const w = mod(on)
  await toSpec($, w, SECTION)
  await gate($)
  w.files[WIDTH] = 'the new test'
  w.runs.test = { exitCode: 1, stdout: failing(NAMES, ['cuts by width']) }
  await gate($)
  w.runs.test = { exitCode: 0, stdout: passing(3, [...NAMES, 'cuts by width']) }
  expect((await gate($)).includes('back_to_red')).toBe(false)
  expect((await gate($)).includes('back_to_red')).toBe(false)
  expect(first(await gate($)).startsWith(`${AT_GREEN}. Not passed: plugin.json's version is 0.1.0`)).toBe(true)
  expect(kept(w).greenTestRefusals).toBe(undefined)
})

test('after a Red that was skipped, the names a returned Red says are gone are the baseline\'s, and they are taken again when it passes', async ($, on) => {
  const w = mod(on)
  await toSpec($, w, NO_CHANGE)
  w.answer = 'Approve: no behaviour change'
  await gate($, { no_behaviour_change: true })
  w.files[MANIFEST] = `{ "name": "${NAME}", "version": "0.1.1" }`
  await goBack($, w, { exitCode: 1, stdout: failing(['draws its line'], ['opens the pane']) })
  expect(kept(w).namesAtRed).toBe(undefined)
  w.files[TEST] = 'the first test, with one test renamed'
  w.runs.test = { exitCode: 0, stdout: passing(2, ['draws its line', 'opens the pane on the command']) }
  w.answer = 'Go on with these changes'
  await gate($)
  const question = (w.asked.at(-1) as { question: string }).question
  expect(question.split('\n')[0]).toBe('These test files are not as they were when Red passed:')
  expect(question.includes('These tests no longer exist: opens the pane')).toBe(true)
  expect(kept(w).phase).toBe('green')
  expect(kept(w).namesAtRed).toEqual(['draws its line', 'opens the pane on the command'])
})

test('an edit\'s first Red keeps its own words: the test files are not as they were before this edit', async ($, on) => {
  const w = mod(on)
  await toSpec($, w, SECTION)
  await gate($)
  w.files[TEST] = 'the first test, changed'
  w.runs.test = { exitCode: 1, stdout: failing(['draws its line'], ['opens the pane']) }
  w.answer = 'Not yet'
  await gate($)
  expect((w.asked.at(-1) as { question: string }).question.split('\n')[0]).toBe('These test files are not as they were before this edit:')
})

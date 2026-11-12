// SPEC.md 9.36 in an edit, through the hooks module itself: a third reading whose tests were mended after its
// report asks the person, says the tests changed since, and starts no fourth, as in a build.
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { GATE, HOME, MOD, NAME, endReader, failing, passing, world } from './world'
import type { World } from './world'

const EDIT = { skill: 'edit', text: 'the phases of an edit', source: 'plugin', pluginName: 'mod-builder', frontmatter: {} } as const
const LATEST = `${HOME}/.claude/mod-builder-data/v2/docs/latest`
const SPEC = `${MOD}/SPEC.md`
const TEST = `${MOD}/tests/pane.test.tsx`
const RESTORE = `${HOME}/.claude/mod-builder-data/v2/restore/s1/1970-01-01T000001Z`
const LOADED = `[DEBUG] hooks module ${NAME}@inline loaded (worker, environment 1, tier user); events: session.start\n`
const OLD_SPEC = '# turn-counter\n\nCounts turns.\n'
const SECTION = '\n## 0.1.1 (2026-11-11)\n\nCuts each row by display width.\n'
const NAMES = ['draws its line', 'opens the pane']
const AT_RED = 'mod-builder: still at phase 4 (Red)'
const READING = 'the test reader is reading the tests against the spec. End your turn now: its report is handed back to you, or mod-builder prompts you. Call the gate then, and not before.'

const gate = async ($: Engine, more: Record<string, unknown> = {}) => String((await $.tool.call({ tool: GATE, ...more } as never)).result)
const kept = (w: World) => w.store[`build:${MOD}`] as Record<string, unknown>

// A finished mod and a session with nothing open; the reader's turn is ended by the test itself.
const mod = (on: Parameters<typeof world>[0], more: Partial<World> = {}) =>
  world(on, {
    readerAnswer: null,
    runs: { validate: { exitCode: 0, stdout: 'Validation passed' }, test: { exitCode: 0, stdout: passing(2, NAMES) }, tsc: { exitCode: 0, stdout: '' }, '--plugin-dir': { exitCode: 0, stdout: '' }, restore: { exitCode: 0, stdout: `restore point: ${RESTORE}\n` } },
    ...more,
    files: {
      [LATEST]: '2026-11-10T151216Z\n', [SPEC]: OLD_SPEC, [`${MOD}/.claude-plugin/plugin.json`]: `{ "name": "${NAME}", "version": "0.1.0" }`,
      [`${MOD}/hooks/hooks.json`]: '{ "modules": ["./register.tsx"] }', [`${MOD}/hooks/register.tsx`]: 'the code', [TEST]: 'the first test', 'the load log': LOADED,
      ...more.files,
    },
  })
// From nothing to Red's gate: the edit opened and named, the change's section written and approved.
const toRed = async ($: Engine, w: World) => {
  await $.skill.prompt(EDIT)
  await gate($, { mod_dir: 'turn-counter' })
  for (const [path, text] of Object.entries(w.files)) if (path.startsWith(`${MOD}/`)) w.files[`${RESTORE}/${path.slice(MOD.length + 1)}`] = text
  await gate($)
  await gate($)
  w.files[SPEC] = `${OLD_SPEC}${SECTION}`
  await gate($)
}

const WIDTH = `${MOD}/tests/width.test.ts`
const NOT_READ = 'The tests have changed since that reading and have not been read as they are now.'
const finding = (what: string) => `VERDICT: FINDINGS\n- tests/width.test.ts: ${what}\n`

test('in an edit too, a third reading with findings whose tests were mended after its report asks the person and starts no fourth', async ($, on) => {
  const w = mod(on)
  await toRed($, w)
  w.files[WIDTH] = 'the new test'
  w.runs.test = { exitCode: 1, stdout: failing(NAMES, ['cuts by width']) }
  await gate($)
  await endReader($, 'reader-1', finding('no wide character is cut'))
  w.files[WIDTH] = 'mended after the first report'
  expect(await gate($)).toBe(`${AT_RED}: the tests changed after the test reader reported on them: that reading did not pass and counts as round 1; ${READING}`)
  await endReader($, 'reader-2', finding('no combining mark is cut'))
  w.files[WIDTH] = 'mended after the second report'
  expect(await gate($)).toBe(`${AT_RED}: the tests changed after the test reader reported on them: that reading did not pass and counts as round 2; ${READING}`)
  await endReader($, 'reader-3', finding('no emoji is cut'))
  w.files[WIDTH] = 'mended after the third report'
  // One question has been asked so far: Spec's approval.
  expect(w.asked.length).toBe(1)
  w.answer = 'Not yet'
  expect(await gate($)).toBe(`${AT_RED}. Not passed: the person has not agreed to go on with these tests (answer: "Not yet"). The next call of the gate has the tests read as they are now.`)
  expect(w.asked.length).toBe(2)
  expect((w.asked[1] as { question: string }).question).toBe(['The test reader has read the tests 3 times. The last time it found behaviours of the spec that no test would catch:', '- tests/width.test.ts: no emoji is cut', NOT_READ, 'The code is written next, to these tests. Go on with these tests?'].join('\n'))
  expect(w.spawned.length).toBe(3)
  expect(kept(w).phase).toBe('red')
})

test('in an edit too, a third round nobody could be asked about is asked about again when the tests were mended, and no fourth reading starts', async ($, on) => {
  const w = mod(on)
  await toRed($, w)
  w.files[WIDTH] = 'the new test'
  w.runs.test = { exitCode: 1, stdout: failing(NAMES, ['cuts by width']) }
  await gate($)
  await endReader($, 'reader-1', finding('no wide character is cut'))
  w.files[WIDTH] = 'mended after the first report'
  await gate($)
  await endReader($, 'reader-2', finding('no combining mark is cut'))
  w.files[WIDTH] = 'mended after the second report'
  await gate($)
  await endReader($, 'reader-3', finding('no emoji is cut'))
  w.answer = null
  expect(await gate($)).toBe(`${AT_RED}. Not passed: the person could not be asked whether to go on with these tests (the question was dismissed, or nobody is at this session).`)
  w.files[WIDTH] = 'mended after the question nobody answered'
  await gate($)
  // Spec's approval, the third round's question, and the same round's again.
  expect(w.asked.length).toBe(3)
  expect((w.asked[2] as { question: string }).question.includes(NOT_READ)).toBe(true)
  expect((w.asked[2] as { question: string }).question.includes('- tests/width.test.ts: no emoji is cut')).toBe(true)
  expect(w.spawned.length).toBe(3)
  expect(kept(w).phase).toBe('red')
})

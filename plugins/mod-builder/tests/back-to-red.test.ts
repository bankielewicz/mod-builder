// SPEC.md 9.11 and 9.30, through the hooks module itself: the way back from Green to Red. It is offered when
// Green's test run has failed twice in a row, taken only by a gate call with back_to_red and the person's own
// answer, and it writes nothing in the mod. The Red the work comes back to ends by rules of its own.
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { BUILT, GATE, HOME, MOD, NAME, failing, passing, world, readerDone } from './world'
import type { World } from './world'

const BUILD = { skill: 'build', text: 'the eight phases', source: 'plugin', pluginName: 'mod-builder', frontmatter: {} } as const
const LATEST = `${HOME}/.claude/mod-builder-data/v2/docs/latest`
const SPEC = `${MOD}/SPEC.md`
const LOADED = `[DEBUG] hooks module ${NAME}@inline loaded (worker, environment 1, tier user); events: session.start\n`
const PANE = `${MOD}/tests/pane.test.tsx`
const COUNTS = `${MOD}/tests/counts.test.tsx`
const CODE = `${MOD}/hooks/register.tsx`
const AT_GREEN = 'mod-builder: still at phase 6 (Green)'
const AT_RED = 'mod-builder: still at phase 5 (Red)'
const OFFER = 'If a test is what is wrong, call the gate with back_to_red: true: mod-builder then asks the person whether to go back to Red and change the tests.'
const NOT_OFFERED = 'back_to_red is offered only at Green, after its test run has failed 2 times in a row: nobody was asked, and nothing was moved.'
const QUESTION = 'Go back to Red to change the tests? Green\'s test run failed 2 times in a row. Failing: counts a turn.'
const BACK = 'mod-builder: back at phase 5 (Red): the person answered "Go back to Red" (return 1). Test files are open again and everything else is closed; nothing in the mod was changed. Change the tests that are wrong, then call the gate.'
const FAILS = { exitCode: 1, stdout: failing(['test 1'], ['counts a turn']) }
const PASSES = { exitCode: 0, stdout: passing(2, ['test 1', 'counts a turn']) }

const gate = async ($: Engine, more: Record<string, unknown> = {}) => readerDone($, String((await $.tool.call({ tool: GATE, ...more } as never)).result))
const first = (answer: string) => answer.split('\n')[0] as string
const kept = (w: World) => w.store[`build:${MOD}`] as Record<string, unknown> & { phase: string; testHashes: Record<string, string>; evidence: Record<string, string> }
const write = async ($: Engine, path: string, more: Record<string, unknown> = {}) => (await $.tool.call({ tool: 'Write', file_path: path, content: 'x', ...more } as never)).deny

const fresh = (on: Parameters<typeof world>[0], more: Partial<World> = {}) =>
  world(on, {
    ...more,
    files: { [LATEST]: '2026-11-10T151216Z\n', [SPEC]: '# turn-counter\n', [`${MOD}/.claude-plugin/plugin.json`]: `{ "name": "${NAME}" }`, [PANE]: 'the first test', 'the load log': LOADED, ...more.files },
  })

// A build walked through its gates to Green: two tests, one of them new at Red.
const toGreen = async ($: Engine, w: World, newTest = 'the new test') => {
  const order = ['knowledge', 'describe', 'spec', 'scaffold', 'red', 'green']
  // The answer a test set for its own question is kept for it: the spec is approved on the way.
  const later = w.answer
  w.answer = 'Approve'
  await $.skill.prompt(BUILD)
  await gate($, { mod_dir: 'turn-counter' })
  while (order.indexOf(kept(w).phase) < order.indexOf('green')) {
    const now = kept(w).phase
    if (now === 'red') {
      w.files[COUNTS] = newTest
      w.runs.test = FAILS
    }
    const answer = await gate($)
    if (kept(w).phase === now) throw new Error(`the walk stopped at ${now}: ${answer}`)
  }
  w.files[CODE] = 'the code written at Green'
  w.answer = later
}

// Green refused twice in a row for its test run, so that the way back is offered.
const offered = async ($: Engine, w: World) => {
  await toGreen($, w)
  w.runs.test = FAILS
  await gate($)
  await gate($)
}

// The work gone back to Red on the person's answer.
const wentBack = async ($: Engine, w: World) => {
  await offered($, w)
  const later = w.answer
  w.answer = 'Go back to Red'
  const answer = await gate($, { back_to_red: true })
  if (kept(w).phase !== 'red') throw new Error(`the work did not go back: ${answer}`)
  w.answer = later
}

// ------------------------------------------------------------------------------------------- the offer

test('Green\'s first refusal for its test run offers nothing; the second in a row ends with the offer', async ($, on) => {
  const w = fresh(on)
  await toGreen($, w)
  w.runs.test = FAILS
  expect(first(await gate($))).toBe(`${AT_GREEN}. Not passed: claude plugin test exited 1: not every test passes.`)
  expect(kept(w).greenTestRefusals).toBe(1)
  expect(first(await gate($))).toBe(`${AT_GREEN}. Not passed: claude plugin test exited 1: not every test passes. ${OFFER}`)
  expect(kept(w).greenTestRefusals).toBe(2)
  expect(first(await gate($))).toBe(`${AT_GREEN}. Not passed: claude plugin test exited 1: not every test passes. ${OFFER}`)
  expect(kept(w).greenTestRefusals).toBe(3)
  expect(w.asked.length).toBe(1)
})

test('a refusal for another reason starts the count again: validate, the typecheck or the load alone offer nothing', async ($, on) => {
  const w = fresh(on)
  await toGreen($, w)
  w.runs.test = FAILS
  await gate($)
  w.runs.validate = { exitCode: 1, stdout: 'the manifest is wrong' }
  expect((await gate($)).includes('back_to_red')).toBe(false)
  expect(kept(w).greenTestRefusals).toBe(0)
  w.runs.validate = { exitCode: 0, stdout: 'Validation passed' }
  expect((await gate($)).includes('back_to_red')).toBe(false)
  expect(kept(w).greenTestRefusals).toBe(1)
  w.runs.test = PASSES
  w.runs.tsc = { exitCode: 2, stdout: 'hooks/register.tsx(1,1): error TS2322\n' }
  expect((await gate($)).includes('back_to_red')).toBe(false)
  expect(kept(w).greenTestRefusals).toBe(0)
  w.runs.tsc = { exitCode: 0, stdout: '' }
  w.runs['--plugin-dir'] = { exitCode: 1, stdout: 'no' }
  expect((await gate($)).includes('back_to_red')).toBe(false)
  expect(kept(w).greenTestRefusals).toBe(0)
})

test('a Green that passes leaves no count, and the record of a build that never failed holds none', async ($, on) => {
  const w = fresh(on)
  await toGreen($, w)
  w.runs.test = PASSES
  expect(first(await gate($)).startsWith('mod-builder: phase 6 (Green) passed (')).toBe(true)
  expect('greenTestRefusals' in kept(w)).toBe(false)
})

test('a pass after a failed run clears the count', async ($, on) => {
  const w = fresh(on)
  await toGreen($, w)
  w.runs.test = FAILS
  await gate($)
  w.runs.test = PASSES
  await gate($)
  expect(kept(w).phase).toBe('verify')
  expect(kept(w).greenTestRefusals).toBe(0)
})

// -------------------------------------------------------------------------------------------- the call

test('back_to_red before it was offered asks nobody and moves nothing', async ($, on) => {
  const w = fresh(on, { answer: 'Go back to Red' })
  await toGreen($, w)
  const asked = w.asked.length
  expect(await gate($, { back_to_red: true })).toBe(`${AT_GREEN}. ${NOT_OFFERED}`)
  w.runs.test = FAILS
  await gate($)
  expect(await gate($, { back_to_red: true })).toBe(`${AT_GREEN}. ${NOT_OFFERED}`)
  expect(w.asked.length).toBe(asked)
  expect(kept(w).phase).toBe('green')
})

test('back_to_red at another phase asks nobody and runs no check of that phase', async ($, on) => {
  const w = fresh(on)
  await $.skill.prompt(BUILD)
  await gate($, { mod_dir: 'turn-counter' })
  await gate($)
  await gate($)
  expect(kept(w).phase).toBe('spec')
  const ran = w.ran.length
  expect(await gate($, { back_to_red: true })).toBe(`mod-builder: still at phase 3 (Spec). ${NOT_OFFERED}`)
  expect(w.asked.length).toBe(0)
  expect(w.ran.length).toBe(ran)
  expect(kept(w).phase).toBe('spec')
})

test('once offered, the call asks the person, "Not yet" first, naming the tests that fail; "Not yet" keeps Green', async ($, on) => {
  const w = fresh(on)
  await offered($, w)
  const asked = w.asked.length
  const ran = w.ran.length
  w.answer = 'Not yet'
  expect(await gate($, { back_to_red: true })).toBe(`${AT_GREEN}. Not passed: the person has not agreed to go back to Red (answer: "Not yet").`)
  expect(w.asked.slice(asked)).toEqual([{ question: QUESTION, options: ['Not yet', 'Go back to Red'] }])
  expect(w.ran.length).toBe(ran)
  expect(kept(w).phase).toBe('green')
  expect(kept(w).greenTestRefusals).toBe(2)
  expect(kept(w).returns).toBe(undefined)
})

test('any other answer keeps Green, and so does a question nobody answers', async ($, on) => {
  const w = fresh(on)
  await offered($, w)
  w.answers = ['Approve', null]
  expect(await gate($, { back_to_red: true })).toBe(`${AT_GREEN}. Not passed: the person has not agreed to go back to Red (answer: "Approve").`)
  expect(await gate($, { back_to_red: true })).toBe(`${AT_GREEN}. Not passed: the person could not be asked whether to go back to Red (the question was dismissed, or nobody is at this session).`)
  expect(kept(w).phase).toBe('green')
})

test('a test file changed since Red is Green\'s own refusal: the question is not asked', async ($, on) => {
  const w = fresh(on, { answer: 'Go back to Red' })
  await offered($, w)
  const asked = w.asked.length
  w.files[COUNTS] = 'changed by a shell command'
  expect((await gate($, { back_to_red: true })).startsWith(`${AT_GREEN}. Not passed: `)).toBe(true)
  expect(w.asked.length).toBe(asked)
  expect(kept(w).phase).toBe('green')
})

test('a test file changed while the person was asked keeps Green', async ($, on) => {
  const w = fresh(on, { answer: 'Go back to Red' })
  await offered($, w)
  w.whileAsked = () => {
    w.files[COUNTS] = 'changed while the question was open'
  }
  expect((await gate($, { back_to_red: true })).startsWith(`${AT_GREEN}. Not passed: `)).toBe(true)
  expect(kept(w).phase).toBe('green')
})

test('a build stopped while the person was asked is not moved', async ($, on) => {
  const w = fresh(on, { answer: 'Go back to Red' })
  await offered($, w)
  w.whileAsked = () => {
    w.store[`build:${MOD}`] = { ...kept(w), stopped: true }
  }
  expect((await gate($, { back_to_red: true })).includes('was stopped or moved while the person was asked, so nothing was moved')).toBe(true)
  expect(kept(w).phase).toBe('green')
  expect(w.store[`redcopy:${MOD}`]).toBe(undefined)
})

// ----------------------------------------------------------------------------------------- going back

test('"Go back to Red" puts the build at Red: the returns are counted, the test files\' text is kept, and nothing in the mod is written', async ($, on) => {
  const w = fresh(on)
  await offered($, w)
  const files = JSON.stringify(Object.entries(w.files).filter(([path]) => path.startsWith(`${MOD}/`)))
  const hashes = { ...kept(w).testHashes }
  w.answer = 'Go back to Red'
  expect(await gate($, { back_to_red: true })).toBe(BACK)
  expect(kept(w).phase).toBe('red')
  expect(kept(w).returns).toBe(1)
  expect(kept(w).redBefore).toEqual(hashes)
  expect(kept(w).greenTestRefusals).toBe(0)
  expect(kept(w).reader).toBe(null)
  expect(kept(w).readerRounds).toBe(0)
  expect(kept(w).readerLast).toBe(null)
  expect('attempt' in kept(w)).toBe(false)
  expect(w.store[`redcopy:${MOD}`]).toEqual({ 'tests/counts.test.tsx': 'the new test', 'tests/pane.test.tsx': 'the first test' })
  expect(JSON.stringify(Object.entries(w.files).filter(([path]) => path.startsWith(`${MOD}/`)))).toBe(files)
})

test('at the returned Red the test files are open and the code is closed, for the main model and for another agent', async ($, on) => {
  const w = fresh(on)
  await wentBack($, w)
  expect(await write($, COUNTS)).toBe(undefined)
  expect(await write($, COUNTS, { agentId: 'helper-1' })).toBe(undefined)
  expect(String(await write($, CODE)).startsWith('mod-builder: hooks/register.tsx can\'t be written')).toBe(true)
  expect(String(await write($, CODE, { agentId: 'helper-1' })).startsWith('mod-builder: hooks/register.tsx can\'t be written')).toBe(true)
  expect(String(await write($, SPEC)).startsWith('mod-builder: SPEC.md can\'t be written')).toBe(true)
})

// --------------------------------------------------------------------------------- how a returned Red ends

test('with no test file changed the returned Red is refused before anything is run', async ($, on) => {
  const w = fresh(on)
  await wentBack($, w)
  const ran = w.ran.length
  expect(await gate($)).toBe(`${AT_RED}. Not passed: no test file has changed since Red passed: the work came back to change a test.`)
  expect(w.ran.length).toBe(ran)
  expect(kept(w).phase).toBe('red')
})

test('hooks/ holds the code written at Green: the returned Red does not hold it to the template, and asks the script nothing', async ($, on) => {
  const w = fresh(on, { answer: 'Go on with these changes' })
  await wentBack($, w)
  w.runs.scaffold = { exitCode: 1, stdout: 'changed: hooks/register.tsx\nsource: lib/count.ts\n' }
  w.files[COUNTS] = 'the corrected test'
  w.runs.test = PASSES
  const ran = w.ran.length
  expect(first(await gate($)).startsWith('mod-builder: phase 5 (Red) passed (')).toBe(true)
  expect(w.ran.slice(ran).some((argv) => argv.some((word) => word.endsWith('scaffold.sh')))).toBe(false)
})

test('a corrected test may simply pass: the run need not fail, the person is asked about the changed file, the reader reads it alone, and Red passes with where it came from', async ($, on) => {
  const w = fresh(on, { answer: 'Go on with these changes' })
  await wentBack($, w)
  const asked = w.asked.length
  w.files[COUNTS] = 'the corrected test\nexpect(count).toBe(2)\n'
  w.runs.test = PASSES
  const answer = first(await gate($))
  expect(answer).toMatch(/^mod-builder: phase 5 \(Red\) passed \(2 tests ran, all passing; the typecheck passes \(types sha256 [0-9a-f]{64}\); 2 test files hashed, not as at the Red before: tests\/counts\.test\.tsx; the person answered "Go on with these changes" for: tests\/counts\.test\.tsx \(changed\); the test reader passed the tests \(round 1\); back from Green \(return 1\)\)\. The build is now at phase 6 \(Green\)\.$/)
  expect(w.asked.length).toBe(asked + 1)
  expect((w.asked.at(-1) as { question: string }).question.includes('tests/counts.test.tsx')).toBe(true)
  expect((w.asked.at(-1) as { options: string[] }).options[0]).toBe('Not yet')
  expect((w.spawned.at(-1) as { prompt: string }).prompt.split('\n').filter((line) => line.startsWith('- '))).toEqual([`- ${COUNTS}`])
  expect(kept(w).phase).toBe('green')
  expect(kept(w).returns).toBe(1)
})

test('"Not yet" to the question about the changed test holds the returned Red, and starts no reader', async ($, on) => {
  const w = fresh(on, { answer: 'Not yet' })
  await wentBack($, w)
  const spawned = w.spawned.length
  w.answer = 'Not yet'
  w.files[COUNTS] = 'the corrected test'
  w.runs.test = PASSES
  expect((await gate($)).startsWith(`${AT_RED}. Not passed: `)).toBe(true)
  expect(w.spawned.length).toBe(spawned)
  expect(kept(w).phase).toBe('red')
})

test('a test file that is new raises no question, and a failing run passes when a test fails by assertion', async ($, on) => {
  const w = fresh(on)
  await wentBack($, w)
  const asked = w.asked.length
  w.files[`${MOD}/tests/more.test.tsx`] = 'another test'
  w.runs.test = { exitCode: 1, stdout: failing(['test 1', 'counts a turn'], ['counts two turns']) }
  expect(first(await gate($))).toMatch(/^mod-builder: phase 5 \(Red\) passed \(3 tests ran, 1 failing; /)
  expect(w.asked.length).toBe(asked)
  expect(kept(w).testsAtRed).toBe(3)
  expect(Object.keys(kept(w).testHashes).sort()).toEqual(['tests/counts.test.tsx', 'tests/more.test.tsx', 'tests/pane.test.tsx'])
})

test('a run whose failures are all thrown errors is refused: the tests are broken, not strict', async ($, on) => {
  const w = fresh(on, { answer: 'Go on with these changes' })
  await wentBack($, w)
  w.files[COUNTS] = 'the corrected test'
  w.runs.test = { exitCode: 1, stdout: failing(['test 1'], ['counts a turn'], 'TypeError: undefined is not a function') }
  expect(first(await gate($))).toBe(`${AT_RED}. Not passed: no failing test fails by assertion: counts a turn.`)
  expect(kept(w).phase).toBe('red')
})

test('a test file that does not load is refused', async ($, on) => {
  const w = fresh(on, { answer: 'Go on with these changes' })
  await wentBack($, w)
  w.files[COUNTS] = 'the corrected test'
  w.runs.test = { exitCode: 1, stdout: failing(['test 1'], ['the file did not load'], 'SyntaxError: Unexpected token') }
  expect(first(await gate($))).toBe(`${AT_RED}. Not passed: a test file did not load.`)
})

test('the returned Red ends on the typecheck too, with the compiler\'s lines', async ($, on) => {
  const w = fresh(on, { answer: 'Go on with these changes' })
  await wentBack($, w)
  w.files[COUNTS] = 'the corrected test'
  w.runs.test = PASSES
  w.runs.tsc = { exitCode: 2, stdout: `${MOD}/tests/counts.test.tsx(1,1): error TS2322: no\n` }
  const answer = await gate($)
  expect(first(answer).startsWith(`${AT_RED}. Not passed: the typecheck exited 2`)).toBe(true)
  expect(answer.includes('error TS2322')).toBe(true)
  expect(kept(w).phase).toBe('red')
})

test('the reader\'s findings hold the returned Red as they hold any Red', async ($, on) => {
  const w = fresh(on, { answer: 'Go on with these changes' })
  await wentBack($, w)
  w.readerAnswer = 'VERDICT: FINDINGS\n- tests/counts.test.tsx: a second turn is never counted\n'
  w.files[COUNTS] = 'the corrected test'
  w.runs.test = PASSES
  expect(first(await gate($))).toBe(`${AT_RED}. Not passed: the test reader found behaviours of the spec that no test would catch (round 1). Change the tests and call the gate again, which starts another reading; after 2 rounds that do not pass, the person is asked.`)
  expect(kept(w).phase).toBe('red')
})

test('after the returned Red, Green holds the run to the new count and the new hashes', async ($, on) => {
  const w = fresh(on, { answer: 'Go on with these changes' })
  await wentBack($, w)
  w.files[`${MOD}/tests/more.test.tsx`] = 'another test'
  w.runs.test = { exitCode: 1, stdout: failing(['test 1', 'counts a turn'], ['counts two turns']) }
  await gate($)
  expect(kept(w).phase).toBe('green')
  w.runs.test = PASSES
  expect(first(await gate($))).toBe(`${AT_GREEN}. Not passed: the run has 2 tests, fewer than the 3 at Red.`)
  w.files[`${MOD}/tests/more.test.tsx`] = 'changed at Green'
  w.runs.test = { exitCode: 0, stdout: passing(3, ['test 1', 'counts a turn', 'counts two turns']) }
  expect((await gate($)).startsWith(`${AT_GREEN}. Not passed: `)).toBe(true)
  w.files[`${MOD}/tests/more.test.tsx`] = 'another test'
  expect(first(await gate($)).startsWith('mod-builder: phase 6 (Green) passed (')).toBe(true)
})

test('a second return is counted, and from the third the question says how often the build went back', async ($, on) => {
  const w = fresh(on, { answer: 'Go on with these changes' })
  await wentBack($, w)
  for (const [turn, text] of [[2, 'corrected once'], [3, 'corrected twice']] as const) {
    w.answer = 'Go on with these changes'
    w.files[COUNTS] = text
    w.runs.test = PASSES
    await gate($)
    expect(kept(w).phase).toBe('green')
    w.runs.test = FAILS
    await gate($)
    await gate($)
    w.answer = 'Go back to Red'
    expect(first(await gate($, { back_to_red: true }))).toBe(BACK.replace('(return 1)', `(return ${turn})`))
    expect(kept(w).returns).toBe(turn)
    expect((w.asked.at(-1) as { question: string }).question).toBe(`${turn === 3 ? 'This build has gone back to Red 2 times already. ' : ''}${QUESTION}`)
  }
  expect(w.store[`redcopy:${MOD}`]).toEqual({ 'tests/counts.test.tsx': 'corrected twice', 'tests/pane.test.tsx': 'the first test' })
})

test('a build that went back still reaches Done, and its Red evidence says where it came from', async ($, on) => {
  const w = fresh(on, { answer: 'Go on with these changes' })
  await wentBack($, w)
  w.files[COUNTS] = 'the corrected test'
  w.runs.test = PASSES
  await gate($)
  await gate($)
  expect(kept(w).phase).toBe('verify')
  w.files[SPEC] = `${w.files[SPEC]}${BUILT}`
  await gate($)
  expect(kept(w).phase).toBe('done')
  expect(String(kept(w).evidence.red).endsWith('back from Green (return 1)')).toBe(true)
  expect(kept(w).returns).toBe(1)
})

test('the status line says the build is back from Green, with the count of returns', async ($, on) => {
  const w = fresh(on)
  await wentBack($, w)
  const DOT = String.fromCharCode(0xb7)
  expect(String(w.statuses.at(-1)).includes(`red ${DOT} back from Green ${DOT} return 1`)).toBe(true)
})

// ------------------------------------------------------------------------- the question at a returned Red

test('a question about the changed test that nobody answers holds the returned Red, as any answer but the approving one does', async ($, on) => {
  const w = fresh(on)
  await wentBack($, w)
  const spawned = w.spawned.length
  w.answer = null
  w.files[COUNTS] = 'the corrected test'
  w.runs.test = PASSES
  expect(await gate($)).toBe(`${AT_RED}. Not passed: the person could not be asked about the changed test files (the question was dismissed, or nobody is at this session).`)
  expect(kept(w).phase).toBe('red')
  expect(w.spawned.length).toBe(spawned)
  expect(kept(w).testsAgreed).toBe(undefined)
})

test('in a build the question says the tests are not as they were when Red passed, and its removed lines come from the copy kept, not from the disk', async ($, on) => {
  const w = fresh(on, { answer: 'Not yet' })
  // The test as Red recorded it holds an expect: its removal is what the person must see.
  await toGreen($, w, 'the new test\nexpect(count).toBe(1)\n')
  w.runs.test = FAILS
  await gate($)
  await gate($)
  w.answer = 'Go back to Red'
  await gate($, { back_to_red: true })
  expect(kept(w).phase).toBe('red')
  w.answer = 'Not yet'
  // The file is changed twice: what was removed is told against the copy, whatever the disk held in between.
  w.files[COUNTS] = 'a draft in between\nexpect(count).toBe(9)\n'
  w.files[COUNTS] = 'the corrected test\n'
  w.runs.test = PASSES
  await gate($)
  const question = (w.asked.at(-1) as { question: string }).question
  expect(question.split('\n')[0]).toBe('These test files are not as they were when Red passed:')
  expect(question.includes('before this edit')).toBe(false)
  expect(question.includes('- tests/counts.test.tsx: 1 line added, 2 lines removed')).toBe(true)
  expect(question.includes('    removed: expect(count).toBe(1)')).toBe(true)
  expect(question.includes('toBe(9)')).toBe(false)
  expect(question.split('\n').at(-1)).toBe('Go on with these changes?')
})

test('a test name that is gone from a changed file is listed as no longer existing', async ($, on) => {
  const w = fresh(on, { answer: 'Not yet' })
  await wentBack($, w)
  w.answer = 'Not yet'
  w.files[COUNTS] = 'the corrected test'
  w.runs.test = { exitCode: 0, stdout: passing(2, ['test 1', 'counts two turns']) }
  await gate($)
  expect((w.asked.at(-1) as { question: string }).question.includes('These tests no longer exist: counts a turn')).toBe(true)
})

test('a test file that was deleted is asked about as gone, and the reader is given the files that are left', async ($, on) => {
  const w = fresh(on, { answer: 'Go on with these changes' })
  await wentBack($, w)
  delete w.files[COUNTS]
  w.runs.test = { exitCode: 0, stdout: passing(1) }
  const answer = first(await gate($))
  expect((w.asked.at(-1) as { question: string }).question.includes('- tests/counts.test.tsx: gone (1 line removed)')).toBe(true)
  expect(answer.includes('the person answered "Go on with these changes" for: tests/counts.test.tsx (gone)')).toBe(true)
  expect((w.spawned.at(-1) as { prompt: string }).prompt.split('\n').filter((line) => line.startsWith('- '))).toEqual([`- ${PANE}`])
  expect(Object.keys(kept(w).testHashes)).toEqual(['tests/pane.test.tsx'])
})

test('a changed file the kept copy does not hold can\'t be shown: Red is refused and says which', async ($, on) => {
  const w = fresh(on, { answer: 'Go on with these changes' })
  await wentBack($, w)
  w.store[`redcopy:${MOD}`] = { 'tests/pane.test.tsx': 'the first test' }
  w.files[COUNTS] = 'the corrected test'
  w.runs.test = PASSES
  expect(await gate($)).toBe(`${AT_RED}. Not passed: tests/counts.test.tsx is not in the copy kept when the work went back to Red, so the person can't be shown what changed.`)
})

test('a test edited again after the person agreed and the reader found something is asked about again', async ($, on) => {
  const w = fresh(on, { answer: 'Go on with these changes' })
  await wentBack($, w)
  w.readerAnswer = 'VERDICT: FINDINGS\n- tests/counts.test.tsx: a second turn is never counted\n'
  w.files[COUNTS] = 'the corrected test'
  w.runs.test = PASSES
  await gate($)
  const asked = w.asked.length
  // The same file as agreed: not asked about again.
  await gate($)
  expect(w.asked.length).toBe(asked)
  w.files[COUNTS] = 'the corrected test, corrected again'
  w.readerAnswer = 'VERDICT: PASS'
  expect(first(await gate($)).startsWith('mod-builder: phase 5 (Red) passed (')).toBe(true)
  expect(w.asked.length).toBe(asked + 1)
  expect((w.asked.at(-1) as { question: string }).question.includes('tests/counts.test.tsx')).toBe(true)
})

test('SPEC.md changed at a returned Red refuses it, before the run and after it', async ($, on) => {
  const w = fresh(on, { answer: 'Go on with these changes' })
  await wentBack($, w)
  const approved = w.files[SPEC] as string
  w.files[COUNTS] = 'the corrected test'
  w.runs.test = PASSES
  w.files[SPEC] = 'rewritten'
  const ran = w.ran.length
  expect((await gate($)).startsWith(`${AT_RED}. Not passed: `)).toBe(true)
  expect(w.ran.length).toBe(ran)
  w.files[SPEC] = approved
  w.whileRunning = (argv) => {
    if (argv.includes('--noEmit')) w.files[SPEC] = 'rewritten while the checks ran'
  }
  expect((await gate($)).startsWith(`${AT_RED}. Not passed: `)).toBe(true)
  expect(kept(w).phase).toBe('red')
})

test('a test file changed while the returned Red\'s checks ran refuses at the end', async ($, on) => {
  const w = fresh(on, { answer: 'Go on with these changes' })
  await wentBack($, w)
  w.files[COUNTS] = 'the corrected test'
  w.runs.test = PASSES
  w.whileRunning = (argv) => {
    if (argv.includes('--noEmit')) w.files[COUNTS] = 'changed while the compiler ran'
  }
  expect(await gate($)).toBe(`${AT_RED}. Not passed: the test files changed while Red's checks ran: ask again.`)
})

test('a link where a test file goes is refused at a returned Red as at any Red', async ($, on) => {
  const w = fresh(on)
  await wentBack($, w)
  w.files[`${MOD}/tests/linked.test.tsx`] = 'elsewhere'
  w.links = [`${MOD}/tests/linked.test.tsx`]
  expect((await gate($)).startsWith(`${AT_RED}. Not passed: tests/linked.test.tsx is a link or no file`)).toBe(true)
})

test('a run of no test is refused at a returned Red', async ($, on) => {
  const w = fresh(on, { answer: 'Go on with these changes' })
  await wentBack($, w)
  w.files[COUNTS] = 'the corrected test'
  w.runs.test = { exitCode: 0, stdout: passing(0) }
  expect(first(await gate($))).toBe(`${AT_RED}. Not passed: the test run ran no test.`)
})

// ------------------------------------------------------------------------------------- who may ask, and when

test('back_to_red that is not true is no such call: the gate runs Green\'s checks as ever', async ($, on) => {
  const w = fresh(on)
  await offered($, w)
  const asked = w.asked.length
  for (const value of ['true', 1, 'yes', null]) {
    expect(first(await gate($, { back_to_red: value }))).toBe(`${AT_GREEN}. Not passed: claude plugin test exited 1: not every test passes. ${OFFER}`)
  }
  expect(w.asked.length).toBe(asked)
  expect(kept(w).phase).toBe('green')
})

test('a stopped build asked to go back is told it was stopped, and nobody is asked', async ($, on) => {
  const w = fresh(on, { answer: 'Go back to Red' })
  await offered($, w)
  const asked = w.asked.length
  w.store[`build:${MOD}`] = { ...kept(w), stopped: true }
  expect((await gate($, { back_to_red: true })).startsWith(`mod-builder: the build of ${MOD} was stopped.`)).toBe(true)
  expect(w.asked.length).toBe(asked)
})

test('another agent of the session that calls the gate with back_to_red gets the person\'s question and no more: the answer decides', async ($, on) => {
  const w = fresh(on)
  await offered($, w)
  const asked = w.asked.length
  w.answer = 'Not yet'
  expect(String((await $.tool.call({ tool: GATE, back_to_red: true, agentId: 'helper-1' } as never)).result)).toBe(`${AT_GREEN}. Not passed: the person has not agreed to go back to Red (answer: "Not yet").`)
  expect(w.asked.length).toBe(asked + 1)
  expect(kept(w).phase).toBe('green')
})

test('the way back is Green\'s alone: Verify\'s refusals for its test run are not counted and offer nothing', async ($, on) => {
  const w = fresh(on)
  await toGreen($, w)
  w.runs.test = PASSES
  await gate($)
  expect(kept(w).phase).toBe('verify')
  w.files[SPEC] = `${w.files[SPEC]}${BUILT}`
  w.runs.test = FAILS
  for (const _ of [1, 2, 3]) expect((await gate($)).includes('back_to_red')).toBe(false)
  expect(kept(w).greenTestRefusals).toBe(undefined)
  expect(await gate($, { back_to_red: true })).toBe(`mod-builder: still at phase 7 (Verify). ${NOT_OFFERED}`)
})

test('going back clears what the reader and the person left at the Red before, and the count of Green\'s refusals', async ($, on) => {
  const w = fresh(on)
  await offered($, w)
  w.store[`build:${MOD}`] = { ...kept(w), reader: { agentId: 'reader-9', startedAt: 1, hashes: {} }, readerRounds: 2, readerLast: { hashes: {}, findings: ['x'] }, testsAgreed: { 'tests/pane.test.tsx': 'missing' } }
  w.answer = 'Go back to Red'
  await gate($, { back_to_red: true })
  expect(kept(w).phase).toBe('red')
  expect(kept(w).reader).toBe(null)
  expect(kept(w).readerRounds).toBe(0)
  expect(kept(w).readerLast).toBe(null)
  expect('testsAgreed' in kept(w)).toBe(false)
  expect(kept(w).greenTestRefusals).toBe(0)
})

test('after a return Green counts its refusals anew and holds the run to the new names', async ($, on) => {
  const w = fresh(on, { answer: 'Go on with these changes' })
  await wentBack($, w)
  w.files[COUNTS] = 'the corrected test'
  w.runs.test = { exitCode: 0, stdout: passing(2, ['test 1', 'counts two turns']) }
  await gate($)
  expect(kept(w).phase).toBe('green')
  expect(kept(w).namesAtRed).toEqual(['test 1', 'counts two turns'])
  w.runs.test = { exitCode: 1, stdout: failing(['test 1'], ['counts two turns']) }
  expect(first(await gate($))).toBe(`${AT_GREEN}. Not passed: claude plugin test exited 1: not every test passes.`)
  expect(kept(w).greenTestRefusals).toBe(1)
  expect(first(await gate($)).endsWith(OFFER)).toBe(true)
})

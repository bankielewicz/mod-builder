// SPEC.md 9.36, through the hooks module itself: a reading that was left behind or is out of date is followed by
// a new one in the same call only as round 1 or 2. As round 3 or later it starts nothing: the person is asked,
// and told that the tests have changed since that reading. So after two rounds that did not pass, changed tests
// are read once more as they stand, and a fourth reading is never started before the person has answered.
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { GATE, MOD, NAME, TYPES, TYPES_TEXT, endReader, failing, world } from './world'
import type { World } from './world'

const SPEC = `${MOD}/SPEC.md`
const APPROVED = '# turn-counter\n'
const PANE = `${MOD}/tests/pane.test.tsx`
const AT_RED = 'mod-builder: still at phase 5 (Red)'
const READING = 'the test reader is reading the tests against the spec. End your turn now: its report is handed back to you, or mod-builder prompts you. Call the gate then, and not before.'
const NOT_READ = 'The tests have changed since that reading and have not been read as they are now.'
const LAST_LINE = 'The code is written next, to these tests. Go on with these tests?'
const FIRST = 'VERDICT: FINDINGS\n- tests/pane.test.tsx: no test counts a second turn\n'
const SECOND = 'VERDICT: FINDINGS\n- SPEC.md: the reset on /clear is never tested\n'
const THIRD = 'VERDICT: FINDINGS\n- tests/pane.test.tsx: the empty log is never drawn\n'
const FOURTH = 'VERDICT: FINDINGS\n- tests/pane.test.tsx: a turn that fails is never counted\n'

const sha256 = async (text: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

// A build that stands at Red with a new test failing by assertion; the reader's turn is ended by the test itself.
const atRed = async (on: Parameters<typeof world>[0], more: Partial<World> = {}) => {
  const w = world(on, {
    readerAnswer: null, ...more,
    files: { [SPEC]: APPROVED, [`${MOD}/.claude-plugin/plugin.json`]: `{ "name": "${NAME}" }`, [PANE]: 'the first test', [TYPES]: TYPES_TEXT, ...more.files },
  })
  w.runs.test = { exitCode: 1, stdout: failing(['test 1'], ['counts a turn']) }
  w.store['session:s1'] = { modDir: MOD }
  w.store[`build:${MOD}`] = {
    modDir: MOD, sessionId: 's1', phase: 'red', specApprovedAt: 1, spec: { length: APPROVED.length, hash: await sha256(APPROVED) },
    testsAtScaffold: 1, namesAtScaffold: ['test 1'], testsAtRed: null, testHashes: null, evidence: { knowledge: 'snapshot 2026-11-10T151216Z' },
  }
  return w
}
const gate = async ($: Engine) => String((await $.tool.call({ tool: GATE } as never)).result)
const kept = (w: World) => w.store[`build:${MOD}`] as Record<string, unknown> & { reader?: { agentId: string } | null; readerLast?: { findings: string[] | null; changed?: boolean } | null; evidence: Record<string, string> }
// The tests are changed, as a model mends them after it was handed a report: before it calls the gate.
const mend = (w: World, text: string) => {
  w.files[PANE] = text
}
const question = (w: World, index: number) => (w.asked[index] as { question: string } | undefined)?.question ?? ''
// Two rounds that did not pass, each counted because the tests were mended after its report, and a third reading
// started: what a model does that is handed every report.
const twoRoundsMended = async ($: Engine, w: World) => {
  await gate($)
  await endReader($, 'reader-1', FIRST)
  mend(w, 'mended after the first report')
  await gate($)
  await endReader($, 'reader-2', SECOND)
  mend(w, 'mended after the second report')

  return gate($)
}

test('a third reading with findings whose tests were mended after its report asks the person, says the tests changed since, and starts no fourth', async ($, on) => {
  const w = await atRed(on, { answer: 'Not yet' })
  await twoRoundsMended($, w)
  await endReader($, 'reader-3', THIRD)
  mend(w, 'mended after the third report')
  expect(await gate($)).toBe(`${AT_RED}. Not passed: the person has not agreed to go on with these tests (answer: "Not yet"). The next call of the gate has the tests read as they are now.`)
  expect(w.asked.length).toBe(1)
  expect(question(w, 0)).toBe(['The test reader has read the tests 3 times. The last time it found behaviours of the spec that no test would catch:', '- tests/pane.test.tsx: the empty log is never drawn', NOT_READ, LAST_LINE].join('\n'))
  expect(w.asked[0]?.options).toEqual(['Not yet', 'Go on with these tests'])
  expect(w.spawned.length).toBe(3)
  expect(kept(w).phase).toBe('red')
  expect(kept(w).readerRounds).toBe(3)
  expect(kept(w).reader).toBe(null)
  expect(kept(w).readerLast?.findings).toEqual(['tests/pane.test.tsx: the empty log is never drawn'])
})

test('a third reading left behind while it read asks the person too, with no verdict to show, and starts no fourth', async ($, on) => {
  const w = await atRed(on, { answer: 'Not yet' })
  await twoRoundsMended($, w)
  mend(w, 'changed by a shell command while the third reader read')
  expect(await gate($)).toBe(`${AT_RED}. Not passed: the person has not agreed to go on with these tests (answer: "Not yet"). The next call of the gate has the tests read as they are now.`)
  expect(question(w, 0)).toBe(['The test reader has read the tests 3 times and gave no verdict the last time.', NOT_READ, LAST_LINE].join('\n'))
  expect(w.asked.length).toBe(1)
  expect(w.spawned.length).toBe(3)
  expect(kept(w).readerRounds).toBe(3)
  expect(kept(w).readerLast?.changed).toBe(true)
})

test('a third reading that gave no verdict line, its tests mended after it, asks the person and starts no fourth', async ($, on) => {
  const w = await atRed(on, { answer: 'Not yet' })
  await twoRoundsMended($, w)
  await endReader($, 'reader-3', 'These tests look thin to me.')
  mend(w, 'mended after a report with no verdict')
  await gate($)
  expect(question(w, 0)).toBe(['The test reader has read the tests 3 times and gave no verdict the last time.', NOT_READ, LAST_LINE].join('\n'))
  expect(w.spawned.length).toBe(3)
})

test('after "Not yet" the next call of the gate has the tests read as they are, and what that reading finds asks the person again', async ($, on) => {
  const w = await atRed(on, { answer: 'Not yet' })
  await twoRoundsMended($, w)
  await endReader($, 'reader-3', THIRD)
  mend(w, 'mended after the third report')
  await gate($)
  expect(await gate($)).toBe(`${AT_RED}: ${READING}`)
  expect(w.spawned.length).toBe(4)
  expect(w.asked.length).toBe(1)
  await endReader($, 'reader-4', FOURTH)
  expect(await gate($)).toBe(`${AT_RED}. Not passed: the person has not agreed to go on with these tests (answer: "Not yet").`)
  expect(question(w, 1)).toBe(['The test reader has read the tests 4 times. The last time it found behaviours of the spec that no test would catch:', '- tests/pane.test.tsx: a turn that fails is never counted', LAST_LINE].join('\n'))
  expect(w.spawned.length).toBe(4)
})

test('a fourth reading whose tests were mended after its report asks again and starts no fifth: no round ends unseen from the third on', async ($, on) => {
  const w = await atRed(on, { answer: 'Not yet' })
  await twoRoundsMended($, w)
  await endReader($, 'reader-3', THIRD)
  mend(w, 'mended after the third report')
  await gate($)
  await gate($)
  await endReader($, 'reader-4', FOURTH)
  mend(w, 'mended after the fourth report')
  await gate($)
  expect(w.asked.length).toBe(2)
  expect(question(w, 1).includes('has read the tests 4 times')).toBe(true)
  expect(question(w, 1).includes(NOT_READ)).toBe(true)
  expect(w.spawned.length).toBe(4)
})

test('"Go on with these tests" after such a question passes Red with the tests as they are, and the evidence says they were not read as they are', async ($, on) => {
  const w = await atRed(on, { answer: 'Go on with these tests' })
  await twoRoundsMended($, w)
  await endReader($, 'reader-3', THIRD)
  // What the third reader was started on: the tests as they were after the second report.
  const read = JSON.stringify((kept(w).reader as unknown as { hashes: Record<string, string> }).hashes)
  mend(w, 'mended after the third report')
  const answer = await gate($)
  expect(answer.includes('the person answered "Go on with these tests" after 3 rounds of the test reader (the last: 1 finding; the tests changed after it and were not read as they are)')).toBe(true)
  expect(kept(w).phase).toBe('green')
  // Red's hashes are the tests the person went on with, not the ones the reader read.
  expect(Object.keys(kept(w).testHashes as Record<string, string>).length).toBe(1)
  expect(JSON.stringify(kept(w).testHashes) === read).toBe(false)
  expect(w.spawned.length).toBe(3)
})

test('with nobody to ask, Red stays, nothing is started and nothing is written down: the next call asks again', async ($, on) => {
  const w = await atRed(on, { answer: null })
  await twoRoundsMended($, w)
  await endReader($, 'reader-3', THIRD)
  mend(w, 'mended after the third report')
  const before = JSON.stringify(kept(w))
  expect(await gate($)).toBe(`${AT_RED}. Not passed: the person could not be asked whether to go on with these tests (the question was dismissed, or nobody is at this session).`)
  expect(w.spawned.length).toBe(3)
  expect(JSON.stringify({ ...kept(w), attempt: undefined })).toBe(JSON.stringify({ ...(JSON.parse(before) as Record<string, unknown>), attempt: undefined }))
  await gate($)
  expect(w.asked.length).toBe(2)
  expect(question(w, 1).includes('has read the tests 3 times')).toBe(true)
  expect(w.spawned.length).toBe(3)
  expect(kept(w).phase).toBe('red')
})

test('tests that change while the person is asked are not passed, and the next call asks again without starting a reading', async ($, on) => {
  const w = await atRed(on, { answer: 'Go on with these tests' })
  await twoRoundsMended($, w)
  await endReader($, 'reader-3', THIRD)
  mend(w, 'mended after the third report')
  w.whileAsked = () => mend(w, 'changed while the question was open')
  expect(await gate($)).toBe(`${AT_RED}. Not passed: the test files changed while the person was being asked: ask again.`)
  w.whileAsked = () => {}
  expect(kept(w).phase).toBe('red')
  expect(w.spawned.length).toBe(3)
  expect((await gate($)).includes('the tests changed after it and were not read as they are')).toBe(true)
  expect(w.asked.length).toBe(2)
  expect(w.spawned.length).toBe(3)
  expect(kept(w).phase).toBe('green')
})

test('after "Not yet" to such a question the status line shows the round and what it found', async ($, on) => {
  const w = await atRed(on, { answer: 'Not yet' })
  await twoRoundsMended($, w)
  await endReader($, 'reader-3', THIRD)
  mend(w, 'mended after the third report')
  await gate($)
  expect(String(w.statuses.at(-1)).includes('test reader: round 3 did not pass \u00b7 1 finding')).toBe(true)
})

// ------------------------------------- once three rounds are counted, no reading before the person has answered

test('a third round with findings that nobody could be asked about, the tests then mended: the next call asks, says the tests changed since, and starts no fourth', async ($, on) => {
  const w = await atRed(on, { answer: null })
  await twoRoundsMended($, w)
  await endReader($, 'reader-3', THIRD)
  expect(await gate($)).toBe(`${AT_RED}. Not passed: the person could not be asked whether to go on with these tests (the question was dismissed, or nobody is at this session).`)
  expect(kept(w).readerRounds).toBe(3)
  mend(w, 'mended after the question nobody answered')
  await gate($)
  expect(w.asked.length).toBe(2)
  expect(question(w, 1)).toBe(['The test reader has read the tests 3 times. The last time it found behaviours of the spec that no test would catch:', '- tests/pane.test.tsx: the empty log is never drawn', NOT_READ, LAST_LINE].join('\n'))
  expect(w.spawned.length).toBe(3)
  // Asked again and again, as long as nobody answers: never a reading.
  mend(w, 'mended once more')
  await gate($)
  expect(w.asked.length).toBe(3)
  expect(w.spawned.length).toBe(3)
  // The person's "Not yet" is what lets the next call start one.
  w.answer = 'Not yet'
  await gate($)
  expect(w.spawned.length).toBe(3)
  expect(await gate($)).toBe(`${AT_RED}: ${READING}`)
  expect(w.spawned.length).toBe(4)
})

test('a third round that ran out of time and that nobody could be asked about: mended tests are not read before the person has answered', async ($, on) => {
  const w = await atRed(on, { answer: null })
  await twoRoundsMended($, w)
  w.now += 600001
  await gate($)
  expect(w.asked.length).toBe(1)
  expect(kept(w).readerRounds).toBe(3)
  mend(w, 'mended after the reader ran out of time')
  await gate($)
  expect(w.asked.length).toBe(2)
  expect(question(w, 1)).toBe(['The test reader has read the tests 3 times and gave no verdict the last time.', NOT_READ, LAST_LINE].join('\n'))
  expect(w.spawned.length).toBe(3)
})

test('a third round because the reader could not be started, nobody to ask: mended tests are not read before the person has answered', async ($, on) => {
  const w = await atRed(on, { answer: null })
  await gate($)
  await endReader($, 'reader-1', FIRST)
  mend(w, 'mended after the first report')
  await gate($)
  await endReader($, 'reader-2', SECOND)
  mend(w, 'mended after the second report')
  w.spawnAnswer = { deny: 'another plugin said no' }
  await gate($)
  expect(kept(w).readerRounds).toBe(3)
  expect(w.asked.length).toBe(1)
  w.spawnAnswer = null
  mend(w, 'mended after the reader that did not start')
  await gate($)
  expect(w.asked.length).toBe(2)
  expect(question(w, 1).includes(NOT_READ)).toBe(true)
  expect(w.spawned.length).toBe(2)
})

test('an answer that is neither label is no answer: mended tests are still not read', async ($, on) => {
  const w = await atRed(on, { answer: 'Maybe later' })
  await twoRoundsMended($, w)
  await endReader($, 'reader-3', THIRD)
  await gate($)
  expect(kept(w).readerAnswered === true).toBe(false)
  mend(w, 'mended after an answer that was none')
  await gate($)
  expect(w.asked.length).toBe(2)
  expect(question(w, 1).includes(NOT_READ)).toBe(true)
  expect(w.spawned.length).toBe(3)
})

test('"Not yet" lets one reading start and no more: the record says so until that reading starts', async ($, on) => {
  const w = await atRed(on, { answer: 'Not yet' })
  await twoRoundsMended($, w)
  await endReader($, 'reader-3', THIRD)
  await gate($)
  expect(kept(w).readerAnswered).toBe(true)
  mend(w, 'mended after "Not yet"')
  expect(await gate($)).toBe(`${AT_RED}: ${READING}`)
  expect(kept(w).readerAnswered).toBe(false)
  expect(w.spawned.length).toBe(4)
  expect(w.asked.length).toBe(1)
})

test('a pass that is out of date once three rounds are counted starts nothing: the person is asked, and told the reader passed the tests as they were', async ($, on) => {
  const w = await atRed(on, { answer: 'Not yet' })
  await twoRoundsMended($, w)
  await endReader($, 'reader-3', THIRD)
  await gate($)
  mend(w, 'mended after "Not yet"')
  await gate($)
  await endReader($, 'reader-4', 'VERDICT: PASS')
  mend(w, 'changed after the fourth reader passed')
  expect(await gate($)).toBe(`${AT_RED}. Not passed: the person has not agreed to go on with these tests (answer: "Not yet"). The next call of the gate has the tests read as they are now.`)
  expect(w.asked.length).toBe(2)
  expect(question(w, 1)).toBe(['The test reader has read the tests 4 times and passed them the last time, as they were then.', NOT_READ, LAST_LINE].join('\n'))
  expect(w.spawned.length).toBe(4)
  expect(kept(w).readerRounds).toBe(3)
  expect(kept(w).phase).toBe('red')
})

test('"Go on with these tests" after such a pass passes Red, and the evidence says the pass was for the tests as they were', async ($, on) => {
  const w = await atRed(on, { answers: ['Not yet'], answer: 'Go on with these tests' })
  await twoRoundsMended($, w)
  await endReader($, 'reader-3', THIRD)
  await gate($)
  mend(w, 'mended after "Not yet"')
  await gate($)
  await endReader($, 'reader-4', 'VERDICT: PASS')
  mend(w, 'changed after the fourth reader passed')
  expect((await gate($)).includes('the person answered "Go on with these tests" after 3 rounds of the test reader that did not pass and one that passed the tests as they were; the tests changed after it and were not read as they are')).toBe(true)
  expect(kept(w).phase).toBe('green')
  expect(w.spawned.length).toBe(4)
})

test('a Red the work came back to counts its rounds anew: three rounds before the return do not hold its first reading', async ($, on) => {
  const w = await atRed(on, { answers: ['Go on with these tests'], answer: 'Go back to Red', files: { 'the load log': `[DEBUG] hooks module ${NAME}@inline loaded (worker, environment 1, tier user); events: session.start\n` } })
  await twoRoundsMended($, w)
  await endReader($, 'reader-3', THIRD)
  await gate($)
  expect(kept(w).phase).toBe('green')
  expect(kept(w).readerRounds).toBe(3)
  // Green refuses twice for its test run, the way back is offered and taken.
  await gate($)
  await gate($)
  await $.tool.call({ tool: GATE, back_to_red: true } as never)
  expect(kept(w).phase).toBe('red')
  expect(kept(w).readerRounds).toBe(0)
  expect(kept(w).readerAnswered).toBe(false)
  w.answer = 'Go on with these changes'
  mend(w, 'the test corrected at the returned Red')
  expect((await gate($)).endsWith(READING)).toBe(true)
  expect(w.spawned.length).toBe(4)
  expect(w.asked.every((one) => !one.question.includes('The test reader has read the tests') || w.asked.indexOf(one) === 0)).toBe(true)
})

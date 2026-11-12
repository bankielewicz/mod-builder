// SPEC.md 9.19, what the pane shows of the test reader, through the hooks module itself: reading after the gate
// started it, reported once its turn ended, its findings after a round that did not pass, and nothing of it once
// Red has passed. The status line says the same in a few words.
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { GATE, MOD, NAME, TYPES, TYPES_TEXT, endReader, failing, world } from './world'
import type { World } from './world'

const DOT = String.fromCharCode(0xb7)
const SPEC = `${MOD}/SPEC.md`
const APPROVED = '# turn-counter\n'
const TEST = `${MOD}/tests/pane.test.tsx`
// 2026-11-12 18:05 UTC.
const NOW = Date.UTC(2026, 10, 12, 18, 5)
const PANE = {
  plugin: 'mod-builder', component: 'Pane', requestId: 'mod-builder', surface: 'terminal',
  props: { title: 'mod-builder', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const sha256 = async (text: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

// A build that stands at Red with a new test failing by assertion; the reader's turn is ended by the test itself.
const atRed = async (on: Parameters<typeof world>[0]) => {
  const w = world(on, {
    readerAnswer: null, now: NOW,
    files: { [SPEC]: APPROVED, [`${MOD}/.claude-plugin/plugin.json`]: `{ "name": "${NAME}" }`, [TEST]: 'the first test', [TYPES]: TYPES_TEXT },
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
const kept = (w: World) => w.store[`build:${MOD}`] as Record<string, unknown>
// Every Text the pane draws, in order.
const drawn = async ($: Engine) => {
  const ui = await $.ui.mount(PANE)
  const texts = (await ui.findAll({ type: 'Text' })).map((one) => one.text)
  await ui.unmount()
  return texts
}
// The texts from the reader's heading up to the phase's own.
const ofReader = (texts: string[]) => {
  const from = texts.indexOf('Test reader')
  return from === -1 ? null : texts.slice(from, texts.findIndex((text, index) => index > from && text.startsWith('5 Red')))
}

test('before the gate has started a reader the pane shows nothing of it', async ($, on) => {
  const w = await atRed(on)
  expect(ofReader(await drawn($))).toBe(null)
  expect(kept(w).reader).toBe(undefined)
})

test('after the gate started the reader the pane shows it reading, with when it started, and the status line says so', async ($, on) => {
  const w = await atRed(on)
  await gate($)
  expect(ofReader(await drawn($))).toEqual(['Test reader', '  reading the tests against the spec', 'started 18:05 UTC'])
  expect(String(w.statuses.at(-1)).endsWith(`${DOT} test reader reading`)).toBe(true)
  expect(String(w.statuses.at(-1)).startsWith('red')).toBe(true)
})

test('once the reader\'s turn has ended the pane shows it has reported and says to call the gate', async ($, on) => {
  const w = await atRed(on)
  await gate($)
  await endReader($, 'reader-1', 'VERDICT: PASS')
  expect(ofReader(await drawn($))).toEqual(['Test reader', '  has reported: the gate is waiting to be called'])
  expect(String(w.statuses.at(-1)).endsWith(`${DOT} test reader reported: call the gate`)).toBe(true)
  expect(kept(w).phase).toBe('red')
})

test('a reader whose turn ended with no answer shows as reported too: the gate is what reads it', async ($, on) => {
  const w = await atRed(on)
  await gate($)
  await endReader($, 'reader-1', undefined, 'error')
  expect(w.store['reader:reader-1']).toEqual({ answer: '', nudges: 1 })
  expect(ofReader(await drawn($))).toEqual(['Test reader', '  has reported: the gate is waiting to be called'])
  expect(String(w.statuses.at(-1)).endsWith(`${DOT} test reader reported: call the gate`)).toBe(true)
})

test('another agent\'s answer under another id does not show the reader as reported', async ($, on) => {
  const w = await atRed(on)
  await gate($)
  w.store['reader:someone-else'] = { answer: 'VERDICT: PASS', nudges: 1 }
  expect(ofReader(await drawn($))).toEqual(['Test reader', '  reading the tests against the spec', 'started 18:05 UTC'])
})

test('after a round that did not pass the pane shows the round and each finding, and the status line names the round', async ($, on) => {
  const w = await atRed(on)
  await gate($)
  await endReader($, 'reader-1', 'VERDICT: FINDINGS\n- tests/pane.test.tsx: no test resets the count\n- SPEC.md line 9: the empty log is never drawn\n')
  await gate($)
  expect(ofReader(await drawn($))).toEqual(['Test reader', '  round 1 did not pass', '  - tests/pane.test.tsx: no test resets the count', '  - SPEC.md line 9: the empty log is never drawn'])
  expect(String(w.statuses.at(-1)).endsWith(`${DOT} test reader: round 1 did not pass`)).toBe(true)
  expect(kept(w).phase).toBe('red')
})

test('a round with no verdict is shown in those words', async ($, on) => {
  await atRed(on)
  await gate($)
  await endReader($, 'reader-1', 'The tests look fine to me.')
  await gate($)
  expect(ofReader(await drawn($))).toEqual(['Test reader', '  round 1 did not pass', '  the reader gave no verdict'])
})

test('once Red has passed the pane shows nothing of the reader but Red\'s evidence, and the status line no word of it', async ($, on) => {
  const w = await atRed(on)
  await gate($)
  await endReader($, 'reader-1', 'VERDICT: PASS')
  expect((await gate($)).startsWith('mod-builder: phase 5 (Red) passed (')).toBe(true)
  const texts = await drawn($)
  expect(texts.includes('Test reader')).toBe(false)
  expect(texts.includes('  the test reader passed the tests (round 1)')).toBe(true)
  expect(String(w.statuses.at(-1)).includes('test reader')).toBe(false)
  expect(kept(w).phase).toBe('green')
})

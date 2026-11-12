// SPEC.md 9.17, point 4, through the hooks module itself: a source file of the mod outside hooks/ and tests/,
// which the scaffold script names as "source: <path>", refuses Scaffold's gate and Red's as a changed hooks/ does.
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { GATE, MOD, NAME, TYPES, TYPES_TEXT, failing, readerDone, world } from './world'
import type { World } from './world'

const SPEC = `${MOD}/SPEC.md`
const APPROVED = '# turn-counter\n'
const REMOVE = 'Remove each with a shell command; what a test needs to name is declared in a declaration file under types/'
const HEADING = 'The last lines of its output:'

const sha256 = async (text: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

const standing = async (on: Parameters<typeof world>[0], phase: 'scaffold' | 'red') => {
  const w = world(on, {
    files: { [SPEC]: APPROVED, [`${MOD}/.claude-plugin/plugin.json`]: `{ "name": "${NAME}" }`, [`${MOD}/tests/pane.test.tsx`]: 'the first test', [TYPES]: TYPES_TEXT },
  })
  if (phase === 'red') w.runs.test = { exitCode: 1, stdout: failing(['test 1'], ['counts a turn']) }
  w.store['session:s1'] = { modDir: MOD }
  w.store[`build:${MOD}`] = {
    modDir: MOD, sessionId: 's1', phase, specApprovedAt: 1, spec: { length: APPROVED.length, hash: await sha256(APPROVED) },
    testsAtScaffold: phase === 'scaffold' ? null : 1, namesAtScaffold: phase === 'scaffold' ? null : ['test 1'], testsAtRed: null, testHashes: null,
    evidence: { knowledge: 'snapshot 2026-11-10T151216Z' },
  }
  return w
}
const gate = async ($: Engine) => readerDone($, String((await $.tool.call({ tool: GATE } as never)).result))
const kept = (w: World) => w.store[`build:${MOD}`] as Record<string, unknown>
const word = (argv: string[]) => (argv.includes('--noEmit') ? 'typecheck' : argv.at(-1) === '-v' ? 'compiler?' : (argv[2] as string))

test('a source file outside hooks/ and tests/ refuses Scaffold before anything else is run, by name', async ($, on) => {
  const w = await standing(on, 'scaffold')
  w.runs.scaffold = { exitCode: 1, stdout: 'source: lib/count.ts\n' }
  expect(await gate($)).toBe(`mod-builder: still at phase 4 (Scaffold). Not passed: the mod holds source outside hooks/ and tests/ (lib/count.ts): at Scaffold the mod's code is the template's alone, and its behaviour is written at Red (tests) and Green (code). ${REMOVE}.\n${HEADING}\nsource: lib/count.ts`)
  expect(w.ran.map(word)).toEqual(['--check'])
  expect(kept(w).phase).toBe('scaffold')
})

test('at Red it refuses before the tests are run, in Red\'s words, and the tests stay open', async ($, on) => {
  const w = await standing(on, 'red')
  w.runs.scaffold = { exitCode: 1, stdout: 'source: lib/count.ts\nsource: util.mjs\n' }
  expect((await gate($)).split('\n')[0]).toBe(`mod-builder: still at phase 5 (Red). Not passed: the mod holds source outside hooks/ and tests/ (lib/count.ts, util.mjs): the mod's code is written at Green, after its tests. ${REMOVE}.`)
  expect(w.ran.map(word)).toEqual(['--check-hooks'])
  expect(kept(w).phase).toBe('red')
  expect((await $.tool.call({ tool: 'Write', file_path: `${MOD}/tests/count.test.tsx`, content: 'x' } as never)).deny).toBe(undefined)
})

test('beside a changed hooks/ both are said: the files to lay again, then the source to remove', async ($, on) => {
  const w = await standing(on, 'scaffold')
  w.runs.scaffold = { exitCode: 1, stdout: 'changed: hooks/register.tsx\nsource: lib/count.ts\n' }
  const first = (await gate($)).split('\n')[0] as string
  expect(first.startsWith('mod-builder: still at phase 4 (Scaffold). Not passed: hooks/ and tests/ are not as the scaffold laid them (changed: hooks/register.tsx)')).toBe(true)
  expect(first.endsWith(`Source outside hooks/ and tests/ is not written before Green either (lib/count.ts). ${REMOVE}.`)).toBe(true)
})

test('source written while Scaffold\'s checks ran refuses at the end, and nothing is recorded', async ($, on) => {
  const w = await standing(on, 'scaffold')
  w.whileRunning = (argv) => {
    if (argv.includes('--noEmit')) w.runs.scaffold = { exitCode: 1, stdout: 'source: lib/count.ts\n' }
  }
  expect((await gate($)).startsWith('mod-builder: still at phase 4 (Scaffold). Not passed: the mod holds source outside hooks/ and tests/ (lib/count.ts)')).toBe(true)
  expect(kept(w).testsAtScaffold).toBe(null)
})

test('with the source gone both gates pass as before', async ($, on) => {
  const w = await standing(on, 'scaffold')
  w.runs.scaffold = { exitCode: 1, stdout: 'source: lib/count.ts\n' }
  expect((await gate($)).startsWith('mod-builder: still at phase 4')).toBe(true)
  delete w.runs.scaffold
  expect((await gate($)).startsWith('mod-builder: phase 4 (Scaffold) passed (')).toBe(true)
})

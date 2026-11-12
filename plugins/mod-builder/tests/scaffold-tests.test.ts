// SPEC.md 7.11, through the hooks module itself: Scaffold to Red also requires the test run to exit 0, judged after
// validate and before the typecheck, and a refusal is quoted like any refused test run. A scaffold whose tests fail,
// or whose module throws as it loads, can't leave Scaffold, where everything can still be written.
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { GATE, MOD, NAME, TYPES, TYPES_SHA, TYPES_TEXT, failing, passing, readerDone, world } from './world'
import type { World } from './world'

const SPEC = `${MOD}/SPEC.md`
const APPROVED = '# turn-counter\n'
const REFUSED = 'mod-builder: still at phase 4 (Scaffold). Not passed: claude plugin test exited 1: not every test of the scaffold passes.'
const HEADING = 'The last lines of its output:'
// What `claude plugin test` printed for a scaffold whose module throws as it loads (SPEC.md 7.10, item 5).
const THROWS = [
  '', 'tests/pane.test.tsx:', '(fail) the pane draws its line [15.10ms]', '  HooksError: turn-counter: hooks module did not load: boom at load',
  '(fail) the command opens the pane [14.99ms]', '  HooksError: turn-counter: hooks module did not load: boom at load', '', ' 0 pass', ' 2 fail',
  'Ran 2 tests across 1 file. [0.23s]', '',
].join('\n')
const numbered = (count: number) => Array.from({ length: count }, (_, index) => `test line ${index + 1}`)

const sha256 = async (text: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

// A world whose build stands at Scaffold, as the gates before it would have left it.
const standing = async (on: Parameters<typeof world>[0]) => {
  const w = world(on, {
    files: { [SPEC]: APPROVED, [`${MOD}/.claude-plugin/plugin.json`]: `{ "name": "${NAME}" }`, [`${MOD}/tests/pane.test.tsx`]: 'the first test', [TYPES]: TYPES_TEXT },
  })
  w.store['session:s1'] = { modDir: MOD }
  w.store[`build:${MOD}`] = {
    modDir: MOD, sessionId: 's1', phase: 'scaffold', specApprovedAt: 1, spec: { length: APPROVED.length, hash: await sha256(APPROVED) },
    testsAtScaffold: null, namesAtScaffold: null, testsAtRed: null, testHashes: null, evidence: { knowledge: 'snapshot 2026-11-10T151216Z' },
  }
  return w
}
const gate = async ($: Engine) => readerDone($, String((await $.tool.call({ tool: GATE } as never)).result))
const kept = (w: World) => w.store[`build:${MOD}`] as Record<string, unknown>
const word = (argv: string[]) => (argv.includes('--noEmit') ? 'typecheck' : argv.at(-1) === '-v' ? 'compiler?' : (argv[2] as string))
const write = async ($: Engine, path: string) => (await $.tool.call({ tool: 'Write', file_path: path, content: 'x' } as never)).deny

test('Scaffold stays when a test of the scaffold fails, though validate passes and the report has a count: the answer quotes the test run', async ($, on) => {
  const w = await standing(on)
  const report = failing(['draws the pane'], ['opens on command'])
  w.runs.test = { exitCode: 1, stdout: report }
  expect(await gate($)).toBe(`${REFUSED}\n${HEADING}\n${report.trimEnd()}`)
  expect(kept(w).phase).toBe('scaffold')
  expect(kept(w).testsAtScaffold).toBe(null)
  expect(kept(w).namesAtScaffold).toBe(null)
})

test('a scaffold whose module throws as it loads can\'t leave Scaffold: both tests fail, and the answer shows why', async ($, on) => {
  const w = await standing(on)
  w.runs.test = { exitCode: 1, stdout: THROWS }
  const answer = (await gate($)).split('\n')
  expect(answer.slice(0, 2)).toEqual([REFUSED, HEADING])
  expect(answer).toContain('  HooksError: turn-counter: hooks module did not load: boom at load')
  expect(kept(w).phase).toBe('scaffold')
})

test('at Scaffold the test run is judged after validate and before the typecheck: a failing run stops the typecheck, and validate\'s refusal comes first', async ($, on) => {
  const w = await standing(on)
  w.runs.test = { exitCode: 1, stdout: failing(['draws the pane'], ['opens on command']) }
  w.runs.tsc = { exitCode: 2, stdout: 'error TS2322\n' }
  expect((await gate($)).split('\n')[0]).toBe(REFUSED)
  expect(w.ran.map(word)).toEqual(['--check', 'validate', 'test'])
  w.runs.validate = { exitCode: 1, stdout: 'validate says no\n' }
  expect(await gate($)).toBe(`mod-builder: still at phase 4 (Scaffold). Not passed: claude plugin validate --strict exited 1.\n${HEADING}\nvalidate says no`)
})

test('a refused test run at Scaffold is quoted by its last 20 lines, and from standard error when it printed nothing', async ($, on) => {
  const w = await standing(on)
  w.runs.test = { exitCode: 1, stdout: `${numbered(25).join('\n')}\n` }
  expect((await gate($)).split('\n')).toEqual([REFUSED, HEADING, ...numbered(25).slice(5)])
  w.runs.test = { exitCode: 1, stdout: '', stderr: 'the runner could not start\n' }
  expect(await gate($)).toBe(`${REFUSED}\n${HEADING}\nthe runner could not start`)
})

test('a build refused at Scaffold for its tests can still write hooks/, and passes once every test passes', async ($, on) => {
  const w = await standing(on)
  w.runs.test = { exitCode: 1, stdout: THROWS }
  await gate($)
  expect(await write($, `${MOD}/hooks/register.tsx`)).toBeUndefined()
  w.runs.test = { exitCode: 0, stdout: passing(2, ['draws the pane', 'opens on command']) }
  expect(await gate($)).toBe(`mod-builder: phase 4 (Scaffold) passed (hooks/ and tests/ are as the scaffold laid them; claude plugin validate --strict exited 0; 2 tests ran; the typecheck passes (types sha256 ${TYPES_SHA})). The build is now at phase 5 (Red).`)
  expect(kept(w).testsAtScaffold).toBe(2)
  expect(kept(w).namesAtScaffold).toEqual(['draws the pane', 'opens on command'])
})

test('any exit code but 0 refuses, and a run that exits 0 with no count is still refused for the count', async ($, on) => {
  const w = await standing(on)
  w.runs.test = { exitCode: 2, stdout: passing(2, ['draws the pane', 'opens on command']) }
  expect((await gate($)).split('\n')[0]).toBe('mod-builder: still at phase 4 (Scaffold). Not passed: claude plugin test exited 2: not every test of the scaffold passes.')
  w.runs.test = { exitCode: 0, stdout: 'no count here\n' }
  expect((await gate($)).split('\n')[0]).toBe("mod-builder: still at phase 4 (Scaffold). Not passed: the test run's last line reports no test count.")
  expect(kept(w).phase).toBe('scaffold')
})

// ------------------------------------------------------------------- what the tests' reader asked for

test('a refused test run at Scaffold is quoted from standard output when it printed a report, whatever standard error holds', async ($, on) => {
  const w = await standing(on)
  const report = failing(['draws the pane'], ['opens on command'])
  w.runs.test = { exitCode: 1, stdout: report, stderr: 'console.log from a test\n' }
  expect(await gate($)).toBe(`${REFUSED}\n${HEADING}\n${report.trimEnd()}`)
})

test('a refused test run at Scaffold is quoted by its own last lines, not cut at a validate section heading', async ($, on) => {
  const w = await standing(on)
  const body = ['(fail) a', '  AssertionError: x', 'Plugin directory checks for the mod:', ' 0 pass', ' 1 fail', 'Ran 1 tests across 1 file. [0.2s]']
  w.runs.test = { exitCode: 1, stdout: `${body.join('\n')}\n` }
  expect((await gate($)).split('\n')).toEqual([REFUSED, HEADING, ...body])
})

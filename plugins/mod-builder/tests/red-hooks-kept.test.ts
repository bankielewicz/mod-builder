// SPEC.md 9.17, through the hooks module itself: Red's gate of a build holds hooks/ to the template too. It asks
// the scaffold script for hooks/ alone (`--check-hooks`), before the test run and once more before it passes; a
// difference refuses, names the files and gives the command that lays hooks/ alone again. tests/ is Red's to
// change and is not compared; an edit has no template and is not asked.
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { GATE, MOD, NAME, TYPES, TYPES_SHA, TYPES_TEXT, failing, readerDone, world } from './world'
import type { World } from './world'

const SPEC = `${MOD}/SPEC.md`
const APPROVED = '# turn-counter\n'
const STILL = 'mod-builder: still at phase 5 (Red). Not passed: '
const WHY = ': it closed when Scaffold passed, and the mod\'s code is written at Green, after its tests. Put it back with: '
const HEADING = 'The last lines of its output:'
const HOOKS_AS_LAID = { exitCode: 0, stdout: 'as laid: hooks/hooks.json hooks/register.tsx\n' }
const RED_RUN = failing(['test 1'], ['counts a turn'])

const sha256 = async (text: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

// A world whose build stands at Red, with a new test that fails by assertion.
const atRed = async (on: Parameters<typeof world>[0]) => {
  const w = world(on, {
    files: { [SPEC]: APPROVED, [`${MOD}/.claude-plugin/plugin.json`]: `{ "name": "${NAME}" }`, [`${MOD}/tests/pane.test.tsx`]: 'the first test', [TYPES]: TYPES_TEXT },
  })
  w.runs.test = { exitCode: 1, stdout: RED_RUN }
  w.runs.scaffold = HOOKS_AS_LAID
  w.store['session:s1'] = { modDir: MOD }
  w.store[`build:${MOD}`] = {
    modDir: MOD, sessionId: 's1', phase: 'red', specApprovedAt: 1, spec: { length: APPROVED.length, hash: await sha256(APPROVED) },
    testsAtScaffold: 1, namesAtScaffold: ['test 1'], testsAtRed: null, testHashes: null, evidence: { knowledge: 'snapshot 2026-11-10T151216Z' },
  }
  return w
}
const gate = async ($: Engine) => readerDone($, String((await $.tool.call({ tool: GATE } as never)).result))
const kept = (w: World) => w.store[`build:${MOD}`] as Record<string, unknown>
const asked = (w: World) => w.ran.filter((argv) => argv.some((one) => one.endsWith('/scripts/scaffold.sh')))
const word = (argv: string[]) => (argv.includes('--noEmit') ? 'typecheck' : argv.at(-1) === '-v' ? 'compiler?' : (argv[2] as string))
// The command the refusal gives: the script the gate itself ran, in its mode that lays hooks/ alone.
const again = (w: World) => `bash "${(asked(w)[0] as string[])[1]}" --again-hooks "${MOD}" ${NAME}`
const REFUSES = '. When that command refuses, a link or a folder stands where a file goes: remove it with a shell command first'

test('Red asks the scaffold script for hooks/ alone, with the mod folder and the manifest\'s name, before the tests run and once more at the end', async ($, on) => {
  const w = await atRed(on)
  expect(await gate($)).toBe(`mod-builder: phase 5 (Red) passed (hooks/ is as the scaffold laid it; 2 tests ran, the new ones failing by assertion; the typecheck passes (types sha256 ${TYPES_SHA}); 1 files under tests/ hashed; the test reader passed the tests (round 1)). The build is now at phase 6 (Green).`)
  // And a third time on the call that reads the test reader's answer, which runs nothing else (SPEC.md 9.19).
  expect(asked(w).map((argv) => argv.slice(2))).toEqual([['--check-hooks', MOD, NAME], ['--check-hooks', MOD, NAME], ['--check-hooks', MOD, NAME]])
  expect(w.ran.map(word)).toEqual(['--check-hooks', 'test', 'compiler?', 'typecheck', '--check-hooks', '--check-hooks'])
})

test('code written under hooks/ before Red refuses Red before the tests are run, and the answer names the file and how hooks/ alone is laid again', async ($, on) => {
  const w = await atRed(on)
  w.runs.scaffold = { exitCode: 1, stdout: 'changed: hooks/register.tsx\n' }
  expect(await gate($)).toBe(`${STILL}hooks/ is not as the scaffold laid it (changed: hooks/register.tsx)${WHY}${again(w)}${REFUSES}.\n${HEADING}\nchanged: hooks/register.tsx`)
  expect(w.ran.map(word)).toEqual(['--check-hooks'])
  expect(kept(w).phase).toBe('red')
  expect(kept(w).testsAtRed).toBe(null)
  expect(kept(w).testHashes).toBe(null)
})

test('an extra file under hooks/ is to be removed, and the tests stay open while Red is refused', async ($, on) => {
  const w = await atRed(on)
  w.runs.scaffold = { exitCode: 1, stdout: 'changed: hooks/register.tsx\nextra: hooks/count.ts\n' }
  expect((await gate($)).split('\n')[0]).toBe(`${STILL}hooks/ is not as the scaffold laid it (changed: hooks/register.tsx; extra: hooks/count.ts)${WHY}${again(w)}, and remove each file named as extra${REFUSES}.`)
  expect((await $.tool.call({ tool: 'Write', file_path: `${MOD}/tests/count.test.tsx`, content: 'x' } as never)).deny).toBe(undefined)
  expect(typeof (await $.tool.call({ tool: 'Write', file_path: `${MOD}/hooks/register.tsx`, content: 'x' } as never)).deny).toBe('string')
})

test('Red passes once hooks/ is as laid again', async ($, on) => {
  const w = await atRed(on)
  w.runs.scaffold = { exitCode: 1, stdout: 'changed: hooks/register.tsx\n' }
  expect((await gate($)).startsWith(STILL)).toBe(true)
  w.runs.scaffold = HOOKS_AS_LAID
  expect((await gate($)).startsWith('mod-builder: phase 5 (Red) passed (hooks/ is as the scaffold laid it; ')).toBe(true)
  expect(kept(w).phase).toBe('green')
})

test('code written under hooks/ while Red\'s checks ran refuses at the end: the tests did not fail against the template, and nothing is recorded', async ($, on) => {
  const w = await atRed(on)
  w.whileRunning = (argv) => {
    if (argv.includes('--noEmit')) w.runs.scaffold = { exitCode: 1, stdout: 'changed: hooks/register.tsx\n' }
  }
  expect(await gate($)).toBe(`${STILL}hooks/ is not as the scaffold laid it (changed: hooks/register.tsx)${WHY}${again(w)}${REFUSES}.\n${HEADING}\nchanged: hooks/register.tsx`)
  expect(w.ran.map(word)).toEqual(['--check-hooks', 'test', 'compiler?', 'typecheck', '--check-hooks'])
  expect(kept(w).phase).toBe('red')
  expect(kept(w).testHashes).toBe(null)
})

test('a check of hooks/ that could not start, or gave no answer, refuses Red', async ($, on) => {
  const w = await atRed(on)
  w.runs.scaffold = 'never starts'
  expect(await gate($)).toBe(`${STILL}the scaffold check ended with no exit code.`)
  w.runs.scaffold = { exitCode: 0, stdout: '' }
  expect(await gate($)).toBe(`${STILL}the scaffold check gave no answer to read (it exited 0).`)
  expect(kept(w).phase).toBe('red')
})

test('Green does not ask: hooks/ is open there, and the code is the build\'s to write', async ($, on) => {
  const w = await atRed(on)
  w.store[`build:${MOD}`] = { ...kept(w), phase: 'green', testsAtRed: 2, testHashes: { 'tests/pane.test.tsx': await sha256(btoa('the first test')) } }
  w.runs.scaffold = { exitCode: 1, stdout: 'changed: hooks/register.tsx\n' }
  await gate($)
  expect(asked(w)).toEqual([])
})

test('hooks/ is asked about before anything else at Red: with a linked test file too, the answer is about hooks/', async ($, on) => {
  const w = await atRed(on)
  w.files[`${MOD}/tests/l.test.ts`] = 'x'
  w.links.push(`${MOD}/tests/l.test.ts`)
  w.runs.scaffold = { exitCode: 1, stdout: 'changed: hooks/register.tsx\n' }
  expect((await gate($)).startsWith(`${STILL}hooks/ is not as the scaffold laid it (`)).toBe(true)
  expect(w.ran.map(word)).toEqual(['--check-hooks'])
})

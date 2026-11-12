// SPEC.md 9.7, through the hooks module itself: a build's typecheck names its test files as an edit's does
// (8.14), as root files, at each of its four gates that typecheck. So a test file the compiler would pass over
// through `include` (a name that opens with a dot, a .tsx beside a .ts of its name) is checked at Red, while
// tests/ is still open, and again at Green and Verify.
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { BUILT, GATE, HOME, MOD, NAME, TYPES, TYPES_TEXT, failing, readerDone, world } from './world'
import type { World } from './world'

const SPEC = `${MOD}/SPEC.md`
const APPROVED = '# turn-counter\n'
const PANE = `${MOD}/tests/pane.test.tsx`
const CONFIG = `${HOME}/.claude/mod-builder-data/v2/typecheck/s1/tsconfig.json`
const LOADED = `[DEBUG] hooks module ${NAME}@inline loaded (worker, environment 1, tier user); events: session.start\n`
// Test files the compiler passes over when only the folder is named, and one that sits outside tests/.
const ODD = { [`${MOD}/tests/.hidden.test.ts`]: 'a', [`${MOD}/tests/a.test.ts`]: 'b', [`${MOD}/tests/a.test.tsx`]: 'c', [`${MOD}/lib/deep/x.test.ts`]: 'd' }
const ODD_NAMED = [`${MOD}/lib/deep/x.test.ts`, `${MOD}/tests/.hidden.test.ts`, `${MOD}/tests/a.test.ts`, `${MOD}/tests/a.test.tsx`, PANE]

const sha256 = async (text: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

// A world whose build stands at the phase named, as the gates before it would have left it, with the test files
// given beside the template's.
const standing = async (on: Parameters<typeof world>[0], at: 'scaffold' | 'red' | 'green' | 'verify', files: Record<string, string> = {}) => {
  const spec = at === 'verify' ? `${APPROVED}${BUILT}` : APPROVED
  const all: Record<string, string> = { [PANE]: 'the first test', ...files }
  const w = world(on, {
    files: { [SPEC]: spec, [`${MOD}/.claude-plugin/plugin.json`]: `{ "name": "${NAME}" }`, 'the load log': LOADED, [TYPES]: TYPES_TEXT, ...all },
  })
  const after = at === 'green' || at === 'verify'
  const hashes: Record<string, string> = {}
  for (const path of Object.keys(all).filter((one) => one.startsWith(`${MOD}/tests/`))) hashes[path.slice(MOD.length + 1)] = await sha256(btoa(all[path] as string))
  w.store['session:s1'] = { modDir: MOD }
  w.store[`build:${MOD}`] = {
    modDir: MOD, sessionId: 's1', phase: at, specApprovedAt: 1, spec: { length: APPROVED.length, hash: await sha256(APPROVED) },
    testsAtScaffold: at === 'scaffold' ? null : 1, namesAtScaffold: at === 'scaffold' ? null : ['test 1'], testsAtRed: after ? 1 : null,
    testHashes: after ? hashes : null, evidence: { knowledge: 'snapshot 2026-11-10T151216Z' },
  }
  return w
}
const gate = async ($: Engine) => readerDone($, String((await $.tool.call({ tool: GATE } as never)).result))
const phase = (w: World) => (w.store[`build:${MOD}`] as { phase: string }).phase
// The files the typecheck named, read from the tsconfig as it stood while each run was under way.
const watched = (w: World) => {
  const named: (string[] | undefined)[] = []
  w.whileRunning = (argv) => {
    if (argv.includes('--noEmit')) named.push((JSON.parse(w.files[CONFIG] ?? '{}') as { files?: string[] }).files)
  }
  return named
}

test('Scaffold\'s typecheck names the template\'s test file as a root file', async ($, on) => {
  const w = await standing(on, 'scaffold')
  const named = watched(w)
  expect(await gate($)).toMatch(/^mod-builder: phase 4 \(Scaffold\) passed /)
  expect(named).toEqual([[PANE]])
})

test('Red\'s typecheck names every test file, the ones a folder would not reach among them, sorted by path', async ($, on) => {
  const w = await standing(on, 'red', ODD)
  w.runs.test = { exitCode: 1, stdout: failing(['test 1'], ['counts a turn']) }
  const named = watched(w)
  expect(await gate($)).toMatch(/^mod-builder: phase 5 \(Red\) passed /)
  expect(named).toEqual([ODD_NAMED])
})

test('a test file with a type error that only a root file shows is refused at Red, where tests/ is still open', async ($, on) => {
  const w = await standing(on, 'red', ODD)
  w.runs.test = { exitCode: 1, stdout: failing(['test 1'], ['counts a turn']) }
  w.runs.tsc = { exitCode: 2, stdout: 'tests/a.test.tsx(1,7): error TS2322: Type \'string\' is not assignable to type \'number\'.\n' }
  const answer = await gate($)
  expect(answer.split('\n')[0]).toBe('mod-builder: still at phase 5 (Red). Not passed: the typecheck exited 2.')
  expect(answer).toContain('tests/a.test.tsx(1,7): error TS2322')
  expect(phase(w)).toBe('red')
  expect((await $.tool.call({ tool: 'Write', file_path: `${MOD}/tests/a.test.tsx`, content: 'x' } as never)).deny).toBe(undefined)
})

test('Green\'s and Verify\'s typecheck name the same files', async ($, on) => {
  const w = await standing(on, 'green', ODD)
  const named = watched(w)
  expect(await gate($)).toMatch(/^mod-builder: phase 6 \(Green\) passed /)
  expect(named).toEqual([ODD_NAMED])
})

test('Verify names them too', async ($, on) => {
  const w = await standing(on, 'verify', ODD)
  const named = watched(w)
  expect(await gate($)).toMatch(/^mod-builder: phase 7 \(Verify\) passed /)
  expect(named).toEqual([ODD_NAMED])
})

test('only source the compiler reads is named: a note or a snapshot under tests/ is not, and a declaration file is', async ($, on) => {
  const w = await standing(on, 'red', { [`${MOD}/tests/notes.md`]: 'x', [`${MOD}/tests/shot.json`]: '{}', [`${MOD}/tests/helper.ts`]: 'y', [`${MOD}/tests/types.d.ts`]: 'z' })
  w.runs.test = { exitCode: 1, stdout: failing(['test 1'], ['counts a turn']) }
  const named = watched(w)
  await gate($)
  expect(named).toEqual([[`${MOD}/tests/helper.ts`, PANE, `${MOD}/tests/types.d.ts`]])
})

test('a build with no test file names none: its configuration has no files key', async ($, on) => {
  const w = await standing(on, 'scaffold')
  delete w.files[PANE]
  const named = watched(w)
  await gate($)
  expect(named).toEqual([undefined])
})

test('the files are listed anew at each gate: one added after Scaffold is named at Red', async ($, on) => {
  const w = await standing(on, 'scaffold')
  const named = watched(w)
  await gate($)
  w.files[`${MOD}/tests/count.test.ts`] = 'new'
  w.runs.test = { exitCode: 1, stdout: failing(['test 1'], ['counts a turn']) }
  await gate($)
  expect(named).toEqual([[PANE], [`${MOD}/tests/count.test.ts`, PANE]])
})

test('Scaffold names a file named as a test outside tests/ too', async ($, on) => {
  const w = await standing(on, 'scaffold', { [`${MOD}/lib/x.test.ts`]: 'a' })
  const named = watched(w)
  await gate($)
  expect(named).toEqual([[`${MOD}/lib/x.test.ts`, PANE]])
})

test('at Red the files are listed after the test run: one written while it ran is named', async ($, on) => {
  const w = await standing(on, 'red')
  w.runs.test = { exitCode: 1, stdout: failing(['test 1'], ['counts a turn']) }
  const named: (string[] | undefined)[] = []
  w.whileRunning = (argv) => {
    if (argv.includes('test') && argv[0] === 'claude') w.files[`${MOD}/tests/late.test.ts`] = 'late'
    if (argv.includes('--noEmit')) named.push((JSON.parse(w.files[CONFIG] ?? '{}') as { files?: string[] }).files)
  }
  await gate($)
  expect(named).toEqual([[`${MOD}/tests/late.test.ts`, PANE]])
})

// A folder of the mod that can't be listed: the mod's files can't all be read then, and nothing says which test
// files there are.
const closed = async ($: Engine, on: Parameters<typeof world>[0], at: 'scaffold' | 'green' | 'verify', label: string) => {
  const w = await standing(on, at, { [`${MOD}/lib/closed`]: 'x' })
  w.listedAs[`${MOD}/lib/closed`] = { kind: 'dir', isLink: false }
  expect(await gate($)).toBe(`mod-builder: still at phase ${label}. Not passed: the mod's files could not be read, so its test files can't be named to the typecheck.`)
  expect(w.ran.filter((argv) => argv.includes('--noEmit'))).toEqual([])
  expect(phase(w)).toBe(at)
}

test('when the mod\'s files can\'t all be read Scaffold does not name none and pass: it refuses, and no compiler runs', async ($, on) => {
  await closed($, on, 'scaffold', '4 (Scaffold)')
})

test('nor does Green', async ($, on) => {
  await closed($, on, 'green', '6 (Green)')
})

test('nor does Verify', async ($, on) => {
  await closed($, on, 'verify', '7 (Verify)')
})

const linked = async ($: Engine, on: Parameters<typeof world>[0], at: 'scaffold' | 'green') => {
  const w = await standing(on, at, { [`${MOD}/lib/l.test.ts`]: 'x' })
  w.links.push(`${MOD}/lib/l.test.ts`)
  const answer = await gate($)
  expect(answer.endsWith('Not passed: lib/l.test.ts is a link or no file: a test must be a file of the mod\'s own, so that the typecheck reads what the mod holds.')).toBe(true)
  expect(w.ran.filter((argv) => argv.includes('--noEmit'))).toEqual([])
  expect(phase(w)).toBe(at)
}

test('a link named as a test is refused by name at Scaffold, before the compiler would stop on it', async ($, on) => {
  await linked($, on, 'scaffold')
})

test('and at Green, where it can still be removed: it lies outside tests/', async ($, on) => {
  await linked($, on, 'green')
  expect((await $.tool.call({ tool: 'Write', file_path: `${MOD}/lib/l.test.ts`, content: 'x' } as never)).deny).toBe(undefined)
})

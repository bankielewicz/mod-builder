// SPEC.md 7.10, through the hooks module itself: a check runs while the files it judges can still be changed. The
// typecheck Green and Verify end on (once for each distinct types file of the build) also ends Red, after the test
// run's verdict, because tests/ closes when Red passes; and it ends Scaffold, after validate and the test run,
// because hooks/ and types/ close when Scaffold passes and Red could not pass over an error in them. A failure is
// answered like any refused typecheck: the types file it failed against and the compiler's last 20 lines.
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { DOWNLOADED, GATE, HOME, INSTALLED, MOD, NAME, TYPES, TYPES_FOLDER, TYPES_SHA, TYPES_TEXT, failing, passing, world } from './world'
import type { World } from './world'

const SPEC = `${MOD}/SPEC.md`
const APPROVED = '# turn-counter\n'
const TEST_FILE = `${MOD}/tests/pane.test.tsx`
const NEW_TEST = `${MOD}/tests/counts.test.tsx`
const CONFIG = `${HOME}/.claude/mod-builder-data/v2/typecheck/s1/tsconfig.json`
// A second types file of the same build, as a session with the sandbox on writes one: other content, other hash.
const SANDBOXED = `${TYPES_FOLDER}/a094200f/plugin-authoring/types/claude-code.d.ts`
const SANDBOXED_TEXT = `${TYPES_TEXT}// allowed_domains\n`
const numbered = (count: number) => Array.from({ length: count }, (_, index) => `line ${index + 1}`)
const AGAINST = `the types file ${TYPES} (sha256 ${TYPES_SHA})`

const sha256 = async (text: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

// A world whose build stands at Scaffold or at Red, as the gates before it would have left it. At Red a new test
// is written and fails by assertion, so the test run's own verdict passes.
const standing = async (on: Parameters<typeof world>[0], at: 'scaffold' | 'red', files: Record<string, string> = {}) => {
  const w = world(on, {
    files: {
      [SPEC]: APPROVED, [`${MOD}/.claude-plugin/plugin.json`]: `{ "name": "${NAME}" }`, [TEST_FILE]: 'the first test',
      ...(at === 'red' ? { [NEW_TEST]: 'the new test' } : {}), [TYPES]: TYPES_TEXT, ...files,
    },
  })
  w.store['session:s1'] = { modDir: MOD }
  w.store[`build:${MOD}`] = {
    modDir: MOD, sessionId: 's1', phase: at, specApprovedAt: 1, spec: { length: APPROVED.length, hash: await sha256(APPROVED) },
    testsAtScaffold: at === 'scaffold' ? null : 1, namesAtScaffold: at === 'scaffold' ? null : ['test 1'], testsAtRed: null,
    testHashes: null, evidence: { knowledge: 'snapshot 2026-11-10T151216Z' },
  }
  if (at === 'red') w.runs.test = { exitCode: 1, stdout: failing(['test 1'], ['counts a turn']) }
  return w
}
const gate = async ($: Engine) => String((await $.tool.call({ tool: GATE } as never)).result)
const kept = (w: World) => w.store[`build:${MOD}`] as Record<string, unknown>
const typechecks = (w: World) => w.ran.filter((argv) => argv.includes('--noEmit'))
const word = (argv: string[]) => (argv.includes('--noEmit') ? 'typecheck' : argv.at(-1) === '-v' ? 'compiler?' : (argv[2] as string))
// The types file each typecheck ran against, read from the tsconfig as it stood while that run was under way.
const watched = (w: World) => {
  const against: string[] = []
  w.whileRunning = (argv) => {
    if (argv.includes('--noEmit')) against.push((JSON.parse(w.files[CONFIG] ?? '{}') as { include: string[] }).include[0] as string)
  }
  return against
}
const write = async ($: Engine, path: string) => (await $.tool.call({ tool: 'Write', file_path: path, content: 'x' } as never)).deny

// ------------------------------------------------------------------------------------------------ Red

test('Red stays when the tests do not typecheck, though the new test fails by assertion: the answer names the types file and quotes the compiler', async ($, on) => {
  const w = await standing(on, 'red')
  w.runs.tsc = { exitCode: 2, stdout: 'tests/counts.test.tsx(4,7): error TS2769: No overload matches this call.\n' }
  expect(await gate($)).toBe(`mod-builder: still at phase 5 (Red). Not passed: the typecheck exited 2.\nThe last lines of its output, against ${AGAINST}:\ntests/counts.test.tsx(4,7): error TS2769: No overload matches this call.`)
  expect(kept(w).phase).toBe('red')
  expect(kept(w).testsAtRed).toBe(null)
  expect(kept(w).testHashes).toBe(null)
})

test('a build refused at Red for the typecheck can still change its tests, and passes once they typecheck', async ($, on) => {
  const w = await standing(on, 'red')
  w.runs.tsc = { exitCode: 2, stdout: 'error TS2769\n' }
  await gate($)
  expect(await write($, NEW_TEST)).toBeUndefined()
  expect(await write($, `${MOD}/hooks/register.tsx`)).toMatch(/phase 5 \(Red\)/)
  w.runs.tsc = { exitCode: 0, stdout: '' }
  expect(await gate($)).toBe(`mod-builder: phase 5 (Red) passed (2 tests ran, the new ones failing by assertion; the typecheck passes (types sha256 ${TYPES_SHA}); 2 files under tests/ hashed). The build is now at phase 6 (Green).`)
  expect(kept(w).testsAtRed).toBe(2)
  expect(Object.keys(kept(w).testHashes as object).sort()).toEqual(['tests/counts.test.tsx', 'tests/pane.test.tsx'])
})

test('at Red the typecheck runs after the test run, in the tsconfig\'s folder, and not at all when the test run is refused', async ($, on) => {
  const w = await standing(on, 'red')
  await gate($)
  expect(w.ran.map(word)).toEqual(['test', 'compiler?', 'typecheck'])
  expect(w.ranIn.at(-1)).toBe(CONFIG.slice(0, CONFIG.lastIndexOf('/')))
  w.ran.length = 0
  w.store[`build:${MOD}`] = { ...kept(w), phase: 'red', testsAtRed: null, testHashes: null }
  w.runs.test = { exitCode: 0, stdout: passing(2, ['test 1', 'counts a turn']) }
  w.runs.tsc = { exitCode: 2, stdout: 'error TS2769\n' }
  expect((await gate($)).split('\n')[0]).toBe('mod-builder: still at phase 5 (Red). Not passed: claude plugin test exited 0: no test fails yet.')
  expect(w.ran.map(word)).toEqual(['test'])
})

test('a refused typecheck at Red is quoted by the compiler\'s last 20 lines, and no more', async ($, on) => {
  const w = await standing(on, 'red')
  w.runs.tsc = { exitCode: 2, stdout: `${numbered(25).join('\n')}\n` }
  expect((await gate($)).split('\n')).toEqual(['mod-builder: still at phase 5 (Red). Not passed: the typecheck exited 2.', `The last lines of its output, against ${AGAINST}:`, ...numbered(25).slice(5)])
})

test('at Red the typecheck runs once against each distinct types file, in the order of their hashes, and the evidence carries every hash', async ($, on) => {
  const w = await standing(on, 'red', { [SANDBOXED]: SANDBOXED_TEXT })
  const against = watched(w)
  const other = await sha256(SANDBOXED_TEXT)
  const order = [[TYPES_SHA, TYPES], [other, SANDBOXED]].sort((one, two) => ((one[0] as string) < (two[0] as string) ? -1 : 1))
  expect(await gate($)).toBe(`mod-builder: phase 5 (Red) passed (2 tests ran, the new ones failing by assertion; the typecheck passes (types sha256 ${order.map((one) => one[0]).join(', ')}); 2 files under tests/ hashed). The build is now at phase 6 (Green).`)
  expect(typechecks(w).length).toBe(2)
  expect(against).toEqual(order.map((one) => one[1]))
})

test('at Red a typecheck that fails against the second types file names that one, and Red stays', async ($, on) => {
  const w = await standing(on, 'red', { [SANDBOXED]: SANDBOXED_TEXT })
  const other = await sha256(SANDBOXED_TEXT)
  const second = TYPES_SHA < other ? [SANDBOXED, other] : [TYPES, TYPES_SHA]
  let runs = 0
  w.whileRunning = (argv) => {
    if (!argv.includes('--noEmit')) return
    runs += 1
    // The world has a run's answer in hand before this is called: what is set here is the next run's.
    if (runs === 1) w.runs.tsc = { exitCode: 2, stdout: 'error TS2322\n' }
  }
  const answer = await gate($)
  expect(runs).toBe(2)
  expect(answer).toBe(`mod-builder: still at phase 5 (Red). Not passed: the typecheck exited 2.\nThe last lines of its output, against the types file ${second[0]} (sha256 ${second[1]}):\nerror TS2322`)
  expect(kept(w).phase).toBe('red')
})

test('at Red a typecheck that can\'t start, or prints nothing, still names the types file', async ($, on) => {
  const w = await standing(on, 'red')
  w.runs.tsc = 'never starts'
  expect(await gate($)).toBe(`mod-builder: still at phase 5 (Red). Not passed: the typecheck ended with no exit code.\nIt printed nothing. It ran against ${AGAINST}.`)
  w.runs.tsc = { exitCode: 1, stdout: '', stderr: 'the compiler fell over\n' }
  expect(await gate($)).toBe(`mod-builder: still at phase 5 (Red). Not passed: the typecheck exited 1.\nThe last lines of its output, against ${AGAINST}:\nthe compiler fell over`)
  expect(kept(w).phase).toBe('red')
})

test('at Red, with the build\'s types not written or no compiler to run, the gate refuses with what is missing and records nothing', async ($, on) => {
  const w = await standing(on, 'red')
  delete w.files[TYPES]
  w.files[`${TYPES_FOLDER}/5d3947d0/plugin-authoring/reference.md`] = 'the reference'
  const answer = await gate($)
  expect(answer).toMatch(/^mod-builder: still at phase 5 \(Red\)\. Not passed: /)
  expect(answer).toMatch(/plugin-authoring/)
  expect(answer.split('\n').length).toBe(1)
  expect(typechecks(w).length).toBe(0)
  w.files[TYPES] = TYPES_TEXT
  w.compilers[INSTALLED] = { exitCode: 1, stdout: '' }
  w.compilers[DOWNLOADED] = { exitCode: 1, stdout: '' }
  expect(await gate($)).toMatch(/^mod-builder: still at phase 5 \(Red\)\. Not passed: no TypeScript compiler could be run /)
  expect(kept(w).testsAtRed).toBe(null)
  expect(kept(w).phase).toBe('red')
})

test('a test changed while Red\'s typecheck ran is not recorded as what was checked: Red stays', async ($, on) => {
  const w = await standing(on, 'red')
  w.whileRunning = (argv) => {
    if (argv.includes('--noEmit')) w.files[NEW_TEST] = 'changed under the compiler'
  }
  expect(await gate($)).toBe('mod-builder: still at phase 5 (Red). Not passed: tests/ changed while the tests ran (not as recorded: tests/counts.test.tsx (changed)): ask again.')
  expect(kept(w).testHashes).toBe(null)
})

test('the pane shows Red\'s evidence with the types hash once Red has passed', async ($, on) => {
  await standing(on, 'red')
  await gate($)
  const ui = await $.ui.mount({ plugin: 'mod-builder', component: 'Pane', requestId: 'mod-builder', surface: 'terminal', props: { title: 'mod-builder', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} } })
  const texts = (await ui.findAll({ type: 'Text' })).map((text) => text.text)
  await ui.unmount()
  expect(texts).toContain(`  the typecheck passes (types sha256 ${TYPES_SHA.slice(0, 12)})`)
})

// ------------------------------------------------------------------------------------------- Scaffold

test('Scaffold passes when validate, the tests and the typecheck pass, run in that order, and its evidence carries the types hash', async ($, on) => {
  const w = await standing(on, 'scaffold')
  expect(await gate($)).toBe(`mod-builder: phase 4 (Scaffold) passed (hooks/ and tests/ are as the scaffold laid them; claude plugin validate --strict exited 0; 1 tests ran; the typecheck passes (types sha256 ${TYPES_SHA})). The build is now at phase 5 (Red).`)
  expect(w.ran.map(word)).toEqual(['--check', 'validate', 'test', 'compiler?', 'typecheck', '--check'])
  expect(kept(w).testsAtScaffold).toBe(1)
})

test('Scaffold stays when the scaffold does not typecheck, though validate and the tests pass: nothing is recorded, and hooks/ can still be written', async ($, on) => {
  const w = await standing(on, 'scaffold')
  w.runs.tsc = { exitCode: 2, stdout: `${numbered(25).join('\n')}\n` }
  expect((await gate($)).split('\n')).toEqual(['mod-builder: still at phase 4 (Scaffold). Not passed: the typecheck exited 2.', `The last lines of its output, against ${AGAINST}:`, ...numbered(25).slice(5)])
  expect(kept(w).phase).toBe('scaffold')
  expect(kept(w).testsAtScaffold).toBe(null)
  expect(kept(w).namesAtScaffold).toBe(null)
  expect(await write($, `${MOD}/hooks/register.tsx`)).toBeUndefined()
  w.runs.tsc = { exitCode: 0, stdout: '' }
  expect(await gate($)).toMatch(/^mod-builder: phase 4 \(Scaffold\) passed /)
})

test('at Scaffold the typecheck is not run when validate or the tests refuse, and the lines quoted are theirs', async ($, on) => {
  const w = await standing(on, 'scaffold')
  w.runs.validate = { exitCode: 1, stdout: 'validate says no\n' }
  w.runs.tsc = { exitCode: 2, stdout: 'error TS2322\n' }
  expect(await gate($)).toBe('mod-builder: still at phase 4 (Scaffold). Not passed: claude plugin validate --strict exited 1.\nThe last lines of its output:\nvalidate says no')
  expect(w.ran.map(word)).toEqual(['--check', 'validate', 'test'])
})

test('at Scaffold the typecheck runs against each distinct types file, and a failure against one names it', async ($, on) => {
  const w = await standing(on, 'scaffold', { [SANDBOXED]: SANDBOXED_TEXT })
  const against = watched(w)
  const other = await sha256(SANDBOXED_TEXT)
  const order = [[TYPES_SHA, TYPES], [other, SANDBOXED]].sort((one, two) => ((one[0] as string) < (two[0] as string) ? -1 : 1))
  expect(await gate($)).toBe(`mod-builder: phase 4 (Scaffold) passed (hooks/ and tests/ are as the scaffold laid them; claude plugin validate --strict exited 0; 1 tests ran; the typecheck passes (types sha256 ${order.map((one) => one[0]).join(', ')})). The build is now at phase 5 (Red).`)
  expect(against).toEqual(order.map((one) => one[1]))
  w.ran.length = 0
  w.store[`build:${MOD}`] = { ...kept(w), phase: 'scaffold', testsAtScaffold: null, namesAtScaffold: null }
  w.runs.tsc = { exitCode: 1, stdout: '' }
  const first = order[0] as string[]
  expect(await gate($)).toBe(`mod-builder: still at phase 4 (Scaffold). Not passed: the typecheck exited 1.\nIt printed nothing. It ran against the types file ${first[1]} (sha256 ${first[0]}).`)
  expect(typechecks(w).length).toBe(1)
})

test('at Scaffold, with the build\'s types not written, the gate refuses and sends the model to the plugin-authoring skill', async ($, on) => {
  const w = await standing(on, 'scaffold')
  delete w.files[TYPES]
  w.files[`${TYPES_FOLDER}/5d3947d0/plugin-authoring/reference.md`] = 'the reference'
  const answer = await gate($)
  expect(answer).toMatch(/^mod-builder: still at phase 4 \(Scaffold\)\. Not passed: /)
  expect(answer).toMatch(/plugin-authoring/)
  expect(kept(w).testsAtScaffold).toBe(null)
  expect(typechecks(w).length).toBe(0)
})

// ------------------------------------------------------------------- what the tests' reader asked for
// ------------------------------------------------------------------------------------------ added by the reader
const EARLIER = `${TYPES_FOLDER}/0000aaaa/plugin-authoring/types/claude-code.d.ts`

test('at Red the typecheck order is the order of the hashes, not of the paths', async ($, on) => {
  // EARLIER sorts before TYPES by path and after it by hash (b62e... against 961c...).
  const w = await standing(on, 'red', { [EARLIER]: SANDBOXED_TEXT })
  expect(TYPES_SHA < (await sha256(SANDBOXED_TEXT))).toBe(true)
  const against = watched(w)
  await gate($)
  expect(against).toEqual([TYPES, EARLIER])
})

test('a typecheck that exits 0 passes at Scaffold though it printed to standard error', async ($, on) => {
  const w = await standing(on, 'scaffold')
  w.runs.tsc = { exitCode: 0, stdout: '', stderr: 'npm warn exec The following package was not found and will be installed: typescript@5.9.3\n' }
  expect(await gate($)).toMatch(/^mod-builder: phase 4 \(Scaffold\) passed /)
})

test('a typecheck that exits 0 passes at Red though it printed a note and wrote to standard error', async ($, on) => {
  const w = await standing(on, 'red')
  w.runs.tsc = { exitCode: 0, stdout: 'a note\n', stderr: 'npm warn exec\n' }
  expect(await gate($)).toMatch(/^mod-builder: phase 5 \(Red\) passed /)
})

test('at Scaffold the typecheck is not run when the test run refuses, though validate passed', async ($, on) => {
  const w = await standing(on, 'scaffold')
  w.runs.test = { exitCode: 0, stdout: 'no count here\n' }
  w.runs.tsc = { exitCode: 2, stdout: 'error TS2322\n' }
  expect((await gate($)).split('\n')[0]).toBe("mod-builder: still at phase 4 (Scaffold). Not passed: the test run's last line reports no test count.")
  expect(w.ran.map(word)).toEqual(['--check', 'validate', 'test'])
})

test('at Red the typecheck is not run for any refusal of the test run', async ($, on) => {
  const refusals = [
    failing(['test 1'], ['counts a turn'], 'TypeError: x is not a function'),
    failing([], ['test 1']),
    failing(['counts a turn'], ['test 1']),
  ]
  const w = await standing(on, 'red')
  w.runs.tsc = { exitCode: 2, stdout: 'error TS2322\n' }
  for (const stdout of refusals) {
    w.ran.length = 0
    w.runs.test = { exitCode: 1, stdout }
    const answer = await gate($)
    expect(answer).toMatch(/^mod-builder: still at phase 5 \(Red\)\. Not passed: /)
    expect(answer).not.toMatch(/typecheck/)
    expect(w.ran.map(word)).toEqual(['test'])
  }
})

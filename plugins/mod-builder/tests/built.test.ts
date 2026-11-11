// SPEC.md 7.9, through the hooks module itself. The types (which corrects 7.7's decision 2): genuine types files of
// one build differ between sessions, so the typecheck runs once for each distinct content, in the order of their
// hashes, and passes only when every run does; it never picks one and never refuses because they differ. The
// "Built on" line: the gate prints it at Green and at Verify for the model to copy, and Verify refuses a "Built"
// block that lacks the hash of any types file it checks against. The lines: a refused validate or test run is
// quoted as a refused typecheck is, validate by what it printed before its plugin-directory section.
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { BUILT, GATE, HOME, MOD, NAME, TYPES, TYPES_FOLDER, TYPES_SHA, TYPES_TEXT, failing, passing, world } from './world'
import type { World } from './world'

const SPEC = `${MOD}/SPEC.md`
const APPROVED = '# turn-counter\n'
const TEST_FILE = `${MOD}/tests/pane.test.tsx`
const CONFIG = `${HOME}/.claude/mod-builder-data/v2/typecheck/s1/tsconfig.json`
const LOADED = `[DEBUG] hooks module ${NAME}@inline loaded (worker, environment 1, tier user); events: session.start\n`
// A second types file of the same build, as a session with the sandbox on writes one: other content, other hash.
const SANDBOXED = `${TYPES_FOLDER}/a094200f/plugin-authoring/types/claude-code.d.ts`
const SANDBOXED_TEXT = `${TYPES_TEXT}// allowed_domains\n`
const line = (hashes: string[], snapshot = '2026-11-10T151216Z') => `Built on Claude Code 2.1.322, from the docs snapshot ${snapshot}, against the types sha256 ${hashes.join(', ')}.`
const COPY = 'The "Built on" line for the "Built" block of SPEC.md, to copy exactly:'
const numbered = (count: number, word = 'line') => Array.from({ length: count }, (_, index) => `${word} ${index + 1}`)
// What `claude plugin validate --strict` printed for a contract that exports a value (the demonstration of 7.8),
// its marks written as plain letters.
const VALIDATE = [
  `Validating plugin manifest: ${MOD}/.claude-plugin/plugin.json`, '', 'x Found 1 error:', '',
  '  > types: line 16: `export` at the top level is followed by `type` or `interface`: a contract exports types and nothing else', '',
  `Validating hooks: ${MOD}/hooks/hooks.json`, '', '  > ./register.tsx hooks: session.start', '',
  `Plugin directory checks for ${MOD}. The plugin directory is the catalog that plugins are submitted to.`, '',
  'x Found 2 problems the plugin directory refuses a submission for:', '', '  > README.md: README missing (README_MISSING).', '  > LICENSE: License missing (LICENSE_MISSING).',
  ...numbered(20, 'directory note'), '', 'x Validation failed', '',
].join('\n')

const sha256 = async (text: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

// A world whose build stands at the phase named, as the gates before it would have left it.
const standing = async (on: Parameters<typeof world>[0], at: 'scaffold' | 'red' | 'green' | 'verify', files: Record<string, string> = {}) => {
  const w = world(on, {
    files: {
      [SPEC]: APPROVED, [`${MOD}/.claude-plugin/plugin.json`]: `{ "name": "${NAME}" }`, [TEST_FILE]: 'the first test', 'the load log': LOADED,
      [TYPES]: TYPES_TEXT, ...files,
    },
  })
  const after = at === 'green' || at === 'verify'
  w.store['session:s1'] = { modDir: MOD }
  w.store[`build:${MOD}`] = {
    modDir: MOD, sessionId: 's1', phase: at, specApprovedAt: 1, spec: { length: APPROVED.length, hash: await sha256(APPROVED) },
    testsAtScaffold: at === 'scaffold' ? null : 1, namesAtScaffold: at === 'scaffold' ? null : ['test 1'], testsAtRed: after ? 1 : null,
    testHashes: after ? { 'tests/pane.test.tsx': await sha256(btoa('the first test')) } : null, evidence: { knowledge: 'snapshot 2026-11-10T151216Z' },
  }
  return w
}
const gate = async ($: Engine) => String((await $.tool.call({ tool: GATE } as never)).result)
const phase = (w: World) => (w.store[`build:${MOD}`] as { phase: string }).phase
const typechecks = (w: World) => w.ran.filter((argv) => argv.includes('--noEmit'))
// The types file each typecheck ran against, read from the tsconfig as it stood while that run was under way.
const watched = (w: World) => {
  const against: string[] = []
  w.whileRunning = (argv) => {
    if (argv.includes('--noEmit')) against.push((JSON.parse(w.files[CONFIG] ?? '{}') as { include: string[] }).include[0] as string)
  }
  return against
}

// ------------------------------------------------------------------------------------------ the types

test('types files that differ are no reason to refuse: the typecheck runs once against each, in the order of their hashes, and Green passes', async ($, on) => {
  const w = await standing(on, 'green', { [SANDBOXED]: SANDBOXED_TEXT })
  const against = watched(w)
  const other = await sha256(SANDBOXED_TEXT)
  const order = [[TYPES_SHA, TYPES], [other, SANDBOXED]].sort((one, two) => ((one[0] as string) < (two[0] as string) ? -1 : 1))
  expect((await gate($)).split('\n')[0]).toBe(`mod-builder: phase 6 (Green) passed (validate, 1 tests, the typecheck (types sha256 ${order.map((one) => one[0]).join(', ')}) and a headless load of ${NAME} all pass; tests/ and SPEC.md are as recorded). The build is now at phase 7 (Verify).`)
  expect(typechecks(w).length).toBe(2)
  expect(against).toEqual(order.map((one) => one[1]))
})

test('five types files, four the same and one that differs, are two typechecks: one for each distinct content', async ($, on) => {
  const same = Object.fromEntries(['b05e15ee', 'b32e1761', 'e481894f'].map((name) => [`${TYPES_FOLDER}/${name}/plugin-authoring/types/claude-code.d.ts`, TYPES_TEXT]))
  const w = await standing(on, 'green', { ...same, [SANDBOXED]: SANDBOXED_TEXT })
  const against = watched(w)
  expect(await gate($)).toMatch(/^mod-builder: phase 6 \(Green\) passed /)
  expect(typechecks(w).length).toBe(2)
  expect([...against].sort()).toEqual([TYPES, SANDBOXED].sort())
})

test('the typecheck passes only when it passes against every types file: a failure against one names that file and quotes the compiler', async ($, on) => {
  const w = await standing(on, 'green', { [SANDBOXED]: SANDBOXED_TEXT })
  const other = await sha256(SANDBOXED_TEXT)
  const second = TYPES_SHA < other ? [SANDBOXED, other] : [TYPES, TYPES_SHA]
  // The first run passes; the run after it fails.
  w.whileRunning = (argv) => {
    if (argv.includes('--noEmit')) w.runs.tsc = { exitCode: 1, stdout: `${numbered(25, 'error').join('\n')}\n` }
  }
  expect((await gate($)).split('\n')).toEqual([
    'mod-builder: still at phase 6 (Green). Not passed: the typecheck exited 1.',
    `The last lines of its output, against the types file ${second[0]} (sha256 ${second[1]}):`,
    ...numbered(25, 'error').slice(5),
  ])
  expect(typechecks(w).length).toBe(2)
  expect(phase(w)).toBe('green')
})

test('a typecheck that fails against the first types file is not run against the next, and names the first', async ($, on) => {
  const w = await standing(on, 'verify', { [SANDBOXED]: SANDBOXED_TEXT, [SPEC]: `${APPROVED}${BUILT}${await sha256(SANDBOXED_TEXT)}\n` })
  const other = await sha256(SANDBOXED_TEXT)
  const first = TYPES_SHA < other ? [TYPES, TYPES_SHA] : [SANDBOXED, other]
  w.runs.tsc = { exitCode: 2, stdout: 'hooks/register.tsx(3,7): error TS2322\n' }
  expect(await gate($)).toBe(`mod-builder: still at phase 7 (Verify). Not passed: the typecheck exited 2.\nThe last lines of its output, against the types file ${first[0]} (sha256 ${first[1]}):\nhooks/register.tsx(3,7): error TS2322`)
  expect(typechecks(w).length).toBe(1)
})

test('a planted types file can only make the check stricter: a mod that passes against the build\'s own and fails against the planted one is refused', async ($, on) => {
  const planted = `${TYPES_FOLDER}/0000/plugin-authoring/types/claude-code.d.ts`
  const plantedText = `${TYPES_TEXT}export type Planted = never\n`
  const w = await standing(on, 'green', { [planted]: plantedText })
  const plantedSha = await sha256(plantedText)
  const fail = { exitCode: 1, stdout: 'error TS2322\n' }
  // The compiler passes against the build's own file and fails against the planted one, whichever is checked first.
  w.runs.tsc = plantedSha < TYPES_SHA ? fail : { exitCode: 0, stdout: '' }
  w.whileRunning = (argv) => {
    if (argv.includes('--noEmit')) w.runs.tsc = fail
  }
  expect(await gate($)).toBe(`mod-builder: still at phase 6 (Green). Not passed: the typecheck exited 1.\nThe last lines of its output, against the types file ${planted} (sha256 ${plantedSha}):\nerror TS2322`)
  expect(phase(w)).toBe('green')
})

test('with one types file the typecheck runs once, and with none Green still refuses and runs nothing', async ($, on) => {
  const w = await standing(on, 'green')
  expect(await gate($)).toMatch(/^mod-builder: phase 6 \(Green\) passed /)
  expect(typechecks(w).length).toBe(1)
  w.store[`build:${MOD}`] = { ...(w.store[`build:${MOD}`] as object), phase: 'green' }
  delete w.files[TYPES]
  w.ran.length = 0
  expect(await gate($)).toMatch(/Not passed: the types of Claude Code 2\.1\.322 are not written yet/)
  expect(w.ran).toEqual([])
})

// ------------------------------------------------------------------------------------- the "Built on" line

test('Green\'s answer ends with the exact "Built on" line to write: the build, the snapshot the build began with, every types hash, sorted', async ($, on) => {
  const w = await standing(on, 'green', { [SANDBOXED]: SANDBOXED_TEXT })
  const hashes = [TYPES_SHA, await sha256(SANDBOXED_TEXT)].sort()
  expect((await gate($)).split('\n').slice(1)).toEqual([COPY, line(hashes)])
  expect((w.store[`build:${MOD}`] as { evidence: Record<string, string> }).evidence.green).toMatch(new RegExp(`types sha256 ${hashes.join(', ')}\\)`))
})

test('Verify refuses a "Built" block that does not hold the hash of the types it checks against: it names the hash, prints the line, and runs nothing', async ($, on) => {
  const w = await standing(on, 'verify', { [SPEC]: `${APPROVED}\n## Built\n\nBuilt on Claude Code 2.1.322, against the types sha256 ${'0'.repeat(64)}.\n` })
  expect(await gate($)).toBe(`mod-builder: still at phase 7 (Verify). Not passed: the "Built" block of SPEC.md does not hold the sha256 of the types this gate checks against (expected: ${TYPES_SHA}).\n${COPY}\n${line([TYPES_SHA])}`)
  expect(w.ran.filter((argv) => argv.at(-1) !== '-v')).toEqual([])
  expect(phase(w)).toBe('verify')
  w.files[SPEC] = `${APPROVED}\n## Built\n\n${line([TYPES_SHA])}\nAs specified.\n`
  expect((await gate($)).split('\n')).toEqual([
    `mod-builder: phase 7 (Verify) passed (validate, 1 tests, the typecheck (types sha256 ${TYPES_SHA}) and a headless load of ${NAME} all pass). The build is now at phase 8 (Done).`,
    COPY, line([TYPES_SHA]),
  ])
})

test('with no "Built" block at all Verify refuses the same way', async ($, on) => {
  const w = await standing(on, 'verify')
  expect(await gate($)).toMatch(/Not passed: the "Built" block of SPEC\.md does not hold the sha256 of the types this gate checks against \(expected: 961c15e9/)
  expect(phase(w)).toBe('verify')
})

test('a "Built" block must hold every distinct hash: with one of two missing, Verify names the missing one', async ($, on) => {
  const other = await sha256(SANDBOXED_TEXT)
  const w = await standing(on, 'verify', { [SANDBOXED]: SANDBOXED_TEXT, [SPEC]: `${APPROVED}${BUILT}` })
  expect((await gate($)).split('\n')).toEqual([
    `mod-builder: still at phase 7 (Verify). Not passed: the "Built" block of SPEC.md does not hold the sha256 of the types this gate checks against (expected: ${other}).`,
    COPY, line([TYPES_SHA, other].sort()),
  ])
  w.files[SPEC] = `${APPROVED}\n## Built\n\n${line([TYPES_SHA, other].sort())}\n`
  expect(await gate($)).toMatch(/^mod-builder: phase 7 \(Verify\) passed /)
})

test('a hash in the approved part of SPEC.md is not in the "Built" block: only what was appended counts', async ($, on) => {
  const approved = `# turn-counter\ntypes sha256 ${TYPES_SHA}\n`
  const w = await standing(on, 'verify', { [SPEC]: `${approved}\n## Built\n\nBuilt on Claude Code 2.1.322.\n` })
  w.store[`build:${MOD}`] = { ...(w.store[`build:${MOD}`] as object), spec: { length: approved.length, hash: await sha256(approved) } }
  expect(await gate($)).toMatch(/Not passed: the "Built" block of SPEC\.md does not hold the sha256/)
})

test('a build with no snapshot recorded at Knowledge is given a line that says so, never a snapshot made up', async ($, on) => {
  const w = await standing(on, 'green')
  w.store[`build:${MOD}`] = { ...(w.store[`build:${MOD}`] as object), evidence: {} }
  expect((await gate($)).split('\n').slice(1)).toEqual([COPY, line([TYPES_SHA], 'unknown')])
})

// -------------------------------------------------------------- the lines of a refused validate or test run

test('Scaffold refused for validate is answered with what validate found: the lines before its plugin-directory section, none after', async ($, on) => {
  const w = await standing(on, 'scaffold')
  w.runs.validate = { exitCode: 1, stdout: VALIDATE }
  const answer = (await gate($)).split('\n')
  expect(answer.slice(0, 2)).toEqual(['mod-builder: still at phase 4 (Scaffold). Not passed: claude plugin validate --strict exited 1.', 'The last lines of its output:'])
  expect(answer.slice(2)).toEqual(VALIDATE.split('\n').slice(0, 9))
  expect(answer.join('\n')).toMatch(/types: line 16: `export` at the top level/)
  expect(answer.join('\n')).not.toMatch(/README|LICENSE|directory note|Validation failed/)
})

test('a validate that printed no plugin-directory section is quoted by its last 20 lines', async ($, on) => {
  const w = await standing(on, 'scaffold')
  w.runs.validate = { exitCode: 1, stdout: `${numbered(25).join('\n')}\n` }
  expect((await gate($)).split('\n').slice(2)).toEqual(numbered(25).slice(5))
  w.runs.validate = { exitCode: 1, stdout: `${numbered(30, 'finding').join('\n')}\nPlugin directory checks for ${MOD}.\nmore\n` }
  expect((await gate($)).split('\n').slice(2)).toEqual(numbered(30, 'finding').slice(10))
})

test('Scaffold refused for the tests is answered with the last 20 lines of the test run', async ($, on) => {
  const w = await standing(on, 'scaffold')
  w.runs.test = { exitCode: 1, stdout: `${numbered(25, 'test line').join('\n')}\n` }
  const answer = (await gate($)).split('\n')
  expect(answer[0]).toMatch(/^mod-builder: still at phase 4 \(Scaffold\)\. Not passed: /)
  expect(answer.slice(1)).toEqual(['The last lines of its output:', ...numbered(25, 'test line').slice(5)])
})

test('Red refused is answered with the last 20 lines of the test run, so the test that did not fail by assertion can be seen', async ($, on) => {
  const w = await standing(on, 'red')
  const report = failing(['test 1'], ['counts a turn'], 'TypeError: undefined is not a function')
  w.runs.test = { exitCode: 1, stdout: report }
  const answer = (await gate($)).split('\n')
  expect(answer[0]).toMatch(/^mod-builder: still at phase 5 \(Red\)\. Not passed: not failing by assertion/)
  expect(answer[1]).toBe('The last lines of its output:')
  expect(answer.slice(2).join('\n')).toBe(report.replace(/\n+$/, ''))
  expect(answer.join('\n')).toMatch(/TypeError: undefined is not a function/)
  w.runs.test = { exitCode: 0, stdout: `${numbered(30, 'filler').join('\n')}\n${passing(1)}` }
  expect((await gate($)).split('\n').length).toBe(22)
})

test('Green and Verify refused for validate or for the tests are answered the same way', async ($, on) => {
  const w = await standing(on, 'green')
  w.runs.validate = { exitCode: 1, stdout: VALIDATE }
  expect((await gate($)).split('\n').slice(1)).toEqual(['The last lines of its output:', ...VALIDATE.split('\n').slice(0, 9)])
  w.runs.validate = { exitCode: 0, stdout: 'Validation passed' }
  const report = failing(['test 1'], ['counts a turn'])
  w.runs.test = { exitCode: 1, stdout: report }
  expect(await gate($)).toBe(`mod-builder: still at phase 6 (Green). Not passed: claude plugin test exited 1: not every test passes.\nThe last lines of its output:\n${report.replace(/\n+$/, '')}`)
  expect(phase(w)).toBe('green')
})

test('a command that printed nothing is quoted from standard error, and a refusal that ran no command quotes nothing', async ($, on) => {
  const w = await standing(on, 'scaffold')
  w.runs.validate = { exitCode: 1, stdout: '', stderr: 'validate: could not read the manifest\n' }
  expect(await gate($)).toBe('mod-builder: still at phase 4 (Scaffold). Not passed: claude plugin validate --strict exited 1.\nThe last lines of its output:\nvalidate: could not read the manifest')
  w.runs.validate = 'never starts'
  expect(await gate($)).toBe('mod-builder: still at phase 4 (Scaffold). Not passed: claude plugin validate --strict ended with no exit code.')
})

// ------------------------------------------------------------------- what the tests' reader asked for

test('a typecheck that fails and prints nothing still names the types file it failed against', async ($, on) => {
  const w = await standing(on, 'green', { [SANDBOXED]: SANDBOXED_TEXT })
  const other = await sha256(SANDBOXED_TEXT)
  const first = TYPES_SHA < other ? [TYPES, TYPES_SHA] : [SANDBOXED, other]
  w.runs.tsc = { exitCode: 1, stdout: '' }
  expect(await gate($)).toBe(`mod-builder: still at phase 6 (Green). Not passed: the typecheck exited 1.\nIt printed nothing. It ran against the types file ${first[0]} (sha256 ${first[1]}).`)
  w.runs.tsc = 'never starts'
  expect(await gate($)).toBe(`mod-builder: still at phase 6 (Green). Not passed: the typecheck ended with no exit code.\nIt printed nothing. It ran against the types file ${first[0]} (sha256 ${first[1]}).`)
})

test('when validate and the tests both fail, the lines quoted are validate\'s, the command the refusal names: at Scaffold, Green and Verify', async ($, on) => {
  const w = await standing(on, 'scaffold')
  w.runs.validate = { exitCode: 1, stdout: 'validate says no\n' }
  w.runs.test = { exitCode: 1, stdout: 'tests say no\n' }
  for (const at of ['scaffold', 'green', 'verify'] as const) {
    w.store[`build:${MOD}`] = { ...(w.store[`build:${MOD}`] as object), phase: at, testsAtScaffold: 1, namesAtScaffold: ['test 1'], testsAtRed: 1, testHashes: { 'tests/pane.test.tsx': await sha256(btoa('the first test')) } }
    w.files[SPEC] = at === 'verify' ? `${APPROVED}${BUILT}` : APPROVED
    expect((await gate($)).split('\n').slice(0, 3)).toEqual([expect.stringMatching(/Not passed: claude plugin validate --strict exited 1\.$/), 'The last lines of its output:', 'validate says no'])
  }
})

test('the lines quoted are those of the command the refusal names, though another failed beside it', async ($, on) => {
  const w = await standing(on, 'green')
  w.runs.validate = { exitCode: 1, stdout: 'validate says no\n' }
  w.runs.tsc = 'never starts'
  w.compilers['npx --no-install tsc'] = { exitCode: 0, stdout: 'Version 5.9.3\n' }
  const answer = await gate($)
  expect(answer.split('\n')[0]).toBe('mod-builder: still at phase 6 (Green). Not passed: the typecheck ended with no exit code.')
  expect(answer).not.toMatch(/validate says no/)
  expect(answer).toMatch(/It printed nothing\. It ran against the types file /)
})

test('Verify refused for validate or for the tests is answered with that command\'s lines', async ($, on) => {
  const w = await standing(on, 'verify', { [SPEC]: `${APPROVED}${BUILT}` })
  w.runs.validate = { exitCode: 1, stdout: VALIDATE }
  expect((await gate($)).split('\n').slice(0, 2)).toEqual(['mod-builder: still at phase 7 (Verify). Not passed: claude plugin validate --strict exited 1.', 'The last lines of its output:'])
  w.runs.validate = { exitCode: 0, stdout: 'Validation passed' }
  w.runs.test = { exitCode: 1, stdout: failing(['test 1'], ['counts a turn']) }
  expect(await gate($)).toMatch(/^mod-builder: still at phase 7 \(Verify\)\. Not passed: claude plugin test exited 1: not every test passes\.\nThe last lines of its output:\n/)
})

test('a test run that printed nothing is quoted from standard error, at Scaffold and at Red', async ($, on) => {
  const w = await standing(on, 'scaffold')
  w.runs.test = { exitCode: 1, stdout: '', stderr: 'the runner could not start\n' }
  expect((await gate($)).split('\n').slice(1)).toEqual(['The last lines of its output:', 'the runner could not start'])
  w.store[`build:${MOD}`] = { ...(w.store[`build:${MOD}`] as object), phase: 'red', testsAtScaffold: 1, namesAtScaffold: ['test 1'] }
  expect((await gate($)).split('\n').slice(1)).toEqual(['The last lines of its output:', 'the runner could not start'])
})

test('the record carries every types hash, sorted, once Green has passed against two types files, and the pane at Verify shows the typecheck to run again', async ($, on) => {
  const w = await standing(on, 'green', { [SANDBOXED]: SANDBOXED_TEXT })
  await gate($)
  const ui = await $.ui.mount({ plugin: 'mod-builder', component: 'Pane', requestId: 'mod-builder', surface: 'terminal', props: { title: 'mod-builder', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} } })
  const texts = (await ui.findAll({ type: 'Text' })).map((text) => text.text)
  await ui.unmount()
  const hashes = [TYPES_SHA, await sha256(SANDBOXED_TEXT)].sort()
  expect(texts).toContain('tsc against the 2.1.322 types')
  expect((w.store[`build:${MOD}`] as { evidence: Record<string, string> }).evidence.green).toMatch(new RegExp(`types sha256 ${hashes.join(', ')}\\)`))
})

test('a "Built" block does not hold a hash that is only part of a longer number', async ($, on) => {
  const w = await standing(on, 'verify', { [SPEC]: `${APPROVED}\n## Built\n\nagainst the types sha256 0${TYPES_SHA}.\n` })
  expect(await gate($)).toMatch(/Not passed: the "Built" block of SPEC\.md does not hold the sha256/)
  w.files[SPEC] = `${APPROVED}\n## Built\n\nagainst the types sha256 ${TYPES_SHA}f.\n`
  expect(await gate($)).toMatch(/Not passed: the "Built" block of SPEC\.md does not hold the sha256/)
})

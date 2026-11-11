// The gate tool (SPEC.md 3.3, "Advancing on evidence, never on the model's word"), through the hooks module
// itself: each phase's check is run by the mod, and the build's record moves only on what the check shows.
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { BUILT, GATE, HOME, MOD, NAME, failing, passing, world } from './world'
import type { World } from './world'

const BUILD = { skill: 'build', text: 'the eight phases', source: 'plugin', pluginName: 'mod-builder', frontmatter: {} } as const
const LATEST = `${HOME}/.claude/mod-builder-data/v2/docs/latest`
const SPEC = `${MOD}/SPEC.md`
// A headless session loads every enabled mod; the one being built is one line among them.
const OTHERS = '[DEBUG] hooks module mod-builder@inline loaded (worker, environment 2, tier user); events: session.start\n[DEBUG] hooks module turn-counter@claudemod loaded (worker, environment 3, tier user); events: tool.call\n'
const LOADED = `${OTHERS}[DEBUG] hooks module ${NAME}@inline loaded (worker, environment 1, tier user); events: session.start\n`
const MANIFEST = `{ "name": "${NAME}" }`

const gate = async ($: Engine, modDir?: string) => {
  const answer = await $.tool.call({ tool: GATE, ...(modDir === undefined ? {} : { mod_dir: modDir }) } as never)
  // The whole answer: a test that compares it says that nothing follows its one line.
  return String(answer.result)
}
// The first line of an answer that goes on: what a refusal quotes beneath it, and the line a passed Green or Verify
// adds, have tests of their own (decisions.test.ts, built.test.ts).
const first = (answer: string) => answer.split('\n')[0] as string
const phase = (w: World) => (w.store[`build:${MOD}`] as { phase: string }).phase
const kept = (w: World) => w.store[`build:${MOD}`] as Record<string, unknown>

// A world with the build already at a phase, as the gates before it would have left it.
const at = async (on: Parameters<typeof world>[0], phaseName: string, more: Partial<World> = {}) => {
  const files: Record<string, string> = {
    [LATEST]: '2026-11-10T151216Z\n',
    [SPEC]: '# turn-counter\n',
    [`${MOD}/.claude-plugin/plugin.json`]: MANIFEST,
    [`${MOD}/tests/pane.test.tsx`]: 'the first test',
    'the load log': LOADED,
    ...more.files,
  }
  const w = world(on, { ...more, files })
  w.store['session:s1'] = { modDir: MOD }
  w.store[`build:${MOD}`] = {
    modDir: MOD, sessionId: 's1', phase: phaseName, specApprovedAt: null, spec: null, testsAtScaffold: null, namesAtScaffold: null,
    testsAtRed: null, testHashes: null, evidence: {},
  }
  return w
}

// Walks a build from its opening to the phase named, through the gate itself.
const walk = async ($: Engine, w: World, to: 'spec' | 'scaffold' | 'red' | 'green' | 'verify' | 'done') => {
  const order = ['knowledge', 'describe', 'spec', 'scaffold', 'red', 'green', 'verify', 'done']
  await $.skill.prompt(BUILD)
  await gate($, 'turn-counter')
  while (order.indexOf(phase(w)) < order.indexOf(to)) {
    const now = phase(w)
    if (now === 'red') {
      w.files[`${MOD}/tests/counts.test.tsx`] = 'the new test'
      w.runs.test = { exitCode: 1, stdout: failing(['test 1'], ['counts a turn']) }
    }
    if (now === 'green') w.runs.test = { exitCode: 0, stdout: passing(2, ['test 1', 'counts a turn']) }
    const answer = await gate($)
    if (phase(w) === now) throw new Error(`the walk stopped at ${now}: ${answer}`)
    // At Verify the "Built" block is written, with the hash of the types the gate checks against.
    if (phase(w) === 'verify') w.files[SPEC] = `${w.files[SPEC]}${BUILT}`
  }
}

const fresh = (on: Parameters<typeof world>[0], more: Partial<World> = {}) =>
  world(on, {
    ...more,
    files: {
      [LATEST]: '2026-11-10T151216Z\n',
      [SPEC]: '# turn-counter\n',
      [`${MOD}/.claude-plugin/plugin.json`]: MANIFEST,
      [`${MOD}/tests/pane.test.tsx`]: 'the first test',
      'the load log': LOADED,
      ...more.files,
    },
  })

test('with no build open the gate says so and changes nothing', async ($, on) => {
  const w = world(on)
  expect(await gate($, 'turn-counter')).toBe('mod-builder: no build is open in this session. /mod-builder:build <what the mod should do> starts one, and /mod-builder:edit <mod folder> <what to change> an edit.')
  expect(w.store).toEqual({})
})

test('the first call names the mod\'s folder: the record is made at Knowledge, bound to the session, under the absolute folder', async ($, on) => {
  const w = fresh(on)
  await $.skill.prompt(BUILD)
  expect(await gate($, 'turn-counter')).toBe(
    `mod-builder: the build's mod folder is ${MOD}. It is at phase 1 (Knowledge). Call mod_builder_gate again to ask for the next phase.`,
  )
  expect(w.store['session:s1']).toEqual({ modDir: MOD })
  expect(kept(w)).toEqual({
    modDir: MOD, sessionId: 's1', phase: 'knowledge', specApprovedAt: null, spec: null, testsAtScaffold: null, namesAtScaffold: null,
    testsAtRed: null, testHashes: null, evidence: {},
  })
})

test('a pending build that names no folder, or one that is none, stays pending', async ($, on) => {
  const w = fresh(on)
  await $.skill.prompt(BUILD)
  expect(await gate($)).toMatch(/has not named its mod's folder\. Call mod_builder_gate with mod_dir/)
  expect(await gate($, '')).toMatch(/has not named its mod's folder/)
  expect(await gate($, '../../..')).toMatch(/has not named its mod's folder/)
  expect(w.store).toEqual({ 'session:s1': { modDir: null } })
})

test('a folder another session is building can\'t be named; one it finished can', async ($, on) => {
  const w = fresh(on)
  w.store[`build:${MOD}`] = { modDir: MOD, sessionId: 's2', phase: 'red' }
  await $.skill.prompt(BUILD)
  expect(await gate($, MOD)).toBe(`mod-builder: ${MOD} is being built by another session (it is at phase 5 (Red)). Name another folder.`)
  expect(w.store['session:s1']).toEqual({ modDir: null })
  w.store[`build:${MOD}`] = { modDir: MOD, sessionId: 's2', phase: 'done' }
  await gate($, MOD)
  expect(kept(w).sessionId).toBe('s1')
  expect(phase(w)).toBe('knowledge')
})

test('once named, the folder stays: a call that names another is refused and runs no check', async ($, on) => {
  const w = await at(on, 'knowledge')
  expect(await gate($, '/work/other')).toBe(`mod-builder: this session's build is in ${MOD}, and stays there. Call mod_builder_gate without mod_dir.`)
  expect(phase(w)).toBe('knowledge')
  expect(await gate($, 'turn-counter')).toMatch(/phase 1 \(Knowledge\) passed/)
})

test('Knowledge ends when a snapshot exists, and not before', async ($, on) => {
  const w = await at(on, 'knowledge')
  delete w.files[LATEST]
  expect(await gate($)).toBe('mod-builder: still at phase 1 (Knowledge). Not passed: no snapshot of the mod documentation exists yet: run /mod-builder refresh.')
  expect(phase(w)).toBe('knowledge')
  w.files[LATEST] = '2026-11-10T151216Z\n'
  expect(await gate($)).toBe('mod-builder: phase 1 (Knowledge) passed (snapshot 2026-11-10T151216Z). The build is now at phase 2 (Describe).')
  expect(kept(w).evidence).toEqual({ knowledge: 'snapshot 2026-11-10T151216Z' })
})

test('Describe has no gate: the next call opens Spec', async ($, on) => {
  const w = await at(on, 'describe')
  expect(await gate($)).toMatch(/now at phase 3 \(Spec\)/)
  expect(w.ran).toEqual([])
  expect(w.asked).toEqual([])
})

test('Spec to Scaffold asks the person, with "Not yet" first, and only "Approve" moves the build', async ($, on) => {
  const w = await at(on, 'spec', { answer: 'Not yet', now: 1731250000000 })
  expect(await gate($)).toBe('mod-builder: still at phase 3 (Spec). Not passed: the person has not approved the spec (answer: "Not yet").')
  expect(w.asked).toEqual([{ question: `Approve the spec of this mod? (${SPEC}) Nothing under hooks/ or tests/ can be written until you approve.`, options: ['Not yet', 'Approve'] }])
  expect(phase(w)).toBe('spec')
  for (const typed of ['looks fine to me', 'approve', 'Approved', 'Approve ', 'do not Approve', 'Approve, Not yet', 'See it first: draw mockups with /design', '']) {
    w.answer = typed
    expect(await gate($)).toMatch(/still at phase 3 \(Spec\)\. Not passed: the person has not approved the spec/)
  }
  expect(phase(w)).toBe('spec')
  expect(kept(w).spec).toBe(null)
  w.answer = 'Approve'
  expect(await gate($)).toBe('mod-builder: phase 3 (Spec) passed (the person answered "Approve"). The build is now at phase 4 (Scaffold).')
  expect(kept(w).specApprovedAt).toBe(1731250000000)
  expect((kept(w).spec as { length: number }).length).toBe('# turn-counter\n'.length)
})

test('the question offers mockups only when a skill named design is in the session\'s list', async ($, on) => {
  const w = await at(on, 'spec', { answer: 'Not yet', commands: ['help', 'frontend:design'] })
  await gate($)
  expect(w.asked[0]?.options).toEqual(['Not yet', 'Approve', 'See it first: draw mockups with /design'])
  w.commands = ['help', 'designer', 'redesign']
  await gate($)
  expect(w.asked[1]?.options).toEqual(['Not yet', 'Approve'])
})

test('a dismissed question, a missing SPEC.md, and a SPEC.md changed while the person was asked each leave the build at Spec', async ($, on) => {
  const w = await at(on, 'spec', { answer: null })
  expect(await gate($)).toMatch(/still at phase 3 \(Spec\)\. Not passed: the person could not be asked/)
  w.answer = 'Approve'
  w.whileAsked = () => {
    w.files[SPEC] = '# turn-counter, and more\n'
  }
  expect(await gate($)).toMatch(/Not passed: SPEC\.md changed while the person was being asked/)
  w.whileAsked = () => {}
  delete w.files[SPEC]
  expect(await gate($)).toMatch(/Not passed: \/work\/turn-counter\/SPEC\.md does not exist yet/)
  expect(w.asked.length).toBe(2)
  expect(phase(w)).toBe('spec')
  expect(kept(w).spec).toBe(null)
})

test('Scaffold to Red runs validate --strict and the tests itself, and records the count and the names', async ($, on) => {
  const w = fresh(on, { runs: { validate: { exitCode: 0, stdout: 'Validation passed' }, test: { exitCode: 0, stdout: passing(2, ['draws the pane', 'opens on command']) }, tsc: { exitCode: 0, stdout: '' } } })
  await walk($, w, 'scaffold')
  w.ran.length = 0
  // The typecheck that follows them (SPEC.md 7.10) has its tests in early-typecheck.test.ts.
  expect(await gate($)).toMatch(/^mod-builder: phase 4 \(Scaffold\) passed \(hooks\/ and tests\/ are as the scaffold laid them; claude plugin validate --strict exited 0; 2 tests ran; the typecheck passes \(types sha256 [0-9a-f]{64}\)\)\. The build is now at phase 5 \(Red\)\.$/)
  expect(w.ran.slice(1, 3)).toEqual([['claude', 'plugin', 'validate', '--strict', MOD], ['claude', 'plugin', 'test', MOD]])
  expect(kept(w).testsAtScaffold).toBe(2)
  expect(kept(w).namesAtScaffold).toEqual(['draws the pane', 'opens on command'])
})

test('Scaffold stays when validate fails or can\'t start', async ($, on) => {
  const w = fresh(on)
  await walk($, w, 'scaffold')
  w.runs.validate = { exitCode: 1, stdout: 'Validation failed' }
  expect(first(await gate($))).toBe('mod-builder: still at phase 4 (Scaffold). Not passed: claude plugin validate --strict exited 1.')
  w.runs.validate = 'never starts'
  expect(await gate($)).toBe('mod-builder: still at phase 4 (Scaffold). Not passed: claude plugin validate --strict ended with no exit code.')
  expect(phase(w)).toBe('scaffold')
})

test('Red to Green passes when a test new since Scaffold fails by assertion, and hashes every file under tests/', async ($, on) => {
  const w = fresh(on)
  await walk($, w, 'red')
  w.files[`${MOD}/tests/counts.test.tsx`] = 'the new test'
  w.files[`${MOD}/tests/deep/more.test.tsx`] = 'another'
  w.runs.test = { exitCode: 1, stdout: failing(['test 1'], ['counts a turn']) }
  expect(await gate($)).toMatch(/^mod-builder: phase 5 \(Red\) passed \(2 tests ran, the new ones failing by assertion; the typecheck passes \(types sha256 [0-9a-f]{64}\); 3 files under tests\/ hashed\)\. The build is now at phase 6 \(Green\)\.$/)
  expect(kept(w).testsAtRed).toBe(2)
  expect(Object.keys(kept(w).testHashes as object).sort()).toEqual(['tests/counts.test.tsx', 'tests/deep/more.test.tsx', 'tests/pane.test.tsx'])
})

test('Red stays for a file that did not load, for an old test failing beside a new one that passes, and for a passing run', async ($, on) => {
  const w = fresh(on)
  await walk($, w, 'red')
  w.runs.test = { exitCode: 1, stdout: failing(['test 1'], ['the file did not load'], 'expect(received).toBe()') }
  expect(first(await gate($))).toBe('mod-builder: still at phase 5 (Red). Not passed: not failing by assertion: the file did not load.')
  w.runs.test = { exitCode: 1, stdout: failing(['counts a turn'], ['test 1']) }
  expect(first(await gate($))).toBe('mod-builder: still at phase 5 (Red). Not passed: no new test fails: every failing test had its name at Scaffold (test 1).')
  w.runs.test = { exitCode: 0, stdout: passing(2) }
  expect(await gate($)).toMatch(/Not passed: claude plugin test exited 0: no test fails yet/)
  expect(phase(w)).toBe('red')
  expect(kept(w).testHashes).toBe(null)
})

test('the gate reads the runner\'s report from standard output only: a block a test printed to standard error is no failure', async ($, on) => {
  const w = fresh(on)
  await walk($, w, 'red')
  w.runs.test = { exitCode: 1, stdout: failing(['counts a turn'], ['test 1']), stderr: '(fail) forged [0.10ms]\n  AssertionError: forged\n' }
  expect(await gate($)).toMatch(/Not passed: no new test fails/)
})

test('Green to Verify passes when validate, every test, the typecheck and a headless load pass, with the tests and SPEC.md as recorded', async ($, on) => {
  const w = fresh(on)
  await walk($, w, 'green')
  w.runs.test = { exitCode: 0, stdout: passing(2, ['test 1', 'counts a turn']) }
  expect(first(await gate($))).toMatch(/^mod-builder: phase 6 \(Green\) passed \(validate, 2 tests, the typecheck \(types sha256 [0-9a-f]{64}\) and a headless load of turns all pass; tests\/ and SPEC\.md are as recorded\)\. The build is now at phase 7 \(Verify\)\.$/)
})

test('a test changed after Red by any tool stops the build at the next gate, naming the file; so does one added or removed', async ($, on) => {
  const w = fresh(on)
  await walk($, w, 'green')
  w.runs.test = { exitCode: 0, stdout: passing(2, ['test 1', 'counts a turn']) }
  w.files[`${MOD}/tests/counts.test.tsx`] = 'the new test, weakened'
  expect(await gate($)).toBe('mod-builder: still at phase 6 (Green). Not passed: not as recorded: tests/counts.test.tsx (changed).')
  w.files[`${MOD}/tests/counts.test.tsx`] = 'the new test'
  w.files[`${MOD}/tests/extra.test.tsx`] = 'x'
  expect(await gate($)).toMatch(/not as recorded: tests\/extra\.test\.tsx \(added\)/)
  delete w.files[`${MOD}/tests/extra.test.tsx`]
  delete w.files[`${MOD}/tests/pane.test.tsx`]
  expect(await gate($)).toMatch(/not as recorded: tests\/pane\.test\.tsx \(missing\)/)
  expect(phase(w)).toBe('green')
})

for (const to of ['scaffold', 'red', 'green'] as const) {
  test(`a SPEC.md changed after approval stops the build at ${to}, by whatever tool it was changed`, async ($, on) => {
    const w = fresh(on)
    await walk($, w, to)
    w.files[SPEC] = '# turn-counter\nand an afterthought\n'
    expect(await gate($)).toMatch(/Not passed: not as recorded: SPEC\.md \(changed\)/)
    expect(phase(w)).toBe(to)
  })
}

test('Verify to Done runs validate, the tests, the typecheck and a headless load, and reads the load in its debug log', async ($, on) => {
  const w = fresh(on)
  await walk($, w, 'verify')
  w.ran.length = 0
  expect(first(await gate($))).toMatch(/^mod-builder: phase 7 \(Verify\) passed \(validate, 2 tests, the typecheck \(types sha256 [0-9a-f]{64}\) and a headless load of turns all pass\)\. The build is now at phase 8 \(Done\)\.$/)
  const log = `${HOME}/.claude/mod-builder-data/v2/loads/s1.log`
  expect(w.ran).toEqual([
    ['npx', '--no-install', 'tsc', '-v'],
    ['claude', 'plugin', 'validate', '--strict', MOD],
    ['claude', 'plugin', 'test', MOD],
    ['npx', '--no-install', 'tsc', '--noEmit', '--pretty', 'false', '-p', `${HOME}/.claude/mod-builder-data/v2/typecheck/s1/tsconfig.json`],
    ['claude', '--plugin-dir', MOD, '-p', '/cost', '--debug-file', log],
  ])
  expect(Object.keys(kept(w).evidence as object)).toEqual(['knowledge', 'describe', 'spec', 'scaffold', 'red', 'green', 'verify'])
})

test('Verify stays when the typecheck fails, when the load\'s log shows the module failed to load, and when SPEC.md\'s approved part changed', async ($, on) => {
  const w = fresh(on)
  await walk($, w, 'verify')
  w.runs.tsc = { exitCode: 2, stdout: 'error TS2322' }
  expect(first(await gate($))).toBe('mod-builder: still at phase 7 (Verify). Not passed: the typecheck exited 2.')
  w.runs.tsc = { exitCode: 0, stdout: '' }
  w.files['the load log'] = `${OTHERS}[ERROR] hooks module ${NAME}@inline failed to load: ${NAME}: /work/turn-counter/hooks/register.tsx does not parse\n`
  expect(await gate($)).toMatch(/Not passed: the headless load's debug log does not show the mod loaded/)
  w.files['the load log'] = `${LOADED}[ERROR] ${NAME}: hooks module did not load: x\n`
  expect(await gate($)).toMatch(/Not passed: the headless load's debug log does not show the mod loaded/)
  w.files['the load log'] = OTHERS
  expect(await gate($)).toMatch(/Not passed: the headless load's debug log does not show the mod loaded/)
  w.files['the load log'] = LOADED
  w.files[SPEC] = '# turn-counter!\n\n## Built\n'
  expect(await gate($)).toMatch(/Not passed: not as recorded: SPEC\.md \(its approved part changed\)/)
  expect(phase(w)).toBe('verify')
})

test('an earlier load\'s log is not read as this one\'s: the log starts empty for each load', async ($, on) => {
  const w = fresh(on)
  await walk($, w, 'verify')
  w.files[`${HOME}/.claude/mod-builder-data/v2/loads/s1.log`] = LOADED
  delete w.files['the load log']
  expect(await gate($)).toMatch(/Not passed: the headless load's debug log does not show the mod loaded/)
})

test('after Done the gate moves nothing', async ($, on) => {
  const w = await at(on, 'done')
  expect(await gate($)).toBe('mod-builder: still at phase 8 (Done). Not passed: the build is done: nothing follows phase 8.')
  expect(phase(w)).toBe('done')
  expect(w.ran).toEqual([])
})

test('a whole build walks from the skill to Done through the gate alone, one phase a call', async ($, on) => {
  const w = fresh(on)
  await walk($, w, 'done')
  expect(phase(w)).toBe('done')
  expect(w.asked.length).toBe(1)
})

test('another session\'s gate call does not move this build', async ($, on) => {
  const w = await at(on, 'describe')
  w.sessionId = 's2'
  expect(await gate($)).toMatch(/no build is open in this session/)
  expect(phase(w)).toBe('describe')
})

test('a write under hooks/ is refused until the person has approved the spec, and the same write passes once the gate has opened Scaffold', async ($, on) => {
  const w = fresh(on, { answer: 'Not yet' })
  const write = async () => (await $.tool.call({ tool: 'Write', file_path: `${MOD}/hooks/register.tsx`, content: 'x' })).deny
  await walk($, w, 'spec')
  expect(await write()).toMatch(/can't be written in phase 3 \(Spec\)/)
  await gate($)
  expect(await write()).toMatch(/can't be written in phase 3 \(Spec\)/)
  w.answer = 'Approve'
  await gate($)
  expect(await write()).toBeUndefined()
  expect(w.reachedTheTool).toEqual([{ tool: 'Write', path: `${MOD}/hooks/register.tsx` }])
})

test('the folder is kept under one spelling: a "/" at its end, ".." and a path from the working folder all name the same build', async ($, on) => {
  const w = fresh(on)
  await $.skill.prompt(BUILD)
  await gate($, '/work/x/../turn-counter//')
  expect(Object.keys(w.store).sort()).toEqual([`build:${MOD}`, 'session:s1'])
  expect(await gate($, './turn-counter/')).toMatch(/phase 1 \(Knowledge\) passed/)
})

test('a mod_dir that is no text names nothing', async ($, on) => {
  const w = fresh(on)
  await $.skill.prompt(BUILD)
  for (const bad of [7, ['turn-counter'], { path: MOD }, null, true]) {
    const answer = await $.tool.call({ tool: GATE, mod_dir: bad } as never)
    expect(String(answer.result)).toMatch(/has not named its mod's folder/)
  }
  expect(w.store).toEqual({ 'session:s1': { modDir: null } })
})

test('when the session or the store can\'t be read, the gate says it failed and the build does not move', async ($, on) => {
  const w = await at(on, 'describe')
  w.unreadable = ['session:s1']
  expect(await gate($)).toMatch(/^mod-builder: the gate failed and the build did not move: /)
  w.unreadable = []
  w.sessionId = null
  expect(await gate($)).toMatch(/^mod-builder: the gate failed and the build did not move: /)
  w.sessionId = 's1'
  expect(phase(w)).toBe('describe')
})

test('every command the gate runs is given more than the default half minute, and no more than the ten the engine allows', async ($, on) => {
  const w = fresh(on)
  await walk($, w, 'done')
  expect(w.ran.length).toBe(w.timeouts.length)
  expect(w.ran.length >= 8).toBe(true)
  expect(w.timeouts.every((ms) => typeof ms === 'number' && ms > 30000 && ms <= 600000)).toBe(true)
})

test('Red stays when the count did not go up, when the report can\'t be read, and when the report was cut short', async ($, on) => {
  const w = fresh(on)
  await walk($, w, 'red')
  w.runs.test = { exitCode: 1, stdout: failing([], ['counts a turn']) }
  expect(first(await gate($))).toBe('mod-builder: still at phase 5 (Red). Not passed: the run has 1 test, no more than the 1 at Scaffold: no new test.')
  w.runs.test = { exitCode: 1, stdout: 'the runner crashed\n' }
  expect(await gate($)).toMatch(/Not passed: the test run's last line reports no test count/)
  w.runs.test = { exitCode: 1, stdout: failing(['test 1'], ['counts a turn']), isTruncated: true }
  expect(await gate($)).toMatch(/Not passed: claude plugin test ended with no exit code/)
  expect(phase(w)).toBe('red')
})

test('a test file changed while the tests ran is not recorded as what ran: Red stays', async ($, on) => {
  const w = fresh(on)
  await walk($, w, 'red')
  w.files[`${MOD}/tests/counts.test.tsx`] = 'the new test'
  w.runs.test = { exitCode: 1, stdout: failing(['test 1'], ['counts a turn']) }
  w.whileRunning = () => {
    w.files[`${MOD}/tests/counts.test.tsx`] = 'the new test, swapped while it ran'
  }
  expect(await gate($)).toMatch(/Not passed: tests\/ changed while the tests ran \(not as recorded: tests\/counts\.test\.tsx \(changed\)\): ask again/)
  expect(phase(w)).toBe('red')
  expect(kept(w).testHashes).toBe(null)
})

test('Green stays when a test still fails, and when a test went missing from the run', async ($, on) => {
  const w = fresh(on)
  await walk($, w, 'green')
  w.runs.test = { exitCode: 1, stdout: failing(['test 1'], ['counts a turn']) }
  expect(first(await gate($))).toBe('mod-builder: still at phase 6 (Green). Not passed: claude plugin test exited 1: not every test passes.')
  w.runs.test = { exitCode: 0, stdout: passing(1) }
  expect(first(await gate($))).toBe('mod-builder: still at phase 6 (Green). Not passed: the run has 1 test, fewer than the 2 at Red.')
  w.runs.test = 'never starts'
  expect(await gate($)).toMatch(/Not passed: claude plugin test ended with no exit code/)
  expect(phase(w)).toBe('green')
})

test('a test changed while Green\'s run was under way stops the build, though the run passed', async ($, on) => {
  const w = fresh(on)
  await walk($, w, 'green')
  w.runs.test = { exitCode: 0, stdout: passing(2, ['test 1', 'counts a turn']) }
  w.whileRunning = () => {
    w.files[`${MOD}/tests/counts.test.tsx`] = 'weakened while it ran'
  }
  expect(await gate($)).toMatch(/Not passed: not as recorded: tests\/counts\.test\.tsx \(changed\)/)
  expect(phase(w)).toBe('green')
})

test('Verify stays when validate fails, when a test fails, when the load exits with an error, and when a test file changed', async ($, on) => {
  const w = fresh(on)
  await walk($, w, 'verify')
  w.runs.validate = { exitCode: 1, stdout: 'Validation failed' }
  expect(first(await gate($))).toBe('mod-builder: still at phase 7 (Verify). Not passed: claude plugin validate --strict exited 1.')
  w.runs.validate = { exitCode: 0, stdout: 'Validation passed' }
  w.runs.test = { exitCode: 1, stdout: failing(['test 1'], ['counts a turn']) }
  expect(await gate($)).toMatch(/Not passed: claude plugin test exited 1: not every test passes/)
  w.runs.test = { exitCode: 0, stdout: passing(2, ['test 1', 'counts a turn']) }
  w.runs['--plugin-dir'] = { exitCode: 1, stdout: '' }
  expect(await gate($)).toMatch(/Not passed: the headless load exited 1/)
  w.runs['--plugin-dir'] = { exitCode: 0, stdout: '' }
  w.files[`${MOD}/tests/pane.test.tsx`] = 'the first test, changed'
  expect(await gate($)).toMatch(/Not passed: not as recorded: tests\/pane\.test\.tsx \(changed\)/)
  expect(phase(w)).toBe('verify')
})

test('at Verify a SPEC.md cut below its approved length, or gone, stops the build', async ($, on) => {
  const w = fresh(on)
  await walk($, w, 'verify')
  w.files[SPEC] = '# turn'
  expect(await gate($)).toMatch(/Not passed: not as recorded: SPEC\.md \(its approved part changed\)/)
  delete w.files[SPEC]
  expect(await gate($)).toMatch(/Not passed: not as recorded: SPEC\.md \(missing\)/)
  expect(phase(w)).toBe('verify')
})

test('the load is read for the mod\'s manifest name, not its folder\'s: a mod that can\'t be named can\'t be shown loaded', async ($, on) => {
  const w = fresh(on)
  await walk($, w, 'verify')
  w.files['the load log'] = '[DEBUG] hooks module turn-counter@inline loaded (worker, environment 1, tier user)\n'
  expect(await gate($)).toMatch(/Not passed: the headless load's debug log does not show the mod loaded/)
  w.files[`${MOD}/.claude-plugin/plugin.json`] = 'not json'
  expect(await gate($)).toMatch(/Not passed: \/work\/turn-counter\/\.claude-plugin\/plugin\.json can't be read/)
  expect(phase(w)).toBe('verify')
})

// The pane rebuilt to the mockup (SPEC.md 8.16, 8.18), through the hooks module: one test for each frame (Main,
// Spec, Guard, Build, Verify, Done), which mounts the pane on a record for that frame and finds its rail state,
// its heading and one row; an edit's rail, a skipped Red, a repair and a stopped record; and what the guard and
// the gate write for the pane alone: the count of refused writes, the last refused gate, each check's state, what
// Done shows, the status line and the toasts. The pane only draws, and no gate reads what it is given.
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { BUILT, GATE, HOME, MOD, NAME, TYPES, TYPES_SHA, TYPES_TEXT, failing, passing, world } from './world'
import type { World } from './world'

const DOT = String.fromCharCode(0xb7)
const TICK = String.fromCharCode(0x2713)
const DOTS = String.fromCharCode(0x2026)
const RULE = String.fromCharCode(0x2500)
const CACHE = `${HOME}/.claude/mod-builder-data/v2/docs`
const STAMP = '2026-11-10T151216Z'
const SPEC = `${MOD}/SPEC.md`
const SPEC_TEXT = '# turn-counter\n'
const TEST_FILE = `${MOD}/tests/pane.test.tsx`
const BUILD = { skill: 'build', text: 'the eight phases', source: 'plugin', pluginName: 'mod-builder', frontmatter: {} } as const
const EDIT = { skill: 'edit', text: 'the phases of an edit', source: 'plugin', pluginName: 'mod-builder', frontmatter: {} } as const
const LOADED = `[DEBUG] hooks module ${NAME}@inline loaded (worker, environment 1, tier user); events: session.start\n`
const PANE = {
  plugin: 'mod-builder', component: 'Pane', requestId: 'mod-builder', surface: 'terminal',
  props: { title: 'mod-builder', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const
// The cache as refresh-docs.sh leaves it: the newest snapshot's manifest, and what changed since the one before.
const CHANGES = `# Changes in ${STAMP} since 2026-11-09T101010Z\n\nPages: 1 changed, 1 added, 0 removed.\n\n## api.md: changed, +4 -2\n\n- ## Add a command\n\n## gallery.md: added, +9\n`
const DOCS = {
  [`${CACHE}/latest`]: `${STAMP}\n`, [`${CACHE}/checked`]: '2026-11-10T160000Z\n',
  [`${CACHE}/${STAMP}/manifest.tsv`]: 'page\turl\tsha256\tlast_modified\tbytes\napi.md\tu\th\tt\t1\nevents.md\tu\th\tt\t1\ngallery.md\tu\th\tt\t1\n',
  [`${CACHE}/${STAMP}/_changes.md`]: CHANGES,
}
// 2026-11-12 18:00 UTC: two days after the cache was checked.
const NOW = Date.UTC(2026, 10, 12, 18)
const KEY = `build:${MOD}`
const REFUSALS = `refusals:${MOD}`
const CHECKS = `checks:${MOD}`
const TABLE = `What each phase may write, under ${MOD}/`

const sha256 = async (text: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
const record = (phase: string, more: Record<string, unknown> = {}) => ({
  modDir: MOD, sessionId: 's1', phase, specApprovedAt: null, spec: null, testsAtScaffold: null, namesAtScaffold: null, testsAtRed: null, testHashes: null, evidence: {}, ...more,
})
const BASELINE = { version: '0.1.0', tests: 2, names: ['a', 'b'], hashes: {}, spec: { length: SPEC_TEXT.length, hash: 'h' }, failed: [], restore: '/home/u/r', at: 1000 }
const editing = (phase: string, more: Record<string, unknown> = {}) =>
  record(phase, { kind: 'edit', red: 'edit', baseline: BASELINE, evidence: { baseline: 'passes its four checks (2 tests); version 0.1.0; restore point /home/u/r' }, ...more })
// A world with the cache laid and a record for the phase named.
const at = (on: Parameters<typeof world>[0], kept: Record<string, unknown>, more: Partial<World> = {}) =>
  world(on, { now: NOW, ...more, files: { ...DOCS, ...more.files }, store: { 'session:s1': { modDir: MOD, ...(kept.kind === 'edit' ? { kind: 'edit' } : {}) }, [KEY]: kept, ...more.store } })
// A world whose build stands at Green or Verify as the gates before it would have left it, its four checks passing.
const standing = async (on: Parameters<typeof world>[0], phase: 'green' | 'verify', more: Partial<World> = {}) => {
  const kept = record(phase, {
    specApprovedAt: Date.UTC(2026, 10, 11, 15, 31), spec: { length: SPEC_TEXT.length, hash: await sha256(SPEC_TEXT) }, testsAtScaffold: 0, namesAtScaffold: [], testsAtRed: 1,
    testHashes: { 'tests/pane.test.tsx': await sha256(btoa('the first test')) }, evidence: { knowledge: `snapshot ${STAMP}` },
  })
  return at(on, kept, {
    ...more,
    files: {
      [SPEC]: phase === 'verify' ? `${SPEC_TEXT}${BUILT}` : SPEC_TEXT, [`${MOD}/.claude-plugin/plugin.json`]: `{ "name": "${NAME}", "version": "0.1.0" }`, [TEST_FILE]: 'the first test',
      'the load log': LOADED, [TYPES]: TYPES_TEXT, ...more.files,
    },
  })
}
const gate = async ($: Engine, more: Record<string, unknown> = {}) => String((await $.tool.call({ tool: GATE, ...more } as never)).result)
const write = async ($: Engine, path: string) => (await $.tool.call({ tool: 'Write', file_path: path, content: 'x' } as never)) as { deny?: string }
const kept = (w: World) => w.store[KEY] as Record<string, unknown> & { phase: string }
// The pane as drawn: every Text, and what a test asks of them.
const drawn = async ($: Engine, columns = 40) => {
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: columns } })
  const all = (await ui.findAll({ type: 'Text' })).map((one) => ({ text: one.text, props: one.props as Record<string, unknown> }))
  const markdown = (await ui.findAll({ type: 'Markdown' })).map((one) => one.text)
  await ui.unmount()
  const texts = all.map((one) => one.text)
  return { texts, markdown, header: all[1], rail: all.slice(2, texts.findIndex((text) => text.startsWith(RULE))), of: (text: string) => all.find((one) => one.text === text) }
}

// ------------------------------------------------------------------------------------------------- the frames

test('Main: at Knowledge the rail marks it as the current phase, and the Knowledge block shows the fetch, the pages and each changed page', async ($, on) => {
  at(on, record('knowledge'))
  const pane = await drawn($)
  expect(pane.texts.slice(0, 2)).toEqual(['MOD BUILDER', `turn-counter ${DOT} new mod`])
  expect(pane.texts[0] === undefined ? null : pane.of('MOD BUILDER')?.props).toEqual({ bold: true })
  expect(pane.rail.map((one) => one.text)).toEqual([' 1 Knowledge ', '2 Describe', '3 Spec', '4 Scaffold', '5 Red', '6 Green', '7 Verify', '8 Done'])
  expect(pane.rail[0]?.props).toEqual({ bold: true, backgroundColor: 'suggestion' })
  expect(pane.rail[1]?.props).toEqual({ dimColor: true })
  expect(pane.texts).toContain(RULE.repeat(40))
  expect(pane.of('Knowledge')?.props.bold).toBe(true)
  const from = pane.texts.indexOf('Knowledge')
  expect(pane.texts.slice(from + 1, from + 11)).toEqual([
    "Anthropic's mod pages", 'last fetched 2 days ago', `  3 pages in snapshot ${STAMP}`, '1 changed, 1 added, 0 removed',
    '  changed', 'api.md', `+4 -2 lines ${DOT} Add a command`, '  added', 'gallery.md', '+9 -0 lines',
  ])
  expect(pane.of('1 changed, 1 added, 0 removed')?.props.color).toBe('warning')
  expect(pane.of('last fetched 2 days ago')?.props.dimColor).toBe(true)
})

test('Spec: the rail marks Spec, the phases before it are done, and the mod\'s SPEC.md is drawn as markdown', async ($, on) => {
  at(on, record('spec'), { files: { [SPEC]: '# turn-counter\n\nA pane that counts turns.\n' } })
  const pane = await drawn($)
  expect(pane.header?.text).toBe(`turn-counter ${DOT} SPEC.md written`)
  expect(pane.rail.slice(0, 4).map((one) => one.text)).toEqual([`1 Knowledge ${TICK}`, `2 Describe ${TICK}`, ' 3 Spec ', '4 Scaffold'])
  expect(pane.rail[0]?.props).toEqual({ color: 'success' })
  expect(pane.of('The spec, as SPEC.md has it')?.props.bold).toBe(true)
  expect(pane.markdown).toEqual(['# turn-counter\n\nA pane that counts turns.'])
})

test('Spec: the approval question says what the guard holds until the answer', async ($, on) => {
  const w = at(on, record('spec'), { files: { [SPEC]: SPEC_TEXT }, answer: 'Not yet' })
  await gate($)
  expect(w.asked.map((one) => one.question)).toEqual([`Approve the spec of this mod? (${SPEC}) Nothing under hooks/ or tests/ can be written until you approve.`])
})

test('Guard: a refused write is counted beside the record, toasted once for the phase, and drawn with the table of what each phase may write', async ($, on) => {
  const w = at(on, record('spec'), { files: { [SPEC]: SPEC_TEXT } })
  const before = JSON.stringify(w.store[KEY])
  expect((await write($, `${MOD}/hooks/register.tsx`)).deny).toMatch(/can't be written in phase 3 \(Spec\)/)
  expect(w.store[REFUSALS]).toEqual({ sessionId: 's1', counts: { spec: 1 }, last: { phase: 'spec', path: 'hooks/register.tsx' }, toasted: ['spec'] })
  expect(w.toasts).toEqual(['refused: hooks/register.tsx, at Spec'])
  expect(w.statuses.at(-1)).toBe(`spec ${DOT} 1 edit refused ${DOT} waiting for your approval`)
  const pane = await drawn($)
  expect(pane.header).toEqual({ text: `turn-counter ${DOT} 1 edit refused ${DOT} phase Spec`, props: { color: 'warning', wrap: 'truncate-end' } })
  expect(pane.rail[2]?.text).toBe(' 3 Spec ')
  expect(pane.of(TABLE)?.props.bold).toBe(true)
  const from = pane.texts.indexOf(TABLE)
  expect(pane.texts.slice(from + 1, from + 7)).toEqual(['  3 Spec', 'SPEC.md only', 'now', '  4 Scaffold', 'everything', 'opens when the person approves the spec'])
  expect(pane.of('now')?.props.color).toBe('suggestion')
  // A second refusal in the phase is counted, with no second toast; the record is never the guard's to write.
  expect((await write($, `${MOD}/tests/a.test.ts`)).deny).toMatch(/can't be written/)
  expect((w.store[REFUSALS] as { counts: unknown; last: unknown }).counts).toEqual({ spec: 2 })
  expect((w.store[REFUSALS] as { last: unknown }).last).toEqual({ phase: 'spec', path: 'tests/a.test.ts' })
  expect(w.toasts.length).toBe(1)
  expect(w.statuses.at(-1)).toBe(`spec ${DOT} 2 edits refused ${DOT} waiting for your approval`)
  expect(JSON.stringify(w.store[KEY])).toBe(before)
})

test('Guard: a write the phase allows is not counted, and a refusal in a later phase has a toast of its own', async ($, on) => {
  const w = at(on, record('spec'), { files: { [SPEC]: SPEC_TEXT } })
  expect((await write($, SPEC)).deny).toBe(undefined)
  expect(w.store[REFUSALS]).toBe(undefined)
  expect(w.toasts).toEqual([])
  await write($, `${MOD}/hooks/register.tsx`)
  w.store[KEY] = record('red')
  await write($, `${MOD}/hooks/register.tsx`)
  await write($, '/work/elsewhere/.claude-plugin/plugin.json')
  expect(w.toasts).toEqual(['refused: hooks/register.tsx, at Spec', 'refused: hooks/register.tsx, at Red'])
  expect((w.store[REFUSALS] as { counts: unknown }).counts).toEqual({ spec: 1, red: 2 })
  expect((w.store[REFUSALS] as { last: unknown }).last).toEqual({ phase: 'red', path: '/work/elsewhere/.claude-plugin/plugin.json' })
})

test('Build: a refused gate leaves its reason and the failing tests in the record, and the pane shows them under the phase the work is in', async ($, on) => {
  const w = await standing(on, 'green', { runs: { validate: { exitCode: 0, stdout: 'Validation passed' }, test: { exitCode: 1, stdout: failing(['counts a turn'], ['resets on /clear']) }, tsc: { exitCode: 0, stdout: '' }, '--plugin-dir': { exitCode: 0, stdout: '' } } })
  const answer = await gate($)
  expect(answer).toMatch(/^mod-builder: still at phase 6 \(Green\)\. Not passed: /)
  const reason = (answer.split('\n')[0] as string).slice('mod-builder: still at phase 6 (Green). Not passed: '.length).replace(/\.$/, '')
  expect(kept(w).attempt).toEqual({ phase: 'green', reason, failing: ['resets on /clear'], passed: 1, tests: 2 })
  expect(kept(w).phase).toBe('green')
  expect(w.statuses.at(-1)).toBe(`green ${DOT} 1 of 2 tests pass`)
  const pane = await drawn($)
  expect(pane.header?.text).toBe(`turn-counter ${DOT} approved 15:31 UTC ${DOT} building`)
  expect(pane.rail.slice(4, 7).map((one) => one.text)).toEqual([`5 Red ${TICK}`, ' 6 Green ', '7 Verify'])
  expect(pane.of('6 Green')?.props.bold).toBe(true)
  expect(pane.of(`working${DOTS}`)?.props.color).toBe('suggestion')
  const from = pane.texts.indexOf(`working${DOTS}`)
  expect(pane.texts.slice(from + 1)).toEqual([`  not passed: ${reason}`, '  fails', 'resets on /clear'])
  expect(pane.of('  fails')?.props.color).toBe('error')
  expect(pane.texts.slice(pane.texts.indexOf('Each check is a command mod-builder ran itself') + 1, from - 1).filter((text) => text.startsWith('  '))).toEqual(['  passed', '  failed', '  passed', '  passed'])
})

test('Build: the gate that passes next leaves no refused gate in the record', async ($, on) => {
  const w = await standing(on, 'green')
  w.store[KEY] = { ...kept(w), attempt: { phase: 'green', reason: 'earlier', failing: ['x'], passed: 0, tests: 1 } }
  expect(await gate($)).toMatch(/^mod-builder: phase 6 \(Green\) passed /)
  expect(kept(w).phase).toBe('verify')
  expect('attempt' in kept(w)).toBe(false)
  expect('finished' in kept(w)).toBe(false)
})

test('Build: a refused gate writes nothing into a record that was stopped while the person was being asked', async ($, on) => {
  const w = at(on, record('spec'), { files: { [SPEC]: SPEC_TEXT }, answer: 'Not yet' })
  w.whileAsked = () => {
    w.store[KEY] = { ...record('spec'), stopped: true }
  }
  expect(await gate($)).toMatch(/Not passed: the person has not approved/)
  expect(w.store[KEY]).toEqual({ ...record('spec'), stopped: true })
})

test('Build: a refused approval is kept as the last refused gate, with no test run to count', async ($, on) => {
  const w = at(on, record('spec'), { files: { [SPEC]: SPEC_TEXT }, answer: 'Not yet' })
  await gate($)
  expect(kept(w).attempt).toEqual({ phase: 'spec', reason: 'the person has not approved the spec (answer: "Not yet")', failing: [], passed: null, tests: null })
  const pane = await drawn($)
  expect(pane.texts.slice(pane.texts.findIndex((text) => text.startsWith(RULE)) + 1)).toEqual(['  not passed: the person has not approved the spec (answer: "Not yet")', 'The spec, as SPEC.md has it'])
})

test('Verify: each check is drawn running while its command runs and passed after it, and the status line counts them', async ($, on) => {
  const w = await standing(on, 'verify')
  const seen: string[] = []
  const lines: (string | undefined)[] = []
  w.whileRunning = (argv) => {
    if (argv.at(-1) === '-v' || argv[0] === 'id') return
    const states = (w.store[CHECKS] as { states: Record<string, string> }).states
    seen.push([states.validate, states.test, states.typecheck, states.load].join(' '))
    lines.push(w.statuses.at(-1))
  }
  expect(await gate($)).toMatch(/^mod-builder: phase 7 \(Verify\) passed /)
  expect(seen).toEqual(['running waiting waiting waiting', 'passed running waiting waiting', 'passed passed running waiting', 'passed passed passed running'])
  expect(lines).toEqual([
    `verify ${DOT} 0 of 4 checks passed ${DOT} validate running`, `verify ${DOT} 1 of 4 checks passed ${DOT} test running`,
    `verify ${DOT} 2 of 4 checks passed ${DOT} typecheck running`, `verify ${DOT} 3 of 4 checks passed ${DOT} headless load running`,
  ])
  expect(w.store[CHECKS]).toEqual({ sessionId: 's1', phase: 'verify', name: NAME, states: { validate: 'passed', test: 'passed', typecheck: 'passed', load: 'passed' } })
})

test('Verify: the frame shows the four checks with their commands and what the load\'s log must show', async ($, on) => {
  const w = await standing(on, 'verify')
  w.store[CHECKS] = { sessionId: 's1', phase: 'verify', name: NAME, states: { validate: 'passed', test: 'passed', typecheck: 'running', load: 'waiting' } }
  const pane = await drawn($)
  expect(pane.header?.text).toBe(`turn-counter ${DOT} checking the finished mod`)
  expect(pane.rail.slice(5).map((one) => one.text)).toEqual([`6 Green ${TICK}`, ' 7 Verify ', '8 Done'])
  const from = pane.texts.indexOf('Each check is a command mod-builder ran itself')
  expect(pane.texts.slice(from + 1, from + 13)).toEqual([
    '  passed', 'validate', `claude plugin validate --strict ${MOD}`, '  passed', 'test', `claude plugin test ${MOD}`,
    '  running', 'typecheck', 'tsc against the 2.1.322 types', '  waiting', 'headless load', `claude --plugin-dir ${MOD} -p /cost`,
  ])
  expect(pane.of('  running')?.props.color).toBe('suggestion')
  expect(pane.texts).toContain(`hooks module ${NAME}@inline loaded`)
  expect(pane.texts).toContain('Unchanged since their gates')
})

test('Verify: a check that fails is drawn failed, no check is left running when the gate has ended, and the status line says which did not pass', async ($, on) => {
  const w = await standing(on, 'verify', { runs: { validate: { exitCode: 0, stdout: 'Validation passed' }, test: { exitCode: 0, stdout: passing(1) }, tsc: { exitCode: 2, stdout: 'hooks/register.tsx(1,1): error TS1005\n' }, '--plugin-dir': { exitCode: 0, stdout: '' } } })
  expect(await gate($)).toMatch(/^mod-builder: still at phase 7 \(Verify\)/)
  expect((w.store[CHECKS] as { states: unknown }).states).toEqual({ validate: 'passed', test: 'passed', typecheck: 'failed', load: 'passed' })
  expect(w.statuses.at(-1)).toBe(`verify ${DOT} 3 of 4 checks passed ${DOT} typecheck did not pass`)
  const pane = await drawn($)
  expect(pane.header).toEqual({ text: `turn-counter ${DOT} typecheck did not pass`, props: { color: 'error', wrap: 'truncate-end' } })
  expect(pane.of('  failed')?.props.color).toBe('error')
})

test('Verify: a gate that refuses before its checks, and one whose command never starts, leave no check running', async ($, on) => {
  const w = await standing(on, 'verify', { files: { [TYPES]: 'not the types\n' } })
  w.store[CHECKS] = { sessionId: 's1', phase: 'verify', name: NAME, states: { validate: 'passed', test: 'running', typecheck: 'waiting', load: 'waiting' } }
  expect(await gate($)).toMatch(/^mod-builder: still at phase 7 \(Verify\)/)
  expect(w.store[CHECKS]).toBe(null)
  w.files[TYPES] = TYPES_TEXT
  w.runs.test = 'never starts'
  expect(await gate($)).toMatch(/^mod-builder: still at phase 7 \(Verify\)/)
  expect(Object.values((w.store[CHECKS] as { states: Record<string, string> }).states).includes('running')).toBe(false)
  expect((w.store[CHECKS] as { states: Record<string, string> }).states.test).toBe('failed')
})

test('Done: Verify\'s gate keeps what Done shows, the toast says the mod is built, the status line is cleared, and the frame says what was built and how to try it', async ($, on) => {
  const w = await standing(on, 'verify', { runs: { validate: { exitCode: 0, stdout: 'Validation passed\n  > ./register.tsx answers its own command: command.run{command=turn-counter}\n' }, test: { exitCode: 0, stdout: passing(1) }, tsc: { exitCode: 0, stdout: '' }, '--plugin-dir': { exitCode: 0, stdout: '' } } })
  expect(await gate($)).toMatch(/^mod-builder: phase 7 \(Verify\) passed /)
  const builtOn = `Built on Claude Code 2.1.322, from the docs snapshot ${STAMP}, against the types sha256 ${TYPES_SHA}.`
  expect(kept(w).finished).toEqual({ version: '0.1.0', files: 3, tests: 1, command: 'turn-counter', builtOn })
  expect(w.toasts).toEqual([`turn-counter is built ${DOT} 4 of 4 checks passed`])
  expect(w.statuses.at(-1) === undefined).toBe(true)
  const pane = await drawn($)
  expect(pane.header).toEqual({ text: `turn-counter 0.1.0 ${DOT} built and checked`, props: { color: 'success', wrap: 'truncate-end' } })
  expect(pane.rail.at(-1)).toEqual({ text: ' 8 Done ', props: { bold: true, backgroundColor: 'success' } })
  expect(pane.of('What was built')?.props.bold).toBe(true)
  const from = pane.texts.indexOf('What was built')
  expect(pane.texts.slice(from + 1, from + 4)).toEqual([`  ${MOD}/`, `3 files ${DOT} 1 test`, `  ${builtOn}`])
  expect(pane.texts.slice(pane.texts.indexOf('Try it') + 1)).toEqual([`  claude --plugin-dir ${MOD}`, 'then', '/turn-counter'])
})

// --------------------------------------------------------------------------------------------- beyond the frames

test('an edit\'s rail has seven phases, and its header names it an edit with the version the mod had', async ($, on) => {
  at(on, editing('green'))
  const pane = await drawn($)
  expect(pane.header?.text).toBe(`turn-counter ${DOT} edit of 0.1.0 ${DOT} editing`)
  expect(pane.rail.map((one) => one.text)).toEqual([`1 Knowledge ${TICK}`, `2 Describe ${TICK}`, `3 Spec ${TICK}`, `4 Red ${TICK}`, ' 5 Green ', '6 Verify', '7 Done'])
  expect(pane.texts).toContain('Baseline')
  expect(pane.texts).toContain('  restore point /home/u/r')
})

test('a skipped Red is drawn dim on the rail with its reason', async ($, on) => {
  const w = at(on, editing('green', { red: 'skipped', skipped: 'no behaviour change' }))
  const pane = await drawn($)
  expect(pane.rail[3]).toEqual({ text: '4 Red skipped: no behaviour change', props: { dimColor: true } })
  w.store[KEY] = editing('green', { red: 'skipped', skipped: 'fit' })
  expect((await drawn($)).rail[3]?.text).toBe('4 Red skipped: the test files fit')
})

test('a repair shows the checks its baseline failed, as a block in the tone of an error', async ($, on) => {
  at(on, editing('describe', { red: 'repair', baseline: { ...BASELINE, failed: ['typecheck', 'load'] }, evidence: { baseline: 'fails typecheck, load; version 0.1.0; restore point /home/u/r' } }))
  const pane = await drawn($)
  expect(pane.of('fails typecheck, headless load: this edit is a repair')?.props.color).toBe('error')
  expect(pane.texts).toContain('  fails typecheck, load')
})

test('a stopped record says so in the header, its rail is dim with no current phase, and the status line is cleared', async ($, on) => {
  const w = at(on, record('green', { evidence: { scaffold: 'validated' } }))
  await write($, `${MOD}/tests/a.test.ts`)
  expect(w.statuses.at(-1)).toBe(`green ${DOT} 1 edit refused`)
  await $.command.run({ command: 'mod-builder', args: 'stop' } as never)
  expect(w.statuses.at(-1) === undefined).toBe(true)
  // The session is no longer bound to the folder; bound again, as a pane left open shows it, the record is drawn.
  w.store['session:s1'] = { modDir: MOD }
  const pane = await drawn($)
  expect(pane.header).toEqual({ text: `turn-counter ${DOT} stopped at Green`, props: { color: 'warning', wrap: 'truncate-end' } })
  expect(pane.rail.every((one) => one.props.dimColor === true)).toBe(true)
  expect(pane.texts.slice(-3)).toEqual(['4 Scaffold', 'passed', '  validated'])
})

// ------------------------------------------------------------------------- the status line, the toasts, the log

test('opening a build and an edit each put one line in the transcript, and a build under way is not opened again', async ($, on) => {
  const w = world(on, { files: { ...DOCS }, now: NOW })
  await $.skill.prompt(BUILD)
  await $.skill.prompt(BUILD)
  expect(w.logged).toEqual(["checking what Claude Code's mods can do today before planning."])
  expect(w.statuses.at(-1)).toBe(`build ${DOT} waiting for the mod's folder`)
  await gate($, { mod_dir: 'turn-counter' })
  expect(w.statuses.at(-1)).toBe(`knowledge ${DOT} snapshot ${STAMP} ${DOT} 2 pages changed`)
  await $.skill.prompt(BUILD)
  expect(w.logged.length).toBe(1)
  w.store[KEY] = record('done')
  await $.skill.prompt(EDIT)
  expect(w.logged).toEqual(["checking what Claude Code's mods can do today before planning.", "checking what Claude Code's mods can do today before planning the change."])
  expect(w.statuses.at(-1)).toBe(`edit ${DOT} waiting for the mod's folder`)
})

test('a record that opens starts with no refusals and no check states of an earlier one, and writes neither key where none was kept', async ($, on) => {
  const w = world(on, { files: { ...DOCS }, now: NOW, store: { [REFUSALS]: { sessionId: 's1', counts: { spec: 3 }, last: null, toasted: ['spec'] }, [CHECKS]: { sessionId: 's1', phase: 'verify', name: 'x', states: {} } } })
  await $.skill.prompt(BUILD)
  await gate($, { mod_dir: 'turn-counter' })
  expect(w.store[REFUSALS]).toBe(null)
  expect(w.store[CHECKS]).toBe(null)
  delete w.store[REFUSALS]
  delete w.store[CHECKS]
  w.store[KEY] = record('done')
  await $.skill.prompt(BUILD)
  await gate($, { mod_dir: 'turn-counter' })
  expect(Object.keys(w.store).sort()).toEqual([KEY, 'session:s1'])
})

test('a new session clears the status line an earlier one left', async ($, on) => {
  const w = world(on, { files: { ...DOCS }, now: NOW })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: false })
  expect(w.statuses.length).toBe(1)
  expect(w.statuses[0] === undefined).toBe(true)
})

test('a fetch that made a new snapshot is said in a toast with the pages that changed, and one that made none is not', async ($, on) => {
  const w = world(on, { files: { ...DOCS }, now: NOW, runs: { refresh: { exitCode: 0, stdout: `refresh-docs: new snapshot ${STAMP} (3 pages), was 2026-11-09T101010Z\n` } } })
  await $.command.run({ command: 'mod-builder', args: 'refresh' } as never)
  expect(w.toasts).toEqual(['mod docs refreshed, 2 pages changed'])
  w.runs.refresh = { exitCode: 0, stdout: `refresh-docs: unchanged since ${STAMP}\n` }
  await $.command.run({ command: 'mod-builder', args: 'refresh' } as never)
  expect(w.toasts.length).toBe(1)
  delete w.files[`${CACHE}/${STAMP}/_changes.md`]
  w.runs.refresh = { exitCode: 0, stdout: `refresh-docs: new snapshot ${STAMP} (3 pages)\n` }
  await $.command.run({ command: 'mod-builder', args: 'refresh' } as never)
  expect(w.toasts.at(-1)).toBe('mod docs refreshed')
})

test('while a fetch this session started runs, the Knowledge block says so, and no longer once it has ended', async ($, on) => {
  let release = () => {}
  const w = world(on, { files: { ...DOCS }, now: NOW, runs: { refresh: { exitCode: 0, stdout: `refresh-docs: unchanged since ${STAMP}\n` } }, fetchHeld: new Promise<void>((resolve) => { release = resolve }) })
  const fetched = $.command.run({ command: 'mod-builder', args: 'refresh' } as never)
  for (let i = 0; i < 12; i++) await $.tool.call({ tool: 'Read', file_path: '/work/notes.md' } as never)
  expect(w.ran.length).toBe(1)
  expect((await drawn($)).texts).toContain(`last fetched 2 days ago ${DOT} refreshing${DOTS}`)
  release()
  await fetched
  expect((await drawn($)).texts).toContain('last fetched 2 days ago')
})

test('the rule under the rail is as wide as the pane\'s body', async ($, on) => {
  at(on, record('knowledge'))
  expect((await drawn($, 72)).texts).toContain(RULE.repeat(72))
  expect((await drawn($, 34)).texts.filter((text) => text.startsWith(RULE))).toEqual([RULE.repeat(34)])
})

test('no gate reads what the pane is given: a gate answers the same with the pane\'s fields and keys damaged as without them', async ($, on) => {
  const w = await standing(on, 'green')
  const clean = JSON.parse(JSON.stringify(w.store)) as Record<string, unknown>
  const plain = await gate($)
  expect(plain).toMatch(/^mod-builder: phase 6 \(Green\) passed /)
  const moved = JSON.stringify(kept(w))
  for (const key of Object.keys(w.store)) delete w.store[key]
  Object.assign(w.store, clean, { [KEY]: { ...(clean[KEY] as object), attempt: 'x', finished: 7 }, [REFUSALS]: 'damaged', [CHECKS]: [1, 2] })
  expect(await gate($)).toBe(plain)
  expect(JSON.stringify({ ...kept(w), finished: undefined })).toBe(moved)
})

// ------------------------------------------------------------------- what an independent reader found untested

const RESTORE = `${HOME}/.claude/mod-builder-data/v2/restore/s1/2026-11-12T180000Z`
const OLD_SPEC = '# turn-counter\n\nCounts turns.\n'
const SECTION = '\n## 0.1.1 (2026-11-11)\n\nCuts each row by display width.\n'
const NAMES = ['draws its line', 'opens the pane']
const MANIFEST = `${MOD}/.claude-plugin/plugin.json`
const FOUR_PASS = { validate: { exitCode: 0, stdout: 'Validation passed' }, test: { exitCode: 0, stdout: passing(1) }, tsc: { exitCode: 0, stdout: '' }, '--plugin-dir': { exitCode: 0, stdout: '' } } as const
// A finished mod and a session in which nothing is open yet, as an edit finds them.
const mod = (on: Parameters<typeof world>[0], more: Partial<World> = {}) =>
  world(on, {
    now: NOW,
    runs: { ...FOUR_PASS, test: { exitCode: 0, stdout: passing(2, NAMES) }, restore: { exitCode: 0, stdout: `restore point: ${RESTORE}\n` }, putback: { exitCode: 0, stdout: '' } },
    ...more,
    files: {
      ...DOCS, [SPEC]: OLD_SPEC, [MANIFEST]: `{ "name": "${NAME}", "version": "0.1.0" }`, [`${MOD}/hooks/hooks.json`]: '{ "modules": ["./register.tsx"] }',
      [`${MOD}/hooks/register.tsx`]: 'the code', [TEST_FILE]: 'the first test', 'the load log': LOADED, ...more.files,
    },
  })
// Opens an edit, names the mod, and goes to Spec's gate with the change's section written.
const toSpec = async ($: Engine, w: World) => {
  await $.skill.prompt(EDIT)
  await gate($, { mod_dir: 'turn-counter' })
  for (const [path, text] of Object.entries(w.files)) if (path.startsWith(`${MOD}/`)) w.files[`${RESTORE}/${path.slice(MOD.length + 1)}`] = text
  await gate($)
  await gate($)
  w.files[SPEC] = `${OLD_SPEC}${SECTION}`
}
// Through Spec and Red, as an edit whose new test fails by assertion, to Green's gate with the code written.
const toGreen = async ($: Engine, w: World) => {
  await toSpec($, w)
  await gate($)
  w.files[`${MOD}/tests/width.test.ts`] = 'the new test'
  w.runs.test = { exitCode: 1, stdout: failing(NAMES, ['cuts by width']) }
  await gate($)
  w.files[MANIFEST] = `{ "name": "${NAME}", "version": "0.1.1" }`
  w.runs.test = { exitCode: 0, stdout: passing(3, [...NAMES, 'cuts by width']) }
}
const states = (w: World) => (w.store[CHECKS] as { states: Record<string, string> } | null)?.states
const boxes = async ($: Engine) => {
  const ui = await $.ui.mount(PANE)
  const all = (await ui.findAll({ type: 'Box' })).map((one) => one.props as Record<string, unknown>)
  await ui.unmount()
  return all
}

test('writes refused side by side are each counted, with one toast for the phase', async ($, on) => {
  const w = at(on, record('spec'), { files: { [SPEC]: SPEC_TEXT } })
  const refused = await Promise.all([write($, `${MOD}/hooks/a.ts`), write($, `${MOD}/hooks/b.ts`), write($, `${MOD}/tests/c.test.ts`)])
  expect(refused.every((one) => typeof one.deny === 'string')).toBe(true)
  expect((w.store[REFUSALS] as { counts: unknown }).counts).toEqual({ spec: 3 })
  expect(w.toasts.length).toBe(1)
  expect(w.statuses.at(-1)).toBe(`spec ${DOT} 3 edits refused ${DOT} waiting for your approval`)
})

test('the guard counts for this session\'s open record only, and says a path inside the mod from the mod\'s folder', async ($, on) => {
  const w = at(on, record('spec'), { files: { [SPEC]: SPEC_TEXT } })
  await $.tool.call({ tool: 'Write', file_path: 'turn-counter/hooks/x.ts', content: 'x' } as never)
  expect((w.store[REFUSALS] as { last: unknown }).last).toEqual({ phase: 'spec', path: 'hooks/x.ts' })
  delete w.store[REFUSALS]
  w.toasts.length = 0
  // Another session's record for the folder this session is bound to: refused, and not counted.
  w.store[KEY] = { ...record('spec'), sessionId: 's2' }
  expect(typeof (await write($, `${MOD}/hooks/x.ts`)).deny).toBe('string')
  expect(w.store[REFUSALS]).toBe(undefined)
  expect(w.toasts).toEqual([])
})

test('a count that can\'t be read changes nothing about the refusal', async ($, on) => {
  const w = at(on, record('spec'), { files: { [SPEC]: SPEC_TEXT }, unreadable: [REFUSALS] })
  expect((await write($, `${MOD}/hooks/register.tsx`)).deny).toMatch(/^mod-builder: hooks\/register\.tsx can't be written in phase 3 \(Spec\)/)
  expect(w.store[REFUSALS]).toBe(undefined)
  expect(w.toasts).toEqual([])
})

test('each gate starts with no check states: a gate that refuses before its checks does not show the failed check of the gate before', async ($, on) => {
  const w = await standing(on, 'verify', { runs: { ...FOUR_PASS, tsc: { exitCode: 2, stdout: 'hooks/register.tsx(1,1): error TS1005\n' } } })
  await gate($)
  expect(states(w)?.typecheck).toBe('failed')
  w.files[TYPES] = 'not the types\n'
  expect(await gate($)).toMatch(/^mod-builder: still at phase 7 \(Verify\)/)
  expect(w.store[CHECKS]).toBe(null)
  expect(w.statuses.at(-1)).toBe(`verify ${DOT} 0 of 4 checks passed`)
  expect((await drawn($)).header?.text).toBe(`turn-counter ${DOT} checking the finished mod`)
})

test('each check\'s state is its own command\'s: validate, the tests, and a load whose log does not show the mod', async ($, on) => {
  const w = await standing(on, 'green', { runs: { ...FOUR_PASS, validate: { exitCode: 1, stdout: 'a finding\n' } } })
  await gate($)
  expect(states(w)).toEqual({ validate: 'failed', test: 'passed', typecheck: 'passed', load: 'passed' })
  w.runs.validate = FOUR_PASS.validate
  w.runs.test = { exitCode: 1, stdout: failing(['a'], ['b']) }
  await gate($)
  expect(states(w)).toEqual({ validate: 'passed', test: 'failed', typecheck: 'passed', load: 'passed' })
  w.runs.test = FOUR_PASS.test
  w.files['the load log'] = '[DEBUG] nothing of the mod\n'
  await gate($)
  expect(states(w)).toEqual({ validate: 'passed', test: 'passed', typecheck: 'passed', load: 'failed' })
  w.files['the load log'] = LOADED
  w.runs['--plugin-dir'] = { exitCode: 1, stdout: '' }
  await gate($)
  expect(states(w)?.load).toBe('failed')
})

test('a test run that exits 0 with fewer tests than Red recorded is drawn failed: the state is the gate\'s own finding', async ($, on) => {
  const w = await standing(on, 'green')
  w.store[KEY] = { ...kept(w), testsAtRed: 2 }
  expect(await gate($)).toMatch(/^mod-builder: still at phase 6 \(Green\)/)
  expect(states(w)).toEqual({ validate: 'passed', test: 'failed', typecheck: 'passed', load: 'passed' })
})

test('a gate with no checks writes no check states where none were kept', async ($, on) => {
  const w = at(on, record('knowledge'))
  await gate($)
  expect(kept(w).phase).toBe('describe')
  expect(Object.keys(w.store).sort()).toEqual([KEY, 'session:s1'])
})

test('a refused Scaffold and a refused Red keep their test run\'s count, and Red\'s status line says how many fail', async ($, on) => {
  const w = at(on, record('scaffold', { specApprovedAt: 1, spec: { length: SPEC_TEXT.length, hash: await sha256(SPEC_TEXT) } }), {
    files: { [SPEC]: SPEC_TEXT, [TEST_FILE]: 'the first test', [TYPES]: TYPES_TEXT }, runs: { ...FOUR_PASS, test: { exitCode: 1, stdout: failing(['a'], ['b', 'c']) } },
  })
  await gate($)
  expect(kept(w).attempt).toEqual({ phase: 'scaffold', reason: (kept(w).attempt as { reason: string }).reason, failing: ['b', 'c'], passed: 1, tests: 3 })
  expect(w.statuses.at(-1)).toBe(`scaffold ${DOT} 1 of 3 tests pass`)
  w.store[KEY] = { ...record('red', { specApprovedAt: 1, spec: { length: SPEC_TEXT.length, hash: await sha256(SPEC_TEXT) }, testsAtScaffold: 1, namesAtScaffold: ['a'] }) }
  w.runs.test = { exitCode: 0, stdout: passing(2, ['a', 'b']) }
  await gate($)
  expect(kept(w).phase).toBe('red')
  expect((kept(w).attempt as { failing: unknown; passed: unknown; tests: unknown }).tests).toBe(2)
  expect(w.statuses.at(-1)).toBe(`red ${DOT} 0 of 2 tests fail`)
})

test('a refused gate\'s words go into the record as it is now: what changed while the person was asked is kept, and a record moved on is left alone', async ($, on) => {
  const w = at(on, record('spec'), { files: { [SPEC]: SPEC_TEXT }, answer: 'Not yet' })
  w.whileAsked = () => {
    w.store[KEY] = { ...record('spec'), evidence: { knowledge: 'written meanwhile' } }
  }
  await gate($)
  expect((kept(w).evidence as Record<string, string>).knowledge).toBe('written meanwhile')
  expect((kept(w).attempt as { phase: string }).phase).toBe('spec')
  for (const moved of [record('scaffold'), { ...record('spec'), sessionId: 's2' }]) {
    w.store[KEY] = record('spec')
    w.whileAsked = () => {
      w.store[KEY] = moved
    }
    await gate($)
    expect(w.store[KEY]).toEqual(moved)
  }
})

test('a build stopped while its gate ran is not moved on, not revived, and gets no toast', async ($, on) => {
  const w = await standing(on, 'verify')
  w.whileRunning = (argv) => {
    if (argv.includes('--plugin-dir')) w.store[KEY] = { ...kept(w), stopped: true }
  }
  expect(await gate($)).toBe(`mod-builder: the build of ${MOD} was stopped or moved while this gate ran, so nothing was moved. Run /mod-builder to see where this session stands.`)
  expect(kept(w).phase).toBe('verify')
  expect(kept(w).stopped).toBe(true)
  expect('finished' in kept(w)).toBe(false)
  expect(w.toasts).toEqual([])
})

test('an approval answered after the build was stopped moves nothing', async ($, on) => {
  const w = at(on, record('spec'), { files: { [SPEC]: SPEC_TEXT }, answer: 'Approve' })
  w.whileAsked = () => {
    w.store[KEY] = { ...record('spec'), stopped: true }
  }
  expect(await gate($)).toMatch(/was stopped or moved while this gate ran, so nothing was moved/)
  expect(w.store[KEY]).toEqual({ ...record('spec'), stopped: true })
})

test('stopping clears the status line whatever was open: a pending build, and a record already done', async ($, on) => {
  const w = world(on, { files: { ...DOCS }, now: NOW })
  await $.skill.prompt(BUILD)
  expect(w.statuses.at(-1)).toBe(`build ${DOT} waiting for the mod's folder`)
  await $.command.run({ command: 'mod-builder', args: 'stop' } as never)
  expect(w.statuses.length).toBe(2)
  expect(w.statuses[1] === undefined).toBe(true)
  w.store['session:s1'] = { modDir: MOD }
  w.store[KEY] = { ...record('spec'), sessionId: 's2' }
  w.statuses.push('left over')
  await $.command.run({ command: 'mod-builder', args: 'stop' } as never)
  expect(w.statuses.at(-1) === undefined).toBe(true)
  w.store['session:s1'] = { modDir: MOD }
  w.store[KEY] = record('done')
  w.statuses.push('left over')
  await $.command.run({ command: 'mod-builder', args: 'stop' } as never)
  expect(w.statuses.at(-1) === undefined).toBe(true)
})

test('a build that goes on in its folder keeps its count of refusals', async ($, on) => {
  const w = at(on, record('spec'), { files: { [SPEC]: SPEC_TEXT } })
  await write($, `${MOD}/hooks/register.tsx`)
  w.store['session:s1'] = { modDir: null }
  await gate($, { mod_dir: 'turn-counter' })
  expect((w.store[REFUSALS] as { counts: unknown }).counts).toEqual({ spec: 1 })
})

test('an edit: opening it empties what an earlier build left, a refused gate is kept, and Done keeps what it shows and says the mod is edited', async ($, on) => {
  const w = mod(on, { store: { [REFUSALS]: { sessionId: 's0', counts: { spec: 3 }, last: null, toasted: ['spec'] }, [CHECKS]: { sessionId: 's0', phase: 'verify', name: 'x', states: {} } } })
  await $.skill.prompt(EDIT)
  await $.skill.prompt(EDIT)
  expect(w.logged).toEqual(["checking what Claude Code's mods can do today before planning the change."])
  await gate($, { mod_dir: 'turn-counter' })
  expect(w.store[REFUSALS]).toBe(null)
  expect(w.store[CHECKS]).toBe(null)
  expect(w.statuses.at(-1)).toBe(`knowledge ${DOT} snapshot ${STAMP} ${DOT} 2 pages changed`)
  delete w.store[REFUSALS]
  delete w.store[CHECKS]
  delete w.store[KEY]
  delete w.store['session:s1']
  await toSpec($, w)
  w.answer = 'Not yet'
  await gate($)
  expect((kept(w).attempt as { phase: string; reason: string })).toEqual({ phase: 'spec', reason: (kept(w).attempt as { reason: string }).reason, failing: [], passed: null, tests: null })
  expect((kept(w).attempt as { reason: string }).reason).toMatch(/Not yet/)
  w.answer = 'Approve'
  await gate($)
  expect('attempt' in kept(w)).toBe(false)
  expect(kept(w).phase).toBe('red')
})

test('an edit through Green and Verify: a refused Green keeps its failing test and leaves no check running, and Done keeps what it shows', async ($, on) => {
  const w = mod(on)
  await toGreen($, w)
  w.runs.test = { exitCode: 1, stdout: failing(NAMES, ['cuts by width']) }
  expect(await gate($)).toMatch(/^mod-builder: still at phase 5 \(Green\)/)
  expect((kept(w).attempt as { failing: unknown }).failing).toEqual(['cuts by width'])
  expect(states(w)).toEqual({ validate: 'passed', test: 'failed', typecheck: 'passed', load: 'passed' })
  expect(w.statuses.at(-1)).toBe(`green ${DOT} 2 of 3 tests pass`)
  w.runs.test = { exitCode: 0, stdout: passing(3, [...NAMES, 'cuts by width']) }
  expect(await gate($)).toMatch(/^mod-builder: phase 5 \(Green\) passed/)
  expect('attempt' in kept(w)).toBe(false)
  expect('finished' in kept(w)).toBe(false)
  expect(w.toasts).toEqual([])
  w.files[SPEC] = `${w.files[SPEC]}${BUILT}`
  expect(await gate($)).toMatch(/^mod-builder: phase 6 \(Verify\) passed/)
  expect(kept(w).phase).toBe('done')
  expect(kept(w).finished).toEqual({ version: '0.1.1', files: 6, tests: 3, command: null, builtOn: `Built on Claude Code 2.1.322, from the docs snapshot ${STAMP}, against the types sha256 ${TYPES_SHA}.` })
  expect(w.toasts).toEqual([`turn-counter is edited ${DOT} 4 of 4 checks passed`])
  expect(w.statuses.at(-1) === undefined).toBe(true)
  expect((await drawn($)).header?.text).toBe(`turn-counter 0.1.1 ${DOT} edited and checked`)
})

test('the command a mod answers is read from what validate said, on either stream', async ($, on) => {
  const w = await standing(on, 'verify', { runs: { ...FOUR_PASS, validate: { exitCode: 0, stdout: '', stderr: 'Validation passed\n  > ./register.tsx answers its own command: command.run{command=turns}\n' } } })
  await gate($)
  expect((kept(w).finished as { command: unknown }).command).toBe('turns')
})

test('the cache is read as it is: a blank "latest" is no snapshot, and the changes are those of the newest snapshot', async ($, on) => {
  const w = at(on, record('knowledge'))
  w.files[`${CACHE}/latest`] = ' \n'
  const pane = await drawn($)
  expect(pane.texts).toContain('  no snapshot yet: /mod-builder refresh fetches one')
  expect(pane.texts.includes('api.md')).toBe(false)
  const said = await $.command.run({ command: 'mod-builder', args: '' } as never)
  expect(said.text).toBe(`mod-builder: turn-counter ${DOT} new mod. It is at 1 Knowledge. Docs: snapshot none, checked 2026-11-10T160000Z.`)
})

test('the layout: the header\'s two ends, a rail that wraps, and cells that keep their width', async ($, on) => {
  at(on, record('spec'), { files: { [SPEC]: SPEC_TEXT }, store: { [REFUSALS]: { sessionId: 's1', counts: { spec: 1 }, last: { phase: 'spec', path: 'a' }, toasted: ['spec'] } } })
  const all = await boxes($)
  expect(all[0]).toEqual({ flexDirection: 'column' })
  expect(all[1]).toEqual({ flexDirection: 'row', justifyContent: 'space-between', columnGap: 2 })
  expect(all[2]).toEqual({ flexDirection: 'row', flexWrap: 'wrap', columnGap: 2 })
  expect(all[3]).toEqual({ flexDirection: 'column', marginTop: 1 })
  expect(all.filter((one) => one.width === 13 && one.flexShrink === 0).length).toBe(5)
  expect(all.filter((one) => one.width === 34 && one.flexShrink === 0).length).toBe(5)
  expect(all.filter((one) => one.width === undefined && one.flexShrink === 1).length > 0).toBe(true)
  const pane = await drawn($)
  expect(pane.of('  3 Spec')?.props).toEqual({ wrap: 'truncate-end' })
  expect(pane.texts.filter((text) => text.startsWith(RULE)).map((text) => pane.of(text)?.props)).toEqual([{ dimColor: true }])
})

test('a pane whose width is not given, or is no width, still draws a rule', async ($, on) => {
  at(on, record('knowledge'))
  for (const [columns, length] of [[undefined, 40], [0, 40], [0.5, 1], [100000, 400]] as const) {
    const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: columns as number } })
    const rule = (await ui.findAll({ type: 'Text' })).map((one) => one.text).filter((text) => text.startsWith(RULE))
    await ui.unmount()
    expect(rule).toEqual([RULE.repeat(length)])
  }
})

test('an edit stopped while the person was asked to approve is not moved on by the answer', async ($, on) => {
  const w = mod(on)
  await toSpec($, w)
  w.whileAsked = () => {
    w.store[KEY] = { ...kept(w), stopped: true }
  }
  expect(await gate($)).toBe(`mod-builder: the edit of ${MOD} was stopped or moved while this gate ran, so nothing was moved. Run /mod-builder to see where this session stands.`)
  expect(kept(w).phase).toBe('spec')
  expect(kept(w).stopped).toBe(true)
  expect(kept(w).specApprovedAt).toBe(null)
})

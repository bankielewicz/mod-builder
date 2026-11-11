// The pane (SPEC.md 3.3, "Pane"; rebuilt to the mockup in 8.16 and 8.18), through the hooks module: the header, the
// phase rail, what the gates saw, and the cache, on every surface.
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { HOME, MOD, world } from './world'

const CACHE = `${HOME}/.claude/mod-builder-data/v2/docs`
const BUILD = { skill: 'build', text: 'the eight phases', source: 'plugin', pluginName: 'mod-builder', frontmatter: {} } as const
const PANE = {
  plugin: 'mod-builder',
  component: 'Pane',
  requestId: 'mod-builder',
  props: { title: 'mod-builder', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const
const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const
const FILES = { [`${CACHE}/latest`]: '2026-11-10T151216Z\n', [`${CACHE}/checked`]: '2026-11-10T160000Z\n' }
// 2026-11-10 18:00 UTC: the cache was checked that day.
const NOW = Date.UTC(2026, 10, 10, 18)
const TITLE = 'MOD BUILDER'
const LATER = ['1 Knowledge', '2 Describe', '3 Spec', '4 Scaffold', '5 Red', '6 Green', '7 Verify', '8 Done']
const RULE = String.fromCharCode(0x2500).repeat(40)
const DOT = String.fromCharCode(0xb7)
const TICK = String.fromCharCode(0x2713)
const DOTS = String.fromCharCode(0x2026)
// The Knowledge block of a cache with a snapshot and nothing to compare it with.
const KNOWLEDGE = ['Knowledge', "Anthropic's mod pages", 'last fetched today', '  pages in snapshot 2026-11-10T151216Z', 'the first snapshot, or nothing to compare with', 'API types for this build', `2.1.322 ${DOT} read from the installed copy at each typecheck`]
const DOCS = 'Docs: snapshot 2026-11-10T151216Z, checked 2026-11-10T160000Z'

const record = (phase: string, evidence: Record<string, string> = {}, sessionId = 's1') => ({
  modDir: MOD, sessionId, phase, specApprovedAt: null, spec: null, testsAtScaffold: null, namesAtScaffold: null, testsAtRed: null, testHashes: null, evidence,
})
const lines = async ($: Engine, surface: (typeof SURFACES)[number] = 'terminal') => {
  const ui = await $.ui.mount({ ...PANE, surface })
  const texts = (await ui.findAll({ type: 'Text' })).map((text) => text.text)
  await ui.unmount()
  return texts
}

test('with no build in the session the pane says so, shows the eight phases unstarted, and the cache', async ($, on) => {
  world(on, { files: FILES, now: NOW })
  expect(await lines($)).toEqual([TITLE, 'no build or edit in this session', ...LATER, RULE, ...KNOWLEDGE])
})

test('a pending build is shown as open with its folder not named yet', async ($, on) => {
  world(on, { files: FILES, now: NOW, store: { 'session:s1': { modDir: null } } })
  expect(await lines($)).toEqual([TITLE, `a new mod ${DOT} its folder is not named yet`, ...LATER, RULE, ...KNOWLEDGE])
})

test('a build at Red shows the phases before it passed, Red as the current one, and what the gates before it saw', async ($, on) => {
  // Out of order, and with an entry no gate has written yet: each passed phase is shown by its phase, in order.
  const evidence = { green: 'not yet', scaffold: 'claude plugin validate --strict exited 0; 1 tests ran', knowledge: 'snapshot 2026-11-10T151216Z', spec: 'the person answered "Approve"', describe: 'no gate' }
  world(on, { files: FILES, now: NOW, store: { 'session:s1': { modDir: MOD }, [`build:${MOD}`]: record('red', evidence) } })
  for (const surface of SURFACES) {
    expect(await lines($, surface)).toEqual([
      TITLE, `turn-counter ${DOT} building`,
      `1 Knowledge ${TICK}`, `2 Describe ${TICK}`, `3 Spec ${TICK}`, `4 Scaffold ${TICK}`, ' 5 Red ', '6 Green', '7 Verify', '8 Done',
      RULE,
      '3 Spec', 'passed', '  the person answered "Approve"',
      '4 Scaffold', 'passed', '  claude plugin validate --strict exited 0', '  1 tests ran',
      '5 Red', `working${DOTS}`,
    ])
  }
})

test('the first phase has no gate before it, and Done shows every phase before it passed', async ($, on) => {
  const w = world(on, { files: FILES, now: NOW, store: { 'session:s1': { modDir: MOD }, [`build:${MOD}`]: record('knowledge') } })
  expect(await lines($)).toEqual([
    TITLE, `turn-counter ${DOT} new mod`, ' 1 Knowledge ', ...LATER.slice(1), RULE, ...KNOWLEDGE,
    'Everything the plan says about the API will cite one of these, by page and line.',
  ])
  w.store[`build:${MOD}`] = record('done', { verify: 'validate, 2 tests, the typecheck and a headless load of turns all pass' })
  expect(await lines($)).toEqual([
    TITLE, `turn-counter ${DOT} built and checked`,
    `1 Knowledge ${TICK}`, `2 Describe ${TICK}`, `3 Spec ${TICK}`, `4 Scaffold ${TICK}`, `5 Red ${TICK}`, `6 Green ${TICK}`, `7 Verify ${TICK}`, ' 8 Done ',
    RULE,
    'What was built', `  ${MOD}/`, '  built on Claude Code 2.1.322, from the documents of 2026-11-10T151216Z',
    'What was checked', '  validate, 2 tests, the typecheck and a headless load of turns all pass',
    'Try it', `  claude --plugin-dir ${MOD}`,
  ])
})

test('the pane shows this session\'s build only: another session\'s record for the folder is not this one\'s progress', async ($, on) => {
  const w = world(on, { files: FILES, now: NOW, store: { 'session:s1': { modDir: MOD }, [`build:${MOD}`]: record('green', {}, 's2') } })
  expect(await lines($)).toEqual([TITLE, `turn-counter ${DOT} its record is missing or another session's`, ...LATER, RULE, ...KNOWLEDGE])
  delete w.store[`build:${MOD}`]
  expect((await lines($))[1]).toBe(`turn-counter ${DOT} its record is missing or another session's`)
})

test('a phase whose gate left no evidence shows no block for it, never a blank or an undefined one', async ($, on) => {
  world(on, { files: FILES, now: NOW, store: { 'session:s1': { modDir: MOD }, [`build:${MOD}`]: record('green', { scaffold: 'x' }) } })
  const shown = await lines($)
  expect(shown.slice(11)).toEqual(['4 Scaffold', 'passed', '  x', '6 Green', `working${DOTS}`])
  expect(shown.some((text) => text.includes('undefined') || text.trim() === '')).toBe(false)
})

test('a snapshot with no check, and a check with no snapshot, are each shown as they are', async ($, on) => {
  const w = world(on, { files: { [`${CACHE}/latest`]: '2026-11-10T151216Z\n' }, now: NOW })
  expect((await lines($)).slice(12, 15)).toEqual(["Anthropic's mod pages", 'never fetched', '  pages in snapshot 2026-11-10T151216Z'])
  delete w.files[`${CACHE}/latest`]
  w.files[`${CACHE}/checked`] = '2026-11-10T160000Z\n'
  expect((await lines($)).slice(12, 15)).toEqual(["Anthropic's mod pages", 'last fetched today', '  no snapshot yet: /mod-builder refresh fetches one'])
})

test('a pane left open follows the build: the same drawing shows the next phase once the gate has moved it', async ($, on) => {
  const w = world(on, { files: FILES, now: NOW, store: { 'session:s1': { modDir: MOD }, [`build:${MOD}`]: record('knowledge') } })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.findAll({ type: 'Text' })).map((text) => text.text).slice(2, 4)).toEqual([' 1 Knowledge ', '2 Describe'])
  await $.tool.call({ tool: 'mcp__mod-builder__mod_builder_gate' } as never)
  expect((w.store[`build:${MOD}`] as { phase: string }).phase).toBe('describe')
  expect((await ui.findAll({ type: 'Text' })).map((text) => text.text).slice(2, 4)).toEqual([`1 Knowledge ${TICK}`, ' 2 Describe '])
  await ui.unmount()
})

test('only this plugin\'s build skill opens the pane: another skill, and a session start, open none', async ($, on) => {
  const w = world(on, { files: FILES })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await $.skill.prompt({ ...BUILD, skill: 'design' })
  await $.skill.prompt({ ...BUILD, pluginName: 'other' })
  expect(w.opened).toEqual([])
})

test('a cache with no snapshot and no check is shown as never fetched, with no snapshot yet', async ($, on) => {
  world(on)
  expect((await lines($)).slice(12, 15)).toEqual(["Anthropic's mod pages", 'never fetched', '  no snapshot yet: /mod-builder refresh fetches one'])
})

test('opening a build opens the pane, and the pane then shows the build as the gate moves it', async ($, on) => {
  const w = world(on, { files: FILES, now: NOW })
  await $.skill.prompt(BUILD)
  expect(w.opened).toEqual([{ id: 'mod-builder', title: 'mod-builder' }])
  expect((await lines($))[1]).toBe(`a new mod ${DOT} its folder is not named yet`)
  await $.tool.call({ tool: 'mcp__mod-builder__mod_builder_gate', mod_dir: 'turn-counter' } as never)
  expect((await lines($)).slice(1, 3)).toEqual([`turn-counter ${DOT} new mod`, ' 1 Knowledge '])
  await $.tool.call({ tool: 'mcp__mod-builder__mod_builder_gate' } as never)
  expect((await lines($)).slice(2, 4)).toEqual([`1 Knowledge ${TICK}`, ' 2 Describe '])
  expect((w.store[`build:${MOD}`] as { evidence: Record<string, string> }).evidence.knowledge).toBe('snapshot 2026-11-10T151216Z')
})

test('"/mod-builder" alone opens the pane and says where the build stands', async ($, on) => {
  const w = world(on, { files: FILES, now: NOW, store: { 'session:s1': { modDir: MOD }, [`build:${MOD}`]: record('green') } })
  const said = await $.command.run({ command: 'mod-builder', args: '' } as never)
  expect(said.text).toBe(`mod-builder: turn-counter ${DOT} building. It is at 6 Green. ${DOCS}.`)
  expect(w.opened).toEqual([{ id: 'mod-builder', title: 'mod-builder' }])
  expect(w.ran).toEqual([])
})

test('"/mod-builder" with no build, and with one whose folder is not named yet, says so', async ($, on) => {
  const w = world(on, { files: FILES, now: NOW })
  const said = await $.command.run({ command: 'mod-builder', args: '  ' } as never)
  expect(said.text).toBe(`mod-builder: no build or edit in this session. ${DOCS}.`)
  w.store['session:s1'] = { modDir: null }
  const pending = await $.command.run({ command: 'mod-builder', args: '' } as never)
  expect(pending.text).toBe(`mod-builder: a new mod ${DOT} its folder is not named yet. ${DOCS}.`)
})

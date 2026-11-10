// The pane (SPEC.md 3.3, "Pane"), through the hooks module: the phase strip, the evidence the last gate saw, and
// the knowledge row, on every surface.
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
const NOT_STARTED = ['[ ] 1 Knowledge', '[ ] 2 Describe', '[ ] 3 Spec', '[ ] 4 Scaffold', '[ ] 5 Red', '[ ] 6 Green', '[ ] 7 Verify', '[ ] 8 Done']
const KNOWLEDGE = 'Docs: snapshot 2026-11-10T151216Z, checked 2026-11-10T160000Z'

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
  world(on, { files: FILES })
  expect(await lines($)).toEqual(['No build in this session.', ...NOT_STARTED, KNOWLEDGE])
})

test('a pending build is shown as open with its folder not named yet', async ($, on) => {
  world(on, { files: FILES, store: { 'session:s1': { modDir: null } } })
  expect(await lines($)).toEqual(['A build is open. Its mod folder is not named yet.', ...NOT_STARTED, KNOWLEDGE])
})

test('a build at Red shows the phases before it passed, Red as the current one, and what the gate before it saw', async ($, on) => {
  // Out of order, and with an entry no gate has written yet: the line shown is the gate before Red's, by its phase.
  const evidence = { green: 'not yet', scaffold: 'claude plugin validate --strict exited 0; 1 tests ran', knowledge: 'snapshot 2026-11-10T151216Z', spec: 'the person answered "Approve"', describe: 'no gate' }
  world(on, { files: FILES, store: { 'session:s1': { modDir: MOD }, [`build:${MOD}`]: record('red', evidence) } })
  for (const surface of SURFACES) {
    expect(await lines($, surface)).toEqual([
      `Building ${MOD}`,
      '[x] 1 Knowledge', '[x] 2 Describe', '[x] 3 Spec', '[x] 4 Scaffold', '[>] 5 Red', '[ ] 6 Green', '[ ] 7 Verify', '[ ] 8 Done',
      'Scaffold: claude plugin validate --strict exited 0; 1 tests ran',
      KNOWLEDGE,
    ])
  }
})

test('the first phase has no gate before it, and Done shows every phase before it passed', async ($, on) => {
  const w = world(on, { files: FILES, store: { 'session:s1': { modDir: MOD }, [`build:${MOD}`]: record('knowledge') } })
  expect(await lines($)).toEqual([`Building ${MOD}`, '[>] 1 Knowledge', ...NOT_STARTED.slice(1), KNOWLEDGE])
  w.store[`build:${MOD}`] = record('done', { verify: 'validate, 2 tests, the typecheck and a headless load of turns all pass' })
  expect(await lines($)).toEqual([
    `Building ${MOD}`,
    '[x] 1 Knowledge', '[x] 2 Describe', '[x] 3 Spec', '[x] 4 Scaffold', '[x] 5 Red', '[x] 6 Green', '[x] 7 Verify', '[>] 8 Done',
    'Verify: validate, 2 tests, the typecheck and a headless load of turns all pass',
    KNOWLEDGE,
  ])
})

test('the pane shows this session\'s build only: another session\'s record for the folder is not this one\'s progress', async ($, on) => {
  const w = world(on, { files: FILES, store: { 'session:s1': { modDir: MOD }, [`build:${MOD}`]: record('green', {}, 's2') } })
  expect(await lines($)).toEqual([`Building ${MOD}, but its record is missing or another session's.`, ...NOT_STARTED, KNOWLEDGE])
  delete w.store[`build:${MOD}`]
  expect((await lines($))[0]).toBe(`Building ${MOD}, but its record is missing or another session's.`)
})

test('a phase whose gate left no evidence shows no evidence line, never a blank or an undefined one', async ($, on) => {
  world(on, { files: FILES, store: { 'session:s1': { modDir: MOD }, [`build:${MOD}`]: record('green', { scaffold: 'x' }) } })
  const shown = await lines($)
  expect(shown.length).toBe(10)
  expect(shown.slice(-2)).toEqual(['[ ] 8 Done', KNOWLEDGE])
})

test('a snapshot with no check, and a check with no snapshot, are each shown as they are', async ($, on) => {
  const w = world(on, { files: { [`${CACHE}/latest`]: '2026-11-10T151216Z\n' } })
  expect((await lines($)).at(-1)).toBe('Docs: snapshot 2026-11-10T151216Z, checked never')
  delete w.files[`${CACHE}/latest`]
  w.files[`${CACHE}/checked`] = '2026-11-10T160000Z\n'
  expect((await lines($)).at(-1)).toBe('Docs: snapshot none, checked 2026-11-10T160000Z')
})

test('a pane left open follows the build: the same drawing shows the next phase once the gate has moved it', async ($, on) => {
  const w = world(on, { files: FILES, store: { 'session:s1': { modDir: MOD }, [`build:${MOD}`]: record('knowledge') } })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.findAll({ type: 'Text' })).map((text) => text.text).slice(1, 3)).toEqual(['[>] 1 Knowledge', '[ ] 2 Describe'])
  await $.tool.call({ tool: 'mcp__mod-builder__mod_builder_gate' } as never)
  expect((w.store[`build:${MOD}`] as { phase: string }).phase).toBe('describe')
  expect((await ui.findAll({ type: 'Text' })).map((text) => text.text).slice(1, 3)).toEqual(['[x] 1 Knowledge', '[>] 2 Describe'])
  await ui.unmount()
})

test('only this plugin\'s build skill opens the pane: another skill, and a session start, open none', async ($, on) => {
  const w = world(on, { files: FILES })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await $.skill.prompt({ ...BUILD, skill: 'design' })
  await $.skill.prompt({ ...BUILD, pluginName: 'other' })
  expect(w.opened).toEqual([])
})

test('a cache with no snapshot and no check is shown as none and never', async ($, on) => {
  world(on)
  expect((await lines($)).at(-1)).toBe('Docs: snapshot none, checked never')
})

test('opening a build opens the pane, and the pane then shows the build as the gate moves it', async ($, on) => {
  const w = world(on, { files: FILES })
  await $.skill.prompt(BUILD)
  expect(w.opened).toEqual([{ id: 'mod-builder', title: 'mod-builder' }])
  expect((await lines($))[0]).toBe('A build is open. Its mod folder is not named yet.')
  await $.tool.call({ tool: 'mcp__mod-builder__mod_builder_gate', mod_dir: 'turn-counter' } as never)
  expect((await lines($)).slice(0, 2)).toEqual([`Building ${MOD}`, '[>] 1 Knowledge'])
  await $.tool.call({ tool: 'mcp__mod-builder__mod_builder_gate' } as never)
  expect((await lines($)).slice(1, 3)).toEqual(['[x] 1 Knowledge', '[>] 2 Describe'])
  expect((await lines($)).at(-2)).toBe('Knowledge: snapshot 2026-11-10T151216Z')
})

test('"/mod-builder" alone opens the pane and says where the build stands', async ($, on) => {
  const w = world(on, { files: FILES, store: { 'session:s1': { modDir: MOD }, [`build:${MOD}`]: record('green') } })
  const said = await $.command.run({ command: 'mod-builder', args: '' } as never)
  expect(said.text).toBe(`mod-builder: Building ${MOD}. It is at 6 Green. ${KNOWLEDGE}.`)
  expect(w.opened).toEqual([{ id: 'mod-builder', title: 'mod-builder' }])
  expect(w.ran).toEqual([])
})

test('"/mod-builder" with no build, and with one whose folder is not named yet, says so', async ($, on) => {
  const w = world(on, { files: FILES })
  const said = await $.command.run({ command: 'mod-builder', args: '  ' } as never)
  expect(said.text).toBe(`mod-builder: No build in this session. ${KNOWLEDGE}.`)
  w.store['session:s1'] = { modDir: null }
  const pending = await $.command.run({ command: 'mod-builder', args: '' } as never)
  expect(pending.text).toBe(`mod-builder: A build is open. Its mod folder is not named yet. ${KNOWLEDGE}.`)
})

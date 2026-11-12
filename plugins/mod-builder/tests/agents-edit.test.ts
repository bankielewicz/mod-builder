// SPEC.md 9.5 and 9.33 in an edit, through the hooks module itself: `/mod-builder:edit --agents <folder> <change>`
// uses the same two agents. An edit's test files are those under tests/ and any file named as a test, and its
// code is its hooks/ and every source file, so the guard's rule by agent follows the edit's own phases.
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { GATE, HOME, MOD, NAME, failing, passing, world, readerDone } from './world'
import type { World } from './world'

const WRITER = 'mod-builder:test-writer'
const IMPLEMENTER = 'mod-builder:implementer'
const START_WRITER = 'Start it with the Agent tool (subagent_type "mod-builder:test-writer"), as a plain subagent'
const START_IMPLEMENTER = 'Start it with the Agent tool (subagent_type "mod-builder:implementer"), as a plain subagent'
const RED_NOTE = ` This edit uses mod-builder's agents: the tests are the test-writer's to write, not yours. ${START_WRITER}.`
const GREEN_NOTE = ` This edit uses mod-builder's agents: the code is the implementer's to write, not yours. ${START_IMPLEMENTER}.`
const redRefusal = (path: string) => `mod-builder: ${path} is the test-writer's to write: this edit uses mod-builder's agents, and at Red only the test-writer writes the tests. ${START_WRITER}.`
const greenRefusal = (path: string) => `mod-builder: ${path} is the implementer's to write: this edit uses mod-builder's agents, and at Green only the implementer writes the code (hooks/ and every source file). ${START_IMPLEMENTER}.`

const LATEST = `${HOME}/.claude/mod-builder-data/v2/docs/latest`
const SPEC = `${MOD}/SPEC.md`
const MANIFEST = `${MOD}/.claude-plugin/plugin.json`
const CODE = `${MOD}/hooks/register.tsx`
const TEST = `${MOD}/tests/pane.test.tsx`
const WIDTH = `${MOD}/tests/width.test.ts`
const RESTORE = `${HOME}/.claude/mod-builder-data/v2/restore/s1/1970-01-01T000001Z`
const LOADED = `[DEBUG] hooks module ${NAME}@inline loaded (worker, environment 1, tier user); events: session.start\n`
const OLD_SPEC = '# turn-counter\n\nCounts turns.\n'
const SECTION = '\n## 0.1.1 (2026-11-11)\n\nCuts each row by display width.\n'
const NAMES = ['draws its line', 'opens the pane']

// The edit skill as the engine expands it: the person's request is the first line that opens with "> ".
const edit = (request: string) =>
  ({
    skill: 'edit', source: 'plugin', pluginName: 'mod-builder', frontmatter: {},
    text: `Base directory for this skill: /p/skills/edit\n\n# Edit a mod\n\nThe person asked for this:\n\n> ${request}\n\nIf nothing is written above, ask which mod to change and what to change in it.\n`,
  }) as never
const build = (request: string) =>
  ({ skill: 'build', source: 'plugin', pluginName: 'mod-builder', frontmatter: {}, text: `# Build a mod\n\nThe person asked for this mod:\n\n> ${request}\n` }) as never
const record = (phase: string, more: Record<string, unknown> = {}) => ({
  modDir: MOD, sessionId: 's1', phase, kind: 'edit', red: 'edit', specApprovedAt: null, spec: null, testsAtScaffold: null, namesAtScaffold: null, testsAtRed: null, testHashes: null, evidence: {}, ...more,
})
// A world whose edit stands at `phase` and uses agents.
const at = (on: Parameters<typeof world>[0], phase: string) =>
  world(on, { store: { 'session:s1': { modDir: MOD, kind: 'edit', agents: true }, [`build:${MOD}`]: record(phase, { agents: true }) } })

const gate = async ($: Engine, more: Record<string, unknown> = {}) => readerDone($, String((await $.tool.call({ tool: GATE, ...more } as never)).result))
const first = (answer: string) => answer.split('\n')[0] as string
const kept = (w: World) => w.store[`build:${MOD}`] as Record<string, unknown> & { phase: string }
const write = async ($: Engine, path: string, agentId?: string) =>
  (await $.tool.call({ tool: 'Write', file_path: path, content: 'x', ...(agentId === undefined ? {} : { agentId }) } as never)).deny
const spawn = async ($: Engine, subagentType: string) =>
  (await $.agent.spawn({ subagentType, prompt: 'the mod is in /work/turn-counter', description: 'write' } as never)) as unknown as { agentId?: string; deny?: string }
const offered = async ($: Engine, agent: string) =>
  (await $.agent.offer({ agent, description: 'd', source: 'plugin', provider: { plugin: 'mod-builder', tier: 'user' } } as never)).isOffered

// A finished mod, as an earlier build left it, and a session in which nothing is open yet.
const mod = (on: Parameters<typeof world>[0]) =>
  world(on, {
    runs: { validate: { exitCode: 0, stdout: 'Validation passed' }, test: { exitCode: 0, stdout: passing(2, NAMES) }, tsc: { exitCode: 0, stdout: '' }, '--plugin-dir': { exitCode: 0, stdout: '' }, restore: { exitCode: 0, stdout: `restore point: ${RESTORE}\n` } },
    files: {
      [LATEST]: '2026-11-10T151216Z\n', [SPEC]: OLD_SPEC, [MANIFEST]: `{ "name": "${NAME}", "version": "0.1.0" }`,
      [`${MOD}/hooks/hooks.json`]: '{ "modules": ["./register.tsx"] }', [CODE]: 'the code', [TEST]: 'the first test', 'the load log': LOADED,
    },
  })

// -------------------------------------------------------------------------------------------- the word

test('an edit asked for with --agents keeps the word in its entry, and the gate\'s first call puts it into the record and says who writes what', async ($, on) => {
  const w = mod(on)
  await $.skill.prompt(edit('--agents turn-counter cut each row by display width'))
  expect(w.store['session:s1']).toEqual({ modDir: null, kind: 'edit', agents: true })
  const answer = await gate($, { mod_dir: 'turn-counter' })
  expect(kept(w).agents).toBe(true)
  expect(kept(w).kind).toBe('edit')
  expect(w.store['session:s1']).toEqual({ modDir: MOD, kind: 'edit', agents: true })
  expect((answer.split('\n').at(-1) as string)).toBe(
    'It is at phase 1 (Knowledge). It uses mod-builder\'s agents (--agents): at Red the tests are the test-writer\'s to write, at Green the code is the implementer\'s. Call mod_builder_gate again to ask for the next phase.',
  )
})

test('an edit asked for without the word has none in its entry or record, and its answers name no agent; the word given to a build that still waits does not pass to an edit', async ($, on) => {
  const w = mod(on)
  await $.skill.prompt(build('--agents a pane'))
  expect(w.store['session:s1']).toEqual({ modDir: null, agents: true })
  await $.skill.prompt(edit('turn-counter cut each row by display width'))
  expect(w.store['session:s1']).toEqual({ modDir: null, kind: 'edit' })
  const answer = await gate($, { mod_dir: 'turn-counter' })
  expect('agents' in kept(w)).toBe(false)
  expect(answer.includes('agents')).toBe(false)
  expect(w.store['session:s1']).toEqual({ modDir: MOD, kind: 'edit' })
})

// ------------------------------------------------------------------------------------------ the guard

test('at an edit\'s Red a test file is the test-writer\'s wherever it sits: the main model is refused under tests/ and for a file named as a test', async ($, on) => {
  const w = at(on, 'red')
  expect(await write($, WIDTH)).toBe(redRefusal('tests/width.test.ts'))
  expect(await write($, `${MOD}/lib/width.test.ts`)).toBe(redRefusal('lib/width.test.ts'))
  expect(w.reachedTheTool).toEqual([])
  const { agentId } = await spawn($, WRITER)
  expect(await write($, WIDTH, agentId)).toBe(undefined)
  expect(await write($, `${MOD}/lib/width.test.ts`, agentId)).toBe(undefined)
  expect(w.store[`agent:s1:${String(agentId)}`]).toEqual({ role: 'test-writer', modDir: MOD })
  // What an edit's Red closes stays closed to it, with the phase's own reason.
  expect(String(await write($, CODE, agentId)).startsWith('mod-builder: hooks/register.tsx can\'t be written in phase 4 (Red) of this edit, which may write test files only')).toBe(true)
})

test('at an edit\'s Green the code is the implementer\'s: the main model is refused under hooks/ and for a source file, and still raises the version itself', async ($, on) => {
  const w = at(on, 'green')
  expect(await write($, CODE)).toBe(greenRefusal('hooks/register.tsx'))
  expect(await write($, `${MOD}/lib/width.ts`)).toBe(greenRefusal('lib/width.ts'))
  expect(await write($, MANIFEST)).toBe(undefined)
  expect(await write($, `${MOD}/README.md`)).toBe(undefined)
  const { agentId } = await spawn($, IMPLEMENTER)
  expect(await write($, CODE, agentId)).toBe(undefined)
  expect(await write($, `${MOD}/lib/width.ts`, agentId)).toBe(undefined)
  expect(String(await write($, WIDTH, agentId)).startsWith('mod-builder: tests/width.test.ts can\'t be written in phase 5 (Green) of this edit')).toBe(true)
  expect(w.reachedTheTool.map((one) => one.path)).toEqual([MANIFEST, `${MOD}/README.md`, CODE, `${MOD}/lib/width.ts`])
})

test('in an edit the test-writer is offered at Red only and the implementer at Green and Verify, by the edit\'s phases', async ($, on) => {
  const w = at(on, 'spec')
  const seen: Record<string, [boolean, boolean]> = {}
  for (const phase of ['knowledge', 'describe', 'spec', 'red', 'green', 'verify', 'done']) {
    kept(w).phase = phase
    seen[phase] = [await offered($, WRITER), await offered($, IMPLEMENTER)]
  }
  expect(seen).toEqual({ knowledge: [false, false], describe: [false, false], spec: [false, false], red: [true, false], green: [false, true], verify: [false, true], done: [false, false] })
})

test('at an edit\'s Verify a source file is still the implementer\'s, and the main model still writes what is no source', async ($, on) => {
  const w = at(on, 'verify')
  expect(await write($, `${MOD}/lib/width.ts`)).toBe(
    `mod-builder: lib/width.ts is the implementer's to write: this edit uses mod-builder's agents, and at Verify only the implementer writes a source file. ${START_IMPLEMENTER}.`,
  )
  expect(await write($, `${MOD}/README.md`)).toBe(undefined)
  const { agentId } = await spawn($, IMPLEMENTER)
  expect(await write($, `${MOD}/lib/width.ts`, agentId)).toBe(undefined)
  expect(w.reachedTheTool.length).toBe(2)
})

test('an edit this session left open goes on as it was: its record keeps the word, the entry takes it from the record, and the answer says so', async ($, on) => {
  const w = mod(on)
  w.store['session:s1'] = { modDir: null, kind: 'edit' }
  w.store[`build:${MOD}`] = record('red', { agents: true })
  expect(await gate($, { mod_dir: 'turn-counter' })).toBe(
    `mod-builder: the edit of ${MOD} goes on. It is at phase 4 (Red). It uses mod-builder's agents (--agents): at Red the tests are the test-writer's to write, at Green the code is the implementer's. Call mod_builder_gate again to ask for the next phase.`,
  )
  expect(kept(w).agents).toBe(true)
  expect(w.store['session:s1']).toEqual({ modDir: MOD, kind: 'edit', agents: true })
  expect(await write($, WIDTH)).toBe(redRefusal('tests/width.test.ts'))
})

// ------------------------------------------------------------------------------- the gate's answers

test('an edit\'s answer that opens Red names the test-writer, and the one that opens Green the implementer', async ($, on) => {
  const w = mod(on)
  await $.skill.prompt(edit('--agents turn-counter cut each row by display width'))
  await gate($, { mod_dir: 'turn-counter' })
  for (const [path, text] of Object.entries(w.files)) if (path.startsWith(`${MOD}/`)) w.files[`${RESTORE}/${path.slice(MOD.length + 1)}`] = text
  await gate($)
  await gate($)
  w.files[SPEC] = `${OLD_SPEC}${SECTION}`
  const intoRed = first(await gate($))
  expect(kept(w).phase).toBe('red')
  expect(intoRed.endsWith(`The edit is now at phase 4 (Red).${RED_NOTE}`)).toBe(true)
  w.files[WIDTH] = 'the new test'
  w.runs.test = { exitCode: 1, stdout: failing(NAMES, ['cuts by width']) }
  const intoGreen = first(await gate($))
  expect(kept(w).phase).toBe('green')
  expect(intoGreen.endsWith(`The edit is now at phase 5 (Green).${GREEN_NOTE}`)).toBe(true)
  expect(kept(w).agents).toBe(true)
})

test('an edit whose Red is skipped never offers the test-writer: the implementer is offered once it is at Green, and the main model is refused there', async ($, on) => {
  const w = at(on, 'spec')
  w.store[`build:${MOD}`] = record('spec', { agents: true, red: 'skipped', skipped: 'fit' })
  expect(await offered($, IMPLEMENTER)).toBe(false)
  kept(w).phase = 'green'
  expect(await offered($, IMPLEMENTER)).toBe(true)
  expect(await offered($, WRITER)).toBe(false)
  expect(await write($, CODE)).toBe(greenRefusal('hooks/register.tsx'))
})

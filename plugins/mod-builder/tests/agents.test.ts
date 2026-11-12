// SPEC.md 9.5 and 9.33, through the hooks module itself: the opt-in agents of a build. The mod reads the word
// --agents from the skill's own text, registers a test-writer and an implementer, offers each to the model only
// at its phase of a record that uses agents, keeps the id of each one the model starts, and lets only that agent
// write: the tests at Red, the code at Green. A teammate is refused at its spawn.
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { BUILT, GATE, HOME, MOD, NAME, failing, passing, world, readerDone } from './world'
import type { World } from './world'

const WRITER = 'mod-builder:test-writer'
const IMPLEMENTER = 'mod-builder:implementer'
const START_WRITER = 'Start it with the Agent tool (subagent_type "mod-builder:test-writer"), as a plain subagent'
const START_IMPLEMENTER = 'Start it with the Agent tool (subagent_type "mod-builder:implementer"), as a plain subagent'
const RED_NOTE = ` This build uses mod-builder's agents: the tests are the test-writer's to write, not yours. ${START_WRITER}.`
const GREEN_NOTE = ` This build uses mod-builder's agents: the code is the implementer's to write, not yours. ${START_IMPLEMENTER}.`
const redRefusal = (path: string) => `mod-builder: ${path} is the test-writer's to write: this build uses mod-builder's agents, and at Red only the test-writer writes the tests. ${START_WRITER}.`
const greenRefusal = (path: string) => `mod-builder: ${path} is the implementer's to write: this build uses mod-builder's agents, and at Green only the implementer writes the code (hooks/ and every source file). ${START_IMPLEMENTER}.`
const NOT_NOW = 'mod-builder: the test-writer can\'t be started now: it writes the tests of a build or edit this session started with --agents, while that is at Red. Run /mod-builder to see where this session stands.'

const LATEST = `${HOME}/.claude/mod-builder-data/v2/docs/latest`
const SPEC = `${MOD}/SPEC.md`
const LOADED = `[DEBUG] hooks module ${NAME}@inline loaded (worker, environment 1, tier user); events: session.start\n`
const PANE = `${MOD}/tests/pane.test.tsx`
const COUNTS = `${MOD}/tests/counts.test.tsx`
const CODE = `${MOD}/hooks/register.tsx`
const FAILS = { exitCode: 1, stdout: failing(['test 1'], ['counts a turn']) }
const PASSES = { exitCode: 0, stdout: passing(2, ['test 1', 'counts a turn']) }
const VERIFY_NOTE = ` This build uses mod-builder's agents: a source file is still the implementer's to write, not yours. ${START_IMPLEMENTER}.`
const verifyRefusal = (path: string) => `mod-builder: ${path} is the implementer's to write: this build uses mod-builder's agents, and at Verify only the implementer writes a source file. ${START_IMPLEMENTER}.`
const TEAMMATE = `mod-builder: the test-writer can't be started as a teammate: a teammate's writes do not pass mod-builder's guard. ${START_WRITER}.`

// The build skill as the engine expands it: the person's request is the first line that opens with "> ".
const build = (request: string) =>
  ({
    skill: 'build', source: 'plugin', pluginName: 'mod-builder', frontmatter: {},
    text: `Base directory for this skill: /p/skills/build\n\n# Build a mod\n\nThe person asked for this mod:\n\n> ${request}\n\nIf nothing is written above, ask what the mod should do before anything else.\n`,
  }) as never
const record = (phase: string, more: Record<string, unknown> = {}) => ({
  modDir: MOD, sessionId: 's1', phase, specApprovedAt: null, spec: null, testsAtScaffold: null, namesAtScaffold: null, testsAtRed: null, testHashes: null, evidence: {}, ...more,
})
// A world whose build stands at `phase` and uses agents.
const at = (on: Parameters<typeof world>[0], phase: string, more: Partial<World> = {}) =>
  world(on, { ...more, store: { 'session:s1': { modDir: MOD, agents: true }, [`build:${MOD}`]: record(phase, { agents: true }), ...more.store } })
// A world whose build stands at `phase` as 0.2.0 stored it: neither the entry nor the record says a word of agents.
const plainAt = (on: Parameters<typeof world>[0], phase: string) => world(on, { store: { 'session:s1': { modDir: MOD }, [`build:${MOD}`]: record(phase) } })

const gate = async ($: Engine, more: Record<string, unknown> = {}) => readerDone($, String((await $.tool.call({ tool: GATE, ...more } as never)).result))
const first = (answer: string) => answer.split('\n')[0] as string
const kept = (w: World) => w.store[`build:${MOD}`] as Record<string, unknown> & { phase: string }
// A write by the main model, or by the agent whose id is given: the refusal, or undefined when it went through.
const write = async ($: Engine, path: string, agentId?: string, tool = 'Write') =>
  (await $.tool.call({ tool, file_path: path, content: 'x', ...(agentId === undefined ? {} : { agentId }) } as never)).deny
// The model's Agent call for a type, as the spawn the engine raises for it.
const spawn = async ($: Engine, subagentType: string, more: Record<string, unknown> = {}) =>
  (await $.agent.spawn({ subagentType, prompt: 'the mod is in /work/turn-counter', description: 'write', ...more } as never)) as unknown as { agentId?: string; deny?: string }
const offered = async ($: Engine, agent: string) =>
  (await $.agent.offer({ agent, description: 'd', source: 'plugin', provider: { plugin: 'mod-builder', tier: 'user' } } as never)).isOffered
const start = ($: Engine) => $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: false })
const agentKeys = (w: World) => Object.keys(w.store).filter((key) => key.startsWith('agent:') && w.store[key] !== null).sort()

// A new build's world, and its walk through the gates to `to`: two tests, one of them new at Red.
const fresh = (on: Parameters<typeof world>[0], more: Partial<World> = {}) =>
  world(on, {
    ...more,
    files: { [LATEST]: '2026-11-10T151216Z\n', [SPEC]: '# turn-counter\n', [`${MOD}/.claude-plugin/plugin.json`]: `{ "name": "${NAME}" }`, [PANE]: 'the first test', 'the load log': LOADED, ...more.files },
  })
const walk = async ($: Engine, w: World, to: string): Promise<string[]> => {
  const order = ['knowledge', 'describe', 'spec', 'scaffold', 'red', 'green']
  const answers: string[] = []
  while (order.indexOf(kept(w).phase) < order.indexOf(to)) {
    const now = kept(w).phase
    if (now === 'red') {
      w.files[COUNTS] = 'the new test'
      w.runs.test = FAILS
    }
    const answer = await gate($)
    expect(kept(w).phase === now ? `the walk stopped at ${now}: ${answer}` : 'moved on').toBe('moved on')
    answers.push(answer)
  }
  return answers
}

// ---------------------------------------------------------------------------------------- registered

test('the mod registers a test-writer and an implementer beside the reader: five tools each, no shell, no CLAUDE.md, and no model named', async ($, on) => {
  const w = world(on)
  await start($)
  expect(w.agents.map((agent) => agent.name)).toEqual(['test-reader', 'test-writer', 'implementer'])
  for (const name of ['test-writer', 'implementer']) {
    const agent = { ...(w.agents.find((one) => one.name === name) as object) } as Record<string, unknown>
    expect(agent.tools).toEqual(['Read', 'Grep', 'Glob', 'Write', 'Edit'])
    expect(agent.omitClaudeMd).toBe(true)
    expect(Object.keys(agent).sort()).toEqual(['description', 'name', 'omitClaudeMd', 'prompt', 'tools'])
    expect(String(agent.prompt).startsWith(name === 'test-writer' ? 'You write the tests of a Claude Code mod before its code is written.' : 'You write the code of a Claude Code mod so that its tests pass.')).toBe(true)
  }
})

test('where no agent type can be registered each of the two is logged by its name, and the gate tool and the command are registered all the same', async ($, on) => {
  const w = world(on, { agentRegisterFails: true })
  await start($)
  expect(w.logged.filter((line) => line.includes('the test-writer could not be registered')).length).toBe(1)
  expect(w.logged.filter((line) => line.includes('the implementer could not be registered')).length).toBe(1)
  expect(w.registered.map((tool) => tool.name)).toEqual(['mod_builder_gate'])
  expect(w.commandsRegistered).toEqual(['mod-builder'])
})

// ------------------------------------------------------------------------------------------- the word

test('the word is read by the mod from the skill\'s text and kept in the session\'s entry; the gate\'s input has no field for it', async ($, on) => {
  const w = world(on)
  await start($)
  await $.skill.prompt(build('--agents a pane that counts the turns'))
  expect(w.store['session:s1']).toEqual({ modDir: null, agents: true })
  const schema = (w.registered[0] as unknown as { inputSchema: { properties: Record<string, unknown> } }).inputSchema
  expect(Object.keys(schema.properties).sort()).toEqual(['back_to_red', 'mod_dir', 'no_behaviour_change'])
})

test('the word later in the request opts nothing in; given as the request\'s first word in a later expansion, it does', async ($, on) => {
  const w = world(on)
  await $.skill.prompt(build('a pane that mentions --agents twice, --agents'))
  expect(w.store['session:s1']).toEqual({ modDir: null })
  await $.skill.prompt(build('--agents a pane that counts the turns'))
  expect(w.store['session:s1']).toEqual({ modDir: null, agents: true })
})

test('the word once given stays given while the build waits for its folder, and /mod-builder stop drops it', async ($, on) => {
  const w = world(on)
  await $.skill.prompt(build('--agents a pane'))
  await $.skill.prompt(build('a pane, typed again without the word'))
  expect(w.store['session:s1']).toEqual({ modDir: null, agents: true })
  await $.command.run({ command: 'mod-builder', args: 'stop' } as never)
  await $.skill.prompt(build('a pane, after the stop'))
  expect(w.store['session:s1']).toEqual({ modDir: null })
})

test('the gate\'s first call puts the word into the record, and its answer says who writes what', async ($, on) => {
  const w = fresh(on)
  await $.skill.prompt(build('--agents a pane that counts the turns'))
  expect(await gate($, { mod_dir: 'turn-counter' })).toBe(
    `mod-builder: the build's mod folder is ${MOD}. It is at phase 1 (Knowledge). It uses mod-builder's agents (--agents): at Red the tests are the test-writer's to write, at Green the code is the implementer's. Call mod_builder_gate again to ask for the next phase.`,
  )
  expect(kept(w).agents).toBe(true)
  expect(w.store['session:s1']).toEqual({ modDir: MOD, agents: true })
})

test('a build asked for without the word has no word in its entry or its record, and neither agent is ever offered in it', async ($, on) => {
  const w = fresh(on)
  await $.skill.prompt(build('a pane that counts the turns'))
  expect(await gate($, { mod_dir: 'turn-counter' })).toBe(`mod-builder: the build's mod folder is ${MOD}. It is at phase 1 (Knowledge). Call mod_builder_gate again to ask for the next phase.`)
  expect('agents' in kept(w)).toBe(false)
  expect(w.store['session:s1']).toEqual({ modDir: MOD })
  await walk($, w, 'red')
  expect(await offered($, WRITER)).toBe(false)
  await walk($, w, 'green')
  expect(await offered($, IMPLEMENTER)).toBe(false)
})

test('expanding the skill again changes nothing in an open record: one without agents gains none by the word', async ($, on) => {
  const w = plainAt(on, 'red')
  await $.skill.prompt(build('--agents the same pane, with the word this time'))
  expect(w.store['session:s1']).toEqual({ modDir: MOD })
  expect('agents' in kept(w)).toBe(false)
  expect(await offered($, WRITER)).toBe(false)
  expect(await write($, PANE)).toBe(undefined)
})

test('expanding the skill again without the word takes no agents from an open record that uses them', async ($, on) => {
  const w = at(on, 'red')
  await $.skill.prompt(build('the same pane, without the word this time'))
  expect(kept(w).agents).toBe(true)
  expect(await write($, PANE)).toBe(redRefusal('tests/pane.test.tsx'))
})

// ------------------------------------------------------------------------------------------ the offer

test('the test-writer is offered only at Red and the implementer only at Green and Verify; the reader stays withheld and other types offered', async ($, on) => {
  const w = at(on, 'scaffold')
  const seen: Record<string, [boolean, boolean]> = {}
  for (const phase of ['knowledge', 'describe', 'spec', 'scaffold', 'red', 'green', 'verify', 'done']) {
    kept(w).phase = phase
    seen[phase] = [await offered($, WRITER), await offered($, IMPLEMENTER)]
  }
  expect(seen).toEqual({
    knowledge: [false, false], describe: [false, false], spec: [false, false], scaffold: [false, false],
    red: [true, false], green: [false, true], verify: [false, true], done: [false, false],
  })
  expect(await offered($, 'mod-builder:test-reader')).toBe(false)
  expect(await offered($, 'Plan')).toBe(true)
})

test('with no build in the session, while one waits for its folder, and once it is stopped, neither is offered', async ($, on) => {
  const w = world(on)
  expect([await offered($, WRITER), await offered($, IMPLEMENTER)]).toEqual([false, false])
  w.store['session:s1'] = { modDir: null, agents: true }
  expect([await offered($, WRITER), await offered($, IMPLEMENTER)]).toEqual([false, false])
  w.store['session:s1'] = { modDir: MOD, agents: true }
  w.store[`build:${MOD}`] = record('red', { agents: true, stopped: true })
  expect(await offered($, WRITER)).toBe(false)
  w.store[`build:${MOD}`] = record('red', { agents: true, sessionId: 's2' })
  expect(await offered($, WRITER)).toBe(false)
})

test('an offer that can\'t read the store withholds', async ($, on) => {
  const w = at(on, 'red')
  expect(await offered($, WRITER)).toBe(true)
  w.unreadable.push('session:s1')
  expect(await offered($, WRITER)).toBe(false)
  w.unreadable.length = 0
  w.unreadable.push(`build:${MOD}`)
  expect(await offered($, WRITER)).toBe(false)
})

test('the implementer\'s offer withholds as well when the store can\'t be read', async ($, on) => {
  const w = at(on, 'green')
  expect(await offered($, IMPLEMENTER)).toBe(true)
  w.unreadable.push('session:s1')
  expect(await offered($, IMPLEMENTER)).toBe(false)
})

// ------------------------------------------------------------------------------------------ the spawn

test('a started test-writer is kept under a key of its own, with its role and the mod; the reader\'s spawn and any other type\'s are kept nowhere', async ($, on) => {
  const w = at(on, 'red')
  const started = await spawn($, WRITER)
  expect(started.agentId).toBe('agent-1')
  expect(w.store['agent:s1:agent-1']).toEqual({ role: 'test-writer', modDir: MOD })
  expect((await spawn($, 'general-purpose')).agentId).toBe('agent-2')
  expect((await spawn($, 'mod-builder:test-reader')).agentId).toBe('reader-3')
  expect(agentKeys(w)).toEqual(['agent:s1:agent-1'])
  expect(w.spawned.map((one) => one.subagentType)).toEqual([WRITER, 'general-purpose', 'mod-builder:test-reader'])
})

test('two agents started side by side are each kept, neither written over the other', async ($, on) => {
  const w = at(on, 'green')
  const [one, two] = await Promise.all([spawn($, IMPLEMENTER), spawn($, IMPLEMENTER)])
  expect([one.agentId, two.agentId].sort()).toEqual(['agent-1', 'agent-2'])
  expect(agentKeys(w)).toEqual(['agent:s1:agent-1', 'agent:s1:agent-2'])
  expect(w.store['agent:s1:agent-2']).toEqual({ role: 'implementer', modDir: MOD })
})

test('a spawn another plugin or the engine denies keeps nothing; the next one that starts is kept', async ($, on) => {
  const w = at(on, 'red', { spawnAnswer: { deny: 'another plugin: not today' } })
  expect((await spawn($, WRITER)).deny).toBe('another plugin: not today')
  expect(agentKeys(w)).toEqual([])
  w.spawnAnswer = null
  await spawn($, WRITER)
  expect(agentKeys(w)).toEqual(['agent:s1:agent-1'])
})

test('a teammate of either type is refused at its spawn, with the reason, and nothing is started', async ($, on) => {
  const w = at(on, 'red')
  expect((await spawn($, WRITER, { isTeammate: true, name: 'scout' })).deny).toBe(
    `mod-builder: the test-writer can't be started as a teammate: a teammate's writes do not pass mod-builder's guard. ${START_WRITER}.`,
  )
  kept(w).phase = 'green'
  expect((await spawn($, IMPLEMENTER, { isTeammate: true, name: 'scout' })).deny).toBe(
    `mod-builder: the implementer can't be started as a teammate: a teammate's writes do not pass mod-builder's guard. ${START_IMPLEMENTER}.`,
  )
  expect(w.spawned).toEqual([])
  expect(agentKeys(w)).toEqual([])
})

test('a teammate is told it is a teammate whatever else stands in its way: with no build in the session, and at another phase', async ($, on) => {
  const w = world(on)
  expect((await spawn($, WRITER, { isTeammate: true, name: 'scout' })).deny).toBe(TEAMMATE)
  w.store['session:s1'] = { modDir: MOD, agents: true }
  w.store[`build:${MOD}`] = record('green', { agents: true })
  expect((await spawn($, WRITER, { isTeammate: true, name: 'scout' })).deny).toBe(TEAMMATE)
  expect(w.spawned).toEqual([])
})

test('a resumed run of either agent is judged as a new one: kept at its phase under the id it runs by, refused at another', async ($, on) => {
  const w = at(on, 'red')
  const again = await spawn($, WRITER, { resume: { agentId: 'agent-of-before' } })
  expect(again.agentId).toBe('agent-1')
  expect(w.store['agent:s1:agent-1']).toEqual({ role: 'test-writer', modDir: MOD })
  kept(w).phase = 'green'
  expect((await spawn($, WRITER, { resume: { agentId: 'agent-1' } })).deny).toBe(NOT_NOW)
  expect(w.spawned.length).toBe(1)
})

test('a teammate of another type is none of the mod\'s to refuse', async ($, on) => {
  const w = at(on, 'red')
  expect((await spawn($, WRITER, { isTeammate: true })).deny === undefined).toBe(false)
  expect((await spawn($, 'general-purpose', { isTeammate: true, name: 'scout' })).deny).toBe(undefined)
  expect(w.spawned.length).toBe(1)
})

test('a spawn of either type is refused while the session has no record that uses agents at that agent\'s phase, and nothing is started', async ($, on) => {
  const w = at(on, 'green')
  expect((await spawn($, WRITER)).deny).toBe(NOT_NOW)
  kept(w).phase = 'red'
  expect((await spawn($, IMPLEMENTER)).deny).toBe(
    'mod-builder: the implementer can\'t be started now: it writes the code of a build or edit this session started with --agents, while that is at Green or Verify. Run /mod-builder to see where this session stands.',
  )
  delete kept(w).agents
  expect((await spawn($, WRITER)).deny).toBe(NOT_NOW)
  delete w.store[`build:${MOD}`]
  delete w.store['session:s1']
  expect((await spawn($, WRITER)).deny).toBe(NOT_NOW)
  expect(w.spawned).toEqual([])
})

test('a spawn the mod can\'t judge is refused for the two types and goes on for any other', async ($, on) => {
  const w = at(on, 'red', { unreadable: ['session:s1'] })
  expect((await spawn($, WRITER)).deny).toBe(
    'mod-builder: the agent was not started: mod-builder could not read whether this session has a build or edit that uses agents. Run with claude --debug to see why.',
  )
  expect(w.spawned).toEqual([])
  expect((await spawn($, 'general-purpose')).agentId).toBe('agent-1')
})

// ------------------------------------------------------------------------------- the guard at Red

test('at Red the main model\'s own write to a test file is refused and told who writes there; the test-writer it starts writes it', async ($, on) => {
  const w = at(on, 'red')
  expect(await write($, PANE)).toBe(redRefusal('tests/pane.test.tsx'))
  expect(await write($, `${MOD}/tests/new.test.ts`, undefined, 'Edit')).toBe(redRefusal('tests/new.test.ts'))
  expect(w.reachedTheTool).toEqual([])
  const { agentId } = await spawn($, WRITER)
  expect(await write($, PANE, agentId)).toBe(undefined)
  expect(await write($, `${MOD}/tests/new.test.ts`, agentId, 'Edit')).toBe(undefined)
  expect(w.reachedTheTool).toEqual([{ tool: 'Write', path: PANE }, { tool: 'Edit', path: `${MOD}/tests/new.test.ts` }])
})

test('a path is judged as the file it names: given from the working folder, or through a folder and back, it is the same test file and the same code', async ($, on) => {
  const w = at(on, 'red')
  expect(await write($, 'turn-counter/tests/pane.test.tsx')).toBe(redRefusal('tests/pane.test.tsx'))
  expect(await write($, `${MOD}/hooks/../tests/pane.test.tsx`)).toBe(redRefusal('tests/pane.test.tsx'))
  expect(await write($, '/work/elsewhere/../turn-counter/tests/pane.test.tsx')).toBe(redRefusal('tests/pane.test.tsx'))
  kept(w).phase = 'green'
  expect(await write($, 'turn-counter/hooks/register.tsx')).toBe(greenRefusal('hooks/register.tsx'))
  expect(await write($, `${MOD}/tests/../lib/count.ts`)).toBe(greenRefusal('lib/count.ts'))
  expect(await write($, './turn-counter/README.md')).toBe(undefined)
  expect(w.reachedTheTool).toEqual([{ tool: 'Write', path: './turn-counter/README.md' }])
})

test('a folder beside the mod whose name begins as the mod\'s is not the mod: a source file there is anyone\'s to write', async ($, on) => {
  const w = at(on, 'green')
  expect(await write($, `${MOD}/lib/count.ts`)).toBe(greenRefusal('lib/count.ts'))
  expect(await write($, `${MOD}-notes/x.ts`)).toBe(undefined)
  expect(await write($, `${MOD}-notes/hooks/register.tsx`)).toBe(undefined)
  expect(w.reachedTheTool.length).toBe(2)
})

test('a planted key for an empty id names nobody: a call with an empty id is the main model\'s', async ($, on) => {
  const w = at(on, 'red', { store: { 'agent:s1:': { role: 'test-writer', modDir: MOD } } })
  expect(await write($, PANE, '')).toBe(redRefusal('tests/pane.test.tsx'))
  expect(w.reachedTheTool).toEqual([])
})

test('at Red an implementer, an agent of another type and an agent another session started are refused as the main model is', async ($, on) => {
  const w = at(on, 'red', { store: { 'agent:s1:impl-1': { role: 'implementer', modDir: MOD }, 'agent:s2:theirs': { role: 'test-writer', modDir: MOD }, 'agent:s1:elsewhere': { role: 'test-writer', modDir: '/work/other' } } })
  expect(await write($, PANE, 'impl-1')).toBe(redRefusal('tests/pane.test.tsx'))
  expect(await write($, PANE, 'theirs')).toBe(redRefusal('tests/pane.test.tsx'))
  expect(await write($, PANE, 'elsewhere')).toBe(redRefusal('tests/pane.test.tsx'))
  const other = await spawn($, 'general-purpose')
  expect(await write($, PANE, other.agentId)).toBe(redRefusal('tests/pane.test.tsx'))
  expect(w.reachedTheTool).toEqual([])
})

test('what Red closes stays closed to the test-writer, with the phase\'s own reason; a path outside the mod is nobody\'s', async ($, on) => {
  const w = at(on, 'red')
  const { agentId } = await spawn($, WRITER)
  const closed = 'mod-builder: hooks/register.tsx can\'t be written in phase 5 (Red), which may write tests/ only. Phase 6 (Green) opens when a new test fails by assertion and the mod, its tests included, typechecks: ask for it by calling the mod_builder_gate tool.'
  expect(await write($, CODE, agentId)).toBe(closed)
  expect(await write($, CODE)).toBe(closed)
  expect(await write($, PANE)).toBe(redRefusal('tests/pane.test.tsx'))
  expect(await write($, '/work/notes.md')).toBe(undefined)
  expect(w.reachedTheTool).toEqual([{ tool: 'Write', path: '/work/notes.md' }])
})

test('while the test reader reads, the test files are closed to the test-writer too', async ($, on) => {
  const w = at(on, 'red')
  const { agentId } = await spawn($, WRITER)
  expect(await write($, PANE)).toBe(redRefusal('tests/pane.test.tsx'))
  kept(w).reader = { agentId: 'reader-9', startedAt: 1000, hashes: {}, evidence: '', change: {} }
  expect(await write($, PANE, agentId)).toBe('mod-builder: tests/pane.test.tsx can\'t be written: the test reader is reading these tests; wait for its report.')
})

// ------------------------------------------------------------------------------ the guard at Green

test('at Green the main model\'s own write under hooks/ or to a source file is refused and told who writes there; the implementer it starts writes both', async ($, on) => {
  const w = at(on, 'green')
  expect(await write($, CODE)).toBe(greenRefusal('hooks/register.tsx'))
  expect(await write($, `${MOD}/hooks/hooks.json`)).toBe(greenRefusal('hooks/hooks.json'))
  // A folder a file system that ignores case would take for hooks/ is closed as hooks/ is, whatever the file.
  expect(await write($, `${MOD}/Hooks/hooks.json`)).toBe(greenRefusal('Hooks/hooks.json'))
  expect(await write($, `${MOD}/lib/count.ts`)).toBe(greenRefusal('lib/count.ts'))
  expect(await write($, `${MOD}/util.mjs`, undefined, 'Edit')).toBe(greenRefusal('util.mjs'))
  expect(w.reachedTheTool).toEqual([])
  const { agentId } = await spawn($, IMPLEMENTER)
  expect(await write($, CODE, agentId)).toBe(undefined)
  expect(await write($, `${MOD}/lib/count.ts`, agentId)).toBe(undefined)
  expect(w.reachedTheTool).toEqual([{ tool: 'Write', path: CODE }, { tool: 'Write', path: `${MOD}/lib/count.ts` }])
})

test('at Green what is neither under hooks/ nor source is still the main model\'s to write: the manifest, a README, a declaration under types/', async ($, on) => {
  const w = at(on, 'green')
  expect(await write($, CODE)).toBe(greenRefusal('hooks/register.tsx'))
  for (const path of ['.claude-plugin/plugin.json', 'README.md', 'types/index.d.ts']) expect(await write($, `${MOD}/${path}`)).toBe(undefined)
  expect(w.reachedTheTool.length).toBe(3)
})

test('at Green a test-writer kept from Red may not write the code, and the implementer may not write a test', async ($, on) => {
  const w = at(on, 'green', { store: { 'agent:s1:writer-1': { role: 'test-writer', modDir: MOD } } })
  expect(await write($, CODE, 'writer-1')).toBe(greenRefusal('hooks/register.tsx'))
  const { agentId } = await spawn($, IMPLEMENTER)
  expect(await write($, PANE, agentId)).toBe(
    'mod-builder: tests/pane.test.tsx can\'t be written in phase 6 (Green), which may write anything but tests/ and SPEC.md. Phase 7 (Verify) opens when every test passes: ask for it by calling the mod_builder_gate tool.',
  )
  expect(w.reachedTheTool).toEqual([])
})

test('a refused write of such a build is counted for the pane as any refused write is', async ($, on) => {
  const w = at(on, 'green')
  expect(await write($, CODE)).toBe(greenRefusal('hooks/register.tsx'))
  expect((w.store[`refusals:${MOD}`] as { counts: Record<string, number> }).counts).toEqual({ green: 1 })
})

// ----------------------------------------------------------------------------- the guard at Verify

test('at Verify a source file is still the implementer\'s: the main model is refused, an implementer started there writes it, and what is no source is the main model\'s', async ($, on) => {
  const w = at(on, 'verify')
  expect(await write($, `${MOD}/lib/count.ts`)).toBe(verifyRefusal('lib/count.ts'))
  expect(await write($, `${MOD}/util.mjs`)).toBe(verifyRefusal('util.mjs'))
  expect(await write($, SPEC)).toBe(undefined)
  expect(await write($, `${MOD}/README.md`)).toBe(undefined)
  const { agentId } = await spawn($, IMPLEMENTER)
  expect(w.store[`agent:s1:${String(agentId)}`]).toEqual({ role: 'implementer', modDir: MOD })
  expect(await write($, `${MOD}/lib/count.ts`, agentId)).toBe(undefined)
  // hooks/ and tests/ stay closed to all, the implementer included, with the phase's own reason.
  expect(String(await write($, CODE, agentId)).startsWith('mod-builder: hooks/register.tsx can\'t be written in phase 7 (Verify)')).toBe(true)
  expect(String(await write($, PANE, agentId)).startsWith('mod-builder: tests/pane.test.tsx can\'t be written in phase 7 (Verify)')).toBe(true)
  expect(w.reachedTheTool.map((one) => one.path)).toEqual([SPEC, `${MOD}/README.md`, `${MOD}/lib/count.ts`])
})

test('Done keeps Verify\'s rule and offers nothing: a source file is refused, and said to be closed for good', async ($, on) => {
  const w = at(on, 'done')
  expect(await offered($, IMPLEMENTER)).toBe(false)
  expect(await write($, `${MOD}/lib/count.ts`)).toBe('mod-builder: lib/count.ts can\'t be written: this build used mod-builder\'s agents and is Done. A source file was the implementer\'s to write, and none can be started now.')
  expect(await write($, `${MOD}/README.md`)).toBe(undefined)
  expect(w.reachedTheTool.length).toBe(1)
})

// ---------------------------------------------------------------------- a build that uses no agents

test('a record stored by 0.2.0 uses no agents: the main model writes its tests at Red and its code at Green, and neither agent is offered or started', async ($, on) => {
  const w = plainAt(on, 'red')
  expect(await offered($, WRITER)).toBe(false)
  expect((await spawn($, WRITER)).deny).toBe(NOT_NOW)
  expect(await write($, PANE)).toBe(undefined)
  kept(w).phase = 'green'
  expect(await offered($, IMPLEMENTER)).toBe(false)
  expect(await write($, CODE)).toBe(undefined)
  expect(await write($, `${MOD}/lib/count.ts`)).toBe(undefined)
  // A subagent of any type the model starts writes there as before.
  const helper = await spawn($, 'general-purpose')
  expect(await write($, CODE, helper.agentId)).toBe(undefined)
  expect(w.reachedTheTool.length).toBe(4)
})

// ----------------------------------------------------------------------- what a started agent may call

test('a started test-writer may call its five tools and the hand-back; a shell, another write tool and the gate are refused, and the gate does not run', async ($, on) => {
  const w = at(on, 'red')
  const { agentId } = await spawn($, WRITER)
  expect(agentId).toBe('agent-1')
  for (const tool of ['Read', 'Grep', 'Glob', 'SubagentHandback']) expect((await $.tool.call({ tool, agentId } as never)).deny).toBe(undefined)
  for (const tool of ['Bash', 'NotebookEdit', 'MultiEdit', 'Agent']) {
    expect((await $.tool.call({ tool, agentId, command: 'ls', file_path: PANE, notebook_path: PANE } as never)).deny).toBe(`mod-builder: the test-writer may call Read, Grep, Glob, Write and Edit only, not ${tool}`)
  }
  expect((await $.tool.call({ tool: GATE, agentId } as never)).deny).toBe(`mod-builder: the test-writer may call Read, Grep, Glob, Write and Edit only, not ${GATE}`)
  expect(kept(w).phase).toBe('red')
  expect(w.ran).toEqual([])
  expect(w.logged.filter((line) => line.startsWith('mod-builder: refused the test-writer\'s call to ')).length).toBe(5)
})

test('a started agent is known by the session it was started in, whatever that session\'s id', async ($, on) => {
  const w = world(on, { sessionId: 'another-session', store: { 'session:another-session': { modDir: MOD, agents: true }, [`build:${MOD}`]: record('red', { agents: true, sessionId: 'another-session' }) } })
  const { agentId } = await spawn($, WRITER)
  expect(w.store[`agent:another-session:${String(agentId)}`]).toEqual({ role: 'test-writer', modDir: MOD })
  expect((await $.tool.call({ tool: 'Bash', command: 'ls', agentId } as never)).deny).toBe('mod-builder: the test-writer may call Read, Grep, Glob, Write and Edit only, not Bash')
  expect(await write($, PANE, agentId)).toBe(undefined)
})

test('a started implementer is held to the same calls; an agent of another type calls what it likes', async ($, on) => {
  at(on, 'green')
  const { agentId } = await spawn($, IMPLEMENTER)
  expect((await $.tool.call({ tool: 'Bash', command: 'ls', agentId } as never)).deny).toBe('mod-builder: the implementer may call Read, Grep, Glob, Write and Edit only, not Bash')
  expect((await $.tool.call({ tool: 'Read', file_path: CODE, agentId } as never)).deny).toBe(undefined)
  const other = await spawn($, 'general-purpose')
  expect((await $.tool.call({ tool: 'Bash', command: 'ls', agentId: other.agentId } as never)).deny).toBe(undefined)
})

// ------------------------------------------------------------------------------- the gate's answers

test('the gate\'s answer that opens Red names the test-writer, and the one that opens Green the implementer', async ($, on) => {
  const w = fresh(on)
  await $.skill.prompt(build('--agents a pane that counts the turns'))
  await gate($, { mod_dir: 'turn-counter' })
  const answers = (await walk($, w, 'green')).map(first)
  const intoRed = answers.find((answer) => answer.includes('The build is now at phase 5 (Red).')) ?? ''
  const intoGreen = answers.find((answer) => answer.includes('The build is now at phase 6 (Green).')) ?? ''
  expect(intoRed.endsWith(`The build is now at phase 5 (Red).${RED_NOTE}`)).toBe(true)
  expect(intoGreen.endsWith(`The build is now at phase 6 (Green).${GREEN_NOTE}`)).toBe(true)
  // No other answer of the walk names an agent.
  expect(answers.filter((answer) => answer.includes('mod-builder\'s agents')).length).toBe(2)
  expect(kept(w).agents).toBe(true)
})

test('the gate\'s answer that opens Verify says a source file is still the implementer\'s, and Done removes the ids kept for the session\'s agents', async ($, on) => {
  const w = fresh(on, { store: { 'agent:s2:theirs': { role: 'implementer', modDir: MOD } } })
  await $.skill.prompt(build('--agents a pane that counts the turns'))
  await gate($, { mod_dir: 'turn-counter' })
  await walk($, w, 'green')
  await spawn($, IMPLEMENTER)
  w.files[CODE] = 'the code written at Green'
  w.runs.test = PASSES
  const intoVerify = first(await gate($))
  expect(kept(w).phase).toBe('verify')
  expect(intoVerify.endsWith(`The build is now at phase 7 (Verify).${VERIFY_NOTE}`)).toBe(true)
  await spawn($, IMPLEMENTER)
  expect(agentKeys(w).length).toBe(3)
  w.files[SPEC] = `${w.files[SPEC]}${BUILT}`
  const intoDone = first(await gate($))
  expect(kept(w).phase).toBe('done')
  expect(intoDone.includes('mod-builder\'s agents')).toBe(false)
  expect(agentKeys(w)).toEqual(['agent:s2:theirs'])
})

test('a build this session left open goes on as it was: its record keeps the word, the entry takes it from the record, and the answer says so', async ($, on) => {
  const w = world(on, { store: { 'session:s1': { modDir: null }, [`build:${MOD}`]: record('red', { agents: true }) } })
  expect(await gate($, { mod_dir: 'turn-counter' })).toBe(
    `mod-builder: the build's mod folder is ${MOD}. It is at phase 5 (Red). It uses mod-builder's agents (--agents): at Red the tests are the test-writer's to write, at Green the code is the implementer's. Call mod_builder_gate again to ask for the next phase.`,
  )
  expect(kept(w).agents).toBe(true)
  expect(w.store['session:s1']).toEqual({ modDir: MOD, agents: true })
  expect(await write($, PANE)).toBe(redRefusal('tests/pane.test.tsx'))
})

test('a Red the work came back to is the test-writer\'s again: the answer says so, the main model is refused and a test-writer writes', async ($, on) => {
  const w = fresh(on)
  await $.skill.prompt(build('--agents a pane that counts the turns'))
  await gate($, { mod_dir: 'turn-counter' })
  await walk($, w, 'green')
  w.files[CODE] = 'the code written at Green'
  w.runs.test = FAILS
  await gate($)
  await gate($)
  w.answer = 'Go back to Red'
  const back = await gate($, { back_to_red: true })
  expect(back).toBe(
    `mod-builder: back at phase 5 (Red): the person answered "Go back to Red" (return 1). Test files are open again and everything else is closed; nothing in the mod was changed. Change the tests that are wrong, then call the gate.${RED_NOTE}`,
  )
  expect(await write($, COUNTS)).toBe(redRefusal('tests/counts.test.tsx'))
  const { agentId } = await spawn($, WRITER)
  expect(await write($, COUNTS, agentId)).toBe(undefined)
})

// -------------------------------------------------------------------------------------------- the stop

test('/mod-builder stop removes the ids kept for this session\'s agents and leaves another session\'s', async ($, on) => {
  const w = at(on, 'red', { store: { 'agent:s2:theirs': { role: 'test-writer', modDir: MOD } } })
  await spawn($, WRITER)
  await spawn($, WRITER)
  expect(agentKeys(w)).toEqual(['agent:s1:agent-1', 'agent:s1:agent-2', 'agent:s2:theirs'])
  await $.command.run({ command: 'mod-builder', args: 'stop' } as never)
  expect(agentKeys(w)).toEqual(['agent:s2:theirs'])
  expect(kept(w).stopped).toBe(true)
})

test('a stop that can\'t list the store\'s keys still stops: the record is stopped, the session unbound, and the answer says so', async ($, on) => {
  const w = at(on, 'red', { unreadable: ['the keys'] })
  await spawn($, WRITER)
  const answer = (await $.command.run({ command: 'mod-builder', args: 'stop' } as never)).text
  expect(answer).toBe(`mod-builder: the build of ${MOD} is stopped at phase 5 (Red). Other plugins' folders can be written again. The folder is left as it is.`)
  expect(kept(w).stopped).toBe(true)
  expect(w.store['session:s1']).toBe(null)
  // The id it could not remove names a mod no open record of this session holds.
  expect(agentKeys(w)).toEqual(['agent:s1:agent-1'])
  expect((await spawn($, WRITER)).deny).toBe(NOT_NOW)
})

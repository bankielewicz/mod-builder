// The build opened on skill.prompt and the tool.call guard (SPEC.md 3.3), through the hooks module itself.
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { GATE, MOD, ROOT, world } from './world'

const BUILD = { skill: 'build', text: 'the eight phases', source: 'plugin', pluginName: 'mod-builder', frontmatter: {} } as const
const NOTEBOOK = { tool: 'NotebookEdit', new_source: 'x' } as const

const start = ($: Engine) => $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
const write = ($: Engine, file_path: string, agentId?: string) => $.tool.call({ tool: 'Write', file_path, content: 'x', ...(agentId === undefined ? {} : { agentId }) })
const record = (phase: string, sessionId = 's1') => ({
  modDir: MOD, sessionId, phase, specApprovedAt: null, spec: null, testsAtScaffold: null, namesAtScaffold: null, testsAtRed: null, testHashes: null, evidence: {},
})
const bound = (phase: string) => ({ 'session:s1': { modDir: MOD }, [`build:${MOD}`]: record(phase) })

test('the gate tool is registered at session start, in the tool list from the first turn', async ($, on) => {
  const w = world(on)
  await start($)
  expect(w.registered.map((tool) => [tool.name, tool.isDeferred])).toEqual([['mod_builder_gate', false]])
  const schema = (w.registered[0] as unknown as { inputSchema: { properties: { mod_dir: { type: string } }; required?: string[] } }).inputSchema
  expect(schema.properties.mod_dir.type).toBe('string')
  expect(schema.required ?? []).toEqual([])
})

test('the build skill as the engine loads it, from this plugin\'s own folder, opens a build; from a folder beside it, none', async ($, on) => {
  const w = world(on)
  await $.skill.prompt({ ...BUILD, path: `${ROOT}-2/skills/build/SKILL.md` })
  await $.skill.prompt({ ...BUILD, path: '/skills/build/SKILL.md' })
  expect(w.store).toEqual({})
  await $.skill.prompt({ ...BUILD, skill: 'mod-builder:build', path: `${ROOT}/skills/build/SKILL.md` })
  expect(w.store).toEqual({ 'session:s1': { modDir: null } })
})

test('expanding this plugin\'s build skill opens a pending build for the session, and hands the skill\'s text on unchanged', async ($, on) => {
  const w = world(on)
  await start($)
  const prompt = await $.skill.prompt(BUILD)
  expect(prompt.text).toBe('the eight phases')
  expect(w.store).toEqual({ 'session:s1': { modDir: null } })
})

test('a plugin skill listed under the plugin\'s name opens a build too', async ($, on) => {
  const w = world(on)
  await $.skill.prompt({ ...BUILD, skill: 'mod-builder:build' })
  expect(w.store).toEqual({ 'session:s1': { modDir: null } })
})

test('another skill, or a build skill that is not this plugin\'s, opens nothing', async ($, on) => {
  const w = world(on)
  await $.skill.prompt({ ...BUILD, skill: 'design' })
  await $.skill.prompt({ ...BUILD, pluginName: 'other' })
  await $.skill.prompt({ skill: 'build', text: 'x', source: 'projectSettings', frontmatter: {} })
  expect(w.store).toEqual({})
})

test('with no build in the session every write passes, and the store is not written', async ($, on) => {
  const w = world(on, { files: { [`${MOD}/.claude-plugin/plugin.json`]: '{}' } })
  await start($)
  expect((await write($, `${MOD}/hooks/register.tsx`)).deny).toBeUndefined()
  expect(w.reachedTheTool).toEqual([{ tool: 'Write', path: `${MOD}/hooks/register.tsx` }])
  expect(w.store).toEqual({})
})

test('while the build is pending, a write into a folder that holds a plugin manifest is refused and never reaches the tool', async ($, on) => {
  const w = world(on, { files: { [`${MOD}/.claude-plugin/plugin.json`]: '{}' } })
  await $.skill.prompt(BUILD)
  const answer = await write($, `${MOD}/hooks/register.tsx`)
  expect(answer.deny).toBe(
    `mod-builder: ${MOD}/hooks/register.tsx can't be written yet: it is in a plugin's folder (${MOD}), and this build has not named its mod's folder. Call the mod_builder_gate tool with mod_dir first.`,
  )
  expect(w.reachedTheTool).toEqual([])
})

test('while the build is pending, the write that would make a folder a plugin is refused, and a write elsewhere passes', async ($, on) => {
  const w = world(on)
  await $.skill.prompt(BUILD)
  expect((await write($, 'new-mod/.claude-plugin/plugin.json')).deny).toMatch(/it is in a plugin's folder \(\/work\/new-mod\)/)
  expect((await write($, '/work/notes.md')).deny).toBeUndefined()
  expect(w.reachedTheTool).toEqual([{ tool: 'Write', path: '/work/notes.md' }])
})

test('a model that never calls the gate can write nothing into a mod: Edit, Write and NotebookEdit are all refused', async ($, on) => {
  const w = world(on, { files: { [`${MOD}/.claude-plugin/plugin.json`]: '{}' } })
  await $.skill.prompt(BUILD)
  const edit = await $.tool.call({ tool: 'Edit', file_path: `${MOD}/SPEC.md`, old_string: 'a', new_string: 'b' })
  const notebook = await $.tool.call({ tool: 'NotebookEdit', notebook_path: `${MOD}/notes.ipynb`, new_source: 'x' })
  expect([edit.deny, notebook.deny, (await write($, `${MOD}/tests/a.test.ts`)).deny].every((deny) => typeof deny === 'string')).toBe(true)
  expect(w.reachedTheTool).toEqual([])
})

test('at Spec only SPEC.md may be written under the mod; hooks/ is refused with the phase and how to move on', async ($, on) => {
  const w = world(on, { store: bound('spec') })
  expect((await write($, `${MOD}/SPEC.md`)).deny).toBeUndefined()
  expect((await write($, `${MOD}/hooks/register.tsx`)).deny).toBe(
    "mod-builder: hooks/register.tsx can't be written in phase 3 (Spec), which may write SPEC.md only. Phase 4 (Scaffold) opens when the person approves the spec: ask for it by calling the mod_builder_gate tool.",
  )
  expect(w.reachedTheTool).toEqual([{ tool: 'Write', path: `${MOD}/SPEC.md` }])
})

test('the same write under hooks/ that Spec refuses passes at Scaffold', async ($, on) => {
  const w = world(on, { store: bound('spec') })
  expect(typeof (await write($, `${MOD}/hooks/register.tsx`)).deny).toBe('string')
  w.store[`build:${MOD}`] = record('scaffold')
  expect((await write($, `${MOD}/hooks/register.tsx`)).deny).toBeUndefined()
})

test('Red writes tests/ only, Green everything but tests/ and SPEC.md, Verify neither tests/ nor hooks/', async ($, on) => {
  const w = world(on, { store: bound('red') })
  const may = async (phase: string, path: string) => {
    w.store[`build:${MOD}`] = record(phase)
    return (await write($, `${MOD}/${path}`)).deny === undefined
  }
  expect([await may('red', 'tests/a.test.ts'), await may('red', 'hooks/register.tsx'), await may('red', 'SPEC.md')]).toEqual([true, false, false])
  expect([await may('green', 'tests/a.test.ts'), await may('green', 'hooks/register.tsx'), await may('green', 'SPEC.md')]).toEqual([false, true, false])
  expect([await may('verify', 'tests/a.test.ts'), await may('verify', 'hooks/register.tsx'), await may('verify', 'SPEC.md')]).toEqual([false, false, true])
  expect([await may('red', 'tests/deep/a.test.ts'), await may('green', 'tests/deep/a.test.ts'), await may('scaffold', 'SPEC.md')]).toEqual([true, false, true])
})

test('every refusal names the phase, what it may write, and how the next one opens', async ($, on) => {
  const w = world(on, { store: bound('red') })
  const refusal = async (phase: string, path: string) => {
    w.store[`build:${MOD}`] = record(phase)
    return (await write($, `${MOD}/${path}`)).deny
  }
  expect(await refusal('knowledge', 'SPEC.md')).toMatch(/in phase 1 \(Knowledge\), which may write nothing in the mod\. Phase 2 \(Describe\) opens when .* calling the mod_builder_gate tool\.$/)
  expect(await refusal('describe', 'SPEC.md')).toMatch(/in phase 2 \(Describe\), which may write nothing in the mod\. Phase 3 \(Spec\) opens when /)
  expect(await refusal('red', 'hooks/x.ts')).toMatch(/^mod-builder: hooks\/x\.ts can't be written in phase 5 \(Red\), which may write tests\/ only\. Phase 6 \(Green\) opens when a new test fails by assertion and the mod, its tests included, typechecks: /)
  expect(await refusal('green', 'tests/a.test.ts')).toMatch(/in phase 6 \(Green\), which may write anything but tests\/ and SPEC\.md\. Phase 7 \(Verify\) opens when every test passes: /)
  expect(await refusal('verify', 'hooks/x.ts')).toMatch(/in phase 7 \(Verify\), which may write anything but tests\/ and hooks\/\. Phase 8 \(Done\) opens when /)
  expect(await refusal('done', 'tests/a.test.ts')).toMatch(/in phase 8 \(Done\), which may write anything but tests\/ and hooks\/\.$/)
  expect(await refusal('shipping', 'SPEC.md')).toMatch(/missing or is not this session's/)
  expect(w.reachedTheTool).toEqual([])
})

test('a tool this build does not have but the guard names, MultiEdit, is judged like the others', async ($, on) => {
  const w = world(on, { store: bound('red') })
  const multi = (file_path: string) => $.tool.call({ tool: 'MultiEdit', file_path, edits: [] } as never)
  expect(typeof (await multi(`${MOD}/hooks/x.ts`)).deny).toBe('string')
  expect((await multi(`${MOD}/tests/a.test.ts`)).deny).toBeUndefined()
  expect(w.reachedTheTool).toEqual([{ tool: 'MultiEdit', path: `${MOD}/tests/a.test.ts` }])
})

test('a subagent\'s write is judged as the main thread\'s is', async ($, on) => {
  const w = world(on, { store: bound('red') })
  expect(typeof (await write($, `${MOD}/hooks/register.tsx`, 'a3d0d8ba5b59fdb67')).deny).toBe('string')
  expect((await write($, `${MOD}/tests/a.test.ts`, 'a3d0d8ba5b59fdb67')).deny).toBeUndefined()
  expect(w.reachedTheTool).toEqual([{ tool: 'Write', path: `${MOD}/tests/a.test.ts` }])
})

test('a path outside the mod passes in a build, and so does a relative path that only looks inside', async ($, on) => {
  const w = world(on, { store: bound('red') })
  expect((await write($, '/work/notes.md')).deny).toBeUndefined()
  expect((await write($, 'turn-counter/../other/hooks/x.ts')).deny).toBeUndefined()
  expect(typeof (await write($, 'turn-counter/hooks/x.ts')).deny).toBe('string')
  expect(w.reachedTheTool.length).toBe(2)
})

test('another session\'s write passes untouched while this folder is being built', async ($, on) => {
  const w = world(on, { store: bound('spec'), sessionId: 's2' })
  expect((await write($, `${MOD}/hooks/register.tsx`)).deny).toBeUndefined()
  expect(w.reachedTheTool.length).toBe(1)
})

test('a build whose record is gone or belongs to another session allows nothing under its folder', async ($, on) => {
  const w = world(on, { store: { 'session:s1': { modDir: MOD } } })
  expect((await write($, `${MOD}/SPEC.md`)).deny).toMatch(/the build's record for \/work\/turn-counter is missing or is not this session's/)
  w.store[`build:${MOD}`] = record('scaffold', 's2')
  expect((await write($, `${MOD}/SPEC.md`)).deny).toMatch(/missing or is not this session's/)
  expect((await write($, '/work/notes.md')).deny).toBeUndefined()
})

test('when the guard can\'t read whether the session has a build, the write passes and a line says the guard judged nothing', async ($, on) => {
  const w = world(on, { store: bound('spec'), sessionId: null })
  expect((await write($, `${MOD}/hooks/register.tsx`)).deny).toBeUndefined()
  w.sessionId = 's1'
  w.unreadable = ['session:s1']
  expect((await write($, `${MOD}/hooks/register.tsx`)).deny).toBeUndefined()
  expect(w.reachedTheTool.length).toBe(2)
  expect(w.logged.length).toBe(2)
  expect(w.logged[0]).toMatch(/^mod-builder: the phase guard could not read whether this session has a build \(.*\), so it judged nothing\.$/)
})

test('once a build is known to be open, a guard that fails refuses the write; any other tool goes on', async ($, on) => {
  const w = world(on, { store: bound('scaffold'), unreadable: [`build:${MOD}`] })
  expect((await write($, `${MOD}/hooks/register.tsx`)).deny).toMatch(/^mod-builder: a build is open in this session and the phase guard failed before it could judge this write/)
  expect((await $.tool.call({ tool: 'Bash', command: 'ls' })).deny).toBeUndefined()
  expect(w.reachedTheTool).toEqual([{ tool: 'Bash', path: '' }])
  expect(w.logged).toEqual([])
})

test('a notebook edit is judged by the notebook it writes, not by a file_path it also carries', async ($, on) => {
  const w = world(on, { store: bound('spec') })
  const inside = await $.tool.call({ ...NOTEBOOK, notebook_path: `${MOD}/notes.ipynb`, file_path: '/work/notes.md' } as never)
  const outside = await $.tool.call({ ...NOTEBOOK, notebook_path: '/work/notes.ipynb', file_path: `${MOD}/hooks/x.ts` } as never)
  expect(typeof inside.deny).toBe('string')
  expect(outside.deny).toBeUndefined()
  expect(w.reachedTheTool).toEqual([{ tool: 'NotebookEdit', path: `${MOD}/hooks/x.ts` }])
})

test('the build skill of another plugin of the same name, loaded from another folder, opens nothing', async ($, on) => {
  const w = world(on)
  await $.skill.prompt({ ...BUILD, path: '/home/u/.claude/plugins/cache/claudemod/mod-builder/0.2.34/skills/build/SKILL.md' })
  expect(w.store).toEqual({})
})

test('while the build is pending, a marketplace\'s list beside no manifest may be written', async ($, on) => {
  const w = world(on)
  await $.skill.prompt(BUILD)
  expect((await write($, '/work/.claude-plugin/marketplace.json')).deny).toBeUndefined()
  expect(w.reachedTheTool.length).toBe(1)
})

test('tools the guard does not look at pass in every phase, the gate tool among them', async ($, on) => {
  const w = world(on, { store: bound('spec') })
  expect((await $.tool.call({ tool: 'Bash', command: `echo x > ${MOD}/hooks/register.tsx` })).deny).toBeUndefined()
  expect((await $.tool.call({ tool: 'Read', file_path: `${MOD}/hooks/register.tsx` })).deny).toBeUndefined()
  expect(w.reachedTheTool.map((call) => call.tool)).toEqual(['Bash', 'Read'])
  w.unreadable = [`build:${MOD}`]
  const gate = await $.tool.call({ tool: GATE } as never)
  expect(gate.deny).toBeUndefined()
  expect(String(gate.result)).toMatch(/^mod-builder: /)
})

test('expanding the skill again leaves a build under way as it is, and opens a new one after Done', async ($, on) => {
  const w = world(on, { store: bound('green') })
  await $.skill.prompt(BUILD)
  expect(w.store).toEqual(bound('green'))
  w.store[`build:${MOD}`] = record('done')
  await $.skill.prompt(BUILD)
  expect(w.store['session:s1']).toEqual({ modDir: null })
})

test('naming a decoy folder through the gate opens nothing: the real mod stays closed until that build is Done', async ($, on) => {
  const w = world(on, { files: { [`${MOD}/.claude-plugin/plugin.json`]: '{}' } })
  await $.skill.prompt(BUILD)
  await $.tool.call({ tool: GATE, mod_dir: '/work/decoy' } as never)
  expect(w.store['session:s1']).toEqual({ modDir: '/work/decoy' })
  expect((await write($, `${MOD}/hooks/register.tsx`)).deny).toBe(
    `mod-builder: ${MOD}/hooks/register.tsx can't be written: it is in another plugin's folder (${MOD}), and this session is building /work/decoy. Until that build is Done, its mod is the only plugin this session may write.`,
  )
  expect(typeof (await write($, `${MOD}/tests/a.test.ts`)).deny).toBe('string')
  expect(typeof (await write($, 'second/.claude-plugin/plugin.json')).deny).toBe('string')
  expect((await write($, '/work/notes.md')).deny).toBeUndefined()
  expect(w.reachedTheTool).toEqual([{ tool: 'Write', path: '/work/notes.md' }])
})

test('another plugin\'s folder is closed in every phase of a named build, and open again once it is Done', async ($, on) => {
  const other = '/work/other-mod'
  const w = world(on, { store: bound('green'), files: { [`${other}/.claude-plugin/plugin.json`]: '{}', [`${MOD}/.claude-plugin/plugin.json`]: '{}' } })
  for (const phase of ['knowledge', 'spec', 'scaffold', 'red', 'green', 'verify']) {
    w.store[`build:${MOD}`] = record(phase)
    expect((await write($, `${other}/hooks/x.ts`)).deny).toMatch(/it is in another plugin's folder \(\/work\/other-mod\), and this session is building \/work\/turn-counter/)
  }
  w.store[`build:${MOD}`] = record('scaffold')
  expect((await write($, `${MOD}/hooks/x.ts`)).deny).toBeUndefined()
  w.store[`build:${MOD}`] = record('done')
  expect((await write($, `${other}/hooks/x.ts`)).deny).toBeUndefined()
  expect(w.reachedTheTool.map((call) => call.path)).toEqual([`${MOD}/hooks/x.ts`, `${other}/hooks/x.ts`])
})

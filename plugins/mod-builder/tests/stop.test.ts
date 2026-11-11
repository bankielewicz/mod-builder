// `/mod-builder stop` (SPEC.md 8.5, 8.17), through the hooks module itself: it ends this session's open build or
// edit at any phase, unbinds the folder, and for an edit asks whether the mod is kept as it is or put back; putting
// it back is one script that deletes nothing.
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { GATE, HOME, MOD, NAME, ROOT, passing, world } from './world'
import type { World } from './world'

const BUILD = { skill: 'build', text: 'the eight phases', source: 'plugin', pluginName: 'mod-builder', frontmatter: {} } as const
const EDIT = { skill: 'edit', text: 'the phases of an edit', source: 'plugin', pluginName: 'mod-builder', frontmatter: {} } as const
const LATEST = `${HOME}/.claude/mod-builder-data/v2/docs/latest`
const RESTORE = `${HOME}/.claude/mod-builder-data/v2/restore/s1/1970-01-01T000001Z`
const STOPPED = `${MOD}.stopped-1970-01-01T000001Z`
const KEEP = 'Keep the mod as it is now'
const PUT_BACK = 'Put it back as it was before this edit'
const OTHER = '/work/other-plugin'

const gate = async ($: Engine, more: Record<string, unknown> = {}) => String((await $.tool.call({ tool: GATE, ...more } as never)).result)
const said = async ($: Engine, args: string) => (await $.command.run({ command: 'mod-builder', args } as never)).text
const write = async ($: Engine, path: string) => (await $.tool.call({ tool: 'Write', file_path: path, content: 'x' } as never)) as { deny?: string }
const kept = (w: World) => w.store[`build:${MOD}`] as Record<string, unknown> & { phase: string }
const putBacks = (w: World) => w.ran.filter((argv) => argv.some((one) => one.endsWith('/put-back.sh')))

const mod = (on: Parameters<typeof world>[0], more: Partial<World> = {}) =>
  world(on, {
    ...more,
    runs: { validate: { exitCode: 0, stdout: 'Validation passed' }, test: { exitCode: 0, stdout: passing(2) }, tsc: { exitCode: 0, stdout: '' }, '--plugin-dir': { exitCode: 0, stdout: '' }, restore: { exitCode: 0, stdout: '' }, putback: { exitCode: 0, stdout: `put back: ${MOD}\nkept: ${STOPPED}\nmoved: .git, node_modules\n` }, ...more.runs },
    files: {
      [LATEST]: '2026-11-10T151216Z\n',
      [`${MOD}/SPEC.md`]: '# turn-counter\n',
      [`${MOD}/.claude-plugin/plugin.json`]: `{ "name": "${NAME}", "version": "0.1.0" }`,
      [`${MOD}/hooks/hooks.json`]: '{ "modules": ["./register.tsx"] }',
      [`${MOD}/hooks/register.tsx`]: 'the code',
      [`${MOD}/tests/pane.test.tsx`]: 'the first test',
      [`${OTHER}/.claude-plugin/plugin.json`]: '{ "name": "other" }',
      'the load log': `[DEBUG] hooks module ${NAME}@inline loaded (worker, environment 1, tier user); events: session.start\n`,
      ...more.files,
    },
  })
const editing = async ($: Engine) => {
  await $.skill.prompt(EDIT)
  await gate($, { mod_dir: 'turn-counter' })
  await gate($)
}

test('with nothing open, stop says so and changes nothing', async ($, on) => {
  const w = mod(on)
  expect(await said($, 'stop')).toBe('mod-builder: no build or edit is open in this session, so there is nothing to stop.')
  expect(w.store).toEqual({})
  expect(w.asked).toEqual([])
})

test('stopping a build marks its record stopped, unbinds the session, asks nothing and moves no folder', async ($, on) => {
  const w = mod(on)
  await $.skill.prompt(BUILD)
  await gate($, { mod_dir: 'turn-counter' })
  await gate($)
  expect(await said($, 'stop')).toBe(`mod-builder: the build of ${MOD} is stopped at phase 2 (Describe). Other plugins' folders can be written again. The folder is left as it is.`)
  expect(kept(w).stopped).toBe(true)
  expect(kept(w).phase).toBe('describe')
  expect(w.store['session:s1']).toBe(null)
  expect(w.asked).toEqual([])
  expect(putBacks(w)).toEqual([])
})

test('once stopped, the session writes other plugins\' folders and the mod\'s own again, and the gate has nothing to move', async ($, on) => {
  const w = mod(on)
  await $.skill.prompt(BUILD)
  await gate($, { mod_dir: 'turn-counter' })
  expect((await write($, `${OTHER}/hooks/a.ts`)).deny).toMatch(/another plugin's folder/)
  expect((await write($, `${MOD}/hooks/register.tsx`)).deny).toMatch(/phase 1 \(Knowledge\)/)
  await said($, 'stop')
  expect((await write($, `${OTHER}/hooks/a.ts`)).deny).toBe(undefined)
  expect((await write($, `${MOD}/hooks/register.tsx`)).deny).toBe(undefined)
  expect(await gate($)).toMatch(/^mod-builder: no build is open in this session\./)
  expect(kept(w).phase).toBe('knowledge')
})

test('a pending build or edit that named no folder is stopped with nothing changed', async ($, on) => {
  const w = mod(on)
  await $.skill.prompt(EDIT)
  expect(await said($, 'stop')).toBe("mod-builder: stopped. This session's edit had named no folder yet, and nothing was changed.")
  expect(w.store['session:s1']).toBe(null)
  expect((await write($, `${MOD}/hooks/register.tsx`)).deny).toBe(undefined)
})

test('stopping an edit asks what becomes of the mod, to keep it first; keeping it runs nothing', async ($, on) => {
  const w = mod(on)
  await editing($)
  w.answer = KEEP
  expect(await said($, 'stop')).toBe(`mod-builder: the edit of ${MOD} is stopped at phase 2 (Describe). Other plugins' folders can be written again. The mod is kept as it is now. Its restore point stays at ${RESTORE}.`)
  expect(w.asked.at(-1)).toEqual({ question: `The edit of ${MOD} is stopped. What becomes of the mod?`, options: [KEEP, PUT_BACK] })
  expect(putBacks(w)).toEqual([])
  expect(kept(w).stopped).toBe(true)
  expect(w.store['session:s1']).toBe(null)
})

test('putting it back runs the script on the mod, its restore point and a stopped folder beside it, and the answer names both and what moved', async ($, on) => {
  const w = mod(on)
  await editing($)
  w.answer = PUT_BACK
  expect(await said($, 'stop')).toBe(
    `mod-builder: the edit of ${MOD} is stopped at phase 2 (Describe). Other plugins' folders can be written again. The mod is put back as it was before this edit, in ${MOD}; the folder as it was when stopped is kept beside it as ${STOPPED}. Moved into the restored mod: .git, node_modules. Nothing was deleted. The mod's git history is as it is now, commits made during the edit included: git shows the restored files as changes against them.`,
  )
  expect(putBacks(w)).toEqual([['bash', `${ROOT}/scripts/put-back.sh`, MOD, RESTORE, STOPPED]])
})

test('a mod with neither folder is put back with nothing moved, and the answer says so', async ($, on) => {
  const w = mod(on, { runs: { putback: { exitCode: 0, stdout: `put back: ${MOD}\nkept: ${STOPPED}\nmoved: nothing\n` } } })
  await editing($)
  w.answer = PUT_BACK
  expect(await said($, 'stop')).toMatch(/kept beside it as .*\. Nothing was moved between them\. Nothing was deleted\.$/)
})

test('a question nobody answers, or any other answer, keeps the mod as it is: only the person\'s own words put it back', async ($, on) => {
  const w = mod(on)
  await editing($)
  w.answer = null
  expect(await said($, 'stop')).toMatch(/The mod is kept as it is now\./)
  expect(putBacks(w)).toEqual([])
  expect(kept(w).stopped).toBe(true)
})

test('when the script fails, the answer says so with its own words, and the edit stays stopped', async ($, on) => {
  const w = mod(on, { runs: { putback: { exitCode: 1, stdout: '', stderr: `put-back: ${STOPPED} is already there; nothing was changed\n` } } })
  await editing($)
  w.answer = PUT_BACK
  expect(await said($, 'stop')).toBe(`mod-builder: the edit of ${MOD} is stopped at phase 2 (Describe). Other plugins' folders can be written again. It could not be put back: put-back: ${STOPPED} is already there; nothing was changed`)
  expect(kept(w).stopped).toBe(true)
})

test('a stopped edit gives way: the same session can open a new edit of the folder, with a new baseline', async ($, on) => {
  const w = mod(on)
  await editing($)
  w.answer = KEEP
  await said($, 'stop')
  w.now = 61000
  await $.skill.prompt(EDIT)
  expect(w.store['session:s1']).toEqual({ modDir: null, kind: 'edit' })
  expect(await gate($, { mod_dir: 'turn-counter' })).toMatch(/^mod-builder: the edit's mod folder is /)
  expect(kept(w).stopped).toBe(undefined)
  expect(kept(w).phase).toBe('knowledge')
  expect((kept(w).baseline as { restore: string }).restore).toBe(`${HOME}/.claude/mod-builder-data/v2/restore/s1/1970-01-01T000101Z`)
})

test('stopping twice, or after Done, changes no record and asks nothing', async ($, on) => {
  const w = mod(on)
  await editing($)
  w.answer = KEEP
  await said($, 'stop')
  const asked = w.asked.length
  expect(await said($, 'stop')).toBe('mod-builder: no build or edit is open in this session, so there is nothing to stop.')
  expect(w.asked.length).toBe(asked)
})

// ------------------------------------------------------- cases the independent reader of these tests asked for

const record = (more: Record<string, unknown> = {}) => ({
  modDir: MOD, sessionId: 's1', phase: 'red', specApprovedAt: null, spec: null, testsAtScaffold: null, namesAtScaffold: null, testsAtRed: null, testHashes: null, evidence: {}, ...more,
})
const BASELINE = { version: '0.1.0', tests: 2, names: ['test 1', 'test 2'], hashes: {}, spec: null, failed: [], restore: RESTORE, at: 1000 }

test('an edit that is Done is not stopped: nobody is asked, nothing is put back, and its record stays as it is', async ($, on) => {
  const w = mod(on)
  w.store['session:s1'] = { modDir: MOD, kind: 'edit' }
  w.store[`build:${MOD}`] = record({ kind: 'edit', red: 'edit', phase: 'done', baseline: BASELINE })
  const before = JSON.stringify(w.store[`build:${MOD}`])
  w.answer = PUT_BACK
  expect(await said($, 'stop')).toBe(`mod-builder: the edit of ${MOD} was already done; this session is no longer bound to it, and nothing else was changed.`)
  expect(w.asked).toEqual([])
  expect(putBacks(w)).toEqual([])
  expect(JSON.stringify(w.store[`build:${MOD}`])).toBe(before)
  expect(w.store['session:s1']).toBe(null)
})

test('a record that is another session\'s is not this session\'s to stop: it is left open, and nobody is asked', async ($, on) => {
  const w = mod(on)
  w.store['session:s1'] = { modDir: MOD, kind: 'edit' }
  w.store[`build:${MOD}`] = record({ sessionId: 's2', kind: 'edit', red: 'edit', phase: 'green', baseline: BASELINE })
  const before = JSON.stringify(w.store[`build:${MOD}`])
  w.answer = PUT_BACK
  expect(await said($, 'stop')).toBe(`mod-builder: stopped. The record for ${MOD} is missing or is not this session's, so it was left as it is; this session is no longer bound to the folder.`)
  expect(JSON.stringify(w.store[`build:${MOD}`])).toBe(before)
  expect(w.asked).toEqual([])
  expect(putBacks(w)).toEqual([])
  expect(w.store['session:s1']).toBe(null)
})

test('an edit is stopped and asked about at its first phase too, and the stopped folder is stamped with the time of the stop', async ($, on) => {
  const w = mod(on)
  await $.skill.prompt(EDIT)
  await gate($, { mod_dir: 'turn-counter' })
  w.now = 61000
  w.answer = PUT_BACK
  expect(await said($, 'stop')).toMatch(/is stopped at phase 1 \(Knowledge\)\. .* kept beside it as \/work\/turn-counter\.stopped-1970-01-01T000101Z\./)
  expect(putBacks(w)).toEqual([['bash', `${ROOT}/scripts/put-back.sh`, MOD, RESTORE, `${MOD}.stopped-1970-01-01T000101Z`]])
  expect(w.asked.length).toBe(1)
})

test('a record 0.1.0 stored, with no kind, is a build still: the guard words it so, and stop stops it as a build', async ($, on) => {
  const w = mod(on)
  w.store['session:s1'] = { modDir: MOD }
  w.store[`build:${MOD}`] = record()
  expect((await write($, `${MOD}/hooks/register.tsx`)).deny).toMatch(/can't be written in phase 5 \(Red\), which may write tests\/ only\./)
  expect((await write($, `${MOD}/hooks/x.test.ts`)).deny).toMatch(/phase 5 \(Red\)/)
  expect(await said($, 'stop')).toBe(`mod-builder: the build of ${MOD} is stopped at phase 5 (Red). Other plugins' folders can be written again. The folder is left as it is.`)
  expect(w.asked).toEqual([])
  expect((w.store[`build:${MOD}`] as { stopped?: boolean; kind?: string }).stopped).toBe(true)
  expect((w.store[`build:${MOD}`] as { kind?: string }).kind).toBe(undefined)
})

test('a stop that fails says so, and nothing is moved', async ($, on) => {
  const w = mod(on)
  await editing($)
  w.unreadable = ['session:s1']
  expect(await said($, 'stop')).toMatch(/^mod-builder: the stop failed \(.*\)\. Nothing was moved; run \/mod-builder to see where this session stands\.$/)
  expect(putBacks(w)).toEqual([])
  expect(kept(w).stopped).toBe(undefined)
})

test('the pane is drawn again when a build or an edit is stopped', async ($, on) => {
  let drawn = 0
  on('ui.invalidate', () => {
    drawn += 1
    return { value: undefined } as never
  })
  const w = mod(on)
  await $.skill.prompt(BUILD)
  await gate($, { mod_dir: 'turn-counter' })
  const before = drawn
  await said($, 'stop')
  expect(drawn).toBeGreaterThan(before)
  expect(kept(w).stopped).toBe(true)
})

// Three defects Codex's stop-time review found in the hooks module (SPEC.md 7.2), each as the behaviour now
// required: a guard that can't read the session's state refuses a write into a plugin's folder; a finished build
// gives way to a new record when its folder is built again; and a link under tests/ is never recorded as a test.
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { BUILT, GATE, HOME, MOD, NAME, failing, passing, readerDone, world } from './world'
import type { World } from './world'

const BUILD = { skill: 'build', text: 'the eight phases', source: 'plugin', pluginName: 'mod-builder', frontmatter: {} } as const
const MANIFEST = `${MOD}/.claude-plugin/plugin.json`
const SPEC = `${MOD}/SPEC.md`
const FILES = {
  [`${HOME}/.claude/mod-builder-data/v2/docs/latest`]: '2026-11-10T151216Z\n',
  [SPEC]: '# turn-counter\n',
  [MANIFEST]: `{ "name": "${NAME}" }`,
  [`${MOD}/tests/pane.test.tsx`]: 'the first test',
  'the load log': `[DEBUG] hooks module ${NAME}@inline loaded (worker, environment 1, tier user)\n`,
}

const write = ($: Engine, file_path: string) => $.tool.call({ tool: 'Write', file_path, content: 'x' })
const gate = async ($: Engine, modDir?: string) => readerDone($, String((await $.tool.call({ tool: GATE, ...(modDir === undefined ? {} : { mod_dir: modDir }) } as never)).result))
const kept = (w: World) => w.store[`build:${MOD}`] as Record<string, unknown>
const record = (phase: string) => ({
  modDir: MOD, sessionId: 's1', phase, specApprovedAt: null, spec: null, testsAtScaffold: null, namesAtScaffold: null, testsAtRed: null, testHashes: null, evidence: {},
})
// Walks a build from where it stands to the phase named, through the gate.
const walk = async ($: Engine, w: World, to: string) => {
  const order = ['knowledge', 'describe', 'spec', 'scaffold', 'red', 'green', 'verify', 'done']
  while (order.indexOf(String(kept(w).phase)) < order.indexOf(to)) {
    const now = String(kept(w).phase)
    if (now === 'red') {
      w.files[`${MOD}/tests/counts.test.tsx`] = 'the new test'
      w.runs.test = { exitCode: 1, stdout: failing(['test 1'], ['counts a turn']) }
    }
    if (now === 'green') w.runs.test = { exitCode: 0, stdout: passing(2, ['test 1', 'counts a turn']) }
    const answer = await gate($)
    if (kept(w).phase === now) throw new Error(`the walk stopped at ${now}: ${answer}`)
    // At Verify the "Built" block is written, with the hash of the types the gate checks against.
    if (kept(w).phase === 'verify') w.files[`${MOD}/SPEC.md`] = `${w.files[`${MOD}/SPEC.md`]}${BUILT}`
  }
}

// ------------------------------------------------------------- a guard that can't read the session's state

const BROKEN: [string, Partial<World>][] = [['the session\'s id', { sessionId: null }], ['the session\'s store entry', { unreadable: ['session:s1'] }]]

for (const [what, broken] of BROKEN) {
  test(`when ${what} can't be read, a write into a plugin's folder is refused and never reaches the tool`, async ($, on) => {
    const w = world(on, { files: { [MANIFEST]: '{}' }, store: { 'session:s1': { modDir: MOD }, [`build:${MOD}`]: record('spec') }, ...broken })
    const refused = await write($, `${MOD}/hooks/register.tsx`)
    expect(refused.deny).toMatch(/^mod-builder: \/work\/turn-counter\/hooks\/register\.tsx can't be written: the phase guard could not read whether this session has a build \(.*\), and the path is in a plugin's folder\./)
    expect(typeof (await write($, `${MOD}/SPEC.md`)).deny).toBe('string')
    expect(typeof (await write($, 'turn-counter/tests/a.test.ts')).deny).toBe('string')
    expect(w.reachedTheTool).toEqual([])
    expect(w.logged).toEqual([])
  })

  test(`when ${what} can't be read, the write that would make a folder a plugin is refused, and a write in no plugin's folder goes on with a line`, async ($, on) => {
    const w = world(on, { files: { [MANIFEST]: '{}' }, ...broken })
    expect(typeof (await write($, '/work/new-mod/.claude-plugin/plugin.json')).deny).toBe('string')
    expect((await write($, '/work/notes.md')).deny).toBeUndefined()
    expect((await write($, '/work/turn-counter-2/hooks/x.ts')).deny).toBeUndefined()
    expect(w.reachedTheTool.map((call) => call.path)).toEqual(['/work/notes.md', '/work/turn-counter-2/hooks/x.ts'])
    expect(w.logged.length).toBe(2)
    expect(w.logged[0]).toMatch(/could not read whether this session has a build \(.*\), so it judged nothing\.$/)
  })
}

test('when the session can say neither its id nor its folder, a path from the root is still placed; one that is not is refused', async ($, on) => {
  const w = world(on, { files: { [MANIFEST]: '{}' }, sessionId: null, cwd: null })
  expect(typeof (await write($, 'notes.md')).deny).toBe('string')
  expect(typeof (await write($, 'turn-counter/hooks/x.ts')).deny).toBe('string')
  expect(typeof (await write($, `${MOD}/hooks/x.ts`)).deny).toBe('string')
  expect((await write($, '/work/notes.md')).deny).toBeUndefined()
  expect(w.reachedTheTool).toEqual([{ tool: 'Write', path: '/work/notes.md' }])
  expect(w.logged.length).toBe(1)
})

test('with the session\'s state unreadable, a path is judged as it resolves, however it is spelled, and however deep it lies', async ($, on) => {
  const w = world(on, { files: { [MANIFEST]: '{}' }, sessionId: null })
  for (const path of ['/work/x/../turn-counter/hooks/a.ts', '/work//turn-counter/./hooks/a.ts', 'x/../turn-counter/a.ts', `${MOD}/hooks/lib/deep/x.ts`, `${MOD}/.claude-plugin/plugin.json`]) {
    expect(typeof (await write($, path)).deny).toBe('string')
  }
  expect((await write($, `${MOD}/../notes.md`)).deny).toBeUndefined()
  expect(w.reachedTheTool).toEqual([{ tool: 'Write', path: `${MOD}/../notes.md` }])
})

test('with the session\'s state unreadable, every tool the guard looks at is refused a plugin\'s folder, each by the path it writes', async ($, on) => {
  const w = world(on, { files: { [MANIFEST]: '{}' }, unreadable: ['session:s1'] })
  const edit = await $.tool.call({ tool: 'Edit', file_path: `${MOD}/SPEC.md`, old_string: 'a', new_string: 'b' })
  const multi = await $.tool.call({ tool: 'MultiEdit', file_path: `${MOD}/SPEC.md`, edits: [] } as never)
  const inside = await $.tool.call({ tool: 'NotebookEdit', new_source: 'x', notebook_path: `${MOD}/n.ipynb`, file_path: '/work/notes.md' } as never)
  const outside = await $.tool.call({ tool: 'NotebookEdit', new_source: 'x', notebook_path: '/work/n.ipynb', file_path: `${MOD}/x.ts` } as never)
  expect([edit.deny, multi.deny, inside.deny].every((deny) => typeof deny === 'string')).toBe(true)
  expect(outside.deny).toBeUndefined()
  expect(w.reachedTheTool.length).toBe(1)
})

test('when the manifests can\'t be looked for either, the write is refused: what can\'t be found out is not a pass', async ($, on) => {
  const w = world(on, { sessionId: null, existsFails: true })
  expect(typeof (await write($, '/work/notes.md')).deny).toBe('string')
  expect(w.reachedTheTool).toEqual([])
})

test('a build known to be open still refuses when anything else can\'t be read: the folder, the manifests, a damaged entry', async ($, on) => {
  const w = world(on, { files: { [MANIFEST]: '{}' }, store: { 'session:s1': { modDir: MOD }, [`build:${MOD}`]: record('scaffold') }, cwd: null })
  expect(typeof (await write($, '/work/notes.md')).deny).toBe('string')
  w.cwd = '/work'
  w.existsFails = true
  expect(typeof (await write($, '/work/notes.md')).deny).toBe('string')
  w.existsFails = false
  w.store['session:s1'] = 'pending'
  expect((await write($, '/work/notes.md')).deny).toMatch(/this session's build record can't be read/)
  w.store['session:s1'] = { modDir: MOD }
  expect((await write($, '/work/notes.md')).deny).toBeUndefined()
  expect(w.reachedTheTool.length).toBe(1)
})

test('a path that climbs above the root can\'t be placed either: with the session\'s state unreadable it is refused', async ($, on) => {
  const w = world(on, { sessionId: null })
  expect(typeof (await write($, '../../../work/turn-counter/hooks/x.ts')).deny).toBe('string')
  expect(w.reachedTheTool).toEqual([])
})

test('a session whose state reads, and holds no build, still writes into a plugin\'s folder as before', async ($, on) => {
  const w = world(on, { files: { [MANIFEST]: '{}' } })
  expect((await write($, `${MOD}/hooks/register.tsx`)).deny).toBeUndefined()
  expect((await $.tool.call({ tool: 'Bash', command: 'ls' })).deny).toBeUndefined()
  expect(w.reachedTheTool.length).toBe(2)
  expect(w.logged).toEqual([])
})

test('a tool the guard does not look at goes on whatever can\'t be read', async ($, on) => {
  const w = world(on, { files: { [MANIFEST]: '{}' }, sessionId: null, cwd: null })
  expect((await $.tool.call({ tool: 'Bash', command: `echo x > ${MOD}/hooks/x.ts` })).deny).toBeUndefined()
  expect((await $.tool.call({ tool: 'Read', file_path: `${MOD}/hooks/x.ts` })).deny).toBeUndefined()
  expect(w.reachedTheTool.length).toBe(2)
})

// ------------------------------------------------------------------- a finished build, built again

test('building a folder again after Done starts a new record at Knowledge, with nothing kept from the finished build', async ($, on) => {
  const w = world(on, { files: { ...FILES } })
  await $.skill.prompt(BUILD)
  await gate($, MOD)
  await walk($, w, 'done')
  expect(kept(w).phase).toBe('done')
  expect(kept(w).testHashes === null).toBe(false)

  await $.skill.prompt(BUILD)
  expect(w.store['session:s1']).toEqual({ modDir: null })
  expect(await gate($, MOD)).toBe(`mod-builder: the build's mod folder is ${MOD}. It is at phase 1 (Knowledge). Call mod_builder_gate again to ask for the next phase.`)
  expect(kept(w)).toEqual(record('knowledge'))
  expect(await gate($)).toMatch(/phase 1 \(Knowledge\) passed/)
  expect(kept(w).phase).toBe('describe')
})

test('the new build is held to its own phases: what the finished one allowed is closed again, and its approval is not carried over', async ($, on) => {
  const w = world(on, { files: { ...FILES } })
  await $.skill.prompt(BUILD)
  await gate($, MOD)
  await walk($, w, 'done')
  expect((await write($, `${MOD}/README.md`)).deny).toBeUndefined()
  await $.skill.prompt(BUILD)
  await gate($, MOD)
  expect((await write($, `${MOD}/README.md`)).deny).toMatch(/in phase 1 \(Knowledge\)/)
  await walk($, w, 'spec')
  w.answer = 'Not yet'
  expect(await gate($)).toMatch(/still at phase 3 \(Spec\)/)
  expect(w.asked.length).toBe(2)
  expect(kept(w).spec).toBe(null)
})

for (const phase of ['spec', 'green', 'verify']) {
  test(`a build this session left unfinished at ${phase} goes on where it stood when the folder is named again`, async ($, on) => {
    const unfinished = { ...record(phase), specApprovedAt: 5, spec: { length: 3, hash: 'h' }, testsAtRed: 2, evidence: { knowledge: 'snapshot x' } }
    const w = world(on, { files: { ...FILES }, store: { 'session:s1': { modDir: null }, [`build:${MOD}`]: unfinished } })
    expect(await gate($, './turn-counter/')).toMatch(new RegExp(`It is at phase \\d \\(${phase[0]?.toUpperCase()}${phase.slice(1)}\\)\\.`))
    expect(kept(w)).toEqual(unfinished)
  })
}

test('the finished record gives way under any spelling of the folder, and until the folder is named the mod stays closed', async ($, on) => {
  const w = world(on, { files: { ...FILES } })
  await $.skill.prompt(BUILD)
  await gate($, MOD)
  await walk($, w, 'done')
  await $.skill.prompt(BUILD)
  expect((await write($, `${MOD}/README.md`)).deny).toMatch(/this build has not named its mod's folder/)
  await gate($, '../work/turn-counter/')
  expect(Object.keys(w.store).filter((key) => key.startsWith('build:'))).toEqual([`build:${MOD}`])
  expect(kept(w)).toEqual(record('knowledge'))
})

// --------------------------------------------------------------------------- a link under tests/

test('Red refuses a tests/ that holds a link, naming it: what a link points at is not recorded', async ($, on) => {
  const w = world(on, { files: { ...FILES } })
  await $.skill.prompt(BUILD)
  await gate($, MOD)
  await walk($, w, 'red')
  w.files[`${MOD}/tests/counts.test.tsx`] = 'the new test'
  w.links = [`${MOD}/tests/counts.test.tsx`]
  w.runs.test = { exitCode: 1, stdout: failing(['test 1'], ['counts a turn']) }
  expect(await gate($)).toBe("mod-builder: still at phase 5 (Red). Not passed: tests/counts.test.tsx is a link or no file: a test must be a file of the mod's own, so that what it holds can be recorded.")
  expect(kept(w).phase).toBe('red')
  expect(kept(w).testHashes).toBe(null)
  w.links = []
  expect(await gate($)).toMatch(/phase 5 \(Red\) passed/)
})

test('a linked folder under tests/ is refused the same way', async ($, on) => {
  const w = world(on, { files: { ...FILES } })
  await $.skill.prompt(BUILD)
  await gate($, MOD)
  await walk($, w, 'red')
  w.files[`${MOD}/tests/shared/more.test.tsx`] = 'elsewhere'
  w.links = [`${MOD}/tests/shared`]
  w.runs.test = { exitCode: 1, stdout: failing(['test 1'], ['counts a turn']) }
  expect(await gate($)).toMatch(/Not passed: tests\/shared is a link or no file/)
  expect(kept(w).phase).toBe('red')
})

test('a test file swapped for a link after Red stops the build at the next gate', async ($, on) => {
  const w = world(on, { files: { ...FILES } })
  await $.skill.prompt(BUILD)
  await gate($, MOD)
  await walk($, w, 'green')
  w.runs.test = { exitCode: 0, stdout: passing(2, ['test 1', 'counts a turn']) }
  w.links = [`${MOD}/tests/counts.test.tsx`]
  expect(await gate($)).toBe('mod-builder: still at phase 6 (Green). Not passed: not as recorded: tests/counts.test.tsx (changed).')
  expect(kept(w).phase).toBe('green')
})

for (const [what, listed] of [['a thing that is no file and no folder', { kind: 'other', isLink: false }], ['a link listed as a file', { kind: 'file', isLink: true }], ['a link listed as a folder', { kind: 'dir', isLink: true }]] as const) {
  test(`Red refuses a tests/ that holds ${what}, at any depth`, async ($, on) => {
    const w = world(on, { files: { ...FILES } })
    await $.skill.prompt(BUILD)
    await gate($, MOD)
    await walk($, w, 'red')
    w.files[`${MOD}/tests/counts.test.tsx`] = 'the new test'
    w.files[`${MOD}/tests/deep/odd/more.test.tsx`] = 'elsewhere'
    w.listedAs = { [`${MOD}/tests/deep/odd`]: { ...listed } }
    w.runs.test = { exitCode: 1, stdout: failing(['test 1'], ['counts a turn']) }
    expect(await gate($)).toMatch(/Not passed: tests\/deep\/odd is a link or no file/)
    expect(kept(w).phase).toBe('red')
    expect(kept(w).testHashes).toBe(null)
  })
}

test('a link added under tests/ after Red stops Green, and one added after Green stops Verify', async ($, on) => {
  const w = world(on, { files: { ...FILES } })
  await $.skill.prompt(BUILD)
  await gate($, MOD)
  await walk($, w, 'green')
  w.runs.test = { exitCode: 0, stdout: passing(2, ['test 1', 'counts a turn']) }
  w.files[`${MOD}/tests/extra.test.tsx`] = 'elsewhere'
  w.links = [`${MOD}/tests/extra.test.tsx`]
  expect(await gate($)).toMatch(/Not passed: not as recorded: tests\/extra\.test\.tsx \(added\)/)
  delete w.files[`${MOD}/tests/extra.test.tsx`]
  await walk($, w, 'verify')
  w.files[`${MOD}/tests/late.test.tsx`] = 'elsewhere'
  w.links = [`${MOD}/tests/late.test.tsx`]
  expect(await gate($)).toMatch(/Not passed: not as recorded: tests\/late\.test\.tsx \(added\)/)
  w.links = [`${MOD}/tests/pane.test.tsx`]
  delete w.files[`${MOD}/tests/late.test.tsx`]
  expect(await gate($)).toMatch(/Not passed: not as recorded: tests\/pane\.test\.tsx \(changed\)/)
  expect(kept(w).phase).toBe('verify')
})

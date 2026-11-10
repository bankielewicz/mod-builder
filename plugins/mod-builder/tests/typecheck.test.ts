// Verify's typecheck (SPEC.md 7.5, the second of step 4's settled points), through the hooks module itself: the
// types are the build's own, found by the mod for the session's version and never taken from the model; the
// tsconfig is written under the plugin's data folder, outside the mod; the compiler is one that is installed, else
// one npx downloads; and with no types or no compiler Verify refuses, says what to do, and runs nothing.
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { DOWNLOADED, GATE, HOME, INSTALLED, MOD, NAME, TMP, TYPES, TYPES_FOLDER, TYPES_TEXT, world } from './world'
import type { World } from './world'

const SPEC = `${MOD}/SPEC.md`
const TEST_FILE = `${MOD}/tests/pane.test.tsx`
const CONFIG_FOLDER = `${HOME}/.claude/mod-builder-data/v2/typecheck/s1`
const CONFIG = `${CONFIG_FOLDER}/tsconfig.json`
const LOADED = `[DEBUG] hooks module ${NAME}@inline loaded (worker, environment 1, tier user); events: session.start\n`
const OPTIONS = {
  target: 'es2023', lib: ['es2023'], types: [], module: 'esnext', moduleResolution: 'bundler', strict: true,
  noUncheckedIndexedAccess: true, noEmit: true, skipLibCheck: true, jsx: 'react', jsxFactory: 'h', jsxFragmentFactory: 'Fragment',
}
const NOT_FOUND = { exitCode: 127, stdout: '', stderr: 'sh: 1: tsc: Permission denied\n' }

const sha256 = async (text: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

// A world whose build stands at Verify, as the gates before it would have left it.
const atVerify = async (on: Parameters<typeof world>[0], more: Partial<World> = {}) => {
  const spec = '# turn-counter\n'
  const w = world(on, {
    ...more,
    files: {
      [SPEC]: spec, [`${MOD}/.claude-plugin/plugin.json`]: `{ "name": "${NAME}" }`, [TEST_FILE]: 'the first test', 'the load log': LOADED,
      [TYPES]: TYPES_TEXT, ...more.files,
    },
  })
  w.store['session:s1'] = { modDir: MOD }
  w.store[`build:${MOD}`] = {
    modDir: MOD, sessionId: 's1', phase: 'verify', specApprovedAt: 1, spec: { length: spec.length, hash: await sha256(spec) }, testsAtScaffold: 0,
    namesAtScaffold: [], testsAtRed: 1, testHashes: { 'tests/pane.test.tsx': await sha256(btoa('the first test')) }, evidence: {},
  }
  return w
}
const gate = async ($: Engine) => String((await $.tool.call({ tool: GATE } as never)).result)
const phase = (w: World) => (w.store[`build:${MOD}`] as { phase: string }).phase
const typechecks = (w: World) => w.ran.filter((argv) => argv.includes('--noEmit'))
const config = (w: World) => JSON.parse(w.files[CONFIG] ?? 'null') as { compilerOptions: unknown; include: string[] } | null

test('Verify typechecks against the build\'s own types, with a tsconfig it writes outside the mod', async ($, on) => {
  const w = await atVerify(on)
  expect(await gate($)).toMatch(/^mod-builder: phase 7 \(Verify\) passed /)
  expect(config(w)).toEqual({ compilerOptions: OPTIONS, include: [TYPES, `${MOD}/hooks`, `${MOD}/tests`, `${MOD}/types`] })
  expect(typechecks(w)).toEqual([['npx', '--no-install', 'tsc', '--noEmit', '-p', CONFIG]])
  expect(Object.keys(w.files).filter((file) => file.startsWith(`${MOD}/`)).sort()).toEqual([`${MOD}/.claude-plugin/plugin.json`, SPEC, TEST_FILE].sort())
})

test('the compiler is asked for, and run, in the tsconfig\'s folder, outside the mod: nothing the mod holds is taken for a compiler', async ($, on) => {
  const w = await atVerify(on)
  w.compilers[INSTALLED] = NOT_FOUND
  await gate($)
  const where = w.ran.map((argv, index) => [argv.includes('tsc'), w.ranIn[index]]).filter(([isCompiler]) => isCompiler === true)
  expect(where).toEqual([[true, CONFIG_FOLDER], [true, CONFIG_FOLDER], [true, CONFIG_FOLDER]])
})

test('a CLAUDE_TMPDIR that is empty or no path from the root places nothing: the user id is asked for instead', async ($, on) => {
  const w = await atVerify(on)
  w.runs.id = { exitCode: 0, stdout: '1000\n' }
  const standing = w.store[`build:${MOD}`]
  for (const tmp of ['', 'relative/tmp', '/']) {
    w.env.CLAUDE_TMPDIR = tmp
    w.store[`build:${MOD}`] = standing
    delete w.files[CONFIG]
    expect(await gate($)).toMatch(/^mod-builder: phase 7 \(Verify\) passed /)
    expect(config(w)?.include[0]).toBe(TYPES)
  }
})

test('when the tsconfig can\'t be written the gate says it failed, nothing is run, and the build stays at Verify', async ($, on) => {
  const w = await atVerify(on)
  w.unwritable = [`${HOME}/.claude/mod-builder-data/v2/typecheck`]
  expect(await gate($)).toMatch(/^mod-builder: the gate failed and the build did not move: .*EACCES/)
  expect(w.ran).toEqual([])
  expect(phase(w)).toBe('verify')
})

test('with no compiler installed, the one npx downloads is asked for and used', async ($, on) => {
  const w = await atVerify(on)
  w.compilers[INSTALLED] = NOT_FOUND
  expect(await gate($)).toMatch(/^mod-builder: phase 7 \(Verify\) passed /)
  expect(w.ran.filter((argv) => argv.at(-1) === '-v')).toEqual([['npx', '--no-install', 'tsc', '-v'], ['npx', '-y', '-p', 'typescript', 'tsc', '-v']])
  expect(typechecks(w)).toEqual([['npx', '-y', '-p', 'typescript', 'tsc', '--noEmit', '-p', CONFIG]])
})

test('an installed compiler that answers is used, and none is downloaded', async ($, on) => {
  const w = await atVerify(on)
  w.compilers[DOWNLOADED] = 'never starts'
  expect(await gate($)).toMatch(/^mod-builder: phase 7 \(Verify\) passed /)
  expect(w.ran.filter((argv) => argv.includes('-y'))).toEqual([])
})

test('with neither compiler, Verify refuses, says what to install, and runs nothing else', async ($, on) => {
  const w = await atVerify(on)
  for (const none of [NOT_FOUND, 'never starts', { exitCode: 0, stdout: '' }, { exitCode: 0, stdout: 'Version 5.9.3\n', isTruncated: true }] as const) {
    w.compilers[INSTALLED] = none
    w.compilers[DOWNLOADED] = none
    w.ran.length = 0
    expect(await gate($)).toBe('mod-builder: still at phase 7 (Verify). Not passed: no TypeScript compiler could be run ("npx --no-install tsc" found none, and "npx -y -p typescript tsc" could not download one): install one with "npm install -g typescript", then ask again.')
    expect(w.ran.every((argv) => argv.at(-1) === '-v')).toBe(true)
  }
  expect(phase(w)).toBe('verify')
})

test('before the build\'s types are written, Verify refuses, sends the model to the plugin-authoring skill, and runs nothing', async ($, on) => {
  const w = await atVerify(on)
  delete w.files[TYPES]
  expect(await gate($)).toBe(`mod-builder: still at phase 7 (Verify). Not passed: the types of Claude Code 2.1.322 are not written yet (looked in ${TYPES_FOLDER}): load the plugin-authoring skill with the Skill tool, which writes them, then ask again.`)
  expect(w.ran).toEqual([])
  expect(config(w)).toBe(null)
  expect(phase(w)).toBe('verify')
  w.files[TYPES] = TYPES_TEXT
  expect(await gate($)).toMatch(/^mod-builder: phase 7 \(Verify\) passed /)
})

test('types written by another version of Claude Code are not this build\'s: in its folder or under its name, they are passed over', async ($, on) => {
  const w = await atVerify(on)
  delete w.files[TYPES]
  w.files[`${TMP}/bundled-skills/2.1.321/aaaa/plugin-authoring/types/claude-code.d.ts`] = '// Written by Claude Code 2.1.321.\n'
  w.files[`${TYPES_FOLDER}/aaaa/plugin-authoring/types/claude-code.d.ts`] = '// Written by Claude Code 2.1.321.\n'
  w.files[`${TYPES_FOLDER}/bbbb/plugin-authoring/reference.md`] = 'no types here'
  expect(await gate($)).toMatch(/Not passed: the types of Claude Code 2\.1\.322 are not written yet/)
  w.version = '2.1.321'
  expect(await gate($)).toMatch(/^mod-builder: phase 7 \(Verify\) passed /)
  expect(config(w)?.include[0]).toBe(`${TMP}/bundled-skills/2.1.321/aaaa/plugin-authoring/types/claude-code.d.ts`)
})

test('of several processes\' types for this build, the first by name that is this build\'s is used', async ($, on) => {
  const w = await atVerify(on)
  delete w.files[TYPES]
  w.files[`${TYPES_FOLDER}/aaaa/plugin-authoring/types/claude-code.d.ts`] = '<html>not types</html>\n'
  w.files[`${TYPES_FOLDER}/cccc/plugin-authoring/types/claude-code.d.ts`] = TYPES_TEXT
  w.files[`${TYPES_FOLDER}/bbbb/plugin-authoring/types/claude-code.d.ts`] = TYPES_TEXT
  expect(await gate($)).toMatch(/^mod-builder: phase 7 \(Verify\) passed /)
  expect(config(w)?.include[0]).toBe(`${TYPES_FOLDER}/bbbb/plugin-authoring/types/claude-code.d.ts`)
})

test('without CLAUDE_TMPDIR the types are looked for under /tmp/claude-<user id>, the id asked of the system', async ($, on) => {
  const w = await atVerify(on)
  w.env.CLAUDE_TMPDIR = undefined
  w.runs.id = { exitCode: 0, stdout: '1000\n' }
  expect(await gate($)).toMatch(/^mod-builder: phase 7 \(Verify\) passed /)
  expect(w.ran[0]).toEqual(['id', '-u'])
  expect(config(w)?.include[0]).toBe(TYPES)
})

test('with no CLAUDE_TMPDIR and no user id, Verify refuses and says where it could not look', async ($, on) => {
  const w = await atVerify(on)
  w.env.CLAUDE_TMPDIR = undefined
  expect(await gate($)).toMatch(/Not passed: the types of Claude Code 2\.1\.322 are not written yet \(looked in no folder: CLAUDE_TMPDIR is not set and the user id could not be read\)/)
  w.runs.id = { exitCode: 0, stdout: 'bryan\n' }
  expect(await gate($)).toMatch(/looked in no folder/)
  expect(phase(w)).toBe('verify')
})

test('a typecheck that finds an error keeps the build at Verify, with the compiler\'s exit code', async ($, on) => {
  const w = await atVerify(on)
  w.runs.tsc = { exitCode: 2, stdout: 'hooks/register.tsx(3,7): error TS2322\n' }
  expect(await gate($)).toBe('mod-builder: still at phase 7 (Verify). Not passed: the typecheck exited 2.')
  expect(phase(w)).toBe('verify')
})

test('the tsconfig is this session\'s own and is written anew for each check, so a folder named by another build is not checked', async ($, on) => {
  const w = await atVerify(on)
  w.files[CONFIG] = JSON.stringify({ include: ['/work/another-mod/hooks'] })
  await gate($)
  expect(config(w)?.include).toEqual([TYPES, `${MOD}/hooks`, `${MOD}/tests`, `${MOD}/types`])
})

test('with HOME not set there is no folder for the tsconfig: Verify refuses and runs nothing', async ($, on) => {
  const w = await atVerify(on)
  w.env.HOME = undefined
  expect(await gate($)).toMatch(/Not passed: HOME is not set, so the typecheck has no folder for its tsconfig\.json/)
  expect(w.ran).toEqual([])
})

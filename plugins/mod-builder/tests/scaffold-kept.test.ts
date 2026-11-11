// SPEC.md 9.4 and 9.15, through the hooks module itself: at Scaffold hooks/ and tests/ hold the template and
// nothing else. The gate asks the scaffold script's own check, for the name in the mod's manifest, first and
// once more after the typecheck; a difference refuses, names the files and says how they are laid again.
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { AS_LAID, GATE, MOD, NAME, TYPES, TYPES_SHA, TYPES_TEXT, failing, world } from './world'
import type { World } from './world'

const SPEC = `${MOD}/SPEC.md`
const APPROVED = '# turn-counter\n'
const MANIFEST = `${MOD}/.claude-plugin/plugin.json`
const STILL = 'mod-builder: still at phase 4 (Scaffold). Not passed: '
const WHY = ': at Scaffold they hold the template and nothing else, and the mod\'s behaviour is written at Red (tests) and Green (code). Put them back with: '
const HEADING = 'The last lines of its output:'

const sha256 = async (text: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

// A world whose record stands at `phase`, as the gates before it would have left it.
const standing = async (on: Parameters<typeof world>[0], phase = 'scaffold', manifest: string | null = `{ "name": "${NAME}" }`) => {
  const w = world(on, {
    files: { [SPEC]: APPROVED, ...(manifest === null ? {} : { [MANIFEST]: manifest }), [`${MOD}/tests/pane.test.tsx`]: 'the first test', [TYPES]: TYPES_TEXT },
  })
  w.store['session:s1'] = { modDir: MOD }
  w.store[`build:${MOD}`] = {
    modDir: MOD, sessionId: 's1', phase, specApprovedAt: 1, spec: { length: APPROVED.length, hash: await sha256(APPROVED) },
    testsAtScaffold: phase === 'scaffold' ? null : 1, namesAtScaffold: phase === 'scaffold' ? null : ['test 1'], testsAtRed: null, testHashes: null,
    evidence: { knowledge: 'snapshot 2026-11-10T151216Z' },
  }
  return w
}
const gate = async ($: Engine) => String((await $.tool.call({ tool: GATE } as never)).result)
const kept = (w: World) => w.store[`build:${MOD}`] as Record<string, unknown>
const checks = (w: World) => w.ran.filter((argv) => argv.includes('--check'))
const word = (argv: string[]) => (argv.includes('--noEmit') ? 'typecheck' : argv.at(-1) === '-v' ? 'compiler?' : (argv[2] as string))
const write = async ($: Engine, path: string) => (await $.tool.call({ tool: 'Write', file_path: path, content: 'x' } as never)).deny
// The command the refusal gives for laying the files again: the script the gate itself ran, in its other mode.
const again = (w: World, name = NAME) => `bash "${(checks(w)[0] as string[])[1]}" --again "${MOD}" ${name}`

test('the gate asks the scaffold script itself, with --check, the mod folder and the name in the manifest', async ($, on) => {
  const w = await standing(on)
  await gate($)
  const asked = checks(w)[0] as string[]
  expect(asked[0]).toBe('bash')
  expect((asked[1] as string).endsWith('/scripts/scaffold.sh')).toBe(true)
  expect(asked.slice(2)).toEqual(['--check', MOD, NAME])
})

test('a changed file under hooks/ refuses Scaffold before anything else is run, and the answer names it and how to lay it again', async ($, on) => {
  const w = await standing(on)
  w.runs.scaffold = { exitCode: 1, stdout: 'changed: hooks/register.tsx\n' }
  const answer = await gate($)
  expect(answer).toBe(`${STILL}hooks/ and tests/ are not as the scaffold laid them (changed: hooks/register.tsx)${WHY}${again(w)}.\n${HEADING}\nchanged: hooks/register.tsx`)
  expect(w.ran.map(word)).toEqual(['--check'])
  expect(kept(w).phase).toBe('scaffold')
  expect(kept(w).testsAtScaffold).toBe(null)
})

test('changed, missing and extra files are all named, in the script\'s order, and an extra file is to be removed', async ($, on) => {
  const w = await standing(on)
  w.runs.scaffold = { exitCode: 1, stdout: 'changed: hooks/register.tsx\nmissing: tests/pane.test.tsx\nextra: hooks/lib.ts\nextra: tests/count.test.ts\n' }
  const first = (await gate($)).split('\n')[0]
  expect(first).toBe(`${STILL}hooks/ and tests/ are not as the scaffold laid them (changed: hooks/register.tsx; missing: tests/pane.test.tsx; extra: hooks/lib.ts; extra: tests/count.test.ts)${WHY}${again(w)}, and remove each file named as extra.`)
})

test('a refused Scaffold leaves hooks/ and tests/ open, so the files can be put back, and it passes once they are as laid', async ($, on) => {
  const w = await standing(on)
  w.runs.scaffold = { exitCode: 1, stdout: 'extra: hooks/lib.ts\n' }
  expect((await gate($)).startsWith(STILL)).toBe(true)
  expect(await write($, `${MOD}/hooks/register.tsx`)).toBe(undefined)
  expect(await write($, `${MOD}/tests/pane.test.tsx`)).toBe(undefined)
  w.runs.scaffold = AS_LAID
  expect(await gate($)).toBe(`mod-builder: phase 4 (Scaffold) passed (hooks/ and tests/ are as the scaffold laid them; claude plugin validate --strict exited 0; 1 tests ran; the typecheck passes (types sha256 ${TYPES_SHA})). The build is now at phase 5 (Red).`)
  expect(kept(w).phase).toBe('red')
})

test('the check is asked once more after the typecheck: a file changed while the checks ran refuses, and nothing is recorded', async ($, on) => {
  const w = await standing(on)
  w.whileRunning = (argv) => {
    if (argv.includes('--noEmit')) w.runs.scaffold = { exitCode: 1, stdout: 'changed: tests/pane.test.tsx\n' }
  }
  const answer = await gate($)
  expect(answer).toBe(`${STILL}hooks/ and tests/ are not as the scaffold laid them (changed: tests/pane.test.tsx)${WHY}${again(w)}.\n${HEADING}\nchanged: tests/pane.test.tsx`)
  expect(w.ran.map(word)).toEqual(['--check', 'validate', 'test', 'compiler?', 'typecheck', '--check'])
  expect(kept(w).phase).toBe('scaffold')
  expect(kept(w).testsAtScaffold).toBe(null)
})

test('a check that exits 0 without saying "as laid" is no evidence, and neither is one that names a difference and exits 0', async ($, on) => {
  const w = await standing(on)
  w.runs.scaffold = { exitCode: 0, stdout: '' }
  expect(await gate($)).toBe(`${STILL}the scaffold check gave no answer to read (it exited 0).`)
  w.runs.scaffold = { exitCode: 0, stdout: 'as laid: hooks/hooks.json\nextra: hooks/lib.ts\n' }
  expect((await gate($)).split('\n')[0]).toBe(`${STILL}the scaffold check gave no answer to read (it exited 0).`)
  expect(kept(w).phase).toBe('scaffold')
})

test('a check that could not start, or was refused its arguments, refuses Scaffold and quotes what the script said', async ($, on) => {
  const w = await standing(on)
  w.runs.scaffold = 'never starts'
  expect(await gate($)).toBe(`${STILL}the scaffold check ended with no exit code.`)
  w.runs.scaffold = { exitCode: 2, stdout: '', stderr: 'scaffold: "Turn Counter" is no mod name\n' }
  expect(await gate($)).toBe(`${STILL}the scaffold check gave no answer to read (it exited 2).\n${HEADING}\nscaffold: "Turn Counter" is no mod name`)
  w.runs.scaffold = { exitCode: 1, stdout: 'nothing the gate knows\n' }
  expect((await gate($)).split('\n')[0]).toBe(`${STILL}the scaffold check gave no answer to read (it exited 1).`)
})

test('a manifest that can\'t be read, or names no text, gives the script no name; the gate does not make one up', async ($, on) => {
  const w = await standing(on, 'scaffold', null)
  // The build stays at Scaffold, so that each call asks again.
  w.runs.scaffold = { exitCode: 2, stdout: '', stderr: 'scaffold: "" is no mod name\n' }
  await gate($)
  expect((checks(w)[0] as string[]).slice(2)).toEqual(['--check', MOD, ''])
  w.files[MANIFEST] = '{ "name": 7 }'
  w.ran.length = 0
  await gate($)
  expect((checks(w)[0] as string[]).slice(2)).toEqual(['--check', MOD, ''])
  w.files[MANIFEST] = 'not json'
  w.ran.length = 0
  await gate($)
  expect((checks(w)[0] as string[]).slice(2)).toEqual(['--check', MOD, ''])
})

test('more than ten differences are named as ten and a count of the rest', async ($, on) => {
  const w = await standing(on)
  const lines = Array.from({ length: 13 }, (_, index) => `extra: hooks/f${index + 1}.ts`)
  w.runs.scaffold = { exitCode: 1, stdout: `${lines.join('\n')}\n` }
  const first = (await gate($)).split('\n')[0] as string
  expect(first).toContain(`(${lines.slice(0, 10).join('; ')}; and 3 more)`)
  expect(first).not.toContain('hooks/f11.ts')
})

test('only Scaffold asks: Red does not run the scaffold check', async ($, on) => {
  const w = await standing(on, 'red')
  w.runs.scaffold = { exitCode: 1, stdout: 'changed: hooks/register.tsx\n' }
  await gate($)
  expect(checks(w)).toEqual([])
})

test('Red may replace the template\'s tests: a run that holds none of the names recorded at Scaffold passes when a new one fails by assertion', async ($, on) => {
  const w = await standing(on, 'red')
  w.runs.test = { exitCode: 1, stdout: failing(['shows the count'], ['counts a turn', 'resets on clear']) }
  expect((await gate($)).startsWith('mod-builder: phase 5 (Red) passed (')).toBe(true)
  expect(kept(w).phase).toBe('green')
  expect(kept(w).testsAtRed).toBe(3)
})

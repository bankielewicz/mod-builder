// The lines a refused load is answered with (SPEC.md 7.7, decision 1, and 7.8): the last 20 lines of what the
// command said, and beside them every line of its log that says a hook of the mod was skipped. The limit of 20
// is the command's alone: no skipped-hook line is dropped for it, and none pushes the command's lines out.
// (Codex's stop-time review of this step, 2026-11-10: with 25 skipped hooks only the last 20 were quoted.)
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { GATE, MOD, NAME, TYPES, TYPES_TEXT, world } from './world'
import type { World } from './world'

const SPEC = `${MOD}/SPEC.md`
const LOADED = `[DEBUG] hooks module ${NAME}@inline loaded (worker, environment 1, tier user); events: session.start\n`
const skipped = (count: number) => Array.from({ length: count }, (_, index) => `[ERROR] ${NAME}: event${index + 1}.x hook skipped: threw ${index + 1}`)
const printed = (count: number) => Array.from({ length: count }, (_, index) => `output ${index + 1}`)

const sha256 = async (text: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

// A world whose build stands at Green, as the gates before it would have left it.
const atGreen = async (on: Parameters<typeof world>[0]) => {
  const spec = '# turn-counter\n'
  const w = world(on, {
    files: {
      [SPEC]: spec, [`${MOD}/.claude-plugin/plugin.json`]: `{ "name": "${NAME}" }`, [`${MOD}/tests/pane.test.tsx`]: 'the first test',
      'the load log': LOADED, [TYPES]: TYPES_TEXT,
    },
  })
  w.store['session:s1'] = { modDir: MOD }
  w.store[`build:${MOD}`] = {
    modDir: MOD, sessionId: 's1', phase: 'green', specApprovedAt: 1, spec: { length: spec.length, hash: await sha256(spec) }, testsAtScaffold: 0,
    namesAtScaffold: [], testsAtRed: 1, testHashes: { 'tests/pane.test.tsx': await sha256(btoa('the first test')) }, evidence: {},
  }
  return w
}
const quoted = async ($: Engine) => String((await $.tool.call({ tool: GATE } as never)).result).split('\n').slice(2)
const logged = (w: World, lines: string[]) => {
  w.files['the load log'] = `${LOADED}${lines.join('\n')}\n`
}

test('every skipped-hook line is quoted, however many there are: 25 skipped hooks are 25 lines', async ($, on) => {
  const w = await atGreen(on)
  logged(w, skipped(25))
  expect(await quoted($)).toEqual(skipped(25))
  logged(w, skipped(21))
  expect(await quoted($)).toEqual(skipped(21))
})

test('a load that failed is quoted by its last 20 lines, and every skipped-hook line follows them', async ($, on) => {
  const w = await atGreen(on)
  w.runs['--plugin-dir'] = { exitCode: 1, stdout: `${printed(25).join('\n')}\n` }
  logged(w, skipped(3))
  expect(await quoted($)).toEqual([...printed(25).slice(5), ...skipped(3)])
  logged(w, skipped(25))
  expect(await quoted($)).toEqual([...printed(25).slice(5), ...skipped(25)])
})

test('a load that failed and printed 20 lines keeps all 20 beside its skipped hooks, and 21 lines lose only the first', async ($, on) => {
  const w = await atGreen(on)
  logged(w, skipped(2))
  w.runs['--plugin-dir'] = { exitCode: 1, stdout: `${printed(20).join('\n')}\n` }
  expect(await quoted($)).toEqual([...printed(20), ...skipped(2)])
  w.runs['--plugin-dir'] = { exitCode: 1, stdout: `${printed(21).join('\n')}\n` }
  expect(await quoted($)).toEqual([...printed(21).slice(1), ...skipped(2)])
})

test('with no skipped hook and a load that ran, the log\'s lines that name the mod are still its last 20', async ($, on) => {
  const w = await atGreen(on)
  const named = Array.from({ length: 25 }, (_, index) => `[DEBUG] ${NAME} line ${index + 1}`)
  w.files['the load log'] = `${named.join('\n')}\n`
  expect(await quoted($)).toEqual(named.slice(5))
})

test('a load that exited 0 is not quoted for what it printed: only its skipped hooks are', async ($, on) => {
  const w = await atGreen(on)
  w.runs['--plugin-dir'] = { exitCode: 0, stdout: `${printed(3).join('\n')}\n` }
  logged(w, skipped(2))
  expect(await quoted($)).toEqual(skipped(2))
})

test('a load that failed and said nothing leaves no empty line before its skipped hooks', async ($, on) => {
  const w = await atGreen(on)
  w.runs['--plugin-dir'] = { exitCode: 1, stdout: '' }
  logged(w, skipped(3))
  expect(await quoted($)).toEqual(skipped(3))
})

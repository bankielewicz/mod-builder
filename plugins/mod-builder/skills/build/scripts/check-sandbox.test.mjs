// Unit tests for check-sandbox.mjs's two judgements (#98, PR #108 review): node --test <this file>.
import assert from 'node:assert/strict'
import { test } from 'node:test'

const mod = await import('./check-sandbox.mjs').catch(() => ({}))
/** A function this change adds, found by name: a module without it fails the test by assertion, not at load. */
function helper(name) {
  assert.equal(typeof mod[name], 'function', `check-sandbox.mjs exports ${name}`)
  return mod[name]
}

const CANARY = "const GLOBALS = ['process', 'Bun', 'Deno', 'fetch', 'WebSocket', 'XMLHttpRequest', 'Worker']\n"
const GOTCHAS = 'These globals are `undefined` on `globalThis` (the canary\'s list): `process`, `Bun`, `Deno`, `fetch`,\n  `WebSocket`, `XMLHttpRequest`, `Worker`. Calling `require` throws.\n'

test("listsDiffer: none when the canary's GLOBALS and gotchas.md's list name the same globals, in any order", () => {
  const differ = helper('listsDiffer')
  assert.equal(differ(CANARY, GOTCHAS), null)
  assert.equal(differ("const GLOBALS = ['Worker', 'process', 'Bun', 'Deno', 'fetch', 'WebSocket', 'XMLHttpRequest']", GOTCHAS), null)
})

test('listsDiffer: names what only one side has, and a list it cannot find', () => {
  const differ = helper('listsDiffer')
  assert.equal(differ(CANARY.replace(", 'Worker'", ''), GOTCHAS), 'only in gotchas.md: Worker')
  assert.equal(differ(CANARY.replace("'Bun', ", "'Bun', 'navigator', "), GOTCHAS), 'only in the canary: navigator')
  assert.equal(differ(CANARY, GOTCHAS.replace(' `Deno`,', '')), 'only in the canary: Deno')
  assert.match(differ('no list here', GOTCHAS), /GLOBALS/)
  assert.match(differ(CANARY, 'no list here'), /canary's list/)
})

const FILES = ['tests/dynamic-import.test.ts', 'tests/node-fs.test.ts']
const refused = (file) => `${file}:\n(fail) the file did not load\n  ${file}: a reason\n`
const OUTPUT = `tests/control.test.ts:\n(pass) the loader > loaded a plain file [1.00ms]\n\n${refused(FILES[0])}\n${refused(FILES[1])}\n 1 pass\n 2 fail\n`

test('loaderVerdict: no failures when the control file passed and each refused file did not load', () => {
  const verdict = helper('loaderVerdict')
  assert.deepEqual(verdict(OUTPUT, FILES, 'tests/control.test.ts'), [])
})

test('loaderVerdict: a refused file that loaded, a file missing from the output, or a control that did not pass are failures', () => {
  const verdict = helper('loaderVerdict')
  const loaded = OUTPUT.replace(refused(FILES[1]), `${FILES[1]}:\n(pass) the loader > loaded a file that imports node:fs [1.00ms]\n`)
  assert.deepEqual(verdict(loaded, FILES, 'tests/control.test.ts'), ['tests/node-fs.test.ts loaded: the loader no longer refuses it'])
  assert.deepEqual(verdict(OUTPUT.replace(refused(FILES[0]), ''), FILES, 'tests/control.test.ts'), ['tests/dynamic-import.test.ts is not in the output'])
  const broken = 'claude plugin test: /tmp/x: no hooks module to load\n'
  assert.deepEqual(verdict(broken, FILES, 'tests/control.test.ts'), [
    'tests/control.test.ts did not pass: the fixture itself is broken',
    'tests/dynamic-import.test.ts is not in the output',
    'tests/node-fs.test.ts is not in the output',
  ])
})

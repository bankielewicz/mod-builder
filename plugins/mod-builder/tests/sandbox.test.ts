import { describe, expect, test } from 'claude-code/testing'

// The sandbox canary (#98, Change 0.2.23). Mod Lab runs `claude plugin test` with no prompt, which is safe only while
// its sandbox holds: this file fails the suite on a build where it doesn't. Its globals are the list gotchas.md
// "Testing and checking" names, and `check-sandbox.mjs` (CI) fails when the two differ. It never imports `node:fs` or
// calls import(): a file that does is refused at load ("(fail) the file did not load"), which a test can't assert of
// itself, so that same CI script checks the loader. The name keeps it out of the node-run coverage command, which
// globs `*-logic.test.ts` and has `process`.

declare const require: (id: string) => unknown

/** gotchas.md "Testing and checking": undefined on `globalThis` in test code (probed 2.1.296, 2.1.301). */
const GLOBALS = ['process', 'Bun', 'Deno', 'fetch', 'WebSocket', 'XMLHttpRequest', 'Worker']

/** What running `run` threw, or `'ran'` when it didn't throw. */
function thrown(run: () => unknown): unknown {
  try {
    run()
    return 'ran'
  } catch (err) {
    return err
  }
}

const nameOf = (err: unknown): string => (err instanceof Error ? err.name : String(err))

/** A function's own constructor, which builds a function of its kind from strings. */
const constructorOf = (fn: unknown) => (fn as { constructor: (...source: string[]) => () => unknown }).constructor

describe('the test sandbox (#98)', () => {
  test('has no file, network or process globals', () => {
    const g = globalThis as Record<string, unknown>
    expect(GLOBALS.filter(name => typeof g[name] !== 'undefined')).toEqual([])
  })

  // `typeof require` reads 'function' here (the transpiler folds it) and `globalThis.require` is always undefined, even
  // where require works (node CommonJS), so only a call tells (PR #108 review).
  test('can not call require', () => {
    expect(nameOf(thrown(() => require('node:fs')))).toBe('ReferenceError')
  })

  // Code from strings is the runtime route to import(). Each route on its own, so one failure doesn't hide the next.
  test('runs no code from strings: the global eval throws EvalError', () => {
    const evaluate = (globalThis as { eval?: unknown }).eval
    // A build without the global eval runs no code through it either.
    expect(typeof evaluate !== 'function' || nameOf(thrown(() => (evaluate as (code: string) => unknown)('1 + 1'))) === 'EvalError').toBe(true)
  })

  test('runs no code from strings: the Function constructor throws EvalError', () => {
    expect(nameOf(thrown(() => new Function('return 1 + 1')()))).toBe('EvalError')
  })

  test('runs no code from strings: the async function constructor throws EvalError', () => {
    expect(nameOf(thrown(() => constructorOf(async () => 0)('return 1')))).toBe('EvalError')
  })

  test('runs no code from strings: the generator function constructor throws EvalError', () => {
    expect(nameOf(thrown(() => constructorOf(function* () {})('yield 1')))).toBe('EvalError')
  })

  test('runs no code from strings: the async generator function constructor throws EvalError', () => {
    expect(nameOf(thrown(() => constructorOf(async function* () {})('yield 1')))).toBe('EvalError')
  })
})

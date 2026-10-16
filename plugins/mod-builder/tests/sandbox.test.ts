import { describe, expect, test } from 'claude-code/testing'

// The sandbox canary (#98, Change 0.2.23). Mod Lab runs `claude plugin test` with no prompt, which is safe only while
// its sandbox holds: this file fails the suite on a build where it doesn't. It checks the list gotchas.md "Testing and
// checking" names; change both together. It never imports `node:fs` or calls import(): a file that does is refused at
// load ("(fail) the file did not load"), which a test can't assert of itself. The name keeps it out of the node-run
// coverage command, which globs `*-logic.test.ts` and has `process`.

/** gotchas.md "Testing and checking": undefined in test code (probed 2.1.296, 2.1.301). */
const GLOBALS = ['process', 'Bun', 'Deno', 'require', 'fetch', 'WebSocket', 'XMLHttpRequest', 'Worker']

/** What running `run` gives: its thrown message, or that it ran. */
function outcome(run: () => unknown): string {
  try {
    run()
    return 'ran'
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

describe('the test sandbox (#98)', () => {
  test('has no file, network or process globals', () => {
    const g = globalThis as Record<string, unknown>
    expect(GLOBALS.filter(name => typeof g[name] !== 'undefined')).toEqual([])
  })

  test('runs no code from strings, the runtime route to import()', () => {
    const evaluate = (globalThis as { eval?: unknown }).eval
    // A build without the global eval runs no code through it either.
    expect(typeof evaluate === 'function' ? outcome(() => (evaluate as (code: string) => unknown)('1 + 1')) : 'no eval').not.toBe('ran')
    expect(outcome(() => new Function('return 1 + 1')())).not.toBe('ran')
  })
})

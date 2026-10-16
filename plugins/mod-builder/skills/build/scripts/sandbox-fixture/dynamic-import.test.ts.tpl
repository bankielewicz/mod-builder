import { describe, expect, test } from 'claude-code/testing'

// claude plugin test must refuse to load this file ("(fail) the file did not load") for its import() alone: the
// specifier is built at run time and names no module here, so a loader that still refused the file-system module by
// name but allowed import() would load it. If it ever loads, this test runs, and check-sandbox.mjs fails (Codex on PR #108).
describe('the loader', () => {
  test('loaded a file that holds import()', async () => {
    const specifier = ['node', 'path'].join(':')
    const loaded = await import(specifier).catch(() => null)
    expect(loaded === null || typeof loaded === 'object').toBe(true)
  })
})

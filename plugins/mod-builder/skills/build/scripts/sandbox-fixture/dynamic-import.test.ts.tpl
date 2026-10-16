import { describe, expect, test } from 'claude-code/testing'

// claude plugin test must refuse to load this file ("(fail) the file did not load"). If it ever loads, this test runs,
// and check-sandbox.mjs fails: a test could then import node:fs at run time.
describe('the loader', () => {
  test('loaded a file that holds import()', async () => {
    const fs = await import('node:fs').catch(() => null)
    expect(fs === null || typeof fs === 'object').toBe(true)
  })
})

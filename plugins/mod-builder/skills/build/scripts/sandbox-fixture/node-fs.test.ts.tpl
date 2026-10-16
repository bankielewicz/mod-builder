import { describe, expect, test } from 'claude-code/testing'
import { readFileSync } from 'node:fs'

// claude plugin test must refuse to load this file ("(fail) the file did not load"). If it ever loads, this test runs,
// and check-sandbox.mjs fails: a test could then read the file system.
describe('the loader', () => {
  test('loaded a file that imports node:fs', () => {
    expect(typeof readFileSync).toBe('function')
  })
})

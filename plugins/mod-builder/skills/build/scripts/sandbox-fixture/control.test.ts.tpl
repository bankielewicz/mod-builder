import { describe, expect, test } from 'claude-code/testing'

// The control: a plain file must load and pass, or the fixture itself is broken and the refusals below prove nothing.
describe('the loader', () => {
  test('loaded a plain file', () => {
    expect(1 + 1).toBe(2)
  })
})

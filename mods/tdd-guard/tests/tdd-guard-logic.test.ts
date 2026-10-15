import { describe, expect, test } from 'claude-code/testing'

import { decide, matchGlob, parseRules } from '../hooks/tdd-guard-logic'

type Rules = Parameters<typeof decide>[0]
type Refusal = { allow: false; reason: string }

/** The `rules` option as the issue gives it. */
const EXAMPLE = 'red-test-writer=+tests/**,+test/**; green-developer=-tests/**,-test/**; refactorer=-tests/**,-test/**'

function rulesOf(text: string): Rules {
  const parsed = parseRules(text) as { rules?: Rules; error?: string }
  expect(parsed.error).toBeUndefined()
  return parsed.rules as Rules
}

describe('parseRules', () => {
  test('reads the issue example: types split on ";", globs on ",", + is an allow-list and - a deny-list', () => {
    expect(parseRules(EXAMPLE)).toEqual({
      rules: {
        'red-test-writer': { allow: ['tests/**', 'test/**'], deny: [] },
        'green-developer': { allow: [], deny: ['tests/**', 'test/**'] },
        refactorer: { allow: [], deny: ['tests/**', 'test/**'] },
      },
    })
  })

  test('a type may carry both + and - globs', () => {
    expect(parseRules('writer=+tests/**,-tests/fixtures/**')).toEqual({
      rules: { writer: { allow: ['tests/**'], deny: ['tests/fixtures/**'] } },
    })
  })

  test('an empty option is no rules, not an error', () => {
    expect(parseRules('')).toEqual({ rules: {} })
    expect(parseRules('   ')).toEqual({ rules: {} })
  })

  test('rejects a malformed entry with a message naming it, and keeps no rules', () => {
    const bad = [
      'green-developer', // no "="
      'green-developer=tests/**', // a glob with neither + nor -
      '=+tests/**', // no agent type
      'green-developer=+', // a sign with no glob
      'green-developer=', // a type with no globs
    ]
    for (const entry of bad) {
      const result = parseRules(entry) as { error?: unknown; rules?: unknown }
      expect(typeof result.error).toBe('string')
      expect(result.error).toContain(entry)
      expect(result.rules).toBeUndefined()
    }
  })

  test('one malformed entry rejects the whole option, even after a good one', () => {
    const result = parseRules('red-test-writer=+tests/**; green-developer=tests/**') as { error?: unknown; rules?: unknown }
    expect(typeof result.error).toBe('string')
    expect(result.error).toContain('green-developer=tests/**')
    expect(result.rules).toBeUndefined()
  })
})

describe('matchGlob', () => {
  test('** is any depth, including none below the folder', () => {
    expect(matchGlob('tests/**', 'tests/a/b.test.ts')).toBe(true)
    expect(matchGlob('tests/**', 'tests/a.test.ts')).toBe(true)
    expect(matchGlob('src/**/x.ts', 'src/a/b/x.ts')).toBe(true)
    expect(matchGlob('**/*.test.ts', 'tests/a/b.test.ts')).toBe(true)
    expect(matchGlob('src/**/x.ts', 'src/a/y.ts')).toBe(false)
  })

  test('* is one segment: it never crosses a "/"', () => {
    expect(matchGlob('tests/*', 'tests/a/b.ts')).toBe(false)
    expect(matchGlob('tests/*', 'tests/a.ts')).toBe(true)
    expect(matchGlob('tests/*.test.ts', 'tests/a.test.ts')).toBe(true)
    expect(matchGlob('tests/*.test.ts', 'tests/a.ts')).toBe(false)
    expect(matchGlob('tests/*.test.ts', 'tests/sub/a.test.ts')).toBe(false)
  })

  test('a glob is relative to the project root: it matches the whole path, not a tail or a prefix of a name', () => {
    expect(matchGlob('tests/**', 'tests/x.ts')).toBe(true)
    expect(matchGlob('tests/**', 'src/tests/a.test.ts')).toBe(false)
    expect(matchGlob('tests/**', 'src/x.ts')).toBe(false)
    expect(matchGlob('tests/**', 'tests-old/a.ts')).toBe(false)
    expect(matchGlob('tests/a.ts', 'tests/a.ts.bak')).toBe(false)
  })

  test('every character but * and ** is literal', () => {
    expect(matchGlob('tests/a.ts', 'tests/a.ts')).toBe(true)
    expect(matchGlob('tests/a.ts', 'tests/aXts')).toBe(false)
    expect(matchGlob('tests/a+b.ts', 'tests/a+b.ts')).toBe(true)
    expect(matchGlob('tests/a+b.ts', 'tests/aab.ts')).toBe(false)
  })
})

describe('decide', () => {
  test('an allow-list type may write only paths matching one of its + globs', () => {
    const rules = rulesOf(EXAMPLE)
    expect(decide(rules, 'red-test-writer', 'tests/a.test.ts')).toEqual({ allow: true })
    expect(decide(rules, 'red-test-writer', 'test/deep/a.test.ts')).toEqual({ allow: true })
    const refused = decide(rules, 'red-test-writer', 'src/x.ts')
    expect(refused).toMatchObject({ allow: false })
    expect(typeof (refused as Refusal).reason).toBe('string')
    expect((refused as Refusal).reason).toContain('tests/**')
  })

  test('a deny-list type may write anything but paths matching one of its - globs, and the reason names the rule', () => {
    const rules = rulesOf(EXAMPLE)
    for (const type of ['green-developer', 'refactorer']) {
      const refused = decide(rules, type, 'tests/a/b.test.ts')
      expect(refused).toMatchObject({ allow: false })
      expect((refused as Refusal).reason).toContain('tests/**')
      expect(decide(rules, type, 'test/x.test.ts')).toMatchObject({ allow: false })
      expect(decide(rules, type, 'src/x.ts')).toEqual({ allow: true })
      expect(decide(rules, type, 'README.md')).toEqual({ allow: true })
    }
  })

  test('a type with both kinds must satisfy both: inside a + glob and outside every - glob', () => {
    const rules = rulesOf('writer=+tests/**,-tests/fixtures/**')
    expect(decide(rules, 'writer', 'tests/a.test.ts')).toEqual({ allow: true })
    expect(decide(rules, 'writer', 'tests/fixtures/x.json')).toMatchObject({ allow: false })
    expect(decide(rules, 'writer', 'src/x.ts')).toMatchObject({ allow: false })
  })

  test('a type with no rule may write anywhere, whatever its name', () => {
    const rules = rulesOf(EXAMPLE)
    expect(decide(rules, 'Explore', 'tests/a.test.ts')).toEqual({ allow: true })
    expect(decide(rules, 'general-purpose', 'src/x.ts')).toEqual({ allow: true })
    expect(decide(rules, 'constructor', 'tests/a.test.ts')).toEqual({ allow: true })
    expect(decide(rules, 'toString', 'tests/a.test.ts')).toEqual({ allow: true })
    expect(decide({}, 'green-developer', 'tests/a.test.ts')).toEqual({ allow: true })
  })

  test('a path outside the project is refused for a type with + rules and passed for one with only - rules', () => {
    const rules = rulesOf(EXAMPLE)
    expect(decide(rules, 'red-test-writer', '../elsewhere/tests/x.test.ts')).toMatchObject({ allow: false })
    expect(decide(rules, 'green-developer', '../elsewhere/tests/x.test.ts')).toEqual({ allow: true })
    expect(decide(rules, 'refactorer', '../elsewhere/x.ts')).toEqual({ allow: true })
  })
})

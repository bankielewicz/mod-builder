import { describe, expect, test } from 'claude-code/testing'

import { changesOf, decide, folderOf, hashOf, launchedId, matchGlob, parseRules, relativeTo, reportOf, withoutId } from '../hooks/tdd-guard-logic'

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

describe('relativeTo', () => {
  test('a path under the root loses the root; one outside it starts with ../', () => {
    expect(relativeTo('/w', '/w/tests/a.test.ts')).toBe('tests/a.test.ts')
    expect(relativeTo('/w', '/elsewhere/tests/y.ts')).toBe('../elsewhere/tests/y.ts')
    expect(relativeTo('/w', '/wider/x.ts')).toBe('../wider/x.ts')
  })

  test('backslashes read as /, so a Windows path is placed the same way', () => {
    expect(relativeTo('C:/w', 'C:\\w\\tests\\a.test.ts')).toBe('tests/a.test.ts')
  })
})

describe('hashOf', () => {
  test('the same text gives the same hash, and any change gives another', () => {
    expect(hashOf('A')).toBe(hashOf('A'))
    expect(hashOf('A')).not.toBe(hashOf('B'))
    expect(hashOf('AB')).not.toBe(hashOf('BA'))
    expect(hashOf('')).toBe('0.811c9dc5.9e3779b9')
  })
})

describe('folderOf', () => {
  test("a glob's folder is its segments before the first wildcard", () => {
    expect(folderOf('tests/**')).toBe('tests')
    expect(folderOf('tests/unit/*.test.ts')).toBe('tests/unit')
    expect(folderOf('**/*.test.ts')).toBe('')
  })

  test('a glob with no wildcard names one file: its folder', () => {
    expect(folderOf('tests/fixtures/data.json')).toBe('tests/fixtures')
    expect(folderOf('package.json')).toBe('')
  })
})

describe('changesOf', () => {
  test('names each file modified, deleted or new, in path order; an unchanged file is left out', () => {
    const before = new Map([['tests/b.ts', '1'], ['tests/a.ts', '1'], ['tests/same.ts', '1']])
    const after = new Map([['tests/a.ts', '2'], ['tests/same.ts', '1'], ['tests/0.ts', '1']])
    expect(changesOf(before, after)).toEqual(['tests/0.ts (new)', 'tests/a.ts (modified)', 'tests/b.ts (deleted)'])
  })

  test('changes already in path order stay in it', () => {
    const before = new Map([['tests/a.ts', '1'], ['tests/b.ts', '1'], ['tests/c.ts', '1']])
    expect(changesOf(before, new Map())).toEqual(['tests/a.ts (deleted)', 'tests/b.ts (deleted)', 'tests/c.ts (deleted)'])
  })

  test('two equal snapshots have no changes', () => {
    expect(changesOf(new Map([['tests/a.ts', '1']]), new Map([['tests/a.ts', '1']]))).toEqual([])
  })
})

describe('reportOf', () => {
  test('names the type and every change; nothing changed is no line', () => {
    expect(reportOf('green-developer', ['tests/a.ts (modified)', 'tests/b.ts (deleted)'])).toBe(
      'tdd-guard: green-developer changed protected test files: tests/a.ts (modified), tests/b.ts (deleted)',
    )
    expect(reportOf('green-developer', [])).toBeNull()
  })
})

describe('launchedId', () => {
  test('a background or teammate launch gives its agent id; a finished run, or one with no id, gives none', () => {
    expect(launchedId({ status: 'async_launched', agentId: 'a7' })).toBe('a7')
    expect(launchedId({ status: 'teammate_spawned', agentId: 't1' })).toBe('t1')
    expect(launchedId({ status: 'completed', agentId: 'a1' })).toBeNull()
    expect(launchedId({ status: 'async_launched' })).toBeNull()
    expect(launchedId({})).toBeNull()
    expect(launchedId(undefined)).toBeNull()
  })
})

describe('withoutId', () => {
  test("drops one agent's record and keeps the rest", () => {
    expect(withoutId({ a7: 'green-developer', a8: 'refactorer' }, 'a7')).toEqual({ a8: 'refactorer' })
    expect(withoutId({ a8: 'refactorer' }, 'a7')).toEqual({ a8: 'refactorer' })
  })
})

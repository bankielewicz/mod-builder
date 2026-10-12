import { describe, expect, test } from 'claude-code/testing'

import { bandParts, parseStatus, textOf } from '../hooks/git-branch-logic'

const OID = '0123456789abcdef0123456789abcdef01234567'

describe('git-branch-logic', () => {
  test('reads branch, ahead/behind and changed entries', () => {
    const out = [
      `# branch.oid ${OID}`,
      '# branch.head feature/x',
      '# branch.upstream origin/feature/x',
      '# branch.ab +2 -1',
      '1 .M N... 100644 100644 100644 aaa bbb src/a.ts',
      '1 A. N... 000000 100644 100644 000 ccc src/b.ts',
      '? notes.txt',
      '',
    ].join('\n')
    expect(parseStatus(0, out, '')).toEqual({ kind: 'branch', branch: 'feature/x', ahead: 2, behind: 1, changed: 3 })
  })

  test('detached, unborn, no upstream, not a repo, and failure', () => {
    expect(parseStatus(0, `# branch.oid ${OID}\n# branch.head (detached)\n`, '')).toEqual({ kind: 'detached', oid: '0123456', changed: 0 })
    expect(parseStatus(0, '# branch.oid (initial)\n# branch.head master\n? a\n', '')).toEqual({ kind: 'unborn', branch: 'master', changed: 1 })
    expect(parseStatus(0, `# branch.oid ${OID}\n# branch.head main\n`, '')).toEqual({ kind: 'branch', branch: 'main', ahead: 0, behind: 0, changed: 0 })
    expect(parseStatus(128, '', 'fatal: not a git repository (or any of the parent directories): .git\n')).toEqual({ kind: 'none' })
    expect(parseStatus(1, '', 'fatal: bad config\nmore')).toEqual({ kind: 'error', message: 'fatal: bad config' })
  })

  test('the line always names the branch, or says detached / no commits', () => {
    expect(textOf(bandParts({ kind: 'branch', branch: 'main', ahead: 0, behind: 0, changed: 0 }, 80))).toBe('⎇ main')
    expect(textOf(bandParts({ kind: 'branch', branch: 'main', ahead: 2, behind: 1, changed: 3 }, 80))).toBe('⎇ main  ·  3 changed  ·  ↑2 ↓1')
    expect(textOf(bandParts({ kind: 'branch', branch: 'main', ahead: 0, behind: 4, changed: 0 }, 80))).toBe('⎇ main  ·  ↓4')
    expect(textOf(bandParts({ kind: 'detached', oid: 'a1b2c3d', changed: 0 }, 80))).toBe('⎇ detached @ a1b2c3d')
    expect(textOf(bandParts({ kind: 'unborn', branch: 'master', changed: 0 }, 80))).toBe('⎇ master  ·  no commits yet')
    expect(bandParts({ kind: 'none' }, 80)).toEqual([])
    expect(bandParts({ kind: 'error', message: 'x' }, 80)).toEqual([])
    expect(bandParts(null, 80)).toEqual([])
  })

  test('narrow shows branch only; long names are cut to fit', () => {
    const s = { kind: 'branch', branch: 'main', ahead: 2, behind: 1, changed: 3 } as const
    expect(textOf(bandParts(s, 30))).toBe('⎇ main')
    const long = textOf(bandParts({ ...s, branch: 'x'.repeat(200) }, 40))
    expect(long.length).toBeLessThanOrEqual(40)
    expect(long.endsWith('…')).toBe(true)
  })
})

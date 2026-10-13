/**
 * Git Branch's rules, free of `$` so tests can call them.
 */

import type { Snapshot } from '../types'

export type { Snapshot }

/** One coloured run of the band's line. */
export type Part = { text: string; role: 'accent' | 'warn' | 'dim' }

const SEP = '  ·  '
const COMPACT_BELOW = 40

/** The argv the mod runs; read-only, never takes the index lock. */
export const GIT_ARGV = ['git', '--no-optional-locks', 'status', '--porcelain=v2', '--branch'] as const

/** Reads `git status --porcelain=v2 --branch` output, or its failure, into a Snapshot. */
export function parseStatus(exitCode: number, stdout: string, stderr: string): Snapshot {
  if (exitCode !== 0) {
    if (/not a git repository/i.test(stderr)) return { kind: 'none' }
    const first = stderr.trim().split('\n')[0] || `exit code ${exitCode}`
    return { kind: 'error', message: first }
  }
  let head = ''
  let oid = ''
  let ahead = 0
  let behind = 0
  let changed = 0
  for (const line of stdout.split('\n')) {
    if (line.startsWith('# branch.head ')) head = line.slice(14).trim()
    else if (line.startsWith('# branch.oid ')) oid = line.slice(13).trim()
    else if (line.startsWith('# branch.ab ')) {
      const m = line.match(/\+(\d+) -(\d+)/)
      if (m) { ahead = Number(m[1]); behind = Number(m[2]) }
    } else if (line && !line.startsWith('#')) changed++
  }
  if (oid === '(initial)') return { kind: 'unborn', branch: head, changed }
  if (head === '(detached)') return { kind: 'detached', oid: oid.slice(0, 7), changed }
  return { kind: 'branch', branch: head, ahead, behind, changed }
}

/** Cuts `text` to `max` characters, ending in `…` when cut. */
export function fit(text: string, max: number): string {
  if (max <= 0) return ''
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

/** The band's line as coloured parts, at most `columns` characters; empty when nothing to draw. */
export function bandParts(s: Snapshot | null, columns: number): Part[] {
  if (!s || s.kind === 'none' || s.kind === 'error' || columns < 3) return []
  const glyph = '⎇ '
  const room = columns - glyph.length
  const name = s.kind === 'detached' ? `detached @ ${s.oid}` : s.branch
  const head: Part[] = [{ text: glyph, role: 'accent' }, { text: fit(name, room), role: s.kind === 'detached' ? 'warn' : 'accent' }]
  if (columns < COMPACT_BELOW) return head

  const extras: Part[] = []
  if (s.kind === 'unborn') extras.push({ text: 'no commits yet', role: 'dim' })
  if (s.changed > 0) extras.push({ text: `${s.changed} changed`, role: 'warn' })
  if (s.kind === 'branch' && (s.ahead || s.behind)) {
    extras.push({ text: [s.ahead ? `↑${s.ahead}` : '', s.behind ? `↓${s.behind}` : ''].filter(Boolean).join(' '), role: 'dim' })
  }
  const out = [...head]
  let used = glyph.length + fit(name, room).length
  for (const x of extras) {
    if (used + SEP.length + x.text.length > columns) break
    out.push({ text: SEP, role: 'dim' }, x)
    used += SEP.length + x.text.length
  }
  return out
}

/** The parts as plain text, for tests and the command's reply. */
export function textOf(parts: Part[]): string {
  return parts.map(p => p.text).join('')
}

/** The four states the demo draws. */
export const DEMO: Snapshot[] = [
  { kind: 'branch', branch: 'main', ahead: 0, behind: 0, changed: 0 },
  { kind: 'branch', branch: 'feature/login-flow', ahead: 2, behind: 1, changed: 3 },
  { kind: 'detached', oid: 'a1b2c3d', changed: 0 },
  { kind: 'unborn', branch: 'master', changed: 0 },
]

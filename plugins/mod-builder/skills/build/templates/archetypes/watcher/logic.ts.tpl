/**
 * __TITLE__'s rules, free of `$` so tests can call them.
 */

import type { Stats } from '../types'

export type { Stats }

export const EMPTY: Stats = { turns: 0, tools: 0, failed: 0, turnStartedAt: null }

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

/** The status line; undefined (cleared) before the first turn. */
export function statusOf(stats: Stats): string | undefined {
  if (stats.turns === 0 && stats.tools === 0) return undefined
  const failed = stats.failed ? ` · ${stats.failed} failed` : ''
  return `◆ ${plural(stats.turns, 'turn')} · ${plural(stats.tools, 'tool call')}${failed}`
}

/** `12m 05s`, `45s`. */
export function elapsedOf(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(seconds / 60)
  return minutes ? `${minutes}m ${String(seconds % 60).padStart(2, '0')}s` : `${seconds}s`
}

/** The toast for a finished turn, or null when it was quick. */
export function slowTurnToastOf(durationMs: number, slowSeconds: number): string | null {
  return durationMs >= slowSeconds * 1000 ? `That turn took ${elapsedOf(durationMs)}` : null
}

/** Reads the `slowSeconds` option defensively; 120 when absent or nonsense. */
export function slowSecondsOf(options: unknown): number {
  const value = Number((options as Record<string, unknown> | undefined)?.slowSeconds)
  return Number.isFinite(value) && value > 0 ? value : 120
}

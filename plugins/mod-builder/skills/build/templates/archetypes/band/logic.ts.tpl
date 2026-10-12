/**
 * __TITLE__'s rules, free of `$` so tests can call them.
 */

import type { Turn } from '../types'

export type { Turn }

/** The band's one line, cut to `columns`; empty when there is nothing to say. */
export function bandTextOf(turn: Turn | null, columns: number): string {
  if (!turn || turn.tools === 0) return ''
  const calls = `${turn.tools} tool call${turn.tools === 1 ? '' : 's'}`
  const failed = turn.failures ? ` · ${turn.failures} failed` : ''
  return `◆ __NAME__  ${calls} this turn${failed}`.slice(0, Math.max(0, columns))
}

/** One more call, failed or not. */
export function countCall(turn: Turn | null, isError: boolean): Turn {
  const base = turn ?? { tools: 0, failures: 0 }
  return { tools: base.tools + 1, failures: base.failures + (isError ? 1 : 0) }
}

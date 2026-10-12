/**
 * __TITLE__'s rules, free of `$` so tests can call them.
 */

import type { Item } from '../types'

export type { Item }

export const DEMO_ITEMS: Item[] = [
  { id: 'a', label: 'Read the SPEC', isDone: true },
  { id: 'b', label: 'Write the logic and its tests', isDone: true },
  { id: 'c', label: 'Draw the pane', isDone: false },
  { id: 'd', label: 'Run validate and test', isDone: false },
]

/** `2 of 4 done`, or the empty state's line. */
export function summaryOf(items: readonly Item[]): string {
  if (items.length === 0) return 'Nothing here yet.'
  return `${items.filter(item => item.isDone).length} of ${items.length} done`
}

/** Selection after moving `by`, wrapping. */
export function moved(selected: number, by: number, count: number): number {
  return count === 0 ? 0 : (((selected + by) % count) + count) % count
}

/** The list with one item flipped. */
export function toggled(items: readonly Item[], at: number): Item[] {
  return items.map((item, index) => (index === at ? { ...item, isDone: !item.isDone } : item))
}

/** How many rows fit, leaving room for the header and buttons. */
export function rowsThatFit(bodyRows: number): number {
  return Math.max(1, bodyRows - 5)
}

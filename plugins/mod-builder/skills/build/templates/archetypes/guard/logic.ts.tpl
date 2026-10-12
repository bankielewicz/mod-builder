/**
 * __TITLE__'s rules, free of `$` so tests can call them.
 */

import type { Decision } from '../types'

export type { Decision }

export type Risk = { reason: string }

/** The command with quoted text blanked, so `echo "rm -rf /"` is not judged as rm. */
export function unquoted(command: string): string {
  return command.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, "''")
}

const RULES: { test: RegExp; reason: string }[] = [
  { test: /\brm\s+(-\w*r\w*f|-\w*f\w*r|-r\s+-f|-f\s+-r|--recursive)\b/, reason: 'deletes files recursively' },
  { test: /\bgit\s+push\b.*\s(--force(?!-with-lease)|-f)\b/, reason: 'force-pushes over remote history' },
  { test: /\bgit\s+reset\s+--hard\b/, reason: 'throws away uncommitted work' },
  { test: /\bgit\s+clean\s+-\w*f/, reason: 'deletes untracked files' },
  { test: /\b(drop|truncate)\s+(table|database|schema)\b/i, reason: 'drops data from a database' },
  { test: /\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba|z)?sh\b/, reason: 'runs a script straight from the network' },
]

/** Why a shell command needs the person's yes, or null when it does not. */
export function riskOf(command: string): Risk | null {
  const plain = unquoted(command)
  const rule = RULES.find(one => one.test.test(plain))
  return rule ? { reason: rule.reason } : null
}

export const ALLOW = 'Allow once'
export const DENY = 'Deny'

/** The question the person answers. */
export function questionOf(command: string, risk: Risk): string {
  const shown = command.length > 120 ? `${command.slice(0, 117)}...` : command
  return `Claude wants to run a command that ${risk.reason}:\n\n  ${shown}\n\nAllow it once?`
}

/** The deny reason, addressed to Claude. */
export function denyOf(risk: Risk): string {
  return `__NAME__: the person declined a command that ${risk.reason}. Do not retry it; ask them how to proceed.`
}

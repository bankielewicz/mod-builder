import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { bandParts, DEMO, GIT_ARGV, parseStatus, textOf } from './git-branch-logic'
import type { Part, Snapshot } from './git-branch-logic'

/**
 * Git Branch: a band above the prompt naming the current git branch.
 * Archetype: band. It refreshes at session start, after Bash calls and at
 * the end of each main-loop turn; it hides outside a repository.
 */

const COLORS = { accent: '#D97757', warn: '#E0B15A' } as const

const snapshot = atom({ plugin: 'git-branch', key: 'snapshot' } as const, null)
const isHidden = atom({ plugin: 'git-branch', key: 'isHidden' } as const, false)
const isDemo = atom({ plugin: 'git-branch', key: 'isDemo' } as const, false)

let inFlight: Promise<Snapshot> | null = null
let queued: Promise<Snapshot> | null = null

async function readGit($: EngineInterface): Promise<Snapshot> {
  let next: Snapshot
  try {
    const r = await $.process.run(GIT_ARGV, { timeoutMs: 5000 })
    next = parseStatus(r.exitCode, r.stdout, r.stderr)
  } catch (err) {
    next = { kind: 'error', message: String((err as Error)?.message ?? err).split('\n')[0] ?? 'unknown error' }
  }
  await update($, snapshot, () => next)
  return next
}

/**
 * One git read at a time. A caller during a read gets one fresh read queued
 * after it (shared by every caller who asks meanwhile), never the read that
 * started before their change.
 */
async function refresh($: EngineInterface): Promise<Snapshot> {
  if (!inFlight) {
    inFlight = readGit($).finally(() => { inFlight = null })
    return inFlight
  }
  if (!queued) {
    queued = inFlight
      .catch(() => undefined)
      .then(() => {
        queued = null
        return refresh($)
      })
  }
  return queued
}

async function describeNow($: EngineInterface): Promise<string> {
  const s = await refresh($)
  if (s.kind === 'none') return 'not inside a git repository.'
  if (s.kind === 'error') return `git failed: ${s.message}`
  return textOf(bandParts(s, 200))
}

/** The person's hide or show, kept in the module: /clear, /resume and /branch reset the atom (#119). */
let hiddenKept = false
/** Set by session.start: a resumed startup fires classic.SessionStart before it (probed on 2.1.296 and 2.1.306, #119). */
let hasStarted = false

/** The only writer of isHidden: the atom and the module's copy. */
async function setHidden($: EngineInterface, hidden: boolean): Promise<void> {
  hiddenKept = hidden
  await update($, isHidden, () => hidden)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command
      .register({ name: 'git-branch', description: 'A band above the prompt showing the current git branch', argumentHint: '[demo | hide | show | refresh]' })
      .catch(() => undefined)
    const started = await next(e)
    // A reload starts the module afresh and keeps the atoms: a hide from before it is kept too (Codex P2, PR #127).
    hiddenKept = await read($, isHidden).catch(() => false)
    hasStarted = true
    void refresh($).catch(() => undefined)
    return started
  })

  // /clear, /resume and /branch reset every atom and don't run session.start (#119): a hidden band stays hidden, and the
  // branch is read again, detached. Startup and compaction reset nothing.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    if (hasStarted) {
      if (hiddenKept) await update($, isHidden, () => true).catch(() => undefined)
      void refresh($).catch(() => undefined)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'git-branch' }, async ($, e) => {
    try {
      const word = e.args.trim().toLowerCase()
      if (word === 'demo') {
        await setHidden($, false)
        await update($, isDemo, () => true)
        return { text: 'four sample states are above the prompt until this turn ends.' }
      }
      if (word === 'hide' || word === 'show') {
        await setHidden($, word === 'hide')
        return { text: `band ${word === 'hide' ? 'hidden' : 'shown'}.` }
      }
      if (word === '' || word === 'refresh') return { text: await describeNow($) }
      return { text: 'Usage: /git-branch [demo | hide | show | refresh]' }
    } catch {
      return { text: 'something went wrong; see claude --debug.' }
    }
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    void refresh($).catch(() => undefined)
    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId) return next(e)
    await update($, isDemo, () => false)
    void refresh($).catch(() => undefined)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rest = await next(e)
    try {
      if (e.props.hasSurvey || e.props.maxRows < 1 || (await read($, isHidden))) return rest
      const width = e.props.bodyColumns - 2
      const lines: Part[][] = (await read($, isDemo))
        ? DEMO.slice(0, Math.max(1, e.props.maxRows - 1)).map(s => bandParts(s, width))
        : [bandParts(await read($, snapshot), width)]
      if (!lines.some(l => l.length)) return rest
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box flexDirection="column">
          {lines.map((parts, i) => (
            <Box key={String(i)} paddingX={1}>
              <Text>
                {parts.map((p, j) =>
                  p.role === 'dim'
                    ? <Text key={String(j)} dimColor>{p.text}</Text>
                    : <Text key={String(j)} color={COLORS[p.role]}>{p.text}</Text>,
                )}
              </Text>
            </Box>
          ))}
          {rest}
        </Box>
      )
    } catch {
      return rest
    }
  })
}

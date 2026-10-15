import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { changesOf, decide, folderOf, hashOf, launchedId, matchGlob, parseRules, relativeTo, reportOf, withoutId } from './tdd-guard-logic'
import type { Files, Rules } from './tdd-guard-logic'

/**
 * Tdd Guard: limits which paths each subagent type may write. Archetype: guard.
 * Edit, Write and NotebookEdit calls from a subagent whose type has rules are judged before they run and refused
 * with a reason addressed to Claude. A shell can still write files, so an Agent call of a type with `-` rules is
 * wrapped: the files under those globs are hashed before it starts and again when it finishes, and a difference is
 * reported to the model and the person. That check detects; it does not prevent.
 */

/** Guarded background runs still going, by agent id: what lets a reload that lost their snapshot be said out loud. */
const pending = atom({ plugin: 'tdd-guard', key: 'pending' } as const, {} as Record<string, string>)

/** The `rules` option, read at each load. A malformed one leaves no rules and its message in `rulesError`. */
let rules: Rules = {}
let rulesError: string | null = null
/** The snapshots of guarded background runs by agent id; a plugin reload loses them. */
const snapshots = new Map<string, { type: string; files: Files }>()

const SKIPPED = new Set(['.git', 'node_modules'])
/** What a subagent's write gets when the check itself broke: a guard fails closed. */
const HELD = 'tdd-guard: the write check failed, so the write was held. Ask the person before retrying.'

// ── Where a write lands ──────────────────────────────────────────────────

/** The project root as the file system spells it, `/` between segments and none at the end. */
async function rootOf($: EngineInterface): Promise<string> {
  const root = await $.session.root()
  const stat = await $.fs.stat(root, { resolve: true }).catch(() => undefined)
  return (stat?.realPath ?? root).replace(/\\/g, '/').replace(/\/+$/, '')
}

/** Where a path lands, the file's own spot or its folder's plus the name for a file not there yet; undefined when that cannot be told. */
async function placed($: EngineInterface, path: string): Promise<string | undefined> {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  const name = path.slice(cut + 1)
  const isPlaceable =
    !/^[A-Za-z]:(?![\\/])/.test(path) && !/^[\\/][\\/]/.test(path) && !/^[A-Za-z]:/.test(name) && name !== '' && name !== '.' && name !== '..'
  if (!isPlaceable) return undefined
  const own = await $.fs.stat(path, { resolve: true }).catch(() => undefined)
  if (own) return own.realPath
  const dir = await $.fs.stat(cut < 0 ? '.' : path.slice(0, cut + 1), { resolve: true }).catch(() => undefined)
  return dir?.realPath === undefined ? undefined : `${dir.realPath.replace(/[\\/]$/, '')}/${name}`
}

/** Why this subagent may not write `path`, or null when it may. The main loop and agents the engine does not list are never guarded. */
async function refusalOf($: EngineInterface, agentId: string | undefined, path: string): Promise<string | null> {
  if (agentId === undefined) return null
  if (rulesError !== null) return rulesError
  const type = (await $.agent.list()).find(agent => agent.id === agentId)?.type
  if (type === undefined || !Object.hasOwn(rules, type)) return null
  const real = await placed($, path)
  if (real === undefined) return `tdd-guard: ${type} may not write ${path} (tdd-guard cannot tell where it lands)`
  const rel = relativeTo(await rootOf($), real)
  const verdict = decide(rules, type, rel)
  return verdict.allow ? null : `tdd-guard: ${type} may not write ${rel} (${verdict.reason})`
}

// ── Test-file integrity ──────────────────────────────────────────────────

/** The `-` globs of a type: what a run of it must leave alone. None when the type is not guarded or the rules do not parse. */
function protectedGlobs(type: string): string[] {
  return Object.hasOwn(rules, type) ? rules[type]!.deny : []
}

/** Hashes the files below `dir` that a glob matches. A file already hashed is skipped: globs like `tests/**` and `tests/sub/**` walk the same folder twice. */
async function walk($: EngineInterface, root: string, dir: string, globs: string[], files: Files): Promise<void> {
  const entries = await $.fs.list(dir === '' ? root : `${root}/${dir}`).catch(() => [])
  for (const entry of entries) {
    const rel = dir === '' ? entry.name : `${dir}/${entry.name}`
    if (entry.kind === 'dir') {
      if (!SKIPPED.has(entry.name)) await walk($, root, rel, globs, files)
    } else if (entry.kind === 'file' && !files.has(rel) && globs.some(glob => matchGlob(glob, rel))) {
      files.set(rel, await $.fs.read(`${root}/${rel}`).then(hashOf, () => `${entry.size}:${entry.mtimeMs}`))
    }
  }
}

/** Every file under the globs, hashed. A folder that is not there holds none. */
async function snapshotOf($: EngineInterface, globs: string[]): Promise<Files> {
  const root = await rootOf($)
  const files: Files = new Map()
  for (const dir of new Set(globs.map(folderOf))) await walk($, root, dir, globs, files)
  return files
}

/** A background run's first turn ended: say what it changed, or that it could not be checked. */
async function finish($: EngineInterface, agentId: string): Promise<void> {
  // The snapshot first: the pending record may still be on its way when the first turn ends.
  const kept = snapshots.get(agentId)
  const type = kept?.type ?? (await read($, pending))[agentId]
  if (type === undefined) return
  snapshots.delete(agentId)
  await update($, pending, all => withoutId(all, agentId))
  const line = kept
    ? reportOf(type, changesOf(kept.files, await snapshotOf($, protectedGlobs(type))))
    : `tdd-guard: ${type} finished, but its test files could not be checked (reloaded)`
  if (line === null) return
  $.ui.toast(line)
  void $.prompt.submit({ text: line }).catch(() => undefined)
}

export const register: Register = (on, raw) => {
  const option = parseRules(String((raw as { rules?: unknown } | undefined)?.rules ?? ''))
  rules = 'rules' in option ? option.rules : {}
  rulesError = 'error' in option ? `${option.error}; subagent writes are held until the rules option is fixed` : null

  // A malformed option holds every subagent write: say so before the first one is refused.
  on('session.start', async ($, e, next) => {
    if (rulesError !== null) $.ui.toast(rulesError)
    return next(e)
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const refusal = await refusalOf($, e.agentId, e.file_path)
    return refusal === null ? next(e) : { deny: refusal }
  }).catch(($, e, next) => (next.called || e.agentId === undefined ? next(e) : { deny: HELD }))

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const refusal = await refusalOf($, e.agentId, e.file_path)
    return refusal === null ? next(e) : { deny: refusal }
  }).catch(($, e, next) => (next.called || e.agentId === undefined ? next(e) : { deny: HELD }))

  on('tool.call', { tool: 'NotebookEdit' }, async ($, e, next) => {
    const refusal = await refusalOf($, e.agentId, e.notebook_path)
    return refusal === null ? next(e) : { deny: refusal }
  }).catch(($, e, next) => (next.called || e.agentId === undefined ? next(e) : { deny: HELD }))

  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const type = e.subagent_type?.trim() ?? ''
    const globs = protectedGlobs(type)
    if (globs.length === 0) return next(e)
    const before = await snapshotOf($, globs)
    const ran = await next(e)
    if (ran.deny !== undefined) return ran
    const later = launchedId(ran.result)
    if (later !== null) {
      snapshots.set(later, { type, files: before })
      await update($, pending, all => ({ ...all, [later]: type }))
      // Its first turn ended while that write was in flight, so finish() has checked it already: drop the record again.
      if (!snapshots.has(later)) await update($, pending, all => withoutId(all, later))
      return ran
    }
    const line = reportOf(type, changesOf(before, await snapshotOf($, globs)))
    if (line === null) return ran
    $.ui.toast(line)
    return { ...ran, context: [...(ran.context ?? []), line] }
  }).catch(($, e, next) => {
    // The agent still runs (or keeps what it gave): a broken check never stops one. But the person hears it went unchecked.
    const type = e.subagent_type?.trim() ?? ''
    if (protectedGlobs(type).length > 0) {
      try {
        $.ui.toast(`tdd-guard: ${type}'s test files could not be checked (the check failed)`)
      } catch {
        // Re-entry: this handler's own $ calls reject.
      }
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) await finish($, e.agentId).catch(() => undefined)
    return next(e)
  })
}

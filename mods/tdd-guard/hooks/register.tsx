import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { decide, matchGlob, parseRules } from './tdd-guard-logic'
import type { Rules } from './tdd-guard-logic'

/**
 * Tdd Guard: limits which paths each subagent type may write. Archetype: guard.
 * Edit, Write and NotebookEdit calls from a subagent whose type has rules are judged before they run and refused
 * with a reason addressed to Claude. A shell can still write files, so an Agent call of a type with `-` rules is
 * wrapped: the files under those globs are hashed before it starts and again when it finishes, and a difference is
 * reported to the model and the person. That check detects; it does not prevent.
 *
 * The helpers below (hash, diff, report line) are pure but live here, not in tdd-guard-logic.ts: the coverage
 * command runs the logic tests alone, which reach only parseRules, matchGlob and decide, and ui.test.tsx covers these.
 */

/** Guarded background runs still going, by agent id: what lets a reload that lost their snapshot be said out loud. */
const pending = atom({ plugin: 'tdd-guard', key: 'pending' } as const, {} as Record<string, string>)

/** Content hash by project-relative path. */
type Files = Map<string, string>

/** The `rules` option, read at each load. A malformed one leaves no rules and its message in `rulesError`. */
let rules: Rules = {}
let rulesError: string | null = null
/** The snapshots of guarded background runs by agent id; a plugin reload loses them. */
const snapshots = new Map<string, { type: string; files: Files }>()

const SKIPPED = new Set(['.git', 'node_modules'])
const LAUNCHED = new Set(['async_launched', 'teammate_spawned'])
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

/** The path relative to the root; one outside it starts with `../`. */
function relativeTo(root: string, real: string): string {
  const path = real.replace(/\\/g, '/')
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : `../${path.replace(/^\/+/, '')}`
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

/** A short hash of a file's text and its length, to tell a changed file from an unchanged one. */
function hashOf(text: string): string {
  let a = 0x811c9dc5
  let b = 0x9e3779b9
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    a = Math.imul(a ^ code, 0x01000193) >>> 0
    b = Math.imul((b + code) ^ (b >>> 15), 0x85ebca6b) >>> 0
  }
  return `${text.length}.${a.toString(16)}.${b.toString(16)}`
}

/** The `-` globs of a type: what a run of it must leave alone. None when the type is not guarded or the rules do not parse. */
function protectedGlobs(type: string): string[] {
  return Object.hasOwn(rules, type) ? rules[type]!.deny : []
}

/** The folder a glob's matches sit under: its segments before the first wildcard (a glob with none: its folder). */
function folderOf(glob: string): string {
  const segments = glob.split('/')
  const wild = segments.findIndex(segment => segment.includes('*'))
  return segments.slice(0, wild < 0 ? -1 : wild).join('/')
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

/** What a run did to the files: `path (modified | deleted | new)`, in path order. */
function changesOf(before: Files, after: Files): string[] {
  const changes: [string, string][] = []
  for (const [path, hash] of before) {
    const now = after.get(path)
    if (now === undefined) changes.push([path, 'deleted'])
    else if (now !== hash) changes.push([path, 'modified'])
  }
  for (const path of after.keys()) if (!before.has(path)) changes.push([path, 'new'])
  return changes.sort(([a], [b]) => (a < b ? -1 : 1)).map(([path, kind]) => `${path} (${kind})`)
}

/** The line the model reads, or null when nothing changed. */
function reportOf(type: string, changes: string[]): string | null {
  return changes.length === 0 ? null : `tdd-guard: ${type} changed protected test files: ${changes.join(', ')}`
}

/** The id of a subagent that answers later (background or teammate), else null. */
function launchedId(result: unknown): string | null {
  const launched = result as { status?: string; agentId?: string } | undefined
  return launched && LAUNCHED.has(launched.status ?? '') && launched.agentId ? launched.agentId : null
}

/** The pending records without one agent's. */
function withoutId(all: Record<string, string>, agentId: string): Record<string, string> {
  return Object.fromEntries(Object.entries(all).filter(([id]) => id !== agentId))
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

/**
 * Tdd Guard's rules, free of `$` so tests can call them: the `rules` option, a glob, the verdict on one path, and the
 * integrity check's hash, diff and report line.
 */

/** One subagent type's globs: `+` globs are an allow-list, `-` globs a deny-list. */
export type Rule = { allow: string[]; deny: string[] }
export type Rules = Record<string, Rule>
export type Decision = { allow: true } | { allow: false; reason: string }

/** Reads `type=+glob,-glob; type=…`: one malformed entry rejects the whole option, so no rule is half applied. */
export function parseRules(text: string): { rules: Rules } | { error: string } {
  const rules = new Map<string, Rule>()
  for (const entry of text.split(';').map(part => part.trim()).filter(part => part !== '')) {
    const at = entry.indexOf('=')
    const globs = entry.slice(at + 1).split(',').map(glob => glob.trim())
    if (at < 1 || globs.some(glob => !/^[+-]./.test(glob))) {
      return { error: `tdd-guard: malformed rule "${entry}" (expected <type>=+glob,-glob, each glob led by + or -)` }
    }
    const type = entry.slice(0, at).trim()
    const rule = rules.get(type) ?? { allow: [], deny: [] }
    for (const glob of globs) rule[glob.startsWith('+') ? 'allow' : 'deny'].push(glob.slice(1))
    rules.set(type, rule)
  }
  return { rules: Object.fromEntries(rules) }
}

/** A glob against a path relative to the project root: `*` is one segment, `**` any depth, anything else is literal. */
export function matchGlob(glob: string, relPath: string): boolean {
  let source = ''
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i]!
    if (char !== '*') {
      source += char.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    } else if (glob[i + 1] !== '*') {
      source += '[^/]*'
    } else if (glob[i + 2] === '/') {
      source += '(?:.*/)?'
      i += 2
    } else {
      source += '.*'
      i += 1
    }
  }
  return new RegExp(`^${source}$`).test(relPath)
}

/** May this type write this path (relative to the project root; one starting with `../` is outside it)? */
export function decide(rules: Rules, type: string, relPath: string): Decision {
  if (!Object.hasOwn(rules, type)) return { allow: true }
  const rule = rules[type]!
  const isOutside = relPath.startsWith('../')
  if (rule.allow.length > 0 && (isOutside || !rule.allow.some(glob => matchGlob(glob, relPath)))) {
    return { allow: false, reason: `allowed only +${rule.allow.join(', +')}` }
  }
  const denied = isOutside ? undefined : rule.deny.find(glob => matchGlob(glob, relPath))
  return denied === undefined ? { allow: true } : { allow: false, reason: `denied by -${denied}` }
}

// ── Test-file integrity ──────────────────────────────────────────────────

/** Content hash by project-relative path. */
export type Files = Map<string, string>

const LAUNCHED = new Set(['async_launched', 'teammate_spawned'])

/** The path relative to the root; one outside it starts with `../`. */
export function relativeTo(root: string, real: string): string {
  const path = real.replace(/\\/g, '/')
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : `../${path.replace(/^\/+/, '')}`
}

/** A short hash of a file's text and its length, to tell a changed file from an unchanged one. */
export function hashOf(text: string): string {
  let a = 0x811c9dc5
  let b = 0x9e3779b9
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    a = Math.imul(a ^ code, 0x01000193) >>> 0
    b = Math.imul((b + code) ^ (b >>> 15), 0x85ebca6b) >>> 0
  }
  return `${text.length}.${a.toString(16)}.${b.toString(16)}`
}

/** The folder a glob's matches sit under: its segments before the first wildcard (a glob with none: its folder). */
export function folderOf(glob: string): string {
  const segments = glob.split('/')
  const wild = segments.findIndex(segment => segment.includes('*'))
  return segments.slice(0, wild < 0 ? -1 : wild).join('/')
}

/** What a run did to the files: `path (modified | deleted | new)`, in path order. */
export function changesOf(before: Files, after: Files): string[] {
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
export function reportOf(type: string, changes: string[]): string | null {
  return changes.length === 0 ? null : `tdd-guard: ${type} changed protected test files: ${changes.join(', ')}`
}

/** The id of a subagent that answers later (background or teammate), else null. */
export function launchedId(result: unknown): string | null {
  const launched = result as { status?: string; agentId?: string } | undefined
  return launched && LAUNCHED.has(launched.status ?? '') && launched.agentId ? launched.agentId : null
}

/** The pending records without one agent's. */
export function withoutId(all: Record<string, string>, agentId: string): Record<string, string> {
  return Object.fromEntries(Object.entries(all).filter(([id]) => id !== agentId))
}

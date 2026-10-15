/**
 * Tdd Guard's rules, free of `$` so tests can call them: the `rules` option, a glob, and the verdict on one path.
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

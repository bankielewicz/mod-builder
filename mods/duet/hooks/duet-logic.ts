/**
 * Duet's rules, free of `$` so tests can call them: routing, custom-agent
 * definitions, the handoff envelope, Codex argv/env, the JSONL fold, the
 * Agent result Claude reads, the run log and the pane's text.
 */

import type { ClaudePending, CodexModel, Envelope, Provider, Sandbox, Task, TaskStatus } from '../types'
import { isAllowedBaseUrl } from './duet-providers-logic'

export type { ClaudePending, CodexModel, Envelope, Sandbox, Task, TaskStatus }

export const DEFAULT_TYPE = 'general-purpose'
const EDIT_TOOLS = ['Edit', 'Write', 'NotebookEdit', 'MultiEdit']

// ── Options ──────────────────────────────────────────────────────────────

export type Options = {
  routes: Set<string> | '*'
  sandbox: Sandbox
  model: string
  maxConcurrent: number
  timeoutMs: number
  consent: 'ask' | 'allow'
  runModes: RunModes
  fsScope: FsScope
  writePaths: WritePaths
  /** The `custom` provider's base URL (0.3.0), '' when unset or not allowed. */
  customUrl: string
  customModel: string
}

/** `codexWritePaths`: project folders per agent type, or the error a malformed value gives (every agent then writes nothing). */
export type WritePaths = Record<string, string[]> | { error: string }

/** `codexFsScope`: `project` confines Codex's filesystem to a duet profile; `anything` leaves Codex's own sandbox as it was. */
export type FsScope = 'project' | 'anything'

/** Whether a Codex run makes Claude wait for it or answers later. */
export type RunMode = 'wait' | 'background'
/** `codexRunMode`: the default for `codexAgents` types, and per-type overrides (roles by any of their names). */
export type RunModes = { fallback: RunMode; overrides: Record<string, RunMode> }

const ROLE_ALIASES: Record<string, string> = { advisor: 'duet:codex-advisor', reviewer: 'duet:codex-reviewer', implementer: 'duet:codex-implementer' }

function modeWord(w: string): RunMode | null {
  const t = w.trim().toLowerCase()
  return t === 'background' || t === 'bg' || t === 'async' ? 'background' : t === 'wait' || t === 'foreground' || t === 'sync' ? 'wait' : null
}

/** `advisor`, `codex-advisor` and `duet:codex-advisor` all name the advisor role; any other type stays as typed. */
export function typeKey(name: string): string {
  const t = name.trim()
  const low = t.toLowerCase()
  if (ROLE_ALIASES[low]) return ROLE_ALIASES[low]!
  if (/^codex-(advisor|reviewer|implementer)$/.test(low)) return `duet:${low}`
  if (/^duet:codex-(advisor|reviewer|implementer)$/.test(low)) return low
  return t
}

/** `"background, advisor=wait, Explore=wait"` → modes, or `{ error }` naming the part that doesn't fit. */
export function parseRunModes(text: string): RunModes | { error: string } {
  const parts = text.split(',').map(p => p.trim()).filter(Boolean)
  // No prototype: a type named constructor or __proto__ is just a key.
  const modes: RunModes = { fallback: 'background', overrides: Object.create(null) as Record<string, RunMode> }
  let hasDefault = false
  for (const part of parts) {
    const eq = part.indexOf('=')
    if (eq === -1) {
      const m = modeWord(part)
      if (!m) return { error: `codexRunMode: "${part}" is not wait or background.` }
      if (hasDefault) return { error: `codexRunMode: "${part}" is a second default; give one, then type=mode overrides.` }
      modes.fallback = m
      hasDefault = true
      continue
    }
    const key = part.slice(0, eq).trim()
    const m = modeWord(part.slice(eq + 1))
    if (!key || !/^[\w.:-]+$/.test(key)) return { error: `codexRunMode: "${part}" needs a type before =, e.g. advisor=wait.` }
    if (!m) return { error: `codexRunMode: "${part}" needs wait or background after =.` }
    modes.overrides[typeKey(key)] = m
  }
  return modes
}

/** A run's mode: an override for its type, else its role's default, else the configured default. */
export function modeOf(o: Options, type: string, role: Role | null): RunMode {
  const key = typeKey(type)
  const own = Object.prototype.hasOwnProperty.call(o.runModes.overrides, key) ? o.runModes.overrides[key] : undefined
  return own ?? role?.mode ?? o.runModes.fallback
}

/** `"red-test-writer=tests;test, impl=src"` → project folders per agent type (roles by any of their names), or `{ error }` naming the part that isn't agent=folder;folder. */
export function parseWritePaths(text: string): WritePaths {
  // No prototype: a type named constructor or __proto__ is just a key.
  const paths: Record<string, string[]> = Object.create(null)
  for (const raw of text.split(',')) {
    const part = raw.trim()
    if (!part) continue
    const eq = part.indexOf('=')
    const key = eq === -1 ? '' : part.slice(0, eq).trim()
    const folders = eq === -1 ? [] : part.slice(eq + 1).split(';').map(f => f.trim()).filter(Boolean)
    if (!/^[\w.:-]+$/.test(key) || !folders.length) return { error: `codexWritePaths: "${part}" needs agent=folder;folder, e.g. red-test-writer=tests;test.` }
    paths[typeKey(key)] = folders
  }
  return paths
}

/** The folders one agent type may write: none when the option is malformed, undefined when the type isn't named (the whole project). */
export function writePathsOf(w: WritePaths, type: string): string[] | undefined {
  if (typeof w.error === 'string') return []
  const key = typeKey(type)
  return Object.prototype.hasOwnProperty.call(w, key) ? (w as Record<string, string[]>)[key] : undefined
}

/** `"general-purpose, Explore"` → a set; `"*"` → every type; blank → none. */
export function parseRoutes(text: string): Set<string> | '*' {
  const t = text.trim()
  if (t === '*') return '*'
  return new Set(t.split(',').map(s => s.trim()).filter(Boolean))
}

/** Reads the manifest's options defensively; never anything above workspace-write. */
export function readOptions(raw: unknown): Options {
  const o = (raw ?? {}) as Record<string, unknown>
  const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) && String(v ?? '') !== '' ? Number(v) : d)
  return {
    routes: parseRoutes(String(o.codexAgents ?? '')),
    sandbox: o.codexSandbox === 'workspace-write' ? 'workspace-write' : 'read-only',
    model: String(o.codexModel ?? '').trim(),
    maxConcurrent: Math.max(0, Math.floor(num(o.maxConcurrent, 2))),
    timeoutMs: Math.max(1, num(o.timeoutMinutes, 20)) * 60_000,
    consent: o.codexConsent === 'allow' ? 'allow' : 'ask',
    fsScope: o.codexFsScope === 'project' ? 'project' : 'anything',
    writePaths: parseWritePaths(String(o.codexWritePaths ?? '')),
    runModes: ((m) => ('error' in m ? { fallback: 'background' as const, overrides: Object.create(null) as Record<string, RunMode> } : m))(parseRunModes(String(o.codexRunMode ?? 'background'))),
    customUrl: ((u) => (isAllowedBaseUrl(u) ? u.replace(/\/+$/, '') : ''))(String(o.apiCustomUrl ?? '').trim()),
    customModel: String(o.apiCustomModel ?? '').trim(),
  }
}

export function isRouted(routes: Options['routes'], subagentType: string | undefined): boolean {
  const type = subagentType?.trim() || DEFAULT_TYPE
  return routes === '*' ? true : routes.has(type)
}

/** What `codexAgents` leaves on Claude even when a type is listed. */
export const EXCEPTIONS = 'named, isolated and nested calls stay on Claude'

const SAY: Record<RunMode, string> = { wait: 'waits', background: 'background' }

/** Overrides for types that aren't roles, as `Explore waits`. */
function typeOverrides(o: Options): string {
  return Object.entries(o.runModes.overrides).filter(([k]) => !k.startsWith(ROLE_PREFIX)).map(([k, m]) => `${k} ${SAY[m]}`).join(', ')
}

/** `/duet` and `/duet routes`: the routes, what they skip, how each runs, the roles, and the limits. */
export function routesText(o: Options): string {
  const list = o.routes === '*' ? 'every subagent type' : o.routes.size ? [...o.routes].join(', ') : 'nothing routed'
  const more = typeOverrides(o)
  const routes = list === 'nothing routed' ? `codex ← ${list}` : `codex ← ${list} (${EXCEPTIONS}), ${SAY[o.runModes.fallback]}${more ? `; ${more}` : ''}`
  const roles = rolesFor(o.sandbox).map(r => `${ROLE_PREFIX}${r.name} (${SAY[modeOf(o, ROLE_PREFIX + r.name, r)]})`).join(', ')
  const editing = o.sandbox === 'workspace-write' ? ' · editing runs wait' : ''
  return `${routes} · roles ${roles} · sandbox ${o.sandbox} · max ${o.maxConcurrent}${editing}`
}

/** The pane's two footer lines (wide layout): routes with their exceptions, then each role's mode and the limits. */
export function routesLines(o: Options): [string, string] {
  const list = o.routes === '*' ? 'every type' : o.routes.size ? [...o.routes].join(', ') : 'nothing routed'
  const routes = `routes  codex ← ${list}${list === 'nothing routed' ? '' : ' · named, isolated, nested stay Claude'}`
  const short: Record<RunMode, string> = { wait: 'waits', background: 'bg' }
  const roles = rolesFor(o.sandbox).map(r => `${r.name.replace('codex-', '')} ${short[modeOf(o, ROLE_PREFIX + r.name, r)]}`)
  const others = list === 'nothing routed' ? [] : [`others ${short[o.runModes.fallback]}`]
  return [routes, `roles   ${[...roles, ...others].join(' · ')}   ${o.sandbox} · max ${o.maxConcurrent}`]
}

// ── Codex roles (registered agent types) ─────────────────────────────────

export const ROLE_PREFIX = 'duet:'

export type Role = { name: string; mode: RunMode; description: string; prompt: string; tools: string[]; editing: boolean }

/** The line Claude reads for a role, ending with how it answers under the current mode. */
export function roleDescription(role: Role, mode: RunMode): string {
  const how = role.editing || mode === 'wait' ? 'Claude waits for its answer' : 'Answers in the background, as a message when it ends'
  return `${role.description} ${how}; it can't be messaged afterwards.`
}

export const ROLES: Role[] = [
  {
    name: 'codex-advisor',
    mode: 'wait',
    editing: false,
    tools: ['Read', 'Grep', 'Glob'],
    description: `Runs on Codex (OpenAI), not Claude. A second opinion from another model family on a plan, design, approach or root cause. Reads the repo; never edits.`,
    prompt: [
      'You are an advisor giving a second opinion from a different model family.',
      'Read what you need in the repository to check the claims in the task; do not edit anything.',
      'Lead with your recommendation in one or two sentences, then the reasons, each tied to evidence (path:line, command output) where the repo can show it.',
      "Say plainly where you disagree with the approach in the task, what you would do instead, and what would change your mind. Separate what you verified from what you assume.",
    ].join('\n'),
  },
  {
    name: 'codex-reviewer',
    mode: 'background',
    editing: false,
    tools: ['Read', 'Grep', 'Glob', 'Bash'],
    description: `Runs on Codex (OpenAI), not Claude. Adversarial review of a diff or files: judges the code that is there, ignores any summary of intent, reports findings with file:line and severity. Never edits.`,
    prompt: [
      'You are an adversarial reviewer. Judge only the code that is there; trust no summary of intent, including the task\'s, unless it is the specification itself.',
      'Look for correctness bugs first: for each, give path:line, severity (high/medium/low), what breaks, and an input that breaks it. Then risks the tests do not cover.',
      'Do not fix anything and do not edit files.',
      'End with one line: "verdict: approve" or "verdict: changes requested (N high, N medium, N low)".',
    ].join('\n'),
  },
  {
    name: 'codex-implementer',
    mode: 'wait',
    editing: true,
    tools: ['Read', 'Grep', 'Glob', 'Bash', 'Edit', 'Write'],
    description: 'Runs on Codex (OpenAI), not Claude. Makes a scoped change under the session folder (no commits, pushes, installs or network) and reports what it changed.',
    prompt: [
      'You implement one scoped change under the session folder. Read the surrounding code first and match its style.',
      'Make the smallest change that does the task; do not refactor beyond it. Run the project\'s tests or checks if you can, and report the result.',
      'Never commit, push, install packages or reach the network.',
      'End with the list of files you changed and what you verified.',
    ].join('\n'),
  },
]

/** The roles duet registers: the implementer only where Codex may edit. */
export function rolesFor(sandbox: Sandbox): Role[] {
  return ROLES.filter(r => !r.editing || sandbox === 'workspace-write')
}

/** The role a `subagent_type` names (`duet:codex-advisor`, or the bare name), else null. */
export function roleOf(subagentType: string | undefined): Role | null {
  const t = subagentType?.trim() ?? ''
  if (!t.startsWith(ROLE_PREFIX)) return null
  return ROLES.find(r => r.name === t.slice(ROLE_PREFIX.length)) ?? null
}

/** A role as an agent definition, so the handoff and the sandbox clamp treat it like an agent file. */
export function roleDef(role: Role): AgentDef {
  return { name: role.name, description: role.description, tools: role.tools, body: role.prompt }
}

// ── Routing ──────────────────────────────────────────────────────────────

export type AgentCallShape = { subagent_type?: string; name?: string; team_name?: string; isolation?: string; agentId?: string }
export type Route = { to: 'codex'; role: Role | null } | { to: 'claude' } | { to: 'deny'; reason: string }

/**
 * Where an Agent call goes. A `duet:` role always goes to Codex (its name is
 * the explicit choice), but never from inside a subagent or isolated. A type
 * in `codexAgents` goes to Codex unless the call is named, isolated or nested.
 */
export function routeOf(o: Options, e: AgentCallShape): Route {
  const role = roleOf(e.subagent_type)
  if (role) {
    const label = ROLE_PREFIX + role.name
    if (e.agentId) return { to: 'deny', reason: `duet: Codex roles run only from the main session; the ${label} subagent did not run.` }
    if (e.isolation) return { to: 'deny', reason: `duet: Codex roles can't run isolated (worktree/remote); the ${label} subagent did not run.` }
    return { to: 'codex', role }
  }
  if (e.agentId || e.name || e.team_name || e.isolation || !isRouted(o.routes, e.subagent_type)) return { to: 'claude' }
  return { to: 'codex', role: null }
}

/** Whether a routed run answers at once: never one that can edit, else as its mode says. */
export function runsInBackground(o: Options, sandbox: Sandbox, type: string, role: Role | null): boolean {
  return sandbox === 'read-only' && modeOf(o, type, role) === 'background'
}

// ── /duet config ─────────────────────────────────────────────────────────

export type ConfigField = { field: string; alias: string; kind: 'text' | 'number'; choices?: string[]; fallback: string | number; help: string }

/** The manifest's `userConfig` fields, in its order, each with a short alias. */
export const CONFIG_FIELDS: ConfigField[] = [
  { field: 'codexAgents', alias: 'agents', kind: 'text', fallback: '', help: 'comma-separated subagent types sent to Codex; * = every type; empty = none' },
  { field: 'codexSandbox', alias: 'sandbox', kind: 'text', choices: ['read-only', 'workspace-write'], fallback: 'read-only', help: 'workspace-write lets Codex write in the session folder and /tmp; both modes read any file you can' },
  { field: 'codexModel', alias: 'model', kind: 'text', fallback: '', help: "passed to codex as -m; empty = Codex's own configured model" },
  { field: 'maxConcurrent', alias: 'max', kind: 'number', fallback: 2, help: 'live Codex runs at once; a call beyond this is refused' },
  { field: 'timeoutMinutes', alias: 'timeout', kind: 'number', fallback: 20, help: 'a run past this stops; one-shot fallback: 10 minutes max' },
  { field: 'codexConsent', alias: 'consent', kind: 'text', choices: ['ask', 'allow'], fallback: 'ask', help: 'ask once per session before the first handoff, or pre-approve' },
  { field: 'codexRunMode', alias: 'mode', kind: 'text', fallback: 'background', help: 'wait or background for codexAgents types, then overrides: advisor=background, Explore=wait (editing runs always wait)' },
  { field: 'codexFsScope', alias: 'scope', kind: 'text', choices: ['anything', 'project'], fallback: 'anything', help: 'project confines Codex to the session folder (read, and write under workspace-write) and hides /tmp; checked through `codex exec` on Codex 0.162.1, Linux only (on macOS, the Codex source makes /tmp readable and writable, even under read-only), re-check after upgrading' },
  { field: 'codexWritePaths', alias: 'paths', kind: 'text', fallback: '', help: 'with scope project and workspace-write: red-test-writer=tests;test, impl=src limits a named agent to those project folders; empty = whole project' },
  { field: 'apiCustomUrl', alias: 'customurl', kind: 'text', fallback: '', help: 'the custom provider\'s OpenAI-compatible base URL (https://, or http:// to localhost), e.g. https://my-gateway.example.com/v1' },
  { field: 'apiCustomModel', alias: 'custommodel', kind: 'text', fallback: '', help: 'the custom provider\'s default model id' },
]

/** A field's stored value as text, its default when unset. */
export function storedText(raw: unknown, f: ConfigField): string {
  const v = ((raw ?? {}) as Record<string, unknown>)[f.field]
  return String(v ?? f.fallback)
}

export type DraftPlan = { writes: { field: ConfigField; value: string | number }[]; errors: string[] }

/** The pane's draft against what is stored: the writes still to make, and the values that do not fit. */
export function planDraft(raw: unknown, draft: Record<string, string>): DraftPlan {
  const plan: DraftPlan = { writes: [], errors: [] }
  for (const f of CONFIG_FIELDS) {
    const text = draft[f.field]
    if (text === undefined) continue
    const coerced = coerceConfigValue(f, text)
    if ('error' in coerced) plan.errors.push(coerced.error)
    else if (String(coerced.value) !== storedText(raw, f)) plan.writes.push({ field: f, value: coerced.value })
  }
  return plan
}

export const CONFIG_USAGE = 'Usage: /duet config [<field> <value>]   fields: ' + CONFIG_FIELDS.map(f => `${f.alias}`).join(', ') + '   ("" clears a text field)'

export function findConfigField(name: string): ConfigField | undefined {
  const n = name.trim().toLowerCase()
  return CONFIG_FIELDS.find(f => f.field.toLowerCase() === n || f.alias === n)
}

/** `/duet config` with no field: every option, its stored value or default. */
export function configText(raw: unknown): string {
  const o = (raw ?? {}) as Record<string, unknown>
  const rows = CONFIG_FIELDS.map(f => {
    const v = o[f.field] ?? f.fallback
    const shown = v === '' ? '(empty)' : String(v)
    const capped = f.field === 'timeoutMinutes' && Number(v) * 60_000 > FALLBACK_MAX_MS ? '   (a one-shot fallback run stops at 10 minutes)' : ''
    return `  ${f.alias.padEnd(11)} ${f.field.padEnd(15)} ${shown}${f.choices ? `   [${f.choices.join(' | ')}]` : ''}${capped}`
  })
  return ['duet config', ...rows, CONFIG_USAGE].join('\n')
}

/** The value text after the field, checked against the field: `{ value }` or `{ error }`. */
export function coerceConfigValue(f: ConfigField, text: string): { value: string | number } | { error: string } {
  let t = text.trim()
  if (/^(""|'')$/.test(t)) t = ''
  else if (/^(".*"|'.*')$/.test(t)) t = t.slice(1, -1)
  if (f.kind === 'number') {
    const n = Number(t)
    if (t === '' || !Number.isFinite(n) || n < (f.field === 'timeoutMinutes' ? 1 : 0)) return { error: `${f.field} takes a number${f.field === 'timeoutMinutes' ? ' ≥ 1' : ' ≥ 0'}, got "${text.trim()}".` }
    return { value: f.field === 'maxConcurrent' ? Math.floor(n) : n }
  }
  if (f.choices && !f.choices.includes(t)) return { error: `${f.field} takes one of ${f.choices.join(', ')}, got "${t}".` }
  if (f.field === 'codexRunMode') {
    const m = parseRunModes(t)
    if ('error' in m) return { error: m.error }
  }
  if (f.field === 'codexWritePaths') {
    const w = parseWritePaths(t)
    if (typeof w.error === 'string') return { error: w.error }
  }
  // The refusal never shows a password the URL carried (#115).
  if (f.field === 'apiCustomUrl' && t !== '' && !isAllowedBaseUrl(t)) return { error: `apiCustomUrl takes an https:// URL, or http:// to localhost, 127.0.0.1 or [::1], with no user:password@, query, fragment, space or backslash; got "${t.replace(/\/\/[^/@\s]*@/, '//***@')}".` }
  return { value: t }
}

// ── Codex's model catalog (`codex debug models`) ─────────────────────────

export const MODELS_ARGV = ['codex', 'debug', 'models']
/** Picker rows: hotkeys 1–9; 0 is "(empty)". */
export const MAX_PICKS = 9

/** The catalog's JSON as models, in Codex's order; `{ error }` when it is not the catalog. */
export function parseModelCatalog(json: string): { models: CodexModel[] } | { error: string } {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    return { error: 'codex debug models did not print JSON.' }
  }
  const list = (data as { models?: unknown })?.models
  if (!Array.isArray(list)) return { error: 'codex debug models printed no model list.' }
  const models = list
    .filter((m): m is Record<string, unknown> => typeof m?.slug === 'string' && m.slug !== '')
    .map(m => ({
      slug: m.slug as string,
      name: typeof m.display_name === 'string' ? m.display_name : (m.slug as string),
      description: typeof m.description === 'string' ? m.description : '',
      isHidden: m.visibility === 'hide',
    }))
  return models.length ? { models } : { error: 'codex debug models listed no models.' }
}

/** The models the picker offers: the listed ones, hidden ones left out. */
export function pickable(models: CodexModel[]): CodexModel[] {
  return models.filter(m => !m.isHidden).slice(0, MAX_PICKS)
}

function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = row
  }
  return prev[b.length]!
}

/** '' when `slug` is empty, in the catalog, or there is no catalog; else why it may not run, with the nearest slug. */
export function modelWarning(slug: string, models: CodexModel[]): string {
  const s = slug.trim()
  if (s === '' || models.length === 0 || models.some(m => m.slug === s)) return ''
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, '')
  const near = [...models].sort((a, b) => distance(norm(s), norm(a.slug)) - distance(norm(s), norm(b.slug)))[0]!
  const close = norm(near.slug) === norm(s) || distance(norm(s), norm(near.slug)) <= 3
  return `"${s}" is not in Codex's model list${close ? `; did you mean ${near.slug}?` : '.'}`
}

/** `/duet config models`: the catalog as text. */
export function modelsText(models: CodexModel[], current: string): string {
  const rows = models.map(m => `  ${m.slug === current ? '✓' : ' '} ${m.slug.padEnd(26)} ${m.name}${m.isHidden ? ' (hidden)' : ''}${m.description ? ` · ${m.description}` : ''}`)
  return ['Codex models (codex debug models)', ...rows, `Set one: /duet config model <slug>   ("" uses Codex's default${current === '' ? ', the current setting' : ''})`].join('\n')
}

// ── Custom agents (.claude/agents, by Claude's discovery rules) ──────────

export type AgentDef = {
  name: string
  description: string
  /** The `tools` value as a list; null when there is no `tools` key (every tool). */
  tools: string[] | null
  /** The `disallowedTools` value as a list. */
  disallowed?: string[]
  /** `tools` or `disallowedTools` is in a form duet doesn't read (a block scalar, an unclosed `[`, a continued line): read-only. */
  isToolsUnread?: boolean
  body: string
}

const LIST_KEYS = ['tools', 'disallowedTools']

/**
 * A frontmatter value without its ` # comment`. As in YAML, a `#` stays inside a quoted
 * value or a quoted `[a, b]` item; in an unquoted value, quotes are just characters.
 */
function uncommented(value: string): string {
  const v = value.trim()
  const isFlow = v.startsWith('[')
  let quote = ''
  let isItemStart = true
  for (let i = 0; i < v.length; i++) {
    const ch = v[i]!
    if (quote) {
      if (quote === '"' && ch === '\\') i++
      else if (ch === quote) quote = ''
      continue
    }
    if (ch === '#' && (i === 0 || /\s/.test(v[i - 1]!))) return v.slice(0, i).trim()
    if ((ch === '"' || ch === "'") && isItemStart) quote = ch
    if (!/\s/.test(ch)) isItemStart = isFlow && (ch === '[' || ch === ',')
  }
  return v
}

/**
 * A list value duet reads as written: no block scalar, mapping, anchor, alias or tag, a `[`
 * closes on its line, and a quoted value ends at its closing quote.
 */
const isReadable = (value: string): boolean =>
  !/^([>|{&!]|\*\S)/.test(value) &&
  (!value.startsWith('[') || value.endsWith(']')) &&
  (!/^["']/.test(value) || (value.length > 1 && value.endsWith(value[0]!)))

/**
 * A frontmatter list (`a, b`, `[a, b]`, quoted or not) as tool names; `[]` or an
 * empty value is an empty list. A permission specifier names its whole tool:
 * `Write(src/**)` is `Write`, and a comma inside the parentheses doesn't split.
 */
function listOf(raw: string): string[] {
  const parts: string[] = []
  let part = ''
  let depth = 0
  for (const ch of raw.replace(/^\[|\]$/g, '')) {
    if (ch === ',' && depth === 0) {
      parts.push(part)
      part = ''
      continue
    }
    if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    part += ch
  }
  parts.push(part)
  return parts.map(s => s.trim().replace(/^["']|["']$/g, '').replace(/\s*\(.*$/, '').trim()).filter(Boolean)
}

/**
 * Frontmatter (`name`, `description`, `tools`, `disallowedTools`) and body of an
 * agent file; null when it has none. `tools` and `disallowedTools` may be one line
 * (`a, b` or `[a, b]`) or a YAML block list of `- a` lines; any other form is
 * marked unread, so the agent runs read-only rather than on a guess.
 */
export function parseAgentFile(text: string): AgentDef | null {
  const m = text.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) return null
  const fields: Record<string, string> = {}
  const blocks: Record<string, string[]> = {}
  let isToolsUnread = false
  let key = ''
  for (const line of (m[1] ?? '').split(/\r?\n/)) {
    const kv = line.match(/^["']?([A-Za-z_-]+)["']?\s*:\s*(.*)$/)
    if (kv) {
      key = kv[1]!
      fields[key] = (kv[2] ?? '').trim()
      delete blocks[key]
      continue
    }
    const rest = line.trim()
    if (!key || rest === '' || rest.startsWith('#')) continue
    if (!LIST_KEYS.includes(key)) {
      // An indented line goes on with a plain value, as YAML folds it: text below an empty `description:`, or a value
      // that wraps. A `>` or `|` block keeps its indicator as its value.
      if (/^\s/.test(line) && !/^[>|]/.test(fields[key]!)) fields[key] = `${fields[key]} ${rest}`.trim()
      continue
    }
    // A `- item` line, indented or not, under an empty value is a block list; any other line continues the value.
    const item = rest.match(/^-(?:\s+(.*))?$/)
    if (item && uncommented(fields[key] ?? '') === '') (blocks[key] ??= []).push(uncommented(item[1] ?? ''))
    else isToolsUnread = true
  }
  const listField = (name: string): string[] | null => {
    const value = fields[name]
    if (value === undefined) return null
    const values = [uncommented(value), ...(blocks[name] ?? [])]
    if (!values.every(isReadable)) isToolsUnread = true
    return values.flatMap(listOf)
  }
  // An absent `tools` key means every tool; a present but empty one (`tools: []`) means none.
  const tools = listField('tools')
  const disallowed = listField('disallowedTools') ?? []
  return {
    name: fields.name ?? '',
    description: fields.description ?? '',
    tools,
    disallowed,
    ...(isToolsUnread ? { isToolsUnread } : {}),
    body: (m[2] ?? '').trim(),
  }
}

/** A frontmatter scalar as YAML reads it: without its ` # comment` and one pair of surrounding quotes. */
function scalarOf(value: string): string {
  return uncommented(value).replace(/^(["'])(.*)\1$/, '$2').trim()
}

/** A `name` Claude skips its file for: one that starts with `-`, holds a `:` or is over 256 characters. */
const isSkippedName = (name: string): boolean => name.startsWith('-') || name.includes(':') || name.length > 256

/**
 * The definition Claude would use for a subagent type, from the file texts of one `.claude/agents` folder.
 * Which folder wins is the caller's search. Identity comes only from the `name` field; a file with no `name`
 * or no `description`, or a `name` that starts with `-`, holds a `:` or is over 256 characters, is skipped as
 * Claude skips it. Two matches that disagree on editing (Claude's pick between them isn't documented) give
 * the one that can't edit. No match is null.
 */
export function pickAgent(texts: string[], type: string): AgentDef | null {
  const defs: AgentDef[] = []
  for (const text of texts) {
    const def = parseAgentFile(text)
    if (!def) continue
    const name = scalarOf(def.name)
    if (name !== type || isSkippedName(name) || scalarOf(def.description) === '') continue
    defs.push({ ...def, name })
  }
  return defs.find(def => !canEdit(def, type)) ?? defs[0] ?? null
}

/** A filesystem-safe folder name for a session id. */
export function sessionFolderOf(sessionId: string): string {
  return sessionId.replace(/[^\w.-]/g, '_').slice(0, 80) || 'unknown'
}

/**
 * Whether an agent may edit. A definition: its `tools` (none listed means
 * every tool) minus `disallowedTools` must keep an edit tool. No definition
 * found: only Claude's `general-purpose` agent edits; anything unresolved
 * (a built-in like Explore or Plan, a plugin's agent, a file duet can't find)
 * is read-only, so a lookup miss never raises the sandbox. So is a definition
 * whose `tools` or `disallowedTools` duet couldn't read.
 */
export function canEdit(def: AgentDef | null, type: string = DEFAULT_TYPE): boolean {
  if (!def) return type === DEFAULT_TYPE
  if (def.isToolsUnread) return false
  const allowed = def.tools === null || def.tools.includes('*') ? EDIT_TOOLS : EDIT_TOOLS.filter(t => def.tools!.includes(t))
  return allowed.some(t => !(def.disallowed ?? []).includes(t))
}

/**
 * An agent can only lower the sandbox, never raise it. A search cut short by duet's limits runs read-only:
 * a definition past them, which Claude reads, may forbid the edits that duet's pick allows.
 */
export function effectiveSandbox(configured: Sandbox, def: AgentDef | null, type: string = DEFAULT_TYPE, isSearchCut = false): Sandbox {
  return configured === 'workspace-write' && !isSearchCut && canEdit(def, type) ? 'workspace-write' : 'read-only'
}

// ── Handoff ──────────────────────────────────────────────────────────────

/** A short, stable hash of the task text: the envelope's spec version. */
export function specVersion(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0
  return h.toString(16).padStart(8, '0').slice(0, 7)
}

/**
 * The consent question. What Codex can reach was measured with Codex 0.162.1 on
 * Linux (SPEC, Change 0.2.4): both sandboxes read any file the user can read;
 * read-only writes nothing; workspace-write writes in the project and /tmp.
 */
export function consentText(cwd: string, sandbox: Sandbox, keyFile?: string): string {
  const writes =
    sandbox === 'workspace-write'
      ? `Agents that edit can write inside ${cwd} and in temporary folders such as /tmp.`
      : 'It runs read-only and writes nothing.'
  // 0.3.0: under codexFsScope anything the provider key file is readable too; under project it is hidden, so it is not named.
  const keys = keyFile ? `, your provider key file ${keyFile} included` : ''
  return `Send this task to Codex (OpenAI)? Codex can read any file your user account can read, not only ${cwd}${keys}, and sends what it reads to OpenAI under your Codex sign-in. ${writes} Allow for the rest of this session?`
}

/**
 * Why consent wasn't given when `$.ui.ask` rejected. On Esc (or a hook denying the question) it rejects with
 * `$.ui.ask: no answer (…)`, and the next call asks again; under `claude -p` there is nobody to ask at all.
 */
export function consentRefusal(err: unknown): string {
  const message = String((err as { message?: unknown } | undefined)?.message ?? err)
  if (message.includes('$.ui.ask: no answer')) return 'the consent question was dismissed; it is asked again next time'
  return 'nobody could be asked to allow sending this repo to Codex (set duet codexConsent to allow for headless runs)'
}

/** Rules the handoff asks Codex to follow. A request to the model: only the sandbox enforces anything. */
export const PROHIBITED = [
  'no git commits, pushes, merges, rebases, resets or branch changes',
  'no package installs or other network access',
  'no reading or writing outside the allowed scope',
  'no deleting files you did not create for this task',
] as const

export type Handoff = { prompt: string; envelope: Envelope }

export function buildHandoff(args: {
  id: string
  description: string
  prompt: string
  base: string
  cwd: string
  sandbox: Sandbox
  def: AgentDef | null
  subagentType: string
}): Handoff {
  const envelope: Envelope = {
    specVersion: specVersion(args.prompt),
    base: args.base,
    candidate: '',
    sandbox: args.sandbox,
    scope: args.cwd,
    role: args.def ? args.subagentType : '',
  }
  const lines = [
    '# Handoff from Claude Code (duet)',
    '',
    `- Task ID: ${args.id}`,
    `- Spec version: ${envelope.specVersion}`,
    `- Base commit: ${args.base}`,
    `- Allowed scope: files under ${args.cwd}`,
    `- Sandbox: ${args.sandbox}${args.sandbox === 'read-only' ? ' (investigate and answer; do not edit files)' : ''}`,
    `- Prohibited: ${PROHIBITED.join('; ')}`,
    '- Required output: a complete final answer to the task below, in plain text. If you changed files, end with a list of them. Say plainly what you verified and what you could not.',
    '',
  ]
  if (args.def?.body) lines.push(`## Role instructions (${args.subagentType})`, '', args.def.body, '')
  lines.push(`## Task: ${args.description || '(no description)'}`, '', args.prompt)
  return { prompt: lines.join('\n'), envelope }
}

// ── Codex process ────────────────────────────────────────────────────────

const NEVER_ASK = ['-c', 'approval_policy="never"'] as const

/** True when `path` lies below `root` (both real, absolute paths): never the root itself, nor a sibling sharing its prefix. */
export function isInside(root: string, path: string): boolean {
  const base = root.replace(/[/\\]+$/, '')
  return path.length > base.length + 1 && (path.startsWith(`${base}/`) || path.startsWith(`${base}\\`))
}

/** The folders Codex keeps read-only inside a writable project (probed on 0.162.1). */
const PROTECTED = new Set(['.git', '.codex', '.agents'])

/** True when `path` is, or lies below, a `.git`, `.codex` or `.agents` folder anywhere under `root`: a write folder there would undo Codex's own protection. */
export function isProtectedPath(root: string, path: string): boolean {
  return isInside(root, path) && path.slice(root.replace(/[/\\]+$/, '').length + 1).split(/[/\\]+/).some(part => PROTECTED.has(part))
}

/** PATH's absolute folders, in order (`:`-separated; Windows' `;` PATH isn't handled). */
export function pathDirs(path: string): string[] {
  return path.split(':').map(d => d.replace(/\/+$/, '')).filter(d => d.startsWith('/'))
}

/** The folder holding `path`. */
export function parentOf(path: string): string {
  return path.replace(/[/\\][^/\\]*$/, '')
}

/** A TOML basic string: JSON's escapes for `\`, `"` and control characters are TOML's. */
function tomlString(s: string): string {
  return JSON.stringify(s)
}

/**
 * The permission profile's name. Codex merges a same-named profile from any loaded config into it,
 * a trusted repository's `.codex/config.toml` included, so each run adds a nonce no config can know.
 */
function profileName(nonce = ''): string {
  const suffix = nonce.replace(/[^A-Za-z0-9]/g, '')
  return suffix ? `duet-mod-fs-scope-${suffix}` : 'duet-mod-fs-scope'
}

/** An absolute path: `/…`, `\…` or a drive letter. */
const ABSOLUTE = /^([/\\]|[A-Za-z]:)/

/** A project-relative folder as a path under `cwd`; null when it is absolute, climbs out of the project, or is the project itself. */
export function folderUnder(cwd: string, folder: string): string | null {
  if (ABSOLUTE.test(folder)) return null
  const parts: string[] = []
  for (const part of folder.split(/[/\\]+/)) {
    if (part === '..') {
      if (!parts.pop()) return null
    } else if (part !== '' && part !== '.') parts.push(part)
  }
  return parts.length ? `${cwd}/${parts.join('/')}` : null
}

/** `path` made absolute: kept when it is, else resolved against `cwd`, with `.` and `..` folded and never above `/`. */
export function resolveFrom(cwd: string, path: string): string {
  if (ABSOLUTE.test(path)) return path
  const parts = cwd.split('/').filter(Boolean)
  for (const part of path.split(/[/\\]+/)) {
    if (part === '..') parts.pop()
    else if (part !== '' && part !== '.') parts.push(part)
  }
  return `/${parts.join('/')}`
}

/**
 * A run's `codexFsScope` inputs: the scope, the home folder Codex is installed under, the folders its
 * agent may write, and folders outside the project it may read (git's own folders in a linked worktree).
 */
type FsProfile = { fsScope?: FsScope; home?: string; writePaths?: string[]; reads?: string[]; nonce?: string }

/**
 * The two `-c` overrides that make a `duet` permission profile the default (SPEC, Change 0.2.6): Codex's
 * built-in minimal set and the project are readable, nothing else is, and `/tmp` and files outside
 * are not mounted. Under workspace-write the project is writable, or only the `writePaths` folders
 * inside it when any are given; a folder outside the project is dropped. Codex's install folder is
 * read-only because the sandbox needs it to re-run `codex`.
 */
function profileArgs(o: { sandbox: Sandbox; cwd: string } & Omit<FsProfile, 'fsScope'>): string[] {
  // Read-only writes nothing, so its writePaths are ignored rather than allowed to widen it. Any list,
  // even an empty one, narrows: only an agent with none gets the whole project.
  const isWritable = o.sandbox === 'workspace-write'
  const named = isWritable ? o.writePaths ?? [] : []
  const entries: [string, 'read' | 'write'][] = [[':minimal', 'read'], [o.cwd, isWritable && o.writePaths === undefined ? 'write' : 'read']]
  for (const folder of new Set(named.flatMap(f => folderUnder(o.cwd, f) ?? []))) if (!isProtectedPath(o.cwd, folder)) entries.push([folder, 'write'])
  // A read outside the project only: never the project or inside it, and never a folder holding the project or the home folder.
  const covers = (folder: string, path: string) => folder.replace(/[/\\]+$/, '') === path.replace(/[/\\]+$/, '') || isInside(folder, path)
  const isNarrow = (path: string) => !covers(o.cwd, path) && !covers(path, o.cwd) && !(o.home && covers(path, o.home))
  for (const path of new Set(o.reads ?? [])) if (ABSOLUTE.test(path) && isNarrow(path)) entries.push([path, 'read'])
  if (o.home) entries.push([`${o.home}/.codex/packages`, 'read'])
  // TOML refuses a repeated key (CODEX_HOME=$HOME/.codex repeats ~/.codex/packages), so each path goes in once, as first given.
  const unique = new Map<string, 'read' | 'write'>()
  for (const [path, access] of entries) {
    const key = path.replace(/\/+/g, '/').replace(/(.)\/$/, '$1')
    if (!unique.has(key)) unique.set(key, access)
  }
  const table = [...unique].map(([path, access]) => `${tomlString(path)}="${access}"`).join(',')
  const name = profileName(o.nonce)
  return ['-c', `default_permissions="${name}"`, '-c', `permissions.${name}.filesystem={${table}}`]
}

/**
 * `codex exec` for a routed subagent; the prompt goes on stdin (`-`). Under project scope the
 * sandbox is set with `-c sandbox_mode`, never `-s`: Codex 0.162.1 ignores the permission profile
 * under `-s` (SPEC, Change 0.2.6).
 */
export function codexArgv(o: { sandbox: Sandbox; model: string; cwd: string } & FsProfile): string[] {
  const sandbox: Sandbox = o.sandbox === 'workspace-write' ? 'workspace-write' : 'read-only'
  const isScoped = o.fsScope === 'project'
  const mode = isScoped ? ['-c', `sandbox_mode="${sandbox}"`] : ['-s', sandbox]
  const profile = isScoped ? profileArgs({ sandbox, cwd: o.cwd, home: o.home, writePaths: o.writePaths, reads: o.reads, nonce: o.nonce }) : []
  return ['codex', 'exec', '--json', '--skip-git-repo-check', ...mode, ...NEVER_ASK, ...profile, '-C', o.cwd, ...(o.model ? ['-m', o.model] : []), '-']
}

export type ReviewTarget = { kind: 'uncommitted' } | { kind: 'base'; ref: string } | { kind: 'commit'; ref: string }

/** `/duet review` args → a target; null when they don't parse. */
export function parseReviewArgs(args: string): ReviewTarget | null {
  const words = args.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return { kind: 'uncommitted' }
  const [flag, ref] = words
  const safe = ref !== undefined && /^[\w./@^~-]+$/.test(ref) && !ref.startsWith('-')
  if (flag === '--base' && safe && words.length === 2) return { kind: 'base', ref }
  if (flag === '--commit' && safe && words.length === 2) return { kind: 'commit', ref }
  return null
}

/**
 * `codex exec review`, always read-only and never asking. A target
 * (`--uncommitted`, `--base`, `--commit`) and a custom prompt can't be combined
 * (Codex exits 2), so the review runs on Codex's own review instructions.
 */
export function reviewArgv(target: ReviewTarget, model: string, scope?: { cwd: string } & FsProfile): string[] {
  const which = target.kind === 'uncommitted' ? ['--uncommitted'] : [`--${target.kind}`, target.ref]
  const profile = scope?.fsScope === 'project' ? profileArgs({ sandbox: 'read-only', cwd: scope.cwd, home: scope.home, reads: scope.reads, nonce: scope.nonce }) : []
  return ['codex', 'exec', 'review', '--json', '--skip-git-repo-check', '-c', 'sandbox_mode="read-only"', ...NEVER_ASK, ...profile, ...which, ...(model ? ['-m', model] : [])]
}

/**
 * Claude Code's credential and provider variables, blanked in Codex's
 * environment. env is laid over the host's, which can't be listed, so the
 * names are fixed (SPEC, Change 0.2.5). Blanking sets '' and can't unset, and
 * '' in a path or profile name changes what a tool does (`CLAUDE_CONFIG_DIR`
 * becomes an empty config dir), so only secrets and provider switches go here,
 * never a path, directory or profile name. The one exception is the messaging
 * socket, where the empty path is the point: Codex gets no inbox to post to. Never add what Codex itself needs:
 * `OPENAI_API_KEY`, `CODEX_HOME`, `PATH`, `HOME`, the proxy variables.
 */
export const BLANKED_ENV = [
  // Anthropic API, and Claude Code's own sign-in state
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_CUSTOM_HEADERS',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_REFRESH_TOKEN',
  'CLAUDE_CODE_SESSION_ACCESS_TOKEN',
  'CLAUDE_CODE_CLIENT_KEY_PASSPHRASE',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  // A path, blanked on purpose: on macOS and Linux the token is optional, and Codex is a child Claude Code trusts
  'CLAUDE_CODE_MESSAGING_SOCKET',
  // Workload Identity Federation: the identity provider's JWT itself
  'ANTHROPIC_IDENTITY_TOKEN',
  // Bedrock, and Bedrock Mantle
  'CLAUDE_CODE_USE_BEDROCK',
  'ANTHROPIC_BEDROCK_BASE_URL',
  'AWS_BEARER_TOKEN_BEDROCK',
  'CLAUDE_CODE_USE_MANTLE',
  'ANTHROPIC_BEDROCK_MANTLE_BASE_URL',
  // Claude Platform on AWS
  'CLAUDE_CODE_USE_ANTHROPIC_AWS',
  'ANTHROPIC_AWS_API_KEY',
  'ANTHROPIC_AWS_BASE_URL',
  'ANTHROPIC_AWS_WORKSPACE_ID',
  // AWS credentials, and the container credential provider's token (ECS, EKS Pod Identity)
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_CONTAINER_AUTHORIZATION_TOKEN',
  // Vertex
  'CLAUDE_CODE_USE_VERTEX',
  'ANTHROPIC_VERTEX_PROJECT_ID',
  'ANTHROPIC_VERTEX_BASE_URL',
  // Foundry
  'CLAUDE_CODE_USE_FOUNDRY',
  'ANTHROPIC_FOUNDRY_API_KEY',
  'ANTHROPIC_FOUNDRY_AUTH_TOKEN',
  'ANTHROPIC_FOUNDRY_BASE_URL',
  'ANTHROPIC_FOUNDRY_RESOURCE',
  // Foundry's Entra path: the Azure SDK's default credential chain (names from the Azure SDK docs, not Claude's)
  'AZURE_CLIENT_ID',
  'AZURE_TENANT_ID',
  'AZURE_CLIENT_SECRET',
  'AZURE_CLIENT_CERTIFICATE_PASSWORD',
  'AZURE_PASSWORD',
  // Azure managed identity (App Service, Functions): the token endpoint's secret header
  'IDENTITY_HEADER',
  // Not the API provider keys duet stores (0.3.0, the owner's decision at review): a key duet keeps lives in its file,
  // which blanking a variable does nothing about, and one set in the shell is the person's own credential for Codex too.
] as const
export function childEnv(): Record<string, string> {
  return Object.fromEntries(BLANKED_ENV.map(k => [k, '']))
}

export type CodexLaunch = { argv: string[]; env: Record<string, string>; input?: string }

/**
 * How Codex starts: argv, the blanked env, and any stdin. `$.process.spawn`
 * takes it whole, and the `$.process.run` fallback takes its parts, so the
 * env is decided here once; tests can't reach spawn itself (it can't be stubbed).
 */
export function codexLaunch(argv: string[], input: string | undefined): CodexLaunch {
  return { argv, env: childEnv(), ...(input !== undefined ? { input } : {}) }
}

// ── Codex JSONL ──────────────────────────────────────────────────────────

export type Run = {
  threadId: string
  text: string
  warnings: string[]
  usage: { input: number; cached: number; output: number }
  failure: string
  isDone: boolean
}

export const EMPTY_RUN: Run = { threadId: '', text: '', warnings: [], usage: { input: 0, cached: 0, output: 0 }, failure: '', isDone: false }

/** One line of `codex exec --json` folded into the run. Unknown lines leave it as it was. */
export function foldEvent(run: Run, line: string): Run {
  let ev: Record<string, any>
  try {
    ev = JSON.parse(line)
  } catch {
    return run
  }
  if (!ev || typeof ev !== 'object') return run
  switch (ev.type) {
    case 'thread.started':
      return { ...run, threadId: String(ev.thread_id ?? '') }
    case 'item.completed': {
      const item = ev.item ?? {}
      if (item.type === 'agent_message') return { ...run, text: String(item.text ?? '') }
      if (item.type === 'error') return { ...run, warnings: [...run.warnings, String(item.message ?? '')] }
      // On Linux, without Codex's install folder the sandbox (bwrap) can't run Codex's own binary: every command fails, and the answer is hollow.
      // Only a failed command whose output has a line starting with bwrap's message counts; a diff or a file quoting it does not.
      const isFailed = item.type === 'command_execution' && item.exit_code !== 0
      const unrunnable = isFailed ? String(item.aggregated_output ?? '').match(/^bwrap: execvp (\S+): No such file or directory$/m) : null
      if (unrunnable && !run.failure) return { ...run, failure: `Codex could not run ${unrunnable[1]} inside its sandbox: under codexFsScope project its install folder must be readable, and duet grants only the folder of the codex on PATH and $CODEX_HOME/packages.` }
      return run
    }
    case 'turn.completed': {
      const u = ev.usage ?? {}
      return {
        ...run,
        isDone: true,
        usage: {
          input: run.usage.input + (Number(u.input_tokens) || 0),
          cached: run.usage.cached + (Number(u.cached_input_tokens) || 0),
          output: run.usage.output + (Number(u.output_tokens) || 0) + (Number(u.reasoning_output_tokens) || 0),
        },
      }
    }
    case 'turn.failed':
      return { ...run, failure: String(ev.error?.message ?? 'the Codex turn failed') }
    case 'error':
      return { ...run, failure: String(ev.message ?? 'Codex reported an error') }
    default:
      return run
  }
}

/** Splits streamed text into whole lines, keeping the unfinished tail. */
export function splitLines(carry: string, chunk: string): { lines: string[]; carry: string } {
  const parts = (carry + chunk).split('\n')
  const tail = parts.pop() ?? ''
  return { lines: parts.filter(l => l.trim()), carry: tail }
}

/** Every line of a whole stdout, folded. */
export function foldAll(stdout: string): Run {
  return stdout.split('\n').filter(l => l.trim()).reduce(foldEvent, EMPTY_RUN)
}

/** Why a finished run failed, or '' when it succeeded. */
export function failureOf(run: Run, exitCode: number | null, stderr: string): string {
  if (run.failure) return run.failure
  if (exitCode !== 0) {
    if (/not logged in|login|unauthori[sz]ed|401/i.test(stderr)) return 'codex: not signed in. Run `codex login`, then retry.'
    const first = stderr.split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('Reading additional input'))[0]
    return `codex exited with ${exitCode ?? 'a signal'}${first ? `: ${first}` : ''}`
  }
  if (!run.text) return 'codex finished without an answer'
  return ''
}

export function tokensOf(run: Run): number {
  return run.usage.input + run.usage.output
}

// ── The Agent result Claude reads ────────────────────────────────────────

export const ONE_SHOT = 'one-shot run: start a new duet task to follow up'

/** The result's last line; `dropped` names the codexWritePaths folders Codex could not write. */
export function footerOf(t: { id: string; model: string; sandbox: Sandbox; base: string; candidate: string; dropped?: string[] }): string {
  const dropped = t.dropped?.length ? ` · not writable: ${t.dropped.join(', ')} (missing, outside the project, or in .git, .codex or .agents)` : ''
  return `[duet ${t.id} · codex${t.model ? ` ${t.model}` : ''} · sandbox ${t.sandbox} · base ${t.base} · ${t.candidate || 'no files changed by this run'}${dropped} · ${ONE_SHOT}]`
}

/** The Agent tool's `completed` record, answered for Codex's run. */
export function agentResult(a: { id: string; prompt: string; text: string; footer: string; durationMs: number; run: Run; model: string }) {
  return {
    status: 'completed' as const,
    agentId: `duet-${a.id}`,
    agentType: 'codex',
    prompt: a.prompt,
    content: [{ type: 'text' as const, text: `${a.text}\n\n${a.footer}` }],
    resolvedModel: a.model ? `codex:${a.model}` : 'codex',
    totalToolUseCount: 0,
    totalDurationMs: Math.max(0, Math.round(a.durationMs)),
    totalTokens: tokensOf(a.run),
    canContinueAgent: false,
    usage: {
      input_tokens: a.run.usage.input,
      output_tokens: a.run.usage.output,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: a.run.usage.cached,
      server_tool_use: null,
      service_tier: null,
      cache_creation: null,
    },
  }
}

/** The Agent tool's `async_launched` record: a background Codex run that answers later. */
export function launchedRecord(a: { id: string; description: string; prompt: string; outputFile: string; model: string }) {
  return {
    status: 'async_launched' as const,
    agentId: `duet-${a.id}`,
    description: a.description,
    prompt: a.prompt,
    outputFile: a.outputFile,
    canReadOutputFile: true,
    canContinueAgent: false,
    resolvedModel: a.model ? `codex:${a.model}` : 'codex',
  }
}

/** The message a background run delivers to the main session when it ends. */
export function deliveryText(a: { id: string; label: string; model: string; sandbox: Sandbox; durationMs: number; tokens: number; text: string; footer: string; failure: string; searchNote?: string }): string {
  const head = `Background agent duet-${a.id} (${a.label})`
  // A failure has no footer to carry the agent search's cut-short note, so it goes on a line of its own.
  if (a.failure) return `${head} failed on Codex: ${a.failure}. It did not run on Claude either.${a.searchNote ? `\n${a.searchNote}` : ''}`
  return `${head} finished on Codex · ${a.model || 'default model'} · ${a.sandbox} · ${duration(a.durationMs)} · ${compact(a.tokens)} tok\n\n${a.text}\n\n${a.footer}`
}

export const READ_ONLY_CANDIDATE = 'read-only run: no files changed'

/** The reason of a `$.prompt.submit` answer that queued nothing, else ''. */
export function dropOf(answer: unknown): string {
  const drop = (answer as { drop?: unknown } | null | undefined)?.drop
  return typeof drop === 'string' ? drop : ''
}

/** A drop the engine gave after Stop, which the next main turn's end may retry (#119); any other drop is another hook's choice. */
export function retryableDrop(reason: string): boolean {
  return reason.includes('the session was stopped and nobody has sent input since') || reason.includes('was removed from the queue before it ran')
}

/** A waited run the person stopped with Esc (#119): the engine killed Codex, so this is neither done nor failed. */
export const STOPPED = 'stopped: you pressed Esc'

/** After Esc the engine refuses process calls, so git reads nothing and a comparison would invent changes. */
export const STOPPED_CANDIDATE = 'stopped with Esc: files not compared'

/**
 * A stopped run that could write, compared just after the stop from outside the aborted hook (#119): what changed
 * since the run began, or the placeholder when git gave no reading (`null`), so a failed read isn't every file changed.
 */
export function stoppedCandidateOf(before: string, after: string | null): string {
  return after === null ? STOPPED_CANDIDATE : `stopped with Esc: ${candidateOf(before, after)}`
}

/**
 * What a `$.process.spawn` error means for a Codex run: after `next.signal` aborted it is the person's stop,
 * never a fallback (#119, probe on 2.1.306); with output already read, a failure; before any, spawn couldn't start.
 */
export function spawnErrorAction(at: { started: boolean; aborted: boolean }): 'stop' | 'fail' | 'fallback' {
  if (at.aborted) return 'stop'
  return at.started ? 'fail' : 'fallback'
}

/**
 * `git status --porcelain` lines as status + path. The leading space is part
 * of the status column (` M a.ts`), so lines must not be trimmed at the
 * start. A rename (`R  old -> new`) is its new path.
 */
export function pathsOf(porcelain: string): { status: string; path: string }[] {
  return porcelain
    .split('\n')
    .map(l => l.replace(/\r$/, ''))
    .filter(l => l.length > 3)
    .map(l => ({ status: l.slice(0, 2), path: l.slice(3).split(' -> ').pop()!.replace(/^"|"$/g, '') }))
}

/** Paths whose content can be hashed (not deleted). */
export function hashablePaths(porcelain: string): string[] {
  return pathsOf(porcelain)
    .filter(p => !p.status.includes('D'))
    .map(p => p.path)
}

/**
 * A snapshot of the dirty tree: one `status<TAB>path<TAB>hash` line per path,
 * the hash being the file's content hash (`git hash-object`), so a file that
 * was already modified and is modified again still counts as changed.
 */
export function snapshotOf(porcelain: string, hashes: Readonly<Record<string, string>>): string {
  return pathsOf(porcelain)
    .map(p => `${p.status}\t${p.path}\t${hashes[p.path] ?? ''}`)
    .join('\n')
}

/** What changed during an editing run: paths whose status or content differs between two snapshots. */
export function candidateOf(before: string, after: string): string {
  const read = (t: string) =>
    new Map(
      t
        .split('\n')
        .filter(Boolean)
        .map(l => {
          const [status = '', path = '', hash = ''] = l.split('\t')
          return [path, `${status}\t${hash}`] as const
        }),
    )
  const a = read(before)
  const b = read(after)
  const paths = new Set<string>()
  for (const [path, state] of b) if (a.get(path) !== state) paths.add(path)
  for (const path of a.keys()) if (!b.has(path)) paths.add(path)
  if (!paths.size) return 'no files changed by this run'
  const list = [...paths].sort()
  const shown = list.slice(0, 3).join(', ') + (list.length > 3 ? ` +${list.length - 3} more` : '')
  return `files changed during this run: ${list.length} (${shown})`
}

/** The verdict line of a review, or its first line. */
export function verdictOf(text: string): string {
  const v = text.split('\n').reverse().find(l => /verdict:/i.test(l))
  return (v ?? text.split('\n').find(l => l.trim()) ?? '').trim().replace(/^[*_`\s]+|[*_`\s]+$/g, '')
}

// ── Reloads and Claude's background runs ─────────────────────────────────

export const LOST = 'lost when duet reloaded'

/** Running tasks this module did not start were cut off by a reload: marked error, and returned. */
export function lostOnReload(tasks: Task[], mine: ReadonlySet<string>, now: number): { tasks: Task[]; lost: Task[] } {
  const lost: Task[] = []
  const next = tasks.map(t => {
    if (t.provider !== 'codex' || t.status !== 'running' || mine.has(t.id)) return t
    const l = { ...t, status: 'error' as const, endedAt: now, detail: LOST }
    lost.push(l)
    return l
  })
  return { tasks: next, lost }
}

/** Codex runs in flight of any kind (routed agents and reviews): what the concurrency limit admits against. */
export function codexRunning(tasks: Task[]): number {
  return tasks.filter(t => t.provider === 'codex' && t.status === 'running').length
}

/** Running Codex rows and the runs this module started, each once: /clear empties the rows while those runs go on (#119). */
export function liveRuns(tasks: Task[], mine: ReadonlySet<string>): number {
  const ids = new Set(mine)
  for (const t of tasks) if (t.provider === 'codex' && t.status === 'running') ids.add(t.id)
  return ids.size
}

/** The next row id, past every row and every id still taken, so a run that outlived /clear keeps its own row (#119). */
export function idAfter(tasks: Task[], taken: Iterable<string>): string {
  const n = [...tasks.map(t => t.id), ...taken].reduce((m, id) => Math.max(m, Number(id.slice(1)) || 0), 0)
  return `d${n + 1}`
}

/** Why a Codex run was refused at the limit. */
export function limitText(running: number, max: number): string {
  return `limit: ${running} Codex run${running === 1 ? '' : 's'} already running (maxConcurrent ${max})`
}

/** The fallback run's ceiling: the engine caps a one-shot process at ten minutes. */
export const FALLBACK_MAX_MS = 600_000

/** Why a one-shot fallback run failed: a timeout when it ran to its ceiling, else a start failure. */
export function fallbackFailure(message: string, elapsedMs: number, capMs: number): string {
  if (/ENOENT|not found|No such file/i.test(message)) return 'codex not found on PATH (install the Codex CLI, then `codex login`)'
  if (/time(d)? ?out/i.test(message) || elapsedMs >= capMs - 1000) return `timed out after ${Math.round(capMs / 60_000)}m (the fallback runs at most ${Math.round(FALLBACK_MAX_MS / 60_000)} minutes)`
  return `codex could not start: ${message.split('\n')[0]}`
}

/** A running row's note when the fallback's ceiling cuts a longer timeoutMinutes; '' when it changes nothing. */
export function fallbackNote(timeoutMs: number): string {
  if (timeoutMs <= FALLBACK_MAX_MS) return ''
  return `fallback: stops at ${Math.round(FALLBACK_MAX_MS / 60_000)}m (timeoutMinutes ${Math.round(timeoutMs / 60_000)})`
}

/** Routed Codex agent runs still going (what the status line counts; reviews excluded). */
export function liveCount(tasks: Task[]): number {
  return tasks.filter(t => t.provider === 'codex' && t.kind === 'agent' && t.status === 'running').length
}

/** The id of a Claude subagent that answers later (background or teammate), else null. */
export function pendingIdOf(result: unknown): string | null {
  const r = result as { status?: string; agentId?: string } | undefined
  return r && (r.status === 'async_launched' || r.status === 'teammate_spawned') && typeof r.agentId === 'string' && r.agentId ? r.agentId : null
}

/** Every token a turn counted: input, cache reads and writes, and output. */
export function usageTokens(u: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } | undefined): number {
  if (!u) return 0
  return (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
}

/** The Claude row a background subagent's first finished turn makes. */
export function claudeTaskOf(p: ClaudePending, e: { usage?: Parameters<typeof usageTokens>[0] & { model?: string }; isAborted: boolean; reason?: string }, now: number): Task {
  return {
    id: `c${p.startedAt}`, provider: 'claude', kind: 'agent', subagentType: p.type, model: e.usage?.model ?? '',
    status: !e.isAborted && (e.reason ?? 'answer') === 'answer' ? 'done' : 'error', startedAt: p.startedAt, endedAt: Math.max(p.startedAt, now),
    tokens: usageTokens(e.usage), description: p.description, detail: e.isAborted ? 'aborted' : '', envelope: null,
  }
}

// ── Run log ──────────────────────────────────────────────────────────────

export type RunLine = {
  id: string
  at: number
  provider: Provider
  kind: 'agent' | 'review'
  type: string
  model: string
  ms: number
  tokens: number
  ok: boolean
}

export function runLineOf(t: Task): RunLine {
  return {
    id: t.id,
    at: t.startedAt,
    provider: t.provider,
    kind: t.kind,
    type: t.subagentType,
    model: t.model,
    ms: Math.max(0, (t.endedAt ?? t.startedAt) - t.startedAt),
    tokens: t.tokens,
    ok: t.status === 'done',
  }
}

/** A run log's non-blank lines. */
function logLines(text: string): string[] {
  return text.split('\n').filter(l => l.trim())
}

/** The log with one line added, kept to the newest `keep` lines. */
export function appendLog(existing: string, line: RunLine, keep = 2000): string {
  const lines = logLines(existing)
  lines.push(JSON.stringify(line))
  return lines.slice(-keep).join('\n') + '\n'
}

/** Several run logs (the legacy one, each session's) as one: their non-blank lines, so a log with no final newline can't swallow the next one's first. */
export function mergeLogs(texts: string[]): string {
  const lines = texts.flatMap(logLines)
  return lines.length ? lines.join('\n') + '\n' : ''
}

function median(xs: number[]): number {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2)
}

export type StatRow = { key: string; runs: number; okPct: number; medianMs: number; medianTokens: number }

export function summarize(log: string): StatRow[] {
  const groups = new Map<string, RunLine[]>()
  for (const l of log.split('\n')) {
    if (!l.trim()) continue
    try {
      const r = JSON.parse(l) as RunLine
      const key = `${r.provider} · ${r.kind === 'review' ? 'review' : r.type}`
      const group = groups.get(key)
      if (group) group.push(r)
      else groups.set(key, [r])
    } catch {
      /* a torn line is skipped */
    }
  }
  return [...groups.entries()]
    .map(([key, rs]) => ({
      key,
      runs: rs.length,
      okPct: Math.round((100 * rs.filter(r => r.ok).length) / rs.length),
      medianMs: median(rs.map(r => r.ms)),
      medianTokens: median(rs.map(r => r.tokens)),
    }))
    .sort((a, b) => a.key.localeCompare(b.key))
}

export function statsText(rows: StatRow[]): string {
  if (!rows.length) return 'No runs recorded yet. Routed subagents and /duet review are logged as they finish.'
  const head = 'provider · type'.padEnd(34) + 'runs'.padStart(5) + 'ok'.padStart(6) + 'median'.padStart(9) + 'tokens'.padStart(9)
  return [head, ...rows.map(r => r.key.slice(0, 33).padEnd(34) + String(r.runs).padStart(5) + `${r.okPct}%`.padStart(6) + duration(r.medianMs).padStart(9) + compact(r.medianTokens).padStart(9))].join('\n')
}

// ── Pane text ────────────────────────────────────────────────────────────

export function duration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}

export function compact(n: number): string {
  if (n <= 0) return '–'
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
}

export function countsOf(tasks: Task[]): string {
  const running = tasks.filter(t => t.status === 'running').length
  const done = tasks.filter(t => t.status === 'done').length
  const stopped = tasks.filter(t => t.status === 'stopped').length
  const failed = tasks.filter(t => t.status === 'error' || t.status === 'refused').length
  return [running && `${running} running`, `${done} done`, stopped && `${stopped} stopped`, failed && `${failed} failed`].filter(Boolean).join(' · ')
}

/** The folded status line; undefined when nothing ran on Codex. */
export function statusLineOf(tasks: Task[]): string | undefined {
  const codex = tasks.filter(t => t.provider === 'codex')
  return codex.length ? `codex: ${countsOf(codex)}` : undefined
}

export type Layout = 'full' | 'medium' | 'compact'
export function layoutOf(columns: number): Layout {
  return columns >= 60 ? 'full' : columns >= 40 ? 'medium' : 'compact'
}

export function kindLabel(t: Task): string {
  return t.kind === 'review' ? `review ${t.subagentType}`.trim() : t.subagentType
}

/** A task's head line for the given layout, cut to `columns`. */
export function rowText(t: Task, now: number, columns: number): string {
  const elapsed = duration((t.endedAt ?? now) - t.startedAt)
  const layout = layoutOf(columns)
  const parts =
    layout === 'compact'
      ? [t.id, t.provider, t.status, elapsed]
      : layout === 'medium'
        ? [t.id.padEnd(4), t.provider.padEnd(7), kindLabel(t).slice(0, 18).padEnd(18), t.status.padEnd(8), elapsed]
        : [t.id.padEnd(4), t.provider.padEnd(7), (t.model || 'default').slice(0, 12).padEnd(12), kindLabel(t).slice(0, 20).padEnd(20), t.status.padEnd(8), elapsed.padStart(7), compact(t.tokens).padStart(6) + ' tok']
  const text = parts.join(layout === 'compact' ? ' ' : ' ')
  return text.length > columns ? `${text.slice(0, Math.max(0, columns - 1))}…` : text
}

const FAILED_MARK: Partial<Record<TaskStatus, string>> = { error: '✕ ', refused: '✕ ' }

/** The dim line under a row: error or refusal, a review's verdict, a running row's note, else the description. */
export function subText(t: Task, columns: number): string {
  const mark = FAILED_MARK[t.status] ?? ''
  const showsDetail = mark !== '' || ((t.kind === 'review' || t.status === 'running' || t.status === 'stopped') && t.detail !== '')
  const s = showsDetail ? `${mark}${t.detail}` : `"${t.description}"`
  return s.length > columns ? `${s.slice(0, Math.max(0, columns - 1))}…` : s
}

export function envelopeLines(e: Envelope): string[] {
  return [
    `spec ${e.specVersion} · base ${e.base} · sandbox ${e.sandbox}`,
    `candidate: ${e.candidate || 'pending'}`,
    `scope: ${e.scope}${e.role ? ` · role: ${e.role}` : ''}`,
  ]
}

export function moved(at: number, by: number, count: number): number {
  if (count <= 0) return 0
  return Math.min(count - 1, Math.max(0, at + by))
}

export function rowsThatFit(bodyRows: number): number {
  return Math.max(1, Math.min(8, Math.floor((bodyRows - 6) / 2)))
}

export const EMPTY_TEXT = 'No Codex tasks yet. Route a subagent type in /config → duet, or run /duet review.'

/** One task in each state, for `/duet demo`. */
export function demoTasks(now: number): Task[] {
  const base = { model: 'gpt-5-codex', endedAt: null, envelope: null, detail: '', tokens: 0 }
  const env: Envelope = { specVersion: '3fa9c21', base: '45798a0', candidate: 'no files changed', sandbox: 'read-only', scope: '/work/app', role: 'code-explorer' }
  return [
    { ...base, id: 'd6', provider: 'codex', kind: 'agent', subagentType: 'code-explorer', status: 'running', startedAt: now - 72_000, tokens: 38_000, description: 'Find every caller of parseConfig and list risky ones', envelope: env },
    { ...base, id: 'd5', provider: 'codex', kind: 'review', subagentType: '--base main', status: 'done', startedAt: now - 400_000, endedAt: now - 240_000, tokens: 61_000, description: 'review --base main', detail: 'verdict: changes requested (1 high, 2 medium, 0 low)' },
    { ...base, id: 'd4', provider: 'codex', kind: 'agent', subagentType: 'duet:codex-advisor', status: 'done', startedAt: now - 900_000, endedAt: now - 780_000, tokens: 24_000, description: 'Summarise README.md', envelope: { ...env, role: '', candidate: 'no files changed' } },
    { ...base, id: 'd3', provider: 'codex', kind: 'agent', subagentType: 'duet:codex-advisor', status: 'stopped', startedAt: now - 960_000, endedAt: now - 950_000, tokens: 2_000, description: 'Check the error handling', detail: STOPPED, envelope: { ...env, candidate: STOPPED_CANDIDATE } },
    { ...base, id: 'd2', provider: 'codex', kind: 'agent', subagentType: 'Explore', status: 'error', startedAt: now - 1_000_000, endedAt: now - 996_000, description: 'Map the auth flow', detail: 'codex: not signed in. Run `codex login`, then retry.' },
    { ...base, id: 'd1', provider: 'codex', kind: 'agent', subagentType: 'test-writer', status: 'refused', startedAt: now - 1_100_000, endedAt: now - 1_100_000, description: 'Add tests for the parser', detail: 'limit: 2 Codex runs already running' },
  ]
}

/**
 * What a bare pane command does (#31): `open` a pane that is not listed, `close` one the surface shows, `show` one that is
 * a tab behind another pane. Callers pass what `$.ui.panes()` answers, whole: a pane waiting undrawn
 * (`isPlaced: false`, an unasked open on a narrow terminal) is no tab behind another, so it counts as not listed and the
 * command's open seats it.
 */
export function paneAction(panes: readonly { id: string; isShown: boolean; isPlaced: boolean }[], id: string): 'open' | 'close' | 'show' {
  const pane = panes.find(p => p.id === id && p.isPlaced)
  return !pane ? 'open' : pane.isShown ? 'close' : 'show'
}

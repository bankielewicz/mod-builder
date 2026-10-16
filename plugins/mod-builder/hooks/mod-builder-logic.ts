/**
 * Mod Lab's deterministic core: every rule that needs no `$`.
 *
 * register.tsx gathers facts from disk and process exit codes, hands them here,
 * and draws what comes back. Nothing in this file reads the clock, the disk or
 * the engine, so every rule is unit-tested in tests/mod-builder-logic.test.ts.
 */

import type { Gate, Light, ModView, Pin, Reach, Reported, Run, RunKind, Stage, Tone } from '../types'

export type { Gate, Light, ModView, Pin, Reach, Reported, Run, RunKind, Stage, Tone }

export const STAGES = [
  'Spec',
  'Scaffold',
  'Logic',
  'Register',
  'Validate',
  'Test',
  'README',
  'Share',
] as const satisfies readonly Stage[]

/** What register.tsx reads off disk for one mod folder. */
export type FileFacts = {
  name: string
  hasSpec: boolean
  /** SPEC.md still holds an unfilled `<placeholder>` outside code. */
  specHasPlaceholder: boolean
  hasManifest: boolean
  hasHooksJson: boolean
  /** hooks/ holds a module other than register.ts(x). */
  hasLogic: boolean
  /** tests/ holds at least one *.test.ts(x). */
  hasTests: boolean
  hasRegister: boolean
  hasReadme: boolean
  /** README.md has a "What it reaches" heading. */
  readmeHasReaches: boolean
  /** The marketplace beside the mods folder lists this mod. */
  isListed: boolean
  /**
   * Newest mtime of what validate and test read: the manifest, hooks/, tests/, types/, agents/,
   * commands/ and skills/ with their subfolders, and the root .mcp.json.
   */
  codeMtimeMs: number
  /**
   * A signature of every code file's path and mtime (the files `codeMtimeMs` covers, subfolders
   * up to 3 deep): changes on an edit, an add, a delete, a rename or a move between folders.
   */
  codeSig: string
  /** Oldest and newest mtime of anything in the folder, for the build span. */
  firstMtimeMs: number
  lastMtimeMs: number
  /** From SPEC.md's slot table, when present. */
  archetype: string | null
  builtOn: string | null
  /** From plugin.json, when present. */
  version: string | null
  description: string | null
  /** README.md is older than the newest code. */
  isReadmeStale: boolean
  /** When SPEC.md, the newest logic or test file (subfolders included), and README.md were last saved (0 when absent). */
  specMtimeMs: number
  logicMtimeMs: number
  readmeMtimeMs: number
  /** The version the marketplace lists this mod at, when it does. */
  listedVersion: string | null
}

export type ValidateReport = {
  ok: boolean
  hooks: string[]
  calls: string[]
  gates: Gate[]
  errors: string[]
  warnings: string[]
}

export type TestReport = {
  ok: boolean
  passed: number
  failed: number
  durationMs: number | null
  failures: string[]
}

/** One finished run, kept in `$.store` per mod. */
export type RunResult = {
  kind: RunKind
  ok: boolean
  /** The mod's codeMtimeMs when the run started; newer code makes it stale. */
  stampMs: number
  /** The mod's codeSig when the run started; any difference makes it stale (older results lack it). */
  codeSig?: string
  /** One line for the row and the toast. */
  summary: string
  /** The first few error lines, for the detail panel and Fix with Claude. */
  errors: string[]
  /** How long the run took. */
  durationMs?: number
  /** When the run finished; judged against an edit's generation. */
  atMs?: number
  validate?: ValidateReport
  /** Test counts, for "12 tests · clean" and the done line. */
  tests?: { passed: number; failed: number }
}

export type Results = Partial<Record<RunKind, RunResult>>

// ── Stages ────────────────────────────────────────────────────────────────

/**
 * The eight lights of one mod, from the disk, the stored runs and what runs
 * now. The disk and exit codes decide passed or failed; a report from the
 * model only ever adds `running` (SPEC non-negotiable 2).
 */
export function lightsOf(
  facts: FileFacts,
  results: Results,
  running: readonly RunKind[],
  reported: Reported | null,
  sinceMs: number | null = null,
  fromVersion: string | null = null,
): Light[] {
  // During an edit (sinceMs set), evidence older than the edit's start is stale:
  // it passed before, and has to be redone for this change.
  const isOld = (atMs: number): boolean => sinceMs !== null && atMs < sinceMs
  const runLight = (kind: 'Validate' | 'Test'): Light => {
    if (running.includes(kind)) return 'running'
    const result = results[kind]
    if (!result) return 'pending'
    const isChanged = result.codeSig !== undefined ? result.codeSig !== facts.codeSig : result.stampMs < facts.codeMtimeMs
    if (isChanged || isOld(result.atMs ?? 0)) return 'stale'
    return result.ok ? 'passed' : 'failed'
  }
  const fileLight = (isDone: boolean, savedMs?: number): Light =>
    !isDone ? 'pending' : savedMs !== undefined && isOld(savedMs) ? 'stale' : 'passed'
  // During an edit, Share needs a new version (not the one the edit started from) that the marketplace lists.
  const isReShared =
    sinceMs === null ||
    (facts.listedVersion !== null && facts.listedVersion === facts.version && (fromVersion === null || facts.version !== fromVersion))

  const lights: Light[] = [
    fileLight(facts.hasSpec && !facts.specHasPlaceholder, facts.specMtimeMs),
    fileLight(facts.hasManifest && facts.hasHooksJson),
    fileLight(facts.hasLogic && facts.hasTests, facts.logicMtimeMs),
    fileLight(facts.hasRegister),
    runLight('Validate'),
    runLight('Test'),
    fileLight(facts.hasReadme && facts.readmeHasReaches, facts.readmeMtimeMs),
    !facts.isListed ? 'pending' : isReShared ? 'passed' : 'stale',
  ]

  // What the skill says it is doing now always shows, even on a stage that
  // passed before. A report never passes a stage: the disk does.
  if (reported?.status === 'running') {
    const at = STAGES.indexOf(reported.stage)
    if (lights[at] !== 'failed') lights[at] = 'running'
  }
  return lights
}

/**
 * Whether a `Spec running` report starts a new build generation: the mod has
 * been built before (its Spec stage already passed), so this is an edit.
 */
export function startsGeneration(report: Reported, lights: readonly Light[] | null): boolean {
  return report.stage === 'Spec' && report.status === 'running' && lights !== null && lights[0] !== 'pending'
}

/** The first failed stage, else the first running, else the first not passed. */
export function focusStageOf(lights: readonly Light[]): { stage: Stage; light: Light } | null {
  for (const want of ['failed', 'running'] as const) {
    const at = lights.indexOf(want)
    if (at >= 0) return { stage: STAGES[at]!, light: want }
  }
  const at = lights.findIndex(light => light !== 'passed')
  return at >= 0 ? { stage: STAGES[at]!, light: lights[at]! } : null
}

/** What a run in flight is doing, in a few words: `validating`, `running tests · 7 of 12`. */
export function runningTextOf(run: Pick<Run, 'kind' | 'passed' | 'failed' | 'total'>): string {
  if (run.kind === 'Validate') return 'validating'
  if (run.kind === 'Typecheck') return 'type-checking'
  const done = run.passed + run.failed
  if (run.total) return `running tests · ${done} of ${run.total}`
  return done ? `running tests · ${done} so far` : 'running tests'
}

/** `12 tests · clean`: the quiet status of a green mod. */
export function cleanTextOf(results: Results): string {
  const tests = results.Test?.tests
  const count = tests ? plural(tests.passed, 'test') : 'tests'
  return `${count} · ${results.Validate?.ok ? 'clean' : 'passing'}`
}

/** The row's one-line status and its tone, in the design's words. */
export function statusOf(
  lights: readonly Light[],
  results: Results,
  reported: Reported | null,
  runs: readonly Run[],
  isFresh: boolean,
): { text: string; tone: Tone } {
  const run = runs[0]
  if (run) return { text: runningTextOf(run), tone: 'text' }
  const focus = focusStageOf(lights)
  if (!focus) return isFresh ? { text: 'ready to share', tone: 'success' } : { text: cleanTextOf(results), tone: 'dim' }
  const { stage, light } = focus
  if (light === 'failed') {
    if (stage === 'Test') return { text: results.Test?.summary ?? 'tests failing', tone: 'error' }
    return { text: `validate · ${results.Validate?.summary ?? 'failed'}`, tone: 'error' }
  }
  if (light === 'running') {
    const note = reported?.stage === stage && reported.note ? reported.note : `${stage.toLowerCase()} in progress`
    return { text: note, tone: 'text' }
  }
  if (light === 'stale') {
    if (stage === 'Validate' || stage === 'Test') return { text: `files changed · re-run ${stage}`, tone: 'warn' }
    if (stage === 'Share') return { text: 'edit · bump the version and re-list it', tone: 'warn' }
    return { text: `edit · update ${stage} for this change`, tone: 'warn' }
  }
  return { text: `next: ${stage}`, tone: 'dim' }
}

/**
 * What to re-run for a mod at the end of a turn: Validate when Validate or
 * Test has gone stale (the code changed after they passed), then Test. Nothing
 * while a run for that mod is already in flight.
 */
export function rerunPlanOf(lights: readonly Light[], isRunning: boolean): RunKind[] {
  if (isRunning) return []
  const validate = lights[STAGES.indexOf('Validate')]
  const test = lights[STAGES.indexOf('Test')]
  // A Validate that failed on the current code blocks Test; re-running it changes nothing.
  if (validate === 'stale') return test === 'pending' ? ['Validate'] : ['Validate', 'Test']
  if ((validate === 'passed' || validate === 'pending') && test === 'stale') return ['Test']
  return []
}

/** Every light green. */
export function isGreen(lights: readonly Light[]): boolean {
  return lights.length === STAGES.length && lights.every(light => light === 'passed')
}

// ── Reading files ─────────────────────────────────────────────────────────

/**
 * The start of a line that ends a paragraph: a blank line, or one that opens an
 * ATX heading, a list item or a block quote. `$` is the end of the input (no
 * `m` flag). A heading or quote takes at most three spaces of indent, as in
 * CommonMark; a list item takes any, since nested items sit deeper. Any `N.`
 * counts as an item, though CommonMark lets only `1.` interrupt a paragraph.
 */
const BLOCK_BREAK = String.raw`(?:[ \t]*(?:\r?\n|$|[-*+][ \t]|\d{1,9}[.)][ \t])| {0,3}(?:#{1,6}(?:[ \t]|$)|>))`

/**
 * An escaped `\` or backtick, which opens no span, or an inline code span: it
 * may wrap over lines, but not into another block (CommonMark).
 */
const ESCAPE_OR_SPAN = new RegExp(String.raw`\\[\\\x60]|\x60(?:[^\x60\n]|\n(?!${BLOCK_BREAK}))*\x60`, 'g')

/**
 * Whether a SPEC still holds a `<placeholder>`: an angle-bracketed phrase
 * outside fenced code, inline code and HTML comments.
 */
export function hasPlaceholder(spec: string): boolean {
  const prose = spec
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(ESCAPE_OR_SPAN, m => (m.startsWith('\\') ? m : ''))
  return /<(?![/!])[^<>\n]{1,120}>/.test(prose)
}

/**
 * The SPEC's slot table as `slot → value`: rows of `| slot | kind | value | … |`,
 * the slot cut at its first space or parenthesis, the value with code ticks dropped.
 */
export function slotsOf(spec: string): Record<string, string> {
  const slots: Record<string, string> = {}
  for (const line of spec.split('\n')) {
    const cells = line.split('|').map(cell => cell.trim())
    if (cells.length < 5 || !/^(REQUIRED|HOUSE|ARCH)/.test(cells[2] ?? '')) continue
    const slot = (cells[1] ?? '').split(/[\s(]/)[0]!.toLowerCase()
    const value = (cells[3] ?? '').replace(/`/g, '').trim()
    if (slot && value) slots[slot] = value
  }
  return slots
}

/** Whether a README has its "What it reaches" heading. */
export function hasReachesHeading(readme: string): boolean {
  return /^#{1,6}\s+what it reaches\b/im.test(readme)
}

/** Whether a README is finished: the heading is there and no template `<!-- … -->` comment is left. */
export function isReadmeDone(readme: string): boolean {
  return hasReachesHeading(readme) && !/<!--/.test(readme)
}

type MarketplaceEntry = { name?: unknown; source?: unknown; version?: unknown }

/** The marketplace entry for a mod: by name, or by a `…/<name>` source. Null when unlisted or unreadable. */
export function findEntry(marketplace: string, name: string): MarketplaceEntry | null {
  try {
    const parsed = JSON.parse(marketplace) as { plugins?: MarketplaceEntry[] }
    return (
      (parsed.plugins ?? []).find(
        plugin =>
          plugin.name === name ||
          (typeof plugin.source === 'string' && plugin.source.replace(/\/+$/, '').endsWith(`/${name}`)),
      ) ?? null
    )
  } catch {
    return null
  }
}

/** The version a marketplace.json lists the mod at, or null when unlisted or unversioned. */
export function listedVersionOf(marketplace: string, name: string): string | null {
  const version = findEntry(marketplace, name)?.version
  return typeof version === 'string' ? version : null
}

/** Whether a marketplace.json lists the mod by name or by a `…/<name>` source. */
export function isListedIn(marketplace: string, name: string): boolean {
  return findEntry(marketplace, name) !== null
}

/** Whether a hooks/ file name is a module other than the register entry. */
export function isLogicModule(file: string): boolean {
  return /\.(m|c)?(t|j)sx?$/.test(file) && !/^register\./.test(file) && !/\.d\.ts$/.test(file)
}

/** Whether a tests/ file name is one `claude plugin test` collects. */
export function isTestFile(file: string): boolean {
  return /\.test\.tsx?$/.test(file)
}

/** Whether a nested file (named by its path from the mod folder) is logic under hooks/ or a test under tests/. Freshness only: existence stays top-level. */
export function isNestedLogicOrTest(path: string): boolean {
  const base = path.slice(path.lastIndexOf('/') + 1)
  if (path.startsWith('hooks/')) return isLogicModule(base)
  return path.startsWith('tests/') && isTestFile(base)
}

// ── Parsing what the commands print ───────────────────────────────────────

/** Splits on commas outside braces and parentheses. */
export function splitTop(list: string): string[] {
  const parts: string[] = []
  let depth = 0
  let part = ''
  for (const char of list) {
    if (char === '{' || char === '(') depth += 1
    if (char === '}' || char === ')') depth = Math.max(0, depth - 1)
    if (char === ',' && depth === 0) {
      if (part.trim()) parts.push(part.trim())
      part = ''
    } else {
      part += char
    }
  }
  if (part.trim()) parts.push(part.trim())
  return parts
}

type ValidateSection = {
  errors?: { path?: string; message?: string }[]
  warnings?: { path?: string; message?: string }[]
  notes?: string[]
  gatingHooks?: { hook?: string; hasCatch?: boolean }[]
}

type ValidateJson = {
  success?: boolean
  manifest?: ValidateSection
  contents?: ValidateSection[]
}

/** `claude plugin validate --json` output (and its exit code) → a report. */
export function parseValidate(stdout: string, exitCode: number): ValidateReport {
  let json: ValidateJson
  try {
    json = JSON.parse(stdout.slice(Math.max(0, stdout.indexOf('{')))) as ValidateJson
  } catch {
    return { ok: false, hooks: [], calls: [], gates: [], errors: nonBlankLines(stdout).slice(0, 3), warnings: [] }
  }
  const sections = [json.manifest, ...(json.contents ?? [])].filter(
    (section): section is ValidateSection => section !== undefined,
  )
  const hooks: string[] = []
  const calls: string[] = []
  const gates: Gate[] = []
  const errors: string[] = []
  const warnings: string[] = []
  for (const section of sections) {
    for (const note of section.notes ?? []) {
      const hooked = note.match(/\bhooks: (.*)$/)
      if (hooked) hooks.push(...splitTop(hooked[1]!))
      const called = note.match(/\bcalls: (.*)$/)
      if (called && called[1] !== 'nothing on $') {
        calls.push(...splitTop(called[1]!).map(call => call.replace(/\s*\(via .*\)$/, '')))
      }
    }
    for (const gate of section.gatingHooks ?? []) {
      if (gate.hook) gates.push({ hook: gate.hook, hasCatch: gate.hasCatch === true })
    }
    for (const error of section.errors ?? []) errors.push(`${error.path ?? ''}: ${error.message ?? ''}`)
    for (const warning of section.warnings ?? []) {
      warnings.push(`${warning.path ?? ''}: ${warning.message ?? ''}`)
    }
  }
  return {
    ok: exitCode === 0 && json.success !== false,
    hooks: [...new Set(hooks)],
    calls: [...new Set(calls)],
    gates,
    errors,
    warnings,
  }
}

/** `claude plugin test` output (bun's reporter, with stderr) and its exit code → a report. */
export function parseTest(output: string, exitCode: number): TestReport {
  const count = (word: string): number =>
    Number(output.match(new RegExp(`^\\s*(\\d+) ${word}\\s*$`, 'm'))?.[1] ?? 0)
  const time = output.match(/^Ran \d+ tests? across .*\[(\d+(?:\.\d+)?)(ms|s)\]\s*$/m)
  const durationMs = time ? Math.round(Number(time[1]) * (time[2] === 's' ? 1000 : 1)) : null
  const lines = output.split('\n')
  const failures: string[] = []
  lines.forEach((line, at) => {
    if (!line.startsWith('(fail) ')) return
    failures.push(line.slice(7).replace(/\s*\[[\d.]+m?s\]$/, ''))
    const detail = lines
      .slice(at + 1, at + 3)
      .map(next => next.trim())
      .find(Boolean)
    if (detail && !detail.startsWith('(')) failures.push(`  ${detail}`)
  })
  // Exits before the runner starts (no tests, bad folder, corrupt manifest) print one stderr line and no `(fail)`.
  if (exitCode !== 0 && !failures.length) failures.push(...nonBlankLines(output).slice(-3))
  const failed = count('fail')
  return {
    ok: exitCode === 0 && failed === 0,
    passed: count('pass'),
    failed,
    durationMs,
    failures: failures.slice(0, 6),
  }
}

/** `tsc -p` output → its error lines, each cut to `file(line,col): message`; none means clean. */
export function parseTsc(stdout: string): string[] {
  return stdout
    .split('\n')
    .filter(line => /error TS\d+/.test(line))
    .map(line => line.replace(/^.*?([^/\\]+\.tsx?\(\d+,\d+\))/, '$1').trim())
}


/** A finished run's one-line summary. */
export function summaryOfRun(
  kind: RunKind,
  ok: boolean,
  detail: { validate?: ValidateReport; test?: TestReport; tscErrors?: readonly string[] },
): string {
  if (kind === 'Validate' && detail.validate) {
    const v = detail.validate
    if (!ok) return plural(Math.max(1, v.errors.length), 'problem')
    const gates = v.gates.length ? ` · ${plural(v.gates.length, 'gate')}` : ''
    return `clean · ${plural(v.hooks.length, 'hook')}${gates}`
  }
  if (kind === 'Test' && detail.test) {
    const t = detail.test
    if (!ok) return t.failed === 0 ? 'tests did not run' : `${plural(t.failed, 'test')} failing`
    const time = t.durationMs === null ? '' : ` in ${(t.durationMs / 1000).toFixed(1)}s`
    return `${plural(t.passed, 'test')} passed${time}`
  }
  if (kind === 'Typecheck') {
    return ok ? 'types clean' : plural(Math.max(1, detail.tscErrors?.length ?? 0), 'type error')
  }
  return ok ? 'passed' : 'failed'
}

/** What a mod reaches, grouped from validate's `calls:` list. */
export function reachesOf(calls: readonly string[]): Reach[] {
  const of = (noun: string): string => {
    const methods = calls.filter(call => call.startsWith(`$.${noun}.`)).map(call => call.slice(noun.length + 3))
    return methods.length ? methods.join(', ') : 'none'
  }
  return [
    { label: 'processes', value: of('process') },
    { label: 'files', value: of('fs') },
    { label: 'network', value: of('http') },
    { label: 'model', value: of('model') },
    { label: 'mcp', value: of('mcp') },
  ]
}

// ── Text ──────────────────────────────────────────────────────────────────

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`
const nonBlankLines = (text: string): string[] => text.split('\n').map(line => line.trim()).filter(Boolean)

/** `0:42`, `12:05`, `3h`, `2d`; an empty string under a second. */
export function durationOf(ms: number): string {
  if (!(ms >= 1000)) return ''
  const seconds = Math.floor(ms / 1000)
  if (seconds < 3600) return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  return `${Math.floor(seconds / 86400)}d`
}

/** Like durationOf, but `0:00` rather than empty: for clocks that must always show. */
export function clockOf(ms: number): string {
  return durationOf(ms) || '0:00'
}

export type Counts = { mods: number; green: number; building: number; failing: number; stale: number }

export function countsOf(views: readonly ModView[]): Counts {
  return {
    mods: views.length,
    green: views.filter(view => isGreen(view.lights)).length,
    building: views.filter(view => view.lights.includes('running')).length,
    failing: views.filter(view => view.lights.includes('failed')).length,
    stale: views.filter(view => view.lights.includes('stale')).length,
  }
}

/** The summary's parts, joined in the pane by a dim ` · `; counts of zero are left out. */
export function summaryPartsOf(counts: Counts): string[] {
  if (counts.mods === 0) return ['0 mods']
  return [
    plural(counts.mods, 'mod'),
    counts.green ? `${counts.green} green` : '',
    counts.building ? `${counts.building} building` : '',
    counts.failing ? `${counts.failing} failing` : '',
    counts.stale ? `${counts.stale} stale` : '',
  ].filter(Boolean)
}

/** `3 mods · 2 green · 1 building`. */
export function summaryOf(counts: Counts): string {
  return counts.mods === 0 ? 'no mods yet' : summaryPartsOf(counts).join(' · ')
}

/** Letter-spaced text: `mod lab` → `M O D   L A B`. */
export function spaced(text: string): string {
  return text
    .toUpperCase()
    .split(' ')
    .map(word => word.split('').join(' '))
    .join('   ')
}

/**
 * The masthead's state word and its tone. While building, `dot` is the `●` that
 * pulses on its own (the letters never move).
 */
export function mastheadOf(counts: Counts): { dot: boolean; word: string; tone: Tone } {
  if (counts.building) return { dot: true, word: spaced('building'), tone: 'success' }
  if (counts.failing) return { dot: false, word: spaced(`${counts.failing} failing`), tone: 'error' }
  if (counts.mods && counts.green === counts.mods) return { dot: false, word: spaced('all green'), tone: 'success' }
  return { dot: false, word: spaced('standing by'), tone: 'dim' }
}

/** The building `●` toggles dimColor every 4 ticks (1 Hz at 250 ms). */
export function isPulseDim(frame: number): boolean {
  return Math.floor(frame / 4) % 2 === 1
}

/** The status-line badge; undefined clears it (no mods). Plain text: the host does not colour it. */
export function badgeOf(counts: Counts): string | undefined {
  if (counts.mods === 0) return undefined
  const head = `◆ ${plural(counts.mods, 'mod')}`
  if (counts.building) return `${head} · ${counts.building} building`
  if (counts.failing) return `${head} · ${counts.failing} failing`
  if (counts.green === counts.mods) return `${head} · all green`
  return `${head} · ${counts.mods - counts.green} in progress`
}

/** Under 34 columns nothing is drawn (and the too-narrow toast fires once). */
export type Layout = 'full' | 'medium' | 'compact' | 'none'

export function layoutOf(bodyColumns: number): Layout {
  if (bodyColumns >= 60) return 'full'
  if (bodyColumns >= 40) return 'medium'
  if (bodyColumns >= 34) return 'compact'
  return 'none'
}

/** One drawn cell run: a glyph or word with its colour role, bold and dimColor. */
export type Mark = { text: string; tone: Tone; bold?: boolean; dim?: boolean }

/** A light's glyph at an animation frame. Running cycles ◐ · ◐ dim · ○, all accent. */
export function lightMarkOf(light: Light, frame = 0): Mark {
  if (light === 'passed') return { text: '●', tone: 'success' }
  if (light === 'failed') return { text: '✕', tone: 'error', bold: true }
  if (light === 'stale') return { text: '◌', tone: 'warn' }
  if (light === 'pending') return { text: '○', tone: 'dim' }
  const at = frame % 3
  return at === 1 ? { text: '◐', tone: 'accent', dim: true } : { text: at === 2 ? '○' : '◐', tone: 'accent', bold: true }
}

/**
 * The column header above the lights: one stage number per light, at the
 * lights' pitch of 2 (digit + space). The number over the selected mod's
 * failed, else running, else stale stage lights up; the rest are dim. The detail panel's
 * track carries the same numbers beside the stage names, as the key.
 */
export function columnsOf(lights: readonly Light[]): Mark[] {
  const first = (light: Light): number => lights.indexOf(light)
  const focus = [first('failed'), first('running'), first('stale')].find(at => at >= 0) ?? -1
  const tone: Tone = lights[focus] === 'failed' ? 'error' : lights[focus] === 'stale' ? 'warn' : 'accent'
  return STAGES.map((_, at) =>
    at === focus ? { text: `${at + 1} `, tone, bold: true } : { text: `${at + 1} `, tone: 'dim' },
  )
}

/**
 * The pipeline track: each stage name in its light's colour, then its
 * connector. After a passed stage whose next has started: `━` success. After
 * a running stage: `┅ ━ ┄` by frame, accent. Otherwise `┄` dim.
 */
export function trackOf(lights: readonly Light[], frame = 0): { num: Mark; name: Mark; joint: Mark | null }[] {
  return STAGES.map((stage, at) => {
    const light = lights[at] ?? 'pending'
    const next = lights[at + 1]
    const name: Mark =
      light === 'passed'
        ? { text: stage, tone: 'success' }
        : light === 'running'
          ? { text: stage, tone: 'accent', bold: true }
          : light === 'failed'
            ? { text: stage, tone: 'error', bold: true }
            : light === 'stale'
              ? { text: stage, tone: 'warn' }
              : { text: stage, tone: 'dim' }
    const num: Mark = { text: `${at + 1} `, tone: 'dim', dim: true }
    if (at === STAGES.length - 1) return { num, name, joint: null }
    let joint: Mark = { text: ' ┄ ', tone: 'dim', dim: true }
    if (light === 'running') joint = { text: ` ${['┅', '━', '┄'][frame % 3]} `, tone: 'accent' }
    else if (light === 'passed' && next !== undefined && next !== 'pending') joint = { text: ' ━ ', tone: 'success' }
    return { num, name, joint }
  })
}

/** A 15-cell bar filled to `fraction` (0..1), for real progress only. */
export function barOf(fraction: number, width = 15): { filled: string; empty: string } {
  const cells = Math.max(0, Math.min(width, Math.round(width * fraction)))
  return { filled: '━'.repeat(cells), empty: '░'.repeat(width - cells) }
}

/**
 * The draft `[F] Fix with Claude` puts in the prompt box: plain words, the
 * first failure quoted from the error box. `path` is the mod's folder as the
 * session should read it (see `displayPathOf`).
 */
export function fixPromptOf(name: string, stage: Stage, errors: readonly string[], failedCount: number, path: string): string {
  // A Test with no failing test never ran: the errors are the runner's own line, not a test.
  const didNotRun = stage === 'Test' && failedCount === 0
  const what = didNotRun
    ? 'the Test run'
    : stage === 'Test'
      ? `the ${failedCount === 1 ? 'failing test' : `${failedCount} failing tests`}`
      : `the ${stage} problem${failedCount === 1 ? '' : 's'}`
  const [first, ...rest] = errors
  const quoted = [`    ✕ ${(first ?? '').trim()}`, ...rest.slice(0, 2).map(line => `      ${line.trim()}`)].join('\n')
  // `in .. First failure` would read as the parent folder.
  const where = path === '.' ? 'the current folder' : path
  const note = didNotRun ? ' (the tests did not run)' : ''
  return `Fix ${what} in ${where}${note}. First failure, from Mod Lab:\n${quoted}\nThen re-run ${stage}.`
}

/** The done box's one line: `ready to share  ·  8/8 stages · 12 tests · validate clean · 1 gate`. */
export function doneLineOf(results: Results): string {
  const parts = ['8/8 stages']
  const tests = results.Test?.tests
  if (tests) parts.push(plural(tests.passed, 'test'))
  if (results.Validate?.ok) parts.push('validate clean')
  const gates = results.Validate?.validate?.gates.length ?? 0
  if (gates) parts.push(plural(gates, 'gate'))
  return parts.join(' · ')
}

/**
 * The view of one mod, from everything gathered. `path` is the mod's folder
 * as shown in the detail header (see `displayPathOf`).
 */
export function viewOf(
  facts: FileFacts,
  results: Results,
  runs: readonly Run[],
  reported: Reported | null,
  isFresh: boolean,
  sinceMs: number | null = null,
  fromVersion: string | null = null,
  path: string,
): ModView {
  const lights = lightsOf(facts, results, runs.map(run => run.kind), reported, sinceMs, fromVersion)
  const { text, tone } = statusOf(lights, results, reported, runs, isFresh && isGreen(lights))
  const validate = results.Validate?.validate
  const focus = focusStageOf(lights)
  const failedStage = focus?.light === 'failed' ? focus.stage : null
  const failedRun = failedStage === 'Validate' || failedStage === 'Test' ? results[failedStage] : undefined
  const last = [results.Validate, results.Test].filter((one): one is RunResult => one !== undefined)
  const lastMs = last.reduce((longest, one) => Math.max(longest, one.durationMs ?? 0), 0)
  const fresh = isFresh && isGreen(lights)
  return {
    name: facts.name,
    lights,
    status: text,
    tone,
    time: durationOf(lastMs),
    isDemo: false,
    isFresh: fresh,
    version: facts.version,
    description: facts.description,
    path: `${path}/`,
    isReadmeStale: facts.isReadmeStale,
    doneLine: fresh ? doneLineOf(results) : null,
    archetype: facts.archetype,
    builtOn: facts.builtOn,
    hooks: validate?.hooks ?? [],
    reaches: validate ? reachesOf(validate.calls) : [],
    gates: validate?.gates ?? [],
    errors: failedRun?.errors ?? [],
    failedStage,
    // factsOf never returns facts without a manifest or SPEC, so these are the placeholder's (#19).
    isPlaceholder: !facts.hasSpec && !facts.hasManifest,
  }
}

// ── Demo ──────────────────────────────────────────────────────────────────

/** One beat of the demo: from `atMs`, `stage` shows `light`, with what the row says. */
export type Beat = { atMs: number; stage: Stage; light: Light; note?: string }

/**
 * The demo build of `aurora`: every stage runs then passes, Test fails once
 * and Claude fixes it. Exactly 12 s, then it holds green for 3 s.
 */
export function demoTimeline(): Beat[] {
  const beats: Beat[] = []
  let at = 0
  const step = (stage: Stage, runMs: number, light: Light, note: string): void => {
    beats.push({ atMs: at, stage, light: 'running', note })
    at += runMs
    beats.push({ atMs: at, stage, light })
  }
  step('Spec', 1000, 'passed', 'writing SPEC.md')
  step('Scaffold', 800, 'passed', 'scaffolding plugin.json')
  step('Logic', 1400, 'passed', 'aurora-logic.ts + tests')
  step('Register', 1000, 'passed', 'register.tsx')
  step('Validate', 1300, 'passed', 'validating')
  step('Test', 1300, 'failed', 'running tests')
  at += 1600
  step('Test', 1300, 'passed', 'Claude is fixing src/band.tsx')
  step('README', 1300, 'passed', 'What it reaches')
  step('Share', 1000, 'passed', 'marketplace entry')
  return beats
}

export const DEMO_NAME = 'aurora'

/** How long the demo holds green after its last beat, before the real state returns. */
export const DEMO_HOLD_MS = 3000

export function demoWalkMs(beats: readonly Beat[] = demoTimeline()): number {
  return beats[beats.length - 1]?.atMs ?? 0
}

export function demoLengthMs(beats: readonly Beat[] = demoTimeline()): number {
  return demoWalkMs(beats) + DEMO_HOLD_MS
}

/** While the demo runs, the summary row: `aurora is a demo · nothing is written to disk`, and `0:02 / 0:12`. */
export function demoClockOf(elapsedMs: number, beats: readonly Beat[] = demoTimeline()): { now: string; total: string } {
  const walk = demoWalkMs(beats)
  return { now: clockOf(Math.min(elapsedMs, walk)), total: clockOf(walk) }
}

const DEMO_ERRORS = ['band steps aside when hasSurvey is true', 'expected 0 band rows, received 2', 'at test/band.test.ts:18:5']

/** The line that replaces `[F] Fix with Claude` while the demo's test is failing. */
export const DEMO_FIXING = 'Claude is fixing src/band.tsx'

/** The demo mod as a view, `elapsedMs` into the demo. */
export function demoViewAt(elapsedMs: number, beats: readonly Beat[] = demoTimeline()): ModView {
  const lights: Light[] = STAGES.map(() => 'pending')
  let current: Beat | undefined
  for (const beat of beats) {
    if (beat.atMs > elapsedMs) break
    lights[STAGES.indexOf(beat.stage)] = beat.light
    current = beat
  }
  const testFailed = lights[STAGES.indexOf('Test')] === 'failed'
  const isDone = isGreen(lights)
  let status: { text: string; tone: Tone }
  if (isDone) status = { text: 'ready to share', tone: 'success' }
  else if (current?.light === 'running') status = { text: current.note ?? 'running', tone: 'text' }
  else if (testFailed) status = { text: '1 test failing', tone: 'error' }
  else status = { text: `next: ${STAGES[lights.findIndex(light => light !== 'passed')] ?? 'Share'}`, tone: 'dim' }
  const hasValidated = lights[STAGES.indexOf('Validate')] === 'passed'
  const walk = demoWalkMs(beats)
  return {
    name: DEMO_NAME,
    lights,
    status: status.text,
    tone: status.tone,
    time: clockOf(Math.min(elapsedMs, walk)),
    isDemo: true,
    isFresh: isDone,
    version: 'demo',
    description: 'A pretend mod. Walks all 8 stages in 12 seconds.',
    path: 'not written to disk',
    isReadmeStale: false,
    doneLine: isDone ? `${DEMO_NAME} walked all 8 stages in ${clockOf(walk)}  ·  demo, nothing saved` : null,
    archetype: 'band + command',
    builtOn: null,
    hooks: hasValidated ? ['session.start', 'command.run{command=aurora}', 'ui.render{component=AbovePrompt}'] : [],
    reaches: hasValidated ? reachesOf(['$.clock.every', '$.ui.status']) : [],
    gates: [],
    errors: testFailed ? DEMO_ERRORS : [],
    failedStage: testFailed ? 'Test' : null,
    isPlaceholder: false,
  }
}

// ── Gathering ─────────────────────────────────────────────────────────────

/** A directory entry as `$.fs.list` gives it, cut to what Mod Lab reads. */
export type Entry = { name: string; kind: 'file' | 'dir' | 'other'; mtimeMs: number }

/** How many parts of a UNC path (`//server/share`) are its root. */
const UNC_ROOT_PARTS = 2

/** Resolves `.` and `..` segments in a `/`-separated path. */
export function normalizePath(path: string): string {
  const slashed = path.replace(/\\/g, '/')
  const root = rootOf(slashed)
  // A UNC path's server and share are part of its root: '..' stops above them, as at `/`.
  const floor = root === '//' ? UNC_ROOT_PARTS : 0
  const parts: string[] = []
  for (const part of slashed.slice(root.length).split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (parts.length > floor && parts[parts.length - 1] !== '..') parts.pop()
      else if (!root) parts.push('..')
    } else {
      parts.push(part)
    }
  }
  return root + parts.join('/')
}

/** A `/`-separated path's root: `//` for a UNC path, `/`, a drive (`C:/`, upper case), or '' when it is relative. */
function rootOf(slashed: string): string {
  if (/^\/\/[^/]/.test(slashed)) return '//'
  if (slashed.startsWith('/')) return '/'
  return /^[A-Za-z]:(\/|$)/.test(slashed) ? `${slashed.charAt(0).toUpperCase()}:/` : ''
}

/**
 * A path as the session reads it: relative to `cwd` when inside it
 * (`mods/foo`), `.` when it is `cwd`, absolute otherwise, and absolute when
 * the working directory couldn't be read (`cwd` null).
 */
export function displayPathOf(path: string, cwd: string | null): string {
  const target = normalizePath(path)
  if (cwd === null) return target
  const root = normalizePath(cwd)
  if (target === root) return '.'
  // `normalizePath` keeps a trailing `/` only for the root itself: cwd `/` gives prefix `/`, not `//`.
  const prefix = `${root.replace(/\/$/, '')}/`
  return target.startsWith(prefix) ? target.slice(prefix.length) : target
}

/** Where a marketplace keeps its manifest, below its folder. */
const MARKETPLACE_FILE = '/.claude-plugin/marketplace.json'

/**
 * The marketplace file `cwd` would have if it were a marketplace, then that of every folder above
 * it, nearest first, down to its root: `/`, a drive (`C:/`) or a UNC share (`//server/share`).
 * A relative `cwd` names no folder to walk, so it has none.
 */
export function marketplaceCandidatesOf(cwd: string): string[] {
  return foldersUpFrom(cwd).map(folder => (folder.endsWith('/') ? folder + MARKETPLACE_FILE.slice(1) : folder + MARKETPLACE_FILE))
}

/** `path` and every folder above it, nearest first, down to its root; none for a relative path. */
export function foldersUpFrom(path: string): string[] {
  const normal = normalizePath(path)
  const root = rootOf(normal)
  if (!root) return []
  const parts = normal.slice(root.length).split('/').filter(Boolean)
  // A UNC path's server and share are its root folder; nothing sits above them.
  const top = root === '//' ? Math.min(UNC_ROOT_PARTS, parts.length) : 0
  const folders: string[] = []
  for (let depth = parts.length; depth >= top; depth--) folders.push(root + parts.slice(0, depth).join('/'))
  return folders
}

/**
 * The mods folder: a set `modsDir` always wins. Otherwise the `mods/` of the nearest folder at or
 * above `cwd` whose marketplace file is among `existing`, the way /mod-builder:build finds it, and
 * `fallback` (the plugin's own) when `cwd` is unknown or no marketplace is above it.
 */
export function modsDirFor(configured: string, cwd: string | null, existing: readonly string[], fallback: string): string {
  if (configured) return normalizePath(configured)
  const found = cwd === null ? undefined : marketplaceCandidatesOf(cwd).find(candidate => existing.includes(candidate))
  return found === undefined ? normalizePath(fallback) : `${found.slice(0, -MARKETPLACE_FILE.length)}/mods`
}

/** Where the marketplace walk starts (#92): the session's project root when known, which a Bash `cd` doesn't move, else `cwd`. */
export function walkStartOf(root: string | null, cwd: string | null): string | null {
  return root ?? cwd
}

/** A path to compare by: normalized, and lower-cased on a drive or UNC share, which Windows reads without case (PR #95 review). */
function pathKey(path: string): string {
  const normal = normalizePath(path)
  const root = rootOf(normal)
  return root === '/' || root === '' ? normal : normal.toLowerCase()
}

/** A build's pinned folder, while the project root is the one it was pinned under or can't be read now; else null (#92). */
export function keptPinOf(pin: Pin | null, root: string | null): Pin | null {
  if (!pin) return null
  return root === null || pathKey(pin.root) === pathKey(root) ? pin : null
}

/**
 * The report a row in `dir` shows: one made in that folder, or one with no folder (stored before 0.2.16).
 * `reported` keeps one report per mod name, so a same-named mod in another folder must not light this row (PR #95 review).
 */
export function reportIn(report: Reported | undefined, dir: string): Reported | null {
  if (!report) return null
  return report.dir === undefined || report.dir === dir ? report : null
}

/** The marketplace file a mods folder belongs to: `<marketplace>/mods` → `<marketplace>/.claude-plugin/marketplace.json`. */
export function marketplaceFileOf(modsDir: string): string {
  const parent = parentOf(modsDir)
  return parent.endsWith('/') ? parent + MARKETPLACE_FILE.slice(1) : parent + MARKETPLACE_FILE
}

/** The folder above `path`, normalized; a root is its own parent. */
export function parentOf(path: string): string {
  const dir = normalizePath(path)
  const cut = dir.lastIndexOf('/')
  return cut < rootOf(dir).length ? rootOf(dir) : dir.slice(0, cut)
}

/** A folder's `.git` as the disk has it: a directory (a repository's top), a file (a worktree's or submodule's pointer), or none. */
export type DotGit = { kind: 'dir' } | { kind: 'file'; text: string } | null

/**
 * The common git folder of the repository `folder` is the top of (PR #95 review follow-up): `<folder>/.git`
 * for a repository top; for a `.git` file, its `gitdir:` (resolved against `folder`) without a trailing
 * `/worktrees/<name>`. A submodule's `gitdir` names its own repository's folder. Null with no `.git`.
 */
export function gitCommonDirOf(folder: string, dotGit: DotGit): string | null {
  if (!dotGit) return null
  const top = normalizePath(folder).replace(/\/$/, '')
  if (dotGit.kind === 'dir') return `${top}/.git`
  const line = /^gitdir:[ \t]*(.+?)[ \t]*$/m.exec(dotGit.text.replace(/\r/g, ''))
  if (!line) return null
  const named = line[1]!.replace(/\\/g, '/')
  const gitDir = normalizePath(rootOf(named) ? named : `${top}/${named}`)
  return /^(.*)\/worktrees\/[^/]+$/.exec(gitDir)?.[1] ?? gitDir
}

/** Whether two common git folders are one repository's (Windows roots without case); an unknown one never is. */
export function isSameRepo(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && pathKey(a) === pathKey(b)
}

/**
 * Whether a reported folder may be pinned, as far as its name and the root tell (PR #95 review): a
 * readable root, and a folder named `mods`. The caller checks that its marketplace file exists and that
 * the folder above it is the project's own repository or one of its worktrees (`isSameRepo`), since
 * Validate and Test then run there. Gives the marketplace file and the normalized root, or why not.
 */
export function pinCheckOf(dir: string, root: string | null): { marketplace: string; root: string } | { reason: string } {
  if (root === null) return { reason: "the project root can't be read" }
  const folder = normalizePath(dir)
  if (folder.slice(folder.lastIndexOf('/') + 1) !== 'mods') return { reason: `${folder} isn't a marketplace's mods folder` }
  return { marketplace: marketplaceFileOf(folder), root: normalizePath(root) }
}

/** A pin as state kept it, or null when it isn't one (no root, or not a pin at all). */
export function pinOf(value: unknown): Pin | null {
  const held = value as { modsDir?: unknown; root?: unknown } | null
  return held && typeof held.modsDir === 'string' && typeof held.root === 'string' ? { modsDir: held.modsDir, root: held.root } : null
}

/**
 * The folder Mod Lab watches (#92): a set `modsDir`, else the pin `keptPinOf` keeps, else `modsDirFor`
 * walking from the root, or from `cwd` when no marketplace in `existing` is above the root (PR #95 review).
 * `pin` is the pin to keep: null when there was none or a changed root dropped it.
 */
export function watchedDirOf(
  pin: Pin | null,
  root: string | null,
  configured: string,
  cwd: string | null,
  existing: readonly string[],
  fallback: string,
): { dir: string; pin: Pin | null } {
  const kept = keptPinOf(pin, root)
  if (configured) return { dir: normalizePath(configured), pin: kept }
  if (kept) return { dir: kept.modsDir, pin: kept }
  const hasMarketplace = (start: string | null): boolean => start !== null && marketplaceCandidatesOf(start).some(path => existing.includes(path))
  const start = [root, cwd].find(hasMarketplace) ?? walkStartOf(root, cwd)
  return { dir: modsDirFor('', start, existing, fallback), pin: null }
}

/**
 * "Ready to share" marks as `<modsDir>/<name>`. Before 0.2.9 a mark was the bare name, of a mod
 * in the one folder Mod Lab watched (`legacyDir`), so a bare one is read as that folder's.
 */
export function freshIdsOf(stored: readonly string[], legacyDir: string): string[] {
  return stored.map(id => (id.includes('/') ? id : `${legacyDir}/${id}`))
}

/** The last two segments of a path, for the summary line: `…/ClaudeMod/mods`. */
export function shortPath(path: string): string {
  const parts = normalizePath(path).split('/').filter(Boolean)
  return parts.length <= 2 ? normalizePath(path) : `…/${parts.slice(-2).join('/')}`
}

/** Everything read from one mod folder, before it is judged. */
export type FolderRead = {
  name: string
  top: readonly Entry[]
  manifestDir: readonly Entry[]
  hooks: readonly Entry[]
  tests: readonly Entry[]
  types: readonly Entry[]
  /** Top-level listings of agents/, commands/ and skills/, which validate reads. Optional: absent reads as empty. */
  agents?: readonly Entry[]
  commands?: readonly Entry[]
  skills?: readonly Entry[]
  /** Files in subfolders of hooks/, tests/, types/, agents/, commands/ and skills/, named by their path from the mod folder (`hooks/lib/parser.ts`). */
  nested?: readonly Entry[]
  spec: string | null
  readme: string | null
  /** plugin.json's text, when present. */
  manifest: string | null
  marketplace: string
}

/** `version` and `description` from a plugin.json's text. */
export function manifestOf(text: string | null): { version: string | null; description: string | null } {
  try {
    const parsed = JSON.parse(text ?? '') as { version?: unknown; description?: unknown }
    return {
      version: typeof parsed.version === 'string' ? parsed.version : null,
      description: typeof parsed.description === 'string' ? parsed.description : null,
    }
  } catch {
    return { version: null, description: null }
  }
}

/** A short, order-independent hash of a list of strings (FNV-1a over the sorted list). */
export function signatureOf(items: readonly string[]): string {
  let h = 0x811c9dc5
  for (const ch of [...items].sort().join('\n')) {
    h ^= ch.codePointAt(0)!
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return `${items.length}:${h.toString(36)}`
}

/** One folder's reads → its facts. A folder with neither manifest nor SPEC is no mod: null. */
export function factsOf(read: FolderRead): FileFacts | null {
  const has = (list: readonly Entry[], name: string): boolean => list.some(entry => entry.name === name)
  const hasManifest = has(read.manifestDir, 'plugin.json')
  const hasSpec = read.spec !== null
  if (!hasManifest && !hasSpec) return null
  const manifest = read.manifestDir.filter(entry => entry.name === 'plugin.json')
  // Named by folder, so a file moved between folders without a new mtime still changes the signature.
  const inFolder = (folder: string, entries: readonly Entry[]): Entry[] =>
    entries.filter(entry => entry.kind === 'file').map(entry => ({ ...entry, name: `${folder}/${entry.name}` }))
  // The one file at the top that validate reads; the SPEC and README are read by neither validate nor test.
  const mcp = read.top.filter(entry => entry.kind === 'file' && entry.name === '.mcp.json')
  const nested = read.nested ?? []
  const code = [
    ...inFolder('.claude-plugin', manifest),
    ...inFolder('hooks', read.hooks),
    ...inFolder('tests', read.tests),
    ...inFolder('types', read.types),
    ...inFolder('agents', read.agents ?? []),
    ...inFolder('commands', read.commands ?? []),
    ...inFolder('skills', read.skills ?? []),
    ...mcp,
    ...nested.filter(entry => entry.kind === 'file'),
  ]
  const all = [...read.top.filter(entry => entry.kind === 'file'), ...code]
  const times = all.map(entry => entry.mtimeMs)
  const slots = read.spec ? slotsOf(read.spec) : {}
  const codeMtimeMs = Math.max(0, ...code.map(entry => entry.mtimeMs))
  const logic = [
    ...read.hooks.filter(entry => isLogicModule(entry.name)),
    ...read.tests.filter(entry => isTestFile(entry.name)),
    ...nested.filter(entry => isNestedLogicOrTest(entry.name)),
  ]
  const codeSig = signatureOf(code.map(entry => `${entry.name}@${entry.mtimeMs}`))
  const readmeEntry = read.top.find(entry => entry.name === 'README.md')
  return {
    ...manifestOf(read.manifest),
    isReadmeStale: read.readme !== null && readmeEntry !== undefined && readmeEntry.mtimeMs < codeMtimeMs,
    name: read.name,
    hasSpec,
    specHasPlaceholder: read.spec !== null && hasPlaceholder(read.spec),
    hasManifest,
    hasHooksJson: has(read.hooks, 'hooks.json'),
    hasLogic: read.hooks.some(entry => entry.kind === 'file' && isLogicModule(entry.name)),
    hasTests: read.tests.some(entry => entry.kind === 'file' && isTestFile(entry.name)),
    hasRegister: read.hooks.some(entry => /^register\.(m|c)?(t|j)sx?$/.test(entry.name)),
    hasReadme: read.readme !== null,
    readmeHasReaches: read.readme !== null && isReadmeDone(read.readme),
    isListed: isListedIn(read.marketplace, read.name),
    listedVersion: listedVersionOf(read.marketplace, read.name),
    specMtimeMs: read.top.find(entry => entry.name === 'SPEC.md')?.mtimeMs ?? 0,
    readmeMtimeMs: readmeEntry?.mtimeMs ?? 0,
    logicMtimeMs: Math.max(0, ...logic.map(entry => entry.mtimeMs)),
    codeMtimeMs,
    codeSig,
    firstMtimeMs: times.length ? Math.min(...times) : 0,
    lastMtimeMs: times.length ? Math.max(...times) : 0,
    archetype: slots.archetype ?? null,
    builtOn: slots.built?.replace(/^Claude Code\s+/i, '') ?? null,
  }
}

/**
 * The facts of a mod whose folder is not written yet (#19): nothing found, nothing read. Its row
 * exists only because a build reported it; the next scan that finds the folder replaces it.
 */
export function placeholderFacts(name: string): FileFacts {
  return {
    name,
    hasSpec: false,
    specHasPlaceholder: false,
    hasManifest: false,
    hasHooksJson: false,
    hasLogic: false,
    hasTests: false,
    hasRegister: false,
    hasReadme: false,
    readmeHasReaches: false,
    isListed: false,
    codeMtimeMs: 0,
    codeSig: signatureOf([]),
    firstMtimeMs: 0,
    lastMtimeMs: 0,
    archetype: null,
    builtOn: null,
    version: null,
    description: null,
    isReadmeStale: false,
    specMtimeMs: 0,
    logicMtimeMs: 0,
    readmeMtimeMs: 0,
    listedVersion: null,
  }
}

/**
 * The mods that get a placeholder row (#19): reported as running and found in no folder. `reports`
 * are the live ones (see `liveReports`), so a running report the skill abandoned has expired, and a
 * passed or failed one for a missing folder (a typo) never gets a row. Given `dir`, only reports made
 * in that mods folder count, so a /cd doesn't carry a placeholder into another folder.
 */
export function placeholderNames(reports: Readonly<Record<string, Reported>>, factsNames: readonly string[], dir?: string): string[] {
  return Object.entries(reports)
    .filter(([name, report]) => report.status === 'running' && !factsNames.includes(name) && (dir === undefined || report.dir === dir))
    .map(([name]) => name)
}

/**
 * The builds still running, per mods folder and mod name (#19): `reported` keeps one report per name,
 * so same-named new mods in two folders need a record of their own. A running report sets its entry,
 * a finished one removes it, and expired entries (and folders left empty) are dropped.
 */
export function withBuilding(
  all: Readonly<Record<string, Readonly<Record<string, Reported>>>>,
  dir: string,
  mod: string,
  report: Reported,
  now: number,
): Record<string, Record<string, Reported>> {
  const next: Record<string, Record<string, Reported>> = {}
  for (const [folder, reports] of Object.entries(all)) {
    const live = liveReports(reports, now)
    if (folder === dir) delete live[mod]
    if (Object.keys(live).length) next[folder] = live
  }
  if (report.status === 'running') next[dir] = { ...next[dir], [mod]: report }
  return next
}

// ── Runs ──────────────────────────────────────────────────────────────────

/** The command line for a run. */
export function argvOf(kind: RunKind, dir: string): string[] {
  if (kind === 'Validate') return ['claude', 'plugin', 'validate', '--json', dir]
  if (kind === 'Test') return ['claude', 'plugin', 'test', dir]
  return ['npx', '-y', '-p', 'typescript@5.6', 'tsc', '-p', dir]
}

/** A finished process → the stored result. */
export function resultOf(kind: RunKind, exitCode: number, output: string, stampMs: number, durationMs = 0, atMs?: number): RunResult {
  const at = atMs === undefined ? {} : { atMs }
  if (kind === 'Validate') {
    const validate = parseValidate(output, exitCode)
    return {
      kind,
      ok: validate.ok,
      stampMs,
      durationMs,
      ...at,
      summary: summaryOfRun(kind, validate.ok, { validate }),
      errors: validate.errors.slice(0, 6),
      validate,
    }
  }
  if (kind === 'Test') {
    const test = parseTest(output, exitCode)
    return {
      kind,
      ok: test.ok,
      stampMs,
      durationMs,
      ...at,
      summary: summaryOfRun(kind, test.ok, { test }),
      errors: test.failures,
      tests: { passed: test.passed, failed: test.failed },
    }
  }
  const tscErrors = parseTsc(output)
  const ok = exitCode === 0 && tscErrors.length === 0
  const errors = tscErrors.length || ok ? tscErrors.slice(0, 6) : output.trim().split('\n').slice(-3)
  return { kind, ok, stampMs, durationMs, ...at, summary: summaryOfRun(kind, ok, { tscErrors }), errors }
}

/** The toast for a finished run: `✓ agent-dock: 12 tests passed in 3.4s`. */
export function toastOfRun(mod: string, result: RunResult): string {
  return result.ok ? `✓ ${mod}: ${result.summary}` : `✕ ${mod}: ${result.summary}. Press F in Mod Lab to fix`
}

/** The toast of a run that threw before its result was stored (a scan or the store write failed). */
export function toastOfRunError(mod: string, kind: RunKind, error: unknown): string {
  return `✕ ${mod}: ${kind === 'Typecheck' ? 'Type-check' : kind} stopped before its result was saved (${cut(errorText(error), 120)})`
}

/** Whether `entry`'s own row (same mod, kind and start) is still in runs: a newer run replaces an orphan's row. */
export function hasRun(all: readonly Run[], entry: Run): boolean {
  return all.some(one => one.mod === entry.mod && one.kind === entry.kind && one.startedAt === entry.startedAt)
}

/** The runs once streamed `counts` land on `entry`'s own row: same mod, kind and start. */
export function withProgress(all: readonly Run[], entry: Run, counts: { passed: number; failed: number }): Run[] {
  return all.map(one => (one.mod === entry.mod && one.kind === entry.kind && one.startedAt === entry.startedAt ? { ...one, ...counts } : one))
}

/** Test lines streamed so far → the counts: bun prints one `(pass)` or `(fail)` line per test. */
export function countStreamed(text: string): { passed: number; failed: number } {
  const { passed, failed } = streamPiece(EMPTY_STREAM, `${text}\n`)
  return { passed, failed }
}

/** The longest line a streamed test run keeps; the rest of a longer line is dropped. */
const STREAM_LINE_MAX = 2000
/** The last lines a streamed test run keeps: the summary, and the error lines of a run that didn't start. */
const STREAM_TAIL_LINES = 50
/** The `(fail)` lines a streamed test run keeps from the start, each with the 2 after it: parseTest shows 6 entries. */
const STREAM_FAILS_KEPT = 6

/** A line number and its text. */
type NumberedLine = readonly [number, string]

/** Which summary line of bun's `parseTest` reads this is (`N pass`, `N fail`, `Ran …`), or ''. */
function summaryKindOf(line: string): string {
  const count = line.match(/^\s*\d+ (pass|fail)\s*$/)
  if (count) return count[1]!
  return /^Ran \d+ tests? across .*\[\d+(?:\.\d+)?m?s\]\s*$/.test(line) ? 'ran' : ''
}

/**
 * A streamed `claude plugin test` run so far: its counts and only the lines
 * parseTest and the log read, so a test that prints without end costs
 * bounded memory, and each piece costs its own length (#9, Codex P2 on PR #65).
 * Pieces come per stream, as they came, not lines (claude-code.d.ts); the results
 * are on stdout and a test's console.log on stderr, whose backlog can arrive after
 * the summary. So each stream has its own unfinished line, and the first summary
 * line of each kind is kept wherever it lands.
 */
export type TestStream = {
  passed: number
  failed: number
  /** Lines finished so far. */
  lines: number
  /** Each stream's line still being printed, cut at STREAM_LINE_MAX. */
  partials: Readonly<Record<string, string>>
  /** The first STREAM_FAILS_KEPT `(fail)` lines and the 2 after each. */
  heads: readonly NumberedLine[]
  failsKept: number
  /** Lines still to keep after the last kept `(fail)` line. */
  after: number
  /** The summary kinds already kept. */
  summaries: readonly string[]
  /** The last STREAM_TAIL_LINES lines. */
  tail: readonly NumberedLine[]
}
export const EMPTY_STREAM: TestStream = { passed: 0, failed: 0, lines: 0, partials: {}, heads: [], failsKept: 0, after: 0, summaries: [], tail: [] }

/** The stream once one more piece of `stream` arrived: only the lines it finishes are counted and kept. */
export function streamPiece(s: TestStream, text: string, stream = 'stdout'): TestStream {
  const parts = ((s.partials[stream] ?? '') + text).split('\n')
  const partial = parts.pop()!.slice(0, STREAM_LINE_MAX)   // split always returns one part
  let { passed, failed, lines, failsKept, after } = s
  const heads = [...s.heads]
  const summaries = [...s.summaries]
  const tail = [...s.tail]
  for (const whole of parts) {
    const line = whole.slice(0, STREAM_LINE_MAX)
    const isFail = line.startsWith('(fail) ')
    if (isFail) failed += 1
    else if (line.startsWith('(pass) ')) passed += 1
    const isKeptFail = isFail && failsKept < STREAM_FAILS_KEPT
    if (isKeptFail || after > 0) heads.push([lines, line])
    if (isKeptFail) {
      failsKept += 1
      after = 2
    } else if (after > 0) after -= 1
    const summary = summaryKindOf(line)
    if (summary && !summaries.includes(summary)) {
      summaries.push(summary)
      heads.push([lines, line])
    }
    tail.push([lines, line])
    lines += 1
  }
  return { passed, failed, lines, partials: { ...s.partials, [stream]: partial }, heads, failsKept, after, summaries, tail: tail.slice(-STREAM_TAIL_LINES) }
}

/** The output a finished stream is judged and logged from: its kept lines in order, then the unfinished ones. */
export function streamOutput(s: TestStream): string {
  const kept = new Map<number, string>([...s.heads, ...s.tail])
  const ordered = [...kept.entries()].sort((a, b) => a[0] - b[0]).map(([, line]) => line)
  return [...ordered, ...Object.values(s.partials)].join('\n')
}

// ── lab_report ────────────────────────────────────────────────────────────

/** The model tool's input schema, as `$.tool.register` takes it. */
export const REPORT_SCHEMA = {
  type: 'object',
  properties: {
    mod: { type: 'string', description: 'The mod folder name under the mods folder, e.g. "git-branch".' },
    stage: { type: 'string', enum: [...STAGES] },
    status: { type: 'string', enum: ['running', 'passed', 'failed'] },
    note: { type: 'string', description: 'A few words on what is happening, e.g. "writing tests".' },
    path: {
      type: 'string',
      description: 'The absolute path of the mod folder, e.g. "/home/me/repo/mods/git-branch". Pass it on every report, so Mod Lab watches the folder you are working in.',
    },
  },
  required: ['mod', 'stage', 'status'],
  additionalProperties: false,
} as const

/**
 * A `lab_report` call's arguments → a checked report, with the mods folder its `path` names (#92), or
 * the reason it was refused. A malformed `path` keeps the report and says why it was ignored (PR #95 review).
 */
export function reportOf(
  input: Record<string, unknown>,
  now: number,
): { mod: string; report: Reported; dir?: string; pathIgnored?: string } | { error: string } {
  const mod = typeof input.mod === 'string' ? input.mod.trim() : ''
  const stage = STAGES.find(one => one === input.stage)
  const status = (['running', 'passed', 'failed'] as const).find(one => one === input.status)
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(mod)) return { error: 'mod must be the mod folder name, kebab-case.' }
  if (!stage) return { error: `stage must be one of ${STAGES.join(', ')}.` }
  if (!status) return { error: 'status must be running, passed or failed.' }
  const note = typeof input.note === 'string' && input.note.trim() ? input.note.trim().slice(0, 60) : undefined
  const report: Reported = note ? { stage, status, note, since: now } : { stage, status, since: now }
  if (input.path === undefined) return { mod, report }
  const path = typeof input.path === 'string' ? normalizePath(input.path.trim()) : ''
  const root = rootOf(path)
  if (!root) return { mod, report, pathIgnored: "path must be the absolute path of the mod's folder" }
  const cut = path.lastIndexOf('/')
  if (path.slice(cut + 1) !== mod) return { mod, report, pathIgnored: `path must end with the mod's folder name, ${mod}` }
  return { mod, report, dir: cut < root.length ? root : path.slice(0, cut) }
}

// ── Band ──────────────────────────────────────────────────────────────────

/** One mod in the band: its bar line, and the detail line beneath when there is room. */
export type BandEntry = {
  name: string
  stage: string
  since: number
  /** 0..1 of real progress: tests run of the last total, else stages passed of 8. */
  fraction: number
  detail: string
}

/**
 * What the band shows: runs first, then reported stages, then the demo; at
 * most three. The bar fills on real progress only, never on the clock.
 */
export function bandEntriesOf(
  runs: readonly Run[],
  reported: Readonly<Record<string, Reported>>,
  demo: { view: ModView; since: number } | null,
  views: readonly ModView[] = [],
): BandEntry[] {
  const stagesDone = (name: string): number =>
    (views.find(view => view.name === name)?.lights.filter(light => light === 'passed').length ?? 0) / STAGES.length
  const entries: BandEntry[] = runs.map(run => {
    const done = run.passed + run.failed
    const isTest = run.kind === 'Test'
    return {
      name: run.mod,
      stage: run.kind,
      since: run.startedAt,
      fraction: isTest && run.total ? done / run.total : stagesDone(run.mod),
      detail: isTest
        ? run.total
          ? `${run.passed} of ${run.total} passed${run.failed ? ` · ${run.failed} failed` : ''}`
          : `${run.passed} passed so far`
        : run.kind === 'Validate'
          ? 'claude plugin validate'
          : 'tsc -p',
    }
  })
  for (const [name, report] of Object.entries(reported)) {
    if (report.status === 'running' && !entries.some(entry => entry.name === name)) {
      entries.push({ name, stage: report.stage, since: report.since, fraction: stagesDone(name), detail: report.note ?? 'in progress' })
    }
  }
  if (demo) {
    const at = demo.view.lights.indexOf('running')
    if (at >= 0) {
      const passed = demo.view.lights.filter(light => light === 'passed').length
      entries.push({ name: demo.view.name, stage: STAGES[at]!, since: demo.since, fraction: passed / STAGES.length, detail: `${demo.view.status} · demo` })
    }
  }
  return entries.slice(0, 3)
}

// ── Demo toasts ───────────────────────────────────────────────────────────

/** The toasts the demo raises for beats crossed between two moments. */
export function demoToastsBetween(fromMs: number, toMs: number, beats: readonly Beat[] = demoTimeline()): string[] {
  const toasts: string[] = []
  for (const beat of beats) {
    if (beat.atMs <= fromMs || beat.atMs > toMs) continue
    if (beat.stage === 'Validate' && beat.light === 'passed') toasts.push(`✓ ${DEMO_NAME}: validate clean · 3 hooks`)
    if (beat.stage === 'Test' && beat.light === 'failed') toasts.push(`✕ ${DEMO_NAME}: 1 test failing. Claude is fixing it`)
    if (beat.stage === 'Test' && beat.light === 'passed') toasts.push(`✓ ${DEMO_NAME}: 6 tests passed in 0.4s`)
  }
  return toasts
}

// ── Report expiry ─────────────────────────────────────────────────────────

/** A `running` report older than this no longer counts: the skill stopped without saying so. */
export const REPORT_TTL_MS = 10 * 60 * 1000

/** The reports that still count at `now`; finished ones are kept, stale running ones dropped. */
export function liveReports(
  reports: Readonly<Record<string, Reported>>,
  now: number,
): Record<string, Reported> {
  const live: Record<string, Reported> = {}
  for (const [name, report] of Object.entries(reports)) {
    if (report.status !== 'running' || now - report.since < REPORT_TTL_MS) live[name] = report
  }
  return live
}

/** How long past its time limit a run still counts: one that is ending (its scan, its store write) is not an orphan. */
export const RUN_GRACE_MS = 30_000

/** The runs still in flight at `now`. A row older than the time limit plus the grace lost its run (a reload ended it). */
export function liveRuns(all: readonly Run[], now: number, limitMs: number): Run[] {
  return all.filter(one => now - one.startedAt <= limitMs + RUN_GRACE_MS)
}

/** `testTimeoutMinutes`: its default, and its most (ten minutes is the most `$.process.run` allows). */
export const RUN_MINUTES = 3
export const RUN_MINUTES_MAX = 10
const RUN_MS_MIN = 1000

/** The `testTimeoutMinutes` option as a time limit in whole ms: minutes above 0 (or their text), at most ten, at least a second; anything else is three minutes. */
export function runLimitMsOf(raw: unknown): number {
  const minutes = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : Number.NaN
  if (!Number.isFinite(minutes) || minutes <= 0) return RUN_MINUTES * 60_000
  return Math.max(RUN_MS_MIN, Math.round(Math.min(minutes, RUN_MINUTES_MAX) * 60_000))
}

/** Whether a check that ran `elapsedMs` used its whole time limit. */
export function isOverLimit(elapsedMs: number, limitMs: number): boolean {
  return elapsedMs >= limitMs
}

/** A time limit in minutes, to two places, as it is shown. */
export function limitMinutesOf(limitMs: number): number {
  return Math.round(limitMs / 600) / 100
}

/** The summary of a check stopped at its time limit: "timed out after 3 minutes". */
export function timeoutText(limitMs: number): string {
  return `timed out after ${plural(limitMinutesOf(limitMs), 'minute')}`
}

// ── Logging ───────────────────────────────────────────────────────────────

export const LOG_LEVELS = ['off', 'normal', 'verbose', 'debug'] as const
export type LogLevel = (typeof LOG_LEVELS)[number]
/** The level a line is written at: never `off`. */
export type LineLevel = Exclude<LogLevel, 'off'>
/** Lines a session keeps; older ones are dropped with a marker. */
export const LOG_CAP = 2000
/** Characters of a line's context kept. */
export const LOG_CONTEXT_MAX = 2000
/** Lines below `normal` are written this long after the last one. */
export const LOG_FLUSH_MS = 2000

/** The `logging` option as a level; anything else is `normal`, the default. */
export function logLevelOf(raw: unknown): LogLevel {
  const word = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  return (LOG_LEVELS as readonly string[]).includes(word) ? (word as LogLevel) : 'normal'
}

/** Whether a line at `level` is written when the option is `configured`. */
export function shouldLog(configured: LogLevel, level: LineLevel): boolean {
  return LOG_LEVELS.indexOf(configured) >= LOG_LEVELS.indexOf(level)
}

const oneLine = (text: string): string => text.replace(/\r?\n/g, ' ⏎ ')
const cut = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

/** JSON of a log line's context; a value JSON can't hold (a cycle) falls back to its text. */
function contextText(context: unknown): string {
  try {
    return JSON.stringify(context) ?? String(context)
  } catch {
    return String(context)
  }
}

/** A caught error as one short line: its name and message. */
export function errorText(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  return cut(oneLine(text), 500)
}

/** One log line: time, level, site, message, and the context as JSON, cut to LOG_CONTEXT_MAX. */
export function logLineOf(atMs: number, level: LineLevel, site: string, message: string, context?: unknown): string {
  const time = new Date(atMs).toISOString()
  const tail = context === undefined ? '' : `  ${cut(oneLine(contextText(context)), LOG_CONTEXT_MAX)}`
  return `${time} ${level.toUpperCase().padEnd(7)} ${site}  ${oneLine(message)}${tail}`
}

/**
 * Whether a caught error is worth a line: not when the same site last logged the same message.
 * A render that fails on every frame (about four a second) would otherwise flood the log.
 * Returns the updated record of each site's last message.
 */
export function isNewCaught(last: Readonly<Record<string, string>>, site: string, message: string): { isNew: boolean; last: Record<string, string> } {
  if (last[site] === message) return { isNew: false, last: { ...last } }
  return { isNew: true, last: { ...last, [site]: message } }
}

/** A session's lines so far, and how many older ones the cap dropped. */
export type LogBuffer = { lines: readonly string[]; dropped: number }
export const EMPTY_LOG: LogBuffer = { lines: [], dropped: 0 }

/** The buffer with `line` added, keeping the newest `cap` lines. */
export function pushLine(buffer: LogBuffer, line: string, cap: number = LOG_CAP): LogBuffer {
  const lines = [...buffer.lines, line]
  const over = Math.max(0, lines.length - cap)
  return { lines: lines.slice(over), dropped: buffer.dropped + over }
}

/** The log file's whole text: a marker for dropped lines, then the lines. */
export function logText(buffer: LogBuffer): string {
  const marker = buffer.dropped ? [`… ${buffer.dropped} earlier line${buffer.dropped === 1 ? '' : 's'} dropped`] : []
  return `${[...marker, ...buffer.lines].join('\n')}\n`
}

/**
 * The session's log file as written before (by this module before a reload),
 * with `buffer` after it: earlier lines first, the marker's count carried over,
 * the newest `cap` kept. Lets a reloaded module continue the file, not replace it.
 */
export function continueLog(earlier: string, buffer: LogBuffer, cap: number = LOG_CAP): LogBuffer {
  const lines = earlier.split('\n').filter(line => line !== '')
  const marker = lines[0]?.match(/^… (\d+) earlier lines? dropped$/)
  const kept = marker ? lines.slice(1) : lines
  const all = [...kept, ...buffer.lines]
  const over = Math.max(0, all.length - cap)
  return { lines: all.slice(over), dropped: (marker ? Number(marker[1]) : 0) + buffer.dropped + over }
}

/** `<home>/.claude/mod-builder-data/logs/<YYYY-MM-DD>-<first 8 of the session id>.log`. */
export function logFileOf(home: string, atMs: number, sessionId: string): string {
  const day = new Date(atMs).toISOString().slice(0, 10)
  const id = (sessionId.replace(/[^\w-]/g, '') || 'unknown').slice(0, 8)
  return `${normalizePath(home)}/.claude/mod-builder-data/logs/${day}-${id}.log`
}

/** The last `count` non-blank lines of a process's output, for debug lines. */
export function outputTail(output: string, count = 20): string[] {
  return output.split(/\r?\n/).filter(line => line.trim()).slice(-count)
}

// ── /mod-builder config ───────────────────────────────────────────────────

export type OptionName = 'logging' | 'autoRerun' | 'autoOpen' | 'modsDir' | 'testTimeoutMinutes'
type OptionField = { name: OptionName; kind: 'choice' | 'boolean' | 'folder' | 'minutes'; choices?: readonly string[]; values: string }
export const OPTION_FIELDS: readonly OptionField[] = [
  { name: 'logging', kind: 'choice', choices: LOG_LEVELS, values: 'off · normal · verbose · debug' },
  { name: 'autoRerun', kind: 'boolean', values: 'on · off' },
  { name: 'autoOpen', kind: 'boolean', values: 'on · off' },
  { name: 'modsDir', kind: 'folder', values: 'a folder path, or default' },
  { name: 'testTimeoutMinutes', kind: 'minutes', values: `minutes, at most ${RUN_MINUTES_MAX}, or default` },
]
/** The listing's name column: as wide as the longest name. */
const OPTION_COLUMN = Math.max(...OPTION_FIELDS.map(f => f.name.length))
export const CONFIG_USAGE = 'Usage: /mod-builder config [list] · /mod-builder config <option> <value>'

export type ConfigCommand =
  | { kind: 'list' }
  | { kind: 'set'; name: OptionName; value: string | boolean | number }
  | { kind: 'error'; text: string }

/** `/mod-builder config …` words → what to do. */
export function parseConfigCommand(words: readonly string[]): ConfigCommand {
  const [first, ...rest] = words.filter(Boolean)
  if (first === undefined || first.toLowerCase() === 'list') return { kind: 'list' }
  const field = OPTION_FIELDS.find(f => f.name.toLowerCase() === first.toLowerCase())
  if (!field) return { kind: 'error', text: `No option "${first}". Options: ${OPTION_FIELDS.map(f => f.name).join(', ')}. ${CONFIG_USAGE}` }
  const raw = rest.join(' ').trim()
  if (!raw) return { kind: 'error', text: `${field.name} needs a value: ${field.values}.` }
  if (field.kind === 'choice') {
    const word = raw.toLowerCase()
    return field.choices?.includes(word)
      ? { kind: 'set', name: field.name, value: word }
      : { kind: 'error', text: `${field.name} must be one of ${field.values}.` }
  }
  if (field.kind === 'boolean') {
    const word = raw.toLowerCase()
    if (['on', 'true', 'yes'].includes(word)) return { kind: 'set', name: field.name, value: true }
    if (['off', 'false', 'no'].includes(word)) return { kind: 'set', name: field.name, value: false }
    return { kind: 'error', text: `${field.name} must be on or off.` }
  }
  if (field.kind === 'minutes') {
    if (raw.toLowerCase() === 'default') return { kind: 'set', name: field.name, value: '' }
    const minutes = Number(raw)
    return Number.isFinite(minutes) && minutes > 0 && minutes <= RUN_MINUTES_MAX
      ? { kind: 'set', name: field.name, value: minutes }
      : { kind: 'error', text: `${field.name} must be a number of minutes above 0, at most ${RUN_MINUTES_MAX}.` }
  }
  return { kind: 'set', name: field.name, value: raw.toLowerCase() === 'default' ? '' : raw }
}

/** Whether a `/config` row's owner is this plugin: `mod-builder`, or `mod-builder@<source>`. */
export function isOwnRow(owner: string | undefined, plugin: string): boolean {
  return owner === plugin || (owner?.startsWith(`${plugin}@`) ?? false)
}

/** The listing's values once `name` is set to `value`; `defaultDir` is the folder an empty `modsDir` means. */
export function valuesAfterSet(name: OptionName, value: string | boolean | number, defaultDir: string): Partial<OptionValues> {
  if (name === 'logging') return { logging: logLevelOf(value) }
  if (name === 'testTimeoutMinutes') return { testTimeoutMinutes: limitMinutesOf(runLimitMsOf(value)) }
  if (name === 'autoRerun') return { autoRerun: value === true }
  if (name === 'autoOpen') return { autoOpen: value === true }
  const dir = String(value)
  return { modsDir: dir, modsDirShown: shortPath(dir || defaultDir) }
}

/** Current values as `/mod-builder config` lists them. */
export type OptionValues = {
  logging: LogLevel
  autoRerun: boolean
  autoOpen: boolean
  modsDir: string
  modsDirShown: string
  testTimeoutMinutes: number
  /** A build's kept folder (#92), shown in place of the default while `modsDir` is empty. */
  pinnedShown?: string
}

/** The `/mod-builder config` listing: each option, its value and what it takes, then the log file. */
export function configListText(values: OptionValues, logFile: string): string {
  const shown: Record<OptionName, string> = {
    logging: values.logging,
    autoRerun: values.autoRerun ? 'on' : 'off',
    autoOpen: values.autoOpen ? 'on' : 'off',
    modsDir: values.modsDir ? values.modsDirShown : values.pinnedShown ? `a build's folder (${values.pinnedShown})` : `default (${values.modsDirShown})`,
    testTimeoutMinutes: plural(values.testTimeoutMinutes, 'minute'),
  }
  const rows = OPTION_FIELDS.map(f => `  ${f.name.padEnd(OPTION_COLUMN)} ${shown[f.name].padEnd(28)} ${f.values}`)
  const log =
    values.logging === 'off' ? 'Log file: none (logging is off)' : logFile ? `Log file: ${logFile}` : 'Log file: not written yet this session'
  return ['mod-builder options (change one: /mod-builder config <option> <value>)', ...rows, log].join('\n')
}

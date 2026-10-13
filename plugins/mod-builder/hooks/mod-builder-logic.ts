/**
 * Mod Lab's deterministic core: every rule that needs no `$`.
 *
 * register.tsx gathers facts from disk and process exit codes, hands them here,
 * and draws what comes back. Nothing in this file reads the clock, the disk or
 * the engine, so every rule is unit-tested in tests/mod-builder-logic.test.ts.
 */

import type { Gate, Light, ModView, Reach, Reported, Run, RunKind, Stage, Tone } from '../types'

export type { Gate, Light, ModView, Reach, Reported, Run, RunKind, Stage, Tone }

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
  /** Newest mtime of what validate and test read: manifest, hooks/, tests/, types/ and their subfolders. */
  codeMtimeMs: number
  /**
   * A signature of every code file's path and mtime, subfolders up to 3 deep: changes on an
   * edit, an add, a delete, a rename or a move between folders.
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
  /** When SPEC.md, the newest logic or test file, and README.md were last saved (0 when absent). */
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
 * Whether a SPEC still holds a `<placeholder>`: an angle-bracketed phrase
 * outside fenced code, inline code and HTML comments.
 */
export function hasPlaceholder(spec: string): boolean {
  const prose = spec
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`\n]*`/g, '')
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
    const errors = stdout
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .slice(0, 3)
    return { ok: false, hooks: [], calls: [], gates: [], errors, warnings: [] }
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

/** `claude plugin test` output (bun's reporter) and its exit code → a report. */
export function parseTest(stdout: string, exitCode: number): TestReport {
  const count = (word: string): number =>
    Number(stdout.match(new RegExp(`^\\s*(\\d+) ${word}\\s*$`, 'm'))?.[1] ?? 0)
  const time = stdout.match(/^Ran \d+ tests? across .*\[(\d+(?:\.\d+)?)(ms|s)\]\s*$/m)
  const durationMs = time ? Math.round(Number(time[1]) * (time[2] === 's' ? 1000 : 1)) : null
  const lines = stdout.split('\n')
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
    if (!ok) return `${plural(Math.max(1, t.failed), 'test')} failing`
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
 * first failure quoted from the error box.
 */
export function fixPromptOf(name: string, stage: Stage, errors: readonly string[], failedCount = 1): string {
  const what =
    stage === 'Test'
      ? `the ${failedCount === 1 ? 'failing test' : `${failedCount} failing tests`}`
      : `the ${stage} problem${failedCount === 1 ? '' : 's'}`
  const [first, ...rest] = errors
  const quoted = [`    ✕ ${(first ?? '').trim()}`, ...rest.slice(0, 2).map(line => `      ${line.trim()}`)].join('\n')
  return `Fix ${what} in mods/${name}. First failure, from Mod Lab:\n${quoted}\nThen re-run ${stage}.`
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

/** The view of one mod, from everything gathered. */
export function viewOf(
  facts: FileFacts,
  results: Results,
  runs: readonly Run[],
  reported: Reported | null,
  isFresh: boolean,
  sinceMs: number | null = null,
  fromVersion: string | null = null,
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
    path: `mods/${facts.name}/`,
    isReadmeStale: facts.isReadmeStale,
    doneLine: fresh ? doneLineOf(results) : null,
    archetype: facts.archetype,
    builtOn: facts.builtOn,
    hooks: validate?.hooks ?? [],
    reaches: validate ? reachesOf(validate.calls) : [],
    gates: validate?.gates ?? [],
    errors: failedRun?.errors ?? [],
    failedStage,
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
  }
}

// ── Gathering ─────────────────────────────────────────────────────────────

/** A directory entry as `$.fs.list` gives it, cut to what Mod Lab reads. */
export type Entry = { name: string; kind: 'file' | 'dir' | 'other'; mtimeMs: number }

/** Resolves `.` and `..` segments in a `/`-separated path. */
export function normalizePath(path: string): string {
  const isAbsolute = path.startsWith('/')
  const parts: string[] = []
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (parts.length && parts[parts.length - 1] !== '..') parts.pop()
      else if (!isAbsolute) parts.push('..')
    } else {
      parts.push(part)
    }
  }
  return (isAbsolute ? '/' : '') + parts.join('/')
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
  /** Files in subfolders of hooks/, tests/ and types/, named by their path from the mod folder (`hooks/lib/parser.ts`). */
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
  const code = [
    ...inFolder('.claude-plugin', manifest),
    ...inFolder('hooks', read.hooks),
    ...inFolder('tests', read.tests),
    ...inFolder('types', read.types),
    ...(read.nested ?? []).filter(entry => entry.kind === 'file'),
  ]
  const all = [...read.top.filter(entry => entry.kind === 'file'), ...code]
  const times = all.map(entry => entry.mtimeMs)
  const slots = read.spec ? slotsOf(read.spec) : {}
  const codeMtimeMs = Math.max(0, ...code.map(entry => entry.mtimeMs))
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
    logicMtimeMs: Math.max(
      0,
      ...[...read.hooks.filter(entry => isLogicModule(entry.name)), ...read.tests.filter(entry => isTestFile(entry.name))].map(
        entry => entry.mtimeMs,
      ),
    ),
    codeMtimeMs,
    codeSig,
    firstMtimeMs: times.length ? Math.min(...times) : 0,
    lastMtimeMs: times.length ? Math.max(...times) : 0,
    archetype: slots.archetype ?? null,
    builtOn: slots.built?.replace(/^Claude Code\s+/i, '') ?? null,
  }
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

/** Test lines streamed so far → the counts: bun prints one `(pass)` or `(fail)` line per test. */
export function countStreamed(text: string): { passed: number; failed: number } {
  let passed = 0
  let failed = 0
  for (const line of text.split('\n')) {
    if (line.startsWith('(pass) ')) passed += 1
    else if (line.startsWith('(fail) ')) failed += 1
  }
  return { passed, failed }
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
  },
  required: ['mod', 'stage', 'status'],
  additionalProperties: false,
} as const

/** A `lab_report` call's arguments → a checked report, or the reason it was refused. */
export function reportOf(
  input: Record<string, unknown>,
  now: number,
): { mod: string; report: Reported } | { error: string } {
  const mod = typeof input.mod === 'string' ? input.mod.trim() : ''
  const stage = STAGES.find(one => one === input.stage)
  const status = (['running', 'passed', 'failed'] as const).find(one => one === input.status)
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(mod)) return { error: 'mod must be the mod folder name, kebab-case.' }
  if (!stage) return { error: `stage must be one of ${STAGES.join(', ')}.` }
  if (!status) return { error: 'status must be running, passed or failed.' }
  const note = typeof input.note === 'string' && input.note.trim() ? input.note.trim().slice(0, 60) : undefined
  return { mod, report: note ? { stage, status, note, since: now } : { stage, status, since: now } }
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

export type OptionName = 'logging' | 'autoRerun' | 'autoOpen' | 'modsDir'
type OptionField = { name: OptionName; kind: 'choice' | 'boolean' | 'folder'; choices?: readonly string[]; values: string }
export const OPTION_FIELDS: readonly OptionField[] = [
  { name: 'logging', kind: 'choice', choices: LOG_LEVELS, values: 'off · normal · verbose · debug' },
  { name: 'autoRerun', kind: 'boolean', values: 'on · off' },
  { name: 'autoOpen', kind: 'boolean', values: 'on · off' },
  { name: 'modsDir', kind: 'folder', values: 'a folder path, or default' },
]
export const CONFIG_USAGE = 'Usage: /mod-builder config [list] · /mod-builder config <option> <value>'

export type ConfigCommand =
  | { kind: 'list' }
  | { kind: 'set'; name: OptionName; value: string | boolean }
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
  return { kind: 'set', name: field.name, value: raw.toLowerCase() === 'default' ? '' : raw }
}

/** Whether a `/config` row's owner is this plugin: `mod-builder`, or `mod-builder@<source>`. */
export function isOwnRow(owner: string | undefined, plugin: string): boolean {
  return owner === plugin || (owner?.startsWith(`${plugin}@`) ?? false)
}

/** The listing's values once `name` is set to `value`. */
export function valuesAfterSet(name: OptionName, value: string | boolean): Partial<OptionValues> {
  if (name === 'logging') return { logging: logLevelOf(value) }
  if (name === 'autoRerun') return { autoRerun: value === true }
  if (name === 'autoOpen') return { autoOpen: value === true }
  return { modsDir: String(value), ...(value ? { modsDirShown: String(value) } : {}) }
}

/** Current values as `/mod-builder config` lists them. */
export type OptionValues = { logging: LogLevel; autoRerun: boolean; autoOpen: boolean; modsDir: string; modsDirShown: string }

/** The `/mod-builder config` listing: each option, its value and what it takes, then the log file. */
export function configListText(values: OptionValues, logFile: string): string {
  const shown: Record<OptionName, string> = {
    logging: values.logging,
    autoRerun: values.autoRerun ? 'on' : 'off',
    autoOpen: values.autoOpen ? 'on' : 'off',
    modsDir: values.modsDir ? values.modsDirShown : `default (${values.modsDirShown})`,
  }
  const rows = OPTION_FIELDS.map(f => `  ${f.name.padEnd(10)} ${shown[f.name].padEnd(28)} ${f.values}`)
  const log =
    values.logging === 'off' ? 'Log file: none (logging is off)' : logFile ? `Log file: ${logFile}` : 'Log file: not written yet this session'
  return ['mod-builder options (change one: /mod-builder config <option> <value>)', ...rows, log].join('\n')
}

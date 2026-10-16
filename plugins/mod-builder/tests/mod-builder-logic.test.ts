import { describe, expect, test } from 'claude-code/testing'

import {
  argvOf,
  badgeOf,
  bandEntriesOf,
  barOf,
  clockOf,
  countsOf,
  countStreamed,
  EMPTY_STREAM,
  streamOutput,
  streamPiece,
  type TestStream,
  demoClockOf,
  demoLengthMs,
  demoTimeline,
  demoToastsBetween,
  demoViewAt,
  demoWalkMs,
  doneLineOf,
  durationOf,
  factsOf,
  fixPromptOf,
  hasPlaceholder,
  hasReachesHeading,
  isGreen,
  isListedIn,
  isReadmeDone,
  isLogicModule,
  isPulseDim,
  isTestFile,
  layoutOf,
  columnsOf,
  lightMarkOf,
  lightsOf,
  liveReports,
  manifestOf,
  mastheadOf,
  normalizePath,
  parseTest,
  parseTsc,
  parseValidate,
  reachesOf,
  REPORT_SCHEMA,
  REPORT_TTL_MS,
  reportOf,
  signatureOf,
  startsGeneration,
  listedVersionOf,
  rerunPlanOf,
  resultOf,
  runningTextOf,
  shortPath,
  slotsOf,
  splitTop,
  STAGES,
  statusOf,
  summaryOf,
  summaryOfRun,
  summaryPartsOf,
  toastOfRun,
  trackOf,
  viewOf,
  type Entry,
  type FileFacts,
  type ModView,
  type Results,
  type Run,
  configListText,
  continueLog,
  isNewCaught,
  isOwnRow,
  valuesAfterSet,
  EMPTY_LOG,
  errorText,
  LOG_CONTEXT_MAX,
  logFileOf,
  logLevelOf,
  logLineOf,
  logText,
  outputTail,
  parseConfigCommand,
  pushLine,
  shouldLog,
} from '../hooks/mod-builder-logic'
import * as Logic from '../hooks/mod-builder-logic'
import { testFail } from './fixtures/test-fail'
import { testNone } from './fixtures/test-none'
import { testPass } from './fixtures/test-pass'
import { validateClean } from './fixtures/validate-clean'
import { validateMissing } from './fixtures/validate-missing'

/** Read off the namespace, so a rule that is not there yet fails its assertion instead of the import. */
const displayPathOf = (path: string, cwd: string | null): string | undefined =>
  (Logic as unknown as { displayPathOf?: (path: string, cwd: string | null) => string }).displayPathOf?.(path, cwd)

/** The mods folder rules, read the same way: a missing rule fails its assertion, not the import. */
const marketplaceCandidatesOf = (cwd: string): string[] | undefined =>
  (Logic as unknown as { marketplaceCandidatesOf?: (cwd: string) => string[] }).marketplaceCandidatesOf?.(cwd)
const freshIdsOf = (stored: readonly string[], legacyDir: string): string[] | undefined =>
  (Logic as unknown as { freshIdsOf?: (stored: readonly string[], legacyDir: string) => string[] }).freshIdsOf?.(stored, legacyDir)
const modsDirFor = (configured: string, cwd: string | null, existing: readonly string[], fallback: string): string | undefined =>
  (Logic as unknown as { modsDirFor?: (configured: string, cwd: string | null, existing: readonly string[], fallback: string) => string }).modsDirFor?.(
    configured,
    cwd,
    existing,
    fallback,
  )

/** The pinned folder rule (#92), read the same way: a missing rule fails its assertion, not the import. */
type Pin = { modsDir: string; root: string | null }
type Watched = { dir: string; pin: Pin | null }
const watchedDirOf = (pin: Pin | null, root: string | null, configured: string, cwd: string | null, existing: readonly string[], fallback: string): Watched | undefined =>
  (Logic as unknown as { watchedDirOf?: (pin: Pin | null, root: string | null, configured: string, cwd: string | null, existing: readonly string[], fallback: string) => Watched }).watchedDirOf?.(
    pin,
    root,
    configured,
    cwd,
    existing,
    fallback,
  )

/** The pin's confinement (PR #95 review), read the same way. */
type PinCheck = { marketplace: string; root: string } | { reason: string }
const pinCheckOf = (dir: string, root: string | null): PinCheck | undefined =>
  (Logic as unknown as { pinCheckOf?: (dir: string, root: string | null) => PinCheck }).pinCheckOf?.(dir, root)
const pinOf = (value: unknown): Pin | null | undefined => (Logic as unknown as { pinOf?: (value: unknown) => Pin | null }).pinOf?.(value)

/** The repository rule (PR #95 review follow-up), read the same way. */
type DotGit = { kind: 'dir' } | { kind: 'file'; text: string } | null
const gitCommonDirOf = (folder: string, dotGit: DotGit): string | null | undefined =>
  (Logic as unknown as { gitCommonDirOf?: (folder: string, dotGit: DotGit) => string | null }).gitCommonDirOf?.(folder, dotGit)
const isSameRepo = (a: string | null, b: string | null): boolean | undefined =>
  (Logic as unknown as { isSameRepo?: (a: string | null, b: string | null) => boolean }).isSameRepo?.(a, b)

/** Git's own record of a worktree (PR #95 review follow-up), read the same way. */
const worktreeLinkOf = (folder: string, dotGit: DotGit): { record: string } | null | undefined =>
  (Logic as unknown as { worktreeLinkOf?: (folder: string, dotGit: DotGit) => { record: string } | null }).worktreeLinkOf?.(folder, dotGit)
const isBackLinkTo = (folder: string, record: string, text: string): boolean | undefined =>
  (Logic as unknown as { isBackLinkTo?: (folder: string, record: string, text: string) => boolean }).isBackLinkTo?.(folder, record, text)

/** A row's report (PR #95 review), read the same way. */
const reportIn = (report: Parameters<typeof liveReports>[0][string] | undefined, dir: string) =>
  (Logic as unknown as { reportIn?: (report: unknown, dir: string) => unknown }).reportIn?.(report, dir)

/** The placeholder rules (#19), read the same way: a missing rule fails its assertion, not the import. */
type ReportedByMod = Parameters<typeof liveReports>[0]
const placeholderFacts = (name: string): FileFacts | undefined =>
  (Logic as unknown as { placeholderFacts?: (name: string) => FileFacts }).placeholderFacts?.(name)
type BuildingByDir = Record<string, ReportedByMod>
const withBuilding = (all: BuildingByDir, dir: string, mod: string, report: ReportedByMod[string], now: number): BuildingByDir | undefined =>
  (Logic as unknown as { withBuilding?: (all: BuildingByDir, dir: string, mod: string, report: ReportedByMod[string], now: number) => BuildingByDir }).withBuilding?.(all, dir, mod, report, now)
const placeholderNames = (reports: ReportedByMod, factsNames: readonly string[], dir?: string): string[] | undefined =>
  (Logic as unknown as { placeholderNames?: (reports: ReportedByMod, factsNames: readonly string[], dir?: string) => string[] }).placeholderNames?.(reports, factsNames, dir)

const EMPTY: FileFacts = {
  name: 'git-branch',
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
  codeMtimeMs: 1000,
  codeSig: 'sig-a',
  firstMtimeMs: 0,
  lastMtimeMs: 42_000,
  archetype: null,
  builtOn: null,
  version: null,
  description: null,
  isReadmeStale: false,
  specMtimeMs: 0,
  logicMtimeMs: 0,
  logicSig: 'logic-a',
  readmeMtimeMs: 0,
  listedVersion: null,
}

const FULL: FileFacts = {
  ...EMPTY,
  hasSpec: true,
  hasManifest: true,
  hasHooksJson: true,
  hasLogic: true,
  hasTests: true,
  hasRegister: true,
  hasReadme: true,
  readmeHasReaches: true,
  isListed: true,
  version: '0.1.0',
  description: 'Shows the branch.',
}

const ok = (kind: 'Validate' | 'Test', stampMs = 1000): Results => ({
  [kind]: { kind, ok: true, stampMs, summary: 'clean', errors: [], durationMs: 3400, tests: kind === 'Test' ? { passed: 12, failed: 0 } : undefined },
})
const GREEN: Results = { ...ok('Validate'), ...ok('Test') }
const run = (kind: Run['kind'], extra: Partial<Run> = {}): Run => ({ mod: 'git-branch', kind, startedAt: 0, passed: 0, failed: 0, total: null, ...extra })

describe('mod-builder-logic', () => {
  test('stages: an empty folder is all pending; a SPEC with a placeholder is not done', () => {
    expect(lightsOf(EMPTY, {}, [], null)).toEqual(STAGES.map(() => 'pending'))
    expect(lightsOf({ ...EMPTY, hasSpec: true, specHasPlaceholder: true }, {}, [], null)[0]).toBe('pending')
    expect(lightsOf({ ...EMPTY, hasSpec: true }, {}, [], null)[0]).toBe('passed')
  })

  test('stages: files light the file stages; runs need results; stale and green', () => {
    expect(lightsOf(FULL, {}, [], null)).toEqual(['passed', 'passed', 'passed', 'passed', 'pending', 'pending', 'passed', 'passed'])
    const lights = lightsOf({ ...FULL, codeMtimeMs: 2000 }, { ...ok('Validate', 1000), ...ok('Test', 2000) }, [], null)
    expect(lights[4]).toBe('stale')
    expect(lights[5]).toBe('passed')
    expect(isGreen(lightsOf(FULL, GREEN, [], null))).toBe(true)
  })

  test('stages: a running run shows running; a report never passes a stage', () => {
    expect(lightsOf(FULL, {}, ['Test'], null)[5]).toBe('running')
    const failed: Results = { Validate: { kind: 'Validate', ok: false, stampMs: 1000, summary: '1 problem', errors: ['x'] } }
    expect(lightsOf(FULL, failed, [], { stage: 'Validate', status: 'passed', since: 0 })[4]).toBe('failed')
    expect(lightsOf(EMPTY, {}, [], { stage: 'Logic', status: 'running', since: 0 })[2]).toBe('running')
  })

  test('status copy follows the design', () => {
    const green = lightsOf(FULL, GREEN, [], null)
    expect(statusOf(green, GREEN, null, [], false)).toEqual({ text: '12 tests · clean', tone: 'dim' })
    expect(statusOf(green, GREEN, null, [], true)).toEqual({ text: 'ready to share', tone: 'success' })
    expect(statusOf(green, GREEN, null, [run('Test', { passed: 7, total: 12 })], false)).toEqual({ text: 'running tests · 7 of 12', tone: 'text' })
    const failing: Results = { ...ok('Validate'), Test: { kind: 'Test', ok: false, stampMs: 1000, summary: '2 tests failing', errors: [] } }
    expect(statusOf(lightsOf(FULL, failing, [], null), failing, null, [], false)).toEqual({ text: '2 tests failing', tone: 'error' })
    const reported = { stage: 'Logic' as const, status: 'running' as const, note: 'writing tests', since: 0 }
    expect(statusOf(lightsOf(EMPTY, {}, [], reported), {}, reported, [], false).text).toBe('writing tests')
    expect(statusOf(lightsOf(EMPTY, {}, [], null), {}, null, [], false)).toEqual({ text: 'next: Spec', tone: 'dim' })
    expect(runningTextOf(run('Validate'))).toBe('validating')
    expect(runningTextOf(run('Test', { passed: 3 }))).toBe('running tests · 3 so far')
  })

  test('files: placeholders, slots, README heading, marketplace, file kinds, manifest', () => {
    expect(hasPlaceholder('# x\n> <One paragraph>\n')).toBe(true)
    expect(hasPlaceholder('# x\n```\n<Box>\n```\n`<name>` <!-- <hint> -->\nDone.')).toBe(false)
    const spec = '| Slot | Kind | Value | Source |\n| --- | --- | --- | --- |\n| archetype | REQUIRED | pane-command | plan |\n| built on | HOUSE | Claude Code 2.1.296 | x |'
    expect(slotsOf(spec)).toEqual({ archetype: 'pane-command', built: 'Claude Code 2.1.296' })
    expect(hasReachesHeading('# A\n\n## What it reaches\n')).toBe(true)
    expect(hasReachesHeading('# A\nwhat it reaches')).toBe(false)
    expect(isReadmeDone('# A\n\n## What it reaches\n<!-- Fill from validate -->')).toBe(false)
    expect(isReadmeDone('# A\n\n## What it reaches\n| Hooks | x |')).toBe(true)
    const market = JSON.stringify({ plugins: [{ name: 'x', source: './mods/git-branch' }] })
    expect(isListedIn(market, 'git-branch')).toBe(true)
    expect(isListedIn(market, 'other')).toBe(false)
    expect(isListedIn('not json', 'x')).toBe(false)
    expect(isLogicModule('branch-logic.ts')).toBe(true)
    expect(isLogicModule('register.tsx')).toBe(false)
    expect(isTestFile('ui.test.tsx')).toBe(true)
    expect(isTestFile('pure.spec.ts')).toBe(false)
    expect(manifestOf('{"version":"1.2.0","description":"x"}')).toEqual({ version: '1.2.0', description: 'x' })
    expect(manifestOf(null)).toEqual({ version: null, description: null })
  })

  test('hasPlaceholder: a code span may wrap onto the next line, so <word> inside it is not a placeholder (#20)', () => {
    // The span starts on one line and ends on the next; CommonMark allows line endings in a span.
    expect(hasPlaceholder('# x\nSave it with `it is in\nstash "<message>"` to keep the work.\n')).toBe(false)
    // The `<word>` is on the first line of the wrapped span.
    expect(hasPlaceholder('# x\nRun `git stash <message>\nand then pop` here.\n')).toBe(false)
    // A real placeholder outside the span is still found, before or after it.
    expect(hasPlaceholder('# x\nSave it with `it is in\nstash "<message>"` to keep <files>.\n')).toBe(true)
    expect(hasPlaceholder('# x\nStage <files> with `git add\n-A` first.\n')).toBe(true)
    // Unwrapped notation is unchanged: `<files>` in plain prose is a placeholder.
    expect(hasPlaceholder('# x\nStage <files> first.\n')).toBe(true)
    // A span does not cross a paragraph: an unclosed backtick before a blank line leaves the next paragraph's
    // placeholder visible, even when a later backtick pair exists.
    expect(hasPlaceholder('# x\nan unclosed ` tick\n\n<files> are staged.\n')).toBe(true)
    expect(hasPlaceholder('# x\nan unclosed ` tick\n\n<files> are staged with `git add`.\n')).toBe(true)
  })

  test('hasPlaceholder: a code span may hold several line endings, as long as no blank line falls inside it (#20)', () => {
    // Shaped like mods/issue-forge/SPEC.md: a quoted message that wraps twice.
    expect(hasPlaceholder('# x\n- preflight blocks with `lcovPath <path> is shared by every\n  run and #44 is running; make it relative to the repository, as\n  coverage/issue-forge.lcov`.\n')).toBe(false)
    // A placeholder after that span is still found.
    expect(hasPlaceholder('# x\nRun `cat\nlist\n| sort` on <files>.\n')).toBe(true)
  })

  test('hasPlaceholder: a span over two line endings leaves no backtick unpaired for the rest of the paragraph (#20)', () => {
    // If the first span is not removed, its opening backtick pairs with the next one and every later
    // pair in the paragraph shifts, so `<c>` reads as prose.
    expect(hasPlaceholder('# x\nsay `one\ntwo\nthree` and `a`\nthen `b` and `<c>`\n')).toBe(false)
  })

  test('hasPlaceholder: a code span ends at the start of another block, so an unclosed backtick hides nothing there (#20)', () => {
    // A heading or list item starts a new block even without a blank line before it, and CommonMark pairs
    // backticks within one block only.
    expect(hasPlaceholder('# x\nAn unmatched `\n# Fill <files> with `git add`\n')).toBe(true)
    expect(hasPlaceholder('# x\n- an unmatched ` tick\n- stage <files> with `git add`\n')).toBe(true)
  })

  test('hasPlaceholder: an escaped backtick opens no code span (#20)', () => {
    // CommonMark reads \` as a literal backtick, so it can't pair with the opener of `git add`.
    expect(hasPlaceholder('# x\nliteral \\`\n<files> and then `git add`\n')).toBe(true)
    // An escaped backslash leaves the backtick after it free to open a span.
    expect(hasPlaceholder('# x\npath \\\\`cmd\n<arg>` ok\n')).toBe(false)
  })

  test('hasPlaceholder: a heading or quote indented four spaces is paragraph text, so it ends no span (#20)', () => {
    // CommonMark allows at most three spaces before `#` or `>`; the span runs to `end`, and <files> after it is prose.
    expect(hasPlaceholder('# x\nText `cmd\n    # foo\nend` <files>\nthen `x`\n')).toBe(true)
    expect(hasPlaceholder('# x\nText `cmd\n    > foo\nend` <files>\nthen `x`\n')).toBe(true)
    // Three spaces still start a heading; a nested list item ends a span at any indent.
    expect(hasPlaceholder('# x\nAn unmatched `\n   # Fill <files> with `git add`\n')).toBe(true)
    expect(hasPlaceholder('# x\n- a\n  - b\n    - c with ` tick\n    - stage <files> with `git add`\n')).toBe(true)
  })

  test('validate: a clean report from real output', () => {
    const report = parseValidate(validateClean, 0)
    expect(report.ok).toBe(true)
    expect(report.hooks).toEqual([
      'session.start',
      'command.run{command=modlab}',
      'tool.call{tool=mcp__mod-builder__lab_report}',
      'tool.call{tool=Write|Edit}',
      'turn.complete',
      'ui.close',
      'ui.render{component=Pane, requestId=modlab}',
      'ui.render{component=AbovePrompt}',
    ])
    expect(report.calls).toContain('$.process.run')
    expect(report.gates.every(gate => gate.hasCatch)).toBe(true)
    expect(summaryOfRun('Validate', true, { validate: report })).toBe(`clean · 8 hooks · ${report.gates.length} gates`)
  })

  test('validate: a failing report, and output that is not JSON', () => {
    const report = parseValidate(validateMissing, 1)
    expect(report.ok).toBe(false)
    expect(report.errors[0]).toContain('no such file')
    expect(report.warnings).toHaveLength(3)
    expect(summaryOfRun('Validate', false, { validate: report })).toBe('1 problem')
    expect(parseValidate('command not found: claude', 127)).toMatchObject({ ok: false, errors: ['command not found: claude'] })
  })

  test('test: pass and fail from real output, and streamed counts', () => {
    const pass = parseTest(testPass, 0)
    expect(pass).toMatchObject({ ok: true, passed: 4, failed: 0 })
    expect(summaryOfRun('Test', true, { test: pass })).toStartWith('4 tests passed in ')
    const fail = parseTest(testFail, 1)
    expect(fail).toMatchObject({ ok: false, passed: 3, failed: 1 })
    expect(fail.failures[0]).toBe('try-notes-logic > parses the arguments')
    expect(fail.failures[1]).toContain('AssertionError')
    expect(countStreamed(testFail)).toEqual({ passed: 3, failed: 1 })
    expect(countStreamed('(pass) a\n(pa')).toEqual({ passed: 1, failed: 0 })
  })

  test('test: a run that exits before the runner starts keeps the output\'s last non-blank lines as its errors', () => {
    expect(parseTest(testNone, 1)).toMatchObject({ ok: false, passed: 0, failed: 0, failures: ['claude plugin test: no *.test.ts or *.test.tsx under /m/mods/git-branch'] })
    const corrupt = '\nclaude plugin test: Plugin x has a corrupt manifest file at /m/x/.claude-plugin/plugin.json.\nJSON parse error: Unexpected token } in JSON at position 12\n'
    expect(parseTest(corrupt, 1).failures).toEqual(['claude plugin test: Plugin x has a corrupt manifest file at /m/x/.claude-plugin/plugin.json.', 'JSON parse error: Unexpected token } in JSON at position 12'])
    expect(parseTest('one\n\ntwo\nthree\n\nfour\n', 1).failures).toEqual(['two', 'three', 'four'])
  })

  test('test: a run that did not start says so instead of "1 test failing"', () => {
    const none = parseTest(testNone, 1)
    expect(summaryOfRun('Test', false, { test: none })).toBe('tests did not run')
    expect(summaryOfRun('Test', false, { test: parseTest(testFail, 1) })).toBe('1 test failing')
  })

  test('test: the result of a run that did not start has the error lines and the "did not run" toast', () => {
    const none = resultOf('Test', 1, testNone, 7, 100)
    expect(none).toMatchObject({ kind: 'Test', ok: false, summary: 'tests did not run', tests: { passed: 0, failed: 0 } })
    expect(none.errors).toEqual(['claude plugin test: no *.test.ts or *.test.tsx under /m/mods/git-branch'])
    expect(toastOfRun('git-branch', none)).toBe('✕ git-branch: tests did not run. Press F in Mod Lab to fix')
  })

  test('tsc: error lines', () => {
    const out = "/work/x/hooks/register.tsx(12,7): error TS2322: Type 'string' is not assignable to type 'number'.\nFound 1 error."
    expect(parseTsc(out)).toEqual(["register.tsx(12,7): error TS2322: Type 'string' is not assignable to type 'number'."])
    expect(summaryOfRun('Typecheck', false, { tscErrors: parseTsc(out) })).toBe('1 type error')
  })

  test('reaches: grouped by noun; splitting respects braces', () => {
    expect(reachesOf(['$.process.run', '$.fs.read', '$.fs.list', '$.ui.toast'])).toEqual([
      { label: 'processes', value: 'run' },
      { label: 'files', value: 'read, list' },
      { label: 'network', value: 'none' },
      { label: 'model', value: 'none' },
      { label: 'mcp', value: 'none' },
    ])
    expect(splitTop('a, b{x=1, y=2}, c (via d, e)')).toEqual(['a', 'b{x=1, y=2}', 'c (via d, e)'])
  })

  test('summary, masthead, badge', () => {
    const view = (lights: ModView['lights']): ModView => ({ ...viewOf(EMPTY, {}, [], null, false, null, 'mods/git-branch'), lights })
    const green = view(STAGES.map(() => 'passed'))
    const building = view(['passed', 'running', 'pending', 'pending', 'pending', 'pending', 'pending', 'pending'])
    const failing = view(['passed', 'passed', 'failed', 'pending', 'pending', 'pending', 'pending', 'pending'])
    const counts = countsOf([green, green, building])
    expect(summaryPartsOf(counts)).toEqual(['3 mods', '2 green', '1 building'])
    expect(summaryOf(counts)).toBe('3 mods · 2 green · 1 building')
    expect(mastheadOf(counts)).toEqual({ dot: true, word: 'B U I L D I N G', tone: 'success' })
    expect(badgeOf(counts)).toBe('◆ 3 mods · 1 building')
    expect(mastheadOf(countsOf([green, failing])).word).toBe('1   F A I L I N G')
    expect(mastheadOf(countsOf([green])).word).toBe('A L L   G R E E N')
    expect(mastheadOf(countsOf([])).word).toBe('S T A N D I N G   B Y')
    expect(summaryPartsOf(countsOf([]))).toEqual(['0 mods'])
    expect(badgeOf(countsOf([]))).toBeUndefined()
    expect([0, 3, 4, 7, 8].map(isPulseDim)).toEqual([false, false, true, true, false])
  })

  test('breakpoints: full, medium, compact, none', () => {
    expect([80, 60, 59, 40, 39, 34, 33].map(layoutOf)).toEqual(['full', 'full', 'medium', 'medium', 'compact', 'compact', 'none'])
  })

  test('lights animate in three frames; the column header lights the number over the running light', () => {
    expect([0, 1, 2, 3].map(frame => lightMarkOf('running', frame))).toEqual([
      { text: '◐', tone: 'accent', bold: true },
      { text: '◐', tone: 'accent', dim: true },
      { text: '○', tone: 'accent', bold: true },
      { text: '◐', tone: 'accent', bold: true },
    ])
    expect(lightMarkOf('failed')).toEqual({ text: '✕', tone: 'error', bold: true })
    const columns = columnsOf(['passed', 'passed', 'passed', 'passed', 'running', 'pending', 'pending', 'pending'])
    expect(columns.map(m => m.text).join('')).toBe('1 2 3 4 5 6 7 8 ')
    expect(columns[4]).toEqual({ text: '5 ', tone: 'accent', bold: true })
    expect(columns[1]).toEqual({ text: '2 ', tone: 'dim' })
    expect(columnsOf(['passed', 'passed', 'failed'] as never)[2]?.tone).toBe('error')
    expect(columnsOf(['passed', 'passed', 'passed', 'passed', 'stale', 'stale', 'passed', 'passed'])[4]).toEqual({ text: '5 ', tone: 'warn', bold: true })
  })

  test('track connectors: ━ after passed, animated after running, ┄ ahead', () => {
    const track = trackOf(['passed', 'passed', 'passed', 'passed', 'running', 'pending', 'pending', 'pending'], 1)
    expect(track[0]?.num).toEqual({ text: '1 ', tone: 'dim', dim: true })
    expect(track[7]?.num.text).toBe('8 ')
    expect(track[0]?.joint).toEqual({ text: ' ━ ', tone: 'success' })
    expect(track[3]?.joint).toEqual({ text: ' ━ ', tone: 'success' })
    expect(track[4]?.joint).toEqual({ text: ' ━ ', tone: 'accent' })
    expect(track[5]?.joint).toEqual({ text: ' ┄ ', tone: 'dim', dim: true })
    expect(track[7]?.joint).toBeNull()
    expect(trackOf(['passed', 'pending'] as never)[0]?.joint?.text).toBe(' ┄ ')
  })

  test('durations, clocks, bars', () => {
    expect([durationOf(500), durationOf(42_000), durationOf(725_000), durationOf(3 * 3600_000)]).toEqual(['', '0:42', '12:05', '3h'])
    expect(clockOf(0)).toBe('0:00')
    expect(barOf(0)).toEqual({ filled: '', empty: '░'.repeat(15) })
    expect(barOf(7 / 12).filled).toHaveLength(9)
    expect(barOf(2).filled).toHaveLength(15)
  })

  test('fix prompt and done line use the design copy', () => {
    const text = fixPromptOf('inbox-zero', 'Test', ['archives threads older than 30 days', '  expected 3 archived, received 0', '  at test/archive.test.ts:42:7'], 2, 'mods/inbox-zero')
    expect(text).toBe(
      'Fix the 2 failing tests in mods/inbox-zero. First failure, from Mod Lab:\n' +
        '    ✕ archives threads older than 30 days\n' +
        '      expected 3 archived, received 0\n' +
        '      at test/archive.test.ts:42:7\n' +
        'Then re-run Test.',
    )
    expect(fixPromptOf('x', 'Validate', ['oops'], 1, 'mods/x')).toStartWith('Fix the Validate problem in mods/x.')
    const withGates: Results = { ...GREEN, Validate: { ...GREEN.Validate!, validate: { ok: true, hooks: [], calls: [], gates: [{ hook: 'tool.call', hasCatch: true }], errors: [], warnings: [] } } }
    expect(doneLineOf(withGates)).toBe('8/8 stages · 12 tests · validate clean · 1 gate')
  })

  test('fix prompt for a Test that did not run says so and quotes the error lines', () => {
    const text = fixPromptOf('git-branch', 'Test', ['claude plugin test: no *.test.ts or *.test.tsx under /m/mods/git-branch'], 0, 'mods/git-branch')
    expect(text).toStartWith('Fix the Test run in mods/git-branch (the tests did not run)')
    expect(text).toContain('claude plugin test: no *.test.ts or *.test.tsx under /m/mods/git-branch')
    expect(text).not.toContain('0 failing tests')
  })

  test('fix prompt names the path it is given, not mods/<name>', () => {
    expect(fixPromptOf('foo', 'Test', ['x'], 1, '/work/mods/foo')).toStartWith('Fix the failing test in /work/mods/foo. First failure, from Mod Lab:')
    expect(fixPromptOf('foo', 'Validate', ['x'], 2, 'other/foo')).toStartWith('Fix the Validate problems in other/foo. First failure, from Mod Lab:')
  })

  test('fix prompt says "the current folder" when the mod folder is the working directory, not "in .."', () => {
    expect(fixPromptOf('foo', 'Test', ['x'], 1, '.')).toStartWith('Fix the failing test in the current folder. First failure, from Mod Lab:')
  })

  test('view: the detail header shows the display path it is given, with a trailing slash', () => {
    expect(viewOf(FULL, GREEN, [], null, true, null, '/work/mods/git-branch').path).toBe('/work/mods/git-branch/')
    expect(viewOf(FULL, {}, [], null, false, null, 'other/git-branch').path).toBe('other/git-branch/')
  })

  test('displayPathOf: inside the cwd it is relative, the cwd itself is ".", anything else stays absolute', () => {
    expect(displayPathOf('/m/mods/foo', '/m')).toBe('mods/foo')
    expect(displayPathOf('/m', '/m')).toBe('.')
    expect(displayPathOf('/work/mods/foo', '/m')).toBe('/work/mods/foo')
    expect(displayPathOf('/m2/mods/foo', '/m')).toBe('/m2/mods/foo')
  })

  test('displayPathOf: with no working directory to compare, the path stays absolute', () => {
    expect(displayPathOf('/m/mods/foo', null)).toBe('/m/mods/foo')
    expect(displayPathOf('/m/./mods//foo', null)).toBe('/m/mods/foo')
  })

  test('marketplaceCandidatesOf: the marketplace file of the working directory and of every folder above it, nearest first, down to the root', () => {
    expect(marketplaceCandidatesOf('/w/wt/plugins/x')).toEqual([
      '/w/wt/plugins/x/.claude-plugin/marketplace.json',
      '/w/wt/plugins/.claude-plugin/marketplace.json',
      '/w/wt/.claude-plugin/marketplace.json',
      '/w/.claude-plugin/marketplace.json',
      '/.claude-plugin/marketplace.json',
    ])
    expect(marketplaceCandidatesOf('/')).toEqual(['/.claude-plugin/marketplace.json'])
  })

  test('marketplaceCandidatesOf: a working directory written with ".", "..", "//" or a trailing slash is read as the folder it names', () => {
    expect(marketplaceCandidatesOf('/w//wt/./plugins/../')).toEqual([
      '/w/wt/.claude-plugin/marketplace.json',
      '/w/.claude-plugin/marketplace.json',
      '/.claude-plugin/marketplace.json',
    ])
  })

  test('marketplaceCandidatesOf: a Windows drive is walked down to its root, as the drive (PR #57 review)', () => {
    expect(marketplaceCandidatesOf('C:\\repo\\wt')).toEqual([
      'C:/repo/wt/.claude-plugin/marketplace.json',
      'C:/repo/.claude-plugin/marketplace.json',
      'C:/.claude-plugin/marketplace.json',
    ])
  })

  test('marketplaceCandidatesOf: a UNC path is walked down to its share, keeping the // root (PR #57 review)', () => {
    const expected = ['//server/share/x/.claude-plugin/marketplace.json', '//server/share/.claude-plugin/marketplace.json']
    expect(marketplaceCandidatesOf('\\\\server\\share\\x')).toEqual(expected)
    expect(marketplaceCandidatesOf('//server/share/x')).toEqual(expected)
  })

  test('marketplaceCandidatesOf: a relative working directory names no folder to walk, so there are no candidates (PR #57 review)', () => {
    expect(marketplaceCandidatesOf('a/b')).toEqual([])
  })

  test('modsDirFor: a marketplace on a Windows drive or a UNC share gives its mods/ there (PR #57 review)', () => {
    expect(modsDirFor('', 'C:\\repo\\wt', ['C:/repo/wt/.claude-plugin/marketplace.json'], '/p/mods')).toBe('C:/repo/wt/mods')
    expect(modsDirFor('', 'C:\\repo\\wt', ['C:/.claude-plugin/marketplace.json'], '/p/mods')).toBe('C:/mods')
    expect(modsDirFor('', '\\\\server\\share\\x', ['//server/share/.claude-plugin/marketplace.json'], '/p/mods')).toBe('//server/share/mods')
  })

  test('normalizePath and displayPathOf keep a UNC root and stop ".." at a drive (PR #57 review)', () => {
    expect(normalizePath('\\\\server\\share\\x\\..\\y')).toBe('//server/share/y')
    expect(normalizePath('//server/share/x')).toBe('//server/share/x')
    expect(normalizePath('C:\\..\\x')).toBe('C:/x')
    expect(displayPathOf('//server/share/x/mods/foo', '\\\\server\\share\\x')).toBe('mods/foo')
  })

  test('freshIdsOf: "ready to share" marks kept before 0.2.9 as bare names belong to the folder the old records described (PR #57 review round 2)', () => {
    expect(freshIdsOf(['alpha', '/w/one/mods/beta'], '/p/mods')).toEqual(['/p/mods/alpha', '/w/one/mods/beta'])
    expect(freshIdsOf(['C:/w/mods/gamma'], '/p/mods')).toEqual(['C:/w/mods/gamma'])
    expect(freshIdsOf([], '/p/mods')).toEqual([])
  })

  test('normalizePath: ".." stops at a UNC share, as at any root (PR #57 review round 2)', () => {
    expect(normalizePath('\\\\server\\share\\repo\\..\\..\\mods')).toBe('//server/share/mods')
    expect(normalizePath('\\\\server\\share\\..\\..\\..\\mods')).toBe('//server/share/mods')
  })

  test('normalizePath: a drive letter is written upper case, so one folder has one spelling (PR #57 review round 2)', () => {
    expect(normalizePath('c:/repo')).toBe('C:/repo')
    expect(normalizePath('c:\\repo\\..\\..')).toBe('C:/')
    expect(marketplaceCandidatesOf('c:\\repo')).toEqual(['C:/repo/.claude-plugin/marketplace.json', 'C:/.claude-plugin/marketplace.json'])
  })

  test('modsDirFor: the mods/ of the nearest folder above the working directory that holds a marketplace', () => {
    const marketplace = ['/w/wt/.claude-plugin/marketplace.json']
    expect(modsDirFor('', '/w/wt/plugins/x', marketplace, '/main/mods')).toBe('/w/wt/mods')
    expect(modsDirFor('', '/w/wt', marketplace, '/main/mods')).toBe('/w/wt/mods')
  })

  test('modsDirFor: a worktree inside the main checkout uses the worktree, the nearer marketplace', () => {
    const both = ['/w/main/.claude-plugin/marketplace.json', '/w/main/scratch/wt/.claude-plugin/marketplace.json']
    expect(modsDirFor('', '/w/main/scratch/wt/plugins/x', both, '/p/mods')).toBe('/w/main/scratch/wt/mods')
    expect(modsDirFor('', '/w/main/plugins/x', both, '/p/mods')).toBe('/w/main/mods')
  })

  test('modsDirFor: the order of the existing list does not matter, only how near the folder is', () => {
    const farFirst = ['/w/.claude-plugin/marketplace.json', '/w/wt/.claude-plugin/marketplace.json']
    expect(modsDirFor('', '/w/wt/plugins/x', farFirst, '/p/mods')).toBe('/w/wt/mods')
  })

  test('modsDirFor: with no marketplace above the working directory it is the fallback, normalized', () => {
    expect(modsDirFor('', '/w/wt/plugins/x', [], '/p/plugins/mod-builder/../../mods')).toBe('/p/mods')
    expect(modsDirFor('', '/w/wt/plugins/x', ['/other/.claude-plugin/marketplace.json'], '/p/mods')).toBe('/p/mods')
  })

  test('modsDirFor: with no working directory to walk from it is the fallback, even if a marketplace exists', () => {
    expect(modsDirFor('', null, ['/w/wt/.claude-plugin/marketplace.json'], '/p/mods')).toBe('/p/mods')
  })

  test('modsDirFor: a marketplace at the filesystem root gives /mods', () => {
    expect(modsDirFor('', '/w/x', ['/.claude-plugin/marketplace.json'], '/p/mods')).toBe('/mods')
  })

  test('modsDirFor: a set modsDir always wins, normalized', () => {
    const marketplace = ['/w/wt/.claude-plugin/marketplace.json']
    expect(modsDirFor('/chosen/mods', '/w/wt/plugins/x', marketplace, '/p/mods')).toBe('/chosen/mods')
    expect(modsDirFor('/chosen/./sub/../mods/', '/w/wt/plugins/x', marketplace, '/p/mods')).toBe('/chosen/mods')
    expect(modsDirFor('/chosen/mods', null, [], '/p/mods')).toBe('/chosen/mods')
  })

  test('view: fresh green mods are ready to share with a done line; others are quiet', () => {
    const freshView = viewOf(FULL, GREEN, [], null, true, null, 'mods/git-branch')
    expect(freshView).toMatchObject({ status: 'ready to share', isFresh: true, doneLine: '8/8 stages · 12 tests · validate clean', version: '0.1.0', path: 'mods/git-branch/', time: '0:03' })
    expect(viewOf(FULL, GREEN, [], null, false, null, 'mods/git-branch')).toMatchObject({ status: '12 tests · clean', isFresh: false, doneLine: null })
    expect(viewOf(FULL, {}, [], null, true, null, 'mods/git-branch').isFresh).toBe(false)
  })

  test('paths and facts from a folder read', () => {
    expect(normalizePath('/a/b/plugins/mod-builder/../../mods')).toBe('/a/b/mods')
    expect(normalizePath('C:\\x\\.\\y')).toBe('C:/x/y')
    expect(shortPath('/mnt/c/Projects/ClaudeMod/mods')).toBe('…/ClaudeMod/mods')
    const file = (name: string, mtimeMs: number) => ({ name, kind: 'file' as const, mtimeMs })
    const read = {
      name: 'git-branch',
      top: [file('SPEC.md', 100), file('README.md', 400)],
      manifestDir: [file('plugin.json', 200)],
      hooks: [file('hooks.json', 200), file('register.tsx', 500), file('branch-logic.ts', 300)],
      tests: [file('branch-logic.test.ts', 400), { name: 'fixtures', kind: 'dir' as const, mtimeMs: 999 }],
      types: [],
      spec: '| archetype | REQUIRED | band | x |\n| built on | HOUSE | Claude Code 2.1.296 | y |\nDone.',
      readme: '# Git branch\n\n## What it reaches\n',
      manifest: '{"name":"git-branch","version":"0.2.0","description":"Branch band."}',
      marketplace: JSON.stringify({ plugins: [{ name: 'git-branch', source: './mods/git-branch' }] }),
    }
    expect(factsOf(read)).toMatchObject({
      hasSpec: true, hasManifest: true, hasHooksJson: true, hasLogic: true, hasTests: true, hasRegister: true,
      readmeHasReaches: true, isListed: true, codeMtimeMs: 500, firstMtimeMs: 100, lastMtimeMs: 500,
      archetype: 'band', builtOn: '2.1.296', version: '0.2.0', description: 'Branch band.', isReadmeStale: true,
    })
    expect(factsOf({ ...read, manifestDir: [], spec: null })).toBeNull()
  })

  test('runs: argv, results with durations and counts, toasts', () => {
    expect(argvOf('Validate', '/m/x')).toEqual(['claude', 'plugin', 'validate', '--json', '/m/x'])
    expect(argvOf('Test', '/m/x')).toEqual(['claude', 'plugin', 'test', '/m/x'])
    const validated = resultOf('Validate', 0, validateClean, 7, 1200)
    expect(validated).toMatchObject({ kind: 'Validate', ok: true, stampMs: 7, durationMs: 1200 })
    expect(toastOfRun('mod-builder', validated)).toStartWith('✓ mod-builder: clean · 8 hooks · ')
    const failed = resultOf('Test', 1, testFail, 7, 900)
    expect(failed.tests).toEqual({ passed: 3, failed: 1 })
    expect(toastOfRun('try-notes', failed)).toBe('✕ try-notes: 1 test failing. Press F in Mod Lab to fix')
    expect(resultOf('Typecheck', 0, '', 7)).toMatchObject({ ok: true, summary: 'types clean' })
  })

  test('lab_report: checked input; stale running reports expire', () => {
    expect(reportOf({ mod: 'git-branch', stage: 'Logic', status: 'running', note: 'writing tests' }, 5)).toEqual({
      mod: 'git-branch',
      report: { stage: 'Logic', status: 'running', note: 'writing tests', since: 5 },
    })
    expect('error' in reportOf({ mod: 'Git Branch', stage: 'Logic', status: 'running' }, 5)).toBe(true)
    expect('error' in reportOf({ mod: 'x', stage: 'Deploy', status: 'running' }, 5)).toBe(true)
    const reports = { a: { stage: 'Logic' as const, status: 'running' as const, since: 0 }, b: { stage: 'Test' as const, status: 'passed' as const, since: 0 } }
    expect(Object.keys(liveReports(reports, REPORT_TTL_MS - 1))).toEqual(['a', 'b'])
    expect(Object.keys(liveReports(reports, REPORT_TTL_MS))).toEqual(['b'])
  })

  test('band: real progress only; runs, then reports, then the demo; three at most', () => {
    const view = viewOf(FULL, {}, [], null, false, null, 'mods/git-branch')
    const entries = bandEntriesOf(
      [{ mod: 'git-branch', kind: 'Test', startedAt: 1, passed: 7, failed: 0, total: 12 }],
      { b: { stage: 'Spec', status: 'running', since: 3, note: 'writing SPEC.md' }, c: { stage: 'Spec', status: 'passed', since: 4 } },
      { view: demoViewAt(0), since: 9 },
      [view],
    )
    expect(entries.map(entry => [entry.name, entry.stage, entry.detail])).toEqual([
      ['git-branch', 'Test', '7 of 12 passed'],
      ['b', 'Spec', 'writing SPEC.md'],
      ['aurora', 'Spec', 'writing SPEC.md · demo'],
    ])
    expect(entries[0]?.fraction).toBe(7 / 12)
    expect(entries[2]?.fraction).toBe(0)
    const validating = bandEntriesOf([{ mod: 'git-branch', kind: 'Validate', startedAt: 1, passed: 0, failed: 0, total: null }], {}, null, [view])
    expect(validating[0]?.fraction).toBe(6 / 8)
    expect(bandEntriesOf([], {}, null)).toEqual([])
  })

  test('demo: 12 s walk, one failure Claude fixes, holds green 3 s', () => {
    const beats = demoTimeline()
    expect(new Set(beats.map(beat => beat.stage))).toEqual(new Set(STAGES))
    expect(demoWalkMs(beats)).toBe(12_000)
    expect(demoLengthMs(beats)).toBe(15_000)
    const failAt = beats.find(beat => beat.light === 'failed')!.atMs
    const failed = demoViewAt(failAt + 100)
    expect(failed).toMatchObject({ failedStage: 'Test', tone: 'error', status: '1 test failing' })
    expect(failed.errors[0]).toBe('band steps aside when hasSurvey is true')
    expect(demoViewAt(failAt + 1700).status).toBe('Claude is fixing src/band.tsx')
    const end = demoViewAt(12_000)
    expect(isGreen(end.lights)).toBe(true)
    expect(end).toMatchObject({ status: 'ready to share', isDemo: true, doneLine: 'aurora walked all 8 stages in 0:12  ·  demo, nothing saved' })
    expect(demoClockOf(2000)).toEqual({ now: '0:02', total: '0:12' })
    expect(demoClockOf(20_000).now).toBe('0:12')
    expect(demoToastsBetween(0, failAt - 1)).toEqual(['✓ aurora: validate clean · 3 hooks'])
    expect(demoToastsBetween(failAt - 1, failAt)).toEqual(['✕ aurora: 1 test failing. Claude is fixing it'])
  })

  test('rerun plan: stale Validate or Test re-runs Validate, then Test once it has run before', () => {
    const lights = (validate: string, test: string) => ['passed', 'passed', 'passed', 'passed', validate, test, 'pending', 'pending'] as never
    expect(rerunPlanOf(lights('passed', 'passed'), false)).toEqual([])
    expect(rerunPlanOf(lights('stale', 'stale'), false)).toEqual(['Validate', 'Test'])
    expect(rerunPlanOf(lights('passed', 'stale'), false)).toEqual(['Test'])
    expect(rerunPlanOf(lights('failed', 'stale'), false)).toEqual([])
    expect(rerunPlanOf(lights('pending', 'stale'), false)).toEqual(['Test'])
    expect(rerunPlanOf(lights('stale', 'pending'), false)).toEqual(['Validate'])
    expect(rerunPlanOf(lights('stale', 'stale'), true)).toEqual([])
    expect(rerunPlanOf(lights('failed', 'pending'), false)).toEqual([])
  })

  test('edit generation: evidence older than the edit goes stale; Scaffold and Register stay green', () => {
    const built: FileFacts = { ...FULL, version: '0.2.0', listedVersion: '0.1.0', specMtimeMs: 100, logicMtimeMs: 300, readmeMtimeMs: 400, codeMtimeMs: 500 }
    const ran: Results = {
      Validate: { kind: 'Validate', ok: true, stampMs: 500, atMs: 600, summary: 'clean', errors: [] },
      Test: { kind: 'Test', ok: true, stampMs: 500, atMs: 650, summary: 'ok', errors: [], tests: { passed: 3, failed: 0 } },
    }
    expect(lightsOf(built, ran, [], null)).toEqual(STAGES.map(() => 'passed'))
    expect(lightsOf(built, ran, [], null, { since: 1000, fromVersion: null })).toEqual(['stale', 'passed', 'stale', 'passed', 'stale', 'stale', 'stale', 'stale'])
    const redone: FileFacts = { ...built, specMtimeMs: 1100, logicMtimeMs: 1200, readmeMtimeMs: 1300, codeMtimeMs: 1200, listedVersion: '0.2.0' }
    const rerun: Results = {
      Validate: { ...ran.Validate!, stampMs: 1200, atMs: 1400 },
      Test: { ...ran.Test!, stampMs: 1200, atMs: 1450 },
    }
    expect(isGreen(lightsOf(redone, rerun, [], null, { since: 1000, fromVersion: null }))).toBe(true)
    expect(statusOf(lightsOf(built, ran, [], null, { since: 1000, fromVersion: null }), ran, null, [], false)).toEqual({ text: 'edit · update Spec for this change', tone: 'warn' })
  })

  test('a running report shows even on a stage that passed; Spec running on a built mod starts an edit', () => {
    const report = { stage: 'Logic' as const, status: 'running' as const, since: 0 }
    expect(lightsOf(FULL, { ...ok('Validate'), ...ok('Test') }, [], report)[2]).toBe('running')
    const spec = { stage: 'Spec' as const, status: 'running' as const, since: 0 }
    expect(startsGeneration(spec, STAGES.map(() => 'passed'))).toBe(true)
    expect(startsGeneration(spec, STAGES.map(() => 'pending'))).toBe(false)
    expect(startsGeneration(spec, null)).toBe(false)
    expect(startsGeneration({ ...spec, stage: 'Logic' }, STAGES.map(() => 'passed'))).toBe(false)
    expect(listedVersionOf(JSON.stringify({ plugins: [{ name: 'x', version: '1.0.0' }] }), 'x')).toBe('1.0.0')
    expect(listedVersionOf('nope', 'x')).toBeNull()
    expect(listedVersionOf(JSON.stringify({ plugins: [{ name: 'other-name', source: './mods/x', version: '2.0.0' }] }), 'x')).toBe('2.0.0')
  })

  test('a deletion or rename makes results stale even when no mtime rises', () => {
    const before = signatureOf(['a-logic.ts@100', 'b.test.ts@200'])
    expect(signatureOf(['b.test.ts@200', 'a-logic.ts@100'])).toBe(before)
    expect(signatureOf(['b.test.ts@200'])).not.toBe(before)
    expect(signatureOf(['c-logic.ts@100', 'b.test.ts@200'])).not.toBe(before)
    const ran: Results = { Validate: { kind: 'Validate', ok: true, stampMs: 200, codeSig: before, summary: 'clean', errors: [] } }
    expect(lightsOf({ ...FULL, codeMtimeMs: 200, codeSig: before }, ran, [], null)[4]).toBe('passed')
    expect(lightsOf({ ...FULL, codeMtimeMs: 200, codeSig: signatureOf(['b.test.ts@200']) }, ran, [], null)[4]).toBe('stale')
  })

  test('the signature sees files in subfolders and moves between folders; nested files never count as the logic module', () => {
    const file = (name: string, mtimeMs: number) => ({ name, kind: 'file' as const, mtimeMs })
    const read = {
      name: 'x', top: [], manifestDir: [file('plugin.json', 100)],
      hooks: [file('register.tsx', 100), { name: 'lib', kind: 'dir' as const, mtimeMs: 100 }],
      tests: [file('x.test.ts', 100)], types: [],
      nested: [file('hooks/lib/parser.ts', 100), file('hooks/lib/x-logic.ts', 100)],
      spec: '# x', readme: null, manifest: null, marketplace: '',
    }
    const before = factsOf(read)!
    expect(before.hasLogic).toBe(false)
    const edited = factsOf({ ...read, nested: [file('hooks/lib/parser.ts', 900), file('hooks/lib/x-logic.ts', 100)] })!
    expect(edited.codeSig).not.toBe(before.codeSig)
    expect(edited.codeMtimeMs).toBe(900)
    const moved = factsOf({ ...read, hooks: [file('register.tsx', 100), file('x.test.ts', 100)], tests: [] })!
    expect(moved.codeSig).not.toBe(before.codeSig)
    expect(factsOf({ ...read, nested: [{ name: 'hooks/lib/deeper', kind: 'dir' as const, mtimeMs: 900 }, ...read.nested] })!.codeSig).toBe(before.codeSig)
  })

  // validate also reads agents/, commands/, skills/ and the root .mcp.json (#17), so editing them must make Validate stale.
  const FOLDER_READ = {
    name: 'x',
    top: [{ name: 'SPEC.md', kind: 'file' as const, mtimeMs: 100 }, { name: 'README.md', kind: 'file' as const, mtimeMs: 300 }],
    manifestDir: [{ name: 'plugin.json', kind: 'file' as const, mtimeMs: 100 }],
    hooks: [{ name: 'register.tsx', kind: 'file' as const, mtimeMs: 100 }],
    tests: [{ name: 'x.test.ts', kind: 'file' as const, mtimeMs: 100 }],
    types: [],
    spec: '# x',
    readme: '# x\n\n## What it reaches\n',
    manifest: null,
    marketplace: '',
  }
  const factsWith = (extra: Record<string, unknown>) => factsOf({ ...FOLDER_READ, ...extra } as Parameters<typeof factsOf>[0])!

  for (const folder of ['agents', 'commands', 'skills']) {
    test(`the signature sees a file in ${folder}/ (#17)`, () => {
      const file = (name: string, mtimeMs: number) => ({ name, kind: 'file' as const, mtimeMs })
      const none = factsWith({})
      const added = factsWith({ [folder]: [file('x.md', 100)] })
      expect(added.codeSig).not.toBe(none.codeSig)
      const edited = factsWith({ [folder]: [file('x.md', 900)] })
      expect(edited.codeSig).not.toBe(added.codeSig)
      expect(edited.codeMtimeMs).toBe(900)
      // README.md (300) is now older than the newest code.
      expect(added.isReadmeStale).toBe(false)
      expect(edited.isReadmeStale).toBe(true)
      // A folder inside it is no file of its own: only the files in it count.
      expect(factsWith({ [folder]: [file('x.md', 100), { name: 'sub', kind: 'dir' as const, mtimeMs: 900 }] }).codeSig).toBe(added.codeSig)
    })
  }

  test('a file moved between agents/, commands/ and skills/ without a new mtime changes the signature (#17)', () => {
    const file = { name: 'x.md', kind: 'file' as const, mtimeMs: 100 }
    const inAgents = factsWith({ agents: [file] })
    const inCommands = factsWith({ commands: [file] })
    const inSkills = factsWith({ skills: [file] })
    expect(new Set([inAgents.codeSig, inCommands.codeSig, inSkills.codeSig]).size).toBe(3)
  })

  test('the signature sees the root .mcp.json, and no other file at the top (#17)', () => {
    const top = (mcp: number, readme: number) => [
      { name: 'SPEC.md', kind: 'file' as const, mtimeMs: 100 },
      { name: 'README.md', kind: 'file' as const, mtimeMs: readme },
      ...(mcp ? [{ name: '.mcp.json', kind: 'file' as const, mtimeMs: mcp }] : []),
    ]
    const none = factsWith({ top: top(0, 300) })
    const added = factsWith({ top: top(100, 300) })
    expect(added.codeSig).not.toBe(none.codeSig)
    const edited = factsWith({ top: top(900, 300) })
    expect(edited.codeSig).not.toBe(added.codeSig)
    expect(edited.codeMtimeMs).toBe(900)
    expect(edited.isReadmeStale).toBe(true)
    // The README and the SPEC are read by neither validate nor test: editing them leaves the signature.
    expect(factsWith({ top: top(100, 950) }).codeSig).toBe(added.codeSig)
  })

  test('during an edit, Share needs a version different from the one the edit started from', () => {
    const listed: FileFacts = { ...FULL, version: '0.1.0', listedVersion: '0.1.0' }
    expect(lightsOf(listed, {}, [], null, { since: 1000, fromVersion: '0.1.0' })[7]).toBe('stale')
    expect(lightsOf({ ...listed, version: '0.2.0', listedVersion: '0.2.0' }, {}, [], null, { since: 1000, fromVersion: '0.1.0' })[7]).toBe('passed')
    expect(lightsOf({ ...listed, version: '0.2.0', listedVersion: '0.1.0' }, {}, [], null, { since: 1000, fromVersion: '0.1.0' })[7]).toBe('stale')
  })
})

describe('logicMtimeMs sees nested logic and test files (#15)', () => {
  const file = (name: string, mtimeMs: number) => ({ name, kind: 'file' as const, mtimeMs })
  const read = {
    name: 'x',
    top: [],
    manifestDir: [file('plugin.json', 100)],
    hooks: [file('register.tsx', 100), file('x-logic.ts', 200), { name: 'lib', kind: 'dir' as const, mtimeMs: 100 }],
    tests: [file('x-logic.test.ts', 300)],
    types: [],
    nested: [file('hooks/lib/parser.ts', 100)],
    spec: '# x',
    readme: null,
    manifest: null,
    marketplace: '',
  }

  test('a nested hooks/ file newer than the top-level files raises logicMtimeMs and leaves hasLogic unchanged', () => {
    const before = factsOf(read)!
    expect(before.logicMtimeMs).toBe(300)
    const edited = factsOf({ ...read, nested: [file('hooks/lib/parser.ts', 900)] })!
    expect(edited.logicMtimeMs).toBe(900)
    expect(edited.hasLogic).toBe(before.hasLogic)
    const older = factsOf({ ...read, nested: [file('hooks/lib/parser.ts', 250)] })!
    expect(older.logicMtimeMs).toBe(300)
    const deeper = factsOf({ ...read, nested: [file('hooks/lib/deep/more/parser.ts', 950)] })!
    expect(deeper.logicMtimeMs).toBe(950)
    const onlyRegister = { ...read, hooks: [file('register.tsx', 100)], tests: [file('x.test.ts', 100)] }
    const nestedOnly = factsOf({ ...onlyRegister, nested: [file('hooks/lib/x-logic.ts', 700)] })!
    expect(nestedOnly.logicMtimeMs).toBe(700)
    expect(nestedOnly.hasLogic).toBe(false)
  })

  test('a nested tests/ file named *.test.ts raises logicMtimeMs and leaves hasTests unchanged', () => {
    const noTests = { ...read, tests: [] }
    const before = factsOf(noTests)!
    expect(before.logicMtimeMs).toBe(200)
    const edited = factsOf({ ...noTests, nested: [file('tests/unit/parser.test.ts', 800)] })!
    expect(edited.logicMtimeMs).toBe(800)
    expect(edited.hasTests).toBe(false)
    expect(factsOf({ ...noTests, nested: [file('tests/unit/ui.test.tsx', 850)] })!.logicMtimeMs).toBe(850)
  })

  test('only nested logic and test files count: not register.*, .d.ts, data files, types/, or helpers under tests/', () => {
    const counted = file('hooks/lib/parser.ts', 500)
    const ignored = [
      file('hooks/lib/register.ts', 900),
      file('hooks/lib/register.tsx', 900),
      file('hooks/lib/types.d.ts', 900),
      file('hooks/lib/data.json', 900),
      file('hooks/lib/README.md', 900),
      file('types/lib/api.ts', 900),
      file('types/lib/api.d.ts', 900),
      file('tests/fixtures/helper.ts', 900),
      file('tests/fixtures/data.json', 900),
      file('tests/fixtures/x-logic.ts', 900),
    ]
    const facts = factsOf({ ...read, nested: [counted, ...ignored] })!
    expect(facts.logicMtimeMs).toBe(500)
    expect(facts.codeMtimeMs).toBe(900)
  })
})

describe('factsOf: logicSig names the logic and test files, so a delete or rename shows (#75)', () => {
  // Typed as Entry, so a listing can mix files and folders (the typecheck read `read`'s lists as files only).
  const file = (name: string, mtimeMs: number): Entry => ({ name, kind: 'file', mtimeMs })
  const dir = (name: string, mtimeMs: number): Entry => ({ name, kind: 'dir', mtimeMs })
  const read = {
    name: 'x',
    top: [file('SPEC.md', 100)],
    manifestDir: [file('plugin.json', 100)],
    hooks: [file('hooks.json', 100), file('register.tsx', 100), file('x-logic.ts', 200), dir('lib', 100)],
    tests: [file('x-logic.test.ts', 300), file('y.test.ts', 300)],
    types: [file('index.d.ts', 100)],
    nested: [file('hooks/lib/parser.ts', 100), file('tests/unit/parser.test.ts', 100)],
    spec: '# x',
    readme: null,
    manifest: null,
    marketplace: '',
  }
  const sigOf = (change: Partial<typeof read> = {}) => factsOf({ ...read, ...change })!.logicSig

  test('the signature is a string, the same for the same files', () => {
    expect(typeof sigOf()).toBe('string')
    expect(sigOf({ ...read })).toBe(sigOf())
  })

  test('a removed, renamed or added top-level logic module or test file changes it', () => {
    const before = sigOf()
    expect(typeof before).toBe('string')
    const hooks = read.hooks.filter(entry => entry.name !== 'x-logic.ts')
    const removedLogic = sigOf({ hooks })
    const removedTest = sigOf({ tests: [file('x-logic.test.ts', 300)] })
    // A rename keeps the file's mtime.
    const renamedLogic = sigOf({ hooks: [...hooks, file('z-logic.ts', 200)] })
    const renamedTest = sigOf({ tests: [file('x-logic.test.ts', 300), file('z.test.ts', 300)] })
    const addedLogic = sigOf({ hooks: [...read.hooks, file('w-logic.ts', 50)] })
    const addedTest = sigOf({ tests: [...read.tests, file('w.test.ts', 50)] })
    const all = [before, removedLogic, removedTest, renamedLogic, renamedTest, addedLogic, addedTest]
    expect(new Set(all).size).toBe(all.length)
  })

  test('a removed, renamed, moved or added nested logic or test file changes it', () => {
    const before = sigOf()
    expect(typeof before).toBe('string')
    const unit = file('tests/unit/parser.test.ts', 100)
    const parser = file('hooks/lib/parser.ts', 100)
    const removedLogic = sigOf({ nested: [unit] })
    const removedTest = sigOf({ nested: [parser] })
    const renamedLogic = sigOf({ nested: [file('hooks/lib/lexer.ts', 100), unit] })
    const movedLogic = sigOf({ nested: [file('hooks/util/parser.ts', 100), unit] })
    const addedLogic = sigOf({ nested: [...read.nested, file('hooks/lib/deep/more.ts', 100)] })
    const addedTest = sigOf({ nested: [...read.nested, file('tests/unit/lexer.test.tsx', 100)] })
    const all = [before, removedLogic, removedTest, renamedLogic, movedLogic, addedLogic, addedTest]
    expect(new Set(all).size).toBe(all.length)
  })

  test('register.*, .d.ts, data files, types/, helpers under tests/ and folders leave it alone', () => {
    const before = sigOf()
    expect(typeof before).toBe('string')
    const ignored = [
      file('hooks/lib/register.ts', 900),
      file('hooks/lib/register.tsx', 900),
      file('hooks/lib/types.d.ts', 900),
      file('hooks/lib/data.json', 900),
      file('hooks/lib/README.md', 900),
      file('types/lib/api.ts', 900),
      file('types/lib/api.d.ts', 900),
      file('tests/fixtures/helper.ts', 900),
      file('tests/fixtures/data.json', 900),
      file('tests/fixtures/x-logic.ts', 900),
      dir('hooks/lib/deeper', 900),
    ]
    expect(sigOf({ nested: [...read.nested, ...ignored] })).toBe(before)
    expect(sigOf({ hooks: read.hooks.filter(entry => entry.name !== 'register.tsx') })).toBe(before)
    expect(sigOf({ hooks: [...read.hooks, file('register.ts', 900), file('types.d.ts', 900), file('data.json', 900), dir('more', 900)] })).toBe(before)
    expect(sigOf({ types: [] })).toBe(before)
    expect(sigOf({ types: [file('index.d.ts', 100), file('extra.d.ts', 100)] })).toBe(before)
    expect(sigOf({ top: [file('SPEC.md', 900), file('README.md', 900), file('.mcp.json', 900)] })).toBe(before)
    expect(sigOf({ tests: [...read.tests, dir('fixtures', 900), file('helper.ts', 900)] })).toBe(before)
  })

  test('a folder under hooks/ or tests/ that could not be listed makes it unknown (null), not a delete (PR #97 review)', () => {
    const unlisted = (folders: string[]) => factsOf({ ...read, unlisted: folders })!.logicSig
    expect(unlisted(['hooks/lib'])).toBeNull()
    expect(unlisted(['hooks'])).toBeNull()
    expect(unlisted(['tests'])).toBeNull()
    expect(unlisted(['tests/unit/deeper'])).toBeNull()
    // Folders it doesn't read leave it as it was.
    expect(unlisted(['types/lib', 'skills', 'agents/x', 'hooksx', '.claude-plugin'])).toBe(sigOf())
    expect(unlisted([])).toBe(sigOf())
  })
})

describe('lightsOf: a changed set of logic and test files redoes the Logic stage during an edit (#75)', () => {
  // The edit began at 1000. Every logic and test file is older (300), as after a delete or a rename, and the rest is redone.
  const after: FileFacts = {
    ...FULL,
    version: '0.2.0',
    listedVersion: '0.2.0',
    specMtimeMs: 1100,
    logicMtimeMs: 300,
    readmeMtimeMs: 1300,
    codeMtimeMs: 1200,
    codeSig: 'sig-b',
    logicSig: 'after',
  }
  const rerun: Results = {
    Validate: { kind: 'Validate', ok: true, stampMs: 1200, atMs: 1400, codeSig: 'sig-b', summary: 'clean', errors: [] },
    Test: { kind: 'Test', ok: true, stampMs: 1200, atMs: 1450, codeSig: 'sig-b', summary: 'ok', errors: [], tests: { passed: 3, failed: 0 } },
  }
  const PASSED = STAGES.map(() => 'passed')
  const STALE_LOGIC = STAGES.map(stage => (stage === 'Logic' ? 'stale' : 'passed'))

  test('a generation logicSig that differs from the current one gives Logic passed', () => {
    expect(lightsOf(after, rerun, [], null, { since: 1000, fromVersion: '0.1.0', logicSig: 'before' })).toEqual(PASSED)
    expect(isGreen(lightsOf(after, rerun, [], null, { since: 1000, fromVersion: '0.1.0', logicSig: 'before' }))).toBe(true)
  })

  test('the same logicSig, none stored, or none passed keeps today\'s rule: Logic stale', () => {
    expect(lightsOf(after, rerun, [], null, { since: 1000, fromVersion: '0.1.0', logicSig: 'before' })[2]).toBe('passed')
    expect(lightsOf(after, rerun, [], null, { since: 1000, fromVersion: '0.1.0', logicSig: 'after' })).toEqual(STALE_LOGIC)
    expect(lightsOf(after, rerun, [], null, { since: 1000, fromVersion: '0.1.0', logicSig: null })).toEqual(STALE_LOGIC)
    expect(lightsOf(after, rerun, [], null, { since: 1000, fromVersion: '0.1.0' })).toEqual(STALE_LOGIC)
  })

  test('a logic file saved after the edit began is redone with the same logicSig, as before', () => {
    expect(lightsOf(after, rerun, [], null, { since: 1000, fromVersion: '0.1.0', logicSig: 'before' })[2]).toBe('passed')
    expect(lightsOf({ ...after, logicMtimeMs: 1200 }, rerun, [], null, { since: 1000, fromVersion: '0.1.0', logicSig: 'after' })).toEqual(PASSED)
    expect(lightsOf({ ...after, logicMtimeMs: 1200 }, rerun, [], null, { since: 1000, fromVersion: '0.1.0', logicSig: 'before' })).toEqual(PASSED)
  })

  test('a differing logicSig only matters during an edit, and never makes a missing stage pass', () => {
    expect(lightsOf(after, rerun, [], null, { since: 1000, fromVersion: '0.1.0', logicSig: 'before' })[2]).toBe('passed')
    // Outside an edit nothing is stale for being old.
    expect(lightsOf({ ...after, logicSig: 'after' }, rerun, [], null, null)).toEqual(PASSED)
    // If the edit removed the last test file or the last logic module, Logic is still not done.
    expect(lightsOf({ ...after, hasTests: false }, rerun, [], null, { since: 1000, fromVersion: '0.1.0', logicSig: 'before' })[2]).toBe('pending')
    expect(lightsOf({ ...after, hasLogic: false }, rerun, [], null, { since: 1000, fromVersion: '0.1.0', logicSig: 'before' })[2]).toBe('pending')
  })

  test('an unknown current logicSig (a folder that could not be listed) keeps today\'s rule: Logic stale (PR #97 review)', () => {
    expect(lightsOf(after, rerun, [], null, { since: 1000, fromVersion: '0.1.0', logicSig: 'before' })[2]).toBe('passed')
    expect(lightsOf({ ...after, logicSig: null }, rerun, [], null, { since: 1000, fromVersion: '0.1.0', logicSig: 'before' })).toEqual(STALE_LOGIC)
    expect(lightsOf({ ...after, logicSig: null, logicMtimeMs: 1200 }, rerun, [], null, { since: 1000, fromVersion: '0.1.0', logicSig: 'before' })).toEqual(PASSED)
  })

  test('a differing logicSig leaves the other stages as they were', () => {
    const stale: FileFacts = { ...after, specMtimeMs: 100, readmeMtimeMs: 100 }
    expect(lightsOf(stale, rerun, [], null, { since: 1000, fromVersion: '0.1.0', logicSig: 'before' })).toEqual(STAGES.map(stage => (stage === 'Spec' || stage === 'README' ? 'stale' : 'passed')))
  })
})

describe('a mod is listed as soon as a build reports it, before its folder exists (#19)', () => {
  const running = (stage: 'Spec' | 'Logic', since = 0): ReportedByMod[string] => ({ stage, status: 'running', since })
  const finished = (status: 'passed' | 'failed'): ReportedByMod[string] => ({ stage: 'Spec', status, since: 0 })

  test('placeholderNames: a name with a running report and no facts gets a row; one with facts does not', () => {
    expect(placeholderNames({ 'new-mod': running('Spec') }, ['git-branch'])).toEqual(['new-mod'])
    expect(placeholderNames({ 'new-mod': running('Spec') }, [])).toEqual(['new-mod'])
    expect(placeholderNames({ 'git-branch': running('Logic'), 'new-mod': running('Spec') }, ['git-branch'])).toEqual(['new-mod'])
    expect(placeholderNames({ a: running('Spec'), b: running('Logic') }, ['git-branch'])?.slice().sort()).toEqual(['a', 'b'])
    expect(placeholderNames({}, ['git-branch'])).toEqual([])
  })

  test('placeholderNames: a passed or failed report for a missing folder gets no row, so a typo in an old report never lingers', () => {
    expect(placeholderNames({ typo: finished('passed') }, ['git-branch'])).toEqual([])
    expect(placeholderNames({ typo: finished('failed') }, ['git-branch'])).toEqual([])
    expect(placeholderNames({ typo: finished('passed'), 'new-mod': running('Spec') }, [])).toEqual(['new-mod'])
  })

  test('placeholderNames: a running report older than REPORT_TTL_MS gets no row, once liveReports has dropped it', () => {
    const reports = { 'new-mod': running('Spec', 0) }
    expect(placeholderNames(liveReports(reports, REPORT_TTL_MS - 1), [])).toEqual(['new-mod'])
    expect(placeholderNames(liveReports(reports, REPORT_TTL_MS), [])).toEqual([])
  })

  test('placeholderNames: given a mods folder, only reports made in that folder get a row (Codex P2, PR #80)', () => {
    const inOne = { ...running('Spec'), dir: '/w/one/mods' }
    expect(placeholderNames({ 'new-mod': inOne }, [], '/w/one/mods')).toEqual(['new-mod'])
    expect(placeholderNames({ 'new-mod': inOne }, [], '/w/two/mods')).toEqual([])
    expect(placeholderNames({ 'new-mod': running('Spec') }, [], '/w/two/mods')).toEqual([])
  })

  test('withBuilding: running reports are kept per mods folder and name, so a same-named build elsewhere leaves this one (Codex P2, PR #80 round 4)', () => {
    const one = withBuilding({}, '/w/one/mods', 'new-mod', running('Spec', 100), 100)
    expect(one).toEqual({ '/w/one/mods': { 'new-mod': running('Spec', 100) } })
    const both = withBuilding(one ?? {}, '/w/two/mods', 'new-mod', running('Spec', 200), 200)
    expect(both).toEqual({ '/w/one/mods': { 'new-mod': running('Spec', 100) }, '/w/two/mods': { 'new-mod': running('Spec', 200) } })
    // A finished report ends only its own folder's build.
    expect(withBuilding(both ?? {}, '/w/two/mods', 'new-mod', { ...finished('passed'), since: 300 }, 300)).toEqual({ '/w/one/mods': { 'new-mod': running('Spec', 100) } })
    // Expired running entries are dropped on the way in, with any folder left empty.
    expect(withBuilding(both ?? {}, '/w/two/mods', 'other', running('Logic', 100 + REPORT_TTL_MS), 100 + REPORT_TTL_MS)).toEqual({ '/w/two/mods': { 'new-mod': running('Spec', 200), other: running('Logic', 100 + REPORT_TTL_MS) } })
  })

  test('placeholderFacts: the facts of a folder with nothing in it, under the reported name', () => {
    const facts = placeholderFacts('new-mod')
    expect(facts).toBeDefined()
    expect(facts?.name).toBe('new-mod')
    const flags = Object.entries(facts ?? {}).filter(([key]) => /^has[A-Z]/.test(key))
    expect(flags.map(([key]) => key).sort()).toEqual(Object.keys(EMPTY).filter(key => /^has[A-Z]/.test(key)).sort())
    expect(flags.filter(([, value]) => value !== false)).toEqual([])
    expect(facts).toMatchObject({
      specHasPlaceholder: false,
      readmeHasReaches: false,
      isListed: false,
      isReadmeStale: false,
      codeMtimeMs: 0,
      firstMtimeMs: 0,
      lastMtimeMs: 0,
      specMtimeMs: 0,
      logicMtimeMs: 0,
      readmeMtimeMs: 0,
      archetype: null,
      builtOn: null,
      version: null,
      description: null,
      listedVersion: null,
    })
  })

  test('a placeholder view lights the reported stage running and leaves the rest pending', () => {
    const facts = placeholderFacts('new-mod')
    expect(facts?.name).toBe('new-mod')
    const spec = viewOf(facts!, {}, [], running('Spec'), false, null, 'mods/new-mod')
    expect(spec.name).toBe('new-mod')
    expect(spec.lights).toEqual(STAGES.map(stage => (stage === 'Spec' ? 'running' : 'pending')))
    const logic = viewOf(facts!, {}, [], running('Logic'), false, null, 'mods/new-mod')
    expect(logic.lights).toEqual(STAGES.map(stage => (stage === 'Logic' ? 'running' : 'pending')))
  })

  test('countsOf counts a placeholder as building', () => {
    const facts = placeholderFacts('new-mod')
    expect(facts?.name).toBe('new-mod')
    const placeholder = viewOf(facts!, {}, [], running('Spec'), false, null, 'mods/new-mod')
    const green = viewOf(FULL, GREEN, [], null, false, null, 'mods/git-branch')
    expect(countsOf([green, placeholder])).toEqual({ mods: 2, green: 1, building: 1, failing: 0, stale: 0 })
    expect(summaryOf(countsOf([green, placeholder]))).toBe('2 mods · 1 green · 1 building')
  })
})

describe('logging and /mod-builder config', () => {
  test('the logging option: four levels, anything else is normal; each level includes the ones above it', () => {
    expect(logLevelOf('verbose')).toBe('verbose')
    expect(logLevelOf(' DEBUG ')).toBe('debug')
    expect(logLevelOf('loud')).toBe('normal')
    expect(logLevelOf(undefined)).toBe('normal')
    expect(shouldLog('off', 'normal')).toBe(false)
    expect(shouldLog('normal', 'normal')).toBe(true)
    expect(shouldLog('normal', 'verbose')).toBe(false)
    expect(shouldLog('verbose', 'verbose')).toBe(true)
    expect(shouldLog('verbose', 'debug')).toBe(false)
    expect(shouldLog('debug', 'debug')).toBe(true)
    expect(shouldLog('debug', 'normal')).toBe(true)
  })

  test('a line: ISO time, padded level, site, one-line message, JSON context cut to its limit', () => {
    const at = Date.parse('2026-10-13T14:02:11.123Z')
    expect(logLineOf(at, 'normal', 'run', 'git-branch Test failed', { durationMs: 900 })).toBe(
      '2026-10-13T14:02:11.123Z NORMAL  run  git-branch Test failed  {"durationMs":900}',
    )
    expect(logLineOf(at, 'verbose', 'scan', 'two\nlines')).toBe('2026-10-13T14:02:11.123Z VERBOSE scan  two ⏎ lines')
    const long = logLineOf(at, 'debug', 'x', 'm', { text: 'a'.repeat(5000) })
    expect(long.length).toBeLessThanOrEqual(80 + LOG_CONTEXT_MAX)
    expect(long.endsWith('…')).toBe(true)
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(logLineOf(at, 'debug', 'x', 'm', cyclic)).toContain('[object Object]')
  })

  test('errors read as name and message; non-errors as text', () => {
    expect(errorText(new TypeError('no implementation for fs.write'))).toBe('TypeError: no implementation for fs.write')
    expect(errorText('ENOENT')).toBe('ENOENT')
    expect(errorText(new Error('a\nb'))).toBe('Error: a ⏎ b')
  })

  test('a caught error repeated at one site is logged once, until that site fails differently', () => {
    const first = isNewCaught({}, 'render.band', 'TypeError: x')
    expect(first.isNew).toBe(true)
    expect(isNewCaught(first.last, 'render.band', 'TypeError: x').isNew).toBe(false)
    expect(isNewCaught(first.last, 'render.band', 'TypeError: y').isNew).toBe(true)
    expect(isNewCaught(first.last, 'tick', 'TypeError: x').isNew).toBe(true)
  })

  test('the buffer keeps the newest lines and says how many it dropped', () => {
    let buffer = EMPTY_LOG
    for (const n of [1, 2, 3, 4]) buffer = pushLine(buffer, `line ${n}`, 3)
    expect(buffer).toEqual({ lines: ['line 2', 'line 3', 'line 4'], dropped: 1 })
    expect(logText(buffer)).toBe('… 1 earlier line dropped\nline 2\nline 3\nline 4\n')
    expect(logText(pushLine(EMPTY_LOG, 'only'))).toBe('only\n')
  })

  test('a reloaded module continues the session file: earlier lines first, the dropped count carried over', () => {
    expect(continueLog('a\nb\n', pushLine(EMPTY_LOG, 'c'))).toEqual({ lines: ['a', 'b', 'c'], dropped: 0 })
    expect(continueLog('… 5 earlier lines dropped\na\nb\n', pushLine(EMPTY_LOG, 'c'), 2)).toEqual({ lines: ['b', 'c'], dropped: 6 })
    expect(continueLog('', pushLine(EMPTY_LOG, 'c'))).toEqual({ lines: ['c'], dropped: 0 })
  })

  test('one log file per session and day, under the data folder', () => {
    const at = Date.parse('2026-10-13T23:59:00Z')
    expect(logFileOf('/home/u', at, 'b48cba1d-4e93-4ff3')).toBe('/home/u/.claude/mod-builder-data/logs/2026-10-13-b48cba1d.log')
    expect(logFileOf('C:\\Users\\u', at, '')).toBe('C:/Users/u/.claude/mod-builder-data/logs/2026-10-13-unknown.log')
    expect(outputTail('a\n\nb\nc\n', 2)).toEqual(['b', 'c'])
  })

  test('/mod-builder config: list, set each option, and say what a bad value should be', () => {
    expect(parseConfigCommand([])).toEqual({ kind: 'list' })
    expect(parseConfigCommand(['list'])).toEqual({ kind: 'list' })
    expect(parseConfigCommand(['logging', 'Verbose'])).toEqual({ kind: 'set', name: 'logging', value: 'verbose' })
    expect(parseConfigCommand(['logging', 'loud'])).toEqual({ kind: 'error', text: 'logging must be one of off · normal · verbose · debug.' })
    expect(parseConfigCommand(['logging'])).toEqual({ kind: 'error', text: 'logging needs a value: off · normal · verbose · debug.' })
    expect(parseConfigCommand(['autorerun', 'off'])).toEqual({ kind: 'set', name: 'autoRerun', value: false })
    expect(parseConfigCommand(['autoOpen', 'yes'])).toEqual({ kind: 'set', name: 'autoOpen', value: true })
    expect(parseConfigCommand(['autoOpen', 'maybe'])).toEqual({ kind: 'error', text: 'autoOpen must be on or off.' })
    expect(parseConfigCommand(['modsDir', '/work', 'mods'])).toEqual({ kind: 'set', name: 'modsDir', value: '/work mods' })
    expect(parseConfigCommand(['modsDir', 'default'])).toEqual({ kind: 'set', name: 'modsDir', value: '' })
    const unknown = parseConfigCommand(['colour', 'red'])
    expect(unknown.kind).toBe('error')
    expect((unknown as { text: string }).text).toStartWith('No option "colour". Options: logging, autoRerun, autoOpen, modsDir, testTimeoutMinutes.')
  })

  test("a /config row is mod-builder's own when its owner is mod-builder or mod-builder@<source>", () => {
    expect(isOwnRow('mod-builder@claudemod', 'mod-builder')).toBe(true)
    expect(isOwnRow('mod-builder@inline', 'mod-builder')).toBe(true)
    expect(isOwnRow('mod-builder', 'mod-builder')).toBe(true)
    expect(isOwnRow('mod-builder-extra@x', 'mod-builder')).toBe(false)
    expect(isOwnRow(undefined, 'mod-builder')).toBe(false)
  })

  test('after a change the listing shows the new value; a reset modsDir shows the real default', () => {
    expect(valuesAfterSet('logging', 'debug', '/p/mods')).toEqual({ logging: 'debug' })
    expect(valuesAfterSet('autoOpen', true, '/p/mods')).toEqual({ autoOpen: true })
    expect(valuesAfterSet('modsDir', '', '/a/b/ClaudeMod/mods')).toEqual({ modsDir: '', modsDirShown: '…/ClaudeMod/mods' })
    expect(valuesAfterSet('modsDir', '/work/x/mods', '/p/mods')).toEqual({ modsDir: '/work/x/mods', modsDirShown: '…/x/mods' })
  })

  test('the listing shows each value and the log file, or why there is none', () => {
    const values = { logging: 'verbose' as const, autoRerun: true, autoOpen: false, modsDir: '', modsDirShown: '…/ClaudeMod/mods', testTimeoutMinutes: 3 }
    const text = configListText(values, '/home/u/.claude/mod-builder-data/logs/2026-10-13-b48cba1d.log')
    expect(text).toContain('logging            verbose')
    expect(text).toContain('autoRerun          on')
    expect(text).toContain('modsDir            default (…/ClaudeMod/mods)')
    expect(text).toContain('Log file: /home/u/.claude/mod-builder-data/logs/2026-10-13-b48cba1d.log')
    expect(configListText({ ...values, logging: 'off' }, '')).toContain('Log file: none (logging is off)')
    expect(configListText(values, '')).toContain('Log file: not written yet this session')
  })
})

describe('runs in flight (PR #55 review)', () => {
  const row = (startedAt: number): Run => ({ mod: 'm', kind: 'Test', startedAt, passed: 0, failed: 0, total: null })

  test('a row older than the time limit plus 30 s lost its run: it no longer counts', () => {
    expect(typeof Logic.liveRuns).toBe('function')
    expect(Logic.RUN_GRACE_MS).toBe(30_000)
    const limit = 60_000
    const rows = [row(0), row(1000)]
    expect(Logic.liveRuns(rows, limit + 30_000, limit)).toEqual(rows)
    expect(Logic.liveRuns(rows, limit + 30_001, limit)).toEqual([row(1000)])
    expect(Logic.liveRuns([], 0, limit)).toEqual([])
  })
})

describe('the time limit, testTimeoutMinutes (PR #55 review)', () => {
  test('a number of minutes above 0, at most ten, in whole milliseconds; anything else is three minutes', () => {
    expect(typeof Logic.runLimitMsOf).toBe('function')
    expect(Logic.runLimitMsOf(5)).toBe(300_000)
    expect(Logic.runLimitMsOf(' 1.5 ')).toBe(90_000)
    expect(Logic.runLimitMsOf(30)).toBe(600_000)
    expect(Logic.runLimitMsOf(1.00001)).toBe(60_001)
    expect(Logic.runLimitMsOf(0.00001)).toBe(1000)
    for (const raw of [undefined, null, 0, -2, Number.NaN, Number.POSITIVE_INFINITY, true, '', 'soon', {}]) expect(Logic.runLimitMsOf(raw)).toBe(180_000)
  })

  test('a check that ran for its whole time limit is over it', () => {
    expect(typeof Logic.isOverLimit).toBe('function')
    expect(Logic.isOverLimit(60_000, 60_000)).toBe(true)
    expect(Logic.isOverLimit(61_000, 60_000)).toBe(true)
    expect(Logic.isOverLimit(59_999, 60_000)).toBe(false)
  })

  test('the timeout summary names the limit in minutes', () => {
    expect(typeof Logic.timeoutText).toBe('function')
    expect(Logic.timeoutText(60_000)).toBe('timed out after 1 minute')
    expect(Logic.timeoutText(180_000)).toBe('timed out after 3 minutes')
    expect(Logic.timeoutText(30_000)).toBe('timed out after 0.5 minutes')
    expect(Logic.timeoutText(60_001)).toBe('timed out after 1 minute')
  })

  test('/mod-builder config takes testTimeoutMinutes: minutes above 0 and at most ten, or default', () => {
    expect(parseConfigCommand(['testTimeoutMinutes', '5'])).toEqual({ kind: 'set', name: 'testTimeoutMinutes', value: 5 } as never)
    expect(parseConfigCommand(['testtimeoutminutes', '1.5'])).toEqual({ kind: 'set', name: 'testTimeoutMinutes', value: 1.5 } as never)
    // default clears the row, as for modsDir, so the manifest's default applies.
    expect(parseConfigCommand(['testTimeoutMinutes', 'Default'])).toEqual({ kind: 'set', name: 'testTimeoutMinutes', value: '' } as never)
    for (const bad of ['0', '-1', '11', 'soon']) {
      expect(parseConfigCommand(['testTimeoutMinutes', bad])).toEqual({ kind: 'error', text: 'testTimeoutMinutes must be a number of minutes above 0, at most 10.' })
    }
    expect(valuesAfterSet('testTimeoutMinutes' as never, 5 as never, '/p/mods')).toEqual({ testTimeoutMinutes: 5 } as never)
    expect(valuesAfterSet('testTimeoutMinutes', '', '/p/mods')).toEqual({ testTimeoutMinutes: 3 })
    // The listing shows the limit in use, rounded as the timeout summary rounds it: 0.001 is the 1 s floor.
    expect(valuesAfterSet('testTimeoutMinutes', 0.001, '/p/mods')).toEqual({ testTimeoutMinutes: 0.02 })
  })

  test('the listing shows the time limit, and its name column fits the longest name', () => {
    const values = { logging: 'normal' as const, autoRerun: true, autoOpen: false, modsDir: '', modsDirShown: '…/ClaudeMod/mods', testTimeoutMinutes: 1 }
    const text = configListText(values, '')
    expect(text).toContain('  testTimeoutMinutes 1 minute ')
    expect(text).toContain('  logging            normal')
  })
})

describe('a run that does not end well (PR #55 review)', () => {
  test('a run that threw before its result was stored: the toast names the check and the error', () => {
    expect(typeof Logic.toastOfRunError).toBe('function')
    expect(Logic.toastOfRunError('m', 'Typecheck', new Error('EIO'))).toBe('✕ m: Type-check stopped before its result was saved (Error: EIO)')
    expect(Logic.toastOfRunError('m', 'Test', 'x'.repeat(300))).toBe(`✕ m: Test stopped before its result was saved (${'x'.repeat(119)}…)`)
  })

  test('a run still has its row only while one with its mod, kind and start is in runs', () => {
    expect(typeof Logic.hasRun).toBe('function')
    const row = (startedAt: number): Run => ({ mod: 'm', kind: 'Test', startedAt, passed: 0, failed: 0, total: null })
    expect(Logic.hasRun([row(5), row(9)], row(5))).toBe(true)
    expect(Logic.hasRun([row(9)], row(5))).toBe(false)
    expect(Logic.hasRun([{ ...row(5), kind: 'Validate' }], row(5))).toBe(false)
    expect(Logic.hasRun([{ ...row(5), mod: 'n' }], row(5))).toBe(false)
  })

  test('streamed progress lands on its own run, not on a newer run of the same check', () => {
    expect(typeof Logic.withProgress).toBe('function')
    const row = (startedAt: number): Run => ({ mod: 'm', kind: 'Test', startedAt, passed: 0, failed: 0, total: null })
    const other: Run = { ...row(5), kind: 'Validate' }
    expect(Logic.withProgress([row(5), row(9), other], row(5), { passed: 2, failed: 1 })).toEqual([{ ...row(5), passed: 2, failed: 1 }, row(9), other])
  })
})

describe('a streamed test run keeps bounded output (#9, Codex P2 on PR #65)', () => {
  const feed = (text: string, size: number): TestStream => {
    let s = EMPTY_STREAM
    for (let at = 0; at < text.length; at += size) s = streamPiece(s, text.slice(at, at + size))
    return s
  }
  const noise = Array.from({ length: 10_000 }, (_, i) => `log line ${i} ${'x'.repeat(200)}`).join('\n')

  test('fed in pieces of any size, it counts and judges as the whole output does', () => {
    for (const whole of [testPass, testFail]) {
      for (const size of [1, 3, 7, 64, whole.length]) {
        const s = feed(whole, size)
        expect({ passed: s.passed, failed: s.failed }).toEqual(countStreamed(whole))
        expect(parseTest(streamOutput(s), 1)).toEqual(parseTest(whole, 1))
      }
    }
  })

  test('megabytes of printing between tests keep the output small, and the summary and failure still parse', () => {
    const whole = testFail.replace('(pass) try-notes-logic > lists', `${noise}\n(pass) try-notes-logic > lists`)
    expect(whole.length).toBeGreaterThan(2_000_000)
    const s = feed(whole, 16_384)
    expect(200_000).toBeGreaterThan(streamOutput(s).length)
    expect({ passed: s.passed, failed: s.failed }).toEqual({ passed: 3, failed: 1 })
    expect(parseTest(streamOutput(s), 1)).toEqual(parseTest(whole, 1))
  })

  test('a line that never ends keeps the output small', () => {
    let s = EMPTY_STREAM
    for (let i = 0; i < 256; i += 1) s = streamPiece(s, 'y'.repeat(16_384))
    expect(200_000).toBeGreaterThan(streamOutput(s).length)
    s = streamPiece(s, `\n${testPass}`)
    expect(200_000).toBeGreaterThan(streamOutput(s).length)
    expect(parseTest(streamOutput(s), 0)).toMatchObject({ ok: true, passed: 4, failed: 0 })
  })

  test('stderr printing that arrives after the stdout summary keeps the summary (found live: "0 tests passed")', () => {
    let s = EMPTY_STREAM
    s = streamPiece(s, testPass, 'stdout')
    for (let at = 0; at < noise.length; at += 16_384) s = streamPiece(s, noise.slice(at, at + 16_384), 'stderr')
    expect(200_000).toBeGreaterThan(streamOutput(s).length)
    expect(parseTest(streamOutput(s), 0)).toEqual(parseTest(testPass, 0))
  })

  test('a stderr piece cut mid-line does not join the stdout line after it', () => {
    let s = EMPTY_STREAM
    s = streamPiece(s, 'noise without its end', 'stderr')
    s = streamPiece(s, '(pass) t > one [1.00ms]\n', 'stdout')
    s = streamPiece(s, ' still noise\n', 'stderr')
    expect({ passed: s.passed, failed: s.failed }).toEqual({ passed: 1, failed: 0 })
  })

  test('many failures among the noise: the first ones, which a result shows, are kept with their detail', () => {
    const fails = Array.from({ length: 40 }, (_, i) => `(fail) t > case ${i} [1.00ms]\n  AssertionError: case ${i}`).join('\n')
    const whole = `${fails}\n${noise}\n\n 0 pass\n 40 fail\nRan 40 tests across 1 file. [0.50s]\n`
    const s = feed(whole, 16_384)
    expect(200_000).toBeGreaterThan(streamOutput(s).length)
    expect(s.failed).toBe(40)
    expect(parseTest(streamOutput(s), 1)).toEqual(parseTest(whole, 1))
    expect(parseTest(streamOutput(s), 1).failures[1]).toBe('  AssertionError: case 0')
  })
})

describe('a build names its folder, and the session keeps it (#92)', () => {
  const running = { stage: 'Logic', status: 'running' } as const

  test('reportOf: a path gives the folder above it, normalized', () => {
    expect(reportOf({ mod: 'foo', ...running, path: 'C:\\x\\mods\\foo' }, 5)).toEqual({ mod: 'foo', report: { ...running, since: 5 }, dir: 'C:/x/mods' })
    expect(reportOf({ mod: 'foo', ...running, path: '/r/mods/foo/' }, 5)).toEqual({ mod: 'foo', report: { ...running, since: 5 }, dir: '/r/mods' })
    expect(reportOf({ mod: 'foo', ...running, path: '/r/wt/../mods/./foo' }, 5)).toEqual({ mod: 'foo', report: { ...running, since: 5 }, dir: '/r/mods' })
  })

  test('reportOf: a relative, non-string or misnamed path is ignored, and the report kept; no path is unchanged', () => {
    const kept = { mod: 'foo', report: { ...running, since: 5 } }
    const notAbsolute = { ...kept, pathIgnored: "path must be the absolute path of the mod's folder" }
    expect(reportOf({ mod: 'foo', ...running, path: 'mods/foo' }, 5)).toEqual(notAbsolute)
    expect(reportOf({ mod: 'foo', ...running, path: '' }, 5)).toEqual(notAbsolute)
    expect(reportOf({ mod: 'foo', ...running, path: 42 }, 5)).toEqual(notAbsolute)
    expect(reportOf({ mod: 'foo', ...running, path: '/r/mods/bar' }, 5)).toEqual({ ...kept, pathIgnored: "path must end with the mod's folder name, foo" })
    expect(reportOf({ mod: 'foo', ...running }, 5)).toEqual(kept)
  })

  test('the config listing names a build\'s kept folder while modsDir is empty (PR #95 review)', () => {
    const values = { logging: 'normal' as const, autoRerun: true, autoOpen: false, modsDir: '', modsDirShown: '…/main/mods', testTimeoutMinutes: 3 }
    expect(configListText({ ...values, pinnedShown: '…/wt/mods' }, '')).toContain("modsDir            a build's folder (…/wt/mods)")
    expect(configListText({ ...values, modsDir: '/my/mods', modsDirShown: '…/my/mods', pinnedShown: '…/wt/mods' }, '')).toContain('modsDir            …/my/mods')
    expect(configListText(values, '')).toContain('modsDir            default (…/main/mods)')
  })

  test('watchedDirOf: with no marketplace above the root, the walk starts from the working directory (PR #95 review)', () => {
    const both = ['/w/main/.claude-plugin/marketplace.json', '/w/main/scratch/wt/.claude-plugin/marketplace.json']
    // A session started in a parent folder, and Claude cd'd into a worktree.
    expect(watchedDirOf(null, '/home/u', '', '/w/main/scratch/wt', both, '/p/mods')).toEqual({ dir: '/w/main/scratch/wt/mods', pin: null })
    expect(watchedDirOf(null, '/home/u', '', '/elsewhere', both, '/p/mods')).toEqual({ dir: '/p/mods', pin: null })
  })

  test('reportIn: a row takes a report made in its own folder, or one with no folder (PR #95 review)', () => {
    const report = { stage: 'Logic' as const, status: 'running' as const, since: 1 }
    expect(reportIn({ ...report, dir: '/w/main/mods' }, '/w/main/mods')).toEqual({ ...report, dir: '/w/main/mods' })
    expect(reportIn({ ...report, dir: '/w/main/scratch/wt/mods' }, '/w/main/mods')).toBeNull()
    expect(reportIn(report, '/w/main/mods')).toEqual(report)
    expect(reportIn(undefined, '/w/main/mods')).toBeNull()
  })

  test('roots on a drive or UNC share compare without case; POSIX roots with it (PR #95 review, Codex P2)', () => {
    const drive = { modsDir: 'C:/Users/Me/repo/scratch/wt/mods', root: 'C:/Users/Me/repo' }
    expect(watchedDirOf(drive, 'C:/users/me/repo', '', null, [], '/p/mods')).toEqual({ dir: drive.modsDir, pin: drive })
    const share = { modsDir: '//Server/Share/repo/wt/mods', root: '//Server/Share/repo' }
    expect(watchedDirOf(share, '//server/share/REPO', '', null, [], '/p/mods')).toEqual({ dir: share.modsDir, pin: share })
    const posix = { modsDir: '/w/Main/scratch/wt/mods', root: '/w/Main' }
    expect(watchedDirOf(posix, '/w/main', '', null, [], '/p/mods')).toEqual({ dir: '/p/mods', pin: null })
  })

  test('pinCheckOf: a marketplace\'s mods folder, inside or outside the project root, passes this check (PR #95 review)', () => {
    expect(pinCheckOf('/w/main/scratch/wt/mods', '/w/main')).toEqual({ marketplace: '/w/main/scratch/wt/.claude-plugin/marketplace.json', root: '/w/main' })
    expect(pinCheckOf('/w/main/mods', '/w/main/')).toEqual({ marketplace: '/w/main/.claude-plugin/marketplace.json', root: '/w/main' })
    expect(pinCheckOf('C:/r/wt/mods', 'C:\\r')).toEqual({ marketplace: 'C:/r/wt/.claude-plugin/marketplace.json', root: 'C:/r' })
    expect(pinCheckOf('/w/mods', '/')).toEqual({ marketplace: '/w/.claude-plugin/marketplace.json', root: '/' })
  })

  test('pinCheckOf: no root, or a folder not named mods, is refused (PR #95 review)', () => {
    expect(pinCheckOf('/w/main/scratch/wt/mods', null)).toEqual({ reason: "the project root can't be read" })
    expect(pinCheckOf('/w/sib/mods', '/w/main')).toEqual({ marketplace: '/w/sib/.claude-plugin/marketplace.json', root: '/w/main' })
    expect(pinCheckOf('/w/main/scratch/wt/plugins', '/w/main')).toEqual({ reason: "/w/main/scratch/wt/plugins isn't a marketplace's mods folder" })
  })

  test('gitCommonDirOf: a repository top, a worktree (absolute or relative gitdir), a submodule; nothing else (PR #95 review follow-up)', () => {
    expect(gitCommonDirOf('/w/main', { kind: 'dir' })).toBe('/w/main/.git')
    expect(gitCommonDirOf('/w/main/scratch/wt', { kind: 'file', text: 'gitdir: /w/main/.git/worktrees/wt\n' })).toBe('/w/main/.git')
    expect(gitCommonDirOf('/w/sib', { kind: 'file', text: 'gitdir: /w/main/.git/worktrees/sib\r\n' })).toBe('/w/main/.git')
    expect(gitCommonDirOf('/w/main/scratch/wt', { kind: 'file', text: 'gitdir: ../../.git/worktrees/wt' })).toBe('/w/main/.git')
    // A submodule's git folder is its own repository's.
    expect(gitCommonDirOf('/w/main/sub', { kind: 'file', text: 'gitdir: ../.git/modules/sub\n' })).toBe('/w/main/.git/modules/sub')
    expect(gitCommonDirOf('/w/main/tmp/copy', null)).toBeNull()
    expect(gitCommonDirOf('/w/x', { kind: 'file', text: 'not a gitdir line' })).toBeNull()
  })

  test('isSameRepo: one common git folder, without case on a drive or UNC share; unknown is never the same (PR #95 review follow-up)', () => {
    expect(isSameRepo('/w/main/.git', '/w/main/.git/')).toBe(true)
    expect(isSameRepo('C:/Users/Me/repo/.git', 'C:/users/me/repo/.git')).toBe(true)
    expect(isSameRepo('/w/Main/.git', '/w/main/.git')).toBe(false)
    expect(isSameRepo('/w/main/tmp/clone/.git', '/w/main/.git')).toBe(false)
    expect(isSameRepo(null, '/w/main/.git')).toBe(false)
    expect(isSameRepo(null, null)).toBe(false)
  })

  test('worktreeLinkOf: a worktree pointer names git\'s record of it; a repository top or a submodule has none (PR #95 review follow-up)', () => {
    expect(worktreeLinkOf('/w/main/scratch/wt', { kind: 'file', text: 'gitdir: /w/main/.git/worktrees/wt\n' })).toEqual({ record: '/w/main/.git/worktrees/wt/gitdir' })
    expect(worktreeLinkOf('/w/main/scratch/wt', { kind: 'file', text: 'gitdir: ../../.git/worktrees/wt' })).toEqual({ record: '/w/main/.git/worktrees/wt/gitdir' })
    expect(worktreeLinkOf('/w/main', { kind: 'dir' })).toBeNull()
    expect(worktreeLinkOf('/w/main/sub', { kind: 'file', text: 'gitdir: ../.git/modules/sub\n' })).toBeNull()
    expect(worktreeLinkOf('/w/main/tmp/copy', null)).toBeNull()
  })

  test('isBackLinkTo: git\'s record must name this folder\'s .git, absolute or relative to the record (PR #95 review follow-up)', () => {
    const record = '/w/main/.git/worktrees/wt/gitdir'
    expect(isBackLinkTo('/w/main/scratch/wt', record, '/w/main/scratch/wt/.git\n')).toBe(true)
    expect(isBackLinkTo('/w/main/scratch/wt', record, '../../../scratch/wt/.git\r\n')).toBe(true)
    expect(isBackLinkTo('C:/r/wt', 'C:/r/.git/worktrees/wt/gitdir', 'C:/R/WT/.git')).toBe(true)
    expect(isBackLinkTo('/w/main/tmp/forged', record, '/w/main/scratch/wt/.git\n')).toBe(false)
    expect(isBackLinkTo('/w/main/scratch/wt', record, '')).toBe(false)
  })

  test('pinOf: a stored pin needs a folder and a root (PR #95 review)', () => {
    expect(pinOf({ modsDir: '/w/wt/mods', root: '/w' })).toEqual({ modsDir: '/w/wt/mods', root: '/w' })
    expect(pinOf({ modsDir: '/w/wt/mods', root: null })).toBeNull()
    expect(pinOf({ modsDir: 3, root: '/w' })).toBeNull()
    expect(pinOf(null)).toBeNull()
  })

  test('REPORT_SCHEMA lists path, and is still closed to other keys', () => {
    expect((REPORT_SCHEMA.properties as Record<string, { type?: string }>).path?.type).toBe('string')
    expect(REPORT_SCHEMA.additionalProperties).toBe(false)
    expect([...REPORT_SCHEMA.required]).toEqual(['mod', 'stage', 'status'])
  })

  test('watchedDirOf: a pin wins over the walk while the root is its own or unknown; a set modsDir wins over the pin', () => {
    const pin = { modsDir: '/w/main/scratch/wt/mods', root: '/w/main' }
    const main = ['/w/main/.claude-plugin/marketplace.json']
    expect(watchedDirOf(pin, '/w/main', '/chosen/mods', '/w/main/x', main, '/p/mods')).toEqual({ dir: '/chosen/mods', pin })
    expect(watchedDirOf(pin, '/w/main/', '', '/w/main/x', main, '/p/mods')).toEqual({ dir: '/w/main/scratch/wt/mods', pin })
    expect(watchedDirOf(pin, null, '', '/w/main/x', main, '/p/mods')).toEqual({ dir: '/w/main/scratch/wt/mods', pin })
  })

  test('watchedDirOf: a changed root drops the pin, and modsDir or the walk decides', () => {
    const pin = { modsDir: '/w/main/scratch/wt/mods', root: '/w/main' }
    expect(watchedDirOf(pin, '/w/two', '', '/w/two', ['/w/two/.claude-plugin/marketplace.json'], '/p/mods')).toEqual({ dir: '/w/two/mods', pin: null })
    expect(watchedDirOf(pin, '/w/two', '/chosen/mods', '/w/two', [], '/p/mods')).toEqual({ dir: '/chosen/mods', pin: null })
  })

  test('watchedDirOf: with no pin the walk starts from the root, else from the working directory', () => {
    const both = ['/w/main/.claude-plugin/marketplace.json', '/w/main/scratch/wt/.claude-plugin/marketplace.json']
    // A Bash cd moved the working directory into the worktree; the root stayed.
    expect(watchedDirOf(null, '/w/main', '', '/w/main/scratch/wt', both, '/p/mods')).toEqual({ dir: '/w/main/mods', pin: null })
    expect(watchedDirOf(null, null, '', '/w/main/scratch/wt', both, '/p/mods')).toEqual({ dir: '/w/main/scratch/wt/mods', pin: null })
    expect(watchedDirOf(null, '/w/main', '/chosen/mods', '/w/main/scratch/wt', both, '/p/mods')).toEqual({ dir: '/chosen/mods', pin: null })
    expect(watchedDirOf(null, null, '', null, both, '/p/mods')).toEqual({ dir: '/p/mods', pin: null })
  })
})

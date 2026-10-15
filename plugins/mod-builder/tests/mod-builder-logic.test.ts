import { describe, expect, test } from 'claude-code/testing'

import {
  argvOf,
  badgeOf,
  bandEntriesOf,
  barOf,
  clockOf,
  countsOf,
  countStreamed,
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
    const view = (lights: ModView['lights']): ModView => ({ ...viewOf(EMPTY, {}, [], null, false, null, null, 'mods/git-branch'), lights })
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
    expect(viewOf(FULL, GREEN, [], null, true, null, null, '/work/mods/git-branch').path).toBe('/work/mods/git-branch/')
    expect(viewOf(FULL, {}, [], null, false, null, null, 'other/git-branch').path).toBe('other/git-branch/')
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

  test('view: fresh green mods are ready to share with a done line; others are quiet', () => {
    const freshView = viewOf(FULL, GREEN, [], null, true, null, null, 'mods/git-branch')
    expect(freshView).toMatchObject({ status: 'ready to share', isFresh: true, doneLine: '8/8 stages · 12 tests · validate clean', version: '0.1.0', path: 'mods/git-branch/', time: '0:03' })
    expect(viewOf(FULL, GREEN, [], null, false, null, null, 'mods/git-branch')).toMatchObject({ status: '12 tests · clean', isFresh: false, doneLine: null })
    expect(viewOf(FULL, {}, [], null, true, null, null, 'mods/git-branch').isFresh).toBe(false)
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
    const view = viewOf(FULL, {}, [], null, false, null, null, 'mods/git-branch')
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
    expect(lightsOf(built, ran, [], null, 1000)).toEqual(['stale', 'passed', 'stale', 'passed', 'stale', 'stale', 'stale', 'stale'])
    const redone: FileFacts = { ...built, specMtimeMs: 1100, logicMtimeMs: 1200, readmeMtimeMs: 1300, codeMtimeMs: 1200, listedVersion: '0.2.0' }
    const rerun: Results = {
      Validate: { ...ran.Validate!, stampMs: 1200, atMs: 1400 },
      Test: { ...ran.Test!, stampMs: 1200, atMs: 1450 },
    }
    expect(isGreen(lightsOf(redone, rerun, [], null, 1000))).toBe(true)
    expect(statusOf(lightsOf(built, ran, [], null, 1000), ran, null, [], false)).toEqual({ text: 'edit · update Spec for this change', tone: 'warn' })
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

  test('during an edit, Share needs a version different from the one the edit started from', () => {
    const listed: FileFacts = { ...FULL, version: '0.1.0', listedVersion: '0.1.0' }
    expect(lightsOf(listed, {}, [], null, 1000, '0.1.0')[7]).toBe('stale')
    expect(lightsOf({ ...listed, version: '0.2.0', listedVersion: '0.2.0' }, {}, [], null, 1000, '0.1.0')[7]).toBe('passed')
    expect(lightsOf({ ...listed, version: '0.2.0', listedVersion: '0.1.0' }, {}, [], null, 1000, '0.1.0')[7]).toBe('stale')
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
    expect((unknown as { text: string }).text).toStartWith('No option "colour". Options: logging, autoRerun, autoOpen, modsDir.')
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
    const values = { logging: 'verbose' as const, autoRerun: true, autoOpen: false, modsDir: '', modsDirShown: '…/ClaudeMod/mods' }
    const text = configListText(values, '/home/u/.claude/mod-builder-data/logs/2026-10-13-b48cba1d.log')
    expect(text).toContain('logging    verbose')
    expect(text).toContain('autoRerun  on')
    expect(text).toContain('modsDir    default (…/ClaudeMod/mods)')
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

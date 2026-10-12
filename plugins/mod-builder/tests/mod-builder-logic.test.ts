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
  legendOf,
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
} from '../hooks/mod-builder-logic'
import { testFail } from './fixtures/test-fail'
import { testPass } from './fixtures/test-pass'
import { validateClean } from './fixtures/validate-clean'
import { validateMissing } from './fixtures/validate-missing'

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
  firstMtimeMs: 0,
  lastMtimeMs: 42_000,
  archetype: null,
  builtOn: null,
  version: null,
  description: null,
  isReadmeStale: false,
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
    const view = (lights: ModView['lights']): ModView => ({ ...viewOf(EMPTY, {}, [], null, false), lights })
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

  test('lights animate in three frames; the legend lights the pair under the running light', () => {
    expect([0, 1, 2, 3].map(frame => lightMarkOf('running', frame))).toEqual([
      { text: '◐', tone: 'accent', bold: true },
      { text: '◐', tone: 'accent', dim: true },
      { text: '○', tone: 'accent', bold: true },
      { text: '◐', tone: 'accent', bold: true },
    ])
    expect(lightMarkOf('failed')).toEqual({ text: '✕', tone: 'error', bold: true })
    const legend = legendOf(['passed', 'passed', 'passed', 'passed', 'running', 'pending', 'pending', 'pending'])
    expect(legend.map(m => m.text).join('')).toBe('SpScLoReVaTeRESh')
    expect(legend[4]).toEqual({ text: 'Va', tone: 'accent' })
    expect(legend[1]).toEqual({ text: 'Sc', tone: 'dim', dim: true })
  })

  test('track connectors: ━ after passed, animated after running, ┄ ahead', () => {
    const track = trackOf(['passed', 'passed', 'passed', 'passed', 'running', 'pending', 'pending', 'pending'], 1)
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
    const text = fixPromptOf('inbox-zero', 'Test', ['archives threads older than 30 days', '  expected 3 archived, received 0', '  at test/archive.test.ts:42:7'], 2)
    expect(text).toBe(
      'Fix the 2 failing tests in mods/inbox-zero. First failure, from Mod Lab:\n' +
        '    ✕ archives threads older than 30 days\n' +
        '      expected 3 archived, received 0\n' +
        '      at test/archive.test.ts:42:7\n' +
        'Then re-run Test.',
    )
    expect(fixPromptOf('x', 'Validate', ['oops'])).toStartWith('Fix the Validate problem in mods/x.')
    const withGates: Results = { ...GREEN, Validate: { ...GREEN.Validate!, validate: { ok: true, hooks: [], calls: [], gates: [{ hook: 'tool.call', hasCatch: true }], errors: [], warnings: [] } } }
    expect(doneLineOf(withGates)).toBe('8/8 stages · 12 tests · validate clean · 1 gate')
  })

  test('view: fresh green mods are ready to share with a done line; others are quiet', () => {
    const freshView = viewOf(FULL, GREEN, [], null, true)
    expect(freshView).toMatchObject({ status: 'ready to share', isFresh: true, doneLine: '8/8 stages · 12 tests · validate clean', version: '0.1.0', path: 'mods/git-branch/', time: '0:03' })
    expect(viewOf(FULL, GREEN, [], null, false)).toMatchObject({ status: '12 tests · clean', isFresh: false, doneLine: null })
    expect(viewOf(FULL, {}, [], null, true).isFresh).toBe(false)
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
    const view = viewOf(FULL, {}, [], null, false)
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
})

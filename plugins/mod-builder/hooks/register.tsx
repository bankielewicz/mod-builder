import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { ModView, Run, RunKind } from '../types'
import * as Lab from './mod-builder-logic'

/**
 * Mod Lab: the showcase half of mod-builder. Every `$` call lives here; every
 * rule it applies lives in mod-builder-logic.ts. The drawing follows the
 * Claude Design mockups in design/ (frames 1a–5b).
 *
 * `/modlab` opens a pane of the mods under the mods folder, each with eight
 * stage lights judged from disk and exit codes. Buttons run validate, test and
 * tsc; the band, the status line, toasts and a notification report runs; the
 * model's `lab_report` tool lights the stage it is working on; `/modlab demo`
 * walks a pretend build through every state.
 */

const PANE = 'modlab'
const TOOL = 'lab_report'
const RESULTS_KEY = 'modlab:results'
const DONE_KEY = 'modlab:done'
const GENERATIONS_KEY = 'modlab:generations'
const FRAME_MS = 250
const NAME_COLUMN = 18
const LABEL_COLUMN = 11
const NARROW_TOAST = '◆ Mod Lab needs a wider window. Widen it, or watch the status line.'

/** The design's colour roles; `text` is the surface's own foreground. */
const COLOR: Record<Lab.Tone, string | undefined> = {
  accent: '#D97757',
  success: '#7FB685',
  warn: '#E0B15A',
  error: '#E06C6C',
  dim: '#8A8580',
  text: undefined,
}
const BACKGROUND = '#1A1918'
const HOVER = '#2C2A27'

const views = atom({ plugin: 'mod-builder', key: 'views' } as const, [])
const selected = atom({ plugin: 'mod-builder', key: 'selected' } as const, null)
const runs = atom({ plugin: 'mod-builder', key: 'runs' } as const, [])
const reported = atom({ plugin: 'mod-builder', key: 'reported' } as const, {})
const frame = atom({ plugin: 'mod-builder', key: 'frame' } as const, { n: 0, now: 0 })
const demoStartedAt = atom({ plugin: 'mod-builder', key: 'demoStartedAt' } as const, null)
const readme = atom({ plugin: 'mod-builder', key: 'readme' } as const, null)
const fresh = atom({ plugin: 'mod-builder', key: 'fresh' } as const, [])
const hasWarnedNarrow = atom({ plugin: 'mod-builder', key: 'hasWarnedNarrow' } as const, false)

type Engine = EngineInterface
type StoredResults = Record<string, Lab.Results>

// Module state: options, timer handles and in-flight guards only. A reload
// starts it afresh; what must survive lives in atoms and $.store.
let configuredDir = ''
let autoOpen = false
let autoRerun = true
let clock: Timer | null = null
let lastTickMs = 0
let scanning: Promise<void> | null = null
let isScanQueued = false
let isQueuedAnnounced = false
const factsByMod = new Map<string, Lab.FileFacts>()
// Logging (Change 0.2.2): the level, this session's lines, its file once known, and writes in order.
let logLevel: Lab.LogLevel = 'normal'
let logBuffer: Lab.LogBuffer = Lab.EMPTY_LOG
let logFile = ''
let logChain: Promise<void> = Promise.resolve()
let flushTimer: Timer | null = null
let lastCaught: Record<string, string> = {}
let writtenSig = ''
let hasReportedWriteFailure = false

// Every function that takes `$` is declared here, at the top of the file: the
// engine follows `$` only into functions it can see at this level.

// ── Logging ───────────────────────────────────────────────────────────────

/**
 * Records one line when the `logging` level allows it: into this session's
 * buffer, the debug log, and the log file (at once for `normal` lines, else
 * LOG_FLUSH_MS after the last). Logging never throws into Mod Lab.
 */
function logEvent($: Engine, level: Lab.LineLevel, site: string, message: string, context?: unknown): void {
  if (!Lab.shouldLog(logLevel, level)) return
  try {
    const line = Lab.logLineOf(Date.now(), level, site, message, context)
    logBuffer = Lab.pushLine(logBuffer, line)
    $.ui.log(line, { to: 'debug' })
    if (level === 'normal') {
      flushTimer?.cancel()
      flushTimer = null
      void flushLog($)
    } else scheduleFlush($)
  } catch {
    // A line that can't be recorded is dropped; Mod Lab carries on.
  }
}

/** A caught error, logged where it was caught; `normal` unless the miss is expected. Repeats at one site are logged once. */
function logCaught($: Engine, site: string, error: unknown, level: Lab.LineLevel = 'normal', context?: unknown): void {
  const message = Lab.errorText(error)
  if (level === 'normal') {
    const seen = Lab.isNewCaught(lastCaught, site, message)
    lastCaught = seen.last
    if (!seen.isNew) return
  }
  logEvent($, level, site, message, context)
}

function scheduleFlush($: Engine): void {
  if (flushTimer) return
  try {
    flushTimer = $.clock.after(Lab.LOG_FLUSH_MS, () => {
      flushTimer = null
      void flushLog($)
    })
  } catch {
    flushTimer = null
  }
}

/** Writes the buffer to this session's log file; writes run one at a time. A failed write is noted once in the debug log. */
function flushLog($: Engine): Promise<void> {
  logChain = logChain
    .then(() => writeLog($))
    .catch((error: unknown) => {
      if (hasReportedWriteFailure) return
      hasReportedWriteFailure = true
      try {
        $.ui.log(`mod-builder: could not write its log ${logFile}: ${Lab.errorText(error)}`, { to: 'debug' })
      } catch {
        // Nothing more can be done.
      }
    })
  return logChain
}

async function writeLog($: Engine): Promise<void> {
  if (logLevel === 'off' || (logBuffer.lines.length === 0 && logBuffer.dropped === 0)) return
  if (!logFile) {
    const home = (await $.env.get('HOME')) || (await $.env.get('USERPROFILE')) || ''
    if (!home) return
    // A session whose id can't be read gets its own name, never a file other sessions share.
    const sessionId = await $.session.id().catch(() => `x${Date.now().toString(36)}`)
    const file = Lab.logFileOf(home, Date.now(), sessionId)
    // After a reload this module starts empty: continue the session's file rather than replace it.
    // A file that exists but can't be read is left alone; the next flush tries again.
    if (await $.fs.exists(file)) {
      const earlier = String(await $.fs.read(file))
      logBuffer = Lab.continueLog(earlier, logBuffer)
    }
    logFile = file
  }
  const text = Lab.logText(logBuffer)
  const sig = `${logBuffer.dropped}:${logBuffer.lines.length}:${logBuffer.lines.at(-1) ?? ''}`
  if (sig === writtenSig) return
  await $.fs.write(logFile, text)
  writtenSig = sig
}

const modsDirOf = ($: Engine): string => Lab.normalizePath(configuredDir || `${$.plugin.root}/../../mods`)

const list = ($: Engine, path: string): Promise<Lab.Entry[]> =>
  $.fs
    .list(path)
    .then(entries => entries.map(({ name, kind, mtimeMs }) => ({ name, kind, mtimeMs })))
    .catch((error: unknown) => {
      logCaught($, 'fs.list', error, 'debug', { path })
      return []
    })

const readText = ($: Engine, path: string): Promise<string | null> =>
  $.fs.read(path).catch((error: unknown) => {
    logCaught($, 'fs.read', error, 'debug', { path })
    return null
  })

/**
 * The files in `folder`'s subfolders (from its `entries`), up to `depth` levels down, named by
 * their path from the mod folder `at`. Sibling folders are listed at once, since /mnt/c is slow;
 * dot-folders and node_modules are skipped.
 */
async function nestedFiles($: Engine, at: string, folder: string, entries: readonly Lab.Entry[], depth = 3): Promise<Lab.Entry[]> {
  if (depth === 0) return []
  const subfolders = entries.filter(entry => entry.kind === 'dir' && !entry.name.startsWith('.') && entry.name !== 'node_modules')
  const found = await Promise.all(
    subfolders.map(async sub => {
      const path = `${folder}/${sub.name}`
      const inner = await list($, `${at}/${path}`)
      const files = inner.filter(entry => entry.kind === 'file').map(entry => ({ ...entry, name: `${path}/${entry.name}` }))
      return [...files, ...(await nestedFiles($, at, path, inner, depth - 1))]
    }),
  )
  return found.flat()
}

const resultsOf = async ($: Engine): Promise<StoredResults> =>
  ((await $.store.get(RESULTS_KEY)) ?? {}) as StoredResults

/** When each mod's current edit started (a build generation), for mods being edited. */
type Generation = { since: number; fromVersion: string | null }
const generationsOf = async ($: Engine): Promise<Record<string, Generation>> =>
  Object.fromEntries(
    Object.entries(((await $.store.get(GENERATIONS_KEY)) ?? {}) as Record<string, number | Generation>).map(([mod, gen]) => [
      mod,
      typeof gen === 'number' ? { since: gen, fromVersion: null } : gen,
    ]),
  )

// ── Scanning ──────────────────────────────────────────────────────────────

/**
 * Reads every mod folder, judges it and redraws. Single-flight: a call during
 * a scan queues one more pass, and every caller waits until the passes end,
 * so what it reads afterwards reflects the disk as of its call.
 */
function scan($: Engine, isAnnounced: boolean): Promise<void> {
  if (scanning) {
    isScanQueued = true
    isQueuedAnnounced ||= isAnnounced
    return scanning
  }
  scanning = scanPasses($, isAnnounced).finally(() => {
    scanning = null
  })
  return scanning
}

async function scanPasses($: Engine, isAnnounced: boolean): Promise<void> {
  let announce = isAnnounced
  do {
    isScanQueued = false
    await scanOnce($, announce)
    announce = isQueuedAnnounced
    isQueuedAnnounced = false
  } while (isScanQueued)
}

async function scanOnce($: Engine, isAnnounced: boolean): Promise<void> {
  const scanStartedAt = Date.now()
  const dir = modsDirOf($)
  const folders = (await list($, dir)).filter(entry => entry.kind === 'dir' && !entry.name.startsWith('.'))
  const marketplace = (await readText($, `${dir}/../.claude-plugin/marketplace.json`)) ?? ''
  const results = await resultsOf($)
  const generations = await generationsOf($)
  const inFlight = await read($, runs)
  const reports = Lab.liveReports(await read($, reported), await $.clock.now())
  factsByMod.clear()
  for (const folder of folders) {
    const at = `${dir}/${folder.name}`
    const top = await list($, at)
    const has = (name: string): boolean => top.some(entry => entry.name === name)
    const [manifestDir, hooks, tests, types] = await Promise.all([
      has('.claude-plugin') ? list($, `${at}/.claude-plugin`) : Promise.resolve([]),
      has('hooks') ? list($, `${at}/hooks`) : Promise.resolve([]),
      has('tests') ? list($, `${at}/tests`) : Promise.resolve([]),
      has('types') ? list($, `${at}/types`) : Promise.resolve([]),
    ])
    const nested = await Promise.all([
      nestedFiles($, at, 'hooks', hooks),
      nestedFiles($, at, 'tests', tests),
      nestedFiles($, at, 'types', types),
    ])
    const facts = Lab.factsOf({
      name: folder.name,
      top,
      manifestDir,
      hooks,
      tests,
      types,
      nested: nested.flat(),
      spec: has('SPEC.md') ? await readText($, `${at}/SPEC.md`) : null,
      readme: has('README.md') ? await readText($, `${at}/README.md`) : null,
      manifest: manifestDir.some(entry => entry.name === 'plugin.json')
        ? await readText($, `${at}/.claude-plugin/plugin.json`)
        : null,
      marketplace,
    })
    if (facts) factsByMod.set(facts.name, facts)
  }
  const judge = (freshNames: readonly string[]): ModView[] =>
    [...factsByMod.values()].map(facts =>
      Lab.viewOf(
        facts,
        results[facts.name] ?? {},
        inFlight.filter(one => one.mod === facts.name),
        reports[facts.name] ?? null,
        freshNames.includes(facts.name),
        generations[facts.name]?.since ?? null,
        generations[facts.name]?.fromVersion ?? null,
      ),
    )
  const newlyGreen = await announceGreen($, judge([]), isAnnounced)
  const freshNames = [...new Set([...(await read($, fresh)), ...newlyGreen])]
  if (newlyGreen.length) await update($, fresh, () => freshNames)
  const next = judge(freshNames)
  // An edit's generation ends when every stage is green again.
  const finished = next.filter(view => Lab.isGreen(view.lights) && generations[view.name] !== undefined)
  if (finished.length) {
    const remaining = { ...generations }
    for (const view of finished) delete remaining[view.name]
    await $.store.set(GENERATIONS_KEY, remaining)
  }
  await update($, views, () => next)
  logEvent($, 'verbose', 'scan', `${folders.length} folders, ${next.length} mods in ${Date.now() - scanStartedAt}ms`, { modsDir: dir })
  logEvent($, 'debug', 'scan.lights', 'lights per mod', Object.fromEntries(next.map(view => [view.name, view.lights.join(' ')])))
  await update($, selected, current =>
    current && (next.some(view => view.name === current) || current === Lab.DEMO_NAME) ? current : (next[0]?.name ?? null),
  )
  await refreshStatus($)
}

/**
 * The first time a mod turns all green at its current code: a toast and a
 * notification (when announced). Returns the mods that just turned green.
 */
async function announceGreen($: Engine, judged: readonly ModView[], isAnnounced: boolean): Promise<string[]> {
  const done = ((await $.store.get(DONE_KEY)) ?? {}) as Record<string, number | string>
  const newly: string[] = []
  let isChanged = false
  for (const view of judged) {
    const stamp = factsByMod.get(view.name)?.codeSig ?? ''
    if (!Lab.isGreen(view.lights) || done[view.name] === stamp) continue
    done[view.name] = stamp
    isChanged = true
    if (!isAnnounced) continue
    newly.push(view.name)
    $.ui.toast(`✓ ${view.name} is ready to share`)
    void $.ui.notify(`${view.name} is ready to share`, { title: 'Mod Lab' }).catch((error: unknown) => logCaught($, 'announceGreen.notify', error))
  }
  if (isChanged) {
    await $.store.set(DONE_KEY, done)
    logEvent($, 'debug', 'store.set', DONE_KEY)
  }
  return newly
}

/** Every mod drawn now: the demo first while it runs. */
async function shownViews($: Engine): Promise<ModView[]> {
  const started = await read($, demoStartedAt)
  const all = await read($, views)
  if (started === null) return all
  const { now } = await read($, frame)
  return [Lab.demoViewAt(Math.max(0, now - started)), ...all]
}

async function refreshStatus($: Engine): Promise<void> {
  $.ui.status(Lab.badgeOf(Lab.countsOf(await shownViews($))))
}

// ── The clock: runs only while something is live ─────────────────────────

function startClock($: Engine): void {
  if (clock) return
  clock = $.clock.every(FRAME_MS, () => void tick($).catch((error: unknown) => logCaught($, 'tick', error)))
}

async function tick($: Engine): Promise<void> {
  const now = await $.clock.now()
  const previous = lastTickMs
  lastTickMs = now
  await update($, frame, current => ({ n: current.n + 1, now }))

  const started = await read($, demoStartedAt)
  if (started !== null) {
    for (const text of Lab.demoToastsBetween(previous - started, now - started)) $.ui.toast(text)
    const walk = Lab.demoWalkMs()
    if (previous - started < walk && now - started >= walk) {
      $.ui.toast(`✓ ${Lab.DEMO_NAME} (demo) is ready to share. That was a whole mod build`)
      void $.ui.notify(`${Lab.DEMO_NAME} (demo) is ready to share`, { title: 'Mod Lab' }).catch((error: unknown) => logCaught($, 'tick.notify', error))
    }
    if (now - started >= Lab.demoLengthMs()) await stopDemo($)
  }
  await refreshStatus($)

  const isLive =
    (await read($, runs)).length > 0 ||
    (await read($, demoStartedAt)) !== null ||
    Object.values(Lab.liveReports(await read($, reported), now)).some(report => report.status === 'running')
  if (!isLive) {
    clock?.cancel()
    clock = null
  }
}

// ── Runs ──────────────────────────────────────────────────────────────────

/** Records streamed test progress on the run in flight, which redraws the row and band. */
async function noteProgress($: Engine, entry: Run, counts: { passed: number; failed: number }): Promise<void> {
  await update($, runs, all => all.map(one => (one.mod === entry.mod && one.kind === entry.kind ? { ...one, ...counts } : one)))
}

async function runToEnd($: Engine, argv: readonly string[], dir: string): Promise<{ exitCode: number; output: string }> {
  const startedAt = Date.now()
  const out = await $.process.run(argv, { cwd: dir, timeoutMs: 180_000 })
  const output = `${out.stdout}\n${out.stderr}`
  logProcess($, argv, out.exitCode, Date.now() - startedAt, output)
  return { exitCode: out.exitCode, output }
}

/** A finished process: argv, exit code and duration at `verbose`; its output's tail at `debug`. */
function logProcess($: Engine, argv: readonly string[], exitCode: number, durationMs: number, output: string): void {
  logEvent($, 'verbose', 'process', `exit ${exitCode} after ${durationMs}ms`, { argv })
  logEvent($, 'debug', 'process.output', argv.slice(0, 3).join(' '), { tail: Lab.outputTail(output) })
}

/**
 * Runs validate or tsc to the end; streams test so the band fills on real
 * progress. A stream that cannot start (it rejects its first pull) falls back
 * to running the tests to the end.
 */
async function execute($: Engine, entry: Run, dir: string): Promise<{ exitCode: number; output: string }> {
  const argv = Lab.argvOf(entry.kind, dir)
  if (entry.kind !== 'Test') return runToEnd($, argv, dir)
  let output = ''
  let seen = 0
  let hasStarted = false
  const startedAt = Date.now()
  try {
    const stream = $.process.spawn({ argv, cwd: dir })
    for await (const piece of stream) {
      hasStarted = true
      output += piece.text
      const counts = Lab.countStreamed(output)
      if (counts.passed + counts.failed !== seen) {
        seen = counts.passed + counts.failed
        await noteProgress($, entry, counts)
      }
    }
    const ended = await stream.result
    logProcess($, argv, ended.code ?? 1, Date.now() - startedAt, output)
    return { exitCode: ended.code ?? 1, output }
  } catch (error) {
    if (hasStarted) throw error
    // Expected under `claude plugin test`, where process.spawn has no stub.
    logCaught($, 'execute.spawn', error, 'verbose', { argv, fallback: 'process.run' })
    return runToEnd($, argv, dir)
  }
}

async function run($: Engine, mod: string, kind: RunKind): Promise<void> {
  if ((await read($, runs)).some(one => one.mod === mod && one.kind === kind)) return
  const dir = `${modsDirOf($)}/${mod}`
  const typesPath = `${dir}/.claude-plugin/types/tsconfig.json`
  const hasTypes =
    kind !== 'Typecheck' ||
    (await $.fs.exists(typesPath).catch((error: unknown) => {
      logCaught($, 'fs.exists', error, 'debug', { path: typesPath })
      return false
    }))
  if (!hasTypes) {
    $.ui.toast(`${mod}: type-check needs the engine's types. Load the mod once in a session (/reload-plugins), then press K`)
    return
  }
  const startedAt = await $.clock.now()
  const last = (await resultsOf($))[mod]?.Test?.tests
  const entry: Run = { mod, kind, startedAt, passed: 0, failed: 0, total: last ? last.passed + last.failed : null }
  await update($, runs, all => [...all, entry])
  startClock($)
  await scan($, false)

  const stamp = factsByMod.get(mod)?.codeMtimeMs ?? startedAt
  const codeSig = factsByMod.get(mod)?.codeSig
  let result: Lab.RunResult
  try {
    const { exitCode, output } = await execute($, entry, dir)
    const endedAt = await $.clock.now()
    result = Lab.resultOf(kind, exitCode, output, stamp, endedAt - startedAt, endedAt)
  } catch (error) {
    const endedAt = await $.clock.now()
    result = { kind, ok: false, stampMs: stamp, durationMs: endedAt - startedAt, atMs: endedAt, summary: 'could not run', errors: [String(error).slice(0, 200)] }
    logCaught($, 'run', error, 'normal', { mod, kind })
  }
  if (codeSig !== undefined) result = { ...result, codeSig }
  logEvent($, 'normal', 'run', `${mod} ${kind} ${result.ok ? 'passed' : 'failed'}`, { durationMs: result.durationMs, summary: result.summary })
  const results = await resultsOf($)
  await $.store.set(RESULTS_KEY, { ...results, [mod]: { ...results[mod], [kind]: result } })
  logEvent($, 'debug', 'store.set', RESULTS_KEY, { mod, kind })
  await update($, runs, all => all.filter(one => !(one.mod === mod && one.kind === kind)))
  $.ui.toast(Lab.toastOfRun(mod, result))
  await scan($, true)
}

/**
 * After a turn: rescan (edits may have come from any tool, Bash included), then
 * re-run what went stale. Validate first; Test only if Validate passes.
 */
async function rerunStale($: Engine): Promise<void> {
  await scan($, true)
  if (!autoRerun) return
  const inFlight = await read($, runs)
  for (const view of await read($, views)) {
    const plan = Lab.rerunPlanOf(view.lights, inFlight.some(one => one.mod === view.name))
    if (plan.includes('Validate')) await run($, view.name, 'Validate')
    const validated = (await resultsOf($))[view.name]?.Validate
    if (plan.includes('Test') && validated?.ok) await run($, view.name, 'Test')
  }
}

function runInBackground($: Engine, mod: string | null, kind: RunKind): void {
  if (!mod || mod === Lab.DEMO_NAME) return
  void run($, mod, kind).catch((error: unknown) => logCaught($, 'runInBackground', error, 'normal', { mod, kind }))
}

// ── The pane ──────────────────────────────────────────────────────────────

const isPaneOpen = async ($: Engine): Promise<boolean> => (await $.ui.panes()).some(pane => pane.id === PANE)

async function openPane($: Engine): Promise<void> {
  const opened = await $.ui.open({ id: PANE, title: 'Mod Lab', columns: 80 })
  if (!opened.isPlaced) $.ui.toast(NARROW_TOAST)
}

async function startDemo($: Engine): Promise<void> {
  const now = await $.clock.now()
  lastTickMs = now
  await update($, frame, current => ({ ...current, now }))
  await update($, demoStartedAt, () => now)
  await update($, selected, () => Lab.DEMO_NAME)
  await update($, readme, () => null)
  startClock($)
}

async function stopDemo($: Engine): Promise<void> {
  await update($, demoStartedAt, () => null)
  await update($, selected, current => (current === Lab.DEMO_NAME ? null : current))
  await scan($, false)
}

/** D starts the demo; D again while it runs stops it. */
async function toggleDemo($: Engine): Promise<void> {
  if ((await read($, demoStartedAt)) === null) await startDemo($)
  else await stopDemo($)
}

async function showReadme($: Engine, mod: string | null): Promise<void> {
  if (!mod || mod === Lab.DEMO_NAME) return
  const text = await readText($, `${modsDirOf($)}/${mod}/README.md`)
  if (text === null) {
    $.ui.toast(`${mod} has no README yet`)
    return
  }
  await update($, readme, () => ({ name: mod, text, isStale: factsByMod.get(mod)?.isReadmeStale ?? false }))
}

async function moveSelection($: Engine, by: number): Promise<void> {
  const names = (await shownViews($)).map(view => view.name)
  if (!names.length) return
  const current = names.indexOf((await read($, selected)) ?? '')
  const nextAt = (Math.max(0, current) + by + names.length) % names.length
  await update($, selected, () => names[nextAt] ?? null)
  if (await read($, readme)) await showReadme($, names[nextAt] ?? null)
}

async function fillFix($: Engine, view: ModView): Promise<void> {
  const failed = (await resultsOf($))[view.name]?.Test?.tests?.failed ?? 1
  await $.prompt.fill({ text: Lab.fixPromptOf(view.name, view.failedStage ?? 'Test', view.errors, failed) })
}

async function warnNarrowOnce($: Engine): Promise<void> {
  if (await read($, hasWarnedNarrow)) return
  await update($, hasWarnedNarrow, () => true)
  $.ui.toast(NARROW_TOAST)
}

async function clearNarrowWarning($: Engine): Promise<void> {
  if (await read($, hasWarnedNarrow)) await update($, hasWarnedNarrow, () => false)
}

// ── Hooks ─────────────────────────────────────────────────────────────────

// ── /mod-builder config ───────────────────────────────────────────────────

/** `/mod-builder config [list]` lists the options; `/mod-builder config <option> <value>` changes one. */
async function configure($: Engine, words: string[]): Promise<string> {
  const command = Lab.parseConfigCommand(words)
  if (command.kind === 'error') return command.text
  if (command.kind === 'set') {
    const why = await setOption($, command.name, command.value)
    if (why) return `Could not change ${command.name}: ${why}`
  }
  const values: Lab.OptionValues = {
    logging: logLevel,
    autoRerun,
    autoOpen,
    modsDir: configuredDir,
    modsDirShown: Lab.shortPath(modsDirOf($)),
  }
  // The set reloads the plugin rather than changing this module's values, so show the new one.
  if (command.kind === 'set') Object.assign(values, Lab.valuesAfterSet(command.name, command.value))
  const shown = (value: string | boolean): string => (typeof value === 'boolean' ? (value ? 'on' : 'off') : value || 'default')
  const head = command.kind === 'set' ? `${command.name} is now ${shown(command.value)}.\n` : ''
  return head + Lab.configListText(values, logFile)
}

/**
 * Writes one option through this plugin's own `/config` row: '' once written, else why not.
 * Changing a plugin's options reloads it (types), which empties this module's log buffer, so
 * the line about the change is written to the file before the set.
 */
async function setOption($: Engine, name: Lab.OptionName, value: string | boolean): Promise<string> {
  // A plugin option's row is keyed `<plugin>.<field>`; its owner names the install, e.g.
  // `mod-builder@claudemod` or `mod-builder@inline` under --plugin-dir (seen live, 2026-10-13).
  const key = `${$.plugin.name}.${name}`
  const row = (await $.config.list()).find(r => r.key === key && Lab.isOwnRow((r.provider as { plugin?: string } | undefined)?.plugin, $.plugin.name))
  if (!row) return `no /config row ${key} in this session (headless sessions list no plugin options). Change it in /config, or /plugin → mod-builder → options.`
  logEvent($, 'normal', 'config', `${name} set`, { value })
  await flushLog($)
  const result = await $.config.set({ key: row.key, value })
  return result.deny ?? ''
}

/** The session's first line: plugin version, mods folder and level. */
async function logStart($: Engine): Promise<void> {
  const manifest = Lab.manifestOf(await readText($, `${$.plugin.root}/.claude-plugin/plugin.json`))
  logEvent($, 'normal', 'session.start', 'Mod Lab started', { version: manifest.version, modsDir: modsDirOf($), logging: logLevel })
}

export const register: Register = (on, options) => {
  const config = (options ?? {}) as Record<string, unknown>
  configuredDir = String(config.modsDir ?? '').trim()
  autoOpen = config.autoOpen === true
  autoRerun = config.autoRerun !== false
  logLevel = Lab.logLevelOf(config.logging)

  on('session.start', async ($, e, next) => {
    await $.command
      .register({
        name: 'modlab',
        description: 'Mod Lab: every mod you are building, stage by stage',
        argumentHint: '[demo | new | <mod>]',
      })
      .catch((error: unknown) => logCaught($, 'session.start.command', error, 'normal', { command: 'modlab' }))
    await $.command
      .register({ name: 'mod-builder', description: "mod-builder's options, including logging", argumentHint: 'config [list | <option> <value>]' })
      .catch((error: unknown) => logCaught($, 'session.start.command', error, 'normal', { command: 'mod-builder' }))
    await $.tool
      .register({
        name: TOOL,
        description:
          'Report mod-builder progress to Mod Lab. Call with status "running" when you start a stage of building a mod, and "passed" or "failed" when it ends. Stages: Spec, Scaffold, Logic, Register, Validate, Test, README, Share. Mod Lab re-runs Validate and Test itself; the disk decides.',
        inputSchema: Lab.REPORT_SCHEMA,
      })
      .catch((error: unknown) => logCaught($, 'session.start.tool', error))
    void logStart($).catch((error: unknown) => logCaught($, 'session.start.log', error))
    void scan($, false).catch((error: unknown) => logCaught($, 'session.start.scan', error))
    return next(e)
  })

  on('command.run', { command: 'mod-builder' }, async ($, e) => {
    logEvent($, 'verbose', 'command', `/mod-builder ${e.args}`.trim())
    const [sub = '', ...rest] = e.args.trim().split(/\s+/)
    if (sub.toLowerCase() !== 'config') return { text: `${Lab.CONFIG_USAGE}` }
    return { text: await configure($, rest) }
  }).catch(($, e, next) => {
    logEvent($, 'normal', 'command.mod-builder', 'hook failed', { error: next.error })
    return { text: 'mod-builder: the config command failed; see the log or claude --debug.' }
  })

  on('command.run', { command: 'modlab' }, async ($, e) => {
    try {
      logEvent($, 'verbose', 'command', `/modlab ${e.args}`.trim())
      const [sub = '', ...rest] = e.args.trim().split(/\s+/)
      const word = sub.toLowerCase()
      if (word === 'demo') {
        void (async () => {
          await startDemo($)
          await openPane($)
        })().catch((error: unknown) => logCaught($, 'modlab.demo', error))
        return { text: `Mod Lab: watch ${Lab.DEMO_NAME} build itself in the pane. Nothing is written to disk.` }
      }
      if (word === 'new') {
        void $.prompt.fill({ text: `/mod-builder:build ${rest.join(' ')}`.trimEnd() + ' ' }).catch((error: unknown) => logCaught($, 'modlab.new', error))
        return { text: 'Describe your mod after /mod-builder:build in the prompt box.' }
      }
      if (word) {
        const name = sub
        void (async () => {
          await scan($, false)
          if ((await read($, views)).some(view => view.name === name)) {
            await update($, selected, () => name)
            await update($, readme, () => null)
            await openPane($)
          } else {
            $.ui.toast(`No mod named ${name} in ${Lab.shortPath(modsDirOf($))}`)
          }
        })().catch((error: unknown) => logCaught($, 'modlab.select', error, 'normal', { mod: name }))
        return { text: `Mod Lab: ${name}.` }
      }
      const isOpen = await isPaneOpen($)
      void (async () => {
        if (isOpen) {
          await $.ui.close({ id: PANE })
          return
        }
        await clearNarrowWarning($)
        await scan($, false)
        await openPane($)
      })().catch((error: unknown) => logCaught($, 'modlab.toggle', error))
      return { text: isOpen ? 'Mod Lab folded to the status line. /modlab to reopen.' : 'Mod Lab opened.' }
    } catch (error) {
      logCaught($, 'modlab', error, 'normal', { args: e.args })
      return { text: 'Mod Lab: something went wrong; see the log (/mod-builder config) or claude --debug.' }
    }
  })

  on('tool.call', { tool: 'mcp__mod-builder__lab_report' }, async ($, e) => {
    const now = await $.clock.now()
    const checked = Lab.reportOf(e as unknown as Record<string, unknown>, now)
    if ('error' in checked) return { result: `Mod Lab: ${checked.error}` }
    const { mod, report } = checked
    logEvent($, 'verbose', 'lab_report', `${mod} ${report.stage} ${report.status}`, report.note ? { note: report.note } : undefined)
    // A Spec report on a mod built before starts an edit: older evidence goes stale.
    let known = (await read($, views)).find(view => view.name === mod)
    if (!known && report.stage === 'Spec') {
      await scan($, false)
      known = (await read($, views)).find(view => view.name === mod)
    }
    if (Lab.startsGeneration(report, known?.lights ?? null)) {
      await $.store.set(GENERATIONS_KEY, { ...(await generationsOf($)), [mod]: { since: now, fromVersion: factsByMod.get(mod)?.version ?? null } })
      logEvent($, 'debug', 'store.set', GENERATIONS_KEY, { mod, edit: 'started' })
    }
    await update($, reported, all => ({ ...all, [mod]: report }))
    if (report.status === 'running') {
      // Follow the active build, unless a README is open in the pane.
      if (!(await read($, readme))) await update($, selected, () => mod)
      startClock($)
      if (autoOpen && !(await isPaneOpen($))) void openPane($).catch((error: unknown) => logCaught($, 'lab_report.open', error))
    }
    if (report.status !== 'running' && (report.stage === 'Validate' || report.stage === 'Test')) {
      runInBackground($, mod, report.stage)
    } else {
      void scan($, true).catch((error: unknown) => logCaught($, 'lab_report.scan', error))
    }
    return { result: `Mod Lab: ${mod} ${report.stage} ${report.status}.` }
  }).catch(($, e, next) => {
    logEvent($, 'normal', 'lab_report', 'hook failed', { error: next.error })
    return { result: 'Mod Lab: noted (the lab could not update just now).' }
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      void rerunStale($).catch((error: unknown) => logCaught($, 'turn.complete.rerun', error))
      void flushLog($)
    }
    return next(e)
  })

  // A session ending: write its lines, then start a fresh buffer and file. After `/clear` or a
  // resume the process goes on under a new session id, and no session.start fires (types).
  on('session.end', async ($, e, next) => {
    // Wait until no write is queued behind the one awaited: a check finishing now may log meanwhile.
    let settled: Promise<void>
    do {
      settled = flushLog($)
      await settled
    } while (settled !== logChain)
    flushTimer?.cancel()
    flushTimer = null
    logBuffer = Lab.EMPTY_LOG
    logFile = ''
    writtenSig = ''
    return next(e)
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) await update($, readme, () => null)
    return next(e)
  }).catch(($, e, next) => {
    logEvent($, 'normal', 'ui.close', 'hook failed', { error: next.error })
    return next(e)
  })

  // ── Drawing ─────────────────────────────────────────────────────────────

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Markdown } = $.ui.resolve(e)
    const layout = Lab.layoutOf(e.props.bodyColumns)
    if (layout === 'none') {
      void warnNarrowOnce($).catch((error: unknown) => logCaught($, 'render.narrow', error))
      return <Box />
    }
    void clearNarrowWarning($).catch((error: unknown) => logCaught($, 'render.narrow.clear', error))

    const isMobile = e.surface === 'mobile'
    const padX = layout === 'compact' ? 1 : 2
    const width = Math.max(10, e.props.bodyColumns - padX * 2)
    const all = await shownViews($)
    const counts = Lab.countsOf(all)
    const masthead = Lab.mastheadOf(counts)
    const { n, now } = await read($, frame)
    const pick = await read($, selected)
    const current = all.find(view => view.name === pick) ?? all[0] ?? null
    const doc = await read($, readme)
    const inFlight = await read($, runs)
    const demoStart = await read($, demoStartedAt)
    const isDemoRunning = demoStart !== null

    const mark = (m: Lab.Mark, key?: string) => (
      <Text key={key} color={COLOR[m.tone]} bold={m.bold === true} dimColor={m.dim === true}>
        {m.text}
      </Text>
    )
    const dim = (text: string, key?: string) => mark({ text, tone: 'dim' }, key)
    const faint = (text: string, key?: string) => mark({ text, tone: 'dim', dim: true }, key)
    const blank = (key: string) => <Text key={key}> </Text>
    const rule = (key: string) => faint('─'.repeat(width), key)
    const isRunning = (kind: RunKind): boolean =>
      current !== null && inFlight.some(one => one.mod === current.name && one.kind === kind)
    const demoChip = (key: string) => (
      <Text key={key} color={BACKGROUND} backgroundColor={COLOR.warn} bold>
        {' DEMO '}
      </Text>
    )

    // Masthead (1d): wordmark left, state word right; while building only the ● pulses.
    const header = (
      <Box justifyContent="space-between">
        <Text color={COLOR.accent} bold>
          {Lab.spaced('mod lab')}
        </Text>
        <Text>
          {masthead.dot && (
            <Text color={COLOR.success} dimColor={Lab.isPulseDim(n)}>
              {'● '}
            </Text>
          )}
          <Text color={COLOR[masthead.tone]}>{masthead.word}</Text>
        </Text>
      </Box>
    )

    // Summary row: counts joined by a dim " · "; right, modsDir (or the demo clock).
    const demoClock = isDemoRunning ? Lab.demoClockOf(Math.max(0, now - demoStart)) : null
    const summary = (
      <Box justifyContent="space-between">
        {demoClock ? (
          <Text>
            {Lab.DEMO_NAME}
            {dim(' is a demo · nothing is written to disk')}
          </Text>
        ) : (
          <Text>
            {Lab.summaryPartsOf(counts).map((part, at) => (
              <Text key={`sum-${at}`}>
                {at > 0 && dim(' · ')}
                {counts.mods ? part : dim(part)}
              </Text>
            ))}
          </Text>
        )}
        {layout !== 'compact' &&
          (demoClock ? (
            <Text>
              {demoClock.now}
              {dim(` / ${demoClock.total}`)}
            </Text>
          ) : (
            <Text>
              {dim('modsDir')}
              {`  ${Lab.shortPath(modsDirOf($))}`}
            </Text>
          ))}
      </Box>
    )

    // busy: dim and ignores presses (its run is in flight). lit: dim but still live (D stops the demo).
    type Press = { primary?: boolean; busy?: boolean; lit?: boolean }
    const button = (key: string, hotkey: string, label: string, onPress: () => void, extra: Press = {}) =>
      isMobile ? (
        <Box key={`touch-${key}`} borderStyle="round" borderColor={COLOR.dim} borderDimColor width="50%" justifyContent="center">
          <Button key={key} label={label} plain dimColor={extra.busy === true || extra.lit === true} onPress={() => (extra.busy ? undefined : onPress())} />
        </Box>
      ) : (
        <Button
          key={key}
          label={label}
          hotkey={hotkey}
          variant={extra.primary ? 'primary' : 'secondary'}
          dimColor={extra.busy === true || extra.lit === true}
          hover={{ backgroundColor: HOVER }}
          onPress={() => (extra.busy ? undefined : onPress())}
        />
      )
    const buttonRows = (groups: ReturnType<typeof button>[][]) => (
      <Box flexDirection="column">
        {groups.map((group, at) => (
          <Box key={`btns-${at}`} gap={isMobile ? 0 : 2} flexWrap="wrap">
            {group}
          </Box>
        ))}
      </Box>
    )
    // The host draws Buttons without their hotkey, and the keys only work once the pane holds the
    // keyboard, so a dim line says how (not on mobile, which has no hotkeys).
    const keysHint = (keys: string) =>
      isMobile || layout === 'compact' ? null : (
        <Text key="keys-hint" color={COLOR.dim} dimColor wrap="truncate">
          {`ctrl+x tab, then ${keys} · esc to leave`}
        </Text>
      )
    const frameOf = (body: ReturnType<typeof blank>[], buttons: ReturnType<typeof buttonRows>, keys: string) => (
      <Box flexDirection="column" paddingX={padX} paddingTop={1} minHeight={e.props.scroll.bodyRows}>
        {header}
        {blank('after-header')}
        {summary}
        {blank('after-summary')}
        {body}
        <Box flexGrow={1} />
        {keysHint(keys)}
        {buttons}
      </Box>
    )
    const press = {
      demo: () => void toggleDemo($).catch((error: unknown) => logCaught($, 'button.demo', error)),
      newMod: () => void $.prompt.fill({ text: '/mod-builder:build ' }).catch((error: unknown) => logCaught($, 'button.new', error)),
      next: () => void moveSelection($, 1).catch((error: unknown) => logCaught($, 'button.next', error)),
      prev: () => void moveSelection($, -1).catch((error: unknown) => logCaught($, 'button.prev', error)),
      run: (kind: RunKind) => () => runInBackground($, current?.name ?? null, kind),
      readme: () => void showReadme($, current?.name ?? null).catch((error: unknown) => logCaught($, 'button.readme', error)),
    }

    // README view (2g).
    if (doc) {
      return frameOf(
        [
          <Box key="readme-head" justifyContent="space-between">
            <Text>
              <Text bold>{doc.name}</Text>
              {dim('  /  README.md')}
            </Text>
            {doc.isStale ? mark({ text: '◌ older than src/', tone: 'warn' }) : <Text> </Text>}
          </Box>,
          rule('readme-rule'),
          blank('readme-gap'),
          <Markdown key="readme-body" text={doc.text} />,
        ],
        buttonRows([
          [
            button('back', 'b', 'Back', () => void update($, readme, () => null).catch((error: unknown) => logCaught($, 'button.back', error))),
            button('next', 'j', 'Next', press.next),
            button('prev', 'p', 'Prev', press.prev),
          ],
        ]),
        'B back · J next · P prev',
      )
    }

    // Empty (2a): only New mod and Demo exist with zero mods.
    if (all.length === 0) {
      return frameOf(
        [
          <Box key="empty-top" flexGrow={1} />,
          <Text key="empty-head" bold>
            No mods yet.
          </Text>,
          blank('empty-gap'),
          <Text key="empty-hint-1">
            {dim('Type ')}
            {mark({ text: '/mod-builder:build', tone: 'accent' })}
            {dim(' and describe one.')}
          </Text>,
          <Text key="empty-hint-2">
            {dim('Or press ')}
            {mark({ text: 'D', tone: 'accent', bold: true })}
            {dim(' to watch a demo build.')}
          </Text>,
          <Box key="empty-bottom" flexGrow={1} />,
        ],
        buttonRows([[button('new', 'n', 'New mod', press.newMod), button('demo', 'd', 'Demo', press.demo, { lit: isDemoRunning })]]),
        'N new mod · D demo',
      )
    }

    // Rows (1a, 4a–4c): name 18 · lights 16 · status · time 5.
    // A run in flight updates as it streams; scanned views only change on a rescan.
    const timeOf = (view: ModView): string => {
      const live = inFlight.find(one => one.mod === view.name)
      return live ? Lab.clockOf(now - live.startedAt) : view.time
    }
    const statusOf = (view: ModView): string => {
      const live = inFlight.find(one => one.mod === view.name)
      return live ? Lab.runningTextOf(live) : view.status
    }
    const rows = all.map(view => {
      const isPicked = view.name === current?.name
      const nameCell = (
        <Box width={NAME_COLUMN} flexShrink={0}>
          {isPicked ? mark({ text: '▸', tone: 'accent', bold: true }) : <Text> </Text>}
          {isPicked ? (
            <Text inverse bold>
              {` ${view.name} `}
            </Text>
          ) : (
            <Text>{` ${view.name}`}</Text>
          )}
          {view.isDemo && <Text> </Text>}
          {view.isDemo && demoChip(`chip-${view.name}`)}
        </Box>
      )
      if (layout === 'compact') {
        const at = view.lights.findIndex(light => light !== 'passed')
        const shown = Lab.lightMarkOf(at < 0 ? 'passed' : view.lights[at]!, n)
        return (
          <Box key={`row-${view.name}`} justifyContent="space-between">
            {nameCell}
            <Text>
              {dim(`${at < 0 ? 8 : at + 1}/8 `)}
              {mark(shown)}
            </Text>
          </Box>
        )
      }
      return (
        <Box key={`row-${view.name}`}>
          {nameCell}
          <Box width={16} flexShrink={0}>
            {view.lights.map((light, at) => (
              <Text key={`${view.name}-l${at}`}>
                {mark(Lab.lightMarkOf(light, n))}{' '}
              </Text>
            ))}
          </Box>
          {layout === 'full' && (
            <Box flexGrow={1} paddingLeft={2}>
              <Text color={COLOR[view.tone]} wrap="truncate">
                {statusOf(view)}
              </Text>
            </Box>
          )}
          {layout === 'full' && (
            <Box width={5} flexShrink={0} justifyContent="flex-end">
              {dim(timeOf(view))}
            </Box>
          )}
        </Box>
      )
    })

    // Mobile (5b): compact rows, touch buttons two to a row, no hotkeys.
    if (isMobile) {
      return frameOf(
        [...rows, blank('mobile-gap')],
        buttonRows([
          [button('validate', 'v', 'Validate', press.run('Validate'), { busy: isRunning('Validate') }), button('test', 't', 'Test', press.run('Test'), { busy: isRunning('Test') })],
          [button('typecheck', 'k', 'Type-check', press.run('Typecheck'), { busy: isRunning('Typecheck') }), button('readme', 'o', 'README', press.readme)],
          [button('next', 'j', 'Next', press.next), button('prev', 'p', 'Prev', press.prev)],
          [button('new', 'n', 'New mod', press.newMod), button('demo', 'd', 'Demo', press.demo, { lit: isDemoRunning })],
        ]),
        '',
      )
    }

    // Column header (as in the mockups): MODS over the names, a stage number over each light.
    const columns =
      layout === 'compact' ? null : (
        <Box key="columns">
          <Box width={NAME_COLUMN} flexShrink={0}>
            {dim('  MODS')}
          </Box>
          <Box width={16} flexShrink={0}>
            {Lab.columnsOf(current?.lights ?? []).map((m, at) => mark(m, `col-${at}`))}
          </Box>
        </Box>
      )

    // Detail (1a, 2b–2j): header, track, error or done box, HOOKS, REACHES.
    const detail: ReturnType<typeof blank>[] = []
    if (current && layout !== 'compact') {
      detail.push(blank('d-gap-0'), rule('d-rule'), blank('d-gap-1'))
      const where = [current.version && (current.isDemo ? current.version : `v${current.version}`), current.path].filter(Boolean).join(' · ')
      detail.push(
        <Box key="d-head" justifyContent="space-between">
          <Text>
            <Text bold>{current.name}</Text>
            {current.isDemo && <Text>{'  '}</Text>}
            {current.isDemo && demoChip('d-chip')}
          </Text>
          {layout === 'full' ? dim(where) : <Text> </Text>}
        </Box>,
      )
      if (layout === 'full' && current.description) {
        detail.push(
          <Text key="d-desc" color={COLOR.dim} wrap="truncate">
            {current.description}
          </Text>,
        )
      }
      detail.push(blank('d-gap-2'))
      detail.push(
        <Box key="d-track" flexWrap="wrap">
          {Lab.trackOf(current.lights, n).map((step, at) => (
            <Text key={`t-${at}`}>
              {mark(step.num)}
              {mark(step.name)}
              {step.joint && mark(step.joint)}
            </Text>
          ))}
        </Box>,
      )
      if (current.failedStage && current.errors.length > 0) {
        const [first = '', second, third] = current.errors.map(line => line.trim())
        detail.push(blank('d-gap-err'))
        detail.push(
          <Box key="d-error" flexDirection="column" borderStyle="round" borderColor={COLOR.error} borderDimColor paddingX={1}>
            <Text wrap="truncate">
              {mark({ text: '✕ ', tone: 'error', bold: true })}
              {first}
            </Text>
            {second !== undefined && (
              <Text color={COLOR.dim} wrap="truncate">
                {`  ${second}`}
              </Text>
            )}
            {third !== undefined && (
              <Text color={COLOR.dim} dimColor wrap="truncate">
                {`  ${third}`}
              </Text>
            )}
          </Box>,
        )
        detail.push(
          current.isDemo ? (
            <Text key="d-fixing">
              {mark({ text: '◐ ', tone: 'accent' })}
              {Lab.DEMO_FIXING}
              {dim('  · demo')}
            </Text>
          ) : (
            <Box key="d-fix">{button('fix', 'f', 'Fix with Claude', () => void fillFix($, current).catch((error: unknown) => logCaught($, 'button.fix', error)), { primary: true })}</Box>
          ),
        )
      }
      if (current.doneLine) {
        detail.push(blank('d-gap-done'))
        detail.push(
          <Box key="d-done" borderStyle="round" borderColor={COLOR.success} paddingX={1}>
            <Text wrap="truncate">
              {mark({ text: '✓ ', tone: 'success', bold: true })}
              {current.isDemo ? (
                mark({ text: current.doneLine, tone: 'success' })
              ) : (
                <Text>
                  {mark({ text: 'ready to share', tone: 'success' })}
                  {dim(`  ·  ${current.doneLine}`)}
                </Text>
              )}
            </Text>
          </Box>,
        )
      }
      if (layout === 'full' && current.hooks.length > 0) {
        detail.push(blank('d-gap-hooks'))
        detail.push(
          <Box key="d-hooks">
            <Box width={LABEL_COLUMN} flexShrink={0}>
              {dim('HOOKS')}
            </Box>
            <Text wrap="wrap">
              {current.hooks.map((hook, at) => (
                <Text key={`h-${at}`}>
                  {at > 0 && faint(' · ')}
                  {hook}
                </Text>
              ))}
            </Text>
          </Box>,
        )
      }
      if (layout === 'full' && current.reaches.length > 0) {
        const value = (text: string) => (text === 'none' ? dim(text.padEnd(15)) : <Text>{text.padEnd(15)}</Text>)
        const reach = (label: string) => current.reaches.find(one => one.label === label)?.value ?? 'none'
        const pairs: [string, string][] = [
          ['processes', 'files'],
          ['network', 'model'],
        ]
        detail.push(blank('d-gap-reach'))
        detail.push(
          <Box key="d-reach" flexDirection="column">
            {pairs.map(([left, right], at) => (
              <Text key={`r-${at}`} wrap="truncate">
                {dim((at === 0 ? 'REACHES' : '').padEnd(LABEL_COLUMN))}
                {dim(left.padEnd(LABEL_COLUMN))}
                {value(reach(left))}
                {dim(right.padEnd(9))}
                {value(reach(right))}
              </Text>
            ))}
            <Text wrap="truncate">
              {dim(''.padEnd(LABEL_COLUMN))}
              {dim('gating'.padEnd(LABEL_COLUMN))}
              {current.gates.length === 0
                ? dim('none')
                : current.gates.map((gate, at) => (
                    <Text key={`g-${at}`}>
                      {at > 0 && faint(' · ')}
                      {mark({ text: gate.hook, tone: 'warn' })}
                      {dim(gate.hasCatch ? '  .catch ✓' : '  no .catch ✕')}
                    </Text>
                  ))}
            </Text>
          </Box>,
        )
      }
    }

    const isDemoPick = current?.isDemo === true
    return frameOf(
      [...(columns ? [columns] : []), ...rows, ...detail],
      buttonRows([
        [
          button('validate', 'v', 'Validate', press.run('Validate'), { busy: isRunning('Validate') || isDemoPick }),
          button('test', 't', 'Test', press.run('Test'), { busy: isRunning('Test') || isDemoPick }),
          ...(layout === 'full'
            ? [button('typecheck', 'k', 'Type-check', press.run('Typecheck'), { busy: isRunning('Typecheck') || isDemoPick })]
            : []),
          button('readme', 'o', 'README', press.readme),
        ],
        [
          ...(all.length > 1 ? [button('next', 'j', 'Next', press.next), button('prev', 'p', 'Prev', press.prev)] : []),
          button('new', 'n', 'New mod', press.newMod),
          button('demo', 'd', 'Demo', press.demo, { lit: isDemoRunning }),
        ],
      ]),
      `V validate · T test${layout === 'full' ? ' · K types' : ''} · O readme${all.length > 1 ? ' · J/P move' : ''} · N new · D demo${current?.failedStage && !current.isDemo ? ' · F fix' : ''}`,
    )
  })

  // Band (3a, 3b): up to three mods, a 15-cell bar on real progress, a detail row when there is room.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rest = await next(e)
    try {
      if (e.props.hasSurvey || e.props.maxRows < 1) return rest
      const { now } = await read($, frame)
      const started = await read($, demoStartedAt)
      const demo = started === null ? null : { view: Lab.demoViewAt(Math.max(0, now - started)), since: started }
      const entries = Lab.bandEntriesOf(
        await read($, runs),
        Lab.liveReports(await read($, reported), now),
        demo,
        await read($, views),
      ).slice(0, e.props.maxRows)
      if (!entries.length) return rest
      const { Box, Text } = $.ui.resolve(e)
      const withDetail = entries.length * 2 <= e.props.maxRows
      return (
        <Box flexDirection="column">
          <Box flexDirection="column" paddingX={1}>
            {entries.map(entry => {
              const bar = Lab.barOf(entry.fraction)
              return (
                <Box key={`band-${entry.name}`} flexDirection="column">
                  <Text wrap="truncate">
                    <Text color={COLOR.accent}>{'◆ '}</Text>
                    <Text bold>{entry.name}</Text>
                    <Text color={COLOR.accent}>{`  ${entry.stage} `}</Text>
                    <Text color={COLOR.accent}>{bar.filled}</Text>
                    <Text color={COLOR.dim} dimColor>
                      {bar.empty}
                    </Text>
                    <Text color={COLOR.dim}>{`  ${Lab.clockOf(Math.max(0, now - entry.since))}`}</Text>
                  </Text>
                  {withDetail && (
                    <Text color={COLOR.dim} dimColor wrap="truncate">
                      {`  ${entry.detail}`}
                    </Text>
                  )}
                </Box>
              )
            })}
          </Box>
          {rest}
        </Box>
      )
    } catch (error) {
      logCaught($, 'render.band', error)
      return rest
    }
  })
}

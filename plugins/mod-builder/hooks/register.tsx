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
const SHOW_TEXT = 'Bringing Mod Lab to the front; it has the keyboard, Esc returns it to the prompt.'
const STILL_BEHIND_TOAST = 'Mod Lab is still behind another tab: ctrl+x tab, then again until it shows.'
/** How long after asking for the front the pane is read again (#31). */
const FRONT_CHECK_MS = 500

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

// One value on purpose: a scan's mods and the folder it judged them in are written together, so no
// render, button, lab_report or re-run ever pairs one folder's rows with another's path. Don't split
// it into two atoms (PR #57 review round 2; the "publishes its folder and its mods together" test).
const judged = atom({ plugin: 'mod-builder', key: 'judged' } as const, { modsDir: null, views: [] })
const selected = atom({ plugin: 'mod-builder', key: 'selected' } as const, null)
const runs = atom({ plugin: 'mod-builder', key: 'runs' } as const, [])
const reported = atom({ plugin: 'mod-builder', key: 'reported' } as const, {})
const building = atom({ plugin: 'mod-builder', key: 'building' } as const, {})
const frame = atom({ plugin: 'mod-builder', key: 'frame' } as const, { n: 0, now: 0 })
const demoStartedAt = atom({ plugin: 'mod-builder', key: 'demoStartedAt' } as const, null)
const readme = atom({ plugin: 'mod-builder', key: 'readme' } as const, null)
const fresh = atom({ plugin: 'mod-builder', key: 'fresh' } as const, [])
const hasWarnedNarrow = atom({ plugin: 'mod-builder', key: 'hasWarnedNarrow' } as const, false)

type Engine = EngineInterface
type StoredResults = Record<string, Lab.Results>

// Module state: options, timer handles, in-flight guards and write chains only.
// A reload starts it afresh; what must survive lives in atoms and $.store.
let configuredDir = ''
let autoOpen = false
let autoRerun = true
/** A check's time limit in ms, from `testTimeoutMinutes`. */
let runLimit = Lab.runLimitMsOf(undefined)
let clock: Timer | null = null
let lastTickMs = 0
let scanning: Promise<void> | null = null
let isScanQueued = false
let isQueuedAnnounced = false
// Writes to the results and generations in $.store, in order (Change 0.2.8).
let storeChain: Promise<void> = Promise.resolve()
// What the last finished scan read; a scan swaps in its own once it has read every folder (Change 0.2.8).
let factsByMod = new Map<string, Lab.FileFacts>()
/** The folder and mods of the last scan that wrote its rows (`judged`): set with no await after that write. */
let published: { modsDir: string; names: ReadonlySet<string> } | null = null
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

/** The session's working directory, read at each use so a `/cd` is followed; null when it can't be read. */
const cwdOf = ($: Engine): Promise<string | null> =>
  $.session.cwd().catch((error: unknown) => (logCaught($, 'session.cwd', error), null))

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

const exists = ($: Engine, path: string): Promise<boolean> =>
  $.fs.exists(path).catch((error: unknown) => {
    logCaught($, 'fs.exists', error, 'debug', { path })
    return false
  })

/** The mods folder of the plugin's own marketplace: `modsDir`'s default when nothing is found from the working directory. */
const pluginModsDirOf = ($: Engine): string => `${$.plugin.root}/../../mods`

/**
 * What `modsDir` means when it isn't set: the `mods/` of the marketplace nearest the working
 * directory (the one /mod-builder:build writes to, a worktree's own in a worktree), else the
 * plugin's own. The working directory is read now, so a `/cd` is followed. Candidates are probed
 * nearest first and the first one found ends the walk (each probe is slow on /mnt/c).
 */
async function defaultModsDir($: Engine): Promise<string> {
  const cwd = await cwdOf($)
  const candidates = cwd === null ? [] : Lab.marketplaceCandidatesOf(cwd)
  let nearest: string[] = []
  for (const path of candidates) {
    if (!(await exists($, path))) continue
    nearest = [path]
    break
  }
  return Lab.modsDirFor('', cwd, nearest, pluginModsDirOf($))
}

/** The mods folder the working directory leads to now. A set `modsDir` wins, so nothing is walked. */
async function currentModsDir($: Engine): Promise<string> {
  return configuredDir ? Lab.normalizePath(configuredDir) : defaultModsDir($)
}

/**
 * The folder the pane shows: the one the last scan judged (kept in state, so it survives a
 * reload), else the current one before any scan. What the pane's buttons act on.
 */
async function shownModsDir($: Engine): Promise<string> {
  return (await read($, judged)).modsDir ?? currentModsDir($)
}

/** One mod folder's file facts, as a scan judges them; null when it isn't a mod. */
async function modFactsOf($: Engine, modsDir: string, name: string, marketplace: string): Promise<Lab.FileFacts | null> {
  const at = `${modsDir}/${name}`
  const top = await list($, at)
  const has = (entry: string): boolean => top.some(one => one.name === entry)
  const listIf = (folder: string): Promise<Lab.Entry[]> => (has(folder) ? list($, `${at}/${folder}`) : Promise.resolve([]))
  const [manifestDir, hooks, tests, types, agents, commands, skills] = await Promise.all([
    listIf('.claude-plugin'),
    listIf('hooks'),
    listIf('tests'),
    listIf('types'),
    listIf('agents'),
    listIf('commands'),
    listIf('skills'),
  ])
  // Their subfolders are walked too; the manifest folder's are not.
  const codeFolders = { hooks, tests, types, agents, commands, skills }
  const nested = await Promise.all(Object.entries(codeFolders).map(([folder, entries]) => nestedFiles($, at, folder, entries)))
  return Lab.factsOf({
    name,
    top,
    manifestDir,
    ...codeFolders,
    nested: nested.flat(),
    spec: has('SPEC.md') ? await readText($, `${at}/SPEC.md`) : null,
    readme: has('README.md') ? await readText($, `${at}/README.md`) : null,
    manifest: manifestDir.some(entry => entry.name === 'plugin.json') ? await readText($, `${at}/.claude-plugin/plugin.json`) : null,
    marketplace,
  })
}

/** The marketplace file beside a mods folder, or '' when there is none. */
const marketplaceOf = async ($: Engine, modsDir: string): Promise<string> => (await readText($, `${modsDir}/../.claude-plugin/marketplace.json`)) ?? ''

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

// ── Store ─────────────────────────────────────────────────────────────────

/**
 * The store key of one mods folder's records. One install serves every folder the working
 * directory leads to, and $.store is shared between sessions, so a mod's name alone is not enough.
 */
const keyOf = (base: string, modsDir: string): string => `${base}:${modsDir}`

/** The one folder Mod Lab watched before 0.2.9 (a set `modsDir`, else the plugin's own): its records were unkeyed. */
const legacyDirOf = ($: Engine): string => Lab.normalizePath(configuredDir || pluginModsDirOf($))

/** One folder's records under `base`; the folder the unkeyed set described reads that until it has its own. */
async function storedOf($: Engine, base: string, modsDir: string): Promise<unknown> {
  const own = await $.store.get(keyOf(base, modsDir))
  if (own !== undefined || modsDir !== legacyDirOf($)) return own
  return $.store.get(base)
}

const resultsOf = async ($: Engine, modsDir: string): Promise<StoredResults> =>
  ((await storedOf($, RESULTS_KEY, modsDir)) ?? {}) as StoredResults

/**
 * When each mod's current edit started (a build generation), for mods being edited, and the
 * version it started from. `repeatedAt` is when a Spec running last repeated during the edit.
 */
type Generation = { since: number; fromVersion: string | null; repeatedAt?: number }
/** As stored: an older version wrote the bare start time. */
type StoredGenerations = Record<string, number | Generation>
const generationsFrom = (stored: StoredGenerations): Record<string, Generation> =>
  Object.fromEntries(
    Object.entries(stored).map(([mod, gen]) => [mod, typeof gen === 'number' ? { since: gen, fromVersion: null } : gen]),
  )
const generationsOf = async ($: Engine, modsDir: string): Promise<Record<string, Generation>> =>
  generationsFrom(((await storedOf($, GENERATIONS_KEY, modsDir)) ?? {}) as StoredGenerations)
/** Whether `latest` is still the generation `read` was: the same start, and no Spec running reported on it since. */
const isSameGeneration = (latest: Generation | undefined, read: Generation | undefined): boolean =>
  latest?.since === read?.since && latest?.repeatedAt === read?.repeatedAt

/**
 * Sets one folder's records under `base` to `change` of their current value. Updates run one at
 * a time, each reading the key in its turn, so two callers never overwrite each other's change.
 * This orders this session's writes only: $.store is one file per plugin, and a second session's
 * write can still race. A failed update rejects for its caller; the next one runs regardless.
 */
function updateStore<T>($: Engine, base: string, modsDir: string, change: (current: T) => T): Promise<void> {
  storeChain = storeChain
    .catch(() => undefined)
    .then(async () => {
      await $.store.set(keyOf(base, modsDir), change(((await storedOf($, base, modsDir)) ?? {}) as T))
    })
  return storeChain
}

/** Updates one folder's build generations, as `updateStore` does, from their current value. */
function updateGenerations($: Engine, modsDir: string, change: (current: Record<string, Generation>) => Record<string, Generation>): Promise<void> {
  return updateStore($, GENERATIONS_KEY, modsDir, (stored: StoredGenerations) => change(generationsFrom(stored)))
}

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
  const dir = await currentModsDir($)
  const folders = (await list($, dir)).filter(entry => entry.kind === 'dir' && !entry.name.startsWith('.'))
  const marketplace = await marketplaceOf($, dir)
  const results = await resultsOf($, dir)
  const generations = await generationsOf($, dir)
  const cwd = await cwdOf($)
  const inFlight = await liveRunsOf($)
  const reports = Lab.liveReports(await read($, reported), await $.clock.now())
  const found = new Map<string, Lab.FileFacts>()
  for (const folder of folders) {
    const facts = await modFactsOf($, dir, folder.name, marketplace)
    if (facts) found.set(facts.name, facts)
  }
  factsByMod = found
  // "Ready to share" marks are kept per folder: a same-named mod elsewhere didn't just turn green.
  const freshIdOf = (name: string): string => `${dir}/${name}`
  // A build that reported a mod before writing its folder gets a row of its own until the folder is found (#19).
  const builds = Lab.liveReports((await read($, building))[dir] ?? {}, await $.clock.now())
  const placeholders = Lab.placeholderNames(builds, [...found.keys()], dir)
  const judge = (freshIds: readonly string[]): ModView[] => [
    ...[...factsByMod.values()].map(facts =>
      Lab.viewOf(
        facts,
        results[facts.name] ?? {},
        inFlight.filter(one => one.mod === facts.name),
        reports[facts.name] ?? null,
        freshIds.includes(freshIdOf(facts.name)),
        generations[facts.name]?.since ?? null,
        generations[facts.name]?.fromVersion ?? null,
        Lab.displayPathOf(`${dir}/${facts.name}`, cwd),
      ),
    ),
    ...placeholders.map(name =>
      Lab.viewOf(
        Lab.placeholderFacts(name),
        {},
        inFlight.filter(one => one.mod === name),
        builds[name] ?? null,
        false,
        null,
        null,
        Lab.displayPathOf(`${dir}/${name}`, cwd),
      ),
    ),
  ]
  const newlyGreen = await announceGreen($, judge([]), isAnnounced, dir)
  const marks = await read($, fresh)
  const kept = Lab.freshIdsOf(marks, legacyDirOf($))
  const freshIds = [...new Set([...kept, ...newlyGreen.map(freshIdOf)])]
  // Written when a mod just turned green, or when bare marks from before 0.2.9 moved to their folder.
  if (newlyGreen.length || kept.some((id, at) => id !== marks[at])) await update($, fresh, () => freshIds)
  const next = judge(freshIds)
  // An edit's generation ends when every stage is green again.
  const finished = next.filter(view => Lab.isGreen(view.lights) && generations[view.name] !== undefined)
  if (finished.length) {
    // Drop only the generations this scan judged: one begun since stays. A Spec running reported on one
    // since was read after this scan's reports, so the edit was finished when it came: it begins the next.
    await updateGenerations($, dir, remaining => {
      for (const view of finished) {
        const [latest, read] = [remaining[view.name], generations[view.name]]
        if (isSameGeneration(latest, read)) delete remaining[view.name]
        else if (latest?.since === read?.since && latest?.repeatedAt !== undefined) {
          remaining[view.name] = { since: latest.repeatedAt, fromVersion: found.get(view.name)?.version ?? null }
        }
      }
      return remaining
    })
  }
  // A README open over another folder's list doesn't belong to this one; closed as the list changes.
  const previous = (await read($, judged)).modsDir
  if (previous !== null && previous !== dir) await update($, readme, () => null)
  await update($, judged, () => ({ modsDir: dir, views: next }))
  published = { modsDir: dir, names: new Set(next.map(view => view.name)) }
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
async function announceGreen($: Engine, judged: readonly ModView[], isAnnounced: boolean, modsDir: string): Promise<string[]> {
  const doneKey = keyOf(DONE_KEY, modsDir)
  const done = ((await storedOf($, DONE_KEY, modsDir)) ?? {}) as Record<string, number | string>
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
    await $.store.set(doneKey, done)
    logEvent($, 'debug', 'store.set', doneKey)
  }
  return newly
}

/** Every mod drawn now: the demo first while it runs. */
async function shownViews($: Engine): Promise<ModView[]> {
  const started = await read($, demoStartedAt)
  const all = (await read($, judged)).views
  if (started === null) return all
  const { now } = await read($, frame)
  return [Lab.demoViewAt(Math.max(0, now - started)), ...all]
}

async function refreshStatus($: Engine): Promise<void> {
  $.ui.status(Lab.badgeOf(Lab.countsOf(await shownViews($))))
}

// ── The clock: runs only while something is live ─────────────────────────

/**
 * session.start fires once per fresh load of this module (claude-code.d.ts), and the runs atom
 * outlives the module that wrote it. So at that moment no row has a live run: clear them all.
 */
async function clearLeftRuns($: Engine): Promise<void> {
  if ((await read($, runs)).length) await update($, runs, () => [])
}

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

  // An orphan that aged out is dropped and the mods rescanned, so its stage stops reading running.
  const all = await read($, runs)
  const live = Lab.liveRuns(all, now, runLimit)
  if (live.length < all.length) {
    await update($, runs, rows => Lab.liveRuns(rows, now, runLimit))
    void scan($, true).catch((error: unknown) => logCaught($, 'tick.scan', error))
  }

  // A placeholder whose running report expired has no folder for a later scan to correct, so rescan now (#19).
  const allBuilds = await read($, building)
  const shown = await read($, judged)
  const builds = Lab.liveReports(allBuilds[shown.modsDir ?? ''] ?? {}, now)
  if (shown.views.some(view => view.isPlaceholder && builds[view.name]?.status !== 'running')) {
    void scan($, true).catch((error: unknown) => logCaught($, 'tick.scan', error))
  }

  // runs is read again here: a run may have started during the awaits above.
  const isLive =
    (await liveRunsOf($)).length > 0 ||
    (await read($, demoStartedAt)) !== null ||
    (await hasRunningReport($, now))
  if (!isLive) {
    clock?.cancel()
    clock = null
    // A run or report that started after those reads found the clock still set and didn't start one: start it again.
    if ((await liveRunsOf($)).length || (await hasRunningReport($, now))) startClock($)
  }
}

// ── Runs ──────────────────────────────────────────────────────────────────

/** Records streamed test progress on the run in flight, which redraws the row and band. */
async function noteProgress($: Engine, entry: Run, counts: { passed: number; failed: number }): Promise<void> {
  await update($, runs, all => Lab.withProgress(all, entry, counts))
}

/** A check ended at its time limit; the message is its summary. */
class RunTimeout extends Error {}

/** The error a check ends with at its time limit: "timed out after 3 minutes". */
const timeoutOf = (): RunTimeout => new RunTimeout(Lab.timeoutText(runLimit))

/** The runs in flight: a row whose run a reload ended counts nowhere once it is past the time limit and the grace. */
/** Whether any build still has a live running report, read now rather than from an earlier copy. */
async function hasRunningReport($: Engine, now: number): Promise<boolean> {
  const reports = [Lab.liveReports(await read($, reported), now), ...Object.values(await read($, building)).map(builds => Lab.liveReports(builds, now))]
  return reports.some(all => Object.values(all).some(report => report.status === 'running'))
}

async function liveRunsOf($: Engine): Promise<Run[]> {
  return Lab.liveRuns(await read($, runs), await $.clock.now(), runLimit)
}

/** Runs a check to the end. `$.process.run` kills one still going at the time limit and rejects: that is a RunTimeout. */
async function runToEnd($: Engine, argv: readonly string[], dir: string): Promise<{ exitCode: number; output: string }> {
  const startedAt = await $.clock.now()
  const out = await $.process.run(argv, { cwd: dir, timeoutMs: runLimit }).catch(async (error: unknown) => {
    // It also rejects when the command cannot start, which happens at once.
    throw Lab.isOverLimit((await $.clock.now()) - startedAt, runLimit) ? timeoutOf() : error
  })
  const output = `${out.stdout}\n${out.stderr}`
  logProcess($, argv, out.exitCode, (await $.clock.now()) - startedAt, output)
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
 * to running the tests to the end. A stream still going at the time limit is
 * stopped, which kills the child, and the run ends as a RunTimeout.
 */
async function execute($: Engine, entry: Run, dir: string): Promise<{ exitCode: number; output: string }> {
  const argv = Lab.argvOf(entry.kind, dir)
  if (entry.kind !== 'Test') return runToEnd($, argv, dir)
  let kept = Lab.EMPTY_STREAM
  let seen = 0
  let hasStarted = false
  let isTimedOut = false
  let timer: Timer | null = null
  const startedAt = Date.now()
  try {
    const stream = $.process.spawn({ argv, cwd: dir })
    // One shot at the limit: a poll overshoots any limit that isn't a multiple of its period.
    timer = $.clock.after(runLimit, () => {
      isTimedOut = true
      // A stream closed before its end rejects its result (claude-code.d.ts, HookStream); nothing reads it then.
      stream.result.catch(() => undefined)
      void stream.return?.(undefined as never)?.catch?.(() => undefined)
    })
    for await (const piece of stream) {
      hasStarted = true
      kept = Lab.streamPiece(kept, piece.text, piece.stream)
      if (kept.passed + kept.failed !== seen) {
        seen = kept.passed + kept.failed
        await noteProgress($, entry, { passed: kept.passed, failed: kept.failed })
      }
    }
    if (isTimedOut) throw timeoutOf()
    const ended = await stream.result
    const output = Lab.streamOutput(kept)
    logProcess($, argv, ended.code ?? 1, Date.now() - startedAt, output)
    return { exitCode: ended.code ?? 1, output }
  } catch (error) {
    if (isTimedOut) throw timeoutOf()
    if (hasStarted) throw error
    // Expected under `claude plugin test`, where process.spawn has no stub.
    logCaught($, 'execute.spawn', error, 'verbose', { argv, fallback: 'process.run' })
    return runToEnd($, argv, dir)
  } finally {
    timer?.cancel()
  }
}

/** Whether a newer run took this run's row (it outlived the limit and the grace): then it must not start or save anything. */
async function isSuperseded($: Engine, entry: Run): Promise<boolean> {
  if (Lab.hasRun(await read($, runs), entry)) return false
  logEvent($, 'normal', 'run', `${entry.mod} ${entry.kind} superseded`, { startedAt: entry.startedAt })
  return true
}

/** Runs a check and judges it. One that throws fails: as timed out at its time limit, else as "could not run". */
async function resultOfRun($: Engine, entry: Run, dir: string, stamp: number): Promise<Lab.RunResult> {
  const { mod, kind, startedAt } = entry
  try {
    const { exitCode, output } = await execute($, entry, dir)
    const endedAt = await $.clock.now()
    return Lab.resultOf(kind, exitCode, output, stamp, endedAt - startedAt, endedAt)
  } catch (error) {
    const endedAt = await $.clock.now()
    const summary = error instanceof RunTimeout ? error.message : 'could not run'
    const result: Lab.RunResult = { kind, ok: false, stampMs: stamp, durationMs: endedAt - startedAt, atMs: endedAt, summary, errors: [String(error).slice(0, 200)] }
    logCaught($, 'run', error, 'normal', { mod, kind })
    return result
  }
}

/**
 * Runs one check of `mod` in `modsDir`, the folder its caller judged it in. Its evidence and its
 * result stay with that folder, even if a /cd moves the scans it triggers elsewhere.
 */
async function run($: Engine, mod: string, kind: RunKind, modsDir: string): Promise<void> {
  if ((await liveRunsOf($)).some(one => one.mod === mod && one.kind === kind)) return
  const dir = `${modsDir}/${mod}`
  const typesPath = `${dir}/.claude-plugin/types/tsconfig.json`
  const hasTypes = kind !== 'Typecheck' || (await exists($, typesPath))
  if (!hasTypes) {
    $.ui.toast(`${mod}: type-check needs the engine's types. Load the mod once in a session (/reload-plugins), then press K`)
    return
  }
  const startedAt = await $.clock.now()
  const last = (await resultsOf($, modsDir))[mod]?.Test?.tests
  const entry: Run = { mod, kind, startedAt, passed: 0, failed: 0, total: last ? last.passed + last.failed : null }
  await update($, runs, all => [...all.filter(one => !(one.mod === mod && one.kind === kind)), entry])
  // From here the row is this run's alone to remove: whatever throws, it goes.
  let toast = ''
  try {
    startClock($)
    await scan($, false)
    if (await isSuperseded($, entry)) return

    const facts = await modFactsOf($, modsDir, mod, await marketplaceOf($, modsDir))
    const stamp = facts?.codeMtimeMs ?? startedAt
    const codeSig = facts?.codeSig
    let result = await resultOfRun($, entry, dir, stamp)
    if (await isSuperseded($, entry)) return
    if (codeSig !== undefined) result = { ...result, codeSig }
    logEvent($, 'normal', 'run', `${mod} ${kind} ${result.ok ? 'passed' : 'failed'}`, { durationMs: result.durationMs, summary: result.summary })
    // A refused write loses this result, but the run still ends and says how it went.
    const resultsKey = keyOf(RESULTS_KEY, modsDir)
    await updateStore($, RESULTS_KEY, modsDir, (stored: StoredResults) => ({ ...stored, [mod]: { ...stored[mod], [kind]: result } })).then(
      () => logEvent($, 'debug', 'store.set', resultsKey, { mod, kind }),
      (error: unknown) => logCaught($, 'store.set', error, 'normal', { key: resultsKey, mod, kind }),
    )
    // A newer run may have taken the row while the write waited its turn. Its later write wins the
    // store, since the writes are chained, so this result is not the one to announce.
    if (await isSuperseded($, entry)) return
    toast = Lab.toastOfRun(mod, result)
  } catch (error) {
    // No result came of it (a scan or reading the mod threw): say so, and rescan below so the stage stops reading running.
    logCaught($, 'run', error, 'normal', { mod, kind })
    toast = Lab.toastOfRunError(mod, kind, error)
  } finally {
    await update($, runs, all => all.filter(one => !(one.mod === mod && one.kind === kind && one.startedAt === startedAt)))
  }
  $.ui.toast(toast)
  await scan($, true)
}

/**
 * After a turn: rescan (edits may have come from any tool, Bash included), then
 * re-run what went stale. Validate first; Test only if Validate passes.
 */
async function rerunStale($: Engine): Promise<void> {
  await scan($, true)
  if (!autoRerun) return
  // The folder these views were judged in, read with them: each run's scans may move elsewhere.
  const verdict = await read($, judged)
  const modsDir = verdict.modsDir ?? (await currentModsDir($))
  const inFlight = await liveRunsOf($)
  for (const view of verdict.views) {
    const plan = Lab.rerunPlanOf(view.lights, inFlight.some(one => one.mod === view.name))
    if (plan.includes('Validate')) await run($, view.name, 'Validate', modsDir)
    const validated = (await resultsOf($, modsDir))[view.name]?.Validate
    if (plan.includes('Test') && validated?.ok) await run($, view.name, 'Test', modsDir)
  }
}

function runInBackground($: Engine, mod: string | null, kind: RunKind, modsDir: string): void {
  if (!mod || mod === Lab.DEMO_NAME) return
  void run($, mod, kind, modsDir).catch((error: unknown) => logCaught($, 'runInBackground', error, 'normal', { mod, kind }))
}

// ── The pane ──────────────────────────────────────────────────────────────

const isPaneOpen = async ($: Engine): Promise<boolean> => (await $.ui.panes()).some(pane => pane.id === PANE)
/** Open and drawn: an unasked open on a narrow terminal is open but waits undrawn, and the person's open seats it. */
const isPaneShown = async ($: Engine): Promise<boolean> => (await $.ui.panes()).some(pane => pane.id === PANE && pane.isPlaced)

async function openPane($: Engine): Promise<void> {
  const opened = await $.ui.open({ id: PANE, title: 'Mod Lab', columns: 80 })
  if (!opened.isPlaced) $.ui.toast(NARROW_TOAST)
}

/**
 * What a bare /modlab does with the pane. A pane waiting undrawn is open but not placed: it is no tab behind another, so it
 * counts as not listed and the person's command seats it.
 */
async function paneActionOf($: Engine): Promise<ReturnType<typeof Lab.paneAction>> {
  return Lab.paneAction((await $.ui.panes()).filter(pane => pane.isPlaced), PANE)
}

/**
 * Asks for a pane that is a tab behind another to the front, with the keyboard, for a person who asked to see it (#31).
 * The request goes out before the first await. A pane that is still a tab behind another afterwards is named in a toast.
 */
async function bringToFront($: Engine): Promise<void> {
  await $.ui.open({ id: PANE, title: 'Mod Lab', columns: 80, focus: true })
  $.clock.after(FRONT_CHECK_MS, () => void warnIfBehind($).catch((error: unknown) => logCaught($, 'modlab.front', error)))
}

/** An open for a command that names the pane: a tab behind another comes to the front, any other pane is opened as before. */
async function openOrFront($: Engine): Promise<void> {
  if ((await paneActionOf($)) === 'show') void bringToFront($).catch((error: unknown) => logCaught($, 'modlab.front', error))
  else await openPane($)
}

async function warnIfBehind($: Engine): Promise<void> {
  if ((await paneActionOf($)) === 'show') $.ui.toast(STILL_BEHIND_TOAST)
}

/**
 * Opens the pane from the hook of the person's command, before it returns: an open after that is "unasked", and the
 * engine leaves it undrawn below 144 columns (#90).
 */
async function showPane($: Engine): Promise<void> {
  await clearNarrowWarning($)
  await openPane($)
}

/**
 * Opens the pane for a typed build or edit skill, unless it is shown; a failure is logged and never stops the skill.
 * It starts no scan: the skill's first report scans, and one that joined a scan started here would wait out an extra
 * pass against its 10 s budget (PR #93 review, Codex).
 */
async function openForSkill($: Engine, command: string): Promise<void> {
  try {
    if (!(await isPaneShown($))) await showPane($)
  } catch (error) {
    logCaught($, 'command.skill', error, 'normal', { command })
  }
}

/** Selects `name` in the pane, out of any README. */
async function selectMod($: Engine, name: string): Promise<void> {
  await update($, selected, () => name)
  await update($, readme, () => null)
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

async function showReadme($: Engine, mod: string | null, modsDir: string): Promise<void> {
  if (!mod || mod === Lab.DEMO_NAME) return
  const text = await readText($, `${modsDir}/${mod}/README.md`)
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
  if (await read($, readme)) await showReadme($, names[nextAt] ?? null, await shownModsDir($))
}

async function fillFix($: Engine, view: ModView, modsDir: string): Promise<void> {
  const failed = (await resultsOf($, modsDir))[view.name]?.Test?.tests?.failed ?? 1
  const path = Lab.displayPathOf(`${modsDir}/${view.name}`, await cwdOf($))
  await $.prompt.fill({ text: Lab.fixPromptOf(view.name, view.failedStage ?? 'Test', view.errors, failed, path) })
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
  // What `default` means is only needed while modsDir is empty, or when it is being set.
  const needsDefault = !configuredDir || (command.kind === 'set' && command.name === 'modsDir')
  const defaultDir = needsDefault ? await defaultModsDir($) : ''
  const values: Lab.OptionValues = {
    logging: logLevel,
    autoRerun,
    autoOpen,
    modsDir: configuredDir,
    modsDirShown: Lab.shortPath(configuredDir ? Lab.normalizePath(configuredDir) : defaultDir),
    testTimeoutMinutes: Lab.limitMinutesOf(runLimit),
  }
  // The set reloads the plugin rather than changing this module's values, so show the new one.
  if (command.kind === 'set') Object.assign(values, Lab.valuesAfterSet(command.name, command.value, defaultDir))
  const shown = (value: string | boolean | number): string =>
    typeof value === 'boolean' ? (value ? 'on' : 'off') : typeof value === 'number' ? String(value) : value || 'default'
  const head = command.kind === 'set' ? `${command.name} is now ${shown(command.value)}.\n` : ''
  return head + Lab.configListText(values, logFile)
}

/**
 * Writes one option through this plugin's own `/config` row: '' once written, else why not.
 * Changing a plugin's options reloads it (types), which empties this module's log buffer, so
 * the line about the change is written to the file before the set.
 */
async function setOption($: Engine, name: Lab.OptionName, value: string | boolean | number): Promise<string> {
  // A plugin option's row is keyed `<plugin>.<field>`; its owner names the install, e.g.
  // `mod-builder@claudemod` or `mod-builder@inline` under --plugin-dir (seen live, 2026-10-13).
  const key = `${$.plugin.name}.${name}`
  const row = (await $.config.list()).find(r => r.key === key && Lab.isOwnRow((r.provider as { plugin?: string } | undefined)?.plugin, $.plugin.name))
  if (!row) return `no /config row ${key} in this session (headless sessions list no plugin options). Change it in /config, or /plugin → mod-builder → options.`
  logEvent($, 'normal', 'config', `${name} changing`, { value })
  await flushLog($)
  const result = await $.config.set({ key: row.key, value })
  // A refusal doesn't reload the plugin, so this module can still record it.
  if (result.deny) logEvent($, 'normal', 'config', `${name} change refused`, { value, reason: result.deny })
  return result.deny ?? ''
}

/** The session's first line: plugin version, mods folder and level. */
async function logStart($: Engine): Promise<void> {
  const manifest = Lab.manifestOf(await readText($, `${$.plugin.root}/.claude-plugin/plugin.json`))
  logEvent($, 'normal', 'session.start', 'Mod Lab started', { version: manifest.version, modsDir: await currentModsDir($), logging: logLevel })
}

export const register: Register = (on, options) => {
  const config = (options ?? {}) as Record<string, unknown>
  configuredDir = String(config.modsDir ?? '').trim()
  autoOpen = config.autoOpen === true
  autoRerun = config.autoRerun !== false
  runLimit = Lab.runLimitMsOf(config.testTimeoutMinutes)
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
    await clearLeftRuns($).catch((error: unknown) => logCaught($, 'session.start.runs', error))
    void logStart($).catch((error: unknown) => logCaught($, 'session.start.log', error))
    void scan($, false).catch((error: unknown) => logCaught($, 'session.start.scan', error))
    // A running report kept from before a reload has no clock in this module: start one, so it can expire (#19).
    if (await hasRunningReport($, await $.clock.now()).catch(() => false)) startClock($)
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
      // Each branch opens the pane before this hook returns: an open after it is "unasked", left undrawn below 144 columns (#90).
      if (word === 'demo') {
        await startDemo($)
        await openOrFront($)
        return { text: `Mod Lab: watch ${Lab.DEMO_NAME} build itself in the pane. Nothing is written to disk.` }
      }
      if (word === 'new') {
        void $.prompt.fill({ text: `/mod-builder:build ${rest.join(' ')}`.trimEnd() + ' ' }).catch((error: unknown) => logCaught($, 'modlab.new', error))
        return { text: 'Describe your mod after /mod-builder:build in the prompt box.' }
      }
      if (word) {
        const name = sub
        // A mod already listed is selected before the pane opens, so its first frame shows it (PR #93 review).
        if ((await read($, judged)).views.some(view => view.name === name)) await selectMod($, name)
        // The scan starts before the open, so a refused open still selects the mod.
        void (async () => {
          await scan($, false)
          if ((await read($, judged)).views.some(view => view.name === name)) {
            await selectMod($, name)
          } else {
            $.ui.toast(`No mod named ${name} in ${Lab.shortPath(await shownModsDir($))}`)
          }
        })().catch((error: unknown) => logCaught($, 'modlab.select', error, 'normal', { mod: name }))
        await openOrFront($)
        return { text: `Mod Lab: ${name}.` }
      }
      const action = await paneActionOf($)
      if (action === 'close') {
        void $.ui.close({ id: PANE }).catch((error: unknown) => logCaught($, 'modlab.toggle', error))
        return { text: 'Mod Lab folded to the status line. /modlab to reopen.' }
      }
      if (action === 'show') {
        void bringToFront($).catch((error: unknown) => logCaught($, 'modlab.front', error))
        return { text: SHOW_TEXT }
      }
      await showPane($)
      void scan($, false).catch((error: unknown) => logCaught($, 'modlab.scan', error))
      return { text: 'Mod Lab opened.' }
    } catch (error) {
      logCaught($, 'modlab', error, 'normal', { args: e.args })
      return { text: 'Mod Lab: something went wrong; see the log (/mod-builder config) or claude --debug.' }
    }
  })

  // A typed /mod-builder:build or /mod-builder:edit opens Mod Lab too, from this hook, so it is drawn at any width (#90).
  // Both fail open: the skill runs whatever happens to the pane.
  on('command.run', { command: 'mod-builder:build' }, async ($, e, next) => {
    await openForSkill($, e.command)
    return next(e)
  }).catch(($, e, next) => {
    logEvent($, 'normal', 'command.skill', 'hook failed', { command: e.command, error: next.error })
    return next(e)
  })

  on('command.run', { command: 'mod-builder:edit' }, async ($, e, next) => {
    await openForSkill($, e.command)
    return next(e)
  }).catch(($, e, next) => {
    logEvent($, 'normal', 'command.skill', 'hook failed', { command: e.command, error: next.error })
    return next(e)
  })

  on('tool.call', { tool: 'mcp__mod-builder__lab_report' }, async ($, e) => {
    const now = await $.clock.now()
    const checked = Lab.reportOf(e as unknown as Record<string, unknown>, now)
    if ('error' in checked) return { result: `Mod Lab: ${checked.error}` }
    const { mod, report } = checked
    logEvent($, 'verbose', 'lab_report', `${mod} ${report.stage} ${report.status}`, report.note ? { note: report.note } : undefined)
    const modsDir = await currentModsDir($)
    // A Spec report on a mod the last written rows of this folder don't list waits for a scan before it reads
    // any state: the first `get` fixes the moment every read of this dispatch sees (#10, #79). A listed mod's rows are enough.
    if (report.stage === 'Spec' && !(published?.modsDir === modsDir && published.names.has(mod))) await scan($, false)
    // The model reports on the folder the session is in now; judge it first if a /cd moved it.
    if ((await read($, judged)).modsDir !== modsDir) await scan($, false)
    // A Spec report on a mod built before starts an edit: older evidence goes stale.
    const known = (await read($, judged)).views.find(view => view.name === mod)
    // A mod with no folder yet is being built, not edited.
    if (Lab.startsGeneration(report, known && !known.isPlaceholder ? known.lights : null)) {
      // The version on disk as the edit begins (a bump may land after the last scan); a repeat keeps its own.
      const manifest = await readText($, `${modsDir}/${mod}/.claude-plugin/plugin.json`)
      const fromVersion = Lab.manifestOf(manifest).version ?? factsByMod.get(mod)?.version ?? null
      // A generation ends only when the mod is all green, so a repeat during the edit keeps its start and baseline.
      // The stamp tells a scan that judged the edit finished before this report that the next edit began here.
      // It always moves on, even within one millisecond of the last, or that scan would read it as unchanged.
      let isStarted = false
      await updateGenerations($, modsDir, all => {
        const current = all[mod]
        isStarted = current === undefined
        return { ...all, [mod]: current ? { ...current, repeatedAt: Math.max(now, (current.repeatedAt ?? 0) + 1) } : { since: now, fromVersion } }
      })
      if (isStarted) logEvent($, 'debug', 'store.set', keyOf(GENERATIONS_KEY, modsDir), { mod, edit: 'started' })
    }
    await update($, reported, all => ({ ...all, [mod]: { ...report, dir: modsDir } }))
    await update($, building, all => Lab.withBuilding(all, modsDir, mod, { ...report, dir: modsDir }, now))
    if (report.status === 'running') {
      // Follow the active build, unless a README is open in the pane.
      if (!(await read($, readme))) await update($, selected, () => mod)
      startClock($)
      if (autoOpen && !(await isPaneOpen($))) void openPane($).catch((error: unknown) => logCaught($, 'lab_report.open', error))
    }
    if (report.status !== 'running' && (report.stage === 'Validate' || report.stage === 'Test')) {
      runInBackground($, mod, report.stage, modsDir)
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
    // A mod reported before its folder exists: nothing to run or read yet (#19).
    const isPlaceholder = current?.isPlaceholder === true
    const doc = await read($, readme)
    // The folder `all` was judged in: what the header names and the buttons act on.
    const shownDir = await shownModsDir($)
    const inFlight = await liveRunsOf($)
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
            {Lab.summaryPartsOf(counts).map((part, at) => [
              at > 0 && dim(' · ', `sum-sep-${at}`),
              <Text key={`sum-${at}`}>{counts.mods ? part : dim(part)}</Text>,
            ])}
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
              {`  ${Lab.shortPath(shownDir)}`}
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
          {`ctrl+x tab (again: next tab), then ${keys} · esc to leave`}
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
      run: (kind: RunKind) => () => runInBackground($, current?.name ?? null, kind, shownDir),
      readme: () => void showReadme($, current?.name ?? null, shownDir).catch((error: unknown) => logCaught($, 'button.readme', error)),
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
          ...(isPlaceholder
            ? []
            : [
                [button('validate', 'v', 'Validate', press.run('Validate'), { busy: isRunning('Validate') }), button('test', 't', 'Test', press.run('Test'), { busy: isRunning('Test') })],
                [button('typecheck', 'k', 'Type-check', press.run('Typecheck'), { busy: isRunning('Typecheck') }), button('readme', 'o', 'README', press.readme)],
              ]),
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
      // Read the working directory now, not at the last scan, so a /cd shows at once and matches what F writes.
      const shown = current.isDemo ? current.path : `${Lab.displayPathOf(`${shownDir}/${current.name}`, await cwdOf($))}/`
      const where = [current.version && (current.isDemo ? current.version : `v${current.version}`), shown].filter(Boolean).join(' · ')
      const note = isPlaceholder ? `folder not written yet: ${Lab.shortPath(shownDir)}/${current.name}/` : null
      detail.push(
        <Box key="d-head" justifyContent="space-between">
          <Text>
            <Text bold>{current.name}</Text>
            {current.isDemo && <Text>{'  '}</Text>}
            {current.isDemo && demoChip('d-chip')}
          </Text>
          {layout === 'full' ? (
            // A path outside the working directory is absolute and can be long: cut its start, keep the mod folder.
            <Text color={COLOR.dim} wrap="truncate-start">
              {where}
            </Text>
          ) : (
            <Text> </Text>
          )}
        </Box>,
      )
      if (layout === 'full' && current.description) {
        detail.push(
          <Text key="d-desc" color={COLOR.dim} wrap="truncate">
            {current.description}
          </Text>,
        )
      }
      if (note) {
        detail.push(
          <Text key="d-note" color={COLOR.dim} wrap="truncate">
            {note}
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
            <Box key="d-fix">{button('fix', 'f', 'Fix with Claude', () => void fillFix($, current, shownDir).catch((error: unknown) => logCaught($, 'button.fix', error)), { primary: true })}</Box>
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
        ...(isPlaceholder
          ? []
          : [
              [
                button('validate', 'v', 'Validate', press.run('Validate'), { busy: isRunning('Validate') || isDemoPick }),
                button('test', 't', 'Test', press.run('Test'), { busy: isRunning('Test') || isDemoPick }),
                ...(layout === 'full'
                  ? [button('typecheck', 'k', 'Type-check', press.run('Typecheck'), { busy: isRunning('Typecheck') || isDemoPick })]
                  : []),
                button('readme', 'o', 'README', press.readme),
              ],
            ]),
        [
          ...(all.length > 1 ? [button('next', 'j', 'Next', press.next), button('prev', 'p', 'Prev', press.prev)] : []),
          button('new', 'n', 'New mod', press.newMod),
          button('demo', 'd', 'Demo', press.demo, { lit: isDemoRunning }),
        ],
      ]),
      `${isPlaceholder ? '' : `V validate · T test${layout === 'full' ? ' · K types' : ''} · O readme · `}${all.length > 1 ? 'J/P move · ' : ''}N new · D demo${current?.failedStage && !current.isDemo ? ' · F fix' : ''}`,
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
        await liveRunsOf($),
        Lab.liveReports(await read($, reported), now),
        demo,
        (await read($, judged)).views,
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

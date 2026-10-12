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
let isScanning = false
let isScanQueued = false
const factsByMod = new Map<string, Lab.FileFacts>()

// Every function that takes `$` is declared here, at the top of the file: the
// engine follows `$` only into functions it can see at this level.

const modsDirOf = ($: Engine): string => Lab.normalizePath(configuredDir || `${$.plugin.root}/../../mods`)

const list = ($: Engine, path: string): Promise<Lab.Entry[]> =>
  $.fs
    .list(path)
    .then(entries => entries.map(({ name, kind, mtimeMs }) => ({ name, kind, mtimeMs })))
    .catch(() => [])

const readText = ($: Engine, path: string): Promise<string | null> => $.fs.read(path).catch(() => null)

const resultsOf = async ($: Engine): Promise<StoredResults> =>
  ((await $.store.get(RESULTS_KEY)) ?? {}) as StoredResults

/** When each mod's current edit started (a build generation), for mods being edited. */
const generationsOf = async ($: Engine): Promise<Record<string, number>> =>
  ((await $.store.get(GENERATIONS_KEY)) ?? {}) as Record<string, number>

// ── Scanning ──────────────────────────────────────────────────────────────

/** Reads every mod folder, judges it and redraws. Single-flight; a call during a scan queues one more. */
async function scan($: Engine, isAnnounced: boolean): Promise<void> {
  if (isScanning) {
    isScanQueued = true
    return
  }
  isScanning = true
  try {
    do {
      isScanQueued = false
      await scanOnce($, isAnnounced)
    } while (isScanQueued)
  } finally {
    isScanning = false
  }
}

async function scanOnce($: Engine, isAnnounced: boolean): Promise<void> {
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
    const manifestDir = has('.claude-plugin') ? await list($, `${at}/.claude-plugin`) : []
    const facts = Lab.factsOf({
      name: folder.name,
      top,
      manifestDir,
      hooks: has('hooks') ? await list($, `${at}/hooks`) : [],
      tests: has('tests') ? await list($, `${at}/tests`) : [],
      types: has('types') ? await list($, `${at}/types`) : [],
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
        generations[facts.name] ?? null,
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
  const done = ((await $.store.get(DONE_KEY)) ?? {}) as Record<string, number>
  const newly: string[] = []
  let isChanged = false
  for (const view of judged) {
    const stamp = factsByMod.get(view.name)?.codeMtimeMs ?? 0
    if (!Lab.isGreen(view.lights) || done[view.name] === stamp) continue
    done[view.name] = stamp
    isChanged = true
    if (!isAnnounced) continue
    newly.push(view.name)
    $.ui.toast(`✓ ${view.name} is ready to share`)
    void $.ui.notify(`${view.name} is ready to share`, { title: 'Mod Lab' }).catch(() => undefined)
  }
  if (isChanged) await $.store.set(DONE_KEY, done)
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
  clock = $.clock.every(FRAME_MS, () => void tick($).catch(() => undefined))
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
      void $.ui.notify(`${Lab.DEMO_NAME} (demo) is ready to share`, { title: 'Mod Lab' }).catch(() => undefined)
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
  const out = await $.process.run(argv, { cwd: dir, timeoutMs: 180_000 })
  return { exitCode: out.exitCode, output: `${out.stdout}\n${out.stderr}` }
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
    return { exitCode: ended.code ?? 1, output }
  } catch (error) {
    if (hasStarted) throw error
    return runToEnd($, argv, dir)
  }
}

async function run($: Engine, mod: string, kind: RunKind): Promise<void> {
  if ((await read($, runs)).some(one => one.mod === mod && one.kind === kind)) return
  const dir = `${modsDirOf($)}/${mod}`
  if (kind === 'Typecheck' && !(await $.fs.exists(`${dir}/.claude-plugin/types/tsconfig.json`).catch(() => false))) {
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
  let result: Lab.RunResult
  try {
    const { exitCode, output } = await execute($, entry, dir)
    const endedAt = await $.clock.now()
    result = Lab.resultOf(kind, exitCode, output, stamp, endedAt - startedAt, endedAt)
  } catch (error) {
    result = { kind, ok: false, stampMs: stamp, summary: 'could not run', errors: [String(error).slice(0, 200)] }
  }
  const results = await resultsOf($)
  await $.store.set(RESULTS_KEY, { ...results, [mod]: { ...results[mod], [kind]: result } })
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
    if (!plan.length) continue
    await run($, view.name, 'Validate')
    const validated = (await resultsOf($))[view.name]?.Validate
    if (plan.includes('Test') && validated?.ok) await run($, view.name, 'Test')
  }
}

function runInBackground($: Engine, mod: string | null, kind: RunKind): void {
  if (!mod || mod === Lab.DEMO_NAME) return
  void run($, mod, kind).catch(() => undefined)
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

export const register: Register = (on, options) => {
  const config = (options ?? {}) as Record<string, unknown>
  configuredDir = String(config.modsDir ?? '').trim()
  autoOpen = config.autoOpen === true
  autoRerun = config.autoRerun !== false

  on('session.start', async ($, e, next) => {
    await $.command
      .register({
        name: 'modlab',
        description: 'Mod Lab: every mod you are building, stage by stage',
        argumentHint: '[demo | new | <mod>]',
      })
      .catch(() => undefined)
    await $.tool
      .register({
        name: TOOL,
        description:
          'Report mod-builder progress to Mod Lab. Call with status "running" when you start a stage of building a mod, and "passed" or "failed" when it ends. Stages: Spec, Scaffold, Logic, Register, Validate, Test, README, Share. Mod Lab re-runs Validate and Test itself; the disk decides.',
        inputSchema: Lab.REPORT_SCHEMA,
      })
      .catch(() => undefined)
    void scan($, false).catch(() => undefined)
    return next(e)
  })

  on('command.run', { command: 'modlab' }, async ($, e) => {
    try {
      const [sub = '', ...rest] = e.args.trim().split(/\s+/)
      const word = sub.toLowerCase()
      if (word === 'demo') {
        void (async () => {
          await startDemo($)
          await openPane($)
        })().catch(() => undefined)
        return { text: `Mod Lab: watch ${Lab.DEMO_NAME} build itself in the pane. Nothing is written to disk.` }
      }
      if (word === 'new') {
        void $.prompt.fill({ text: `/mod-builder:build ${rest.join(' ')}`.trimEnd() + ' ' }).catch(() => undefined)
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
        })().catch(() => undefined)
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
      })().catch(() => undefined)
      return { text: isOpen ? 'Mod Lab folded to the status line. /modlab to reopen.' : 'Mod Lab opened.' }
    } catch {
      return { text: 'Mod Lab: something went wrong; see claude --debug.' }
    }
  })

  on('tool.call', { tool: 'mcp__mod-builder__lab_report' }, async ($, e) => {
    const now = await $.clock.now()
    const checked = Lab.reportOf(e as unknown as Record<string, unknown>, now)
    if ('error' in checked) return { result: `Mod Lab: ${checked.error}` }
    const { mod, report } = checked
    // A Spec report on a mod built before starts an edit: older evidence goes stale.
    const known = (await read($, views)).find(view => view.name === mod)
    if (Lab.startsGeneration(report, known?.lights ?? null)) {
      await $.store.set(GENERATIONS_KEY, { ...(await generationsOf($)), [mod]: now })
    }
    await update($, reported, all => ({ ...all, [mod]: report }))
    if (report.status === 'running') {
      // Follow the active build, unless a README is open in the pane.
      if (!(await read($, readme))) await update($, selected, () => mod)
      startClock($)
      if (autoOpen && !(await isPaneOpen($))) void openPane($).catch(() => undefined)
    }
    if (report.status !== 'running' && (report.stage === 'Validate' || report.stage === 'Test')) {
      runInBackground($, mod, report.stage)
    } else {
      void scan($, true).catch(() => undefined)
    }
    return { result: `Mod Lab: ${mod} ${report.stage} ${report.status}.` }
  }).catch(() => ({ result: 'Mod Lab: noted (the lab could not update just now).' }))

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) void rerunStale($).catch(() => undefined)
    return next(e)
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) await update($, readme, () => null)
    return next(e)
  }).catch(($, e, next) => next(e))

  // ── Drawing ─────────────────────────────────────────────────────────────

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Markdown } = $.ui.resolve(e)
    const layout = Lab.layoutOf(e.props.bodyColumns)
    if (layout === 'none') {
      void warnNarrowOnce($).catch(() => undefined)
      return <Box />
    }
    void clearNarrowWarning($).catch(() => undefined)

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
      demo: () => void toggleDemo($).catch(() => undefined),
      newMod: () => void $.prompt.fill({ text: '/mod-builder:build ' }).catch(() => undefined),
      next: () => void moveSelection($, 1).catch(() => undefined),
      prev: () => void moveSelection($, -1).catch(() => undefined),
      run: (kind: RunKind) => () => runInBackground($, current?.name ?? null, kind),
      readme: () => void showReadme($, current?.name ?? null).catch(() => undefined),
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
            button('back', 'b', 'Back', () => void update($, readme, () => null).catch(() => undefined)),
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
            <Box key="d-fix">{button('fix', 'f', 'Fix with Claude', () => void fillFix($, current).catch(() => undefined), { primary: true })}</Box>
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
    } catch {
      return rest
    }
  })
}

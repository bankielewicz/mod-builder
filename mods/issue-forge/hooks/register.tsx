import { atom, read, update } from 'claude-code'
import type { EngineInterface, ProcessRunResult, Register } from 'claude-code'

import {
  AGENT_DESCRIPTIONS,
  DEFAULT_COMMAND_MINUTES,
  DEMO_STATES,
  NAME,
  PHASES,
  PROFILE_FILE,
  STASH_LIST_ARGV,
  TAKE_OVER,
  USAGE,
  advance,
  afterBlock,
  agentName,
  isInlineAnswer,
  agentsKey,
  agentPrompt,
  badgeOf,
  baseOf,
  baseRefOf,
  baseRemoteOf,
  baseRemoteOfRun,
  branchLine,
  branchName,
  canRetry,
  checkoutBaseOf,
  checkoutState,
  checkoutWorkspaceOf,
  cleanupLine,
  commitMessage,
  commonDirOf,
  coverageLine,
  demoRun,
  elsewhereLine,
  elsewhereText,
  findStash,
  foreignChange,
  forkOfOrigin,
  forkRemoteVerdict,
  gateG,
  gateR,
  guardAction,
  hasSourceRecord,
  hasStash,
  headArg,
  hostOf,
  isAbsolutePath,
  isActive,
  isDrivenElsewhere,
  isForkOf,
  isLockError,
  isOwnHandback,
  isOwnMailboxHandback,
  isPluginManifest,
  isPrunable,
  isPullUrl,
  isSameRepo,
  isWorking,
  isWorktreeRun,
  issueLabel,
  keepText,
  keptForkBlock,
  keptWorktreePlan,
  layoutOf,
  lcovFileOf,
  legacyAgentsKey,
  lineOf,
  lockPathOf,
  manifestOf,
  mergeLine,
  migrationPlan,
  newModLine,
  newModReply,
  newPluginGate,
  newPluginOf,
  newPluginRecord,
  newPluginRefusal,
  newRun,
  nextDemoState,
  normalizePath,
  othersLine,
  othersOf,
  outsideChecks,
  ownerOf,
  parseCommand,
  parseLcov,
  parseMergeTree,
  parseProfile,
  parseRunKey,
  phasePrompt,
  phaseRows,
  pickRun,
  prBody,
  profileProblems,
  profileStatusText,
  promptExtraOf,
  pruneKeys,
  publishAsk,
  paneAction,
  pressQuestion,
  publishQuestion,
  readdWorktreeCommand,
  releasesOnEnd,
  remoteVerdict,
  repoLabel,
  repoOfView,
  repoAgentsKeys,
  repoRunKeys,
  routedRedBlock,
  runKey,
  severalText,
  sharedLcovBlock,
  spawnRefs,
  splitZ,
  sshHostToResolve,
  sshHostname,
  stashApplyArgv,
  stashMessage,
  startAnswer,
  startChoices,
  statusText,
  tailLines,
  takeOverQuestion,
  totals,
  truncate,
  unstagedOf,
  viewOf,
  withRefusal,
  workOf,
  workspacePlan,
  worktreeAddFailure,
  worktreePath,
  worktreeStateOf,
} from './issue-forge-logic'
import type { Activity, BaseRemote, CheckoutState, Command, CommandResult, DemoState, DemoView, Gate, Kept, KeptWorktreePlan, LegacyEntry, LineContext, MergeCheck, OtherRun, Phase, Profile, RemoteFound, RemoteVerdict, Run, RunEvent, RunPick, StashRef, Step, Tone, TurnEnd } from './issue-forge-logic'

/**
 * Issue Forge: one GitHub issue to a pull request, test-first (SPEC.md "How it works").
 * Every `$` call lives here; every rule lives in issue-forge-logic.ts.
 */

const PANE = 'issue-forge'
const TITLE = 'Issue Forge'
/** The pane as every open asks for it; bringing it to the front adds only `focus`. */
const PANE_ARGS = { id: PANE, title: TITLE, columns: 76 }
const SHOW_TEXT = 'bringing the pane to the front; it takes the keyboard if your prompt is empty (Esc gives it back).'
const STILL_BEHIND_TOAST = `${TITLE} is still behind another tab: ctrl+x tab, then again until it shows.`
/** After a start or a resume opened the pane behind another tab: where it is and how to reach it. */
const BEHIND_TEXT = 'its pane is behind another tab (ctrl+x tab, then again until it shows)'
/** How long after asking for the front the pane is read again (#31). */
const FRONT_CHECK_MS = 500
const GIT_TIMEOUT = 60_000
/** The attempts a git call that writes the index or a ref makes against a held lock, a second apart (#28). */
const LOCK_ATTEMPTS = 5
const LOCK_WAIT_MS = 1000
/** Why a phase agent's report is kept from the main model: shown for prompt.submit's drop, only logged for session.receive's consumed (d.ts). */
const HANDBACK_DROP = 'issue-forge: a phase agent finished; the pane has the result.'
const COLORS: Record<Tone, string | undefined> = { success: '#7FB685', accent: '#D97757', warn: '#E0B15A', error: '#E06C6C', dim: undefined }

const runAtom = atom({ plugin: 'issue-forge', key: 'run' } as const, null)
const activityAtom = atom({ plugin: 'issue-forge', key: 'activity' } as const, null)
const nowAtom = atom({ plugin: 'issue-forge', key: 'now' } as const, 0)
const demoAtom = atom({ plugin: 'issue-forge', key: 'demo' } as const, null)
/** The issue whose run the pane shows: the one this session last started, resumed, published, stopped or asked about (Change 0.3.0). */
const focusAtom = atom({ plugin: 'issue-forge', key: 'focus' } as const, null)
/** The repository's other active runs: the pane's also line. */
const othersAtom = atom({ plugin: 'issue-forge', key: 'others' } as const, [] as OtherRun[])

type Options = { redModel: string; greenModel: string; refactorModel: string; redAgentType: string; confirmPublish: boolean }

let options: Options = { redModel: 'opus', greenModel: 'sonnet', refactorModel: 'opus', redAgentType: 'issue-forge:red', confirmPublish: true }
let sessionCwd = ''
/** Whether a person is at the prompt: a dismissed start menu then means Cancel (PR #51 review). */
let isInteractive = true
let home = ''
/** This session's id, read once at session start: what a run's driver names (Change 0.3.0). */
let sessionId = ''
/** The issue the pane shows, kept in the module: /clear, /resume and /branch reset focusAtom (#119). */
let focusKept: number | null = null
/** The drive's activity line, kept in the module for the same reason (#119). */
let activityKept: Activity | null = null
/**
 * A drive: its run, the run's store key and issue, whether it was stopped or handed off, and its generation. A new
 * drive of the same run (a hand-off, then a resume) has a new one, so the old drive's step in flight fails every
 * ownership check (PR #51 review).
 */
type Drive = { runId: string; key: string; issue: number; isStopped: boolean; gen: number }
/** The run as a drive hands it to a step: stamped with the drive's generation (never stored). */
type Stamped = Run & { driveGen: number }
let drives = 0
/** The run this module is driving (one per session); null after a reload (the run then reads as interrupted). */
let driving: Drive | null = null
/** The driven run as last written: the status line's badge. */
let drivenLast: Run | null = null
/** The run whose drive has its publish question open; a Publish or Stop press then asks no second one (PR #96 review). */
let publishAsking: string | null = null
/** Ends the long command running now (a stop, or its timeout). */
let stopCommand: (() => void) | null = null
/** The one agent of the run allowed to call tools; the run's other agents are refused (SPEC 9). */
let liveAgent: string | null = null
/** The live agent's run: where the guard keeps it (Change 0.2.0; an agent's cwd is ignored, P4). */
let liveWork: { root: string; workRoot: string; testGlobs: readonly string[]; baseManifests: readonly string[] } | null = null
/**
 * Every agent id and name a run of this repository has started, in memory for the tool.call guard
 * and the hand-back drop, and in the store so a new run or a reload never forgets one (an agent
 * can't be ended, only refused).
 */
let knownRefs = new Set<string>()
/** The last run write queued: updateRun chains each one after it. */
let runWrites: Promise<void> = Promise.resolve()
/** Where git keeps each folder's lock files, asked once per folder and file (PR #88 review). */
const lockFiles: Record<string, string> = {}
/** An agent's final answer and how its turn ended, for the phase waiting on it. */
type AgentTurn = { answer: string; reason?: TurnEnd }
const waiting: Record<string, { resolve: (turn: AgentTurn) => void; reject: (err: Error) => void }> = {}

function readOptions(raw: unknown): Options {
  const o = (raw ?? {}) as Record<string, unknown>
  const text = (key: string, fallback: string) => (typeof o[key] === 'string' && (o[key] as string).trim() !== '' ? (o[key] as string).trim() : fallback)
  return {
    redModel: text('redModel', 'opus'),
    greenModel: text('greenModel', 'sonnet'),
    refactorModel: text('refactorModel', 'opus'),
    redAgentType: text('redAgentType', 'issue-forge:red'),
    confirmPublish: o.confirmPublish !== false && o.confirmPublish !== 'false',
  }
}

const MAX_KNOWN = 500

/** A run's store key; runs stored before 0.3.0 had no repo until session start moved them. */
const keyOf = (run: Run) => runKey(run.repo ?? run.root, run.issue)

function refsOf(run: Run | null): string[] {
  return run ? run.agents.flatMap(a => (a.name ? [a.id, a.name] : [a.id])) : []
}

// ── Outside world ─────────────────────────────────────────────────────────

/** git takes no optional locks, so the run's own `git status` doesn't refresh the index while an agent's or the user's git needs it (#28). */
const GIT_ENV = { GIT_OPTIONAL_LOCKS: '0' }

async function git($: EngineInterface, root: string, args: string[], stdin?: string) {
  return $.process.run(['git', ...args], { cwd: root, timeoutMs: GIT_TIMEOUT, env: GIT_ENV, ...(stdin === undefined ? {} : { stdin }) })
}

/**
 * git that another process may hold a lock against (a parallel run's fetch): retried twice at once (Change 0.3.0).
 * A fetch spends seconds on the network first, so the other is done. The index has gitWrite (#28).
 */
async function gitRetry($: EngineInterface, root: string, args: string[], stdin?: string) {
  let r = await git($, root, args, stdin)
  for (let i = 0; i < 2 && r.exitCode !== 0 && isLockError(`${r.stderr}\n${r.stdout}`); i++) r = await git($, root, args, stdin)
  return r
}

/** A git call's output: a failure throws, naming the subcommand and the first line git printed. */
function outputOf(args: string[], r: ProcessRunResult): string {
  if (r.exitCode !== 0) throw new Error(`git ${args[0]} failed: ${firstLine(r.stderr || r.stdout)}`)
  return r.stdout
}

async function gitOut($: EngineInterface, root: string, args: string[]): Promise<string> {
  return outputOf(args, await git($, root, args))
}

/** Thrown when a git lock (the index's or a ref's) is still held after the last attempt: the drive blocks with its reason and next step. */
class Locked extends Error {
  readonly next: string
  constructor(lockPath: string) {
    super(`another git process is using ${lockPath} (${LOCK_ATTEMPTS} attempts over ${((LOCK_ATTEMPTS - 1) * LOCK_WAIT_MS) / 1000} s)`)
    this.next = `wait for the other git process to finish, or delete ${lockPath} if none is running`
  }
}

/**
 * git that writes the index or a ref (add, commit, stash, switch, merge): another process holding .git/index.lock, or a
 * ref's lock, fails it at once, so a failure caused by a lock waits a second and tries again, five attempts in all (#28,
 * PR #88 review). Stash prints nothing when it meets the index lock, so that file is looked for too. Any other failure
 * comes back as it is.
 */
async function gitWrite($: EngineInterface, run: Run, root: string, args: string[], stdin?: string) {
  // Known before the call: a lock file is a silent failure's only sign, and the other process may let it go soon after.
  // stash push names no lock when refs/stash's is held (git 2.53: only "Cannot save the current status").
  const files = [await lockFileOf($, root, 'index.lock'), ...(args[0] === 'stash' && args[1] === 'push' ? [await lockFileOf($, root, 'refs/stash.lock')] : [])]
  for (let attempt = 1; ; attempt++) {
    const r = await git($, root, args, stdin)
    if (r.exitCode === 0) return r
    const text = `${r.stderr}\n${r.stdout}`
    const held = lockPathOf(text) ?? (await heldOf($, files))
    if (!held && !isLockError(text)) return r
    // A lock refusal that no lock file explains (a broken ref) comes back as git said it once the attempts are spent.
    if (attempt === LOCK_ATTEMPTS) {
      if (!held) return r
      throw new Locked(held)
    }
    await lockWait($)
    // The 5 s watch is too slow for a takeover during the waits: the stored run is read before each attempt.
    await stillOwned($, run)
  }
}

/**
 * One of the folder's lock files: a linked worktree's index lock is under the main .git folder, and refs/stash is
 * shared by every worktree, so git says where. Without `--path-format=absolute`, which git before 2.31 prints back
 * instead of reading, so a relative answer is joined here.
 */
async function lockFileOf($: EngineInterface, root: string, name: 'index.lock' | 'refs/stash.lock'): Promise<string> {
  const key = `${root}\0${name}`
  const known = lockFiles[key]
  if (known) return known
  const r = await git($, root, ['rev-parse', '--git-path', name])
  const path = r.exitCode === 0 ? r.stdout.trim() : ''
  if (!path) return `${root}/.git/${name}`
  return (lockFiles[key] = isAbsolutePath(path) ? path : `${root}/${path}`)
}

/** The first of `files` that exists, or null. */
async function heldOf($: EngineInterface, files: string[]): Promise<string | null> {
  for (const file of files) if (await $.fs.exists(file)) return file
  return null
}

/**
 * The second between lock attempts, as a timer: `$.clock.sleep` would count against a hook's budget. The timer may never
 * fire (a hook refuses it, a reload cancels it), so a Stop, hand-off or takeover ends the wait itself, as it ends a command.
 */
async function lockWait($: EngineInterface): Promise<void> {
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = $.clock.after(LOCK_WAIT_MS, () => resolve())
      stopCommand = () => {
        timer.cancel()
        reject(new Stopped())
      }
    })
  } finally {
    stopCommand = null
  }
}

/** gitWrite for a call that must succeed: a failure throws, as gitOut's does. */
async function gitWriteOut($: EngineInterface, run: Run, root: string, args: string[], stdin?: string): Promise<string> {
  return outputOf(args, await gitWrite($, run, root, args, stdin))
}

function firstLine(text: string): string {
  return text.trim().split('\n')[0] ?? ''
}

async function rootOf($: EngineInterface): Promise<string | null> {
  const r = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { cwd: sessionCwd || undefined, timeoutMs: GIT_TIMEOUT, env: GIT_ENV }).catch(() => null)
  return r && r.exitCode === 0 ? r.stdout.trim() : null
}

/** The session's checkout and git's common folder, which every worktree of the repository shares (Change 0.3.0). */
type Repo = { root: string; repo: string }

async function repoOf($: EngineInterface): Promise<Repo | null> {
  const root = await rootOf($)
  if (!root) return null
  const r = await git($, root, ['rev-parse', '--git-common-dir']).catch(() => null)
  const repo = r && r.exitCode === 0 ? commonDirOf(root, r.stdout) : null
  return repo ? { root, repo } : null
}

async function loadRun($: EngineInterface, key: string): Promise<Run | null> {
  return ((await $.store.get(key)) as Run | undefined) ?? null
}

/** The repository's runs, read from the store each time: other sessions write it too. */
async function listRuns($: EngineInterface, repo: string): Promise<{ key: string; run: Run }[]> {
  const out: { key: string; run: Run }[] = []
  for (const key of repoRunKeys(await $.store.keys(), repo)) {
    const run = await loadRun($, key)
    if (run) out.push({ key, run })
  }
  return out
}

async function runsOf($: EngineInterface, repo: string): Promise<Run[]> {
  return (await listRuns($, repo)).map(e => e.run)
}

/**
 * Every write of a stored run, one at a time, so none is computed from a read another write has since made stale
 * (PR #41 round 4). `change` gets the run as stored now and returns what to store, or null to write nothing.
 * Resolves to the run written, or null.
 */
async function updateRun($: EngineInterface, key: string, change: (stored: Run | null) => Run | null): Promise<Run | null> {
  const before = runWrites
  let done = () => {}
  runWrites = new Promise<void>(resolve => (done = resolve))
  try {
    await before
    const next = change(await loadRun($, key))
    if (!next) return null
    await $.store.set(key, next)
    await reflect($, next)
    return next
  } finally {
    done()
  }
}

/** A run just written: its agents are known, the pane redraws it when it is the one shown, the badge when it is driven. */
async function reflect($: EngineInterface, run: Run): Promise<void> {
  for (const ref of refsOf(run)) knownRefs.add(ref)
  if (driving && run.id === driving.runId) drivenLast = run
  if ((await read($, focusAtom)) === run.issue) await update($, runAtom, () => run)
}

/** Another session drives the stored run now: it took it over (Change 0.3.0). */
function isTakenOver(stored: Run): boolean {
  return !!stored.driver && stored.driver.session !== sessionId
}

/**
 * A drive's write, by generation `gen`. Resolves to the run written, or null when it was dropped: the drive then has
 * nothing left to drive. A stop wins every race, a write lands only on the same run, never on one another session
 * took over (Change 0.3.0), and never from a drive that was stopped, handed off or replaced (PR #51 review). A refusal
 * the guard stored meanwhile is kept (Codex 4290653342).
 */
async function saveRun($: EngineInterface, run: Run, gen: number): Promise<Run | null> {
  return updateRun($, keyOf(run), stored =>
    !stored || stored.id !== run.id || (run.step !== 'stopped' && stored.step === 'stopped') || isTakenOver(stored) || driving?.gen !== gen || driving.isStopped ? null : withRefusal(stored, run),
  )
}

/**
 * The branch and folder preflight just made, written onto the stored run at once, even over a stop, so a
 * Stop pressed before preflight returns never loses them (Codex, PR #41 round 3). Never onto a run another
 * session took over meanwhile: it makes its own (Codex 4278707576).
 */
async function recordMade($: EngineInterface, run: Run, made: Kept): Promise<void> {
  const now = await $.clock.now()
  await updateRun($, keyOf(run), stored => (stored?.id === run.id && !isTakenOver(stored) ? advance(stored, { type: 'made', keep: made }, now) : null))
}

/** A number start's repository, written onto the stored run at once, as recordMade writes the branch (PR #68 review 2). */
async function recordPinned($: EngineInterface, run: Run, repo: string): Promise<void> {
  const now = await $.clock.now()
  await updateRun($, keyOf(run), stored => (stored?.id === run.id && !isTakenOver(stored) ? advance(stored, { type: 'pinned', repo }, now) : null))
}

/** Adds agents to the run's known list (memory and store); they are refused tools unless live. */
async function rememberAgents($: EngineInterface, run: Run, refs: readonly string[]): Promise<void> {
  for (const ref of refs) knownRefs.add(ref)
  const key = agentsKey(run.repo ?? run.root, run.issue)
  const stored = ((await $.store.get(key)) as string[] | undefined) ?? []
  const merged = [...new Set([...stored, ...refs])].slice(-MAX_KNOWN)
  await $.store.set(key, merged)
}

async function setActivity($: EngineInterface, label: string | null): Promise<void> {
  const since = await $.clock.now()
  const activity = label ? { label, since } : null
  activityKept = activity
  await update($, activityAtom, () => activity)
}

/**
 * A long command (tests, coverage, checks) through `$.process.spawn`, killed at the profile's
 * timeout by ending its stream (C0 P3). Where spawn can't start (always under `claude plugin
 * test`), the same command runs through `$.process.run`, capped at ten minutes.
 */
async function runLong($: EngineInterface, argv: string[], root: string, minutes: number, env?: Record<string, string>): Promise<CommandResult> {
  let text = ''
  let isTimedOut = false
  let isStopped = false
  let hasStarted = false
  const stream = $.process.spawn({ argv, cwd: root, ...(env ? { env } : {}) })
  const end = () => void stream.return(undefined as never).catch(() => undefined)
  const timer = $.clock.after(minutes * 60_000, () => {
    isTimedOut = true
    end()
  })
  stopCommand = () => {
    isStopped = true
    end()
  }
  try {
    let result: CommandResult
    try {
      for await (const piece of stream) {
        hasStarted = true
        text = (text + piece.text).slice(-200_000)
      }
      if (isTimedOut || isStopped) result = { exit: null, isTimedOut, tail: tailLines(text) }
      else result = { exit: (await stream.result).code, isTimedOut: false, tail: tailLines(text) }
    } catch (err) {
      result = hasStarted || isTimedOut || isStopped ? { exit: null, isTimedOut, tail: tailLines(text) } : await runShort($, argv, root, minutes, err, env)
    }
    if (isStopped) throw new Stopped()
    return result
  } finally {
    timer.cancel()
    stopCommand = null
  }
}

/** Thrown when /issue-forge stop (or a takeover) ends the run mid-step: nothing after it may change the repository. */
class Stopped extends Error {
  constructor() {
    super('stopped')
  }
}

/** Whether this module is still driving `run`: false once it was stopped, or another drive (a later one included) took it over. */
function isDriving(run: Run): boolean {
  return driving !== null && driving.runId === run.id && !driving.isStopped && (run as Partial<Stamped>).driveGen === driving.gen
}

function stillDriving(run: Run): void {
  if (!isDriving(run)) throw new Stopped()
}

/** Before a commit or a stash: a run another session stopped, took over or replaced is left alone (Change 0.3.0). */
async function stillOwned($: EngineInterface, run: Run): Promise<void> {
  stillDriving(run)
  if (foreignChange(await loadRun($, keyOf(run)), run.id, sessionId)) {
    endLocalDrive()
    throw new Stopped()
  }
}

/** Ends this session's drive at once, as a Stop does, writing nothing: the command is ended and the agent refused. */
function endLocalDrive(): void {
  if (driving) driving.isStopped = true
  stopCommand?.()
  liveAgent = null
  liveWork = null
  for (const [id, w] of Object.entries(waiting)) {
    delete waiting[id]
    w.reject(new Error('stopped'))
  }
}

/** The drive under way in this session, if any (a stopped or handed-off one isn't). */
function drivingNow(): Drive | null {
  return driving && !driving.isStopped ? driving : null
}

async function hasBranch($: EngineInterface, root: string, branch: string): Promise<boolean> {
  return (await git($, root, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])).exitCode === 0
}

/** A gate commits only on the run's own branch: an agent may have switched branches. */
async function offBranch($: EngineInterface, run: Run): Promise<Blocked | null> {
  const head = (await gitOut($, workOf(run), ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
  return head === run.branch ? null : block(`HEAD is on ${head}, not ${run.branch}`, `git switch ${run.branch}`)
}

async function runShort($: EngineInterface, argv: string[], root: string, minutes: number, why: unknown, env?: Record<string, string>): Promise<CommandResult> {
  try {
    const r = await $.process.run(argv, { cwd: root, timeoutMs: Math.min(minutes * 60_000, 600_000), ...(env ? { env } : {}) })
    return { exit: r.exitCode, isTimedOut: false, tail: tailLines(`${r.stdout}\n${r.stderr}`) }
  } catch (err) {
    return { exit: null, isTimedOut: /time/i.test(String(err)), tail: `could not run ${argv.join(' ')}: ${String(err)} (spawn: ${String(why)})` }
  }
}

/** The LCOV file's text if the coverage command wrote it after `since`; a stale or missing file is null. */
async function readLcov($: EngineInterface, path: string, since: number): Promise<string | null> {
  try {
    const st = await $.fs.stat(path)
    if (st.mtimeMs < since - 2000) return null
    return await $.fs.read(path)
  } catch {
    return null
  }
}

async function commitAll($: EngineInterface, run: Run, message: string): Promise<string | undefined> {
  await stillOwned($, run)
  const root = workOf(run)
  const staged = await git($, root, ['diff', '--cached', '--quiet'])
  if (staged.exitCode === 0) return undefined
  await gitWriteOut($, run, root, ['commit', '-q', '-F', '-'], message)
  return (await gitOut($, root, ['rev-parse', 'HEAD'])).trim()
}

/** Stashes the tree under a unique message and records the entry's SHA (the list is shared by every worktree). */
async function stashAll($: EngineInterface, run: Run, message: string): Promise<StashRef | undefined> {
  await stillOwned($, run)
  const root = workOf(run)
  await gitWriteOut($, run, root, ['stash', 'push', '--include-untracked', '-m', message])
  const sha = findStash(await gitOut($, root, STASH_LIST_ARGV.slice(1)), message)
  return sha ? { sha, message } : undefined
}

// ── Steps ─────────────────────────────────────────────────────────────────

type Blocked = Extract<RunEvent, { type: 'block' }>
const block = (reason: string, next: string): Blocked => ({ type: 'block', reason, next })

async function authCheck($: EngineInterface, run: Run): Promise<Blocked | null> {
  const auth = await $.process.run(['gh', 'auth', 'status'], { cwd: run.root, timeoutMs: GIT_TIMEOUT }).catch(() => null)
  return !auth || auth.exitCode !== 0 ? block('gh is not signed in', 'run gh auth login') : null
}

/** `gh issue view` of an issue, in `repo` when one is named, else in the repository gh resolves. */
const issueViewArgv = (issue: number, repo: string | null | undefined): string[] => ['gh', 'issue', 'view', String(issue), ...(repo ? ['--repo', repo] : []), '--json', 'number,title,body,state,url']

/** The issue as gh reads it from `repo` (the run's pinned repository, or gh's own choice for a run stored before #25). */
async function issueCheck($: EngineInterface, run: Run, repo: string | null): Promise<Blocked | { title: string; body: string; url: string }> {
  const view = await $.process.run(issueViewArgv(run.issue, repo), { cwd: run.root, timeoutMs: GIT_TIMEOUT })
  if (view.exitCode !== 0) return block(`issue #${run.issue} not found: ${firstLine(view.stderr)}`, 'check the issue number or URL')
  const issue = JSON.parse(view.stdout) as { title: string; body: string; state: string; url: string }
  // gh issue view answers for a pull request's number too.
  // Final: a pull request's number never becomes an issue's, so resume can't clear it (Change 0.7.0).
  if (isPullUrl(issue.url)) return { ...block(`#${run.issue} is a pull request, not an issue`, 'pick another issue'), isFinal: true }
  if (issue.state !== 'OPEN') return block(`issue #${run.issue} is ${issue.state.toLowerCase()}`, 'reopen it or pick another issue')
  return { title: issue.title, body: issue.body ?? '', url: issue.url }
}

/** The GitHub repository gh resolves in `root` (`host/owner/repo`), or why it can't say. */
async function ghRepoOf($: EngineInterface, root: string): Promise<Blocked | { repo: string }> {
  const view = await $.process.run(['gh', 'repo', 'view', '--json', 'nameWithOwner,url'], { cwd: root, timeoutMs: GIT_TIMEOUT }).catch(() => null)
  if (!view || view.exitCode !== 0) return block(`could not tell which GitHub repository this checkout belongs to: ${firstLine(view?.stderr ?? 'gh repo view did not finish')}`, 'give the checkout a GitHub remote named origin')
  const repo = repoOfView(view.stdout)
  return repo ? { repo } : block("could not read gh repo view's output", 'check gh')
}

/**
 * Whether a remote URL names `repo`. The URL itself is parsed here and never passed on: it can hold a token. A renamed or
 * transferred repository differs from the URL, so gh is asked for the name it gives `host/owner/repo`.
 */
async function remoteRepo($: EngineInterface, root: string, url: string, repo: string, views: Views = new Map()): Promise<RemoteFound> {
  return foundOf($, root, remoteVerdict(url, repo), repo, views)
}

/**
 * `remoteRepo` for a fork clone's remotes (the fork, the base remote): an ssh host other than `repo`'s is resolved with
 * `ssh -G`, never taken for a nickname (PR #87 review, the owner's choice).
 */
async function forkRemoteRepo($: EngineInterface, root: string, url: string, repo: string, views: Views = new Map()): Promise<RemoteFound> {
  const host = sshHostToResolve(url, repo)
  return foundOf($, root, forkRemoteVerdict(url, repo, host === null ? undefined : await sshHostOf($, root, host)), repo, views)
}

/** `ssh -G <host>`: the host ssh reaches for it, ~/.ssh/config applied, without connecting; null when ssh can't say. */
async function sshHostOf($: EngineInterface, root: string, host: string): Promise<string | null> {
  const shown = await $.process.run(['ssh', '-G', host], { cwd: root, timeoutMs: GIT_TIMEOUT }).catch(() => null)
  return shown?.exitCode === 0 ? sshHostname(shown.stdout) : null
}

/** A verdict settled: another repository on `repo`'s host is asked about, since gh may call it `repo` renamed. */
async function foundOf($: EngineInterface, root: string, verdict: RemoteVerdict, repo: string, views: Views): Promise<RemoteFound> {
  if (verdict.kind === 'match') return 'match'
  if (verdict.kind === 'unrecognised') return { other: null }
  if (verdict.kind === 'other') return { other: verdict.repo }
  const canonical = await canonicalOf($, root, verdict.repo, views)
  return isSameRepo(canonical, repo) ? 'match' : { other: canonical ?? verdict.repo }
}

/** gh's names for `host/owner/repo`s, asked once each within one check (PR #87 review). */
type Views = Map<string, Promise<string | null>>

/** The name gh gives `host/owner/repo` (a renamed or transferred repository's new one), or null when gh can't say. */
function canonicalOf($: EngineInterface, root: string, repo: string, views: Views): Promise<string | null> {
  const known = views.get(repo)
  if (known) return known
  const asked = $.process
    .run(['gh', 'repo', 'view', repo, '--json', 'nameWithOwner,url'], { cwd: root, timeoutMs: GIT_TIMEOUT })
    .then(view => (view.exitCode === 0 ? repoOfView(view.stdout) : null))
    .catch(() => null)
  views.set(repo, asked)
  return asked
}

/** The distinct, non-empty lines of a command's output, in order. */
function linesOf(stdout: string): string[] {
  return [...new Set(stdout.split('\n').map(line => line.trim()).filter(line => line !== ''))]
}

/** `git remote get-url --push --all origin`: every URL git pushes origin to, one line each, and git's exit code. */
async function pushUrlsOf($: EngineInterface, root: string): Promise<{ exitCode: number; urls: string[] }> {
  const pushed = await git($, root, ['remote', 'get-url', '--push', '--all', 'origin'])
  return { exitCode: pushed.exitCode, urls: linesOf(pushed.stdout) }
}

/** Origin's fetch URL and every URL git pushes it to, or null without an origin. Kept in memory only: a URL can hold a token. */
type OriginUrls = { fetch: string; pushes: string[] }

async function originUrls($: EngineInterface, root: string): Promise<OriginUrls | null> {
  const fetched = await git($, root, ['remote', 'get-url', 'origin'])
  const pushed = await pushUrlsOf($, root)
  return fetched.exitCode !== 0 || pushed.exitCode !== 0 ? null : { fetch: fetched.stdout.trim(), pushes: pushed.urls }
}

/**
 * Origin fetches from and pushes to `repo`, the repository gh sends the issue and the pull request to. git pushes to every push
 * URL, so each is checked (PR #68 review), and one that is the fetch URL only once. Preflight passes the URLs it read.
 */
async function originCheck($: EngineInterface, root: string, repo: string, read?: OriginUrls | null, views: Views = new Map()): Promise<Blocked | null> {
  const urls = read === undefined ? await originUrls($, root) : read
  if (!urls) return block('this checkout has no remote named origin', `add a remote named origin for ${repoLabel(repo)}`)
  const fetchUrl = urls.fetch
  const pushUrls = urls.pushes.filter(u => u !== fetchUrl)
  for (const [url, isPush] of [[fetchUrl, false] as const, ...pushUrls.map(u => [u, true] as const)]) {
    const found = await remoteRepo($, root, url, repo, views)
    if (found === 'match') continue
    const label = found.other === null ? 'an unrecognised URL' : repoLabel(found.other)
    const next = found.other === null ? `give origin an https, http or ssh URL for ${repoLabel(repo)}` : `work from a clone whose origin is ${repoLabel(repo)}, or whose origin is your fork of ${repoLabel(repo)} with another remote for ${repoLabel(repo)}`
    return block(`origin ${isPush ? 'pushes to' : 'fetches from'} ${label}, but gh sends issues and pull requests to ${repoLabel(repo)}`, next)
  }
  return null
}

/** A fork clone's remotes (#26): the one the base is fetched from, and the fork origin pushes to (`host/owner/repo`). */
type Fork = { baseRemote: string; headRepo: string }

/** The fork origin pushes to, from the URLs preflight read: each is resolved once, all at once (PR #87 review). */
async function forkOf($: EngineInterface, root: string, repo: string, urls: OriginUrls | null, views: Views): Promise<string | null> {
  if (!urls) return null
  const unique = [...new Set([urls.fetch, ...urls.pushes])]
  const found = new Map((await Promise.all(unique.map(url => forkRemoteRepo($, root, url, repo, views)))).map((f, i) => [unique[i], f]))
  const of = (url: string) => found.get(url) ?? { other: null }
  return forkOfOrigin(of(urls.fetch), urls.pushes.map(of), repo)
}

/** Whether remote `name`'s fetch URL names `repo`. */
async function remoteNames($: EngineInterface, root: string, name: string, repo: string, views: Views): Promise<boolean> {
  const url = await git($, root, ['remote', 'get-url', name])
  return url.exitCode === 0 && (await forkRemoteRepo($, root, url.stdout.trim(), repo, views)) === 'match'
}

/** The remotes besides origin whose fetch URL names `repo`, looked up together: a fork clone fetches the base from the one there is. */
async function baseRemoteFor($: EngineInterface, root: string, repo: string, views: Views): Promise<BaseRemote> {
  const names = linesOf((await git($, root, ['remote'])).stdout).filter(n => n !== 'origin')
  const named = await Promise.all(names.map(name => remoteNames($, root, name, repo, views)))
  return baseRemoteOf(names.filter((_, i) => named[i]))
}

/**
 * A clone whose origin isn't `repo` may be a fork clone (#26): origin pushes to a fork of `repo` and another remote is `repo`. The
 * fork must be a user's, not an organization's, which `gh pr create --head` can't name. This runs before anything is fetched. Any
 * other clone gets `stray`, the origin block.
 */
async function forkCheck($: EngineInterface, root: string, repo: string, stray: Blocked, urls: OriginUrls | null, views: Views): Promise<Blocked | Fork> {
  const headRepo = await forkOf($, root, repo, urls, views)
  if (!headRepo) return stray
  const base = await baseRemoteFor($, root, repo, views)
  if (base.kind === 'none') return stray
  if (base.kind === 'several') return block(`remotes ${base.remotes.slice(0, -1).join(', ')} and ${base.remotes.slice(-1).join('')} both point at ${repoLabel(repo)}`, 'remove one of them')
  const view = await $.process.run(['gh', 'repo', 'view', headRepo, '--json', 'isFork,parent'], { cwd: root, timeoutMs: GIT_TIMEOUT }).catch(() => null)
  if (!view || view.exitCode !== 0) return block(`could not read ${repoLabel(headRepo)} from gh: ${firstLine(view?.stderr ?? 'gh repo view did not finish')}`, 'check gh and your access to the fork')
  if (!isForkOf(view.stdout, repo)) return block(`origin ${repoLabel(headRepo)} isn't a fork of ${repoLabel(repo)}`, `point origin at your fork of ${repoLabel(repo)}`)
  const owner = ownerOf(headRepo)
  // gh api asks github.com unless told the host (Codex on PR #87).
  const type = await $.process.run(['gh', 'api', '--hostname', hostOf(headRepo), `users/${owner}`, '--jq', '.type'], { cwd: root, timeoutMs: GIT_TIMEOUT }).catch(() => null)
  if (!type || type.exitCode !== 0) return block(`could not tell whether ${owner} is a user or an organization: ${firstLine(type?.stderr ?? 'gh api did not finish')}`, 'check gh')
  if (type.stdout.trim() === 'Organization') return block("gh pr create can't name an organization's fork as the head (cli/cli#10093)", `point origin at a fork in a personal account, not ${owner}'s`)
  return { baseRemote: base.remote, headRepo }
}

/** A fork run's origin still pushes only to the fork it was preflighted for: git pushes to every push URL (#26). */
async function forkPushCheck($: EngineInterface, root: string, headRepo: string): Promise<Blocked | null> {
  const pushed = await pushUrlsOf($, root)
  const moved = block(`origin no longer pushes to ${repoLabel(headRepo)}`, 'point origin back at it, or start a new run')
  if (pushed.exitCode !== 0 || pushed.urls.length === 0) return moved
  for (const url of pushed.urls) if ((await forkRemoteRepo($, root, url, headRepo)) !== 'match') return moved
  return null
}

/** Origin still pushes where the run's branch goes: the fork it was preflighted for (#26), else `repo` itself (#25). */
async function pushCheck($: EngineInterface, root: string, repo: string | undefined, headRepo: string | undefined): Promise<Blocked | null> {
  if (headRepo) return forkPushCheck($, root, headRepo)
  return repo ? originCheck($, root, repo) : null
}

/** Reads and validates the profile, the outside checks included (§4.2). */
async function loadProfile($: EngineInterface, root: string): Promise<{ profile: Profile | null; errors: string[] }> {
  const path = `${root}/${PROFILE_FILE}`
  if (!(await $.fs.exists(path))) return { profile: null, errors: [] }
  const parsed = parseProfile(await $.fs.read(path), home)
  if (!parsed.profile) return { profile: null, errors: parsed.errors }
  const p = parsed.profile
  const outside = outsideChecks(p, root)
  const isLcovIgnored = outside.lcovInside === null ? null : (await git($, root, ['check-ignore', '-q', '--', outside.lcovInside])).exitCode === 0
  const missing: string[] = []
  for (const c of outside.commands) {
    const found =
      c.kind === 'path'
        ? await $.fs.exists(isAbsolutePath(c.argv0) ? c.argv0 : `${root}/${c.argv0}`)
        : (await $.process.run(['sh', '-c', 'command -v "$1"', '_', c.argv0], { cwd: root, timeoutMs: GIT_TIMEOUT })).exitCode === 0
    if (!found) missing.push(c.argv0)
  }
  const problems = profileProblems(p, { isLcovIgnored, missing })
  return problems.length > 0 ? { profile: null, errors: problems } : { profile: p, errors: [] }
}

/**
 * A fork run's base remote still fetches from `repo`, as the folder that fetches reads it: the run stores only its name, and a
 * resume, a kept worktree's own config or the publish merge check would fetch whatever it points at now (Codex on PR #87).
 * Origin is checked by `originCheck` and `pushCheck`.
 */
async function baseRemoteCheck($: EngineInterface, cwd: string, remote: string, repo: string | undefined): Promise<Blocked | null> {
  if (remote === 'origin' || !repo) return null
  const url = await git($, cwd, ['remote', 'get-url', remote])
  if (url.exitCode === 0 && (await forkRemoteRepo($, cwd, url.stdout.trim(), repo)) === 'match') return null
  return block(`${remote} no longer fetches from ${repoLabel(repo)}`, `point ${remote} back at ${repoLabel(repo)}, or start a new run`)
}

/** `git fetch <remote> <base>` once the remote is still `repo`'s, or the block naming why it can't be or failed. */
async function fetchBase($: EngineInterface, cwd: string, remote: string, base: string, repo?: string): Promise<Blocked | null> {
  const moved = await baseRemoteCheck($, cwd, remote, repo)
  if (moved) return moved
  await setActivity($, `git fetch ${remote} ${base}`)
  const fetched = await gitRetry($, cwd, ['fetch', remote, base])
  return fetched.exitCode === 0 ? null : block(`git fetch ${remote} ${base} failed: ${firstLine(fetched.stderr)}`, 'check the base branch and the network')
}

/** A branch with no commits of its own fast-forwards to <remote>/<base>, so a fix pushed there reaches it. */
async function catchUp($: EngineInterface, run: Run, cwd: string, remote: string, base: string): Promise<Blocked | null> {
  const hasNoOwnCommits = (await git($, cwd, ['merge-base', '--is-ancestor', 'HEAD', `${remote}/${base}`])).exitCode === 0
  if (!hasNoOwnCommits) return null
  stillDriving(run)
  await setActivity($, `catching up with ${remote}/${base}`)
  const ff = await gitWrite($, run, cwd, ['merge', '--ff-only', '-q', `${remote}/${base}`])
  return ff.exitCode === 0 ? null : block(`could not fast-forward to ${remote}/${base}: ${firstLine(ff.stderr)}`, 'check the branch')
}

type Where = { kind: 'here' } | { kind: 'worktree'; worktreeDir: string; minutes: number }

/** Whether the session's checkout has changes or isn't on the base: one `git status` and one `rev-parse`. */
async function checkoutOf($: EngineInterface, root: string, base: string, heldBy?: number): Promise<CheckoutState> {
  await setActivity($, 'checking the checkout')
  const porcelain = await gitOut($, root, ['status', '--porcelain'])
  const head = (await gitOut($, root, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
  return checkoutState({ porcelain, head, base, ...(heldBy === undefined ? {} : { heldBy }) })
}

/**
 * Here or in a new worktree (Change 0.2.0). The base's profile decides, read from <remote>/<base> before
 * anything is made or switched; a busy checkout is never branched in place.
 */
async function whereToWork($: EngineInterface, run: Run, root: string, remote: string, base: string): Promise<Blocked | Where> {
  const issue = run.issue
  await setActivity($, `reading ${PROFILE_FILE} from ${remote}/${base}`)
  const shown = await git($, root, ['show', `${remote}/${base}:${PROFILE_FILE}`])
  const atBase = shown.exitCode === 0 ? parseProfile(shown.stdout, home) : { profile: undefined, errors: [firstLine(shown.stderr) || 'missing'] }
  if (!atBase.profile) return block(`${remote}/${base} has no valid ${PROFILE_FILE}: ${atBase.errors[0] ?? 'missing'}`, `commit ${PROFILE_FILE} to ${base}`)
  const { workspace, worktreeDir, commandTimeoutMinutes } = atBase.profile
  // `worktree` makes one whatever the checkout holds, so it isn't looked at (a status is slow on a big tree or a Windows mount).
  // Another active run working in this checkout makes it busy (Change 0.3.0).
  const holder = workspace === 'worktree' ? undefined : (await runsOf($, run.repo ?? root)).find(r => r.id !== run.id && isActive(r) && normalizePath(workOf(r)) === normalizePath(root))
  const state = workspace === 'worktree' ? { isBusy: false, why: '' } : await checkoutOf($, root, base, holder?.issue)
  // Start in the menu under `ask` was the answer to the worktree question: it isn't asked twice.
  const plan = workspacePlan(run.chosenWorktree && workspace === 'ask' ? 'worktree' : workspace, state, base, `${remote}/${base}`)
  if (plan.kind === 'block') return block(plan.reason, plan.next)
  if (plan.kind === 'here') return { kind: 'here' }
  // Everything a worktree needs is checked before anyone is asked for one.
  const routed = routedRedBlock(options.redAgentType, true)
  if (routed) return block(routed.reason, routed.next)
  if ((await git($, root, ['check-ignore', '-q', '--', `${worktreeDir}/`])).exitCode !== 0) return block(`${worktreeDir} isn't gitignored`, `add ${worktreeDir}/ to .gitignore`)
  if (plan.kind === 'ask' && !(await chooseWorktree($, issue, root, state.why, worktreeDir))) {
    return block(`${root} is busy (${state.why}) and no new worktree was chosen`, `answer New worktree in an interactive session, set "workspace" to "worktree" in ${PROFILE_FILE} on ${base}, or clean the checkout`)
  }
  return { kind: 'worktree', worktreeDir, minutes: commandTimeoutMinutes }
}

/**
 * Step 2: the base, where the run works, and the run's branch, cut here or in a new worktree from `remote`'s base. `repo` is
 * the pinned repository: the base question can wait on the person, so the base remote is read again before the fetch.
 */
async function makeBranch($: EngineInterface, run: Run, issueBody: string, remote: string, repo: string, headRepo?: string): Promise<Blocked | Kept> {
  const root = run.root
  // This checkout's profile only names the base; the profile that is checked and runs is <remote>/<base>'s.
  await setActivity($, `reading ${PROFILE_FILE}`)
  const profileBase = checkoutBaseOf(await readLocalProfile($, root))
  const asked = baseOf({ baseBranch: profileBase }, issueBody)
  const base = asked === profileBase ? asked : await chooseBase($, run.issue, asked, profileBase)
  if (!base) return block(`issue #${run.issue} asks for base ${asked}, not ${profileBase}, and nobody confirmed it`, "answer the question in an interactive session, or remove the issue's Base branch line")
  stillDriving(run)
  const unfetched = await fetchBase($, root, remote, base, repo)
  if (unfetched) return unfetched
  const where = await whereToWork($, run, root, remote, base)
  if ('type' in where) return where
  const local = splitZ((await gitOut($, root, ['for-each-ref', '--format=%(refname:short)%00', `refs/heads/issue-${run.issue}-*`, `refs/heads/issue-${run.issue}`])).replace(/\n/g, ''))
  // A fork clone's branch name must be free on the fork it is pushed to and on the project it is cut from (#26).
  const remoteHeads: string[] = []
  for (const name of new Set(['origin', remote])) {
    const listed = await gitOut($, root, ['ls-remote', '--heads', name, `issue-${run.issue}*`])
    remoteHeads.push(...listed.split('\n').map(line => line.split('refs/heads/')[1] ?? '').filter(Boolean))
  }
  const branch = branchName(run.issue, run.title, [...local, ...remoteHeads])
  // A fork clone's branch is kept with the fork its name was checked on, so a resume can't take it elsewhere (Codex on PR #87).
  const forked = headRepo ? { baseRemote: remote, headRepo } : {}
  stillDriving(run)
  if (where.kind === 'here') {
    await setActivity($, `git switch -c ${branch}`)
    const switched = await gitWrite($, run, root, ['switch', '--no-track', '-c', branch, `${remote}/${base}`])
    if (switched.exitCode !== 0) return block(`git switch failed: ${firstLine(switched.stderr)}`, 'check the repository state')
    const here = { branch, workRoot: root, base, ...forked }
    await recordMade($, run, here)
    return here
  }
  const workRoot = worktreePath(root, where.worktreeDir, branch)
  if (await $.fs.exists(workRoot)) return block(`${workRoot} already exists`, 'remove it, or set another worktreeDir')
  await setActivity($, `git worktree add ${where.worktreeDir}/${branch}`)
  // A full checkout can outlast git's 60 s on a slow disk: it runs like the profile's commands, on their timeout.
  const made = { branch, workRoot, base, ...forked }
  let added: CommandResult
  try {
    added = await runLong($, ['git', 'worktree', 'add', '--no-track', '-b', branch, workRoot, `${remote}/${base}`], root, where.minutes, GIT_ENV)
  } catch (err) {
    // A Stop during the add: the branch git already made is kept on the stopped run, like one made before it.
    if (err instanceof Stopped && (await hasBranch($, root, branch))) await recordMade($, run, made)
    throw err
  }
  if (added.exit !== 0) {
    const failed = block(worktreeAddFailure(added, where.minutes), `check ${workRoot} (git worktree remove --force removes a half-made one)`)
    // git creates the branch before it fills the folder: a branch left behind is kept, and resume adds the worktree for it.
    if (!(await hasBranch($, root, branch))) return failed
    await recordMade($, run, made)
    return { ...failed, keep: made }
  }
  await recordMade($, run, made)
  return made
}

/**
 * What to do with a run's kept worktree, from git's own list: `fs.exists` can be wrong, and git run in a
 * folder at that path that isn't the worktree works on the checkout above it (round 6).
 */
async function keptWorktree($: EngineInterface, root: string, workRoot: string): Promise<KeptWorktreePlan | Blocked> {
  const listed = await git($, root, ['worktree', 'list', '--porcelain'])
  if (listed.exitCode !== 0) return block(`git worktree list failed: ${firstLine(listed.stderr || listed.stdout) || `exit ${listed.exitCode}`}`, 'check git in this checkout')
  return keptWorktreePlan(worktreeStateOf(listed.stdout, workRoot), await $.fs.exists(workRoot))
}

const strayFolder = (workRoot: string): Blocked => block(`${workRoot} is there but isn't the run's git worktree`, `move ${workRoot} aside`)

/**
 * Steps 1 and 2. A preflight that blocked after making its branch recorded it with the block, so a
 * resume reuses that branch and folder instead of making another (Codex, PR #41).
 */
async function preflight($: EngineInterface, run: Run): Promise<RunEvent> {
  await setActivity($, 'checking gh and the issue')
  const unauthed = await authCheck($, run)
  if (unauthed) return unauthed
  // Every gh call of the run names this repository, and origin must be it (#25).
  const resolved = run.ghRepo ? { repo: run.ghRepo } : await ghRepoOf($, run.root)
  if ('type' in resolved) return resolved
  const { repo } = resolved
  // Origin is the project, or (#26) the contributor's fork with the project as another remote.
  // Origin's URLs are read once and each repository named is asked about once (PR #87 review).
  const urls = await originUrls($, run.root)
  const views: Views = new Map()
  const stray = await originCheck($, run.root, repo, urls, views)
  const fork = stray ? await forkCheck($, run.root, repo, stray, urls, views) : null
  if (fork && 'type' in fork) return fork
  const remote = fork?.baseRemote ?? 'origin'
  // Pinned once origin agrees (or is a fork of it), so a later block keeps it; an origin block leaves it open to a fix of the remotes.
  if (!run.ghRepo) await recordPinned($, run, repo)
  const issue = await issueCheck($, run, repo)
  if ('type' in issue) return issue
  let made: Kept
  if (run.branch) {
    made = { branch: run.branch, workRoot: workOf(run), base: run.base }
    const moved = keptForkBlock(run.headRepo, fork?.headRepo, repo)
    if (moved) return { ...block(moved.reason, moved.next), keep: made }
    // A kept worktree that is gone (removed by hand, or never filled) is made again for the kept branch.
    const kept = isWorktreeRun(run) ? await keptWorktree($, run.root, made.workRoot) : 'reuse'
    if (typeof kept !== 'string') return { ...kept, keep: made }
    if (kept === 'block') return { ...strayFolder(made.workRoot), keep: made }
    if (kept === 'add') {
      stillDriving(run)
      // git refuses to add a folder deleted by hand while it is still registered: only this path's entry is cleared (no
      // prune of others'). A folder git never registered just fails the remove.
      await git($, run.root, ['worktree', 'remove', made.workRoot])
      await setActivity($, `git worktree add ${made.workRoot}`)
      const minutes = run.profile?.commandTimeoutMinutes ?? DEFAULT_COMMAND_MINUTES
      const again = await runLong($, ['git', 'worktree', 'add', made.workRoot, made.branch], run.root, minutes, GIT_ENV)
      if (again.exit !== 0) return { ...block(worktreeAddFailure(again, minutes), `check ${made.workRoot}`), keep: made }
    }
    // A kept worktree's own config can give origin other URLs (extensions.worktreeConfig): it is checked where it fetches.
    const strayThere = made.workRoot === run.root ? null : await pushCheck($, made.workRoot, repo, fork?.headRepo)
    if (strayThere) return { ...strayThere, keep: made }
    const unfetched = await fetchBase($, made.workRoot, remote, made.base, repo)
    if (unfetched) return { ...unfetched, keep: made }
    // A fix pushed to the base (the profile, a missing command) reaches the kept branch before it is checked again.
    const behind = await catchUp($, run, made.workRoot, remote, made.base)
    if (behind) return { ...behind, keep: made }
  } else {
    const fresh = await makeBranch($, { ...run, title: issue.title }, issue.body, remote, repo, fork?.headRepo)
    if ('type' in fresh) return fresh
    made = fresh
  }
  try {
    const mergeBase = (await gitOut($, made.workRoot, ['merge-base', 'HEAD', `${remote}/${made.base}`])).trim()
    // The profile whose commands run is the base's, not the checkout the run started from (which anyone may have pushed).
    await setActivity($, `reading ${PROFILE_FILE} from ${remote}/${made.base}`)
    const trusted = await loadProfile($, made.workRoot)
    if (!trusted.profile) return { ...block(`${remote}/${made.base} has no valid ${PROFILE_FILE}: ${trusted.errors[0] ?? 'missing'}`, `commit ${PROFILE_FILE} to ${made.base}`), keep: made }
    return { type: 'preflighted', title: issue.title, body: issue.body, url: issue.url, base: made.base, branch: made.branch, mergeBase, profile: trusted.profile, workRoot: made.workRoot, repo, ...fork }
  } catch (err) {
    if (err instanceof Stopped) throw err
    return { ...block(`unexpected: ${err instanceof Error ? err.message : String(err)}`, 'see /issue-forge status'), keep: made }
  }
}

/**
 * Before each step that runs coverage (baseline, gates G and F), on a fresh start or a resume: one LCOV file can't
 * serve two runs at once (Change 0.3.0; Codex 4278707573).
 */
async function lcovShared($: EngineInterface, run: Run, p: Profile): Promise<Blocked | null> {
  const shared = sharedLcovBlock(p, (await runsOf($, run.repo ?? run.root)).filter(r => r.id !== run.id))
  return shared ? block(shared.reason, shared.next) : null
}

/**
 * Step 3. A branch with no commits of its own first catches up with the base (so "fix main, then resume"
 * works), and the merge base is computed afresh every time, so a blocked baseline never leaves a stale one.
 */
async function baseline($: EngineInterface, run: Run, p: Profile): Promise<RunEvent> {
  const shared = await lcovShared($, run, p)
  if (shared) return shared
  const root = workOf(run)
  const remote = baseRemoteOfRun(run)
  const unfetched = await fetchBase($, root, remote, run.base, run.ghRepo)
  if (unfetched) return unfetched
  const behind = await catchUp($, run, root, remote, run.base)
  if (behind) return behind
  const mergeBase = (await gitOut($, root, ['merge-base', 'HEAD', baseRefOf(run)])).trim()
  await setActivity($, 'running tests')
  const tests = await runLong($, p.testCommand, root, p.commandTimeoutMinutes)
  if (tests.exit !== 0) return block(tests.isTimedOut ? 'tests time out before any change' : 'tests fail before any change', `fix ${run.base}`)
  await setActivity($, 'running coverage')
  const since = await $.clock.now()
  const cov = await runLong($, p.coverageCommand, root, p.commandTimeoutMinutes)
  const text = cov.exit === 0 ? await readLcov($, lcovFileOf(p, root), since) : null
  const lcov = text === null ? null : parseLcov(text, root)
  if (!lcov || !hasSourceRecord(p, lcov)) return block('coverage produced no data', `check coverageCommand and lcovPath in ${PROFILE_FILE}`)
  return { type: 'baselined', baseline: totals(p, lcov), mergeBase }
}

function waitForAnswer(agentId: string): Promise<AgentTurn> {
  return new Promise((resolve, reject) => {
    waiting[agentId] = { resolve, reject }
  })
}

/** A phase: spawn its agent (named, so a routing plugin leaves it on Claude) and wait for its turn.complete. */
async function phase($: EngineInterface, run: Run, which: Phase, p: Profile): Promise<RunEvent | null> {
  const redTestPaths = which === 'green' && run.redCommit ? splitZ(await gitOut($, workOf(run), ['diff', '--name-only', '-z', run.mergeBase, run.redCommit])) : undefined
  const prompt = phasePrompt(which, run, promptExtraOf(which, run, redTestPaths))
  const subagentType = which === 'red' ? options.redAgentType : `issue-forge:${which}`
  const isOwn = subagentType.startsWith('issue-forge:')
  const routed = routedRedBlock(subagentType, isWorktreeRun(run))
  if (routed) return block(routed.reason, routed.next)
  const name = isOwn ? agentName(run, which) : undefined
  // Known before the spawn returns, so an agent that stops sooner still has its hand-back taken.
  if (name) knownRefs.add(name)
  const model = which === 'red' ? options.redModel : which === 'green' ? options.greenModel : options.refactorModel
  await setActivity($, `starting the ${which} agent`)
  const baseManifests = [...(await manifestsAt($, workOf(run), run.mergeBase)), ...(await manifestsAt($, workOf(run), baseRefOf(run)))]
  const spawned = await $.agent.spawn({ subagentType, prompt, description: `issue-forge #${run.issue} ${which}`, model, cwd: workOf(run), ...(name ? { name } : {}) })
  const agentId = spawned.agentId
  // An agent another plugin answered in-line (a Codex router, say) has no loop and no turn.complete (C0).
  const isInline = !!agentId && isInlineAnswer(agentId, spawned.model)
  // Wait before any other await, so a fast agent's turn.complete finds its waiter.
  const answer = agentId && !isInline ? waitForAnswer(agentId) : null
  void answer?.catch(() => undefined)
  // Steer the agent from its first tool call: set before any other await, like the waiter.
  if (agentId) {
    liveAgent = agentId
    liveWork = { root: run.root, workRoot: workOf(run), testGlobs: run.profile?.testGlobs ?? [], baseManifests }
  }
  // A stop (or another run) while the spawn was pending wins: the agent is only refused tools.
  const latest = await loadRun($, keyOf(run))
  if (!latest || latest.id !== run.id || latest.step !== run.step || !isDriving(run)) {
    if (agentId) {
      delete waiting[agentId]
      if (liveAgent === agentId) {
        liveAgent = null
        liveWork = null
      }
      await rememberAgents($, run, spawnRefs(agentId, name, spawned.teammateId))
    }
    return null
  }
  if (spawned.deny !== undefined || !agentId) return block(`the ${which} agent didn't start: ${spawned.deny ?? 'no agent id'}`, 'check the agent type and model options')
  await rememberAgents($, run, spawnRefs(agentId, name, spawned.teammateId))
  await saveRun($, advance(latest, { type: 'spawned', agent: { id: agentId, ...(name ? { name } : {}), phase: which } }, await $.clock.now()), (run as Stamped).driveGen)
  await setActivity($, 'agent working')
  try {
    return { type: 'agentDone', ...(answer ? await answer : { answer: '' }) }
  } finally {
    if (liveAgent === agentId) {
      liveAgent = null
      liveWork = null
    }
  }
}

async function headOf($: EngineInterface, root: string): Promise<string> {
  return (await gitOut($, root, ['rev-parse', 'HEAD'])).trim()
}

async function stagedSince($: EngineInterface, root: string, ref: string): Promise<string[]> {
  return splitZ(await gitOut($, root, ['diff', '--cached', '--name-only', '-z', ref]))
}

/** The guard refused a manifest: the driven run records it, so the phase's gate blocks on it (Change 0.7.0); never a run another session took over. */
async function recordNewPlugin($: EngineInterface, path: string): Promise<void> {
  const d = drivingNow()
  if (!d) return
  const now = await $.clock.now()
  await updateRun($, d.key, stored => newPluginRecord(stored, d.runId, sessionId, path, now))
}

/** The plugin manifests at a commit (the merge base, or the base branch's tip): none is new (Codex 4290574826; owner). None when git can't list them. */
async function manifestsAt($: EngineInterface, root: string, ref: string): Promise<string[]> {
  const listed = await git($, root, ['ls-tree', '-r', '--name-only', '-z', ref]).catch(() => null)
  return listed?.exitCode === 0 ? splitZ(listed.stdout).filter(isPluginManifest) : []
}

/**
 * R4 and G8 (Change 0.7.0): a manifest added since the merge base (renames off: a moved one is added), or the one the guard
 * refused, unless the base branch's tip has it. Checked before any test runs.
 */
async function newPluginAt($: EngineInterface, run: Run, root: string) {
  const added = splitZ(await gitOut($, root, ['diff', '--cached', '--no-renames', '--name-only', '--diff-filter=A', '-z', run.mergeBase]))
  return newPluginOf(added, run.newPlugin, run.profile?.testGlobs ?? [], await manifestsAt($, root, baseRefOf(run)))
}

/** Gate R (§3 step 4); on pass, the red commit, and after G6's return, green's work restored by its SHA. */
async function gateRStep($: EngineInterface, run: Run, p: Profile): Promise<RunEvent> {
  const root = workOf(run)
  const away = await offBranch($, run)
  if (away) return away
  stillDriving(run)
  await setActivity($, 'staging')
  await gitWriteOut($, run, root, ['add', '-A'])
  const madeR = await newPluginAt($, run, root)
  if (madeR) return { type: 'gated', gate: newPluginGate('R', madeR) }
  // The behaviour pass must add a test of its own: judge it against the red commit, not the merge base.
  const staged = await stagedSince($, root, run.behaviourFor && run.redCommit ? run.redCommit : run.mergeBase)
  await setActivity($, 'running tests')
  const tests = await runLong($, p.testCommand, root, p.commandTimeoutMinutes)
  const gate = gateR(p, { staged, tests })
  if (!gate.passed) return { type: 'gated', gate, testTail: tests.tail }
  const isBehaviour = !!run.behaviourFor
  // Nothing new to commit means a replay after a reload: the gated tests are HEAD already.
  const commit = (await commitAll($, run, commitMessage(isBehaviour ? 'behaviour' : 'red', run, run.behaviourFor ?? []))) ?? (await headOf($, root))
  if (isBehaviour && run.greenStash) {
    const stash = run.greenStash
    stillDriving(run)
    const restore = (reason: string) => ({ type: 'gated' as const, gate, commit, testTail: tests.tail, blockAfter: { reason, next: `restore green's work by hand (git stash apply ${stash.sha.slice(0, 7)})` } })
    if (!hasStash(await gitOut($, root, STASH_LIST_ARGV.slice(1)), stash.sha)) return restore(`stash ${stash.sha.slice(0, 7)} "${stash.message}" is gone`)
    // The commit is made: a lock that outlasts the apply blocks after it, naming the stash, as any failed restore does.
    let applied: ProcessRunResult
    try {
      applied = await gitWrite($, run, root, stashApplyArgv(stash).slice(1))
    } catch (err) {
      if (err instanceof Locked) return restore(`${err.message}; green's work is in stash ${stash.sha.slice(0, 7)} "${stash.message}"`)
      throw err
    }
    if (applied.exitCode !== 0) return restore(`could not restore green's work; it is in stash ${stash.sha.slice(0, 7)} "${stash.message}"`)
  }
  return { type: 'gated', gate, commit, testTail: tests.tail }
}

/** Gates G and F (§3 steps 5–6): G1–G7 over facts gathered here, judged in the logic module. */
async function gateGStep($: EngineInterface, run: Run, p: Profile, which: 'G' | 'F'): Promise<RunEvent> {
  const shared = await lcovShared($, run, p)
  if (shared) return shared
  const root = workOf(run)
  const redCommit = run.redCommit ?? run.mergeBase
  const away = await offBranch($, run)
  if (away) return away
  stillDriving(run)
  await setActivity($, 'staging')
  await gitWriteOut($, run, root, ['add', '-A'])
  const madeG = await newPluginAt($, run, root)
  if (madeG) return { type: 'gated', gate: newPluginGate(which, madeG) }
  const staged = await stagedSince($, root, run.mergeBase)
  const changedSinceRed = await stagedSince($, root, redCommit)
  const redPaths = splitZ(await gitOut($, root, ['diff', '--name-only', '-z', run.mergeBase, redCommit]))
  await setActivity($, 'running tests')
  const tests = await runLong($, p.testCommand, root, p.commandTimeoutMinutes)
  await setActivity($, 'running coverage')
  const since = await $.clock.now()
  const coverage = await runLong($, p.coverageCommand, root, p.commandTimeoutMinutes)
  const lcov = coverage.exit === 0 ? await readLcov($, lcovFileOf(p, root), since) : null
  // Fixed prefixes and no external diff: diff.mnemonicPrefix or diff.noprefix would hide every changed line.
  const diff = await gitOut($, root, ['diff', '-U0', '--cached', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/', run.mergeBase])
  const checks: { argv: string[]; result: CommandResult }[] = []
  for (const [i, argv] of p.checks.entries()) {
    await setActivity($, `checks ${i + 1}/${p.checks.length}`)
    checks.push({ argv, result: await runLong($, argv, root, p.commandTimeoutMinutes) })
  }
  // A command that rewrote files (a formatter, a snapshot update) means the tests ran on bytes that aren't staged.
  const rewritten = unstagedOf(await gitOut($, root, ['status', '--porcelain', '-z']))
  if (rewritten.length > 0) return block(`a command changed files after staging, so the tested bytes aren't the ones that would be committed: ${rewritten.slice(0, 5).join(', ')}${rewritten.length > 5 ? ` and ${rewritten.length - 5} more` : ''}`, 'make the profile commands leave the tree as they found it (or commit what they write)')
  const gate: Gate = gateG(p, run.baseline, { staged, changedSinceRed, redPaths, tests, coverage, lcov, diff, checks }, root, which)
  if (gate.passed) {
    const commit = await commitAll($, run, commitMessage(which === 'G' ? 'green' : 'refactor', run))
    return { type: 'gated', gate, commit, testTail: tests.tail, ...(which === 'F' ? { head: await headOf($, root) } : {}) }
  }
  if (which === 'G' && gate.isBehaviourOnly && !run.isBehaviourDone) {
    await setActivity($, "stashing green's work")
    return { type: 'gated', gate, stash: await stashAll($, run, stashMessage('green', run)), testTail: tests.tail }
  }
  if (which === 'F' && !canRetry(run, 'refactor')) {
    await setActivity($, 'stashing the rejected refactor')
    const stash = await stashAll($, run, stashMessage('refactor', run))
    return { type: 'gated', gate, stash, testTail: tests.tail, head: await headOf($, root) }
  }
  return { type: 'gated', gate, testTail: tests.tail }
}

/** Step 7: push the branch (no -u) and open the pull request. */
async function publish($: EngineInterface, run: Run): Promise<RunEvent> {
  if (!run.branch || run.branch === run.base) return block(`refusing to push ${run.branch || 'no branch'} onto ${run.base}`, 'check the run')
  const dir = `${home}/.claude/issue-forge-data/${run.id}`
  const body = `${dir}/pr.md`
  // Only what gate F checked leaves the machine: HEAD must still be that commit, and that commit is what's pushed.
  if (run.gatedHead) {
    const tip = (await gitOut($, workOf(run), ['rev-parse', '--verify', `refs/heads/${run.branch}`])).trim()
    if (tip !== run.gatedHead) return block(`${run.branch} moved after gate F (now ${tip.slice(0, 7)}, checked ${run.gatedHead.slice(0, 7)})`, 'remove the new commits, or start a new run')
  }
  // A run pinned to a repository pushes only to an origin that is it (#25), as the folder that pushes reads it (PR #68 review 2);
  // a fork run, only to the fork it was preflighted for (#26).
  const stray = await pushCheck($, workOf(run), run.ghRepo, run.headRepo)
  if (stray) return stray
  // The PR body says what was true when it was pushed: the merge is checked again here.
  const merge = await mergeCheck($, run)
  await $.fs.write(body, prBody({ ...run, merge }))
  // Nothing irreversible waits for the 5 s watch: a stop or take-over from another session is read here (PR #51 review).
  await stillOwned($, run)
  await setActivity($, `git push origin ${run.branch}`)
  const pushed = await git($, workOf(run), ['push', 'origin', run.gatedHead ? `${run.gatedHead}:refs/heads/${run.branch}` : run.branch])
  if (pushed.exitCode !== 0) return block(`git push failed: ${firstLine(pushed.stderr)}`, 'check access to origin')
  await stillOwned($, run)
  await setActivity($, 'gh pr create')
  const pr = await $.process.run(['gh', 'pr', 'create', '--base', run.base, '--head', headArg(run.branch, run.headRepo), '--title', `${run.title} (#${run.issue})`, '--body-file', body, ...(run.ghRepo ? ['--repo', run.ghRepo] : [])], { cwd: workOf(run), timeoutMs: GIT_TIMEOUT })
  if (pr.exitCode !== 0) return block(`gh pr create failed: ${firstLine(pr.stderr)}`, `the branch is pushed; open the pull request by hand or /issue-forge publish`)
  return { type: 'published', url: pr.stdout.trim().split('\n').pop() ?? '', merge }
}

/**
 * An issue's `Base branch:` line names a branch anyone with push access may have written, and the
 * profile's commands run from it: confirm it first. No answer possible counts as no.
 */
async function chooseBase($: EngineInterface, issue: number, asked: string, profileBase: string): Promise<string | null> {
  const useAsked = `Use ${asked}`
  const useProfile = `Use ${profileBase}`
  const answer = await askOr($, `Issue #${issue} asks to branch from ${asked}, not ${profileBase}, and the tests will run from that branch. Which base?`, [useAsked, useProfile])
  return answer === useAsked ? asked : answer === useProfile ? profileBase : null
}

/** A busy checkout under `ask`: a new worktree, or nothing. No answer possible counts as no. */
async function chooseWorktree($: EngineInterface, issue: number, root: string, why: string, dir: string): Promise<boolean> {
  return (await askOr($, `${root} is busy (${why}). Run #${issue} in a new worktree under ${dir}?`, ['New worktree', 'Stop'])) === 'New worktree'
}

/** `$.ui.ask`, or null when nobody can answer (claude -p, a dismissed question). */
async function askOr($: EngineInterface, question: string, labels: string[]): Promise<string | null> {
  try {
    return await $.ui.ask(question, labels)
  } catch {
    return null
  }
}

/** Case 1: does the gated commit still merge into a freshly fetched base? It informs, never blocks, and never throws. */
async function mergeCheck($: EngineInterface, run: Run): Promise<MergeCheck> {
  const work = workOf(run)
  const remote = baseRemoteOfRun(run)
  await setActivity($, `checking the merge with ${baseRefOf(run)}`)
  try {
    const moved = await baseRemoteCheck($, work, remote, run.ghRepo)
    if (moved) return { isClean: false, files: [], error: moved.reason }
    const fetched = await gitRetry($, work, ['fetch', remote, run.base])
    if (fetched.exitCode !== 0) return { isClean: false, files: [], error: `git fetch ${remote} ${run.base} failed: ${firstLine(fetched.stderr)}` }
    return parseMergeTree(await git($, work, ['merge-tree', '--write-tree', '--name-only', '--no-messages', '-z', run.gatedHead ?? `refs/heads/${run.branch}`, baseRefOf(run)]))
  } catch (err) {
    return { isClean: false, files: [], error: err instanceof Error ? err.message : String(err) }
  } finally {
    await setActivity($, null)
  }
}

/** Asks before anything leaves the machine; no answer possible (claude -p, dismissed) counts as no. */
async function confirmPublish($: EngineInterface, run: Run): Promise<boolean> {
  return !options.confirmPublish || (await askOr($, publishQuestion(run), ['Publish', 'Not now'])) === 'Publish'
}

async function doStep($: EngineInterface, run: Run): Promise<RunEvent | null> {
  const p = run.profile
  if (run.step === 'preflight') return preflight($, run)
  if (!p) return block('the run has no profile', `fix ${PROFILE_FILE}, then start again`)
  switch (run.step) {
    case 'baseline':
      return baseline($, run, p)
    case 'red':
    case 'green':
    case 'refactor':
      return phase($, run, run.step, p)
    case 'gateR':
      return gateRStep($, run, p)
    case 'gateG':
      return gateGStep($, run, p, 'G')
    case 'gateF':
      return gateGStep($, run, p, 'F')
    case 'publishing':
      return publish($, run)
    default:
      return null
  }
}

/**
 * Drives the run step by step until it leaves the working steps, then asks about publishing once.
 * A drive that another took over (publish while its question was open) ends without touching it.
 * One drive per session (Change 0.3.0); when it ends, the run's driver is cleared so any session may resume it.
 */
async function drive($: EngineInterface, first: Run, mayAsk: boolean): Promise<void> {
  const key = keyOf(first)
  const runId = first.id
  const me: Drive = { runId, key, issue: first.issue, isStopped: false, gen: ++drives }
  driving = me
  drivenLast = first
  let ticks = 0
  const ticker = $.clock.every(1000, () => void tickOnce($, ++ticks % 5 === 0).catch(() => undefined))
  const isMine = () => driving === me && !me.isStopped
  try {
    for (;;) {
      const run = await loadRun($, key)
      if (!run || run.id !== runId || !isMine()) return
      if (run.step === 'ready' && mayAsk) {
        mayAsk = false
        // The merge is checked ahead only for a question; publish checks it again for the PR body.
        if (options.confirmPublish) {
          const merge = await mergeCheck($, run)
          const at = await $.clock.now()
          // A Publish or Stop pressed during the check moved the run on: its result lands only on a run still ready and driven.
          const checked = await updateRun($, key, stored => (stored?.id === runId && stored.step === 'ready' && isMine() ? advance(stored, { type: 'merged', merge }, at) : null))
          // One pressed while the result was written takes the run over: only a run still driven is asked about.
          if (!checked || !isMine()) return
          publishAsking = runId
          const isYes = await confirmPublish($, checked).finally(() => {
            if (publishAsking === runId) publishAsking = null
          })
          if (!isYes) return
        }
        // The question may have stayed open while /issue-forge publish (or stop) moved the run on.
        const now = await loadRun($, key)
        if (!now || now.id !== runId || now.step !== 'ready' || !isMine()) return
        if (!(await saveRun($, advance(now, { type: 'publish' }, await $.clock.now()), me.gen))) return
        continue
      }
      if (!isWorking(run.step)) return
      let ev: RunEvent | null
      try {
        const stamped: Stamped = { ...run, driveGen: me.gen }
        ev = await doStep($, stamped)
      } catch (err) {
        ev = err instanceof Locked ? block(err.message, err.next) : block(`unexpected: ${err instanceof Error ? err.message : String(err)}`, 'see /issue-forge status')
      }
      if (!ev || !isMine()) return
      const latest = (await loadRun($, key)) ?? run
      if (latest.id !== runId || latest.step === 'stopped') return
      // A write dropped (stopped, taken over or replaced elsewhere) ends the drive, or it would run the step again.
      if (!(await saveRun($, advance(latest, ev, await $.clock.now()), me.gen))) return
    }
  } finally {
    ticker.cancel()
    if (driving === me) {
      driving = null
      await releaseDriver($, me).catch(() => undefined)
      await setActivity($, null).catch(() => undefined)
      await announce($, key).catch(() => undefined)
    }
  }
}

/** Clears this session as the run's driver, so another session can resume it without taking it over. */
async function releaseDriver($: EngineInterface, d: Drive): Promise<Run | null> {
  const now = await $.clock.now()
  return updateRun($, d.key, stored => (stored?.id === d.runId && stored.driver?.session === sessionId ? advance(stored, { type: 'release', session: sessionId }, now) : null))
}

async function tickOnce($: EngineInterface, isWatch: boolean): Promise<void> {
  const now = await $.clock.now()
  await update($, nowAtom, () => now)
  const d = drivingNow()
  if (d && drivenLast) $.ui.status(badgeOf(drivenLast, now))
  if (isWatch && d) await watch($, d)
}

/** Every 5 s the driving session reads its run: stopped or taken over in another session, this drive ends (Change 0.3.0). */
async function watch($: EngineInterface, d: Drive): Promise<void> {
  const stored = await loadRun($, d.key)
  const change = foreignChange(stored, d.runId, sessionId)
  if (change && drivingNow() === d) {
    endLocalDrive()
    $.ui.status(undefined)
    $.ui.toast(`#${d.issue} ${change === 'takenOver' ? 'was taken over by another session' : change === 'stopped' ? 'was stopped in another session' : 'was replaced'}; this session stopped driving it.`)
  }
  if (stored?.repo) await refreshOthers($, stored.repo)
}

/** How a drive ended, said once: a toast, and the status line cleared. */
async function announce($: EngineInterface, key: string): Promise<void> {
  $.ui.status(undefined)
  const run = await loadRun($, key)
  if (!run) return
  if (run.step === 'ready') $.ui.toast(`#${run.issue} is ready. /issue-forge publish pushes it and opens the PR.`)
  else if (run.step === 'blocked' && run.blocked) $.ui.toast(truncate(`#${run.issue} blocked: ${run.blocked.reason}`, 80))
  else if (run.step === 'done') $.ui.toast(truncate(`PR opened: ${run.prUrl ?? ''}`, 80))
}

function startDrive($: EngineInterface, run: Run, mayAsk = true): void {
  void drive($, run, mayAsk).catch(() => undefined)
}

// ── Commands and buttons ──────────────────────────────────────────────────

async function openPane($: EngineInterface): Promise<void> {
  const opened = await $.ui.open(PANE_ARGS)
  if (!opened.isPlaced) $.ui.toast(`${TITLE} needs a wider window. Widen it to see the pane, or watch the status line.`)
}

async function paneActionOf($: EngineInterface): Promise<ReturnType<typeof paneAction>> {
  return paneAction(await $.ui.panes(), PANE)
}

/** Whether the pane is open as a tab behind another; a start or a resume says so in its answer, and never takes the keyboard. */
async function isBehind($: EngineInterface): Promise<boolean> {
  return (await paneActionOf($).catch(() => 'open')) === 'show'
}

/**
 * Asks for a pane that is a tab behind another to the front, with the keyboard, for a person who asked to see it (#31).
 * The request goes out before the first await. A pane that is still a tab behind another afterwards is named in a toast.
 */
async function bringToFront($: EngineInterface): Promise<void> {
  await $.ui.open({ ...PANE_ARGS, focus: true })
  $.clock.after(FRONT_CHECK_MS, () => void warnIfBehind($).catch(() => undefined))
}

async function warnIfBehind($: EngineInterface): Promise<void> {
  if ((await paneActionOf($)) === 'show') $.ui.toast(STILL_BEHIND_TOAST)
}

/** An open for a command that names the pane: a tab behind another comes to the front, any other pane is opened as before. */
async function openOrFront($: EngineInterface): Promise<void> {
  if ((await paneActionOf($)) === 'show') void bringToFront($).catch(() => undefined)
  else await openPane($)
}

/** The starting checkout's own profile text: it names the base and the menu's wording, never what runs. */
async function readLocalProfile($: EngineInterface, root: string): Promise<string | null> {
  const path = `${root}/${PROFILE_FILE}`
  return (await $.fs.exists(path)) ? await $.fs.read(path) : null
}

async function lineCtx($: EngineInterface): Promise<LineContext> {
  return { me: sessionId, drivingId: drivingNow()?.runId ?? null, now: await $.clock.now() }
}

/** The pane shows this run: the one a command named or acted on (Change 0.3.0). */
async function setFocus($: EngineInterface, run: Run | null): Promise<void> {
  await writeFocus($, run?.issue ?? null)
  await update($, runAtom, () => run)
}

/** The only writer of the focus: the atom and the module's copy, which /clear's reseed reads (#119). */
async function writeFocus($: EngineInterface, issue: number | null): Promise<void> {
  focusKept = issue
  await update($, focusAtom, () => issue)
}

/** The pane shows the run `focus` names, or the default pick, and the also line leaves it out. */
async function showPicked($: EngineInterface, at: Repo, runs: Run[], focus: number | null): Promise<void> {
  const pick = pickRun(runs, { issue: null, focus, root: at.root, needActive: false })
  const shown = pick.kind === 'run' ? pick.run : null
  await setFocus($, shown)
  // The focus is passed, not re-read: a dispatch's state reads may not see its own writes (gotchas.md, Codex on PR #124).
  await refreshOthers($, at.repo, runs, shown?.issue ?? null)
}

/** The also line, and the shown run as stored now: other sessions write the store too. */
async function refreshOthers($: EngineInterface, repo: string, known?: Run[], shownIssue?: number | null): Promise<void> {
  const runs = known ?? (await runsOf($, repo))
  const focus = shownIssue !== undefined ? shownIssue : await read($, focusAtom)
  const shown = focus === null ? undefined : runs.find(r => r.issue === focus)
  if (shown) await update($, runAtom, () => shown)
  const ctx = await lineCtx($)
  await update($, othersAtom, () => othersOf(runs, { ...ctx, shownId: shown?.id ?? null }))
}

async function statusFor($: EngineInterface, run: Run, runs: readonly Run[]): Promise<string> {
  const ctx = await lineCtx($)
  return statusText(run, ctx.drivingId === run.id, ctx.now, sessionId, othersOf(runs, { ...ctx, shownId: run.id }))
}

/** The run a command means (Change 0.3.0), with the repository's runs as read for it. */
async function pickFor($: EngineInterface, at: Repo, issue: number | null, needActive: boolean): Promise<{ pick: RunPick; runs: Run[] }> {
  const runs = await runsOf($, at.repo)
  return { pick: pickRun(runs, { issue, focus: await read($, focusAtom), root: at.root, needActive }), runs }
}

const noneText = (issue: number | null, fallback: string) => (issue === null ? fallback : `no run for #${issue} in this repository.`)

/** A run under way in another session is taken over only after a yes; no answer possible counts as no. */
async function confirmTakeOver($: EngineInterface, run: Run): Promise<boolean> {
  return (await askOr($, takeOverQuestion(run, await $.clock.now()), [TAKE_OVER, 'Cancel'])) === TAKE_OVER
}

/**
 * The start's own read of the issue (Change 0.7.0): when its body asks for the plugin to be built with mod-builder,
 * the answer is the next steps, and nothing is stored. A failed read starts as before; preflight reports the cause.
 */
async function newModStart($: EngineInterface, root: string, issue: number, ghRepo?: string): Promise<string | null> {
  const view = await $.process.run(issueViewArgv(issue, ghRepo), { cwd: root, timeoutMs: GIT_TIMEOUT }).catch(() => null)
  if (!view || view.exitCode !== 0) return null
  let read: { title?: string; body?: string; url?: string }
  try {
    read = JSON.parse(view.stdout) as typeof read
  } catch {
    return null
  }
  // A pull request's number is preflight's to refuse, as a pull request (PR #103 /code-review).
  if (isPullUrl(read.url ?? '')) return null
  const line = newModLine(read.body ?? '')
  return line === null ? null : newModReply({ issue, title: read.title ?? '', url: read.url ?? '', ...(ghRepo ? { ghRepo } : {}) }, line)
}

/**
 * `/issue-forge <N>` (Change 0.3.0, 3): the same issue answers its status; another active run, or a drive in this
 * session, gets one question; otherwise the run starts.
 */
async function startRun($: EngineInterface, at: Repo | null, issue: number, named?: string): Promise<string> {
  if (!at) return 'not in a git repository. Start Claude Code inside the repository the issue belongs to.'
  // An issue URL must name the repository gh resolves here (#25), before this checkout's runs answer for its number (PR #68
  // review); the run is pinned to the name gh gives it.
  let ghRepo: string | undefined
  if (named) {
    const resolved = await ghRepoOf($, at.root)
    if ('type' in resolved) return resolved.reason
    if (!isSameRepo(named, resolved.repo)) return `${repoLabel(named)}#${issue} is in another repository: this checkout's GitHub repository is ${repoLabel(resolved.repo)}. Start Claude Code in a clone of ${repoLabel(named)}.`
    ghRepo = resolved.repo
  }
  const runs = await runsOf($, at.repo)
  const same = runs.find(r => r.issue === issue && isActive(r))
  if (same) {
    await setFocus($, same)
    return `#${issue} has a run already.\n${await statusFor($, same, runs)}`
  }
  const refused = await newModStart($, at.root, issue, ghRepo)
  if (refused) return refused
  const d = drivingNow()
  const drivingRun = d ? (runs.find(r => r.id === d.runId) ?? null) : null
  const local = await readLocalProfile($, at.root)
  const workspace = checkoutWorkspaceOf(local)
  const others = runs.filter(r => isActive(r) && r.id !== drivingRun?.id)
  const menu = startChoices({ issue, base: checkoutBaseOf(local), workspace, driving: drivingRun, others, me: sessionId, now: await $.clock.now() })
  if (!menu) return begin($, at, issue, false, ghRepo)
  const action = startAnswer(menu, await askOr($, menu.question, menu.options.map(o => o.label)), isInteractive)
  const isChosen = workspace !== 'here'
  switch (action.kind) {
    case 'start':
      return begin($, at, issue, isChosen, ghRepo)
    case 'takeOver':
      return resumeRun($, at, action.issue, true)
    case 'resume':
      return resumeRun($, at, action.issue)
    case 'stopThenStart': {
      const stopped = await stopRun($, at, action.issue)
      return stopped.startsWith('stopped') ? `stopped #${action.issue}; ${await begin($, at, issue, isChosen, ghRepo)}` : stopped
    }
    case 'handOffThenStart': {
      const step = await handOff($)
      return step ? `handed off #${action.issue} at ${step}; ${await begin($, at, issue, isChosen, ghRepo)}` : 'this session is driving no run.'
    }
    case 'keep':
      return keepText(issue)
    default:
      return 'cancelled; nothing started.'
  }
}

/**
 * Deletes finished runs beyond the repository's newest 20, once a new run is claimed. Each is read again first, and
 * deleted only if it is still the finished run listed (Codex 4278707561); the window between that read and the
 * delete is narrow, not closed, as the store has no compare-and-set. Agents lists are kept (PR #51 review).
 */
async function prune($: EngineInterface, repo: string): Promise<void> {
  const entries = await listRuns($, repo)
  for (const key of pruneKeys(entries)) {
    const listed = entries.find(e => e.key === key)?.run
    if (listed && isPrunable(listed, await loadRun($, key))) await $.store.delete(key)
  }
}

/** Writes the new run, with this session as its driver, only if its key is still free; then drives it. */
async function begin($: EngineInterface, at: Repo, issue: number, isChosenWorktree: boolean, ghRepo?: string): Promise<string> {
  const now = await $.clock.now()
  const fresh: Run = { ...newRun(`${issue}-${now}`, at.root, issue, now, ghRepo), repo: at.repo, ...(isChosenWorktree ? { chosenWorktree: true } : {}) }
  const run = advance(fresh, { type: 'drive', session: sessionId }, now)
  await writeFocus($, issue)
  const claimed = await updateRun($, keyOf(run), stored => (isActive(stored) ? null : run))
  if (!claimed) return `#${issue} was started by another session a moment ago; /issue-forge status ${issue} says where it is.`
  await prune($, at.repo)
  await update($, demoAtom, () => null)
  const isBehindNow = await isBehind($)
  void openPane($).catch(() => undefined)
  startDrive($, claimed)
  return `starting ${issueLabel(run)}; ${isBehindNow ? BEHIND_TEXT : 'the pane shows progress'}. Nothing is pushed until you say yes.`
}

/**
 * The run as resume read it: same run, step and driver. Resume spends seconds on gh and git before it writes, and a
 * stop or a resume from another session in that time wins (PR #51, Codex 4278707565).
 */
function isAsRead(stored: Run | null, run: Run): boolean {
  return !!stored && stored.id === run.id && stored.step === run.step && stored.driver?.session === run.driver?.session
}

const movedOn = (run: Run) => `#${run.issue} moved on before it could be resumed; /issue-forge status ${run.issue} says where it is.`

/** Re-checks what may have changed while the run waited (SPEC 12), then drives it again. */
async function resumeRun($: EngineInterface, at: Repo | null, issue: number | null, isTakeOver = false): Promise<string> {
  if (!at) return 'no run to resume here.'
  const { pick } = await pickFor($, at, issue, true)
  if (pick.kind === 'several') return severalText(pick.runs, 'resume', await lineCtx($))
  if (pick.kind === 'none') return noneText(issue, 'no run to resume here.')
  const run = pick.run
  await setFocus($, run)
  if (!isActive(run)) return 'no run to resume here.'
  // A final block is one resume can't clear (Change 0.7.0).
  if (run.step === 'blocked' && run.blocked?.isFinal) return `#${run.issue} can't be resumed: ${run.blocked.reason}. /issue-forge stop ${run.issue} ends it.`
  const d = drivingNow()
  if (d?.runId === run.id) return `#${run.issue} is running already.`
  if (d) return `this session is driving #${d.issue}; /issue-forge handoff first, or resume #${run.issue} from another session.`
  if (isDrivenElsewhere(run, sessionId) && !isTakeOver && !(await confirmTakeOver($, run))) return elsewhereText(run.issue)
  const key = keyOf(run)
  const back = advance(run, { type: 'resume' }, await $.clock.now())
  if (back.branch) {
    // At preflight the issue is read again, from the repository preflight pins; a run blocked there may have none yet (PR #68 review).
    const issueNow = (await authCheck($, back)) ?? (back.step === 'preflight' ? null : await issueCheck($, back, back.ghRepo ?? null))
    const work = workOf(back)
    // A worktree that is gone, or a folder in its place, is preflight's to handle; at a later step it holds the
    // run's work, so the person decides. git runs in the folder only once git has it as the worktree.
    const kept = isWorktreeRun(back) ? await keptWorktree($, back.root, work) : 'reuse'
    const head = kept === 'reuse' ? (await gitOut($, work, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim() : null
    const why =
      issueNow && 'type' in issueNow
        ? issueNow
        : typeof kept !== 'string'
          ? kept
          : kept !== 'reuse'
            ? back.step === 'preflight'
              ? null
              : kept === 'block'
                ? strayFolder(work)
                : block(`the run's worktree ${work} is gone`, readdWorktreeCommand(work, back.branch))
            : head !== back.branch
            ? block(`HEAD is on ${head}, not ${back.branch}`, `git switch ${back.branch}`)
            : null
    if (why) {
      const now = await $.clock.now()
      // Still blocked: no session drives it (a driver taken over, or left by a reload, is cleared).
      const kept = await updateRun($, key, stored => (isAsRead(stored, run) ? advance(advance(back, why, now), { type: 'release', session: back.driver?.session ?? '' }, now) : null))
      return kept ? `still blocked: ${why.reason}.` : movedOn(run)
    }
  }
  const now = await $.clock.now()
  const driven = await updateRun($, key, stored => (isAsRead(stored, run) ? advance(back, { type: 'drive', session: sessionId }, now) : null))
  if (!driven) return movedOn(run)
  const isBehindNow = await isBehind($)
  void openPane($).catch(() => undefined)
  startDrive($, driven)
  return `resuming #${back.issue} at ${back.step}${isBehindNow ? `; ${BEHIND_TEXT}` : ''}.`
}

async function publishRun($: EngineInterface, at: Repo | null, issue: number | null, byPress = false): Promise<string> {
  if (!at) return 'no run to publish here.'
  const { pick } = await pickFor($, at, issue, false)
  if (pick.kind === 'several') return severalText(pick.runs, 'publish', await lineCtx($))
  if (pick.kind === 'none') return noneText(issue, 'no run to publish here.')
  const run = pick.run
  await setFocus($, run)
  if (run.step !== 'ready') return `#${run.issue} isn't ready to publish (${run.step}).`
  const d = drivingNow()
  if (d && d.runId !== run.id) return `this session is driving #${d.issue}; /issue-forge handoff first, or publish #${run.issue} from another session.`
  if (byPress) {
    // The drive's own publish question, while it is open, is this press's question: a second one would stack on it.
    const refused = publishAsking === run.id ? null : await refusedPress($, 'publish', run, isDrivenElsewhere(run, sessionId))
    if (refused) return refused
  } else if (isDrivenElsewhere(run, sessionId) && !(await confirmTakeOver($, run))) return elsewhereText(run.issue)
  // A drive waiting on the publish question is taken over: when that question is answered, it finds the run moved on.
  if (driving?.runId === run.id) driving = null
  const now = await $.clock.now()
  const moved = await updateRun($, keyOf(run), stored => (stored?.id === run.id && stored.step === 'ready' ? advance(advance(stored, { type: 'publish' }, now), { type: 'drive', session: sessionId }, now) : null))
  if (!moved) return `#${run.issue} moved on before it could be published; /issue-forge status says where it is.`
  startDrive($, moved, false)
  return `publishing #${run.issue}: pushing ${run.branch} and opening a pull request against ${run.base}.`
}

async function stopRun($: EngineInterface, at: Repo | null, issue: number | null, byPress = false): Promise<string> {
  if (!at) return 'no active run here.'
  const { pick } = await pickFor($, at, issue, true)
  if (pick.kind === 'several') return severalText(pick.runs, 'stop', await lineCtx($))
  if (pick.kind === 'none') return noneText(issue, 'no active run here.')
  const run = pick.run
  await setFocus($, run)
  if (!isActive(run)) return 'no active run here.'
  // Another session's drive notices the stop within 5 s and ends itself (watch).
  const isElsewhere = drivingNow()?.runId !== run.id && isDrivenElsewhere(run, sessionId)
  if (byPress) {
    // The drive's own publish question is open: a Stop question would stack on it.
    if (publishAsking === run.id) return `#${run.issue}'s publish question is open; answer it first, then press Stop.`
    const refused = await refusedPress($, 'stop', run, isElsewhere)
    if (refused) return refused
  } else if (isElsewhere && !(await confirmTakeOver($, run))) return elsewhereText(run.issue)
  const isHere = drivingNow()?.runId === run.id
  if (isHere) endLocalDrive()
  const now = await $.clock.now()
  const stopped = await updateRun($, keyOf(run), stored => (stored?.id === run.id && isActive(stored) ? advance(stored, { type: 'stop' }, now) : null))
  if (isHere) $.ui.status(undefined)
  // The write is pinned to the run's id: a run replaced while a question was open is left alone, and said so.
  if (!stopped) return `#${run.issue} moved on before it could be stopped; /issue-forge status ${run.issue} says where.`
  return `stopped #${run.issue}. Its branch ${stopped.branch || '(none yet)'} and commits are kept; its agents are refused further tool calls.`
}

/** Ends this session's drive and clears it as the driver, keeping the step: any session can resume the run. */
async function handOff($: EngineInterface): Promise<Step | null> {
  const d = drivingNow()
  if (!d) return null
  endLocalDrive()
  $.ui.status(undefined)
  return ((await releaseDriver($, d)) ?? drivenLast)?.step ?? null
}

async function handOffRun($: EngineInterface, issue: number | null): Promise<string> {
  const d = drivingNow()
  if (!d) return 'this session is driving no run.'
  if (issue !== null && issue !== d.issue) return `this session drives #${d.issue}, not #${issue}.`
  const step = await handOff($)
  return `handed off #${d.issue} at ${step ?? 'its step'}; /issue-forge resume ${d.issue} continues it in any session.`
}

async function statusOf($: EngineInterface, at: Repo | null, issue: number | null): Promise<string> {
  if (!at) return 'not in a git repository.'
  const { pick, runs } = await pickFor($, at, issue, false)
  if (pick.kind === 'several') {
    const ctx = await lineCtx($)
    return [`${pick.runs.length} runs in this repository:`, ...pick.runs.map(r => lineOf(r, ctx))].join('\n')
  }
  if (pick.kind === 'none') {
    if (issue !== null) return noneText(issue, '')
    const { profile, errors } = await loadProfile($, at.root)
    return profileStatusText(errors, profile)
  }
  await setFocus($, pick.run)
  return statusFor($, pick.run, runs)
}

async function showStatus($: EngineInterface): Promise<void> {
  const demo = await read($, demoAtom)
  if (demo) {
    const d = demoRun(demo as DemoState, await $.clock.now())
    $.ui.toast(truncate(statusText(d.run, d.isDriving, await $.clock.now(), d.me, d.others).split('\n').slice(0, 2).join(' · '), 80))
    return
  }
  $.ui.toast(truncate((await statusOf($, await repoOf($), await read($, focusAtom))).split('\n').slice(0, 2).join(' · '), 80))
}

async function startDemo($: EngineInterface, state: DemoState | null): Promise<void> {
  await update($, nowAtom, () => 0)
  await update($, demoAtom, () => state ?? 'running')
}

async function stepDemo($: EngineInterface): Promise<void> {
  await update($, demoAtom, d => (d ? nextDemoState(d as DemoState) : d))
}

async function endDemo($: EngineInterface): Promise<void> {
  await update($, demoAtom, () => null)
}

type RunCommand = Extract<Command, { kind: 'start' | 'status' | 'resume' | 'publish' | 'stop' | 'handoff' }>

/** A command about a run, by the issue it names (Change 0.3.0). */
async function runCommand($: EngineInterface, at: Repo | null, cmd: RunCommand, byPress = false): Promise<string> {
  if (cmd.kind === 'start') return startRun($, at, cmd.issue, cmd.repo)
  const issue = cmd.issue ?? null
  switch (cmd.kind) {
    case 'status':
      return statusOf($, at, issue)
    case 'resume':
      return resumeRun($, at, issue)
    case 'publish':
      return publishRun($, at, issue, byPress)
    case 'stop':
      return stopRun($, at, issue, byPress)
    default:
      return handOffRun($, issue)
  }
}

/**
 * A pane press of Stop or Publish asks first, whatever `confirmPublish` says: a stray key must not do either (#31). The
 * command asks after its own refusals, about the run it picked, and the one question also covers a run another session
 * drives (PR #96 review). A typed command stays immediate. Null goes on; otherwise what a no, a dismissal or no one to
 * answer leaves, as the press's toast.
 */
async function refusedPress($: EngineInterface, kind: 'stop' | 'publish', run: Run, isElsewhere: boolean): Promise<string | null> {
  const ask = pressQuestion(kind, run, await $.clock.now(), isElsewhere)
  // The choice that changes nothing is listed first.
  return (await askOr($, ask.question, [ask.no, ask.yes])) === ask.yes ? null : ask.kept
}

/** A button acts on the run the pane shows (a demo only ends or ignores it; Stop and Publish ask first), then the also line is read again. */
async function press($: EngineInterface, kind: 'stop' | 'resume' | 'publish' | 'handoff'): Promise<void> {
  if (await read($, demoAtom)) return kind === 'stop' ? endDemo($) : undefined
  const at = await repoOf($)
  // Hand off acts on this session's drive, whichever run the pane shows.
  const issue = kind === 'handoff' ? undefined : ((await read($, focusAtom)) ?? undefined)
  $.ui.toast(truncate(await runCommand($, at, { kind, ...(issue === undefined ? {} : { issue }) }, true), 80))
  if (at) await refreshOthers($, at.repo)
}

/** Moves the 0.2 per-checkout keys of this repository to its 0.3.0 keys (SPEC Change 0.3.0, 2). */
async function migrate($: EngineInterface, at: Repo): Promise<void> {
  const legacy: LegacyEntry[] = []
  for (const key of await $.store.keys()) {
    const parsed = parseRunKey(key)
    if (parsed?.kind !== 'legacyRun') continue
    const run = await loadRun($, key)
    if (run) legacy.push({ key, root: parsed.root, run })
  }
  if (legacy.length === 0) return
  // Another checkout's key is this repository's only if git lists it: read once, only when there is one.
  const elsewhere = legacy.filter(e => normalizePath(e.root) !== normalizePath(at.root))
  const listed = elsewhere.length > 0 ? await git($, at.root, ['worktree', 'list', '--porcelain']) : null
  const worktrees = [at.root, ...elsewhere.map(e => e.root).filter(root => listed?.exitCode === 0 && worktreeStateOf(listed.stdout, root) !== 'unregistered')]
  const existing: Record<string, Run | null> = {}
  for (const e of legacy) existing[runKey(at.repo, e.run.issue)] = await loadRun($, runKey(at.repo, e.run.issue))
  const plan = migrationPlan(legacy, worktrees, at.repo, existing)
  for (const m of plan.moves) {
    await $.store.set(m.to, m.run)
    await mergeLegacyAgents($, m.root, at.repo, m.run.issue)
    await $.store.delete(m.from)
  }
  for (const d of plan.drops) {
    const parsed = parseRunKey(d.to)
    if (parsed?.kind === 'run') await mergeLegacyAgents($, d.root, at.repo, parsed.issue)
    await $.store.delete(d.from)
  }
}

/** The 0.2 list of a checkout's agents joins the moved run's list, so they stay refused. */
async function mergeLegacyAgents($: EngineInterface, root: string, repo: string, issue: number): Promise<void> {
  const from = legacyAgentsKey(root)
  const old = (await $.store.get(from)) as string[] | undefined
  if (!old) return
  const to = agentsKey(repo, issue)
  const current = ((await $.store.get(to)) as string[] | undefined) ?? []
  await $.store.set(to, [...new Set([...current, ...old])].slice(-MAX_KNOWN))
  await $.store.delete(from)
}

async function restore($: EngineInterface): Promise<void> {
  home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''
  sessionId = (await $.session.id().catch(() => '')) || `local-${await $.clock.now()}`
  const at = await repoOf($)
  if (!at) {
    knownRefs = new Set()
    await setFocus($, null)
    return
  }
  // One-time upgrade work: if it fails, the old keys wait for the next session start, and the guard still loads.
  await migrate($, at).catch(() => undefined)
  const runs = await runsOf($, at.repo)
  const stored: string[] = []
  for (const key of repoAgentsKeys(await $.store.keys(), at.repo)) stored.push(...(((await $.store.get(key)) as string[] | undefined) ?? []))
  knownRefs = new Set([...stored, ...runs.flatMap(refsOf)])
  await showPicked($, at, runs, await read($, focusAtom))
}

/**
 * After /clear, /resume or /branch every atom is back at its default and session.start doesn't run: the pane's run,
 * its focus and the also line come back from the store (#119). The drive and `sessionId` are the module's and stay:
 * the process goes on under a new session id, and the run's driver record names the old one.
 */
async function reseed($: EngineInterface): Promise<void> {
  // A resumed startup fires this before session.start (probed on 2.1.296 and 2.1.306): restore() seeds the pane there.
  if (!sessionId) return
  const kept = activityKept
  if (kept) await update($, activityAtom, () => kept)
  const at = await repoOf($)
  if (!at) return
  await showPicked($, at, await runsOf($, at.repo), focusKept)
}

/** At session end (not /clear or /resume: the process goes on), the run this session drives is let go. */
async function releaseOnEnd($: EngineInterface, reason: string): Promise<void> {
  const d = drivingNow()
  if (d && releasesOnEnd(reason)) await releaseDriver($, d)
}

/** What the pane draws outside a demo: the shown run, whether this session drives it, and the others. */
async function liveView($: EngineInterface): Promise<DemoView> {
  const run = await read($, runAtom)
  const isDriving = !!run && drivingNow()?.runId === run.id
  return { run, isDriving, activity: isDriving ? await read($, activityAtom) : null, others: await read($, othersAtom), me: sessionId }
}

// ── Hooks ─────────────────────────────────────────────────────────────────

export const register: Register = (on, raw) => {
  options = readOptions(raw)

  on('session.start', async ($, e, next) => {
    sessionCwd = e.cwd
    isInteractive = e.isInteractive
    await $.command
      .register({ name: 'issue-forge', description: 'Take a GitHub issue to a pull request, test-first, behind a coverage gate', argumentHint: '<issue number or URL> | status [N] | resume [N] | publish [N] | handoff [N] | stop [N] | demo' })
      .catch(() => undefined)
    for (const which of PHASES) {
      await $.agent
        .register({ name: which, description: AGENT_DESCRIPTIONS[which], prompt: agentPrompt(which), tools: ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash'] })
        .catch(() => undefined)
    }
    await restore($).catch(() => undefined)
    return next(e)
  })

  // /clear, /resume and /branch reset every atom; startup and compaction reset nothing (#119). A resumed startup
  // (claude --continue) also fires source resume, before session.start: reseed skips it.
  // Detached: two git calls and a store scan needn't hold the new conversation's start (PR #124 review).
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    void reseed($).catch(() => undefined)
    return next(e)
  }).catch(($, e, next) => next(e))

  // Change 0.3.0: a session that ends lets go of the run it drives, so another can resume it without a take-over.
  on('session.end', async ($, e, next) => {
    await releaseOnEnd($, e.reason).catch(() => undefined)
    return next(e)
  }).catch(($, e, next) => next(e))

  // The three phase agents are the mod's own: the main model is never offered them.
  on('agent.offer', { agent: 'issue-forge:red' }, () => ({ isOffered: false })).catch(() => ({ isOffered: false }))
  on('agent.offer', { agent: 'issue-forge:green' }, () => ({ isOffered: false })).catch(() => ({ isOffered: false }))
  on('agent.offer', { agent: 'issue-forge:refactor' }, () => ({ isOffered: false })).catch(() => ({ isOffered: false }))

  on('turn.complete', async ($, e, next) => {
    const id = e.agentId
    const w = id ? waiting[id] : undefined
    if (id && w) {
      delete waiting[id]
      w.resolve({ answer: e.answer, reason: e.reason })
    }
    return next(e)
  })

  // A run's agent that isn't live (stopped, or orphaned by a reload) is refused; the live one is kept in the run's folder (guardAction).
  on('tool.call', async ($, e, next) => {
    if (!e.agentId) return next(e)
    const ctx = { liveAgent, known: knownRefs, workRoot: liveWork?.workRoot ?? null, root: liveWork?.root ?? null }
    const action = guardAction(e, ctx)
    if (action.kind === 'deny') return { deny: action.reason }
    const call = action.kind === 'rewrite' ? ({ ...e, ...action.patch } as typeof e) : e
    // The live agent may edit a plugin manifest that exists (a version bump), never create one (Change 0.7.0).
    const manifest = manifestOf(call, ctx, liveWork?.testGlobs ?? [], liveWork?.baseManifests ?? [])
    if (manifest && !(await $.fs.stat(manifest.absolute).then(() => true, () => false))) {
      await recordNewPlugin($, manifest.relative)
      return { deny: newPluginRefusal(manifest.relative) }
    }
    return next(call)
  }).catch(($, e, next) => next(e))

  // An unnamed phase agent's report (or a named one's, with agent teams off) reaches the main loop as a peer prompt; the pane already has it (C0).
  on('prompt.submit', async ($, e, next) => {
    if (e.origin?.kind === 'peer' && knownRefs.size > 0 && isOwnHandback(e.text, [...knownRefs])) return { drop: HANDBACK_DROP }
    return next(e)
  }).catch(($, e, next) => next(e))

  // With agent teams on, a named phase agent is a teammate: its report is an idle notice from its name, and no prompt.submit fires (#27, P4).
  // Only that notice is consumed; anything else the agent sends reaches the model (PR #86 review).
  on('session.receive', async ($, e, next) => {
    if (isOwnMailboxHandback(e, [...knownRefs])) return { consumed: HANDBACK_DROP }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'issue-forge' }, async ($, e) => {
    try {
      const cmd = parseCommand(e.args)
      switch (cmd.kind) {
        case 'toggle': {
          const action = await paneActionOf($)
          if (action === 'show') {
            void bringToFront($).catch(() => undefined)
            return { text: SHOW_TEXT }
          }
          void (action === 'close' ? $.ui.close({ id: PANE }) : openPane($)).catch(() => undefined)
          return { text: action === 'close' ? 'closed. /issue-forge to reopen.' : `opened. ${USAGE}` }
        }
        case 'start':
        case 'status':
        case 'resume':
        case 'publish':
        case 'stop':
        case 'handoff': {
          const at = await repoOf($)
          const text = await runCommand($, at, cmd)
          // Every command reads the repository's runs again for the also line (Change 0.3.0).
          if (at) await refreshOthers($, at.repo).catch(() => undefined)
          return { text }
        }
        case 'demo':
          // The open goes out before this hook returns, ahead of the demo's state: an open after that is unasked.
          await openOrFront($).catch(() => undefined)
          void startDemo($, cmd.state).catch(() => undefined)
          return { text: `demo in the pane: [ Next state ] steps through ${DEMO_STATES.join(', ')}. Nothing real runs.` }
        default:
          return { text: `unknown: ${cmd.text}. ${USAGE}` }
      }
    } catch (err) {
      return { text: `something went wrong (${err instanceof Error ? err.message : String(err)}); see claude --debug.` }
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const demo = (await read($, demoAtom)) as DemoState | null
    const tickNow = await read($, nowAtom)
    const now = tickNow > 0 && !demo ? Math.max(tickNow, await $.clock.now()) : await $.clock.now()
    const live = demo ? demoRun(demo, now) : await liveView($)
    const run = live.run
    const view = viewOf(run, live.isDriving, live.me)
    // A final block is one resume can't clear (Change 0.7.0): no Resume button and no r in the hint.
    const canResume = (view === 'blocked' && !run?.blocked?.isFinal) || view === 'interrupted' || view === 'elsewhere'
    const others = live.others
    const canHandOff = live.isDriving && (view === 'running' || view === 'ready')
    const cols = Math.max(20, e.props.bodyColumns - 2)
    const layout = e.surface === 'mobile' ? 'compact' : layoutOf(e.props.bodyColumns)
    const rows = run && view !== 'blocked' && view !== 'stopped' ? phaseRows(run, now, live.activity) : []
    const cov = run ? coverageLine(run, layout) : null
    const masthead = run ? truncate(`${issueLabel(run)} ${run.title}`, Math.max(0, cols - 24)) : ''
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box justifyContent="space-between">
          <Text color="#D97757" bold>
            {layout === 'compact' ? 'ISSUE FORGE' : 'I S S U E   F O R G E'}
          </Text>
          {layout !== 'compact' && <Text dimColor>{masthead}</Text>}
        </Box>
        {demo && <Text dimColor>{`demo · ${demo} (${DEMO_STATES.indexOf(demo) + 1}/${DEMO_STATES.length})`}</Text>}
        <Text dimColor>{'─'.repeat(cols)}</Text>
        {view === 'empty' && <Text>No run here. /issue-forge &lt;issue number or URL&gt; starts one,</Text>}
        {view === 'empty' && <Text dimColor>/issue-forge demo shows every state.</Text>}
        {view === 'stopped' && run && <Text dimColor>{truncate(`Run #${run.issue} stopped; its branch ${run.branch || '(none)'} is kept.`, cols)}</Text>}
        {view === 'stopped' && <Text dimColor>/issue-forge &lt;issue number or URL&gt; starts another.</Text>}
        {(view === 'stopped' || view === 'done') && run && cleanupLine(run) && <Text dimColor>{truncate(cleanupLine(run) ?? '', cols)}</Text>}
        {view === 'blocked' && run?.blocked && (
          <Text color="#E06C6C">{truncate(`✕ blocked at ${run.blocked.at}: ${run.blocked.reason}`, cols)}</Text>
        )}
        {view === 'blocked' && run?.blocked && <Text dimColor>{truncate(`next: ${run.blocked.next}, then ${afterBlock(run)}`, cols)}</Text>}
        {view === 'blocked' && run?.blocked?.steps && run.blocked.steps.length > 0 && <Text dimColor>steps: /issue-forge status</Text>}
        {rows.map(row => (
          <Box key={`row-${row.label}`} flexDirection="column">
            <Box justifyContent="space-between">
              <Text color={COLORS[row.tone]} dimColor={row.tone === 'dim'}>
                {layout === 'compact' ? `${row.glyph} ${row.label}` : truncate(`${row.glyph} ${row.label.padEnd(9)} ${row.detail}`, cols - (layout === 'full' ? 8 : 0))}
              </Text>
              {layout === 'full' && <Text dimColor>{row.time}</Text>}
            </Box>
            {layout !== 'compact' &&
              row.notes.map((note, i) => (
                <Text key={`note-${row.label}-${i}`} dimColor>
                  {truncate(`             ${note}`, cols)}
                </Text>
              ))}
          </Box>
        ))}
        {view === 'interrupted' && run && <Text color="#E0B15A">{truncate(`◌ interrupted during ${run.step}; /issue-forge resume restarts it`, cols)}</Text>}
        {/* Two lines, as blocked has: the status text's one line doesn't fit a 76-column pane. */}
        {view === 'elsewhere' && run && <Text color="#E0B15A">{truncate(`◌ ${elsewhereLine(run, now).split('; ')[0] ?? ''}`, cols)}</Text>}
        {view === 'elsewhere' && run && <Text dimColor>{truncate(elsewhereLine(run, now).split('; ')[1] ?? '', cols)}</Text>}
        {view === 'ready' && run && layout !== 'compact' && mergeLine(run) && (
          <Text color={run.merge?.isClean ? '#7FB685' : '#E0B15A'}>{truncate(mergeLine(run) ?? '', cols)}</Text>
        )}
        {view === 'ready' && run && layout !== 'compact' && (
          <Text>{truncate(publishAsk(run), cols)}</Text>
        )}
        {view === 'done' && run && <Text color="#7FB685">✓ pull request opened</Text>}
        {view === 'done' && run?.prUrl && <Text color="#D97757">{truncate(run.prUrl, cols)}</Text>}
        {(cov || (run?.branch && layout === 'full') || (others.length > 0 && layout !== 'compact')) && <Text dimColor>{'─'.repeat(cols)}</Text>}
        {cov && <Text dimColor>{truncate(layout === 'full' ? `coverage   ${cov}` : cov, cols)}</Text>}
        {run?.branch && layout === 'full' && <Text dimColor>{truncate(`branch     ${branchLine(run)}`, cols)}</Text>}
        {others.length > 0 && layout !== 'compact' && <Text dimColor>{truncate(layout === 'full' ? `also       ${othersLine(others)}` : `also: ${othersLine(others)}`, cols)}</Text>}
        <Box gap={2} marginTop={1}>
          {view === 'ready' && <Button key="publish" label="Publish" hotkey="p" variant="primary" onPress={() => void press($, 'publish').catch(() => undefined)} />}
          {canResume && <Button key="resume" label="Resume" hotkey="r" variant="primary" onPress={() => void press($, 'resume').catch(() => undefined)} />}
          {canHandOff && <Button key="handoff" label="Hand off" hotkey="h" plain onPress={() => void press($, 'handoff').catch(() => undefined)} />}
          {(view === 'running' || view === 'blocked' || view === 'interrupted' || view === 'elsewhere' || view === 'ready') && <Button key="stop" label="Stop" hotkey="s" plain onPress={() => void press($, 'stop').catch(() => undefined)} />}
          {view !== 'empty' && <Button key="status" label="Status" hotkey="t" plain onPress={() => void showStatus($).catch(() => undefined)} />}
          {demo && <Button key="next" label="Next state" hotkey="n" plain onPress={() => void stepDemo($).catch(() => undefined)} />}
          {demo && <Button key="end" label="End demo" hotkey="e" plain onPress={() => void endDemo($).catch(() => undefined)} />}
        </Box>
        {layout !== 'compact' && (
          <Text dimColor>
            {truncate(
              [view === 'ready' ? 'p publish' : '', canResume ? 'r resume' : '', canHandOff ? 'h hand off' : '', view === 'running' || view === 'blocked' || view === 'interrupted' || view === 'elsewhere' || view === 'ready' ? 's stop' : '', view !== 'empty' ? 't status' : '', demo ? 'n next · e end' : '', 'ctrl+x tab: keys, again: next tab']
                .filter(Boolean)
                .join(' · '),
              cols,
            )}
          </Text>
        )}
      </Box>
    )
  })
}

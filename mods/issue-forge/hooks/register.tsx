import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

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
  agentName,
  agentsKey,
  agentPrompt,
  badgeOf,
  baseOf,
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
  failuresOf,
  findStash,
  foreignChange,
  gateG,
  gateR,
  guardAction,
  hasSourceRecord,
  hasStash,
  isAbsolutePath,
  isActive,
  isDrivenElsewhere,
  isLockError,
  isOwnHandback,
  isWorking,
  isWorktreeRun,
  keepText,
  keptWorktreePlan,
  layoutOf,
  lcovFileOf,
  lineOf,
  mergeLine,
  migrationPlan,
  newRun,
  nextDemoState,
  normalizePath,
  othersLine,
  othersOf,
  outsideChecks,
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
  pruneKeys,
  publishQuestion,
  readdWorktreeCommand,
  releasesOnEnd,
  repoRunKeys,
  routedRedBlock,
  runKey,
  severalText,
  sharedLcovBlock,
  splitZ,
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
  workOf,
  workspacePlan,
  worktreeAddFailure,
  worktreePath,
  worktreeStateOf,
} from './issue-forge-logic'
import type { CheckoutState, Command, CommandResult, DemoState, DemoView, Gate, Kept, KeptWorktreePlan, LegacyEntry, LineContext, MergeCheck, OtherRun, Phase, Profile, Run, RunEvent, RunPick, StashRef, Step, Tone } from './issue-forge-logic'

/**
 * Issue Forge: one GitHub issue to a pull request, test-first (SPEC.md "How it works").
 * Every `$` call lives here; every rule lives in issue-forge-logic.ts.
 */

const PANE = 'issue-forge'
const TITLE = 'Issue Forge'
const GIT_TIMEOUT = 60_000
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
let home = ''
/** This session's id, read once at session start: what a run's driver names (Change 0.3.0). */
let sessionId = ''
/** A drive: its run, the run's store key and issue, and whether it was stopped or handed off. */
type Drive = { runId: string; key: string; issue: number; isStopped: boolean }
/** The run this module is driving (one per session); null after a reload (the run then reads as interrupted). */
let driving: Drive | null = null
/** The driven run as last written: the status line's badge. */
let drivenLast: Run | null = null
/** Ends the long command running now (a stop, or its timeout). */
let stopCommand: (() => void) | null = null
/** The one agent of the run allowed to call tools; the run's other agents are refused (SPEC 9). */
let liveAgent: string | null = null
/** The live agent's run: where the guard keeps it (Change 0.2.0; an agent's cwd is ignored, P4). */
let liveWork: { root: string; workRoot: string } | null = null
/**
 * Every agent id and name a run of this repository has started, in memory for the tool.call guard
 * and the hand-back drop, and in the store so a new run or a reload never forgets one (an agent
 * can't be ended, only refused).
 */
let knownRefs = new Set<string>()
/** The last run write queued: updateRun chains each one after it. */
let runWrites: Promise<void> = Promise.resolve()
const waiting: Record<string, { resolve: (answer: string) => void; reject: (err: Error) => void }> = {}

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

async function git($: EngineInterface, root: string, args: string[], stdin?: string) {
  return $.process.run(['git', ...args], { cwd: root, timeoutMs: GIT_TIMEOUT, ...(stdin === undefined ? {} : { stdin }) })
}

/**
 * git that another process may hold a lock against (a parallel run's fetch, the shared stash, the index):
 * retried twice at once (Change 0.3.0). A fetch spends seconds on the network first, so the other is done.
 */
async function gitRetry($: EngineInterface, root: string, args: string[], stdin?: string) {
  let r = await git($, root, args, stdin)
  for (let i = 0; i < 2 && r.exitCode !== 0 && isLockError(`${r.stderr}\n${r.stdout}`); i++) r = await git($, root, args, stdin)
  return r
}

async function gitOut($: EngineInterface, root: string, args: string[]): Promise<string> {
  const r = await git($, root, args)
  if (r.exitCode !== 0) throw new Error(`git ${args[0]} failed: ${firstLine(r.stderr || r.stdout)}`)
  return r.stdout
}

function firstLine(text: string): string {
  return text.trim().split('\n')[0] ?? ''
}

async function rootOf($: EngineInterface): Promise<string | null> {
  const r = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { cwd: sessionCwd || undefined, timeoutMs: GIT_TIMEOUT }).catch(() => null)
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

async function saveRun($: EngineInterface, run: Run): Promise<void> {
  // A stop wins every race, a write lands only on the same run, and never on one another session took over (Change 0.3.0).
  await updateRun($, keyOf(run), stored => (!stored || stored.id !== run.id || (run.step !== 'stopped' && stored.step === 'stopped') || isTakenOver(stored) ? null : run))
}

/**
 * The branch and folder preflight just made, written onto the stored run at once, even over a stop, so a
 * Stop pressed before preflight returns never loses them (Codex, PR #41 round 3).
 */
async function recordMade($: EngineInterface, run: Run, made: Kept): Promise<void> {
  const now = await $.clock.now()
  await updateRun($, keyOf(run), stored => (stored?.id === run.id ? advance(stored, { type: 'made', keep: made }, now) : null))
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
  await update($, activityAtom, () => (label ? { label, since } : null))
}

/**
 * A long command (tests, coverage, checks) through `$.process.spawn`, killed at the profile's
 * timeout by ending its stream (C0 P3). Where spawn can't start (always under `claude plugin
 * test`), the same command runs through `$.process.run`, capped at ten minutes.
 */
async function runLong($: EngineInterface, argv: string[], root: string, minutes: number): Promise<CommandResult> {
  let text = ''
  let isTimedOut = false
  let isStopped = false
  let hasStarted = false
  const stream = $.process.spawn({ argv, cwd: root })
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
      result = hasStarted || isTimedOut || isStopped ? { exit: null, isTimedOut, tail: tailLines(text) } : await runShort($, argv, root, minutes, err)
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

/** Whether this module is still driving `run`: false once it was stopped or another drive took it over. */
function isDriving(run: Run): boolean {
  return driving !== null && driving.runId === run.id && !driving.isStopped
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

async function runShort($: EngineInterface, argv: string[], root: string, minutes: number, why: unknown): Promise<CommandResult> {
  try {
    const r = await $.process.run(argv, { cwd: root, timeoutMs: Math.min(minutes * 60_000, 600_000) })
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
  const r = await gitRetry($, root, ['commit', '-q', '-F', '-'], message)
  if (r.exitCode !== 0) throw new Error(`git commit failed: ${firstLine(r.stderr || r.stdout)}`)
  return (await gitOut($, root, ['rev-parse', 'HEAD'])).trim()
}

/** Stashes the tree under a unique message and records the entry's SHA (the list is shared by every worktree). */
async function stashAll($: EngineInterface, run: Run, message: string): Promise<StashRef | undefined> {
  await stillOwned($, run)
  const root = workOf(run)
  const pushed = await gitRetry($, root, ['stash', 'push', '--include-untracked', '-m', message])
  if (pushed.exitCode !== 0) throw new Error(`git stash failed: ${firstLine(pushed.stderr || pushed.stdout)}`)
  const sha = findStash(await gitOut($, root, STASH_LIST_ARGV.slice(1)), message)
  return sha ? { sha, message } : undefined
}

// ── Steps ─────────────────────────────────────────────────────────────────

type Blocked = Extract<RunEvent, { type: 'block' }>
const block = (reason: string, next: string): Blocked => ({ type: 'block', reason, next })

async function issueCheck($: EngineInterface, run: Run): Promise<Blocked | { title: string; body: string; url: string }> {
  const auth = await $.process.run(['gh', 'auth', 'status'], { cwd: run.root, timeoutMs: GIT_TIMEOUT }).catch(() => null)
  if (!auth || auth.exitCode !== 0) return block('gh is not signed in', 'run gh auth login')
  const view = await $.process.run(['gh', 'issue', 'view', String(run.issue), '--json', 'number,title,body,state,url'], { cwd: run.root, timeoutMs: GIT_TIMEOUT })
  if (view.exitCode !== 0) return block(`issue #${run.issue} not found: ${firstLine(view.stderr)}`, 'check the issue number')
  const issue = JSON.parse(view.stdout) as { title: string; body: string; state: string; url: string }
  if (issue.state !== 'OPEN') return block(`issue #${run.issue} is ${issue.state.toLowerCase()}`, 'reopen it or pick another issue')
  return { title: issue.title, body: issue.body ?? '', url: issue.url }
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

/** `git fetch origin <base>`, or the block naming why it failed. */
async function fetchBase($: EngineInterface, cwd: string, base: string): Promise<Blocked | null> {
  await setActivity($, `git fetch origin ${base}`)
  const fetched = await gitRetry($, cwd, ['fetch', 'origin', base])
  return fetched.exitCode === 0 ? null : block(`git fetch origin ${base} failed: ${firstLine(fetched.stderr)}`, 'check the base branch and the network')
}

/** A branch with no commits of its own fast-forwards to origin/<base>, so a fix pushed there reaches it. */
async function catchUp($: EngineInterface, run: Run, cwd: string, base: string): Promise<Blocked | null> {
  const hasNoOwnCommits = (await git($, cwd, ['merge-base', '--is-ancestor', 'HEAD', `origin/${base}`])).exitCode === 0
  if (!hasNoOwnCommits) return null
  stillDriving(run)
  await setActivity($, `catching up with origin/${base}`)
  const ff = await git($, cwd, ['merge', '--ff-only', '-q', `origin/${base}`])
  return ff.exitCode === 0 ? null : block(`could not fast-forward to origin/${base}: ${firstLine(ff.stderr)}`, 'check the branch')
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
 * Here or in a new worktree (Change 0.2.0). The base's profile decides, read from origin/<base> before
 * anything is made or switched; a busy checkout is never branched in place.
 */
async function whereToWork($: EngineInterface, run: Run, root: string, base: string): Promise<Blocked | Where> {
  const issue = run.issue
  await setActivity($, `reading ${PROFILE_FILE} from origin/${base}`)
  const shown = await git($, root, ['show', `origin/${base}:${PROFILE_FILE}`])
  const atBase = shown.exitCode === 0 ? parseProfile(shown.stdout, home) : { profile: undefined, errors: [firstLine(shown.stderr) || 'missing'] }
  if (!atBase.profile) return block(`origin/${base} has no valid ${PROFILE_FILE}: ${atBase.errors[0] ?? 'missing'}`, `commit ${PROFILE_FILE} to ${base}`)
  const { workspace, worktreeDir, commandTimeoutMinutes } = atBase.profile
  // `worktree` makes one whatever the checkout holds, so it isn't looked at (a status is slow on a big tree or a Windows mount).
  // Another active run working in this checkout makes it busy (Change 0.3.0).
  const holder = workspace === 'worktree' ? undefined : (await runsOf($, run.repo ?? root)).find(r => r.id !== run.id && isActive(r) && normalizePath(workOf(r)) === normalizePath(root))
  const state = workspace === 'worktree' ? { isBusy: false, why: '' } : await checkoutOf($, root, base, holder?.issue)
  // Start in the menu under `ask` was the answer to the worktree question: it isn't asked twice.
  const plan = workspacePlan(run.chosenWorktree && workspace === 'ask' ? 'worktree' : workspace, state, base)
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

/** Step 2: the base, where the run works, and the run's branch, cut here or in a new worktree. */
async function makeBranch($: EngineInterface, run: Run, issueBody: string): Promise<Blocked | Kept> {
  const root = run.root
  // This checkout's profile only names the base; the profile that is checked and runs is origin/<base>'s.
  await setActivity($, `reading ${PROFILE_FILE}`)
  const profileBase = checkoutBaseOf(await readLocalProfile($, root))
  const asked = baseOf({ baseBranch: profileBase }, issueBody)
  const base = asked === profileBase ? asked : await chooseBase($, run.issue, asked, profileBase)
  if (!base) return block(`issue #${run.issue} asks for base ${asked}, not ${profileBase}, and nobody confirmed it`, "answer the question in an interactive session, or remove the issue's Base branch line")
  stillDriving(run)
  const unfetched = await fetchBase($, root, base)
  if (unfetched) return unfetched
  const where = await whereToWork($, run, root, base)
  if ('type' in where) return where
  const local = splitZ((await gitOut($, root, ['for-each-ref', '--format=%(refname:short)%00', `refs/heads/issue-${run.issue}-*`, `refs/heads/issue-${run.issue}`])).replace(/\n/g, ''))
  const remote = (await gitOut($, root, ['ls-remote', '--heads', 'origin', `issue-${run.issue}*`]))
    .split('\n')
    .map(line => line.split('refs/heads/')[1] ?? '')
    .filter(Boolean)
  const branch = branchName(run.issue, run.title, [...local, ...remote])
  stillDriving(run)
  if (where.kind === 'here') {
    await setActivity($, `git switch -c ${branch}`)
    const switched = await git($, root, ['switch', '--no-track', '-c', branch, `origin/${base}`])
    if (switched.exitCode !== 0) return block(`git switch failed: ${firstLine(switched.stderr)}`, 'check the repository state')
    await recordMade($, run, { branch, workRoot: root, base })
    return { branch, workRoot: root, base }
  }
  const workRoot = worktreePath(root, where.worktreeDir, branch)
  if (await $.fs.exists(workRoot)) return block(`${workRoot} already exists`, 'remove it, or set another worktreeDir')
  await setActivity($, `git worktree add ${where.worktreeDir}/${branch}`)
  // A full checkout can outlast git's 60 s on a slow disk: it runs like the profile's commands, on their timeout.
  const made = { branch, workRoot, base }
  let added: CommandResult
  try {
    added = await runLong($, ['git', 'worktree', 'add', '--no-track', '-b', branch, workRoot, `origin/${base}`], root, where.minutes)
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
  const issue = await issueCheck($, run)
  if ('type' in issue) return issue
  let made: Kept
  if (run.branch) {
    made = { branch: run.branch, workRoot: workOf(run), base: run.base }
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
      const again = await runLong($, ['git', 'worktree', 'add', made.workRoot, made.branch], run.root, minutes)
      if (again.exit !== 0) return { ...block(worktreeAddFailure(again, minutes), `check ${made.workRoot}`), keep: made }
    }
    const unfetched = await fetchBase($, made.workRoot, made.base)
    if (unfetched) return { ...unfetched, keep: made }
    // A fix pushed to the base (the profile, a missing command) reaches the kept branch before it is checked again.
    const behind = await catchUp($, run, made.workRoot, made.base)
    if (behind) return { ...behind, keep: made }
  } else {
    const fresh = await makeBranch($, { ...run, title: issue.title }, issue.body)
    if ('type' in fresh) return fresh
    made = fresh
  }
  try {
    const mergeBase = (await gitOut($, made.workRoot, ['merge-base', 'HEAD', `origin/${made.base}`])).trim()
    // The profile whose commands run is the base's, not the checkout the run started from (which anyone may have pushed).
    await setActivity($, `reading ${PROFILE_FILE} from origin/${made.base}`)
    const trusted = await loadProfile($, made.workRoot)
    if (!trusted.profile) return { ...block(`origin/${made.base} has no valid ${PROFILE_FILE}: ${trusted.errors[0] ?? 'missing'}`, `commit ${PROFILE_FILE} to ${made.base}`), keep: made }
    // One LCOV file for every run can't serve two at once (Change 0.3.0).
    const shared = sharedLcovBlock(trusted.profile, made.workRoot, (await runsOf($, run.repo ?? run.root)).filter(r => r.id !== run.id))
    if (shared) return { ...block(shared.reason, shared.next), keep: made }
    return { type: 'preflighted', title: issue.title, body: issue.body, url: issue.url, base: made.base, branch: made.branch, mergeBase, profile: trusted.profile, workRoot: made.workRoot }
  } catch (err) {
    if (err instanceof Stopped) throw err
    return { ...block(`unexpected: ${err instanceof Error ? err.message : String(err)}`, 'see /issue-forge status'), keep: made }
  }
}

/**
 * Step 3. A branch with no commits of its own first catches up with the base (so "fix main, then resume"
 * works), and the merge base is computed afresh every time, so a blocked baseline never leaves a stale one.
 */
async function baseline($: EngineInterface, run: Run, p: Profile): Promise<RunEvent> {
  const root = workOf(run)
  const unfetched = await fetchBase($, root, run.base)
  if (unfetched) return unfetched
  const behind = await catchUp($, run, root, run.base)
  if (behind) return behind
  const mergeBase = (await gitOut($, root, ['merge-base', 'HEAD', `origin/${run.base}`])).trim()
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

function waitForAnswer(agentId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    waiting[agentId] = { resolve, reject }
  })
}

/** A phase: spawn its agent (named, so duet leaves it on Claude) and wait for its turn.complete. */
async function phase($: EngineInterface, run: Run, which: Phase, p: Profile): Promise<RunEvent | null> {
  const last = run.lastGate
  // A retry is this phase's own gate having failed last (an attempt count resets on resume; the failure stays relevant).
  const isRetry = !!last && !last.passed && last.gate === (which === 'red' ? 'R' : which === 'green' ? 'G' : 'F')
  const redTestPaths = which === 'green' && run.redCommit ? splitZ(await gitOut($, workOf(run), ['diff', '--name-only', '-z', run.mergeBase, run.redCommit])) : undefined
  const prompt = phasePrompt(which, run, {
    failures: isRetry && last ? failuresOf(last) : undefined,
    behaviourFor: which === 'red' ? run.behaviourFor : undefined,
    redTestPaths,
    testTail: which === 'green' && !isRetry ? run.redTestTail : isRetry && last?.checks.some(c => (c.id === 'G2' || c.id === 'R3') && !c.passed) ? run.lastTestTail : undefined,
  })
  const subagentType = which === 'red' ? options.redAgentType : `issue-forge:${which}`
  const isOwn = subagentType.startsWith('issue-forge:')
  const routed = routedRedBlock(subagentType, isWorktreeRun(run))
  if (routed) return block(routed.reason, routed.next)
  const name = isOwn ? agentName(run, which) : undefined
  const model = which === 'red' ? options.redModel : which === 'green' ? options.greenModel : options.refactorModel
  await setActivity($, `starting the ${which} agent`)
  const spawned = await $.agent.spawn({ subagentType, prompt, description: `issue-forge #${run.issue} ${which}`, model, cwd: workOf(run), ...(name ? { name } : {}) })
  const agentId = spawned.agentId
  // An agent another plugin answered in-line (duet's Codex) has no loop and no turn.complete (C0).
  const isInline = !!agentId && (spawned.model.startsWith('codex') || agentId.startsWith('duet-'))
  // Wait before any other await, so a fast agent's turn.complete finds its waiter.
  const answer = agentId && !isInline ? waitForAnswer(agentId) : null
  void answer?.catch(() => undefined)
  // Steer the agent from its first tool call: set before any other await, like the waiter.
  if (agentId) {
    liveAgent = agentId
    liveWork = { root: run.root, workRoot: workOf(run) }
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
      await rememberAgents($, run, name ? [agentId, name] : [agentId])
    }
    return null
  }
  if (spawned.deny !== undefined || !agentId) return block(`the ${which} agent didn't start: ${spawned.deny ?? 'no agent id'}`, 'check the agent type and model options')
  await rememberAgents($, run, name ? [agentId, name] : [agentId])
  await saveRun($, advance(latest, { type: 'spawned', agent: { id: agentId, ...(name ? { name } : {}), phase: which } }, await $.clock.now()))
  await setActivity($, 'agent working')
  try {
    return { type: 'agentDone', answer: answer ? await answer : '' }
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

/** Gate R (§3 step 4); on pass, the red commit, and after G6's return, green's work restored by its SHA. */
async function gateRStep($: EngineInterface, run: Run, p: Profile): Promise<RunEvent> {
  const root = workOf(run)
  const away = await offBranch($, run)
  if (away) return away
  stillDriving(run)
  await setActivity($, 'staging')
  await gitOut($, root, ['add', '-A'])
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
    const applied = await git($, root, stashApplyArgv(stash).slice(1))
    if (applied.exitCode !== 0) return restore(`could not restore green's work; it is in stash ${stash.sha.slice(0, 7)} "${stash.message}"`)
  }
  return { type: 'gated', gate, commit, testTail: tests.tail }
}

/** Gates G and F (§3 steps 5–6): G1–G7 over facts gathered here, judged in the logic module. */
async function gateGStep($: EngineInterface, run: Run, p: Profile, which: 'G' | 'F'): Promise<RunEvent> {
  const root = workOf(run)
  const redCommit = run.redCommit ?? run.mergeBase
  const away = await offBranch($, run)
  if (away) return away
  stillDriving(run)
  await setActivity($, 'staging')
  await gitOut($, root, ['add', '-A'])
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
  // The PR body says what was true when it was pushed: the merge is checked again here.
  const merge = await mergeCheck($, run)
  await $.fs.write(body, prBody({ ...run, merge }))
  stillDriving(run)
  await setActivity($, `git push origin ${run.branch}`)
  const pushed = await git($, workOf(run), ['push', 'origin', run.gatedHead ? `${run.gatedHead}:refs/heads/${run.branch}` : run.branch])
  if (pushed.exitCode !== 0) return block(`git push failed: ${firstLine(pushed.stderr)}`, 'check access to origin')
  stillDriving(run)
  await setActivity($, 'gh pr create')
  const pr = await $.process.run(['gh', 'pr', 'create', '--base', run.base, '--head', run.branch, '--title', `${run.title} (#${run.issue})`, '--body-file', body], { cwd: workOf(run), timeoutMs: GIT_TIMEOUT })
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
  await setActivity($, `checking the merge with origin/${run.base}`)
  try {
    const fetched = await gitRetry($, work, ['fetch', 'origin', run.base])
    if (fetched.exitCode !== 0) return { isClean: false, files: [], error: `git fetch origin ${run.base} failed: ${firstLine(fetched.stderr)}` }
    return parseMergeTree(await git($, work, ['merge-tree', '--write-tree', '--name-only', '--no-messages', '-z', run.gatedHead ?? `refs/heads/${run.branch}`, `origin/${run.base}`]))
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
  const me: Drive = { runId, key, issue: first.issue, isStopped: false }
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
          if (!(await confirmPublish($, checked))) return
        }
        // The question may have stayed open while /issue-forge publish (or stop) moved the run on.
        const now = await loadRun($, key)
        if (!now || now.id !== runId || now.step !== 'ready' || !isMine()) return
        await saveRun($, advance(now, { type: 'publish' }, await $.clock.now()))
        continue
      }
      if (!isWorking(run.step)) return
      let ev: RunEvent | null
      try {
        ev = await doStep($, run)
      } catch (err) {
        ev = block(`unexpected: ${err instanceof Error ? err.message : String(err)}`, 'see /issue-forge status')
      }
      if (!ev || !isMine()) return
      const latest = (await loadRun($, key)) ?? run
      if (latest.id !== runId || latest.step === 'stopped') return
      await saveRun($, advance(latest, ev, await $.clock.now()))
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
  const opened = await $.ui.open({ id: PANE, title: TITLE, columns: 76 })
  if (!opened.isPlaced) $.ui.toast(`${TITLE} needs a wider window. Widen it to see the pane, or watch the status line.`)
}

async function isOpen($: EngineInterface): Promise<boolean> {
  return (await $.ui.panes()).some(pane => pane.id === PANE)
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
  await update($, focusAtom, () => run?.issue ?? null)
  await update($, runAtom, () => run)
}

/** The also line, and the shown run as stored now: other sessions write the store too. */
async function refreshOthers($: EngineInterface, repo: string, known?: Run[]): Promise<void> {
  const runs = known ?? (await runsOf($, repo))
  const focus = await read($, focusAtom)
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
 * `/issue-forge <N>` (Change 0.3.0, 3): the same issue answers its status; another active run, or a drive in this
 * session, gets one question; otherwise the run starts.
 */
async function startRun($: EngineInterface, at: Repo | null, issue: number): Promise<string> {
  if (!at) return 'not in a git repository. Start Claude Code inside the repository the issue belongs to.'
  const runs = await runsOf($, at.repo)
  const same = runs.find(r => r.issue === issue && isActive(r))
  if (same) {
    await setFocus($, same)
    return `#${issue} has a run already.\n${await statusFor($, same, runs)}`
  }
  const d = drivingNow()
  const drivingRun = d ? (runs.find(r => r.id === d.runId) ?? null) : null
  const local = await readLocalProfile($, at.root)
  const workspace = checkoutWorkspaceOf(local)
  const others = runs.filter(r => isActive(r) && r.id !== drivingRun?.id)
  const menu = startChoices({ issue, base: checkoutBaseOf(local), workspace, driving: drivingRun, others, me: sessionId, now: await $.clock.now() })
  if (!menu) return begin($, at, issue, false)
  const action = startAnswer(menu, await askOr($, menu.question, menu.options.map(o => o.label)))
  const isChosen = workspace !== 'here'
  switch (action.kind) {
    case 'start':
      return begin($, at, issue, isChosen)
    case 'takeOver':
      return resumeRun($, at, action.issue, true)
    case 'resume':
      return resumeRun($, at, action.issue)
    case 'stopThenStart': {
      const stopped = await stopRun($, at, action.issue)
      return stopped.startsWith('stopped') ? `stopped #${action.issue}; ${await begin($, at, issue, isChosen)}` : stopped
    }
    case 'handOffThenStart': {
      const step = await handOff($)
      return step ? `handed off #${action.issue} at ${step}; ${await begin($, at, issue, isChosen)}` : 'this session is driving no run.'
    }
    case 'keep':
      return keepText(issue)
    default:
      return 'cancelled; nothing started.'
  }
}

/** Writes the new run, with this session as its driver, only if its key is still free; then drives it. */
async function begin($: EngineInterface, at: Repo, issue: number, isChosenWorktree: boolean): Promise<string> {
  const now = await $.clock.now()
  for (const key of pruneKeys(await listRuns($, at.repo))) {
    await $.store.delete(key)
    const parsed = parseRunKey(key)
    if (parsed?.kind === 'run') await $.store.delete(agentsKey(parsed.repo, parsed.issue))
  }
  const fresh: Run = { ...newRun(`${issue}-${now}`, at.root, issue, now), repo: at.repo, ...(isChosenWorktree ? { chosenWorktree: true } : {}) }
  const run = advance(fresh, { type: 'drive', session: sessionId }, now)
  await update($, focusAtom, () => issue)
  const claimed = await updateRun($, keyOf(run), stored => (isActive(stored) ? null : run))
  if (!claimed) return `#${issue} was started by another session a moment ago; /issue-forge status ${issue} says where it is.`
  await update($, demoAtom, () => null)
  void openPane($).catch(() => undefined)
  startDrive($, claimed)
  return `starting #${issue}; the pane shows progress. Nothing is pushed until you say yes.`
}

/** Re-checks what may have changed while the run waited (SPEC 12), then drives it again. */
async function resumeRun($: EngineInterface, at: Repo | null, issue: number | null, isTakeOver = false): Promise<string> {
  if (!at) return 'no run to resume here.'
  const { pick } = await pickFor($, at, issue, true)
  if (pick.kind === 'several') return severalText(pick.runs, 'resume', await lineCtx($))
  if (pick.kind === 'none') return noneText(issue, 'no run to resume here.')
  const run = pick.run
  await setFocus($, run)
  if (!isActive(run)) return 'no run to resume here.'
  const d = drivingNow()
  if (d?.runId === run.id) return `#${run.issue} is running already.`
  if (d) return `this session is driving #${d.issue}; /issue-forge handoff first, or resume #${run.issue} from another session.`
  if (isDrivenElsewhere(run, sessionId) && !isTakeOver && !(await confirmTakeOver($, run))) return elsewhereText(run.issue)
  const key = keyOf(run)
  const back = advance(run, { type: 'resume' }, await $.clock.now())
  if (back.branch) {
    const issueNow = await issueCheck($, back)
    const work = workOf(back)
    // A worktree that is gone, or a folder in its place, is preflight's to handle; at a later step it holds the
    // run's work, so the person decides. git runs in the folder only once git has it as the worktree.
    const kept = isWorktreeRun(back) ? await keptWorktree($, back.root, work) : 'reuse'
    const head = kept === 'reuse' ? (await gitOut($, work, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim() : null
    const why =
      'type' in issueNow
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
      await updateRun($, key, stored => (stored?.id === run.id ? advance(advance(back, why, now), { type: 'release', session: back.driver?.session ?? '' }, now) : null))
      return `still blocked: ${why.reason}.`
    }
  }
  const now = await $.clock.now()
  const driven = await updateRun($, key, stored => (stored?.id === run.id ? advance(back, { type: 'drive', session: sessionId }, now) : null))
  if (!driven) return `#${run.issue} moved on before it could be resumed; /issue-forge status ${run.issue} says where it is.`
  void openPane($).catch(() => undefined)
  startDrive($, driven)
  return `resuming #${back.issue} at ${back.step}.`
}

async function publishRun($: EngineInterface, at: Repo | null, issue: number | null): Promise<string> {
  if (!at) return 'no run to publish here.'
  const { pick } = await pickFor($, at, issue, false)
  if (pick.kind === 'several') return severalText(pick.runs, 'publish', await lineCtx($))
  if (pick.kind === 'none') return noneText(issue, 'no run to publish here.')
  const run = pick.run
  await setFocus($, run)
  if (run.step !== 'ready') return `#${run.issue} isn't ready to publish (${run.step}).`
  const d = drivingNow()
  if (d && d.runId !== run.id) return `this session is driving #${d.issue}; /issue-forge handoff first, or publish #${run.issue} from another session.`
  if (isDrivenElsewhere(run, sessionId) && !(await confirmTakeOver($, run))) return elsewhereText(run.issue)
  // A drive waiting on the publish question is taken over: when that question is answered, it finds the run moved on.
  if (driving?.runId === run.id) driving = null
  const now = await $.clock.now()
  const moved = await updateRun($, keyOf(run), stored => (stored?.id === run.id && stored.step === 'ready' ? advance(advance(stored, { type: 'publish' }, now), { type: 'drive', session: sessionId }, now) : null))
  if (!moved) return `#${run.issue} moved on before it could be published; /issue-forge status says where it is.`
  startDrive($, moved, false)
  return `publishing #${run.issue}: pushing ${run.branch} and opening a pull request against ${run.base}.`
}

async function stopRun($: EngineInterface, at: Repo | null, issue: number | null): Promise<string> {
  if (!at) return 'no active run here.'
  const { pick } = await pickFor($, at, issue, true)
  if (pick.kind === 'several') return severalText(pick.runs, 'stop', await lineCtx($))
  if (pick.kind === 'none') return noneText(issue, 'no active run here.')
  const run = pick.run
  await setFocus($, run)
  if (!isActive(run)) return 'no active run here.'
  const isHere = drivingNow()?.runId === run.id
  // Another session's drive notices the stop within 5 s and ends itself (watch).
  if (!isHere && isDrivenElsewhere(run, sessionId) && !(await confirmTakeOver($, run))) return elsewhereText(run.issue)
  if (isHere) endLocalDrive()
  const now = await $.clock.now()
  const stopped = await updateRun($, keyOf(run), stored => (stored?.id === run.id && isActive(stored) ? advance(stored, { type: 'stop' }, now) : null))
  if (isHere) $.ui.status(undefined)
  return `stopped #${run.issue}. Its branch ${(stopped ?? run).branch || '(none yet)'} and commits are kept; its agents are refused further tool calls.`
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
  await openPane($)
}

async function stepDemo($: EngineInterface): Promise<void> {
  await update($, demoAtom, d => (d ? nextDemoState(d as DemoState) : d))
}

async function endDemo($: EngineInterface): Promise<void> {
  await update($, demoAtom, () => null)
}

type RunCommand = Extract<Command, { kind: 'start' | 'status' | 'resume' | 'publish' | 'stop' | 'handoff' }>

/** A command about a run, by the issue it names (Change 0.3.0). */
async function runCommand($: EngineInterface, at: Repo | null, cmd: RunCommand): Promise<string> {
  if (cmd.kind === 'start') return startRun($, at, cmd.issue)
  const issue = cmd.issue ?? null
  switch (cmd.kind) {
    case 'status':
      return statusOf($, at, issue)
    case 'resume':
      return resumeRun($, at, issue)
    case 'publish':
      return publishRun($, at, issue)
    case 'stop':
      return stopRun($, at, issue)
    default:
      return handOffRun($, issue)
  }
}

/** A button acts on the run the pane shows (a demo only ends or ignores it), then the also line is read again. */
async function press($: EngineInterface, kind: 'stop' | 'resume' | 'publish' | 'handoff'): Promise<void> {
  if (await read($, demoAtom)) return kind === 'stop' ? endDemo($) : undefined
  const at = await repoOf($)
  // Hand off acts on this session's drive, whichever run the pane shows.
  const issue = kind === 'handoff' ? undefined : ((await read($, focusAtom)) ?? undefined)
  $.ui.toast(truncate(await runCommand($, at, { kind, ...(issue === undefined ? {} : { issue }) }), 80))
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
  const from = `issue-forge:agents:${root}`
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
  await migrate($, at)
  const runs = await runsOf($, at.repo)
  const stored: string[] = []
  for (const run of runs) stored.push(...(((await $.store.get(agentsKey(at.repo, run.issue))) as string[] | undefined) ?? []))
  knownRefs = new Set([...stored, ...runs.flatMap(refsOf)])
  const pick = pickRun(runs, { issue: null, focus: await read($, focusAtom), root: at.root, needActive: false })
  await setFocus($, pick.kind === 'run' ? pick.run : null)
  await refreshOthers($, at.repo, runs)
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
    await $.command
      .register({ name: 'issue-forge', description: 'Take a GitHub issue to a pull request, test-first, behind a coverage gate', argumentHint: '<issue> | status | resume | publish | stop | demo' })
      .catch(() => undefined)
    for (const which of PHASES) {
      await $.agent
        .register({ name: which, description: AGENT_DESCRIPTIONS[which], prompt: agentPrompt(which), tools: ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash'] })
        .catch(() => undefined)
    }
    await restore($).catch(() => undefined)
    return next(e)
  })

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
      w.resolve(e.answer)
    }
    return next(e)
  })

  // A run's agent that isn't live (stopped, or orphaned by a reload) is refused; the live one is kept in the run's folder (guardAction).
  on('tool.call', async ($, e, next) => {
    if (!e.agentId) return next(e)
    const action = guardAction(e, { liveAgent, known: knownRefs, workRoot: liveWork?.workRoot ?? null, root: liveWork?.root ?? null })
    if (action.kind === 'deny') return { deny: action.reason }
    if (action.kind === 'rewrite') return next({ ...e, ...action.patch } as typeof e)
    return next(e)
  }).catch(($, e, next) => next(e))

  // A phase agent's report reaches the main loop as a peer prompt; the pane already has it (C0).
  on('prompt.submit', async ($, e, next) => {
    if (e.origin?.kind === 'peer' && knownRefs.size > 0 && isOwnHandback(e.text, [...knownRefs])) return { drop: 'issue-forge: a phase agent finished; the pane has the result.' }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'issue-forge' }, async ($, e) => {
    try {
      const cmd = parseCommand(e.args)
      switch (cmd.kind) {
        case 'toggle': {
          const wasOpen = await isOpen($)
          void (wasOpen ? $.ui.close({ id: PANE }) : openPane($)).catch(() => undefined)
          return { text: wasOpen ? 'closed. /issue-forge to reopen.' : `opened. ${USAGE}` }
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
    const others = live.others
    const canHandOff = live.isDriving && (view === 'running' || view === 'ready')
    const cols = Math.max(20, e.props.bodyColumns - 2)
    const layout = e.surface === 'mobile' ? 'compact' : layoutOf(e.props.bodyColumns)
    const rows = run && view !== 'blocked' && view !== 'stopped' ? phaseRows(run, now, live.activity) : []
    const cov = run ? coverageLine(run, layout) : null
    const masthead = run ? truncate(`#${run.issue} ${run.title}`, Math.max(0, cols - 24)) : ''
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
        {view === 'empty' && <Text>No run here. /issue-forge &lt;issue number&gt; starts one,</Text>}
        {view === 'empty' && <Text dimColor>/issue-forge demo shows every state.</Text>}
        {view === 'stopped' && run && <Text dimColor>{truncate(`Run #${run.issue} stopped; its branch ${run.branch || '(none)'} is kept.`, cols)}</Text>}
        {view === 'stopped' && <Text dimColor>/issue-forge &lt;issue number&gt; starts another.</Text>}
        {(view === 'stopped' || view === 'done') && run && cleanupLine(run) && <Text dimColor>{truncate(cleanupLine(run) ?? '', cols)}</Text>}
        {view === 'blocked' && run?.blocked && (
          <Text color="#E06C6C">{truncate(`✕ blocked at ${run.blocked.at}: ${run.blocked.reason}`, cols)}</Text>
        )}
        {view === 'blocked' && run?.blocked && <Text dimColor>{truncate(`next: ${run.blocked.next}, then /issue-forge resume`, cols)}</Text>}
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
          <Text>{truncate(`Push ${run.branch} and open a pull request against ${run.base}?`, cols)}</Text>
        )}
        {view === 'done' && run && <Text color="#7FB685">✓ pull request opened</Text>}
        {view === 'done' && run?.prUrl && <Text color="#D97757">{truncate(run.prUrl, cols)}</Text>}
        {(cov || (run?.branch && layout === 'full') || (others.length > 0 && layout !== 'compact')) && <Text dimColor>{'─'.repeat(cols)}</Text>}
        {cov && <Text dimColor>{truncate(layout === 'full' ? `coverage   ${cov}` : cov, cols)}</Text>}
        {run?.branch && layout === 'full' && <Text dimColor>{truncate(`branch     ${branchLine(run)}`, cols)}</Text>}
        {others.length > 0 && layout !== 'compact' && <Text dimColor>{truncate(layout === 'full' ? `also       ${othersLine(others)}` : `also: ${othersLine(others)}`, cols)}</Text>}
        <Box gap={2} marginTop={1}>
          {view === 'ready' && <Button key="publish" label="Publish" hotkey="p" variant="primary" onPress={() => void press($, 'publish').catch(() => undefined)} />}
          {(view === 'blocked' || view === 'interrupted' || view === 'elsewhere') && <Button key="resume" label="Resume" hotkey="r" variant="primary" onPress={() => void press($, 'resume').catch(() => undefined)} />}
          {canHandOff && <Button key="handoff" label="Hand off" hotkey="h" plain onPress={() => void press($, 'handoff').catch(() => undefined)} />}
          {(view === 'running' || view === 'blocked' || view === 'interrupted' || view === 'elsewhere' || view === 'ready') && <Button key="stop" label="Stop" hotkey="s" plain onPress={() => void press($, 'stop').catch(() => undefined)} />}
          {view !== 'empty' && <Button key="status" label="Status" hotkey="t" plain onPress={() => void showStatus($).catch(() => undefined)} />}
          {demo && <Button key="next" label="Next state" hotkey="n" plain onPress={() => void stepDemo($).catch(() => undefined)} />}
          {demo && <Button key="end" label="End demo" hotkey="e" plain onPress={() => void endDemo($).catch(() => undefined)} />}
        </Box>
        {layout !== 'compact' && (
          <Text dimColor>
            {truncate(
              [view === 'ready' ? 'p publish' : '', view === 'blocked' || view === 'interrupted' || view === 'elsewhere' ? 'r resume' : '', canHandOff ? 'h hand off' : '', view === 'running' || view === 'blocked' || view === 'interrupted' || view === 'elsewhere' || view === 'ready' ? 's stop' : '', view !== 'empty' ? 't status' : '', demo ? 'n next · e end' : '', 'ctrl+x tab focuses the pane']
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

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import {
  AGENT_DESCRIPTIONS,
  DEMO_STATES,
  NAME,
  PHASES,
  PROFILE_FILE,
  STASH_LIST_ARGV,
  USAGE,
  advance,
  agentName,
  agentPrompt,
  badgeOf,
  baseOf,
  branchName,
  canRetry,
  commitMessage,
  coverageLine,
  demoRun,
  failuresOf,
  findStash,
  gateG,
  gateR,
  hasSourceRecord,
  hasStash,
  isActive,
  isOwnHandback,
  isWorking,
  layoutOf,
  newRun,
  nextDemoState,
  outsideChecks,
  parseCommand,
  parseLcov,
  parseProfile,
  phasePrompt,
  phaseRows,
  prBody,
  profileProblems,
  profileStatusText,
  splitZ,
  stashApplyArgv,
  stashMessage,
  statusText,
  tailLines,
  totals,
  truncate,
  viewOf,
} from './issue-forge-logic'
import type { CommandResult, DemoState, Gate, Phase, Profile, Run, RunEvent, StashRef, Tone } from './issue-forge-logic'

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

type Options = { redModel: string; greenModel: string; refactorModel: string; redAgentType: string; confirmPublish: boolean }

let options: Options = { redModel: 'opus', greenModel: 'sonnet', refactorModel: 'opus', redAgentType: 'issue-forge:red', confirmPublish: true }
let sessionCwd = ''
let home = ''
/** The run this module is driving; null after a reload (the run then reads as interrupted). */
let driving: { runId: string; isStopped: boolean } | null = null
/** Ends the long command running now (a stop, or its timeout). */
let stopCommand: (() => void) | null = null
/** The one agent of the run allowed to call tools; the run's other agents are refused (SPEC 9). */
let liveAgent: string | null = null
/**
 * Every agent id and name a run of this repository has started, in memory for the tool.call guard
 * and the hand-back drop, and in the store so a new run or a reload never forgets one (an agent
 * can't be ended, only refused).
 */
let knownRefs = new Set<string>()
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

const storeKey = (root: string) => `issue-forge:run:${root}`
const agentsKey = (root: string) => `issue-forge:agents:${root}`
const MAX_KNOWN = 500

function refsOf(run: Run | null): string[] {
  return run ? run.agents.flatMap(a => (a.name ? [a.id, a.name] : [a.id])) : []
}

// ── Outside world ─────────────────────────────────────────────────────────

async function git($: EngineInterface, root: string, args: string[], stdin?: string) {
  return $.process.run(['git', ...args], { cwd: root, timeoutMs: GIT_TIMEOUT, ...(stdin === undefined ? {} : { stdin }) })
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

async function loadRun($: EngineInterface, root: string): Promise<Run | null> {
  return ((await $.store.get(storeKey(root))) as Run | undefined) ?? null
}

async function saveRun($: EngineInterface, run: Run): Promise<Run> {
  await $.store.set(storeKey(run.root), run)
  await update($, runAtom, () => run)
  for (const ref of refsOf(run)) knownRefs.add(ref)
  return run
}

/** Adds agents to the repository's known list (memory and store); they are refused tools unless live. */
async function rememberAgents($: EngineInterface, root: string, refs: readonly string[]): Promise<void> {
  for (const ref of refs) knownRefs.add(ref)
  const stored = ((await $.store.get(agentsKey(root))) as string[] | undefined) ?? []
  const merged = [...new Set([...stored, ...refs])].slice(-MAX_KNOWN)
  await $.store.set(agentsKey(root), merged)
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
    for await (const piece of stream) {
      hasStarted = true
      text = (text + piece.text).slice(-200_000)
    }
    if (isTimedOut || isStopped) return { exit: null, isTimedOut, tail: tailLines(text) }
    const r = await stream.result
    return { exit: r.code, isTimedOut: false, tail: tailLines(text) }
  } catch (err) {
    if (hasStarted || isTimedOut || isStopped) return { exit: null, isTimedOut, tail: tailLines(text) }
    return runShort($, argv, root, minutes, err)
  } finally {
    timer.cancel()
    stopCommand = null
  }
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

async function commitAll($: EngineInterface, root: string, message: string): Promise<string | undefined> {
  const staged = await git($, root, ['diff', '--cached', '--quiet'])
  if (staged.exitCode === 0) return undefined
  const r = await git($, root, ['commit', '-q', '-F', '-'], message)
  if (r.exitCode !== 0) throw new Error(`git commit failed: ${firstLine(r.stderr || r.stdout)}`)
  return (await gitOut($, root, ['rev-parse', 'HEAD'])).trim()
}

/** Stashes the tree under a unique message and records the entry's SHA (the list is shared by every worktree). */
async function stashAll($: EngineInterface, root: string, message: string): Promise<StashRef | undefined> {
  await gitOut($, root, ['stash', 'push', '--include-untracked', '-m', message])
  const sha = findStash(await gitOut($, root, STASH_LIST_ARGV.slice(1)), message)
  return sha ? { sha, message } : undefined
}

// ── Steps ─────────────────────────────────────────────────────────────────

type Blocked = { type: 'block'; reason: string; next: string }
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
  const isLcovIgnored = outside.lcovInside === null ? null : (await git($, root, ['check-ignore', '-q', outside.lcovInside])).exitCode === 0
  const missing: string[] = []
  for (const c of outside.commands) {
    const found =
      c.kind === 'path'
        ? await $.fs.exists(c.argv0.startsWith('/') ? c.argv0 : `${root}/${c.argv0}`)
        : (await $.process.run(['sh', '-c', 'command -v "$1"', '_', c.argv0], { cwd: root, timeoutMs: GIT_TIMEOUT })).exitCode === 0
    if (!found) missing.push(c.argv0)
  }
  const problems = profileProblems(p, { isLcovIgnored, missing })
  return problems.length > 0 ? { profile: null, errors: problems } : { profile: p, errors: [] }
}

/** Step 1 and 2: preconditions, then the run's branch. */
async function preflight($: EngineInterface, run: Run): Promise<RunEvent> {
  const root = run.root
  await setActivity($, 'checking gh and the issue')
  const issue = await issueCheck($, run)
  if ('type' in issue) return issue
  await setActivity($, 'checking the working tree')
  if ((await gitOut($, root, ['status', '--porcelain'])).trim() !== '') return block('the working tree has changes', 'commit or stash them')
  await setActivity($, `reading ${PROFILE_FILE}`)
  const { profile, errors } = await loadProfile($, root)
  if (!profile) return block(errors[0] ?? `no ${PROFILE_FILE} in ${root}`, `fix ${PROFILE_FILE} (see the README)`)
  const asked = baseOf(profile, issue.body)
  const base = asked === profile.baseBranch ? asked : await chooseBase($, run.issue, asked, profile.baseBranch)
  if (!base) return block(`issue #${run.issue} asks for base ${asked}, not ${profile.baseBranch}, and nobody confirmed it`, "answer the question in an interactive session, or remove the issue's Base branch line")
  await setActivity($, `git fetch origin ${base}`)
  const fetched = await git($, root, ['fetch', 'origin', base])
  if (fetched.exitCode !== 0) return block(`git fetch origin ${base} failed: ${firstLine(fetched.stderr)}`, 'check the base branch and the network')
  const local = splitZ((await gitOut($, root, ['for-each-ref', '--format=%(refname:short)%00', `refs/heads/issue-${run.issue}-*`, `refs/heads/issue-${run.issue}`])).replace(/\n/g, ''))
  const remote = (await gitOut($, root, ['ls-remote', '--heads', 'origin', `issue-${run.issue}*`]))
    .split('\n')
    .map(line => line.split('refs/heads/')[1] ?? '')
    .filter(Boolean)
  const branch = branchName(run.issue, issue.title, [...local, ...remote])
  await setActivity($, `git switch -c ${branch}`)
  const switched = await git($, root, ['switch', '--no-track', '-c', branch, `origin/${base}`])
  if (switched.exitCode !== 0) return block(`git switch failed: ${firstLine(switched.stderr)}`, 'check the repository state')
  const mergeBase = (await gitOut($, root, ['merge-base', 'HEAD', `origin/${base}`])).trim()
  return { type: 'preflighted', title: issue.title, body: issue.body, url: issue.url, base, branch, mergeBase, profile }
}

/** Step 3. A branch with no commits of its own first catches up with the base (so "fix main, then resume" works). */
async function baseline($: EngineInterface, run: Run, p: Profile): Promise<RunEvent> {
  const root = run.root
  let mergeBase = run.mergeBase
  if ((await gitOut($, root, ['rev-list', '--count', `${run.mergeBase}..HEAD`])).trim() === '0') {
    await setActivity($, `catching up with origin/${run.base}`)
    await git($, root, ['fetch', 'origin', run.base])
    const ff = await git($, root, ['merge', '--ff-only', '-q', `origin/${run.base}`])
    if (ff.exitCode !== 0) return block(`could not fast-forward to origin/${run.base}: ${firstLine(ff.stderr)}`, 'check the branch')
    mergeBase = (await gitOut($, root, ['merge-base', 'HEAD', `origin/${run.base}`])).trim()
  }
  await setActivity($, 'running tests')
  const tests = await runLong($, p.testCommand, root, p.commandTimeoutMinutes)
  if (tests.exit !== 0) return block(tests.isTimedOut ? 'tests time out before any change' : 'tests fail before any change', `fix ${run.base}`)
  await setActivity($, 'running coverage')
  const since = await $.clock.now()
  const cov = await runLong($, p.coverageCommand, root, p.commandTimeoutMinutes)
  const text = cov.exit === 0 ? await readLcov($, p.lcovPath, since) : null
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
  const isRetry = !!last && !last.passed && run.used[which] > 0
  const redTestPaths = which === 'green' && run.redCommit ? splitZ(await gitOut($, run.root, ['diff', '--name-only', '-z', run.mergeBase, run.redCommit])) : undefined
  const prompt = phasePrompt(which, run, {
    failures: isRetry && last ? failuresOf(last) : undefined,
    behaviourFor: which === 'red' ? run.behaviourFor : undefined,
    redTestPaths,
    testTail: which === 'green' && !isRetry ? run.redTestTail : isRetry && last?.checks.some(c => (c.id === 'G2' || c.id === 'R3') && !c.passed) ? run.lastTestTail : undefined,
  })
  const subagentType = which === 'red' ? options.redAgentType : `issue-forge:${which}`
  const isOwn = subagentType.startsWith('issue-forge:')
  const name = isOwn ? agentName(run, which) : undefined
  const model = which === 'red' ? options.redModel : which === 'green' ? options.greenModel : options.refactorModel
  await setActivity($, `starting the ${which} agent`)
  const spawned = await $.agent.spawn({ subagentType, prompt, description: `issue-forge #${run.issue} ${which}`, model, cwd: run.root, ...(name ? { name } : {}) })
  const agentId = spawned.agentId
  // An agent another plugin answered in-line (duet's Codex) has no loop and no turn.complete (C0).
  const isInline = !!agentId && (spawned.model.startsWith('codex') || agentId.startsWith('duet-'))
  // Wait before any other await, so a fast agent's turn.complete finds its waiter.
  const answer = agentId && !isInline ? waitForAnswer(agentId) : null
  void answer?.catch(() => undefined)
  // A stop (or another run) while the spawn was pending wins: the agent is only refused tools.
  const latest = await loadRun($, run.root)
  if (!latest || latest.id !== run.id || latest.step !== run.step) {
    if (agentId) {
      delete waiting[agentId]
      await rememberAgents($, run.root, name ? [agentId, name] : [agentId])
    }
    return null
  }
  if (spawned.deny !== undefined || !agentId) return block(`the ${which} agent didn't start: ${spawned.deny ?? 'no agent id'}`, 'check the agent type and model options')
  liveAgent = agentId
  await rememberAgents($, run.root, name ? [agentId, name] : [agentId])
  await saveRun($, advance(latest, { type: 'spawned', agent: { id: agentId, ...(name ? { name } : {}), phase: which } }, await $.clock.now()))
  await setActivity($, 'agent working')
  try {
    return { type: 'agentDone', answer: answer ? await answer : '' }
  } finally {
    if (liveAgent === agentId) liveAgent = null
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
  const root = run.root
  await setActivity($, 'staging')
  await gitOut($, root, ['add', '-A'])
  // The behaviour pass must add a test of its own: judge it against the red commit, not the merge base.
  const staged = await stagedSince($, root, run.behaviourFor && run.redCommit ? run.redCommit : run.mergeBase)
  await setActivity($, 'running tests')
  const tests = await runLong($, p.testCommand, root, p.commandTimeoutMinutes)
  const gate = gateR(p, { staged, tests })
  if (!gate.passed) return { type: 'gated', gate, testTail: tests.tail }
  const isBehaviour = !!run.behaviourFor
  const commit = await commitAll($, root, commitMessage(isBehaviour ? 'behaviour' : 'red', run, run.behaviourFor ?? []))
  if (isBehaviour && run.greenStash) {
    const stash = run.greenStash
    if (!hasStash(await gitOut($, root, STASH_LIST_ARGV.slice(1)), stash.sha)) return block(`stash ${stash.sha.slice(0, 7)} is gone`, "restore green's work by hand")
    const applied = await git($, root, stashApplyArgv(stash).slice(1))
    if (applied.exitCode !== 0) return block(`could not restore green's work; it is in stash ${stash.sha.slice(0, 7)} "${stash.message}"`, 'apply it by hand')
  }
  return { type: 'gated', gate, commit, testTail: tests.tail }
}

/** Gates G and F (§3 steps 5–6): G1–G7 over facts gathered here, judged in the logic module. */
async function gateGStep($: EngineInterface, run: Run, p: Profile, which: 'G' | 'F'): Promise<RunEvent> {
  const root = run.root
  const redCommit = run.redCommit ?? run.mergeBase
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
  const lcov = coverage.exit === 0 ? await readLcov($, p.lcovPath, since) : null
  const diff = await gitOut($, root, ['diff', '-U0', '--cached', run.mergeBase])
  const checks: { argv: string[]; result: CommandResult }[] = []
  for (const [i, argv] of p.checks.entries()) {
    await setActivity($, `checks ${i + 1}/${p.checks.length}`)
    checks.push({ argv, result: await runLong($, argv, root, p.commandTimeoutMinutes) })
  }
  const gate: Gate = gateG(p, run.baseline, { staged, changedSinceRed, redPaths, tests, coverage, lcov, diff, checks }, root, which)
  if (gate.passed) {
    const commit = await commitAll($, root, commitMessage(which === 'G' ? 'green' : 'refactor', run))
    return { type: 'gated', gate, commit, testTail: tests.tail, ...(which === 'F' ? { head: await headOf($, root) } : {}) }
  }
  if (which === 'G' && gate.isBehaviourOnly && !run.isBehaviourDone) {
    await setActivity($, "stashing green's work")
    return { type: 'gated', gate, stash: await stashAll($, root, stashMessage('green', run)), testTail: tests.tail }
  }
  if (which === 'F' && !canRetry(run, 'refactor')) {
    await setActivity($, 'stashing the rejected refactor')
    const stash = await stashAll($, root, stashMessage('refactor', run))
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
    const head = await headOf($, run.root)
    if (head !== run.gatedHead) return block(`${run.branch} moved after gate F (HEAD ${head.slice(0, 7)}, checked ${run.gatedHead.slice(0, 7)})`, 'remove the new commits, or start a new run')
  }
  await $.fs.write(body, prBody(run))
  await setActivity($, `git push origin ${run.branch}`)
  const pushed = await git($, run.root, ['push', 'origin', run.gatedHead ? `${run.gatedHead}:refs/heads/${run.branch}` : run.branch])
  if (pushed.exitCode !== 0) return block(`git push failed: ${firstLine(pushed.stderr)}`, 'check access to origin')
  await setActivity($, 'gh pr create')
  const pr = await $.process.run(['gh', 'pr', 'create', '--base', run.base, '--head', run.branch, '--title', `${run.title} (#${run.issue})`, '--body-file', body], { cwd: run.root, timeoutMs: GIT_TIMEOUT })
  if (pr.exitCode !== 0) return block(`gh pr create failed: ${firstLine(pr.stderr)}`, `the branch is pushed; open the pull request by hand or /issue-forge publish`)
  return { type: 'published', url: pr.stdout.trim().split('\n').pop() ?? '' }
}

/**
 * An issue's `Base branch:` line names a branch anyone with push access may have written, and the
 * profile's commands run from it: confirm it first. No answer possible counts as no.
 */
async function chooseBase($: EngineInterface, issue: number, asked: string, profileBase: string): Promise<string | null> {
  try {
    const useAsked = `Use ${asked}`
    const useProfile = `Use ${profileBase}`
    const answer = await $.ui.ask(`Issue #${issue} asks to branch from ${asked}, not ${profileBase}, and the tests will run from that branch. Which base?`, [useAsked, useProfile])
    return answer === useAsked ? asked : answer === useProfile ? profileBase : null
  } catch {
    return null
  }
}

/** Asks before anything leaves the machine; no answer possible (claude -p, dismissed) counts as no. */
async function confirmPublish($: EngineInterface, run: Run): Promise<boolean> {
  if (!options.confirmPublish) return true
  try {
    const answer = await $.ui.ask(`Push ${run.branch} and open a pull request against ${run.base}?`, ['Publish', 'Not now'])
    return answer === 'Publish'
  } catch {
    return false
  }
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
 */
async function drive($: EngineInterface, root: string, runId: string, mayAsk: boolean): Promise<void> {
  const me = { runId, isStopped: false }
  driving = me
  const ticker = $.clock.every(1000, () => void tickOnce($).catch(() => undefined))
  const isMine = () => driving === me && !me.isStopped
  try {
    for (;;) {
      const run = await loadRun($, root)
      if (!run || run.id !== runId || !isMine()) return
      if (run.step === 'ready' && mayAsk) {
        mayAsk = false
        if (!(await confirmPublish($, run))) return
        // The question may have stayed open while /issue-forge publish (or stop) moved the run on.
        const now = await loadRun($, root)
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
      const latest = (await loadRun($, root)) ?? run
      if (latest.id !== runId || latest.step === 'stopped') return
      await saveRun($, advance(latest, ev, await $.clock.now()))
    }
  } finally {
    ticker.cancel()
    if (driving === me) {
      driving = null
      await setActivity($, null).catch(() => undefined)
      await announce($, root).catch(() => undefined)
    }
  }
}

async function tickOnce($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  await update($, nowAtom, () => now)
  const run = await read($, runAtom)
  if (run && driving) $.ui.status(badgeOf(run, now))
}

/** How a drive ended, said once: a toast, and the status line cleared. */
async function announce($: EngineInterface, root: string): Promise<void> {
  $.ui.status(undefined)
  const run = await loadRun($, root)
  if (!run) return
  if (run.step === 'ready') $.ui.toast(`#${run.issue} is ready. /issue-forge publish pushes it and opens the PR.`)
  else if (run.step === 'blocked' && run.blocked) $.ui.toast(truncate(`#${run.issue} blocked: ${run.blocked.reason}`, 80))
  else if (run.step === 'done') $.ui.toast(truncate(`PR opened: ${run.prUrl ?? ''}`, 80))
}

function startDrive($: EngineInterface, root: string, runId: string, mayAsk = true): void {
  void drive($, root, runId, mayAsk).catch(() => undefined)
}

// ── Commands and buttons ──────────────────────────────────────────────────

async function openPane($: EngineInterface): Promise<void> {
  const opened = await $.ui.open({ id: PANE, title: TITLE, columns: 76 })
  if (!opened.isPlaced) $.ui.toast(`${TITLE} needs a wider window. Widen it to see the pane, or watch the status line.`)
}

async function isOpen($: EngineInterface): Promise<boolean> {
  return (await $.ui.panes()).some(pane => pane.id === PANE)
}

async function startRun($: EngineInterface, issue: number): Promise<string> {
  const root = await rootOf($)
  if (!root) return 'not in a git repository. Start Claude Code inside the repository the issue belongs to.'
  const existing = await loadRun($, root)
  if (isActive(existing) && existing) return `a run is already active here.\n${statusText(existing, driving?.runId === existing.id, await $.clock.now())}`
  const now = await $.clock.now()
  const run = await saveRun($, newRun(`${issue}-${now}`, root, issue, now))
  await update($, demoAtom, () => null)
  void openPane($).catch(() => undefined)
  startDrive($, root, run.id)
  return `starting #${issue}; the pane shows progress. Nothing is pushed until you say yes.`
}

/** Re-checks what may have changed while the run waited (SPEC 12), then drives it again. */
async function resumeRun($: EngineInterface): Promise<string> {
  const root = await rootOf($)
  const run = root ? await loadRun($, root) : null
  if (!root || !run || !isActive(run)) return 'no run to resume here.'
  if (driving?.runId === run.id) return `#${run.issue} is running already.`
  if (run.step !== 'blocked' && !isWorking(run.step) && run.step !== 'ready') return statusText(run, false, await $.clock.now())
  const back = run.step === 'blocked' ? advance(run, { type: 'resume' }, await $.clock.now()) : run
  if (back.branch) {
    const issue = await issueCheck($, back)
    const head = (await gitOut($, root, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
    const why = 'type' in issue ? issue : head !== back.branch ? block(`HEAD is on ${head}, not ${back.branch}`, `git switch ${back.branch}`) : null
    if (why) {
      await saveRun($, advance(back, why, await $.clock.now()))
      return `still blocked: ${why.reason}.`
    }
  }
  await saveRun($, back)
  void openPane($).catch(() => undefined)
  startDrive($, root, back.id)
  return `resuming #${back.issue} at ${back.step}.`
}

async function publishRun($: EngineInterface): Promise<string> {
  const root = await rootOf($)
  const run = root ? await loadRun($, root) : null
  if (!root || !run || run.step !== 'ready') return run ? `#${run.issue} isn't ready to publish (${run.step}).` : 'no run to publish here.'
  // A drive waiting on the publish question is taken over: when that question is answered, it finds the run moved on.
  if (driving?.runId === run.id) driving = null
  await saveRun($, advance(run, { type: 'publish' }, await $.clock.now()))
  startDrive($, root, run.id, false)
  return `publishing #${run.issue}: pushing ${run.branch} and opening a pull request against ${run.base}.`
}

async function stopRun($: EngineInterface): Promise<string> {
  const root = await rootOf($)
  const run = root ? await loadRun($, root) : null
  if (!run || !isActive(run)) return 'no active run here.'
  if (driving?.runId === run.id) driving.isStopped = true
  stopCommand?.()
  liveAgent = null
  for (const [id, w] of Object.entries(waiting)) {
    delete waiting[id]
    w.reject(new Error('stopped'))
  }
  await saveRun($, advance(run, { type: 'stop' }, await $.clock.now()))
  $.ui.status(undefined)
  return `stopped #${run.issue}. Its branch ${run.branch || '(none yet)'} and commits are kept; its agents are refused further tool calls.`
}

async function statusOf($: EngineInterface): Promise<string> {
  const root = await rootOf($)
  if (!root) return 'not in a git repository.'
  const run = await loadRun($, root)
  if (run) return statusText(run, driving?.runId === run.id, await $.clock.now())
  const { profile, errors } = await loadProfile($, root)
  return profileStatusText(errors, profile)
}

async function showStatus($: EngineInterface): Promise<void> {
  const demo = await read($, demoAtom)
  if (demo) {
    const d = demoRun(demo as DemoState, await $.clock.now())
    $.ui.toast(truncate(statusText(d.run, d.isDriving, await $.clock.now()).split('\n').slice(0, 2).join(' · '), 80))
    return
  }
  $.ui.toast(truncate((await statusOf($)).split('\n').slice(0, 2).join(' · '), 80))
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

async function pressStop($: EngineInterface): Promise<void> {
  if (await read($, demoAtom)) return endDemo($)
  $.ui.toast(truncate(await stopRun($), 80))
}

async function pressResume($: EngineInterface): Promise<void> {
  if (await read($, demoAtom)) return
  $.ui.toast(truncate(await resumeRun($), 80))
}

async function pressPublish($: EngineInterface): Promise<void> {
  if (await read($, demoAtom)) return
  $.ui.toast(truncate(await publishRun($), 80))
}

async function restore($: EngineInterface): Promise<void> {
  home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''
  const root = await rootOf($)
  const run = root ? await loadRun($, root) : null
  const stored = root ? (((await $.store.get(agentsKey(root))) as string[] | undefined) ?? []) : []
  knownRefs = new Set([...stored, ...refsOf(run)])
  await update($, runAtom, () => run)
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

  // A run's agent that isn't the live one (stopped, or orphaned by a reload) may not use tools.
  on('tool.call', async ($, e, next) => {
    const id = e.agentId
    if (id && id !== liveAgent && knownRefs.has(id)) return { deny: 'issue-forge: this run was stopped or restarted; end your turn now without further tool calls.' }
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
          return { text: await startRun($, cmd.issue) }
        case 'status':
          return { text: await statusOf($) }
        case 'resume':
          return { text: await resumeRun($) }
        case 'publish':
          return { text: await publishRun($) }
        case 'stop':
          return { text: await stopRun($) }
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
    const live = demo ? demoRun(demo, now) : { run: await read($, runAtom), isDriving: driving !== null, activity: await read($, activityAtom) }
    const run = live.run
    const view = viewOf(run, live.isDriving)
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
        {view === 'ready' && run && layout !== 'compact' && (
          <Text>{truncate(`Push ${run.branch} and open a pull request against ${run.base}?`, cols)}</Text>
        )}
        {view === 'done' && run && <Text color="#7FB685">✓ pull request opened</Text>}
        {view === 'done' && run?.prUrl && <Text color="#D97757">{truncate(run.prUrl, cols)}</Text>}
        {(cov || (run?.branch && layout === 'full')) && <Text dimColor>{'─'.repeat(cols)}</Text>}
        {cov && <Text dimColor>{truncate(layout === 'full' ? `coverage   ${cov}` : cov, cols)}</Text>}
        {run?.branch && layout === 'full' && <Text dimColor>{truncate(`branch     ${run.branch} → ${run.base}`, cols)}</Text>}
        <Box gap={2} marginTop={1}>
          {view === 'ready' && <Button key="publish" label="Publish" hotkey="p" variant="primary" onPress={() => void pressPublish($).catch(() => undefined)} />}
          {(view === 'blocked' || view === 'interrupted') && <Button key="resume" label="Resume" hotkey="r" variant="primary" onPress={() => void pressResume($).catch(() => undefined)} />}
          {(view === 'running' || view === 'blocked' || view === 'interrupted' || view === 'ready') && <Button key="stop" label="Stop" hotkey="s" plain onPress={() => void pressStop($).catch(() => undefined)} />}
          {view !== 'empty' && <Button key="status" label="Status" hotkey="t" plain onPress={() => void showStatus($).catch(() => undefined)} />}
          {demo && <Button key="next" label="Next state" hotkey="n" plain onPress={() => void stepDemo($).catch(() => undefined)} />}
          {demo && <Button key="end" label="End demo" hotkey="e" plain onPress={() => void endDemo($).catch(() => undefined)} />}
        </Box>
        {layout !== 'compact' && (
          <Text dimColor>
            {truncate(
              [view === 'ready' ? 'p publish' : '', view === 'blocked' || view === 'interrupted' ? 'r resume' : '', view === 'running' || view === 'blocked' || view === 'interrupted' || view === 'ready' ? 's stop' : '', view !== 'empty' ? 't status' : '', demo ? 'n next · e end' : '', 'ctrl+x tab focuses the pane']
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

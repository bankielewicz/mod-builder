import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import {
  agentResult, appendLog, buildHandoff, coerceConfigValue, configText, findConfigField, modelsText, modelWarning, parseModelCatalog, pickable, planDraft, storedText, CONFIG_FIELDS, CONFIG_USAGE, MODELS_ARGV, candidateOf, childEnv, codexArgv, codexLaunch, countsOf, demoTasks, effectiveSandbox,
  EMPTY_RUN, EMPTY_TEXT, envelopeLines, failureOf, foldAll, foldEvent, footerOf, layoutOf, moved,
  parseReviewArgs, pickAgent, readOptions, reviewArgv, routesText, rowsThatFit, rowText, runLineOf,
  splitLines, statsText, statusLineOf, subText, summarize, tokensOf, verdictOf, writePathsOf, folderUnder, isInside, isProtectedPath, parentOf, pathDirs, resolveFrom, DEFAULT_TYPE,
  claudeTaskOf, deliveryText, launchedRecord, liveCount, lostOnReload, modeOf, pendingIdOf, roleDef, roleDescription, rolesFor, routeOf, routesLines, runsInBackground, READ_ONLY_CANDIDATE, ROLE_PREFIX,
  codexRunning, consentText, fallbackFailure, FALLBACK_MAX_MS, hashablePaths, limitText, sessionFolderOf, snapshotOf,
} from './duet-logic'
import type { AgentDef, ClaudePending, CodexModel, ConfigField, Envelope, FsScope, Options, ReviewTarget, Role, Run, Sandbox, Task } from './duet-logic'

/**
 * Duet: delegates chosen subagent types and its own `duet:` roles to Codex,
 * runs independent Codex reviews, and measures every run. Archetype: pane +
 * command, with a tool.call {tool:'Agent'} hook in guard form that answers
 * routed calls: read-only runs at once (the answer arrives later through
 * $.prompt.submit), editing runs in the foreground.
 */

const PANE = 'duet'
const CONFIG_PANE = 'duet-config'
const COLORS = { accent: '#D97757', success: '#7FB685', warn: '#E0B15A', error: '#E06C6C' } as const
const STATUS_COLOR = { running: COLORS.accent, done: COLORS.success, error: COLORS.error, refused: COLORS.warn } as const
const YES = 'Yes, send to Codex'
const NO = 'No'

const tasks = atom({ plugin: 'duet', key: 'tasks' } as const, [])
const selected = atom({ plugin: 'duet', key: 'selected' } as const, 0)
const view = atom({ plugin: 'duet', key: 'view' } as const, 'tasks')
const consent = atom({ plugin: 'duet', key: 'consent' } as const, 'unasked')
const statsAtom = atom({ plugin: 'duet', key: 'statsText' } as const, '')
const nowAtom = atom({ plugin: 'duet', key: 'now' } as const, 0)
const isDemo = atom({ plugin: 'duet', key: 'isDemo' } as const, false)
const draftAtom = atom({ plugin: 'duet', key: 'configDraft' } as const, {} as Record<string, string>)
const noteAtom = atom({ plugin: 'duet', key: 'configNote' } as const, '')
const savingAtom = atom({ plugin: 'duet', key: 'configSaving' } as const, false)
const cfgAt = atom({ plugin: 'duet', key: 'configAt' } as const, 0)
const editingAtom = atom({ plugin: 'duet', key: 'configEditing' } as const, '')
const modelsAtom = atom({ plugin: 'duet', key: 'configModels' } as const, [] as CodexModel[])
const modelsStateAtom = atom({ plugin: 'duet', key: 'configModelsState' } as const, 'idle')
const pickingAtom = atom({ plugin: 'duet', key: 'configPicking' } as const, false)
const reopenAtom = atom({ plugin: 'duet', key: 'configReopenAt' } as const, 0)
const claudePending = atom({ plugin: 'duet', key: 'claudePending' } as const, {} as Record<string, ClaudePending>)
/** A reload this long after a save began is that save's own; later ones leave the pane alone. */
const REOPEN_WINDOW_MS = 60_000
const MODEL_FIELD = CONFIG_FIELDS.find(f => f.field === 'codexModel')!

let options: Options = readOptions({})
let rawOptions: unknown = {}
let ticker: Timer | null = null
/** Codex runs this module instance started; a running row not in here was cut off by a reload. */
const mine = new Set<string>()

// ── Pane, status, ticker ─────────────────────────────────────────────────

async function openPane($: EngineInterface): Promise<void> {
  const opened = await $.ui.open({ id: PANE, title: 'Duet', columns: 76 })
  if (!opened.isPlaced) $.ui.toast('Duet needs a wider window. Widen it to see the pane, or watch the status line.')
}

async function isOpen($: EngineInterface): Promise<boolean> {
  return (await $.ui.panes()).some(pane => pane.id === PANE)
}

async function refreshStatus($: EngineInterface): Promise<void> {
  $.ui.status(statusLineOf(await read($, tasks)))
}

/** One 1 s clock while anything runs; it stops itself when nothing does. */
async function ensureTicker($: EngineInterface): Promise<void> {
  await update($, nowAtom, () => Date.now())
  if (ticker) return
  ticker = $.clock.every(1000, () => {
    void tick($).catch(() => undefined)
  })
}

async function tick($: EngineInterface): Promise<void> {
  const list = await read($, tasks)
  const demo = await read($, isDemo)
  if (!demo && !list.some(t => t.status === 'running')) {
    ticker?.cancel()
    ticker = null
    return
  }
  await update($, nowAtom, () => Date.now())
}

async function putTask($: EngineInterface, task: Task): Promise<void> {
  await update($, tasks, list => [task, ...list.filter(t => t.id !== task.id)])
  await refreshStatus($)
}

/** Adds a refused row, its id taken inside the same update, so it can never land on a live row's id. */
async function addRefused($: EngineInterface, make: (id: string) => Task): Promise<Task> {
  let added: Task | null = null
  await update($, tasks, list => {
    added = make(idAfter(list))
    return [added, ...list]
  })
  await refreshStatus($)
  return added!
}

async function patchTask($: EngineInterface, id: string, patch: Partial<Task>): Promise<void> {
  await update($, tasks, list => list.map(t => (t.id === id ? { ...t, ...patch } : t)))
  await refreshStatus($)
}

function idAfter(list: Task[]): string {
  const n = list.reduce((m, t) => Math.max(m, Number(t.id.slice(1)) || 0), 0)
  return `d${n + 1}`
}

async function nextId($: EngineInterface): Promise<string> {
  return idAfter(await read($, tasks))
}

/** Admits a run under the concurrency limit, its row added in the same write: the row, or null at the limit. */
async function admit($: EngineInterface, make: (id: string) => Task): Promise<Task | null> {
  let admitted: Task | null = null
  await update($, tasks, list => {
    const t = make(idAfter(list))
    admitted = codexRunning(list) < options.maxConcurrent ? t : null
    return admitted ? [t, ...list] : list
  })
  await refreshStatus($)
  return admitted
}

// ── Files ────────────────────────────────────────────────────────────────

/** The user's home folder: HOME, else USERPROFILE (Windows); '' when neither is set. */
async function homeDir($: EngineInterface): Promise<string> {
  return (await $.env.get('HOME')) || (await $.env.get('USERPROFILE')) || ''
}

async function dataDir($: EngineInterface): Promise<string> {
  return `${(await homeDir($)) || '.'}/.claude/duet-data`
}

/** This session's own folder, for per-task files: ids restart at d1 in every session. */
async function sessionDir($: EngineInterface): Promise<string> {
  const id = await $.session.id().catch(() => 'unknown')
  return `${await dataDir($)}/sessions/${sessionFolderOf(id)}`
}

// Appends to runs.jsonl one at a time within this session (it is read, appended and rewritten).
let logChain: Promise<void> = Promise.resolve()

async function readText($: EngineInterface, path: string): Promise<string> {
  try {
    return String(await $.fs.read(path))
  } catch {
    return ''
  }
}

async function appendRun($: EngineInterface, task: Task): Promise<void> {
  const path = `${await dataDir($)}/runs.jsonl`
  await $.fs.write(path, appendLog(await readText($, path), runLineOf(task)))
}

function logRun($: EngineInterface, task: Task): Promise<void> {
  logChain = logChain.catch(() => undefined).then(() => appendRun($, task))
  return logChain
}

/** How many folders deep below a `.claude/agents` folder duet's own search goes. */
const AGENT_DEPTH = 8
/** How many `.md` files duet's own search reads per `.claude/agents` folder. */
const AGENT_FILES = 500
/** How many agent files are read at once: enough to overlap the reads, few enough to stay far from the open-file limit. */
const AGENT_READS = 16

/** Agent files by path, read again only when their size or time changed; the folders are listed on every call. */
const agentCache = new Map<string, { size: number; mtimeMs: number; text: string }>()

type AgentEntry = { path: string; size: number; mtimeMs: number }
/** Which of the search's limits a lookup reached: a folder it did not enter, or a `.md` file it did not read. */
type AgentCut = { depth: boolean; files: boolean }

/**
 * The `.claude/agents` folders Claude scans, nearest first: the session folder up to the repository root,
 * then the user's. As Claude does, the repository root is the nearest folder holding a `.git` entry, whether
 * or not git can read it; without one the search goes up to the filesystem root.
 */
async function agentRoots($: EngineInterface, cwd: string): Promise<string[]> {
  const start = cwd.replace(/\\/g, '/').replace(/\/+$/, '')
  const folders: string[] = []
  for (let dir = start; ; dir = parentOf(dir)) {
    folders.push(`${dir}/.claude/agents`)
    if (parentOf(dir) === dir || (await $.fs.exists(`${dir}/.git`).catch(() => false))) break
  }
  const home = await homeDir($)
  const user = `${home.replace(/\\/g, '/').replace(/\/+$/, '')}/.claude/agents`
  return home && !folders.includes(user) ? [...folders, user] : folders
}

/**
 * The `.md` files under an agents folder, subfolders and dot-folders included. A symbolic link is followed, as
 * Claude follows it; a folder whose real path was already searched (a link loop, or a root linked into another)
 * isn't searched again. A failed list is an empty folder. Past the limits, a folder isn't entered and a file
 * isn't listed; `cut` records which limit hid a `.md` file, or a folder or link that may hold one.
 */
async function listAgentFiles($: EngineInterface, dir: string, searched: Set<string>, cut: AgentCut, found: AgentEntry[] = [], depth = 0): Promise<AgentEntry[]> {
  const real = await realPathOf($, dir)
  if (real === undefined || searched.has(real)) return found
  if (depth > AGENT_DEPTH || found.length >= AGENT_FILES) {
    // A look inside, one level and no reads: only a folder that may hold a definition cuts the search short.
    const inside = await $.fs.list(dir).catch(() => [])
    if (inside.some(e => e.isLink || e.kind === 'dir' || (e.kind === 'file' && e.name.endsWith('.md')))) {
      if (depth > AGENT_DEPTH) cut.depth = true
      else cut.files = true
    }
    return found
  }
  searched.add(real)
  const entries = []
  for (const e of [...(await $.fs.list(dir).catch(() => []))].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    entries.push(e.isLink ? { ...e, ...(await $.fs.stat(`${dir}/${e.name}`).catch(() => ({ kind: 'other' as const }))) } : e)
  }
  for (const e of entries) {
    if (e.kind !== 'file' || !e.name.endsWith('.md')) continue
    if (found.length < AGENT_FILES) found.push({ path: `${dir}/${e.name}`, size: e.size, mtimeMs: e.mtimeMs })
    else cut.files = true
  }
  for (const e of entries) {
    if (e.kind === 'dir') await listAgentFiles($, `${dir}/${e.name}`, searched, cut, found, depth + 1)
  }
  return found
}

/** An agent file's text, from the cache while its size and time match the listing. */
async function agentText($: EngineInterface, e: AgentEntry): Promise<string> {
  const cached = agentCache.get(e.path)
  if (cached && cached.size === e.size && cached.mtimeMs === e.mtimeMs) return cached.text
  const text = await readText($, e.path)
  if (text) agentCache.set(e.path, { size: e.size, mtimeMs: e.mtimeMs, text })
  else agentCache.delete(e.path)
  return text
}

/**
 * A folder's agent texts in the listing's order, read AGENT_READS at a time. A read that fails is tried once more on
 * its own, since an error such as too many open files passes; one that fails again is left out, as Claude leaves out
 * a file it can't read.
 */
async function agentTexts($: EngineInterface, entries: AgentEntry[]): Promise<string[]> {
  const texts: string[] = []
  for (let i = 0; i < entries.length; i += AGENT_READS) texts.push(...(await Promise.all(entries.slice(i, i + AGENT_READS).map(e => agentText($, e)))))
  for (const [i, e] of entries.entries()) if (!texts[i]) texts[i] = await agentText($, e)
  return texts
}

/** Forgets the cached files under a searched folder that its listing no longer holds, so the cache never outgrows the folders. */
function pruneAgentCache(dir: string, listed: Set<string>): void {
  for (const path of [...agentCache.keys()]) {
    if (path.startsWith(`${dir}/`) && !listed.has(path)) agentCache.delete(path)
  }
}

/** What Claude reads when a lookup reached a limit: a definition past it was never read, so the one used may not be Claude's. */
function cutText(type: string, cut: AgentCut): string {
  const limits = [...(cut.depth ? [`${AGENT_DEPTH} folders deep`] : []), ...(cut.files ? [`${AGENT_FILES} .md files in one .claude/agents folder`] : [])]
  return limits.length ? `duet: the search for the ${type} agent definition was cut short at ${limits.join(' and ')}; a definition past that was not read, so Claude may use a different one, and duet ran this agent read-only.` : ''
}

/**
 * The custom agent's definition by Claude's discovery rules: the nearest `.claude/agents` folder with a file
 * named `type` in its `name` field, and a note when the search was cut short by its depth or file limit.
 * Agents from managed settings, `--agents`, a plugin or `--add-dir` aren't reachable, so they are a miss.
 */
async function agentDef($: EngineInterface, cwd: string, type: string): Promise<{ def: AgentDef | null; note: string }> {
  if (!/^[\w.:-]+$/.test(type)) return { def: null, note: '' }
  // A folder is listed and read only when every nearer one had no match, so each pick sees that folder alone.
  const searched = new Set<string>()
  const cut: AgentCut = { depth: false, files: false }
  const listed = new Set<string>()
  let def: AgentDef | null = null
  for (const dir of await agentRoots($, cwd)) {
    const entries = await listAgentFiles($, dir, searched, cut)
    for (const e of entries) listed.add(e.path)
    pruneAgentCache(dir, listed)
    def = pickAgent(await agentTexts($, entries), type)
    if (def) break
  }
  return { def, note: cutText(type, cut) }
}

/** Where a path really lands, or undefined when it leads nowhere. */
async function realPathOf($: EngineInterface, path: string): Promise<string | undefined> {
  try {
    return (await $.fs.stat(path, { resolve: true })).realPath
  } catch {
    return undefined
  }
}

/** The write folders that really land inside the project: a symlink out of it, to it, into .git, .codex or .agents, or a folder not there yet is dropped. */
async function safeWritePaths($: EngineInterface, cwd: string, folders: string[] | undefined): Promise<string[] | undefined> {
  if (folders === undefined) return undefined
  const root = await realPathOf($, cwd)
  const kept: string[] = []
  for (const folder of folders) {
    const path = folderUnder(cwd, folder)
    const real = root && path ? await realPathOf($, path) : undefined
    if (root && real && isInside(root, real) && !isProtectedPath(root, real)) kept.push(folder)
  }
  return kept
}

// ── Git evidence ─────────────────────────────────────────────────────────

async function git($: EngineInterface, args: string[]): Promise<string> {
  try {
    const r = await $.process.run(['git', '--no-optional-locks', ...args], { timeoutMs: 10_000 })
    // Trim only the end: `git status --porcelain` lines start with a meaningful space.
    return r.exitCode === 0 ? r.stdout.replace(/\s+$/, '') : ''
  } catch {
    return ''
  }
}

/**
 * Git's own folders, absolute: outside the session folder in a linked worktree or a submodule. Without
 * --path-format (git 2.31 and later only), a relative answer is resolved against the session folder.
 */
async function gitDirs($: EngineInterface, cwd: string): Promise<string[]> {
  return (await git($, ['rev-parse', '--git-dir', '--git-common-dir'])).split('\n').map(l => l.trim()).filter(Boolean).map(path => resolveFrom(cwd, path))
}

/** Where a path really lands when it leads to a file; undefined for a folder, anything else, or nothing. */
async function fileRealPathOf($: EngineInterface, path: string): Promise<string | undefined> {
  try {
    const stat = await $.fs.stat(path, { resolve: true })
    return stat.kind === 'file' ? stat.realPath : undefined
  } catch {
    return undefined
  }
}

/**
 * Codex's install folders: where the codex on PATH really lands (Codex runs itself from there in its sandbox), and
 * $CODEX_HOME/packages. Like the shell, the lookup skips a codex that is not a file; it can't see the executable bit.
 */
async function codexInstallDirs($: EngineInterface): Promise<string[]> {
  const codexHome = (await $.env.get('CODEX_HOME')) || ''
  const dirs = codexHome ? [`${codexHome}/packages`] : []
  for (const dir of pathDirs((await $.env.get('PATH')) || '')) {
    const real = await fileRealPathOf($, `${dir}/codex`)
    if (real) return [...dirs, parentOf(real)]
  }
  return dirs
}

/** What a project-scope run may read outside the session folder: git's own folders and Codex's install folders. */
async function scopeReads($: EngineInterface, cwd: string): Promise<string[]> {
  return [...(await gitDirs($, cwd)), ...(await codexInstallDirs($))]
}

type Scope = { fsScope: FsScope; home: string; reads: string[] }

/** A run's scope, fixed when it is admitted: the option, the home folder, and under project scope what Codex may read outside it. */
async function scopeOf($: EngineInterface, cwd: string): Promise<Scope> {
  const fsScope = options.fsScope
  return { fsScope, home: await homeDir($), reads: fsScope === 'project' ? await scopeReads($, cwd) : [] }
}

async function baseCommit($: EngineInterface): Promise<string> {
  return (await git($, ['rev-parse', '--short', 'HEAD'])) || 'none'
}

/** The dirty tree with each file's content hash, for comparing before and after an editing run. */
async function porcelain($: EngineInterface): Promise<string> {
  const status = await git($, ['status', '--porcelain', '--untracked-files=all'])
  const paths = hashablePaths(status).slice(0, 500)
  const hashes: Record<string, string> = {}
  if (paths.length) {
    const out = (await git($, ['hash-object', '--', ...paths])).split('\n')
    paths.forEach((path, at) => (hashes[path] = out[at] ?? ''))
  }
  return snapshotOf(status, hashes)
}

// ── Consent ──────────────────────────────────────────────────────────────

/** '' when allowed; otherwise why not. Asks once per session. */
async function ensureConsent($: EngineInterface, cwd: string): Promise<string> {
  if (options.consent === 'allow') return ''
  const now = await read($, consent)
  if (now === 'yes') return ''
  if (now === 'no') return 'you declined sending this repo to Codex this session'
  let answer = ''
  try {
    answer = await $.ui.ask(consentText(cwd, options.sandbox), [YES, NO])
  } catch {
    return 'nobody could be asked to allow sending this repo to Codex (set duet codexConsent to allow for headless runs)'
  }
  const ok = answer === YES
  await update($, consent, () => (ok ? 'yes' : 'no'))
  return ok ? '' : 'you declined sending this repo to Codex this session'
}

// ── Running Codex ────────────────────────────────────────────────────────

type Ran = { run: Run; failure: string }

/** Runs Codex, folding its JSONL into the task as it streams; stops at the timeout. */
async function runCodex($: EngineInterface, id: string, argv: string[], input: string | undefined): Promise<Ran> {
  const launch = codexLaunch(argv, input)
  let run = EMPTY_RUN
  let carry = ''
  let timedOut = false
  let started = false
  const stream = $.process.spawn(launch)
  let elapsed = 0
  const timer = $.clock.every(5000, () => {
    elapsed += 5000
    if (elapsed >= options.timeoutMs) {
      timedOut = true
      void stream.return?.(undefined as never)?.catch?.(() => undefined)
    }
  })
  try {
    let stderr = ''
    for await (const chunk of stream) {
      started = true
      if (chunk.stream === 'stderr') {
        stderr += chunk.text
        continue
      }
      const split = splitLines(carry, chunk.text)
      carry = split.carry
      for (const line of split.lines) run = foldEvent(run, line)
      if (run.text || run.isDone) await patchTask($, id, { tokens: tokensOf(run) })
      if (timedOut) break
    }
    if (carry.trim()) run = foldEvent(run, carry)
    if (timedOut) return { run, failure: `timed out after ${Math.round(options.timeoutMs / 60_000)}m` }
    const end = await stream.result
    return { run, failure: failureOf(run, end.code, stderr) }
  } catch (err) {
    if (started) return { run, failure: `codex stopped: ${String((err as Error)?.message ?? err).split('\n')[0]}` }
    // spawn could not start: try a one-shot run (also the path tests exercise)
    const cap = Math.min(options.timeoutMs, FALLBACK_MAX_MS)
    const fallbackAt = Date.now()
    try {
      const r = await $.process.run(launch.argv, { env: launch.env, ...(launch.input !== undefined ? { stdin: launch.input } : {}), timeoutMs: cap })
      const folded = foldAll(r.stdout)
      return { run: folded, failure: failureOf(folded, r.exitCode, r.stderr) }
    } catch (err2) {
      return { run, failure: fallbackFailure(String((err2 as Error)?.message ?? err2), Date.now() - fallbackAt, cap) }
    }
  } finally {
    timer.cancel()
  }
}

// ── Routed subagent ──────────────────────────────────────────────────────

type AgentCall = { subagent_type?: string; prompt: string; description: string }

/** One admitted Codex run, everything its finish needs. */
type Job = Scope & { id: string; type: string; cwd: string; writePaths: string[] | undefined; dropped: string[]; searchNote: string; sandbox: Sandbox; baseSha: string; before: string; prompt: string; envelope: Envelope; startedAt: number; task: Task }
type Finished = { run: Run; failure: string; footer: string; endedAt: number }

/** Runs Codex for an admitted job and records the outcome: row, log line, toast. */
async function runJob($: EngineInterface, j: Job): Promise<Finished> {
  const { run, failure } = await runCodex($, j.id, codexArgv({ sandbox: j.sandbox, model: options.model, cwd: j.cwd, fsScope: j.fsScope, home: j.home, writePaths: j.writePaths, reads: j.reads, nonce: crypto.randomUUID() }), j.prompt)
  const endedAt = Date.now()
  // A read-only run can't write, so a before/after comparison would only credit Claude's own edits to Codex.
  const cand = j.sandbox === 'read-only' ? READ_ONLY_CANDIDATE : candidateOf(j.before, await porcelain($))
  const done: Task = { ...j.task, envelope: { ...j.envelope, candidate: cand }, endedAt, tokens: tokensOf(run), status: failure ? 'error' : 'done', detail: failure }
  await putTask($, done)
  await logRun($, done).catch(() => undefined)
  $.ui.toast((failure ? `${j.id} failed on codex: ${failure}` : `${j.id} done on codex · ${j.type}`).slice(0, 80))
  const footer = footerOf({ id: j.id, model: options.model, sandbox: j.sandbox, base: j.baseSha, candidate: cand, dropped: j.dropped })
  return { run, failure, endedAt, footer: j.searchNote ? `${j.searchNote}\n${footer}` : footer }
}

/** A background run: finishes the job, then hands the answer (or the failure) to the main session. */
async function finishInBackground($: EngineInterface, j: Job, outputFile: string): Promise<void> {
  let text: string
  try {
    const r = await runJob($, j)
    await $.fs.write(outputFile, r.failure ? `duet ${j.id} failed on Codex: ${r.failure}\n${j.searchNote ? `${j.searchNote}\n` : ''}` : `${r.run.text}\n\n${r.footer}\n`).catch(() => undefined)
    text = deliveryText({ id: j.id, label: j.type, model: options.model, sandbox: j.sandbox, durationMs: r.endedAt - j.startedAt, tokens: tokensOf(r.run), text: r.run.text, footer: r.footer, failure: r.failure, searchNote: j.searchNote })
  } catch (err) {
    const why = `duet failed unexpectedly (${String((err as Error)?.message ?? err).split('\n')[0]})`
    await patchTask($, j.id, { status: 'error', endedAt: Date.now(), detail: why }).catch(() => undefined)
    text = deliveryText({ id: j.id, label: j.type, model: options.model, sandbox: j.sandbox, durationMs: 0, tokens: 0, text: '', footer: '', failure: why })
  } finally {
    mine.delete(j.id)
  }
  // Never quietly: if the message can't be queued, the toast points at the answer on disk.
  await $.prompt.submit({ text }).catch(() => $.ui.toast(`${j.id} ended on codex · answer in ${outputFile}`.slice(0, 80)))
}

async function routeToCodex($: EngineInterface, e: AgentCall, role: Role | null): Promise<{ deny: string } | { result: ReturnType<typeof agentResult> | ReturnType<typeof launchedRecord> }> {
  const type = role ? ROLE_PREFIX + role.name : e.subagent_type?.trim() || DEFAULT_TYPE
  const cwd = await $.session.cwd()
  const startedAt = Date.now()
  const rowOf = (id: string): Task => ({ id, provider: 'codex', kind: 'agent', subagentType: type, model: options.model, status: 'running', startedAt, endedAt: null, tokens: 0, description: e.description, detail: '', envelope: null })

  const refuse = async (why: string) => {
    await addRefused($, id => ({ ...rowOf(id), status: 'refused', endedAt: Date.now(), detail: why }))
    return { deny: `duet: ${why}; the ${type} subagent did not run.` }
  }

  const blocked = await ensureConsent($, cwd)
  if (blocked) return refuse(blocked)
  const task = await admit($, rowOf)
  if (!task) {
    return refuse(limitText(codexRunning(await read($, tasks)), options.maxConcurrent))
  }

  const id = task.id
  mine.add(id)
  let handedOff = false
  try {
    const { def, note: searchNote } = role ? { def: roleDef(role), note: '' } : await agentDef($, cwd, type)
    const sandbox = effectiveSandbox(options.sandbox, def, type, searchNote !== '')
    const baseSha = await baseCommit($)
    const before = sandbox === 'read-only' ? '' : await porcelain($)
    const handoff = buildHandoff({ id, description: e.description, prompt: e.prompt, base: baseSha, cwd, sandbox, def, subagentType: type })
    await patchTask($, id, { envelope: handoff.envelope })
    await ensureTicker($)
    const named = writePathsOf(options.writePaths, type)
    const scope = await scopeOf($, cwd)
    const writePaths = scope.fsScope === 'project' && sandbox === 'workspace-write' ? await safeWritePaths($, cwd, named) : named
    const dropped = named && writePaths ? named.filter(folder => !writePaths.includes(folder)) : []
    const job: Job = { ...scope, id, type, cwd, writePaths, dropped, searchNote, sandbox, baseSha, before, prompt: handoff.prompt, envelope: handoff.envelope, startedAt, task: { ...task, envelope: handoff.envelope } }

    if (runsInBackground(options, sandbox, type, role)) {
      const outputFile = `${await sessionDir($)}/${id}.out.md`
      await $.fs.write(outputFile, `duet ${id} (${type}) is running on Codex; its answer arrives as a message when it ends.\n`).catch(() => undefined)
      handedOff = true
      void finishInBackground($, job, outputFile).catch(() => undefined)
      return { result: launchedRecord({ id, description: e.description, prompt: e.prompt, outputFile, model: options.model }) }
    }

    const r = await runJob($, job)
    if (r.failure) return { deny: `duet: the Codex handoff failed (${r.failure}); the ${type} subagent did not run on Claude either.${searchNote ? `\n${searchNote}` : ''}` }
    return { result: agentResult({ id, prompt: e.prompt, text: r.run.text, footer: r.footer, durationMs: r.endedAt - startedAt, run: r.run, model: options.model }) }
  } catch (err) {
    await patchTask($, id, { status: 'error', endedAt: Date.now(), detail: `duet failed unexpectedly (${String((err as Error)?.message ?? err).split('\n')[0]})` }).catch(() => undefined)
    throw err
  } finally {
    if (!handedOff) mine.delete(id)
  }
}

/** A subagent that stayed on Claude, measured from its own result. */
async function measureClaude($: EngineInterface, e: AgentCall, result: unknown, startedAt: number): Promise<void> {
  const r = result as { status?: string; totalDurationMs?: number; totalTokens?: number; resolvedModel?: string } | undefined
  if (!r || r.status !== 'completed') return
  const t: Task = {
    id: `c${startedAt}`, provider: 'claude', kind: 'agent', subagentType: e.subagent_type?.trim() || DEFAULT_TYPE, model: r.resolvedModel ?? '',
    status: 'done', startedAt, endedAt: startedAt + (r.totalDurationMs ?? 0), tokens: r.totalTokens ?? 0, description: e.description, detail: '', envelope: null,
  }
  await logRun($, t)
}

// ── Review ───────────────────────────────────────────────────────────────

async function review($: EngineInterface, target: ReviewTarget): Promise<void> {
  const id = ''
  const label = target.kind === 'uncommitted' ? '--uncommitted' : `--${target.kind} ${target.ref}`
  const task: Task = { id, provider: 'codex', kind: 'review', subagentType: label, model: options.model, status: 'running', startedAt: Date.now(), endedAt: null, tokens: 0, description: `review ${label}`, detail: '', envelope: null }
  const cwd = await $.session.cwd()
  const blocked = await ensureConsent($, cwd)
  if (blocked) {
    const row = await addRefused($, newId => ({ ...task, id: newId, status: 'refused', endedAt: Date.now(), detail: blocked }))
    $.ui.toast(`${row.id} review refused: ${blocked}`.slice(0, 80))
    return
  }
  const admitted = await admit($, newId => ({ ...task, id: newId }))
  if (!admitted) {
    const why = limitText(codexRunning(await read($, tasks)), options.maxConcurrent)
    const row = await addRefused($, newId => ({ ...task, id: newId, status: 'refused', endedAt: Date.now(), detail: why }))
    $.ui.toast(`${row.id} review refused: ${why}`.slice(0, 80))
    return
  }
  Object.assign(task, { id: admitted.id })
  let done: Task
  let text = ''
  try {
    await ensureTicker($)
    const { run, failure } = await runCodex($, task.id, reviewArgv(target, options.model, { cwd, ...(await scopeOf($, cwd)), nonce: crypto.randomUUID() }), undefined)
    done = { ...task, endedAt: Date.now(), tokens: tokensOf(run), status: failure ? 'error' : 'done', detail: failure || verdictOf(run.text) }
    text = run.text
  } catch (err) {
    // Whatever fails after admission, the row must not stay running and hold a slot.
    done = { ...task, endedAt: Date.now(), status: 'error', detail: `duet failed unexpectedly (${String((err as Error)?.message ?? err).split('\n')[0]})` }
  }
  await putTask($, done)
  void logRun($, done).catch(() => undefined)
  if (done.status === 'done') await $.fs.write(`${await sessionDir($)}/review-${task.id}.md`, text)
  $.ui.toast((done.status === 'error' ? `${task.id} review failed: ${done.detail}` : `${task.id} review: ${done.detail}`).slice(0, 80))
}

// ── Commands ─────────────────────────────────────────────────────────────

async function showStats($: EngineInterface): Promise<string> {
  const text = statsText(summarize(await readText($, `${await dataDir($)}/runs.jsonl`)))
  await update($, statsAtom, () => text)
  return text
}

async function toggleStats($: EngineInterface): Promise<void> {
  if ((await read($, view)) === 'stats') {
    await update($, view, () => 'tasks')
    return
  }
  await showStats($)
  await update($, view, () => 'stats')
}

async function startDemo($: EngineInterface): Promise<void> {
  await update($, isDemo, () => true)
  await update($, view, () => 'tasks')
  await update($, selected, () => 0)
  await ensureTicker($)
  await openPane($)
}

// How many task rows the pane last drew; selection never goes past them.
let drawnRows = Number.POSITIVE_INFINITY

async function move($: EngineInterface, by: number): Promise<void> {
  const listed = (await read($, isDemo)) ? demoTasks(0).length : (await read($, tasks)).filter(t => t.provider === 'codex').length
  await update($, selected, at => moved(at, by, Math.min(listed, drawnRows)))
}

/** Writes one option through the `/config` row's writer: '' once written, else why not. */
async function writeField($: EngineInterface, f: ConfigField, value: string | number): Promise<string> {
  const row = (await $.config.list()).find(r => r.key.endsWith(`.${f.field}`) && r.key.startsWith('duet'))
  if (!row) return `the ${f.field} row is not in /config; use /plugin to configure duet.`
  const r = await $.config.set({ key: row.key, value })
  return r.deny ?? ''
}

/** `/duet config` opens the pane; `/duet config list` prints every option; `/duet config <field> <value>` changes one. */
async function configure($: EngineInterface, words: string[]): Promise<string> {
  const [name, ...value] = words
  if (name === undefined) {
    const opened = await $.ui.open({ id: CONFIG_PANE, title: 'Duet config', columns: 76, focus: true })
    return opened.isPlaced ? 'Config pane opened: j/k move, e changes, s saves.' : `${configText(rawOptions)}\n(The window is too narrow for the config pane.)`
  }
  if (name.toLowerCase() === 'list') return configText(rawOptions)
  if (name.toLowerCase() === 'models') {
    const failed = await fetchModels($)
    return failed ? `Could not list Codex's models: ${failed}` : modelsText(await read($, modelsAtom), options.model)
  }
  const f = findConfigField(name)
  if (!f) return `no option "${name}". ${CONFIG_USAGE}`
  if (value.length === 0) return `${f.field} needs a value. ${CONFIG_USAGE}`
  const coerced = coerceConfigValue(f, value.join(' '))
  if ('error' in coerced) return coerced.error
  const deny = await writeField($, f, coerced.value)
  if (deny) return `not changed: ${deny}`
  const warning = f === MODEL_FIELD && coerced.value !== '' && !(await fetchModels($)) ? modelWarning(String(coerced.value), await read($, modelsAtom)) : ''
  return `${f.field} = ${coerced.value === '' ? '(empty)' : coerced.value}. duet reloads with it.${warning ? `\nNote: ${warning}` : ''}`
}

/**
 * Saves the pane's draft one field at a time. Each write reloads the module,
 * which may cut this short; the draft and the saving flag live in $.state, so
 * session.start of the new module calls this again and it writes what is left.
 */
async function saveDraft($: EngineInterface): Promise<void> {
  const plan = planDraft(rawOptions, await read($, draftAtom))
  if (plan.errors.length) {
    await update($, savingAtom, () => false)
    await update($, noteAtom, () => `Not saved: ${plan.errors.join(' ')}`)
    return
  }
  await update($, savingAtom, () => true)
  if (plan.writes.length) await update($, reopenAtom, () => Date.now())
  for (const w of plan.writes) {
    const deny = await writeField($, w.field, w.value)
    if (deny) {
      await update($, savingAtom, () => false)
      await update($, noteAtom, () => `${w.field} not saved: ${deny}`)
      await update($, reopenAtom, () => 0)
      return
    }
  }
  await update($, savingAtom, () => false)
  await update($, draftAtom, () => ({}))
  await update($, noteAtom, () => (plan.writes.length ? `Saved ${plan.writes.map(w => w.field.alias).join(', ')}.` : 'Nothing to save.'))
  if (!plan.writes.length) await update($, reopenAtom, () => 0)   // no write, no reload to wait for
  await restorePane($)
}

/**
 * Each write reloads the module, and a reload can drop the pane or the keys
 * it held. Reopens it if gone and puts the keys back on it, so the next
 * option can be edited without running /duet config again.
 */
async function restorePane($: EngineInterface): Promise<void> {
  const isUp = await $.ui.panes().then(ps => ps.some(p => p.id === CONFIG_PANE), () => false)
  if (!isUp) await $.ui.open({ id: CONFIG_PANE, title: 'Duet config', columns: 76, focus: true }).catch(() => undefined)
  await $.ui.focus({ requestId: CONFIG_PANE, key: 'cfg-change' }).catch(() => undefined)
}

async function editDraft($: EngineInterface, f: ConfigField, text: string): Promise<void> {
  await update($, draftAtom, d => ({ ...d, [f.field]: text }))
  await update($, noteAtom, () => '')
}

async function moveConfig($: EngineInterface, by: number): Promise<void> {
  await update($, editingAtom, () => '')
  await update($, pickingAtom, () => false)
  const at = await update($, cfgAt, at => moved(at, by, CONFIG_FIELDS.length))
  // First time on the model row: fetch the catalog so a typo is flagged and the list opens without a wait.
  if (CONFIG_FIELDS[at] === MODEL_FIELD && (await read($, modelsAtom)).length === 0 && (await read($, modelsStateAtom)) === 'idle') await fetchModels($)
}

/** Asks Codex for its model catalog (`codex debug models`, which refreshes it): '' once stored, else why not. */
async function fetchModels($: EngineInterface): Promise<string> {
  await update($, modelsStateAtom, () => 'fetching')
  let failed = ''
  try {
    const r = await $.process.run(MODELS_ARGV, { env: childEnv(), timeoutMs: 30_000 })
    const parsed = r.exitCode === 0 ? parseModelCatalog(r.stdout) : { error: (r.stderr.trim().split('\n')[0] || `codex exited ${r.exitCode}`) }
    if ('error' in parsed) failed = parsed.error
    else await update($, modelsAtom, () => parsed.models)
  } catch (err) {
    const msg = String((err as Error)?.message ?? err)
    failed = /ENOENT|not found|No such file/i.test(msg) ? 'codex not found on PATH' : msg.split('\n')[0]!
  }
  await update($, modelsStateAtom, () => (failed ? failed : 'idle'))
  return failed
}

/** A digit in the picker: that model (0: empty, Codex's default) into the draft. */
async function pickModel($: EngineInterface, slug: string): Promise<void> {
  await update($, editingAtom, () => '')
  await update($, pickingAtom, () => false)
  await editDraft($, MODEL_FIELD, slug)
  await update($, noteAtom, () => `model → ${slug || '(empty)'}, not saved yet: s saves, u reverts.`)
}

/** e (or r) on the model row: opens the list, fetching Codex's catalog when there is none yet or on r. */
async function openPicker($: EngineInterface, refresh: boolean): Promise<void> {
  await update($, editingAtom, () => '')
  await update($, pickingAtom, () => true)
  if (refresh || ((await read($, modelsAtom)).length === 0 && (await read($, modelsStateAtom)) !== 'fetching')) await fetchModels($)
}

/** t in the open list: closes it and opens the text box for a slug the list does not show. */
async function typeModel($: EngineInterface): Promise<void> {
  await update($, pickingAtom, () => false)
  await update($, editingAtom, () => MODEL_FIELD.field)
  await $.ui.focus({ requestId: CONFIG_PANE, key: 'cfg-edit' }).catch(() => undefined)
}

/** e on the highlighted row: a choice field steps to its next choice; a text field opens its edit box. */
async function changeConfig($: EngineInterface): Promise<void> {
  const f = CONFIG_FIELDS[await read($, cfgAt)] ?? CONFIG_FIELDS[0]!
  if (f.choices) {
    const current = (await read($, draftAtom))[f.field] ?? storedText(rawOptions, f)
    const next = f.choices[(f.choices.indexOf(current) + 1) % f.choices.length]!
    await editDraft($, f, next)
    return
  }
  if (f === MODEL_FIELD) return openPicker($, false)
  await update($, editingAtom, () => f.field)
  await $.ui.focus({ requestId: CONFIG_PANE, key: 'cfg-edit' }).catch(() => undefined)
}

async function finishEdit($: EngineInterface, f: ConfigField, text: string): Promise<void> {
  await editDraft($, f, text)
  await update($, editingAtom, () => '')
}

async function readReview($: EngineInterface, id: string): Promise<string> {
  return readText($, `${await sessionDir($)}/review-${id}.md`)
}

export const register: Register = (on, raw) => {
  rawOptions = raw
  options = readOptions(raw)

  on('session.start', async ($, e, next) => {
    // Rows still running that this module didn't start were cut off by a reload: say so, never quietly.
    let lost: Task[] = []
    await update($, tasks, list => {
      const r = lostOnReload(list, mine, Date.now())
      lost = r.lost
      return r.lost.length ? r.tasks : list
    })
    if (lost.length) {
      await refreshStatus($)
      for (const t of lost) {
        void logRun($, t).catch(() => undefined)
        if (t.kind === 'agent') void $.prompt.submit({ text: deliveryText({ id: t.id, label: t.subagentType, model: t.model, sandbox: t.envelope?.sandbox ?? 'read-only', durationMs: 0, tokens: 0, text: '', footer: '', failure: t.detail }) }).catch(() => undefined)
      }
    }
    for (const r of rolesFor(options.sandbox)) {
      const description = roleDescription(r, modeOf(options, ROLE_PREFIX + r.name, r))
      await $.agent.register({ name: r.name, description, prompt: r.prompt, tools: r.tools }).catch(() => undefined)
    }
    if (await read($, savingAtom)) void saveDraft($).catch(() => undefined)
    else {
      const savedAt = await read($, reopenAtom)
      if (savedAt > 0 && Date.now() - savedAt < REOPEN_WINDOW_MS) {
        // The reload a save caused: the pane comes back, once.
        await update($, reopenAtom, () => 0)
        await restorePane($).catch(() => undefined)
      }
    }
    await $.command
      .register({ name: 'duet', description: 'Delegate subagents to Codex, review diffs independently, and compare runs', argumentHint: '[demo | review [--base <branch> | --commit <sha>] | show <id> | stats | routes | config [list | models | <field> <value>]]' })
      .catch(() => undefined)
    return next(e)
  })

  on('command.run', { command: 'duet' }, async ($, e) => {
    try {
      const [word = '', ...rest] = e.args.trim().split(/\s+/)
      const sub = word.toLowerCase()
      if (sub === 'demo') {
        void startDemo($).catch(() => undefined)
        return { text: 'demo tasks (running, review, done, error, refused) are in the pane until this turn ends. Nothing runs.' }
      }
      if (sub === 'review') {
        const target = parseReviewArgs(rest.join(' '))
        if (!target) return { text: 'Usage: /duet review [--base <branch> | --commit <sha>]  (default: uncommitted changes)' }
        void review($, target).catch(() => undefined)
        return { text: 'Codex review started (read-only). Its verdict lands in the pane and a toast; /duet show <id> prints it in full.' }
      }
      if (sub === 'show') {
        const id = rest[0] ?? ''
        const text = /^d\d+$/.test(id) ? await readReview($, id) : ''
        return { text: text || `no saved review for "${id}".` }
      }
      if (sub === 'stats') return { text: await showStats($) }
      if (sub === 'routes') return { text: routesText(options) }
      if (sub === 'config') return { text: await configure($, rest) }
      if (sub !== '') return { text: 'Usage: /duet [demo | review [--base <branch> | --commit <sha>] | show <id> | stats | routes | config [list | models | <field> <value>]]' }
      const wasOpen = await isOpen($)
      void (wasOpen ? $.ui.close({ id: PANE }) : openPane($)).catch(() => undefined)
      return { text: wasOpen ? 'Closed. /duet to reopen.' : `Opened. ${routesText(options)}` }
    } catch {
      return { text: 'something went wrong; see claude --debug.' }
    }
  })

  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    // duet: roles always go to Codex (main loop only); codexAgents types unless named, isolated or nested.
    const route = routeOf(options, e)
    if (route.to === 'deny') return { deny: route.reason }
    if (route.to === 'codex') return routeToCodex($, e, route.role)
    const startedAt = Date.now()
    const ran = await next(e)
    if (!e.agentId && ran.deny === undefined && !ran.isError) {
      // A background or teammate subagent is measured when its first turn ends.
      const later = pendingIdOf(ran.result)
      const pending: ClaudePending = { startedAt, type: e.subagent_type?.trim() || DEFAULT_TYPE, description: e.description }
      if (later) void update($, claudePending, p => ({ ...p, [later]: pending })).catch(() => undefined)
      else void measureClaude($, e, ran.result, startedAt).catch(() => undefined)
    }
    return ran
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'duet: the Codex handoff failed unexpectedly; the subagent did not run. See claude --debug.' }))

  on('turn.complete', async ($, e, next) => {
    const agentId = e.agentId
    if (agentId) {
      let taken: ClaudePending | undefined
      await update($, claudePending, p => {
        taken = p[agentId]
        if (!taken) return p
        const { [agentId]: _, ...rest } = p
        return rest
      })
      if (taken) void logRun($, claudeTaskOf(taken, e, Date.now())).catch(() => undefined)
    } else if (await read($, isDemo)) {
      await update($, isDemo, () => false)
      await update($, selected, () => 0)
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const demo = await read($, isDemo)
    const now = (await read($, nowAtom)) || Date.now()
    const list = demo ? demoTasks(now) : (await read($, tasks)).filter(t => t.provider === 'codex')
    const at = await read($, selected)
    const mode = await read($, view)
    const width = Math.max(20, e.props.bodyColumns - 2)
    const layout = layoutOf(width)
    const room = rowsThatFit(e.props.scroll.bodyRows)
    drawnRows = room
    const focused = e.props.isFocused
    const head = layout === 'compact' ? 'DUET' : 'D U E T'
    const counts = list.length ? countsOf(list) : ''
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box justifyContent="space-between">
          <Text color={COLORS.accent} bold={focused}>{head}</Text>
          <Text dimColor>{counts}</Text>
        </Box>
        <Text dimColor>{'─'.repeat(width)}</Text>
        {mode === 'stats' ? (
          <Text>{(await read($, statsAtom)) || 'No runs recorded yet.'}</Text>
        ) : list.length === 0 ? (
          <Text dimColor>{EMPTY_TEXT}</Text>
        ) : (
          list.slice(0, room).map((t, i) => (
            <Box key={`t-${t.id}`} flexDirection="column">
              <Text color={STATUS_COLOR[t.status]} inverse={focused && i === at}>
                {(i === at ? '▸ ' : '  ') + rowText(t, now, width - 2)}
              </Text>
              {layout !== 'compact' && <Text dimColor>{'    ' + subText(t, width - 4)}</Text>}
              {focused && i === at && t.envelope && layout !== 'compact' &&
                envelopeLines(t.envelope).map((line, j) => <Text key={`env-${t.id}-${j}`} dimColor>{'    ' + line}</Text>)}
            </Box>
          ))
        )}
        <Text dimColor>{'─'.repeat(width)}</Text>
        {layout !== 'compact' && routesLines(options).map((line, i) => <Text key={`routes-${i}`} dimColor>{line.slice(0, width)}</Text>)}
        <Box gap={2}>
          <Button key="review" label="Review diff" hotkey="r" variant="primary" onPress={() => void review($, { kind: 'uncommitted' }).catch(() => undefined)} />
          <Button key="stats" label={mode === 'stats' ? 'Tasks' : 'Stats'} hotkey="s" plain onPress={() => void toggleStats($).catch(() => undefined)} />
          <Button key="next" label="Next" hotkey="j" plain onPress={() => void move($, 1).catch(() => undefined)} />
          <Button key="prev" label="Prev" hotkey="k" plain onPress={() => void move($, -1).catch(() => undefined)} />
          <Button key="close" label="Close" hotkey="c" plain onPress={() => void $.ui.close({ id: PANE }).catch(() => undefined)} />
        </Box>
        {layout !== 'compact' && <Text dimColor>ctrl+x tab: pane keys  ·  r review  s stats  j/k move  c close</Text>}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: CONFIG_PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    if (!('Input' in els)) {
      const { Box, Text } = els
      return (
        <Box flexDirection="column" paddingX={1}>
          <Text>{configText(rawOptions)}</Text>
          <Text dimColor>This surface draws no fields: change one with /duet config field value.</Text>
        </Box>
      )
    }
    const { Box, Text, Button, Input } = els
    const draft = await read($, draftAtom)
    const note = await read($, noteAtom)
    const saving = await read($, savingAtom)
    const at = Math.min(await read($, cfgAt), CONFIG_FIELDS.length - 1)
    const editingField = await read($, editingAtom)
    const editing = CONFIG_FIELDS.find(f => f.field === editingField)
    const width = Math.max(20, e.props.bodyColumns - 2)
    const dirty = planDraft(rawOptions, draft)
    const isDirty = dirty.writes.length > 0 || dirty.errors.length > 0
    const sel = CONFIG_FIELDS[at]!
    const onModel = sel === MODEL_FIELD
    const models = onModel ? await read($, modelsAtom) : []
    const modelsState = onModel ? await read($, modelsStateAtom) : 'idle'
    const picking = onModel && (await read($, pickingAtom))
    const modelNow = draft[MODEL_FIELD.field] ?? storedText(rawOptions, MODEL_FIELD)
    const picks = pickable(models)
    const warning = onModel ? modelWarning(modelNow, models) : ''
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box justifyContent="space-between">
          <Text color={COLORS.accent} bold={e.props.isFocused}>DUET CONFIG</Text>
          <Text dimColor>{saving ? 'saving…' : isDirty ? 'unsaved changes' : 'saved'}</Text>
        </Box>
        <Text dimColor>{'─'.repeat(width)}</Text>
        {CONFIG_FIELDS.map((f, i) => {
          const stored = storedText(rawOptions, f)
          const shown = draft[f.field] ?? stored
          const changed = draft[f.field] !== undefined && draft[f.field] !== stored
          const value = shown === '' ? '(empty)' : shown
          const choices = f.choices ? `   [${f.choices.join(' | ')}]` : ''
          const line = `${i === at ? '▸' : ' '} ${changed ? '•' : ' '} ${f.alias.padEnd(8)} ${value}${choices}`
          return <Text key={`cfg-row-${f.field}`} inverse={i === at} color={changed ? COLORS.warn : undefined}>{line.slice(0, width)}</Text>
        })}
        <Text dimColor>{'─'.repeat(width)}</Text>
        <Text dimColor>{(sel.field + ': ' + sel.help).slice(0, width)}</Text>
        {picking && !editing && (
          <Box key="cfg-models" flexDirection="column">
            {modelsState === 'fetching' && <Text dimColor>Asking Codex for its models…</Text>}
            {modelsState !== 'fetching' && modelsState !== 'idle' && <Text color={COLORS.error}>{`Could not list Codex's models: ${modelsState}`.slice(0, width)}</Text>}
            {picks.length > 0 && (
              <Button key="cfg-pick-0" hotkey="0" plain onPress={() => void pickModel($, '').catch(() => undefined)}>
                {`${modelNow === '' ? '✓' : ' '} (empty)  Codex's own configured model`.slice(0, width - 3)}
              </Button>
            )}
            {picks.map((m, i) => (
              <Button key={`cfg-pick-${m.slug}`} hotkey={String(i + 1)} plain onPress={() => void pickModel($, m.slug).catch(() => undefined)}>
                {`${m.slug === modelNow ? '✓' : ' '} ${m.slug.padEnd(26)} ${m.description || m.name}`.slice(0, width - 3)}
              </Button>
            ))}
          </Box>
        )}
        {warning !== '' && <Text color={COLORS.warn}>{warning.slice(0, width)}</Text>}
        {editing && (
          <Input key="cfg-edit" label={`${editing.alias}: `} value={draft[editing.field] ?? storedText(rawOptions, editing)} submitLabel="set" autoFocus
            placeholder={editing.kind === 'number' ? String(editing.fallback) : '(empty)'}
            onInput={(v: string) => void editDraft($, editing, v).catch(() => undefined)}
            onSubmit={(v: string) => void finishEdit($, editing, v).catch(() => undefined)} />
        )}
        {note !== '' && <Text color={note.startsWith('Saved') || note === 'Nothing to save.' ? COLORS.success : note.startsWith('model →') ? undefined : COLORS.warn}>{note}</Text>}
        <Box gap={2}>
          <Button key="cfg-change" label={sel.choices ? 'Next choice' : onModel ? 'Choose model' : 'Edit'} hotkey="e" variant="primary" onPress={() => void changeConfig($).catch(() => undefined)} />
          {picking && <Button key="cfg-type" label="Type one" hotkey="t" plain onPress={() => void typeModel($).catch(() => undefined)} />}
          {onModel && <Button key="cfg-refresh" label={models.length ? 'Refresh models' : 'List models'} hotkey="r" plain onPress={() => void openPicker($, true).catch(() => undefined)} />}
          <Button key="cfg-next" label="Down" hotkey="j" plain onPress={() => void moveConfig($, 1).catch(() => undefined)} />
          <Button key="cfg-prev" label="Up" hotkey="k" plain onPress={() => void moveConfig($, -1).catch(() => undefined)} />
          <Button key="cfg-save" label="Save" hotkey="s" plain onPress={() => void saveDraft($).catch(() => undefined)} />
          <Button key="cfg-revert" label="Revert" hotkey="u" plain onPress={() => void (async () => { await update($, draftAtom, () => ({})); await update($, editingAtom, () => ''); await update($, pickingAtom, () => false); await update($, noteAtom, () => '') })().catch(() => undefined)} />
          <Button key="cfg-close" label="Close" hotkey="c" plain onPress={() => void $.ui.close({ id: CONFIG_PANE }).catch(() => undefined)} />
        </Box>
        <Text dimColor>{editing ? 'type the value, enter: set  ·  esc: back to the keys' : picking ? '0-9: pick  ·  t: type one  ·  r: refresh  ·  j/k: move  ·  c: close' : onModel ? 'e: choose a model  ·  r: refresh  ·  j/k: move  ·  s: save  ·  c: close' : 'j/k: move  ·  e: change  ·  s: save  ·  u: revert  ·  c: close'}</Text>
      </Box>
    )
  })
}

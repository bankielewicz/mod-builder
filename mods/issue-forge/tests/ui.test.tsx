import { describe, expect, mock, test } from 'claude-code/testing'

// Behaviour tests for register.tsx: every `$` call is answered by a scripted repository below.

const ROOT = '/w'
/** This session's id; another session's runs carry OTHER (0.3.0). */
const SESSION = 'session-me'
const OTHER = 'session-other'
/** The run keys of 0.3.0: git's common folder of /w, and the issue. */
const key = (issue: number) => `issue-forge:repo-run:${ROOT}/.git#${issue}`
const LCOV_PATH = '/cov/lcov.info'
const BRANCH = 'issue-16-fix-the-thing'
const PANE = { title: 'Issue Forge', isFocused: true, bodyColumns: 76, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const
const COMPOSER = { kind: 'composer' } as const
const PRESENTATION = { isFullscreen: false, columns: 160 } as const
const PROFILE = {
  testCommand: ['t'],
  coverageCommand: ['c'],
  lcovPath: LCOV_PATH,
  sourceGlobs: ['src/**'],
  testGlobs: ['tests/**'],
  commitTrailers: ['Co-Authored-By: Tester <t@example.com>'],
}
const ISSUE = { number: 16, title: 'Fix the thing', body: 'Make it work.', state: 'OPEN', url: 'https://github.com/o/r/issues/16' }
const DIFF = 'diff --git a/src/a.ts b/src/a.ts\nnew file mode 100644\n--- /dev/null\n+++ b/src/a.ts\n@@ -0,0 +1,2 @@\n+x\n+y\n'
const LCOV = 'SF:/w/src/a.ts\nDA:1,1\nDA:2,3\nLF:2\nLH:2\nBRF:0\nBRH:0\nend_of_record\n'

/** The first store.set of a value `when` picks lands only once `until` settles; `isHeld` says it is waiting. */
type StoreHold = { when: (value: any) => boolean; until: Promise<void>; isHeld?: boolean }

type World = {
  isRepo: boolean
  isDirty: boolean
  isPlaced: boolean
  hasProfile: boolean
  head: string
  testsExit: number
  staged: string[]
  sinceRed: string[]
  redPaths: string[]
  hasChanges: boolean
  answer: string | null
  /** When set, the publish question stays open until this settles with the label chosen. */
  hold: Promise<string> | null
  /** The issue body gh returns. */
  issueBody: string
  /** When set, $.agent.spawn stays pending until this settles. */
  spawnHold: Promise<void> | null
  /** What refs/heads/<branch> points at; absent, the stub's HEAD. */
  tip?: string
  /** When set, the test command stays running until this settles. */
  testHold: Promise<void> | null
  /** Successive answers to `rev-parse --abbrev-ref HEAD` (the last repeats); absent, `head`. */
  heads?: string[]
  /** When set, git push stays running until this settles. */
  pushHold?: Promise<void>
  fetchFails?: boolean
  /** When set, the next `git status --porcelain -z` (a gate's last look before it commits) waits for it (once). */
  statusHold?: Promise<void>
  /** Runs when `gh issue view` is called: another session acting while resume checks the run (PR #51 review). */
  beforeIssueView?: () => void
  /** `git fetch` fails this many times on a ref lock another process holds, then succeeds (0.3.0). */
  fetchLocks?: number
  /** `merge-base --is-ancestor HEAD origin/<base>`: true when the branch has no commits of its own. */
  isAncestor?: boolean
  /** `git status --porcelain -z` after staging. */
  porcelainZ?: string
  /** The profile in the checkout the session started in; absent, PROFILE. */
  localProfile?: Record<string, unknown>
  /** The profile on origin/<base>, read after the switch; absent, the same profile. */
  baseProfile?: Record<string, unknown>
  switched?: boolean
  /** Linked worktrees that exist (`git worktree add` adds one); HEAD there is `wtHead`. */
  worktrees: string[]
  wtHead: string
  /** Each worktree's own copy of the profile: taken at worktree add, renewed by a fast-forward there. */
  wtProfiles: Record<string, Record<string, unknown>>
  /** `git check-ignore -q <worktreeDir>/`: false when the folder isn't ignored. */
  worktreeIgnored?: boolean
  /** `git merge-tree` at ready; absent, a clean merge. */
  mergeTree?: { exitCode: number; stdout: string; stderr?: string }
  /** When set, the next `git merge-base HEAD …` waits for it (once). */
  mergeBaseHold?: Promise<void>
  /** `git worktree add` fails (git still leaves the new branch behind). */
  worktreeAddFails?: boolean
  /** When set, the next `git worktree add` waits for it (once). */
  worktreeAddHold?: Promise<void>
  /** Worktrees git still has registered though their folder is gone: add refuses one until `git worktree remove` clears it. */
  staleWorktrees?: string[]
  /** Paths `fs.exists` can't see though they are there (an unmounted drive, a denied path). */
  fsBlind?: string[]
  /** `git worktree list` fails. */
  worktreeListFails?: boolean
  /** `git worktree list` throws, as a timed-out process.run does. */
  worktreeListThrows?: boolean
  /** When set, a store stub that can hold one write stands in for mock.store. */
  storeHold?: StoreHold
  /** When set, the next `git merge-tree` waits for it (once). */
  mergeHold?: Promise<void>
  /** `git merge-tree` throws, as a timed-out process.run does. */
  mergeThrows?: boolean
  /** Where the coverage command last ran: a real reporter names files under that folder. */
  lcovRoot?: string
  /** What $.command.register was given. */
  registered: { name: string; argumentHint?: string }[]
  /** Every process.run with the folder it ran in. */
  calls: { argv: string[]; cwd?: string; timeoutMs?: number }[]
  /** The command each Bash call reached beneath the mod with. */
  bash: string[]
  argv: string[][]
  commits: string[]
  spawned: { subagentType: string; name?: string; model?: string; prompt: string; cwd?: string }[]
  asked: string[]
  toasts: string[]
  opened: string[]
  files: Record<string, string>
  beneath: string[]
  clock: any
}

const ok = (stdout = '') => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
const fail = (stderr: string, code = 1) => ({ value: { exitCode: code, stdout: '', stderr, isStdoutTruncated: false, isStderrTruncated: false } })

/** A repository, gh and the profile's commands, scripted; every `$` call the mod makes has an answer. */
function engine(on: any, w: Partial<World> = {}, store: Record<string, unknown> = {}): World {
  const world: World = {
    isRepo: true,
    isDirty: false,
    isPlaced: true,
    hasProfile: true,
    head: 'main',
    testsExit: 0,
    staged: [],
    sinceRed: [],
    redPaths: [],
    hasChanges: true,
    answer: 'Not now',
    hold: null,
    issueBody: ISSUE.body,
    spawnHold: null,
    testHold: null,
    worktrees: [],
    wtHead: BRANCH,
    wtProfiles: {},
    registered: [],
    calls: [],
    bash: [],
    argv: [],
    commits: [],
    spawned: [],
    asked: [],
    toasts: [],
    opened: [],
    files: {},
    beneath: [],
    clock: null,
    ...w,
  }
  world.clock = mock.clock(on, { now: 1_000_000 })
  const hold = world.storeHold
  if (hold) {
    on('store.get', ($: any, e: any) => ({ value: store[e.key] }))
    on('store.set', ($: any, e: any) => {
      const land = () => ((store[e.key] = e.value), { value: undefined })
      if (hold.isHeld || !hold.when(e.value)) return land()
      hold.isHeld = true
      return hold.until.then(land)
    })
    on('store.keys', () => ({ value: Object.keys(store) }))
    on('store.delete', ($: any, e: any) => (delete store[e.key], { value: undefined }))
  } else mock.store(on, store)
  on('session.id', () => ({ value: SESSION }))
  mock.env(on, { HOME: '/home/u' })
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('session.end', ($: any, e: any) => ({ sessionId: e.sessionId }))
  on('command.register', ($: any, e: any) => (world.registered.push(e), { value: undefined }))
  on('agent.register', ($: any, e: any) => ({ value: { agent: `issue-forge:${e.name}` } }))
  on('ui.open', ($: any, e: any) => (world.opened.push(e.id), { value: { isPlaced: world.isPlaced } }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', ($: any, e: any) => (world.toasts.push(e.text ?? String(e)), { value: undefined }))
  on('turn.complete', ($: any, e: any) => ({ text: e.answer }))
  on('prompt.submit', ($: any, e: any) => ({ text: e.text }))
  on('tool.call', { tool: 'Bash' }, ($: any, e: any) => (world.beneath.push(e.agentId ?? 'main'), world.bash.push(e.command), { result: 'ran' }))
  on('tool.call', { tool: 'AskUserQuestion' }, ($: any, e: any) => {
    const q = e.questions[0].question
    world.asked.push(q)
    if (world.hold) return world.hold.then(label => ({ result: { questions: e.questions, answers: { [q]: label } } }))
    if (world.answer === null) return { deny: 'nobody to ask' }
    return { result: { questions: e.questions, answers: { [q]: world.answer } } }
  })
  on('agent.spawn', ($: any, e: any) => {
    world.spawned.push({ subagentType: e.subagentType ?? e.subagent_type, name: e.name, model: e.model, prompt: e.prompt, cwd: e.cwd })
    const answer = { model: e.model ?? 'claude', agentId: `a${world.spawned.length}` }
    return world.spawnHold ? world.spawnHold.then(() => answer) : answer
  })
  const profilePath = `${ROOT}/.issue-forge.json`
  const worktreeOf = (path: string) => world.worktrees.find(wt => path === `${wt}/.issue-forge.json`)
  const isWorktreeProfile = (path: string) => worktreeOf(path) !== undefined
  on('fs.exists', ($: any, e: any) => ({
    value: !world.fsBlind?.includes(e.path) && (((e.path === profilePath || isWorktreeProfile(e.path)) && world.hasProfile) || e.path in world.files || world.worktrees.includes(e.path)),
  }))
  on('fs.read', ($: any, e: any) => {
    if (e.path === profilePath && world.hasProfile) return { value: JSON.stringify(world.switched && world.baseProfile ? world.baseProfile : (world.localProfile ?? PROFILE)) }
    if (isWorktreeProfile(e.path) && world.hasProfile) return { value: JSON.stringify(world.wtProfiles[worktreeOf(e.path) ?? ''] ?? world.baseProfile ?? PROFILE) }
    if (e.path === LCOV_PATH) return { value: LCOV.replace(`SF:${ROOT}/`, `SF:${world.lcovRoot ?? ROOT}/`) }
    return { deny: 'ENOENT' }
  })
  on('fs.stat', ($: any, e: any) => (e.path === LCOV_PATH ? { value: { kind: 'file', size: LCOV.length, mtimeMs: world.clock.now(), isLink: false } } : { deny: 'ENOENT' }))
  on('fs.write', ($: any, e: any) => ((world.files[e.path] = e.text), { value: undefined }))
  on('process.run', ($: any, e: any) => {
    const argv = e.argv as string[]
    world.argv.push(argv)
    world.calls.push({ argv, cwd: e.init?.cwd, timeoutMs: e.init?.timeoutMs })
    const inWorktree = world.worktrees.includes(e.init?.cwd)
    const [cmd, ...a] = argv
    const s = a.join(' ')
    const testResult = () => (world.testsExit === 0 ? ok('all pass') : fail('1 failing: expected 2, got undefined', world.testsExit))
    if (cmd === 't' || cmd === './t.sh') return world.testHold ? world.testHold.then(testResult) : testResult()
    if (cmd === 'c') world.lcovRoot = e.init?.cwd ?? ROOT
    if (cmd === 'c' || cmd === 't2') return ok('ran')
    if (cmd === 'sh') return ok('/usr/bin/x')
    if (cmd === 'gh') {
      if (s === 'auth status') return ok()
      if (a[0] === 'issue') {
        world.beforeIssueView?.()
        return ok(JSON.stringify({ ...ISSUE, body: world.issueBody }))
      }
      if (a[0] === 'pr') return ok('https://github.com/o/r/pull/20\n')
    }
    if (cmd !== 'git') return fail(`unknown ${cmd}`)
    // git's common folder: the main checkout answers relative, as git does there.
    if (s === 'rev-parse --git-common-dir') return ok('.git\n')
    if (s === 'rev-parse --show-toplevel') return world.isRepo ? ok(`${ROOT}\n`) : fail('fatal: not a git repository', 128)
    if (s === 'rev-parse --abbrev-ref HEAD' && inWorktree) return ok(`${world.wtHead}\n`)
    if (a[0] === 'show' && a[1]?.endsWith(':.issue-forge.json')) return world.hasProfile ? ok(JSON.stringify(world.baseProfile ?? PROFILE)) : fail(`fatal: path '.issue-forge.json' does not exist in '${a[1]}'`, 128)
    if (a[0] === 'worktree' && a[1] === 'add') {
      // As git 2.53 does: the progress line, then the reason, both on stderr.
      if (world.worktreeAddFails) return fail(`Preparing worktree (new branch '${a[4]}')\nfatal: could not create work tree dir '${a[5]}': Permission denied`, 128)
      const path = a.includes('-b') ? a[5] ?? '' : a[2] ?? ''
      if (world.staleWorktrees?.includes(path)) return fail(`Preparing worktree (checking out '${a[3]}')\nfatal: '${path}' is a missing but already registered worktree;\nuse 'add -f' to override, or 'prune' or 'remove' to clear`, 128)
      const add = () => (world.worktrees.push(path), (world.wtProfiles[path] = world.baseProfile ?? PROFILE), ok())
      const hold = world.worktreeAddHold
      world.worktreeAddHold = undefined
      return hold ? hold.then(add) : add()
    }
    if (s === 'worktree list --porcelain') {
      if (world.worktreeListThrows) return { deny: 'process timed out after 60000 ms' }
      if (world.worktreeListFails) return fail('fatal: unable to read the worktree list', 128)
      // As git 2.53 prints it: the main checkout first; a registered folder that is gone is `prunable`.
      const entry = (path: string) => `worktree ${path}\nHEAD c0\nbranch refs/heads/x\n${world.staleWorktrees?.includes(path) ? 'prunable gitdir file points to non-existent location\n' : ''}`
      return ok([ROOT, ...world.worktrees, ...(world.staleWorktrees ?? [])].map(entry).join('\n'))
    }
    if (a[0] === 'worktree' && a[1] === 'remove') {
      const path = a[a.length - 1] ?? ''
      if (!world.staleWorktrees?.includes(path)) return fail(`fatal: '${path}' is not a working tree`, 128)
      return (world.staleWorktrees = world.staleWorktrees.filter(p => p !== path)), ok()
    }
    if (a[0] === 'merge' && a.includes('--ff-only') && inWorktree) return (world.wtProfiles[e.init?.cwd] = world.baseProfile ?? PROFILE), ok()
    // As git does: a path starting with '-' and not after '--' is read as options.
    if (a[0] === 'check-ignore' && (a[a.length - 1] ?? '').startsWith('-') && a[a.length - 2] !== '--') return fail("error: unknown switch `s'", 129)
    if (a[0] === 'check-ignore' && world.worktreeIgnored === false) return fail('', 1)
    if (a[0] === 'merge-tree') {
      if (world.mergeThrows) return { deny: 'process timed out after 60000 ms' }
      const result = world.mergeTree ? { value: { stderr: '', isStdoutTruncated: false, isStderrTruncated: false, ...world.mergeTree } } : ok('tree0\0')
      const hold = world.mergeHold
      world.mergeHold = undefined
      return hold ? hold.then(() => result) : result
    }
    if (s === 'rev-parse --abbrev-ref HEAD') return ok(`${world.heads && world.heads.length > 0 ? (world.heads.length > 1 ? world.heads.shift() : world.heads[0]) : world.head}\n`)
    if (s === 'rev-parse HEAD') return ok(`c${world.commits.length}\n`)
    if (a[0] === 'rev-parse' && a[1] === '--verify') return ok(`${world.tip ?? `c${world.commits.length}`}\n`)
    if (s === 'status --porcelain') return ok(world.isDirty ? ' M src/a.ts\n' : '')
    if (a[0] === 'switch') return (world.head = a[3] ?? ''), (world.switched = true), ok()
    if (a[0] === 'fetch' && (world.fetchLocks ?? 0) > 0) return (world.fetchLocks = (world.fetchLocks ?? 0) - 1), fail("error: cannot lock ref 'refs/remotes/origin/main': is at 1a but expected 2b", 1)
    if (a[0] === 'fetch') return world.fetchFails ? fail('fatal: unable to access origin', 128) : ok()
    if (a[0] === 'merge-base' && a[1] === '--is-ancestor') return world.isAncestor === false ? fail('', 1) : ok()
    if (a[0] === 'status' && a.includes('-z')) {
      const hold = world.statusHold
      world.statusHold = undefined
      return hold ? hold.then(() => ok(world.porcelainZ ?? '')) : ok(world.porcelainZ ?? '')
    }
    if (a[0] === 'push') return world.pushHold ? world.pushHold.then(() => ok()) : ok()
    if (a[0] === 'merge-base') {
      const hold = world.mergeBaseHold
      world.mergeBaseHold = undefined
      return hold ? hold.then(() => ok('base0\n')) : ok('base0\n')
    }
    if (a[0] === 'rev-list') return ok(`${world.commits.length}\n`)
    if (s === 'diff --cached --quiet') return world.hasChanges ? fail('', 1) : ok()
    if (s === 'diff --cached --name-only -z base0') return ok(world.staged.join('\0'))
    if (a[0] === 'diff' && a[1] === '--cached' && a[2] === '--name-only') return ok(world.sinceRed.join('\0'))
    if (a[0] === 'diff' && a[1] === '--name-only') return ok(world.redPaths.join('\0'))
    if (a[0] === 'diff' && a.includes('-U0')) return ok(DIFF)
    if (a[0] === 'commit') return world.commits.push(e.init?.stdin ?? ''), ok()
    return ok()
  })
  return world
}

async function start($: any, isInteractive = true) {
  await $.session.start({ surface: 'terminal', isInteractive, cwd: ROOT })
}

const run = ($: any, args: string) => $.command.run({ command: 'issue-forge', args, origin: COMPOSER, presentation: PRESENTATION })

async function until(w: World, cond: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 400 && !cond(); i++) await w.clock.advance(5)
  if (!cond()) throw new Error(`timed out waiting for ${label}`)
}

const turn = (agentId: string, answer: string) => ({ answer, durationMs: 1000, isAborted: false, turnId: `t-${agentId}`, agentId, reason: 'answer' })

async function pane($: any, surface = 'terminal', bodyColumns = 76) {
  return $.ui.mount({ plugin: 'issue-forge', surface, component: 'Pane', requestId: 'issue-forge', props: { ...PANE, bodyColumns }, viewport: { columns: bodyColumns + 4, rows: 40 } })
}

/** A run stored by an earlier module (a reload): working at green, with red's and green's agents. */
function storedRun(step: string, extra: Record<string, unknown> = {}) {
  return {
    id: '16-1',
    root: ROOT,
    issue: 16,
    title: ISSUE.title,
    body: ISSUE.body,
    url: ISSUE.url,
    branch: BRANCH,
    base: 'main',
    mergeBase: 'base0',
    profile: { ...PROFILE, baseBranch: 'main', excludeGlobs: [], unmeasuredGlobs: [], behaviourTestGlobs: [], checks: [], threshold: 95, regressionTolerance: 0, attempts: { red: 2, green: 3, refactor: 1 }, commandTimeoutMinutes: 15, notes: '' },
    step,
    used: { red: 1, green: 1, refactor: 0 },
    redCommit: 'c1',
    baseline: { lines: 100, branches: null },
    gates: {},
    times: { red: { startedAt: 0, endedAt: 1 }, green: { startedAt: 1 } },
    startedAt: 0,
    agents: [
      { id: 'old-red', name: 'issue-forge-16-red-1', phase: 'red' },
      { id: 'old-green', name: 'issue-forge-16-green-1', phase: 'green' },
    ],
    ...extra,
  }
}

describe('demo and drawing', () => {
  test('every demo state shows its copy on terminal and desktop', async ($, on) => {
    const w = engine(on)
    await start($)
    const { text } = await run($, 'demo')
    expect(text).toContain('[ Next state ] steps through empty, running, gate, failed, blocked, interrupted, elsewhere, ready, done')
    const copy: [string, RegExp][] = [
      ['empty', /No run here\. \/issue-forge <issue number> starts one/],
      ['running', /attempt 1\/3 · agent working/],
      ['gate', /gate G · running tests/],
      ['failed', /gate G: diff branch 91\.30% < 95/],
      ['blocked', /blocked at baseline: tests fail before any change/],
      ['interrupted', /interrupted during green; \/issue-forge resume restarts it/],
      ['elsewhere', /◌ runs in another session \(for 2m05s\)/],
      ['ready', /Push issue-16-mod-lab-fix-prompt-and-path-header-hardc/],
      ['done', /pull request opened/],
    ]
    for (const [state, re] of copy) {
      await run($, `demo ${state}`)
      await w.clock.settle()
      for (const surface of ['terminal', 'desktop'] as const) {
        const ui = await pane($, surface)
        expect(await ui.find({ type: 'Text', text: re })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: /I S S U E   F O R G E/ })).toBeDefined()
        await ui.unmount()
      }
    }
    expect(w.opened.every(id => id === 'issue-forge')).toBe(true)
  })

  test('Next state steps and wraps; End demo returns to the real (empty) view', async ($, on) => {
    const w = engine(on)
    await start($)
    await run($, 'demo done')
    await w.clock.settle()
    let ui = await pane($)
    await ui.press({ key: 'next' })
    await ui.unmount()
    ui = await pane($)
    expect(await ui.find({ type: 'Text', text: /demo · empty \(1\/9\)/ })).toBeDefined()
    await ui.press({ key: 'next' })
    await ui.unmount()
    ui = await pane($)
    expect(await ui.find({ type: 'Text', text: /agent working/ })).toBeDefined()
    await ui.press({ key: 'end' })
    await ui.unmount()
    ui = await pane($)
    expect(await ui.find({ type: 'Text', text: /No run here\./ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /demo ·/ })).toBeUndefined()
  })

  test('widths: medium drops the branch line and shortens coverage; compact is one line per phase', async ($, on) => {
    const w = engine(on)
    await start($)
    await run($, 'demo done')
    await w.clock.settle()
    let ui = await pane($, 'terminal', 50)
    expect(await ui.find({ type: 'Text', text: /cov 100\.00 \/ 100\.00/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^branch / })).toBeUndefined()
    await ui.unmount()
    ui = await pane($, 'terminal', 30)
    expect(await ui.find({ type: 'Text', text: /^ISSUE FORGE$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^✓ red$/ })).toBeDefined()
    await ui.unmount()
    ui = await pane($, 'mobile', 76)
    expect(await ui.find({ type: 'Text', text: /^✓ green$/ })).toBeDefined()
  })

  test('a window too narrow for the pane says so in a toast', async ($, on) => {
    const w = engine(on, { isPlaced: false })
    await start($)
    await run($, 'demo')
    await w.clock.settle()
    expect(w.toasts).toContain('Issue Forge needs a wider window. Widen it to see the pane, or watch the status line.')
  })
})

describe('starting a run', () => {
  test('outside a git repository nothing starts', async ($, on) => {
    const w = engine(on, { isRepo: false })
    await start($)
    const { text } = await run($, '16')
    expect(text).toContain('not in a git repository')
    expect(w.argv.some(a => a[0] === 'gh')).toBe(false)
  })

  test('a dirty tree blocks at preflight (workspace here), creates no branch, and a second start answers with the active run', async ($, on) => {
    const w = engine(on, { isDirty: true, baseProfile: { ...PROFILE, workspace: 'here' } })
    await start($)
    expect((await run($, '#16')).text).toContain('starting #16')
    await until(w, () => w.toasts.some(t => t.includes('blocked')), 'the block')
    expect(w.toasts).toContain('#16 blocked: the checkout is busy (1 changed file)')
    expect(w.argv.some(a => a[0] === 'git' && (a[1] === 'switch' || a[1] === 'worktree'))).toBe(false)
    const ui = await pane($)
    expect(await ui.find({ type: 'Text', text: /✕ blocked at preflight: the checkout is busy \(1 changed file\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /next: set "workspace" to "worktree" or "ask"/ })).toBeDefined()
    await ui.unmount()
    // 0.3.0: another run no longer refuses a start; the session is asked what to do (Cancel here).
    w.answer = 'Cancel'
    const again = (await run($, '17')).text ?? ''
    expect(w.asked.at(-1)).toBe('#16 is active in this repository: blocked at preflight. What should this session do?')
    expect(again).toBe('cancelled; nothing started.')
    expect(w.argv.some(a => a.includes('17'))).toBe(false)
    expect((await run($, 'stop')).text).toContain('stopped #16')
    expect((await run($, 'status')).text).toContain('stopped; the branch and its commits are kept')
  })

  test('status with no run reports the profile: missing, then valid', async ($, on) => {
    const w = engine(on, { hasProfile: false })
    await start($)
    expect((await run($, 'status')).text).toBe('No run in this repository, and no .issue-forge.json in its root.')
    w.hasProfile = true
    expect((await run($, 'status')).text).toContain('.issue-forge.json validates: base main, threshold 95%, 0 checks.')
  })
})

// Under `claude plugin test` (2.1.296) a spawn never gets an agent id: the kit keeps only `{ model }` from an
// `agent.spawn` answer, so a run blocks right after each spawn with "didn't start". Each stage below is
// therefore driven from a run stored at the step after its spawn; C7 runs the spawns live.
describe('a run, stage by stage', () => {
  test('start: preflight cuts the branch, the baseline is recorded, and red is spawned named, on its model', async ($, on) => {
    const w = engine(on)
    await start($)
    expect((await run($, '16')).text).toBe('starting #16; the pane shows progress. Nothing is pushed until you say yes.')
    await until(w, () => w.spawned.length === 1, 'red')
    expect(w.argv).toContainEqual(['git', 'switch', '--no-track', '-c', BRANCH, 'origin/main'])
    expect(w.spawned[0]).toMatchObject({ subagentType: 'issue-forge:red', name: 'issue-forge-16-red-1', model: 'opus', cwd: ROOT })
    expect(w.spawned[0]!.prompt).toContain('Make it work.')
    await until(w, () => w.toasts.some(t => t.includes('blocked')), 'the kit block')
    expect((await run($, 'status')).text).toContain('baseline: total lines 100.00% · branches n/a')
  })

  test("gate R: red's failing tests are committed with the trailer, then green is spawned with their paths", async ($, on) => {
    const w = engine(on, { head: BRANCH, testsExit: 1, staged: ['tests/a.test.ts'], redPaths: ['tests/a.test.ts'] }, { [`issue-forge:run:${ROOT}`]: storedRun('gateR', { redCommit: undefined, used: { red: 1, green: 0, refactor: 0 }, agents: [] }) })
    await start($)
    expect((await run($, 'resume')).text).toBe('resuming #16 at gateR.')
    await until(w, () => w.spawned.length === 1, 'green')
    expect(w.commits[0]).toBe('test(#16): red: Fix the thing\n\nCo-Authored-By: Tester <t@example.com>\n')
    expect(w.spawned[0]).toMatchObject({ subagentType: 'issue-forge:green', name: 'issue-forge-16-green-1', model: 'sonnet' })
    expect(w.spawned[0]!.prompt).toContain('tests/a.test.ts')
  })

  test('gate R refuses a red phase that touched source: no commit, red again', async ($, on) => {
    const w = engine(on, { head: BRANCH, testsExit: 1, staged: ['tests/a.test.ts', 'src/a.ts'] }, { [`issue-forge:run:${ROOT}`]: storedRun('gateR', { redCommit: undefined, used: { red: 1, green: 0, refactor: 0 }, agents: [{ id: 'old-red', name: 'issue-forge-16-red-1', phase: 'red' }] }) })
    await start($)
    await run($, 'resume')
    await until(w, () => w.spawned.length === 1, 'red again')
    expect(w.commits.length).toBe(0)
    expect(w.spawned[0]).toMatchObject({ subagentType: 'issue-forge:red', name: 'issue-forge-16-red-2' })
    expect(w.spawned[0]!.prompt).toContain('R1: not test files: src/a.ts')
  })

  test("gate G: green's covered change is committed, then refactor is spawned", async ($, on) => {
    const w = engine(on, { head: BRANCH, staged: ['tests/a.test.ts', 'src/a.ts'], sinceRed: ['src/a.ts'], redPaths: ['tests/a.test.ts'] }, { [`issue-forge:run:${ROOT}`]: storedRun('gateG') })
    await start($)
    expect((await run($, 'resume')).text).toBe('resuming #16 at gateG.')
    await until(w, () => w.spawned.length === 1, 'refactor')
    expect(w.commits[0]).toStartWith('fix(#16): green: Fix the thing')
    // The coverage diff fixes its prefixes: diff.mnemonicPrefix or diff.noprefix would otherwise hide every changed line.
    const diff = w.argv.find(a => a[0] === 'git' && a[1] === 'diff' && a.includes('-U0'))!
    for (const flag of ['--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/']) expect(diff).toContain(flag)
    expect(w.spawned[0]).toMatchObject({ subagentType: 'issue-forge:refactor', name: 'issue-forge-16-refactor-1', model: 'opus' })
  })

  test('gate G refuses edited tests (G1) and sends green back with the failure', async ($, on) => {
    const w = engine(on, { head: BRANCH, staged: ['tests/a.test.ts', 'src/a.ts'], sinceRed: ['src/a.ts', 'tests/a.test.ts'], redPaths: ['tests/a.test.ts'] }, { [`issue-forge:run:${ROOT}`]: storedRun('gateG') })
    await start($)
    await run($, 'resume')
    await until(w, () => w.spawned.length === 1, 'green again')
    expect(w.commits.length).toBe(0)
    expect(w.spawned[0]).toMatchObject({ subagentType: 'issue-forge:green', name: 'issue-forge-16-green-2' })
    expect(w.spawned[0]!.prompt).toContain('G1: tests changed since the red commit: tests/a.test.ts')
  })

  test('gate F with nothing to commit: ready, it asks, and "Not now" pushes nothing', async ($, on) => {
    const w = engine(on, { head: BRANCH, hasChanges: false, staged: ['tests/a.test.ts', 'src/a.ts'], sinceRed: ['src/a.ts'], redPaths: ['tests/a.test.ts'] }, { [`issue-forge:run:${ROOT}`]: storedRun('gateF', { greenCommit: 'c2', used: { red: 1, green: 1, refactor: 1 } }) })
    await start($)
    await run($, 'resume')
    await until(w, () => w.asked.length === 1, 'the question')
    expect(w.asked[0]).toBe(`Push ${BRANCH} and open a pull request against main?`)
    await until(w, () => w.toasts.some(t => t.startsWith('#16 is ready')), 'ready')
    expect(w.commits.length).toBe(0)
    expect(w.argv.some(a => a[1] === 'push')).toBe(false)
    const ui = await pane($)
    expect(await ui.find({ type: 'Text', text: /Push issue-16-fix-the-thing and open a pull request against main\?/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /changed lines 100\.00% · branches n\/a/ })).toBeDefined()
  })

  test('no answer possible counts as no: the run stays ready and nothing is pushed', async ($, on) => {
    const w = engine(on, { answer: null, head: BRANCH }, { [`issue-forge:run:${ROOT}`]: storedRun('ready', { greenCommit: 'c2', gatedHead: 'c0' }) })
    await start($)
    expect((await run($, 'resume')).text).toContain('resuming #16 at ready')
    await until(w, () => w.asked.length === 1, 'the question')
    await w.clock.settle()
    expect(w.argv.some(a => a[1] === 'push' || a[1] === 'pr')).toBe(false)
    expect((await run($, 'status')).text).toContain('ready: /issue-forge publish pushes')
  })

  test('confirmPublish off: a ready run publishes without asking', { options: { confirmPublish: false } }, async ($, on) => {
    const w = engine(on, { head: BRANCH }, { [`issue-forge:run:${ROOT}`]: storedRun('ready', { greenCommit: 'c2', gatedHead: 'c0' }) })
    await start($)
    await run($, 'resume')
    await until(w, () => w.toasts.some(t => t.startsWith('PR opened')), 'the PR')
    expect(w.asked.length).toBe(0)
    expect(w.argv).toContainEqual(['git', 'push', 'origin', `c0:refs/heads/${BRANCH}`])
  })

  test('a red type other than issue-forge:red is spawned unnamed (duet may route it), with the red rules in its prompt', { options: { redAgentType: 'general-purpose' } }, async ($, on) => {
    const w = engine(on, { head: BRANCH, testsExit: 1, staged: ['tests/a.test.ts', 'src/a.ts'], redPaths: ['tests/a.test.ts'] }, { [`issue-forge:run:${ROOT}`]: storedRun('gateR', { redCommit: undefined, used: { red: 1, green: 0, refactor: 0 }, agents: [] }) })
    await start($)
    await run($, 'resume')
    await until(w, () => w.spawned.length === 1, 'red again')
    expect(w.spawned[0]!.subagentType).toBe('general-purpose')
    expect(w.spawned[0]!.name).toBeUndefined()
    expect(w.spawned[0]!.prompt).toContain('Write tests from the issue only.')
  })

  test('publish while the question is still open: one push, one PR, and the late answer changes nothing', async ($, on) => {
    let release: (label: string) => void = () => undefined
    const hold = new Promise<string>(resolve => (release = resolve))
    const w = engine(on, { head: BRANCH, hold }, { [`issue-forge:run:${ROOT}`]: storedRun('ready', { greenCommit: 'c2', gatedHead: 'c0' }) })
    await start($)
    await run($, 'resume')
    await until(w, () => w.asked.length === 1, 'the question')
    expect((await run($, 'publish')).text).toContain(`pushing ${BRANCH}`)
    await until(w, () => w.toasts.some(t => t.startsWith('PR opened')), 'the PR')
    release('Publish')
    await w.clock.settle()
    await w.clock.advance(50)
    expect(w.argv.filter(a => a[0] === 'gh' && a[1] === 'pr').length).toBe(1)
    expect(w.argv.filter(a => a[0] === 'git' && a[1] === 'push').length).toBe(1)
    expect((await run($, 'status')).text).toContain('done: https://github.com/o/r/pull/20')
  })

  test('publish refuses when the branch moved after gate F, and pushes nothing', async ($, on) => {
    const w = engine(on, { head: BRANCH }, { [`issue-forge:run:${ROOT}`]: storedRun('ready', { greenCommit: 'c2', gatedHead: 'f1' }) })
    await start($)
    await run($, 'publish')
    await until(w, () => w.toasts.some(t => t.includes('blocked')), 'the block')
    expect((await run($, 'status')).text).toContain(`blocked at publishing: ${BRANCH} moved after gate F (now c0, checked f1)`)
    expect(w.argv.some(a => a[1] === 'push' || a[1] === 'pr')).toBe(false)
  })

  test("a behaviour pass that adds no test fails gate R against the red commit, and red goes again", async ($, on) => {
    const stash = { sha: 'abc123', message: 'issue-forge #16 green before behaviour test (run 16-1, attempt 1)' }
    const w = engine(on, { head: BRANCH, testsExit: 1, staged: ['tests/a.test.ts'], sinceRed: [] }, { [`issue-forge:run:${ROOT}`]: storedRun('gateR', { behaviourFor: ['src/register.tsx'], greenStash: stash, used: { red: 1, green: 1, refactor: 0 } }) })
    await start($)
    await run($, 'resume')
    await until(w, () => w.spawned.length === 1, 'red again')
    expect(w.commits.length).toBe(0)
    expect(w.argv.some(a => a[1] === 'stash' && a[2] === 'apply')).toBe(false)
    expect(w.spawned[0]!.prompt).toContain('R2: nothing staged')
  })

  test('publish works after you switched to another branch: it checks and pushes the run\'s branch, not HEAD', async ($, on) => {
    const w = engine(on, { head: 'main' }, { [`issue-forge:run:${ROOT}`]: storedRun('ready', { greenCommit: 'c2', gatedHead: 'c0' }) })
    await start($)
    await run($, 'publish')
    await until(w, () => w.toasts.some(t => t.startsWith('PR opened')), 'the PR')
    expect(w.argv).toContainEqual(['git', 'rev-parse', '--verify', `refs/heads/${BRANCH}`])
    expect(w.argv).toContainEqual(['git', 'push', 'origin', `c0:refs/heads/${BRANCH}`])
  })

  test('a gate finds HEAD off the run\'s branch (an agent switched): it blocks before staging or committing', async ($, on) => {
    const w = engine(on, { heads: [BRANCH, 'main'], staged: ['tests/a.test.ts', 'src/a.ts'], sinceRed: ['src/a.ts'] }, { [`issue-forge:run:${ROOT}`]: storedRun('gateG') })
    await start($)
    expect((await run($, 'resume')).text).toBe('resuming #16 at gateG.')
    await until(w, () => w.toasts.some(t => t.includes('blocked')), 'the block')
    expect((await run($, 'status')).text).toContain(`blocked at gateG: HEAD is on main, not ${BRANCH}`)
    expect(w.commits.length).toBe(0)
    expect(w.argv.some(a => a[0] === 'git' && a[1] === 'add')).toBe(false)
    expect(w.argv.some(a => a[0] === 't')).toBe(false)
  })

  test('stop during a gate\'s test run: nothing after it runs, nothing is committed, the run stays stopped', async ($, on) => {
    let release: () => void = () => undefined
    const w = engine(on, { head: BRANCH, testHold: new Promise<void>(resolve => (release = resolve)), staged: ['tests/a.test.ts', 'src/a.ts'], sinceRed: ['src/a.ts'], redPaths: ['tests/a.test.ts'] }, { [`issue-forge:run:${ROOT}`]: storedRun('gateG') })
    await start($)
    await run($, 'resume')
    await until(w, () => w.argv.some(a => a[0] === 't'), 'the test run')
    expect((await run($, 'stop')).text).toContain('stopped #16')
    release()
    await w.clock.settle()
    await w.clock.advance(50)
    expect(w.argv.some(a => a[0] === 'c')).toBe(false)
    expect(w.commits.length).toBe(0)
    expect((await run($, 'status')).text).toContain('stopped; the branch and its commits are kept')
  })

  test('publish pushes the branch without -u and opens a PR whose body closes the issue', async ($, on) => {
    const w = engine(on, { head: BRANCH }, { [`issue-forge:run:${ROOT}`]: storedRun('ready', { greenCommit: 'c2', gatedHead: 'c0' }) })
    await start($)
    expect((await run($, 'publish')).text).toContain(`pushing ${BRANCH}`)
    await until(w, () => w.toasts.some(t => t.startsWith('PR opened')), 'the PR')
    expect(w.asked.length).toBe(0)
    expect(w.argv).toContainEqual(['git', 'push', 'origin', `c0:refs/heads/${BRANCH}`])
    const pr = w.argv.find(a => a[0] === 'gh' && a[1] === 'pr')!
    expect(pr.slice(0, 7)).toEqual(['gh', 'pr', 'create', '--base', 'main', '--head', BRANCH])
    expect(pr[8]).toBe('Fix the thing (#16)')
    const body = w.files[pr[pr.length - 1]!] ?? ''
    expect(pr[pr.length - 1]).toBe('/home/u/.claude/issue-forge-data/16-1/pr.md')
    expect(body).toContain('Closes #16')
    expect((await run($, 'status')).text).toContain('done: https://github.com/o/r/pull/20')
    const ui = await pane($)
    expect(await ui.find({ type: 'Text', text: /https:\/\/github\.com\/o\/r\/pull\/20/ })).toBeDefined()
  })
})

describe('review round 3 (PR #24)', () => {
  test('stop while git push is running: no pull request is opened afterwards', async ($, on) => {
    let release: () => void = () => undefined
    const w = engine(on, { head: BRANCH, pushHold: new Promise<void>(resolve => (release = resolve)) }, { [`issue-forge:run:${ROOT}`]: storedRun('ready', { greenCommit: 'c2', gatedHead: 'c0' }) })
    await start($)
    await run($, 'publish')
    await until(w, () => w.argv.some(a => a[1] === 'push'), 'the push')
    expect((await run($, 'stop')).text).toContain('stopped #16')
    release()
    await w.clock.settle()
    await w.clock.advance(50)
    expect(w.argv.some(a => a[0] === 'gh' && a[1] === 'pr')).toBe(false)
  })

  test('baseline: a failed fetch blocks; a branch with commits of its own is not fast-forwarded', async ($, on) => {
    const blocked = storedRun('blocked', { blocked: { at: 'baseline', reason: 'tests fail before any change', next: 'fix main' }, redCommit: undefined, agents: [], used: { red: 0, green: 0, refactor: 0 } })
    const w = engine(on, { head: BRANCH, fetchFails: true }, { [`issue-forge:run:${ROOT}`]: blocked })
    await start($)
    await run($, 'resume')
    await until(w, () => w.toasts.some(t => t.includes('blocked')), 'the block')
    expect((await run($, 'status')).text).toContain('blocked at baseline: git fetch origin main failed: fatal: unable to access origin')
    expect(w.argv.some(a => a[1] === 'merge' && a[2] === '--ff-only')).toBe(false)
    w.fetchFails = false
    w.isAncestor = false
    await run($, 'resume')
    await until(w, () => w.spawned.length === 1, 'red')
    expect(w.argv.some(a => a[1] === 'merge' && a[2] === '--ff-only')).toBe(false)
    expect(w.argv).toContainEqual(['git', 'merge-base', 'HEAD', 'origin/main'])
  })

  test('gate G blocks when a command rewrote files after staging, and commits nothing', async ($, on) => {
    const w = engine(on, { head: BRANCH, staged: ['tests/a.test.ts', 'src/a.ts'], sinceRed: ['src/a.ts'], redPaths: ['tests/a.test.ts'], porcelainZ: 'MM src/a.ts\0?? src/a.snap\0' }, { [`issue-forge:run:${ROOT}`]: storedRun('gateG') })
    await start($)
    await run($, 'resume')
    await until(w, () => w.toasts.some(t => t.includes('blocked')), 'the block')
    expect((await run($, 'status')).text).toContain("blocked at gateG: a command changed files after staging, so the tested bytes aren't the ones that would be committed: src/a.ts, src/a.snap")
    expect(w.commits.length).toBe(0)
  })

  test("the commands that run are the base's profile, read after the switch, not the starting checkout's", async ($, on) => {
    const w = engine(on, { baseProfile: { ...PROFILE, testCommand: ['t2'] } })
    await start($)
    await run($, '16')
    await until(w, () => w.spawned.length === 1, 'red')
    const switchAt = w.argv.findIndex(a => a[1] === 'switch')
    expect(w.argv.slice(switchAt).some(a => a[0] === 't2')).toBe(true)
    expect(w.argv.slice(switchAt).some(a => a[0] === 't')).toBe(false)
  })

  test("a lost stash after the behaviour commit blocks at gate G, and resume goes on there", async ($, on) => {
    const stash = { sha: 'abc1234def', message: 'issue-forge #16 green before behaviour test (run 16-1, attempt 1)' }
    const w = engine(on, { head: BRANCH, testsExit: 1, sinceRed: ['tests/b.ui.test.ts'], staged: ['tests/a.test.ts', 'tests/b.ui.test.ts'] }, { [`issue-forge:run:${ROOT}`]: storedRun('gateR', { behaviourFor: ['src/register.tsx'], greenStash: stash, used: { red: 1, green: 1, refactor: 0 } }) })
    await start($)
    await run($, 'resume')
    await until(w, () => w.toasts.some(t => t.includes('blocked')), 'the block')
    expect(w.commits[0]).toStartWith('test(#16): red: behaviour test for src/register.tsx')
    expect((await run($, 'status')).text).toContain('blocked at gateG: stash abc1234 "issue-forge #16 green before behaviour test (run 16-1, attempt 1)" is gone')
    w.testsExit = 0
    w.sinceRed = ['src/register.tsx']
    expect((await run($, 'resume')).text).toBe('resuming #16 at gateG.')
    await until(w, () => w.argv.some(a => a[1] === 'diff' && a.includes('-U0')), 'gate G')
  })
})

describe('reloads, resume and stop', () => {
  test("an issue's Base branch line is used only once you confirm it; no answer blocks before any checkout", async ($, on) => {
    const w = engine(on, { issueBody: 'Make it work.\nBase branch: evil', answer: 'Use main' })
    await start($)
    await run($, '16')
    await until(w, () => w.spawned.length === 1, 'red')
    expect(w.asked[0]).toBe('Issue #16 asks to branch from evil, not main, and the tests will run from that branch. Which base?')
    expect(w.argv).toContainEqual(['git', 'switch', '--no-track', '-c', BRANCH, 'origin/main'])
    expect(w.argv.some(a => a.includes('evil') || a.includes('origin/evil'))).toBe(false)
  })

  test('an unconfirmed Base branch blocks at preflight and checks nothing out', async ($, on) => {
    const w = engine(on, { issueBody: 'Base branch: evil', answer: null })
    await start($)
    await run($, '16')
    await until(w, () => w.toasts.some(t => t.includes('blocked')), 'the block')
    expect((await run($, 'status')).text).toContain('blocked at preflight: issue #16 asks for base evil, not main, and nobody confirmed it')
    expect(w.argv.some(a => a[1] === 'fetch' || a[1] === 'switch')).toBe(false)
  })

  test("a stopped run's agents stay refused after a new run starts, and agents remembered from earlier runs too", async ($, on) => {
    engine(on, {}, { [`issue-forge:run:${ROOT}`]: storedRun('stopped'), [`issue-forge:agents:${ROOT}`]: ['ghost-1'] })
    await start($)
    expect((await run($, '17')).text).toContain('starting #17')
    for (const id of ['old-red', 'old-green', 'ghost-1']) expect(((await $.tool.call({ tool: 'Bash', command: 'ls', agentId: id } as never)) as any).deny).toContain('issue-forge:')
  })

  test('a stop while a spawn is still pending keeps the run stopped', async ($, on) => {
    let release: () => void = () => undefined
    const w = engine(on, { head: BRANCH, spawnHold: new Promise<void>(resolve => (release = resolve)) }, { [`issue-forge:run:${ROOT}`]: storedRun('green') })
    await start($)
    await run($, 'resume')
    await until(w, () => w.spawned.length === 1, 'the spawn')
    expect((await run($, 'stop')).text).toContain('stopped #16')
    release()
    await w.clock.settle()
    await w.clock.advance(50)
    expect((await run($, 'status')).text).toContain('stopped; the branch and its commits are kept')
  })


  test("after a reload the run reads as interrupted, and its old agents' tool calls and hand-backs are refused", async ($, on) => {
    const w = engine(on, {}, { [`issue-forge:run:${ROOT}`]: storedRun('green') })
    await start($)
    const ui = await pane($)
    expect(await ui.find({ type: 'Text', text: /◌ interrupted during green/ })).toBeDefined()
    await ui.unmount()
    for (const id of ['old-red', 'old-green']) expect(((await $.tool.call({ tool: 'Bash', command: 'ls', agentId: id } as never)) as any).deny).toContain('issue-forge:')
    expect((await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'someone-else' } as never)) as any).toMatchObject({ result: 'ran' })
    expect((await $.tool.call({ tool: 'Bash', command: 'ls' } as never)) as any).toMatchObject({ result: 'ran' })
    expect(w.beneath).toEqual(['someone-else', 'main'])
    // A finished phase agent's report reaches the main loop as a peer prompt; the run's own are dropped.
    const handback = (from: string) => ({ text: `<agent-message from="${from}">\n[Subagent hand-back] done`, origin: { kind: 'peer' } }) as never
    expect(((await $.prompt.submit(handback('issue-forge-16-red-1'))) as any).drop).toBe('issue-forge: a phase agent finished; the pane has the result.')
    expect(((await $.prompt.submit(handback('old-green'))) as any).drop).toBeDefined()
    expect((await $.prompt.submit(handback('someone-else'))) as any).toMatchObject({ text: expect.stringContaining('someone-else') })
    expect((await $.prompt.submit({ text: '<agent-message from="issue-forge-16-red-1">typed by the person' } as never)) as any).toMatchObject({ text: expect.stringContaining('typed') })
  })

  test('resume re-checks HEAD, then restarts the step with its attempts reset; stop ends it', async ($, on) => {
    const blocked = storedRun('blocked', { blocked: { at: 'green', reason: 'gate G failed after 3 attempts: tests fail (exit 1)', next: 'fix it by hand on the branch' }, used: { red: 1, green: 3, refactor: 0 } })
    const w = engine(on, { head: 'main' }, { [`issue-forge:run:${ROOT}`]: blocked })
    await start($)
    expect((await run($, 'resume')).text).toBe(`still blocked: HEAD is on main, not ${BRANCH}.`)
    expect(w.spawned.length).toBe(0)
    w.head = BRANCH
    expect((await run($, 'resume')).text).toBe('resuming #16 at green.')
    await until(w, () => w.spawned.length === 1, 'green')
    // Attempts reset; the name counts the run's green agents, so it never repeats the earlier one's.
    expect(w.spawned[0]).toMatchObject({ subagentType: 'issue-forge:green', name: 'issue-forge-16-green-2' })
    expect((await run($, 'stop')).text).toContain('its agents are refused further tool calls')
    expect((await run($, 'status')).text).toContain('stopped; the branch and its commits are kept')
    expect(((await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'old-green' } as never)) as any).deny).toContain('issue-forge:')
  })
})

describe('workspace: where a run works (Change 0.2.0)', () => {
  const WT = `${ROOT}/scratch/issue-forge/${BRANCH}`
  const WRITES = ['add', 'commit', 'switch', 'stash', 'merge', 'reset', 'checkout']
  const writesIn = (w: World, cwd: string) => w.calls.filter(c => c.cwd === cwd && c.argv[0] === 'git' && WRITES.includes(c.argv[1] ?? ''))

  test("here: a busy checkout blocks naming why, and origin/main's profile decides, not the checkout's", async ($, on) => {
    const w = engine(on, { isDirty: true, baseProfile: { ...PROFILE, workspace: 'here' } })
    await start($)
    await run($, '16')
    await until(w, () => w.toasts.some(t => t.includes('blocked')), 'the block')
    expect(w.toasts).toContain('#16 blocked: the checkout is busy (1 changed file)')
    expect(w.argv).toContainEqual(['git', 'show', 'origin/main:.issue-forge.json'])
    expect(w.asked.length).toBe(0)
    expect(w.argv.some(a => a[1] === 'switch' || a[1] === 'worktree')).toBe(false)
    expect((await run($, 'status')).text).toContain("next: set \"workspace\" to \"worktree\" or \"ask\" in .issue-forge.json on main (the run reads origin/main's copy), or clean the checkout")
    await run($, 'stop')
    w.isDirty = false
    w.head = 'feature'
    w.toasts.length = 0
    await run($, '16')
    await until(w, () => w.toasts.some(t => t.includes('blocked')), 'the second block')
    expect(w.toasts).toContain('#16 blocked: the checkout is busy (on feature)')
    expect(w.argv.some(a => a[1] === 'switch' || a[1] === 'worktree')).toBe(false)
  })

  test('ask: a busy checkout is offered a new worktree; yes forks origin/main there and never writes to the checkout', async ($, on) => {
    const w = engine(on, { isDirty: true, head: 'issue-3-duet', answer: 'New worktree' })
    await start($)
    await run($, '16')
    await until(w, () => w.spawned.length === 1, 'red')
    expect(w.asked[0]).toBe(`${ROOT} is busy (1 changed file, on issue-3-duet). Run #16 in a new worktree under scratch/issue-forge?`)
    expect(w.argv).toContainEqual(['git', 'worktree', 'add', '--no-track', '-b', BRANCH, WT, 'origin/main'])
    expect(w.argv.some(a => a[1] === 'switch')).toBe(false)
    expect(writesIn(w, ROOT)).toEqual([])
    expect(w.calls.find(c => c.argv[0] === 't')?.cwd).toBe(WT)
    expect(w.spawned[0]).toMatchObject({ subagentType: 'issue-forge:red', cwd: WT })
    expect(w.spawned[0]!.prompt).toContain(`Repository root: ${WT}. Work only inside it`)
    expect((await run($, 'status')).text).toContain(`worktree: ${WT} (once the PR merges: git worktree remove ${WT})`)
  })

  test('ask with nobody to answer blocks before any branch or worktree is made', async ($, on) => {
    const w = engine(on, { isDirty: true, answer: null })
    await start($)
    await run($, '16')
    await until(w, () => w.toasts.some(t => t.includes('blocked')), 'the block')
    expect(w.toasts).toContain(`#16 blocked: ${ROOT} is busy (1 changed file) and no new worktree was chosen`)
    expect(w.argv.some(a => a[1] === 'switch' || a[1] === 'worktree')).toBe(false)
  })

  test('worktree: an un-ignored worktreeDir blocks first; then even a clean checkout on main gets a worktree, never a switch', async ($, on) => {
    const w = engine(on, { baseProfile: { ...PROFILE, workspace: 'worktree' }, worktreeIgnored: false })
    await start($)
    await run($, '16')
    await until(w, () => w.toasts.some(t => t.includes('blocked')), 'the block')
    expect(w.toasts).toContain("#16 blocked: scratch/issue-forge isn't gitignored")
    expect(w.argv.some(a => a[1] === 'switch' || a[1] === 'worktree')).toBe(false)
    await run($, 'stop')
    w.worktreeIgnored = true
    await run($, '17')
    await until(w, () => w.spawned.length === 1, 'red')
    expect(w.argv).toContainEqual(['git', 'worktree', 'add', '--no-track', '-b', 'issue-17-fix-the-thing', `${ROOT}/scratch/issue-forge/issue-17-fix-the-thing`, 'origin/main'])
    expect(w.argv.some(a => a[1] === 'switch')).toBe(false)
    expect(writesIn(w, ROOT)).toEqual([])
  })

  test("a worktree run's gate stages and commits in the worktree, and resume checks HEAD there", async ($, on) => {
    const w = engine(on, { head: 'issue-3-duet', worktrees: [WT], testsExit: 1, staged: ['tests/a.test.ts'], redPaths: ['tests/a.test.ts'] }, { [`issue-forge:run:${ROOT}`]: storedRun('gateR', { workRoot: WT, redCommit: undefined, used: { red: 1, green: 0, refactor: 0 }, agents: [] }) })
    await start($)
    expect((await run($, 'resume')).text).toBe('resuming #16 at gateR.')
    await until(w, () => w.spawned.length === 1, 'green')
    expect(w.commits.length).toBe(1)
    expect(writesIn(w, WT).map(c => c.argv[1])).toEqual(['add', 'commit'])
    expect(writesIn(w, ROOT)).toEqual([])
    expect(w.spawned[0]).toMatchObject({ subagentType: 'issue-forge:green', cwd: WT })
  })

  test('a run stored before 0.2.0 (no workRoot) still works in its root', async ($, on) => {
    const w = engine(on, { head: BRANCH, testsExit: 1, staged: ['tests/a.test.ts'], redPaths: ['tests/a.test.ts'] }, { [`issue-forge:run:${ROOT}`]: storedRun('gateR', { redCommit: undefined, used: { red: 1, green: 0, refactor: 0 }, agents: [] }) })
    await start($)
    await run($, 'resume')
    await until(w, () => w.spawned.length === 1, 'green')
    expect(writesIn(w, ROOT).map(c => c.argv[1])).toEqual(['add', 'commit'])
  })

  test('ready: the merge check against a fresh origin/main names conflicting files in the question and the pane', async ($, on) => {
    const w = engine(on, { head: BRANCH, mergeTree: { exitCode: 1, stdout: 'tree0\0.claude-plugin/marketplace.json\0' } }, { [`issue-forge:run:${ROOT}`]: storedRun('ready', { greenCommit: 'c2', gatedHead: 'c0' }) })
    await start($)
    await run($, 'resume')
    await until(w, () => w.asked.length === 1, 'the question')
    expect(w.asked[0]).toBe(`Push ${BRANCH} and open a pull request against main? It conflicts with origin/main in: .claude-plugin/marketplace.json.`)
    const mergeAt = w.argv.findIndex(a => a[1] === 'merge-tree')
    expect(w.argv[mergeAt]).toEqual(['git', 'merge-tree', '--write-tree', '--name-only', '--no-messages', '-z', 'c0', 'origin/main'])
    expect(w.argv.slice(0, mergeAt).some(a => a[1] === 'fetch' && a[3] === 'main')).toBe(true)
    await w.clock.settle()
    const ui = await pane($)
    expect(await ui.find({ type: 'Text', text: /conflicts with origin\/main: \.claude-plugin\/marketplace\.json/ })).toBeDefined()
    expect(w.argv.some(a => a[1] === 'push')).toBe(false)
  })

  test("the guard in a worktree run leaves the main loop's and other agents' calls as they were; retired agents stay refused", async ($, on) => {
    const w = engine(on, { worktrees: [WT] }, { [`issue-forge:run:${ROOT}`]: storedRun('green', { workRoot: WT }) })
    await start($)
    expect((await $.tool.call({ tool: 'Bash', command: 'ls' } as never)) as any).toMatchObject({ result: 'ran' })
    expect((await $.tool.call({ tool: 'Bash', command: 'git status', agentId: 'someone-else' } as never)) as any).toMatchObject({ result: 'ran' })
    expect(w.bash).toEqual(['ls', 'git status'])
    expect(((await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'old-red' } as never)) as any).deny).toContain('issue-forge:')
  })
})

describe('review of PR #41', () => {
  const WT = `${ROOT}/scratch/issue-forge/${BRANCH}`

  test('a Publish pressed while the merge check runs is kept: one push, one PR, and the run ends done (Codex P1)', async ($, on) => {
    let release = () => {}
    const w = engine(on, { head: BRANCH, mergeHold: new Promise<void>(r => (release = r)) }, { [`issue-forge:run:${ROOT}`]: storedRun('ready', { greenCommit: 'c2', gatedHead: 'c0' }) })
    await start($)
    await run($, 'resume')
    await until(w, () => w.argv.some(a => a[1] === 'merge-tree'), 'the merge check')
    expect((await run($, 'publish')).text).toContain('publishing #16')
    await until(w, () => w.toasts.some(t => t.startsWith('PR opened')), 'the PR')
    release()
    await w.clock.settle()
    expect((await run($, 'status')).text).toContain('done: https://github.com/o/r/pull/20')
    expect(w.argv.filter(a => a[1] === 'push')).toHaveLength(1)
    expect(w.asked).toEqual([])
  })

  test("a red type another plugin routes is refused in a worktree run, before any worktree is made and before a spawn (Codex P2)", { options: { redAgentType: 'general-purpose' } }, async ($, on) => {
    const w = engine(on, { baseProfile: { ...PROFILE, workspace: 'worktree' } })
    await start($)
    await run($, '16')
    await until(w, () => w.toasts.some(t => t.includes('blocked')), 'the block')
    expect((await run($, 'status')).text).toContain("blocked at preflight: redAgentType general-purpose can't work in a worktree: another plugin (duet's Codex) runs it in the session's folder")
    expect(w.argv.some(a => a[1] === 'worktree' || a[1] === 'switch')).toBe(false)
  })

  test('a stored worktree run at red with a routed red type blocks instead of spawning (Codex P2)', { options: { redAgentType: 'general-purpose' } }, async ($, on) => {
    const w = engine(on, { worktrees: [WT] }, { [`issue-forge:run:${ROOT}`]: storedRun('red', { workRoot: WT, redCommit: undefined, used: { red: 0, green: 0, refactor: 0 }, agents: [] }) })
    await start($)
    await run($, 'resume')
    await until(w, () => w.toasts.some(t => t.includes('blocked')), 'the block')
    expect(w.spawned).toHaveLength(0)
  })

  test('a block after the worktree was made records it, and resume reuses it instead of making another (Codex P2)', async ($, on) => {
    const w = engine(on, { baseProfile: { ...PROFILE, testCommand: ['./t.sh'], workspace: 'worktree' } })
    await start($)
    await run($, '16')
    await until(w, () => w.toasts.some(t => t.includes('blocked')), 'the block')
    const status = (await run($, 'status')).text ?? ''
    expect(status).toContain('blocked at preflight: origin/main has no valid .issue-forge.json: command not found: ./t.sh')
    expect(status).toContain(`worktree: ${WT}`)
    w.files[`${WT}/t.sh`] = ''
    expect((await run($, 'resume')).text).toBe('resuming #16 at preflight.')
    await until(w, () => w.spawned.length === 1, 'red')
    expect(w.argv.filter(a => a[1] === 'worktree')).toEqual([['git', 'worktree', 'add', '--no-track', '-b', BRANCH, WT, 'origin/main'], ['git', 'worktree', 'list', '--porcelain'], ['git', 'worktree', 'list', '--porcelain']])
    expect(w.argv.some(a => a.some(x => x.includes(`${BRANCH}-2`)))).toBe(false)
    expect(w.spawned[0]).toMatchObject({ cwd: WT })
  })

  test('a merge check that throws still asks, naming why it could not run', async ($, on) => {
    const w = engine(on, { head: BRANCH, mergeThrows: true }, { [`issue-forge:run:${ROOT}`]: storedRun('ready', { greenCommit: 'c2', gatedHead: 'c0' }) })
    await start($)
    await run($, 'resume')
    await until(w, () => w.asked.length === 1, 'the question')
    expect(w.asked[0]).toContain(`Push ${BRANCH} and open a pull request against main? (merge check unavailable: `)
    expect(w.asked[0]).toContain('timed out')
  })

  test("git worktree add runs like the profile's commands, not on git's 60 s", async ($, on) => {
    const w = engine(on, { baseProfile: { ...PROFILE, workspace: 'worktree' } })
    await start($)
    await run($, '16')
    await until(w, () => w.spawned.length === 1, 'red')
    // Under the kit spawn can't start, so it falls back to process.run at the host's 10-minute cap.
    expect(w.calls.find(c => c.argv[1] === 'worktree')?.timeoutMs).toBe(600_000)
  })

  test('publish checks the merge again, so the PR body says what was true when it was pushed', async ($, on) => {
    const w = engine(on, { head: BRANCH, mergeTree: { exitCode: 1, stdout: 'tree0\0x.json\0' } }, { [`issue-forge:run:${ROOT}`]: storedRun('ready', { greenCommit: 'c2', gatedHead: 'c0', merge: { isClean: true, files: [] } }) })
    await start($)
    await run($, 'publish')
    await until(w, () => w.toasts.some(t => t.startsWith('PR opened')), 'the PR')
    const body = Object.entries(w.files).find(([path]) => path.endsWith('/pr.md'))?.[1] ?? ''
    expect(body).toContain('At publish time this conflicted with origin/main in: x.json.')
  })

  test('under ask, an un-ignored worktreeDir blocks before the question is asked', async ($, on) => {
    const w = engine(on, { isDirty: true, worktreeIgnored: false, answer: 'New worktree' })
    await start($)
    await run($, '16')
    await until(w, () => w.toasts.some(t => t.includes('blocked')), 'the block')
    expect(w.toasts).toContain("#16 blocked: scratch/issue-forge isn't gitignored")
    expect(w.asked).toEqual([])
  })
})

describe('review of PR #41, round 2', () => {
  test("a worktreeDir or lcovPath starting with '-' reaches git check-ignore as a path, not as options (Codex P2)", async ($, on) => {
    const w = engine(on, { localProfile: { ...PROFILE, lcovPath: '-cov/l.lcov' }, baseProfile: { ...PROFILE, workspace: 'worktree', worktreeDir: '-scratch' } })
    await start($)
    expect((await run($, 'status')).text).toContain('.issue-forge.json validates')
    await run($, '16')
    await until(w, () => w.spawned.length === 1, 'red')
    expect(w.argv).toContainEqual(['git', 'check-ignore', '-q', '--', '-scratch/'])
    expect(w.argv).toContainEqual(['git', 'worktree', 'add', '--no-track', '-b', BRANCH, `${ROOT}/-scratch/${BRANCH}`, 'origin/main'])
  })

  test('resume after the profile is fixed on origin/main: the kept branch catches up before its profile is checked again (Codex P2)', async ($, on) => {
    const WT = `${ROOT}/scratch/issue-forge/${BRANCH}`
    const w = engine(on, { baseProfile: { ...PROFILE, testCommand: ['./t.sh'], workspace: 'worktree' } })
    await start($)
    await run($, '16')
    await until(w, () => w.toasts.some(t => t.includes('blocked')), 'the block')
    expect((await run($, 'status')).text).toContain('command not found: ./t.sh')
    // The fix lands on origin/main; the worktree still has the old copy until it catches up.
    w.baseProfile = { ...PROFILE, workspace: 'worktree' }
    w.toasts.length = 0
    expect((await run($, 'resume')).text).toBe('resuming #16 at preflight.')
    await until(w, () => w.spawned.length === 1 || w.toasts.some(t => t.includes('blocked')), 'red or a block')
    expect(w.spawned).toHaveLength(1)
    expect(w.calls.some(c => c.argv[1] === 'merge' && c.argv.includes('--ff-only') && c.cwd === WT)).toBe(true)
    expect(w.argv.filter(a => a[1] === 'worktree')).toEqual([['git', 'worktree', 'add', '--no-track', '-b', BRANCH, WT, 'origin/main'], ['git', 'worktree', 'list', '--porcelain'], ['git', 'worktree', 'list', '--porcelain']])
  })

  for (const [label, localProfile] of [
    ['a path command missing there', { ...PROFILE, testCommand: ['./t.sh'] }],
    ['a profile that no longer validates', { ...PROFILE, testCommand: 'not an argv' }],
  ] as const) {
    test(`the starting checkout's profile only names the base (${label}); a worktree run checks origin/main's copy (Codex P2)`, async ($, on) => {
      const w = engine(on, { isDirty: true, head: 'old-feature', localProfile, baseProfile: { ...PROFILE, workspace: 'worktree' } })
      await start($)
      await run($, '16')
      await until(w, () => w.spawned.length === 1 || w.toasts.some(t => t.includes('blocked')), 'red or a block')
      // Under the kit a spawn gets no agentId, so the run blocks right after it; what matters is that red was spawned.
      expect(w.spawned).toHaveLength(1)
      expect(w.spawned[0]).toMatchObject({ subagentType: 'issue-forge:red', cwd: `${ROOT}/scratch/issue-forge/${BRANCH}` })
    })
  }
})

describe('review of PR #41, round 3', () => {
  const WT = `${ROOT}/scratch/issue-forge/${BRANCH}`
  const WORKTREE = { ...PROFILE, workspace: 'worktree' }

  test('a Stop right after worktree add keeps the branch and worktree on the stopped run (Codex P2)', async ($, on) => {
    let release = () => {}
    const w = engine(on, { baseProfile: WORKTREE, mergeBaseHold: new Promise<void>(r => (release = r)) })
    await start($)
    await run($, '16')
    await until(w, () => w.argv.some(a => a[1] === 'merge-base' && a[2] === 'HEAD'), 'the merge base')
    expect((await run($, 'stop')).text).toContain(`Its branch ${BRANCH} and commits are kept`)
    release()
    await w.clock.settle()
    const status = (await run($, 'status')).text ?? ''
    expect(status).toContain(`${BRANCH} → main`)
    expect(status).toContain(`worktree: ${WT} (when you no longer need it: git worktree remove ${WT})`)
  })

  test('a failed worktree add keeps the branch git left, and resume makes the worktree for it instead of a -2 branch', async ($, on) => {
    const w = engine(on, { baseProfile: WORKTREE, worktreeAddFails: true })
    await start($)
    await run($, '16')
    await until(w, () => w.toasts.some(t => t.includes('blocked')), 'the block')
    expect((await run($, 'status')).text).toContain(`${BRANCH} → main`)
    w.worktreeAddFails = false
    expect((await run($, 'resume')).text).toBe('resuming #16 at preflight.')
    await until(w, () => w.spawned.length === 1 || w.toasts.filter(t => t.includes('blocked')).length > 1, 'red or another block')
    expect(w.spawned).toHaveLength(1)
    expect(w.argv.filter(a => a[1] === 'worktree').slice(1)).toEqual([['git', 'worktree', 'list', '--porcelain'], ['git', 'worktree', 'list', '--porcelain'], ['git', 'worktree', 'remove', WT], ['git', 'worktree', 'add', WT, BRANCH]])
    expect(w.argv.some(a => a.some(x => x.includes(`${BRANCH}-2`)))).toBe(false)
  })

  test('resume after the kept worktree was removed by hand makes it again at preflight, and says so at a later step', async ($, on) => {
    const atPreflight = storedRun('blocked', { blocked: { at: 'preflight', reason: 'r', next: 'n' }, workRoot: WT, redCommit: undefined, used: { red: 0, green: 0, refactor: 0 }, agents: [] })
    // A folder removed by hand stays registered with git until something clears it.
    const w = engine(on, { baseProfile: WORKTREE, staleWorktrees: [WT] }, { [`issue-forge:run:${ROOT}`]: atPreflight })
    await start($)
    expect((await run($, 'resume')).text).toBe('resuming #16 at preflight.')
    await until(w, () => w.spawned.length === 1 || w.toasts.some(t => t.includes('blocked')), 'red or a block')
    expect(w.spawned).toHaveLength(1)
    expect(w.argv.filter(a => a[1] === 'worktree')).toEqual([['git', 'worktree', 'list', '--porcelain'], ['git', 'worktree', 'list', '--porcelain'], ['git', 'worktree', 'remove', WT], ['git', 'worktree', 'add', WT, BRANCH]])
  })

  test('with confirmPublish off nobody is asked, so the merge is checked once, at publish', { options: { confirmPublish: false } }, async ($, on) => {
    const w = engine(on, { head: BRANCH }, { [`issue-forge:run:${ROOT}`]: storedRun('ready', { greenCommit: 'c2', gatedHead: 'c0' }) })
    await start($)
    await run($, 'resume')
    await until(w, () => w.toasts.some(t => t.startsWith('PR opened')), 'the PR')
    expect(w.argv.filter(a => a[1] === 'merge-tree')).toHaveLength(1)
  })

  test("resume of a later step whose worktree is gone names the folder instead of failing on it", async ($, on) => {
    engine(on, {}, { [`issue-forge:run:${ROOT}`]: storedRun('blocked', { blocked: { at: 'gateG', reason: 'r', next: 'n' }, workRoot: WT }) })
    await start($)
    expect((await run($, 'resume')).text).toBe(`still blocked: the run's worktree ${WT} is gone.`)
  })
})

describe('review of PR #41, round 4', () => {
  const WT = `${ROOT}/scratch/issue-forge/${BRANCH}`
  const WORKTREE = { ...PROFILE, workspace: 'worktree' }

  test("a failed worktree add is named by git's fatal: line, not the progress line before it", async ($, on) => {
    const w = engine(on, { baseProfile: WORKTREE, worktreeAddFails: true })
    await start($)
    await run($, '16')
    await until(w, () => w.toasts.some(t => t.includes('blocked')), 'the block')
    expect((await run($, 'status')).text).toContain(`blocked at preflight: git worktree add failed: fatal: could not create work tree dir '${WT}': Permission denied`)
  })

  test('a Stop while git worktree add runs keeps the branch it made on the stopped run', async ($, on) => {
    let release = () => {}
    const w = engine(on, { baseProfile: WORKTREE, worktreeAddHold: new Promise<void>(r => (release = r)) })
    await start($)
    await run($, '16')
    await until(w, () => w.argv.some(a => a[1] === 'worktree' && a[2] === 'add'), 'the worktree add')
    expect((await run($, 'stop')).text).toContain('stopped #16')
    release()
    await w.clock.settle()
    const status = (await run($, 'status')).text ?? ''
    expect(status).toContain(`${BRANCH} → main`)
    expect(status).toContain(`worktree: ${WT} (when you no longer need it: git worktree remove ${WT})`)
  })

  test('a Stop whose write lands after the new branch was recorded keeps both the stop and the branch', async ($, on) => {
    let releaseAdd = () => {}
    let releaseStop = () => {}
    const storeHold: StoreHold = { when: v => v?.step === 'stopped', until: new Promise<void>(r => (releaseStop = r)) }
    const w = engine(on, { baseProfile: WORKTREE, worktreeAddHold: new Promise<void>(r => (releaseAdd = r)), storeHold })
    await start($)
    await run($, '16')
    await until(w, () => w.argv.some(a => a[1] === 'worktree' && a[2] === 'add'), 'the worktree add')
    const stopping = run($, 'stop')
    await until(w, () => storeHold.isHeld === true, "the stop's write")
    releaseAdd()
    for (let i = 0; i < 40; i++) await w.clock.advance(5)
    releaseStop()
    expect((await stopping).text).toContain('stopped #16')
    await w.clock.settle()
    const status = (await run($, 'status')).text ?? ''
    expect(status).toContain('stopped; the branch and its commits are kept')
    expect(status).toContain(`${BRANCH} → main`)
  })

  test('a Publish pressed while the merge result is being written still publishes, once', async ($, on) => {
    let release = () => {}
    const storeHold: StoreHold = { when: v => v?.step === 'ready' && v?.merge !== undefined, until: new Promise<void>(r => (release = r)) }
    const w = engine(on, { head: BRANCH, storeHold }, { [`issue-forge:run:${ROOT}`]: storedRun('ready', { greenCommit: 'c2', gatedHead: 'c0' }) })
    await start($)
    await run($, 'resume')
    await until(w, () => storeHold.isHeld === true, 'the merge write')
    const publishing = run($, 'publish')
    for (let i = 0; i < 60; i++) await w.clock.advance(5)
    release()
    expect((await publishing).text).toContain('publishing #16')
    await until(w, () => w.toasts.some(t => t.startsWith('PR opened')), 'the PR')
    await w.clock.settle()
    expect((await run($, 'status')).text).toContain('done: https://github.com/o/r/pull/20')
    expect(w.argv.filter(a => a[1] === 'push')).toHaveLength(1)
    expect(w.asked).toEqual([])
  })
})

describe('review of PR #41, code-review pass', () => {
  const WT = `${ROOT}/scratch/issue-forge/${BRANCH}`

  test('a worktree gone at a later step is given back with a command that works: git keeps a folder deleted by hand registered, so the add needs the remove first', async ($, on) => {
    engine(on, {}, { [`issue-forge:run:${ROOT}`]: storedRun('blocked', { blocked: { at: 'gateG', reason: 'r', next: 'n' }, workRoot: WT }) })
    await start($)
    await run($, 'resume')
    expect((await run($, 'status')).text).toContain(`next: git worktree remove ${WT}; git worktree add ${WT} ${BRANCH}, then /issue-forge resume`)
  })

  test("worktree: the session's checkout is not looked at (no status, no HEAD read), since a worktree is made whatever it holds", async ($, on) => {
    const w = engine(on, { isDirty: true, head: 'issue-3-duet', baseProfile: { ...PROFILE, workspace: 'worktree' } })
    await start($)
    await run($, '16')
    await until(w, () => w.spawned.length === 1, 'red')
    expect(w.argv).toContainEqual(['git', 'worktree', 'add', '--no-track', '-b', BRANCH, WT, 'origin/main'])
    const looked = w.calls.filter(c => c.cwd === ROOT && c.argv[0] === 'git' && (c.argv[1] === 'status' || (c.argv[1] === 'rev-parse' && c.argv[2] === '--abbrev-ref')))
    expect(looked).toEqual([])
  })
})

describe('review of PR #41, round 6', () => {
  const WT = `${ROOT}/scratch/issue-forge/${BRANCH}`
  const WORKTREE = { ...PROFILE, workspace: 'worktree' }
  const atPreflight = () => ({
    [`issue-forge:run:${ROOT}`]: storedRun('blocked', { blocked: { at: 'preflight', reason: 'r', next: 'n' }, workRoot: WT, redCommit: undefined, used: { red: 0, green: 0, refactor: 0 }, agents: [] }),
  })
  const atGateG = () => ({ [`issue-forge:run:${ROOT}`]: storedRun('blocked', { blocked: { at: 'gateG', reason: 'r', next: 'n' }, workRoot: WT }) })
  const changesWorktrees = (w: { argv: string[][] }) => w.argv.filter(a => a[1] === 'worktree' && a[2] !== 'list')

  test("resume at preflight refuses a plain folder at the run's worktree path: git run there would work on the main checkout", async ($, on) => {
    const w = engine(on, { baseProfile: WORKTREE, files: { [WT]: '' } }, atPreflight())
    await start($)
    expect((await run($, 'resume')).text).toBe('resuming #16 at preflight.')
    await until(w, () => w.spawned.length === 1 || w.toasts.some(t => t.includes('blocked')), 'red or a block')
    expect(w.spawned).toHaveLength(0)
    expect((await run($, 'status')).text).toContain(`blocked at preflight: ${WT} is there but isn't the run's git worktree`)
    expect(w.calls.filter(c => c.cwd === WT)).toEqual([])
    expect(changesWorktrees(w)).toEqual([])
  })

  test('resume at preflight refuses a registered worktree whose .git is gone though its folder is there, and runs no git worktree remove on it', async ($, on) => {
    // git lists it prunable, as for a deleted folder, but the folder (and whatever is in it) is still there.
    const w = engine(on, { baseProfile: WORKTREE, files: { [WT]: '' }, staleWorktrees: [WT] }, atPreflight())
    await start($)
    expect((await run($, 'resume')).text).toBe('resuming #16 at preflight.')
    await until(w, () => w.spawned.length === 1 || w.toasts.some(t => t.includes('blocked')), 'red or a block')
    expect((await run($, 'status')).text).toContain(`blocked at preflight: ${WT} is there but isn't the run's git worktree`)
    expect(w.calls.filter(c => c.cwd === WT)).toEqual([])
    expect(changesWorktrees(w)).toEqual([])
  })

  test("resume reuses a worktree git has, even when fs.exists can't see it, instead of removing it and adding it again", async ($, on) => {
    const w = engine(on, { baseProfile: WORKTREE, worktrees: [WT], fsBlind: [WT] }, atPreflight())
    await start($)
    expect((await run($, 'resume')).text).toBe('resuming #16 at preflight.')
    await until(w, () => w.spawned.length === 1 || w.toasts.some(t => t.includes('blocked')), 'red or a block')
    expect(w.spawned).toHaveLength(1)
    expect(changesWorktrees(w)).toEqual([])
  })

  test("resume at a later step refuses a plain folder at the worktree path without running git in it", async ($, on) => {
    const w = engine(on, { files: { [WT]: '' } }, atGateG())
    await start($)
    expect((await run($, 'resume')).text).toBe(`still blocked: ${WT} is there but isn't the run's git worktree.`)
    expect(w.calls.filter(c => c.cwd === WT)).toEqual([])
  })

  test('resume says when git cannot list its worktrees, instead of guessing from the folder', async ($, on) => {
    engine(on, { worktreeListFails: true }, atGateG())
    await start($)
    expect((await run($, 'resume')).text).toBe('still blocked: git worktree list failed: fatal: unable to read the worktree list.')
  })
})

describe('parallel runs (Change 0.3.0)', () => {
  const START16 = 'Start #16 in a new worktree from origin/main (Recommended)'
  const WORKTREE = { ...PROFILE, workspace: 'worktree' }
  const WT16 = `${ROOT}/scratch/issue-forge/${BRANCH}`
  const blocked44 = (extra: Record<string, unknown> = {}) =>
    storedRun('blocked', { id: '44-1', issue: 44, title: 'duet follow-ups', branch: 'issue-44-duet', blocked: { at: 'gateG', reason: 'HEAD is on main, not issue-44-duet', next: 'git switch issue-44-duet' }, agents: [{ id: 'old-44', name: 'issue-forge-44-green-1', phase: 'green' }], ...extra })
  /** Keeps $.agent.spawn pending, so the drive stays at red (under test a spawn never gets an agent id). */
  const held = () => new Promise<void>(() => undefined)
  const elsewhere40 = (extra: Record<string, unknown> = {}) => storedRun('green', { id: '40-1', issue: 40, branch: 'issue-40-x', repo: `${ROOT}/.git`, driver: { session: OTHER, since: 1_000_000 - 125_000 }, ...extra })

  test('the reported case: #44 blocked under the old per-checkout key moves at session start, and /issue-forge 16 asks, then starts in a new worktree', async ($, on) => {
    const w = engine(on, { answer: START16, localProfile: WORKTREE, baseProfile: WORKTREE, spawnHold: held() }, { [`issue-forge:run:${ROOT}`]: blocked44(), [`issue-forge:agents:${ROOT}`]: ['ghost-1'] })
    await start($)
    expect((await run($, '16')).text).toBe('starting #16; the pane shows progress. Nothing is pushed until you say yes.')
    expect(w.asked).toEqual(['#44 is active in this repository: blocked at gateG. What should this session do?'])
    await until(w, () => w.spawned.length === 1, "#16's red agent")
    expect(w.argv).toContainEqual(['git', 'worktree', 'add', '--no-track', '-b', BRANCH, WT16, 'origin/main'])
    expect((await run($, 'status 44')).text).toContain('blocked at gateG: HEAD is on main, not issue-44-duet')
    expect((await run($, 'status')).text).toContain('also: #16 red 1/2')
    // The moved run's agents, and the old checkout's remembered ones, stay refused.
    for (const id of ['old-44', 'ghost-1']) expect(((await $.tool.call({ tool: 'Bash', command: 'ls', agentId: id } as never)) as any).deny).toContain('issue-forge:')
  })

  test("under ask, Start is the answer to the worktree question; under here, a checkout #44's run works in is busy", async ($, on) => {
    const w = engine(on, { answer: START16, localProfile: { ...PROFILE, workspace: 'ask' } }, { [key(44)]: blocked44({ repo: `${ROOT}/.git` }) })
    await start($)
    await run($, '16')
    await until(w, () => w.spawned.length === 1, "#16's red agent")
    expect(w.asked).toHaveLength(1)
    expect(w.argv.some(a => a[1] === 'worktree' && a[2] === 'add')).toBe(true)
    expect(w.argv.some(a => a[1] === 'switch')).toBe(false)
  })

  test("under here, a clean checkout on main that #44's run works in blocks the new run", async ($, on) => {
    const HERE = { ...PROFILE, workspace: 'here' }
    const w = engine(on, { answer: 'Start #16 here (Recommended)', localProfile: HERE, baseProfile: HERE }, { [key(44)]: blocked44({ repo: `${ROOT}/.git` }) })
    await start($)
    await run($, '16')
    await until(w, () => w.toasts.some(t => t.startsWith('#16 blocked')), 'the block')
    expect(w.toasts).toContain("#16 blocked: the checkout is busy (#44's run works here)")
    expect(w.argv.some(a => a[1] === 'switch')).toBe(false)
  })

  test('the same issue answers its status, with no menu; Cancel and Stop-then-start do what they say', async ($, on) => {
    const w = engine(on, { answer: 'Cancel', baseProfile: WORKTREE }, { [key(44)]: blocked44({ repo: `${ROOT}/.git` }) })
    await start($)
    const same = (await run($, '44')).text ?? ''
    expect(same).toContain('#44 has a run already.')
    expect(same).toContain('blocked at gateG')
    expect(w.asked).toEqual([])
    expect((await run($, '16')).text).toBe('cancelled; nothing started.')
    expect(w.argv.some(a => a[0] === 'gh')).toBe(false)
    w.answer = 'Stop #44, then start #16'
    expect((await run($, '16')).text).toBe('stopped #44; starting #16; the pane shows progress. Nothing is pushed until you say yes.')
    expect((await run($, 'status 44')).text).toContain('stopped; the branch and its commits are kept')
  })

  test('nobody to answer (claude -p): the typed issue starts', async ($, on) => {
    const w = engine(on, { answer: null, baseProfile: WORKTREE }, { [key(44)]: blocked44({ repo: `${ROOT}/.git` }) })
    // A -p run: no person at the prompt (PR #51 review: only then does a missing answer start the run).
    await start($, false)
    expect((await run($, '16')).text).toContain('starting #16')
    await until(w, () => w.spawned.length === 1, "#16's red agent")
  })

  test('the session driving #16: Keep explains, no answer explains, Hand off ends the drive and starts #17', async ($, on) => {
    const w = engine(on, { baseProfile: WORKTREE, spawnHold: held() })
    await start($)
    await run($, '16')
    await until(w, () => w.spawned.length === 1, "#16's red agent")
    w.answer = 'Keep #16 here; start #17 from another session (Recommended)'
    const keep = 'Open another Claude Code session in this repository and run /issue-forge 17 there; it gets its own worktree.'
    expect((await run($, '17')).text).toBe(keep)
    expect(w.asked.at(-1)).toBe('This session is driving #16 (red 1/2). What should it do with #17?')
    // Esc on the menu in an interactive session cancels (PR #51 review).
    w.answer = null
    expect((await run($, '17')).text).toBe('cancelled; nothing started.')
    w.answer = 'Hand #16 off and start #17 here (any session can resume #16)'
    expect((await run($, '17')).text).toBe('handed off #16 at red; starting #17; the pane shows progress. Nothing is pushed until you say yes.')
    expect((await run($, 'status 16')).text).toContain('interrupted during red; /issue-forge resume restarts it')
  })

  test('/issue-forge handoff and the Hand off button end this session\'s drive and keep the step', async ($, on) => {
    const w = engine(on, { baseProfile: WORKTREE, spawnHold: held() })
    await start($)
    expect((await run($, 'handoff')).text).toBe('this session is driving no run.')
    await run($, '16')
    await until(w, () => w.spawned.length === 1, "#16's red agent")
    const ui = await pane($)
    expect(await ui.find({ type: 'Text', text: /h hand off/ })).toBeDefined()
    await ui.press({ key: 'handoff' })
    await until(w, () => w.toasts.some(t => t.startsWith('handed off #16')), 'the hand-off toast')
    await ui.unmount()
    expect(w.toasts).toContain('handed off #16 at red; /issue-forge resume 16 continues it in any session.')
    expect((await run($, 'resume')).text).toBe('resuming #16 at red.')
    await until(w, () => w.spawned.length === 2, 'red again')
    expect((await run($, 'handoff 16')).text).toBe('handed off #16 at red; /issue-forge resume 16 continues it in any session.')
  })

  test('with two active runs, a command without a number names them; stop 44 stops only #44', async ($, on) => {
    const w = engine(on, {}, { [key(44)]: blocked44({ repo: `${ROOT}/.git`, startedAt: 1 }), [key(52)]: blocked44({ id: '52-1', issue: 52, repo: `${ROOT}/.git`, startedAt: 2 }) })
    await start($)
    expect((await run($, 'stop')).text).toBe('2 runs in this repository: #52 blocked at gateG · #44 blocked at gateG. Name one: /issue-forge stop 52')
    expect((await run($, 'resume')).text).toContain('Name one: /issue-forge resume 52')
    expect((await run($, 'stop 44')).text).toContain('stopped #44')
    expect((await run($, 'status 52')).text).toContain('blocked at gateG')
    expect((await run($, 'status 7')).text).toBe('no run for #7 in this repository.')
    expect(w.asked).toEqual([])
  })

  test('a run another session drives: Cancel or no answer refuses and writes nothing; Take over resumes it here', async ($, on) => {
    const store: Record<string, unknown> = { [key(40)]: elsewhere40() }
    const w = engine(on, { head: 'issue-40-x', answer: 'Cancel', spawnHold: held(), storeHold: { when: () => false, until: Promise.resolve() } }, store)
    await start($)
    const refused = '#40 runs in another session; use that session, or answer Take over in an interactive one.'
    expect((await run($, 'resume')).text).toBe(refused)
    expect(w.asked).toEqual(['#40 is driven by another session (for 2m05s). If that session has ended, take it over?'])
    w.answer = null
    expect((await run($, 'stop 40')).text).toBe(refused)
    expect((store[key(40)] as any).step).toBe('green')
    expect((store[key(40)] as any).driver).toEqual({ session: OTHER, since: 875_000 })
    w.answer = 'Take over'
    expect((await run($, 'resume 40')).text).toBe('resuming #40 at green.')
    await until(w, () => w.spawned.length === 1, 'green')
    expect((store[key(40)] as any).driver.session).toBe(SESSION)
  })

  test("the pane shows a run driven elsewhere, and the repository's other runs on an also line", async ($, on) => {
    engine(on, {}, { [key(44)]: blocked44({ repo: `${ROOT}/.git`, startedAt: 1 }), [key(40)]: elsewhere40({ startedAt: 2 }) })
    await start($)
    await run($, 'status 40')
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await pane($, surface)
      expect(await ui.find({ type: 'Text', text: /◌ runs in another session \(for 2m05s\)$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /\/issue-forge resume 40 takes it over/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /also {7}#44 blocked at gateG/ })).toBeDefined()
      await ui.unmount()
    }
  })

  test("session.end clears this session's driver, not another's, and not on /clear (the process goes on)", async ($, on) => {
    // #40 is blocked with a driver left by another session: it isn't running, so it doesn't share the LCOV file.
    const store: Record<string, unknown> = { [key(40)]: elsewhere40({ step: 'blocked', blocked: { at: 'green', reason: 'r', next: 'n' } }) }
    // #40 is still active, so starting #16 asks: Start (Esc would now cancel).
    const w = engine(on, { answer: START16, baseProfile: WORKTREE, spawnHold: held(), storeHold: { when: () => false, until: Promise.resolve() } }, store)
    await start($)
    await run($, '16')
    await until(w, () => w.spawned.length === 1, "#16's red agent")
    expect((store[key(16)] as any).driver.session).toBe(SESSION)
    await $.session.end({ reason: 'clear', sessionId: SESSION } as never)
    expect((store[key(16)] as any).driver.session).toBe(SESSION)
    await $.session.end({ reason: 'other', sessionId: SESSION } as never)
    expect((store[key(16)] as any).driver).toBeUndefined()
    expect((store[key(16)] as any).step).toBe('red')
    expect((store[key(40)] as any).driver.session).toBe(OTHER)
  })

  for (const [what, change, toast] of [
    ['takes over', (r: any) => ({ ...r, driver: { session: OTHER, since: 0 } }), '#16 was taken over by another session; this session stopped driving it.'],
    ['stops', (r: any) => ({ ...r, step: 'stopped' }), '#16 was stopped in another session; this session stopped driving it.'],
  ] as const) {
    test(`the driving session ends its own drive within 5 s when another session ${what} its run`, async ($, on) => {
      const store: Record<string, unknown> = {}
      const w = engine(on, { baseProfile: WORKTREE, spawnHold: held(), answer: 'Cancel', storeHold: { when: () => false, until: Promise.resolve() } }, store)
      await start($)
      await run($, '16')
      await until(w, () => w.spawned.length === 1, "#16's red agent")
      // Another session writes the run (the store is shared live between sessions).
      store[key(16)] = change(store[key(16)])
      await w.clock.advance(5_000)
      await until(w, () => w.toasts.includes(toast), 'the toast')
      // This session drives nothing now: a new start doesn't offer to keep or hand off #16.
      await run($, '17')
      expect(w.asked.at(-1) ?? '').not.toContain('This session is driving')
    })
  }

  // PR #51 review (Codex 4278707565): resume spends seconds on gh and git before it writes; a run another
  // session stopped or took in that time is left as that session wrote it.
  for (const [what, head, change, stored] of [
    ['stops it before resume drives it', BRANCH, (r: any) => ({ ...r, step: 'stopped' }), { step: 'stopped' }],
    ['resumes it first', BRANCH, (r: any) => ({ ...r, step: 'green', driver: { session: OTHER, since: 1 } }), { driver: { session: OTHER, since: 1 } }],
    ['stops it while resume finds it still blocked', 'main', (r: any) => ({ ...r, step: 'stopped' }), { step: 'stopped' }],
  ] as const) {
    test(`resume writes nothing when another session ${what}`, async ($, on) => {
      const store: Record<string, unknown> = { [key(16)]: storedRun('blocked', { repo: `${ROOT}/.git`, blocked: { at: 'green', reason: 'r', next: 'n' } }) }
      const w = engine(on, { head, spawnHold: held(), storeHold: { when: () => false, until: Promise.resolve() } }, store)
      w.beforeIssueView = () => (store[key(16)] = change(store[key(16)]))
      await start($)
      expect((await run($, 'resume')).text).toBe('#16 moved on before it could be resumed; /issue-forge status 16 says where it is.')
      expect(store[key(16)]).toMatchObject(stored)
      expect(w.spawned).toEqual([])
    })
  }

  test('stop with no number means the run the pane shows: once it has stopped, a second stop leaves the other run alone', async ($, on) => {
    engine(on, {}, { [key(44)]: blocked44({ repo: `${ROOT}/.git`, startedAt: 1 }), [key(40)]: blocked44({ id: '40-1', issue: 40, repo: `${ROOT}/.git`, startedAt: 2 }) })
    await start($)
    expect((await run($, 'stop 40')).text).toContain('stopped #40')
    expect((await run($, 'stop')).text).toBe('no active run here.')
    expect((await run($, 'status 44')).text).toContain('blocked at gateG')
  })

  // PR #51 review: push and gh pr create can't be undone, so they don't wait for the 5 s watch.
  // The take-over variant came after green: before it, the drive re-ran the step forever and hung the suite
  // instead of failing an assertion.
  for (const [what, change] of [
    ['stops', (r: any) => ({ ...r, step: 'stopped' })],
    ['takes over', (r: any) => ({ ...r, driver: { session: OTHER, since: 1 } })],
  ] as const) {
    test(`publish pushes nothing when another session ${what} the run during the merge check`, async ($, on) => {
      let release: () => void = () => undefined
      const store: Record<string, unknown> = { [key(16)]: storedRun('ready', { repo: `${ROOT}/.git`, greenCommit: 'c2', gatedHead: 'c0' }) }
      const w = engine(on, { head: BRANCH, mergeHold: new Promise<void>(r => (release = r)), storeHold: { when: () => false, until: Promise.resolve() } }, store)
      await start($)
      expect((await run($, 'publish')).text).toContain('publishing #16')
      await until(w, () => w.argv.some(a => a[1] === 'merge-tree'), 'the merge check')
      store[key(16)] = change(store[key(16)])
      release()
      // Bounded, not settle(): a drive that kept going after its write was dropped would never settle.
      for (let i = 0; i < 20; i++) await w.clock.advance(5)
      expect(w.argv.filter(a => a[1] === 'push')).toEqual([])
      expect(w.argv.filter(a => a[0] === 'gh' && a[1] === 'pr')).toEqual([])
      // The drive has ended: the step isn't run again.
      expect(w.argv.filter(a => a[1] === 'merge-tree')).toHaveLength(1)
    })
  }

  test('a resumed run checks the shared LCOV file again before its gate runs coverage (PR #51 review)', async ($, on) => {
    const blocked16 = storedRun('blocked', { repo: `${ROOT}/.git`, blocked: { at: 'gateG', reason: 'r', next: 'n' } })
    const w = engine(on, { head: BRANCH, staged: ['tests/a.test.ts', 'src/a.ts'], sinceRed: ['src/a.ts'], redPaths: ['tests/a.test.ts'] }, { [key(16)]: blocked16, [key(40)]: elsewhere40() })
    await start($)
    expect((await run($, 'resume 16')).text).toBe('resuming #16 at gateG.')
    await until(w, () => w.toasts.some(t => t.startsWith('#16 blocked')), 'the block')
    expect((await run($, 'status 16')).text).toContain('blocked at gateG: lcovPath /cov/lcov.info is shared by every run and #40 is running')
    expect(w.argv.some(a => a[0] === 'c')).toBe(false)
    expect(w.commits).toEqual([])
  })

  test("the branch and worktree preflight made don't land on a run another session took over meanwhile (Codex 4278707576)", async ($, on) => {
    let release: () => void = () => undefined
    const store: Record<string, unknown> = {}
    const w = engine(on, { baseProfile: WORKTREE, worktreeAddHold: new Promise<void>(r => (release = r)), storeHold: { when: () => false, until: Promise.resolve() } }, store)
    await start($)
    await run($, '16')
    await until(w, () => w.argv.some(a => a[1] === 'worktree' && a[2] === 'add'), 'the worktree add')
    store[key(16)] = { ...(store[key(16)] as any), driver: { session: OTHER, since: 1 } }
    release()
    for (let i = 0; i < 20; i++) await w.clock.advance(5)
    expect(store[key(16)]).toMatchObject({ branch: '', driver: { session: OTHER, since: 1 } })
    expect((store[key(16)] as any).workRoot).toBeUndefined()
  })

  test("pruning keeps a pruned run's agents list, so they stay refused after a restart (PR #51 review)", async ($, on) => {
    const store: Record<string, unknown> = { [`issue-forge:repo-agents:${ROOT}/.git#100`]: ['ghost-100'] }
    for (let i = 0; i < 21; i++) store[key(100 + i)] = storedRun('done', { id: `${100 + i}-1`, issue: 100 + i, repo: `${ROOT}/.git`, startedAt: i, agents: [] })
    const w = engine(on, { baseProfile: WORKTREE, spawnHold: held(), storeHold: { when: () => false, until: Promise.resolve() } }, store)
    await start($)
    await run($, '16')
    await until(w, () => w.spawned.length === 1, "#16's red agent")
    expect(store[key(100)]).toBeUndefined()
    expect(store[key(101)]).toBeDefined()
    // A restart of the module (a reload) rebuilds the known agents from the store.
    await start($)
    expect(((await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'ghost-100' } as never)) as any).deny).toContain('issue-forge:')
  })

  test("a step of a handed-off drive doesn't commit, even when the run is resumed at once in the same session (PR #51 review)", async ($, on) => {
    let release: () => void = () => undefined
    const gateG = storedRun('gateG', { repo: `${ROOT}/.git` })
    const w = engine(on, { head: BRANCH, staged: ['tests/a.test.ts', 'src/a.ts'], sinceRed: ['src/a.ts'], redPaths: ['tests/a.test.ts'], spawnHold: held(), statusHold: new Promise<void>(r => (release = r)) }, { [key(16)]: gateG })
    await start($)
    expect((await run($, 'resume')).text).toBe('resuming #16 at gateG.')
    await until(w, () => w.argv.some(a => a[1] === 'status' && a.includes('-z')), "the first drive's last look")
    expect((await run($, 'handoff')).text).toBe('handed off #16 at gateG; /issue-forge resume 16 continues it in any session.')
    expect((await run($, 'resume')).text).toBe('resuming #16 at gateG.')
    await until(w, () => w.commits.length === 1, "the second drive's commit")
    release()
    for (let i = 0; i < 20; i++) await w.clock.advance(5)
    expect(w.commits).toHaveLength(1)
  })

  test('Esc on the start menu in an interactive session cancels; the run starts only where nobody can answer (PR #51 review)', async ($, on) => {
    const w = engine(on, { answer: null, baseProfile: WORKTREE }, { [key(44)]: blocked44({ repo: `${ROOT}/.git` }) })
    await start($)
    expect((await run($, '16')).text).toBe('cancelled; nothing started.')
    expect(w.asked).toHaveLength(1)
    expect(w.argv.some(a => a[0] === 'gh')).toBe(false)
  })

  test('the session driving a run, under claude -p: no answer explains how to start the issue elsewhere', async ($, on) => {
    const w = engine(on, { answer: null, baseProfile: WORKTREE, spawnHold: held() })
    await start($, false)
    await run($, '16')
    await until(w, () => w.spawned.length === 1, "#16's red agent")
    expect((await run($, '17')).text).toBe('Open another Claude Code session in this repository and run /issue-forge 17 there; it gets its own worktree.')
  })

  test("a migration that fails doesn't stop session start from loading the known agents (PR #51 review)", async ($, on) => {
    engine(on, { worktreeListThrows: true }, { 'issue-forge:run:/elsewhere': storedRun('stopped', { id: 'x-1', root: '/elsewhere', issue: 9 }), [key(16)]: storedRun('green', { repo: `${ROOT}/.git` }) })
    await start($)
    expect(((await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'old-red' } as never)) as any).deny).toContain('issue-forge:')
  })

  test('the command offers handoff and the optional issue numbers in its hint (PR #51 review)', async ($, on) => {
    const w = engine(on)
    await start($)
    expect(w.registered.map(r => r.argumentHint)).toEqual(['<issue> | status [N] | resume [N] | publish [N] | handoff [N] | stop [N] | demo'])
  })

  test('a lock another git holds on the fetch is retried, and the run goes on', async ($, on) => {
    const w = engine(on, { baseProfile: WORKTREE, fetchLocks: 2, spawnHold: held() })
    await start($)
    await run($, '16')
    await until(w, () => w.spawned.length === 1, "#16's red agent")
    expect(w.toasts.some(t => t.includes('blocked'))).toBe(false)
  })

  test('an lcovPath outside the run folder blocks while another session drives a run', async ($, on) => {
    const w = engine(on, { answer: START16, localProfile: WORKTREE, baseProfile: WORKTREE }, { [key(40)]: elsewhere40() })
    await start($)
    await run($, '16')
    await until(w, () => w.toasts.some(t => t.startsWith('#16 blocked')), 'the block')
    expect((await run($, 'status 16')).text).toContain('lcovPath /cov/lcov.info is shared by every run and #40 is running')
    expect(w.spawned).toEqual([])
  })
})

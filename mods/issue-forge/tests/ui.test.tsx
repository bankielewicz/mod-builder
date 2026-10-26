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

/** One answer of `gitFails` (#28): `isLocked` leaves .git/index.lock in place, `isStashLocked` .git/refs/stash.lock (PR #88 review). */
type GitFail = { stderr: string; code: number; isLocked: boolean; isStashLocked?: boolean }

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
  /** The fence preflight's answer (Change 0.10.0): absent, the script's own no-fence-file refusal; 'throws', bash can't start. */
  fenceCheck?: { exitCode: number; stderr: string } | 'throws'
  /** How many times the fence preflight ran. */
  fenceChecks?: number
  /** The next fence preflight answers only once this settles (PR #162 review round 2, finding 1). */
  fenceHold?: Promise<void>
  /** True once the held preflight has been asked. */
  fenceHeld?: boolean
  /** `git status --porcelain=v1 -z -uall --no-renames` in the session's folder (Change 0.10.0); absent, clean. */
  rootStatus?: string
  /** `git hash-object`'s answer per path; absent, `h-<path>`. */
  rootHashes?: Record<string, string>
  /** What `fs.stat` finds at a path `rootStatus` lists; absent, a file. `hash-object` fails on a `dir`, as git does on a submodule. */
  rootKinds?: Record<string, 'file' | 'dir' | 'other'>
  /** The first `fs.write` that `when` picks lands only once `until` settles (PR #162 review round 1, finding 1). */
  writeHold?: { when: (path: string, text: string) => boolean; until: Promise<void>; isHeld?: boolean }
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
  /** `git write-tree` (#101): each call takes the next tree and the last one repeats; absent, tree0. */
  trees?: string[]
  /** HEAD's tree as the commit read sees it (#101: a commit a hook changed); absent, the tree the last commit staged. */
  headTree?: string
  /** The tree `write-tree` last answered. */
  lastTree?: string
  /** HEAD's tree (PR #136 review): each commit sets it to the staged tree, or to `headTree` (a commit a hook changed); absent, tree0. */
  commitTree?: string
  /** `git rev-parse HEAD` (PR #136 review: a HEAD another process moved); absent, c<number of commits>. */
  revParseHead?: string
  /** `log.showSignature` is on: as git 2.53 does for a signed commit, `git log` prints the check's line first (unless --no-show-signature). */
  showSignature?: boolean
  /** refs/replace/<HEAD> names a commit with this tree (Codex 4351786036): git reads it unless --no-replace-objects. */
  replacedTree?: string
  /** The parent `cat-file commit` names for HEAD (PR #136 review round 2: another commit moved the branch); absent, the commit before. */
  headParent?: string
  /** The profile's format command `f` (#137) exits with this, printing a parse error; absent, 0. */
  formatExit?: number
  /** What `f` leaves unstaged, as `git status --porcelain -z` prints it, until the next `git add -A` stages it (#137). */
  formatWrites?: string
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
  /** With `storeHold`, each write and delete that lands, in order, as `set <key>` or `delete <key>` (#140). */
  storeOps?: string[]
  /** With `storeHold`, keys whose `$.store.get` rejects (PR #145 review round 1, finding 4). */
  storeGetFails?: string[]
  /** With `storeHold`, runs before each `$.store.get` answers, with the key and how many times it has been read (finding 3). */
  onStoreGet?: (key: string, reads: number) => void
  /** With `storeHold`, the next `$.store.keys` rejects, once (PR #145 review round 3, finding 4). */
  storeKeysFailNext?: boolean
  /** With `storeHold`, a write that would take the store's compact JSON past this many characters rejects, as Claude Code's does (round 4). */
  storeLimit?: number
  /** Every `$.ui.log` line (PR #145 review round 3, finding 4). */
  logs: string[]
  /** When set, the next `git merge-tree` waits for it (once). */
  mergeHold?: Promise<void>
  /** `git merge-tree` throws, as a timed-out process.run does. */
  mergeThrows?: boolean
  /** Where the coverage command last ran: a real reporter names files under that folder. */
  lcovRoot?: string
  /** `gh repo view --json nameWithOwner,url`; absent, o/r on github.com (#25). */
  repoView?: { exitCode: number; stdout: string; stderr?: string }
  /** `git remote get-url origin`: the URL, or a failure; absent, https://github.com/o/r.git (#25). */
  originUrl?: string | { exitCode: number; stderr: string }
  /** `git remote get-url --push --all origin`, one line per URL; absent, the same as originUrl (#25, PR #68 review). */
  pushUrl?: string | string[] | { exitCode: number; stderr: string }
  /** What `gh repo view <host/owner/repo>` canonicalises an argument to (its nameWithOwner); absent, the argument itself (#25). */
  canonical?: Record<string, string>
  /** Remotes other than origin, name to fetch URL: `git remote` lists origin and these, sorted; absent, origin alone (#26). */
  remotes?: Record<string, string>
  /** `ssh -G <host>`: the HostName ~/.ssh/config gives a nickname; absent, the host itself, as ssh prints it. */
  sshHosts?: Record<string, string>
  /** `gh repo view <fork> --json isFork,parent` exits 1 with this on stderr. */
  forkViewFails?: string
  /** `gh api users/<owner>` exits 1 with this on stderr. */
  ownerTypeFails?: string
  /** `ssh -G` can't run (no ssh). */
  sshFails?: boolean
  /** `gh repo view <repo> --json nameWithOwner,url` for this one repository answers only once `until` settles. */
  viewHold?: { repo: string; until: Promise<void> }
  /** Per folder, remotes whose fetch URL differs there (a worktree's own config); absent, `remotes` everywhere. */
  remotesIn?: Record<string, Record<string, string>>
  /** `gh repo view <host/owner/repo> --json isFork,parent`: the parent as `owner/name`, or null for a repository that isn't a fork; absent, a fork of o/r (#26). */
  parentOf?: Record<string, string | null>
  /** Owners `gh api users/<owner> --jq .type` calls an Organization, as `owner` on any host or `host/owner` on that host only; any other is a User (#26). */
  orgOwners?: string[]
  /** `git ls-remote --heads <remote>`: the branch names already on a remote; absent, none (#26). */
  remoteHeads?: Record<string, string[]>
  /**
   * Index-writing git calls that fail (#28): a call whose arguments are, or start with, `on` takes the next answer;
   * once `seq` is empty the calls pass. `isLocked` says the answer leaves .git/index.lock in place (fs.exists sees it).
   */
  gitFails?: { on: string; seq: GitFail[] }
  /** Whether .git/index.lock exists now: set by a failure that held it, cleared by the next call `gitFails` matches. */
  lockFile?: boolean
  /** Whether .git/refs/stash.lock exists now, as `lockFile` (PR #88 review). */
  stashLockFile?: boolean
  /** git before 2.31: rev-parse doesn't know `--path-format` and prints it back, exit 0, before the path (PR #88 review). */
  isGitBefore231?: boolean
  /** The other process lets go of .git/index.lock while the mod asks git where that file is (PR #88 review). */
  isLockGoneOnLookup?: boolean
  /** `git stash list`'s output; absent, empty. */
  stashList?: string
  /** The url `gh issue view` answers with; absent, ISSUE's (#25). */
  issueUrl?: string
  /** `gh issue view` exits 1 with this on stderr (#25). */
  issueFails?: string
  /** `git diff --cached … --diff-filter=A -z <merge base>`: paths a phase added (Change 0.7.0), found by its filter, not its exact flags. */
  added?: string[]
  /** `git ls-tree -r --name-only -z origin/main`: the base branch's tip (owner's decision after PR #103's review). */
  baseTip?: string[]
  /** What $.command.register was given. */
  registered: { name: string; argumentHint?: string }[]
  /** Every process.run with the folder it ran in and the mock time it ran at. */
  calls: { argv: string[]; cwd?: string; timeoutMs?: number; at: number }[]
  /** Every process.run's init, parallel to `argv`: the env and stdin a call carried (#28). */
  inits: any[]
  /** The command each Bash call reached beneath the mod with. */
  bash: string[]
  argv: string[][]
  commits: string[]
  spawned: { subagentType: string; name?: string; model?: string; prompt: string; cwd?: string }[]
  asked: string[]
  /** The labels each question offered, in the order asked (#31). */
  choices: string[][]
  toasts: string[]
  opened: string[]
  /** Every `$.ui.open`, whole: `focus` included (#31). */
  opens: { id: string; title?: string; columns?: number; focus?: boolean }[]
  /** Every id `$.ui.close` was asked to close (#31). */
  closed: string[]
  /** What `$.ui.panes()` lists (#31): `isShown: false` is a tab behind another pane, `isPlaced: false` one waiting undrawn (placed unless it says so). Absent, none is open. */
  panes?: { id: string; isShown: boolean; isPlaced?: boolean }[]
  /** A listed pane comes to the front once it was opened (#31). */
  showOnOpen?: boolean
  files: Record<string, string>
  beneath: string[]
  clock: any
  /** What each `$.agent.list()` answers, call by call; the last repeats; absent, no agents (#40). */
  listed?: any[][]
  /** `$.agent.list()` rejects (#40). */
  listFails?: boolean
  /** The `task_id` of every `TaskStop` call, in order (#40). */
  taskStops: string[]
  /** What a `TaskStop` call answers; absent, the success Claude Code 2.1.310 gave (#40's probe). */
  taskStopAnswer?: any
  /** `$.agent.spawn` is refused with this reason (PR #151 review round 1, finding 5). */
  spawnDeny?: string
  /** When set, every `TaskStop` waits for it, as one held by a permission dialog would (round 2, finding 4). */
  taskStopHold?: Promise<void>
}

/** Where git keeps /w's index lock (#28). */
const LOCK_PATH = `${ROOT}/.git/index.lock`
/** The lock of refs/stash, which every worktree shares (PR #88 review). */
const STASH_LOCK_PATH = `${ROOT}/.git/refs/stash.lock`

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
    inits: [],
    bash: [],
    argv: [],
    commits: [],
    spawned: [],
    asked: [],
    choices: [],
    toasts: [],
    logs: [],
    opened: [],
    opens: [],
    closed: [],
    files: {},
    beneath: [],
    clock: null,
    taskStops: [],
    ...w,
  }
  world.clock = mock.clock(on, { now: 1_000_000 })
  const hold = world.storeHold
  if (hold) {
    const reads: Record<string, number> = {}
    on('store.get', ($: any, e: any) => {
      const n = (reads[e.key] ?? 0) + 1
      reads[e.key] = n
      world.onStoreGet?.(e.key, n)
      return world.storeGetFails?.includes(e.key) ? { deny: 'the store could not be read' } : { value: store[e.key] }
    })
    on('store.set', ($: any, e: any) => {
      // Claude Code's check, read in the 2.1.309 binary: the new store as compact JSON, in characters.
      const size = world.storeLimit === undefined ? 0 : JSON.stringify({ ...store, [e.key]: e.value }).length
      if (world.storeLimit !== undefined && size > world.storeLimit) return { deny: `the store would be ${size} characters, over the ${world.storeLimit} limit` }
      const land = () => ((store[e.key] = e.value), world.storeOps?.push(`set ${e.key}`), { value: undefined })
      if (hold.isHeld || !hold.when(e.value)) return land()
      hold.isHeld = true
      return hold.until.then(land)
    })
    on('store.keys', () => {
      if (!world.storeKeysFailNext) return { value: Object.keys(store) }
      world.storeKeysFailNext = false
      return { deny: 'the store could not be listed' }
    })
    on('store.delete', ($: any, e: any) => (delete store[e.key], world.storeOps?.push(`delete ${e.key}`), { value: undefined }))
  } else mock.store(on, store)
  on('session.id', () => ({ value: SESSION }))
  mock.env(on, { HOME: '/home/u' })
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('session.end', ($: any, e: any) => ({ sessionId: e.sessionId }))
  on('command.register', ($: any, e: any) => (world.registered.push(e), { value: undefined }))
  on('agent.register', ($: any, e: any) => ({ value: { agent: `issue-forge:${e.name}` } }))
  on('ui.open', ($: any, e: any) => (world.opened.push(e.id), world.opens.push({ ...e }), { value: { isPlaced: world.isPlaced } }))
  on('ui.panes', () => ({
    value: (world.panes ?? []).map(pane => ({ id: pane.id, title: 'Issue Forge', isFocused: false, isPlaced: pane.isPlaced ?? true, isShown: pane.isShown || (world.showOnOpen === true && world.opened.includes(pane.id)) })),
  }))
  on('ui.close', ($: any, e: any) => (world.closed.push(e.id), { value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', ($: any, e: any) => (world.toasts.push(e.text ?? String(e)), { value: undefined }))
  on('ui.log', ($: any, e: any) => (world.logs.push(e.text), { value: undefined }))
  on('turn.complete', ($: any, e: any) => ({ text: e.answer }))
  on('prompt.submit', ($: any, e: any) => ({ text: e.text }))
  on('session.receive', ($: any, e: any) => ({ text: e.text }))
  on('tool.call', { tool: 'Bash' }, ($: any, e: any) => (world.beneath.push(e.agentId ?? 'main'), world.bash.push(e.command), { result: 'ran' }))
  on('tool.call', { tool: 'AskUserQuestion' }, ($: any, e: any) => {
    const q = e.questions[0].question
    world.asked.push(q)
    world.choices.push((e.questions[0].options ?? []).map((option: any) => option.label))
    if (world.hold) return world.hold.then(label => ({ result: { questions: e.questions, answers: { [q]: label } } }))
    if (world.answer === null) return { deny: 'nobody to ask' }
    return { result: { questions: e.questions, answers: { [q]: world.answer } } }
  })
  let lists = 0
  on('agent.list', () => {
    if (world.listFails) return { deny: 'the agents could not be listed' }
    const all = world.listed ?? [[]]
    return { value: all[Math.min(lists++, all.length - 1)] }
  })
  on('tool.call', { tool: 'TaskStop' }, ($: any, e: any) => {
    world.taskStops.push(e.task_id)
    const answer = world.taskStopAnswer ?? { result: { message: `Successfully stopped task: ${e.task_id} (issue-forge #16)`, task_id: e.task_id, task_type: 'local_agent', command: 'issue-forge #16' } }
    return world.taskStopHold ? world.taskStopHold.then(() => answer) : answer
  })
  on('agent.spawn', ($: any, e: any) => {
    world.spawned.push({ subagentType: e.subagentType ?? e.subagent_type, name: e.name, model: e.model, prompt: e.prompt, cwd: e.cwd })
    const answer = world.spawnDeny !== undefined ? { deny: world.spawnDeny } : { model: e.model ?? 'claude', agentId: `a${world.spawned.length}` }
    return world.spawnHold ? world.spawnHold.then(() => answer) : answer
  })
  const profilePath = `${ROOT}/.issue-forge.json`
  const worktreeOf = (path: string) => world.worktrees.find(wt => path === `${wt}/.issue-forge.json`)
  const isWorktreeProfile = (path: string) => worktreeOf(path) !== undefined
  on('fs.exists', ($: any, e: any) => ({
    value: !world.fsBlind?.includes(e.path) && (((e.path === profilePath || isWorktreeProfile(e.path)) && world.hasProfile) || e.path in world.files || world.worktrees.includes(e.path) || (e.path === LOCK_PATH && world.lockFile === true) || (e.path === STASH_LOCK_PATH && world.stashLockFile === true)),
  }))
  on('fs.read', ($: any, e: any) => {
    if (e.path === profilePath && world.hasProfile) return { value: JSON.stringify(world.switched && world.baseProfile ? world.baseProfile : (world.localProfile ?? PROFILE)) }
    if (isWorktreeProfile(e.path) && world.hasProfile) return { value: JSON.stringify(world.wtProfiles[worktreeOf(e.path) ?? ''] ?? world.baseProfile ?? PROFILE) }
    if (e.path === LCOV_PATH) return { value: LCOV.replace(`SF:${ROOT}/`, `SF:${world.lcovRoot ?? ROOT}/`) }
    // What the mod wrote reads back, as the fence's 5 s check reads its files (Change 0.10.0).
    if (e.path in world.files) return { value: world.files[e.path] }
    return { deny: 'ENOENT' }
  })
  // The paths the session folder's status lists, which the folder check stats before hashing (PR #162 review round 1, finding 3).
  const rootListed = (path: string) => path.startsWith(`${ROOT}/`) && (world.rootStatus ?? '').split('\0').some(entry => entry.slice(3) === path.slice(ROOT.length + 1))
  on('fs.stat', ($: any, e: any) => {
    if (e.path === LCOV_PATH) return { value: { kind: 'file', size: LCOV.length, mtimeMs: world.clock.now(), isLink: false } }
    if (rootListed(e.path)) return { value: { kind: world.rootKinds?.[e.path.slice(ROOT.length + 1)] ?? 'file', size: 1, mtimeMs: 0, isLink: false } }
    return e.path in world.files ? { value: { kind: 'file', size: world.files[e.path]!.length, mtimeMs: 0, isLink: false } } : { deny: 'ENOENT' }
  })
  on('fs.write', ($: any, e: any) => {
    const land = () => ((world.files[e.path] = e.text), { value: undefined })
    const hold = world.writeHold
    if (!hold || hold.isHeld || !hold.when(e.path, e.text)) return land()
    hold.isHeld = true
    return hold.until.then(land)
  })
  on('process.run', ($: any, e: any) => {
    const argv = e.argv as string[]
    world.argv.push(argv)
    world.calls.push({ argv, cwd: e.init?.cwd, timeoutMs: e.init?.timeoutMs, at: world.clock.now() })
    world.inits.push(e.init)
    const inWorktree = world.worktrees.includes(e.init?.cwd)
    const [cmd, ...a] = argv
    const s = a.join(' ')
    const testResult = () => (world.testsExit === 0 ? ok('all pass') : fail('1 failing: expected 2, got undefined', world.testsExit))
    if (cmd === 't' || cmd === './t.sh') return world.testHold ? world.testHold.then(testResult) : testResult()
    if (cmd === 'c') world.lcovRoot = e.init?.cwd ?? ROOT
    if (cmd === 'c' || cmd === 't2') return ok('ran')
    if (cmd === 'sh') return ok('/usr/bin/x')
    if (cmd === 'f') {
      if (world.formatWrites !== undefined) world.porcelainZ = world.formatWrites
      return world.formatExit ? fail('src/a.ts: SyntaxError: Unexpected token (3:1)', world.formatExit) : ok('formatted')
    }
    if (cmd === 'gh') {
      if (s === 'auth status') return ok()
      if (s === 'repo view --json nameWithOwner,url') return world.repoView ? { value: { stderr: '', isStdoutTruncated: false, isStderrTruncated: false, ...world.repoView } } : ok(JSON.stringify({ nameWithOwner: 'o/r', url: 'https://github.com/o/r' }))
      if (a[0] === 'repo' && a[1] === 'view' && a[3] === '--json' && a[4] === 'isFork,parent') {
        if (world.forkViewFails) return fail(world.forkViewFails)
        const parent = world.parentOf && (a[2] ?? '') in world.parentOf ? world.parentOf[a[2] ?? ''] : 'o/r'
        const [owner = '', name = ''] = (parent ?? '').split('/')
        return ok(JSON.stringify(parent === null ? { isFork: false, parent: null } : { isFork: true, parent: { id: 'R_1', name, owner: { id: 'U_1', login: owner } } }))
      }
      // As gh does: without --hostname, gh api asks github.com.
      const user = a[0] === 'api' ? a.find(x => x.startsWith('users/')) : undefined
      if (user !== undefined) {
        if (world.ownerTypeFails) return fail(world.ownerTypeFails)
        const host = a[1] === '--hostname' ? (a[2] ?? '') : 'github.com'
        const owner = user.slice('users/'.length)
        return ok(`${world.orgOwners?.includes(owner) || world.orgOwners?.includes(`${host}/${owner}`) ? 'Organization' : 'User'}\n`)
      }
      if (a[0] === 'repo' && a[1] === 'view' && a[3] === '--json' && a[4] === 'nameWithOwner,url') {
        const [host = '', owner = '', name = ''] = (a[2] ?? '').split('/')
        const nameWithOwner = world.canonical?.[a[2] ?? ''] ?? `${owner}/${name}`
        const answer = ok(JSON.stringify({ nameWithOwner, url: `https://${host}/${nameWithOwner}` }))
        const held = world.viewHold
        return held && held.repo === a[2] ? held.until.then(() => answer) : answer
      }
      if (a[0] === 'issue') {
        world.beforeIssueView?.()
        if (world.issueFails) return fail(world.issueFails)
        return ok(JSON.stringify({ ...ISSUE, ...(world.issueUrl ? { url: world.issueUrl } : {}), body: world.issueBody }))
      }
      if (a[0] === 'pr') return ok('https://github.com/o/r/pull/20\n')
    }
    // As OpenSSH 10.2 does: ssh -G applies ~/.ssh/config and prints the host it would reach, lowercased, without connecting.
    if (cmd === 'ssh' && a[0] === '-G') return world.sshFails ? fail('sh: 1: ssh: not found', 127) : ok(`user git\nhostname ${world.sshHosts?.[a[1] ?? ''] ?? (a[1] ?? '').toLowerCase()}\nport 22\n`)
    // The fence preflight (Change 0.10.0): hooks/fence.sh refuses the synthetic call, as the script does with no fence file.
    if (cmd === 'bash' && (a[0] ?? '').endsWith('/hooks/fence.sh')) {
      world.fenceChecks = (world.fenceChecks ?? 0) + 1
      const check = world.fenceCheck
      const answer = check === 'throws' ? { deny: 'spawn bash ENOENT' } : check ? { value: { stdout: '', isStdoutTruncated: false, isStderrTruncated: false, ...check } } : fail('issue-forge: this agent has no fence file, so it may not call tools; end your turn now.\n', 2)
      const hold = world.fenceHold
      if (!hold) return answer
      world.fenceHold = undefined
      world.fenceHeld = true
      return hold.then(() => answer)
    }
    if (cmd !== 'git') return fail(`unknown ${cmd}`)
    // The folder check (Change 0.10.0) reads the session's folder with --no-renames, and hashes what it lists.
    if (a[0] === 'status' && a.includes('--no-renames')) return ok(world.rootStatus ?? '')
    if (a[0] === 'hash-object') {
      const paths = String(e.init?.stdin ?? '').split('\n').filter((p: string) => p !== '')
      const dir = paths.find((p: string) => world.rootKinds?.[p] === 'dir')
      if (dir) return fail(`fatal: Unable to hash ${dir}\n`, 128)
      return ok(`${paths.map((p: string) => world.rootHashes?.[p] ?? `h-${p}`).join('\n')}\n`)
    }
    // A held index.lock (#28): the call takes the next scripted failure, and the lock file stays while that failure says so.
    const failing = world.gitFails
    if (failing && (s === failing.on || s.startsWith(`${failing.on} `))) {
      const next = failing.seq.shift()
      world.lockFile = next?.isLocked ?? false
      world.stashLockFile = next?.isStashLocked ?? false
      if (next) return fail(next.stderr, next.code)
    }
    // What the format command wrote is staged by the next git add -A (#137).
    if (s === 'add -A' && world.formatWrites !== undefined && world.porcelainZ === world.formatWrites) world.porcelainZ = undefined
    if (s === 'write-tree') {
      const trees = world.trees ?? []
      // Absent `trees`: each staging with changes gives a new tree; with none, the index is HEAD's tree.
      world.lastTree = (trees.length > 1 ? trees.shift() : trees[0]) ?? (world.hasChanges ? `tree${world.commits.length + 1}` : (world.commitTree ?? 'tree0'))
      return ok(`${world.lastTree}\n`)
    }
    // HEAD and its tree from one commit object (PR #136 review, Codex 4350587226).
    // A commit object, as `git cat-file commit` prints it; replacement refs apply unless --no-replace-objects (round 2).
    const catAt = a[0] === '--no-replace-objects' ? 1 : 0
    if (a[catAt] === 'cat-file' && a[catAt + 1] === 'commit') {
      const tree = catAt === 0 && world.replacedTree ? world.replacedTree : (world.headTree ?? world.commitTree ?? 'tree0')
      const parent = world.headParent ?? (world.commits.length > 0 ? `c${world.commits.length - 1}` : 'base0')
      return ok(`tree ${tree}\nparent ${parent}\nauthor t <a@b.c> 1 +0000\ncommitter t <a@b.c> 1 +0000\n\nmsg\n`)
    }
    if (s === 'rev-parse --verify HEAD') return ok(`c${world.commits.length}\n`)
    if (a[0] === 'log' && a.includes('--format=%H %T')) {
      const signature = world.showSignature && !a.includes('--no-show-signature') ? 'Good "git" signature for p@p with ED25519 key SHA256:HhRJ4R0iwBQK9sEH4vryn4kTqmD6h4b9weroZ7BY0so\n' : ''
      return ok(`${signature}c${world.commits.length} ${world.replacedTree ?? world.headTree ?? world.commitTree ?? 'tree0'}\n`)
    }
    // As git 2.53 prints it: relative to the folder in the main checkout, absolute in a linked worktree.
    if (s === 'rev-parse --git-path index.lock' || s === 'rev-parse --path-format=absolute --git-path index.lock') {
      if (world.isLockGoneOnLookup) world.lockFile = false
      if (a[1] === '--git-path') return ok(inWorktree ? `${ROOT}/.git/worktrees/${(e.init?.cwd ?? '').split('/').pop()}/index.lock\n` : '.git/index.lock\n')
      return ok(world.isGitBefore231 ? '--path-format=absolute\n.git/index.lock\n' : `${LOCK_PATH}\n`)
    }
    // git 2.53 prints refs' lock paths absolute, in the main checkout too.
    if (s === 'rev-parse --git-path refs/stash.lock') return ok(`${STASH_LOCK_PATH}\n`)
    if (a[0] === 'stash' && a[1] === 'list' && world.stashList !== undefined) return ok(world.stashList)
    // git's common folder: the main checkout answers relative, as git does there.
    // As git 2.53 prints them: `--all` lists every push URL, one per line.
    if (s === 'remote get-url origin' || s === 'remote get-url --push --all origin') {
      const url = (s === 'remote get-url origin' ? world.originUrl : (world.pushUrl ?? world.originUrl)) ?? 'https://github.com/o/r.git'
      return typeof url === 'string' ? ok(`${url}\n`) : Array.isArray(url) ? ok(url.map(u => `${u}\n`).join('')) : fail(url.stderr, url.exitCode)
    }
    if (s === 'remote') return ok(`${['origin', ...Object.keys(world.remotes ?? {})].sort().join('\n')}\n`)
    if (a[0] === 'remote' && a[1] === 'get-url' && a.length === 3) {
      const url = world.remotesIn?.[e.init?.cwd ?? '']?.[a[2] ?? ''] ?? world.remotes?.[a[2] ?? '']
      if (url !== undefined) return ok(`${url}\n`)
    }
    if (a[0] === 'ls-remote') return ok((world.remoteHeads?.[a[2] ?? ''] ?? []).map(name => `0123abc\trefs/heads/${name}\n`).join(''))
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
    if (s === 'rev-parse HEAD') return ok(`${world.revParseHead ?? `c${world.commits.length}`}\n`)
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
    // The gate's checks diff the tested tree (PR #136 review, Codex 4350587243): `git diff … <ref> <tested tree>`.
    const isTreeDiff = a[0] === 'diff' && a.at(-1) === world.lastTree
    if (isTreeDiff && a.includes('--diff-filter=A') && a.at(-2) === 'base0') return ok((world.added ?? []).join('\0'))
    if (isTreeDiff && a[1] === '--name-only' && a.at(-2) === 'base0') return ok(world.staged.join('\0'))
    if (isTreeDiff && a[1] === '--name-only') return ok(world.sinceRed.join('\0'))
    if (s === 'ls-tree -r --name-only -z origin/main') return ok((world.baseTip ?? []).join('\0'))
    if (a[0] === 'diff' && a[1] === '--name-only') return ok(world.redPaths.join('\0'))
    if (a[0] === 'diff' && a.includes('-U0')) return ok(DIFF)
    if (a[0] === 'commit') return world.commits.push(e.init?.stdin ?? ''), (world.commitTree = world.headTree ?? world.lastTree ?? 'tree0'), ok()
    return ok()
  })
  return world
}

async function start($: any, isInteractive = true) {
  await $.session.start({ surface: 'terminal', isInteractive, cwd: ROOT })
}

const run = ($: any, args: string) => $.command.run({ command: 'issue-forge', args, origin: COMPOSER, presentation: PRESENTATION })
/** The start's own read of the issue (Change 0.7.0), before the start menu and preflight: a number start names no --repo. */
const isStartRead = (a: string[]) => a[0] === 'gh' && a[1] === 'issue' && a[2] === 'view' && !a.includes('--repo')

async function until(w: World, cond: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 400 && !cond(); i++) await w.clock.advance(5)
  if (!cond()) throw new Error(`timed out waiting for ${label}`)
}

/** Like `until`, but a miss is left to the test's own assertion: the test then fails by it, not by a timeout. */
async function waitFor(w: World, cond: () => boolean): Promise<void> {
  for (let i = 0; i < 400 && !cond(); i++) await w.clock.advance(5)
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
      ['empty', /No run here\. \/issue-forge <issue number or URL> starts one/],
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
    expect(w.argv.some(a => a.includes('17') && !isStartRead(a))).toBe(false)
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

  test("gate R: green is spawned with the red agent's answer in its prompt (#78)", async ($, on) => {
    const w = engine(on, { head: BRANCH, testsExit: 1, staged: ['tests/a.test.ts'], redPaths: ['tests/a.test.ts'] }, { [`issue-forge:run:${ROOT}`]: storedRun('gateR', { redCommit: undefined, used: { red: 1, green: 0, refactor: 0 }, agents: [], redAnswer: 'The suggested fix times out five tests; the fallback passes.' }) })
    await start($)
    await run($, 'resume')
    await until(w, () => w.spawned.length === 1, 'green')
    expect(w.spawned[0]).toMatchObject({ subagentType: 'issue-forge:green' })
    expect(w.spawned[0]!.prompt).toContain('The suggested fix times out five tests; the fallback passes.')
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

  test('a red type other than issue-forge:red is spawned unnamed (a routing plugin may take it), with the red rules in its prompt', { options: { redAgentType: 'general-purpose' } }, async ($, on) => {
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
    // A run stored by 0.1.0 has no pinned repository: no --repo, and no origin check (#25).
    expect(pr).not.toContain('--repo')
    expect(w.argv.some(a => a[0] === 'git' && a[1] === 'remote')).toBe(false)
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

  // A named agent is a teammate with agent teams on: its report is a mailbox delivery, not a prompt (#27, probed on 2.1.296).
  const MAILBOX_DROP = 'issue-forge: a phase agent finished; the pane has the result.'
  const idle = (from: string) => `{"type":"idle_notification","from":"${from}","idleReason":"available","result":"Five new tests are in place."}`
  const mailbox = (teammate: string, extra: Record<string, unknown> = {}) => ({ origin: { kind: 'peer', teammate, isVerified: true, ...extra }, text: idle(teammate) }) as never

  test("a run's named agent finishing is consumed in session.receive, whether or not the harness verified the sender, so the main model stays idle (#27)", async ($, on) => {
    engine(on, {}, { [`issue-forge:run:${ROOT}`]: storedRun('green') })
    await start($)
    const ui = await pane($)
    await ui.unmount()
    expect(await $.session.receive(mailbox('issue-forge-16-red-1'))).toEqual({ consumed: MAILBOX_DROP })
    expect(await $.session.receive(mailbox('issue-forge-16-green-1'))).toEqual({ consumed: MAILBOX_DROP })
    expect(await $.session.receive(mailbox('issue-forge-16-red-1', { isVerified: false }))).toEqual({ consumed: MAILBOX_DROP })
  })

  test("every other delivery still reaches the model: the run's agent's own message or one for another agent, another teammate, the lead, no sender name (#27, PR #86 review)", async ($, on) => {
    engine(on, {}, { [`issue-forge:run:${ROOT}`]: storedRun('green') })
    await start($)
    const ui = await pane($)
    await ui.unmount()
    // From the run's own agent, only the idle notice to the main conversation is consumed.
    const wrote = { origin: { kind: 'peer', teammate: 'issue-forge-16-green-1', isVerified: true }, text: 'Which test glob covers mods/x?' }
    expect(await $.session.receive(wrote as never)).toEqual({ text: wrote.text })
    expect(await $.session.receive({ ...(mailbox('issue-forge-16-green-1') as object), agentId: 'a7' } as never)).toEqual({ text: idle('issue-forge-16-green-1') })
    // The same notice from a name the run doesn't know passes through untouched.
    expect(await $.session.receive(mailbox('researcher'))).toEqual({ text: idle('researcher') })
    expect(await $.session.receive(mailbox('issue-forge-99-red-1'))).toEqual({ text: idle('issue-forge-99-red-1') })
    expect(await $.session.receive({ origin: { kind: 'coordinator', teammate: 'team-lead', isVerified: true }, text: 'please look at #16' } as never)).toEqual({ text: 'please look at #16' })
    // A delivery without a mailbox sender passes through, even when its text names the run's agent.
    const quoted = idle('issue-forge-16-red-1')
    expect(await $.session.receive({ origin: { kind: 'bridge' }, text: quoted } as never)).toEqual({ text: quoted })
    expect(await $.session.receive({ origin: { kind: 'peer' }, text: quoted } as never)).toEqual({ text: quoted })
    expect(await $.session.receive({ text: quoted } as never)).toEqual({ text: quoted })
  })

  test("an agent that stops before its spawn returns still has its idle notice consumed: the name is known first (PR #86 review)", async ($, on) => {
    const w = engine(on, { head: BRANCH, spawnHold: new Promise<void>(() => undefined) }, { [`issue-forge:run:${ROOT}`]: storedRun('green') })
    await start($)
    await run($, 'resume')
    await until(w, () => w.spawned.length === 1, 'the spawn')
    expect(w.spawned[0]!.name).toBe('issue-forge-16-green-2')
    expect(await $.session.receive(mailbox('issue-forge-16-green-2'))).toEqual({ consumed: MAILBOX_DROP })
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
    // A run stored by 0.1.0 has no pinned repository: the issue is looked up as before (#25).
    expect(w.argv.find(a => a[0] === 'gh' && a[1] === 'issue')).not.toContain('--repo')
    // The answer says what the stop did, never a refusal no run has shown (#40).
    const stopped = (await run($, 'stop')).text
    expect(stopped).toContain('stopped #16')
    expect(stopped).not.toContain('refused')
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
    expect((await run($, 'status')).text).toContain("blocked at preflight: redAgentType general-purpose can't work in a worktree: a plugin that routes it elsewhere (to Codex, say) may run it in the session's folder")
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
    // The folder check (Change 0.10.0) reads the checkout's status to compare it later, and never blocks on what it holds.
    const looked = w.calls.filter(c => c.cwd === ROOT && c.argv[0] === 'git' && ((c.argv[1] === 'status' && !c.argv.includes('--no-renames')) || (c.argv[1] === 'rev-parse' && c.argv[2] === '--abbrev-ref')))
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
    expect(w.argv.filter(a => a[0] === 'gh' && !isStartRead(a))).toEqual([])
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

  // #153: the run a "…then start #M" choice names can end while the menu's question is open (the store is shared live
  // between sessions); the start goes on, and its answer says what became of that run.
  for (const [what, change, lead] of [
    ['stops', (r: any) => ({ ...r, step: 'stopped' }), '#16 was stopped in another session while you chose'],
    ['takes over', (r: any) => ({ ...r, driver: { session: OTHER, since: 0 } }), '#16 was taken over by another session while you chose'],
    // PR #155 review round 1, finding 2: a new run of #16 in its place.
    ['replaces', (r: any) => ({ ...r, id: '16-other', driver: { session: OTHER, since: 0 } }), '#16 was replaced while you chose'],
    // PR #159 review round 1, finding 1: finished in another session, its record still naming that session as driver.
    ['finishes', (r: any) => ({ ...r, step: 'done', driver: { session: OTHER, since: 0 } }), '#16 finished while you chose'],
  ] as const) {
    test(`#153: another session ${what} #16 while the menu is open, and Hand #16 off and start #17 here still starts #17`, async ($, on) => {
      const store: Record<string, unknown> = {}
      const w = engine(on, { baseProfile: WORKTREE, spawnHold: held(), storeHold: { when: () => false, until: Promise.resolve() } }, store)
      await start($)
      await run($, '16')
      await until(w, () => w.spawned.length === 1, "#16's red agent")
      let answer: (label: string) => void = () => undefined
      w.hold = new Promise<string>(resolve => (answer = resolve))
      const asked = w.asked.length
      const pending = run($, '17')
      await until(w, () => w.asked.length > asked, 'the menu question')
      store[key(16)] = change(store[key(16)])
      await w.clock.advance(5_000)
      await until(w, () => w.toasts.some(t => t.startsWith('#16 was')), 'the watch ending the drive')
      answer('Hand #16 off and start #17 here (any session can resume #16)')
      expect((await pending).text).toBe(`${lead}; starting #17; the pane shows progress. Nothing is pushed until you say yes.`)
      expect((store[key(17)] as any)?.issue).toBe(17)
    })
  }

  // #153: the run "Stop #44, then start #16" names can end while the menu's question is open; the start goes on, and its
  // answer says what became of #44. PR #155 review round 1 added the deleted record (finding 2) and the finished one, which
  // keeps its driver until that session releases it (finding 1).
  for (const [what, change, lead] of [
    ['stops #44', (s: Record<string, unknown>) => void (s[key(44)] = { ...(s[key(44)] as any), step: 'stopped' }), '#44 was stopped in another session while you chose'],
    ['deletes #44', (s: Record<string, unknown>) => void delete s[key(44)], '#44 was replaced while you chose'],
    ['finishes #44', (s: Record<string, unknown>) => void (s[key(44)] = { ...(s[key(44)] as any), step: 'done', blocked: undefined, driver: { session: OTHER, since: 1_000_000 } }), '#44 finished while you chose'],
  ] as const) {
    test(`#153: another session ${what} while the menu is open, and Stop #44, then start #16 still starts #16`, async ($, on) => {
      const store: Record<string, unknown> = { [key(44)]: blocked44({ repo: `${ROOT}/.git` }) }
      const w = engine(on, { baseProfile: WORKTREE, localProfile: WORKTREE, spawnHold: held(), storeHold: { when: () => false, until: Promise.resolve() } }, store)
      await start($)
      let answer: (label: string) => void = () => undefined
      w.hold = new Promise<string>(resolve => (answer = resolve))
      const pending = run($, '16')
      await until(w, () => w.asked.length > 0, 'the menu question')
      expect(w.asked.at(-1)).toBe('#44 is active in this repository: blocked at gateG. What should this session do?')
      change(store)
      answer('Stop #44, then start #16')
      expect((await pending).text).toBe(`${lead}; starting #16; the pane shows progress. Nothing is pushed until you say yes.`)
      expect((store[key(16)] as any)?.issue).toBe(16)
    })
  }

  test('#153 guard: #44 resumed in another session while the menu is open, then no to taking it over: nothing starts', async ($, on) => {
    const store: Record<string, unknown> = { [key(44)]: blocked44({ repo: `${ROOT}/.git` }) }
    const w = engine(on, { baseProfile: WORKTREE, localProfile: WORKTREE, spawnHold: held(), storeHold: { when: () => false, until: Promise.resolve() } }, store)
    await start($)
    let answer: (label: string) => void = () => undefined
    w.hold = new Promise<string>(resolve => (answer = resolve))
    const pending = run($, '16')
    await until(w, () => w.asked.length > 0, 'the menu question')
    store[key(44)] = { ...(store[key(44)] as any), step: 'green', blocked: undefined, driver: { session: OTHER, since: 1_000_000 } }
    // The take-over question gets the same held label, which isn't Take over: a no.
    answer('Stop #44, then start #16')
    expect((await pending).text).toBe('#44 runs in another session; use that session, or answer Take over in an interactive one.')
    expect(w.asked.at(-1)).toContain('If that session has ended, take it over?')
    expect(key(16) in store).toBe(false)
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

  test('a Stop press on a run another session drives asks one question that says so: Keep it running leaves it, Stop the run stops it (PR #96 review)', async ($, on) => {
    const store: Record<string, unknown> = { [key(40)]: elsewhere40() }
    const w = engine(on, { head: 'issue-40-x', answer: 'Keep it running', spawnHold: held(), storeHold: { when: () => false, until: Promise.resolve() } }, store)
    await start($)
    await run($, 'status 40')
    const ask = '#40 is driven by another session (for 2m05s). Stop run #40? Its branch and commits are kept.'
    let ui = await pane($)
    await ui.press({ key: 'stop' })
    await waitFor(w, () => w.toasts.some(t => t.startsWith('left #40')))
    await ui.unmount()
    expect(w.asked).toEqual([ask])
    expect((store[key(40)] as any).step).toBe('green')
    w.answer = 'Stop the run'
    ui = await pane($)
    await ui.press({ key: 'stop' })
    await waitFor(w, () => w.toasts.some(t => t.startsWith('stopped #40')))
    await ui.unmount()
    expect(w.asked).toEqual([ask, ask])
    expect((store[key(40)] as any).step).toBe('stopped')
  })

  test('a Publish press on a ready run while this session drives another refuses before asking (PR #96 review)', async ($, on) => {
    const ready44 = storedRun('ready', { id: '44-1', issue: 44, branch: 'issue-44-duet', repo: `${ROOT}/.git`, greenCommit: 'c2', gatedHead: 'c0' })
    const w = engine(on, { answer: START16, baseProfile: WORKTREE, spawnHold: held() }, { [key(44)]: ready44 })
    await start($)
    await run($, '16')
    await until(w, () => w.spawned.length === 1, "#16's red agent")
    await run($, 'status 44')
    const asked = w.asked.length
    w.answer = 'Publish'
    const ui = await pane($)
    await ui.press({ key: 'publish' })
    await waitFor(w, () => w.toasts.some(t => t.startsWith('this session is driving #16')))
    await ui.unmount()
    expect(w.asked.length).toBe(asked)
    expect(w.toasts.some(t => t.startsWith('this session is driving #16'))).toBe(true)
    expect(w.argv.some(a => a[1] === 'push')).toBe(false)
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
    expect(w.argv.filter(a => a[0] === 'gh' && !isStartRead(a))).toEqual([])
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
    expect(w.registered.map(r => r.argumentHint)).toEqual(['<issue number or URL> | status [N] | resume [N] | publish [N] | handoff [N] | stop [N] | demo'])
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

  // #119 gap 1: /clear, /resume and /branch reset every atom, and session.start doesn't run again. The pane's run comes back.
  describe('#119: the pane shows its run again after /clear', () => {
    const RUNS = () => ({ [key(44)]: blocked44({ repo: `${ROOT}/.git`, startedAt: 1 }), [key(52)]: blocked44({ id: '52-1', issue: 52, repo: `${ROOT}/.git`, startedAt: 2 }) })
    const watch = (on: any) => {
      const writes: { key: string; value: any }[] = []
      on('state.set', ($: any, e: any, next: any) => (writes.push({ key: e.key, value: e.value }), next(e)))
      on('classic.SessionStart', () => ({}))
      return writes
    }
    const pane = (writes: { key: string; value: any }[]) => writes.filter(w => w.key === 'focus' || w.key === 'run' || w.key === 'others' || w.key === 'activity')

    test('a classic.SessionStart after /clear writes the focused run back; one after compaction writes nothing', async ($, on) => {
      const writes = watch(on)
      const w = engine(on, {}, RUNS())
      await start($)
      expect((await run($, 'status 44')).text).toContain('blocked at gateG')
      writes.length = 0
      await $.classic.SessionStart({ source: 'compact' })
      await w.clock.settle()
      expect(writes.filter(w => w.key === 'focus' || w.key === 'run')).toEqual([])
      await $.classic.SessionStart({ source: 'clear' })
      await until(w, () => writes.some(x => x.key === 'others'), 'the also line written back')
      expect(writes.filter(w => w.key === 'focus').map(w => w.value)).toEqual([44])
      expect(writes.filter(w => w.key === 'run').map(w => w.value?.issue)).toContain(44)
      expect(writes.some(w => w.key === 'others')).toBe(true)
    })

    test('the also line written back names the other run and leaves out the shown one (Codex, PR #124)', async ($, on) => {
      const writes = watch(on)
      const w = engine(on, {}, RUNS())
      await start($)
      await run($, 'status 44')
      writes.length = 0
      await $.classic.SessionStart({ source: 'clear' })
      await until(w, () => writes.some(x => x.key === 'others'), 'the also line written back')
      const others = writes.filter(x => x.key === 'others').at(-1)!.value as { issue: number }[]
      expect(others.map(o => o.issue)).toEqual([52])
    })

    for (const source of ['resume', 'fork'] as const) {
      test(`after ${source === 'fork' ? '/branch (source fork)' : '/resume'} it writes the focus back too`, async ($, on) => {
        const writes = watch(on)
        const w = engine(on, {}, RUNS())
        await start($)
        await run($, 'status 44')
        writes.length = 0
        await $.classic.SessionStart({ source })
        await until(w, () => writes.some(x => x.key === 'focus'), `the focus written back after ${source}`)
        expect(writes.filter(x => x.key === 'focus').map(x => x.value)).toEqual([44])
      })
    }

    // Probed on 2.1.296 and 2.1.306: classic.SessionStart fires before session.start at startup (source startup) and at
    // claude --continue (source resume). There restore() seeds the pane, so the hook does nothing.
    test('at a resumed startup, before session.start, it does nothing: no git, no writes (PR #124 review)', async ($, on) => {
      const writes = watch(on)
      const w = engine(on, {}, RUNS())
      await $.classic.SessionStart({ source: 'resume' })
      await w.clock.settle()
      expect(pane(writes)).toEqual([])
      expect(w.argv.filter(a => a[0] === 'git')).toEqual([])
    })

    test('a run in progress gets its activity line back (PR #124 review)', async ($, on) => {
      const writes = watch(on)
      const w = engine(on, { baseProfile: WORKTREE, spawnHold: held() })
      await start($)
      await run($, '16')
      await until(w, () => w.spawned.length === 1, "#16's red agent")
      const shown = writes.filter(x => x.key === 'activity').at(-1)!.value
      expect(shown?.label).toBeDefined()
      writes.length = 0
      await $.classic.SessionStart({ source: 'clear' })
      await until(w, () => writes.some(x => x.key === 'activity'), 'the activity written back')
      expect(writes.filter(x => x.key === 'activity').at(-1)!.value).toEqual(shown)
    })
  })
})

// Issue #25: an issue URL, and each run pinned to one GitHub repository. The pinned repository is `Run.ghRepo`
// (`host/owner/repo`): `Run.repo` is git's common folder, which keys the store (Change 0.3.0).
describe('an issue URL, and a run pinned to one repository (#25)', () => {
  const URL16 = 'https://github.com/o/r/issues/16'
  const ISSUE_VIEW = ['gh', 'issue', 'view', '16', '--repo', 'github.com/o/r', '--json', 'number,title,body,state,url']
  const REPO_VIEW = ['gh', 'repo', 'view', '--json', 'nameWithOwner,url']
  const BUT = 'but gh sends issues and pull requests to o/r'
  const NEXT_CLONE = 'work from a clone whose origin is o/r, or whose origin is your fork of o/r with another remote for o/r'
  /** The store the mod writes to, readable here. */
  const watched = (): Record<string, unknown> => ({})
  const WATCH = { when: () => false, until: Promise.resolve() }
  const storedRuns = (store: Record<string, unknown>) => Object.keys(store).filter(k => k.includes('#16'))
  const argvText = (w: World) => w.argv.map(a => a.join(' '))
  const indexOfArgv = (w: World, text: string) => argvText(w).indexOf(text)
  /** Starts #16 and waits for the block (a run that passes preflight blocks right after the red spawn, under test). */
  async function blockedStatus($: any, w: World, args = '16'): Promise<string> {
    await run($, args)
    await until(w, () => w.toasts.some(t => t.includes('blocked')), 'the block')
    return (await run($, 'status')).text ?? ''
  }

  test('a pasted issue URL starts the run for its repository, and the issue is read from it', async ($, on) => {
    const store = watched()
    const w = engine(on, { storeHold: WATCH }, store)
    await start($)
    expect((await run($, URL16)).text).toBe('starting o/r#16; the pane shows progress. Nothing is pushed until you say yes.')
    await until(w, () => w.spawned.length === 1, 'red')
    expect(w.argv).toContainEqual(ISSUE_VIEW)
    expect(w.argv).toContainEqual(REPO_VIEW)
    expect(Object.keys(store).some(k => k.startsWith('issue-forge:repo-run:') && k.endsWith('#16'))).toBe(true)
    expect((await run($, 'status')).text).toStartWith('o/r#16 ')
  })

  test("a URL's case and a trailing fragment do not matter: the run is pinned to the name gh gives the checkout", async ($, on) => {
    const w = engine(on)
    await start($)
    expect((await run($, 'https://GitHub.com/O/R/issues/16#issuecomment-1')).text).toBe('starting o/r#16; the pane shows progress. Nothing is pushed until you say yes.')
    await until(w, () => w.spawned.length === 1, 'red')
    expect(w.argv).toContainEqual(ISSUE_VIEW)
  })

  test("a URL of another repository answers with both names and starts nothing: no issue read, nothing fetched or switched", async ($, on) => {
    const store = watched()
    const w = engine(on, { storeHold: WATCH }, store)
    await start($)
    expect((await run($, 'https://github.com/x/y/issues/16')).text).toBe("x/y#16 is in another repository: this checkout's GitHub repository is o/r. Start Claude Code in a clone of x/y.")
    await w.clock.settle()
    expect(storedRuns(store)).toEqual([])
    expect(w.argv).toContainEqual(REPO_VIEW)
    expect(w.argv.some(a => (a[0] === 'gh' && a[1] === 'issue') || (a[0] === 'git' && (a[1] === 'fetch' || a[1] === 'switch')))).toBe(false)
  })

  test("a URL of another repository's issue is refused though this checkout has a run with the same number (PR #68 review)", async ($, on) => {
    const blocked = storedRun('blocked', { ghRepo: 'github.com/o/r', blocked: { at: 'green', reason: 'r', next: 'n' }, used: { red: 1, green: 1, refactor: 0 } })
    engine(on, { head: BRANCH }, { [`issue-forge:run:${ROOT}`]: blocked })
    await start($)
    expect((await run($, 'https://github.com/x/y/issues/16')).text).toBe("x/y#16 is in another repository: this checkout's GitHub repository is o/r. Start Claude Code in a clone of x/y.")
  })

  test('a URL on another host is another repository, named with its host', async ($, on) => {
    const w = engine(on)
    await start($)
    expect((await run($, 'https://ghe.example.com/o/r/issues/16')).text).toBe("ghe.example.com/o/r#16 is in another repository: this checkout's GitHub repository is o/r. Start Claude Code in a clone of ghe.example.com/o/r.")
    expect(w.argv.some(a => a[0] === 'gh' && a[1] === 'issue')).toBe(false)
  })

  test('a URL start where gh cannot tell the repository says why, and starts nothing', async ($, on) => {
    const store = watched()
    const w = engine(on, { repoView: { exitCode: 1, stdout: '', stderr: 'no git remotes found\nsecond line' }, storeHold: WATCH }, store)
    await start($)
    expect((await run($, URL16)).text).toBe('could not tell which GitHub repository this checkout belongs to: no git remotes found')
    await w.clock.settle()
    expect(storedRuns(store)).toEqual([])
    expect(w.argv.some(a => a[0] === 'gh' && a[1] === 'issue')).toBe(false)
  })

  test("a URL start where gh repo view prints something else says it could not read the output, and starts nothing", async ($, on) => {
    const store = watched()
    const w = engine(on, { repoView: { exitCode: 0, stdout: 'not json' }, storeHold: WATCH }, store)
    await start($)
    expect((await run($, URL16)).text).toBe("could not read gh repo view's output")
    await w.clock.settle()
    expect(storedRuns(store)).toEqual([])
  })

  test("a pull request's URL is not an issue URL: the answer is unknown, with the new usage", async ($, on) => {
    const w = engine(on)
    await start($)
    expect((await run($, 'https://github.com/o/r/pull/16')).text).toBe(
      'unknown: https://github.com/o/r/pull/16. /issue-forge <issue number or URL> · status [N] · resume [N] · publish [N] · handoff [N] · stop [N] · demo',
    )
    expect(w.argv.some(a => a[0] === 'gh')).toBe(false)
  })

  test('preflight checks gh, then the repository, then origin (fetch, then push), then the issue, before any fetch or switch; the issue is read with --repo', async ($, on) => {
    const w = engine(on)
    await start($)
    expect((await run($, '16')).text).toBe('starting #16; the pane shows progress. Nothing is pushed until you say yes.')
    await until(w, () => w.spawned.length === 1, 'red')
    expect(w.argv).toContainEqual(ISSUE_VIEW)
    const order = ['gh auth status', 'gh repo view --json nameWithOwner,url', 'git remote get-url origin', 'git remote get-url --push --all origin', ISSUE_VIEW.join(' '), 'git fetch origin main'].map(t => indexOfArgv(w, t))
    expect(order.every(i => i >= 0)).toBe(true)
    expect([...order].sort((x, y) => x - y)).toEqual(order)
    const switched = w.argv.findIndex(a => a[0] === 'git' && a[1] === 'switch')
    expect(switched > (order[5] ?? 0)).toBe(true)
  })

  test('a number start where gh cannot tell the repository blocks at preflight with that reason, before anything is fetched or switched', async ($, on) => {
    const w = engine(on, { repoView: { exitCode: 1, stdout: '', stderr: 'no git remotes found' } })
    await start($)
    const status = await blockedStatus($, w)
    expect(status).toContain('blocked at preflight: could not tell which GitHub repository this checkout belongs to: no git remotes found')
    expect(status).toContain('next: give the checkout a GitHub remote named origin')
    expect(w.argv.some(a => a[0] === 'git' && (a[1] === 'fetch' || a[1] === 'switch'))).toBe(false)
    expect(w.argv.filter(a => a[0] === 'gh' && a[1] === 'issue' && !isStartRead(a))).toEqual([])
  })

  test("a number start where gh repo view prints something else blocks: could not read its output", async ($, on) => {
    const w = engine(on, { repoView: { exitCode: 0, stdout: 'not json' } })
    await start($)
    const status = await blockedStatus($, w)
    expect(status).toContain("blocked at preflight: could not read gh repo view's output")
    expect(status).toContain('next: check gh')
    expect(w.argv.some(a => a[0] === 'git' && (a[1] === 'fetch' || a[1] === 'switch'))).toBe(false)
  })

  test('a checkout with no origin remote blocks, naming the repository to add it for', async ($, on) => {
    const w = engine(on, { originUrl: { exitCode: 2, stderr: "error: No such remote 'origin'" } })
    await start($)
    const status = await blockedStatus($, w)
    expect(status).toContain('blocked at preflight: this checkout has no remote named origin')
    expect(status).toContain('next: add a remote named origin for o/r')
    expect(w.argv.some(a => a[0] === 'git' && (a[1] === 'fetch' || a[1] === 'switch'))).toBe(false)
  })

  test("an origin renamed since the clone was made is asked about by host/owner/repo, never by URL, and passes when gh gives the repository's name", async ($, on) => {
    const w = engine(on, { originUrl: 'https://github.com/old/r.git', canonical: { 'github.com/old/r': 'o/r' } })
    await start($)
    await run($, '16')
    await until(w, () => w.spawned.length === 1, 'red')
    expect(w.argv).toContainEqual(['gh', 'repo', 'view', 'github.com/old/r', '--json', 'nameWithOwner,url'])
    expect(w.argv.flat().some(x => x.includes('old/r.git'))).toBe(false)
  })

  test('an origin that is a fork blocks, and neither the block, the argv nor the pane carries the token in its URL', async ($, on) => {
    const w = engine(on, { originUrl: 'https://x-access-token:SECRET@github.com/fork/r.git', canonical: { 'github.com/fork/r': 'fork/r' } })
    await start($)
    const status = await blockedStatus($, w)
    expect(status).toContain(`blocked at preflight: origin fetches from fork/r, ${BUT}`)
    expect(status).toContain(`next: ${NEXT_CLONE}`)
    expect(w.argv).toContainEqual(['gh', 'repo', 'view', 'github.com/fork/r', '--json', 'nameWithOwner,url'])
    expect(w.argv.some(a => a[0] === 'git' && (a[1] === 'fetch' || a[1] === 'switch'))).toBe(false)
    const ui = await pane($)
    expect(await ui.find({ type: 'Text', text: /origin fetches from fork\/r/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /SECRET/ })).toBeUndefined()
    expect(JSON.stringify([w.argv, w.toasts, w.asked, status])).not.toContain('SECRET')
  })

  test('an origin that pushes somewhere else blocks, naming where', async ($, on) => {
    const w = engine(on, { originUrl: 'https://github.com/o/r.git', pushUrl: 'https://github.com/me/r.git' })
    await start($)
    const status = await blockedStatus($, w)
    expect(status).toContain(`blocked at preflight: origin pushes to me/r, ${BUT}`)
    expect(status).toContain(`next: ${NEXT_CLONE}`)
    expect(w.argv.some(a => a[0] === 'git' && (a[1] === 'fetch' || a[1] === 'switch'))).toBe(false)
  })

  test('an origin with several push URLs blocks when any of them is another repository, since git pushes to all of them (PR #68 review)', async ($, on) => {
    const w = engine(on, { pushUrl: ['https://github.com/o/r.git', 'git@github.com:me/other.git'] })
    await start($)
    const status = await blockedStatus($, w)
    expect(status).toContain(`blocked at preflight: origin pushes to me/other, ${BUT}`)
    expect(w.argv.some(a => a[0] === 'git' && (a[1] === 'fetch' || a[1] === 'switch'))).toBe(false)
  })

  test('a push URL that is the fetch URL is not checked twice: a renamed origin is asked of gh once (PR #68 review)', async ($, on) => {
    const w = engine(on, { originUrl: 'https://github.com/old/r.git', canonical: { 'github.com/old/r': 'o/r' } })
    await start($)
    await run($, '16')
    await until(w, () => w.spawned.length === 1, 'red')
    expect(w.argv.filter(a => a.join(' ') === 'gh repo view github.com/old/r --json nameWithOwner,url')).toHaveLength(1)
  })

  test('an origin URL it cannot read says which forms it reads, rather than to clone again (PR #68 review)', async ($, on) => {
    const w = engine(on, { originUrl: 'file:///srv/mirror/r.git' })
    await start($)
    const status = await blockedStatus($, w)
    expect(status).toContain(`blocked at preflight: origin fetches from an unrecognised URL, ${BUT}`)
    expect(status).toContain('next: give origin an https, http or ssh URL for o/r, then /issue-forge resume')
  })

  test('an origin URL gh cannot place is an unrecognised URL, and no gh repo view is run for it', async ($, on) => {
    const w = engine(on, { originUrl: 'git://example.org/x.git' })
    await start($)
    const status = await blockedStatus($, w)
    expect(status).toContain(`blocked at preflight: origin fetches from an unrecognised URL, ${BUT}`)
    expect(w.argv.filter(a => a[0] === 'gh' && a[1] === 'repo' && a[3] !== '--json')).toEqual([])
  })

  test('an scp-like origin for the same repository passes without asking gh about it', async ($, on) => {
    const w = engine(on, { originUrl: 'git@github.com:o/r.git' })
    await start($)
    await run($, '16')
    await until(w, () => w.spawned.length === 1, 'red')
    expect(w.argv).toContainEqual(['git', 'remote', 'get-url', 'origin'])
    expect(w.argv).toContainEqual(['git', 'remote', 'get-url', '--push', '--all', 'origin'])
    expect(w.argv.filter(a => a[0] === 'gh' && a[1] === 'repo' && a[3] !== '--json')).toEqual([])
  })

  test('an https origin on another host blocks though its owner and repository match, and gh is not asked about that host (PR #68 review)', async ($, on) => {
    const w = engine(on, { originUrl: 'https://ghe.example.com/o/r.git' })
    await start($)
    const status = await blockedStatus($, w)
    expect(status).toContain(`blocked at preflight: origin fetches from ghe.example.com/o/r, ${BUT}`)
    expect(w.argv.filter(a => a[0] === 'gh' && a[1] === 'repo' && a[3] !== '--json')).toEqual([])
    expect(w.argv.some(a => a[0] === 'git' && (a[1] === 'fetch' || a[1] === 'switch'))).toBe(false)
  })

  test('an ssh origin on another host, for another repository, blocks without asking gh about that host (PR #68 review)', async ($, on) => {
    const w = engine(on, { originUrl: 'git@some-host:x/y.git' })
    await start($)
    const status = await blockedStatus($, w)
    expect(status).toContain(`blocked at preflight: origin fetches from some-host/x/y, ${BUT}`)
    expect(w.argv.filter(a => a[0] === 'gh' && a[1] === 'repo' && a[3] !== '--json')).toEqual([])
  })

  test('an ssh:// origin through an alias of the host passes for the same owner and repository, as the scp-like form does', async ($, on) => {
    const w = engine(on, { originUrl: 'ssh://git@github-work/o/r.git' })
    await start($)
    await run($, '16')
    await until(w, () => w.spawned.length === 1, 'red')
    expect(w.argv.filter(a => a[0] === 'gh' && a[1] === 'repo' && a[3] !== '--json')).toEqual([])
  })

  test("the number of a pull request is refused as an issue", async ($, on) => {
    const w = engine(on, { issueUrl: 'https://github.com/o/r/pull/16' })
    await start($)
    const status = await blockedStatus($, w)
    expect(status).toContain('blocked at preflight: #16 is a pull request, not an issue')
    expect(status).toContain('next: pick another issue')
    expect(w.argv.some(a => a[0] === 'git' && (a[1] === 'fetch' || a[1] === 'switch'))).toBe(false)
  })

  test('a number start that blocks after origin passes is pinned to its repository, and resume keeps it (PR #68 review 2)', async ($, on) => {
    // An issue gh can't find blocks after origin passes and stays resumable (a pull request's block is final from 0.7.0).
    const w = engine(on, { issueFails: 'GraphQL: Could not resolve to an issue' })
    await start($)
    const status = await blockedStatus($, w)
    expect(status).toStartWith('o/r#16\n')
    expect((await run($, 'resume')).text).toBe('resuming #16 at preflight.')
    await until(w, () => w.toasts.filter(t => t.includes('blocked')).length >= 2, 'the second block')
    // The repository is not asked again: a remote changed meanwhile can't move the run to another repository's #16.
    expect(w.argv.filter(a => a.join(' ') === REPO_VIEW.join(' '))).toHaveLength(1)
    expect(w.argv.filter(a => a[0] === 'gh' && a[1] === 'issue' && !isStartRead(a))).toEqual([ISSUE_VIEW, ISSUE_VIEW])
  })

  test('a number start that origin blocks stays unpinned, so fixing the remotes or gh repo set-default and resuming recovers it', async ($, on) => {
    const w = engine(on, { originUrl: 'https://github.com/fork/r.git', canonical: { 'github.com/fork/r': 'fork/r' } })
    await start($)
    const status = await blockedStatus($, w)
    expect(status).toStartWith('#16\n')
  })

  test('an issue gh cannot find says to check the number or URL', async ($, on) => {
    const w = engine(on, { issueFails: 'GraphQL: Could not resolve to an issue or pull request with the number of 16.' })
    await start($)
    const status = await blockedStatus($, w)
    expect(status).toContain('blocked at preflight: issue #16 not found: GraphQL: Could not resolve to an issue or pull request with the number of 16.')
    expect(status).toContain('next: check the issue number or URL')
  })

  test('publish checks origin (push URL) before it pushes, and opens the pull request on the run\'s repository', async ($, on) => {
    const w = engine(on, { head: BRANCH }, { [`issue-forge:run:${ROOT}`]: storedRun('ready', { ghRepo: 'github.com/o/r', greenCommit: 'c2', gatedHead: 'c0' }) })
    await start($)
    expect((await run($, 'publish')).text).toBe(`publishing #16: pushing ${BRANCH} and opening a pull request against main.`)
    await until(w, () => w.toasts.some(t => t.startsWith('PR opened')), 'the PR')
    const pushUrl = indexOfArgv(w, 'git remote get-url --push --all origin')
    const push = w.argv.findIndex(a => a[0] === 'git' && a[1] === 'push')
    expect(pushUrl >= 0 && pushUrl < push).toBe(true)
    expect(w.argv).toContainEqual(['git', 'push', 'origin', `c0:refs/heads/${BRANCH}`])
    const pr = w.argv.find(a => a[0] === 'gh' && a[1] === 'pr')!
    expect(pr.slice(0, 7)).toEqual(['gh', 'pr', 'create', '--base', 'main', '--head', BRANCH])
    expect(pr.slice(-4)).toEqual(['--body-file', '/home/u/.claude/issue-forge-data/16-1/pr.md', '--repo', 'github.com/o/r'])
    expect(w.files['/home/u/.claude/issue-forge-data/16-1/pr.md']).toContain('Closes #16')
  })

  test('publish blocks when origin is no longer the run\'s repository: nothing is pushed, no pull request is opened', async ($, on) => {
    const w = engine(on, { head: BRANCH, originUrl: 'https://github.com/fork/r.git' }, { [`issue-forge:run:${ROOT}`]: storedRun('ready', { ghRepo: 'github.com/o/r', greenCommit: 'c2', gatedHead: 'c0' }) })
    await start($)
    await run($, 'publish')
    await until(w, () => w.toasts.some(t => t.includes('blocked') || t.startsWith('PR opened')), 'the block')
    expect((await run($, 'status')).text).toContain(`blocked at publishing: origin fetches from fork/r, ${BUT}`)
    expect(w.argv.some(a => (a[0] === 'git' && a[1] === 'push') || (a[0] === 'gh' && a[1] === 'pr'))).toBe(false)
  })

  // With extensions.worktreeConfig, a linked worktree's config.worktree can give origin another pushurl than the
  // checkout's (probed, git 2.53): origin is checked in the folder git fetches and pushes from.
  test('publish of a worktree run checks origin in the worktree that pushes (PR #68 review 2)', async ($, on) => {
    const WT = `${ROOT}/scratch/issue-forge/${BRANCH}`
    const w = engine(on, { head: BRANCH, worktrees: [WT], wtHead: BRANCH }, { [`issue-forge:run:${ROOT}`]: storedRun('ready', { ghRepo: 'github.com/o/r', greenCommit: 'c2', gatedHead: 'c0', workRoot: WT }) })
    await start($)
    await run($, 'publish')
    await until(w, () => w.toasts.some(t => t.startsWith('PR opened')), 'the PR')
    expect(w.calls.filter(c => c.argv.join(' ') === 'git remote get-url --push --all origin').map(c => c.cwd)).toEqual([WT])
  })

  test('resume of a worktree run at preflight checks origin in its kept worktree too, before it fetches there (PR #68 review 2)', async ($, on) => {
    const WT = `${ROOT}/scratch/issue-forge/${BRANCH}`
    const atPreflight = storedRun('blocked', { ghRepo: 'github.com/o/r', blocked: { at: 'preflight', reason: 'r', next: 'n' }, workRoot: WT, redCommit: undefined, used: { red: 0, green: 0, refactor: 0 }, agents: [] })
    const w = engine(on, { baseProfile: { ...PROFILE, workspace: 'worktree' }, worktrees: [WT], wtHead: BRANCH }, { [`issue-forge:run:${ROOT}`]: atPreflight })
    await start($)
    expect((await run($, 'resume')).text).toBe('resuming #16 at preflight.')
    await until(w, () => w.spawned.length === 1 || w.toasts.some(t => t.includes('blocked')), 'red or a block')
    const pushUrlCwds = w.calls.filter(c => c.argv.join(' ') === 'git remote get-url --push --all origin').map(c => c.cwd)
    expect(pushUrlCwds).toEqual([ROOT, WT])
    const checked = w.calls.findIndex(c => c.cwd === WT && c.argv.join(' ') === 'git remote get-url --push --all origin')
    const fetched = w.calls.findIndex(c => c.cwd === WT && c.argv[1] === 'fetch')
    expect(checked >= 0 && checked < fetched).toBe(true)
  })

  test('publish blocks when origin now pushes elsewhere, though it still fetches from the run\'s repository', async ($, on) => {
    const w = engine(on, { head: BRANCH, pushUrl: 'https://github.com/me/r.git' }, { [`issue-forge:run:${ROOT}`]: storedRun('ready', { ghRepo: 'github.com/o/r', greenCommit: 'c2', gatedHead: 'c0' }) })
    await start($)
    await run($, 'publish')
    await until(w, () => w.toasts.some(t => t.includes('blocked') || t.startsWith('PR opened')), 'the block')
    expect((await run($, 'status')).text).toContain(`blocked at publishing: origin pushes to me/r, ${BUT}`)
    expect(w.argv.some(a => (a[0] === 'git' && a[1] === 'push') || (a[0] === 'gh' && a[1] === 'pr'))).toBe(false)
  })

  test('the pane names the repository in its masthead and in the publish line of a ready run', async ($, on) => {
    engine(on, {}, { [`issue-forge:run:${ROOT}`]: storedRun('ready', { ghRepo: 'github.com/o/r', greenCommit: 'c2', gatedHead: 'c0' }) })
    await start($)
    await run($, 'status')
    const ui = await pane($)
    expect(await ui.find({ type: 'Text', text: /^o\/r#16 Fix the thing$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Push issue-16-fix-the-thing and open a pull request on o\/r against main\?$/ })).toBeDefined()
    // The branch line stays as it was.
    expect(await ui.find({ type: 'Text', text: /^branch {5}issue-16-fix-the-thing → main$/ })).toBeDefined()
  })

  test('a run driven to gate F asks to publish on its repository', async ($, on) => {
    const w = engine(on, { head: BRANCH, hasChanges: false, staged: ['tests/a.test.ts', 'src/a.ts'], sinceRed: ['src/a.ts'], redPaths: ['tests/a.test.ts'] }, { [`issue-forge:run:${ROOT}`]: storedRun('gateF', { ghRepo: 'github.com/o/r', greenCommit: 'c2', used: { red: 1, green: 1, refactor: 1 } }) })
    await start($)
    await run($, 'resume')
    await until(w, () => w.asked.length === 1, 'the question')
    expect(w.asked[0]).toBe(`Push ${BRANCH} and open a pull request on o/r against main?`)
  })

  test('a GitHub Enterprise run is named with its host in the masthead', async ($, on) => {
    engine(on, {}, { [`issue-forge:run:${ROOT}`]: storedRun('ready', { ghRepo: 'ghe.example.com/o/r', greenCommit: 'c2', gatedHead: 'c0' }) })
    await start($)
    await run($, 'status')
    const ui = await pane($)
    expect(await ui.find({ type: 'Text', text: /^ghe\.example\.com\/o\/r#16 Fix the thing$/ })).toBeDefined()
  })

  test("resume reads the issue of a run with a branch from the repository it is pinned to", async ($, on) => {
    const blocked = storedRun('blocked', { ghRepo: 'github.com/o/r', blocked: { at: 'green', reason: 'r', next: 'n' }, used: { red: 1, green: 1, refactor: 0 } })
    const w = engine(on, { head: BRANCH }, { [`issue-forge:run:${ROOT}`]: blocked })
    await start($)
    expect((await run($, 'resume')).text).toBe('resuming #16 at green.')
    await until(w, () => w.spawned.length === 1, 'green')
    expect(w.argv).toContainEqual(ISSUE_VIEW)
  })

  test('resume of a pinned run whose issue is now a pull request stays blocked, and starts no agent', async ($, on) => {
    const blocked = storedRun('blocked', { ghRepo: 'github.com/o/r', blocked: { at: 'green', reason: 'r', next: 'n' }, used: { red: 1, green: 1, refactor: 0 } })
    const w = engine(on, { head: BRANCH, issueUrl: 'https://github.com/o/r/pull/16' }, { [`issue-forge:run:${ROOT}`]: blocked })
    await start($)
    expect((await run($, 'resume')).text).toBe('still blocked: #16 is a pull request, not an issue.')
    expect(w.spawned).toEqual([])
  })

  test('resume of a run that blocked at preflight after making its branch reads the issue only with --repo (PR #68 review)', async ($, on) => {
    // A number start that made its branch, then found no profile on origin/main: the block keeps the branch, and no repository is pinned yet.
    const kept = storedRun('blocked', {
      blocked: { at: 'preflight', reason: 'origin/main has no valid .issue-forge.json: missing', next: 'commit .issue-forge.json to main' },
      mergeBase: '', profile: null, used: { red: 0, green: 0, refactor: 0 }, redCommit: undefined, baseline: null,
    })
    const w = engine(on, { head: BRANCH }, { [`issue-forge:run:${ROOT}`]: kept })
    await start($)
    expect((await run($, 'resume')).text).toBe('resuming #16 at preflight.')
    await until(w, () => w.spawned.length === 1, 'red')
    const issueViews = w.argv.filter(a => a[0] === 'gh' && a[1] === 'issue')
    expect(issueViews.length).toBeGreaterThan(0)
    expect(issueViews.filter(a => !a.includes('--repo'))).toEqual([])
  })

  test("resume of a run stored by 0.1.0 at preflight (no branch, no repository) runs the whole new preflight and pins it", async ($, on) => {
    const early = storedRun('blocked', {
      blocked: { at: 'preflight', reason: 'gh is not signed in', next: 'run gh auth login' },
      title: '', body: '', url: '', branch: '', base: '', mergeBase: '', profile: null,
      used: { red: 0, green: 0, refactor: 0 }, redCommit: undefined, baseline: null, times: {}, agents: [],
    })
    const w = engine(on, {}, { [`issue-forge:run:${ROOT}`]: early })
    await start($)
    expect((await run($, 'resume')).text).toBe('resuming #16 at preflight.')
    await until(w, () => w.spawned.length === 1, 'red')
    expect(w.argv).toContainEqual(REPO_VIEW)
    expect(w.argv).toContainEqual(ISSUE_VIEW)
    expect((await run($, 'status')).text).toStartWith('o/r#16 ')
  })

  test('the demo run is named with its repository in the masthead', async ($, on) => {
    const w = engine(on)
    await start($)
    await run($, 'demo ready')
    await w.clock.settle()
    const ui = await pane($)
    expect(await ui.find({ type: 'Text', text: /^bankielewicz\/mod-builder#16 Mod Lab/ })).toBeDefined()
  })

  test('the stopped pane says an issue number or URL starts another run', async ($, on) => {
    engine(on, {}, { [`issue-forge:run:${ROOT}`]: storedRun('stopped') })
    await start($)
    await run($, 'status')
    const ui = await pane($)
    expect(await ui.find({ type: 'Text', text: /^\/issue-forge <issue number or URL> starts another\.$/ })).toBeDefined()
  })
})

describe('a pane behind another tab is brought to the front, not closed (#31)', () => {
  const SHOW = 'bringing the pane to the front; it takes the keyboard if your prompt is empty (Esc gives it back).'
  const STILL_BEHIND = 'Issue Forge is still behind another tab: ctrl+x tab, then again until it shows.'
  const HIDDEN = [{ id: 'issue-forge', isShown: false }]
  /** Open but waiting undrawn: an unasked open on a narrow terminal, or any open with no surface to draw it (d.ts `UiPane.isPlaced`). */
  const WAITING = [{ id: 'issue-forge', isShown: false, isPlaced: false }]
  // The read after the open may come at once or after 500 ms (the probe of #31 decides), so each test lets 1 s pass.
  const SETTLED_MS = 1000
  const BEHIND = '(ctrl+x tab, then again until it shows)'

  test('a bare /issue-forge answers at once, opens the hidden pane with the keyboard, and closes nothing', async ($, on) => {
    const w = engine(on, { panes: HIDDEN })
    await start($)
    expect((await run($, '')).text).toBe(SHOW)
    await w.clock.advance(SETTLED_MS)
    expect(w.closed).toEqual([])
    expect(w.opens.at(-1)).toMatchObject({ id: 'issue-forge', title: 'Issue Forge', columns: 76, focus: true })
  })

  test('a bare /issue-forge by pane state: not listed opens without the keyboard, shown closes, hidden is brought to the front', async ($, on) => {
    const w = engine(on)
    await start($)
    expect((await run($, '')).text).toMatch(/^opened\. /)
    await w.clock.advance(10)
    expect(w.opens.map(open => open.focus)).toEqual([undefined])
    w.opens.length = 0
    w.panes = [{ id: 'issue-forge', isShown: true }]
    expect((await run($, '')).text).toBe('closed. /issue-forge to reopen.')
    await w.clock.advance(10)
    expect(w.closed).toEqual(['issue-forge'])
    expect(w.opens).toEqual([])
    w.closed.length = 0
    w.panes = HIDDEN
    expect((await run($, '')).text).toBe(SHOW)
    await w.clock.advance(SETTLED_MS)
    expect(w.closed).toEqual([])
    expect(w.opens.at(-1)).toMatchObject({ id: 'issue-forge', focus: true })
  })

  test('a pane still behind another tab after the open is named in a toast', async ($, on) => {
    const w = engine(on, { panes: HIDDEN })
    await start($)
    await run($, '')
    await w.clock.advance(SETTLED_MS)
    expect(w.opens.at(-1)).toMatchObject({ id: 'issue-forge', focus: true })
    expect(w.toasts).toContain(STILL_BEHIND)
  })

  test('a pane that came forward after the open gets no toast', async ($, on) => {
    const w = engine(on, { panes: HIDDEN, showOnOpen: true })
    await start($)
    expect((await run($, '')).text).toBe(SHOW)
    await w.clock.advance(SETTLED_MS)
    expect(w.opens.at(-1)).toMatchObject({ id: 'issue-forge', focus: true })
    expect(w.toasts).not.toContain(STILL_BEHIND)
  })

  test('/issue-forge demo with the pane hidden keeps its answer and brings the pane forward with the keyboard; with none listed it opens plain', async ($, on) => {
    const w = engine(on, { panes: HIDDEN })
    await start($)
    expect((await run($, 'demo')).text).toContain('demo in the pane: [ Next state ] steps through')
    await w.clock.advance(SETTLED_MS)
    expect(w.opens.at(-1)).toMatchObject({ id: 'issue-forge', title: 'Issue Forge', columns: 76, focus: true })
    expect(w.closed).toEqual([])
    expect(w.toasts).toContain(STILL_BEHIND)
    w.opens.length = 0
    w.panes = []
    await run($, 'demo')
    await w.clock.advance(SETTLED_MS)
    expect(w.opens.map(open => open.focus)).toEqual([undefined])
  })

  test('/issue-forge demo asks for the pane before its hook returns, ahead of the demo state it writes (PR #96 review, Codex 4290452262)', async ($, on) => {
    const w = engine(on, { panes: HIDDEN })
    // Once set, every state write waits: an open that comes after the demo's writes has not gone out.
    let writes: Promise<void> | null = null
    let release: () => void = () => undefined
    on('state.set', ($: any, e: any, next: any) => (writes ? writes.then(() => next(e)) : next(e)))
    await start($)
    writes = new Promise<void>(resolve => (release = resolve))
    expect((await run($, 'demo')).text).toContain('demo in the pane')
    expect(w.opens.length).toBe(1)
    expect(w.opens[0]).toMatchObject({ id: 'issue-forge', focus: true })
    release()
    await w.clock.advance(SETTLED_MS)
    expect(w.opens.length).toBe(1)
  })

  test('/issue-forge demo with the pane hidden gets no toast once the pane came forward', async ($, on) => {
    const w = engine(on, { panes: HIDDEN, showOnOpen: true })
    await start($)
    await run($, 'demo')
    await w.clock.advance(SETTLED_MS)
    expect(w.opens.at(-1)).toMatchObject({ id: 'issue-forge', focus: true })
    expect(w.toasts).not.toContain(STILL_BEHIND)
  })

  test('a start with its pane behind another tab says so, and opens it without the keyboard', async ($, on) => {
    const w = engine(on, { isDirty: true, baseProfile: { ...PROFILE, workspace: 'here' }, panes: HIDDEN })
    await start($)
    expect((await run($, '16')).text).toBe(`starting #16; its pane is behind another tab ${BEHIND}. Nothing is pushed until you say yes.`)
    await until(w, () => w.opens.length > 0, 'the open')
    await until(w, () => w.toasts.some(t => t.includes('blocked')), 'the block')
    expect(w.opens.every(open => !open.focus)).toBe(true)
    expect(w.closed).toEqual([])
  })

  test('a resume with its pane behind another tab says so, and opens it without the keyboard', async ($, on) => {
    const blocked = storedRun('blocked', { blocked: { at: 'green', reason: 'gate G failed after 3 attempts: tests fail (exit 1)', next: 'fix it by hand on the branch' }, used: { red: 1, green: 3, refactor: 0 } })
    const w = engine(on, { head: BRANCH, panes: HIDDEN }, { [`issue-forge:run:${ROOT}`]: blocked })
    await start($)
    expect((await run($, 'resume')).text).toBe(`resuming #16 at green; its pane is behind another tab ${BEHIND}.`)
    await until(w, () => w.spawned.length === 1, 'green')
    expect(w.opens.length).toBeGreaterThan(0)
    expect(w.opens.every(open => !open.focus)).toBe(true)
  })

  test('a pane waiting undrawn is no tab behind another: a bare /issue-forge opens it as before, with the narrow-window toast and no "behind" one (PR #96 review, Codex P2)', async ($, on) => {
    const w = engine(on, { panes: WAITING, isPlaced: false })
    await start($)
    expect((await run($, '')).text).toMatch(/^opened\. /)
    await w.clock.advance(SETTLED_MS)
    expect(w.opens.map(open => open.focus)).toEqual([undefined])
    expect(w.closed).toEqual([])
    expect(w.toasts).toContain('Issue Forge needs a wider window. Widen it to see the pane, or watch the status line.')
    expect(w.toasts).not.toContain(STILL_BEHIND)
  })

  test('/issue-forge demo with its pane waiting undrawn opens it without the keyboard or a "behind" toast (PR #96 review, Codex P2)', async ($, on) => {
    const w = engine(on, { panes: WAITING })
    await start($)
    await run($, 'demo')
    await w.clock.advance(SETTLED_MS)
    expect(w.opens.map(open => open.focus)).toEqual([undefined])
    expect(w.toasts).not.toContain(STILL_BEHIND)
  })

  test('a start with its pane waiting undrawn gives the usual answer, not "behind another tab" (PR #96 review)', async ($, on) => {
    const w = engine(on, { isDirty: true, baseProfile: { ...PROFILE, workspace: 'here' }, panes: WAITING })
    await start($)
    expect((await run($, '16')).text).toBe('starting #16; the pane shows progress. Nothing is pushed until you say yes.')
    await until(w, () => w.toasts.some(t => t.includes('blocked')), 'the block')
  })

  test('a resume with its pane waiting undrawn gives the usual answer, not "behind another tab" (PR #96 review)', async ($, on) => {
    const blocked = storedRun('blocked', { blocked: { at: 'green', reason: 'gate G failed after 3 attempts: tests fail (exit 1)', next: 'fix it by hand on the branch' }, used: { red: 1, green: 3, refactor: 0 } })
    const w = engine(on, { head: BRANCH, panes: WAITING }, { [`issue-forge:run:${ROOT}`]: blocked })
    await start($)
    expect((await run($, 'resume')).text).toBe('resuming #16 at green.')
    await until(w, () => w.spawned.length === 1, 'green')
  })

  test('the pane hint holds for any tab', async ($, on) => {
    engine(on)
    await start($)
    const ui = await pane($)
    expect(await ui.find({ type: 'Text', text: /^ctrl\+x tab: keys, again: next tab$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /focuses the pane/ })).toBeUndefined()
    await ui.unmount()
  })

  test('the hint stays last in the list, so a narrow pane cuts the action keys last', async ($, on) => {
    engine(on, {}, { [`issue-forge:run:${ROOT}`]: storedRun('blocked', { blocked: { at: 'green', reason: 'r', next: 'n' }, used: { red: 1, green: 3, refactor: 0 } }) })
    await start($)
    const ui = await pane($)
    expect(await ui.find({ type: 'Text', text: /^r resume · s stop · t status · ctrl\+x tab: keys, again: next tab$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /focuses the pane/ })).toBeUndefined()
    await ui.unmount()
  })
})

describe('a pane press that changes a live run asks first (#31)', () => {
  const STOP_ASK = 'Stop run #16? Its branch and commits are kept.'
  const PUBLISH_ASK = `Push ${BRANCH} and open a pull request against main?`
  const blockedRun = () => storedRun('blocked', { blocked: { at: 'green', reason: 'gate G failed after 3 attempts: tests fail (exit 1)', next: 'fix it by hand on the branch' }, used: { red: 1, green: 3, refactor: 0 } })
  const asked = (w: World, count: number) => waitFor(w, () => w.asked.length >= count)

  test('Stop asks: Keep it running leaves the run, Stop the run stops it; the demo\'s Stop ends the demo without asking', async ($, on) => {
    const w = engine(on, { head: BRANCH, answer: 'Keep it running' }, { [`issue-forge:run:${ROOT}`]: blockedRun() })
    await start($)
    await run($, 'status')
    await run($, 'demo ready')
    await w.clock.settle()
    let ui = await pane($)
    await ui.press({ key: 'stop' })
    await w.clock.settle()
    await ui.unmount()
    expect(w.asked).toEqual([])
    ui = await pane($)
    expect(await ui.find({ type: 'Text', text: /demo ·/ })).toBeUndefined()
    await ui.unmount()

    ui = await pane($)
    await ui.press({ key: 'stop' })
    await asked(w, 1)
    await w.clock.settle()
    await ui.unmount()
    expect(w.asked).toEqual([STOP_ASK])
    expect([...(w.choices[0] ?? [])].sort()).toEqual(['Keep it running', 'Stop the run'])
    expect(w.toasts.some(t => t.startsWith('stopped #16'))).toBe(false)
    expect((await run($, 'status')).text).not.toContain('stopped')

    w.answer = 'Stop the run'
    ui = await pane($)
    await ui.press({ key: 'stop' })
    await waitFor(w, () => w.toasts.some(t => t.startsWith('stopped #16')))
    await ui.unmount()
    expect(w.asked).toEqual([STOP_ASK, STOP_ASK])
    expect(w.toasts.some(t => t.startsWith('stopped #16'))).toBe(true)
    expect((await run($, 'status')).text).toContain('stopped; the branch and its commits are kept')
  })

  test('Stop with nobody to answer leaves the run as it is', async ($, on) => {
    const w = engine(on, { head: BRANCH, answer: null }, { [`issue-forge:run:${ROOT}`]: blockedRun() })
    await start($)
    await run($, 'status')
    const ui = await pane($)
    await ui.press({ key: 'stop' })
    await asked(w, 1)
    await w.clock.settle()
    await ui.unmount()
    expect(w.asked).toEqual([STOP_ASK])
    expect(w.toasts.some(t => t.startsWith('stopped #16'))).toBe(false)
    expect((await run($, 'status')).text).not.toContain('stopped')
  })

  test('Publish asks whatever confirmPublish says: Not now pushes nothing, Publish pushes', { options: { confirmPublish: false } }, async ($, on) => {
    const w = engine(on, { head: BRANCH, answer: 'Not now' }, { [`issue-forge:run:${ROOT}`]: storedRun('ready', { greenCommit: 'c2', gatedHead: 'c0' }) })
    await start($)
    await run($, 'status')
    let ui = await pane($)
    await ui.press({ key: 'publish' })
    await asked(w, 1)
    await w.clock.settle()
    await ui.unmount()
    expect(w.asked).toEqual([PUBLISH_ASK])
    expect([...(w.choices[0] ?? [])].sort()).toEqual(['Not now', 'Publish'])
    expect(w.argv.some(a => a[1] === 'push' || a[1] === 'pr')).toBe(false)

    w.answer = 'Publish'
    ui = await pane($)
    await ui.press({ key: 'publish' })
    await waitFor(w, () => w.toasts.some(t => t.startsWith('PR opened')))
    await ui.unmount()
    expect(w.asked).toEqual([PUBLISH_ASK, PUBLISH_ASK])
    expect(w.argv).toContainEqual(['git', 'push', 'origin', `c0:refs/heads/${BRANCH}`])
  })

  test('a Stop press answered no, or with nobody to answer, says the run was left and how to stop it (PR #96 review)', async ($, on) => {
    const kept = 'left #16 as it is; /issue-forge stop 16 stops it.'
    const w = engine(on, { head: BRANCH, answer: 'Keep it running' }, { [`issue-forge:run:${ROOT}`]: blockedRun() })
    await start($)
    await run($, 'status')
    let ui = await pane($)
    await ui.press({ key: 'stop' })
    await waitFor(w, () => w.toasts.includes(kept))
    await ui.unmount()
    expect(w.toasts).toContain(kept)
    w.answer = null
    ui = await pane($)
    await ui.press({ key: 'stop' })
    await waitFor(w, () => w.toasts.filter(t => t === kept).length === 2)
    await ui.unmount()
    expect(w.toasts.filter(t => t === kept).length).toBe(2)
    expect((await run($, 'status')).text).not.toContain('stopped')
  })

  test('a Publish press answered Not now says the run was left unpublished and how to publish it (PR #96 review)', { options: { confirmPublish: false } }, async ($, on) => {
    const kept = 'left #16 unpublished; /issue-forge publish 16 publishes it.'
    const w = engine(on, { head: BRANCH, answer: 'Not now' }, { [`issue-forge:run:${ROOT}`]: storedRun('ready', { greenCommit: 'c2', gatedHead: 'c0' }) })
    await start($)
    await run($, 'status')
    const ui = await pane($)
    await ui.press({ key: 'publish' })
    await waitFor(w, () => w.toasts.includes(kept))
    await ui.unmount()
    expect(w.toasts).toContain(kept)
    expect(w.argv.some(a => a[1] === 'push' || a[1] === 'pr')).toBe(false)
  })

  test("a Publish press while the drive's own publish question is open asks nothing more: one question, one push, one PR (PR #96 review)", async ($, on) => {
    let release: (label: string) => void = () => undefined
    const hold = new Promise<string>(resolve => (release = resolve))
    const w = engine(on, { head: BRANCH, hold }, { [`issue-forge:run:${ROOT}`]: storedRun('ready', { greenCommit: 'c2', gatedHead: 'c0' }) })
    await start($)
    await run($, 'resume')
    await until(w, () => w.asked.length === 1, 'the question')
    const ui = await pane($)
    await ui.press({ key: 'publish' })
    await waitFor(w, () => w.toasts.some(t => t.startsWith('PR opened')))
    await ui.unmount()
    expect(w.asked.length).toBe(1)
    expect(w.toasts.some(t => t.startsWith('PR opened'))).toBe(true)
    release('Publish')
    await w.clock.settle()
    await w.clock.advance(50)
    expect(w.argv.filter(a => a[0] === 'gh' && a[1] === 'pr').length).toBe(1)
    expect(w.argv.filter(a => a[0] === 'git' && a[1] === 'push').length).toBe(1)
  })

  test("a Stop press while the drive's own publish question is open asks nothing more and says to answer it first (PR #96, Codex 4290573669)", async ($, on) => {
    let release: (label: string) => void = () => undefined
    const hold = new Promise<string>(resolve => (release = resolve))
    const w = engine(on, { head: BRANCH, hold }, { [`issue-forge:run:${ROOT}`]: storedRun('ready', { greenCommit: 'c2', gatedHead: 'c0' }) })
    await start($)
    await run($, 'resume')
    await until(w, () => w.asked.length === 1, 'the question')
    const ui = await pane($)
    await ui.press({ key: 'stop' })
    await waitFor(w, () => w.toasts.some(t => t.includes('publish question is open')))
    await ui.unmount()
    expect(w.asked.length).toBe(1)
    expect(w.toasts).toContain("#16's publish question is open; answer it first, then press Stop.")
    release('Not now')
    await w.clock.settle()
    await w.clock.advance(50)
    expect((await run($, 'status')).text).not.toContain('stopped')
    expect(w.argv.some(a => a[1] === 'push')).toBe(false)
  })

  test('a Stop press on a run that finished after the pane drew asks nothing and says there is nothing to stop (PR #96 review, Codex 4290452256)', async ($, on) => {
    const store: Record<string, unknown> = { [key(16)]: { ...blockedRun(), repo: `${ROOT}/.git` } }
    // storeHold makes the stubs read and write `store` itself, so the test can change a run as another session would.
    const w = engine(on, { head: BRANCH, answer: 'Stop the run', storeHold: { when: () => false, until: Promise.resolve() } }, store)
    await start($)
    await run($, 'status')
    const ui = await pane($)
    // The pane drew Stop for the blocked run; another session stopped it since.
    store[key(16)] = { ...(store[key(16)] as any), step: 'stopped' }
    await ui.press({ key: 'stop' })
    await waitFor(w, () => w.toasts.includes('no active run here.'))
    await ui.unmount()
    expect(w.asked).toEqual([])
    expect(w.toasts).toContain('no active run here.')
  })

  test('a Stop press whose run was replaced while its question was open stops nothing and says so (PR #96 review, Codex 4290452260)', async ($, on) => {
    let release: (label: string) => void = () => undefined
    const hold = new Promise<string>(resolve => (release = resolve))
    const store: Record<string, unknown> = { [key(16)]: { ...blockedRun(), repo: `${ROOT}/.git` } }
    const w = engine(on, { head: BRANCH, hold, storeHold: { when: () => false, until: Promise.resolve() } }, store)
    await start($)
    await run($, 'status')
    const ui = await pane($)
    await ui.press({ key: 'stop' })
    await until(w, () => w.asked.length === 1, 'the question')
    // Another session stopped #16 and started it again: a new run under the same key.
    store[key(16)] = { ...(store[key(16)] as any), id: '16-2' }
    release('Stop the run')
    await waitFor(w, () => w.toasts.some(t => t.includes('#16')))
    await ui.unmount()
    expect((store[key(16)] as any).id).toBe('16-2')
    expect((store[key(16)] as any).step).toBe('blocked')
    expect(w.toasts.some(t => t.startsWith('stopped #16'))).toBe(false)
    expect(w.toasts).toContain('#16 moved on before it could be stopped; /issue-forge status 16 says where.')
  })

  test('Publish with nobody to answer pushes nothing', { options: { confirmPublish: false } }, async ($, on) => {
    const w = engine(on, { head: BRANCH, answer: null }, { [`issue-forge:run:${ROOT}`]: storedRun('ready', { greenCommit: 'c2', gatedHead: 'c0' }) })
    await start($)
    await run($, 'status')
    const ui = await pane($)
    await ui.press({ key: 'publish' })
    await asked(w, 1)
    await w.clock.settle()
    await ui.unmount()
    expect(w.asked).toEqual([PUBLISH_ASK])
    expect(w.argv.some(a => a[1] === 'push' || a[1] === 'pr')).toBe(false)
  })
})

// Issue #26: a fork clone. Origin is the contributor's fork (me/r) and another remote is the project (o/r), which is
// what gh resolves; the base is fetched from that remote, the branch is pushed to origin, and the pull request names
// the fork's owner as its head. The pinned repository is `Run.ghRepo` (as in #25), the new fields `baseRemote` and
// `headRepo` (`host/owner/repo` of origin).
describe('a fork clone: origin is the contributor\'s fork and the project is another remote (#26)', () => {
  const WT = `${ROOT}/scratch/issue-forge/${BRANCH}`
  const FORK = { originUrl: 'https://github.com/me/r.git', remotes: { upstream: 'https://github.com/o/r.git' } }
  const WATCH = { when: () => false, until: Promise.resolve() }
  const FORK_VIEW = ['gh', 'repo', 'view', 'github.com/me/r', '--json', 'isFork,parent']
  /** The project remote, pointed elsewhere after preflight read it (Codex on PR #87). */
  const MOVED = { upstream: 'https://github.com/evil/r.git' }
  const forkRun = (extra: Record<string, unknown> = {}) => storedRun('ready', { ghRepo: 'github.com/o/r', baseRemote: 'upstream', headRepo: 'github.com/me/r', greenCommit: 'c2', gatedHead: 'c0', ...extra })
  const isGitWrite = (a: string[]) => a[0] === 'git' && (a[1] === 'fetch' || a[1] === 'switch' || a[1] === 'worktree')
  const isPublished = (w: World) => w.argv.some(a => (a[0] === 'git' && a[1] === 'push') || (a[0] === 'gh' && a[1] === 'pr'))
  /** Starts #16 and waits for the first block: preflight's, or the red phase's once a run gets that far. */
  async function started($: any, w: World): Promise<string> {
    await run($, '16')
    await until(w, () => w.toasts.some(t => t.includes('blocked')), 'the block')
    return (await run($, 'status')).text ?? ''
  }

  test('start: the base is fetched from the project remote, the branch is cut from it, and red is spawned', async ($, on) => {
    const w = engine(on, FORK)
    await start($)
    await started($, w)
    expect(w.spawned).toHaveLength(1)
    expect(w.argv).toContainEqual(['git', 'fetch', 'upstream', 'main'])
    expect(w.argv).toContainEqual(['git', 'switch', '--no-track', '-c', BRANCH, 'upstream/main'])
    expect(w.argv.some(a => a[1] === 'fetch' && a[2] === 'origin')).toBe(false)
  })

  test("start: the profile, the merge base and the catch-up all read the project remote's base, never origin's", async ($, on) => {
    const w = engine(on, FORK)
    await start($)
    await started($, w)
    expect(w.argv).toContainEqual(['git', 'show', 'upstream/main:.issue-forge.json'])
    expect(w.argv).toContainEqual(['git', 'merge-base', 'HEAD', 'upstream/main'])
    expect(w.argv).toContainEqual(['git', 'merge-base', '--is-ancestor', 'HEAD', 'upstream/main'])
    expect(w.argv).toContainEqual(['git', 'merge', '--ff-only', '-q', 'upstream/main'])
    expect(w.argv.flat().some(x => x.startsWith('origin/'))).toBe(false)
  })

  test('start in a new worktree: it is added from the project remote\'s base', async ($, on) => {
    const w = engine(on, { ...FORK, baseProfile: { ...PROFILE, workspace: 'worktree' } })
    await start($)
    await started($, w)
    expect(w.argv).toContainEqual(['git', 'worktree', 'add', '--no-track', '-b', BRANCH, WT, 'upstream/main'])
    expect(w.argv.flat().some(x => x.startsWith('origin/'))).toBe(false)
  })

  test('start: a branch name taken on either remote is avoided, so origin and the project remote are both asked', async ($, on) => {
    const w = engine(on, { ...FORK, remoteHeads: { origin: [BRANCH], upstream: [`${BRANCH}-2`] } })
    await start($)
    await started($, w)
    expect(w.argv).toContainEqual(['git', 'ls-remote', '--heads', 'origin', 'issue-16*'])
    expect(w.argv).toContainEqual(['git', 'ls-remote', '--heads', 'upstream', 'issue-16*'])
    expect(w.argv).toContainEqual(['git', 'switch', '--no-track', '-c', `${BRANCH}-3`, 'upstream/main'])
  })

  test('start: the run is stored with the project remote and the fork, and stays pinned to the project', async ($, on) => {
    const store: Record<string, unknown> = {}
    const w = engine(on, { ...FORK, storeHold: WATCH }, store)
    await start($)
    await started($, w)
    const stored = Object.entries(store).find(([k]) => k.startsWith('issue-forge:repo-run:') && k.endsWith('#16'))?.[1] as Record<string, unknown> | undefined
    expect(stored?.issue).toBe(16)
    expect(stored?.baseRemote).toBe('upstream')
    expect(stored?.headRepo).toBe('github.com/me/r')
    expect(stored?.ghRepo).toBe('github.com/o/r')
  })

  test("start: origin is checked to be a fork of the project and not an organization's, by host/owner/repo and before anything is fetched; a token in a URL goes nowhere", async ($, on) => {
    const w = engine(on, { originUrl: 'https://x-access-token:SECRET@github.com/me/r.git', remotes: { upstream: 'https://x-access-token:SECRET@github.com/o/r.git' } })
    await start($)
    const status = await started($, w)
    expect(w.argv).toContainEqual(FORK_VIEW)
    expect(w.argv).toContainEqual(['gh', 'api', '--hostname', 'github.com', 'users/me', '--jq', '.type'])
    const forkAt = w.argv.findIndex(a => a.join(' ') === FORK_VIEW.join(' '))
    const ownerAt = w.argv.findIndex(a => a[0] === 'gh' && a[1] === 'api')
    const fetchAt = w.argv.findIndex(a => a[0] === 'git' && a[1] === 'fetch')
    expect(fetchAt).toBeGreaterThan(forkAt)
    expect(fetchAt).toBeGreaterThan(ownerAt)
    expect(forkAt).toBeGreaterThanOrEqual(0)
    expect(JSON.stringify([w.argv, w.toasts, w.asked, status])).not.toContain('SECRET')
  })

  test('start: a parent that is the project in another case still passes the fork check', async ($, on) => {
    const w = engine(on, { ...FORK, parentOf: { 'github.com/me/r': 'O/R' } })
    await start($)
    await started($, w)
    expect(w.spawned).toHaveLength(1)
    expect(w.argv).toContainEqual(['git', 'fetch', 'upstream', 'main'])
  })

  test("start: an organization's fork blocks before anything is fetched or made, since gh pr create can't name it as the head", async ($, on) => {
    const w = engine(on, { ...FORK, orgOwners: ['me'] })
    await start($)
    const status = await started($, w)
    expect(status).toContain("blocked at preflight: gh pr create can't name an organization's fork as the head (cli/cli#10093)")
    expect(w.argv).toContainEqual(['gh', 'api', '--hostname', 'github.com', 'users/me', '--jq', '.type'])
    expect(w.spawned).toEqual([])
    expect(w.argv.some(isGitWrite)).toBe(false)
  })

  test("start on GitHub Enterprise: the owner is looked up on the project's host, so an organization there blocks though github.com has a user of that name", async ($, on) => {
    const GHE = { repoView: { exitCode: 0, stdout: JSON.stringify({ nameWithOwner: 'o/r', url: 'https://ghe.example.com/o/r' }) }, originUrl: 'https://ghe.example.com/me/r.git', remotes: { upstream: 'https://ghe.example.com/o/r.git' } }
    const w = engine(on, { ...GHE, orgOwners: ['ghe.example.com/me'] })
    await start($)
    const status = await started($, w)
    expect(w.argv).toContainEqual(['gh', 'api', '--hostname', 'ghe.example.com', 'users/me', '--jq', '.type'])
    expect(status).toContain("blocked at preflight: gh pr create can't name an organization's fork as the head (cli/cli#10093)")
    expect(w.spawned).toEqual([])
  })

  test('start: two remotes that point at the project block, naming both and saying to remove one', async ($, on) => {
    const w = engine(on, { originUrl: 'https://github.com/me/r.git', remotes: { project: 'https://github.com/o/r.git', upstream: 'git@github.com:o/r.git' } })
    await start($)
    const status = await started($, w)
    expect(status).toContain('blocked at preflight: remotes project and upstream both point at o/r')
    expect(status).toContain('next: remove one of them')
    expect(w.spawned).toEqual([])
    expect(w.argv.some(isGitWrite)).toBe(false)
  })

  test("start: an origin that isn't a fork blocks", async ($, on) => {
    const w = engine(on, { ...FORK, parentOf: { 'github.com/me/r': null } })
    await start($)
    const status = await started($, w)
    expect(status).toContain("blocked at preflight: origin me/r isn't a fork of o/r")
    expect(w.argv).toContainEqual(FORK_VIEW)
    expect(w.spawned).toEqual([])
    expect(w.argv.some(isGitWrite)).toBe(false)
  })

  test("start: an origin that is a fork of another repository blocks", async ($, on) => {
    const w = engine(on, { ...FORK, parentOf: { 'github.com/me/r': 'x/r' } })
    await start($)
    const status = await started($, w)
    expect(status).toContain("blocked at preflight: origin me/r isn't a fork of o/r")
    expect(w.spawned).toEqual([])
    expect(w.argv.some(isGitWrite)).toBe(false)
  })

  test("start: a failed fetch of the base names the project remote", async ($, on) => {
    const w = engine(on, { ...FORK, fetchFails: true })
    await start($)
    const status = await started($, w)
    expect(status).toContain('blocked at preflight: git fetch upstream main failed: fatal: unable to access origin')
    expect(w.argv.some(a => a[1] === 'fetch' && a[2] === 'origin')).toBe(false)
  })

  test("resume at the baseline fetches and catches up from the stored project remote", async ($, on) => {
    const blocked = storedRun('blocked', { ghRepo: 'github.com/o/r', baseRemote: 'upstream', headRepo: 'github.com/me/r', blocked: { at: 'baseline', reason: 'tests fail before any change', next: 'fix main' }, redCommit: undefined, agents: [], used: { red: 0, green: 0, refactor: 0 } })
    const w = engine(on, { ...FORK, head: BRANCH, fetchFails: true }, { [`issue-forge:run:${ROOT}`]: blocked })
    await start($)
    await run($, 'resume')
    await until(w, () => w.toasts.some(t => t.includes('blocked')), 'the block')
    expect((await run($, 'status')).text).toContain('blocked at baseline: git fetch upstream main failed: fatal: unable to access origin')
    expect(w.argv.some(a => a[1] === 'fetch' && a[2] === 'origin')).toBe(false)
    w.fetchFails = false
    await run($, 'resume')
    await until(w, () => w.spawned.length === 1, 'red')
    expect(w.argv).toContainEqual(['git', 'merge', '--ff-only', '-q', 'upstream/main'])
    expect(w.argv).toContainEqual(['git', 'merge-base', 'HEAD', 'upstream/main'])
    expect(w.argv.flat().some(x => x.startsWith('origin/'))).toBe(false)
  })

  test("publish pushes to origin and opens the pull request on the project with the fork's owner as the head", async ($, on) => {
    const w = engine(on, { ...FORK, head: BRANCH }, { [`issue-forge:run:${ROOT}`]: forkRun() })
    await start($)
    expect((await run($, 'publish')).text).toBe(`publishing #16: pushing ${BRANCH} and opening a pull request against main.`)
    await until(w, () => w.toasts.some(t => t.startsWith('PR opened') || t.includes('blocked')), 'the PR or a block')
    expect(w.toasts.some(t => t.startsWith('PR opened'))).toBe(true)
    const pushUrl = w.argv.findIndex(a => a.join(' ') === 'git remote get-url --push --all origin')
    const push = w.argv.findIndex(a => a[0] === 'git' && a[1] === 'push')
    expect(pushUrl >= 0 && pushUrl < push).toBe(true)
    expect(w.argv).toContainEqual(['git', 'push', 'origin', `c0:refs/heads/${BRANCH}`])
    expect(w.argv.find(a => a[0] === 'gh' && a[1] === 'pr')).toEqual(['gh', 'pr', 'create', '--base', 'main', '--head', `me:${BRANCH}`, '--title', 'Fix the thing (#16)', '--body-file', '/home/u/.claude/issue-forge-data/16-1/pr.md', '--repo', 'github.com/o/r'])
  })

  test("publish checks the merge against the project remote's base, fetched there", async ($, on) => {
    const w = engine(on, { ...FORK, head: BRANCH }, { [`issue-forge:run:${ROOT}`]: forkRun() })
    await start($)
    await run($, 'publish')
    await until(w, () => w.toasts.some(t => t.startsWith('PR opened') || t.includes('blocked')), 'the PR or a block')
    expect(w.argv).toContainEqual(['git', 'fetch', 'upstream', 'main'])
    expect(w.argv.some(a => a[1] === 'fetch' && a[2] === 'origin')).toBe(false)
    expect(w.argv.find(a => a[1] === 'merge-tree')?.at(-1)).toBe('upstream/main')
  })

  test('publish blocks when origin now pushes to another repository than the fork the run was preflighted for: no push, no pull request', async ($, on) => {
    const w = engine(on, { head: BRANCH, originUrl: 'https://github.com/other/r.git', remotes: { upstream: 'https://github.com/o/r.git' } }, { [`issue-forge:run:${ROOT}`]: forkRun() })
    await start($)
    await run($, 'publish')
    await until(w, () => w.toasts.some(t => t.startsWith('PR opened') || t.includes('blocked')), 'the block')
    const status = (await run($, 'status')).text ?? ''
    expect(status).toContain('blocked at publishing: origin no longer pushes to me/r')
    expect(status).toContain('next: point origin back at it, or start a new run')
    expect(isPublished(w)).toBe(false)
  })

  test('publish blocks when any of origin\'s push URLs is another repository than the fork, since git pushes to all of them', async ($, on) => {
    const w = engine(on, { ...FORK, head: BRANCH, pushUrl: ['https://github.com/me/r.git', 'git@github.com:other/r.git'] }, { [`issue-forge:run:${ROOT}`]: forkRun() })
    await start($)
    await run($, 'publish')
    await until(w, () => w.toasts.some(t => t.startsWith('PR opened') || t.includes('blocked')), 'the block')
    expect((await run($, 'status')).text).toContain('blocked at publishing: origin no longer pushes to me/r')
    expect(isPublished(w)).toBe(false)
  })

  // PR #87 review: origin's fetch URL is part of the fork check, and each URL is read and resolved once.
  test("start: an origin that fetches from a third repository though it pushes to a fork is no fork clone: the origin block, and the fork isn't looked up", async ($, on) => {
    const w = engine(on, { ...FORK, originUrl: 'https://github.com/x/r.git', pushUrl: 'https://github.com/me/r.git' })
    await start($)
    const status = await started($, w)
    expect(status).toContain('blocked at preflight: origin fetches from x/r, but gh sends issues and pull requests to o/r')
    expect(w.argv).not.toContainEqual(FORK_VIEW)
    expect(w.argv.some(isGitWrite)).toBe(false)
  })

  test("start: an origin that fetches from the project and pushes to the fork is no fork clone: ls-remote origin couldn't see the fork's branches", async ($, on) => {
    const w = engine(on, { ...FORK, originUrl: 'https://github.com/o/r.git', pushUrl: 'https://github.com/me/r.git' })
    await start($)
    const status = await started($, w)
    expect(status).toContain('blocked at preflight: origin pushes to me/r, but gh sends issues and pull requests to o/r')
    expect(w.argv).not.toContainEqual(FORK_VIEW)
    expect(w.argv.some(isGitWrite)).toBe(false)
  })

  test("start: preflight reads origin's push URLs once and asks gh about the fork's name once", async ($, on) => {
    const w = engine(on, FORK)
    await start($)
    await started($, w)
    const firstFetch = w.argv.findIndex(a => a[0] === 'git' && a[1] === 'fetch')
    const before = w.argv.slice(0, firstFetch).map(a => a.join(' '))
    expect(before.filter(a => a === 'git remote get-url --push --all origin')).toHaveLength(1)
    expect(before.filter(a => a === 'gh repo view github.com/me/r --json nameWithOwner,url')).toHaveLength(1)
  })

  test("start: the other remotes are looked up together, so one slow gh answer doesn't hold up the rest", async ($, on) => {
    let release = () => {}
    const held = new Promise<void>(resolve => (release = resolve))
    const w = engine(on, { ...FORK, remotes: { fork2: 'https://github.com/x/r.git', upstream: 'https://github.com/o/r.git' }, viewHold: { repo: 'github.com/x/r', until: held } })
    await start($)
    await run($, '16')
    await until(w, () => w.argv.some(a => a.join(' ') === 'gh repo view github.com/x/r --json nameWithOwner,url'), 'the held lookup')
    for (let i = 0; i < 10; i++) await w.clock.advance(5)
    expect(w.argv).toContainEqual(['git', 'remote', 'get-url', 'upstream'])
    release()
    await until(w, () => w.spawned.length === 1 || w.toasts.some(t => t.includes('blocked')), 'red or a block')
    expect(w.spawned).toHaveLength(1)
  })

  // PR #87 review, the owner's choice: an ssh host nickname is resolved with ssh -G for the fork and the base remote, never
  // assumed; origin's own check keeps #25's rule (#71).
  test("start: origin through an ssh nickname for the project's host is a fork clone once ssh -G resolves it", async ($, on) => {
    const w = engine(on, { ...FORK, originUrl: 'git@gh-personal:me/r.git', sshHosts: { 'gh-personal': 'github.com' } })
    await start($)
    await started($, w)
    expect(w.argv).toContainEqual(['ssh', '-G', 'gh-personal'])
    expect(w.argv).toContainEqual(FORK_VIEW)
    expect(w.argv).toContainEqual(['git', 'fetch', 'upstream', 'main'])
    expect(w.spawned).toHaveLength(1)
  })

  test("start: an ssh nickname ssh can't resolve is no fork: the origin block, and nothing is fetched", async ($, on) => {
    const w = engine(on, { ...FORK, originUrl: 'git@gh-personal:me/r.git', sshFails: true })
    await start($)
    const status = await started($, w)
    expect(status).toContain('blocked at preflight: origin fetches from gh-personal/me/r, but gh sends issues and pull requests to o/r')
    expect(w.argv.some(isGitWrite)).toBe(false)
  })

  test('start: a mirror on another host with the same owner/repo is not the project, so the real project remote is the base', async ($, on) => {
    const w = engine(on, { ...FORK, remotes: { gitlab: 'git@gitlab.com:o/r.git', upstream: 'https://github.com/o/r.git' } })
    await start($)
    await started($, w)
    expect(w.argv).toContainEqual(['git', 'fetch', 'upstream', 'main'])
    expect(w.argv.some(a => a[1] === 'fetch' && a[2] === 'gitlab')).toBe(false)
    expect(w.spawned).toHaveLength(1)
  })

  test('start: a mirror alone is no base remote: the origin block, and nothing is fetched from it', async ($, on) => {
    const w = engine(on, { ...FORK, remotes: { gitlab: 'git@gitlab.com:o/r.git' } })
    await start($)
    const status = await started($, w)
    expect(status).toContain('blocked at preflight: origin fetches from me/r, but gh sends issues and pull requests to o/r')
    expect(w.argv.some(isGitWrite)).toBe(false)
  })

  test("start: a project remote through an ssh nickname for the project's host is the base", async ($, on) => {
    const w = engine(on, { ...FORK, remotes: { upstream: 'git@gh-work:o/r.git' }, sshHosts: { 'gh-work': 'github.com' } })
    await start($)
    await started($, w)
    expect(w.argv).toContainEqual(['git', 'fetch', 'upstream', 'main'])
    expect(w.spawned).toHaveLength(1)
  })

  test("publish blocks a push URL with the fork's owner/repo on another host: git would push there", async ($, on) => {
    const w = engine(on, { ...FORK, head: BRANCH, pushUrl: ['https://github.com/me/r.git', 'git@gitlab.com:me/r.git'] }, { [`issue-forge:run:${ROOT}`]: forkRun() })
    await start($)
    await run($, 'publish')
    await until(w, () => w.toasts.some(t => t.startsWith('PR opened') || t.includes('blocked')), 'the block')
    expect((await run($, 'status')).text).toContain('blocked at publishing: origin no longer pushes to me/r')
    expect(isPublished(w)).toBe(false)
  })

  test('resume at the baseline blocks when the project remote is now a mirror on another host', async ($, on) => {
    const blocked = storedRun('blocked', { ghRepo: 'github.com/o/r', baseRemote: 'upstream', headRepo: 'github.com/me/r', blocked: { at: 'baseline', reason: 'tests fail before any change', next: 'fix main' }, redCommit: undefined, agents: [], used: { red: 0, green: 0, refactor: 0 } })
    const w = engine(on, { ...FORK, head: BRANCH, remotes: { upstream: 'git@gitlab.com:o/r.git' } }, { [`issue-forge:run:${ROOT}`]: blocked })
    await start($)
    await run($, 'resume')
    await until(w, () => w.spawned.length === 1 || w.toasts.some(t => t.includes('blocked')), 'red or a block')
    expect((await run($, 'status')).text).toContain('blocked at baseline: upstream no longer fetches from o/r')
    expect(w.argv.some(a => a[0] === 'git' && a[1] === 'fetch')).toBe(false)
  })

  // PR #87 review: the paths through the fork check and the push check that had no test.
  test("start: gh failing to read the fork blocks with gh's reason, not as \"isn't a fork\"", async ($, on) => {
    const w = engine(on, { ...FORK, forkViewFails: 'HTTP 502: Bad Gateway' })
    await start($)
    const status = await started($, w)
    expect(status).toContain('blocked at preflight: could not read me/r from gh: HTTP 502: Bad Gateway')
    expect(status).toContain('next: check gh and your access to the fork')
    expect(w.argv.some(isGitWrite)).toBe(false)
  })

  test("start: gh failing to say whether the fork's owner is an organization blocks with gh's reason", async ($, on) => {
    const w = engine(on, { ...FORK, ownerTypeFails: 'HTTP 404: Not Found (https://api.github.com/users/me)' })
    await start($)
    const status = await started($, w)
    expect(status).toContain('blocked at preflight: could not tell whether me is a user or an organization: HTTP 404: Not Found')
    expect(w.argv.some(isGitWrite)).toBe(false)
  })

  test("start: origin a fork but no remote for the project is the origin block, and the fork isn't looked up", async ($, on) => {
    const w = engine(on, { originUrl: 'https://github.com/me/r.git' })
    await start($)
    const status = await started($, w)
    expect(status).toContain('blocked at preflight: origin fetches from me/r, but gh sends issues and pull requests to o/r')
    expect(w.argv).not.toContainEqual(FORK_VIEW)
  })

  test('publish blocks when origin has no push URL to read, or none at all', async ($, on) => {
    const w = engine(on, { ...FORK, head: BRANCH, pushUrl: { exitCode: 2, stderr: "error: No such remote 'origin'" } }, { [`issue-forge:run:${ROOT}`]: forkRun() })
    await start($)
    await run($, 'publish')
    await until(w, () => w.toasts.some(t => t.startsWith('PR opened') || t.includes('blocked')), 'the block')
    expect((await run($, 'status')).text).toContain('blocked at publishing: origin no longer pushes to me/r')
    expect(isPublished(w)).toBe(false)
  })

  test('publish blocks when origin lists no push URL', async ($, on) => {
    const w = engine(on, { ...FORK, head: BRANCH, pushUrl: [] }, { [`issue-forge:run:${ROOT}`]: forkRun() })
    await start($)
    await run($, 'publish')
    await until(w, () => w.toasts.some(t => t.startsWith('PR opened') || t.includes('blocked')), 'the block')
    expect((await run($, 'status')).text).toContain('blocked at publishing: origin no longer pushes to me/r')
    expect(isPublished(w)).toBe(false)
  })

  test("resume of a fork run's kept worktree at preflight checks origin's push URLs there against the fork, then fetches the base there", async ($, on) => {
    const atPreflight = storedRun('blocked', { ghRepo: 'github.com/o/r', baseRemote: 'upstream', headRepo: 'github.com/me/r', blocked: { at: 'preflight', reason: 'r', next: 'n' }, workRoot: WT, redCommit: undefined, agents: [], used: { red: 0, green: 0, refactor: 0 } })
    const w = engine(on, { ...FORK, baseProfile: { ...PROFILE, workspace: 'worktree' }, worktrees: [WT], wtHead: BRANCH }, { [`issue-forge:run:${ROOT}`]: atPreflight })
    await start($)
    await run($, 'resume')
    await until(w, () => w.spawned.length === 1 || w.toasts.some(t => t.includes('blocked')), 'red or a block')
    const pushedThere = w.calls.findIndex(c => c.cwd === WT && c.argv.join(' ') === 'git remote get-url --push --all origin')
    const fetchedThere = w.calls.findIndex(c => c.cwd === WT && c.argv.join(' ') === 'git fetch upstream main')
    expect(pushedThere >= 0 && pushedThere < fetchedThere).toBe(true)
    expect(w.spawned).toHaveLength(1)
  })

  test('start: a project remote repointed while the base question is open is read again before the first fetch (Codex on PR #87)', async ($, on) => {
    let answer = (_label: string) => {}
    const hold = new Promise<string>(resolve => (answer = resolve))
    const w = engine(on, { ...FORK, issueBody: 'Make it work.\nBase branch: dev', hold })
    await start($)
    await run($, '16')
    await until(w, () => w.asked.length === 1, 'the base question')
    w.remotes = MOVED
    answer('Use dev')
    await until(w, () => w.spawned.length === 1 || w.toasts.some(t => t.includes('blocked')), 'red or a block')
    expect((await run($, 'status')).text).toContain('blocked at preflight: upstream no longer fetches from o/r')
    expect(w.argv.some(a => a[0] === 'git' && a[1] === 'fetch')).toBe(false)
  })

  // PR #87 review (Codex): the stored base remote is a name; what it fetches from is read again where it is fetched.
  const ZERO = { redCommit: undefined, agents: [], used: { red: 0, green: 0, refactor: 0 } }

  test('resume at the baseline blocks when the project remote now fetches from another repository: nothing is fetched or spawned', async ($, on) => {
    const blocked = storedRun('blocked', { ghRepo: 'github.com/o/r', baseRemote: 'upstream', headRepo: 'github.com/me/r', blocked: { at: 'baseline', reason: 'tests fail before any change', next: 'fix main' }, ...ZERO })
    const w = engine(on, { ...FORK, head: BRANCH, remotes: MOVED }, { [`issue-forge:run:${ROOT}`]: blocked })
    await start($)
    await run($, 'resume')
    await until(w, () => w.spawned.length === 1 || w.toasts.some(t => t.includes('blocked')), 'red or a block')
    const status = (await run($, 'status')).text ?? ''
    expect(status).toContain('blocked at baseline: upstream no longer fetches from o/r')
    expect(status).toContain('next: point upstream back at o/r, or start a new run')
    expect(w.argv.some(a => a[0] === 'git' && a[1] === 'fetch')).toBe(false)
    expect(w.spawned).toEqual([])
  })

  test("resume of a fork run's kept worktree at preflight reads the project remote there before it fetches: its own config can point it elsewhere", async ($, on) => {
    const atPreflight = storedRun('blocked', { ghRepo: 'github.com/o/r', baseRemote: 'upstream', headRepo: 'github.com/me/r', blocked: { at: 'preflight', reason: 'r', next: 'n' }, workRoot: WT, ...ZERO })
    const w = engine(on, { ...FORK, baseProfile: { ...PROFILE, workspace: 'worktree' }, worktrees: [WT], wtHead: BRANCH, remotesIn: { [WT]: MOVED } }, { [`issue-forge:run:${ROOT}`]: atPreflight })
    await start($)
    await run($, 'resume')
    await until(w, () => w.spawned.length === 1 || w.toasts.some(t => t.includes('blocked')), 'red or a block')
    expect((await run($, 'status')).text).toContain('blocked at preflight: upstream no longer fetches from o/r')
    expect(w.calls.some(c => c.cwd === WT && c.argv[1] === 'fetch')).toBe(false)
    expect(w.spawned).toEqual([])
  })

  test("publish doesn't fetch a project remote that now points elsewhere: the pull request says why the merge check is unavailable", async ($, on) => {
    const w = engine(on, { ...FORK, head: BRANCH, remotes: MOVED }, { [`issue-forge:run:${ROOT}`]: forkRun() })
    await start($)
    await run($, 'publish')
    await until(w, () => w.toasts.some(t => t.startsWith('PR opened') || t.includes('blocked')), 'the PR or a block')
    expect(w.argv.some(a => a[0] === 'git' && a[1] === 'fetch')).toBe(false)
    expect(w.files['/home/u/.claude/issue-forge-data/16-1/pr.md']).toContain("the merge check couldn't run: upstream no longer fetches from o/r")
  })

  // Codex on PR #87 (round 3): a branch kept by a preflight block was named for the fork origin pushed to then.
  test('start: a fork run that blocks after making its branch keeps the fork and the base remote with it', async ($, on) => {
    const store: Record<string, unknown> = {}
    const w = engine(on, { ...FORK, baseProfile: { ...PROFILE, workspace: 'worktree' }, worktreeAddFails: true, storeHold: WATCH }, store)
    await start($)
    expect(await started($, w)).toContain('blocked at preflight')
    const stored = Object.entries(store).find(([k]) => k.startsWith('issue-forge:repo-run:') && k.endsWith('#16'))?.[1] as Record<string, unknown> | undefined
    expect(stored?.branch).toBe(BRANCH)
    expect(stored?.headRepo).toBe('github.com/me/r')
    expect(stored?.baseRemote).toBe('upstream')
  })

  test("resume at preflight of a fork run's kept branch blocks when origin now pushes to another fork: the name was checked on the first", async ($, on) => {
    const atPreflight = storedRun('blocked', { ghRepo: 'github.com/o/r', baseRemote: 'upstream', headRepo: 'github.com/me/r', blocked: { at: 'preflight', reason: 'r', next: 'n' }, ...ZERO })
    const w = engine(on, { ...FORK, originUrl: 'https://github.com/you/r.git', head: BRANCH }, { [`issue-forge:run:${ROOT}`]: atPreflight })
    await start($)
    await run($, 'resume')
    await until(w, () => w.spawned.length === 1 || w.toasts.some(t => t.includes('blocked')), 'red or a block')
    const status = (await run($, 'status')).text ?? ''
    expect(status).toContain("blocked at preflight: origin now pushes to you/r, not me/r, where the run's branch was named")
    expect(status).toContain('next: point origin back at me/r, or start a new run')
    expect(w.argv.some(a => a[0] === 'git' && a[1] === 'fetch')).toBe(false)
    expect(w.spawned).toEqual([])
  })
})

// #28: another process holds .git/index.lock, so the index-writing calls (add, commit, stash apply, switch,
// merge --ff-only) fail at once. They wait a second and try again, five attempts in all, then the run blocks naming the lock.
describe('a held git index lock (#28)', () => {
  /** git 2.43.0's refusal of add, commit and switch, with its hint. */
  const LOCK_STDERR = `fatal: Unable to create '${LOCK_PATH}': File exists.\n\nAnother git process seems to be running in this repository, e.g.\nan editor opened by 'git commit'. Please make sure all processes\nare terminated then try again. If it still fails, a git process\nmay have crashed in this repository earlier:\nremove the file manually to continue.\n`
  /** `n` failures that leave the lock file in place; the call after them passes. */
  const locked = (n: number, stderr = LOCK_STDERR, code = 128): GitFail[] => Array.from({ length: n }, () => ({ stderr, code, isLocked: true }))
  /** Keeps $.agent.spawn pending, so the drive stays at the spawn (under test a spawn never gets an agent id). */
  const held = () => new Promise<void>(() => undefined)
  const STASH = { sha: 'abc1234def', message: 'issue-forge #16 green before behaviour test (run 16-1, attempt 1)' }
  const isBlocked = (w: World) => w.toasts.some(t => t.includes('blocked'))
  /** Advances the mock clock a step at a time until `cond` holds, or `ms` have passed. It never throws, so the test's own expect says what failed. */
  async function pump(w: World, cond: () => boolean, ms = 12_000): Promise<void> {
    for (let t = 0; t < ms && !cond(); t += 50) await w.clock.advance(50)
    await w.clock.settle()
  }
  /** Each git call whose arguments are, or start with, `prefix`. */
  const callsOf = (w: World, prefix: string) => w.calls.filter(c => c.argv[0] === 'git' && (c.argv.slice(1).join(' ') === prefix || c.argv.slice(1).join(' ').startsWith(`${prefix} `)))
  const stdinsOf = (w: World, prefix: string) => w.argv.flatMap((a, i) => (a[0] === 'git' && a.slice(1).join(' ').startsWith(prefix) ? [w.inits[i]?.stdin] : []))
  /** The wait between one attempt and the next: at least a second each, as the issue says. */
  const gaps = (calls: { at: number }[]) => calls.slice(1).map((c, i) => c.at - calls[i]!.at)
  const atGateR = (extra: Partial<World> = {}, run: Record<string, unknown> = {}) => {
    const stored = { [`issue-forge:run:${ROOT}`]: storedRun('gateR', { redCommit: undefined, used: { red: 1, green: 0, refactor: 0 }, agents: [], ...run }) }
    return { world: { head: BRANCH, testsExit: 1, staged: ['tests/a.test.ts'], redPaths: ['tests/a.test.ts'], spawnHold: held(), ...extra }, stored }
  }

  test('gate R: a commit that meets the lock waits a second and tries again with the same message; the run goes on', async ($, on) => {
    const { world, stored } = atGateR({ gitFails: { on: 'commit', seq: locked(1) } })
    const w = engine(on, world, stored)
    await start($)
    await run($, 'resume')
    await pump(w, () => w.spawned.length === 1 || isBlocked(w))
    expect(w.toasts.filter(t => t.includes('blocked'))).toEqual([])
    const commits = callsOf(w, 'commit')
    expect(commits.length).toBe(2)
    expect(gaps(commits).every(g => g >= 1000)).toBe(true)
    // The retry sends the message again: stdin is not a stream that the first attempt used up.
    expect(stdinsOf(w, 'commit')).toEqual([w.commits[0], w.commits[0]])
    expect(w.commits[0]).toBe('test(#16): red: Fix the thing\n\nCo-Authored-By: Tester <t@example.com>\n')
    expect(w.spawned.length).toBe(1)
    expect(w.spawned[0]).toMatchObject({ subagentType: 'issue-forge:green' })
  })

  test('gate R: a commit that meets the lock five times blocks naming the lock, after four waits, with no sixth attempt', async ($, on) => {
    const { world, stored } = atGateR({ gitFails: { on: 'commit', seq: locked(5) } })
    const w = engine(on, world, stored)
    await start($)
    await run($, 'resume')
    await pump(w, () => isBlocked(w))
    const status = (await run($, 'status')).text
    expect(status).toContain(`blocked at gateR: another git process is using ${LOCK_PATH} (5 attempts over 4 s)`)
    expect(status).toContain(`next: wait for the other git process to finish, or delete ${LOCK_PATH} if none is running, then /issue-forge resume`)
    expect(w.toasts.some(t => t.startsWith('#16 blocked: another git process is using /w/.git/index.lock'))).toBe(true)
    // Long enough for a sixth attempt, were there one.
    await w.clock.advance(5000)
    await w.clock.settle()
    const commits = callsOf(w, 'commit')
    expect(commits.length).toBe(5)
    expect(gaps(commits).every(g => g >= 1000)).toBe(true)
    expect(commits[4]!.at - commits[0]!.at).toBeGreaterThanOrEqual(4000)
    // The lock's path is asked of git once and reused by the later attempts.
    expect(w.argv.filter(a => a.join(' ') === 'git rev-parse --git-path index.lock').length).toBe(1)
    expect(w.commits.length).toBe(0)
    expect(w.spawned.length).toBe(0)
  })

  test('gate R: after a retry, a commit that fails for another reason is not tried again, and the block is the unexpected one', async ($, on) => {
    const emptyIdent: GitFail = { stderr: 'fatal: empty ident name (for <u@h>) not allowed\n', code: 128, isLocked: false }
    const { world, stored } = atGateR({ gitFails: { on: 'commit', seq: [...locked(1), emptyIdent] } })
    const w = engine(on, world, stored)
    await start($)
    await run($, 'resume')
    await pump(w, () => isBlocked(w))
    expect((await run($, 'status')).text).toContain('blocked at gateR: unexpected: git commit failed: fatal: empty ident name (for <u@h>) not allowed')
    await w.clock.advance(5000)
    await w.clock.settle()
    const commits = callsOf(w, 'commit')
    expect(commits.length).toBe(2)
    expect(gaps(commits).every(g => g >= 1000)).toBe(true)
    expect(w.commits.length).toBe(0)
  })

  // PR #88 review (Codex P2): 0.3.0 retried commit and stash on any git lock; a ref's lock is retried as the index's is.
  // The refusals are git 2.53.0's, captured in a scratch repository with the lock file made by hand.
  const REF_LOCK_PATH = `${ROOT}/.git/refs/heads/${BRANCH}.lock`
  const refLocked = (n: number): GitFail[] => locked(n, `fatal: cannot lock ref 'HEAD': Unable to create '${REF_LOCK_PATH}': File exists.\n`).map(f => ({ ...f, isLocked: false }))

  test("gate R: a commit that meets a held branch ref lock waits a second and tries again; the run goes on (PR #88 review)", async ($, on) => {
    const { world, stored } = atGateR({ gitFails: { on: 'commit', seq: refLocked(1) } })
    const w = engine(on, world, stored)
    await start($)
    await run($, 'resume')
    await pump(w, () => w.spawned.length === 1 || isBlocked(w))
    expect(w.toasts.filter(t => t.includes('blocked'))).toEqual([])
    const commits = callsOf(w, 'commit')
    expect(commits.length).toBe(2)
    expect(gaps(commits).every(g => g >= 1000)).toBe(true)
    expect(w.spawned[0]).toMatchObject({ subagentType: 'issue-forge:green' })
  })

  test('gate R: a commit that meets a ref lock five times blocks naming that lock, not the index (PR #88 review)', async ($, on) => {
    const { world, stored } = atGateR({ gitFails: { on: 'commit', seq: refLocked(5) } })
    const w = engine(on, world, stored)
    await start($)
    await run($, 'resume')
    await pump(w, () => isBlocked(w))
    const status = (await run($, 'status')).text
    expect(status).toContain(`blocked at gateR: another git process is using ${REF_LOCK_PATH} (5 attempts over 4 s)`)
    expect(status).toContain(`next: wait for the other git process to finish, or delete ${REF_LOCK_PATH} if none is running, then /issue-forge resume`)
    expect(callsOf(w, 'commit').length).toBe(5)
  })

  // PR #88 review (Codex 4290283822): `cannot lock ref` also opens git's refusal of a broken ref, which no lock file
  // explains. git 2.53.0's text, captured in a scratch repository with the branch's ref file overwritten.
  test('gate R: a commit refused for a broken ref is not blamed on a lock: the block is git\'s own failure', async ($, on) => {
    const broken = `fatal: cannot lock ref 'HEAD': unable to resolve reference 'refs/heads/${BRANCH}': reference broken\n`
    const { world, stored } = atGateR({ gitFails: { on: 'commit', seq: locked(5, broken).map(f => ({ ...f, isLocked: false })) } })
    const w = engine(on, world, stored)
    await start($)
    await run($, 'resume')
    await pump(w, () => isBlocked(w))
    const status = (await run($, 'status')).text
    expect(status).toContain(`blocked at gateR: unexpected: git commit failed: fatal: cannot lock ref 'HEAD': unable to resolve reference 'refs/heads/${BRANCH}': reference broken`)
    expect(status).not.toContain('another git process')
    expect(w.commits).toEqual([])
  })

  // PR #88 (Codex 4290341993): a lock git couldn't create for another reason is no other process's. git 2.53.0's
  // refusal of add with a read-only .git, captured in a scratch repository.
  test("gate R: git add -A that can't create the index lock (Permission denied) blocks with git's own failure, not a held lock", async ($, on) => {
    const denied = `fatal: Unable to create '${LOCK_PATH}': Permission denied\n`
    const { world, stored } = atGateR({ gitFails: { on: 'add', seq: locked(5, denied).map(f => ({ ...f, isLocked: false })) } })
    const w = engine(on, world, stored)
    await start($)
    await run($, 'resume')
    await pump(w, () => isBlocked(w))
    const status = (await run($, 'status')).text
    expect(status).toContain(`blocked at gateR: unexpected: git add failed: fatal: Unable to create '${LOCK_PATH}': Permission denied`)
    expect(status).not.toContain('another git process')
  })

  // git 2.53.0 names no lock here: stderr is only this line, exit 1, and the tree is left as it was.
  const STASH_LOCKED: GitFail = { stderr: 'Cannot save the current status\n', code: 1, isLocked: false, isStashLocked: true }

  test("gate F: a stash push that meets the shared refs/stash lock waits a second and tries again; the rejected refactor is stashed (PR #88 review)", async ($, on) => {
    // Resume gives the phase its attempts again, so a profile with no refactor retry is what sends a failed gate F to the stash.
    const noRetry = storedRun('gateF', { greenCommit: 'c2', used: { red: 1, green: 1, refactor: 1 } })
    const stored = { [`issue-forge:run:${ROOT}`]: { ...noRetry, profile: { ...noRetry.profile, attempts: { red: 2, green: 3, refactor: 0 } } } }
    const w = engine(on, { head: BRANCH, testsExit: 1, staged: ['tests/a.test.ts', 'src/a.ts'], sinceRed: ['src/a.ts'], redPaths: ['tests/a.test.ts'], gitFails: { on: 'stash push', seq: [STASH_LOCKED] } }, stored)
    await start($)
    await run($, 'resume')
    await pump(w, () => callsOf(w, 'stash list').length > 0 || isBlocked(w))
    const pushes = callsOf(w, 'stash push')
    expect(pushes.length).toBe(2)
    expect(gaps(pushes).every(g => g >= 1000)).toBe(true)
    expect((await run($, 'status')).text).not.toContain('git stash failed')
  })

  // PR #88 review (Codex P1): the 5 s watch can't see a takeover in time, so each attempt after a wait reads the stored
  // run first, as commitAll and stashAll do before their first one.
  test('gate R: a run another session takes over during the lock wait gets no further commit attempt (PR #88 review)', async ($, on) => {
    const { world, stored } = atGateR({ gitFails: { on: 'commit', seq: locked(5) } })
    const store: Record<string, unknown> = { ...stored }
    const w = engine(on, { ...world, storeHold: { when: () => false, until: Promise.resolve() } }, store)
    await start($)
    await run($, 'resume')
    await pump(w, () => callsOf(w, 'commit').length === 1)
    // Another session writes the run (the store is shared live between sessions).
    store[key(16)] = { ...(store[key(16)] as any), driver: { session: OTHER, since: 1 } }
    // Three waits' worth, still short of the 5 s watch.
    for (let t = 0; t < 3000; t += 50) await w.clock.advance(50)
    await w.clock.settle()
    expect(callsOf(w, 'commit').length).toBe(1)
    expect((store[key(16)] as any).driver).toEqual({ session: OTHER, since: 1 })
    expect(w.commits).toEqual([])
  })

  test('gate F: a stash push that meets the refs/stash lock five times blocks naming that lock (PR #88 review)', async ($, on) => {
    const noRetry = storedRun('gateF', { greenCommit: 'c2', used: { red: 1, green: 1, refactor: 1 } })
    const stored = { [`issue-forge:run:${ROOT}`]: { ...noRetry, profile: { ...noRetry.profile, attempts: { red: 2, green: 3, refactor: 0 } } } }
    const w = engine(on, { head: BRANCH, testsExit: 1, staged: ['tests/a.test.ts', 'src/a.ts'], sinceRed: ['src/a.ts'], redPaths: ['tests/a.test.ts'], gitFails: { on: 'stash push', seq: Array.from({ length: 5 }, () => STASH_LOCKED) } }, stored)
    await start($)
    await run($, 'resume')
    await pump(w, () => isBlocked(w))
    const status = (await run($, 'status')).text
    expect(status).toContain(`another git process is using ${STASH_LOCK_PATH} (5 attempts over 4 s)`)
    expect(status).toContain(`next: wait for the other git process to finish, or delete ${STASH_LOCK_PATH} if none is running, then /issue-forge resume`)
    expect(callsOf(w, 'stash push').length).toBe(5)
  })

  // PR #88 review: the wait's timer may never fire (a hook refuses clock.after, a reload cancels it); a Stop ends the
  // wait itself, so the drive ends and clears this session as the driver at once.
  test('a Stop during the lock wait ends the drive at once, without waiting for the timer (PR #88 review)', async ($, on) => {
    const { world, stored } = atGateR({ gitFails: { on: 'commit', seq: locked(5) } })
    const store: Record<string, unknown> = { ...stored }
    const w = engine(on, { ...world, storeHold: { when: () => false, until: Promise.resolve() } }, store)
    await start($)
    await run($, 'resume')
    await pump(w, () => callsOf(w, 'commit').length === 1)
    expect((store[key(16)] as any).driver?.session).toBe(SESSION)
    expect((await run($, 'stop')).text).toContain('stopped #16')
    // The clock stays where it is: the wait's timer doesn't fire.
    await w.clock.settle()
    expect((store[key(16)] as any).step).toBe('stopped')
    expect((store[key(16)] as any).driver).toBeUndefined()
    expect(callsOf(w, 'commit').length).toBe(1)
  })

  test('gate R: git add -A that meets the lock is retried after a second, and gate R goes on', async ($, on) => {
    const { world, stored } = atGateR({ gitFails: { on: 'add', seq: locked(1) } })
    const w = engine(on, world, stored)
    await start($)
    await run($, 'resume')
    await pump(w, () => w.spawned.length === 1 || isBlocked(w))
    expect(w.toasts.filter(t => t.includes('blocked'))).toEqual([])
    const adds = callsOf(w, 'add -A')
    expect(adds.length).toBe(2)
    expect(gaps(adds).every(g => g >= 1000)).toBe(true)
    expect(w.commits.length).toBe(1)
    expect(w.spawned.length).toBe(1)
  })

  test('gate G: git add -A that meets the lock is retried after a second, and the green commit is made', async ($, on) => {
    const stored = { [`issue-forge:run:${ROOT}`]: storedRun('gateG') }
    const w = engine(on, { head: BRANCH, staged: ['tests/a.test.ts', 'src/a.ts'], sinceRed: ['src/a.ts'], redPaths: ['tests/a.test.ts'], spawnHold: held(), gitFails: { on: 'add', seq: locked(1) } }, stored)
    await start($)
    await run($, 'resume')
    await pump(w, () => w.spawned.length === 1 || isBlocked(w))
    expect(w.toasts.filter(t => t.includes('blocked'))).toEqual([])
    const adds = callsOf(w, 'add -A')
    expect(adds.length).toBe(2)
    expect(gaps(adds).every(g => g >= 1000)).toBe(true)
    expect(w.commits[0]).toStartWith('fix(#16): green: Fix the thing')
    expect(w.spawned[0]).toMatchObject({ subagentType: 'issue-forge:refactor' })
  })

  describe("restoring green's stash", () => {
    const behaviour = (gitFails: { on: string; seq: GitFail[] }) =>
      atGateR(
        { testsExit: 1, sinceRed: ['tests/b.ui.test.ts'], staged: ['tests/a.test.ts', 'tests/b.ui.test.ts'], stashList: `${STASH.sha}\tOn ${BRANCH}: ${STASH.message}\n`, gitFails },
        { redCommit: 'c1', behaviourFor: ['src/register.tsx'], greenStash: STASH, used: { red: 1, green: 1, refactor: 0 }, agents: [{ id: 'old-green', name: 'issue-forge-16-green-1', phase: 'green' }] },
      )
    const applies = (w: World) => callsOf(w, `stash apply ${STASH.sha}`)

    test('gate R: git stash apply that exits 1 with no output while the lock file exists is retried, and gate R goes on', async ($, on) => {
      const { world, stored } = behaviour({ on: 'stash apply', seq: [{ stderr: '', code: 1, isLocked: true }] })
      const w = engine(on, world, stored)
      await start($)
      await run($, 'resume')
      await pump(w, () => w.argv.some(a => a[1] === 'diff' && a.includes('-U0')) || isBlocked(w))
      expect(w.toasts.filter(t => t.includes('blocked'))).toEqual([])
      expect(applies(w).length).toBe(2)
      expect(gaps(applies(w)).every(g => g >= 1000)).toBe(true)
      expect(w.commits[0]).toStartWith('test(#16): red: behaviour test for src/register.tsx')
      // Gate G has begun: green's work is back in the tree.
      expect(w.argv.some(a => a[1] === 'diff' && a.includes('-U0'))).toBe(true)
    })

    // PR #88 review (Codex P2): before 2.31, `rev-parse --path-format=absolute --git-path index.lock` exits 0 with the
    // option on its first line, so the file looked for was never the lock and a silent stash failure was never retried.
    test('gate R: with git before 2.31, a stash apply that exits 1 with no output while the lock file exists is still retried', async ($, on) => {
      const { world, stored } = behaviour({ on: 'stash apply', seq: [{ stderr: '', code: 1, isLocked: true }] })
      const w = engine(on, { ...world, isGitBefore231: true }, stored)
      await start($)
      await run($, 'resume')
      await pump(w, () => w.argv.some(a => a[1] === 'diff' && a.includes('-U0')) || isBlocked(w))
      expect(w.toasts.filter(t => t.includes('blocked'))).toEqual([])
      expect(applies(w).length).toBe(2)
    })

    // PR #88 review: stash apply says nothing when it meets the lock, so the file is the only sign. Its path is known
    // before the call, so a lock let go while git was asked where it is still counts.
    test('gate R: a silent stash apply is retried even when the lock is let go while its path would be looked up', async ($, on) => {
      const { world, stored } = behaviour({ on: 'stash apply', seq: [{ stderr: '', code: 1, isLocked: true }] })
      const w = engine(on, { ...world, isLockGoneOnLookup: true }, stored)
      await start($)
      await run($, 'resume')
      await pump(w, () => w.argv.some(a => a[1] === 'diff' && a.includes('-U0')) || isBlocked(w))
      expect(w.toasts.filter(t => t.includes('blocked'))).toEqual([])
      expect(applies(w).length).toBe(2)
    })

    // PR #88 review: the behaviour commit is made before the apply, so a lock that outlasts the apply blocks after it,
    // with the stash named, as any other failed restore does. git 2.53.0's refusal, captured in a scratch repository.
    test("gate R: a stash apply that meets the lock five times keeps the behaviour commit and blocks naming green's stash", async ($, on) => {
      const applyLocked = `error: Unable to create '${LOCK_PATH}': File exists.\n\nAnother git process seems to be running in this repository.\nerror: could not write index\n`
      const { world, stored } = behaviour({ on: 'stash apply', seq: locked(5, applyLocked, 1) })
      const w = engine(on, world, stored)
      await start($)
      await run($, 'resume')
      await pump(w, () => isBlocked(w))
      const status = (await run($, 'status')).text
      expect(status).toContain(`blocked at gateG: another git process is using ${LOCK_PATH} (5 attempts over 4 s); green's work is in stash abc1234 "${STASH.message}"`)
      expect(status).toContain("next: restore green's work by hand (git stash apply abc1234)")
      expect(w.commits[0]).toStartWith('test(#16): red: behaviour test for src/register.tsx')
      expect(applies(w).length).toBe(5)
    })

    test('gate R: a stash apply that fails with no lock file is not tried again, and the block says where green\'s work is', async ($, on) => {
      const { world, stored } = behaviour({ on: 'stash apply', seq: [{ stderr: '', code: 1, isLocked: true }, { stderr: '', code: 1, isLocked: false }] })
      const w = engine(on, world, stored)
      await start($)
      await run($, 'resume')
      await pump(w, () => isBlocked(w))
      expect((await run($, 'status')).text).toContain(`blocked at gateG: could not restore green's work; it is in stash abc1234 "${STASH.message}"`)
      await w.clock.advance(5000)
      await w.clock.settle()
      expect(applies(w).length).toBe(2)
      expect(gaps(applies(w)).every(g => g >= 1000)).toBe(true)
    })
  })

  test('preflight: git switch that meets the lock five times blocks at preflight naming the lock, and nothing after the switch runs', async ($, on) => {
    const w = engine(on, { spawnHold: held(), gitFails: { on: 'switch', seq: locked(5) } })
    await start($)
    expect((await run($, '16')).text).toBe('starting #16; the pane shows progress. Nothing is pushed until you say yes.')
    await pump(w, () => isBlocked(w))
    const status = (await run($, 'status')).text
    expect(status).toContain(`blocked at preflight: another git process is using ${LOCK_PATH} (5 attempts over 4 s)`)
    expect(status).toContain(`next: wait for the other git process to finish, or delete ${LOCK_PATH} if none is running, then /issue-forge resume`)
    await w.clock.advance(5000)
    await w.clock.settle()
    const switches = callsOf(w, 'switch')
    expect(switches.length).toBe(5)
    expect(gaps(switches).every(g => g >= 1000)).toBe(true)
    const lastSwitch = w.argv.map(a => a[1]).lastIndexOf('switch')
    const after = w.argv.slice(lastSwitch + 1)
    expect(after.some(a => a[0] === 't' || a[0] === 'c' || a[1] === 'merge-base')).toBe(false)
    expect(w.spawned.length).toBe(0)
  })

  test('baseline: git merge --ff-only that meets the lock (error: text, exit 1) is retried after a second, and the baseline is recorded', async ($, on) => {
    const blocked = storedRun('blocked', { blocked: { at: 'baseline', reason: 'tests fail before any change', next: 'fix main' }, redCommit: undefined, agents: [], used: { red: 0, green: 0, refactor: 0 } })
    const lockError = `error: Unable to create '${LOCK_PATH}': File exists.\n\nAnother git process seems to be running in this repository.\n`
    const w = engine(on, { head: BRANCH, spawnHold: held(), gitFails: { on: 'merge --ff-only', seq: locked(1, lockError, 1) } }, { [`issue-forge:run:${ROOT}`]: blocked })
    await start($)
    await run($, 'resume')
    await pump(w, () => w.spawned.length === 1 || isBlocked(w))
    expect(w.toasts.filter(t => t.includes('blocked'))).toEqual([])
    const merges = callsOf(w, 'merge --ff-only')
    expect(merges.length).toBe(2)
    expect(gaps(merges).every(g => g >= 1000)).toBe(true)
    expect(w.spawned.length).toBe(1)
    expect((await run($, 'status')).text).toContain('baseline: total lines 100.00% · branches n/a')
  })

  test("the run's own git calls take no optional locks: each carries GIT_OPTIONAL_LOCKS=0, its git status included", async ($, on) => {
    const w = engine(on, { spawnHold: held() })
    await start($)
    await run($, '16')
    await pump(w, () => w.spawned.length === 1 || isBlocked(w))
    expect(w.spawned.length).toBe(1)
    // The one git call outside git(): it finds the root the others run in.
    const calls = w.argv.flatMap((a, i) => (a[0] === 'git' && a.slice(1).join(' ') !== 'rev-parse --show-toplevel' ? [{ text: a.join(' '), env: w.inits[i]?.env }] : []))
    expect(calls.some(c => c.text.startsWith('git status'))).toBe(true)
    expect(calls.filter(c => c.env?.GIT_OPTIONAL_LOCKS !== '0').map(c => c.text)).toEqual([])
  })

  // PR #88 review: the README says the run's git takes no optional locks; the root lookup and worktree add are git too.
  test('in a worktree run every git call carries GIT_OPTIONAL_LOCKS=0, rev-parse --show-toplevel and worktree add included', async ($, on) => {
    const w = engine(on, { baseProfile: { ...PROFILE, workspace: 'worktree' }, spawnHold: held() })
    await start($)
    await run($, '16')
    await pump(w, () => w.spawned.length === 1 || isBlocked(w))
    expect(w.spawned.length).toBe(1)
    const calls = w.argv.flatMap((a, i) => (a[0] === 'git' ? [{ text: a.join(' '), env: w.inits[i]?.env }] : []))
    expect(calls.some(c => c.text.startsWith('git rev-parse --show-toplevel'))).toBe(true)
    expect(calls.some(c => c.text.startsWith('git worktree add'))).toBe(true)
    expect(calls.filter(c => c.env?.GIT_OPTIONAL_LOCKS !== '0').map(c => c.text)).toEqual([])
    // The profile's own commands run as the user wrote them.
    expect(w.argv.flatMap((a, i) => (a[0] === 't' ? [w.inits[i]?.env] : []))).toEqual([undefined])
  })

  // PR #88 (Codex 4290342002): a profile command that is itself git is the user's command, not one of the run's.
  test("a profile command that is git runs with the session's env; worktree add still takes no optional locks", async ($, on) => {
    const w = engine(on, { baseProfile: { ...PROFILE, workspace: 'worktree', testCommand: ['git', 'diff', '--check'] }, spawnHold: held() })
    await start($)
    await run($, '16')
    await pump(w, () => w.spawned.length === 1 || isBlocked(w))
    expect(w.spawned.length).toBe(1)
    const envs = (prefix: string) => w.argv.flatMap((a, i) => (a.join(' ').startsWith(prefix) ? [w.inits[i]?.env] : []))
    expect(envs('git diff --check').length).toBeGreaterThan(0)
    expect(envs('git diff --check').filter(e => e !== undefined)).toEqual([])
    expect(envs('git worktree add').map(e => e?.GIT_OPTIONAL_LOCKS)).toEqual(['0'])
  })
})

describe('new plugins are mod-builder\'s (Change 0.7.0)', () => {
  // As #18 asked: the build-with line, and the lines that belong to it.
  const NEW_MOD_BODY = '## Before you start\n\n- **Build it with `/mod-builder:build`** (SPEC first, one approval), from\n  the `guard` archetype.\n- Read the SPEC template.\n'
  // As #19 named it: the skill in passing, in a fix.
  const FIX_BODY = 'While `/mod-builder:build` was on its Spec stage the band showed the new mod, but the list did not.'
  const MANIFEST = 'mods/x/.claude-plugin/plugin.json'

  test('an issue that asks for a new plugin is answered with next steps, and nothing starts', async ($, on) => {
    const store: Record<string, unknown> = {}
    const w = engine(on, { issueBody: NEW_MOD_BODY }, store)
    await start($)
    const { text } = (await run($, '16')) as { text: string }
    expect(text).toStartWith('#16 asks for a new Claude Code plugin.')
    expect(text).toContain('Nothing was started.')
    expect(text).toContain('1. Run /mod-builder:build and ask for the plugin #16 describes: "Fix the thing" (https://github.com/o/r/issues/16).')
    expect(text).toContain("It matched this line of the issue (the author's words; issue-forge hasn't checked them). If it doesn't ask for a new plugin, reword it and start again:\n  > - **Build it with `/mod-builder:build`** (SPEC first, one approval), from\n\nNext steps:")
    expect(text).not.toContain("Follow the issue's own guidance")
    expect(text).toContain('Open a pull request that closes #16.')
    await w.clock.settle()
    expect(Object.keys(store).filter(k => k.startsWith('issue-forge:repo-run:'))).toEqual([])
    expect(w.argv.filter(a => a[0] === 'git' && a[1] !== 'rev-parse')).toEqual([])
    expect(w.spawned).toEqual([])
    expect(w.opened).toEqual([])
  })

  test('an issue that names /mod-builder:build in passing starts as before', async ($, on) => {
    const w = engine(on, { issueBody: FIX_BODY })
    await start($)
    expect((await run($, '16')).text).toBe('starting #16; the pane shows progress. Nothing is pushed until you say yes.')
    await until(w, () => w.spawned.length === 1, 'red')
  })

  test('a start whose issue read fails still starts, and preflight blocks as before', async ($, on) => {
    const w = engine(on, { issueFails: 'GraphQL: Could not resolve to an issue' })
    await start($)
    expect((await run($, '16')).text).toBe('starting #16; the pane shows progress. Nothing is pushed until you say yes.')
    await until(w, () => w.toasts.some(t => t.includes('blocked')), 'the block')
    expect((await run($, 'status')).text).toContain('issue #16 not found: GraphQL: Could not resolve to an issue')
  })

  test('a green that adds a plugin manifest blocks final at gate G: Stop and Status, no Resume, no retry; resume refuses', async ($, on) => {
    const w = engine(on, { head: BRANCH, staged: ['tests/a.test.ts', 'src/a.ts', MANIFEST], sinceRed: ['src/a.ts', MANIFEST], redPaths: ['tests/a.test.ts'], added: ['src/a.ts', MANIFEST] }, { [`issue-forge:run:${ROOT}`]: storedRun('gateG') })
    await start($)
    await run($, 'resume')
    await until(w, () => w.toasts.some(t => t.includes('blocked')), 'the block')
    expect(w.spawned).toEqual([])
    expect(w.commits).toEqual([])
    expect(w.argv.some(a => a[0] === 't')).toBe(false)
    const ui = await pane($)
    expect(await ui.find({ type: 'Text', text: /a phase agent created a new Claude Code plugin/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /then \/issue-forge stop 16/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^steps: \/issue-forge status$/ })).toBeDefined()
    expect(await ui.find({ key: 'resume' })).toBeUndefined()
    expect(await ui.find({ key: 'stop' })).toBeDefined()
    expect(await ui.find({ key: 'status' })).toBeDefined()
    expect((await run($, 'resume')).text).toStartWith("#16 can't be resumed: a phase agent created a new Claude Code plugin (mods/x/.claude-plugin/plugin.json)")
    expect((await run($, 'status')).text).toContain("1. Nothing past red's commit was committed, and nothing was pushed.")
  })

  test("a pull request's number is refused as a pull request, even when its body reads as a new plugin (PR #103 /code-review)", async ($, on) => {
    const w = engine(on, { issueBody: NEW_MOD_BODY, issueUrl: 'https://github.com/o/r/pull/16' })
    await start($)
    const { text } = (await run($, '16')) as { text: string }
    expect(text.startsWith('#16 asks for a new Claude Code plugin.')).toBe(false)
    await until(w, () => w.toasts.some(t => t.includes('blocked')), 'the block')
    expect((await run($, 'status')).text).toContain('blocked at preflight: #16 is a pull request, not an issue')
  })

  test('the gates read added paths with rename detection off, so a moved manifest counts as added (PR #103 /code-review)', async ($, on) => {
    const w = engine(on, { head: BRANCH, staged: ['tests/a.test.ts', MANIFEST], sinceRed: [MANIFEST], redPaths: ['tests/a.test.ts'], added: [MANIFEST] }, { [`issue-forge:run:${ROOT}`]: storedRun('gateG') })
    await start($)
    await run($, 'resume')
    await until(w, () => w.toasts.some(t => t.includes('blocked')), 'the block')
    const reads = w.calls.filter(c => c.argv.includes('--diff-filter=A')).map(c => c.argv.join(' '))
    // Since PR #136 review round 1 (Codex 4350587243) the read diffs the tested tree (tree1 here) instead of the index.
    expect(reads).toEqual(['git diff --no-renames --name-only --diff-filter=A -z base0 tree1'])
  })

  test("a manifest on the base branch's tip isn't the run's new plugin: someone else's, merged in, doesn't block (owner, after PR #103's review)", async ($, on) => {
    const w = engine(on, { head: BRANCH, staged: ['tests/a.test.ts', 'src/a.ts', MANIFEST], sinceRed: ['src/a.ts'], redPaths: ['tests/a.test.ts'], added: ['src/a.ts', MANIFEST], baseTip: [MANIFEST] }, { [`issue-forge:run:${ROOT}`]: storedRun('gateG') })
    await start($)
    await run($, 'resume')
    await until(w, () => w.toasts.some(t => t.includes('blocked')) || w.argv.some(a => a[0] === 't'), 'the block or the tests')
    expect(w.argv.some(a => a[0] === 't')).toBe(true)
    expect(w.calls.some(c => c.argv.join(' ') === 'git ls-tree -r --name-only -z origin/main')).toBe(true)
  })

  test('red adding a plugin manifest blocks final at gate R, with nothing committed', async ($, on) => {
    const w = engine(on, { head: BRANCH, testsExit: 1, staged: ['tests/a.test.ts', MANIFEST], redPaths: ['tests/a.test.ts'], added: ['tests/a.test.ts', MANIFEST] }, { [`issue-forge:run:${ROOT}`]: storedRun('gateR', { redCommit: undefined, used: { red: 1, green: 0, refactor: 0 }, agents: [] }) })
    await start($)
    await run($, 'resume')
    await until(w, () => w.toasts.some(t => t.includes('blocked')), 'the block')
    expect(w.argv.some(a => a[0] === 't')).toBe(false)
    expect(w.commits).toEqual([])
    expect(w.spawned).toEqual([])
    const status = (await run($, 'status')).text as string
    expect(status).toContain(`blocked at gateR: a phase agent created a new Claude Code plugin (${MANIFEST})`)
    expect(status).toContain('1. Nothing was committed, and nothing was pushed.')
    expect(status).not.toContain('git show')
  })

  test('red adding a plugin fixture under the test globs passes gate R as test data (owner\'s decision after the PR opened)', async ($, on) => {
    const FIXTURE = 'tests/fixtures/sample/.claude-plugin/plugin.json'
    const w = engine(on, { head: BRANCH, testsExit: 1, staged: ['tests/a.test.ts', FIXTURE], redPaths: ['tests/a.test.ts', FIXTURE], added: ['tests/a.test.ts', FIXTURE] }, { [`issue-forge:run:${ROOT}`]: storedRun('gateR', { redCommit: undefined, used: { red: 1, green: 0, refactor: 0 }, agents: [] }) })
    await start($)
    await run($, 'resume')
    await until(w, () => w.spawned.length === 1 || w.toasts.some(t => t.includes('blocked')), 'green, or a block')
    // The kit's spawn has no agent id, so a block follows green's spawn; what matters is that R4 didn't block.
    expect(w.toasts.filter(t => t.includes('new Claude Code plugin'))).toEqual([])
    expect(w.commits[0]).toStartWith('test(#16): red: Fix the thing')
    expect(w.spawned[0]).toMatchObject({ subagentType: 'issue-forge:green' })
  })

  test('a final block\'s hint line offers stop and status, not resume', async ($, on) => {
    const w = engine(on, { head: BRANCH, staged: ['tests/a.test.ts', MANIFEST], sinceRed: [MANIFEST], redPaths: ['tests/a.test.ts'], added: [MANIFEST] }, { [`issue-forge:run:${ROOT}`]: storedRun('gateG') })
    await start($)
    await run($, 'resume')
    await until(w, () => w.toasts.some(t => t.includes('blocked')), 'the block')
    const ui = await pane($)
    expect(await ui.find({ type: 'Text', text: /r resume/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^s stop · t status · ctrl\+x tab: keys, again: next tab$/ })).toBeDefined()
  })

  test('a pull request\'s number blocks final: resume refuses it', async ($, on) => {
    const w = engine(on, { issueUrl: 'https://github.com/o/r/pull/16' })
    await start($)
    await run($, '16')
    await until(w, () => w.toasts.some(t => t.includes('blocked')), 'the block')
    expect((await run($, 'resume')).text).toBe("#16 can't be resumed: #16 is a pull request, not an issue. /issue-forge stop 16 ends it.")
  })

  // The guard's own decision is logic (manifestOf): a test can't make a live phase agent, since only core sets a spawn's agentId (d.ts).
  test('a manifest the guard refused, with nothing added, still blocks final at the gate', async ($, on) => {
    const w = engine(on, { head: BRANCH, staged: ['tests/a.test.ts', 'src/a.ts'], sinceRed: ['src/a.ts'], redPaths: ['tests/a.test.ts'] }, { [`issue-forge:run:${ROOT}`]: storedRun('gateG', { newPlugin: MANIFEST }) })
    await start($)
    await run($, 'resume')
    await until(w, () => w.toasts.some(t => t.includes('blocked')), 'the block')
    expect((await run($, 'status')).text).toContain(`a phase agent tried to create a new Claude Code plugin (${MANIFEST})`)
    expect(w.commits).toEqual([])
    expect(w.spawned).toEqual([])
  })
})


// #101 (Change 0.7.5): a gate records the tree it tests (git write-tree after git add -A), commits only that tree, and
// blocks when the index changed before the commit or the commit holds another tree.
describe('#101: a gate commits only the tree it tested', () => {
  const isBlocked = (w: World) => w.toasts.some(t => t.includes('blocked'))
  /** Keeps $.agent.spawn pending, so the drive stays at the next phase's spawn (under test a spawn never gets an agent id). */
  const held = () => new Promise<void>(() => undefined)
  const G_WORLD = { head: BRANCH, staged: ['tests/a.test.ts', 'src/a.ts'], sinceRed: ['src/a.ts'], redPaths: ['tests/a.test.ts'] }
  const R_RUN = { redCommit: undefined, used: { red: 1, green: 0, refactor: 0 }, agents: [] }
  const R_WORLD = { head: BRANCH, testsExit: 1, staged: ['tests/a.test.ts'], redPaths: ['tests/a.test.ts'] }
  const firstOf = (w: World, match: (a: string[]) => boolean) => w.argv.findIndex(match)
  const isGit = (sub: string) => (a: string[]) => a[0] === 'git' && a.slice(1).join(' ') === sub

  test('gate G: a path staged after the gate staged blocks it before the commit, with nothing committed', async ($, on) => {
    const w = engine(on, { ...G_WORLD, trees: ['1111111aaaa', '2222222bbbb'], spawnHold: held() }, { [`issue-forge:run:${ROOT}`]: storedRun('gateG') })
    await start($)
    await run($, 'resume')
    await until(w, () => isBlocked(w) || w.spawned.length > 0, 'a block or refactor')
    const status = (await run($, 'status')).text ?? ''
    expect(status).toContain('blocked at gateG: the index changed after gate G tested it (tested 1111111, now 2222222)')
    expect(status).toContain("next: see what was staged since (git diff --cached --stat 1111111aaaa) and take what isn't the run's out of the run's folder (resume stages everything again), then /issue-forge resume")
    // The tested tree is recorded after staging and before any test runs.
    expect(firstOf(w, isGit('add -A'))).toBeLessThan(firstOf(w, isGit('write-tree')))
    expect(firstOf(w, isGit('write-tree'))).toBeLessThan(firstOf(w, a => a[0] === 't'))
    expect(w.commits.length).toBe(0)
    expect(w.spawned).toEqual([])
  })

  test("gate G: a commit whose tree isn't the tested one blocks after it and resets nothing; a resume tests the commit and keeps it", async ($, on) => {
    const store: Record<string, unknown> = { [`issue-forge:run:${ROOT}`]: storedRun('gateG', { redCommit: 'r1' }) }
    const w = engine(on, { ...G_WORLD, trees: ['1111111aaaa'], headTree: '3333333cccc', spawnHold: held(), storeHold: { when: () => false, until: Promise.resolve() } }, store)
    await start($)
    await run($, 'resume')
    await until(w, () => isBlocked(w) || w.spawned.length > 0, 'a block or refactor')
    const status = (await run($, 'status')).text ?? ''
    expect(status).toContain("blocked at gateG: commit c1 holds a tree gate G didn't test (3333333, tested 1111111): a commit hook that rewrites files, or another process during the commit")
    expect(status).toContain("next: see what wasn't tested (git diff 1111111aaaa HEAD); a commit hook's change needs nothing (resume tests the commit as it stands), anything else needs git reset HEAD~1 and taking it out of the run's folder, then /issue-forge resume")
    expect(w.commits.length).toBe(1)
    expect(w.argv.some(a => a[0] === 'git' && a[1] === 'reset')).toBe(false)
    expect(w.spawned).toEqual([])
    // The index is the commit now: resume stages it again, tests it, and keeps HEAD as green's commit.
    w.headTree = undefined
    w.trees = ['3333333cccc']
    w.hasChanges = false
    await run($, 'resume')
    await until(w, () => w.spawned.length === 1, 'refactor')
    expect(w.commits.length).toBe(1)
    expect(w.spawned[0]).toMatchObject({ subagentType: 'issue-forge:refactor' })
    const stored = (store[key(16)] ?? store[`issue-forge:run:${ROOT}`]) as any
    expect(stored.greenCommit).toBe('c1')
  })

  test('gate G: a write-tree that meets a held index.lock waits a second and tries again; the gate goes on', async ($, on) => {
    const LOCKED = { stderr: `fatal: Unable to create '${LOCK_PATH}': File exists.\n`, code: 128, isLocked: true }
    const w = engine(on, { ...G_WORLD, gitFails: { on: 'write-tree', seq: [LOCKED] }, spawnHold: held() }, { [`issue-forge:run:${ROOT}`]: storedRun('gateG') })
    await start($)
    await run($, 'resume')
    for (let t = 0; t < 12_000 && w.spawned.length === 0 && !isBlocked(w); t += 50) await w.clock.advance(50)
    await w.clock.settle()
    expect(w.toasts.filter(t => t.includes('blocked'))).toEqual([])
    const trees = w.calls.filter(c => c.argv[0] === 'git' && c.argv[1] === 'write-tree')
    expect(trees.length).toBe(3)
    expect(trees[1]!.at - trees[0]!.at).toBeGreaterThanOrEqual(1000)
    expect(w.commits.length).toBe(1)
    expect(w.spawned[0]).toMatchObject({ subagentType: 'issue-forge:refactor' })
  })

  test('gate R: a path staged after the gate staged blocks it before the red commit', async ($, on) => {
    const w = engine(on, { ...R_WORLD, trees: ['1111111aaaa', '2222222bbbb'], spawnHold: held() }, { [`issue-forge:run:${ROOT}`]: storedRun('gateR', R_RUN) })
    await start($)
    await run($, 'resume')
    await until(w, () => isBlocked(w) || w.spawned.length > 0, 'a block or green')
    expect((await run($, 'status')).text).toContain('blocked at gateR: the index changed after gate R tested it (tested 1111111, now 2222222)')
    expect(w.commits.length).toBe(0)
    expect(w.spawned).toEqual([])
  })

  test('gate R: a replay with nothing staged keeps HEAD as the red commit, as before', async ($, on) => {
    const w = engine(on, { ...R_WORLD, hasChanges: false, spawnHold: held() }, { [`issue-forge:run:${ROOT}`]: storedRun('gateR', R_RUN) })
    await start($)
    await run($, 'resume')
    await until(w, () => w.spawned.length === 1 || isBlocked(w), 'green or a block')
    expect(w.toasts.filter(t => t.includes('blocked'))).toEqual([])
    expect(w.commits.length).toBe(0)
    expect(w.spawned[0]).toMatchObject({ subagentType: 'issue-forge:green' })
  })

  test('gate F: a path staged after the gate staged blocks it before the refactor commit', async ($, on) => {
    const w = engine(on, { ...G_WORLD, trees: ['1111111aaaa', '2222222bbbb'] }, { [`issue-forge:run:${ROOT}`]: storedRun('gateF', { greenCommit: 'c2', used: { red: 1, green: 1, refactor: 1 } }) })
    await start($)
    await run($, 'resume')
    await until(w, () => isBlocked(w) || w.asked.length > 0, 'a block or the push question')
    expect((await run($, 'status')).text).toContain('blocked at gateF: the index changed after gate F tested it (tested 1111111, now 2222222)')
    expect(w.commits.length).toBe(0)
    expect(w.asked).toEqual([])
  })
})

// PR #136 review round 1: commitAll reads HEAD and its tree from one commit object, "nothing to commit" means HEAD's tree is
// the tested one, and gate F publishes the head commitAll verified (Codex 4350587226, 4350587255).
describe('PR #136 review round 1: the commit commitAll verified', () => {
  const held = () => new Promise<void>(() => undefined)
  const G_WORLD = { head: BRANCH, staged: ['tests/a.test.ts', 'src/a.ts'], sinceRed: ['src/a.ts'], redPaths: ['tests/a.test.ts'] }
  const HOLD_STORE = { when: () => false, until: Promise.resolve() }
  const storedOf = (store: Record<string, unknown>) => (store[key(16)] ?? store[`issue-forge:run:${ROOT}`]) as any

  test("gate G: nothing staged by the index's own account, but HEAD's tree isn't the tested one: it commits the tested tree, not keep HEAD", async ($, on) => {
    const store: Record<string, unknown> = { [`issue-forge:run:${ROOT}`]: storedRun('gateG', { redCommit: 'r1' }) }
    const w = engine(on, { ...G_WORLD, hasChanges: false, trees: ['1111111aaaa'], commitTree: '4444444dddd', spawnHold: held(), storeHold: HOLD_STORE }, store)
    await start($)
    await run($, 'resume')
    await until(w, () => w.spawned.length > 0 || w.toasts.some(t => t.includes('blocked')), 'refactor or a block')
    expect(w.commits.length).toBe(1)
    expect(storedOf(store).greenCommit).toBe('c1')
  })

  test('gate F: the head it records is the commit whose tree it checked, though HEAD moved afterwards', async ($, on) => {
    const store: Record<string, unknown> = { [`issue-forge:run:${ROOT}`]: storedRun('gateF', { greenCommit: 'c0', used: { red: 1, green: 1, refactor: 1 } }) }
    const w = engine(on, { ...G_WORLD, revParseHead: 'f00dcafe', storeHold: HOLD_STORE }, store)
    await start($)
    await run($, 'resume')
    await until(w, () => w.asked.length > 0 || w.toasts.some(t => t.includes('blocked')), 'the push question or a block')
    expect(w.commits.length).toBe(1)
    expect(storedOf(store).refactorCommit).toBe('c1')
    expect(storedOf(store).gatedHead).toBe('c1')
  })
})

// PR #136 review round 1, Codex 4350587243: every check a gate makes judges the tree it tested, not the index at its own moment.
describe('PR #136 review round 1: the checks read the tested tree', () => {
  const held = () => new Promise<void>(() => undefined)

  test("gate G: the staged paths, the new manifests and the coverage diff are diffs to the tested tree; none reads the index", async ($, on) => {
    const w = engine(on, { head: BRANCH, staged: ['tests/a.test.ts', 'src/a.ts'], sinceRed: ['src/a.ts'], redPaths: ['tests/a.test.ts'], trees: ['5555555eeee'], spawnHold: held() }, { [`issue-forge:run:${ROOT}`]: storedRun('gateG') })
    await start($)
    await run($, 'resume')
    await until(w, () => w.spawned.length > 0 || w.toasts.some(t => t.includes('blocked')), 'refactor or a block')
    const diffs = w.argv.filter(a => a[0] === 'git' && a[1] === 'diff')
    expect(diffs.filter(a => a.includes('--cached'))).toEqual([])
    expect(diffs.find(a => a.includes('--diff-filter=A'))?.slice(-2)).toEqual(['base0', '5555555eeee'])
    expect(diffs.find(a => a.includes('-U0'))?.slice(-2)).toEqual(['base0', '5555555eeee'])
    expect(diffs.filter(a => a[2] === '--name-only' || a[1] === '--name-only').map(a => a.slice(-2))).toContainEqual(['c1', '5555555eeee'])
    expect(w.spawned[0]).toMatchObject({ subagentType: 'issue-forge:refactor' })
  })

  test('gate R: the staged paths and the new manifests are diffs to the tested tree', async ($, on) => {
    const w = engine(on, { head: BRANCH, testsExit: 1, staged: ['tests/a.test.ts'], redPaths: ['tests/a.test.ts'], trees: ['6666666ffff'], spawnHold: held() }, { [`issue-forge:run:${ROOT}`]: storedRun('gateR', { redCommit: undefined, used: { red: 1, green: 0, refactor: 0 }, agents: [] }) })
    await start($)
    await run($, 'resume')
    await until(w, () => w.spawned.length > 0 || w.toasts.some(t => t.includes('blocked')), 'green or a block')
    const diffs = w.argv.filter(a => a[0] === 'git' && a[1] === 'diff')
    expect(diffs.filter(a => a.includes('--cached'))).toEqual([])
    expect(diffs.find(a => a.includes('--diff-filter=A'))?.slice(-2)).toEqual(['base0', '6666666ffff'])
    expect(w.spawned[0]).toMatchObject({ subagentType: 'issue-forge:green' })
  })
})

// PR #136 review round 1, finding 7: with nothing to commit, a gate keeps HEAD only when it is new since the last commit the run
// recorded: gate F compares with the green commit or, when green committed nothing, the red commit.
describe('PR #136 review round 1: the commit a gate keeps', () => {
  const HOLD_STORE = { when: () => false, until: Promise.resolve() }
  const storedOf = (store: Record<string, unknown>) => (store[key(16)] ?? store[`issue-forge:run:${ROOT}`]) as any

  test("gate F with no green commit recorded and HEAD at red's commit records no refactor commit", async ($, on) => {
    const store: Record<string, unknown> = { [`issue-forge:run:${ROOT}`]: storedRun('gateF', { redCommit: 'c0', greenCommit: undefined, used: { red: 1, green: 1, refactor: 1 } }) }
    const w = engine(on, { head: BRANCH, hasChanges: false, staged: ['tests/a.test.ts', 'src/a.ts'], sinceRed: ['src/a.ts'], redPaths: ['tests/a.test.ts'], storeHold: HOLD_STORE }, store)
    await start($)
    await run($, 'resume')
    await until(w, () => w.asked.length > 0 || w.toasts.some(t => t.includes('blocked')), 'the push question or a block')
    expect(w.commits.length).toBe(0)
    expect(storedOf(store).refactorCommit).toBe(undefined)
  })
})

// PR #136 review round 1, finding 3, in the drive: gate G's checks passed, then the index changed before the commit.
describe('PR #136 review round 1: the gate record beside a block', () => {
  test("gate G's passing result and test tail are kept with its before-the-commit block", async ($, on) => {
    const store: Record<string, unknown> = { [`issue-forge:run:${ROOT}`]: storedRun('gateG') }
    const w = engine(on, { head: BRANCH, staged: ['tests/a.test.ts', 'src/a.ts'], sinceRed: ['src/a.ts'], redPaths: ['tests/a.test.ts'], trees: ['1111111aaaa', '2222222bbbb'], storeHold: { when: () => false, until: Promise.resolve() } }, store)
    await start($)
    await run($, 'resume')
    await until(w, () => w.toasts.some(t => t.includes('blocked')), 'the block')
    const stored = (store[key(16)] ?? store[`issue-forge:run:${ROOT}`]) as any
    expect(stored.step).toBe('blocked')
    expect(stored.gates?.G?.passed).toBe(true)
    expect(stored.lastTestTail).toBe('all pass')
  })
})

// PR #136 review round 1, finding 4: gates R and F, as gate G is tested above.
describe('PR #136 review round 1: gates R and F', () => {
  const held = () => new Promise<void>(() => undefined)
  const isBlocked = (w: World) => w.toasts.some(t => t.includes('blocked'))
  const isGit = (sub: string) => (a: string[]) => a[0] === 'git' && a.slice(1).join(' ') === sub
  const firstOf = (w: World, match: (a: string[]) => boolean) => w.argv.findIndex(match)
  const HOLD_STORE = { when: () => false, until: Promise.resolve() }
  const storedOf = (store: Record<string, unknown>) => (store[key(16)] ?? store[`issue-forge:run:${ROOT}`]) as any
  const STASH = { sha: 'abc1234def', message: 'issue-forge #16 green before behaviour test (run 16-1, attempt 1)' }
  const R_RUN = { redCommit: undefined, used: { red: 1, green: 0, refactor: 0 }, agents: [] }
  const R_WORLD = { head: BRANCH, testsExit: 1, staged: ['tests/a.test.ts'], redPaths: ['tests/a.test.ts'] }
  const G_WORLD = { head: BRANCH, staged: ['tests/a.test.ts', 'src/a.ts'], sinceRed: ['src/a.ts'], redPaths: ['tests/a.test.ts'] }
  const F_RUN = { greenCommit: 'g1', used: { red: 1, green: 1, refactor: 1 } }

  test("gate R: a commit whose tree isn't the tested one blocks after it, resets nothing, and green doesn't start", async ($, on) => {
    const w = engine(on, { ...R_WORLD, trees: ['1111111aaaa'], headTree: '3333333cccc', spawnHold: held() }, { [`issue-forge:run:${ROOT}`]: storedRun('gateR', R_RUN) })
    await start($)
    await run($, 'resume')
    await until(w, () => isBlocked(w) || w.spawned.length > 0, 'a block or green')
    expect((await run($, 'status')).text).toContain("blocked at gateR: commit c1 holds a tree gate R didn't test (3333333, tested 1111111)")
    expect(w.commits.length).toBe(1)
    expect(w.argv.some(a => a[0] === 'git' && a[1] === 'reset')).toBe(false)
    expect(w.spawned).toEqual([])
  })

  test("gate R's behaviour pass: an after-commit block leaves green's stash alone, and the resume applies it", async ($, on) => {
    const w = engine(
      on,
      { head: BRANCH, testsExit: 1, sinceRed: ['tests/b.ui.test.ts'], staged: ['tests/a.test.ts', 'tests/b.ui.test.ts'], stashList: `${STASH.sha}\tOn ${BRANCH}: ${STASH.message}\n`, trees: ['1111111aaaa'], headTree: '3333333cccc', spawnHold: held() },
      { [`issue-forge:run:${ROOT}`]: storedRun('gateR', { redCommit: 'r1', behaviourFor: ['src/register.tsx'], greenStash: STASH, used: { red: 1, green: 1, refactor: 0 }, agents: [] }) },
    )
    await start($)
    await run($, 'resume')
    await until(w, () => isBlocked(w), 'the block')
    expect((await run($, 'status')).text).toContain("blocked at gateR: commit c1 holds a tree gate R didn't test")
    expect(w.argv.some(a => a[1] === 'stash' && a[2] === 'apply')).toBe(false)
    // The index is the commit now: the resume tests it, keeps it and restores green's work.
    w.headTree = undefined
    w.trees = ['3333333cccc']
    w.hasChanges = false
    await run($, 'resume')
    await until(w, () => w.argv.some(a => a[1] === 'stash' && a[2] === 'apply'), "green's stash applied")
    expect(w.argv.filter(a => a[1] === 'stash' && a[2] === 'apply')).toEqual([['git', 'stash', 'apply', STASH.sha]])
    expect(w.commits.length).toBe(1)
  })

  test("gate F: a commit whose tree isn't the tested one blocks after it, and the run asks nothing about pushing", async ($, on) => {
    const w = engine(on, { ...G_WORLD, trees: ['1111111aaaa'], headTree: '3333333cccc' }, { [`issue-forge:run:${ROOT}`]: storedRun('gateF', F_RUN) })
    await start($)
    await run($, 'resume')
    await until(w, () => isBlocked(w) || w.asked.length > 0, 'a block or the push question')
    expect((await run($, 'status')).text).toContain("blocked at gateF: commit c1 holds a tree gate F didn't test (3333333, tested 1111111)")
    expect(w.commits.length).toBe(1)
    expect(w.asked).toEqual([])
  })

  test('gate F: a replay with nothing to commit keeps HEAD, new since green, as the refactor commit and the head it publishes', async ($, on) => {
    const store: Record<string, unknown> = { [`issue-forge:run:${ROOT}`]: storedRun('gateF', F_RUN) }
    const w = engine(on, { ...G_WORLD, hasChanges: false, storeHold: HOLD_STORE }, store)
    await start($)
    await run($, 'resume')
    await until(w, () => isBlocked(w) || w.asked.length > 0, 'a block or the push question')
    expect(w.commits.length).toBe(0)
    expect(storedOf(store)).toMatchObject({ refactorCommit: 'c0', gatedHead: 'c0' })
  })

  test('gate R records the tested tree after staging and before the tests', async ($, on) => {
    const r = engine(on, { ...R_WORLD, spawnHold: held() }, { [`issue-forge:run:${ROOT}`]: storedRun('gateR', R_RUN) })
    await start($)
    await run($, 'resume')
    await until(r, () => isBlocked(r) || r.spawned.length > 0, 'a block or green')
    expect(firstOf(r, isGit('add -A'))).toBeLessThan(firstOf(r, isGit('write-tree')))
    expect(firstOf(r, isGit('write-tree'))).toBeLessThan(firstOf(r, a => a[0] === 't'))
  })

  test('gate F records the tested tree after staging and before the tests', async ($, on) => {
    const w = engine(on, { ...G_WORLD }, { [`issue-forge:run:${ROOT}`]: storedRun('gateF', F_RUN) })
    await start($)
    await run($, 'resume')
    await until(w, () => isBlocked(w) || w.asked.length > 0, 'a block or the push question')
    expect(firstOf(w, isGit('add -A'))).toBeLessThan(firstOf(w, isGit('write-tree')))
    expect(firstOf(w, isGit('write-tree'))).toBeLessThan(firstOf(w, a => a[0] === 't'))
  })
})

// PR #136 review round 1, a probe on git 2.53: with log.showSignature on, git log prints a signature line before the format's
// output, so the read of HEAD and its tree turns signature checking off for itself.
describe('PR #136 review round 1: log.showSignature', () => {
  test('gate G commits and goes on in a repository that shows commit signatures in git log', async ($, on) => {
    const w = engine(on, { head: BRANCH, staged: ['tests/a.test.ts', 'src/a.ts'], sinceRed: ['src/a.ts'], redPaths: ['tests/a.test.ts'], showSignature: true, spawnHold: new Promise<void>(() => undefined) }, { [`issue-forge:run:${ROOT}`]: storedRun('gateG') })
    await start($)
    await run($, 'resume')
    await until(w, () => w.spawned.length > 0 || w.toasts.some(t => t.includes('blocked')), 'refactor or a block')
    expect(w.toasts.filter(t => t.includes('blocked'))).toEqual([])
    expect(w.commits.length).toBe(1)
    expect(w.spawned[0]).toMatchObject({ subagentType: 'issue-forge:refactor' })
  })
})

// PR #136 review round 2: Codex 4351786036 (replacement refs) and finding 3 (another commit during the commit).
describe('PR #136 review round 2: the commit read', () => {
  const held = () => new Promise<void>(() => undefined)
  const G_WORLD = { head: BRANCH, staged: ['tests/a.test.ts', 'src/a.ts'], sinceRed: ['src/a.ts'], redPaths: ['tests/a.test.ts'] }
  const HOLD_STORE = { when: () => false, until: Promise.resolve() }
  const storedOf = (store: Record<string, unknown>) => (store[key(16)] ?? store[`issue-forge:run:${ROOT}`]) as any

  test("gate G: a replacement ref whose tree is the tested one doesn't make HEAD's own tree pass for it", async ($, on) => {
    const store: Record<string, unknown> = { [`issue-forge:run:${ROOT}`]: storedRun('gateG', { redCommit: 'r1' }) }
    const w = engine(on, { ...G_WORLD, hasChanges: false, trees: ['1111111aaaa'], commitTree: '4444444dddd', replacedTree: '1111111aaaa', spawnHold: held(), storeHold: HOLD_STORE }, store)
    await start($)
    await run($, 'resume')
    await until(w, () => w.spawned.length > 0 || w.toasts.some(t => t.includes('blocked')), 'refactor or a block')
    expect(w.commits.length).toBe(1)
    expect(storedOf(store).greenCommit).toBe('c1')
  })

  test("gate G: a commit whose parent isn't the HEAD from before blocks, naming another commit, not the gate's own", async ($, on) => {
    const w = engine(on, { ...G_WORLD, headParent: 'f00dcafe99', spawnHold: held() }, { [`issue-forge:run:${ROOT}`]: storedRun('gateG') })
    await start($)
    await run($, 'resume')
    await until(w, () => w.spawned.length > 0 || w.toasts.some(t => t.includes('blocked')), 'refactor or a block')
    const status = (await run($, 'status')).text ?? ''
    expect(status).toContain("blocked at gateG: another commit moved the branch during gate G's commit (HEAD c1, whose parent is f00dcaf, not c0)")
    expect(status).toContain("next: see what landed (git log -3) and put the branch back on gate G's commit by hand, then /issue-forge resume")
    expect(w.spawned).toEqual([])
  })
})

// PR #136 review round 2, finding 1: a rejected refactor publishes green's commit, so publish's tip check blocks a branch that
// moved, instead of a fresh read of HEAD that no tree check covered.
describe('PR #136 review round 2: a rejected refactor', () => {
  test("gate F's rejected refactor records green's commit as the head to publish, though HEAD moved", async ($, on) => {
    // Resume gives the phase its attempts again, so a profile with no refactor retry sends the failed gate F to the stash.
    const noRetry = storedRun('gateF', { greenCommit: 'g1', used: { red: 1, green: 1, refactor: 1 } })
    const store: Record<string, unknown> = { [`issue-forge:run:${ROOT}`]: { ...noRetry, profile: { ...noRetry.profile, attempts: { red: 2, green: 3, refactor: 0 } } } }
    const w = engine(on, { head: BRANCH, testsExit: 1, staged: ['tests/a.test.ts', 'src/a.ts'], sinceRed: ['src/a.ts'], redPaths: ['tests/a.test.ts'], revParseHead: 'f00dcafe', storeHold: { when: () => false, until: Promise.resolve() } }, store)
    await start($)
    await run($, 'resume')
    await until(w, () => w.asked.length > 0 || w.toasts.some(t => t.includes('blocked')), 'the push question or a block')
    const stored = (store[key(16)] ?? store[`issue-forge:run:${ROOT}`]) as any
    expect(stored.isRefactorRejected).toBe(true)
    expect(stored.gatedHead).toBe('g1')
  })
})

// PR #136 review round 2, finding 4, in the drive: errors during the commit keep the gate's result.
describe('PR #136 review round 2: errors during the commit', () => {
  const LOCKED = { stderr: `fatal: Unable to create '${LOCK_PATH}': File exists.\n`, code: 128, isLocked: true }
  const G_WORLD = { head: BRANCH, staged: ['tests/a.test.ts', 'src/a.ts'], sinceRed: ['src/a.ts'], redPaths: ['tests/a.test.ts'] }
  const HOLD_STORE = { when: () => false, until: Promise.resolve() }
  const storedOf = (store: Record<string, unknown>) => (store[key(16)] ?? store[`issue-forge:run:${ROOT}`]) as any
  const isBlocked = (w: World) => w.toasts.some(t => t.includes('blocked'))

  test("gate G: a commit that a hook fails blocks, naming the hook, with the gate's passing result kept", async ($, on) => {
    const store: Record<string, unknown> = { [`issue-forge:run:${ROOT}`]: storedRun('gateG') }
    const w = engine(on, { ...G_WORLD, gitFails: { on: 'commit', seq: [{ stderr: '- files were modified by this hook\n', code: 1, isLocked: false }] }, storeHold: HOLD_STORE }, store)
    await start($)
    await run($, 'resume')
    await until(w, () => isBlocked(w), 'the block')
    const status = (await run($, 'status')).text ?? ''
    expect(status).toContain('blocked at gateG: gate G passed, but git commit failed: - files were modified by this hook')
    expect(storedOf(store).gates?.G?.passed).toBe(true)
    expect(storedOf(store).lastTestTail).toBe('all pass')
  })

  test("gate G: a commit that meets the lock five times blocks naming the lock, with the gate's passing result kept", async ($, on) => {
    const store: Record<string, unknown> = { [`issue-forge:run:${ROOT}`]: storedRun('gateG') }
    const w = engine(on, { ...G_WORLD, gitFails: { on: 'commit', seq: [LOCKED, LOCKED, LOCKED, LOCKED, LOCKED] }, storeHold: HOLD_STORE }, store)
    await start($)
    await run($, 'resume')
    for (let t = 0; t < 12_000 && !isBlocked(w); t += 50) await w.clock.advance(50)
    await w.clock.settle()
    expect((await run($, 'status')).text).toContain(`blocked at gateG: another git process is using ${LOCK_PATH}`)
    expect(storedOf(store).gates?.G?.passed).toBe(true)
  })
})

// #137 (Change 0.8.0): with a profile formatCommand, each gate stages, formats, stages again, then records the tree it tests;
// a format command that fails fails the gate before anything is tested, and the phase gets another attempt.
describe('#137: the profile formatCommand', () => {
  const held = () => new Promise<void>(() => undefined)
  const isBlocked = (w: World) => w.toasts.some(t => t.includes('blocked'))
  const isGit = (sub: string) => (a: string[]) => a[0] === 'git' && a.slice(1).join(' ') === sub
  const FORMATTED = { ...storedRun('gateG').profile, formatCommand: ['f', '--write'], checks: [['t2']] }
  const R_RUN = { redCommit: undefined, used: { red: 1, green: 0, refactor: 0 }, agents: [], profile: FORMATTED }
  const R_WORLD = { head: BRANCH, testsExit: 1, staged: ['tests/a.test.ts'], redPaths: ['tests/a.test.ts'] }
  const G_WORLD = { head: BRANCH, staged: ['tests/a.test.ts', 'src/a.ts'], sinceRed: ['src/a.ts'], redPaths: ['tests/a.test.ts'] }
  const G_RUN = { profile: FORMATTED }
  const F_RUN = { greenCommit: 'g1', used: { red: 1, green: 1, refactor: 1 }, profile: { ...FORMATTED, attempts: { red: 2, green: 3, refactor: 2 } } }
  /** The gate's staging, format, tree and test calls, in order, up to the first test run. */
  const sequence = (w: World) => {
    const tests = w.argv.findIndex(a => a[0] === 't')
    return w.argv
      .slice(0, tests === -1 ? undefined : tests + 1)
      .filter(a => isGit('add -A')(a) || isGit('write-tree')(a) || a[0] === 'f' || a[0] === 't')
      .map(a => a.join(' '))
  }
  /** What ran after the format command: no tree, test, coverage or check may follow a failed one. */
  const afterFormat = (w: World) => {
    const at = w.argv.findIndex(a => a[0] === 'f')
    return at === -1 ? ['the format command never ran'] : w.argv.slice(at + 1).filter(a => isGit('write-tree')(a) || isGit('add -A')(a) || ['t', 'c', 't2'].includes(a[0] ?? '')).map(a => a.join(' '))
  }

  test('gate R: add -A, the format command, add -A again, then write-tree and the tests', async ($, on) => {
    const w = engine(on, { ...R_WORLD, spawnHold: held() }, { [`issue-forge:run:${ROOT}`]: storedRun('gateR', R_RUN) })
    await start($)
    await run($, 'resume')
    await until(w, () => isBlocked(w) || w.spawned.length > 0, 'a block or green')
    expect(sequence(w)).toEqual(['git add -A', 'f --write', 'git add -A', 'git write-tree', 't'])
    expect(w.commits.length).toBe(1)
    expect(w.spawned[0]).toMatchObject({ subagentType: 'issue-forge:green' })
  })

  test('gate G: the same order, before the tests, coverage and checks', async ($, on) => {
    const w = engine(on, { ...G_WORLD, spawnHold: held() }, { [`issue-forge:run:${ROOT}`]: storedRun('gateG', G_RUN) })
    await start($)
    await run($, 'resume')
    await until(w, () => isBlocked(w) || w.spawned.length > 0, 'a block or refactor')
    expect(sequence(w)).toEqual(['git add -A', 'f --write', 'git add -A', 'git write-tree', 't'])
    expect(w.argv.findIndex(a => a[0] === 'f')).toBeLessThan(w.argv.findIndex(a => a[0] === 't2'))
    expect(w.spawned[0]).toMatchObject({ subagentType: 'issue-forge:refactor' })
  })

  test('gate F: the same order', async ($, on) => {
    const w = engine(on, { ...G_WORLD }, { [`issue-forge:run:${ROOT}`]: storedRun('gateF', F_RUN) })
    await start($)
    await run($, 'resume')
    await until(w, () => isBlocked(w) || w.asked.length > 0, 'a block or the push question')
    expect(sequence(w)).toEqual(['git add -A', 'f --write', 'git add -A', 'git write-tree', 't'])
  })

  test('gate R: a format command that fails fails gate R with R5 before anything is tested, and red gets another attempt with its output', async ($, on) => {
    const w = engine(on, { ...R_WORLD, formatExit: 2, spawnHold: held() }, { [`issue-forge:run:${ROOT}`]: storedRun('gateR', R_RUN) })
    await start($)
    await run($, 'resume')
    await until(w, () => isBlocked(w) || w.spawned.length > 0, 'a block or red')
    expect(afterFormat(w)).toEqual([])
    expect(w.commits.length).toBe(0)
    expect(w.spawned[0]).toMatchObject({ subagentType: 'issue-forge:red' })
    expect(w.spawned[0]?.prompt).toContain('- R5: format command failed: f --write (exit 2)')
    expect(w.spawned[0]?.prompt).toContain('src/a.ts: SyntaxError: Unexpected token (3:1)')
  })

  test('gate G: a format command that fails fails gate G with G9, no tree, test, coverage or check follows, and green tries again', async ($, on) => {
    const w = engine(on, { ...G_WORLD, formatExit: 1, spawnHold: held() }, { [`issue-forge:run:${ROOT}`]: storedRun('gateG', G_RUN) })
    await start($)
    await run($, 'resume')
    await until(w, () => isBlocked(w) || w.spawned.length > 0, 'a block or green')
    expect(afterFormat(w)).toEqual([])
    expect(w.commits.length).toBe(0)
    expect(w.spawned[0]).toMatchObject({ subagentType: 'issue-forge:green' })
    expect(w.spawned[0]?.prompt).toContain('- G9: format command failed: f --write (exit 1)')
    expect(w.spawned[0]?.prompt).toContain("The last lines of the format command's output:")
  })

  test('gate F: a format command that fails fails gate F with G9, and refactor tries again', async ($, on) => {
    const w = engine(on, { ...G_WORLD, formatExit: 1, spawnHold: held() }, { [`issue-forge:run:${ROOT}`]: storedRun('gateF', F_RUN) })
    await start($)
    await run($, 'resume')
    await until(w, () => isBlocked(w) || w.spawned.length > 0 || w.asked.length > 0, 'a block, refactor or the push question')
    expect(afterFormat(w)).toEqual([])
    expect(w.commits.length).toBe(0)
    expect(w.asked).toEqual([])
    expect(w.spawned[0]).toMatchObject({ subagentType: 'issue-forge:refactor' })
    expect(w.spawned[0]?.prompt).toContain('- G9: format command failed: f --write (exit 1)')
  })

  test("gate F: a format command that fails on the refactor's last attempt rejects it as any failed check does: stashed, green's commit to publish", async ($, on) => {
    // Resume gives the phase its attempts again, so a profile with no refactor retry is what rejects the refactor.
    const store: Record<string, unknown> = { [`issue-forge:run:${ROOT}`]: storedRun('gateF', { ...F_RUN, profile: { ...FORMATTED, attempts: { red: 2, green: 3, refactor: 0 } } }) }
    const w = engine(on, { ...G_WORLD, formatExit: 1, storeHold: { when: () => false, until: Promise.resolve() } }, store)
    await start($)
    await run($, 'resume')
    await until(w, () => w.asked.length > 0 || isBlocked(w), 'the push question or a block')
    expect(w.argv.some(a => a[0] === 'git' && a[1] === 'stash' && a[2] === 'push')).toBe(true)
    const stored = (store[key(16)] ?? store[`issue-forge:run:${ROOT}`]) as any
    expect(stored).toMatchObject({ step: 'ready', isRefactorRejected: true, gatedHead: 'g1' })
  })

  test("gate G: what the format command rewrites is staged by the second add -A, so the rewritten-files look doesn't block", async ($, on) => {
    const w = engine(on, { ...G_WORLD, formatWrites: ' M src/a.ts\0', spawnHold: held() }, { [`issue-forge:run:${ROOT}`]: storedRun('gateG', G_RUN) })
    await start($)
    await run($, 'resume')
    await until(w, () => isBlocked(w) || w.spawned.length > 0, 'a block or refactor')
    expect(w.argv.some(a => a[0] === 'f')).toBe(true)
    expect(w.toasts.filter(t => t.includes('blocked'))).toEqual([])
    expect(w.commits.length).toBe(1)
  })

  test('without the key, nothing extra runs: one add -A, then write-tree, as in 0.7.5', async ($, on) => {
    const w = engine(on, { ...G_WORLD, spawnHold: held() }, { [`issue-forge:run:${ROOT}`]: storedRun('gateG') })
    await start($)
    await run($, 'resume')
    await until(w, () => isBlocked(w) || w.spawned.length > 0, 'a block or refactor')
    expect(sequence(w)).toEqual(['git add -A', 'git write-tree', 't'])
  })

  test('a command that rewrites files after staging is pointed at formatCommand', async ($, on) => {
    const w = engine(on, { ...G_WORLD, porcelainZ: ' M src/a.ts\0' }, { [`issue-forge:run:${ROOT}`]: storedRun('gateG') })
    await start($)
    await run($, 'resume')
    await until(w, () => isBlocked(w), 'the block')
    expect((await run($, 'status')).text).toContain('next: make the profile commands leave the tree as they found it, or put the formatter in formatCommand')
  })
})

// #140 (Change 0.9.0): before a new run is written, the store is swept (finished records trimmed, the oldest finished runs of
// any repository deleted past the budget); finished runs are stored trimmed; status names old unfinished runs.
describe('#140: the store under its limit', () => {
  const OTHER = (issue: number) => `issue-forge:repo-run:/other/.git#${issue}`
  const otherRun = (issue: number, step: string, startedAt: number, extra: Record<string, unknown> = {}) => ({ ...storedRun(step), id: `${issue}-1`, root: '/other', repo: '/other/.git', issue, startedAt, agents: [], ...extra })
  const HOLD = () => ({ when: () => false, until: Promise.resolve() })
  const TRIMMED = ['lastTestTail', 'redTestTail', 'redAnswer', 'behaviourAnswer']
  const storedOf = (store: Record<string, unknown>) => (store[key(16)] ?? store[`issue-forge:run:${ROOT}`]) as any

  test("a start trims another repository's finished record written before 0.9.0, and keeps it when that is enough", async ($, on) => {
    const store: Record<string, unknown> = { [OTHER(5)]: otherRun(5, 'done', 0, { lastTestTail: 'T'.repeat(30_000), redAnswer: 'notes', body: 'b'.repeat(2000) }) }
    const w = engine(on, { storeHold: HOLD() }, store)
    await start($)
    expect((await run($, '16')).text).toContain('starting #16')
    const kept = store[OTHER(5)] as any
    expect(kept).toBeDefined()
    for (const field of TRIMMED) expect(field in kept).toBe(false)
    expect(kept.body).toBe(`${'b'.repeat(500)}…`)
    expect(w.toasts.filter(t => t.includes('MiB'))).toEqual([])
  })

  test("a start over the budget deletes another repository's oldest finished run before the new run is written", async ($, on) => {
    const store: Record<string, unknown> = {
      [OTHER(5)]: otherRun(5, 'done', 0, { title: 'x'.repeat(2_000_000) }),
      [OTHER(6)]: otherRun(6, 'stopped', 1, { title: 'y'.repeat(1_500_000) }),
    }
    const storeOps: string[] = []
    const w = engine(on, { storeHold: HOLD(), storeOps }, store)
    await start($)
    expect((await run($, '16')).text).toContain('starting #16')
    expect(OTHER(5) in store).toBe(false)
    expect(OTHER(6) in store).toBe(true)
    const deleted = storeOps.indexOf(`delete ${OTHER(5)}`)
    expect(deleted).toBeGreaterThan(-1)
    expect(deleted).toBeLessThan(storeOps.indexOf(`set ${key(16)}`))
    expect(w.toasts.filter(t => t.includes('MiB'))).toEqual([])
  })

  test('a start over the budget with only unfinished runs left warns once, deletes nothing, and the run starts', async ($, on) => {
    const store: Record<string, unknown> = { [OTHER(7)]: otherRun(7, 'blocked', 0, { title: 'z'.repeat(3_300_000) }) }
    const w = engine(on, { storeHold: HOLD() }, store)
    await start($)
    expect((await run($, '16')).text).toContain('starting #16')
    expect(OTHER(7) in store).toBe(true)
    const warnings = w.toasts.filter(t => t.includes("of Claude Code's limit after the cleanup: 1 unfinished run in 1 repository left"))
    expect(warnings.length).toBe(1)
    expect(warnings[0]).toStartWith('store still at 79%')
  })

  // PR #145 review round 1, finding 3: the sweep's guards. Its second read of a key is the re-read before the write.
  test('a finished record another session restarted between the sweep\'s read and its re-read is left alone, not trimmed', async ($, on) => {
    const store: Record<string, unknown> = { [OTHER(5)]: otherRun(5, 'done', 0, { lastTestTail: 'T'.repeat(30_000) }) }
    const restarted = otherRun(5, 'green', 5, { id: '5-2', lastTestTail: 'live tail' })
    engine(on, { storeHold: HOLD(), onStoreGet: (key, reads) => void (key === OTHER(5) && reads === 2 && (store[OTHER(5)] = restarted)) }, store)
    await start($)
    expect((await run($, '16')).text).toContain('starting #16')
    expect(store[OTHER(5)]).toEqual(restarted)
  })

  test('a finished run another session restarted before the delete is kept, and the size it would have freed still counts', async ($, on) => {
    const store: Record<string, unknown> = { [OTHER(5)]: otherRun(5, 'done', 0, { title: 'x'.repeat(3_300_000) }) }
    const restarted = otherRun(5, 'green', 5, { id: '5-2', title: 'x'.repeat(3_300_000) })
    const w = engine(on, { storeHold: HOLD(), onStoreGet: (key, reads) => void (key === OTHER(5) && reads === 2 && (store[OTHER(5)] = restarted)) }, store)
    await start($)
    expect((await run($, '16')).text).toContain('starting #16')
    // The id, not the record: a failure that printed 3.3 MB of title would end the test run without a report.
    expect((store[OTHER(5)] as any)?.id).toBe('5-2')
    expect(w.toasts.filter(t => t.startsWith('store still at '))).toHaveLength(1)
  })

  // PR #145 review round 3, finding 4: a sweep that fails leaves a line in the transcript, and the run still starts.
  test('a sweep that fails writes "store sweep failed" to the transcript, and the run starts', async ($, on) => {
    // The issue is read just before the run is begun, so the next listing of the store is the sweep's.
    let w: World | null = null
    w = engine(on, { storeHold: HOLD(), beforeIssueView: () => void (w && (w.storeKeysFailNext = true)) }, {})
    await start($)
    expect((await run($, '16')).text).toContain('starting #16')
    expect(w.logs.filter(line => line.startsWith('store sweep failed: '))).toHaveLength(1)
  })

  // PR #145 review round 4 (Codex 4361674892): unfinished runs alone fill the store, which the sweep never empties, so
  // Claude Code refuses the new run; the answer says so and how to free it.
  test("a start the store refuses answers that it wasn't started and how to free the store, and starts nothing", async ($, on) => {
    const LIMIT = 4_194_304
    // One unfinished run 100 characters under Claude Code's limit: any new run takes it over.
    const pad = LIMIT - JSON.stringify({ [OTHER(7)]: otherRun(7, 'blocked', 0, { title: '' }) }).length - 100
    const store: Record<string, unknown> = { [OTHER(7)]: otherRun(7, 'blocked', 0, { title: 'z'.repeat(pad) }) }
    const w = engine(on, { storeHold: HOLD(), storeLimit: LIMIT }, store)
    await start($)
    const text = (await run($, '16')).text
    expect(text).toContain("#16 wasn't started")
    expect(text).toContain(`over the ${LIMIT} limit`)
    expect(text).toContain('/issue-forge stop <N>')
    expect(key(16) in store).toBe(false)
    expect(w.spawned).toHaveLength(0)
  })

  // PR #145 review round 3, finding 2 (Codex 4361161666): two starts at once both plan the same delete; the second finds it gone.
  test('a run another session deleted before the re-read counts as freed, so a clean store shows no warning', async ($, on) => {
    const store: Record<string, unknown> = { [OTHER(5)]: otherRun(5, 'done', 0, { title: 'x'.repeat(3_300_000) }) }
    const w = engine(on, { storeHold: HOLD(), onStoreGet: (key, reads) => void (key === OTHER(5) && reads === 2 && delete store[OTHER(5)]) }, store)
    await start($)
    expect((await run($, '16')).text).toContain('starting #16')
    expect(OTHER(5) in store).toBe(false)
    expect(w.toasts.filter(t => t.startsWith('store still at '))).toEqual([])
  })

  // PR #145 review round 2, finding 1 (Codex 4360654720): the counts come from what the re-reads found, not the first read.
  test('the warning counts a run another session restarted before the delete as unfinished', async ($, on) => {
    const store: Record<string, unknown> = { [OTHER(5)]: otherRun(5, 'done', 0, { title: 'x'.repeat(3_300_000) }) }
    const restarted = otherRun(5, 'green', 5, { id: '5-2', title: 'x'.repeat(3_300_000) })
    const w = engine(on, { storeHold: HOLD(), onStoreGet: (key, reads) => void (key === OTHER(5) && reads === 2 && (store[OTHER(5)] = restarted)) }, store)
    await start($)
    await run($, '16')
    const warning = w.toasts.find(t => t.startsWith('store still at ')) ?? ''
    expect(warning).toContain('1 unfinished run in 1 repository left')
  })

  test('the warning shows once a session: a second start over the budget shows no second toast', async ($, on) => {
    const HERE = { ...PROFILE, workspace: 'here' }
    const store: Record<string, unknown> = { [OTHER(7)]: otherRun(7, 'blocked', 0, { title: 'z'.repeat(3_300_000) }) }
    const w = engine(on, { storeHold: HOLD(), isDirty: true, localProfile: HERE, baseProfile: HERE }, store)
    await start($)
    expect((await run($, '16')).text).toContain('starting #16')
    await until(w, () => w.toasts.some(t => t.startsWith('#16 blocked')), "#16's block")
    w.answer = 'Start #17 here (Recommended)'
    await run($, '17')
    await until(w, () => w.toasts.some(t => t.startsWith('#17 blocked')), "#17's block")
    expect(w.toasts.filter(t => t.startsWith('store still at '))).toHaveLength(1)
  })

  // PR #145 review round 1, finding 4: one failed read is skipped, not the end of the sweep.
  test('a key whose read fails is skipped, and the sweep still trims the rest', async ($, on) => {
    const store: Record<string, unknown> = {
      [OTHER(4)]: otherRun(4, 'done', 0, { lastTestTail: 'T'.repeat(30_000) }),
      [OTHER(5)]: otherRun(5, 'done', 1, { lastTestTail: 'T'.repeat(30_000) }),
    }
    engine(on, { storeHold: HOLD(), storeGetFails: [OTHER(4)] }, store)
    await start($)
    expect((await run($, '16')).text).toContain('starting #16')
    expect('lastTestTail' in (store[OTHER(5)] as any)).toBe(false)
    expect('lastTestTail' in (store[OTHER(4)] as any)).toBe(true)
  })

  // PR #145 review round 2, finding 2: a 3.3 MB run the sweep can't read would otherwise weigh nothing, and nothing would warn.
  test("a key the sweep can't read makes the warning show, naming it, though the rest measures under the budget", async ($, on) => {
    const store: Record<string, unknown> = { [OTHER(6)]: otherRun(6, 'blocked', 0, { title: 'z'.repeat(3_300_000) }) }
    const w = engine(on, { storeHold: HOLD(), storeGetFails: [OTHER(6)] }, store)
    await start($)
    expect((await run($, '16')).text).toContain('starting #16')
    expect(w.toasts.filter(t => t.endsWith("1 key couldn't be read and isn't counted; 1 unfinished run in 1 repository left: /issue-forge stop <N>, in a run's repository, ends one"))).toHaveLength(0)
    expect(w.toasts.filter(t => t.endsWith(": 1 key couldn't be read and isn't counted"))).toHaveLength(1)
  })

  // PR #145 review round 1, finding 1 (Codex 4359421020): migrate() leaves another checkout's pre-0.3 record where it is.
  test("a start trims a finished pre-0.3 record of another checkout, which migration leaves under its old key", async ($, on) => {
    const LEGACY = 'issue-forge:run:/elsewhere'
    const store: Record<string, unknown> = { [LEGACY]: { ...otherRun(9, 'done', 0, { lastTestTail: 'T'.repeat(30_000), body: 'b'.repeat(2000) }), root: '/elsewhere' } }
    engine(on, { storeHold: HOLD() }, store)
    await start($)
    expect((await run($, '16')).text).toContain('starting #16')
    const kept = store[LEGACY] as any
    expect(kept).toBeDefined()
    expect('lastTestTail' in kept).toBe(false)
    expect(kept.body).toBe(`${'b'.repeat(500)}…`)
  })

  test('a stopped run is stored trimmed', async ($, on) => {
    const store: Record<string, unknown> = { [`issue-forge:run:${ROOT}`]: storedRun('green', { redAnswer: 'notes', lastTestTail: 'last', redTestTail: 'red', body: 'b'.repeat(600) }) }
    engine(on, { storeHold: HOLD() }, store)
    await start($)
    expect((await run($, 'stop')).text).toContain('stopped #16')
    const stopped = storedOf(store)
    expect(stopped.step).toBe('stopped')
    for (const field of TRIMMED) expect(field in stopped).toBe(false)
    expect(stopped.body).toBe(`${'b'.repeat(500)}…`)
  })

  test("a published run is stored trimmed, and its pull request still carries the red agent's answer", async ($, on) => {
    const store: Record<string, unknown> = { [`issue-forge:run:${ROOT}`]: storedRun('ready', { greenCommit: 'c2', gatedHead: 'c0', redAnswer: 'RED NOTES', body: 'b'.repeat(600) }) }
    const w = engine(on, { head: BRANCH, storeHold: HOLD() }, store)
    await start($)
    await run($, 'publish')
    await until(w, () => w.toasts.some(t => t.startsWith('PR opened')), 'the PR')
    await w.clock.settle()
    const done = storedOf(store)
    expect(done.step).toBe('done')
    expect('redAnswer' in done).toBe(false)
    expect(done.body).toBe(`${'b'.repeat(500)}…`)
    expect(Object.values(w.files).some(text => text.includes('RED NOTES'))).toBe(true)
  })

  test('status names an unfinished run started 8 days ago, with its stop command', async ($, on) => {
    const LINE = 'unfinished for over 7 days: #8 blocked (started 8 days ago); /issue-forge stop <N> ends one and keeps its branch and commits'
    const store: Record<string, unknown> = {
      [key(16)]: storedRun('green'),
      [key(8)]: { ...storedRun('blocked'), id: '8-1', issue: 8, startedAt: 1_000_000 - 8 * 86_400_000, blocked: { at: 'gateG', reason: 'why', next: 'do this' } },
    }
    engine(on, {}, store)
    await start($)
    expect((await run($, 'status')).text).toContain(LINE)
    expect((await run($, 'status 8')).text).toContain(LINE)
    expect((await run($, 'status 16')).text).toContain(LINE)
    // PR #145 review round 2, finding 8: an issue with no run here answers with the stale line too.
    expect((await run($, 'status 99')).text).toContain(LINE)
  })
})

// A drive that ends, ends its agents (SPEC Change 0.9.1). The rows are `$.agent.list()`'s as Claude Code 2.1.310 gave them
// (#40's probe); a kit spawn never gets an agent id, so an agent the run started is matched by its name.
describe('#40: a drive that ends, ends its agents', () => {
  const row = (id: string, name: string | undefined, phase: string, status = 'running', extra: Record<string, unknown> = {}) => ({
    id,
    ...(name ? { name } : {}),
    description: `issue-forge #16 ${phase}`,
    type: `issue-forge:${phase}`,
    status,
    spawnedBy: 'issue-forge',
    ...extra,
  })
  const oldGreen = (status = 'running') => row('old-green', 'issue-forge-16-green-1', 'green', status)
  const newGreen = (status = 'running') => row('a77', 'issue-forge-16-green-2', 'green', status)
  const held = () => new Promise<void>(() => undefined)
  const WORKTREE = { ...PROFILE, workspace: 'worktree' }

  test("a stop ends the run's agent that is still going, and says it has stopped; one it doesn't know or didn't start is left alone", async ($, on) => {
    const listed = [[oldGreen(), row('stranger', undefined, 'red'), row('lookalike', 'issue-forge-16-red-1', 'red', 'running', { spawnedBy: 'other-mod' })], [oldGreen('killed')]]
    const w = engine(on, { listed }, { [`issue-forge:run:${ROOT}`]: storedRun('green') })
    await start($)
    const text = (await run($, 'stop')).text
    expect(w.taskStops).toEqual(['old-green'])
    expect(text).toBe(`stopped #16. Its branch ${BRANCH} and commits are kept; its green agent (issue-forge-16-green-1) has stopped.`)
  })

  test('a TaskStop that is refused leaves the agent going, and the answer says so, with the reason', async ($, on) => {
    const w = engine(on, { listed: [[oldGreen()]], taskStopAnswer: { deny: 'no' } }, { [`issue-forge:run:${ROOT}`]: storedRun('green') })
    await start($)
    const text = (await run($, 'stop')).text
    expect(w.taskStops).toEqual(['old-green'])
    expect(text).toContain("kept; its green agent (issue-forge-16-green-1) wasn't stopped (no), so it may keep working until its turn ends.")
    expect(text).not.toContain('refused')
  })

  test('an agent that already finished: no TaskStop, and the answer says no agent was running', async ($, on) => {
    const w = engine(on, { listed: [[oldGreen('completed')]] }, { [`issue-forge:run:${ROOT}`]: storedRun('green') })
    await start($)
    expect((await run($, 'stop')).text).toContain('kept; no agent was running.')
    expect(w.taskStops).toEqual([])
  })

  test("a run with no agents: no TaskStop, even for a listed agent of another run's name", async ($, on) => {
    const w = engine(on, { listed: [[oldGreen()]] }, { [`issue-forge:run:${ROOT}`]: storedRun('green', { agents: [] }) })
    await start($)
    expect((await run($, 'stop')).text).toContain('kept; no agent was running.')
    expect(w.taskStops).toEqual([])
  })

  test("agents that can't be listed: the answer says so, and promises nothing", async ($, on) => {
    const w = engine(on, { listFails: true }, { [`issue-forge:run:${ROOT}`]: storedRun('green') })
    await start($)
    const text = (await run($, 'stop')).text
    expect(text).toContain("kept; its agents couldn't be listed (")
    expect(text).toContain('so any still working may keep going until their turn ends.')
    expect(w.taskStops).toEqual([])
  })

  test('a stop of the run this session drives ends its agent', async ($, on) => {
    const w = engine(on, { head: BRANCH, spawnHold: held(), listed: [[newGreen()], [newGreen('killed')]] }, { [`issue-forge:run:${ROOT}`]: storedRun('green') })
    await start($)
    expect((await run($, 'resume')).text).toBe('resuming #16 at green.')
    await until(w, () => w.spawned.length === 1, "#16's green agent")
    expect((await run($, 'stop')).text).toContain('kept; its green agent (issue-forge-16-green-2) has stopped.')
    expect(w.taskStops).toEqual(['a77'])
  })

  test('a stop of another run leaves the agent of the run this session drives alone', async ($, on) => {
    const blocked44 = storedRun('blocked', { id: '44-1', issue: 44, title: 'duet follow-ups', branch: 'issue-44-duet', repo: `${ROOT}/.git`, blocked: { at: 'gateG', reason: 'r', next: 'n' }, agents: [{ id: 'old-44', name: 'issue-forge-44-green-1', phase: 'green' }] })
    const old44 = (status: string) => row('old-44', 'issue-forge-44-green-1', 'green', status, { description: 'issue-forge #44 green' })
    const listed = [[newGreen(), old44('running')], [newGreen(), old44('killed')]]
    const w = engine(on, { head: BRANCH, spawnHold: held(), listed }, { [key(16)]: storedRun('green', { repo: `${ROOT}/.git` }), [key(44)]: blocked44 })
    await start($)
    expect((await run($, 'resume 16')).text).toBe('resuming #16 at green.')
    await until(w, () => w.spawned.length === 1, "#16's green agent")
    expect((await run($, 'stop 44')).text).toContain('kept; its green agent (issue-forge-44-green-1) has stopped.')
    expect(w.taskStops).toEqual(['old-44'])
  })

  test('a stop while the spawn is still pending ends the agent once the spawn resolves', async ($, on) => {
    let release: () => void = () => undefined
    const w = engine(on, { head: BRANCH, spawnHold: new Promise<void>(resolve => (release = resolve)), listed: [[], [newGreen()], [newGreen('killed')]] }, { [`issue-forge:run:${ROOT}`]: storedRun('green') })
    await start($)
    await run($, 'resume')
    await until(w, () => w.spawned.length === 1, 'the spawn')
    expect((await run($, 'stop')).text).toContain('stopped #16')
    expect(w.taskStops).toEqual([])
    release()
    await waitFor(w, () => w.taskStops.length > 0)
    expect(w.taskStops).toEqual(['a77'])
  })

  test("hand off ends this session's agent, and says so", async ($, on) => {
    const w = engine(on, { head: BRANCH, spawnHold: held(), listed: [[newGreen()], [newGreen('killed')]] }, { [`issue-forge:run:${ROOT}`]: storedRun('green') })
    await start($)
    await run($, 'resume')
    await until(w, () => w.spawned.length === 1, "#16's green agent")
    expect((await run($, 'handoff')).text).toBe('handed off #16 at green; /issue-forge resume 16 continues it in any session; its green agent (issue-forge-16-green-2) has stopped.')
    expect(w.taskStops).toEqual(['a77'])
  })

  test('the driving session ends its agent when another session stops its run, and the toast says so', async ($, on) => {
    const store: Record<string, unknown> = {}
    const red = (status: string) => row('a77', 'issue-forge-16-red-1', 'red', status)
    const w = engine(on, { baseProfile: WORKTREE, spawnHold: held(), answer: 'Cancel', storeHold: { when: () => false, until: Promise.resolve() }, listed: [[red('running')], [red('killed')]] }, store)
    await start($)
    await run($, '16')
    await until(w, () => w.spawned.length === 1, "#16's red agent")
    store[key(16)] = { ...(store[key(16)] as any), step: 'stopped' }
    await w.clock.advance(5_000)
    await until(w, () => w.toasts.some(t => t.startsWith('#16 was stopped in another session')), 'the toast')
    await waitFor(w, () => w.taskStops.length > 0)
    expect(w.taskStops).toEqual(['a77'])
    await waitFor(w, () => w.toasts.some(t => t.includes('has stopped')))
    expect(w.toasts).toContain('#16 was stopped in another session; this session stopped driving it; its red agent (issue-forge-16-red-1) has stopped.')
  })

  // PR #151 review round 1, finding 2: the answer says what that session does, not a deadline nothing here verifies.
  test('a stop of a run another session drives says its agents run there, and when that session ends them', async ($, on) => {
    const elsewhere = storedRun('green', { id: '40-1', issue: 40, branch: 'issue-40-x', repo: `${ROOT}/.git`, driver: { session: OTHER, since: 1_000_000 - 125_000 } })
    const w = engine(on, { head: 'issue-40-x', answer: 'Take over' }, { [key(40)]: elsewhere })
    await start($)
    const text = (await run($, 'stop 40')).text
    expect(text).toBe('stopped #40. Its branch issue-40-x and commits are kept; its agents run in the session driving it, which ends its drive and them at its next check (every 5 s) if it is still open.')
    expect(w.taskStops).toEqual([])
  })

  test('round 1, finding 2: a Stop of the driven run that another session replaced meanwhile still ends the agent, and says so', async ($, on) => {
    let release: (label: string) => void = () => undefined
    const hold = new Promise<string>(resolve => (release = resolve))
    const store: Record<string, unknown> = { [key(16)]: storedRun('green', { repo: `${ROOT}/.git` }) }
    const w = engine(on, { head: BRANCH, spawnHold: held(), storeHold: { when: () => false, until: Promise.resolve() }, listed: [[newGreen()], [newGreen('killed')]] }, store)
    await start($)
    expect((await run($, 'resume')).text).toBe('resuming #16 at green.')
    await until(w, () => w.spawned.length === 1, "#16's green agent")
    w.hold = hold
    const ui = await pane($)
    await ui.press({ key: 'stop' })
    await until(w, () => w.asked.length === 1, 'the question')
    store[key(16)] = { ...(store[key(16)] as any), id: '16-2' }
    release('Stop the run')
    await waitFor(w, () => w.toasts.some(t => t.includes('moved on')))
    await ui.unmount()
    expect(w.taskStops).toEqual(['a77'])
    // A press shows its answer cut to 80 characters, so the outcome comes first (the owner: "Lead with the outcome").
    expect(w.toasts.some(t => t.startsWith('#16 moved on; its green agent (issue-forge-16-green-2) has stopped'))).toBe(true)
  })

  test("a pressed Stop's toast leads with which agents stopped, so the 80-character cut keeps it", async ($, on) => {
    const w = engine(on, { head: BRANCH, spawnHold: held(), answer: 'Stop the run', listed: [[newGreen()], [newGreen('killed')]] }, { [`issue-forge:run:${ROOT}`]: storedRun('green') })
    await start($)
    expect((await run($, 'resume')).text).toBe('resuming #16 at green.')
    await until(w, () => w.spawned.length === 1, "#16's green agent")
    const ui = await pane($)
    await ui.press({ key: 'stop' })
    await waitFor(w, () => w.toasts.some(t => t.startsWith('stopped #16')))
    await ui.unmount()
    expect(w.taskStops).toEqual(['a77'])
    expect(w.toasts.some(t => t.startsWith('stopped #16; its green agent (issue-forge-16-green-2) has stopped.'))).toBe(true)
  })

  test("a pressed Hand off's toast leads with which agents stopped", async ($, on) => {
    const w = engine(on, { head: BRANCH, spawnHold: held(), listed: [[newGreen()], [newGreen('killed')]] }, { [`issue-forge:run:${ROOT}`]: storedRun('green') })
    await start($)
    expect((await run($, 'resume')).text).toBe('resuming #16 at green.')
    await until(w, () => w.spawned.length === 1, "#16's green agent")
    const ui = await pane($)
    await ui.press({ key: 'handoff' })
    await waitFor(w, () => w.toasts.some(t => t.startsWith('handed off #16')))
    await ui.unmount()
    expect(w.taskStops).toEqual(['a77'])
    expect(w.toasts.some(t => t.startsWith('handed off #16 at green; its green agent (issue-forge-16-green-2) has stopped'))).toBe(true)
  })

  test('round 1, finding 3: hand off, then start, says what happened to the handed-off run\'s agent', async ($, on) => {
    const red = (status: string) => row('a77', 'issue-forge-16-red-1', 'red', status)
    const w = engine(on, { baseProfile: WORKTREE, spawnHold: held(), listed: [[red('running')], [red('killed')], []] })
    await start($)
    await run($, '16')
    await until(w, () => w.spawned.length === 1, "#16's red agent")
    w.answer = 'Hand #16 off and start #17 here (any session can resume #16)'
    expect((await run($, '17')).text).toBe('handed off #16 at red; its red agent (issue-forge-16-red-1) has stopped; starting #17; the pane shows progress. Nothing is pushed until you say yes.')
    expect(w.taskStops).toEqual(['a77'])
  })

  test('round 1, finding 5: a stop while the spawn is pending ends nothing when the spawn is refused, even an agent of the same name', async ($, on) => {
    let release: () => void = () => undefined
    const w = engine(on, { head: BRANCH, spawnDeny: 'no', spawnHold: new Promise<void>(resolve => (release = resolve)), listed: [[], [newGreen()]] }, { [`issue-forge:run:${ROOT}`]: storedRun('green') })
    await start($)
    await run($, 'resume')
    await until(w, () => w.spawned.length === 1, 'the spawn')
    expect((await run($, 'stop')).text).toContain('stopped #16')
    release()
    await w.clock.settle()
    await w.clock.advance(50)
    expect(w.taskStops).toEqual([])
  })

  test('round 1, finding 6: an agent still read as running right after TaskStop is listed again a moment later', async ($, on) => {
    const w = engine(on, { listed: [[oldGreen()], [oldGreen()], [oldGreen('killed')]] }, { [`issue-forge:run:${ROOT}`]: storedRun('green') })
    await start($)
    const stopping = run($, 'stop')
    await waitFor(w, () => w.taskStops.length > 0)
    for (let i = 0; i < 400; i++) await w.clock.advance(5)
    const text = (await stopping).text
    expect(w.taskStops).toEqual(['old-green'])
    expect(text).toContain('kept; its green agent (issue-forge-16-green-1) has stopped.')
  })

  test('round 1, finding 8: the drive\'s agent is ended even when the stop\'s store write is refused', async ($, on) => {
    const store: Record<string, unknown> = { [key(16)]: storedRun('green', { repo: `${ROOT}/.git` }) }
    const w = engine(on, { head: BRANCH, spawnHold: held(), storeHold: { when: () => false, until: Promise.resolve() }, listed: [[newGreen()], [newGreen('killed')]] }, store)
    await start($)
    expect((await run($, 'resume')).text).toBe('resuming #16 at green.')
    await until(w, () => w.spawned.length === 1, "#16's green agent")
    w.storeLimit = 10
    await run($, 'stop').catch(() => undefined)
    expect(w.taskStops).toEqual(['a77'])
  })

  test("round 2, finding 1: hand off ends the drive's agent even when releasing the run's driver is refused (Codex 4365778044)", async ($, on) => {
    const store: Record<string, unknown> = { [key(16)]: storedRun('green', { repo: `${ROOT}/.git` }) }
    const w = engine(on, { head: BRANCH, spawnHold: held(), storeHold: { when: () => false, until: Promise.resolve() }, listed: [[newGreen()], [newGreen('killed')]] }, store)
    await start($)
    expect((await run($, 'resume')).text).toBe('resuming #16 at green.')
    await until(w, () => w.spawned.length === 1, "#16's green agent")
    w.storeLimit = 10
    await run($, 'handoff').catch(() => undefined)
    expect(w.taskStops).toEqual(['a77'])
  })

  test("round 2, finding 2: an agent whose spawn resolved after the stop is ended, and a toast says so, since the stop's answer came first", async ($, on) => {
    let release: () => void = () => undefined
    const w = engine(on, { head: BRANCH, spawnHold: new Promise<void>(resolve => (release = resolve)), listed: [[], [newGreen()], [newGreen('killed')]] }, { [`issue-forge:run:${ROOT}`]: storedRun('green') })
    await start($)
    await run($, 'resume')
    await until(w, () => w.spawned.length === 1, 'the spawn')
    expect((await run($, 'stop')).text).toContain('kept; no agent was running.')
    release()
    await waitFor(w, () => w.toasts.some(t => t.startsWith('#16: ')))
    expect(w.taskStops).toEqual(['a77'])
    expect(w.toasts).toContain('#16: its green agent (issue-forge-16-green-2) has stopped')
  })

  test("round 2, finding 4: the stop is written before TaskStop answers, so a TaskStop held by a dialog doesn't hold the run's record", async ($, on) => {
    let release: () => void = () => undefined
    const store: Record<string, unknown> = { [key(16)]: storedRun('green', { repo: `${ROOT}/.git` }) }
    const w = engine(on, { head: BRANCH, spawnHold: held(), storeHold: { when: () => false, until: Promise.resolve() }, taskStopHold: new Promise<void>(resolve => (release = resolve)), listed: [[newGreen()], [newGreen('killed')]] }, store)
    await start($)
    expect((await run($, 'resume')).text).toBe('resuming #16 at green.')
    await until(w, () => w.spawned.length === 1, "#16's green agent")
    const stopping = run($, 'stop')
    await waitFor(w, () => (store[key(16)] as any).step === 'stopped')
    expect((store[key(16)] as any).step).toBe('stopped')
    release()
    expect((await stopping).text).toContain('kept; its green agent (issue-forge-16-green-2) has stopped.')
  })

  test("round 2, finding 9: a takeover caught just before a commit ends the drive's agent (stillOwned)", async ($, on) => {
    let release: () => void = () => undefined
    const store: Record<string, unknown> = { [key(16)]: storedRun('gateG', { repo: `${ROOT}/.git` }) }
    const w = engine(on, { head: BRANCH, staged: ['tests/a.test.ts', 'src/a.ts'], sinceRed: ['src/a.ts'], redPaths: ['tests/a.test.ts'], spawnHold: held(), storeHold: { when: () => false, until: Promise.resolve() }, statusHold: new Promise<void>(r => (release = r)), listed: [[oldGreen('idle')], [oldGreen('killed')]] }, store)
    await start($)
    expect((await run($, 'resume')).text).toBe('resuming #16 at gateG.')
    await until(w, () => w.argv.some(a => a[1] === 'status' && a.includes('-z')), "the gate's last look")
    store[key(16)] = { ...(store[key(16)] as any), driver: { session: OTHER, since: 1 } }
    release()
    await waitFor(w, () => w.taskStops.length > 0)
    expect(w.taskStops).toEqual(['old-green'])
    expect(w.commits).toEqual([])
    // stillOwned caught it, not watch's 5-second check, whose toast would say so.
    expect(w.toasts.some(t => t.includes('was taken over'))).toBe(false)
  })
})

describe('#156: the fence and the folder check (Change 0.10.0)', () => {
  const WT = `${ROOT}/scratch/issue-forge/${BRANCH}`
  const RUN = `issue-forge:run:${ROOT}`
  const FENCE = '/home/u/.claude/issue-forge-data/fence/name/issue-forge-16-red-1'
  const held = () => new Promise<void>(() => undefined)
  const red = (status: string) => ({ id: 'a77', name: 'issue-forge-16-red-1', description: 'issue-forge #16 red', type: 'issue-forge:red', status, spawnedBy: 'issue-forge' })
  const atRed = (extra: Record<string, unknown> = {}) => storedRun('red', { workRoot: WT, redCommit: undefined, used: { red: 0, green: 0, refactor: 0 }, agents: [], ...extra })
  const releasable = () => {
    let release: () => void = () => undefined
    return { hold: new Promise<void>(resolve => (release = resolve)), release: () => release() }
  }
  // A record seeded under the old key moves to the repository's key at start (Change 0.3.0's migration).
  const stored = (store: Record<string, unknown>) => (store[key(16)] ?? store[RUN]) as any
  // A store the test's own object backs, so `stored` reads what the mod wrote (mock.store keeps a copy).
  const LIVE = { storeHold: { when: () => false, until: Promise.resolve() } }
  const strayReason = `the session's folder ${ROOT} changed while the red agent worked: stray.txt; issue-forge can't tell whether the agent or someone else made the change`

  test("a preflight that doesn't get the script's own refusal blocks the phase, and no agent starts", async ($, on) => {
    const store: Record<string, unknown> = { [RUN]: atRed() }
    const w = engine(on, { ...LIVE, worktrees: [WT],fenceCheck: { exitCode: 0, stderr: '' } }, store)
    await start($)
    await run($, 'resume')
    await waitFor(w, () => stored(store).step === 'blocked')
    expect(w.spawned).toEqual([])
    expect(stored(store).blocked).toMatchObject({ at: 'red', reason: "the fence can't run (exit 0), so no agent was started", next: 'issue-forge needs bash 4.2 or later on PATH to run hooks/fence.sh' })
  })

  test("a preflight whose bash can't start blocks the same way", async ($, on) => {
    const store: Record<string, unknown> = { [RUN]: atRed() }
    const w = engine(on, { ...LIVE, worktrees: [WT],fenceCheck: 'throws' }, store)
    await start($)
    await run($, 'resume')
    await waitFor(w, () => stored(store).step === 'blocked')
    expect(w.spawned).toEqual([])
    expect(stored(store).blocked?.reason).toContain("the fence can't run (")
    expect(stored(store).blocked?.reason).toContain('spawn bash ENOENT')
  })

  test("the agent's fence file is live, by its name, before the spawn, and retired when its phase ends", async ($, on) => {
    const spawn = releasable()
    const w = engine(on, { ...LIVE, worktrees: [WT],spawnHold: spawn.hold }, { [RUN]: atRed() })
    await start($)
    await run($, 'resume')
    await until(w, () => w.spawned.length === 1, "#16's red agent")
    expect(w.fenceChecks).toBe(1)
    expect(w.files[FENCE]).toMatch(new RegExp(`^live \\d+ ${WT}\\n$`))
    spawn.release()
    await waitFor(w, () => w.files[FENCE] === 'retired\n')
    expect(w.files[FENCE]).toBe('retired\n')
  })

  test("a stop retires the agent's fence file", async ($, on) => {
    const w = engine(on, { ...LIVE, worktrees: [WT],spawnHold: held(), listed: [[red('running')], [red('killed')]] }, { [RUN]: atRed() })
    await start($)
    await run($, 'resume')
    await until(w, () => w.spawned.length === 1, "#16's red agent")
    await run($, 'stop')
    expect(w.files[FENCE]).toBe('retired\n')
  })

  test("the 5 s check writes the fence line again, later, while the agent works", async ($, on) => {
    const store: Record<string, unknown> = { [RUN]: atRed() }
    const w = engine(on, { ...LIVE, worktrees: [WT],spawnHold: held() }, store)
    await start($)
    await run($, 'resume')
    await until(w, () => w.spawned.length === 1, "#16's red agent")
    const first = Number((w.files[FENCE] ?? '').split(' ')[1])
    await w.clock.advance(5_000)
    await waitFor(w, () => Number((w.files[FENCE] ?? '').split(' ')[1]) > first)
    expect(Number((w.files[FENCE] ?? '').split(' ')[1])).toBeGreaterThan(first)
    expect(stored(store).step).toBe('red')
  })

  test('the folder changing while the agent works: the 5 s check ends the agent and blocks the run, naming the file', async ($, on) => {
    const store: Record<string, unknown> = { [RUN]: atRed() }
    const w = engine(on, { ...LIVE, worktrees: [WT],spawnHold: held(), listed: [[red('running')], [red('killed')]] }, store)
    await start($)
    await run($, 'resume')
    await until(w, () => w.spawned.length === 1, "#16's red agent")
    expect(stored(store).folderSnapshot).toMatchObject({ phase: 'red', entries: [] })
    w.rootStatus = '?? stray.txt\0'
    await w.clock.advance(5_000)
    await waitFor(w, () => stored(store).step === 'blocked')
    expect(stored(store).blocked).toMatchObject({ at: 'red', reason: strayReason, next: "check those files (issue-forge doesn't undo them)" })
    expect(stored(store).isFolderBlock).toBe(true)
    await waitFor(w, () => w.taskStops.length > 0)
    expect(w.taskStops).toEqual(['a77'])
    expect(w.files[FENCE]).toBe('retired\n')
  })

  // The check when the agent's answer arrives isn't reachable here: a kit spawn gets no agentId, so the phase ends at
  // "didn't start" (gotchas.md:288-293). It shares folderNow and folderBlock with the 5 s check, tested above and in logic.
  test("a spawn that gets no agent id: the phase ends at didn't start, its fence retired, with no folder block", async ($, on) => {
    const spawn = releasable()
    const store: Record<string, unknown> = { [RUN]: atRed() }
    const w = engine(on, { ...LIVE, worktrees: [WT],spawnHold: spawn.hold }, store)
    await start($)
    await run($, 'resume')
    await until(w, () => w.spawned.length === 1, "#16's red agent")
    spawn.release()
    await waitFor(w, () => stored(store).step === 'blocked')
    expect(stored(store).blocked?.reason).toBe("the red agent didn't start: no agent id")
    expect(stored(store).isFolderBlock).toBeUndefined()
    expect(w.files[FENCE]).toBe('retired\n')
  })

  test('an edit already there when the phase began, and unchanged since, blocks nothing at the 5 s check', async ($, on) => {
    const store: Record<string, unknown> = { [RUN]: atRed() }
    const w = engine(on, { ...LIVE, worktrees: [WT],spawnHold: held(), rootStatus: ' M before.ts\0' }, store)
    await start($)
    await run($, 'resume')
    await until(w, () => w.spawned.length === 1, "#16's red agent")
    expect(stored(store).folderSnapshot).toMatchObject({ phase: 'red', entries: [{ xy: ' M', path: 'before.ts', hash: 'h-before.ts' }] })
    await w.clock.advance(5_000)
    await w.clock.settle()
    expect(stored(store).step).toBe('red')
    expect(w.taskStops).toEqual([])
  })

  test("a change found at a stop is named in the stop's answer", async ($, on) => {
    const w = engine(on, { ...LIVE, worktrees: [WT],spawnHold: held(), listed: [[red('running')], [red('killed')]] }, { [RUN]: atRed() })
    await start($)
    await run($, 'resume')
    await until(w, () => w.spawned.length === 1, "#16's red agent")
    w.rootStatus = '?? stray.txt\0'
    expect((await run($, 'stop')).text).toBe(`stopped #16. Its branch ${BRANCH} and commits are kept; its red agent (issue-forge-16-red-1) has stopped; the session's folder changed while it worked: stray.txt.`)
  })

  test("a pressed Stop's toast names the first changed file within its 80 characters", async ($, on) => {
    const w = engine(on, { ...LIVE, worktrees: [WT],spawnHold: held(), answer: 'Stop the run', listed: [[red('running')], [red('killed')]] }, { [RUN]: atRed() })
    await start($)
    await run($, 'resume')
    await until(w, () => w.spawned.length === 1, "#16's red agent")
    w.rootStatus = '?? stray.txt\0'
    const ui = await pane($)
    await ui.press({ key: 'stop' })
    await waitFor(w, () => w.toasts.some(t => t.startsWith('stopped #16')))
    await ui.unmount()
    expect(w.toasts.some(t => t.startsWith('stopped #16; folder changed: stray.txt; its red agent'))).toBe(true)
  })

  test('a hand-off keeps the snapshot, and the next phase start compares against it before anything else', async ($, on) => {
    const store: Record<string, unknown> = { [RUN]: atRed() }
    const w = engine(on, { ...LIVE, worktrees: [WT],spawnHold: held(), listed: [[red('running')], [red('killed')], [], []] }, store)
    await start($)
    await run($, 'resume')
    await until(w, () => w.spawned.length === 1, "#16's red agent")
    await run($, 'handoff')
    expect(stored(store).folderSnapshot).toMatchObject({ phase: 'red' })
    w.rootStatus = '?? stray.txt\0'
    const checks = w.fenceChecks
    await run($, 'resume')
    await waitFor(w, () => stored(store).step === 'blocked')
    expect(stored(store).blocked?.reason).toBe(strayReason)
    expect(w.spawned.length).toBe(1)
    expect(w.fenceChecks).toBe(checks)
  })

  test('a takeover found by the watch: its toast names the changed file', async ($, on) => {
    const store: Record<string, unknown> = {}
    const w = engine(on, { baseProfile: { ...PROFILE, workspace: 'worktree' }, spawnHold: held(), answer: 'Cancel', storeHold: { when: () => false, until: Promise.resolve() }, listed: [[red('running')], [red('killed')]] }, store)
    await start($)
    await run($, '16')
    await until(w, () => w.spawned.length === 1, "#16's red agent")
    w.rootStatus = '?? stray.txt\0'
    store[key(16)] = { ...(store[key(16)] as any), step: 'stopped' }
    await w.clock.advance(5_000)
    await waitFor(w, () => w.toasts.some(t => t.startsWith('#16 was stopped in another session') && t.includes('has stopped')))
    expect(w.toasts).toContain("#16 was stopped in another session; this session stopped driving it; its red agent (issue-forge-16-red-1) has stopped; the session's folder changed while it worked: stray.txt.")
  })

  test('a resume after a folder block stashes the worktree first, and its answer names the stash', async ($, on) => {
    const message = 'issue-forge #16 red after the folder check (run 16-1)'
    const store: Record<string, unknown> = { [RUN]: storedRun('blocked', { workRoot: WT, redCommit: undefined, used: { red: 1, green: 0, refactor: 0 }, agents: [], blocked: { at: 'red', reason: strayReason, next: 'n' }, isFolderBlock: true }) }
    const w = engine(on, { ...LIVE, worktrees: [WT],spawnHold: held(), stashList: `abc1234def0\tOn ${BRANCH}: ${message}\n` }, store)
    await start($)
    expect((await run($, 'resume')).text).toBe(`resuming #16 at red; any uncommitted files in its worktree go to the stash "${message}" first.`)
    await until(w, () => w.spawned.length === 1, "#16's red agent")
    const push = w.calls.find(c => c.argv[1] === 'stash' && c.argv[2] === 'push')
    expect(push).toMatchObject({ argv: ['git', 'stash', 'push', '--include-untracked', '-m', message], cwd: WT })
    expect(stored(store).folderStash).toEqual({ sha: 'abc1234def0', message })
    expect('isFolderBlock' in stored(store)).toBe(false)
  })

  test('a fence file changed or removed while the agent works: the agent is ended and the run blocks', async ($, on) => {
    const store: Record<string, unknown> = { [RUN]: atRed() }
    const w = engine(on, { ...LIVE, worktrees: [WT],spawnHold: held(), listed: [[red('running')], [red('killed')]] }, store)
    await start($)
    await run($, 'resume')
    await until(w, () => w.spawned.length === 1, "#16's red agent")
    w.files[FENCE] = 'live 9999999999 /\n'
    await w.clock.advance(5_000)
    await waitFor(w, () => stored(store).step === 'blocked')
    expect(stored(store).blocked).toMatchObject({ reason: 'the fence file for issue-forge-16-red-1 was changed or removed, so the agent was ended', next: 'check ~/.claude/issue-forge-data/fence/' })
    await waitFor(w, () => w.taskStops.length > 0)
    expect(w.taskStops).toEqual(['a77'])
  })

  test('the preflight failing on the 5 s check ends the agent and blocks the run', async ($, on) => {
    const store: Record<string, unknown> = { [RUN]: atRed() }
    const w = engine(on, { ...LIVE, worktrees: [WT],spawnHold: held(), listed: [[red('running')], [red('killed')]] }, store)
    await start($)
    await run($, 'resume')
    await until(w, () => w.spawned.length === 1, "#16's red agent")
    w.fenceCheck = { exitCode: 0, stderr: '' }
    await w.clock.advance(5_000)
    await waitFor(w, () => stored(store).step === 'blocked')
    expect(stored(store).blocked?.reason).toBe("the fence can't run (exit 0), so no agent was started")
    await waitFor(w, () => w.taskStops.length > 0)
    expect(w.taskStops).toEqual(['a77'])
  })

  test("a here run's agent is fenced too, but its folder isn't watched", async ($, on) => {
    const store: Record<string, unknown> = { [RUN]: storedRun('red', { redCommit: undefined, used: { red: 0, green: 0, refactor: 0 }, agents: [] }) }
    const w = engine(on, { ...LIVE, head: BRANCH, spawnHold: held() }, store)
    await start($)
    await run($, 'resume')
    await until(w, () => w.spawned.length === 1, "#16's red agent")
    expect(w.files[FENCE]).toMatch(new RegExp(`^live \\d+ ${ROOT}\\n$`))
    expect('folderSnapshot' in stored(store)).toBe(false)
    expect(w.calls.some(c => c.argv.includes('--no-renames'))).toBe(false)
  })

  test('a dirty submodule beside a dirty file: the file changing again is still caught by its hash (PR #162 review round 1, finding 3)', async ($, on) => {
    const store: Record<string, unknown> = { [RUN]: atRed() }
    const w = engine(on, { ...LIVE, worktrees: [WT], spawnHold: held(), listed: [[red('running')], [red('killed')]], rootStatus: ' M a.txt\0 M sub\0', rootKinds: { sub: 'dir' } }, store)
    await start($)
    await run($, 'resume')
    await until(w, () => w.spawned.length === 1, "#16's red agent")
    expect(stored(store).folderSnapshot?.entries).toEqual([{ xy: ' M', path: 'a.txt', hash: 'h-a.txt' }, { xy: ' M', path: 'sub', kind: 'dir' }])
    w.rootHashes = { 'a.txt': 'h-a.txt-again' }
    await w.clock.advance(5_000)
    await waitFor(w, () => stored(store).step === 'blocked')
    expect(stored(store).blocked?.reason).toBe(`the session's folder ${ROOT} changed while the red agent worked: a.txt; issue-forge can't tell whether the agent or someone else made the change`)
  })

  // PR #162 review round 1, finding 4 (Codex 4372144808): the stop, the hand-off and the watch end the drive first, and
  // phase()'s finally can then drop the folder watch before their own compare. In the kit, a late spawn does it: the spawn
  // resolves while the stop's store write is held, its branch ends the agent, and phase() returns.
  const writeHeld = (w: World) => waitFor(w, () => w.storeHold?.isHeld === true)

  test("a stop the late spawn's end overtakes still compares the folder, and names the change", async ($, on) => {
    const spawn = releasable()
    const write = releasable()
    const w = engine(on, { worktrees: [WT], spawnHold: spawn.hold, storeHold: { when: (v: any) => v?.step === 'stopped', until: write.hold }, listed: [[red('running')], [red('killed')], [], []] }, { [RUN]: atRed() })
    await start($)
    await run($, 'resume')
    await until(w, () => w.spawned.length === 1, "#16's red agent")
    w.rootStatus = '?? stray.txt\0'
    const stopping = run($, 'stop')
    await writeHeld(w)
    spawn.release()
    await waitFor(w, () => w.toasts.some(t => t.startsWith('#16: its red agent')))
    await w.clock.settle()
    write.release()
    expect((await stopping).text).toContain("the session's folder changed while it worked: stray.txt")
  })

  test("a hand-off the late spawn's end overtakes still compares the folder, and names the change", async ($, on) => {
    const spawn = releasable()
    const write = releasable()
    const w = engine(on, { worktrees: [WT], spawnHold: spawn.hold, storeHold: { when: (v: any) => v?.step === 'red' && v?.driver === undefined && v?.folderSnapshot !== undefined, until: write.hold }, listed: [[red('running')], [red('killed')], [], []] }, { [RUN]: atRed() })
    await start($)
    await run($, 'resume')
    await until(w, () => w.spawned.length === 1, "#16's red agent")
    w.rootStatus = '?? stray.txt\0'
    const handing = run($, 'handoff')
    await writeHeld(w)
    spawn.release()
    await waitFor(w, () => w.toasts.some(t => t.startsWith('#16: its red agent')))
    await w.clock.settle()
    write.release()
    expect((await handing).text).toContain("the session's folder changed while it worked: stray.txt")
  })

  // PR #162 review round 1, finding 1 (Codex 4372144796): a stop that retires the fence while the 5 s check's rewrite is
  // in flight must not be undone by it, or the ended agent's queued calls pass for up to 30 s more.
  test("a stop while the 5 s check rewrites the fence: retired lands last, and stays", async ($, on) => {
    const write = releasable()
    const w = engine(on, { ...LIVE, worktrees: [WT], spawnHold: held(), listed: [[red('running')], [red('killed')]] }, { [RUN]: atRed() })
    await start($)
    await run($, 'resume')
    await until(w, () => w.spawned.length === 1, "#16's red agent")
    const first = w.files[FENCE]
    w.writeHold = { when: (path: string, text: string) => path === FENCE && text.startsWith('live ') && text !== first, until: write.hold }
    await w.clock.advance(5_000)
    await waitFor(w, () => w.writeHold?.isHeld === true)
    const stopping = run($, 'stop')
    await w.clock.settle()
    write.release()
    await stopping
    await w.clock.settle()
    expect(w.files[FENCE]).toBe('retired\n')
  })

  // PR #162 review round 1, finding 5 (the owner's content check): another repository's run of #16 can hold the name file.
  // Its line is as issue-forge writes one: at most 30 s ahead of now.
  const OTHER = '/elsewhere/scratch/issue-forge/issue-16-x'
  const otherLine = (w: World) => `live ${Math.floor(w.clock.now() / 1000) + 30} ${OTHER}\n`

  test("a name another run's live line holds: the spawn is refused, the run blocks naming that folder, and its line stays", async ($, on) => {
    const store: Record<string, unknown> = { [RUN]: atRed() }
    const w = engine(on, { ...LIVE, worktrees: [WT] }, store)
    const line = otherLine(w)
    w.files[FENCE] = line
    await start($)
    await run($, 'resume')
    await waitFor(w, () => stored(store).step === 'blocked')
    expect(w.spawned).toEqual([])
    expect(stored(store).blocked).toMatchObject({ at: 'red', reason: `the fence name issue-forge-16-red-1 is live in ${OTHER} (another run of #16), so no agent was started` })
    expect(w.files[FENCE]).toBe(line)
  })

  test("another run's line in the name file before the id file exists: the agent is ended, the run blocks, and that line is left as it is", async ($, on) => {
    const store: Record<string, unknown> = { [RUN]: atRed() }
    const w = engine(on, { ...LIVE, worktrees: [WT], spawnHold: held(), listed: [[red('running')], [red('killed')]] }, store)
    await start($)
    await run($, 'resume')
    await until(w, () => w.spawned.length === 1, "#16's red agent")
    const line = otherLine(w)
    w.files[FENCE] = line
    await w.clock.advance(5_000)
    await waitFor(w, () => stored(store).step === 'blocked')
    expect(stored(store).blocked?.reason).toBe(`the fence name issue-forge-16-red-1 is live in ${OTHER} (another run of #16), so the agent was ended`)
    await waitFor(w, () => w.taskStops.length > 0)
    await w.clock.settle()
    expect(w.taskStops).toEqual(['a77'])
    expect(w.files[FENCE]).toBe(line)
    expect(w.logs).toContain(`issue-forge fence check: ${FENCE} holds another run's line (${OTHER}), at the 5 s check`)
  })

  test("a name line further ahead than issue-forge writes is tampering, and the retirement writes over it, so the name recovers", async ($, on) => {
    const store: Record<string, unknown> = { [RUN]: atRed() }
    const w = engine(on, { ...LIVE, worktrees: [WT], spawnHold: held(), listed: [[red('running')], [red('killed')]] }, store)
    await start($)
    await run($, 'resume')
    await until(w, () => w.spawned.length === 1, "#16's red agent")
    w.files[FENCE] = `live 9999999999 ${OTHER}\n`
    await w.clock.advance(5_000)
    await waitFor(w, () => stored(store).step === 'blocked')
    expect(stored(store).blocked?.reason).toBe('the fence file for issue-forge-16-red-1 was changed or removed, so the agent was ended')
    await waitFor(w, () => w.files[FENCE] === 'retired\n')
    expect(w.files[FENCE]).toBe('retired\n')
    expect(w.logs).toContain(`issue-forge fence check: ${FENCE} holds a line issue-forge didn't write, at the 5 s check`)
  })

  // PR #162 review round 2, finding 1 (Codex 4372538889): a stop that lands while the phase awaits its preflight must leave no
  // live fence and start no agent.
  test("a stop while the phase's preflight runs: no fence is left live, and no agent starts", async ($, on) => {
    const preflight = releasable()
    const store: Record<string, unknown> = { [RUN]: atRed() }
    const w = engine(on, { ...LIVE, worktrees: [WT], spawnHold: held(), fenceHold: preflight.hold }, store)
    await start($)
    await run($, 'resume')
    await waitFor(w, () => w.fenceHeld === true)
    expect((await run($, 'stop')).text).toContain('stopped #16')
    preflight.release()
    await w.clock.settle()
    expect(w.spawned).toEqual([])
    expect(w.files[FENCE]?.startsWith('live ') ?? false).toBe(false)
  })

  test("a stop while the phase writes its first fence line: the line is retired, and no agent starts", async ($, on) => {
    const write = releasable()
    const store: Record<string, unknown> = { [RUN]: atRed() }
    const w = engine(on, { ...LIVE, worktrees: [WT], spawnHold: held(), writeHold: { when: (path: string, text: string) => path === FENCE && text.startsWith('live '), until: write.hold } }, store)
    await start($)
    await run($, 'resume')
    await waitFor(w, () => w.writeHold?.isHeld === true)
    const stopping = run($, 'stop')
    await w.clock.settle()
    write.release()
    expect((await stopping).text).toContain('stopped #16')
    await w.clock.settle()
    expect(w.spawned).toEqual([])
    expect(w.files[FENCE]).toBe('retired\n')
  })

  // PR #162 review round 1, item 6: the debug log says which check found a folder change. The answer's check isn't reachable
  // in the kit (a kit spawn's agentId is dropped); the live check's step covers it.
  const foundAt = (where: string) => `issue-forge folder check: 1 changed, found at ${where}`

  test('a folder change the 5 s check finds says so in the debug log', async ($, on) => {
    const store: Record<string, unknown> = { [RUN]: atRed() }
    const w = engine(on, { ...LIVE, worktrees: [WT], spawnHold: held(), listed: [[red('running')], [red('killed')]] }, store)
    await start($)
    await run($, 'resume')
    await until(w, () => w.spawned.length === 1, "#16's red agent")
    w.rootStatus = '?? stray.txt\0'
    await w.clock.advance(5_000)
    await waitFor(w, () => stored(store).step === 'blocked')
    expect(w.logs).toContain(foundAt('the 5 s check'))
  })

  test('a folder change a stop finds says so in the debug log', async ($, on) => {
    const w = engine(on, { ...LIVE, worktrees: [WT], spawnHold: held(), listed: [[red('running')], [red('killed')]] }, { [RUN]: atRed() })
    await start($)
    await run($, 'resume')
    await until(w, () => w.spawned.length === 1, "#16's red agent")
    w.rootStatus = '?? stray.txt\0'
    await run($, 'stop')
    expect(w.logs).toContain(foundAt('a stop'))
  })

  test("a folder change a hand-off finds, and one the next phase's start finds, each say so in the debug log", async ($, on) => {
    const store: Record<string, unknown> = { [RUN]: atRed() }
    const w = engine(on, { ...LIVE, worktrees: [WT], spawnHold: held(), listed: [[red('running')], [red('killed')], [], []] }, store)
    await start($)
    await run($, 'resume')
    await until(w, () => w.spawned.length === 1, "#16's red agent")
    w.rootStatus = '?? stray.txt\0'
    await run($, 'handoff')
    expect(w.logs).toContain(foundAt('a hand-off'))
    await run($, 'resume')
    await waitFor(w, () => stored(store).step === 'blocked')
    expect(w.logs).toContain(foundAt("a phase's start"))
  })

  test("a folder change found when another session stops or takes over the run says so in the debug log", async ($, on) => {
    const store: Record<string, unknown> = {}
    const w = engine(on, { baseProfile: { ...PROFILE, workspace: 'worktree' }, spawnHold: held(), answer: 'Cancel', storeHold: { when: () => false, until: Promise.resolve() }, listed: [[red('running')], [red('killed')]] }, store)
    await start($)
    await run($, '16')
    await until(w, () => w.spawned.length === 1, "#16's red agent")
    w.rootStatus = '?? stray.txt\0'
    store[key(16)] = { ...(store[key(16)] as any), step: 'stopped' }
    await w.clock.advance(5_000)
    await waitFor(w, () => w.toasts.some(t => t.startsWith('#16 was stopped in another session')))
    expect(w.logs).toContain(foundAt("another session's stop or takeover"))
  })
})

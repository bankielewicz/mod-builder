// Issue Forge's state contract. Self-contained: no imports.

export type Phase = 'red' | 'green' | 'refactor'

/** Where a run is (SPEC "How it works" 14). `blocked` and `stopped` hold no work. */
export type Step =
  | 'preflight'
  | 'baseline'
  | 'red'
  | 'gateR'
  | 'green'
  | 'gateG'
  | 'refactor'
  | 'gateF'
  | 'ready'
  | 'publishing'
  | 'done'
  | 'blocked'
  | 'stopped'

/** `.issue-forge.json`, validated, defaults filled, `~` expanded (§4). */
export type Profile = {
  baseBranch: string
  testCommand: string[]
  coverageCommand: string[]
  /** Change 0.8.0 (#137): the repository's formatter; each gate runs it between two `git add -A`. Absent, no format step. */
  formatCommand?: string[]
  lcovPath: string
  sourceGlobs: string[]
  testGlobs: string[]
  excludeGlobs: string[]
  unmeasuredGlobs: string[]
  behaviourTestGlobs: string[]
  checks: string[][]
  threshold: number
  regressionTolerance: number
  attempts: { red: number; green: number; refactor: number }
  commandTimeoutMinutes: number
  notes: string
  commitTrailers: string[]
  /** Where a run works: `here` (this checkout, never when busy), `worktree` (always a new one), `ask` (when busy). */
  workspace: Workspace
  /** Where new worktrees go, relative to the repository root (gitignored). */
  worktreeDir: string
}

export type Workspace = 'ask' | 'worktree' | 'here'

/** `git merge-tree` of the gated commit against the freshly fetched base, at ready. */
export type MergeCheck = { isClean: boolean; files: string[]; error?: string }

/** A percentage rounded to two decimals, or null for "n/a". */
export type Pct = number | null

export type Check = { id: string; passed: boolean; detail: string }

export type Coverage = {
  diffLines: Pct
  diffBranches: Pct
  totalLines: Pct
  totalBranches: Pct
  /** `path: 3-5, 9` for each changed measured file with uncovered lines. */
  uncovered: string[]
}

export type Gate = {
  gate: 'R' | 'G' | 'F'
  passed: boolean
  checks: Check[]
  coverage?: Coverage
  /** G6 failed and nothing else did: the run goes back to red once. */
  isBehaviourOnly?: boolean
  /** Unmeasured source files changed since the merge base. */
  unmeasured?: string[]
  /** R4 or G8 failed: a phase agent created a plugin manifest, or the guard refused one (Change 0.7.0). */
  newPlugin?: NewPlugin
}

/** A new Claude Code plugin's manifest a phase agent made (`isCreated`) or the guard refused it (Change 0.7.0). */
export type NewPlugin = { path: string; isCreated: boolean }

export type Baseline = { lines: Pct; branches: Pct }

export type AgentRef = { id: string; name?: string; phase: Phase }

/** A stash entry the mod made, found by its unique message and kept by its commit. */
export type StashRef = { sha: string; message: string }

/**
 * One entry of `git status --porcelain=v1 -z -uall --no-renames` in the session's folder, with git's hash of the file when
 * it could be read (Change 0.10.0), or what `$.fs.stat` found there when that isn't a file, such as a submodule's folder
 * (PR #162 review round 1, finding 3).
 */
export type FolderEntry = { path: string; xy: string; hash?: string; kind?: 'dir' | 'other' }

/**
 * The session's folder as a phase's agent began (Change 0.10.0): its entries, or past 200 of them a count and a digest, with
 * a status-only digest and whether every hashable entry had its hash (PR #162 review round 2, finding 4; absent on a
 * snapshot stored before).
 */
export type FolderSnapshot =
  | { phase: Phase; at: number; entries: FolderEntry[] }
  | { phase: Phase; at: number; count: number; digest: string; statusDigest?: string; isHashed?: boolean }

export type PhaseTime = { startedAt: number; endedAt?: number }

/** The session whose drive is under way (Change 0.3.0): its `$.session.id()` at session start, and since when. */
export type Driver = { session: string; since: number }

/** One of the repository's other active runs, as the pane's `also` line shows it (Change 0.3.0). */
export type OtherRun = { issue: number; step: Step; line: string; isElsewhere: boolean }

export type Run = {
  id: string
  /** git's common folder: every worktree of the repository shares it, and it keys the store (Change 0.3.0). Absent in runs stored before. */
  repo?: string
  /** The GitHub repository (`host/owner/repo`) every gh call of the run names with `--repo` (#25). Absent in runs stored before. */
  ghRepo?: string
  /** The remote the base is fetched from, in a fork clone where origin is the contributor's fork (#26). Absent: origin. */
  baseRemote?: string
  /** The fork origin pushes to (`host/owner/repo`), whose owner heads the pull request (#26). Absent: the branch alone. */
  headRepo?: string
  /** Set while a session drives the run; cleared when the drive ends (Change 0.3.0). */
  driver?: Driver
  /** Started from the menu's Start under `ask`: it works in a new worktree, asked once (Change 0.3.0). */
  chosenWorktree?: boolean
  /** The checkout the run was started from (it keyed the store before 0.3.0). */
  root: string
  /** Where git, the profile's commands and the agents work: a new worktree, or `root`. Absent in runs stored before 0.2.0. */
  workRoot?: string
  issue: number
  title: string
  /** The issue's text; a `done` or `stopped` record keeps its first 500 characters and `…` (0.9.0). */
  body: string
  url: string
  branch: string
  base: string
  mergeBase: string
  profile: Profile | null
  step: Step
  /** Spawns used in each phase since it last started or was resumed. */
  used: { red: number; green: number; refactor: number }
  redCommit?: string
  greenCommit?: string
  refactorCommit?: string
  baseline: Baseline | null
  /** The latest result of each gate. */
  gates: { R?: Gate; G?: Gate; F?: Gate }
  lastGate?: Gate
  /** Last 200 lines, at most 20,000 characters, of the test output red's gate saw: green's first prompt gets them. Dropped once `done` or `stopped` (0.9.0). */
  redTestTail?: string
  /** Last 200 lines, at most 20,000 characters, of the latest gate's test output, or of its format command's when that failed it (R5, G9; 0.8.0): a retry's prompt gets them. Dropped once `done` or `stopped` (0.9.0). */
  lastTestTail?: string
  /** The red agent's final answer, plus a behaviour detour's once its gate R passed: each green prompt and the PR body get it. Dropped once `done` or `stopped` (0.9.0). */
  redAnswer?: string
  /** Set while red adds a behaviour test for these files (G6's one return). */
  behaviourFor?: string[]
  /** The detour's latest red answer, held until its gate R passes, then added to `redAnswer` (PR #89 review). */
  behaviourAnswer?: string
  isBehaviourDone?: boolean
  /** The stash entry holding green's work during that return; applied by its SHA only. */
  greenStash?: StashRef
  isRefactorRejected?: boolean
  refactorStash?: StashRef
  times: { red?: PhaseTime; green?: PhaseTime; refactor?: PhaseTime; publish?: PhaseTime }
  startedAt: number
  /** When the run became `done` or `stopped` (0.9.0, PR #145 review round 1): the store's budget deletes the longest finished first. */
  finishedAt?: number
  agents: AgentRef[]
  prUrl?: string
  /** HEAD when the run reached ready (after gate F): publish pushes exactly this commit, and refuses if HEAD moved. */
  gatedHead?: string
  merge?: MergeCheck
  /** The manifest the guard refused a phase agent, relative to the run's folder: the phase's gate blocks on it (Change 0.7.0). */
  newPlugin?: string
  /**
   * `steps`: what the person does next, one item each; `isFinal`: resume can't clear it, so the hint says stop
   * (Change 0.7.0). Both absent in runs stored before.
   */
  blocked?: { at: Step; reason: string; next: string; steps?: string[]; isFinal?: boolean }
  /** The session's folder as this phase's agent began, in a worktree run: compared while it works (Change 0.10.0, #156). */
  folderSnapshot?: FolderSnapshot
  /** Set by a block from the folder check: the resume stashes the worktree's uncommitted files first (Change 0.10.0). */
  isFolderBlock?: boolean
  /** The stash that resume made (Change 0.10.0). */
  folderStash?: StashRef
}

/** What the module is doing right now inside a step: a label and since when. */
export type Activity = { label: string; since: number }

declare module 'claude-code' {
  interface PluginState {
    'issue-forge': { run: Run | null; activity: Activity | null; now: number; demo: string | null; focus: number | null; others: OtherRun[] }
  }
}

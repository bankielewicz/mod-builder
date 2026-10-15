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
}

export type Baseline = { lines: Pct; branches: Pct }

export type AgentRef = { id: string; name?: string; phase: Phase }

/** A stash entry the mod made, found by its unique message and kept by its commit. */
export type StashRef = { sha: string; message: string }

export type PhaseTime = { startedAt: number; endedAt?: number }

/** The session whose drive is under way (Change 0.3.0): its `$.session.id()` at session start, and since when. */
export type Driver = { session: string; since: number }

/** One of the repository's other active runs, as the pane's `also` line shows it (Change 0.3.0). */
export type OtherRun = { issue: number; step: Step; line: string; isElsewhere: boolean }

export type Run = {
  id: string
  /** git's common folder: every worktree of the repository shares it, and it keys the store (Change 0.3.0). Absent in runs stored before. */
  repo?: string
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
  /** Last 200 lines of the test output red's gate saw: green's first prompt gets them. */
  redTestTail?: string
  /** Last 200 lines of the latest gate's test output: a retry's prompt gets them. */
  lastTestTail?: string
  redAnswer?: string
  /** Set while red adds a behaviour test for these files (G6's one return). */
  behaviourFor?: string[]
  isBehaviourDone?: boolean
  /** The stash entry holding green's work during that return; applied by its SHA only. */
  greenStash?: StashRef
  isRefactorRejected?: boolean
  refactorStash?: StashRef
  times: { red?: PhaseTime; green?: PhaseTime; refactor?: PhaseTime; publish?: PhaseTime }
  startedAt: number
  agents: AgentRef[]
  prUrl?: string
  /** HEAD when the run reached ready (after gate F): publish pushes exactly this commit, and refuses if HEAD moved. */
  gatedHead?: string
  merge?: MergeCheck
  blocked?: { at: Step; reason: string; next: string }
}

/** What the module is doing right now inside a step: a label and since when. */
export type Activity = { label: string; since: number }

declare module 'claude-code' {
  interface PluginState {
    'issue-forge': { run: Run | null; activity: Activity | null; now: number; demo: string | null; focus: number | null; others: OtherRun[] }
  }
}

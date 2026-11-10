// The phase guard's rules as pure functions (SPEC.md 3.2 and 3.3): no `$`, no file, no clock, no process.
// The hooks module reads the world and asks these; each answer depends only on its arguments.
// The syntax is plain erasable TypeScript, so the logic tests can load this file under node as it is.

// ---------------------------------------------------------------------------------------------- phases

export const PHASES = ['knowledge', 'describe', 'spec', 'scaffold', 'red', 'green', 'verify', 'done'] as const
export type Phase = (typeof PHASES)[number]

const TITLES: Record<Phase, string> = {
  knowledge: 'Knowledge',
  describe: 'Describe',
  spec: 'Spec',
  scaffold: 'Scaffold',
  red: 'Red',
  green: 'Green',
  verify: 'Verify',
  done: 'Done',
}

// What ends each phase, as SPEC.md 3.2's table has it. Describe has no gate; Done is the end.
const ENDS_WHEN: Record<Phase, string> = {
  knowledge: 'a snapshot exists',
  describe: 'the model has read the pages that bear on the request (no gate)',
  spec: 'the person approves the spec',
  scaffold: '`claude plugin validate --strict` passes',
  red: 'a new test fails by assertion',
  green: 'every test passes',
  verify: 'validate, test, the typecheck and the headless load all pass',
  done: 'the build is over',
}

const MAY_WRITE: Record<Phase, string> = {
  knowledge: 'nothing in the mod',
  describe: 'nothing in the mod',
  spec: 'SPEC.md only',
  scaffold: 'everything',
  red: 'tests/ only',
  green: 'anything but tests/ and SPEC.md',
  verify: 'anything but tests/ and hooks/',
  done: 'anything but tests/ and hooks/',
}

export const GATE_TOOL = 'mod_builder_gate'

export function isPhase(value: unknown): value is Phase {
  return typeof value === 'string' && (PHASES as readonly string[]).includes(value)
}

// 1 for Knowledge up to 8 for Done.
export function phaseNumber(phase: Phase): number {
  return PHASES.indexOf(phase) + 1
}

export function phaseTitle(phase: Phase): string {
  return TITLES[phase]
}

// "phase 5 (Red)"
export function phaseLabel(phase: Phase): string {
  return `phase ${phaseNumber(phase)} (${TITLES[phase]})`
}

// The phase after this one, or null after Done. A build moves one phase at a time.
export function nextPhase(phase: Phase): Phase | null {
  if (!isPhase(phase)) return null
  const next = PHASES[PHASES.indexOf(phase) + 1]
  return next === undefined ? null : next
}

// ---------------------------------------------------------------------------------- what a phase may write

// The tools the guard looks at. Every other tool passes: the guard does not parse a shell command.
export const GUARDED_TOOLS = ['Edit', 'MultiEdit', 'Write', 'NotebookEdit'] as const

export function isGuardedTool(tool: string): boolean {
  return (GUARDED_TOOLS as readonly string[]).includes(tool)
}

// The segments of a path with "." and empty ones dropped and ".." applied; null when ".." climbs above the root.
function segments(path: string): string[] | null {
  const kept: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (kept.length === 0) return null
      kept.pop()
    } else {
      kept.push(part)
    }
  }
  return kept
}

// Where `path` is inside the mod's folder: its path from that folder ("" for the folder itself), or null when it
// is outside. `path` may be relative to `cwd`; `modDir` and `cwd` are absolute. Paths are compared as text, with
// "/" between segments: a link is not followed, which is one reason the guard is not a sandbox.
export function pathInMod(modDir: string, path: string, cwd: string): string | null {
  if (typeof modDir !== 'string' || typeof path !== 'string' || typeof cwd !== 'string') return null
  if (!modDir.startsWith('/') || !cwd.startsWith('/') || path === '') return null
  const mod = segments(modDir)
  const target = segments(path.startsWith('/') ? path : `${cwd}/${path}`)
  if (mod === null || target === null || target.length < mod.length) return null
  for (let i = 0; i < mod.length; i++) {
    if (mod[i] !== target[i]) return null
  }
  return target.slice(mod.length).join('/')
}

// The part of the mod a path from the mod's folder belongs to. With `foldCase`, names are compared without regard
// to letter case.
type Area = 'spec' | 'tests' | 'hooks' | 'other'
function area(relPath: string, foldCase: boolean): Area {
  const parts = segments(relPath) ?? []
  const first = foldCase ? (parts[0] ?? '').toLowerCase() : parts[0] ?? ''
  if (parts.length === 1 && first === (foldCase ? 'spec.md' : 'SPEC.md')) return 'spec'
  if (first === 'tests') return 'tests'
  if (first === 'hooks') return 'hooks'
  return 'other'
}

// Whether a guarded tool may write `relPath` (a path from the mod's folder, as pathInMod gives it) in `phase`.
// SPEC.md 3.3's table covers phases 3 to 7. Before Spec nothing in the mod may be written. Done has no row: it
// keeps Verify's rule, so what was verified stays as verified for as long as the build's record is kept.
// At Verify, SPEC.md may be written (the "Built" block is appended): that its approved part is unchanged is
// checked at the gate (specKept), not here.
// A name that closes an area is compared without regard to letter case, because a file system that ignores case
// would let "spec.md" reach SPEC.md; a name that opens one must be spelled exactly, so "Tests/" opens nothing.
// A phase that is none, or a path that is no text, may write nothing.
export function mayWrite(phase: Phase, relPath: string): boolean {
  if (!isPhase(phase) || typeof relPath !== 'string') return false
  const exact = area(relPath, false)
  const folded = area(relPath, true)
  switch (phase) {
    case 'knowledge':
    case 'describe':
      return false
    case 'spec':
      return exact === 'spec'
    case 'scaffold':
      return true
    case 'red':
      return exact === 'tests'
    case 'green':
      return folded !== 'tests' && folded !== 'spec'
    case 'verify':
    case 'done':
      return folded !== 'tests' && folded !== 'hooks'
  }
}

export type WriteVerdict = { allowed: true } | { allowed: false; reason: string }

// The guard's answer for one write, with the reason a refusal shows the model: the phase, what it may write,
// what opens next and how to ask for it.
export function writeVerdict(phase: Phase, relPath: string): WriteVerdict {
  if (mayWrite(phase, relPath)) return { allowed: true }
  const shown = typeof relPath !== 'string' || relPath === '' ? 'the mod folder' : relPath
  if (!isPhase(phase)) return { allowed: false, reason: `mod-builder: ${shown} can't be written: the build's record names no phase.` }
  const next = nextPhase(phase)
  const opens =
    next === null
      ? ''
      : ` ${capital(phaseLabel(next))} opens when ${ENDS_WHEN[phase]}: ask for it by calling the ${GATE_TOOL} tool.`
  return {
    allowed: false,
    reason: `mod-builder: ${shown} can't be written in ${phaseLabel(phase)}, which may write ${MAY_WRITE[phase]}.${opens}`,
  }
}

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

// ------------------------------------------------------------------------------------------- the gates

// One command the mod ran: its exit code and everything it printed.
export type Run = { exitCode: number; output: string }

export type Verdict = { pass: true; tests?: number } | { pass: false; reason: string }

export type TestRun = { tests: number; failures: { name: string; body: string }[] }

// Reads what `claude plugin test` printed: the number of tests from its last line ("Ran 5 tests across 3 files.
// [0.22s]"), and each "(fail) <name>" block with the lines under it, which are indented by two spaces (the totals
// after the last block are indented by one). Null when the last line holds no count.
export function parseTestRun(output: string): TestRun | null {
  const lines = output.split('\n').map((line) => line.replace(/\r$/, ''))
  let last = lines.length - 1
  while (last >= 0 && lines[last].trim() === '') last--
  const ran = last < 0 ? null : lines[last].match(/^Ran (\d+) tests? across \d+ files?\./)
  if (ran === null) return null
  const failures: { name: string; body: string }[] = []
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('(fail) ')) continue
    const body: string[] = []
    for (let j = i + 1; j < lines.length && (lines[j].startsWith('  ') || lines[j] === ''); j++) body.push(lines[j])
    while (body.length > 0 && body[body.length - 1].trim() === '') body.pop()
    failures.push({ name: nameOf(lines[i]), body: body.join('\n') })
  }
  return { tests: Number(ran[1]), failures }
}

// The name on a "(pass) <name> [1.38ms]" or "(fail) <name> [0.48ms]" line: what follows the mark, without the time
// at its end. A file that did not load has no time, and a name may hold brackets of its own.
function nameOf(line: string): string {
  return line.slice('(fail) '.length).replace(/ \[[^\]]*\]$/, '')
}

// The name of every test a run shows, passed or failed, in the order printed. The mod records these at Scaffold,
// so the Red gate can tell a new test from one that was there. Null when the output is no text or its last line
// holds no count: such a run names nothing.
export function testNames(output: string): string[] | null {
  if (typeof output !== 'string' || parseTestRun(output) === null) return null
  const lines = output.split('\n').map((line) => line.replace(/\r$/, ''))
  return lines.filter((line) => line.startsWith('(pass) ') || line.startsWith('(fail) ')).map(nameOf)
}

const NO_COUNT = "the test run's last line reports no test count"

function count(tests: number): string {
  return tests === 1 ? '1 test' : `${tests} tests`
}

// Whether a recorded test count is one: a whole number, zero or more. A gate that is handed anything else has
// nothing to compare with, and refuses: a lost or damaged record must never pass a build.
function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

// A command's result the gates can read: an exit code that is a whole number and output that is text. A command
// killed by a signal has no exit code; that, or no result at all, is no evidence of anything and passes no gate.
function ended(run: Run, name: string): Verdict {
  const ok = typeof run === 'object' && run !== null && Number.isInteger(run.exitCode) && typeof run.output === 'string'
  return ok ? { pass: true } : { pass: false, reason: `${name} ended with no exit code` }
}

const VALIDATE = 'claude plugin validate --strict'
const TEST = 'claude plugin test'

// The approval question's options. "Not yet" is first, so a stray Enter can't approve; the mockups option is
// offered only when a skill named design is in the session's list.
export const NOT_YET = 'Not yet'
export const APPROVE = 'Approve'
export const SEE_IT_FIRST = 'See it first: draw mockups with /design'

export function approvalOptions(hasDesignSkill: boolean): string[] {
  return hasDesignSkill ? [NOT_YET, APPROVE, SEE_IT_FIRST] : [NOT_YET, APPROVE]
}

// Spec to Scaffold: only the person's own "Approve" passes. Any other answer, typed text or none does not.
export function specGate(answer: string | null | undefined): Verdict {
  if (answer === APPROVE) return { pass: true }
  return { pass: false, reason: `the person has not approved the spec (answer: ${answer == null ? 'none' : JSON.stringify(answer)})` }
}

// Scaffold to Red: `claude plugin validate --strict` exits 0. The test run only gives the count to record; its
// names, which the mod records too, come from testNames.
export function scaffoldGate(validate: Run, test: Run): Verdict {
  for (const check of [ended(validate, VALIDATE), ended(test, TEST)]) if (!check.pass) return check
  if (validate.exitCode !== 0) return { pass: false, reason: `claude plugin validate --strict exited ${validate.exitCode}` }
  const run = parseTestRun(test.output)
  if (run === null) return { pass: false, reason: NO_COUNT }
  return { pass: true, tests: run.tests }
}

// Whether a "(fail)" block opens with an assertion error: the first line under the test starts with
// "AssertionError", as in "  AssertionError: expect(received).toBe()". A file that did not load opens with something
// else, even when a source line it quotes further down holds "expect(".
function opensWithAssertion(body: string): boolean {
  return body.split('\n')[0].trimStart().startsWith('AssertionError')
}

// Recorded names are a list of texts. Anything else is no record, and a gate handed it refuses.
function isNames(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((name) => typeof name === 'string')
}

// Red to Green: the tests fail, there are more of them than at Scaffold, every failure opens with an assertion
// error, and at least one failing test has a name that no test had at Scaffold (`namesAtScaffold`, as testNames
// gave them there). So a file that did not load can't pass, and neither can an old test failing beside a new one
// that passes.
export function redGate(test: Run, testsAtScaffold: number, namesAtScaffold: string[]): Verdict {
  if (!isCount(testsAtScaffold)) return { pass: false, reason: 'no test count is recorded from Scaffold' }
  if (!isNames(namesAtScaffold)) return { pass: false, reason: 'no test names are recorded from Scaffold' }
  const check = ended(test, TEST)
  if (!check.pass) return check
  if (test.exitCode === 0) return { pass: false, reason: 'claude plugin test exited 0: no test fails yet' }
  const run = parseTestRun(test.output)
  if (run === null) return { pass: false, reason: NO_COUNT }
  if (run.tests <= testsAtScaffold) {
    return { pass: false, reason: `the run has ${count(run.tests)}, no more than the ${testsAtScaffold} at Scaffold: no new test` }
  }
  if (run.failures.length === 0) return { pass: false, reason: 'claude plugin test failed, but its output holds no (fail) block' }
  const other = run.failures.filter((failure) => !opensWithAssertion(failure.body))
  if (other.length > 0) {
    return { pass: false, reason: `not failing by assertion: ${other.map((failure) => failure.name).join('; ')}` }
  }
  if (run.failures.every((failure) => namesAtScaffold.includes(failure.name))) {
    const old = run.failures.map((failure) => failure.name).join('; ')
    return { pass: false, reason: `no new test fails: every failing test had its name at Scaffold (${old})` }
  }
  return { pass: true, tests: run.tests }
}

// Green to Verify: every test passes, and no test went missing since Red.
export function greenGate(test: Run, testsAtRed: number): Verdict {
  if (!isCount(testsAtRed)) return { pass: false, reason: 'no test count is recorded from Red' }
  const check = ended(test, TEST)
  if (!check.pass) return check
  if (test.exitCode !== 0) return { pass: false, reason: `claude plugin test exited ${test.exitCode}: not every test passes` }
  const run = parseTestRun(test.output)
  if (run === null) return { pass: false, reason: NO_COUNT }
  if (run.tests < testsAtRed) return { pass: false, reason: `the run has ${count(run.tests)}, fewer than the ${testsAtRed} at Red` }
  return { pass: true, tests: run.tests }
}

// `loadShown` is whether the headless session's debug log shows the mod loaded and admitted (SPEC.md 4). The
// caller reads the log: what those lines look like on a build is a probe SPEC.md 5 still owes (P2), and a line
// such as "not loaded:" holds the word too, so these rules do not guess at it.
export type VerifyRuns = { validate: Run; test: Run; typecheck: Run; load: Run; loadShown: boolean }

// Verify to Done: validate, test, the typecheck and the headless load all pass, and the load is seen in the log.
export function verifyGate(runs: VerifyRuns, testsAtRed: number): Verdict {
  if (!isCount(testsAtRed)) return { pass: false, reason: 'no test count is recorded from Red' }
  if (typeof runs !== 'object' || runs === null) return { pass: false, reason: `${VALIDATE} ended with no exit code` }
  for (const check of [ended(runs.validate, VALIDATE), ended(runs.test, TEST), ended(runs.typecheck, 'the typecheck'), ended(runs.load, 'the headless load')]) {
    if (!check.pass) return check
  }
  if (runs.validate.exitCode !== 0) return { pass: false, reason: `claude plugin validate --strict exited ${runs.validate.exitCode}` }
  const tests = greenGate(runs.test, testsAtRed)
  if (!tests.pass) return tests
  if (runs.typecheck.exitCode !== 0) return { pass: false, reason: `the typecheck exited ${runs.typecheck.exitCode}` }
  if (runs.load.exitCode !== 0) return { pass: false, reason: `the headless load exited ${runs.load.exitCode}` }
  if (runs.loadShown !== true) return { pass: false, reason: 'the headless load\'s debug log does not show the mod loaded and admitted' }
  return tests
}

// ---------------------------------------------------------------------------------------- the hashes

// File path from the mod's folder -> the hash of its content.
export type Hashes = Record<string, string>

function isHash(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

function isHashes(value: unknown): value is Hashes {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// The files that are not as recorded: changed, gone, or (for a folder whose whole content was recorded, as
// tests/ is when Red passes) added since. Sorted by path.
export function changedFiles(recorded: Hashes, current: Hashes): { path: string; how: 'changed' | 'missing' | 'added' }[] {
  // A file may be named like a property every object has ("constructor"), so only own keys count.
  const has = (hashes: Hashes, path: string) => Object.prototype.hasOwnProperty.call(hashes, path)
  const found: { path: string; how: 'changed' | 'missing' | 'added' }[] = []
  if (!isHashes(recorded) || !isHashes(current)) return found
  for (const path of Object.keys(recorded)) {
    if (!has(current, path)) found.push({ path, how: 'missing' })
    else if (current[path] !== recorded[path] || !isHash(recorded[path])) found.push({ path, how: 'changed' })
  }
  for (const path of Object.keys(current)) {
    if (!has(recorded, path)) found.push({ path, how: 'added' })
  }
  return found.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

// A gate's hash check of the tests: refuses, naming each file, when one differs from what was recorded. Both
// sides hold the same scope, every file under tests/ and nothing else: a file outside it would count as added.
export function hashGate(recorded: Hashes, current: Hashes): Verdict {
  if (!isHashes(recorded)) return { pass: false, reason: 'no hashes are recorded for tests/' }
  if (!isHashes(current)) return { pass: false, reason: 'the files under tests/ could not be read' }
  const found = changedFiles(recorded, current)
  if (found.length === 0) return { pass: true }
  return { pass: false, reason: `not as recorded: ${found.map((file) => `${file.path} (${file.how})`).join(', ')}` }
}

// SPEC.md as it was at approval, and as it is now. `approvedPartHash` is the hash of its first `length` characters,
// `length` being the recorded one; null when the file is now shorter than that, or gone.
export type SpecRecord = { length: number; hash: string }
export type SpecNow = { length: number; hash: string; approvedPartHash: string | null }

// A gate's check of SPEC.md. Up to the gate that ends Green the file must be exactly as approved. From Verify on
// it may have grown, because Verify appends the "Built" block: then its approved part must be unchanged.
export function specKept(recorded: SpecRecord, now: SpecNow | null, phase: Phase): Verdict {
  if (typeof recorded !== 'object' || recorded === null || !isCount(recorded.length) || !isHash(recorded.hash)) {
    return { pass: false, reason: 'no approved SPEC.md is recorded' }
  }
  if (now === null) return { pass: false, reason: 'not as recorded: SPEC.md (missing)' }
  const mayGrow = phase === 'verify' || phase === 'done'
  const readable = typeof now === 'object' && isCount(now.length) && isPhase(phase)
  const kept = !readable
    ? false
    : mayGrow
      ? now.length >= recorded.length && now.approvedPartHash === recorded.hash
      : now.length === recorded.length && now.hash === recorded.hash
  if (kept) return { pass: true }
  return { pass: false, reason: mayGrow ? "not as recorded: SPEC.md (its approved part changed)" : 'not as recorded: SPEC.md (changed)' }
}

// ------------------------------------------------------------------------------- staleness of the cache

// The time a snapshot stamp names ("2026-11-10T151216Z"), in milliseconds since 1970, or null when it is no stamp.
export function parseStamp(stamp: string): number | null {
  if (typeof stamp !== 'string') return null
  const match = stamp.trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})(\d{2})(\d{2})Z$/)
  if (match === null) return null
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number)
  const time = Date.UTC(year, month - 1, day, hour, minute, second)
  const back = new Date(time)
  const real = back.getUTCFullYear() === year && back.getUTCMonth() === month - 1 && back.getUTCDate() === day
  return real && hour < 24 && minute < 60 && second < 60 ? time : null
}

export const DEFAULT_REFRESH_DAYS = 7

export type CacheState = {
  isInteractive: boolean // a headless session never fetches
  refreshDays: number // the plugin option; 0 turns the automatic fetch off; what is no number counts as the default
  checked: string | null // the cache's `checked` file: the stamp of the last fetch, or null when there is none
  now: number // milliseconds since 1970
  version: string // the Claude Code version of this session
  versionAtCheck: string | null // the version recorded at the last fetch
}

const DAY = 24 * 60 * 60 * 1000

// Whether session.start should start a fetch: the session is interactive, the option is not 0, and the last
// fetch is older than `refreshDays` days, unreadable or missing, or was made by another Claude Code version.
// A `checked` more than a day ahead of the clock is as unreadable as garbage: one wrong clock must not hold the
// cache back until that date. A clock reading that is no time leaves no age to judge by, and counts as stale too.
export function isCacheStale(state: CacheState): boolean {
  if (!state.isInteractive) return false
  const days = typeof state.refreshDays === 'number' && Number.isFinite(state.refreshDays) ? state.refreshDays : DEFAULT_REFRESH_DAYS
  if (days <= 0) return false
  if (!(typeof state.now === 'number' && Number.isFinite(state.now))) return true
  const checked = parseStamp(state.checked as string)
  if (checked === null || checked - state.now > DAY) return true
  // A session that does not know its own version can't say the version changed: it is judged by age alone.
  const knowsVersion = typeof state.version === 'string' && state.version !== ''
  if (knowsVersion && state.versionAtCheck !== state.version) return true
  return state.now - checked > days * DAY
}

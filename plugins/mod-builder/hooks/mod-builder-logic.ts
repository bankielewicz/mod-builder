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
  red: 'a new test fails by assertion and the mod, its tests included, typechecks',
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
  const at = (index: number): string => lines[index] ?? ''
  let last = lines.length - 1
  while (last >= 0 && at(last).trim() === '') last--
  const ran = last < 0 ? null : at(last).match(/^Ran (\d+) tests? across \d+ files?\./)
  if (ran === null) return null
  const failures: { name: string; body: string }[] = []
  for (let i = 0; i < lines.length; i++) {
    if (!at(i).startsWith('(fail) ')) continue
    const body: string[] = []
    for (let j = i + 1; j < lines.length && (at(j).startsWith('  ') || at(j) === ''); j++) body.push(at(j))
    while (body.length > 0 && (body[body.length - 1] ?? '').trim() === '') body.pop()
    failures.push({ name: nameOf(at(i)), body: body.join('\n') })
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
  // A scaffold's tests all pass (SPEC.md 7.11): everything but tests/ closes when Scaffold passes, and Red takes
  // no failure that does not open with an assertion error, so a test that fails here could never be mended there.
  if (test.exitCode !== 0) return { pass: false, reason: `claude plugin test exited ${test.exitCode}: not every test of the scaffold passes` }
  const run = parseTestRun(test.output)
  if (run === null) return { pass: false, reason: NO_COUNT }
  return { pass: true, tests: run.tests }
}

// The typecheck alone, as Scaffold and Red end on it (SPEC.md 7.10): it ran to an exit code, and that code is 0.
// Green and Verify judge theirs among the four checks, in verifyGate.
export function typecheckGate(typecheck: Run): Verdict {
  const check = ended(typecheck, 'the typecheck')
  if (!check.pass) return check
  if (typecheck.exitCode !== 0) return { pass: false, reason: `the typecheck exited ${typecheck.exitCode}` }
  return { pass: true }
}

// Whether a "(fail)" block opens with an assertion error: the first line under the test starts with
// "AssertionError", as in "  AssertionError: expect(received).toBe()". A file that did not load opens with something
// else, even when a source line it quotes further down holds "expect(".
function opensWithAssertion(body: string): boolean {
  return (body.split('\n')[0] ?? '').trimStart().startsWith('AssertionError')
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
  const [year = 0, month = 0, day = 0, hour = 0, minute = 0, second = 0] = match.slice(1).map(Number)
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

// ------------------------------------------------------------------------------- Verify's typecheck

// The typecheck of the mod being built (SPEC.md 7.5): against the types of the build that runs the session, which
// Claude Code writes when its plugin-authoring skill loads, with a tsconfig kept outside the mod. Nothing here is
// fetched, and no path comes from the model.

// The compilers tried, in order: one that is installed, else one npx downloads.
export const COMPILERS: readonly (readonly string[])[] = [['npx', '--no-install', 'tsc'], ['npx', '-y', '-p', 'typescript', 'tsc']]

// The folder that holds one folder per process that loaded the plugin-authoring skill on this build, each with
// the build's types; null when it can't be placed. `tmpDir` is CLAUDE_TMPDIR; without it, /tmp/claude-<user id>.
export function typesFolder(tmpDir: string | null | undefined, userId: string | null | undefined, version: string): string | null {
  if (typeof version !== 'string' || !/^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(version)) return null
  const given = typeof tmpDir === 'string' && tmpDir.startsWith('/') ? absolutePath(tmpDir, '/') : null
  const id = typeof userId === 'string' ? userId.trim() : ''
  const base = given !== null && given !== '/' ? given : /^[0-9]+$/.test(id) ? `/tmp/claude-${id}` : null
  return base === null ? null : `${base}/bundled-skills/${version}`
}

// Where a process's types file is, under one of that folder's folders.
export function typesFileIn(folder: string, name: string): string {
  return `${folder}/${name}/plugin-authoring/types/claude-code.d.ts`
}

// Whether a types file is this build's: its first line names the version that wrote it.
export function isTypesOf(text: string, version: string): boolean {
  return typeof text === 'string' && typeof version === 'string' && version !== '' && text.split('\n')[0] === `// Written by Claude Code ${version}.`
}

// The tsconfig.json for the check, as the types file's own header gives it, naming the types file and the mod's
// hooks/, tests/ and types/ by their full paths: it is kept outside the mod.
export function typecheckConfig(typesFile: string, modDir: string): string {
  const config = {
    compilerOptions: {
      target: 'es2023', lib: ['es2023'], types: [], module: 'esnext', moduleResolution: 'bundler', strict: true,
      noUncheckedIndexedAccess: true, noEmit: true, skipLibCheck: true, jsx: 'react', jsxFactory: 'h', jsxFragmentFactory: 'Fragment',
    },
    include: [typesFile, `${modDir}/hooks`, `${modDir}/tests`, `${modDir}/types`],
  }
  return `${JSON.stringify(config, null, 2)}\n`
}

// One candidate for the build's types: a file whose first line names the session's version, and what it holds.
// `content` is compared whole (the file's bytes, as the caller read them); `sha256` is the file's own hash.
export type TypesCandidate = { path: string; content: string; sha256: string }

// The types the typecheck runs against: one file for each distinct content among the candidates, in the order of
// their hashes; or why there is none.
export type TypesToCheck = { pass: true; types: { path: string; sha256: string }[] } | { pass: false; reason: string }

// Which types the typecheck runs against (SPEC.md 7.9, which corrects 7.7's decision 2). Genuine types files of one
// build differ between sessions (the Bash tool's fields differ where the sandbox is on), so candidates that differ
// are no reason to refuse, and none of them is picked: the typecheck runs once for each distinct content and must
// pass for every one. A planted file can then only make the check stricter or fail it; it can never make a mod
// pass that fails against the genuine files, because those are checked too. With no candidate there is nothing
// to check against, and that refuses.
export function typesToCheck(candidates: readonly TypesCandidate[], folder: string | null, version: string): TypesToCheck {
  const found = Array.isArray(candidates) ? candidates : []
  if (found.length === 0) {
    return {
      pass: false,
      reason: `the types of Claude Code ${version} are not written yet (looked in ${folder ?? 'no folder: CLAUDE_TMPDIR is not set and the user id could not be read'}): load the plugin-authoring skill with the Skill tool, which writes them, then ask again`,
    }
  }
  // One file stands for each distinct content: the first by path, so that the same files give the same answer.
  const byPath = [...found].sort((one, other) => (one.path < other.path ? -1 : one.path > other.path ? 1 : 0))
  const distinct: TypesCandidate[] = []
  for (const one of byPath) {
    if (!distinct.some((kept) => kept.content === one.content && kept.sha256 === one.sha256)) distinct.push(one)
  }
  const types = distinct.map((one) => ({ path: one.path, sha256: one.sha256 }))
  types.sort((one, other) => (one.sha256 < other.sha256 ? -1 : one.sha256 > other.sha256 ? 1 : one.path < other.path ? -1 : 1))
  return { pass: true, types }
}

// The "Built on" line of a built mod's SPEC.md, as the gate prints it for the model to copy: the build, the docs
// snapshot, and the hash of every distinct types file the typecheck ran against, sorted.
export function builtOnLine(version: string, snapshot: string, hashes: readonly string[]): string {
  return `Built on Claude Code ${version}, from the docs snapshot ${snapshot}, against the types sha256 ${[...new Set(hashes)].sort().join(', ')}.`
}

// The hashes missing from the "Built" block of a SPEC.md: the part after its approved text must hold every one,
// whole (a hash inside a longer run of hex digits is another number).
export function builtMisses(spec: string, approvedLength: number, hashes: readonly string[]): string[] {
  const built = typeof spec === 'string' && Number.isInteger(approvedLength) && approvedLength >= 0 ? spec.slice(approvedLength) : ''
  const holds = (hash: string) => /^[0-9a-f]+$/.test(hash) && new RegExp(`(?<![0-9a-f])${hash}(?![0-9a-f])`).test(built)
  return [...new Set(hashes)].sort().filter((hash) => typeof hash !== 'string' || !holds(hash))
}

// Which of the four checks a refused Green or Verify failed at, in the order verifyGate judges them: one that
// ended with no exit code first (in the order they run), then validate, the tests, the typecheck, the load. The
// lines a refusal quotes are that command's, whatever else failed beside it.
export function refusedAt(runs: VerifyRuns, testsAtRed: number): 'validate' | 'test' | 'typecheck' | 'load' {
  const order = [['validate', runs.validate], ['test', runs.test], ['typecheck', runs.typecheck], ['load', runs.load]] as const
  const unended = order.find(([, ran]) => !ended(ran, '').pass)
  if (unended !== undefined) return unended[0]
  if (runs.validate.exitCode !== 0) return 'validate'
  if (!greenGate(runs.test, testsAtRed).pass) return 'test'
  return runs.typecheck.exitCode !== 0 ? 'typecheck' : 'load'
}

// What a refused `claude plugin validate` is quoted by: the last lines of what it printed before its "Plugin
// directory checks for" section. That section lists what the plugin directory would refuse (a missing README, a
// missing license), says itself that it does not change the result, and is long enough to push the real error out
// of the last 20 lines. Without that heading, the last lines of the whole.
export function validateLines(output: string, count = 20): string {
  if (typeof output !== 'string') return ''
  const lines = output.replace(/\r\n/g, '\n').split('\n')
  const at = lines.findIndex((line) => line.trimStart().startsWith('Plugin directory checks for'))
  // With nothing before that section there is nothing of validate's own to quote: then the last lines of the whole.
  const own = at < 0 ? '' : lastLines(lines.slice(0, at).join('\n'), count)
  return own !== '' ? own : lastLines(lines.join('\n'), count)
}

// The last lines of a command's output, for a refusal to carry (SPEC.md 7.7, decision 1): at most `count` lines,
// empty lines at the end left out; '' when there is nothing to show.
export function lastLines(output: string, count = 20): string {
  if (typeof output !== 'string' || !(Number.isInteger(count) && count > 0)) return ''
  const lines = output.replace(/\r\n/g, '\n').split('\n')
  while (lines.length > 0 && (lines.at(-1) as string).trim() === '') lines.pop()
  return lines.slice(-count).join('\n')
}

// Whether a compiler asked for its version answered as one: it ran, and said "Version <number>".
export function isCompiler(run: Run): boolean {
  return typeof run === 'object' && run !== null && run.exitCode === 0 && typeof run.output === 'string' && /^Version [0-9]/.test(run.output.trim())
}

// ------------------------------------------------------------------------------- what opens a build

// The part of a `skill.prompt` input the mod reads (the build's types, 2.1.322): the skill's name, whose words it
// is, the plugin it comes with, and the file it was loaded from.
export type SkillPrompt = { skill: string; source: string; pluginName?: string; path?: string }

export const BUILD_SKILL = 'build'

// Whether a skill being expanded is this plugin's `build`: the plugin it comes with is this one, its name is
// "build", alone or after the plugin's name and a colon, as a plugin's skill is listed ("mod-builder:build"), and
// the file it was loaded from, when the event names one, is under this plugin's folder. So another plugin's skill
// of that name, a project's, and the build skill of another plugin that shares this one's name open nothing.
// `source` is not read: which word a plugin loaded with --plugin-dir carries there is not verified on 2.1.322.
export function isBuildSkill(e: SkillPrompt, pluginName: string, pluginRoot: string): boolean {
  if (typeof e !== 'object' || e === null || typeof pluginName !== 'string' || pluginName === '') return false
  if (typeof pluginRoot !== 'string' || !pluginRoot.startsWith('/')) return false
  if (e.pluginName !== pluginName) return false
  if (e.path !== undefined && pathInMod(pluginRoot, e.path as string, '/') === null) return false
  return e.skill === BUILD_SKILL || e.skill === `${pluginName}:${BUILD_SKILL}`
}

// ------------------------------------------------------------------------------------- the record

// What `$.store` holds for a session that started a build: `modDir` is null while the build is pending (the
// model has not yet named the mod's folder through the gate tool), and the mod's folder from then on.
export type SessionEntry = { modDir: string | null }

// One build, kept under its mod's folder and bound to the session that started it.
export type BuildRecord = {
  modDir: string
  sessionId: string
  phase: Phase
  specApprovedAt: number | null // milliseconds since 1970
  spec: SpecRecord | null // SPEC.md as it was at approval
  testsAtScaffold: number | null
  namesAtScaffold: string[] | null
  testsAtRed: number | null
  testHashes: Hashes | null // every file under tests/, when Red passed
  evidence: Record<string, string> // phase -> what the gate that ended it saw
}

export function sessionKey(sessionId: string): string {
  return `session:${sessionId}`
}

export function buildKey(modDir: string): string {
  return `build:${modDir}`
}

// An absolute path with "." and ".." applied and no "/" at its end, or null when it is none: `path` may be
// relative to `cwd`, which is absolute.
export function absolutePath(path: string, cwd: string): string | null {
  if (typeof path !== 'string' || typeof cwd !== 'string' || path === '' || !cwd.startsWith('/')) return null
  const parts = segments(path.startsWith('/') ? path : `${cwd}/${path}`)
  return parts === null ? null : `/${parts.join('/')}`
}

// A new build's record: at Knowledge, with nothing approved and nothing recorded.
export function newRecord(modDir: string, sessionId: string): BuildRecord {
  return {
    modDir, sessionId, phase: 'knowledge', specApprovedAt: null, spec: null,
    testsAtScaffold: null, namesAtScaffold: null, testsAtRed: null, testHashes: null, evidence: {},
  }
}

export function isSessionEntry(value: unknown): value is SessionEntry {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const modDir = (value as { modDir?: unknown }).modDir
  return modDir === null || (typeof modDir === 'string' && modDir.startsWith('/'))
}

// Whether a stored value is a build's record as far as the guard reads it: a folder, a session and a phase.
export function isBuildRecord(value: unknown): value is BuildRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Partial<BuildRecord>
  return typeof record.modDir === 'string' && record.modDir.startsWith('/') && typeof record.sessionId === 'string' && record.sessionId !== '' && isPhase(record.phase)
}

// ------------------------------------------------------------------------------------- the guard

// The path a guarded tool writes: `notebook_path` for NotebookEdit, `file_path` for the others. The tool decides
// which field is read, so a call can't show the guard one path and write another. Null when the call names none.
export function toolPath(tool: string, e: { file_path?: unknown; notebook_path?: unknown }): string | null {
  if (typeof e !== 'object' || e === null) return null
  const path = tool === 'NotebookEdit' ? e.notebook_path : e.file_path
  return typeof path === 'string' && path !== '' ? path : null
}

// Every folder above a path, nearest first, each absolute: where a `.claude-plugin/plugin.json` would make the
// path part of a plugin. Empty when the path is none.
export function foldersAbove(path: string, cwd: string): string[] {
  const absolute = absolutePath(path, cwd)
  if (absolute === null) return []
  const parts = absolute.split('/').filter((part) => part !== '')
  const found: string[] = []
  for (let length = parts.length - 1; length >= 0; length--) found.push(`/${parts.slice(0, length).join('/')}`)
  return found
}

// The folder a write is creating as a plugin: the one whose `.claude-plugin/plugin.json` the path is, or null.
// Another file of a `.claude-plugin` folder (a marketplace's list) makes no plugin.
export function pluginFolderBeingMade(path: string, cwd: string): string | null {
  const absolute = absolutePath(path, cwd)
  if (absolute === null) return null
  const parts = absolute.split('/').filter((part) => part !== '')
  const length = parts.length
  if (length < 2 || parts[length - 1] !== 'plugin.json' || parts[length - 2] !== '.claude-plugin') return null
  return `/${parts.slice(0, length - 2).join('/')}`
}

export type GuardInput = {
  tool: string
  path: string | null // toolPath's answer
  cwd: string
  sessionId: string
  entry: unknown // what the store holds under sessionKey(sessionId)
  record: unknown // what it holds under buildKey(entry.modDir), when the entry names a folder
  pluginFolders: string[] // the folders above the path that hold a .claude-plugin/plugin.json
}

// The guard's answer for one tool call. A tool the guard does not look at, a call that names no path, and a session
// with no build pass at once. In a session with a build, a path that can't be made absolute (it climbs above the
// root, or the session's folder is not known) can't be judged, and is refused. While the build is pending, a write
// inside any plugin's folder, or one that makes a folder a plugin, is refused until the gate tool has been told
// the mod's folder; of `pluginFolders` only those above the path count. From then on paths under the mod's
// folder are judged by the phase the build's record names; a record that is missing, damaged or another
// session's judges nothing and so allows nothing under that folder. A write into another plugin's folder, outside
// the mod or inside it, is refused until the build is Done; any other path outside the mod passes.
export function guardVerdict(input: GuardInput): WriteVerdict {
  if (!isGuardedTool(input.tool) || input.path === null) return { allowed: true }
  if (input.entry === undefined || input.entry === null) return { allowed: true }
  if (!isSessionEntry(input.entry)) {
    return { allowed: false, reason: `mod-builder: ${input.path} can't be written: this session's build record can't be read. Start the build again with /mod-builder:build.` }
  }
  if (absolutePath(input.path, input.cwd) === null) {
    return { allowed: false, reason: `mod-builder: ${input.path} can't be written: the path can't be read as one under ${String(input.cwd)}, so the build's guard can't judge it. Give the path from the root.` }
  }
  // The plugin's folder the path lies in: the one the write is making, or the nearest above it that holds a manifest.
  const above = foldersAbove(input.path, input.cwd)
  const holding = Array.isArray(input.pluginFolders) ? above.find((folder) => input.pluginFolders.includes(folder)) : undefined
  const folder = pluginFolderBeingMade(input.path, input.cwd) ?? holding
  if (input.entry.modDir === null) {
    if (folder === undefined) return { allowed: true }
    return {
      allowed: false,
      reason: `mod-builder: ${input.path} can't be written yet: it is in a plugin's folder (${folder}), and this build has not named its mod's folder. Call the ${GATE_TOOL} tool with mod_dir first.`,
    }
  }
  const relPath = pathInMod(input.entry.modDir, input.path, input.cwd)
  const own = isBuildRecord(input.record) && input.record.modDir === input.entry.modDir && input.record.sessionId === input.sessionId
  // Another plugin's folder stays closed until this build is Done: else naming any folder through the gate, an
  // invented one or one that holds the real mod, would leave the real mod unchecked. The path is another plugin's
  // when the plugin folder it lies in is not the mod's own: outside the mod, any plugin folder; under the mod, one
  // that lies inside it. (A plugin folder above the mod leaves the mod's own paths to the phase.) A record that
  // can't be read is not Done.
  const inMod = folder === undefined ? null : pathInMod(input.entry.modDir, folder, '/')
  const others = folder !== undefined && (relPath === null || (inMod !== null && inMod !== ''))
  const done = own && (input.record as BuildRecord).phase === 'done'
  if (others && !done) {
    return {
      allowed: false,
      reason: `mod-builder: ${input.path} can't be written: it is in another plugin's folder (${folder}), and this session is building ${input.entry.modDir}. Until that build is Done, its mod is the only plugin this session may write.`,
    }
  }
  if (relPath === null) return { allowed: true }
  if (!own) {
    return { allowed: false, reason: `mod-builder: ${relPath === '' ? 'the mod folder' : relPath} can't be written: the build's record for ${input.entry.modDir} is missing or is not this session's. Call the ${GATE_TOOL} tool to see where the build stands.` }
  }
  return writeVerdict((input.record as BuildRecord).phase, relPath)
}

// ------------------------------------------------------------------------------- the headless load

// The debug-log lines that say a hook of the mod was skipped: "<name>: <event> hook skipped: <why>", after the
// log's own stamp. A mod whose hook throws when the session starts is loaded and does nothing (the owner's probe,
// 2026-11-10: a mod named `clear`, whose command the build refuses), so such a line fails the load.
export function hooksSkipped(log: string, name: string): string[] {
  if (typeof log !== 'string' || typeof name !== 'string' || name === '') return []
  const opens = `${name}: `
  return log.split('\n').map((line) => line.replace(/\r$/, '')).filter((line) => {
    const at = line.startsWith(opens) ? 0 : line.indexOf(` ${opens}`) + 1
    if (at === 0 && !line.startsWith(opens)) return false
    return /^[A-Za-z][A-Za-z0-9._:-]* hook skipped:/.test(line.slice(at + opens.length))
  })
}

// Whether a headless session's debug log shows a mod's hooks module loaded (SPEC.md 7.3): a line holds
// "hooks module <name>@inline loaded", no line says of that mod that it failed to load, did not load or was
// not loaded, and no line says a hook of it was skipped. The lines are those of 2.1.322.
export function loadShown(log: string, name: string): boolean {
  if (typeof log !== 'string' || typeof name !== 'string' || name === '') return false
  const lines = log.split('\n')
  const module = `hooks module ${name}@inline`
  // A line is this mod's when it names its module, or opens (after the log's own stamp) with its name and a colon.
  const says = (line: string, text: string) => line.startsWith(text) || line.includes(` ${text}`)
  const failed = (line: string) =>
    says(line, `${module} failed to load`) || says(line, `${name}: hooks module did not load`) ||
    ((says(line, `${module} `) || says(line, `${name}: `)) && line.includes('not loaded:'))
  return lines.some((line) => says(line, `${module} loaded`)) && !lines.some(failed) && hooksSkipped(log, name).length === 0
}

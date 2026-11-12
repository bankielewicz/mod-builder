// The phase guard (SPEC.md 3.3): a build is opened when this plugin's build skill is expanded, a tool.call hook
// refuses the writes a phase may not make, and one tool, mod_builder_gate, runs each phase's check itself and
// advances the build on what the check shows. Beside it (SPEC.md 3.1, "When"): at the start of an interactive
// session the documentation cache is refreshed when it is stale, `/mod-builder refresh` refreshes it now, and one
// pane shows the phases, the evidence and the cache. The rules are in mod-builder-logic.ts; this file reads the
// world for them through `$` and writes down what they answer.
import type { EngineInterface, Register } from 'claude-code'

import {
  approvalHint, changesIn, checksKey, commandOf, countRefusal, doneToast, newChecks, openedLine, pagesIn, paneModel, parseTestRun, agreedHashes, registersOf, untestedChanges, untestedEvidence, untestedGate, untestedQuestion, refreshedToast, refusalsKey, settledChecks, stoppedKey, testResult, typecheckResult, withCheck, withResult,
  APPROVE_NO_CHANGE, baselineVerdict, editApprovalOptions, editApprovalQuestion, editFolderVerdict, editRedGate, editSpecGate, editSpecKept, entryKind,
  isEditSkill, isOpenRecord, isTestPath, isKeptOut, keptTestsGate, mayRefactor, namesGone, newEditRecord, nextPhaseOf, phaseLabelOf, putsBack, recordKind, refactorRecord, repairRedGate,
  restoreFolder, stopOptions, stoppedFolder, stoppedRecord, testChangeEvidence, testChangeGate, testChangeOptions, testChangeQuestion, testFilesChanged, testFilesToAsk, testHashesOf, versionGate,
  APPROVE, GATE_TOOL, PHASES, absolutePath, approvalOptions, buildKey, foldersAbove, greenGate, guardVerdict,
  hashGate, isBuildRecord, isBuildSkill, isCacheStale, isCompiler, isGuardedTool, isSessionEntry, loadShown, newRecord, nextPhase, phaseLabel, phaseNumber, pluginFolderBeingMade, redGate,
  GO_ON, READER, READER_DESCRIPTION, READER_NAME, READER_NUDGE, READER_NUDGES, READER_PROMPT, READER_STARTED, READER_TOOLS, findingLines, readReaderAnswer, readVerdict, readerEvidence,
  readerGate, readerKey, readerMayCall, readerMessage, readerOptions, readerQuestion, readerReading, readerRefusal, readerStartsEvidence, readerStartsQuestion, readerStep, readerWaits,
  readersKey, roundEnds, sectionLine, startsEnd, unnameable,
  scaffoldGate, scaffoldKeptGate, sessionKey, specGate, specKept, testNames, toolPath, typecheckConfig, typesFileIn, typesFolder, typesToCheck, isTypesOf, lastLines, hooksSkipped, builtOnLine, builtMisses, refusedAt, typecheckGate, validateLines, COMPILERS, verifyGate,
} from './mod-builder-logic'
import type { UntestedFile, AskedFile, Attempt, Baseline, BuildRecord, Cell, Check, Checks, CheckState, Finished, Hashes, Kind, PaneInput, PaneModel, Phase, Run, SpecNow, Stop, Tone, TypecheckRun, TypesCandidate, Verdict } from './mod-builder-logic'

type Engine = EngineInterface

// How long each check may run, in milliseconds. `$.process.run` allows ten minutes at most (the build's types).
const VALIDATE_MS = 120000
const SCAFFOLD_MS = 60000
const TEST_MS = 300000
const TYPECHECK_MS = 300000
const LOAD_MS = 120000
// Asking a compiler for its version: npx may download it first.
const COMPILER_MS = 300000

const REFRESH_MS = 300000

// What stands for the hash of a link, or of anything else under tests/ that is no file and no folder. Its content
// is not read, so it can't be recorded: Red refuses a tests/ that holds one.
const NOT_A_FILE = 'not a file'

// How a build is started (SPEC.md 7.5): the build skill's own command. `/mod-builder <words>` can't start one: it
// runs this mod's command, and a submitted command's text can't be rewritten into another command.
const START = '/mod-builder:build'
// How an edit is started (SPEC.md 8.3): the edit skill's own command.
const EDIT_START = '/mod-builder:edit'

const NO_BUILD = `mod-builder: no build is open in this session. ${START} <what the mod should do> starts one, and ${EDIT_START} <mod folder> <what to change> an edit.`

const PANE = 'mod-builder'
// The store key that holds the Claude Code version the documentation was last fetched under.
const FETCHED_UNDER = 'refresh:version'

const cacheOf = (home: string) => `${home}/.claude/mod-builder-data/v2/docs`

// ------------------------------------------------------------------------------------ reading the world

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

// A file's text, or null when it can't be read.
async function readText($: Engine, path: string): Promise<string | null> {
  try {
    return await $.fs.read(path)
  } catch {
    return null
  }
}

// One command, as the gates read it: its exit code and what it wrote to standard output. A test's own printing
// goes to standard error, so it is not read as the runner's report. A command that could not start, or outran its
// time, has no exit code, and the gates refuse it.
// `errors` is what it wrote to standard error: never read as evidence, and shown only when a refusal quotes it.
async function run($: Engine, argv: readonly string[], timeoutMs: number, cwd?: string): Promise<Run & { errors: string }> {
  try {
    const ran = await $.process.run(argv, cwd === undefined ? { timeoutMs } : { timeoutMs, cwd })
    // Output cut at the engine's limit has lost its end, where the runner's count is: it is no evidence.
    if (ran.isStdoutTruncated) return { exitCode: Number.NaN, output: '', errors: '' }
    return { exitCode: ran.exitCode, output: ran.stdout, errors: ran.stderr }
  } catch {
    return { exitCode: Number.NaN, output: '', errors: '' }
  }
}

// SPEC.md as it is now, beside the length recorded at approval; null when it is gone.
async function specNow($: Engine, modDir: string, approvedLength: number | null): Promise<{ text: string; now: SpecNow } | null> {
  const text = await readText($, `${modDir}/SPEC.md`)
  if (text === null) return null
  const approvedPartHash = approvedLength !== null && text.length >= approvedLength ? await sha256(text.slice(0, approvedLength)) : null
  return { text, now: { length: text.length, hash: await sha256(text), approvedPartHash } }
}

// The hash of every file under the mod's tests/, by its path from the mod's folder; null when the folder can't
// be listed. What is no file and no folder (a link) is recorded as such, so that swapping one in is a change.
async function hashTests($: Engine, modDir: string): Promise<Hashes | null> {
  return hashUnder($, modDir, 'tests')
}

// Every file of the mod, by its path from the mod's folder, without its own .git and node_modules (SPEC.md 8.3,
// the baseline): what an edit is compared with, and where its test files are found wherever they sit.
async function hashMod($: Engine, modDir: string): Promise<Hashes | null> {
  return hashUnder($, modDir, '')
}

async function hashUnder($: Engine, modDir: string, from: string): Promise<Hashes | null> {
  const hashes: Hashes = {}
  const walk = async (rel: string): Promise<boolean> => {
    let entries
    try {
      entries = await $.fs.list(rel === '' ? modDir : `${modDir}/${rel}`)
    } catch {
      return false
    }
    for (const entry of entries) {
      const path = rel === '' ? entry.name : `${rel}/${entry.name}`
      if (isKeptOut(path)) continue
      if (entry.kind === 'dir' && !entry.isLink) {
        if (!(await walk(path))) return false
      } else if (entry.kind === 'file' && !entry.isLink) {
        try {
          hashes[path] = await sha256((await $.fs.read(`${modDir}/${path}`, { as: 'bytes' })).base64)
        } catch {
          return false
        }
      } else {
        hashes[path] = NOT_A_FILE
      }
    }
    return true
  }
  return (await walk(from)) ? hashes : null
}

// ------------------------------------------------------------------------------------ Verify's typecheck

// The command that typechecks the mod (SPEC.md 7.5), or, as a text, why there is none. The types are the ones this
// build wrote when its plugin-authoring skill loaded, found here and never taken from the model; the tsconfig is
// written under the plugin's data folder, outside the mod; the compiler is the first of COMPILERS that answers.
// `types` is one file for each distinct content among the files that name themselves this build's types, in the
// order of their hashes: the typecheck runs against each (SPEC.md 7.9).
async function typecheckCommand($: Engine, modDir: string): Promise<{ argv: readonly string[]; cwd: string; config: string; types: { path: string; sha256: string }[] } | string> {
  const { version } = await $.session.version()
  const tmpDir = await $.env.get('CLAUDE_TMPDIR')
  // The user's id is asked for only when CLAUDE_TMPDIR places no folder: unset, empty, or no path from the root.
  const folder = typesFolder(tmpDir, null, version) ?? typesFolder(null, (await run($, ['id', '-u'], VALIDATE_MS)).output, version)
  let names: string[] = []
  try {
    names = folder === null ? [] : (await $.fs.list(folder)).map((entry) => entry.name).sort()
  } catch {
    names = []
  }
  // Every file that names itself this build's types is a candidate. The mod can't prove who wrote a file, and
  // genuine ones differ between sessions, so none is picked: the typecheck runs against each distinct one.
  const candidates: TypesCandidate[] = []
  for (const name of names) {
    const path = typesFileIn(folder as string, name)
    // Read once, as bytes: what is compared, what is hashed and what the first line is read from are one reading.
    let content: string
    try {
      content = (await $.fs.read(path, { as: 'bytes' })).base64
    } catch {
      continue
    }
    const bytes = Uint8Array.from(atob(content), (char) => char.charCodeAt(0))
    if (!isTypesOf(new TextDecoder().decode(bytes.slice(0, 256)), version)) continue
    // The hash is the file's own, as `sha256sum` prints it.
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    candidates.push({ path, content, sha256: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('') })
  }
  const found = typesToCheck(candidates, folder, version)
  if (!found.pass) return found.reason
  const { types } = found
  const home = await $.env.get('HOME')
  if (home === undefined) return 'HOME is not set, so the typecheck has no folder for its tsconfig.json'
  const config = `${home}/.claude/mod-builder-data/v2/typecheck/${await $.session.id()}/tsconfig.json`
  await $.fs.write(config, typecheckConfig((types[0] as { path: string }).path, modDir))
  // Asked, and later run, in the tsconfig's folder: npx looks for a compiler from the folder it runs in, and a
  // file the build put in the mod (node_modules/.bin/tsc) must not be taken for one.
  const outside = config.slice(0, config.lastIndexOf('/'))
  for (const compiler of COMPILERS) {
    if (isCompiler(await run($, [...compiler, '-v'], COMPILER_MS, outside))) return { argv: [...compiler, '--noEmit', '--pretty', 'false', '-p', config], cwd: outside, config, types }
  }
  return 'no TypeScript compiler could be run ("npx --no-install tsc" found none, and "npx -y -p typescript tsc" could not download one): install one with "npm install -g typescript", then ask again'
}

// ------------------------------------------------------------------------------- the documentation cache

// Runs the fetcher now and answers the line to show: what the script said, or why it did not run.
// How many fetches this session started are running: the pane says "refreshing" while one is.
let fetching = 0

async function refresh($: Engine): Promise<{ isDone: boolean; text: string }> {
  const home = await $.env.get('HOME')
  if (home === undefined) return { isDone: false, text: 'mod-builder: HOME is not set, so the documentation cache has no folder.' }
  let ran
  fetching += 1
  $.ui.invalidate('ui.render')
  try {
    ran = await $.process.run(['bash', `${$.plugin.root}/scripts/refresh-docs.sh`, cacheOf(home)], { timeoutMs: REFRESH_MS })
  } catch (error) {
    return { isDone: false, text: `mod-builder: the documentation fetch could not run: ${String(error)}` }
  } finally {
    fetching -= 1
    $.ui.invalidate('ui.render')
  }
  const last = (text: string) => text.trim().split('\n').pop() ?? ''
  const said = last(ran.stdout) !== '' ? last(ran.stdout) : last(ran.stderr)
  if (ran.exitCode !== 0) return { isDone: false, text: `mod-builder: the documentation fetch failed (exit ${ran.exitCode}): ${said}` }
  // A run that found another fetch holding the lock fetched nothing: the version it would record is not this one's.
  if (!said.includes('another fetch holds the lock')) await $.store.set(FETCHED_UNDER, (await $.session.version()).version)
  // A new snapshot is said in a toast, with how many pages differ from the one before (the Main frame).
  if (said.includes('new snapshot ')) {
    const latest = ((await readText($, `${cacheOf(home)}/latest`)) ?? '').trim()
    toast($, refreshedToast(latest === '' ? null : changesIn(await readText($, `${cacheOf(home)}/${latest}/_changes.md`))))
  }
  await redraw($)
  return { isDone: true, text: `mod-builder: ${said}` }
}

// At the start of an interactive session: fetches when the cache is stale (SPEC.md 3.1, "When"). Nothing waits
// for it, and a fetch that fails changes nothing: the next session tries again.
async function refreshWhenStale($: Engine, refreshDays: unknown): Promise<void> {
  try {
    const home = await $.env.get('HOME')
    if (home === undefined) return
    const fetchedUnder = await $.store.get(FETCHED_UNDER)
    const isStale = isCacheStale({
      isInteractive: true,
      refreshDays: refreshDays as number,
      checked: await readText($, `${cacheOf(home)}/checked`),
      now: await $.clock.now(),
      version: (await $.session.version()).version,
      versionAtCheck: typeof fetchedUnder === 'string' ? fetchedUnder : null,
    })
    if (!isStale) return
    const done = await refresh($)
    if (!done.isDone) $.ui.log(done.text, { to: 'debug' })
  } catch (error) {
    $.ui.log(`mod-builder: the documentation cache could not be checked: ${String(error)}`, { to: 'debug' })
  }
}

// ------------------------------------------------------------------------------------------ the pane

// What the pane's rules are given (SPEC.md 8.18): this session's entry and record, what the guard and the gate
// wrote beside the record, and what the cache holds. The pane only draws: nothing is run or fetched here.
async function paneInput($: Engine): Promise<PaneInput> {
  const sessionId = await $.session.id()
  const entry = await $.store.get(sessionKey(sessionId))
  const modDir = isSessionEntry(entry) ? entry.modDir : null
  const record = modDir === null ? undefined : await $.store.get(buildKey(modDir))
  const refusals = modDir === null ? undefined : await $.store.get(refusalsKey(modDir))
  const checks = modDir === null ? undefined : await $.store.get(checksKey(modDir))
  const home = await $.env.get('HOME')
  const word = async (name: string): Promise<string | null> => {
    const text = home === undefined ? null : await readText($, `${cacheOf(home)}/${name}`)
    return text === null || text.trim() === '' ? null : text.trim()
  }
  const latest = await word('latest')
  const inLatest = async (name: string) => (latest === null || home === undefined ? null : readText($, `${cacheOf(home)}/${latest}/${name}`))
  const spec = isBuildRecord(record) && record.phase === 'spec' ? await readText($, `${record.modDir}/SPEC.md`) : null
  // The mod's own name, as its manifest has it: the load's rows say it before the gate has run.
  let name: string | null = null
  try {
    const manifest = modDir === null ? null : await readText($, `${modDir}/.claude-plugin/plugin.json`)
    const named = manifest === null ? undefined : (JSON.parse(manifest) as { name?: unknown }).name
    name = typeof named === 'string' ? named : null
  } catch {
    name = null
  }
  // With nothing open, what this session stopped last stays in view (SPEC.md 8.18, "Stopped").
  const last = isSessionEntry(entry) ? undefined : await $.store.get(stoppedKey(sessionId))
  const stopped = typeof last === 'string' ? await $.store.get(buildKey(last)) : undefined
  return {
    sessionId, entry, record, refusals, checks, spec, name, stopped,
    knowledge: {
      latest, checked: await word('checked'), pages: pagesIn(await inLatest('manifest.tsv')), changes: changesIn(await inLatest('_changes.md')),
      isRefreshing: fetching > 0, version: (await $.session.version()).version, now: await $.clock.now(),
    },
  }
}

// After anything the pane shows has changed: the pane is drawn again, and the status line follows it. The line is
// cleared when the rules give none: at Done, when stopped, and with no open record (SPEC.md 8.18, point 4). A
// status line that can't be set stops nothing.
// Two of these can run at once (a fetch ending as a gate ends): only the one started last sets the line, so an
// older reading never lands after a newer one.
let redraws = 0

async function redraw($: Engine): Promise<void> {
  $.ui.invalidate('ui.render')
  const mine = ++redraws
  try {
    const status = paneModel(await paneInput($)).status ?? undefined
    if (mine === redraws) $.ui.status(status)
  } catch {
    // The line then stays as it was; the pane's own drawing says what it could not read.
  }
}

// A toast is never what a gate, the guard or a fetch stands on: one that can't be shown stops nothing.
function toast($: Engine, text: string): void {
  try {
    $.ui.toast(text)
  } catch {
    // Nothing else changes.
  }
}

// A tone is a meaning; the colour is the person's theme's.
const TONES: Record<Tone, { color?: 'success' | 'warning' | 'error' | 'suggestion'; dimColor?: boolean }> = {
  plain: {}, dim: { dimColor: true }, success: { color: 'success' }, warning: { color: 'warning' }, error: { color: 'error' }, current: { color: 'suggestion' },
}

// ------------------------------------------------------------------------------------------ the gate

// `detail` is what a refusal quotes beneath its reason, with its own heading: the last lines of the command that
// failed, or the line to write. `note` is what a passed gate adds to its answer.
// `tested` is the test run a refusal came from, when there was one: the pane shows which tests failed.
// `wait` is a third outcome beside a pass and a refusal (SPEC.md 9.19): the test reader is out, and the gate's
// answer is these words. It moves nothing, and is no refused gate: no attempt is kept and nothing is counted.
type Step = { verdict: Verdict; evidence?: string; change?: Partial<BuildRecord>; detail?: string; note?: string; tested?: Run; wait?: string }

// What a command said: what it printed, else what it wrote to standard error.
const said = (ran: Run & { errors: string }) => (ran.output.trim() !== '' ? ran.output : ran.errors)

// A refusal's quoted lines under their heading; nothing when there are none.
const quoting = (verdict: Verdict, lines: string, heading = 'The last lines of its output:', tested?: Run): Step => ({ verdict, ...(lines === '' ? {} : { detail: `${heading}\n${lines}` }), ...(tested === undefined ? {} : { tested }) })

const refuse = (reason: string): Step => ({ verdict: { pass: false, reason } })

// The hash checks every gate from Scaffold on makes first (SPEC.md 3.3, "Writes the hook can't see").
async function unchanged($: Engine, record: BuildRecord, withTests: boolean): Promise<Verdict> {
  const spec = await specNow($, record.modDir, record.spec === null ? null : record.spec.length)
  const kept = specKept(record.spec as NonNullable<BuildRecord['spec']>, spec === null ? null : spec.now, record.phase)
  if (!kept.pass || !withTests) return kept
  return hashGate(record.testHashes as Hashes, (await hashTests($, record.modDir)) as Hashes)
}

const validate = ($: Engine, modDir: string) => run($, ['claude', 'plugin', 'validate', '--strict', modDir], VALIDATE_MS)
const test = ($: Engine, modDir: string) => run($, ['claude', 'plugin', 'test', modDir], TEST_MS)

type Typecheck = Exclude<Awaited<ReturnType<typeof typecheckCommand>>, string>
type TypesFile = { path: string; sha256: string }

// The typecheck, once for each distinct types file, in the order of their hashes; it stops at the first that fails.
// `against` is the types file of the last run: the one a failure is named for.
// `testFiles` are the mod's test files, which the typecheck names (SPEC.md 8.14 for an edit, 9.7 for a build).
async function typecheckEach($: Engine, typecheck: Typecheck, modDir: string, testFiles: readonly string[] = []): Promise<{ ran: Run & { errors: string }; against: TypesFile }> {
  let ran: Run & { errors: string } = { exitCode: Number.NaN, output: '', errors: '' }
  let against = typecheck.types[0] as TypesFile
  for (const types of typecheck.types) {
    against = types
    await $.fs.write(typecheck.config, typecheckConfig(types.path, modDir, testFiles))
    ran = await run($, typecheck.argv, TYPECHECK_MS, typecheck.cwd)
    if (ran.exitCode !== 0) break
  }
  return { ran, against }
}

// The typecheck against every distinct types file, none left out when one fails: what the baseline and a repair's
// Red read, each run with the folder the compiler ran in (SPEC.md 8.10).
async function typecheckAll($: Engine, typecheck: Typecheck, modDir: string, testFiles: readonly string[]): Promise<{ ran: Run & { errors: string }; against: TypesFile }[]> {
  const all: { ran: Run & { errors: string }; against: TypesFile }[] = []
  for (const types of typecheck.types) {
    await $.fs.write(typecheck.config, typecheckConfig(types.path, modDir, testFiles))
    all.push({ ran: await run($, typecheck.argv, TYPECHECK_MS, typecheck.cwd), against: types })
  }
  return all
}

// Whether hooks/ and tests/ are as the scaffold laid them (SPEC.md 9.15): the scaffold script's own check, run
// here for the name in the mod's manifest. The model's word is not asked. A manifest that can't be read gives
// no name, which the script refuses.
// At Red it is asked of hooks/ alone (SPEC.md 9.17): the tests are Red's to change.
async function scaffoldKept($: Engine, modDir: string, at: 'scaffold' | 'red' = 'scaffold'): Promise<{ verdict: Verdict; said: string }> {
  let name = ''
  try {
    const found = (JSON.parse((await readText($, `${modDir}/.claude-plugin/plugin.json`)) ?? '') as { name?: unknown }).name
    if (typeof found === 'string') name = found
  } catch {
    // No name then.
  }
  const script = `${$.plugin.root}/scripts/scaffold.sh`
  const only = at === 'red' ? '-hooks' : ''
  const checked = await run($, ['bash', script, `--check${only}`, modDir, name], SCAFFOLD_MS)
  return { verdict: scaffoldKeptGate(checked, `bash "${script}" --again${only} "${modDir}" ${name}`, at), said: said(checked) }
}

// What a refused typecheck quotes: the compiler's last lines, and always the types file it failed against, though
// the compiler printed nothing.
function typecheckDetail(ran: Run & { errors: string }, against: TypesFile): string {
  const lines = lastLines(said(ran))
  const types = `the types file ${against.path} (sha256 ${against.sha256})`
  return lines === '' ? `It printed nothing. It ran against ${types}.` : `The last lines of its output, against ${types}:\n${lines}`
}

// The mod's test files as the typecheck is to name them (SPEC.md 8.14, 9.7): every file under tests/ and every
// file named as a test, wherever it sits, by its path from the mod's folder. A build names them as an edit does,
// at each of its gates that typecheck, so that no test file is frozen at Red unchecked. Answers why not, as
// text, when the mod's files can't all be read (then nothing says which test files there are, and naming none
// would pass them unchecked) or when one of them is a link or no plain file (the compiler would read through
// it, or stop on it without naming it).
async function testFilesOf($: Engine, modDir: string): Promise<string[] | string> {
  const all = await hashMod($, modDir)
  if (all === null) return 'the mod\'s files could not be read, so its test files can\'t be named to the typecheck'
  const tests = testHashesOf(all)
  const linked = Object.keys(tests).find((path) => tests[path] === NOT_A_FILE)
  if (linked !== undefined) return `${linked} is a link or no file: a test must be a file of the mod's own, so that the typecheck reads what the mod holds`
  return Object.keys(tests)
}

// The typecheck as Scaffold and Red end on it (SPEC.md 7.10): the same one Green and Verify run, here while the
// files it judges can still be changed. Answers the refusal, or the hashes of the types it passed against.
async function typecheckNow($: Engine, modDir: string, testFiles: readonly string[] = []): Promise<Step | string[]> {
  const typecheck = await typecheckCommand($, modDir)
  if (typeof typecheck === 'string') return refuse(typecheck)
  const { ran, against } = await typecheckEach($, typecheck, modDir, testFiles)
  const verdict = typecheckGate(ran)
  if (!verdict.pass) return { verdict, detail: typecheckDetail(ran, against) }
  return [...new Set(typecheck.types.map((one) => one.sha256))].sort()
}

// The four checks that end Green and end Verify, run in this order: `claude plugin validate --strict`, `claude
// plugin test`, the typecheck, and a headless load read in its debug log; the tests' and SPEC.md's hashes are
// compared before them and after. A failed typecheck or load is answered with the last lines of what it said.
async function fourChecks($: Engine, record: BuildRecord): Promise<Step> {
  const { modDir } = record
  const isEdit = recordKind(record) === 'edit'
  const kept = isEdit ? await editUnchanged($, record) : await unchanged($, record, true)
  if (!kept.pass) return { verdict: kept }
  // The test files are named to the typecheck, wherever they sit (SPEC.md 8.14; a build's too, 9.7).
  // The mod as the four checks find it: what the person is asked about later must be what was checked.
  const checked = isEdit ? await hashMod($, modDir) : null
  const named = isEdit ? Object.keys(testHashesOf(checked ?? {})) : await testFilesOf($, modDir)
  if (typeof named === 'string') return refuse(named)
  const testFiles = named
  // What the test run is held to: the count Red recorded, else (a skipped Red) the baseline's, else none.
  const testsBefore = record.testsAtRed ?? record.baseline?.tests ?? 0
  const manifest = await readText($, `${modDir}/.claude-plugin/plugin.json`)
  let name = ''
  try {
    name = String((JSON.parse(manifest ?? '') as { name?: unknown }).name ?? '')
  } catch {
    return refuse(`${modDir}/.claude-plugin/plugin.json can't be read`)
  }
  // What the typecheck needs is looked for first: without the build's types or a compiler, nothing is run.
  const typecheck = await typecheckCommand($, modDir)
  if (typeof typecheck === 'string') return refuse(typecheck)
  const hashes = [...new Set(typecheck.types.map((one) => one.sha256))].sort()
  // The "Built on" line, as the model is to copy it: the gate composes it, the model never does.
  const snapshot = (record.evidence.knowledge ?? '').startsWith('snapshot ') ? (record.evidence.knowledge as string).slice('snapshot '.length) : 'unknown'
  const line = builtOnLine((await $.session.version()).version, snapshot, hashes)
  const copy = `The "Built on" line for the "Built" block of SPEC.md, to copy exactly:\n${line}`
  // At Verify the "Built" block is written: it must hold the hash of every types file this gate checks against.
  if (record.phase === 'verify') {
    const missing = builtMisses((await readText($, `${modDir}/SPEC.md`)) ?? '', record.spec === null ? 0 : record.spec.length, hashes)
    if (missing.length > 0) {
      return { verdict: { pass: false, reason: `the "Built" block of SPEC.md does not hold the sha256 of the types this gate checks against (expected: ${missing.join(', ')})` }, detail: copy }
    }
  }
  const home = await $.env.get('HOME')
  const log = `${home ?? ''}/.claude/mod-builder-data/v2/loads/${await $.session.id()}.log`
  // `claude --debug-file` adds to a file that is there, so the log starts empty.
  await $.fs.write(log, '')
  // Each check's state is written beside the record as it moves, for the pane alone (SPEC.md 8.18): no verdict
  // reads it, and a state that can't be written stops nothing.
  let checks: Checks = newChecks(await $.session.id(), record.phase, name)
  const mark = async (check: Check, state: CheckState): Promise<void> => {
    checks = withCheck(checks, check, state)
    try {
      await $.store.set(checksKey(modDir), checks)
      await redraw($)
    } catch {
      // The pane then shows the state before this one.
    }
  }
  await mark('validate', 'running')
  const validated = await validate($, modDir)
  await mark('validate', validated.exitCode === 0 ? 'passed' : 'failed')
  await mark('test', 'running')
  const tested = await test($, modDir)
  checks = withResult(checks, 'test', testResult(tested.output))
  await mark('test', tested.exitCode === 0 ? 'passed' : 'failed')
  await mark('typecheck', 'running')
  const { ran: typechecked, against } = await typecheckEach($, typecheck, modDir, testFiles)
  checks = withResult(checks, 'typecheck', typecheckResult(typechecked))
  await mark('typecheck', typecheckGate(typechecked).pass ? 'passed' : 'failed')
  await mark('load', 'running')
  // `/cost` is answered by Claude Code itself: the session loads the mod and makes no model call.
  const loaded = await run($, ['claude', '--plugin-dir', modDir, '-p', '/cost', '--debug-file', log], LOAD_MS)
  const logged = (await readText($, log)) ?? ''
  const runs = { validate: validated, test: tested, typecheck: typechecked, load: loaded, loadShown: loadShown(logged, name) }
  await mark('load', loaded.exitCode === 0 && runs.loadShown ? 'passed' : 'failed')
  const verdict = verifyGate(runs, testsBefore)
  if (!verdict.pass) {
    // Which of the four it was is asked of the rules (refusedAt), not read from the reason's words.
    const at = refusedAt(runs, testsBefore)
    await mark(at, 'failed')
    if (at === 'validate') return quoting(verdict, validateLines(said(validated)))
    if (at === 'test') return quoting(verdict, lastLines(said(tested)), undefined, tested)
    if (at === 'typecheck') return { verdict, detail: typecheckDetail(typechecked, against) }
    // The load: the last lines of what the command said when it did not exit 0, and after them every line of its
    // log that says a hook of the mod was skipped, however many (the limit is the command's alone); with neither,
    // the last of the log's lines that name the mod.
    const skipped = hooksSkipped(logged, name)
    const own = [...(loaded.exitCode === 0 ? [] : [lastLines(said(loaded))]), ...skipped].filter((part) => part !== '')
    return quoting(verdict, own.length > 0 ? own.join('\n') : lastLines(logged.split('\n').filter((line) => name !== '' && line.includes(name)).join('\n')))
  }
  const still = isEdit ? await editUnchanged($, record) : await unchanged($, record, true)
  if (!still.pass) return { verdict: still }
  const evidence = `validate, ${verdict.tests} tests, the typecheck (types sha256 ${hashes.join(', ')}) and a headless load of ${name} all pass`
  let version: unknown
  try {
    version = (JSON.parse(manifest ?? '') as { version?: unknown }).version
  } catch {
    version = undefined
  }
  // What Done's frame shows, kept when Verify passes: for the pane alone.
  const finished: Finished = {
    version: typeof version === 'string' ? version : null, files: Object.keys((await hashMod($, modDir)) ?? {}).length, tests: verdict.tests as number,
    command: commandOf(`${validated.output}\n${validated.errors}`), builtOn: line,
  }
  const change: Partial<BuildRecord> = record.phase === 'verify' ? { finished } : {}
  if (!isEdit) return { verdict, evidence, note: copy, change }
  // An edit whose Red was skipped wrote no test: the run is held to the baseline's tests (SPEC.md 8.15).
  if (record.red === 'skipped') {
    const same = keptTestsGate(tested, record.baseline, record.skipped)
    if (!same.pass) return quoting(same, lastLines(said(tested)), undefined, tested)
  }
  // The version is greater than before the edit (SPEC.md 8.3); judged again at Verify, where plugin.json is open.
  const greater = versionGate(record.baseline?.version ?? null, version)
  if (!greater.pass) return { verdict: greater }
  const versioned = `${evidence}; version ${String(version)}${record.baseline?.version == null ? '' : `, after ${record.baseline.version}`}`
  // With Red skipped no new test covers the change: the person is asked, with the list of what changed (SPEC.md
  // 8.23), here where every file it names can still be changed.
  if (record.red !== 'skipped' || record.baseline === undefined) return { verdict, evidence: versioned, note: copy, change }
  const asked = await askOfUntested($, record, record.baseline, registersOf(said(validated)), checked)
  if ('verdict' in asked) return asked
  return { verdict, evidence: asked.evidence === '' ? versioned : `${versioned}; ${asked.evidence}`, note: copy, change: { ...change, agreed: asked.agreed, ...(asked.registers === undefined ? {} : { agreedRegisters: asked.registers }) } }
}

// The question of an edit whose Red was skipped (SPEC.md 8.23). At Green it is always asked; at Verify, only when
// a file is not as the person agreed at Green. Answers the refusal, or what the gate's evidence says of the
// answer (nothing when nothing was asked) with the hashes the answer covered.
async function askOfUntested($: Engine, record: BuildRecord, baseline: Baseline, registersNow: string[], checked: Hashes | null): Promise<Step | { evidence: string; agreed: Hashes; registers: string[] | undefined }> {
  const { modDir } = record
  const tsconfig = () => readText($, `${modDir}/tsconfig.json`)
  const now = await hashMod($, modDir)
  if (now === null) return refuse('the mod\'s files could not be read')
  const covered = agreedHashes(now, await tsconfig(), baseline.hashes)
  // A file written while the four checks ran was not checked: nobody is asked to agree to it.
  const asChecked = checked === null ? null : hashGate(agreedHashes(checked, await tsconfig(), baseline.hashes), covered)
  if (asChecked === null || !asChecked.pass) return refuse(`the mod changed while its checks ran${asChecked === null ? '' : ` (${asChecked.reason})`}: ask again`)
  const isAgain = record.phase === 'verify' && record.agreed !== undefined
  const changed = isAgain ? untestedChanges(record.agreed as Hashes, now, await tsconfig(), baseline.hashes) : untestedChanges(baseline.hashes, now, await tsconfig())
  // What was agreed at Green stands when nothing was asked: the next question compares with that, not with this.
  if (isAgain && changed.length === 0) return { evidence: '', agreed: covered, registers: record.agreedRegisters }
  const files: UntestedFile[] = []
  for (const file of changed) {
    files.push({ ...file, before: file.how === 'added' ? null : await readText($, `${baseline.restore}/${file.path}`), after: file.how === 'missing' ? null : await readText($, `${modDir}/${file.path}`) })
  }
  // Asked again, only what differs from what was agreed at Green is said: a difference already agreed to is not.
  // A record agreed before that was kept has only the baseline's to compare with.
  const isSinceGreen = isAgain && record.agreedRegisters !== undefined
  const registersBefore = isSinceGreen ? (record.agreedRegisters as string[]) : baseline.registers ?? null
  const question = untestedQuestion({ files, tests: baseline.tests, restore: baseline.restore, registersBefore, registersNow, isAgain, isSinceGreen })
  let answer: string | null = null
  try {
    answer = await $.ui.ask(question, { options: testChangeOptions(), header: 'Changes' })
  } catch {
    return refuse('the person could not be asked about the changes made with Red skipped (the question was dismissed, or nobody is at this session)')
  }
  const verdict = untestedGate(answer)
  if (!verdict.pass) return { verdict }
  // What the answer covers is what was listed: a file changed while the question was open is not agreed to.
  const after = await hashMod($, modDir)
  const same = after === null ? null : hashGate(covered, agreedHashes(after, await tsconfig(), baseline.hashes))
  if (same === null || !same.pass) return refuse(`the mod changed while the person was being asked${same === null ? '' : ` (${same.reason})`}: ask again`)
  return { evidence: untestedEvidence(changed, answer as string), agreed: covered, registers: registersNow }
}

// ------------------------------------------------------------------------------------------ an edit (SPEC.md 8)

const RESTORE_MS = 300000

// The hash checks an edit's gates make from Red on: SPEC.md as approved (or grown by the "Built" block from Verify
// on), and every test file as recorded: at Red, or at the baseline when Red was skipped.
async function editUnchanged($: Engine, record: BuildRecord): Promise<Verdict> {
  const spec = await specNow($, record.modDir, record.spec === null ? null : record.spec.length)
  const kept = specKept(record.spec as NonNullable<BuildRecord['spec']>, spec === null ? null : spec.now, record.phase)
  if (!kept.pass) return kept
  const recorded = record.testHashes ?? (record.red === 'skipped' && record.baseline !== undefined ? testHashesOf(record.baseline.hashes) : null)
  const now = await hashMod($, record.modDir)
  if (recorded === null) return { pass: false, reason: 'no hashes are recorded for the test files' }
  if (now === null) return { pass: false, reason: 'the mod\'s files could not be read' }
  return hashGate(recorded, testHashesOf(now))
}

// The mod as it stands when an edit opens (SPEC.md 8.3): its four checks run on it before anything is written,
// what they showed recorded, and the restore point made. Answers the new record with what to tell the model, or
// why no edit opens.
async function takeBaseline($: Engine, modDir: string, sessionId: string): Promise<{ record: BuildRecord; said: string } | string> {
  const hashes = await hashMod($, modDir)
  if (hashes === null) return `the files of ${modDir} could not be read`
  const manifest = await readText($, `${modDir}/.claude-plugin/plugin.json`)
  let name = ''
  let version: string | null = null
  try {
    const read = JSON.parse(manifest ?? '') as { name?: unknown; version?: unknown }
    name = String(read.name ?? '')
    version = typeof read.version === 'string' ? read.version : null
  } catch {
    return `${modDir}/.claude-plugin/plugin.json can't be read`
  }
  const typecheck = await typecheckCommand($, modDir)
  if (typeof typecheck === 'string') return typecheck
  const home = await $.env.get('HOME')
  const at = await $.clock.now()
  const restore = restoreFolder(home, sessionId, at)
  if (restore === null) return 'the restore point has no folder: HOME is not set, or this session has no plain id'
  const log = `${home ?? ''}/.claude/mod-builder-data/v2/loads/${sessionId}.log`
  try {
    await $.fs.write(log, '')
  } catch (error) {
    return `the log of the baseline's load could not be written (${String(error)})`
  }
  const testFiles = Object.keys(testHashesOf(hashes))
  const validated = await validate($, modDir)
  const tested = await test($, modDir)
  const typechecked = await typecheckAll($, typecheck, modDir, testFiles)
  const loaded = await run($, ['claude', '--plugin-dir', modDir, '-p', '/cost', '--debug-file', log], LOAD_MS)
  const logged = (await readText($, log)) ?? ''
  const typechecks: TypecheckRun[] = typechecked.map((one) => ({ run: one.ran, cwd: typecheck.cwd }))
  const verdict = baselineVerdict({ validate: validated, test: tested, typechecks, load: loaded, loadShown: loadShown(logged, name) }, modDir, Object.keys(hashes))
  if (!verdict.taken) return verdict.reason
  // Nothing was written to the mod by these checks: it is hashed again, and must be as it was.
  const after = await hashMod($, modDir)
  const same = after === null ? null : hashGate(hashes, after)
  if (same === null || !same.pass) return `${modDir} changed while its baseline was being taken${same === null ? '' : ` (${same.reason})`}: ask again`
  const made = await run($, ['bash', `${$.plugin.root}/scripts/restore-point.sh`, modDir, restore], RESTORE_MS)
  if (made.exitCode !== 0) return `the restore point could not be made (${lastLines(said(made), 3).replace(/\n/g, ' ') || 'restore-point.sh ended with no exit code'})`
  const spec = await specNow($, modDir, null)
  const baseline: Baseline = {
    version, tests: verdict.tests, names: testNames(tested.output) ?? [], hashes,
    spec: spec === null ? null : { length: spec.now.length, hash: spec.now.hash }, failed: verdict.failed, restore, at,
    registers: registersOf(said(validated)),
  }
  const failing = typechecked.find((one) => one.ran.exitCode !== 0)
  const quoted: Record<Check, string> = {
    validate: validateLines(said(validated)), test: lastLines(said(tested)),
    typecheck: failing === undefined ? '' : typecheckDetail(failing.ran, failing.against), load: lastLines(said(loaded)),
  }
  const passes = verdict.failed.length === 0
  const how = passes
    ? `It passes its four checks as it stands (${verdict.tests} tests).`
    : `As it stands it does not pass: ${verdict.failed.join(', ')}.${verdict.red === 'edit' ? ' It has no test file, and nothing else fails: Red is entered, and ends as in any edit.' : ' This edit is a repair.'}`
  const red = verdict.red === 'skipped' ? ' Its test files fit this build, so Red is skipped: Spec is followed by Green.' : verdict.red === 'repair' ? ' Red is entered, tests only: it ends when a test file exists and the test files typecheck.' : ''
  const lines = verdict.failed.map((check) => (quoted[check] === '' ? '' : `\n${check}:\n${check === 'typecheck' ? quoted[check] : `The last lines of its output:\n${quoted[check]}`}`)).join('')
  const record = newEditRecord(modDir, sessionId, baseline, verdict.red)
  const summary = passes ? `passes its four checks (${verdict.tests} tests)` : `fails ${verdict.failed.join(', ')}`
  return {
    record: { ...record, evidence: { baseline: `${summary}; version ${version ?? 'none'}; restore point ${restore}` } },
    said: `${how}${passes ? '' : red} Its restore point is ${restore}.${lines}`,
  }
}

// 8.4's question at an edit's or a repair's Red: asked when a test file the baseline had has changed or is gone.
// Answers the refusal, or what the evidence says of it ('' when there was nothing to ask).
async function askOfTests($: Engine, record: BuildRecord, now: Hashes, tested: Run | null): Promise<Step | { said: string; agreed: Hashes }> {
  const baseline = record.baseline as Baseline
  const asked = testFilesToAsk(baseline.hashes, now)
  if (asked.length === 0) return { said: '', agreed: {} }
  // What an answer covers: each asked file as it is now, or that it is gone. The gate is called again while the
  // test reader is out (SPEC.md 9.19), and the same changes are not asked about twice.
  const agreed: Hashes = {}
  for (const file of asked) agreed[file.path] = file.how === 'missing' ? 'missing' : (now[file.path] as string)
  if (record.testsAgreed !== undefined && hashGate(record.testsAgreed, agreed).pass && hashGate(agreed, record.testsAgreed).pass) return { said: testChangeEvidence(asked, GO_ON), agreed }
  const files: AskedFile[] = []
  for (const file of asked) {
    const before = await readText($, `${baseline.restore}/${file.path}`)
    if (before === null) return refuse(`${file.path} can't be read in the restore point (${baseline.restore}), so the person can't be shown what changed`)
    files.push({ path: file.path, before, after: file.how === 'missing' ? null : await readText($, `${record.modDir}/${file.path}`) })
  }
  const names = tested === null ? null : testNames(tested.output)
  const question = testChangeQuestion(files, names === null ? [] : namesGone(baseline.names, names)) as string
  let answer: string | null = null
  try {
    answer = await $.ui.ask(question, { options: testChangeOptions(), header: 'Tests' })
  } catch {
    return refuse('the person could not be asked about the changed test files (the question was dismissed, or nobody is at this session)')
  }
  const verdict = testChangeGate(answer)
  if (!verdict.pass) return { verdict }
  return { said: testChangeEvidence(asked, answer as string), agreed }
}

// The mod's test files as they hash now, by their paths from its folder; null when its files can't all be read.
async function testHashesNow($: Engine, modDir: string): Promise<Hashes | null> {
  const all = await hashMod($, modDir)
  return all === null ? null : testHashesOf(all)
}

// What Red's gate does about a test reader that is out, before it runs anything (SPEC.md 9.19), for the test
// files as they are now. While it has not answered and its time is not up, the answer is "still reading": no
// test and no compiler is run. When its answer is stored, Red's other checks are not run again for the same test
// files: the reader's verdict is read, and a pass is answered with what those checks saw when it was started.
// Null in every other case: Red runs all its checks.
async function readerOut($: Engine, record: BuildRecord): Promise<Step | null> {
  const out = record.reader
  if (out === undefined || out === null) return null
  const hashes = await testHashesNow($, record.modDir)
  if (hashes === null) return null
  const stored = readReaderAnswer(await $.store.get(readerKey(out.agentId)))
  const seconds = readerWaits(out, hashes, await $.clock.now(), stored?.answer)
  if (seconds !== null) return { verdict: { pass: false, reason: readerReading(seconds) }, wait: readerReading(seconds) }
  if (stored === null || !hashGate(out.hashes, hashes).pass || !hashGate(hashes, out.hashes).pass || out.evidence === undefined) return null
  return readTests($, record, hashes, [], null, { verdict: { pass: true }, evidence: out.evidence, change: (out.change ?? {}) as Partial<BuildRecord> })
}

// The test reader, when every other check of Red has passed (SPEC.md 9.3, 9.19). `hashes` are the test files as
// they hash now, `files` those the reader is to read, `fromLine` where an edit's section starts, and `passing`
// the step Red would have answered: it is answered, with the reader's evidence added, only on the reader's
// "VERDICT: PASS" for these hashes or on the person's own answer. The verdict is read from what this mod stored
// under the id its own spawn returned, never from anything the model passes.
async function readTests($: Engine, record: BuildRecord, hashes: Hashes, files: readonly string[], fromLine: number | null, passing: Step): Promise<Step> {
  const sessionId = await $.session.id()
  const out = record.reader ?? null
  const stored = out === null ? null : readReaderAnswer(await $.store.get(readerKey(out.agentId)))
  const now = await $.clock.now()
  let rounds = Number.isInteger(record.readerRounds) ? (record.readerRounds as number) : 0
  let last = record.readerLast ?? null
  // Every reader this Red started, those left behind by changed tests included (SPEC.md 9.24).
  const starts = Number.isInteger(record.readerStarts) && (record.readerStarts as number) >= 0 ? (record.readerStarts as number) : 0
  const step = readerStep(out, last, rounds, hashes, now, stored?.answer)
  // What a call that does not pass still keeps of Red's other checks: the person's agreement to changed test
  // files alone. What they counted and hashed is written when Red passes, and not before.
  const keeps: Partial<BuildRecord> = passing.change?.testsAgreed === undefined ? {} : { testsAgreed: passing.change.testsAgreed }
  const passed = (evidence: string): Step => ({
    ...passing, evidence: `${passing.evidence ?? ''}; ${evidence}`, change: { ...passing.change, reader: null, readerRounds: rounds, readerLast: last, readerStarts: 0 },
  })
  const held = (findings: string[] | null, more = ''): Step => ({
    verdict: { pass: false, reason: `${readerRefusal(findings, rounds)}${more}` },
    ...(findings === null || findings.length === 0 ? {} : { detail: findingLines(findings).join('\n') }),
    change: { ...keeps, reader: null, readerRounds: rounds, readerLast: last },
  })
  // `question` and `evidence` are the rounds' own unless the question is asked in place of one reader too many.
  const ask = async (findings: string[] | null, question = readerQuestion(findings, rounds), evidence = readerEvidence({ by: 'person', rounds, findings })): Promise<Step> => {
    const change = { ...keeps, reader: null, readerRounds: rounds, readerLast: last }
    let answer: string | null = null
    try {
      answer = await $.ui.ask(question, { options: readerOptions(), header: 'Tests' })
    } catch {
      return { verdict: { pass: false, reason: 'the person could not be asked whether to go on with these tests (the question was dismissed, or nobody is at this session)' }, change }
    }
    const verdict = readerGate(answer)
    if (!verdict.pass) return { verdict, change }
    // What the person agreed to is the tests as they were when the question was asked.
    const after = await testHashesNow($, record.modDir)
    if (after === null || !hashGate(hashes, after).pass) return { verdict: { pass: false, reason: 'the test files changed while the person was being asked: ask again' }, change }
    return passed(evidence)
  }
  // A round that has just ended without a pass: its findings hold Red, or, from the second on, the person is asked.
  const ended = (findings: string[] | null, more = ''): Promise<Step> | Step => {
    rounds += 1
    last = { hashes, findings }
    return roundEnds(rounds) === 'ask' ? ask(findings) : held(findings, more)
  }
  // A reader left behind by changed tests is no round: it ended nothing, and its answer is never read. So one
  // call of the gate adds one round at most.
  switch (step.do) {
    case 'wait':
      return { verdict: { pass: false, reason: readerReading(step.seconds) }, wait: readerReading(step.seconds), change: keeps }
    case 'read': {
      const read = readVerdict(step.answer)
      if (read.verdict === 'pass') {
        last = null
        return passed(readerEvidence({ by: 'reader', round: rounds + 1 }))
      }
      return ended(read.verdict === 'findings' ? read.findings : null)
    }
    case 'timeout':
      return ended(null)
    case 'again':
      return held(step.findings)
    case 'ask':
      return ask(step.findings)
    case 'start': {
      // One reader too many for this Red: the person is asked instead, and nothing is started (SPEC.md 9.24).
      if (startsEnd(starts) === 'ask') return ask(last === null ? null : last.findings, readerStartsQuestion(starts, last === null ? null : last.findings), readerStartsEvidence(starts))
      const odd = unnameable(record.modDir, files)
      const message = readerMessage(record.modDir, fromLine, files)
      if (odd.length > 0 || message === null) {
        return { verdict: { pass: false, reason: `the test reader can't be given a path that holds a line break or another control character (${odd.join(', ')}): rename it` }, change: { ...keeps, reader: null, readerRounds: rounds, readerLast: last } }
      }
      let agentId: string | null = null
      let why = 'it could not be started'
      try {
        const started = (await $.agent.spawn({ subagentType: READER, prompt: message, description: 'Read the tests against the spec' })) as { agentId?: unknown; deny?: unknown }
        if (typeof started.agentId === 'string' && started.agentId !== '') agentId = started.agentId
        else if (typeof started.deny === 'string') why = `its start was refused (${started.deny})`
      } catch (error) {
        why = `it could not be started (${String(error)})`
      }
      // A reader that did not start is a round with no verdict (SPEC.md 9.3).
      if (agentId === null) return ended(null, `. The reader was not started: ${why}`)
      const known = await $.store.get(readersKey(sessionId))
      await $.store.set(readersKey(sessionId), [...(Array.isArray(known) ? known.filter((one) => typeof one === 'string') : []), agentId])
      return {
        verdict: { pass: false, reason: READER_STARTED }, wait: READER_STARTED,
        change: { ...keeps, reader: { agentId, startedAt: now, hashes, evidence: passing.evidence ?? '', change: { ...passing.change } }, readerRounds: rounds, readerLast: last, readerStarts: starts + 1 },
      }
    }
  }
}

// A turn has ended (SPEC.md 9.12, 9.19). When it is a test reader's of this session, and the session's open
// record names that reader, its answer is stored under the reader's own key, the pane is redrawn, and the main
// model is nudged to call the gate; the nudge is not waited for, since it resolves only when the main turn has
// ended. When it is the main session's own turn and the nudge for an unread answer could not be sent, it is sent
// once more.
// The verdict is never read here, and nothing the reader wrote is in the nudge.
async function turnEnded($: Engine, e: { agentId?: unknown; answer?: unknown; reason?: unknown }): Promise<void> {
  const sessionId = await $.session.id()
  const entry = await $.store.get(sessionKey(sessionId))
  if (!isSessionEntry(entry) || entry.modDir === null) return
  const record = await $.store.get(buildKey(entry.modDir))
  if (!isOpenRecord(record) || (record as BuildRecord).sessionId !== sessionId) return
  const out = (record as BuildRecord).reader
  if (out === undefined || out === null) return
  // The nudge is not waited for. One that did not enter is marked on the stored answer, which stays for the next
  // call of the gate to find: the main session's own next turn end then tries once more (SPEC.md 9.12, point 5).
  // A prompt another plugin's hook or the engine refuses does not reject: it resolves with `drop` (9.24, as run);
  // with no session bound it rejects. Both are marked.
  const mark = async () => {
    try {
      const stored = readReaderAnswer(await $.store.get(readerKey(out.agentId)))
      if (stored !== null) await $.store.set(readerKey(out.agentId), { answer: stored.answer, nudges: stored.nudges, failed: true })
    } catch {
      // Nothing more to do: the answer itself is stored.
    }
  }
  const nudge = () => {
    void $.prompt.submit({ text: READER_NUDGE }).then((sent) => (typeof (sent as { drop?: unknown } | undefined)?.drop === 'string' ? mark() : undefined), mark)
  }
  if (e.agentId === undefined) {
    // A nudge that was sent is queued until this turn ends (9.13): only one that failed is sent again.
    const stored = readReaderAnswer(await $.store.get(readerKey(out.agentId)))
    if (stored === null || !stored.failed || stored.nudges >= READER_NUDGES) return
    await $.store.set(readerKey(out.agentId), { answer: stored.answer, nudges: stored.nudges + 1 })
    nudge()
    return
  }
  if (e.agentId !== out.agentId) return
  const known = await $.store.get(readersKey(sessionId))
  if (!Array.isArray(known) || !known.includes(out.agentId)) return
  // The first answer under an id stands.
  if (readReaderAnswer(await $.store.get(readerKey(out.agentId))) !== null) return
  await $.store.set(readerKey(out.agentId), { answer: e.reason === 'answer' && typeof e.answer === 'string' ? e.answer : '', nudges: 1 })
  await redraw($)
  nudge()
}

// Whether a tool call is one a test reader of this session may not make (SPEC.md 9.12, 9.14): its loop reaches
// this hook with its id, and it may call Read, Grep, Glob and the hand-back tool only. Answers the refusal, or
// null. A tool the API runs itself never reaches a hook, and is not judged here (9.14).
async function readerRefused($: Engine, e: { agentId?: unknown; tool?: unknown }): Promise<string | null> {
  if (typeof e.agentId !== 'string' || readerMayCall(e.tool)) return null
  const known = await $.store.get(readersKey(await $.session.id()))
  if (!Array.isArray(known) || !known.includes(e.agentId)) return null
  $.ui.log(`mod-builder: refused the test reader's call to ${String(e.tool)}: it may call Read, Grep and Glob only`, { to: 'debug' })
  return `mod-builder: the test reader may call Read, Grep and Glob only, not ${String(e.tool)}`
}

// The check that ends an edit's phase, run now. `claims` is whether the gate's call put the change forward as one
// with no behaviour change (SPEC.md 8.15).
async function checkEdit($: Engine, record: BuildRecord, claims: boolean): Promise<Step> {
  const { modDir } = record
  const baseline = record.baseline
  if (baseline === undefined) return refuse(`the edit's record holds no baseline. Start the edit again with ${EDIT_START}`)
  switch (record.phase) {
    case 'knowledge':
    case 'describe':
      return check($, record)
    case 'done':
      return refuse('the edit is done: nothing follows phase 7')
    case 'spec': {
      const before = await specNow($, modDir, baseline.spec === null ? null : baseline.spec.length)
      const kept = editSpecKept(baseline.spec, before === null ? null : before.now, before === null ? '' : before.text, claims)
      if (!kept.pass) return { verdict: kept }
      const isOffered = mayRefactor(baseline, record.red)
      if (claims && !isOffered) {
        return refuse('this edit can\'t be approved as one with no behaviour change: that route is for a mod that passed its baseline and has tests with a count. Call the gate without no_behaviour_change')
      }
      const options = editApprovalOptions(claims, isOffered)
      let answer: string | null = null
      try {
        answer = await $.ui.ask(editApprovalQuestion(modDir, options), { options, header: 'Spec' })
      } catch {
        return refuse('the person could not be asked (the question was dismissed, or nobody is at this session)')
      }
      const verdict = editSpecGate(answer, options)
      if (!verdict.pass) return { verdict }
      const after = await specNow($, modDir, null)
      if (before === null || after === null || after.now.hash !== before.now.hash) return refuse('SPEC.md changed while the person was being asked: ask again')
      const approved = { specApprovedAt: await $.clock.now(), spec: { length: before.now.length, hash: before.now.hash } }
      const routed = verdict.route === 'refactor' ? refactorRecord({ ...record, ...approved }) : null
      return {
        verdict: { pass: true },
        evidence: `the person answered "${answer}"${routed === null ? '' : `: Red is skipped, every test is kept as it is`}`,
        change: routed === null ? approved : { ...approved, red: routed.red, skipped: routed.skipped },
      }
    }
    case 'red': {
      const kept = await specUnchanged($, record)
      if (!kept.pass) return { verdict: kept }
      // A test reader that is out for these tests is waited for, or its answer read; the checks that passed when
      // it was started are not run again (SPEC.md 9.19).
      const reading = await readerOut($, record)
      if (reading !== null) return reading
      const before = await hashMod($, modDir)
      if (before === null) return refuse('the mod\'s files could not be read')
      const tests = testHashesOf(before)
      const linked = Object.keys(tests).find((path) => tests[path] === NOT_A_FILE)
      if (linked !== undefined) return refuse(`${linked} is a link or no file: a test must be a file of the mod's own, so that what it holds can be recorded`)
      const testFiles = Object.keys(tests)
      let tested: (Run & { errors: string }) | null = null
      let ended: string
      let count = 0
      if (record.red === 'repair') {
        const typecheck = await typecheckCommand($, modDir)
        if (typeof typecheck === 'string') return refuse(typecheck)
        const all = await typecheckAll($, typecheck, modDir, testFiles)
        const verdict = repairRedGate(all.map((one) => ({ run: one.ran, cwd: typecheck.cwd })), modDir, Object.keys(before))
        if (!verdict.pass) {
          const failing = all.find((one) => one.ran.exitCode !== 0)
          return failing === undefined ? { verdict } : { verdict, detail: typecheckDetail(failing.ran, failing.against) }
        }
        ended = `the test files typecheck (types sha256 ${[...new Set(typecheck.types.map((one) => one.sha256))].sort().join(', ')})`
      } else {
        tested = await test($, modDir)
        const verdict = editRedGate(tested, baseline.names, testFilesChanged(baseline.hashes, before))
        if (!verdict.pass) return quoting(verdict, lastLines(said(tested)), undefined, tested)
        count = verdict.tests as number
        const types = await typecheckNow($, modDir, testFiles)
        if (!Array.isArray(types)) return types
        ended = `${count} tests ran, a new or changed one failing by assertion; the typecheck passes (types sha256 ${types.join(', ')})`
      }
      const answered = await askOfTests($, record, before, tested)
      if ('verdict' in answered) return answered
      const asked = answered.said
      const after = await hashMod($, modDir)
      if (after === null) return refuse('the mod\'s files could not be read')
      const same = hashGate(tests, testHashesOf(after))
      if (!same.pass) return refuse(`the test files changed while Red's checks ran (${same.reason}): ask again`)
      const still = await specUnchanged($, record)
      if (!still.pass) return { verdict: still }
      const changed = testFilesChanged(baseline.hashes, before)
      // Then the test reader (SPEC.md 9.3): it reads the test files that are new or changed in this edit, against
      // the change's section of SPEC.md.
      const spec = (await readText($, `${modDir}/SPEC.md`)) ?? ''
      // With no test file new or changed (a repair that mends what lies outside them), it reads them all: a
      // reader given no file would pass tests it never saw.
      return readTests($, record, tests, changed.length > 0 ? changed : testFiles, sectionLine(spec, baseline.spec === null ? 0 : baseline.spec.length), {
        verdict: { pass: true },
        evidence: `${ended}; ${testFiles.length} test files hashed${changed.length === 0 ? '' : `, not as at the baseline: ${changed.join(', ')}`}${asked === '' ? '' : `; ${asked}`}`,
        change: { testsAtRed: count, testHashes: tests, testsAgreed: answered.agreed },
      })
    }
    case 'green': {
      const step = await fourChecks($, record)
      if (!step.verdict.pass || step.evidence === undefined) return step
      return { ...step, evidence: `${step.evidence}; the test files and SPEC.md are as recorded` }
    }
    case 'verify':
      return fourChecks($, record)
    case 'scaffold':
      return refuse('an edit has no Scaffold: its record is damaged')
  }
}

// SPEC.md alone, as approved: what Red's gate of an edit checks before its test files are recorded.
async function specUnchanged($: Engine, record: BuildRecord): Promise<Verdict> {
  const spec = await specNow($, record.modDir, record.spec === null ? null : record.spec.length)
  return specKept(record.spec as NonNullable<BuildRecord['spec']>, spec === null ? null : spec.now, record.phase)
}

// `/mod-builder stop` (SPEC.md 8.5): ends this session's open build or edit at any phase. The record is marked
// stopped and the session is no longer bound to the folder. An edit then asks whether the mod stays as it is or
// is put back as it was; putting it back deletes nothing (scripts/put-back.sh).
async function stop($: Engine): Promise<string> {
  const sessionId = await $.session.id()
  const key = sessionKey(sessionId)
  const entry = await $.store.get(key)
  if (!isSessionEntry(entry)) return 'mod-builder: no build or edit is open in this session, so there is nothing to stop.'
  const record = entry.modDir === null ? undefined : await $.store.get(buildKey(entry.modDir))
  if (entry.modDir === null) {
    await $.store.set(key, null)
    await redraw($)
    return `mod-builder: stopped. This session's ${entryKind(entry)} had named no folder yet, and nothing was changed.`
  }
  // A record that is missing, or another session's, is not this session's to stop: only the session is unbound.
  if (!isBuildRecord(record) || record.sessionId !== sessionId) {
    await $.store.set(key, null)
    await redraw($)
    return `mod-builder: stopped. The record for ${entry.modDir} is missing or is not this session's, so it was left as it is; this session is no longer bound to the folder.`
  }
  if (!isOpenRecord(record)) {
    await $.store.set(key, null)
    await redraw($)
    return `mod-builder: the ${recordKind(record) === 'edit' ? 'edit' : 'build'} of ${record.modDir} was already ${record.stopped === true ? 'stopped' : 'done'}; this session is no longer bound to it, and nothing else was changed.`
  }
  const kind = recordKind(record) as Kind
  // The record first, then the session: a record marked stopped holds nothing even if the second write fails.
  await $.store.set(buildKey(record.modDir), stoppedRecord(record))
  await $.store.set(key, null)
  // What was stopped stays in the pane until this session opens another build or edit; it binds nothing.
  await $.store.set(stoppedKey(sessionId), record.modDir)
  await redraw($)
  const stopped = `mod-builder: the ${kind} of ${record.modDir} is stopped at ${phaseLabelOf(kind, record.phase)}. Other plugins' folders can be written again.`
  if (kind !== 'edit' || record.baseline === undefined) return `${stopped} The folder is left as it is.`
  // The person's answer and the folder kept beside the mod, for the pane alone.
  // Written into the record as it is now, and only while that is still the one this stop stopped: the question
  // can stay open for minutes, and a record another session has made in the folder since is not written over.
  const keep = async (stop: Stop): Promise<void> => {
    try {
      const now = await $.store.get(buildKey(record.modDir))
      if (isBuildRecord(now) && now.stopped === true && now.sessionId === sessionId) await $.store.set(buildKey(record.modDir), { ...now, stop })
      await redraw($)
    } catch {
      // The pane then shows the stopped record without them.
    }
  }
  let answer: string | null = null
  try {
    answer = await $.ui.ask(`The edit of ${record.modDir} is stopped. What becomes of the mod?`, { options: stopOptions(), header: 'Stop' })
  } catch {
    answer = null
  }
  if (!putsBack(answer)) {
    await keep({ answer, beside: null })
    return `${stopped} The mod is kept as it is now. Its restore point stays at ${record.baseline.restore}.`
  }
  const beside = stoppedFolder(record.modDir, await $.clock.now())
  await keep({ answer, beside: null })
  if (beside === null) return `${stopped} It could not be put back: no name could be made for the stopped folder. The mod is as it is now, and its restore point is ${record.baseline.restore}.`
  const put = await run($, ['bash', `${$.plugin.root}/scripts/put-back.sh`, record.modDir, record.baseline.restore, beside], RESTORE_MS)
  if (put.exitCode !== 0) return `${stopped} It could not be put back: ${lastLines(said(put), 3).replace(/\n/g, ' ') || 'put-back.sh ended with no exit code'}`
  await keep({ answer, beside })
  const moved = put.output.split('\n').find((line) => line.startsWith('moved: ')) ?? 'moved: nothing'
  // With the mod's .git moved back, its history is the one it had when stopped (SPEC.md 8.17).
  const history = moved.slice('moved: '.length).split(', ').includes('.git') ? " The mod's git history is as it is now, commits made during the edit included: git shows the restored files as changes against them." : ''
  return `${stopped} The mod is put back as it was before this edit, in ${record.modDir}; the folder as it was when stopped is kept beside it as ${beside}. ${moved === 'moved: nothing' ? 'Nothing was moved between them.' : `Moved into the restored mod: ${moved.slice('moved: '.length)}.`} Nothing was deleted.${history}`
}

// The check that ends the record's phase, run now.
async function check($: Engine, record: BuildRecord): Promise<Step> {
  const { modDir } = record
  switch (record.phase) {
    case 'knowledge': {
      const home = await $.env.get('HOME')
      const latest = home === undefined ? null : await readText($, `${home}/.claude/mod-builder-data/v2/docs/latest`)
      if (latest === null || latest.trim() === '') return refuse('no snapshot of the mod documentation exists yet: run /mod-builder refresh')
      return { verdict: { pass: true }, evidence: `snapshot ${latest.trim()}` }
    }
    case 'describe':
      return { verdict: { pass: true }, evidence: 'no gate' }
    case 'spec': {
      const before = await specNow($, modDir, null)
      if (before === null) return refuse(`${modDir}/SPEC.md does not exist yet`)
      const commands = await $.command.list()
      const hasDesign = commands.some((command) => command.name === 'design' || command.name.endsWith(':design'))
      let answer: string | null = null
      try {
        answer = await $.ui.ask(`Approve the spec of this mod? (${modDir}/SPEC.md) ${approvalHint('build')}`, { options: approvalOptions(hasDesign), header: 'Spec' })
      } catch {
        return refuse('the person could not be asked (the question was dismissed, or nobody is at this session)')
      }
      const verdict = specGate(answer)
      if (!verdict.pass) return { verdict }
      const after = await specNow($, modDir, null)
      if (after === null || after.now.hash !== before.now.hash) return refuse('SPEC.md changed while the person was being asked: ask again')
      return {
        verdict,
        evidence: `the person answered "${APPROVE}"`,
        change: { specApprovedAt: await $.clock.now(), spec: { length: before.now.length, hash: before.now.hash } },
      }
    }
    case 'scaffold': {
      const kept = await unchanged($, record, false)
      if (!kept.pass) return { verdict: kept }
      // hooks/ and tests/ hold the template and nothing else (SPEC.md 9.4, 9.15). Asked first, so that a build
      // that wrote ahead is told so before a failing test tells it something else.
      const laid = await scaffoldKept($, modDir)
      if (!laid.verdict.pass) return quoting(laid.verdict, lastLines(laid.said))
      const validated = await validate($, modDir)
      const tests = await test($, modDir)
      const verdict = scaffoldGate(validated, tests)
      // A refused validate or test run is quoted as a refused typecheck is (SPEC.md 7.9): validate's own findings,
      // which stand before its plugin-directory section, or the last lines of the test run.
      if (!verdict.pass) return validated.exitCode !== 0 ? quoting(verdict, validateLines(said(validated))) : quoting(verdict, lastLines(said(tests)), undefined, tests)
      // The typecheck too (SPEC.md 7.10): hooks/ and types/ close when Scaffold passes, and Red ends on a typecheck.
      const named = await testFilesOf($, modDir)
      if (typeof named === 'string') return refuse(named)
      const types = await typecheckNow($, modDir, named)
      if (!Array.isArray(types)) return types
      // And once more, after the checks: what they judged is what closes when Scaffold passes.
      const still = await scaffoldKept($, modDir)
      if (!still.verdict.pass) return quoting(still.verdict, lastLines(still.said))
      return {
        verdict,
        evidence: `hooks/ and tests/ are as the scaffold laid them; claude plugin validate --strict exited 0; ${verdict.tests} tests ran; the typecheck passes (types sha256 ${types.join(', ')})`,
        change: { testsAtScaffold: verdict.tests as number, namesAtScaffold: testNames(tests.output) },
      }
    }
    case 'red': {
      const kept = await unchanged($, record, false)
      if (!kept.pass) return { verdict: kept }
      // hooks/ is still the template (SPEC.md 9.17): asked before the tests are run against it, and before a
      // test reader's verdict is read.
      const laid = await scaffoldKept($, modDir, 'red')
      if (!laid.verdict.pass) return quoting(laid.verdict, lastLines(laid.said))
      // A test reader that is out for these tests is waited for, or its answer read; the checks that passed when
      // it was started are not run again (SPEC.md 9.19).
      const reading = await readerOut($, record)
      if (reading !== null) return reading
      // The tests are hashed before the run and after it: what is recorded must be what ran.
      const before = await hashTests($, modDir)
      const linked = before === null ? undefined : Object.keys(before).find((path) => before[path] === NOT_A_FILE)
      if (linked !== undefined) return refuse(`${linked} is a link or no file: a test must be a file of the mod's own, so that what it holds can be recorded`)
      const tested = await test($, modDir)
      const verdict = redGate(tested, record.testsAtScaffold as number, record.namesAtScaffold as string[])
      if (!verdict.pass) return quoting(verdict, lastLines(said(tested)), undefined, tested)
      // The typecheck, after the test run's verdict (SPEC.md 7.10): tests/ closes when Red passes, so a test that
      // does not typecheck is refused here, while it can still be changed. It runs before the tests are hashed
      // again, so what is recorded is what was typechecked.
      const named = await testFilesOf($, modDir)
      if (typeof named === 'string') return refuse(named)
      const types = await typecheckNow($, modDir, named)
      if (!Array.isArray(types)) return types
      const testHashes = await hashTests($, modDir)
      if (before === null || testHashes === null) return refuse('the files under tests/ could not be read')
      const same = hashGate(before, testHashes)
      if (!same.pass) return refuse(`tests/ changed while the tests ran (${same.reason}): ask again`)
      const still = await unchanged($, record, false)
      if (!still.pass) return { verdict: still }
      // And once more: the tests failed against the template, not against code written while they ran.
      const stillLaid = await scaffoldKept($, modDir, 'red')
      if (!stillLaid.verdict.pass) return quoting(stillLaid.verdict, lastLines(stillLaid.said))
      // Then the test reader (SPEC.md 9.3): it reads every test file of the build against SPEC.md.
      const read = await testHashesNow($, modDir)
      if (read === null) return refuse('the mod\'s files could not be read')
      return readTests($, record, read, Object.keys(read), null, {
        verdict,
        evidence: `hooks/ is as the scaffold laid it; ${verdict.tests} tests ran, the new ones failing by assertion; the typecheck passes (types sha256 ${types.join(', ')}); ${Object.keys(testHashes).length} files under tests/ hashed`,
        change: { testsAtRed: verdict.tests as number, testHashes },
      })
    }
    // Green and Verify end on the same four checks (SPEC.md 7.7, decision 1): what Verify would refuse for the code
    // is refused at Green, while the code can still be changed.
    case 'green': {
      const step = await fourChecks($, record)
      if (!step.verdict.pass || step.evidence === undefined) return step
      return { ...step, evidence: `${step.evidence}; tests/ and SPEC.md are as recorded` }
    }
    case 'verify':
      return fourChecks($, record)
    case 'done':
      return refuse('the build is done: nothing follows phase 8')
  }
}

// The guard's counting of refused writes, in the order they were refused.
let counting: Promise<void> = Promise.resolve()

// A record that opens starts with no refusals and no check states: what an earlier build or edit of the folder
// left under those keys is emptied (SPEC.md 8.18). Nothing is written where nothing is kept.
async function emptyBeside($: Engine, modDir: string, keys: readonly string[] = [refusalsKey(modDir), checksKey(modDir)]): Promise<void> {
  for (const key of keys) {
    const kept = await $.store.get(key)
    if (kept !== undefined && kept !== null) await $.store.set(key, null)
  }
}

// What a refused gate leaves for the pane (SPEC.md 8.18): its reason, and from its test run the tests that failed
// and how many passed. It is written into the record as it is now, and only while that is still this session's
// open record at the same phase: a record stopped or moved while the gate ran is left alone. No verdict reads it.
// What a gate that did not pass still changes in the record (SPEC.md 9.19): which test reader is out, the rounds
// that ended, what the person agreed to. Written into the record as it is now, and only while it is still the
// one this gate read, open and at the same phase.
async function keepChange($: Engine, record: BuildRecord, step: Step): Promise<void> {
  if (step.change === undefined) return
  const now = await $.store.get(buildKey(record.modDir))
  if (isOpenRecord(now) && (now as BuildRecord).sessionId === record.sessionId && (now as BuildRecord).phase === record.phase) {
    await $.store.set(buildKey(record.modDir), { ...(now as BuildRecord), ...step.change })
  }
}

async function keepAttempt($: Engine, record: BuildRecord, step: Step): Promise<void> {
  try {
    const run = step.tested === undefined ? null : parseTestRun(step.tested.output)
    const attempt: Attempt = {
      phase: record.phase, reason: step.verdict.pass ? '' : step.verdict.reason,
      failing: run === null ? [] : run.failures.map((failure) => failure.name),
      passed: run === null ? null : run.tests - run.failures.length, tests: run === null ? null : run.tests,
    }
    const now = await $.store.get(buildKey(record.modDir))
    if (isOpenRecord(now) && (now as BuildRecord).sessionId === record.sessionId && (now as BuildRecord).phase === record.phase) {
      await $.store.set(buildKey(record.modDir), { ...(now as BuildRecord), attempt })
    }
  } catch {
    // The pane then shows no reason; the gate's answer holds it.
  }
}

// When a gate has ended, however it ended: no check is left "running" (SPEC.md 8.18), and the pane and the status
// line follow.
async function settle($: Engine, modDir: string): Promise<void> {
  try {
    const kept = await $.store.get(checksKey(modDir))
    if (kept !== undefined && kept !== null) await $.store.set(checksKey(modDir), settledChecks(kept as Checks))
  } catch {
    // The pane then shows the last state written.
  }
  await redraw($)
}

// One call of the gate tool: names the mod's folder when the build is pending, else runs the check that ends
// the current phase and moves the build on when it passes. The answer is the text the model reads.
async function gate($: Engine, modDirArgument: unknown, claims = false): Promise<string> {
  const sessionId = await $.session.id()
  const entry = await $.store.get(sessionKey(sessionId))
  if (!isSessionEntry(entry)) return NO_BUILD
  if (entry.modDir === null && entryKind(entry) === 'edit') {
    const modDir = typeof modDirArgument === 'string' ? absolutePath(modDirArgument, await $.session.cwd()) : null
    if (modDir === null) return `mod-builder: this edit has not named its mod's folder. Call ${GATE_TOOL} with mod_dir, the folder of the mod to edit.`
    const kept = await $.store.get(buildKey(modDir))
    const may = editFolderVerdict({
      modDir, pluginRoot: $.plugin.root, sessionId, kept,
      hasManifest: await $.fs.exists(`${modDir}/.claude-plugin/plugin.json`), hooksJson: await readText($, `${modDir}/hooks/hooks.json`),
    })
    if (!may.pass) return `mod-builder: no edit was opened: ${may.reason}${may.reason.endsWith('.') ? '' : '.'}`
    // An edit this session left unfinished in the folder goes on, with the baseline it took then.
    if (isOpenRecord(kept) && (kept as BuildRecord).sessionId === sessionId && recordKind(kept) === 'edit') {
      await $.store.set(sessionKey(sessionId), { modDir, kind: 'edit' })
      return `mod-builder: the edit of ${modDir} goes on. It is at ${phaseLabelOf('edit', (kept as BuildRecord).phase)}. Call ${GATE_TOOL} again to ask for the next phase.`
    }
    const taken = await takeBaseline($, modDir, sessionId)
    if (typeof taken === 'string') return `mod-builder: no edit was opened, and nothing was written: ${taken}.`
    await emptyBeside($, modDir)
    await $.store.set(buildKey(modDir), taken.record)
    await $.store.set(sessionKey(sessionId), { modDir, kind: 'edit' })
    await redraw($)
    return `mod-builder: the edit's mod folder is ${modDir}. ${taken.said}\nIt is at ${phaseLabelOf('edit', 'knowledge')}. Call ${GATE_TOOL} again to ask for the next phase.`
  }
  if (entry.modDir === null) {
    const modDir = typeof modDirArgument === 'string' ? absolutePath(modDirArgument, await $.session.cwd()) : null
    if (modDir === null) return `mod-builder: this build has not named its mod's folder. Call ${GATE_TOOL} with mod_dir, the folder the mod is built in.`
    const kept = await $.store.get(buildKey(modDir))
    if (isOpenRecord(kept) && (kept as BuildRecord).sessionId !== sessionId) {
      const theirs = kept as BuildRecord
      return `mod-builder: ${modDir} is being ${recordKind(theirs) === 'edit' ? 'edited' : 'built'} by another session (it is at ${phaseLabelOf(recordKind(theirs) as Kind, theirs.phase)}). Name another folder.`
    }
    // A build this session left unfinished in the folder goes on; a finished or stopped one, or an edit, gives
    // way to a new record.
    const goesOn = isOpenRecord(kept) && (kept as BuildRecord).sessionId === sessionId && recordKind(kept) === 'build'
    const record = goesOn ? (kept as BuildRecord) : newRecord(modDir, sessionId)
    if (!goesOn) await emptyBeside($, modDir)
    await $.store.set(buildKey(modDir), record)
    await $.store.set(sessionKey(sessionId), { modDir })
    await redraw($)
    return `mod-builder: the build's mod folder is ${modDir}. It is at ${phaseLabel(record.phase)}. Call ${GATE_TOOL} again to ask for the next phase.`
  }
  const record = await $.store.get(buildKey(entry.modDir))
  if (!isBuildRecord(record) || record.sessionId !== sessionId || record.modDir !== entry.modDir) {
    return `mod-builder: the build's record for ${entry.modDir} is missing or is not this session's. Start the build again with ${START}.`
  }
  const kind = recordKind(record) as Kind
  if (typeof modDirArgument === 'string' && absolutePath(modDirArgument, await $.session.cwd()) !== record.modDir) {
    return `mod-builder: this session's ${kind} is in ${record.modDir}, and stays there. Call ${GATE_TOOL} without mod_dir.`
  }
  if (record.stopped === true) return `mod-builder: the ${kind} of ${record.modDir} was stopped. Start a new one with ${kind === 'edit' ? EDIT_START : START}.`
  // The record without the last refused gate's words: a gate that passes leaves none.
  const { attempt: _attempt, ...kept } = record
  // Each gate starts with no check states: what the gate before left (a failed check, or one still "running" after
  // a call that was cut off) is not this gate's, and a gate that refuses before its checks must not show it.
  try {
    await emptyBeside($, record.modDir, [checksKey(record.modDir)])
  } catch {
    // The pane then shows the states before these.
  }
  // Whether the record is still this gate's to move: the one it read, open, at the same phase. A build or edit
  // stopped while its gate ran (the person may be asked for minutes) is not moved on, and not revived.
  const stillHere = async (): Promise<boolean> => {
    const now = await $.store.get(buildKey(record.modDir))
    return isOpenRecord(now) && (now as BuildRecord).sessionId === sessionId && (now as BuildRecord).phase === record.phase
  }
  const gone = `mod-builder: the ${kind} of ${record.modDir} was stopped or moved while this gate ran, so nothing was moved. Run /mod-builder to see where this session stands.`
  if (kind === 'build') {
    let step: Step
    try {
      step = await check($, record)
    } catch (error) {
      await settle($, record.modDir)
      throw error
    }
    if (step.wait !== undefined) {
      await keepChange($, record, step)
      await settle($, record.modDir)
      return `mod-builder: still at ${phaseLabel(record.phase)}: ${step.wait}.`
    }
    if (!step.verdict.pass) {
      await keepChange($, record, step)
      await keepAttempt($, record, step)
      await settle($, record.modDir)
      return `mod-builder: still at ${phaseLabel(record.phase)}. Not passed: ${step.verdict.reason}.${step.detail === undefined ? '' : `\n${step.detail}`}`
    }
    if (!(await stillHere())) {
      await settle($, record.modDir)
      return gone
    }
    const next = nextPhase(record.phase) as Phase
    const evidence = { ...record.evidence, [record.phase]: step.evidence ?? '' }
    await $.store.set(buildKey(record.modDir), { ...kept, ...step.change, phase: next, evidence })
    if (next === 'done') toast($, doneToast(record.modDir, 'build'))
    await settle($, record.modDir)
    return `mod-builder: ${phaseLabel(record.phase)} passed (${step.evidence ?? ''}). The build is now at ${phaseLabel(next)}.${step.note === undefined ? '' : `\n${step.note}`}`
  }
  let step: Step
  try {
    step = await checkEdit($, record, claims)
  } catch (error) {
    await settle($, record.modDir)
    throw error
  }
  const at = phaseLabelOf('edit', record.phase)
  if (step.wait !== undefined) {
    await keepChange($, record, step)
    await settle($, record.modDir)
    return `mod-builder: still at ${at}: ${step.wait}.`
  }
  if (!step.verdict.pass) {
    await keepChange($, record, step)
    await keepAttempt($, record, step)
    await settle($, record.modDir)
    return `mod-builder: still at ${at}. Not passed: ${step.verdict.reason}.${step.detail === undefined ? '' : `\n${step.detail}`}`
  }
  if (!(await stillHere())) {
    await settle($, record.modDir)
    return gone
  }
  const moved = { ...kept, ...step.change }
  const next = nextPhaseOf('edit', record.phase, moved.red) as Phase
  const evidence = { ...record.evidence, [record.phase]: step.evidence ?? '' }
  await $.store.set(buildKey(record.modDir), { ...moved, phase: next, evidence })
  if (next === 'done') toast($, doneToast(record.modDir, 'edit'))
  await settle($, record.modDir)
  const skips = record.phase === 'spec' && next === 'green' ? ` Red is skipped (${moved.skipped === 'no behaviour change' ? 'no behaviour change' : 'the test files fit this build'}).` : ''
  return `mod-builder: ${at} passed (${step.evidence ?? ''}).${skips} The edit is now at ${phaseLabelOf('edit', next)}.${step.note === undefined ? '' : `\n${step.note}`}`
}

// The folders above a path that hold a plugin's manifest, nearest first.
async function pluginFoldersAbove($: Engine, path: string, cwd: string): Promise<string[]> {
  const found: string[] = []
  for (const folder of foldersAbove(path, cwd)) {
    if (await $.fs.exists(`${folder === '/' ? '' : folder}/.claude-plugin/plugin.json`)) found.push(folder)
  }
  return found
}

// Whether a path lies in a plugin's folder, or makes one; true too when that can't be found out. A path from the
// root needs no working folder to be placed; one that is not can't be placed when the session can't say its folder.
async function liesInPlugin($: Engine, path: string): Promise<boolean> {
  try {
    let cwd = '/'
    try {
      cwd = await $.session.cwd()
    } catch {
      if (!path.startsWith('/')) return true
    }
    if (absolutePath(path, cwd) === null || pluginFolderBeingMade(path, cwd) !== null) return true
    return (await pluginFoldersAbove($, path, cwd)).length > 0
  } catch {
    return true
  }
}

// What the gate tool answers when its hook failed: why, and that the build is where it was.
const gateFailed = (_: Engine, __: unknown, next: { error: { kind: string; message?: string } }) => ({
  result: `mod-builder: the gate failed and the build did not move: ${next.error.message ?? next.error.kind}`,
})

// ---------------------------------------------------------------------------------------- the hooks

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: GATE_TOOL,
      description:
        `Asks mod-builder for the next phase of the mod build this session started with ${START}, or of the edit it started with ${EDIT_START}. The first call names the folder the mod is built in, or the mod to edit (mod_dir). Each later call runs the check that ends the current phase (the person approving the spec, validate, the tests, the typecheck, a load) and answers whether the build moved on, or what failed. Call it when a phase's work is done; it is the only way to the next phase.`,
      inputSchema: {
        type: 'object',
        properties: {
          mod_dir: { type: 'string', description: 'The folder the mod is built in, or the folder of the mod to edit; absolute or from the working directory. Given on the first call only.' },
          no_behaviour_change: { type: 'boolean', description: `In an edit, at Spec only: true puts the change forward as one with no behaviour change (a tidy-up, a description, a README). The person is then offered "${APPROVE_NO_CHANGE}", which skips Red and keeps every test as it is.` },
        },
      },
      isDeferred: false,
    })
    await $.command.register({
      name: 'mod-builder',
      description: `mod-builder: "refresh" fetches the mod documentation now; "stop" ends this session's build or edit; alone, shows where this session's build stands. ${START} <what the mod should do> builds a mod, ${EDIT_START} <mod folder> <what to change> edits one`,
      argumentHint: '[refresh|stop]',
    })
    // The test reader (SPEC.md 9.3): registered after the gate tool, and its failure stops nothing. A build of
    // Claude Code that has no such call still gets its gate; the reader's start is then a round with no verdict.
    try {
      await $.agent.register({ name: READER_NAME, description: READER_DESCRIPTION, prompt: READER_PROMPT, tools: [...READER_TOOLS], omitClaudeMd: true })
    } catch (error) {
      $.ui.log(`mod-builder: the test reader could not be registered (${String(error)})`, { to: 'debug' })
    }
    // Not awaited: the session starts while the fetch runs. A headless session never fetches.
    if (e.isInteractive) void refreshWhenStale($, options.refreshDays)
    // A new session has no open record: a status line an earlier one left is cleared (SPEC.md 8.18, point 4).
    await redraw($)

    return next(e)
  })

  // The test reader is the mod's to start, never the model's: its type is withheld from the model (SPEC.md 9.3).
  // The .catch withholds it too: a hook that failed here would otherwise be skipped, and the type offered.
  on('agent.offer', { agent: 'mod-builder:test-reader' }, () => ({ isOffered: false })).catch(() => ({ isOffered: false }))

  // A reader's answer is stored when its turn ends, and the main model nudged (SPEC.md 9.12). A failure here
  // changes nothing about the turn: the answer stays unread, and the gate counts a round with no verdict.
  on('turn.complete', async ($, e, next) => {
    try {
      await turnEnded($, e)
    } catch (error) {
      $.ui.log(`mod-builder: the end of a turn could not be read for the test reader (${String(error)})`, { to: 'debug' })
    }

    return next(e)
  })

  // What starts a build: this plugin's build skill being expanded, which the model can't skip or fake.
  on('skill.prompt', async ($, e, next) => {
    if (isBuildSkill(e, $.plugin.name, $.plugin.root)) {
      const key = sessionKey(await $.session.id())
      const entry = await $.store.get(key)
      const record = isSessionEntry(entry) && entry.modDir !== null ? await $.store.get(buildKey(entry.modDir)) : undefined
      // A build under way stays as it is when the skill is expanded again; a finished or lost one gives way.
      if (!isOpenRecord(record)) {
        // The transcript's line comes once: not again while the build it opened still waits for its folder.
        const waits = isSessionEntry(entry) && entry.modDir === null && entryKind(entry) === 'build'
        await $.store.set(key, { modDir: null })
        await emptyBeside($, '', [stoppedKey(await $.session.id())])
        if (!waits) $.ui.log(openedLine('build'))
      }
      // Unasked, so it is placed only where the terminal has the room; /mod-builder opens it at any width.
      void $.ui.open({ id: PANE, title: 'mod-builder' })
      await redraw($)
    }
    // What starts an edit (SPEC.md 8.3): this plugin's edit skill being expanded, exactly as `build` opens a build.
    if (isEditSkill(e, $.plugin.name, $.plugin.root)) {
      const key = sessionKey(await $.session.id())
      const entry = await $.store.get(key)
      const record = isSessionEntry(entry) && entry.modDir !== null ? await $.store.get(buildKey(entry.modDir)) : undefined
      // A build or an edit under way stays as it is; a finished, stopped or lost one gives way to a pending edit.
      if (!isOpenRecord(record)) {
        const waits = isSessionEntry(entry) && entry.modDir === null && entryKind(entry) === 'edit'
        await $.store.set(key, { modDir: null, kind: 'edit' })
        await emptyBeside($, '', [stoppedKey(await $.session.id())])
        if (!waits) $.ui.log(openedLine('edit'))
      }
      void $.ui.open({ id: PANE, title: 'mod-builder' })
      await redraw($)
    }

    return next(e)
  })

  // The gate tool's own hook. It answers for itself and never calls `next`. When it throws, outruns its time or
  // answers in the wrong shape, its handler answers in its place (SPEC.md 7.5): a gate that failed moved nothing.
  // It is registered before the guard's hook, so that it is the first to see its tool's call: on 2.1.322 a failure
  // in a hook beneath another hook of the same module is handed to the upper hook's handler, never to its own.
  on('tool.call', { tool: 'mcp__mod-builder__mod_builder_gate' }, async ($, e) => {
    // The gate is the main model's to call. This hook answers before the guard's, so the test reader is refused
    // here too: it may call its three tools and the hand-back (SPEC.md 9.14).
    const refused = e.agentId === undefined ? null : await readerRefused($, e)
    if (refused !== null) return { deny: refused }

    return { result: await gate($, (e as { mod_dir?: unknown }).mod_dir, (e as { no_behaviour_change?: unknown }).no_behaviour_change === true) }
  }).catch(gateFailed)

  // Every tool call passes here; only a write by a tool the guard looks at is judged. No matcher, so that a tool
  // this build lacks (MultiEdit on 2.1.322) is still judged on a build that has it.
  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    // A test reader's loop may call its three tools and the hand-back, nothing else (SPEC.md 9.12, 9.14).
    if (e.agentId !== undefined) {
      const refused = await readerRefused($, e)
      if (refused !== null) return { deny: refused }
    }
    const path = isGuardedTool(tool) ? toolPath(tool, e as { file_path?: unknown; notebook_path?: unknown }) : null
    if (path === null) return next(e)
    // Whether this session has a build at all. When that can't be read, the guard can't tell "no build here" from
    // "could not check". A write into a plugin's folder is then refused: an unreadable record must not open a mod.
    // Any other write goes on, with a line that says so: a store that can't be read must not stop a session's
    // ordinary edits (the owner, 2026-11-10: "Refuse inside plugins only").
    let sessionId: string
    let entry: unknown
    try {
      sessionId = await $.session.id()
      entry = await $.store.get(sessionKey(sessionId))
    } catch (error) {
      if (await liesInPlugin($, path)) {
        return { deny: `mod-builder: ${path} can't be written: the phase guard could not read whether this session has a build (${String(error)}), and the path is in a plugin's folder. Run with claude --debug to see why.` }
      }
      $.ui.log(`mod-builder: the phase guard could not read whether this session has a build (${String(error)}), so it judged nothing.`)
      return next(e)
    }
    if (entry === undefined || entry === null) return next(e)
    // From here a build is open in this session: anything that fails refuses the write (the .catch below).
    const cwd = await $.session.cwd()
    // The plugins the path lies in: while a build is open, another plugin's folder is closed (pending or named).
    const pluginFolders = await pluginFoldersAbove($, path, cwd)
    const record = isSessionEntry(entry) && entry.modDir !== null ? await $.store.get(buildKey(entry.modDir)) : undefined
    const verdict = guardVerdict({ tool, path, cwd, sessionId, entry, record, pluginFolders })
    if (verdict.allowed) return next(e)
    // A refused write is counted for the pane, beside the record and never in it (SPEC.md 8.18): the toast comes
    // once for each phase. A count that can't be kept changes nothing about the refusal.
    // Refusals are counted one after another: writes refused side by side would each read the count before the
    // others wrote theirs, and each show the phase's toast.
    // Done included: a write refused there is one of the build's refusals, and Done's frame counts them.
    if (isBuildRecord(record) && record.stopped !== true && record.sessionId === sessionId) {
      const { modDir, phase } = record
      counting = counting.then(async () => {
        const whole = absolutePath(path, cwd) ?? path
        const counted = countRefusal(await $.store.get(refusalsKey(modDir)), sessionId, phase, whole.startsWith(`${modDir}/`) ? whole.slice(modDir.length + 1) : whole)
        await $.store.set(refusalsKey(modDir), counted.refusals)
        if (counted.toast !== null) toast($, counted.toast)
        await redraw($)
      }).catch(() => {
        // The pane then shows the count before this one.
      })
      await counting
    }

    return { deny: verdict.reason }
  }).catch(($, e, next) =>
    next.called || !isGuardedTool(String(e.tool))
      ? next(e)
      : { deny: 'mod-builder: a build is open in this session and the phase guard failed before it could judge this write, so the write is refused. Run with claude --debug to see why.' },
  )

  on('command.run', { command: 'mod-builder' }, async ($, e) => {
    const word = e.args.trim()
    if (word === 'refresh') return { text: (await refresh($)).text }
    if (word === 'stop') {
      try {
        return { text: await stop($) }
      } catch (error) {
        return { text: `mod-builder: the stop failed (${String(error)}). Nothing was moved; run /mod-builder to see where this session stands.` }
      }
    }
    if (word !== '') {
      return { text: `mod-builder: "/mod-builder refresh" fetches the mod documentation now, and "/mod-builder" alone shows this session's build. To build a mod, run: ${START} ${word}` }
    }
    await $.ui.open({ id: PANE, title: 'mod-builder' })
    const given = await paneInput($)
    const model = paneModel(given)
    const now = model.rail.find((item) => item.state === 'current')

    return { text: `mod-builder: ${model.header.state}.${now === undefined ? '' : ` It is at ${now.text}.`} Docs: snapshot ${given.knowledge.latest ?? 'none'}, checked ${given.knowledge.checked ?? 'never'}.` }
  })

  // The pane (SPEC.md 8.18): the rules say what is drawn, and this draws it with the surface's own elements.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Markdown } = $.ui.resolve(e)
    const model: PaneModel = paneModel(await paneInput($))
    const columns = Math.min(400, Math.max(1, Math.floor(Number((e.props as { bodyColumns?: unknown }).bodyColumns) || 40)))
    // A cell with a width keeps it and is cut at its end; left to wrap, a narrow pane breaks its word (probed).
    const cell = (one: Cell) => (
      <Box width={one.width} flexShrink={one.width === undefined ? 1 : 0}>
        <Text {...TONES[one.tone ?? 'plain']} wrap="truncate-end">{one.text}</Text>
      </Box>
    )
    const isDone = model.rail.at(-1)?.state === 'current'

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
          <Text bold>{model.header.title}</Text>
          <Text {...TONES[model.header.tone]} wrap="truncate-end">{model.header.state}</Text>
        </Box>
        <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
          {model.rail.map((item) =>
            model.isRailDim || item.state === 'later' || item.state === 'skipped' ? <Text dimColor>{item.text}</Text>
              : item.state === 'done' ? <Text color="success">{item.text}</Text>
                : <Text bold backgroundColor={isDone ? 'success' : 'suggestion'}>{` ${item.text} `}</Text>,
          )}
        </Box>
        <Text dimColor>{'\u2500'.repeat(columns)}</Text>
        {model.blocks.map((block) => (
          <Box flexDirection="column" marginTop={1}>
            {block.heading.length > 0 && (
              <Box flexDirection="row" columnGap={2}>
                {block.heading.map((one, index) => <Text {...TONES[one.tone ?? 'plain']} bold={index === 0} wrap="truncate-end">{one.text}</Text>)}
              </Box>
            )}
            {block.rows.map((row) => <Box flexDirection="row" columnGap={1}>{row.map(cell)}</Box>)}
            {block.markdown !== undefined && <Markdown text={block.markdown} />}
          </Box>
        ))}
      </Box>
    )
  })
}

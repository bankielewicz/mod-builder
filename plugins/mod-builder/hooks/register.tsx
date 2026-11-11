// The phase guard (SPEC.md 3.3): a build is opened when this plugin's build skill is expanded, a tool.call hook
// refuses the writes a phase may not make, and one tool, mod_builder_gate, runs each phase's check itself and
// advances the build on what the check shows. Beside it (SPEC.md 3.1, "When"): at the start of an interactive
// session the documentation cache is refreshed when it is stale, `/mod-builder refresh` refreshes it now, and one
// pane shows the phases, the evidence and the cache. The rules are in mod-builder-logic.ts; this file reads the
// world for them through `$` and writes down what they answer.
import type { EngineInterface, Register } from 'claude-code'

import {
  APPROVE_NO_CHANGE, EDIT_PHASES, baselineVerdict, editApprovalOptions, editApprovalQuestion, editFolderVerdict, editRedGate, editSpecGate, editSpecKept, entryKind,
  isEditSkill, isOpenRecord, isTestPath, isKeptOut, keptTestsGate, mayRefactor, namesGone, newEditRecord, nextPhaseOf, phaseLabelOf, putsBack, recordKind, refactorRecord, repairRedGate,
  restoreFolder, stopOptions, stoppedFolder, stoppedRecord, testChangeEvidence, testChangeGate, testChangeOptions, testChangeQuestion, testFilesChanged, testFilesToAsk, testHashesOf, versionGate,
  APPROVE, GATE_TOOL, PHASES, absolutePath, approvalOptions, buildKey, foldersAbove, greenGate, guardVerdict,
  hashGate, isBuildRecord, isBuildSkill, isCacheStale, isCompiler, isGuardedTool, isSessionEntry, loadShown, newRecord, nextPhase, phaseLabel, phaseNumber, phaseTitle, pluginFolderBeingMade, redGate,
  scaffoldGate, sessionKey, specGate, specKept, testNames, toolPath, typecheckConfig, typesFileIn, typesFolder, typesToCheck, isTypesOf, lastLines, hooksSkipped, builtOnLine, builtMisses, refusedAt, typecheckGate, validateLines, COMPILERS, verifyGate,
} from './mod-builder-logic'
import type { AskedFile, Baseline, BuildRecord, Check, Hashes, Kind, Phase, Run, SpecNow, TypecheckRun, TypesCandidate, Verdict } from './mod-builder-logic'

type Engine = EngineInterface

// How long each check may run, in milliseconds. `$.process.run` allows ten minutes at most (the build's types).
const VALIDATE_MS = 120000
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
async function refresh($: Engine): Promise<{ isDone: boolean; text: string }> {
  const home = await $.env.get('HOME')
  if (home === undefined) return { isDone: false, text: 'mod-builder: HOME is not set, so the documentation cache has no folder.' }
  let ran
  try {
    ran = await $.process.run(['bash', `${$.plugin.root}/scripts/refresh-docs.sh`, cacheOf(home)], { timeoutMs: REFRESH_MS })
  } catch (error) {
    return { isDone: false, text: `mod-builder: the documentation fetch could not run: ${String(error)}` }
  }
  const last = (text: string) => text.trim().split('\n').pop() ?? ''
  const said = last(ran.stdout) !== '' ? last(ran.stdout) : last(ran.stderr)
  if (ran.exitCode !== 0) return { isDone: false, text: `mod-builder: the documentation fetch failed (exit ${ran.exitCode}): ${said}` }
  // A run that found another fetch holding the lock fetched nothing: the version it would record is not this one's.
  if (!said.includes('another fetch holds the lock')) await $.store.set(FETCHED_UNDER, (await $.session.version()).version)
  $.ui.invalidate('ui.render')
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

type PaneView = { title: string; phases: { text: string; isDim: boolean }[]; evidence: string; knowledge: string }

// What the pane shows for this session: its build's phases, what the last gate saw, and the cache.
async function paneView($: Engine): Promise<PaneView> {
  const sessionId = await $.session.id()
  const entry = await $.store.get(sessionKey(sessionId))
  const kept = isSessionEntry(entry) && entry.modDir !== null ? await $.store.get(buildKey(entry.modDir)) : undefined
  const record = isBuildRecord(kept) && kept.sessionId === sessionId ? kept : null
  const kind: Kind = record === null ? entryKind(entry) : (recordKind(record) as Kind)
  const shown: readonly Phase[] = kind === 'edit' ? EDIT_PHASES : PHASES
  const at = record === null ? 0 : shown.indexOf(record.phase) + 1
  const title = !isSessionEntry(entry)
    ? 'No build in this session.'
    : entry.modDir === null
      ? `${kind === 'edit' ? 'An edit' : 'A build'} is open. Its mod folder is not named yet.`
      : record === null
        ? `Building ${entry.modDir}, but its record is missing or another session's.`
        : `${kind === 'edit' ? 'Editing' : 'Building'} ${entry.modDir}`
  const phases = shown.map((phase) => {
    const number = shown.indexOf(phase) + 1
    const mark = at === 0 || number > at ? '[ ]' : number < at ? '[x]' : '[>]'
    return { text: `${mark} ${number} ${phaseTitle(phase)}`, isDim: mark !== '[>]' }
  })
  const before = record === null || at < 2 ? undefined : shown[at - 2]
  const seen = before === undefined || record === null ? undefined : record.evidence[before]
  const evidence = before === undefined || seen === undefined || seen === '' ? '' : `${phaseTitle(before)}: ${seen}`
  const home = await $.env.get('HOME')
  const latest = home === undefined ? null : await readText($, `${cacheOf(home)}/latest`)
  const checked = home === undefined ? null : await readText($, `${cacheOf(home)}/checked`)
  const knowledge = `Docs: snapshot ${latest === null ? 'none' : latest.trim()}, checked ${checked === null ? 'never' : checked.trim()}`

  return { title, phases, evidence, knowledge }
}

// ------------------------------------------------------------------------------------------ the gate

// `detail` is what a refusal quotes beneath its reason, with its own heading: the last lines of the command that
// failed, or the line to write. `note` is what a passed gate adds to its answer.
type Step = { verdict: Verdict; evidence?: string; change?: Partial<BuildRecord>; detail?: string; note?: string }

// What a command said: what it printed, else what it wrote to standard error.
const said = (ran: Run & { errors: string }) => (ran.output.trim() !== '' ? ran.output : ran.errors)

// A refusal's quoted lines under their heading; nothing when there are none.
const quoting = (verdict: Verdict, lines: string, heading = 'The last lines of its output:'): Step => (lines === '' ? { verdict } : { verdict, detail: `${heading}\n${lines}` })

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
// `testFiles` are an edit's test files, which the typecheck names (SPEC.md 8.14); a build names none.
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

// What a refused typecheck quotes: the compiler's last lines, and always the types file it failed against, though
// the compiler printed nothing.
function typecheckDetail(ran: Run & { errors: string }, against: TypesFile): string {
  const lines = lastLines(said(ran))
  const types = `the types file ${against.path} (sha256 ${against.sha256})`
  return lines === '' ? `It printed nothing. It ran against ${types}.` : `The last lines of its output, against ${types}:\n${lines}`
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
  // An edit's test files are named to the typecheck, wherever they sit (SPEC.md 8.14).
  const testFiles = isEdit ? Object.keys(testHashesOf((await hashMod($, modDir)) ?? {})) : []
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
  const validated = await validate($, modDir)
  const tested = await test($, modDir)
  const { ran: typechecked, against } = await typecheckEach($, typecheck, modDir, testFiles)
  // `/cost` is answered by Claude Code itself: the session loads the mod and makes no model call.
  const loaded = await run($, ['claude', '--plugin-dir', modDir, '-p', '/cost', '--debug-file', log], LOAD_MS)
  const logged = (await readText($, log)) ?? ''
  const runs = { validate: validated, test: tested, typecheck: typechecked, load: loaded, loadShown: loadShown(logged, name) }
  const verdict = verifyGate(runs, testsBefore)
  if (!verdict.pass) {
    // Which of the four it was is asked of the rules (refusedAt), not read from the reason's words.
    const at = refusedAt(runs, testsBefore)
    if (at === 'validate') return quoting(verdict, validateLines(said(validated)))
    if (at === 'test') return quoting(verdict, lastLines(said(tested)))
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
  if (!isEdit) return { verdict, evidence, note: copy }
  // An edit whose Red was skipped wrote no test: the run is held to the baseline's tests (SPEC.md 8.15).
  if (record.red === 'skipped') {
    const same = keptTestsGate(tested, record.baseline, record.skipped)
    if (!same.pass) return quoting(same, lastLines(said(tested)))
  }
  // The version is greater than before the edit (SPEC.md 8.3); judged again at Verify, where plugin.json is open.
  let version: unknown
  try {
    version = (JSON.parse(manifest ?? '') as { version?: unknown }).version
  } catch {
    version = undefined
  }
  const greater = versionGate(record.baseline?.version ?? null, version)
  if (!greater.pass) return { verdict: greater }
  return { verdict, evidence: `${evidence}; version ${String(version)}${record.baseline?.version == null ? '' : `, after ${record.baseline.version}`}`, note: copy }
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
async function askOfTests($: Engine, record: BuildRecord, now: Hashes, tested: Run | null): Promise<Step | string> {
  const baseline = record.baseline as Baseline
  const asked = testFilesToAsk(baseline.hashes, now)
  if (asked.length === 0) return ''
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
  return testChangeEvidence(asked, answer as string)
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
        if (!verdict.pass) return quoting(verdict, lastLines(said(tested)))
        count = verdict.tests as number
        const types = await typecheckNow($, modDir, testFiles)
        if (!Array.isArray(types)) return types
        ended = `${count} tests ran, a new or changed one failing by assertion; the typecheck passes (types sha256 ${types.join(', ')})`
      }
      const asked = await askOfTests($, record, before, tested)
      if (typeof asked !== 'string') return asked
      const after = await hashMod($, modDir)
      if (after === null) return refuse('the mod\'s files could not be read')
      const same = hashGate(tests, testHashesOf(after))
      if (!same.pass) return refuse(`the test files changed while Red's checks ran (${same.reason}): ask again`)
      const still = await specUnchanged($, record)
      if (!still.pass) return { verdict: still }
      const changed = testFilesChanged(baseline.hashes, before)
      return {
        verdict: { pass: true },
        evidence: `${ended}; ${testFiles.length} test files hashed${changed.length === 0 ? '' : `, not as at the baseline: ${changed.join(', ')}`}${asked === '' ? '' : `; ${asked}`}`,
        change: { testsAtRed: count, testHashes: tests },
      }
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
    $.ui.invalidate('ui.render')
    return `mod-builder: stopped. This session's ${entryKind(entry)} had named no folder yet, and nothing was changed.`
  }
  // A record that is missing, or another session's, is not this session's to stop: only the session is unbound.
  if (!isBuildRecord(record) || record.sessionId !== sessionId) {
    await $.store.set(key, null)
    $.ui.invalidate('ui.render')
    return `mod-builder: stopped. The record for ${entry.modDir} is missing or is not this session's, so it was left as it is; this session is no longer bound to the folder.`
  }
  if (!isOpenRecord(record)) {
    await $.store.set(key, null)
    $.ui.invalidate('ui.render')
    return `mod-builder: the ${recordKind(record) === 'edit' ? 'edit' : 'build'} of ${record.modDir} was already ${record.stopped === true ? 'stopped' : 'done'}; this session is no longer bound to it, and nothing else was changed.`
  }
  const kind = recordKind(record) as Kind
  // The record first, then the session: a record marked stopped holds nothing even if the second write fails.
  await $.store.set(buildKey(record.modDir), stoppedRecord(record))
  await $.store.set(key, null)
  $.ui.invalidate('ui.render')
  const stopped = `mod-builder: the ${kind} of ${record.modDir} is stopped at ${phaseLabelOf(kind, record.phase)}. Other plugins' folders can be written again.`
  if (kind !== 'edit' || record.baseline === undefined) return `${stopped} The folder is left as it is.`
  let answer: string | null = null
  try {
    answer = await $.ui.ask(`The edit of ${record.modDir} is stopped. What becomes of the mod?`, { options: stopOptions(), header: 'Stop' })
  } catch {
    answer = null
  }
  if (!putsBack(answer)) return `${stopped} The mod is kept as it is now. Its restore point stays at ${record.baseline.restore}.`
  const beside = stoppedFolder(record.modDir, await $.clock.now())
  if (beside === null) return `${stopped} It could not be put back: no name could be made for the stopped folder. The mod is as it is now, and its restore point is ${record.baseline.restore}.`
  const put = await run($, ['bash', `${$.plugin.root}/scripts/put-back.sh`, record.modDir, record.baseline.restore, beside], RESTORE_MS)
  if (put.exitCode !== 0) return `${stopped} It could not be put back: ${lastLines(said(put), 3).replace(/\n/g, ' ') || 'put-back.sh ended with no exit code'}`
  const moved = put.output.split('\n').find((line) => line.startsWith('moved: ')) ?? 'moved: nothing'
  return `${stopped} The mod is put back as it was before this edit, in ${record.modDir}; the folder as it was when stopped is kept beside it as ${beside}. ${moved === 'moved: nothing' ? 'Nothing was moved between them.' : `Moved into the restored mod: ${moved.slice('moved: '.length)}.`} Nothing was deleted.`
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
        answer = await $.ui.ask(`Approve the spec of this mod? (${modDir}/SPEC.md)`, { options: approvalOptions(hasDesign), header: 'Spec' })
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
      const validated = await validate($, modDir)
      const tests = await test($, modDir)
      const verdict = scaffoldGate(validated, tests)
      // A refused validate or test run is quoted as a refused typecheck is (SPEC.md 7.9): validate's own findings,
      // which stand before its plugin-directory section, or the last lines of the test run.
      if (!verdict.pass) return quoting(verdict, validated.exitCode !== 0 ? validateLines(said(validated)) : lastLines(said(tests)))
      // The typecheck too (SPEC.md 7.10): hooks/ and types/ close when Scaffold passes, and Red ends on a typecheck.
      const types = await typecheckNow($, modDir)
      if (!Array.isArray(types)) return types
      return {
        verdict,
        evidence: `claude plugin validate --strict exited 0; ${verdict.tests} tests ran; the typecheck passes (types sha256 ${types.join(', ')})`,
        change: { testsAtScaffold: verdict.tests as number, namesAtScaffold: testNames(tests.output) },
      }
    }
    case 'red': {
      const kept = await unchanged($, record, false)
      if (!kept.pass) return { verdict: kept }
      // The tests are hashed before the run and after it: what is recorded must be what ran.
      const before = await hashTests($, modDir)
      const linked = before === null ? undefined : Object.keys(before).find((path) => before[path] === NOT_A_FILE)
      if (linked !== undefined) return refuse(`${linked} is a link or no file: a test must be a file of the mod's own, so that what it holds can be recorded`)
      const tested = await test($, modDir)
      const verdict = redGate(tested, record.testsAtScaffold as number, record.namesAtScaffold as string[])
      if (!verdict.pass) return quoting(verdict, lastLines(said(tested)))
      // The typecheck, after the test run's verdict (SPEC.md 7.10): tests/ closes when Red passes, so a test that
      // does not typecheck is refused here, while it can still be changed. It runs before the tests are hashed
      // again, so what is recorded is what was typechecked.
      const types = await typecheckNow($, modDir)
      if (!Array.isArray(types)) return types
      const testHashes = await hashTests($, modDir)
      if (before === null || testHashes === null) return refuse('the files under tests/ could not be read')
      const same = hashGate(before, testHashes)
      if (!same.pass) return refuse(`tests/ changed while the tests ran (${same.reason}): ask again`)
      const still = await unchanged($, record, false)
      if (!still.pass) return { verdict: still }
      return {
        verdict,
        evidence: `${verdict.tests} tests ran, the new ones failing by assertion; the typecheck passes (types sha256 ${types.join(', ')}); ${Object.keys(testHashes).length} files under tests/ hashed`,
        change: { testsAtRed: verdict.tests as number, testHashes },
      }
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
    await $.store.set(buildKey(modDir), taken.record)
    await $.store.set(sessionKey(sessionId), { modDir, kind: 'edit' })
    $.ui.invalidate('ui.render')
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
    const record = isOpenRecord(kept) && (kept as BuildRecord).sessionId === sessionId && recordKind(kept) === 'build' ? (kept as BuildRecord) : newRecord(modDir, sessionId)
    await $.store.set(buildKey(modDir), record)
    await $.store.set(sessionKey(sessionId), { modDir })
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
  if (kind === 'build') {
    const step = await check($, record)
    if (!step.verdict.pass) return `mod-builder: still at ${phaseLabel(record.phase)}. Not passed: ${step.verdict.reason}.${step.detail === undefined ? '' : `\n${step.detail}`}`
    const next = nextPhase(record.phase) as Phase
    const evidence = { ...record.evidence, [record.phase]: step.evidence ?? '' }
    await $.store.set(buildKey(record.modDir), { ...record, ...step.change, phase: next, evidence })
    $.ui.invalidate('ui.render')
    return `mod-builder: ${phaseLabel(record.phase)} passed (${step.evidence ?? ''}). The build is now at ${phaseLabel(next)}.${step.note === undefined ? '' : `\n${step.note}`}`
  }
  const step = await checkEdit($, record, claims)
  const at = phaseLabelOf('edit', record.phase)
  if (!step.verdict.pass) return `mod-builder: still at ${at}. Not passed: ${step.verdict.reason}.${step.detail === undefined ? '' : `\n${step.detail}`}`
  const moved = { ...record, ...step.change }
  const next = nextPhaseOf('edit', record.phase, moved.red) as Phase
  const evidence = { ...record.evidence, [record.phase]: step.evidence ?? '' }
  await $.store.set(buildKey(record.modDir), { ...moved, phase: next, evidence })
  $.ui.invalidate('ui.render')
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
    // Not awaited: the session starts while the fetch runs. A headless session never fetches.
    if (e.isInteractive) void refreshWhenStale($, options.refreshDays)

    return next(e)
  })

  // What starts a build: this plugin's build skill being expanded, which the model can't skip or fake.
  on('skill.prompt', async ($, e, next) => {
    if (isBuildSkill(e, $.plugin.name, $.plugin.root)) {
      const key = sessionKey(await $.session.id())
      const entry = await $.store.get(key)
      const record = isSessionEntry(entry) && entry.modDir !== null ? await $.store.get(buildKey(entry.modDir)) : undefined
      // A build under way stays as it is when the skill is expanded again; a finished or lost one gives way.
      if (!isOpenRecord(record)) await $.store.set(key, { modDir: null })
      // Unasked, so it is placed only where the terminal has the room; /mod-builder opens it at any width.
      void $.ui.open({ id: PANE, title: 'mod-builder' })
      $.ui.invalidate('ui.render')
    }
    // What starts an edit (SPEC.md 8.3): this plugin's edit skill being expanded, exactly as `build` opens a build.
    if (isEditSkill(e, $.plugin.name, $.plugin.root)) {
      const key = sessionKey(await $.session.id())
      const entry = await $.store.get(key)
      const record = isSessionEntry(entry) && entry.modDir !== null ? await $.store.get(buildKey(entry.modDir)) : undefined
      // A build or an edit under way stays as it is; a finished, stopped or lost one gives way to a pending edit.
      if (!isOpenRecord(record)) await $.store.set(key, { modDir: null, kind: 'edit' })
      void $.ui.open({ id: PANE, title: 'mod-builder' })
      $.ui.invalidate('ui.render')
    }

    return next(e)
  })

  // The gate tool's own hook. It answers for itself and never calls `next`. When it throws, outruns its time or
  // answers in the wrong shape, its handler answers in its place (SPEC.md 7.5): a gate that failed moved nothing.
  // It is registered before the guard's hook, so that it is the first to see its tool's call: on 2.1.322 a failure
  // in a hook beneath another hook of the same module is handed to the upper hook's handler, never to its own.
  on('tool.call', { tool: 'mcp__mod-builder__mod_builder_gate' }, async ($, e) => ({
    result: await gate($, (e as { mod_dir?: unknown }).mod_dir, (e as { no_behaviour_change?: unknown }).no_behaviour_change === true),
  })).catch(gateFailed)

  // Every tool call passes here; only a write by a tool the guard looks at is judged. No matcher, so that a tool
  // this build lacks (MultiEdit on 2.1.322) is still judged on a build that has it.
  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
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

    return verdict.allowed ? next(e) : { deny: verdict.reason }
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
    const view = await paneView($)
    const now = view.phases.find((phase) => !phase.isDim)

    const title = view.title.endsWith('.') ? view.title : `${view.title}.`

    return { text: `mod-builder: ${title}${now === undefined ? '' : ` It is at ${now.text.slice(4)}.`} ${view.knowledge}.` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const view = await paneView($)

    return (
      <Box flexDirection="column">
        <Text>{view.title}</Text>
        {view.phases.map((phase) => (
          <Text dimColor={phase.isDim}>{phase.text}</Text>
        ))}
        {view.evidence !== '' && <Text dimColor>{view.evidence}</Text>}
        <Text dimColor>{view.knowledge}</Text>
      </Box>
    )
  })
}

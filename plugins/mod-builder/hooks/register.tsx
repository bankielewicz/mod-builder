// The phase guard (SPEC.md 3.3): a build is opened when this plugin's build skill is expanded, a tool.call hook
// refuses the writes a phase may not make, and one tool, mod_builder_gate, runs each phase's check itself and
// advances the build on what the check shows. Beside it (SPEC.md 3.1, "When"): at the start of an interactive
// session the documentation cache is refreshed when it is stale, `/mod-builder refresh` refreshes it now, and one
// pane shows the phases, the evidence and the cache. The rules are in mod-builder-logic.ts; this file reads the
// world for them through `$` and writes down what they answer.
import type { EngineInterface, Register } from 'claude-code'

import {
  APPROVE, GATE_TOOL, PHASES, absolutePath, approvalOptions, buildKey, foldersAbove, greenGate, guardVerdict,
  hashGate, isBuildRecord, isBuildSkill, isCacheStale, isGuardedTool, isSessionEntry, loadShown, newRecord, nextPhase, phaseLabel, phaseNumber, phaseTitle, pluginFolderBeingMade, redGate,
  scaffoldGate, sessionKey, specGate, specKept, testNames, toolPath, verifyGate,
} from './mod-builder-logic'
import type { BuildRecord, Hashes, Phase, Run, SpecNow, Verdict } from './mod-builder-logic'

type Engine = EngineInterface

// How long each check may run, in milliseconds. `$.process.run` allows ten minutes at most (the build's types).
const VALIDATE_MS = 120000
const TEST_MS = 300000
const TYPECHECK_MS = 300000
const LOAD_MS = 120000

const REFRESH_MS = 300000

// What stands for the hash of a link, or of anything else under tests/ that is no file and no folder. Its content
// is not read, so it can't be recorded: Red refuses a tests/ that holds one.
const NOT_A_FILE = 'not a file'

const NO_BUILD = 'mod-builder: no build is open in this session. /mod-builder <what the mod should do> starts one.'

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
async function run($: Engine, argv: readonly string[], timeoutMs: number): Promise<Run> {
  try {
    const ran = await $.process.run(argv, { timeoutMs })
    // Output cut at the engine's limit has lost its end, where the runner's count is: it is no evidence.
    if (ran.isStdoutTruncated) return { exitCode: Number.NaN, output: '' }
    return { exitCode: ran.exitCode, output: ran.stdout }
  } catch {
    return { exitCode: Number.NaN, output: '' }
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
  const hashes: Hashes = {}
  const walk = async (rel: string): Promise<boolean> => {
    let entries
    try {
      entries = await $.fs.list(`${modDir}/${rel}`)
    } catch {
      return false
    }
    for (const entry of entries) {
      const path = `${rel}/${entry.name}`
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
  return (await walk('tests')) ? hashes : null
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
  const at = record === null ? 0 : phaseNumber(record.phase)
  const title = !isSessionEntry(entry)
    ? 'No build in this session.'
    : entry.modDir === null
      ? 'A build is open. Its mod folder is not named yet.'
      : record === null
        ? `Building ${entry.modDir}, but its record is missing or another session's.`
        : `Building ${entry.modDir}`
  const phases = PHASES.map((phase) => {
    const number = phaseNumber(phase)
    const mark = at === 0 || number > at ? '[ ]' : number < at ? '[x]' : '[>]'
    return { text: `${mark} ${number} ${phaseTitle(phase)}`, isDim: mark !== '[>]' }
  })
  const before = record === null || at < 2 ? undefined : PHASES[at - 2]
  const seen = before === undefined || record === null ? undefined : record.evidence[before]
  const evidence = before === undefined || seen === undefined || seen === '' ? '' : `${phaseTitle(before)}: ${seen}`
  const home = await $.env.get('HOME')
  const latest = home === undefined ? null : await readText($, `${cacheOf(home)}/latest`)
  const checked = home === undefined ? null : await readText($, `${cacheOf(home)}/checked`)
  const knowledge = `Docs: snapshot ${latest === null ? 'none' : latest.trim()}, checked ${checked === null ? 'never' : checked.trim()}`

  return { title, phases, evidence, knowledge }
}

// ------------------------------------------------------------------------------------------ the gate

type Step = { verdict: Verdict; evidence?: string; change?: Partial<BuildRecord> }

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
      if (!verdict.pass) return { verdict }
      return {
        verdict,
        evidence: `claude plugin validate --strict exited 0; ${verdict.tests} tests ran`,
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
      const verdict = redGate(await test($, modDir), record.testsAtScaffold as number, record.namesAtScaffold as string[])
      if (!verdict.pass) return { verdict }
      const testHashes = await hashTests($, modDir)
      if (before === null || testHashes === null) return refuse('the files under tests/ could not be read')
      const same = hashGate(before, testHashes)
      if (!same.pass) return refuse(`tests/ changed while the tests ran (${same.reason}): ask again`)
      const still = await unchanged($, record, false)
      if (!still.pass) return { verdict: still }
      return {
        verdict,
        evidence: `${verdict.tests} tests ran, the new ones failing by assertion; ${Object.keys(testHashes).length} files under tests/ hashed`,
        change: { testsAtRed: verdict.tests as number, testHashes },
      }
    }
    case 'green': {
      const kept = await unchanged($, record, true)
      if (!kept.pass) return { verdict: kept }
      const verdict = greenGate(await test($, modDir), record.testsAtRed as number)
      if (!verdict.pass) return { verdict }
      // And again after the run: a file changed while the tests ran is a file changed.
      const still = await unchanged($, record, true)
      if (!still.pass) return { verdict: still }
      return { verdict, evidence: `all ${verdict.tests} tests pass; tests/ and SPEC.md are as recorded` }
    }
    case 'verify': {
      const kept = await unchanged($, record, true)
      if (!kept.pass) return { verdict: kept }
      const manifest = await readText($, `${modDir}/.claude-plugin/plugin.json`)
      let name = ''
      try {
        name = String((JSON.parse(manifest ?? '') as { name?: unknown }).name ?? '')
      } catch {
        return refuse(`${modDir}/.claude-plugin/plugin.json can't be read`)
      }
      const home = await $.env.get('HOME')
      const log = `${home ?? ''}/.claude/mod-builder-data/v2/loads/${await $.session.id()}.log`
      // `claude --debug-file` adds to a file that is there, so the log starts empty.
      await $.fs.write(log, '')
      const runs = {
        validate: await validate($, modDir),
        test: await test($, modDir),
        typecheck: await run($, ['npx', '--no-install', 'tsc', '--noEmit', '-p', modDir], TYPECHECK_MS),
        // `/cost` is answered by Claude Code itself: the session loads the mod and makes no model call.
        load: await run($, ['claude', '--plugin-dir', modDir, '-p', '/cost', '--debug-file', log], LOAD_MS),
        loadShown: false,
      }
      runs.loadShown = loadShown((await readText($, log)) ?? '', name)
      const verdict = verifyGate(runs, record.testsAtRed as number)
      if (!verdict.pass) return { verdict }
      const still = await unchanged($, record, true)
      if (!still.pass) return { verdict: still }
      return { verdict, evidence: `validate, ${verdict.tests} tests, the typecheck and a headless load of ${name} all pass` }
    }
    case 'done':
      return refuse('the build is done: nothing follows phase 8')
  }
}

// One call of the gate tool: names the mod's folder when the build is pending, else runs the check that ends
// the current phase and moves the build on when it passes. The answer is the text the model reads.
async function gate($: Engine, modDirArgument: unknown): Promise<string> {
  const sessionId = await $.session.id()
  const entry = await $.store.get(sessionKey(sessionId))
  if (!isSessionEntry(entry)) return NO_BUILD
  if (entry.modDir === null) {
    const modDir = typeof modDirArgument === 'string' ? absolutePath(modDirArgument, await $.session.cwd()) : null
    if (modDir === null) return `mod-builder: this build has not named its mod's folder. Call ${GATE_TOOL} with mod_dir, the folder the mod is built in.`
    const kept = await $.store.get(buildKey(modDir))
    if (isBuildRecord(kept) && kept.sessionId !== sessionId && kept.phase !== 'done') {
      return `mod-builder: ${modDir} is being built by another session (it is at ${phaseLabel(kept.phase)}). Name another folder.`
    }
    // A build this session left unfinished in the folder goes on; a finished one gives way to a new record.
    const record = isBuildRecord(kept) && kept.sessionId === sessionId && kept.phase !== 'done' ? kept : newRecord(modDir, sessionId)
    await $.store.set(buildKey(modDir), record)
    await $.store.set(sessionKey(sessionId), { modDir })
    return `mod-builder: the build's mod folder is ${modDir}. It is at ${phaseLabel(record.phase)}. Call ${GATE_TOOL} again to ask for the next phase.`
  }
  const record = await $.store.get(buildKey(entry.modDir))
  if (!isBuildRecord(record) || record.sessionId !== sessionId || record.modDir !== entry.modDir) {
    return `mod-builder: the build's record for ${entry.modDir} is missing or is not this session's. Start the build again with /mod-builder.`
  }
  if (typeof modDirArgument === 'string' && absolutePath(modDirArgument, await $.session.cwd()) !== record.modDir) {
    return `mod-builder: this session's build is in ${record.modDir}, and stays there. Call ${GATE_TOOL} without mod_dir.`
  }
  const step = await check($, record)
  if (!step.verdict.pass) return `mod-builder: still at ${phaseLabel(record.phase)}. Not passed: ${step.verdict.reason}.`
  const next = nextPhase(record.phase) as Phase
  const evidence = { ...record.evidence, [record.phase]: step.evidence ?? '' }
  await $.store.set(buildKey(record.modDir), { ...record, ...step.change, phase: next, evidence })
  $.ui.invalidate('ui.render')
  return `mod-builder: ${phaseLabel(record.phase)} passed (${step.evidence ?? ''}). The build is now at ${phaseLabel(next)}.`
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
        'Asks mod-builder for the next phase of the mod build this session started with /mod-builder. The first call names the folder the mod is built in (mod_dir). Each later call runs the check that ends the current phase (the person approving the spec, validate, the tests, the typecheck, a load) and answers whether the build moved on, or what failed. Call it when a phase\'s work is done; it is the only way to the next phase.',
      inputSchema: { type: 'object', properties: { mod_dir: { type: 'string', description: 'The folder the mod is built in, absolute or from the working directory. Given on the first call only.' } } },
      isDeferred: false,
    })
    await $.command.register({
      name: 'mod-builder',
      description: 'mod-builder: "refresh" fetches the mod documentation now; alone, shows where this session\'s build stands',
      argumentHint: '[refresh]',
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
      if (!(isBuildRecord(record) && record.phase !== 'done')) await $.store.set(key, { modDir: null })
      // Unasked, so it is placed only where the terminal has the room; /mod-builder opens it at any width.
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
    result: await gate($, (e as { mod_dir?: unknown }).mod_dir),
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
    if (word !== '') {
      return { text: 'mod-builder: "/mod-builder refresh" fetches the mod documentation now, and "/mod-builder" alone shows this session\'s build. A build is started by the build skill.' }
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

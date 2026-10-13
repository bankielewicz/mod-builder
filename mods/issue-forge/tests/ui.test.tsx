import { describe, expect, mock, test } from 'claude-code/testing'

// Behaviour tests for register.tsx: every `$` call is answered by a scripted repository below.

const ROOT = '/w'
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
  mock.store(on, store)
  mock.env(on, { HOME: '/home/u' })
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }))
  on('agent.register', ($: any, e: any) => ({ value: { agent: `issue-forge:${e.name}` } }))
  on('ui.open', ($: any, e: any) => (world.opened.push(e.id), { value: { isPlaced: world.isPlaced } }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', ($: any, e: any) => (world.toasts.push(e.text ?? String(e)), { value: undefined }))
  on('turn.complete', ($: any, e: any) => ({ text: e.answer }))
  on('prompt.submit', ($: any, e: any) => ({ text: e.text }))
  on('tool.call', { tool: 'Bash' }, ($: any, e: any) => (world.beneath.push(e.agentId ?? 'main'), { result: 'ran' }))
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
  on('fs.exists', ($: any, e: any) => ({ value: (e.path === profilePath && world.hasProfile) || e.path in world.files }))
  on('fs.read', ($: any, e: any) => {
    if (e.path === profilePath && world.hasProfile) return { value: JSON.stringify(PROFILE) }
    if (e.path === LCOV_PATH) return { value: LCOV }
    return { deny: 'ENOENT' }
  })
  on('fs.stat', ($: any, e: any) => (e.path === LCOV_PATH ? { value: { kind: 'file', size: LCOV.length, mtimeMs: world.clock.now(), isLink: false } } : { deny: 'ENOENT' }))
  on('fs.write', ($: any, e: any) => ((world.files[e.path] = e.text), { value: undefined }))
  on('process.run', ($: any, e: any) => {
    const argv = e.argv as string[]
    world.argv.push(argv)
    const [cmd, ...a] = argv
    const s = a.join(' ')
    if (cmd === 't') return world.testsExit === 0 ? ok('all pass') : fail('1 failing: expected 2, got undefined', world.testsExit)
    if (cmd === 'c') return ok('coverage written')
    if (cmd === 'sh') return ok('/usr/bin/x')
    if (cmd === 'gh') {
      if (s === 'auth status') return ok()
      if (a[0] === 'issue') return ok(JSON.stringify({ ...ISSUE, body: world.issueBody }))
      if (a[0] === 'pr') return ok('https://github.com/o/r/pull/20\n')
    }
    if (cmd !== 'git') return fail(`unknown ${cmd}`)
    if (s === 'rev-parse --show-toplevel') return world.isRepo ? ok(`${ROOT}\n`) : fail('fatal: not a git repository', 128)
    if (s === 'rev-parse --abbrev-ref HEAD') return ok(`${world.head}\n`)
    if (s === 'rev-parse HEAD') return ok(`c${world.commits.length}\n`)
    if (s === 'status --porcelain') return ok(world.isDirty ? ' M src/a.ts\n' : '')
    if (a[0] === 'switch') return (world.head = a[3] ?? ''), ok()
    if (a[0] === 'merge-base') return ok('base0\n')
    if (a[0] === 'rev-list') return ok(`${world.commits.length}\n`)
    if (s === 'diff --cached --quiet') return world.hasChanges ? fail('', 1) : ok()
    if (s === 'diff --cached --name-only -z base0') return ok(world.staged.join('\0'))
    if (a[0] === 'diff' && a[1] === '--cached' && a[2] === '--name-only') return ok(world.sinceRed.join('\0'))
    if (a[0] === 'diff' && a[1] === '--name-only') return ok(world.redPaths.join('\0'))
    if (s === 'diff -U0 --cached base0') return ok(DIFF)
    if (a[0] === 'commit') return world.commits.push(e.init?.stdin ?? ''), ok()
    return ok()
  })
  return world
}

async function start($: any) {
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: ROOT })
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
    expect(text).toContain('[ Next state ] steps through empty, running, gate, failed, blocked, interrupted, ready, done')
    const copy: [string, RegExp][] = [
      ['empty', /No run here\. \/issue-forge <issue number> starts one/],
      ['running', /attempt 1\/3 · agent working/],
      ['gate', /gate G · running tests/],
      ['failed', /gate G: diff branch 91\.30% < 95/],
      ['blocked', /blocked at baseline: tests fail before any change/],
      ['interrupted', /interrupted during green; \/issue-forge resume restarts it/],
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
    expect(await ui.find({ type: 'Text', text: /demo · empty \(1\/8\)/ })).toBeDefined()
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

  test('a dirty tree blocks at preflight, creates no branch, and a second start answers with the active run', async ($, on) => {
    const w = engine(on, { isDirty: true })
    await start($)
    expect((await run($, '#16')).text).toContain('starting #16')
    await until(w, () => w.toasts.some(t => t.includes('blocked')), 'the block')
    expect(w.toasts).toContain('#16 blocked: the working tree has changes')
    expect(w.argv.some(a => a[0] === 'git' && a[1] === 'switch')).toBe(false)
    const ui = await pane($)
    expect(await ui.find({ type: 'Text', text: /✕ blocked at preflight: the working tree has changes/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /next: commit or stash them, then \/issue-forge resume/ })).toBeDefined()
    await ui.unmount()
    const again = (await run($, '17')).text ?? ''
    expect(again).toContain('a run is already active here.')
    expect(again).toContain('blocked at preflight')
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
    const w = engine(on, { head: BRANCH, testsExit: 1, staged: ['tests/a.test.ts', 'src/a.ts'] }, { [`issue-forge:run:${ROOT}`]: storedRun('gateR', { redCommit: undefined, used: { red: 1, green: 0, refactor: 0 }, agents: [] }) })
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
    expect((await run($, 'status')).text).toContain(`blocked at publishing: ${BRANCH} moved after gate F (HEAD c0, checked f1)`)
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
    expect(w.spawned[0]).toMatchObject({ subagentType: 'issue-forge:green', name: 'issue-forge-16-green-1' })
    expect((await run($, 'stop')).text).toContain('its agents are refused further tool calls')
    expect((await run($, 'status')).text).toContain('stopped; the branch and its commits are kept')
    expect(((await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'old-green' } as never)) as any).deny).toContain('issue-forge:')
  })
})

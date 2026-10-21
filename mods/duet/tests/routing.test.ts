import { describe, expect, mock, test } from 'claude-code/testing'
import { BLANKED, PASSED_THROUGH } from './env-names'

const OK_JSONL = [
  '{"type":"thread.started","thread_id":"t1"}',
  '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"Found 3 callers."}}',
  '{"type":"turn.completed","usage":{"input_tokens":1000,"cached_input_tokens":200,"output_tokens":50,"reasoning_output_tokens":0}}',
].join('\n')

const EXPLORER = `---
name: code-explorer
description: Read-only codebase investigator.
tools: Read, Grep, Glob
---

You are a read-only code explorer.`

const DATA = '/home/u/.claude/duet-data'
/** The shared log that sessions wrote before each kept its own. */
const LEGACY_LOG = `${DATA}/runs.jsonl`
const logOf = (session: string) => `${DATA}/sessions/${session}/runs.jsonl`
const runLine = (provider: 'codex' | 'claude', type: string, id = 'x') =>
  JSON.stringify({ id, at: 0, provider, kind: 'agent', type, model: '', ms: 1000, tokens: 100, ok: true }) + '\n'

type Seen = { argv: string[][]; stdin: string[]; env: Record<string, string>[]; asked: number; questions: string[]; toasts: string[]; beneath: number; files: Record<string, string>; reads: string[]; listed: string[]; mtimes: Record<string, number>; registered: { name: string; description: string }[]; submitted: string[]; dropped: string[]; maxReads: number; timeouts: (number | undefined)[]; clock: any }

/** Stubs every `$` call the routing path makes; nothing else sits beneath the mod. */
function engine(on: any, o: { answer?: string; codex?: 'ok' | 'missing' | 'fail'; agents?: Record<string, string>; beneath?: unknown; env?: Record<string, string>; real?: Record<string, string | null>; kinds?: Record<string, 'file' | 'dir' | 'other'>; gitDirs?: string; oldGit?: boolean; denyEnv?: string; cwd?: string; top?: string | null; gitAt?: string[]; links?: string[]; unreadable?: string[]; flaky?: string[]; hold?: (path: string) => number; askDeny?: string; noAsk?: boolean; askHold?: Promise<void>; codexHold?: Promise<void>; onCodex?: () => void; noSessionId?: boolean; missingText?: string; logGate?: Promise<void>; drops?: string[]; dirty?: string; gitFailAfterCodex?: boolean } = {}): Seen {
  const seen: Seen = { argv: [], stdin: [], env: [], asked: 0, questions: [], toasts: [], beneath: 0, files: { ...(o.agents ?? {}) }, reads: [], listed: [], mtimes: {}, registered: [], submitted: [], dropped: [], maxReads: 0, timeouts: [], clock: null }
  seen.clock = mock.clock(on)
  on('agent.register', ($: any, e: any) => (seen.registered.push({ name: e.name, description: e.description }), { value: { agent: `duet:${e.name}` } }))
  // A drop answers the prompt in Claude Code's place while o.drops lasts, as after Stop (#119).
  on('prompt.submit', ($: any, e: any) => (o.drops?.length ? (seen.dropped.push(e.text), { drop: o.drops.shift() }) : (seen.submitted.push(e.text), { text: e.text })))
  on('turn.complete', ($: any, e: any) => ({ text: e.answer, usage: e.usage }))
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }))
  // `cwd`: where the session started, below the repository root unless it is the root itself.
  on('session.cwd', () => ({ value: o.cwd ?? '/w' }))
  // `noSessionId`: the id can't be read, as when the engine rejects `$.session.id()`.
  on('session.id', () => (o.noSessionId ? { deny: 'no session id' } : { value: 's1' }))
  // `denyEnv`, read at call time: that variable's lookup fails, as a broken engine call would.
  on('env.get', ($: any, e: any) => (o.denyEnv === e.name ? { deny: 'env unavailable' } : { value: (o.env ?? { HOME: '/home/u' })[e.name] }))
  // `hold`: a read stays in flight for that many promise turns, and `maxReads` counts the most in flight at once.
  // `missingText`: what reading a missing file rejects with, for an engine that words it without ENOENT.
  // `logGate`: a read of a run log (runs.jsonl) takes what the file holds when it starts, then answers once that promise settles.
  let reading = 0
  const failedOnce = new Set<string>()
  on('fs.read', ($: any, e: any) => {
    seen.reads.push(e.path)
    const text = seen.files[e.path]
    // `unreadable` paths are listed but can't be read, as a file without read permission; a `flaky` path's first read
    // fails as one past the process's open-file limit does, and later reads succeed.
    const isFlaky = o.flaky?.includes(e.path) && !failedOnce.has(e.path)
    if (isFlaky) failedOnce.add(e.path)
    const answer = text === undefined ? { deny: o.missingText ?? 'ENOENT: no such file' } : o.unreadable?.includes(e.path) ? { deny: 'EACCES: permission denied' } : isFlaky ? { deny: 'EMFILE: too many open files' } : { value: text }
    if (o.logGate && String(e.path).endsWith('/runs.jsonl')) return o.logGate.then(() => answer)
    if (!o.hold) return answer
    reading++
    seen.maxReads = Math.max(seen.maxReads, reading)
    return (async () => {
      for (let turn = 0; turn < o.hold!(e.path); turn++) await Promise.resolve()
      reading--
      return answer
    })()
  })
  on('fs.write', ($: any, e: any) => ((seen.files[e.path] = e.text), { value: undefined }))
  // A folder lists what the same path map holds below it: a file (its time from `mtimes`, else 1), or a folder for a deeper path;
  // `links` are listed as symbolic links (`other`, `isLink`), as the engine lists them; fs.stat says what each leads to.
  // A folder with nothing below it is not there.
  on('fs.list', ($: any, e: any) => {
    const dir = String(e.path).replace(/\/+$/, '')
    seen.listed.push(dir)
    const entries = new Map<string, { name: string; kind: 'file' | 'dir' | 'other'; size: number; mtimeMs: number; isLink: boolean }>()
    for (const [path, text] of Object.entries(seen.files)) {
      if (!path.startsWith(`${dir}/`)) continue
      const [name = '', ...deeper] = path.slice(dir.length + 1).split('/')
      const child = `${dir}/${name}`
      if (entries.has(name)) continue
      if (o.links?.includes(child)) entries.set(name, { name, kind: 'other', size: 0, mtimeMs: 0, isLink: true })
      else if (deeper.length) entries.set(name, { name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false })
      else entries.set(name, { name, kind: 'file', size: text.length, mtimeMs: seen.mtimes[path] ?? 1, isLink: false })
    }
    return entries.size ? { value: [...entries.values()] } : { deny: 'ENOENT: no such directory' }
  })
  // Every path is a folder at its own spelling unless `real` says where it lands (null: not there); a codex binary or
  // codex.js is a file. `kinds` overrides the kind by the path asked for.
  on('fs.stat', ($: any, e: any) => {
    const real = o.real && e.path in o.real ? o.real[e.path] : e.path
    if (real === null) return { deny: 'ENOENT: no such file' }
    const kind = o.kinds?.[e.path] ?? (/\/codex(\.js)?$/.test(real) ? 'file' : 'dir')
    return { value: { kind, size: 0, mtimeMs: 0, isLink: real !== e.path, ...(e.resolve ? { realPath: real } : {}) } }
  })
  // A folder holds `.git` when `gitAt` names it, else when it is the repository root `top` (`/w`; none for `top: null`).
  // Any other path exists when the map holds it or something below it.
  on('fs.exists', ($: any, e: any) => {
    const path = String(e.path).replace(/\/+$/, '')
    if (path.endsWith('/.git')) return { value: (o.gitAt ?? (o.top === null ? [] : [o.top ?? '/w'])).includes(path.slice(0, -'/.git'.length)) }
    return { value: Object.keys(seen.files).some(p => p === path || p.startsWith(`${path}/`)) }
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', ($: any, e: any) => (seen.toasts.push(e.text), { value: undefined }))
  on('process.run', ($: any, e: any) => {
    const argv = e.argv as string[]
    // `--git-dir --git-common-dir`: a plain repository's .git sits in the session folder unless `gitDirs` says otherwise.
    // `oldGit`: git before 2.31, which has no --path-format.
    if (argv[0] === 'git' && o.oldGit && argv.some(a => a.startsWith('--path-format'))) return { value: { exitCode: 128, stdout: '', stderr: 'fatal: unknown option', isStdoutTruncated: false, isStderrTruncated: false } }
    if (argv[0] === 'git' && argv.includes('--git-common-dir')) return { value: { exitCode: 0, stdout: `${o.gitDirs ?? '/w/.git\n/w/.git'}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    // `dirty`: what git status prints before Codex runs; `gitFailAfterCodex`: git status exits 128 once Codex has run (#119).
    if (argv[0] === 'git' && argv.includes('status') && o.gitFailAfterCodex && seen.argv.length > 0) return { value: { exitCode: 128, stdout: '', stderr: 'fatal: unable to read index', isStdoutTruncated: false, isStderrTruncated: false } }
    if (argv[0] === 'git' && argv.includes('status') && o.dirty) return { value: { exitCode: 0, stdout: o.dirty, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    if (argv[0] === 'git' && argv.includes('hash-object')) return { value: { exitCode: 0, stdout: argv.slice(argv.indexOf('--') + 1).map((_, i) => `h${i}`).join('\n'), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    if (argv[0] === 'git') return { value: { exitCode: 0, stdout: argv.includes('rev-parse') ? 'abc1234\n' : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    seen.argv.push(argv)
    seen.stdin.push(e.init?.stdin ?? '')
    seen.env.push(e.init?.env ?? {})
    seen.timeouts.push(e.init?.timeoutMs)
    o.onCodex?.()
    if (o.codex === 'missing') return { deny: 'spawn codex ENOENT' }
    if (o.codex === 'fail') return { value: { exitCode: 1, stdout: '', stderr: 'Error: not logged in', isStdoutTruncated: false, isStderrTruncated: false } }
    const ok = { value: { exitCode: 0, stdout: OK_JSONL, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    // `codexHold`: the Codex run stays in flight until that promise settles; `onCodex` fires as it starts.
    return o.codexHold ? o.codexHold.then(() => ok) : ok
  })
  // `askDeny`: the dialog was dismissed (Esc) or a hook denied it, so `$.ui.ask` rejects with `$.ui.ask: no answer (…)`.
  // `noAsk`: there is no AskUserQuestion tool to ask with, as under `claude -p`, so `$.ui.ask` rejects some other way.
  // `askHold`: the dialog stays open until that promise settles.
  on('tool.call', { tool: 'AskUserQuestion' }, ($: any, e: any) => {
    seen.asked++
    if (o.noAsk) throw new Error('no tool named "AskUserQuestion" in this session')
    const q = e.questions[0].question
    seen.questions.push(q)
    const answer = o.askDeny ? { deny: o.askDeny } : { result: { questions: e.questions, answers: { [q]: o.answer ?? 'Yes, send to Codex' } } }
    return o.askHold ? o.askHold.then(() => answer) : answer
  })
  on('tool.call', { tool: 'Agent' }, () => {
    seen.beneath++
    return { result: o.beneath ?? { status: 'completed', agentId: 'a1', content: [{ type: 'text', text: 'from claude' }], prompt: 'p', totalToolUseCount: 1, totalDurationMs: 500, totalTokens: 900, usage: {} } }
  })
  return seen
}

async function start($: any, cwd = '/w') {
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd })
}

const call = (extra: Record<string, unknown> = {}) => ({ tool: 'Agent', description: 'Find callers', prompt: 'List callers of parseConfig.', ...extra })

describe('routing', () => {
  test('a routed type runs on Codex, never beneath, with the footer and a safe argv', { options: { codexAgents: 'general-purpose', codexRunMode: 'wait' } }, async ($, on) => {
    const seen = engine(on)
    await start($)
    const r: any = await $.tool.call(call() as never)
    expect(seen.beneath).toBe(0)
    expect(seen.asked).toBe(1)
    expect(r.text ?? JSON.stringify(r.result)).toContain('Found 3 callers.')
    expect(JSON.stringify(r.result)).toContain('[duet d1 · codex · sandbox read-only · base abc1234')
    const argv = seen.argv[0]!
    expect(argv.slice(0, 2)).toEqual(['codex', 'exec'])
    expect(argv).toContain('approval_policy="never"')
    expect(argv.join(' ')).not.toMatch(/dangerously|approve-for-me/)
    expect(seen.stdin[0]).toContain('Task ID: d1')
    expect(seen.stdin[0]).toContain('List callers of parseConfig.')
    expect(seen.env[0]!.ANTHROPIC_API_KEY).toBe('')
    expect(seen.files[logOf('s1')] ?? '').toContain('"provider":"codex"')
    expect(seen.files[LEGACY_LOG]).toBeUndefined()
  })

  test("a routed call blanks cloud-provider credentials in Codex's env and leaves what Codex needs", { options: { codexAgents: 'general-purpose', codexRunMode: 'wait' } }, async ($, on) => {
    const seen = engine(on)
    await start($)
    await $.tool.call(call() as never)
    const env = seen.env[0]!
    for (const k of BLANKED) expect([k, env[k]]).toEqual([k, ''])
    for (const k of PASSED_THROUGH) expect([k, k in env]).toEqual([k, false])
  })

  test('an unrouted type reaches Claude untouched and is measured', { options: { codexAgents: 'general-purpose' } }, async ($, on) => {
    const seen = engine(on)
    await start($)
    await $.tool.call(call({ subagent_type: 'Plan' }) as never)
    expect(seen.beneath).toBe(1)
    expect(seen.argv.length).toBe(0)
    expect(seen.asked).toBe(0)
  })

  test('declining refuses, and a second routed call is refused without asking again', { options: { codexAgents: '*' } }, async ($, on) => {
    const seen = engine(on, { answer: 'No' })
    await start($)
    const a: any = await $.tool.call(call() as never)
    const b: any = await $.tool.call(call({ subagent_type: 'Explore' }) as never)
    for (const r of [a, b]) expect(r.deny ?? r.text).toMatch(/declined sending this repo to Codex/)
    expect(seen.asked).toBe(1)
    expect(seen.beneath).toBe(0)
    expect(seen.argv.length).toBe(0)
  })

  test('the concurrency limit refuses; it never falls through to Claude', { options: { codexAgents: '*', maxConcurrent: 0 } }, async ($, on) => {
    const seen = engine(on)
    await start($)
    const r: any = await $.tool.call(call() as never)
    expect(r.deny ?? r.text).toMatch(/limit: 0 Codex runs already running/)
    expect(seen.beneath).toBe(0)
  })

  test('codex missing or signed out refuses with the reason', { options: { codexAgents: '*', codexConsent: 'allow', codexRunMode: 'wait' } }, async ($, on) => {
    const seen = engine(on, { codex: 'missing' })
    await start($)
    const r: any = await $.tool.call(call() as never)
    expect(r.deny ?? r.text).toMatch(/codex not found on PATH/)
    expect(seen.asked).toBe(0)
    expect(seen.beneath).toBe(0)
  })

  test('signed out', { options: { codexAgents: '*', codexConsent: 'allow', codexRunMode: 'wait' } }, async ($, on) => {
    engine(on, { codex: 'fail' })
    await start($)
    const r: any = await $.tool.call(call() as never)
    expect(r.deny ?? r.text).toMatch(/codex login/)
  })

  test('calls inside a subagent pass through (depth 1)', { options: { codexAgents: '*' } }, async ($, on) => {
    const seen = engine(on)
    await start($)
    await $.tool.call({ ...call(), agentId: 'sub-1' } as never)
    expect(seen.beneath).toBe(1)
    expect(seen.argv.length).toBe(0)
  })

  test('a custom agent brings its role and clamps workspace-write to read-only', { options: { codexAgents: 'code-explorer', codexSandbox: 'workspace-write', codexConsent: 'allow' } }, async ($, on) => {
    const seen = engine(on, { agents: { '/w/.claude/agents/code-explorer.md': EXPLORER } })
    await start($)
    // A read-only agent runs in the background by default (codexRunMode), so Codex starts after the call returns (#45).
    const r: any = await $.tool.call(call({ subagent_type: 'code-explorer' }) as never)
    expect(r.result.status).toBe('async_launched')
    await seen.clock.settle()
    expect(seen.beneath).toBe(0)
    expect(seen.stdin[0]).toContain('## Role instructions (code-explorer)')
    expect(seen.stdin[0]).toContain('You are a read-only code explorer.')
    const argv = seen.argv[0]!
    expect(argv[argv.indexOf('-s') + 1]).toBe('read-only')
  })

  test('an editing agent keeps workspace-write when configured', { options: { codexAgents: 'test-writer', codexSandbox: 'workspace-write', codexConsent: 'allow' } }, async ($, on) => {
    const seen = engine(on, { agents: { '/home/u/.claude/agents/test-writer.md': '---\nname: test-writer\ndescription: Writes tests.\ntools: Read, Write, Edit, Bash\n---\nWrite tests.' } })
    await start($)
    await $.tool.call(call({ subagent_type: 'test-writer' }) as never)
    const argv = seen.argv[0]!
    expect(argv[argv.indexOf('-s') + 1]).toBe('workspace-write')
    expect(seen.stdin[0]).toContain('Write tests.')
  })

  test('with no HOME, a user-level agent is found under USERPROFILE', { options: { codexAgents: 'test-writer', codexSandbox: 'workspace-write', codexConsent: 'allow' } }, async ($, on) => {
    const seen = engine(on, { env: { USERPROFILE: '/users/u' }, agents: { '/users/u/.claude/agents/test-writer.md': '---\nname: test-writer\ndescription: Writes tests.\ntools: Read, Write, Edit\n---\nWrite tests.' } })
    await start($)
    await $.tool.call(call({ subagent_type: 'test-writer' }) as never)
    const argv = seen.argv[0]!
    expect(argv[argv.indexOf('-s') + 1]).toBe('workspace-write')
    expect(seen.stdin[0]).toContain('## Role instructions (test-writer)')
  })
})

describe('0.2.0: roles, background runs, honest routing', () => {
  test('the diagnosis: with codexAgents *, a named call stays on Claude', { options: { codexAgents: '*' } }, async ($, on) => {
    const seen = engine(on)
    await start($)
    await $.tool.call(call({ name: 'model-probe-1' }) as never)
    expect(seen.beneath).toBe(1)
    expect(seen.argv.length).toBe(0)
    expect(seen.asked).toBe(0)
  })

  test('a duet: role goes to Codex even when named, with its role instructions, read-only', { options: { codexAgents: '', codexSandbox: 'workspace-write', codexConsent: 'allow', codexRunMode: 'background, reviewer=wait' } }, async ($, on) => {
    const seen = engine(on)
    await start($)
    const r: any = await $.tool.call(call({ subagent_type: 'duet:codex-reviewer', name: 'rev' }) as never)
    expect(seen.beneath).toBe(0)
    expect(r.result.status).toBe('completed')
    expect(seen.stdin[0]).toContain('## Role instructions (duet:codex-reviewer)')
    expect(seen.stdin[0]).toContain('You are an adversarial reviewer.')
    const argv = seen.argv[0]!
    expect(argv[argv.indexOf('-s') + 1]).toBe('read-only')
  })

  test('a duet: role is refused from inside a subagent or isolated, and never reaches Claude', { options: { codexConsent: 'allow' } }, async ($, on) => {
    const seen = engine(on)
    await start($)
    const nested: any = await $.tool.call(call({ subagent_type: 'duet:codex-advisor', agentId: 'sub-1' }) as never)
    const isolated: any = await $.tool.call(call({ subagent_type: 'duet:codex-advisor', isolation: 'worktree' }) as never)
    expect(nested.deny ?? nested.text).toMatch(/only from the main session/)
    expect(isolated.deny ?? isolated.text).toMatch(/can't run isolated/)
    expect(seen.beneath).toBe(0)
    expect(seen.argv.length).toBe(0)
  })

  test('session.start registers the roles; their descriptions say how they answer', { options: {} }, async ($, on) => {
    const seen = engine(on)
    await start($)
    expect(seen.registered.map(r => r.name)).toEqual(['codex-advisor', 'codex-reviewer'])
    expect(seen.registered[0]!.description).toContain('Claude waits for its answer')
    expect(seen.registered[1]!.description).toContain('Answers in the background')
  })

  test('the implementer is registered only under workspace-write; an override changes a description', { options: { codexSandbox: 'workspace-write', codexRunMode: 'wait, advisor=background' } }, async ($, on) => {
    const seen = engine(on)
    await start($)
    expect(seen.registered.map(r => r.name)).toEqual(['codex-advisor', 'codex-reviewer', 'codex-implementer'])
    expect(seen.registered[0]!.description).toContain('Answers in the background')
    expect(seen.registered[2]!.description).toContain('Claude waits for its answer')
  })

  test('a background run answers async_launched at once, then delivers its answer as a prompt', { options: { codexConsent: 'allow' } }, async ($, on) => {
    const seen = engine(on)
    await start($)
    const r: any = await $.tool.call(call({ subagent_type: 'duet:codex-reviewer' }) as never)
    expect(r.result.status).toBe('async_launched')
    expect(r.result.agentId).toBe('duet-d1')
    expect(r.result.outputFile).toBe('/home/u/.claude/duet-data/sessions/s1/d1.out.md')
    expect(r.result.canContinueAgent).toBe(false)
    expect(seen.beneath).toBe(0)
    await seen.clock.settle()
    expect(seen.submitted.length).toBe(1)
    expect(seen.submitted[0]).toContain('Background agent duet-d1 (duet:codex-reviewer) finished on Codex')
    expect(seen.submitted[0]).toContain('Found 3 callers.')
    expect(seen.submitted[0]).toContain('[duet d1 · codex · sandbox read-only · base abc1234 · read-only run: no files changed')
    expect(seen.files['/home/u/.claude/duet-data/sessions/s1/d1.out.md']).toContain('Found 3 callers.')
  })

  test('a failed background run is delivered as a failure, never quietly', { options: { codexConsent: 'allow' } }, async ($, on) => {
    const seen = engine(on, { codex: 'missing' })
    await start($)
    const r: any = await $.tool.call(call({ subagent_type: 'duet:codex-reviewer' }) as never)
    expect(r.result.status).toBe('async_launched')
    await seen.clock.settle()
    expect(seen.submitted[0]).toMatch(/duet-d1 \(duet:codex-reviewer\) failed on Codex: codex not found on PATH.*did not run on Claude either/)
  })

  test('roles wait or not by default: advisor waits, reviewer is background', { options: { codexConsent: 'allow' } }, async ($, on) => {
    const seen = engine(on)
    await start($)
    const advisor: any = await $.tool.call(call({ subagent_type: 'duet:codex-advisor' }) as never)
    const reviewer: any = await $.tool.call(call({ subagent_type: 'duet:codex-reviewer' }) as never)
    expect(advisor.result.status).toBe('completed')
    expect(reviewer.result.status).toBe('async_launched')
    await seen.clock.settle()
  })

  test('a waited record says it cannot be messaged', { options: { codexAgents: 'general-purpose', codexConsent: 'allow', codexRunMode: 'wait' } }, async ($, on) => {
    engine(on)
    await start($)
    const r: any = await $.tool.call(call() as never)
    expect(r.result.canContinueAgent).toBe(false)
    expect(JSON.stringify(r.result)).toContain('one-shot run: start a new duet task to follow up')
  })

  test('an editing run always waits, even in background mode', { options: { codexAgents: 'test-writer', codexSandbox: 'workspace-write', codexConsent: 'allow', codexRunMode: 'background' } }, async ($, on) => {
    const seen = engine(on, { agents: { '/w/.claude/agents/test-writer.md': '---\nname: test-writer\ndescription: Writes tests.\ntools: Read, Write, Edit\n---\nWrite tests.' } })
    await start($)
    const r: any = await $.tool.call(call({ subagent_type: 'test-writer' }) as never)
    expect(r.result.status).toBe('completed')
    expect(seen.submitted.length).toBe(0)
  })

  test('a background Claude subagent is measured at its first finished turn, once', { options: { codexAgents: '' } }, async ($, on) => {
    const seen = engine(on, { beneath: { status: 'async_launched', agentId: 'a9', description: 'Map auth', prompt: 'p', outputFile: '/tmp/a9' } })
    await start($)
    await $.tool.call(call({ subagent_type: 'Explore' }) as never)
    await seen.clock.settle()
    const usage = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 30, cache_creation_input_tokens: 0, model: 'claude-x' }
    const turn = { answer: 'done', durationMs: 900, isAborted: false, turnId: 't1', agentId: 'a9', reason: 'answer', usage }
    await ($ as any).turn.complete(turn)
    await ($ as any).turn.complete({ ...turn, turnId: 't2' })
    await seen.clock.settle()
    expect(seen.files[LEGACY_LOG]).toBeUndefined()
    const rows = (seen.files[logOf('s1')] ?? '').split('\n').filter(Boolean).map(l => JSON.parse(l))
    expect(rows.length).toBe(1)
    expect(rows[0].provider).toBe('claude')
    expect(rows[0].type).toBe('Explore')
    expect(rows[0].tokens).toBe(150)
    expect(rows[0].ok).toBe(true)
  })
})

describe('review admission', () => {
  test('a review counts against maxConcurrent, so at the limit it is refused and Codex never runs', { options: { maxConcurrent: 0, codexConsent: 'allow' } }, async ($: any, on: any) => {
    const seen = engine(on)
    await start($)
    await $.command.run({ command: 'duet', args: 'review', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
    await seen.clock.advance(1000)
    expect(seen.argv).toEqual([])
  })

  test("a review blanks cloud-provider credentials in Codex's env and leaves what Codex needs", { options: { codexConsent: 'allow' } }, async ($: any, on: any) => {
    const seen = engine(on)
    await start($)
    await $.command.run({ command: 'duet', args: 'review', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
    await seen.clock.advance(1000)
    expect(seen.argv[0]!.slice(0, 3)).toEqual(['codex', 'exec', 'review'])
    const env = seen.env[0]!
    for (const k of BLANKED) expect([k, env[k]]).toEqual([k, ''])
    for (const k of PASSED_THROUGH) expect([k, k in env]).toEqual([k, false])
  })

  test('a review that fails after it was admitted ends as error and frees its slot, so the next review runs (PR #39 review round 2)', { options: { codexConsent: 'allow', maxConcurrent: 1, codexFsScope: 'project' } }, async ($: any, on: any) => {
    const o: { denyEnv?: string } = {}
    const seen = engine(on, o)
    await start($)
    o.denyEnv = 'HOME'
    await $.command.run({ command: 'duet', args: 'review', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
    await seen.clock.advance(1000)
    expect(seen.argv).toEqual([])
    o.denyEnv = undefined
    await $.command.run({ command: 'duet', args: 'review', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
    await seen.clock.advance(1000)
    expect(seen.argv.length).toBe(1)
    expect(seen.argv[0]!.slice(0, 3)).toEqual(['codex', 'exec', 'review'])
  })

  test('overlapping reviews at maxConcurrent 1: each refusal takes its own row id, the running review keeps d1, and only one Codex process starts (PR #1: 6148aa6, 56c0832)', { options: { maxConcurrent: 1, codexConsent: 'allow' } }, async ($: any, on: any) => {
    const LIMIT = 'limit: 1 Codex run already running (maxConcurrent 1)'
    let release!: () => void
    let begun!: () => void
    const started = new Promise<void>(resolve => (begun = resolve))
    const seen = engine(on, { codexHold: new Promise<void>(resolve => (release = resolve)), onCodex: begun })
    await start($)
    const review = () => $.command.run({ command: 'duet', args: 'review', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
    const pane = () => $.ui.mount({ plugin: 'duet', surface: 'terminal', component: 'Pane', requestId: 'duet', props: { title: 'Duet', isFocused: true, bodyColumns: 76, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} }, viewport: { columns: 120, rows: 40 } })
    try {
      // Which of the two is admitted is the engine's order; one starts and one is refused either way.
      const answers = (await Promise.all([review(), review()])).map(r => r.text)
      await started
      await seen.clock.settle()
      // The process count and the toasts come first: they are what 6148aa6 and 56c0832 fixed. Hooks from before #5 also
      // answer "started" for a refused review, which the answer checks below would report instead.
      expect(seen.argv.length).toBe(1)
      expect(seen.toasts).toEqual([`d2 review refused: ${LIMIT}`])
      const third = await review()
      await seen.clock.settle()
      expect(seen.argv.length).toBe(1)
      expect(seen.toasts).toEqual([`d2 review refused: ${LIMIT}`, `d3 review refused: ${LIMIT}`])
      expect(answers.filter(text => /^Codex review started/.test(text)).length).toBe(1)
      expect(answers.filter(text => text.includes(`Codex review not started: ${LIMIT}`)).length).toBe(1)
      expect(third.text).toContain(`Codex review not started: ${LIMIT}`)
      // The running review keeps its own row; the refusals are rows of their own.
      const ui = await pane()
      const rows = {
        d1: await ui.find({ type: 'Text', text: /d1\s+codex\s.*running/ }),
        d2: await ui.find({ type: 'Text', text: /d2\s+codex\s.*refused/ }),
        d3: await ui.find({ type: 'Text', text: /d3\s+codex\s.*refused/ }),
      }
      await ui.unmount()
      expect(rows.d1).toBeDefined()
      expect(rows.d2).toBeDefined()
      expect(rows.d3).toBeDefined()
    } finally {
      release()
    }
    await seen.clock.settle()
    expect(seen.argv.length).toBe(1)
  })
})

describe('issue 5: /duet review answers for what happened', () => {
  const review = ($: any) => $.command.run({ command: 'duet', args: 'review', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })

  test('at the concurrency limit the answer says not started and names the limit; Codex never runs and the refusal toast stays', { options: { maxConcurrent: 0, codexConsent: 'allow' } }, async ($: any, on: any) => {
    const seen = engine(on)
    await start($)
    const { text } = await review($)
    await seen.clock.advance(1000)
    expect(text).toMatch(/^Codex review not started: limit: 0 Codex runs already running \(maxConcurrent 0\)/)
    expect(text).not.toMatch(/review started/)
    expect(seen.argv).toEqual([])
    expect(seen.toasts).toEqual(['d1 review refused: limit: 0 Codex runs already running (maxConcurrent 0)'])
  })

  test('a declined consent answers not started with the decline reason; Codex never runs and the refusal toast stays', { options: { codexConsent: 'ask' } }, async ($: any, on: any) => {
    const seen = engine(on, { answer: 'No' })
    await start($)
    const { text } = await review($)
    await seen.clock.advance(1000)
    expect(text).toMatch(/^Codex review not started: you declined sending this repo to Codex this session/)
    expect(text).not.toMatch(/review started/)
    expect(seen.asked).toBe(1)
    expect(seen.argv).toEqual([])
    expect(seen.toasts).toEqual(['d1 review refused: you declined sending this repo to Codex this session'])
  })

  test('with nobody to ask (claude -p) the answer says not started and why; Codex never runs and the refusal toast stays', { options: { codexConsent: 'ask' } }, async ($: any, on: any) => {
    const seen = engine(on, { noAsk: true })
    await start($)
    const { text } = await review($)
    await seen.clock.advance(1000)
    expect(text).toMatch(/^Codex review not started: nobody could be asked to allow sending this repo to Codex \(set duet codexConsent to allow for headless runs\)/)
    expect(text).not.toMatch(/review started/)
    expect(seen.asked).toBe(1)
    expect(seen.argv).toEqual([])
    expect(seen.toasts).toHaveLength(1)
    expect(seen.toasts[0]).toMatch(/^d1 review refused: nobody could be asked to allow sending this repo to Codex/)
  })

  test('the command answers only after the consent dialog does: it waits while the dialog is open, then says started and Codex runs', { options: { codexConsent: 'ask' } }, async ($: any, on: any) => {
    let release!: () => void
    const held = new Promise<void>(resolve => (release = resolve))
    const seen = engine(on, { askHold: held })
    await start($)
    let answered = false
    const running = review($).then((r: any) => ((answered = true), r))
    try {
      await seen.clock.advance(1000)
      expect(seen.asked).toBe(1)
      expect(answered).toBe(false)
    } finally {
      release()
    }
    const { text } = await running
    expect(text).toMatch(/^Codex review started \(read-only\)/)
    await seen.clock.advance(1000)
    expect(seen.argv).toHaveLength(1)
    expect(seen.argv[0]!.slice(0, 3)).toEqual(['codex', 'exec', 'review'])
  })
})

describe('PR #52 review: a dismissed consent dialog says so', () => {
  const review = ($: any) => $.command.run({ command: 'duet', args: 'review', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  const ESC = "The user doesn't want to proceed with this tool use. The tool use was rejected"

  test('Esc on the consent dialog answers not started because it was dismissed, not because nobody could be asked; Codex never runs and the next review asks again', { options: { codexConsent: 'ask' } }, async ($: any, on: any) => {
    const seen = engine(on, { askDeny: ESC })
    await start($)
    const first = await review($)
    await seen.clock.advance(1000)
    expect(first.text).toBe('Codex review not started: the consent question was dismissed; it is asked again next time')
    expect(seen.toasts[0]).toMatch(/^d1 review refused: the consent question was dismissed/)
    const second = await review($)
    expect(second.text).toBe(first.text)
    expect(seen.asked).toBe(2)
    expect(seen.argv).toEqual([])
  })
})

describe('PR #52 review: the allowed case and the pane button go through the same gate', () => {
  const review = ($: any) => $.command.run({ command: 'duet', args: 'review', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  const pane = ($: any) => $.ui.mount({ plugin: 'duet', surface: 'terminal', component: 'Pane', requestId: 'duet', props: { title: 'Duet', isFocused: true, bodyColumns: 76, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} }, viewport: { columns: 120, rows: 40 } })

  test('with codexConsent allow nobody is asked, the answer says started and Codex runs', { options: { codexConsent: 'allow' } }, async ($: any, on: any) => {
    const seen = engine(on)
    await start($)
    const { text } = await review($)
    expect(text).toMatch(/^Codex review started \(read-only\)/)
    await seen.clock.advance(1000)
    expect(seen.asked).toBe(0)
    expect(seen.argv).toHaveLength(1)
    expect(seen.argv[0]!.slice(0, 3)).toEqual(['codex', 'exec', 'review'])
  })

  test('the pane\'s Review diff button is refused at the limit with the same toast, and Codex never runs', { options: { maxConcurrent: 0, codexConsent: 'allow' } }, async ($: any, on: any) => {
    const seen = engine(on)
    await start($)
    const ui = await pane($)
    await ui.press({ key: 'review' })
    await seen.clock.advance(1000)
    await ui.unmount()
    expect(seen.argv).toEqual([])
    expect(seen.toasts).toEqual(['d1 review refused: limit: 0 Codex runs already running (maxConcurrent 0)'])
  })

  test('the pane\'s Review diff button asks for consent, then runs Codex on the uncommitted changes', { options: { codexConsent: 'ask' } }, async ($: any, on: any) => {
    const seen = engine(on)
    await start($)
    const ui = await pane($)
    await ui.press({ key: 'review' })
    await seen.clock.advance(1000)
    await ui.unmount()
    expect(seen.asked).toBe(1)
    expect(seen.argv).toHaveLength(1)
    expect(seen.argv[0]).toContain('--uncommitted')
  })
})

describe('issue 3 part B: codexFsScope reaches the Codex runs', () => {
  const WRITER = (name: string) => `---\nname: ${name}\ndescription: Writes files.\ntools: Read, Write, Edit\n---\nWrite files.`
  const agents = {
    '/w/.claude/agents/red-test-writer.md': WRITER('red-test-writer'),
    '/w/.claude/agents/impl-writer.md': WRITER('impl-writer'),
    '/w/.claude/agents/code-explorer.md': EXPLORER,
  }
  const scoped = { codexAgents: 'red-test-writer, impl-writer, code-explorer', codexSandbox: 'workspace-write', codexFsScope: 'project', codexWritePaths: 'red-test-writer=tests;test', codexConsent: 'allow', codexRunMode: 'wait' }
  // These find duet's profile whether or not its name carries a per-run nonce; the nonce test checks the name itself.
  const filesystem = (argv: string[]) => argv.find(a => /^permissions\.duet-mod-fs-scope(-[A-Za-z0-9]+)?\.filesystem=/.test(a)) ?? ''
  const namesProfile = (argv: string[]) => argv.some(a => /^default_permissions="duet-mod-fs-scope(-[A-Za-z0-9]+)?"$/.test(a))
  const pair = (path: string, access: 'read' | 'write') => `${JSON.stringify(path)}="${access}"`

  test('an agent named in codexWritePaths may write only those folders; the rest of the project and the Codex install folder are read', { options: scoped }, async ($, on) => {
    const seen = engine(on, { agents })
    await start($)
    await $.tool.call(call({ subagent_type: 'red-test-writer' }) as never)
    const argv = seen.argv[0]!
    expect(argv[argv.indexOf('sandbox_mode="workspace-write"') - 1]).toBe('-c')
    expect(argv).not.toContain('-s')
    expect(namesProfile(argv)).toBe(true)
    const fs = filesystem(argv)
    expect(fs).toContain(pair('/w', 'read'))
    expect(fs).toContain(pair('/w/tests', 'write'))
    expect(fs).toContain(pair('/w/test', 'write'))
    expect(fs).toContain(pair('/home/u/.codex/packages', 'read'))
    expect(fs).not.toContain(pair('/w', 'write'))
    expect(fs).not.toContain('/tmp')
  })

  test('an editing agent not named gets the whole project writable; an agent that cannot edit gets it read-only', { options: scoped }, async ($, on) => {
    const seen = engine(on, { agents })
    await start($)
    await $.tool.call(call({ subagent_type: 'impl-writer' }) as never)
    await $.tool.call(call({ subagent_type: 'code-explorer' }) as never)
    const [editing, reading] = seen.argv.map(filesystem)
    expect(editing).toContain(pair('/w', 'write'))
    expect(editing).toContain(pair('/home/u/.codex/packages', 'read'))
    expect(reading).toContain(pair('/w', 'read'))
    expect(reading).not.toContain('="write"')
    expect(seen.argv[1]![seen.argv[1]!.indexOf('sandbox_mode="read-only"') - 1]).toBe('-c')
    expect(seen.argv[1]).not.toContain('-s')
  })

  test('a malformed codexWritePaths leaves every routed agent read-only instead of widening (PR #39 review)', { options: { ...scoped, codexWritePaths: 'red-test-writer:tests' } }, async ($, on) => {
    const seen = engine(on, { agents })
    await start($)
    await $.tool.call(call({ subagent_type: 'red-test-writer' }) as never)
    await $.tool.call(call({ subagent_type: 'impl-writer' }) as never)
    expect(seen.argv.length).toBe(2)
    for (const argv of seen.argv) {
      expect(filesystem(argv)).toContain(pair('/w', 'read'))
      expect(filesystem(argv)).not.toContain('="write"')
    }
  })

  test('a codexWritePaths folder whose real path leaves the project, is the project, or is not there is dropped; one landing inside stays (PR #39 review)', { options: { ...scoped, codexWritePaths: 'red-test-writer=tests;test;spec;self' } }, async ($, on) => {
    const seen = engine(on, { agents, real: { '/w/tests': '/outside/tests', '/w/test': '/w/sub/test', '/w/spec': null, '/w/self': '/w' } })
    await start($)
    await $.tool.call(call({ subagent_type: 'red-test-writer' }) as never)
    const fs = filesystem(seen.argv[0]!)
    expect(fs).toContain(pair('/w', 'read'))
    expect(fs).toContain(pair('/w/test', 'write'))
    for (const gone of ['/w/tests', '/w/spec', '/w/self', '/outside/tests']) expect(fs).not.toContain(JSON.stringify(gone))
    expect(fs).not.toContain(pair('/w', 'write'))
  })

  test('a codexWritePaths folder that is, or links into, .git, .codex or .agents is dropped, so Codex keeps them read-only (PR #39 review round 2)', { options: { ...scoped, codexWritePaths: 'red-test-writer=tests;cfg;skills;.git;src' } }, async ($, on) => {
    const seen = engine(on, { agents, real: { '/w/tests': '/w/.git/hooks', '/w/cfg': '/w/.codex', '/w/skills': '/w/.agents/skills' } })
    await start($)
    await $.tool.call(call({ subagent_type: 'red-test-writer' }) as never)
    const fs = filesystem(seen.argv[0]!)
    expect(fs).toContain(pair('/w/src', 'write'))
    for (const gone of ['/w/tests', '/w/cfg', '/w/skills', '/w/.git']) expect(fs).not.toContain(JSON.stringify(gone))
    expect(fs).not.toContain(pair('/w', 'write'))
  })

  test('a codexWritePaths folder that is dropped (here: not there yet, so Codex could not create it) is named in the result Claude reads (PR #39 review round 2)', { options: { ...scoped, codexWritePaths: 'red-test-writer=tests;src' } }, async ($, on) => {
    const seen = engine(on, { agents, real: { '/w/tests': null } })
    await start($)
    const r: any = await $.tool.call(call({ subagent_type: 'red-test-writer' }) as never)
    expect(filesystem(seen.argv[0]!)).toContain(pair('/w/src', 'write'))
    const text = r.result.content[0].text as string
    expect(text).toContain('not writable: tests')
    expect(text).not.toContain('not writable: tests, src')
  })

  test('in a linked worktree, a routed run and a review can read git\'s own folders, read-only (PR #39 review)', { options: { ...scoped, codexWritePaths: '' } }, async ($, on) => {
    const seen = engine(on, { agents, gitDirs: '/main/.git/worktrees/w\n/main/.git' })
    await start($)
    await $.tool.call(call({ subagent_type: 'impl-writer' }) as never)
    await $.command.run({ command: 'duet', args: 'review', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
    await seen.clock.advance(1000)
    expect(seen.argv.length).toBe(2)
    for (const argv of seen.argv) {
      const fs = filesystem(argv)
      expect(fs).toContain(pair('/main/.git/worktrees/w', 'read'))
      expect(fs).toContain(pair('/main/.git', 'read'))
      expect(fs).not.toContain(pair('/main/.git', 'write'))
    }
    expect(filesystem(seen.argv[0]!)).toContain(pair('/w', 'write'))
  })

  test('on git before 2.31, which has no --path-format, git\'s own folders are still readable; a relative answer is taken from the session folder (PR #39 review round 2)', { options: { ...scoped, codexWritePaths: '' } }, async ($, on) => {
    const seen = engine(on, { agents, gitDirs: '/main/.git/worktrees/w\n../main/.git', oldGit: true })
    await start($)
    await $.tool.call(call({ subagent_type: 'impl-writer' }) as never)
    const fs = filesystem(seen.argv[0]!)
    expect(fs).toContain(pair('/main/.git/worktrees/w', 'read'))
    expect(fs).toContain(pair('/main/.git', 'read'))
  })

  test('the Codex on PATH and CODEX_HOME\'s packages are readable, so Codex can run itself in the sandbox (PR #39 review)', { options: { ...scoped, codexWritePaths: '' } }, async ($, on) => {
    const env = { HOME: '/home/u', PATH: '/usr/bin:/opt/nvm/bin', CODEX_HOME: '/data/codex' }
    const seen = engine(on, { agents, env, real: { '/usr/bin/codex': null, '/opt/nvm/bin/codex': '/opt/nvm/lib/node_modules/@openai/codex/bin/codex.js' } })
    await start($)
    await $.tool.call(call({ subagent_type: 'impl-writer' }) as never)
    const fs = filesystem(seen.argv[0]!)
    expect(fs).toContain(pair('/opt/nvm/lib/node_modules/@openai/codex/bin', 'read'))
    expect(fs).toContain(pair('/data/codex/packages', 'read'))
    expect(fs).not.toContain('/usr/bin')
  })

  test('the PATH lookup skips a codex that is not a file, as the shell would (PR #39 review round 2, Codex 4266372737)', { options: { ...scoped, codexWritePaths: '' } }, async ($, on) => {
    const env = { HOME: '/home/u', PATH: '/a/bin:/opt/codex/bin' }
    const seen = engine(on, { agents, env, kinds: { '/a/bin/codex': 'dir' } })
    await start($)
    await $.tool.call(call({ subagent_type: 'impl-writer' }) as never)
    const fs = filesystem(seen.argv[0]!)
    expect(fs).toContain(pair('/opt/codex/bin', 'read'))
    expect(fs).not.toContain('/a/bin')
  })

  test('a codex in the home folder itself never makes the home folder readable (PR #39 review round 2)', { options: { ...scoped, codexWritePaths: '' } }, async ($, on) => {
    const env = { HOME: '/home/u', PATH: '/home/u:/opt/codex/bin' }
    const seen = engine(on, { agents, env })
    await start($)
    await $.tool.call(call({ subagent_type: 'impl-writer' }) as never)
    const fs = filesystem(seen.argv[0]!)
    expect(fs).not.toContain(pair('/home/u', 'read'))
    expect(fs).toContain(pair('/home/u/.codex/packages', 'read'))
  })

  test('each run and each review gets its own random profile name, so no loaded Codex config can name it and merge in (PR #39 review round 2)', { options: { ...scoped, codexWritePaths: '' } }, async ($, on) => {
    const seen = engine(on, { agents })
    await start($)
    await $.tool.call(call({ subagent_type: 'impl-writer' }) as never)
    await $.tool.call(call({ subagent_type: 'impl-writer' }) as never)
    await $.command.run({ command: 'duet', args: 'review', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
    await seen.clock.advance(1000)
    expect(seen.argv.length).toBe(3)
    const names = seen.argv.map(argv => (argv.find(a => a.startsWith('default_permissions=')) ?? '').slice('default_permissions="'.length, -1))
    expect(new Set(names).size).toBe(3)
    seen.argv.forEach((argv, at) => {
      expect(names[at]).toMatch(/^duet-mod-fs-scope-[A-Za-z0-9]{16,}$/)
      expect(argv.some(a => a.startsWith(`permissions.${names[at]}.filesystem=`))).toBe(true)
    })
  })

  test('a review runs read-only under the same profile, with the session folder as the project', { options: { codexFsScope: 'project', codexConsent: 'allow' } }, async ($: any, on: any) => {
    const seen = engine(on)
    await start($)
    await $.command.run({ command: 'duet', args: 'review', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
    await seen.clock.advance(1000)
    const argv = seen.argv[0]!
    expect(argv.slice(0, 3)).toEqual(['codex', 'exec', 'review'])
    expect(namesProfile(argv)).toBe(true)
    const fs = filesystem(argv)
    expect(fs).toContain(pair('/w', 'read'))
    expect(fs).toContain(pair('/home/u/.codex/packages', 'read'))
    expect(fs).not.toContain('="write"')
    expect(argv).toContain('sandbox_mode="read-only"')
  })
})

describe('issue 4: a custom agent is found by Claude\'s discovery rules', () => {
  // The session starts in /w/pkg, inside the repository whose root is /w.
  const IN = '/w/pkg'
  const options = { codexAgents: 'editor, writer, reader, outsider, general-purpose, ghost', codexSandbox: 'workspace-write', codexConsent: 'allow', codexRunMode: 'wait' }
  const agent = (name: string, tools: string, body: string) => `---\nname: ${name}\ndescription: An agent.\ntools: ${tools}\n---\n\n${body}`
  const EDITS = 'Read, Write, Edit'
  const READS = 'Read, Grep'
  const sandboxOf = (argv: string[] | undefined) => argv?.[argv.indexOf('-s') + 1]
  const asks = ($: any, type: string) => $.tool.call(call({ subagent_type: type }) as never)

  test('an editing agent in an ancestor folder keeps workspace-write and sends its instructions; a miss stays read-only, except general-purpose', { options }, async ($, on) => {
    const seen = engine(on, { cwd: IN, agents: { '/w/.claude/agents/editor.md': agent('editor', EDITS, 'You edit files.') } })
    await start($, IN)
    await asks($, 'editor')
    await asks($, 'ghost')
    await asks($, 'general-purpose')
    expect(sandboxOf(seen.argv[0])).toBe('workspace-write')
    expect(seen.stdin[0]).toContain('## Role instructions (editor)')
    expect(seen.stdin[0]).toContain('You edit files.')
    expect(sandboxOf(seen.argv[1])).toBe('read-only')
    expect(seen.stdin[1]).not.toContain('## Role instructions')
    expect(sandboxOf(seen.argv[2])).toBe('workspace-write')
  })

  test('an editing agent in a subfolder of .claude/agents is found, dot-folders included', { options }, async ($, on) => {
    const seen = engine(on, { cwd: IN, agents: { '/w/pkg/.claude/agents/review/editor.md': agent('editor', EDITS, 'In a subfolder.'), '/w/pkg/.claude/agents/.team/writer.md': agent('writer', EDITS, 'In a dot-folder.') } })
    await start($, IN)
    await asks($, 'editor')
    await asks($, 'writer')
    expect(sandboxOf(seen.argv[0])).toBe('workspace-write')
    expect(seen.stdin[0]).toContain('In a subfolder.')
    expect(sandboxOf(seen.argv[1])).toBe('workspace-write')
    expect(seen.stdin[1]).toContain('In a dot-folder.')
  })

  test('a definition whose name differs from its file name is found by its name', { options }, async ($, on) => {
    const seen = engine(on, { cwd: IN, agents: { '/w/pkg/.claude/agents/ed.md': agent('"editor" # renamed', EDITS, 'Renamed on disk.'), '/w/pkg/.claude/agents/editor.md': agent('someone-else', READS, 'Not this one.') } })
    await start($, IN)
    await asks($, 'editor')
    expect(sandboxOf(seen.argv[0])).toBe('workspace-write')
    expect(seen.stdin[0]).toContain('Renamed on disk.')
    expect(seen.stdin[0]).not.toContain('Not this one.')
  })

  test('a reading agent in an ancestor folder runs read-only and its instructions are sent', { options }, async ($, on) => {
    const seen = engine(on, { cwd: IN, agents: { '/w/.claude/agents/reader.md': agent('reader', READS, 'You only read.') } })
    await start($, IN)
    await asks($, 'reader')
    expect(sandboxOf(seen.argv[0])).toBe('read-only')
    expect(seen.stdin[0]).toContain('## Role instructions (reader)')
    expect(seen.stdin[0]).toContain('You only read.')
  })

  test('a general-purpose.md in an ancestor folder without edit tools makes general-purpose read-only', { options }, async ($, on) => {
    const seen = engine(on, { cwd: IN, agents: { '/w/.claude/agents/general-purpose.md': agent('general-purpose', 'Read', 'Only reads.') } })
    await start($, IN)
    await asks($, 'general-purpose')
    expect(sandboxOf(seen.argv[0])).toBe('read-only')
    expect(seen.stdin[0]).toContain('Only reads.')
  })

  test('the nearest folder wins over an ancestor', { options }, async ($, on) => {
    const seen = engine(on, { cwd: IN, agents: { '/w/pkg/.claude/agents/team/editor.md': agent('editor', EDITS, 'Near.'), '/w/.claude/agents/editor.md': agent('editor', READS, 'Far.') } })
    await start($, IN)
    await asks($, 'editor')
    expect(sandboxOf(seen.argv[0])).toBe('workspace-write')
    expect(seen.stdin[0]).toContain('Near.')
    expect(seen.stdin[0]).not.toContain('Far.')
  })

  test('a project definition wins over the user\'s, and the user\'s folder is searched by name too', { options }, async ($, on) => {
    const seen = engine(on, { cwd: IN, agents: { '/home/u/.claude/agents/editor.md': agent('editor', READS, 'User level.'), '/w/.claude/agents/editor.md': agent('editor', EDITS, 'Project level.'), '/home/u/.claude/agents/mine/ed.md': agent('writer', EDITS, 'Mine.') } })
    await start($, IN)
    await asks($, 'editor')
    await asks($, 'writer')
    expect(sandboxOf(seen.argv[0])).toBe('workspace-write')
    expect(seen.stdin[0]).toContain('Project level.')
    expect(seen.stdin[0]).not.toContain('User level.')
    expect(sandboxOf(seen.argv[1])).toBe('workspace-write')
    expect(seen.stdin[1]).toContain('Mine.')
  })

  test('the search goes up to the repository root and stops there', { options }, async ($, on) => {
    const deep = '/w/pkg/sub'
    const seen = engine(on, { cwd: deep, top: '/w/pkg', agents: { '/w/pkg/.claude/agents/editor.md': agent('editor', EDITS, 'Inside.'), '/w/.claude/agents/outsider.md': agent('outsider', EDITS, 'Above the root.') } })
    await start($, deep)
    await asks($, 'editor')
    await asks($, 'outsider')
    expect(sandboxOf(seen.argv[0])).toBe('workspace-write')
    expect(seen.stdin[0]).toContain('Inside.')
    expect(sandboxOf(seen.argv[1])).toBe('read-only')
    expect(seen.stdin[1]).not.toContain('Above the root.')
  })

  test('with no git repository the search goes up to the filesystem root', { options }, async ($, on) => {
    const seen = engine(on, { cwd: '/a/b/c', top: null, agents: { '/a/.claude/agents/editor.md': agent('editor', EDITS, 'Far up.') } })
    await start($, '/a/b/c')
    await asks($, 'editor')
    expect(sandboxOf(seen.argv[0])).toBe('workspace-write')
    expect(seen.stdin[0]).toContain('Far up.')
  })

  test('a folder holding .git ends the search even when git can\'t read it, as it ends Claude\'s', { options }, async ($, on) => {
    // Probed on 2.1.299: an empty .git folder, or an empty .git file, stops Claude's walk although `git rev-parse` fails there.
    const deep = '/w/pkg/sub'
    const seen = engine(on, { cwd: deep, top: null, gitAt: ['/w/pkg'], agents: { '/w/.claude/agents/outsider.md': agent('outsider', EDITS, 'Above the root.') } })
    await start($, deep)
    await asks($, 'outsider')
    expect(sandboxOf(seen.argv[0])).toBe('read-only')
    expect(seen.stdin[0]).not.toContain('Above the root.')
  })

  test('a session folder reached through a link is still searched up to the repository root', { options }, async ($, on) => {
    // git would answer with the real path (/data/proj); the walk goes by the session folder's own spelling.
    const cwd = '/home/u/link/pkg'
    const seen = engine(on, { cwd, gitAt: ['/home/u/link'], agents: { '/home/u/link/.claude/agents/general-purpose.md': agent('general-purpose', READS, 'Only reads.') } })
    await start($, cwd)
    await asks($, 'general-purpose')
    expect(sandboxOf(seen.argv[0])).toBe('read-only')
    expect(seen.stdin[0]).toContain('Only reads.')
  })

  test('the user folder is searched once when the walk already passed it, whichever separators HOME uses (PR #43 review)', { options }, async ($, on) => {
    // On a POSIX test host the engine places a `C:/` path under its working directory, so a folder is matched by its end.
    const once = (seen: Seen, folder: string) => seen.listed.filter(d => d.replace(/\\/g, '/').endsWith(folder)).length
    const posix = engine(on, { cwd: '/home/u/proj', top: null })
    await start($, '/home/u/proj')
    await asks($, 'editor')
    expect(once(posix, '/home/u/.claude/agents')).toBe(1)
  })

  test('a Windows HOME with backslashes is the same user folder the walk passed', { options }, async ($, on) => {
    const once = (seen: Seen, folder: string) => seen.listed.filter(d => d.replace(/\\/g, '/').endsWith(folder)).length
    const windows = engine(on, { cwd: 'C:/Users/u/proj', top: null, env: { USERPROFILE: 'C:\\Users\\u' } })
    await start($, 'C:/Users/u/proj')
    await asks($, 'editor')
    expect(once(windows, 'C:/Users/u/.claude/agents')).toBe(1)
  })

  test('a symbolic link is followed, as Claude follows it: a linked folder and a linked file are both read', { options }, async ($, on) => {
    // Probed on 2.1.299 and 2.1.300: Claude loads agents through a linked file, a linked subfolder and a linked .claude/agents.
    const linked = '/w/pkg/.claude/agents/shared'
    const file = '/w/pkg/.claude/agents/gp.md'
    const seen = engine(on, { cwd: IN, links: [linked, file], kinds: { [file]: 'file' }, agents: { [`${linked}/editor.md`]: agent('editor', READS, 'Through a link.'), '/w/.claude/agents/editor.md': agent('editor', EDITS, 'Real.'), [file]: agent('general-purpose', READS, 'A linked file.') } })
    await start($, IN)
    await asks($, 'editor')
    await asks($, 'general-purpose')
    expect(sandboxOf(seen.argv[0])).toBe('read-only')
    expect(seen.stdin[0]).toContain('Through a link.')
    expect(seen.stdin[0]).not.toContain('Real.')
    expect(sandboxOf(seen.argv[1])).toBe('read-only')
    expect(seen.stdin[1]).toContain('A linked file.')
  })

  test('a linked folder that leads back to a folder already searched is not searched again', { options }, async ($, on) => {
    const loop = '/w/pkg/.claude/agents/loop'
    const seen = engine(on, { cwd: IN, links: [loop], real: { [loop]: '/w/pkg/.claude/agents' }, agents: { '/w/pkg/.claude/agents/editor.md': agent('editor', READS, 'Once.'), [`${loop}/x.md`]: '' } })
    await start($, IN)
    await asks($, 'editor')
    expect(sandboxOf(seen.argv[0])).toBe('read-only')
    expect(seen.stdin[0]).toContain('Once.')
    expect(seen.listed).not.toContain(loop)
  })

  test('a definition nested more than 8 folders down is not read, so the user-level one is used', { options }, async ($, on) => {
    const tooDeep = '/w/pkg/.claude/agents/a/b/c/d/e/f/g/h/i/j/k/l/editor.md'
    const seen = engine(on, { cwd: IN, agents: { [tooDeep]: agent('editor', READS, 'Too deep.'), '/home/u/.claude/agents/mine/ed.md': agent('editor', EDITS, 'User level.') } })
    await start($, IN)
    await asks($, 'editor')
    // The read-only editor too deep to read may be Claude's pick, so the cut-short search runs read-only (PR #48 review).
    expect(sandboxOf(seen.argv[0])).toBe('read-only')
    expect(seen.stdin[0]).toContain('User level.')
    expect(seen.stdin[0]).not.toContain('Too deep.')
  })

  test('a definition 8 folders down is read and one 9 down is not: duet\'s own cap, since Claude reads deeper (PR #43 review)', { options }, async ($, on) => {
    const eight = '/w/pkg/.claude/agents/1/2/3/4/5/6/7/8'
    const seen = engine(on, { cwd: IN, agents: { [`${eight}/reader.md`]: agent('reader', READS, 'Eight deep.'), [`${eight}/9/editor.md`]: agent('editor', READS, 'Nine deep.'), '/home/u/.claude/agents/editor.md': agent('editor', EDITS, 'User level.') } })
    await start($, IN)
    await asks($, 'reader')
    await asks($, 'editor')
    expect(seen.stdin[0]).toContain('Eight deep.')
    // The 9th folder cut the search short, and the read-only editor there may be Claude's pick: read-only (PR #48 review).
    expect(sandboxOf(seen.argv[1])).toBe('read-only')
    expect(seen.stdin[1]).toContain('User level.')
    expect(seen.reads).not.toContain(`${eight}/9/editor.md`)
  })

  test('a file that can no longer be read is skipped, as Claude skips it, and its cached text is not used (PR #43 review)', { options }, async ($, on) => {
    // Probed on 2.1.299: Claude leaves out an agent file it has no permission to read.
    const near = '/w/pkg/.claude/agents/editor.md'
    const unreadable: string[] = []
    const seen = engine(on, { cwd: IN, unreadable, agents: { [near]: agent('editor', READS, 'Near.'), '/w/.claude/agents/editor.md': agent('editor', EDITS, 'Readable.') } })
    await start($, IN)
    await asks($, 'editor')
    unreadable.push(near)
    seen.mtimes[near] = 2
    await asks($, 'editor')
    expect(seen.argv.map(sandboxOf)).toEqual(['read-only', 'workspace-write'])
    expect(seen.stdin[0]).toContain('Near.')
    expect(seen.stdin[1]).toContain('Readable.')
    expect(seen.stdin[1]).not.toContain('Near.')
  })

  test('only the first 500 files of a root are read, so the 601st does not shadow the user-level definition', { options }, async ($, on) => {
    const agents: Record<string, string> = {}
    for (let i = 0; i < 600; i++) agents[`/w/pkg/.claude/agents/f${String(i).padStart(3, '0')}.md`] = agent(`filler-${i}`, READS, 'Filler.')
    agents['/w/pkg/.claude/agents/zz-editor.md'] = agent('editor', READS, 'Past the limit.')
    agents['/home/u/.claude/agents/mine/ed.md'] = agent('editor', EDITS, 'User level.')
    const seen = engine(on, { cwd: IN, agents })
    await start($, IN)
    await asks($, 'editor')
    // The 500-file limit cut the search short, and the read-only editor past it may be Claude's pick: read-only (PR #48 review).
    expect(sandboxOf(seen.argv[0])).toBe('read-only')
    expect(seen.stdin[0]).toContain('User level.')
    expect(seen.stdin[0]).not.toContain('Past the limit.')
  })

  test('folders are listed on every call: a definition added or removed between two calls is seen at once', { options }, async ($, on) => {
    const seen = engine(on, { cwd: IN })
    await start($, IN)
    const path = '/w/.claude/agents/editor.md'
    await asks($, 'editor')
    seen.files[path] = agent('editor', EDITS, 'Added later.')
    await asks($, 'editor')
    delete seen.files[path]
    await asks($, 'editor')
    expect(seen.argv.map(sandboxOf)).toEqual(['read-only', 'workspace-write', 'read-only'])
    expect(seen.stdin[1]).toContain('Added later.')
  })

  test('a definition is read once while its size and time are unchanged, and again when either changes', { options }, async ($, on) => {
    const path = '/w/.claude/agents/editor.md'
    const seen = engine(on, { cwd: IN, agents: { [path]: agent('editor', 'Read, Grep, Edit', 'Version one.') } })
    await start($, IN)
    const reads = () => seen.reads.filter(p => p === path).length
    await asks($, 'editor')
    await asks($, 'editor')
    expect(reads()).toBe(1)
    expect(seen.argv.map(sandboxOf)).toEqual(['workspace-write', 'workspace-write'])

    // Same size, newer time: Edit becomes Glob, so the agent can no longer edit.
    seen.files[path] = agent('editor', 'Read, Grep, Glob', 'Version one.')
    seen.mtimes[path] = 2
    await asks($, 'editor')
    expect(reads()).toBe(2)
    expect(sandboxOf(seen.argv[2])).toBe('read-only')

    // Same time, different size: it edits again.
    seen.files[path] = agent('editor', 'Read, Write, Edit', 'Version three.')
    await asks($, 'editor')
    expect(reads()).toBe(3)
    expect(sandboxOf(seen.argv[3])).toBe('workspace-write')
    expect(seen.stdin[3]).toContain('Version three.')
  })
})

describe('issue 44: agent discovery follow-ups from the PR #43 review', () => {
  const IN = '/w/pkg'
  const options = { codexAgents: 'editor, writer, reader, general-purpose, ghost', codexSandbox: 'workspace-write', codexConsent: 'allow', codexRunMode: 'wait' }
  const agent = (name: string, tools: string, body: string) => `---\nname: ${name}\ndescription: An agent.\ntools: ${tools}\n---\n\n${body}`
  const EDITS = 'Read, Write, Edit'
  const READS = 'Read, Grep'
  const sandboxOf = (argv: string[] | undefined) => argv?.[argv.indexOf('-s') + 1]
  const asks = ($: any, type: string) => $.tool.call(call({ subagent_type: type }) as never)
  /** The text Claude reads from a foreground run: the answer and the footer. */
  const resultText = async ($: any, type: string): Promise<string> => {
    const r: any = await $.tool.call(call({ subagent_type: type }) as never)
    return (r.result?.content ?? []).map((c: { text?: string }) => c.text ?? '').join('\n')
  }

  test('a folder past the 8-folder limit that holds no .md file, subfolder or link does not cut the search short (PR #48 review)', { options }, async ($, on) => {
    const nine = '/w/pkg/.claude/agents/1/2/3/4/5/6/7/8/9'
    const seen = engine(on, { cwd: IN, agents: { [`${nine}/notes.txt`]: 'Not an agent.', '/home/u/.claude/agents/ed.md': agent('editor', EDITS, 'User level.') } })
    await start($, IN)
    const text = await resultText($, 'editor')
    expect(seen.stdin[0]).toContain('User level.')
    expect(text).not.toMatch(/cut short/i)
    expect(sandboxOf(seen.argv[0])).toBe('workspace-write')
    expect(seen.reads).not.toContain(`${nine}/notes.txt`)
  })

  test('a folder met after the 500th file that holds no .md file, subfolder or link does not cut the search short (PR #48 review)', { options }, async ($, on) => {
    const seen = engine(on, { cwd: IN, agents: { '/w/pkg/.claude/agents/zz/notes.txt': 'Not an agent.', '/home/u/.claude/agents/ed.md': agent('editor', EDITS, 'User level.') } })
    for (let i = 0; i < 500; i++) seen.files[`/w/pkg/.claude/agents/f${String(i).padStart(3, '0')}.md`] = agent(`filler-${i}`, READS, 'Filler.')
    await start($, IN)
    const text = await resultText($, 'editor')
    expect(seen.stdin[0]).toContain('User level.')
    expect(text).not.toMatch(/cut short/i)
    expect(sandboxOf(seen.argv[0])).toBe('workspace-write')
  })

  test('a link past the limit that leads nowhere, to a file not named .md, or back into a searched folder does not cut the search short (PR #48 review)', { options }, async ($, on) => {
    const nine = '/w/pkg/.claude/agents/1/2/3/4/5/6/7/8/9'
    const seen = engine(on, {
      cwd: IN,
      agents: { [`${nine}/gone`]: 'x', [`${nine}/readme.txt`]: 'x', [`${nine}/loop`]: 'x', '/home/u/.claude/agents/ed.md': agent('editor', EDITS, 'User level.') },
      links: [`${nine}/gone`, `${nine}/readme.txt`, `${nine}/loop`],
      real: { [`${nine}/gone`]: null, [`${nine}/readme.txt`]: '/elsewhere/readme.txt', [`${nine}/loop`]: '/w/pkg/.claude/agents' },
      kinds: { [`${nine}/readme.txt`]: 'file' },
    })
    await start($, IN)
    const text = await resultText($, 'editor')
    expect(text).not.toMatch(/cut short/i)
    expect(sandboxOf(seen.argv[0])).toBe('workspace-write')
  })

  test('a link past the limit that leads to a folder not yet searched cuts the search short (PR #48 review)', { options }, async ($, on) => {
    const nine = '/w/pkg/.claude/agents/1/2/3/4/5/6/7/8/9'
    const seen = engine(on, { cwd: IN, agents: { [`${nine}/more`]: 'x', '/home/u/.claude/agents/ed.md': agent('editor', EDITS, 'User level.') }, links: [`${nine}/more`], real: { [`${nine}/more`]: '/elsewhere/agents' } })
    await start($, IN)
    expect(await resultText($, 'editor')).toMatch(/cut short at 8 folders deep/)
    expect(sandboxOf(seen.argv[0])).toBe('read-only')
  })

  test('a link past the limit named .md that leads to a file cuts the search short (PR #48 review)', { options }, async ($, on) => {
    const nine = '/w/pkg/.claude/agents/1/2/3/4/5/6/7/8/9'
    const seen = engine(on, { cwd: IN, agents: { [`${nine}/agent.md`]: 'x', '/home/u/.claude/agents/ed.md': agent('editor', EDITS, 'User level.') }, links: [`${nine}/agent.md`], real: { [`${nine}/agent.md`]: '/elsewhere/agent.md' }, kinds: { [`${nine}/agent.md`]: 'file' } })
    await start($, IN)
    expect(await resultText($, 'editor')).toMatch(/cut short at 8 folders deep/)
    expect(sandboxOf(seen.argv[0])).toBe('read-only')
  })

  test('a folder past the limit that holds only a subfolder still cuts the search short: what lies below it was not looked at (PR #48 review)', { options }, async ($, on) => {
    const seen = engine(on, { cwd: IN, agents: { '/w/pkg/.claude/agents/1/2/3/4/5/6/7/8/9/10/notes.txt': 'Not an agent.', '/home/u/.claude/agents/ed.md': agent('editor', EDITS, 'User level.') } })
    await start($, IN)
    const text = await resultText($, 'editor')
    expect(text).toMatch(/cut short at 8 folders deep/)
    expect(sandboxOf(seen.argv[0])).toBe('read-only')
  })

  test('an editing agent demoted to read-only by a cut-short search still waits in background mode, so Claude reads the note before it goes on (PR #48 review)', { options: { ...options, codexRunMode: 'background' } }, async ($, on) => {
    const seen = engine(on, { cwd: IN, agents: { '/w/pkg/.claude/agents/1/2/3/4/5/6/7/8/9/other.md': agent('someone', READS, 'Nine deep.'), '/home/u/.claude/agents/ed.md': agent('editor', EDITS, 'User level.') } })
    await start($, IN)
    const r: any = await $.tool.call(call({ subagent_type: 'editor' }) as never)
    expect(r.result?.status).toBe('completed')
    expect(sandboxOf(seen.argv[0])).toBe('read-only')
    expect((r.result?.content ?? []).map((c: { text?: string }) => c.text ?? '').join('\n')).toMatch(/cut short at 8 folders deep.*read-only/)
    expect(seen.submitted.length).toBe(0)
  })

  test('a search cut short runs the agent read-only, since a definition past the limit may forbid edits, and the note says so (PR #48 review)', { options }, async ($, on) => {
    // Claude reads this read-only general-purpose definition 9 folders down; duet stops at 8, and its fallback, the built-in, edits.
    const seen = engine(on, { cwd: IN, agents: { '/w/pkg/.claude/agents/1/2/3/4/5/6/7/8/9/gp.md': agent('general-purpose', READS, 'Nine deep.') } })
    await start($, IN)
    const text = await resultText($, 'general-purpose')
    expect(seen.stdin[0]).not.toContain('Nine deep.')
    expect(sandboxOf(seen.argv[0])).toBe('read-only')
    expect(text.split('\n').find(line => line.startsWith('duet: the search'))).toMatch(/read-only/)
  })

  test('a search that the 8-folder limit cut short says so in the run\'s result, naming the limit; one that reached no limit does not', { options }, async ($, on) => {
    const eight = '/w/pkg/.claude/agents/d1/d2/d3/d4/d5/d6/d7/d8'
    const seen = engine(on, { cwd: IN, agents: { [`${eight}/reader.md`]: agent('reader', READS, 'Eight deep.'), '/home/u/.claude/agents/editor.md': agent('editor', EDITS, 'User level.') } })
    await start($, IN)
    // Nothing sits below the 8th folder: the whole tree was searched.
    expect(await resultText($, 'reader')).not.toMatch(/cut short/i)
    // A 9th folder holds a definition the search never reaches, and the lookup falls through to the user's.
    seen.files[`${eight}/d9/editor.md`] = agent('editor', READS, 'Nine deep.')
    const cut = await resultText($, 'editor')
    expect(seen.stdin[1]).toContain('User level.')
    expect(cut).toMatch(/cut short/i)
    expect(cut).toMatch(/\b8 folders\b/)
  })

  test('a search that the 500-file limit cut short says so in the run\'s result, naming the limit; one that reached no limit does not', { options }, async ($, on) => {
    const seen = engine(on, { cwd: IN, agents: { '/w/pkg/.claude/agents/other.md': agent('someone', READS, 'Not it.'), '/home/u/.claude/agents/mine/ed.md': agent('editor', EDITS, 'User level.') } })
    await start($, IN)
    expect(await resultText($, 'editor')).not.toMatch(/cut short/i)
    // 600 more files in the nearest folder: the 500 first by name are read, and the definition past them never is.
    for (let i = 0; i < 600; i++) seen.files[`/w/pkg/.claude/agents/f${String(i).padStart(3, '0')}.md`] = agent(`filler-${i}`, READS, 'Filler.')
    seen.files['/w/pkg/.claude/agents/zz-editor.md'] = agent('editor', READS, 'Past the limit.')
    const cut = await resultText($, 'editor')
    expect(seen.stdin[1]).toContain('User level.')
    expect(seen.stdin[1]).not.toContain('Past the limit.')
    expect(cut).toMatch(/cut short/i)
    expect(cut).toMatch(/\b500\b/)
  })

  test('the 500-file note counts a whole agents folder, subfolders included, and claims nothing about how far Claude reads', { options }, async ($, on) => {
    const seen = engine(on, { cwd: IN, agents: { '/home/u/.claude/agents/ed.md': agent('editor', EDITS, 'User level.') } })
    await start($, IN)
    // 300 files in each of two subfolders: neither holds 500, the agents folder does.
    for (let i = 0; i < 600; i++) seen.files[`/w/pkg/.claude/agents/${i < 300 ? 'a' : 'b'}/f${String(i).padStart(3, '0')}.md`] = agent(`filler-${i}`, READS, 'Filler.')
    seen.files['/w/pkg/.claude/agents/c/editor.md'] = agent('editor', READS, 'Past the limit.')
    const cut = await resultText($, 'editor')
    expect(seen.stdin[0]).toContain('User level.')
    expect(cut).toMatch(/\b500 \.md files\b/)
    expect(cut).not.toMatch(/per folder/)
    expect(cut).not.toMatch(/deeper/)
  })

  test('a folder\'s files are read together, not one after the other, and the pick still follows the files\' name order', { options }, async ($, on) => {
    const agents: Record<string, string> = {}
    for (let i = 0; i < 5; i++) agents[`/w/.claude/agents/par-${i}.md`] = agent('editor', EDITS, `Body ${i}.`)
    // The later a file's name, the sooner its read ends, so the reads finish in the reverse of their name order.
    const seen = engine(on, { cwd: IN, agents, hold: path => 60 - 10 * Number(path.match(/par-(\d)/)?.[1] ?? 0) })
    await start($, IN)
    await asks($, 'editor')
    expect(seen.reads.filter(p => p.includes('/par-')).length).toBe(5)
    expect(seen.maxReads).toBe(5)
    expect(sandboxOf(seen.argv[0])).toBe('workspace-write')
    expect(seen.stdin[0]).toContain('Body 0.')
    expect(seen.stdin[0]).not.toContain('Body 4.')
  })

  test('a folder\'s files are read at most 16 at a time, so a large folder does not open hundreds of files at once (PR #48 review)', { options }, async ($, on) => {
    const agents: Record<string, string> = {}
    for (let i = 0; i < 40; i++) agents[`/w/.claude/agents/many-${String(i).padStart(2, '0')}.md`] = agent(`filler-${i}`, READS, 'Filler.')
    agents['/w/.claude/agents/zz-editor.md'] = agent('editor', EDITS, 'Last by name.')
    const seen = engine(on, { cwd: IN, agents, hold: () => 3 })
    await start($, IN)
    await asks($, 'editor')
    expect(seen.reads.filter(p => p.includes('/many-')).length).toBe(40)
    expect(seen.maxReads).toBe(16)
    expect(seen.stdin[0]).toContain('Last by name.')
  })

  test('a read that fails once is tried again on its own, so a passing error does not hide a definition and hand the pick to an editing one (PR #48 review)', { options }, async ($, on) => {
    const near = '/w/pkg/.claude/agents/editor.md'
    const seen = engine(on, { cwd: IN, flaky: [near], agents: { [near]: agent('editor', READS, 'Near.'), '/w/.claude/agents/editor.md': agent('editor', EDITS, 'Far.') } })
    await start($, IN)
    await asks($, 'editor')
    expect(seen.reads.filter(p => p === near).length).toBe(2)
    expect(seen.stdin[0]).toContain('Near.')
    expect(sandboxOf(seen.argv[0])).toBe('read-only')
  })

  test('a definition that dropped out of the folder listing is read again when it returns, even with the same size and time', { options }, async ($, on) => {
    const path = '/w/.claude/agents/prune-me.md'
    const seen = engine(on, { cwd: IN, agents: { [path]: agent('editor', EDITS, 'Version one.'), '/w/.claude/agents/other.md': agent('someone', READS, 'Not it.') } })
    await start($, IN)
    const reads = () => seen.reads.filter(p => p === path).length
    await asks($, 'editor')
    expect(reads()).toBe(1)
    // Gone from the listing: its cached text is dropped with it.
    delete seen.files[path]
    await asks($, 'editor')
    expect(sandboxOf(seen.argv[1])).toBe('read-only')
    // Back with the same length and the same time, but other text.
    seen.files[path] = agent('editor', EDITS, 'Version two.')
    await asks($, 'editor')
    expect(reads()).toBe(2)
    expect(sandboxOf(seen.argv[2])).toBe('workspace-write')
    expect(seen.stdin[2]).toContain('Version two.')
  })

  // PR #48 review (Codex, P2): the note was joined into the footer only, and no failure path carries the footer.
  test('a run that fails after a cut-short search keeps the note: in the denial, the background delivery and the .out.md file', { options: { ...options, codexAgents: 'reader, bgreader', codexRunMode: 'background, reader=wait' } }, async ($, on) => {
    const eight = '/w/pkg/.claude/agents/d1/d2/d3/d4/d5/d6/d7/d8'
    const seen = engine(on, { cwd: IN, codex: 'missing', agents: { '/home/u/.claude/agents/reader.md': agent('reader', READS, 'User level.'), '/home/u/.claude/agents/bgreader.md': agent('bgreader', READS, 'User level.') } })
    await start($, IN)
    // Nothing is cut short: the failure says nothing about the search.
    const plain: any = await asks($, 'reader')
    expect(plain.deny).toMatch(/codex not found on PATH/)
    expect(plain.deny).not.toMatch(/cut short/i)
    // A 9th folder holds a file the search never reaches; the runs below fail on Codex all the same.
    seen.files[`${eight}/d9/reader.md`] = agent('reader', READS, 'Nine deep.')
    // Waited on: the denial Claude reads.
    const denied: any = await asks($, 'reader')
    expect(denied.deny).toMatch(/the Codex handoff failed \(codex not found on PATH/)
    expect(denied.deny).toMatch(/the search for the reader agent definition was cut short at 8 folders deep/)
    // In the background: the delivered message and the file the launch record points to.
    const launched: any = await asks($, 'bgreader')
    expect(launched.result.status).toBe('async_launched')
    await seen.clock.settle()
    expect(seen.submitted.length).toBe(1)
    expect(seen.submitted[0]).toMatch(/duet-d\d \(bgreader\) failed on Codex: codex not found on PATH/)
    expect(seen.submitted[0]).toMatch(/the search for the bgreader agent definition was cut short at 8 folders deep/)
    const outFile = seen.files[launched.result.outputFile]
    expect(outFile).toMatch(/failed on Codex: codex not found on PATH/)
    expect(outFile).toMatch(/the search for the bgreader agent definition was cut short at 8 folders deep/)
  })
})

describe('issue 6: a running fallback run says the engine stops it at 10 minutes', () => {
  const NOTE = /fallback: stops at 10m \(timeoutMinutes 20\)/
  const review = ($: any) => $.command.run({ command: 'duet', args: 'review', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  const pane = ($: any) => $.ui.mount({ plugin: 'duet', surface: 'terminal', component: 'Pane', requestId: 'duet', props: { title: 'Duet', isFocused: true, bodyColumns: 76, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} }, viewport: { columns: 120, rows: 40 } })

  /** A Codex run held in flight: `started` settles once its process.run is called, `release` lets it finish. */
  function held() {
    let release!: () => void
    let begun!: () => void
    const gate = new Promise<void>(r => (release = r))
    const started = new Promise<void>(r => (begun = r))
    return { gate, started, release, begun }
  }

  test('a waited agent run on timeoutMinutes 20 caps the one-shot run at 600000 ms and shows the note on its running row', { options: { codexAgents: 'general-purpose', codexConsent: 'allow', codexRunMode: 'wait', timeoutMinutes: 20 } }, async ($: any, on: any) => {
    const h = held()
    const seen = engine(on, { codexHold: h.gate, onCodex: h.begun })
    await start($)
    const running = $.tool.call(call() as never)
    await h.started
    const ui = await pane($)
    const note = await ui.find({ type: 'Text', text: NOTE })
    await ui.unmount()
    h.release()
    await running
    expect(seen.timeouts[0]).toBe(600_000)
    expect(note).toBeDefined()
  })

  test('a review on timeoutMinutes 20 shows the note on its running row', { options: { codexConsent: 'allow', timeoutMinutes: 20 } }, async ($: any, on: any) => {
    const h = held()
    const seen = engine(on, { codexHold: h.gate, onCodex: h.begun })
    await start($)
    await review($)
    await seen.clock.advance(1000)
    await h.started
    const ui = await pane($)
    const note = await ui.find({ type: 'Text', text: NOTE })
    await ui.unmount()
    h.release()
    await seen.clock.advance(1000)
    expect(seen.timeouts[0]).toBe(600_000)
    expect(note).toBeDefined()
  })
})

describe('issue 7: each session keeps its own run log', () => {
  const OPTS = { codexAgents: 'general-purpose', codexRunMode: 'wait' } as const
  const stats = ($: any) => $.command.run({ command: 'duet', args: 'stats', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  const rowOf = (text: string, key: string) => text.split('\n').find(l => l.startsWith(key)) ?? ''

  test('a finished run leaves the legacy log and another session\'s log byte for byte as they were', { options: OPTS }, async ($, on) => {
    const seen = engine(on)
    const legacy = runLine('claude', 'Plan', 'legacy')
    const other = runLine('codex', 'Explore', 'other')
    seen.files[LEGACY_LOG] = legacy
    seen.files[logOf('s2')] = other
    await start($)
    await $.tool.call(call() as never)
    expect(seen.files[LEGACY_LOG]).toBe(legacy)
    expect(seen.files[logOf('s2')]).toBe(other)
    const own = (seen.files[logOf('s1')] ?? '').split('\n').filter(Boolean)
    expect(own.length).toBe(1)
    expect(JSON.parse(own[0] ?? '{}').provider).toBe('codex')
  })

  test('the 2000-line cap is per session: this session\'s log drops its oldest line and the other session\'s keeps all of its own', { options: OPTS }, async ($, on) => {
    const seen = engine(on)
    const other = runLine('codex', 'Explore', 'other')
    seen.files[logOf('s1')] = Array.from({ length: 2000 }, (_, i) => runLine('claude', 'Plan', `old${i}`)).join('')
    seen.files[logOf('s2')] = other
    await start($)
    await $.tool.call(call() as never)
    const own = (seen.files[logOf('s1')] ?? '').split('\n').filter(Boolean)
    expect(own.length).toBe(2000)
    expect(JSON.parse(own[0] ?? '{}').id).toBe('old1')
    expect(JSON.parse(own[own.length - 1] ?? '{}').provider).toBe('codex')
    expect(seen.files[logOf('s2')]).toBe(other)
  })

  test('sessions whose id can\'t be read share sessions/unknown/runs.jsonl, never the legacy file', { options: OPTS }, async ($, on) => {
    const seen = engine(on, { noSessionId: true })
    await start($)
    await $.tool.call(call() as never)
    expect(seen.files[LEGACY_LOG]).toBeUndefined()
    expect(seen.files[logOf('unknown')] ?? '').toContain('"provider":"codex"')
  })

  test('/duet stats counts the legacy log, other sessions\' logs and this session\'s, and skips a session with no log or an unreadable one', { options: OPTS, }, async ($, on) => {
    const seen = engine(on, { unreadable: [logOf('s3')] })
    seen.files[LEGACY_LOG] = runLine('codex', 'Explore')
    seen.files[logOf('s2')] = runLine('claude', 'Explore') + runLine('claude', 'Explore')
    seen.files[logOf('s3')] = runLine('claude', 'Explore')
    seen.files[`${DATA}/sessions/s4/review-d1.md`] = 'a session that logged nothing'
    await start($)
    await $.tool.call(call() as never)
    const { text } = await stats($)
    expect(rowOf(text, 'claude · Explore')).toMatch(/^claude · Explore\s+2\s/)
    expect(rowOf(text, 'codex · Explore')).toMatch(/^codex · Explore\s+1\s/)
    expect(rowOf(text, 'codex · general-purpose')).toMatch(/^codex · general-purpose\s+1\s/)
  })

  test('/duet stats works with sessions\' logs alone, when no legacy log exists', { options: OPTS }, async ($, on) => {
    const seen = engine(on)
    seen.files[logOf('s2')] = runLine('claude', 'Explore')
    await start($)
    await $.tool.call(call() as never)
    const { text } = await stats($)
    expect(rowOf(text, 'claude · Explore')).toMatch(/^claude · Explore\s+1\s/)
    expect(rowOf(text, 'codex · general-purpose')).toMatch(/^codex · general-purpose\s+1\s/)
  })

  test('PR #67 review (Codex P2): /duet stats reads the session logs at most 16 at a time and counts every one', { options: OPTS }, async ($, on) => {
    const seen = engine(on, { hold: () => 3 })
    for (let i = 0; i < 40; i++) seen.files[logOf(`p${i}`)] = runLine('claude', 'Explore')
    await start($)
    const { text } = await stats($)
    expect(seen.reads.filter(p => p.startsWith(`${DATA}/sessions/p`)).length).toBe(40)
    expect(seen.maxReads).toBe(16)
    expect(rowOf(text, 'claude · Explore')).toMatch(/^claude · Explore\s+40\s/)
  })

  test('PR #67 review (Codex P2): a session log whose read fails once, as past the open-file limit, is read again and counted', { options: OPTS }, async ($, on) => {
    const seen = engine(on, { flaky: [logOf('s2')] })
    seen.files[logOf('s2')] = runLine('claude', 'Explore') + runLine('claude', 'Explore')
    seen.files[logOf('s3')] = runLine('claude', 'Explore')
    await start($)
    const { text } = await stats($)
    expect(seen.reads.filter(p => p === logOf('s2')).length).toBe(2)
    expect(rowOf(text, 'claude · Explore')).toMatch(/^claude · Explore\s+3\s/)
  })

  test('PR #67 review (Codex P2): a session folder with no log, or no legacy log, is read once: a missing file is not retried', { options: OPTS }, async ($, on) => {
    const seen = engine(on)
    seen.files[`${DATA}/sessions/s4/review-d1.md`] = 'a session that logged nothing'
    seen.files[logOf('s2')] = runLine('claude', 'Explore')
    await start($)
    const { text } = await stats($)
    expect(seen.reads.filter(p => p === logOf('s4')).length).toBe(1)
    expect(seen.reads.filter(p => p === LEGACY_LOG).length).toBe(1)
    expect(rowOf(text, 'claude · Explore')).toMatch(/^claude · Explore\s+1\s/)
  })

  test('PR #67 review: a run never overwrites a session log it could not read (no permission): the log keeps every line', { options: OPTS }, async ($, on) => {
    const seen = engine(on, { unreadable: [logOf('s1')] })
    const kept = runLine('claude', 'Plan', 'a') + runLine('claude', 'Plan', 'b') + runLine('claude', 'Plan', 'c')
    seen.files[logOf('s1')] = kept
    await start($)
    await $.tool.call(call() as never)
    expect(seen.files[logOf('s1')]).toBe(kept)
  })

  test('PR #67 review: a session log whose read fails once, as past the open-file limit, is read again and the run appended', { options: OPTS }, async ($, on) => {
    const seen = engine(on, { flaky: [logOf('s1')] })
    seen.files[logOf('s1')] = runLine('claude', 'Plan', 'a') + runLine('claude', 'Plan', 'b') + runLine('claude', 'Plan', 'c')
    await start($)
    await $.tool.call(call() as never)
    const own = (seen.files[logOf('s1')] ?? '').split('\n').filter(Boolean)
    expect(own.map(l => JSON.parse(l).id).slice(0, 3)).toEqual(['a', 'b', 'c'])
    expect(own.length).toBe(4)
    expect(JSON.parse(own[3] ?? '{}').provider).toBe('codex')
  })

  test('PR #67 review: a session\'s first run starts its log even when the engine words a missing file without ENOENT', { options: OPTS }, async ($, on) => {
    const seen = engine(on, { missingText: 'no such file or directory' })
    await start($)
    await $.tool.call(call() as never)
    const own = (seen.files[logOf('s1')] ?? '').split('\n').filter(Boolean)
    expect(own.length).toBe(1)
    expect(JSON.parse(own[0] ?? '{}').provider).toBe('codex')
  })

  test('PR #67 review: /duet stats reads a missing log once even when the engine words it without ENOENT', { options: OPTS }, async ($, on) => {
    const seen = engine(on, { missingText: 'no such file or directory' })
    seen.files[`${DATA}/sessions/s4/review-d1.md`] = 'a session that logged nothing'
    seen.files[logOf('s2')] = runLine('claude', 'Explore')
    await start($)
    const { text } = await stats($)
    expect(seen.reads.filter(p => p === logOf('s4')).length).toBe(1)
    expect(rowOf(text, 'claude · Explore')).toMatch(/^claude · Explore\s+1\s/)
  })
})

describe('issue 8: run-log appends within a session are serialized', () => {
  test('two routed Codex runs that finish together both land in the session log (PR #1: 56c0832)', { options: { codexAgents: '*', codexConsent: 'allow', codexRunMode: 'wait', maxConcurrent: 2 } }, async ($: any, on: any) => {
    // Reads of a run log wait at the gate until both runs have finished and settled. An append that doesn't wait for the one
    // before it is then reading the log too, so both read it empty and the second write drops the first run's line.
    let open!: () => void
    const seen = engine(on, { logGate: new Promise<void>(resolve => (open = resolve)) })
    await start($)
    const both = Promise.all([$.tool.call(call() as never), $.tool.call(call() as never)])
    await seen.clock.settle()
    open()
    await both
    await seen.clock.settle()
    expect(seen.argv.length).toBe(2)
    // Every run log the mod wrote, not only this session's, so hooks from before #7 (one shared log) fail here for the race and not for the path.
    const logs = Object.keys(seen.files).filter(path => path.endsWith('/runs.jsonl'))
    const rows = logs.flatMap(path => seen.files[path]!.split('\n').filter(Boolean).map(l => JSON.parse(l)))
    expect(rows.map(r => r.id).sort()).toEqual(['d1', 'd2'])
    expect(rows.every(r => r.provider === 'codex')).toBe(true)
  })
})

describe('0.3.0: the consent question names the provider key file where Codex can read it', () => {
  test('under codexFsScope anything (the default) the question names ~/.claude/duet-data/.env', { options: { codexAgents: 'general-purpose' } }, async ($, on) => {
    const seen = engine(on)
    await start($)
    await $.tool.call(call() as never)
    expect(seen.questions.length).toBe(1)
    expect(seen.questions[0]).toContain('your provider key file ~/.claude/duet-data/.env')
  })

  test('under codexFsScope project the key file is hidden, so the question does not name it', { options: { codexAgents: 'general-purpose', codexFsScope: 'project' } }, async ($, on) => {
    const seen = engine(on)
    await start($)
    await $.tool.call(call() as never)
    expect(seen.questions.length).toBe(1)
    expect(seen.questions[0]).not.toContain('key file')
  })

  test('under codexFsScope project a session folder that holds the key file (the home folder) still names it (Codex 4298736579)', { options: { codexAgents: 'general-purpose', codexFsScope: 'project' } }, async ($, on) => {
    const seen = engine(on, { cwd: '/home/u' })
    await start($, '/home/u')
    await $.tool.call(call() as never)
    expect(seen.questions.length).toBe(1)
    expect(seen.questions[0]).toContain('your provider key file ~/.claude/duet-data/.env')
  })
})

describe('0.3.0: provider keys are never blanked for Codex (the owner\'s decision at review)', () => {
  test('a routed call leaves GEMINI_API_KEY and OPENROUTER_API_KEY out of the blanked env, so a Codex env_key keeps working', { options: { codexAgents: 'general-purpose', codexConsent: 'allow' } }, async ($, on) => {
    const seen = engine(on)
    await start($)
    await $.tool.call(call() as never)
    await seen.clock.advance(1000)   // the run answers in the background; Codex starts after the call returns
    const env = seen.env[0]!
    for (const k of ['GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'GROQ_API_KEY', 'DUET_CUSTOM_API_KEY']) expect([k, env[k]]).toEqual([k, undefined])
    expect(env.ANTHROPIC_API_KEY).toBe('')
    expect(env.OPENAI_API_KEY).toBeUndefined()
  })
})


// #119 gap 3: after Stop, $.prompt.submit resolves { drop } and queues nothing (the owner's option b: retry at turn.complete, toast as the fallback).
describe('#119: a background answer that Stop dropped', () => {
  const STOPPED_DROP = 'the session was stopped and nobody has sent input since'
  const OUT = '/home/u/.claude/duet-data/sessions/s1/d1.out.md'
  const turnEnds = ($: any, agentId?: string) => $.turn.complete({ turnId: 't', answer: '', durationMs: 0, isAborted: false, usage: null, ...(agentId ? { agentId } : {}) })

  test('is kept, named in a toast, and submitted again when the next main turn ends', { options: { codexConsent: 'allow' } }, async ($, on) => {
    const seen = engine(on, { drops: [STOPPED_DROP] })
    await start($)
    await $.tool.call(call({ subagent_type: 'duet:codex-reviewer' }) as never)
    await seen.clock.settle()
    expect(seen.dropped.length).toBe(1)
    expect(seen.submitted.length).toBe(0)
    expect(seen.toasts.some(t => t.includes('d1') && t.includes('answer in'))).toBe(true)
    // A subagent's turn ending is not the person's next input.
    await turnEnds($, 'sub-1')
    await seen.clock.settle()
    expect(seen.submitted.length).toBe(0)
    await turnEnds($)
    await seen.clock.settle()
    expect(seen.submitted.length).toBe(1)
    expect(seen.submitted[0]).toContain('Background agent duet-d1 (duet:codex-reviewer) finished on Codex')
    expect(seen.files[OUT]).toContain('Found 3 callers.')
  })

  test("another hook's drop is not retried: the toast points at the answer on disk", { options: { codexConsent: 'allow' } }, async ($, on) => {
    const seen = engine(on, { drops: ['a policy hook held it'] })
    await start($)
    await $.tool.call(call({ subagent_type: 'duet:codex-reviewer' }) as never)
    await seen.clock.settle()
    expect(seen.toasts.some(t => t.includes('answer in'))).toBe(true)
    await turnEnds($)
    await seen.clock.settle()
    expect(seen.submitted.length).toBe(0)
    expect(seen.dropped.length).toBe(1)
  })
})

// #119 gap 1, the owner's choice: the consent answer outlives /clear, /resume and /branch, which reset every atom.
describe('#119: the Codex consent answer outlives /clear', () => {
  const review = ($: any) => $.command.run({ command: 'duet', args: 'review', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })

  test('a classic.SessionStart after /clear writes the answer back; one after compaction writes nothing', { options: { codexConsent: 'ask' } }, async ($: any, on: any) => {
    const writes: { key: string; value: unknown }[] = []
    on('state.set', ($: any, e: any, next: any) => (writes.push({ key: e.key, value: e.value }), next(e)))
    on('classic.SessionStart', () => ({}))
    const seen = engine(on)
    await start($)
    await review($)
    expect(seen.asked).toBe(1)
    writes.length = 0
    await $.classic.SessionStart({ source: 'compact' })
    expect(writes.filter(w => w.key === 'consent')).toEqual([])
    await $.classic.SessionStart({ source: 'clear' })
    expect(writes.filter(w => w.key === 'consent')).toEqual([{ key: 'consent', value: 'yes' }])
  })

  test('with nothing answered yet, /clear writes no answer', { options: { codexConsent: 'ask' } }, async ($: any, on: any) => {
    const writes: { key: string; value: unknown }[] = []
    on('state.set', ($: any, e: any, next: any) => (writes.push({ key: e.key, value: e.value }), next(e)))
    on('classic.SessionStart', () => ({}))
    engine(on)
    await start($)
    await $.classic.SessionStart({ source: 'clear' })
    expect(writes.filter(w => w.key === 'consent')).toEqual([])
  })
})

// #119, Codex on PR #123: a git read that fails is no reading, not an empty tree, or every file dirty before the run counts as changed by it.
describe('#119: a failed git read after an editing run', () => {
  test('records that the files were not compared, not that the dirty ones changed', { options: { codexAgents: 'test-writer', codexSandbox: 'workspace-write', codexConsent: 'allow' } }, async ($, on) => {
    const seen = engine(on, { dirty: ' M a.ts\n M b.ts\n', gitFailAfterCodex: true, agents: { '/home/u/.claude/agents/test-writer.md': '---\nname: test-writer\ndescription: Writes tests.\ntools: Read, Write, Edit, Bash\n---\nWrite tests.' } })
    await start($)
    const r: any = await $.tool.call(call({ subagent_type: 'test-writer' }) as never)
    const text = JSON.stringify(r)
    expect(text).not.toContain('files changed during this run')
    expect(text).toContain('files not compared')
    expect(seen.argv.length).toBe(1)
  })
})

// #121 (owner's approval, 2026-10-21): /duet stop <id> and the pane's Stop key. Under the kit process.spawn has no stub,
// so a run takes the one-shot fallback: these pin the answers and the question; the stream stop is a live check.
describe('#121: /duet stop and the Stop key', () => {
  const duet = ($: any, args: string) => $.command.run({ command: 'duet', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  const pane = ($: any) => $.ui.mount({ plugin: 'duet', surface: 'terminal', component: 'Pane', requestId: 'duet', props: { title: 'Duet', isFocused: true, bodyColumns: 76, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} }, viewport: { columns: 120, rows: 40 } })
  const QUESTION = 'Stop d1 (review --uncommitted on Codex)? What Codex already wrote stays.'
  const ONE_SHOT = "d1 runs as a one-shot fallback and can't be stopped; it ends at its timeout."

  test("with nothing running, /duet stop says so, and an unknown id isn't running", { options: { codexConsent: 'allow' } }, async ($: any, on: any) => {
    engine(on)
    await start($)
    expect((await duet($, 'stop')).text).toBe('No Codex run is running.')
    expect((await duet($, 'stop d9')).text).toBe("d9 isn't running.")
  })

  test("a running one-shot run is listed, and can't be stopped: the answer says why", { options: { codexConsent: 'allow' } }, async ($: any, on: any) => {
    let release!: () => void
    let begun!: () => void
    const started = new Promise<void>(resolve => (begun = resolve))
    const seen = engine(on, { codexHold: new Promise<void>(resolve => (release = resolve)), onCodex: begun })
    await start($)
    try {
      expect((await duet($, 'review')).text).toMatch(/^Codex review started/)
      await started
      await seen.clock.settle()
      expect((await duet($, 'stop')).text).toBe('Usage: /duet stop <id>. Running now: d1.')
      expect((await duet($, 'stop d1')).text).toBe(ONE_SHOT)
    } finally {
      release()
    }
  })

  test('the Stop key asks first: Keep it running leaves the run, Stop it answers as /duet stop does', { options: { codexConsent: 'allow' } }, async ($: any, on: any) => {
    let release!: () => void
    let begun!: () => void
    const started = new Promise<void>(resolve => (begun = resolve))
    const o: { codexHold: Promise<void>; onCodex: () => void; answer: string } = { codexHold: new Promise<void>(resolve => (release = resolve)), onCodex: () => begun(), answer: 'Keep it running' }
    const seen = engine(on, o)
    await start($)
    try {
      await duet($, 'review')
      await started
      await seen.clock.settle()
      let ui = await pane($)
      expect(await ui.find({ key: 'stop' })).toBeDefined()
      await ui.press({ key: 'stop' })
      await seen.clock.settle()
      await ui.unmount()
      expect(seen.questions).toContain(QUESTION)
      expect(seen.toasts).not.toContain(ONE_SHOT)
      o.answer = 'Stop it'
      ui = await pane($)
      await ui.press({ key: 'stop' })
      await seen.clock.settle()
      await ui.unmount()
      expect(seen.toasts).toContain(ONE_SHOT)
    } finally {
      release()
    }
  })

  test('the demo shows no Stop key: its rows are samples', { options: { codexConsent: 'allow' } }, async ($: any, on: any) => {
    engine(on)
    await start($)
    await duet($, 'demo')
    const ui = await pane($)
    expect(await ui.find({ key: 'stop' })).toBeUndefined()
    await ui.unmount()
  })
})

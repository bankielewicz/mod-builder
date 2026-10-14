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

type Seen = { argv: string[][]; stdin: string[]; env: Record<string, string>[]; asked: number; beneath: number; files: Record<string, string>; reads: string[]; listed: string[]; mtimes: Record<string, number>; registered: { name: string; description: string }[]; submitted: string[]; maxReads: number; clock: any }

/** Stubs every `$` call the routing path makes; nothing else sits beneath the mod. */
function engine(on: any, o: { answer?: string; codex?: 'ok' | 'missing' | 'fail'; agents?: Record<string, string>; beneath?: unknown; env?: Record<string, string>; real?: Record<string, string | null>; kinds?: Record<string, 'file' | 'dir' | 'other'>; gitDirs?: string; oldGit?: boolean; denyEnv?: string; cwd?: string; top?: string | null; gitAt?: string[]; links?: string[]; unreadable?: string[]; hold?: (path: string) => number } = {}): Seen {
  const seen: Seen = { argv: [], stdin: [], env: [], asked: 0, beneath: 0, files: { ...(o.agents ?? {}) }, reads: [], listed: [], mtimes: {}, registered: [], submitted: [], maxReads: 0, clock: null }
  seen.clock = mock.clock(on)
  on('agent.register', ($: any, e: any) => (seen.registered.push({ name: e.name, description: e.description }), { value: { agent: `duet:${e.name}` } }))
  on('prompt.submit', ($: any, e: any) => (seen.submitted.push(e.text), { text: e.text }))
  on('turn.complete', ($: any, e: any) => ({ text: e.answer, usage: e.usage }))
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }))
  // `cwd`: where the session started, below the repository root unless it is the root itself.
  on('session.cwd', () => ({ value: o.cwd ?? '/w' }))
  on('session.id', () => ({ value: 's1' }))
  // `denyEnv`, read at call time: that variable's lookup fails, as a broken engine call would.
  on('env.get', ($: any, e: any) => (o.denyEnv === e.name ? { deny: 'env unavailable' } : { value: (o.env ?? { HOME: '/home/u' })[e.name] }))
  // `hold`: a read stays in flight for that many promise turns, and `maxReads` counts the most in flight at once.
  let reading = 0
  on('fs.read', ($: any, e: any) => {
    seen.reads.push(e.path)
    const text = seen.files[e.path]
    // `unreadable` paths are listed but can't be read, as a file without read permission.
    const answer = text === undefined ? { deny: 'ENOENT: no such file' } : o.unreadable?.includes(e.path) ? { deny: 'EACCES: permission denied' } : { value: text }
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
  on('ui.toast', () => ({ value: undefined }))
  on('process.run', ($: any, e: any) => {
    const argv = e.argv as string[]
    // `--git-dir --git-common-dir`: a plain repository's .git sits in the session folder unless `gitDirs` says otherwise.
    // `oldGit`: git before 2.31, which has no --path-format.
    if (argv[0] === 'git' && o.oldGit && argv.some(a => a.startsWith('--path-format'))) return { value: { exitCode: 128, stdout: '', stderr: 'fatal: unknown option', isStdoutTruncated: false, isStderrTruncated: false } }
    if (argv[0] === 'git' && argv.includes('--git-common-dir')) return { value: { exitCode: 0, stdout: `${o.gitDirs ?? '/w/.git\n/w/.git'}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    if (argv[0] === 'git') return { value: { exitCode: 0, stdout: argv.includes('rev-parse') ? 'abc1234\n' : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    seen.argv.push(argv)
    seen.stdin.push(e.init?.stdin ?? '')
    seen.env.push(e.init?.env ?? {})
    if (o.codex === 'missing') return { deny: 'spawn codex ENOENT' }
    if (o.codex === 'fail') return { value: { exitCode: 1, stdout: '', stderr: 'Error: not logged in', isStdoutTruncated: false, isStderrTruncated: false } }
    return { value: { exitCode: 0, stdout: OK_JSONL, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('tool.call', { tool: 'AskUserQuestion' }, ($: any, e: any) => {
    seen.asked++
    const q = e.questions[0].question
    return { result: { questions: e.questions, answers: { [q]: o.answer ?? 'Yes, send to Codex' } } }
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
    expect(seen.files['/home/u/.claude/duet-data/runs.jsonl']).toContain('"provider":"codex"')
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
    const rows = (seen.files['/home/u/.claude/duet-data/runs.jsonl'] ?? '').split('\n').filter(Boolean).map(l => JSON.parse(l))
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

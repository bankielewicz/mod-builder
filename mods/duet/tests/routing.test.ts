import { describe, expect, mock, test } from 'claude-code/testing'

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

type Seen = { argv: string[][]; stdin: string[]; env: Record<string, string>[]; asked: number; beneath: number; files: Record<string, string>; registered: { name: string; description: string }[]; submitted: string[]; clock: any }

/** Stubs every `$` call the routing path makes; nothing else sits beneath the mod. */
function engine(on: any, o: { answer?: string; codex?: 'ok' | 'missing' | 'fail'; agents?: Record<string, string>; beneath?: unknown } = {}): Seen {
  const seen: Seen = { argv: [], stdin: [], env: [], asked: 0, beneath: 0, files: { ...(o.agents ?? {}) }, registered: [], submitted: [], clock: null }
  seen.clock = mock.clock(on)
  on('agent.register', ($: any, e: any) => (seen.registered.push({ name: e.name, description: e.description }), { value: { agent: `duet:${e.name}` } }))
  on('prompt.submit', ($: any, e: any) => (seen.submitted.push(e.text), { text: e.text }))
  on('turn.complete', ($: any, e: any) => ({ text: e.answer, usage: e.usage }))
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }))
  on('session.cwd', () => ({ value: '/w' }))
  on('session.id', () => ({ value: 's1' }))
  on('env.get', ($: any, e: any) => ({ value: e.name === 'HOME' ? '/home/u' : undefined }))
  on('fs.read', ($: any, e: any) => {
    const text = seen.files[e.path]
    if (text === undefined) return { deny: 'ENOENT: no such file' }
    return { value: text }
  })
  on('fs.write', ($: any, e: any) => ((seen.files[e.path] = e.text), { value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('process.run', ($: any, e: any) => {
    const argv = e.argv as string[]
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

async function start($: any) {
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
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
    await $.tool.call(call({ subagent_type: 'code-explorer' }) as never)
    expect(seen.beneath).toBe(0)
    expect(seen.stdin[0]).toContain('## Role instructions (code-explorer)')
    expect(seen.stdin[0]).toContain('You are a read-only code explorer.')
    const argv = seen.argv[0]!
    expect(argv[argv.indexOf('-s') + 1]).toBe('read-only')
  })

  test('an editing agent keeps workspace-write when configured', { options: { codexAgents: 'test-writer', codexSandbox: 'workspace-write', codexConsent: 'allow' } }, async ($, on) => {
    const seen = engine(on, { agents: { '/home/u/.claude/agents/test-writer.md': '---\nname: test-writer\ntools: Read, Write, Edit, Bash\n---\nWrite tests.' } })
    await start($)
    await $.tool.call(call({ subagent_type: 'test-writer' }) as never)
    const argv = seen.argv[0]!
    expect(argv[argv.indexOf('-s') + 1]).toBe('workspace-write')
    expect(seen.stdin[0]).toContain('Write tests.')
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
    const seen = engine(on, { agents: { '/w/.claude/agents/test-writer.md': '---\nname: test-writer\ntools: Read, Write, Edit\n---\nWrite tests.' } })
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
})

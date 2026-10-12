import { describe, expect, test } from 'claude-code/testing'

import {
  modelWarning, parseModelCatalog,
  agentResult, appendLog, buildHandoff, candidateOf, childEnv, codexArgv, effectiveSandbox, failureOf, foldAll,
  isRouted, codexRunning, sessionFolderOf, parseAgentFile, parseReviewArgs, parseRoutes, readOptions, reviewArgv, rowText, splitLines,
  statsText, summarize, verdictOf,
  claudeTaskOf, coerceConfigValue, deliveryText, findConfigField, liveCount, lostOnReload, modeOf, parseRunModes, pendingIdOf,
  roleDescription, roleOf, rolesFor, routeOf, routesLines, routesText, runsInBackground, typeKey, usageTokens, ROLES, LOST,
} from '../hooks/duet-logic'

// Captured from codex-cli 0.162.1: `codex exec --json -s read-only "Reply with the single word ok."`
const REAL_JSONL = [
  '{"type":"thread.started","thread_id":"01a1317d-0458-74c2-91a6-12d24585db32"}',
  '{"type":"item.completed","item":{"id":"item_0","type":"error","message":"Under-development features enabled: default_mode_request_user_input."}}',
  '{"type":"turn.started"}',
  '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"ok"}}',
  '{"type":"turn.completed","usage":{"input_tokens":22059,"cached_input_tokens":11264,"cache_write_input_tokens":0,"output_tokens":5,"reasoning_output_tokens":0}}',
].join('\n')

const EXPLORER = `---
name: code-explorer
description: Read-only codebase investigator.
tools: Read, Grep, Glob
---

You are a read-only code explorer.`

describe('routing and options', () => {
  test('routes parse; unlisted types stay on Claude; default type is general-purpose', () => {
    const r = parseRoutes('general-purpose, Explore , ')
    expect(r).toEqual(new Set(['general-purpose', 'Explore']))
    expect(isRouted(r, undefined)).toBe(true)
    expect(isRouted(r, 'Plan')).toBe(false)
    expect(isRouted(parseRoutes('*'), 'anything')).toBe(true)
    expect(isRouted(parseRoutes(''), 'general-purpose')).toBe(false)
  })

  test('options default safely and never exceed workspace-write', () => {
    const o = readOptions({})
    expect(o.sandbox).toBe('read-only')
    expect(o.maxConcurrent).toBe(2)
    expect(o.timeoutMs).toBe(20 * 60_000)
    expect(o.consent).toBe('ask')
    expect(readOptions({ codexSandbox: 'danger-full-access' }).sandbox).toBe('read-only')
    expect(readOptions({ codexSandbox: 'workspace-write' }).sandbox).toBe('workspace-write')
  })
})

describe('custom agents', () => {
  test('frontmatter and body; a read-only tool list clamps the sandbox', () => {
    const def = parseAgentFile(EXPLORER)
    expect(def?.name).toBe('code-explorer')
    expect(def?.tools).toEqual(['Read', 'Grep', 'Glob'])
    expect(def?.body).toBe('You are a read-only code explorer.')
    expect(effectiveSandbox('workspace-write', def)).toBe('read-only')
    expect(effectiveSandbox('workspace-write', parseAgentFile('---\nname: w\ntools: Read, Edit\n---\nx'))).toBe('workspace-write')
    expect(effectiveSandbox('workspace-write', parseAgentFile('---\nname: all\n---\nx'))).toBe('workspace-write')
    expect(effectiveSandbox('read-only', parseAgentFile('---\nname: w\ntools: Write\n---\nx'))).toBe('read-only')
    expect(parseAgentFile('no frontmatter')).toBeNull()
  })
})

describe('handoff', () => {
  test('carries task id, spec version, base, scope, prohibitions, required output, role and the prompt verbatim', () => {
    const { prompt, envelope } = buildHandoff({ id: 'd3', description: 'Find callers', prompt: 'List callers of parseConfig.', base: 'abc1234', cwd: '/w', sandbox: 'read-only', def: parseAgentFile(EXPLORER), subagentType: 'code-explorer' })
    for (const s of ['Task ID: d3', `Spec version: ${envelope.specVersion}`, 'Base commit: abc1234', 'Allowed scope: files under /w', 'Prohibited: no git commits', 'Required output:', '## Role instructions (code-explorer)', 'You are a read-only code explorer.', 'List callers of parseConfig.']) {
      expect(prompt).toContain(s)
    }
    expect(envelope.specVersion).toMatch(/^[0-9a-f]{7}$/)
  })
})

describe('codex process', () => {
  test('argv never asks, never bypasses, and reviews are read-only', () => {
    const a = codexArgv({ sandbox: 'workspace-write', model: '', cwd: '/w' })
    expect(a).toEqual(['codex', 'exec', '--json', '--skip-git-repo-check', '-s', 'workspace-write', '-c', 'approval_policy="never"', '-C', '/w', '-'])
    expect(codexArgv({ sandbox: 'danger-full-access' as never, model: 'm', cwd: '/w' })).toContain('read-only')
    const r = reviewArgv({ kind: 'base', ref: 'main' }, '')
    expect(r).toContain('sandbox_mode="read-only"')
    expect(r).toContain('approval_policy="never"')
    for (const argv of [a, r]) expect(argv.join(' ')).not.toMatch(/dangerously|approve-for-me|full-access/)
  })

  test('review args parse and reject option injection', () => {
    expect(parseReviewArgs('')).toEqual({ kind: 'uncommitted' })
    expect(parseReviewArgs('--base main')).toEqual({ kind: 'base', ref: 'main' })
    expect(parseReviewArgs('--commit abc123')).toEqual({ kind: 'commit', ref: 'abc123' })
    expect(parseReviewArgs('--base --dangerously-bypass-approvals-and-sandbox')).toBeNull()
    expect(parseReviewArgs('--base main extra')).toBeNull()
  })

  test('Claude credentials are blanked in Codex env', () => {
    const env = childEnv()
    for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN']) expect(env[k]).toBe('')
  })

  test('folds the real 0.162.1 JSONL; a mid-run error item is a warning', () => {
    const run = foldAll(REAL_JSONL)
    expect(run.text).toBe('ok')
    expect(run.usage).toEqual({ input: 22059, cached: 11264, output: 5 })
    expect(run.warnings.length).toBe(1)
    expect(run.isDone).toBe(true)
    expect(failureOf(run, 0, '')).toBe('')
    expect(failureOf(foldAll(''), 1, 'Error: not logged in')).toMatch(/codex login/)
    expect(failureOf(foldAll(''), 0, '')).toBe('codex finished without an answer')
  })

  test('streamed chunks split into whole lines', () => {
    const a = splitLines('', '{"a":1}\n{"b"')
    expect(a.lines).toEqual(['{"a":1}'])
    expect(splitLines(a.carry, ':2}\n').lines).toEqual(['{"b":2}'])
  })
})

describe('agent result', () => {
  test('has every field of the Agent completed record', () => {
    const r = agentResult({ id: 'd1', prompt: 'p', text: 'ok', footer: '[duet d1 · codex]', durationMs: 1234.6, run: foldAll(REAL_JSONL), model: '' })
    expect(r.status).toBe('completed')
    expect(r.agentId).toBe('duet-d1')
    expect(r.content[0]?.text).toBe('ok\n\n[duet d1 · codex]')
    expect(r.totalDurationMs).toBe(1235)
    expect(r.totalTokens).toBe(22064)
    expect(r.totalToolUseCount).toBe(0)
    expect(r.usage).toEqual({ input_tokens: 22059, output_tokens: 5, cache_creation_input_tokens: null, cache_read_input_tokens: 11264, server_tool_use: null, service_tier: null, cache_creation: null })
  })

  test('evidence and verdict lines', () => {
    // a tree already dirty before the run is not blamed on it
    expect(candidateOf(' M a.ts\n?? notes.md\n', ' M a.ts\n?? notes.md\n')).toBe('no files changed by this run')
    expect(candidateOf(' M a.ts\n', ' M a.ts\n?? tests/b.test.ts\n M c.ts\n')).toBe('files changed during this run: 2 (c.ts, tests/b.test.ts)')
    expect(candidateOf('', '')).toBe('no files changed by this run')
    expect(verdictOf('finding 1\n**verdict: changes requested (1 high, 0 medium, 0 low)**')).toBe('verdict: changes requested (1 high, 0 medium, 0 low)')
  })
})

describe('run log', () => {
  test('appends, summarizes per provider and type, and prints a table', () => {
    const line = (provider: 'codex' | 'claude', type: string, ms: number, tokens: number, ok: boolean) => ({ id: 'x', at: 0, provider, kind: 'agent' as const, type, model: '', ms, tokens, ok })
    let log = ''
    log = appendLog(log, line('codex', 'Explore', 1000, 100, true))
    log = appendLog(log, line('codex', 'Explore', 3000, 300, false))
    log = appendLog(log, line('claude', 'Explore', 2000, 200, true))
    expect(log.trim().split('\n').length).toBe(3)
    const rows = summarize(log + 'torn{\n')
    expect(rows).toEqual([
      { key: 'claude · Explore', runs: 1, okPct: 100, medianMs: 2000, medianTokens: 200 },
      { key: 'codex · Explore', runs: 2, okPct: 50, medianMs: 2000, medianTokens: 200 },
    ])
    expect(statsText(rows)).toContain('codex · Explore')
    expect(statsText([])).toMatch(/No runs recorded yet/)
  })

  test('rows fit their width', () => {
    const t = { id: 'd1', provider: 'codex' as const, kind: 'agent' as const, subagentType: 'general-purpose', model: 'gpt', status: 'running' as const, startedAt: 0, endedAt: null, tokens: 38000, description: 'x', detail: '', envelope: null }
    expect(rowText(t, 72_000, 80)).toContain('1m12s')
    expect(rowText(t, 72_000, 30)).toBe('d1 codex running 1m12s')
    expect(rowText(t, 72_000, 20).length).toBeLessThanOrEqual(20)
  })
})

describe('Codex model catalog', () => {
  test('parses slugs in order and refuses what is not the catalog', () => {
    const r = parseModelCatalog(JSON.stringify({ models: [{ slug: 'a', display_name: 'A', visibility: 'list' }, { slug: 'b', visibility: 'hide' }, { nope: 1 }] }))
    expect(r).toEqual({ models: [{ slug: 'a', name: 'A', description: '', isHidden: false }, { slug: 'b', name: 'b', description: '', isHidden: true }] })
    expect(parseModelCatalog('not json')).toEqual({ error: 'codex debug models did not print JSON.' })
    expect(parseModelCatalog('{"models":[]}')).toEqual({ error: 'codex debug models listed no models.' })
  })

  test('warns on an unknown slug and suggests the nearest close one', () => {
    const models = [{ slug: 'gpt-6-sol', name: '', description: '', isHidden: false }, { slug: 'gpt-6-luna', name: '', description: '', isHidden: false }]
    expect(modelWarning('gpt-6sol', models)).toBe('"gpt-6sol" is not in Codex\'s model list; did you mean gpt-6-sol?')
    expect(modelWarning('o3-ultra-max', models)).toBe('"o3-ultra-max" is not in Codex\'s model list.')
    expect(modelWarning('gpt-6-sol', models)).toBe('')
    expect(modelWarning('', models)).toBe('')
    expect(modelWarning('anything', [])).toBe('')
  })
})

describe('0.2.0 rules', () => {
  const opts = (raw: Record<string, unknown> = {}) => readOptions({ codexAgents: '*', ...raw })
  const advisor = roleOf('duet:codex-advisor')
  const reviewer = roleOf('duet:codex-reviewer')

  test('routeOf: roles go to Codex even named; codexAgents types skip named, isolated and nested calls', () => {
    const o = opts()
    expect(routeOf(o, { subagent_type: 'general-purpose', name: 'probe' })).toEqual({ to: 'claude' })
    expect(routeOf(o, { subagent_type: 'general-purpose', isolation: 'worktree' })).toEqual({ to: 'claude' })
    expect(routeOf(o, { subagent_type: 'general-purpose', agentId: 'a1' })).toEqual({ to: 'claude' })
    expect(routeOf(o, { subagent_type: 'general-purpose' })).toEqual({ to: 'codex', role: null })
    expect(routeOf(readOptions({ codexAgents: '' }), { subagent_type: 'duet:codex-reviewer', name: 'r' })).toEqual({ to: 'codex', role: reviewer })
    expect(routeOf(o, { subagent_type: 'duet:codex-advisor', agentId: 'a1' })).toMatchObject({ to: 'deny' })
    expect(routeOf(o, { subagent_type: 'duet:codex-advisor', isolation: 'remote' })).toMatchObject({ to: 'deny' })
    expect(roleOf('duet:nope')).toBeNull()
    expect(roleOf('codex-advisor')).toBeNull()
  })

  test('routesText states the exceptions, each role mode, and drops them when nothing is routed', () => {
    expect(routesText(opts())).toBe('codex ← every subagent type (named, isolated and nested calls stay on Claude), background · roles duet:codex-advisor (waits), duet:codex-reviewer (background) · sandbox read-only · max 2')
    expect(routesText(readOptions({ codexAgents: '' }))).toBe('codex ← nothing routed · roles duet:codex-advisor (waits), duet:codex-reviewer (background) · sandbox read-only · max 2')
    const w = readOptions({ codexAgents: 'Explore', codexSandbox: 'workspace-write', codexRunMode: 'wait, Plan=background, advisor=background' })
    expect(routesText(w)).toBe('codex ← Explore (named, isolated and nested calls stay on Claude), waits; Plan background · roles duet:codex-advisor (background), duet:codex-reviewer (background), duet:codex-implementer (waits) · sandbox workspace-write · max 2 · editing runs wait')
  })

  test('routesLines fit the pane: routes with exceptions, then roles and limits', () => {
    const [a, b] = routesLines(opts())
    expect(a).toBe('routes  codex ← every type · named, isolated, nested stay Claude')
    expect(b).toBe('roles   advisor waits · reviewer bg · others bg   read-only · max 2')
    expect(a.length).toBeLessThanOrEqual(74)
    expect(b.length).toBeLessThanOrEqual(74)
    expect(routesLines(readOptions({}))[0]).toBe('routes  codex ← nothing routed')
  })

  test('parseRunModes: a default and overrides; role aliases; bad parts named', () => {
    expect(parseRunModes('')).toEqual({ fallback: 'background', overrides: {} })
    expect(parseRunModes('wait, advisor=background, Explore=wait')).toEqual({ fallback: 'wait', overrides: { 'duet:codex-advisor': 'background', Explore: 'wait' } })
    expect(parseRunModes('foreground')).toEqual({ fallback: 'wait', overrides: {} })
    expect(typeKey('codex-reviewer')).toBe('duet:codex-reviewer')
    expect(typeKey('Duet:Codex-Reviewer')).toBe('duet:codex-reviewer')
    expect(typeKey('general-purpose')).toBe('general-purpose')
    expect(parseRunModes('later')).toEqual({ error: 'codexRunMode: "later" is not wait or background.' })
    expect(parseRunModes('advisor=soon')).toEqual({ error: 'codexRunMode: "advisor=soon" needs wait or background after =.' })
    expect(parseRunModes('=wait')).toMatchObject({ error: expect.stringContaining('needs a type before =') })
    expect(coerceConfigValue(findConfigField('mode')!, 'later')).toMatchObject({ error: expect.stringContaining('not wait or background') })
    expect(coerceConfigValue(findConfigField('mode')!, 'background, advisor=background')).toEqual({ value: 'background, advisor=background' })
    expect(readOptions({ codexRunMode: 'nonsense' }).runModes).toEqual({ fallback: 'background', overrides: {} })
  })

  test('parseRunModes (found by the live Codex review): no prototype keys; a second default is refused', () => {
    const o = readOptions({ codexRunMode: 'background' })
    expect(modeOf(o, 'constructor', null)).toBe('background')
    expect(modeOf(o, 'toString', null)).toBe('background')
    expect(modeOf(readOptions({ codexRunMode: 'background, __proto__=wait' }), '__proto__', null)).toBe('wait')
    expect(modeOf(readOptions({ codexRunMode: 'background, __proto__=wait' }), 'general-purpose', null)).toBe('background')
    expect(modeOf(readOptions({ codexRunMode: 'wait, constructor=background' }), 'constructor', null)).toBe('background')
    expect(parseRunModes('wait, background')).toEqual({ error: 'codexRunMode: "background" is a second default; give one, then type=mode overrides.' })
  })

  test('modeOf and runsInBackground: override, then role, then default; an editing run never', () => {
    const o = readOptions({ codexRunMode: 'background, Explore=wait' })
    expect(modeOf(o, 'duet:codex-advisor', advisor)).toBe('wait')
    expect(modeOf(o, 'duet:codex-reviewer', reviewer)).toBe('background')
    expect(modeOf(o, 'Explore', null)).toBe('wait')
    expect(modeOf(o, 'general-purpose', null)).toBe('background')
    expect(modeOf(readOptions({ codexRunMode: 'background, advisor=background' }), 'duet:codex-advisor', advisor)).toBe('background')
    expect(runsInBackground(o, 'read-only', 'general-purpose', null)).toBe(true)
    expect(runsInBackground(o, 'workspace-write', 'general-purpose', null)).toBe(false)
    expect(runsInBackground(o, 'read-only', 'duet:codex-advisor', advisor)).toBe(false)
  })

  test('roles: implementer only under workspace-write; descriptions match the mode', () => {
    expect(rolesFor('read-only').map(r => r.name)).toEqual(['codex-advisor', 'codex-reviewer'])
    expect(rolesFor('workspace-write').map(r => r.name)).toEqual(['codex-advisor', 'codex-reviewer', 'codex-implementer'])
    const impl = ROLES.find(r => r.name === 'codex-implementer')!
    expect(roleDescription(impl, 'background')).toContain('Claude waits for its answer')
    expect(roleDescription(reviewer!, 'background')).toMatch(/^Runs on Codex \(OpenAI\), not Claude\..*Answers in the background, as a message when it ends; it can't be messaged afterwards\.$/)
    for (const r of ROLES) expect(r.description).toContain('Runs on Codex (OpenAI), not Claude.')
  })

  test('deliveryText: success leads with the agent id; failure says it did not fall back', () => {
    const base = { id: 'd3', label: 'duet:codex-reviewer', model: 'gpt-6.1-sol', sandbox: 'read-only' as const, durationMs: 134_000, tokens: 61_000, text: 'verdict: approve', footer: '[duet d3 · codex]', failure: '' }
    expect(deliveryText(base)).toBe('Background agent duet-d3 (duet:codex-reviewer) finished on Codex · gpt-6.1-sol · read-only · 2m14s · 61k tok\n\nverdict: approve\n\n[duet d3 · codex]')
    expect(deliveryText({ ...base, model: '' })).toContain('finished on Codex · default model ·')
    expect(deliveryText({ ...base, failure: 'timed out after 20m' })).toBe('Background agent duet-d3 (duet:codex-reviewer) failed on Codex: timed out after 20m. It did not run on Claude either.')
  })

  test('lostOnReload marks only running Codex rows this module did not start; liveCount counts agent runs', () => {
    const t = (id: string, status: 'running' | 'done', kind: 'agent' | 'review' = 'agent', provider: 'codex' | 'claude' = 'codex') =>
      ({ id, provider, kind, subagentType: 'x', model: '', status, startedAt: 0, endedAt: null, tokens: 0, description: '', detail: '', envelope: null })
    const list = [t('d1', 'running'), t('d2', 'running'), t('d3', 'done'), t('d4', 'running', 'review'), t('c1', 'running', 'agent', 'claude')]
    expect(liveCount(list)).toBe(2)
    const r = lostOnReload(list, new Set(['d2']), 99)
    expect(r.lost.map(x => x.id)).toEqual(['d1', 'd4'])
    expect(r.lost[0]).toMatchObject({ status: 'error', detail: LOST, endedAt: 99 })
    expect(liveCount(r.tasks)).toBe(1)
    expect(lostOnReload([t('d1', 'done')], new Set(), 1).lost).toEqual([])
  })

  test('pendingIdOf, usageTokens and claudeTaskOf measure background Claude runs', () => {
    expect(pendingIdOf({ status: 'async_launched', agentId: 'a9' })).toBe('a9')
    expect(pendingIdOf({ status: 'teammate_spawned', agentId: 't1' })).toBe('t1')
    expect(pendingIdOf({ status: 'completed', agentId: 'a1' })).toBeNull()
    expect(pendingIdOf(undefined)).toBeNull()
    expect(usageTokens({ input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 })).toBe(10)
    expect(usageTokens(undefined)).toBe(0)
    const p = { startedAt: 1000, type: 'Explore', description: 'Map auth' }
    expect(claudeTaskOf(p, { usage: { input_tokens: 5, output_tokens: 5, model: 'm' }, isAborted: false, reason: 'answer' }, 4000)).toMatchObject({ provider: 'claude', status: 'done', tokens: 10, model: 'm', startedAt: 1000, endedAt: 4000, subagentType: 'Explore' })
    expect(claudeTaskOf(p, { isAborted: true, reason: 'aborted' }, 2000)).toMatchObject({ status: 'error', detail: 'aborted' })
  })
})

describe('review fixes', () => {
  test('an explicitly empty tools list is read-only; an absent one is every tool', () => {
    expect(parseAgentFile('---\nname: none\ntools: []\n---\nx')?.tools).toEqual([])
    expect(effectiveSandbox('workspace-write', parseAgentFile('---\nname: none\ntools: []\n---\nx'))).toBe('read-only')
    expect(effectiveSandbox('workspace-write', parseAgentFile('---\nname: none\ntools:\n---\nx'))).toBe('read-only')
    expect(parseAgentFile('---\nname: all\n---\nx')?.tools).toBeNull()
  })

  test('admission counts reviews too; session folders are filesystem-safe', () => {
    const t = (kind: 'agent' | 'review', status: 'running' | 'done') => ({ id: 'd1', provider: 'codex', kind, status }) as never
    expect(codexRunning([t('agent', 'running'), t('review', 'running'), t('review', 'done')])).toBe(2)
    expect(sessionFolderOf('a1b2-c3/../x')).toBe('a1b2-c3_.._x')
    expect(sessionFolderOf('')).toBe('unknown')
  })
})

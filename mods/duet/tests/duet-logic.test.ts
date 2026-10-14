import { describe, expect, test } from 'claude-code/testing'

import {
  modelWarning, parseModelCatalog,
  agentResult, appendLog, buildHandoff, candidateOf, hashablePaths, pathsOf, snapshotOf, childEnv, codexArgv, codexLaunch, effectiveSandbox, failureOf, foldAll,
  isInside, isProtectedPath, isRouted, codexRunning, parentOf, pathDirs, writePathsOf, consentText, fallbackFailure, limitText, BLANKED_ENV, sessionFolderOf, parseAgentFile, parseReviewArgs, parseRoutes, readOptions, reviewArgv, rowText, splitLines,
  statsText, summarize, verdictOf,
  claudeTaskOf, coerceConfigValue, deliveryText, findConfigField, liveCount, lostOnReload, modeOf, parseRunModes, pendingIdOf,
  roleDescription, roleOf, rolesFor, routeOf, routesLines, routesText, runsInBackground, typeKey, usageTokens, ROLES, LOST,
} from '../hooks/duet-logic'
import { BLANKED, PASSED_THROUGH } from './env-names'

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
    // Codex rejects a positional prompt next to --uncommitted/--base/--commit: the target must be last.
    expect(r.slice(-2)).toEqual(['--base', 'main'])
    expect(reviewArgv({ kind: 'uncommitted' }, 'm').slice(-3)).toEqual(['--uncommitted', '-m', 'm'])
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

  test('cloud-provider credentials are blanked in Codex env; what must reach Codex is left alone', () => {
    const env = childEnv()
    for (const k of BLANKED) expect([k, env[k]]).toEqual([k, ''])
    for (const k of PASSED_THROUGH) expect([k, k in env]).toEqual([k, false])
  })

  test("codexLaunch gives Codex's spawn the blanked env, and stdin only when there is input", () => {
    const launch = codexLaunch(['codex', 'exec', '--json'], 'the task')
    expect(launch).toEqual({ argv: ['codex', 'exec', '--json'], env: childEnv(), input: 'the task' })
    for (const k of BLANKED) expect([k, launch.env[k]]).toEqual([k, ''])
    expect(codexLaunch(['codex', 'exec', 'review'], undefined)).toEqual({ argv: ['codex', 'exec', 'review'], env: childEnv() })
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
    const snap = (porcelain: string, hashes: Record<string, string> = {}) => snapshotOf(porcelain, hashes)
    expect(candidateOf(snap(' M a.ts\n?? notes.md\n', { 'a.ts': 'h1' }), snap(' M a.ts\n?? notes.md\n', { 'a.ts': 'h1' }))).toBe('no files changed by this run')
    expect(candidateOf(snap(' M a.ts\n'), snap(' M a.ts\n?? tests/b.test.ts\n M c.ts\n'))).toBe('files changed during this run: 2 (c.ts, tests/b.test.ts)')
    // An already-modified file that the run modifies again: same status, new content.
    expect(candidateOf(snap(' M a.ts', { 'a.ts': 'h1' }), snap(' M a.ts', { 'a.ts': 'h2' }))).toBe('files changed during this run: 1 (a.ts)')
    // The leading space is part of the status: the path keeps its first character.
    expect(pathsOf(' M hooks/register.tsx\nR  old.ts -> new.ts\n D gone.ts')).toEqual([
      { status: ' M', path: 'hooks/register.tsx' },
      { status: 'R ', path: 'new.ts' },
      { status: ' D', path: 'gone.ts' },
    ])
    expect(hashablePaths(' M a.ts\n D gone.ts\n?? n.md')).toEqual(['a.ts', 'n.md'])
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
  test('an unresolved agent is read-only unless it is general-purpose; disallowedTools can take edits away', () => {
    expect(effectiveSandbox('workspace-write', null, 'general-purpose')).toBe('workspace-write')
    for (const type of ['Explore', 'Plan', 'some-plugin:agent', 'missing-file']) expect(effectiveSandbox('workspace-write', null, type)).toBe('read-only')
    const noEdits = parseAgentFile('---\nname: r\ndisallowedTools: Write, Edit, NotebookEdit, MultiEdit\n---\nx')
    expect(noEdits?.disallowed).toEqual(['Write', 'Edit', 'NotebookEdit', 'MultiEdit'])
    expect(effectiveSandbox('workspace-write', noEdits, 'r')).toBe('read-only')
    expect(effectiveSandbox('workspace-write', parseAgentFile('---\nname: w\ndisallowedTools: Write\n---\nx'), 'w')).toBe('workspace-write')
    expect(effectiveSandbox('workspace-write', parseAgentFile('---\nname: w\ntools: Edit\ndisallowedTools: [Edit]\n---\nx'), 'w')).toBe('read-only')
  })

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

describe('second review round', () => {
  test('the limit message counts every Codex run, reviews included', () => {
    expect(limitText(1, 1)).toBe('limit: 1 Codex run already running (maxConcurrent 1)')
    expect(limitText(2, 2)).toBe('limit: 2 Codex runs already running (maxConcurrent 2)')
  })

  test('a fallback that ran to its ceiling is a timeout, not a start failure', () => {
    expect(fallbackFailure('process killed', 600_000, 600_000)).toBe('timed out after 10m (the fallback runs at most 10 minutes)')
    expect(fallbackFailure('Timed out after 600000ms', 5, 600_000)).toStartWith('timed out after 10m')
    expect(fallbackFailure('spawn codex ENOENT', 5, 600_000)).toStartWith('codex not found on PATH')
    expect(fallbackFailure('permission denied\nmore', 5, 600_000)).toBe('codex could not start: permission denied')
  })

  test("Claude Code's provider credentials are blanked for Codex", () => {
    for (const name of ['ANTHROPIC_API_KEY', 'AWS_BEARER_TOKEN_BEDROCK', 'ANTHROPIC_FOUNDRY_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_VERTEX']) {
      expect(BLANKED_ENV).toContain(name)
    }
  })

  test('BLANKED_ENV is exactly the literal list, once each, and never names what must reach Codex', () => {
    const names: readonly string[] = BLANKED_ENV
    expect([...names].sort()).toEqual([...BLANKED].sort())
    expect(new Set(names).size).toBe(names.length)
    for (const name of PASSED_THROUGH) expect([name, names.includes(name)]).toEqual([name, false])
  })
})


describe('third review round: tool lists in any YAML form', () => {
  const agent = (frontmatter: string) => parseAgentFile(`---\nname: a\n${frontmatter}\n---\nx`)
  const sandboxOf = (frontmatter: string) => effectiveSandbox('workspace-write', agent(frontmatter), 'a')

  test('a block disallowedTools list takes edits away, indented or at the key indent', () => {
    expect(agent('disallowedTools:\n  - Write\n  - Edit\n  - NotebookEdit\n  - MultiEdit')?.disallowed).toEqual(['Write', 'Edit', 'NotebookEdit', 'MultiEdit'])
    expect(sandboxOf('disallowedTools:\n  - Write\n  - Edit\n  - NotebookEdit\n  - MultiEdit')).toBe('read-only')
    expect(sandboxOf('disallowedTools:\n- Write\n- Edit\n- NotebookEdit\n- MultiEdit')).toBe('read-only')
    expect(sandboxOf('disallowedTools:\n  - Write\n\n  # edits too\n  - Edit\n  - NotebookEdit\n  - MultiEdit\nmodel: sonnet')).toBe('read-only')
    expect(sandboxOf('disallowedTools:\n  - Write')).toBe('workspace-write')
  })

  test('a block tools list that grants an edit tool keeps workspace-write; one without stays read-only', () => {
    expect(agent('tools:\n  - Read\n  - Edit')?.tools).toEqual(['Read', 'Edit'])
    expect(sandboxOf('tools:\n  - Read\n  - Edit')).toBe('workspace-write')
    expect(sandboxOf('tools:\n  - Read\n  - Grep')).toBe('read-only')
    expect(sandboxOf('tools:\n  - Read\n  - Edit\ndisallowedTools:\n  - Edit')).toBe('read-only')
  })

  test('comments and permission specifiers name the whole tool', () => {
    expect(sandboxOf('disallowedTools: Write, Edit, NotebookEdit, MultiEdit # read only')).toBe('read-only')
    expect(sandboxOf('disallowedTools:\n  - Write # no writes\n  - Edit\n  - NotebookEdit\n  - MultiEdit')).toBe('read-only')
    expect(agent('disallowedTools: Write(src/**), Edit(src/**), NotebookEdit, MultiEdit')?.disallowed).toEqual(['Write', 'Edit', 'NotebookEdit', 'MultiEdit'])
    expect(sandboxOf('disallowedTools: Write(src/**), Edit(src/**), NotebookEdit, MultiEdit')).toBe('read-only')
    expect(agent('tools: Bash(git add:*, git commit:*), "Edit"')?.tools).toEqual(['Bash', 'Edit'])
    expect(agent('tools: C#Tool')?.tools).toEqual(['C#Tool'])
  })

  test('a # inside a quoted value or quoted item is not a comment; in an unquoted value it is', () => {
    expect(sandboxOf('disallowedTools: "x # y, Write, Edit, NotebookEdit, MultiEdit"')).toBe('read-only')
    expect(sandboxOf("disallowedTools: 'x # y, Write, Edit, NotebookEdit, MultiEdit' # all edits")).toBe('read-only')
    expect(sandboxOf('disallowedTools: ["x # y", Write, Edit, NotebookEdit, MultiEdit]')).toBe('read-only')
    expect(sandboxOf('disallowedTools:\n  - "x # y"\n  - Write\n  - Edit\n  - NotebookEdit\n  - MultiEdit')).toBe('read-only')
    expect(agent('tools: Read, Bash(echo "a # b"), Edit')?.tools).toEqual(['Read', 'Bash'])
  })

  test('a list value duet cannot read runs read-only', () => {
    for (const frontmatter of [
      'disallowedTools: >\n  Write, Edit, NotebookEdit, MultiEdit',
      'disallowedTools: |\n  Write',
      'disallowedTools: [Write, Edit,\n  NotebookEdit, MultiEdit]',
      'disallowedTools: Write, Edit,\n  NotebookEdit, MultiEdit',
      'disallowedTools:\n  Write, Edit, NotebookEdit, MultiEdit',
      'disallowedTools: &deny [Write]',
      'tools: {Edit: true}',
      'tools:\n  - Edit\n  nested: value',
      'disallowedTools: "Write # x", Edit, NotebookEdit, MultiEdit',
    ]) {
      expect(agent(frontmatter)?.isToolsUnread).toBe(true)
      expect(sandboxOf(frontmatter)).toBe('read-only')
    }
  })

  test('other fields keep their old reading; only tools and disallowedTools collect lists', () => {
    const def = agent('description: |\n  Reviews code.\n  - never edits\ntools: Read, Edit')
    expect(def?.isToolsUnread).toBeUndefined()
    expect(def?.description).toBe('|')
    expect(sandboxOf('description: Fixes issue #12\ntools: Read, Edit')).toBe('workspace-write')
    expect(agent('tools: [Read, Edit]')?.tools).toEqual(['Read', 'Edit'])
  })
})

describe('fourth review round: what the consent says Codex can reach', () => {
  test('both sandboxes say Codex can read beyond the project; only workspace-write mentions writes', () => {
    const ro = consentText('/w/proj', 'read-only')
    expect(ro).toContain('any file your user account can read, not only /w/proj')
    expect(ro).toContain('sends what it reads to OpenAI')
    expect(ro).toContain('It runs read-only and writes nothing.')
    const ww = consentText('/w/proj', 'workspace-write')
    expect(ww).toContain('any file your user account can read, not only /w/proj')
    expect(ww).toContain('can write inside /w/proj and in temporary folders such as /tmp')
    expect(ww).not.toContain('writes nothing')
  })
})

describe('issue 3 part B: codexFsScope limits what Codex can read and write', () => {
  const HOME = '/home/u'
  const fsScope = 'project' as never
  const project = (o: Record<string, unknown> = {}) => codexArgv({ sandbox: 'read-only', model: '', cwd: '/w/proj', home: HOME, fsScope, ...o } as never)
  /** The `-c permissions.duet-mod-fs-scope.filesystem=…` value, or '' when the argv has none. */
  const filesystem = (argv: string[]) => argv.find(a => a.startsWith('permissions.duet-mod-fs-scope.filesystem=')) ?? ''
  /** One `"path"="access"` entry of the table, the path as a TOML basic string (JSON's escapes for \ and " are TOML's). */
  const pair = (path: string, access: 'read' | 'write') => `${JSON.stringify(path)}="${access}"`
  const count = (text: string, what: string) => text.split(what).length - 1

  test('project scope adds a duet profile as the default and its filesystem table, and sets the sandbox with -c sandbox_mode, never -s (codex exec 0.162.1 drops the profile under -s)', () => {
    const argv = project()
    expect(argv).toContain('default_permissions="duet-mod-fs-scope"')
    const fs = filesystem(argv)
    expect(fs.startsWith('permissions.duet-mod-fs-scope.filesystem={')).toBe(true)
    expect(fs.endsWith('}')).toBe(true)
    const at = [argv.indexOf('default_permissions="duet-mod-fs-scope"'), argv.indexOf(fs)]
    for (const i of at) expect(argv[i - 1]).toBe('-c')
    const rest = argv.filter((_, i) => !at.some(a => i === a || i === a - 1))
    expect(rest).toEqual(['codex', 'exec', '--json', '--skip-git-repo-check', '-c', 'sandbox_mode="read-only"', '-c', 'approval_policy="never"', '-C', '/w/proj', '-'])
    expect(argv).not.toContain('-s')
    const writable = project({ sandbox: 'workspace-write' })
    expect(writable[writable.indexOf('sandbox_mode="workspace-write"') - 1]).toBe('-c')
    expect(writable).not.toContain('-s')
    expect(project({ model: 'gpt-x' }).slice(-3)).toEqual(['-m', 'gpt-x', '-'])
  })

  test('anything scope, or none, adds nothing: today\'s argv, whatever else is passed; project scope is the one that differs', () => {
    const today = ['codex', 'exec', '--json', '--skip-git-repo-check', '-s', 'workspace-write', '-c', 'approval_policy="never"', '-C', '/w/proj', '-']
    for (const extra of [{ fsScope: 'anything' }, { fsScope: 'anything', writePaths: ['tests'] }, { fsScope: undefined }]) {
      expect(project({ sandbox: 'workspace-write', ...extra })).toEqual(today)
    }
    expect(codexArgv({ sandbox: 'workspace-write', model: '', cwd: '/w/proj', home: HOME } as never)).toEqual(today)
    expect(project({ sandbox: 'workspace-write' })).not.toEqual(today)
  })

  test('under read-only the profile lets Codex read the built-in minimal set, the project and the Codex install folder, and nothing else', () => {
    const fs = filesystem(project())
    expect(fs).toContain('":minimal"="read"')
    expect(fs).toContain(pair('/w/proj', 'read'))
    expect(fs).toContain(pair('/home/u/.codex/packages', 'read'))
    expect(count(fs, '="read"')).toBe(3)
    expect(fs).not.toContain('="write"')
    expect(fs).not.toContain('/tmp')
  })

  test('under workspace-write the whole project is writable, still without /tmp', () => {
    const fs = filesystem(project({ sandbox: 'workspace-write' }))
    expect(fs).toContain(pair('/w/proj', 'write'))
    expect(fs).not.toContain(pair('/w/proj', 'read'))
    expect(fs).toContain(pair('/home/u/.codex/packages', 'read'))
    expect(fs).not.toContain('/tmp')
  })

  test('writePaths narrows workspace-write to those folders: the project is read, each folder is write', () => {
    const fs = filesystem(project({ sandbox: 'workspace-write', writePaths: ['tests', 'test/unit'] }))
    expect(fs).toContain(pair('/w/proj', 'read'))
    expect(fs).not.toContain(pair('/w/proj', 'write'))
    expect(fs).toContain(pair('/w/proj/tests', 'write'))
    expect(fs).toContain(pair('/w/proj/test/unit', 'write'))
    expect(count(fs, '="write"')).toBe(2)
  })

  test('writePaths never widens: under read-only nothing is writable', () => {
    const fs = filesystem(project({ sandbox: 'read-only', writePaths: ['tests'] }))
    expect(fs).toContain(pair('/w/proj', 'read'))
    expect(fs).not.toContain('="write"')
  })

  test('a writePaths entry that leaves the project is dropped; the ones inside stay', () => {
    const fs = filesystem(project({ sandbox: 'workspace-write', writePaths: ['../sib', '/etc', 'src/../..', '..', '../proj-evil', 'tests', '/home/u/.ssh'] }))
    expect(fs).toContain(pair('/w/proj/tests', 'write'))
    expect(count(fs, '="write"')).toBe(1)
    for (const gone of ['/w/sib', '/etc', '/w/proj-evil', '/home/u/.ssh']) expect(fs).not.toContain(gone)
    expect(fs).toContain(pair('/w/proj', 'read'))
  })

  test('writePaths with nothing inside the project leaves the whole project read-only, never writable', () => {
    const fs = filesystem(project({ sandbox: 'workspace-write', writePaths: ['../sib', '/etc'] }))
    expect(fs).toContain(pair('/w/proj', 'read'))
    expect(fs).not.toContain('="write"')
  })

  test('a project path with a quote and a backslash is escaped as a TOML string', () => {
    const cwd = 'C:\\Users\\me\\my "proj"'
    const argv = codexArgv({ sandbox: 'read-only', model: '', cwd, home: HOME, fsScope } as never)
    const fs = filesystem(argv)
    expect(fs).toContain(pair(cwd, 'read'))
    expect(fs).toContain('"C:\\\\Users\\\\me\\\\my \\"proj\\""="read"')
    expect(argv.slice(argv.indexOf('-C'), argv.indexOf('-C') + 2)).toEqual(['-C', cwd])
    expect(filesystem(codexArgv({ sandbox: 'workspace-write', model: '', cwd, home: HOME, fsScope } as never))).toContain(pair(cwd, 'write'))
  })

  test('a review gets the same profile read-only, keeps its flags, and still ends with its target; anything scope or none leaves it as it was', () => {
    const scope = { fsScope, cwd: '/w/proj', home: HOME } as never
    const base = reviewArgv({ kind: 'base', ref: 'main' }, '', scope)
    expect(base).toContain('default_permissions="duet-mod-fs-scope"')
    const fs = filesystem(base)
    expect(fs).toContain(pair('/w/proj', 'read'))
    expect(fs).toContain(pair('/home/u/.codex/packages', 'read'))
    expect(fs).not.toContain('="write"')
    expect(base).toContain('sandbox_mode="read-only"')
    expect(base).toContain('approval_policy="never"')
    expect(base.slice(-2)).toEqual(['--base', 'main'])
    expect(reviewArgv({ kind: 'uncommitted' }, 'm', scope).slice(-3)).toEqual(['--uncommitted', '-m', 'm'])
    const today = reviewArgv({ kind: 'commit', ref: 'abc123' }, '')
    expect(today.join(' ')).not.toContain('default_permissions')
    expect(reviewArgv({ kind: 'commit', ref: 'abc123' }, '', { fsScope: 'anything', cwd: '/w/proj', home: HOME } as never)).toEqual(today)
  })
})

describe('issue 3 part B: codexFsScope and codexWritePaths are read defensively', () => {
  const read = (o: Record<string, unknown>) => readOptions(o) as unknown as { fsScope: string; writePaths: Record<string, string[]>; sandbox: string }

  test('the scope is anything unless the manifest says project; the other options read as before', () => {
    expect(read({}).fsScope).toBe('anything')
    expect(read({ codexFsScope: 'anything' }).fsScope).toBe('anything')
    for (const junk of ['Project', 'all', '', 1, null, 'danger-full-access']) expect(read({ codexFsScope: junk }).fsScope).toBe('anything')
    const o = read({ codexSandbox: 'workspace-write', codexFsScope: 'project', codexWritePaths: 'a=b' })
    expect([o.fsScope, o.sandbox]).toEqual(['project', 'workspace-write'])
  })

  test('codexWritePaths reads agent=folder;folder entries, comma-separated, and is empty when unset', () => {
    expect(read({}).writePaths).toEqual({})
    expect(read({ codexWritePaths: '' }).writePaths).toEqual({})
    expect(read({ codexWritePaths: 'red-test-writer=tests;test' }).writePaths).toEqual({ 'red-test-writer': ['tests', 'test'] })
    expect(read({ codexWritePaths: ' red-test-writer = tests ; test , impl-writer=src ' }).writePaths).toEqual({ 'red-test-writer': ['tests', 'test'], 'impl-writer': ['src'] })
  })
})

describe('PR #39 review: the permission profile has its own name', () => {
  test('the profile is not named duet, so a [permissions.duet] in a loaded Codex config cannot merge into it and widen reads', () => {
    const argv = codexArgv({ sandbox: 'read-only', model: '', cwd: '/w/proj', fsScope: 'project' } as never)
    expect(argv).toContain('default_permissions="duet-mod-fs-scope"')
    expect(argv.some(a => a.startsWith('permissions.duet-mod-fs-scope.filesystem={'))).toBe(true)
    expect(argv).not.toContain('default_permissions="duet"')
    expect(argv.some(a => a.startsWith('permissions.duet.'))).toBe(false)
    const review = reviewArgv({ kind: 'uncommitted' }, '', { cwd: '/w/proj', fsScope: 'project' } as never)
    expect(review).toContain('default_permissions="duet-mod-fs-scope"')
  })
})

describe('PR #39 review: a malformed codexWritePaths fails closed', () => {
  test('a part that is not agent=folder;folder makes the whole option an error naming that part', () => {
    for (const bad of ['red-test-writer:tests', 'red-test-writer tests', 'red-test-writer=', '=tests', 'red test=tests', 'ok=src, red-test-writer:tests']) {
      const w = readOptions({ codexWritePaths: bad }).writePaths as unknown as { error?: unknown }
      expect(typeof w.error).toBe('string')
    }
    const w = readOptions({ codexWritePaths: 'ok=src, red-test-writer:tests' }).writePaths as unknown as { error: string }
    expect(w.error).toContain('red-test-writer:tests')
    expect(readOptions({ codexWritePaths: 'red-test-writer=tests, ' }).writePaths).toEqual({ 'red-test-writer': ['tests'] })
  })

  test('an empty folder list narrows to nothing: workspace-write leaves the project read-only, with no folder writable', () => {
    const argv = codexArgv({ sandbox: 'workspace-write', model: '', cwd: '/w/proj', fsScope: 'project', writePaths: [] } as never)
    const fs = argv.find(a => a.startsWith('permissions.duet-mod-fs-scope.filesystem=')) ?? ''
    expect(fs).toContain('"/w/proj"="read"')
    expect(fs).not.toContain('="write"')
  })

  test('/duet config paths rejects a malformed value and keeps a good one', () => {
    const f = findConfigField('paths')!
    expect('error' in coerceConfigValue(f, 'red-test-writer:tests')).toBe(true)
    expect(coerceConfigValue(f, 'red-test-writer=tests;test')).toEqual({ value: 'red-test-writer=tests;test' })
    expect(coerceConfigValue(f, '""')).toEqual({ value: '' })
  })
})

describe('PR #39 review: a write folder must land strictly inside the project', () => {
  test('isInside is true only for a path below the root, never the root itself or a sibling that shares its prefix', () => {
    expect(isInside('/w', '/w/tests')).toBe(true)
    expect(isInside('/w', '/w/a/b')).toBe(true)
    expect(isInside('/w', '/w')).toBe(false)
    expect(isInside('/w', '/wx/tests')).toBe(false)
    expect(isInside('/w', '/outside')).toBe(false)
    expect(isInside('C:\\w', 'C:\\w\\tests')).toBe(true)
    expect(isInside('C:\\w', 'C:\\wx')).toBe(false)
  })
})

describe('PR #39 review: git\'s own folders are readable in a linked worktree', () => {
  const fsOf = (argv: string[]) => argv.find(a => a.startsWith('permissions.duet-mod-fs-scope.filesystem=')) ?? ''
  test('reads outside the project are added read-only; ones inside the project, repeated or not absolute are not', () => {
    const reads = ['/repo/.git/worktrees/wt', '/repo/.git', '/repo/.git', '/w/wt/.git', 'abc1234']
    for (const sandbox of ['read-only', 'workspace-write']) {
      const fs = fsOf(codexArgv({ sandbox, model: '', cwd: '/w/wt', fsScope: 'project', reads } as never))
      expect(fs).toContain('"/repo/.git/worktrees/wt"="read"')
      expect(fs.split('"/repo/.git"="read"').length - 1).toBe(1)
      expect(fs).not.toContain('/w/wt/.git')
      expect(fs).not.toContain('abc1234')
    }
    const review = fsOf(reviewArgv({ kind: 'uncommitted' }, '', { cwd: '/w/wt', fsScope: 'project', reads } as never))
    expect(review).toContain('"/repo/.git"="read"')
    expect(codexArgv({ sandbox: 'read-only', model: '', cwd: '/w/wt', fsScope: 'anything', reads } as never).join(' ')).not.toContain('/repo/.git')
  })
})

describe('PR #39 review: Codex\'s real install folder', () => {
  test('pathDirs keeps PATH\'s absolute folders in order; parentOf gives the folder holding a path', () => {
    expect(pathDirs('/usr/local/bin:/home/u/.local/bin::relative/bin:/opt/codex/bin/')).toEqual(['/usr/local/bin', '/home/u/.local/bin', '/opt/codex/bin'])
    expect(pathDirs('')).toEqual([])
    expect(parentOf('/home/u/.codex/packages/standalone/releases/0.162.1/bin/codex')).toBe('/home/u/.codex/packages/standalone/releases/0.162.1/bin')
    expect(parentOf('/usr/lib/node_modules/@openai/codex/bin/codex.js')).toBe('/usr/lib/node_modules/@openai/codex/bin')
  })

  test('a command that fails because the sandbox cannot run Codex itself makes the run fail, naming the binary, instead of done', () => {
    const lines = [
      { type: 'thread.started', thread_id: 't1' },
      { type: 'item.completed', item: { id: 'i1', type: 'command_execution', command: '/bin/bash -lc ls', aggregated_output: 'bwrap: execvp /opt/codex/bin/codex: No such file or directory\n', exit_code: 1, status: 'failed' } },
      { type: 'item.completed', item: { id: 'i2', type: 'agent_message', text: 'I could not list the files.' } },
      { type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 5 } },
    ].map(l => JSON.stringify(l)).join('\n')
    const run = foldAll(lines)
    expect(run.failure).toContain('/opt/codex/bin/codex')
    expect(run.failure).toContain('install folder')
    const ok = foldAll([{ type: 'item.completed', item: { type: 'command_execution', aggregated_output: 'bwrap is a word here', exit_code: 0 } }, { type: 'item.completed', item: { type: 'agent_message', text: 'fine' } }].map(l => JSON.stringify(l)).join('\n'))
    expect(ok.failure).toBe('')
  })
})

describe('PR #39 review: the gaps /code-review listed', () => {
  const fsOf = (argv: string[]) => argv.find(a => a.startsWith('permissions.duet-mod-fs-scope.filesystem=')) ?? ''

  test('writePathsOf: a malformed option gives no folder, a named type or role alias its folders, an unnamed type undefined', () => {
    expect(writePathsOf({ error: 'bad' }, 'red-test-writer')).toEqual([])
    const w = readOptions({ codexWritePaths: 'implementer=src, red-test-writer=tests' }).writePaths
    expect(writePathsOf(w, 'duet:codex-implementer')).toEqual(['src'])
    expect(writePathsOf(w, 'codex-implementer')).toEqual(['src'])
    expect(writePathsOf(w, 'red-test-writer')).toEqual(['tests'])
    expect(writePathsOf(w, 'impl-writer')).toBe(undefined)
    expect(writePathsOf(w, '__proto__')).toBe(undefined)
  })

  test('a write folder that folds back to the project itself is dropped, so it never makes the project writable', () => {
    const fs = fsOf(codexArgv({ sandbox: 'workspace-write', model: '', cwd: '/w/proj', fsScope: 'project', writePaths: ['.', 'src/..', './'] } as never))
    expect(fs).toContain('"/w/proj"="read"')
    expect(fs).not.toContain('="write"')
  })

  test('with no home folder the profile has no ~/.codex/packages entry, only what reads gives', () => {
    const fs = fsOf(codexArgv({ sandbox: 'read-only', model: '', cwd: '/w/proj', fsScope: 'project', reads: ['/opt/codex/bin'] } as never))
    expect(fs).not.toContain('.codex/packages')
    expect(fs).toContain('"/opt/codex/bin"="read"')
  })

  test('the first failure stands: a later bwrap line does not replace it', () => {
    const lines = [
      { type: 'error', message: 'stream error' },
      { type: 'item.completed', item: { type: 'command_execution', aggregated_output: 'bwrap: execvp /x/codex: No such file or directory' } },
    ].map(l => JSON.stringify(l)).join('\n')
    expect(foldAll(lines).failure).toBe('stream error')
  })
})

describe('issue 3 part B: the scope help matches what was checked', () => {
  test('the /duet config help for scope says it was checked through codex exec on Codex 0.162.1, not that it is unchecked', () => {
    const help = findConfigField('scope')!.help
    expect(help).toContain('codex exec')
    expect(help).toContain('0.162.1')
    expect(help).not.toContain('not yet')
  })

  test('the scope help says hiding /tmp is checked on Linux only: on macOS, :minimal lets Seatbelt grant /private/tmp (PR #39 review)', () => {
    const help = findConfigField('scope')!.help
    expect(help).toMatch(/Linux only|Linux; not macOS/)
  })
})

describe('PR #39 review round 2: a write folder never reaches what Codex protects', () => {
  const fsOf = (argv: string[]) => argv.find(a => a.startsWith('permissions.duet-mod-fs-scope.filesystem=')) ?? ''

  test('isProtectedPath is true for a .git, .codex or .agents folder under the root and anything below one; never for other names or another root', () => {
    for (const path of ['/w/.git', '/w/.git/hooks', '/w/.codex', '/w/.codex/config.toml', '/w/.agents', '/w/.agents/skills', '/w/vendor/lib/.git/hooks']) expect(isProtectedPath('/w', path)).toBe(true)
    for (const path of ['/w', '/w/src', '/w/.github', '/w/.gitignore', '/w/.codexrc', '/w/agents', '/x/.git', '/wx/.git']) expect(isProtectedPath('/w', path)).toBe(false)
  })

  test('a named write folder in .git, .codex or .agents is dropped from the profile; the others stay writable', () => {
    const fs = fsOf(codexArgv({ sandbox: 'workspace-write', model: '', cwd: '/w', fsScope: 'project', writePaths: ['.git/hooks', '.codex', './.agents/skills', 'src'] } as never))
    expect(fs).toContain('"/w/src"="write"')
    expect(fs).toContain('"/w"="read"')
    for (const gone of ['/w/.git', '/w/.codex', '/w/.agents']) expect(fs).not.toContain(gone)
  })
})

describe('PR #39 review round 2: only a failed command with a bwrap line is a sandbox failure', () => {
  const cmd = (aggregated_output: string, exit_code: number | null) => ({ type: 'item.completed', item: { type: 'command_execution', command: 'x', aggregated_output, exit_code, status: exit_code ? 'failed' : 'completed' } })
  const fold = (...items: object[]) => foldAll([...items, { type: 'item.completed', item: { type: 'agent_message', text: 'answer' } }].map(l => JSON.stringify(l)).join('\n'))

  test('a command that succeeds, whose output quotes the bwrap line (a git diff or cat of duet itself), leaves the run done', () => {
    const quoted = "+      const unrunnable = /bwrap: execvp (\\S+): No such file or directory/\n  'bwrap: execvp /opt/codex/bin/codex: No such file or directory'\n"
    const run = fold(cmd(quoted, 0))
    expect(run.failure).toBe('')
    expect(run.text).toBe('answer')
  })

  test('a failed command that only quotes the line mid-text is not a sandbox failure; one whose output line starts with it is', () => {
    expect(fold(cmd("grep: x\n  see 'bwrap: execvp /x/codex: No such file or directory'\n", 1)).failure).toBe('')
    expect(fold(cmd('some noise\nbwrap: execvp /x/codex: No such file or directory\n', 1)).failure).toContain('/x/codex')
  })
})

describe('PR #39 review round 2: the profile table and its name', () => {
  const tableOf = (argv: string[]) => argv.find(a => /^permissions\.[\w-]+\.filesystem=/.test(a)) ?? ''

  test('with CODEX_HOME=$HOME/.codex, ~/.codex/packages is in the table once: TOML refuses a repeated key, and Codex would not start', () => {
    const fs = tableOf(codexArgv({ sandbox: 'read-only', model: '', cwd: '/w', fsScope: 'project', home: '/home/u', reads: ['/home/u/.codex/packages', '/home/u/.codex//packages/', '/opt/codex/bin'] } as never))
    expect(fs.split('"/home/u/.codex/packages"').length - 1).toBe(1)
    expect(fs).not.toContain('//packages')
    expect(fs).toContain('"/opt/codex/bin"="read"')
  })
})

import { describe, expect, test } from 'claude-code/testing'

import {
  modelWarning, parseModelCatalog,
  agentResult, appendLog, buildHandoff, candidateOf, hashablePaths, pathsOf, snapshotOf, childEnv, codexArgv, codexLaunch, effectiveSandbox, failureOf, foldAll,
  isInside, isProtectedPath, isRouted, resolveFrom, codexRunning, parentOf, pathDirs, writePathsOf, consentText, fallbackFailure, limitText, BLANKED_ENV, sessionFolderOf, parseAgentFile, parseReviewArgs, parseRoutes, readOptions, reviewArgv, rowText, splitLines,
  footerOf, statsText, summarize, verdictOf,
  claudeTaskOf, coerceConfigValue, configText, deliveryText, findConfigField, liveCount, lostOnReload, modeOf, parseRunModes, pendingIdOf,
  roleDescription, roleOf, rolesFor, routeOf, routesLines, routesText, runsInBackground, typeKey, usageTokens, ROLES, LOST,
} from '../hooks/duet-logic'
import * as logic from '../hooks/duet-logic'
import type { Task } from '../types'
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

describe('0.3.1 (issue #115): /duet config text', () => {
  test('a refused apiCustomUrl never echoes a password, and names every local host it allows', () => {
    const r = coerceConfigValue(findConfigField('customurl')!, 'https://bob:hunter2@gw.example.com/v1')
    expect('error' in r && r.error.includes('hunter2')).toBe(false)
    expect('error' in r && r.error).toContain('[::1]')
    expect('error' in r && r.error).toContain('https://***@gw.example.com/v1')
  })

  test('/duet config list keeps its columns aligned for the wider aliases', () => {
    const lines = configText({}).split('\n')
    const at = (field: string) => lines.find(l => l.includes(` ${field} `))!.indexOf(field)
    expect(at('apiCustomUrl')).toBe(at('codexWritePaths'))
    expect(at('apiCustomModel')).toBe(at('codexWritePaths'))
  })
})

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

  test('deliveryText: a failure keeps the cut-short search note on its own line (PR #48 review); an empty note adds nothing', () => {
    const note = 'duet: the search for the reader agent definition was cut short at 8 folders deep; a definition past that was not read, so Claude may use a different one.'
    const failed = { id: 'd3', label: 'reader', model: '', sandbox: 'read-only' as const, durationMs: 0, tokens: 0, text: '', footer: '', failure: 'timed out after 20m', searchNote: note }
    const plain = { ...failed, searchNote: '' }
    expect(deliveryText(failed)).toBe(`Background agent duet-d3 (reader) failed on Codex: timed out after 20m. It did not run on Claude either.\n${note}`)
    expect(deliveryText(plain)).toBe('Background agent duet-d3 (reader) failed on Codex: timed out after 20m. It did not run on Claude either.')
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

  test('an empty - item in a block list names no tool; the items around it are still read', () => {
    expect(agent('tools:\n  -\n  - Read\n  - Edit')?.tools).toEqual(['Read', 'Edit'])
    expect(sandboxOf('tools:\n  - Read\n  -\n  - Edit')).toBe('workspace-write')
    expect(agent('disallowedTools:\n  -\n  - Edit')?.disallowed).toEqual(['Edit'])
    expect(sandboxOf('tools:\n  - Read\n  - Edit\ndisallowedTools:\n  -\n  - Edit')).toBe('read-only')
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
    // 0.3.0: under codexFsScope anything the question names the provider key file, which Codex can read like any file.
    expect(consentText('/w/proj', 'read-only', '~/.claude/duet-data/.env')).toContain('your provider key file ~/.claude/duet-data/.env')
    expect(consentText('/w/proj', 'read-only')).not.toContain('key file')
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

  test('a failed command with no output at all is not a sandbox failure', () => {
    const run = foldAll([{ type: 'item.completed', item: { type: 'command_execution', command: 'false', exit_code: 1, status: 'failed' } }, { type: 'item.completed', item: { type: 'agent_message', text: 'answer' } }].map(l => JSON.stringify(l)).join('\n'))
    expect(run.failure).toBe('')
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

  test('a nonce makes the profile name one no config can know; default_permissions names that profile; the nonce keeps letters and digits only', () => {
    const argv = codexArgv({ sandbox: 'read-only', model: '', cwd: '/w', fsScope: 'project', nonce: 'ab12-CD34' } as never)
    expect(argv).toContain('default_permissions="duet-mod-fs-scope-ab12CD34"')
    expect(tableOf(argv).startsWith('permissions.duet-mod-fs-scope-ab12CD34.filesystem={')).toBe(true)
    const review = reviewArgv({ kind: 'uncommitted' }, '', { cwd: '/w', fsScope: 'project', nonce: 'x.y"z' } as never)
    expect(review).toContain('default_permissions="duet-mod-fs-scope-xyz"')
    expect(review.some(a => a.startsWith('permissions.duet-mod-fs-scope-xyz.filesystem='))).toBe(true)
  })
})

describe('PR #39 review round 2: a read grant never covers the home folder or the project', () => {
  const tableOf = (argv: string[]) => argv.find(a => /^permissions\.[\w-]+\.filesystem=/.test(a)) ?? ''

  test('a read that is the home folder, or holds it or the project, is dropped; narrower ones stay', () => {
    const fs = tableOf(codexArgv({ sandbox: 'read-only', model: '', cwd: '/home/u/proj', fsScope: 'project', home: '/home/u', reads: ['/home/u', '/home/u/', '/home', '/', '/home/u/bin', '/opt/codex/bin'] } as never))
    for (const gone of ['"/home/u"=', '"/home/u/"=', '"/home"=', '"/"=']) expect(fs).not.toContain(gone)
    expect(fs).toContain('"/home/u/bin"="read"')
    expect(fs).toContain('"/opt/codex/bin"="read"')
    const homeless = tableOf(codexArgv({ sandbox: 'read-only', model: '', cwd: '/srv/proj', fsScope: 'project', reads: ['/srv', '/srv/other'] } as never))
    expect(homeless).not.toContain('"/srv"=')
    expect(homeless).toContain('"/srv/other"="read"')
  })
})

describe('PR #39 review round 2: git\'s answers without --path-format', () => {
  test('resolveFrom keeps an absolute path and resolves a relative one against the folder, .. included', () => {
    expect(resolveFrom('/w', '/main/.git')).toBe('/main/.git')
    expect(resolveFrom('/w', '.git')).toBe('/w/.git')
    expect(resolveFrom('/w/sub', '../../main/./.git')).toBe('/main/.git')
    expect(resolveFrom('/w', '../../..')).toBe('/')
  })
})

describe('PR #39 review round 2: a dropped write folder is reported', () => {
  test('the footer names the codexWritePaths folders that were dropped; with none, it is as before', () => {
    const base = { id: 'x1', model: '', sandbox: 'workspace-write' as const, base: 'abc1234', candidate: '' }
    const footer = footerOf({ ...base, dropped: ['tests', 'cfg'] } as never)
    expect(footer).toContain('not writable: tests, cfg')
    expect(footerOf({ ...base, dropped: [] } as never)).toBe(footerOf(base))
  })
})

describe('the footer names the model', () => {
  test('a set model follows codex in the footer; none leaves codex alone', () => {
    const base = { id: 'x1', model: '', sandbox: 'read-only' as const, base: 'abc1234', candidate: '' }
    expect(footerOf({ ...base, model: 'gpt-5.5' })).toContain('[duet x1 · codex gpt-5.5 · sandbox read-only')
    expect(footerOf(base)).toContain('[duet x1 · codex · sandbox read-only')
  })
})

describe('PR #39 review round 2: the scope help says what macOS allows', () => {
  test('on macOS, /tmp is readable and writable under the profile, not just reachable (Codex 0.162.1 seatbelt_scratch.rs adds it as a write root)', () => {
    const help = findConfigField('scope')!.help
    expect(help).toMatch(/macOS[^.;]*\/tmp[^.;]*writable/)
  })
})

describe('issue 4: pickAgent resolves a custom agent by Claude\'s rules', () => {
  // Issue #44: `pickAgent(texts, type)` takes the file texts of ONE `.claude/agents` folder; which folder wins is `agentDef`'s loop.
  // It is reached through the namespace and a throw is caught and asserted away, so a missing export or the old
  // `{ root, path, text }` call shape fails by assertion rather than by an error.
  type Picked = { body: string; tools: string[] | null } | null
  const pick = (texts: string[], type: string): Picked => {
    let picked: Picked = null
    let threw = ''
    try {
      picked = (logic as any).pickAgent(texts, type)
    } catch (err) {
      threw = String((err as Error)?.message ?? err)
    }
    expect(typeof (logic as any).pickAgent).toBe('function')
    expect(threw).toBe('')
    return picked
  }
  const definition = (fields: string, body = 'Do the work.') => `---\n${fields}\n---\n${body}`
  const agent = (name: string, tools: string, body = 'Do the work.') => definition(`name: ${name}\ndescription: An agent.\ntools: ${tools}`, body)
  const EDITS = 'Read, Write, Edit'
  const READS = 'Read, Grep'
  const sandboxOf = (def: Picked, type: string) => effectiveSandbox('workspace-write', def as never, type)

  test('a definition is matched by its name field, not by its file name', () => {
    const def = pick([agent('reader', READS, 'Read only.'), agent('other', EDITS, 'Not the reader.')], 'reader')
    expect(def?.body).toBe('Read only.')
    expect(def?.tools).toEqual(['Read', 'Grep'])
  })

  test('a quoted name, and one with a trailing comment, still match', () => {
    for (const name of ['"reader"', "'reader'", 'reader # the reader', '"reader" # the reader', "'reader'   #x"]) {
      const def = pick([agent(name, READS, `Body of ${name}.`)], 'reader')
      expect([name, def?.body]).toEqual([name, `Body of ${name}.`])
    }
  })

  test('a file with no name is documentation, even when its file name is the type; so is one with no frontmatter', () => {
    const documentation = definition('description: Notes about the reader.\ntools: Read', 'Notes.')
    expect(pick([documentation], 'reader')).toBeNull()
    expect(pick(['Just notes, no frontmatter.'], 'reader')).toBeNull()
  })

  test('a name or description whose value starts on the next indented line is read, as Claude reads it (PR #43 review)', () => {
    // Probed on 2.1.299 and 2.1.300: Claude loads these; duet read each value as empty and skipped the file.
    const nextLine = definition('name:\n  general-purpose\ndescription:\n  Reads things\ntools: Read', 'Only reads.')
    const def = pick([nextLine], 'general-purpose')
    expect(def?.body).toBe('Only reads.')
    expect(sandboxOf(def, 'general-purpose')).toBe('read-only')
    const continued = definition('name: reader\ndescription: starts here\n  and goes on\ntools: Read', 'Continued.')
    expect(pick([continued], 'reader')?.body).toBe('Continued.')
    const folded = definition('name: reader\ndescription: >\n  folded text\ntools: Read', 'Folded.')
    expect(pick([folded], 'reader')?.body).toBe('Folded.')
  })

  test('a file with a name but no description is skipped, and a later text in the same folder is used instead', () => {
    const noDescription = definition('name: reader\ntools: Write', 'No description.')
    expect(pick([noDescription], 'reader')).toBeNull()
    const def = pick([noDescription, agent('reader', READS, 'Described.')], 'reader')
    expect(def?.body).toBe('Described.')
  })

  test('a name that starts with -, contains a colon or is over 256 characters is skipped; 256 is fine', () => {
    for (const name of ['-reader', 'my:reader', 'a'.repeat(257)]) {
      expect([name.slice(0, 12), pick([agent(name, READS)], name)]).toEqual([name.slice(0, 12), null])
    }
    const longest = 'a'.repeat(256)
    expect(pick([agent(longest, READS, 'Longest.')], longest)?.body).toBe('Longest.')
  })

  test('two files with one name in one folder, one editing and one not: read-only, never a miss, in either order', () => {
    const writes = agent('reader', EDITS, 'Writes.')
    const reads = agent('reader', READS, 'Reads.')
    for (const texts of [[writes, reads], [reads, writes]]) {
      const def = pick(texts, 'reader')
      expect(def ?? null).not.toBeNull()
      expect(sandboxOf(def, 'reader')).toBe('read-only')
    }
  })

  test('the same conflict under general-purpose is read-only, not the editing default of a miss', () => {
    const def = pick([agent('general-purpose', EDITS), agent('general-purpose', READS)], 'general-purpose')
    expect(def ?? null).not.toBeNull()
    expect(sandboxOf(def, 'general-purpose')).toBe('read-only')
  })

  test('a general-purpose.md that cannot edit is read-only, not the editing default of a miss', () => {
    const def = pick([agent('general-purpose', 'Read')], 'general-purpose')
    expect(def ?? null).not.toBeNull()
    expect(sandboxOf(def, 'general-purpose')).toBe('read-only')
  })

  test('two files with one name in one folder that can both edit: editing', () => {
    const def = pick([agent('reader', EDITS, 'One.'), agent('reader', 'Read, Edit', 'Two.')], 'reader')
    expect(def ?? null).not.toBeNull()
    expect(sandboxOf(def, 'reader')).toBe('workspace-write')
  })

  test('no file with that name is null: none at all, or only other names', () => {
    expect(pick([], 'reader')).toBeNull()
    expect(pick([agent('writer', EDITS), agent('readers', EDITS)], 'reader')).toBeNull()
  })
})

describe('issue 44: a search cut short runs read-only (PR #48 review)', () => {
  test('a cut-short search lowers workspace-write to read-only, for a miss under general-purpose and for an editing definition alike; an uncut one is unchanged', () => {
    const editor = parseAgentFile('---\nname: e\ndescription: d\ntools: Read, Edit\n---\nx')
    expect(effectiveSandbox('workspace-write', null, 'general-purpose', true)).toBe('read-only')
    expect(effectiveSandbox('workspace-write', editor, 'e', true)).toBe('read-only')
    expect(effectiveSandbox('workspace-write', null, 'general-purpose', false)).toBe('workspace-write')
    expect(effectiveSandbox('workspace-write', editor, 'e')).toBe('workspace-write')
  })
})

describe('PR #52 review: a dismissed consent question is not "nobody could be asked"', () => {
  // What $.ui.ask rejects with, probed live on 2.1.300: on Esc, and under claude -p.
  const ESC = new Error("duet: $.ui.ask: no answer (The user doesn't want to proceed with this tool use. The tool use was rejected)")
  const HEADLESS = new Error('duet: $.tool.call: no tool named "AskUserQuestion" in this session')
  const NOBODY = 'nobody could be asked to allow sending this repo to Codex (set duet codexConsent to allow for headless runs)'
  const refusal = (err: unknown) => ((logic as Record<string, unknown>).consentRefusal as ((e: unknown) => string) | undefined)?.(err)

  test('a question that got no answer was dismissed and is asked again; one that could not be asked says how to allow headless runs', () => {
    expect(refusal(ESC)).toBe('the consent question was dismissed; it is asked again next time')
    expect(refusal(HEADLESS)).toBe(NOBODY)
    expect(refusal(new Error('no implementation for tool.call'))).toBe(NOBODY)
    expect(refusal('not an error')).toBe(NOBODY)
    expect(refusal(undefined)).toBe(NOBODY)
  })
})

describe('issue 6: the fallback cap is documented in the config help and shown on a running row', () => {
  const NOTE = 'fallback: stops at 10m (timeoutMinutes 20)'
  const row = (over: Partial<Task> = {}): Task => ({ id: 'd1', provider: 'codex', kind: 'agent', subagentType: 'Explore', model: '', status: 'running', startedAt: 0, endedAt: null, tokens: 0, description: 'Find callers', detail: '', envelope: null, ...over })

  test('the timeoutMinutes help, shown by /duet config list and the config pane, says a one-shot fallback run stops at 10 minutes', () => {
    const help = findConfigField('timeout')!.help
    expect(help).toMatch(/one-shot/)
    expect(help).toMatch(/10 minutes/)
  })

  test('a running row shows its non-empty detail under it, and shows the description when it has none', () => {
    expect(logic.subText(row({ detail: NOTE }), 80)).toContain(NOTE)
    expect(logic.subText(row(), 80)).toBe('"Find callers"')
  })

  test('the note on a running row is cut to the row width with an ellipsis, like any sub line', () => {
    expect(logic.subText(row({ detail: NOTE }), 20)).toBe(`${NOTE.slice(0, 19)}…`)
  })
})

describe('issue 6 review: the fallback note appears only when the cap cuts timeoutMinutes', () => {
  const note = (timeoutMs: number) => ((logic as Record<string, unknown>).fallbackNote as ((t: number) => string) | undefined)?.(timeoutMs)

  test('timeoutMinutes 20 gets the note the running row shows', () => {
    expect(note(20 * 60_000)).toBe('fallback: stops at 10m (timeoutMinutes 20)')
  })

  test('timeoutMinutes 10 or less gets no note, since the cap changes nothing', () => {
    expect(note(10 * 60_000)).toBe('')
    expect(note(5 * 60_000)).toBe('')
  })
})

describe('issue 6 review (Codex P2): the fallback cap is readable where the config shows it', () => {
  const help = () => findConfigField('timeout')!.help
  const timeoutRow = (raw: unknown) => logic.configText(raw).split('\n').find(l => l.includes('timeoutMinutes'))!

  test('the help line fits the config pane uncut (opened at 76 columns, 74 for text) and says 10 minutes is a maximum', () => {
    expect(('timeoutMinutes: ' + help()).length <= 74).toBe(true)
    expect(help()).toMatch(/10 minutes (max|at most)/)
  })

  test('/duet config shows the cap on the timeoutMinutes row when the timeout is longer than it, and not otherwise', () => {
    expect(timeoutRow(undefined)).toMatch(/one-shot fallback.*10 minutes/)
    expect(timeoutRow({ timeoutMinutes: 20 })).toMatch(/one-shot fallback.*10 minutes/)
    expect(timeoutRow({ timeoutMinutes: 10 })).not.toMatch(/one-shot/)
    expect(timeoutRow({ timeoutMinutes: 5 })).not.toMatch(/one-shot/)
  })
})

describe('issue 7: mergeLogs joins the per-session run logs for /duet stats', () => {
  const line = (provider: 'codex' | 'claude', type: string, ms: number, tokens: number, ok: boolean) => ({ id: 'x', at: 0, provider, kind: 'agent' as const, type, model: '', ms, tokens, ok })
  const text = (...lines: ReturnType<typeof line>[]) => lines.reduce((log, l) => appendLog(log, l), '')
  const mergeLogs = (texts: string[]): string => {
    const fn = (logic as Record<string, unknown>).mergeLogs
    expect(typeof fn).toBe('function')
    const merged = (fn as (t: string[]) => unknown)(texts)
    expect(typeof merged).toBe('string')
    return merged as string
  }

  test('two session logs and a legacy log give the union, summarized as one', () => {
    const legacy = text(line('codex', 'Explore', 1000, 100, true))
    const s1 = text(line('codex', 'Explore', 3000, 300, false), line('claude', 'Explore', 2000, 200, true))
    const s2 = text(line('claude', 'Plan', 500, 50, true))
    const merged = mergeLogs([legacy, s1, s2])
    expect(merged.split('\n').filter(l => l.trim()).length).toBe(4)
    expect(summarize(merged)).toEqual([
      { key: 'claude · Explore', runs: 1, okPct: 100, medianMs: 2000, medianTokens: 200 },
      { key: 'claude · Plan', runs: 1, okPct: 100, medianMs: 500, medianTokens: 50 },
      { key: 'codex · Explore', runs: 2, okPct: 50, medianMs: 2000, medianTokens: 200 },
    ])
  })

  test('a log without a final newline does not swallow the first line of the next', () => {
    const bare = JSON.stringify(line('codex', 'Explore', 1000, 100, true))
    const next = text(line('claude', 'Plan', 500, 50, true))
    expect(summarize(mergeLogs([bare, next])).map(r => `${r.key}:${r.runs}`)).toEqual(['claude · Plan:1', 'codex · Explore:1'])
    expect(summarize(mergeLogs(['torn{', next])).map(r => `${r.key}:${r.runs}`)).toEqual(['claude · Plan:1'])
  })

  test('blank and corrupt lines are skipped, as summarize skips them, and nothing at all merges to no rows', () => {
    const good = text(line('codex', 'Explore', 1000, 100, true))
    const merged = mergeLogs(['', '\n\n', 'torn{\n', good, '   \n', '{"provider":\n'])
    expect(summarize(merged)).toEqual([{ key: 'codex · Explore', runs: 1, okPct: 100, medianMs: 1000, medianTokens: 100 }])
    expect(summarize(mergeLogs([]))).toEqual([])
    expect(summarize(mergeLogs(['', '\n']))).toEqual([])
  })
})

describe('PR #67 review: summarize stays linear, since /duet stats now reads every session\'s log', () => {
  test('40,000 runs of one kind summarize in well under a second (copying the group on every run took seconds)', () => {
    const run = JSON.stringify({ id: 'x', at: 0, provider: 'codex', kind: 'agent', type: 'Explore', model: '', ms: 1000, tokens: 100, ok: true })
    const log = `${Array(40_000).fill(run).join('\n')}\n`
    const started = Date.now()
    const rows = summarize(log)
    const took = Date.now() - started
    expect(rows).toEqual([{ key: 'codex · Explore', runs: 40_000, okPct: 100, medianMs: 1000, medianTokens: 100 }])
    expect(took).toBeLessThanOrEqual(1000)
  })
})

describe('paneAction: one rule for a bare pane command (#31)', () => {
  // Read off the namespace, so a rule that is not there yet fails its assertion, not the import.
  type PaneRow = { id: string; isShown: boolean; isPlaced: boolean }
  const paneAction = (panes: readonly PaneRow[], id: string): string | undefined =>
    (logic as unknown as { paneAction?: (panes: readonly PaneRow[], id: string) => string }).paneAction?.(panes, id)

  test('a pane that is not listed opens, whatever other panes are', () => {
    expect(paneAction([], 'x')).toBe('open')
    expect(paneAction([{ id: 'y', isShown: true, isPlaced: true }], 'x')).toBe('open')
    expect(paneAction([{ id: 'y', isShown: false, isPlaced: true }], 'x')).toBe('open')
  })

  test('a listed pane the surface shows closes', () => {
    expect(paneAction([{ id: 'x', isShown: true, isPlaced: true }], 'x')).toBe('close')
  })

  test('a listed pane that is a tab behind another shows, rather than closing', () => {
    expect(paneAction([{ id: 'x', isShown: false, isPlaced: true }], 'x')).toBe('show')
  })

  test('only the entry with the id decides: another pane shown or hidden changes nothing', () => {
    expect(paneAction([{ id: 'y', isShown: true, isPlaced: true }, { id: 'x', isShown: false, isPlaced: true }], 'x')).toBe('show')
    expect(paneAction([{ id: 'y', isShown: false, isPlaced: true }, { id: 'x', isShown: true, isPlaced: true }], 'x')).toBe('close')
    expect(paneAction([{ id: 'x', isShown: false, isPlaced: true }, { id: 'y', isShown: true, isPlaced: true }], 'y')).toBe('close')
  })

  test('a pane waiting undrawn (isPlaced: false) is no tab behind another: it counts as not listed, and opens (PR #96 review, Codex P2)', () => {
    expect(paneAction([{ id: 'x', isShown: false, isPlaced: false }], 'x')).toBe('open')
    expect(paneAction([{ id: 'x', isShown: true, isPlaced: false }], 'x')).toBe('open')
    expect(paneAction([{ id: 'y', isShown: true, isPlaced: true }, { id: 'x', isShown: false, isPlaced: false }], 'x')).toBe('open')
  })

  test('it takes what $.ui.panes() answers, whole entries included', () => {
    const entry = (id: string, isShown: boolean) => ({ id, title: id, isShown, isFocused: false, isPlaced: true })
    expect(paneAction([entry('duet', true), entry('duet-config', false)], 'duet-config')).toBe('show')
    expect(paneAction([entry('duet', true), entry('duet-config', false)], 'duet')).toBe('close')
  })
})

// #119 gap 1 (the owner's cheap guard): /clear empties the tasks atom while the runs this module started go on.
describe('#119: the concurrency limit and row ids hold after /clear', () => {
  const t = (id: string, status: 'running' | 'done', provider: 'codex' | 'claude' = 'codex', kind: 'agent' | 'review' = 'agent') =>
    ({ id, provider, kind, subagentType: 'x', model: '', status, startedAt: 0, endedAt: null, tokens: 0, description: '', detail: '', envelope: null }) as Task

  test('liveRuns counts running Codex rows and the runs this module started, each once', () => {
    const list = [t('d1', 'running'), t('d2', 'done'), t('d3', 'running', 'codex', 'review'), t('c1', 'running', 'claude')]
    expect(logic.liveRuns?.(list, new Set(['d1', 'd3']))).toBe(2)
    // After /clear the list is empty and two runs are still going.
    expect(logic.liveRuns?.([], new Set(['d1', 'd3']))).toBe(2)
    expect(logic.liveRuns?.(list, new Set())).toBe(2)
  })

  test('idAfter skips the ids of runs still going, so a run that outlived /clear keeps its own row', () => {
    expect(logic.idAfter?.([], ['d4'])).toBe('d5')
    expect(logic.idAfter?.([t('d2', 'done')], [])).toBe('d3')
    expect(logic.idAfter?.([t('d7', 'done')], ['d3'])).toBe('d8')
    expect(logic.idAfter?.([], [])).toBe('d1')
    // An id with no number after its letter counts as 0, so it never blocks the next id.
    expect(logic.idAfter?.([t('dx', 'done')], ['d'])).toBe('d1')
  })
})

// #119 gap 2 (probe, 2.1.306): Esc kills a waited spawn, its loop throws "… aborted", and $ calls after it reject.
describe('#119: a Codex run the person stopped with Esc', () => {
  test('a spawn error after an abort is a stop, never a fallback, whether or not output came', () => {
    expect(logic.spawnErrorAction?.({ started: false, aborted: true })).toBe('stop')
    expect(logic.spawnErrorAction?.({ started: true, aborted: true })).toBe('stop')
    expect(logic.spawnErrorAction?.({ started: true, aborted: false })).toBe('fail')
    expect(logic.spawnErrorAction?.({ started: false, aborted: false })).toBe('fallback')
  })

  test('a stopped run is counted as stopped, neither done nor failed', () => {
    expect(logic.STOPPED).toBe('stopped: you pressed Esc')
    const t = (id: string, status: string) => ({ id, provider: 'codex', kind: 'agent', subagentType: 'x', model: '', status, startedAt: 0, endedAt: 1, tokens: 0, description: '', detail: '', envelope: null }) as unknown as Task
    expect(logic.countsOf([t('d1', 'stopped'), t('d2', 'done'), t('d3', 'error')])).toBe('1 done · 1 stopped · 1 failed')
  })
})

describe('#119: a stopped run makes no file comparison', () => {
  // After the abort the engine refuses process calls, so git status reads '' and a comparison would invent changes.
  test('its candidate says the files were not compared', () => {
    expect(logic.STOPPED_CANDIDATE).toBe('stopped with Esc: files not compared')
  })
})

describe('#119: which prompt drops are retried', () => {
  test('only the two the engine gives after Stop', () => {
    expect(logic.retryableDrop?.('the session was stopped and nobody has sent input since')).toBe(true)
    expect(logic.retryableDrop?.('the prompt was removed from the queue before it ran')).toBe(true)
    expect(logic.retryableDrop?.('duet: $.prompt.submit: the command was removed from the queue before it ran')).toBe(true)
    expect(logic.retryableDrop?.('a policy hook held it')).toBe(false)
    expect(logic.retryableDrop?.('')).toBe(false)
  })

  test('dropOf reads the reason of a { drop } answer, and nothing else', () => {
    expect(logic.dropOf?.({ drop: 'why' })).toBe('why')
    expect(logic.dropOf?.({ text: 'sent' })).toBe('')
    expect(logic.dropOf?.(undefined)).toBe('')
    expect(logic.dropOf?.({ drop: 7 })).toBe('')
  })
})

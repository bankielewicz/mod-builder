import { describe, expect, test } from 'claude-code/testing'

import {
  PROVIDERS, PROVIDER_KEY_NAMES, KEY_FILE_NOTE, authTextOf, baseUrlOf, isAllowedBaseUrl, keyFileOf, keyFor, maskKey, modelsRequest, parseChatReply, parseEnvFile,
  parseModelsReply, probeRequest, providerOf, providerRowText, providersText, redact, refusalReason, rowWindow, savedNote, serializeEnv, testOutcome, testText, upsertEnvLine,
} from '../hooks/duet-providers-logic'
import { PROVIDER_KEYS } from './env-names'

const KEY = 'sk-test-0123456789abcdefa1b2'

describe('providers as data', () => {
  test('ids are unique, none is claude; every entry has a name, a base URL, a default model; anthropic signs in with the session', () => {
    const ids = PROVIDERS.map(p => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).not.toContain('claude')
    for (const id of ['anthropic', 'openai', 'codex', 'google', 'xai', 'mistral', 'deepseek', 'groq', 'together', 'fireworks', 'openrouter', 'perplexity', 'cerebras', 'ollama', 'custom']) expect(ids).toContain(id)
    for (const p of PROVIDERS) {
      expect(p.name.length).toBeGreaterThan(0)
      if (p.id !== 'custom' && p.id !== 'codex') expect(isAllowedBaseUrl(p.baseUrl)).toBe(true)
      if (p.id !== 'custom' && p.id !== 'ollama' && p.id !== 'codex') expect(p.defaultModel.length).toBeGreaterThan(0)
    }
    expect(providerOf('anthropic')!.auth).toBe('session')
    expect(providerOf('anthropic')!.keyName).toBe('ANTHROPIC_API_KEY')
    expect(providerOf('ollama')!.keyName).toBeNull()
    expect(providerOf('codex')!.auth).toBe('cli')
    expect(providerOf('perplexity')!.modelsPath).toBeNull()
    expect(providerOf('google')!.baseUrl).toBe('https://generativelanguage.googleapis.com/v1beta/openai')
    expect(providerOf('nope')).toBeUndefined()
  })

  test('the key names are the exact list the env tests blank, OPENAI_API_KEY apart', () => {
    expect([...PROVIDER_KEY_NAMES].sort()).toEqual([...PROVIDER_KEYS].sort())
    expect(PROVIDER_KEY_NAMES).not.toContain('OPENAI_API_KEY')
    expect(PROVIDER_KEY_NAMES).toContain('GEMINI_API_KEY')
    expect(PROVIDER_KEY_NAMES).toContain('DUET_CUSTOM_API_KEY')
  })

  test('base URLs: the table, the custom option, or none; only https or a local http endpoint is allowed', () => {
    expect(isAllowedBaseUrl('https://api.x.ai/v1')).toBe(true)
    expect(isAllowedBaseUrl('http://localhost:11434/v1')).toBe(true)
    expect(isAllowedBaseUrl('http://127.0.0.1:8080/v1')).toBe(true)
    expect(isAllowedBaseUrl('http://api.example.com/v1')).toBe(false)
    expect(isAllowedBaseUrl('ftp://x')).toBe(false)
    expect(isAllowedBaseUrl('')).toBe(false)
    expect(baseUrlOf(providerOf('custom')!, { customUrl: 'https://my-gw.example.com/v1/' })).toBe('https://my-gw.example.com/v1')
    expect(baseUrlOf(providerOf('custom')!, { customUrl: '' })).toBe('')
    expect(baseUrlOf(providerOf('custom')!, { customUrl: 'http://evil.example.com/v1' })).toBe('')
    expect(baseUrlOf(providerOf('groq')!, { customUrl: 'https://ignored' })).toBe('https://api.groq.com/openai/v1')
  })
})

describe('key file', () => {
  test('the file lives under the home folder, never the project', () => {
    expect(keyFileOf('/home/u')).toBe('/home/u/.claude/duet-data/.env')
    expect(keyFileOf('C:\\Users\\u')).toBe('C:/Users/u/.claude/duet-data/.env')
    expect(KEY_FILE_NOTE).toContain('~/.claude/duet-data/.env')
  })

  test('parse: export prefix, quotes, comments, CRLF, = in a value', () => {
    const text = ['# duet keys', 'export GEMINI_API_KEY="AIza=abc"', "XAI_API_KEY='xai-1'", 'GROQ_API_KEY=gsk_2 # trailing', '', 'MISTRAL_API_KEY=a=b=c', 'broken line', ' SPACED = v ', 'EMPTY='].join('\r\n')
    expect(parseEnvFile(text)).toEqual({ GEMINI_API_KEY: 'AIza=abc', XAI_API_KEY: 'xai-1', GROQ_API_KEY: 'gsk_2', MISTRAL_API_KEY: 'a=b=c', SPACED: 'v', EMPTY: '' })
    expect(parseEnvFile('')).toEqual({})
  })

  test('upsert changes one line and keeps every other byte; a missing file is created; null removes', () => {
    const before = '# mine\nOTHER=keep this  \nGEMINI_API_KEY=old\n\nTAIL=1\n'
    const after = upsertEnvLine(before, 'GEMINI_API_KEY', 'new-value')
    expect(after).toBe('# mine\nOTHER=keep this  \nGEMINI_API_KEY=new-value\n\nTAIL=1\n')
    expect(upsertEnvLine('A=1', 'B', '2')).toBe('A=1\nB=2\n')
    expect(upsertEnvLine('', 'B', '2')).toBe('B=2\n')
    expect(upsertEnvLine(after, 'GEMINI_API_KEY', null)).toBe('# mine\nOTHER=keep this  \n\nTAIL=1\n')
    expect(upsertEnvLine('A=1\n', 'B', null)).toBe('A=1\n')
    // A value with spaces or # is quoted so it reads back whole.
    expect(parseEnvFile(upsertEnvLine('', 'K', 'a b#c'))).toEqual({ K: 'a b#c' })
    expect(serializeEnv({ A: '1', B: 'x y' })).toBe('A=1\nB="x y"\n')
  })

  test('the process variable wins over the file, and the source is named', () => {
    const google = providerOf('google')!
    expect(keyFor(google, { GEMINI_API_KEY: 'from-env' }, { GEMINI_API_KEY: 'from-file' })).toEqual({ key: 'from-env', source: 'env' })
    expect(keyFor(google, {}, { GEMINI_API_KEY: 'from-file' })).toEqual({ key: 'from-file', source: 'file' })
    expect(keyFor(google, { GEMINI_API_KEY: '' }, {})).toEqual({ key: '', source: 'none' })
    expect(keyFor(providerOf('ollama')!, {}, {})).toEqual({ key: '', source: 'none' })
    expect(keyFor(providerOf('anthropic')!, {}, {})).toEqual({ key: '', source: 'none' })
  })
})

describe('redaction', () => {
  test('a key shows as its last four characters only; short values are not echoed', () => {
    expect(maskKey(KEY)).toBe('…a1b2')
    expect(maskKey('short')).toBe('…')
    expect(maskKey('')).toBe('')
  })

  test('every stored key is replaced in text, JSON and headers; empty keys are ignored', () => {
    const keys = [KEY, 'xai-second-key-9999']
    expect(redact(`Bearer ${KEY} and {"key":"xai-second-key-9999"}`, keys)).toBe('Bearer [redacted] and {"key":"[redacted]"}')
    expect(redact('nothing here', keys)).toBe('nothing here')
    expect(redact('a  b', ['', '  '])).toBe('a  b')
    expect(redact(KEY + KEY, [KEY])).toBe('[redacted][redacted]')
  })
})

describe('requests and replies', () => {
  test('models: GET {base}/models with a Bearer header; no key header for ollama; none for a provider without /models', () => {
    const r = modelsRequest(providerOf('google')!, KEY, 'https://generativelanguage.googleapis.com/v1beta/openai')!
    expect(r.url).toBe('https://generativelanguage.googleapis.com/v1beta/openai/models')
    expect(r.init.method).toBe('GET')
    expect(r.init.headers.Authorization).toBe(`Bearer ${KEY}`)
    expect(r.init.body).toBeUndefined()
    expect(modelsRequest(providerOf('ollama')!, '', 'http://localhost:11434/v1')!.init.headers.Authorization).toBeUndefined()
    expect(modelsRequest(providerOf('perplexity')!, KEY, 'https://api.perplexity.ai')).toBeNull()
  })

  test('probe: a one-token chat completion, no temperature or top_p, the model given or the default', () => {
    const r = probeRequest(providerOf('perplexity')!, KEY, 'https://api.perplexity.ai', '')
    expect(r.url).toBe('https://api.perplexity.ai/chat/completions')
    expect(r.init.method).toBe('POST')
    expect(r.init.headers['Content-Type']).toBe('application/json')
    const body = JSON.parse(r.init.body!)
    expect(body).toEqual({ model: 'sonar-pro', messages: [{ role: 'user', content: 'Reply with ok.' }], max_tokens: 1 })
    expect(JSON.parse(probeRequest(providerOf('openai')!, KEY, 'https://api.openai.com/v1', 'gpt-5-mini').init.body!).model).toBe('gpt-5-mini')
  })

  test('replies: the models list, a completion, an error body with the key redacted, and non-JSON', () => {
    expect(parseModelsReply('{"object":"list","data":[{"id":"gemini-2.5-pro"},{"id":"gemini-2.5-flash"}]}')).toEqual({ ids: ['gemini-2.5-pro', 'gemini-2.5-flash'] })
    expect(parseModelsReply('{"models":[{"name":"x"}]}')).toEqual({ error: 'no model list in the reply' })
    expect(parseModelsReply('<html>')).toEqual({ error: 'the reply is not JSON' })
    const ok = parseChatReply('{"model":"sonar-pro","choices":[{"message":{"role":"assistant","content":"ok"}}],"usage":{"prompt_tokens":9,"completion_tokens":1}}')
    expect(ok).toEqual({ text: 'ok', tokens: 10, model: 'sonar-pro' })
    expect(parseChatReply(`{"error":{"message":"Incorrect API key provided: ${KEY}","type":"invalid_request_error"}}`, [KEY])).toEqual({ error: 'Incorrect API key provided: [redacted]' })
    expect(parseChatReply('{"choices":[]}')).toEqual({ error: 'no reply text' })
    expect(parseChatReply('nope')).toEqual({ error: 'the reply is not JSON' })
  })

  test('test outcome: /models 200 → ok; 404/405 → a likely wrong base URL, no billed fallback; 401 → unauthorized; the probe records the model', () => {
    const at = 1_000
    expect(testOutcome('models', { status: 200, ok: true, text: '{"data":[{"id":"a"},{"id":"b"}]}' }, 412, at)).toEqual({ ok: true, status: 200, ms: 412, model: '', note: 'ok 412ms · 2 models', at })
    expect(testOutcome('models', { status: 404, ok: false, text: '' }, 50, at)).toEqual({ ok: false, status: 404, ms: 50, model: '', note: '✕ 404 not found on /models: is the base URL right? (test <id> <model> runs a one-token completion instead)', at })
    expect(testOutcome('models', { status: 405, ok: false, text: '' }, 50, at).note).toContain('✕ 405 not allowed on /models: is the base URL right?')
    expect(testOutcome('models', { status: 401, ok: false, text: '{"error":{"message":"invalid x-api-key"}}' }, 80, at)).toEqual({ ok: false, status: 401, ms: 80, model: '', note: '✕ 401 unauthorized (invalid x-api-key)', at })
    expect(testOutcome('probe', { status: 200, ok: true, text: '{"model":"sonar-pro","choices":[{"message":{"content":"ok"}}],"usage":{"prompt_tokens":9,"completion_tokens":1}}' }, 900, at)).toEqual({ ok: true, status: 200, ms: 900, model: 'sonar-pro', note: 'ok 900ms sonar-pro · 1 token', at })
    expect(testOutcome('probe', { status: 429, ok: false, text: '', headers: { 'retry-after': '30' } }, 20, at)).toEqual({ ok: false, status: 429, ms: 20, model: '', note: '✕ 429 rate limited (retry-after 30 s); not retried', at })
    expect(testOutcome('probe', { status: 500, ok: false, text: 'oops' }, 20, at).note).toBe('✕ 500 server error (oops)')
    expect(testOutcome('probe', { status: 403, ok: false, text: '' }, 20, at).note).toBe('✕ 403 forbidden')
    expect(testOutcome('probe', { status: 418, ok: false, text: '{"error":"teapot"}' }, 20, at).note).toBe('✕ 418 failed (teapot)')
    expect(testOutcome('probe', { status: 200, ok: true, text: '{"choices":[]}' }, 20, at).note).toBe('✕ 200 no reply text')
    expect(testOutcome('probe', { status: 200, ok: true, text: '{"choices":[{"message":{"content":"ok"}}]}' }, 20, at).note).toBe('ok 20ms (model not named) · 1 token')
    expect(testOutcome('models', { status: 200, ok: true, text: '{"x":1}' }, 20, at).note).toBe('ok 20ms · no model list in the reply')
    // OpenRouter's list answers without a key (probed 2026-10-16): the ok says so.
    expect(providerOf('openrouter')!.modelsNeedKey).toBe(false)
    expect(testOutcome('models', { status: 200, ok: true, text: '{"data":[{"id":"a"}]}' }, 20, at, [], false).note).toBe('ok 20ms · 1 models (the list needs no key; test <id> <model> checks the key)')
    expect(testOutcome('probe', { status: 429, ok: false, text: '' }, 20, at).note).toBe('✕ 429 rate limited (retry-after not given); not retried')
    // A refusal before any reply (the host refused the request).
    expect(testOutcome('models', { refused: 'duet: $.http.fetch: nonessential traffic is disabled' }, 0, at).note).toBe('✕ not sent: nonessential traffic is disabled')
    // Wordings seen on 2.1.301: a policy refusal, and a connection that failed (ollama not running).
    expect(refusalReason('duet: $.http.fetch(http://localhost:11434/v1/models) failed: ECONNREFUSED: Unable to connect. Is the computer able to access the url?')).toBe('ECONNREFUSED: Unable to connect. Is the computer able to access the url?')
    expect(refusalReason('duet: $.http.fetch: nonessential traffic is disabled')).toBe('nonessential traffic is disabled')
    expect(refusalReason('something else\nmore')).toBe('something else')
  })
})

describe('pane text', () => {
  test('the saved note warns that Codex can read the key file under codexFsScope anything, and not under project', () => {
    expect(savedNote('chmod 600', 'anything')).toEqual(['saved to ~/.claude/duet-data/.env (chmod 600) · t tests it', 'Codex can read this file under codexFsScope: anything; project hides it.'])
    expect(savedNote('chmod 600', 'project')).toEqual(['saved to ~/.claude/duet-data/.env (chmod 600) · t tests it'])
    expect(savedNote('chmod 600 failed: EPERM; set the file\'s permissions yourself', 'project')).toEqual(['saved to ~/.claude/duet-data/.env (chmod 600 failed: EPERM; set the file\'s permissions yourself) · t tests it'])
  })

  test('the row window keeps the highlighted row in view and never shrinks under 3 rows (seen live: a 14-row pane scrolled the header out)', () => {
    expect(rowWindow(0, 15, 40, 8)).toEqual({ start: 0, room: 15 })
    expect(rowWindow(3, 15, 14, 8)).toEqual({ start: 0, room: 6 })
    expect(rowWindow(8, 15, 14, 8)).toEqual({ start: 5, room: 6 })
    expect(rowWindow(14, 15, 14, 8)).toEqual({ start: 9, room: 6 })
    expect(rowWindow(14, 15, 5, 8)).toEqual({ start: 12, room: 3 })
  })

  test('auth and test columns', () => {
    expect(authTextOf(providerOf('anthropic')!, { key: '', source: 'none' }, '')).toBe('signed-in')
    expect(authTextOf(providerOf('anthropic')!, { key: KEY, source: 'file' }, '')).toBe('key …a1b2')
    expect(authTextOf(providerOf('google')!, { key: KEY, source: 'env' }, '')).toBe('key …a1b2 from env')
    expect(authTextOf(providerOf('google')!, { key: '', source: 'none' }, '')).toBe('no key')
    expect(authTextOf(providerOf('codex')!, { key: '', source: 'none' }, '')).toBe('codex login')
    expect(authTextOf(providerOf('ollama')!, { key: '', source: 'none' }, '')).toBe('localhost:11434')
    expect(authTextOf(providerOf('custom')!, { key: '', source: 'none' }, '')).toBe('no URL set')
    expect(authTextOf(providerOf('custom')!, { key: KEY, source: 'file' }, 'https://gw.example.com/v1')).toBe('key …a1b2 · gw.example.com')
    expect(authTextOf(providerOf('custom')!, { key: '', source: 'none' }, 'https://gw.example.com/v1')).toBe('no key')
    expect(testText(undefined)).toBe('untested')
    expect(testText({ ok: true, status: 200, ms: 412, model: 'gemini-2.5-pro', note: 'ok 412ms gemini-2.5-pro', at: 1 })).toBe('ok 412ms gemini-2.5-pro')
    expect(testText('running')).toBe('testing… GET /models')
  })

  test('a row fits the width and marks the providers a route uses; the list prints every provider', () => {
    const row = providerRowText({ p: providerOf('google')!, auth: 'key …a1b2', test: 'ok 412ms gemini-2.5-pro', used: true }, 76)
    expect(row).toBe('● google     Google Gemini        key …a1b2          ok 412ms gemini-2.5-pro')
    expect(row.length).toBeLessThanOrEqual(76)
    expect(providerRowText({ p: providerOf('xai')!, auth: 'no key', test: '—', used: false }, 76)).toBe('  xai        xAI Grok             no key             —')
    expect(providerRowText({ p: providerOf('google')!, auth: 'key …a1b2', test: 'ok 412ms gemini-2.5-pro', used: true }, 40).length).toBeLessThanOrEqual(40)
    // Narrow: id, auth and test only.
    expect(providerRowText({ p: providerOf('google')!, auth: 'key …a1b2', test: 'ok', used: false }, 50)).toBe('  google     key …a1b2          ok')
    const text = providersText([{ p: providerOf('google')!, auth: 'key …a1b2', test: 'untested', used: false }], 2, 1)
    expect(text).toContain('duet providers · 2 keys · 1 tested')
    expect(text).toContain('google')
    expect(text).toContain(KEY_FILE_NOTE)
    expect(text).not.toContain(KEY)
  })
})

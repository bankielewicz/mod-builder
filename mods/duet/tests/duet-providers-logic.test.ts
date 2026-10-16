import { describe, expect, test } from 'claude-code/testing'

import {
  PROVIDERS, PROVIDER_KEY_NAMES, KEY_FILE_NOTE, authTextOf, baseUrlOf, detailLinesThatFit, isAllowedBaseUrl, isLocalBaseUrl, keyFileOf, keyFor, maskKey, modelsRequest, namesKeyFile, namesKeyFolder, parseChatReply, parseEnvFile,
  keyFileExposed, parseModelsReply, probeRequest, providerOf, providerRowText, providersText, redact, refusalReason, rowWindow, savedNote, serializeEnv, testOutcome, testText, upsertEnvLine,
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

  test('the key names duet stores are the exact list the env tests pass through to Codex; none of them is blanked', () => {
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
    // Codex 4298476191: a URL carrying user:password would show that password in the pane and the transcript.
    expect(isAllowedBaseUrl('https://user:password@gateway.example/v1')).toBe(false)
    expect(isAllowedBaseUrl('https://user@gateway.example/v1')).toBe(false)
    // Codex 4298736558: a query or fragment would have /models appended after it.
    expect(isAllowedBaseUrl('https://gw.example/v1?tenant=a')).toBe(false)
    expect(isAllowedBaseUrl('https://gw.example/v1#x')).toBe(false)
    expect(isAllowedBaseUrl('http://localhost:1234/v1?x')).toBe(false)
    expect(isLocalBaseUrl('http://localhost:1234/v1')).toBe(true)
    expect(isLocalBaseUrl('https://gw.example.com/v1')).toBe(false)
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
    // Codex 4297835997 (P1): with no home folder there is no key file; never a path under the project.
    expect(keyFileOf('')).toBe('')
    expect(keyFileOf('  ')).toBe('')
  })

  test('a command or path that names the key file is recognised, on either separator; look-alikes are not', () => {
    for (const text of ['cat ~/.claude/duet-data/.env', 'cat /home/u/.claude/duet-data/.env | head', 'type C:\\Users\\u\\.claude\\duet-data\\.env', '/home/u/.claude/duet-data/.env']) expect([text, namesKeyFile(text)]).toEqual([text, true])
    for (const text of ['cat .env', 'cat duet-data/.env.bak', 'cat duet-data/.environment', '']) expect([text, namesKeyFile(text)]).toEqual([text, false])
    // A rooted path to the file or its folder counts wherever it stands: quoted, in a -c payload, through $HOME, ${HOME} or ~,
    // with // or /. in it, or a wildcard or the folder itself (a read of the folder reads the file). An unrooted mention
    // (a grep pattern), a heredoc body and a comment do not: this repo's docs name the path all the time.
    for (const text of [
      'cat "~/.claude/duet-data/.env"', "cat '/home/u/.claude/duet-data/.env'", 'cat ~/.claude/duet-data/../duet-data/.env',
      'cat "$HOME/.claude/duet-data/.env"', 'cat "${HOME}/.claude/duet-data/.env"', 'bash -c "cat ~/.claude/duet-data/.env"', "sh -c 'cat ~/.claude/duet-data/.env'",
      "python3 -c \"open('/home/u/.claude/duet-data/.env').read()\"", 'cat ~/.claude/duet-data//.env', 'cat ~/.claude/duet-data/./.env', 'cat ~/.claude/duet-data/*',
      'grep -r API_KEY ~/.claude/duet-data', 'ls ~/.claude/duet-data', 'cd ~/.claude/duet-data && cat .env',
    ]) expect([text, namesKeyFile(text)]).toEqual([text, true])
    for (const text of [
      'grep -n "duet-data/.env" README.md', 'grep -n duet-data/.env README.md', "cat > README.md <<'EOF'\nkeys live in ~/.claude/duet-data/.env (600)\nEOF", 'echo hi # ~/.claude/duet-data/.env',
      'cat <<EOF > SPEC.md\n- the file ~/.claude/duet-data/.env\nEOF\nls', 'ls ~/.claude/duet-data-old', 'ls ~/.claude',
      // A message that names the path is text, not a read: this repo's commits and PR comments name it all the time.
      'git commit -m "docs: ~/.claude/duet-data/.env"',
    ]) expect([text, namesKeyFile(text)]).toEqual([text, false])
    // A Grep's path or glob: the file, or its folder.
    for (const text of ['/home/u/.claude/duet-data', '~/.claude/duet-data/', '**/duet-data/.env', 'C:\\Users\\u\\.claude\\duet-data']) expect([text, namesKeyFolder(text)]).toEqual([text, true])
    for (const text of ['/w', '/home/u/.claude', '~/.claude/duet-data-old', '']) expect([text, namesKeyFolder(text)]).toEqual([text, false])
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
    // Codex 4297835963: parse reads the last duplicate, so an upsert keeps one line where the last was and drops the others.
    expect(upsertEnvLine('A=1\nK=old1\nB=2\nexport K=old2\n', 'K', 'new')).toBe('A=1\nB=2\nK=new\n')
    expect(parseEnvFile(upsertEnvLine('K=old1\nK=old2\n', 'K', 'new'))).toEqual({ K: 'new' })
    expect(upsertEnvLine('K=old1\nK=old2\nA=1\n', 'K', null)).toBe('A=1\n')
    expect(upsertEnvLine('A=1\n', 'B', null)).toBe('A=1\n')
    // A value with spaces or # is quoted so it reads back whole.
    expect(parseEnvFile(upsertEnvLine('', 'K', 'a b#c'))).toEqual({ K: 'a b#c' })
    // Codex 4298736511: quotes, backslashes and newlines round-trip, and a closing quote is the first unescaped one.
    for (const v of ['ab"cd', 'a\\ b', 'line1\nline2', '"leading', "it's", 'back\\slash\\', 'tab\there', 'a\u2028b', 'c\u2029d']) expect(parseEnvFile(upsertEnvLine('', 'K', v))).toEqual({ K: v })
    expect(parseEnvFile('K="abc" # it\'s "x"')).toEqual({ K: 'abc' })
    expect(parseEnvFile('K="a\\"b" # c')).toEqual({ K: 'a"b' })
    // A double-quoted value that is not valid JSON (an unknown escape) is taken between its quotes as written.
    expect(parseEnvFile('K="a\\qb"')).toEqual({ K: 'a\\qb' })
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
    // Codex 4297836038: a key that is a prefix of another is replaced after the longer one, so no suffix leaks.
    expect(redact('secret and secret-suffix', ['secret', 'secret-suffix'])).toBe('[redacted] and [redacted]')
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
    // Codex 4298476139: Anthropic's native /v1/models needs anthropic-version; other providers get no such header.
    expect(modelsRequest(providerOf('anthropic')!, KEY, 'https://api.anthropic.com/v1')!.init.headers['anthropic-version']).toBe('2023-06-01')
    expect(r.init.headers['anthropic-version']).toBeUndefined()
    expect(probeRequest(providerOf('anthropic')!, KEY, 'https://api.anthropic.com/v1', '').init.headers['anthropic-version']).toBe('2023-06-01')
    // Codex 4298989651: the native endpoints document x-api-key; the key goes in both headers until a real key settles it.
    expect(modelsRequest(providerOf('anthropic')!, KEY, 'https://api.anthropic.com/v1')!.init.headers['x-api-key']).toBe(KEY)
    expect(r.init.headers['x-api-key']).toBeUndefined()
    // Codex 4297835980: OpenRouter's list is public, so its models request carries no header without a key.
    expect(modelsRequest(providerOf('openrouter')!, '', 'https://openrouter.ai/api/v1')!.init.headers.Authorization).toBeUndefined()
  })

  test('probe: a one-token chat completion, no temperature or top_p, the model given or the default', () => {
    const r = probeRequest(providerOf('perplexity')!, KEY, 'https://api.perplexity.ai', '')
    expect(r.url).toBe('https://api.perplexity.ai/chat/completions')
    expect(r.init.method).toBe('POST')
    expect(r.init.headers['Content-Type']).toBe('application/json')
    const body = JSON.parse(r.init.body!)
    expect(body).toEqual({ model: 'sonar-pro', messages: [{ role: 'user', content: 'Reply with ok.' }], max_tokens: 1 })
    // Codex 4297836005: OpenAI's o-series rejects max_tokens; OpenAI gets max_completion_tokens, every other provider max_tokens.
    expect(JSON.parse(probeRequest(providerOf('openai')!, KEY, 'https://api.openai.com/v1', 'o3').init.body!)).toEqual({ model: 'o3', messages: [{ role: 'user', content: 'Reply with ok.' }], max_completion_tokens: 1 })
    expect(JSON.parse(probeRequest(providerOf('google')!, KEY, 'https://generativelanguage.googleapis.com/v1beta/openai', '').init.body!).max_tokens).toBe(1)
  })

  test('replies: the models list, a completion, an error body with the key redacted, and non-JSON', () => {
    expect(parseModelsReply('{"object":"list","data":[{"id":"gemini-2.5-pro"},{"id":"gemini-2.5-flash"}]}')).toEqual({ ids: ['gemini-2.5-pro', 'gemini-2.5-flash'], hasMore: false })
    // Codex 4297836020: a paginated list (Anthropic's has_more) says there is more; 4298476186: an id that echoes a key is redacted.
    expect(parseModelsReply('{"data":[{"id":"claude-a"}],"has_more":true,"last_id":"claude-a"}')).toEqual({ ids: ['claude-a'], hasMore: true })
    expect(parseModelsReply(`{"data":[{"id":"leak-${KEY}"}]}`, [KEY])).toEqual({ ids: ['leak-[redacted]'], hasMore: false })
    expect(parseModelsReply('{"models":[{"name":"x"}]}')).toEqual({ error: 'no model list in the reply' })
    // Together AI answers a top-level array (docs.together.ai, models list schema), [field].
    expect(parseModelsReply('[{"id":"meta-llama/x"},{"id":"y"}]')).toEqual({ ids: ['meta-llama/x', 'y'], hasMore: false })
    expect(parseModelsReply('<html>')).toEqual({ error: 'the reply is not JSON' })
    const ok = parseChatReply('{"model":"sonar-pro","choices":[{"message":{"role":"assistant","content":"ok"}}],"usage":{"prompt_tokens":9,"completion_tokens":1}}')
    expect(ok).toEqual({ text: 'ok', tokens: 10, model: 'sonar-pro' })
    expect(parseChatReply(`{"error":{"message":"Incorrect API key provided: ${KEY}","type":"invalid_request_error"}}`, [KEY])).toEqual({ error: 'Incorrect API key provided: [redacted]' })
    expect(parseChatReply('{"choices":[]}')).toEqual({ error: 'no reply text' })
    // A reasoning model spends the one-token budget thinking: 200, a choice, empty content. The key still worked.
    expect(parseChatReply('{"model":"gpt-5","choices":[{"message":{"role":"assistant","content":""},"finish_reason":"length"}],"usage":{"prompt_tokens":9,"completion_tokens":1}}')).toEqual({ text: '', tokens: 10, model: 'gpt-5' })
    expect(parseChatReply('{"model":"m","choices":[{"message":{"role":"assistant"}}]}')).toEqual({ text: '', tokens: 0, model: 'm' })
    // A gateway that sends "error": null beside a reply is not an error.
    expect(parseChatReply('{"error":null,"model":"m","choices":[{"message":{"content":"ok"}}]}')).toEqual({ text: 'ok', tokens: 0, model: 'm' })
    expect(parseChatReply('nope')).toEqual({ error: 'the reply is not JSON' })
    // Codex 4298989618: a JSON `null` (or a number, a string) is not a reply either; nothing throws.
    expect(parseChatReply('null')).toEqual({ error: 'the reply is not JSON' })
    expect(parseChatReply('42')).toEqual({ error: 'the reply is not JSON' })
    expect(parseModelsReply('null')).toEqual({ error: 'the reply is not JSON' })
    expect(parseModelsReply('"x"')).toEqual({ error: 'no model list in the reply' })
    // Codex 4299363023: a credential split by a control character is still a credential: cleaned first, then redacted.
    expect(parseModelsReply('{"data":[{"id":"sec\\u001bret-ok"}]}', ['secret'])).toEqual({ ids: ['[redacted]-ok'], hasMore: false })
    expect(parseChatReply('{"model":"sec\\u001bret","choices":[{"message":{"content":"ok"}}]}', ['secret'])).toEqual({ text: 'ok', tokens: 0, model: '[redacted]' })
    // Codex 4298989646: a model id is cleaned of control characters and line breaks, and bounded.
    expect(parseModelsReply('{"data":[{"id":"ok\\u001b[31mINJECTED\\nline"},{"id":"' + 'x'.repeat(300) + '"}]}')).toEqual({ ids: ['ok[31mINJECTEDline', 'x'.repeat(120)], hasMore: false })
  })

  test('test outcome: /models 200 → ok; 404/405 → a likely wrong base URL, no billed fallback; 401 → unauthorized; the probe records the model', () => {
    const at = 1_000
    expect(testOutcome('models', { status: 200, ok: true, text: '{"data":[{"id":"a"},{"id":"b"}]}' }, 412, at)).toEqual({ ok: true, status: 200, ms: 412, model: '', note: 'ok 412ms · 2 models', at, key: '', host: '' })
    expect(testOutcome('models', { status: 404, ok: false, text: '' }, 50, at)).toEqual({ ok: false, status: 404, ms: 50, model: '', note: '✕ 404 not found on /models: is the base URL right? (test <id> <model> runs a one-token completion instead)', at, key: '', host: '' })
    expect(testOutcome('models', { status: 405, ok: false, text: '' }, 50, at).note).toContain('✕ 405 not allowed on /models: is the base URL right?')
    expect(testOutcome('models', { status: 401, ok: false, text: '{"error":{"message":"invalid x-api-key"}}' }, 80, at)).toEqual({ ok: false, status: 401, ms: 80, model: '', note: '✕ 401 unauthorized (invalid x-api-key)', at, key: '', host: '' })
    expect(testOutcome('probe', { status: 200, ok: true, text: '{"model":"sonar-pro","choices":[{"message":{"content":"ok"}}],"usage":{"prompt_tokens":9,"completion_tokens":1}}' }, 900, at)).toEqual({ ok: true, status: 200, ms: 900, model: 'sonar-pro', note: 'ok 900ms sonar-pro · 1 token', at, key: '', host: '' })
    expect(testOutcome('probe', { status: 429, ok: false, text: '', headers: { 'retry-after': '30' } }, 20, at)).toEqual({ ok: false, status: 429, ms: 20, model: '', note: '✕ 429 rate limited (retry-after 30 s); not retried', at, key: '', host: '' })
    expect(testOutcome('probe', { status: 500, ok: false, text: 'oops' }, 20, at).note).toBe('✕ 500 server error (oops)')
    expect(testOutcome('probe', { status: 403, ok: false, text: '' }, 20, at).note).toBe('✕ 403 forbidden')
    expect(testOutcome('probe', { status: 418, ok: false, text: '{"error":"teapot"}' }, 20, at).note).toBe('✕ 418 failed (teapot)')
    expect(testOutcome('probe', { status: 200, ok: true, text: '{"choices":[]}' }, 20, at).note).toBe('✕ 200 no reply text')
    // Codex 4299363010: an error object on a 2xx is cleaned and bounded like any other provider text.
    const long = testOutcome('probe', { status: 200, ok: true, text: `{"error":{"message":"bad\\u001b[2Jmsg${'x'.repeat(300)}"}}` }, 20, at).note
    expect(long.startsWith('✕ 200 bad[2Jmsgxxx')).toBe(true)
    expect(long.length).toBeLessThanOrEqual(90)
    // Codex 4299426954 (the list's failure text) and the 429 header both go through clean before redact.
    expect(testOutcome('probe', { status: 429, ok: false, text: '', headers: { 'retry-after': 'sec\u001bret' } }, 20, at, ['secret']).note).toBe('✕ 429 rate limited (retry-after [redacted] s); not retried')
    // Codex 4299362999: a result remembers the base URL it tested, so a custom endpoint that moved shows as untested.
    expect(testOutcome('models', { status: 200, ok: true, text: '{"data":[{"id":"a"}]}' }, 20, at, [], true, '', 'https://gw.example.com/v1').host).toBe('https://gw.example.com/v1')
    expect(testOutcome('probe', { status: 200, ok: true, text: '{"model":"gpt-5","choices":[{"message":{"content":""}}]}' }, 20, at).note).toBe('ok 20ms gpt-5 · 1 token')
    // Codex 4298736527: the model the reply names is redacted and bounded before it reaches the note.
    expect(testOutcome('probe', { status: 200, ok: true, text: `{"model":"${KEY}","choices":[{"message":{"content":"ok"}}]}` }, 20, at, [KEY]).note).toBe('ok 20ms [redacted] · 1 token')
    expect(testOutcome('probe', { status: 200, ok: true, text: `{"model":"${'m'.repeat(5000)}","choices":[{"message":{"content":"ok"}}]}` }, 20, at).note.length).toBeLessThanOrEqual(99)
    expect(testOutcome('probe', { status: 200, ok: true, text: '{"choices":[{"message":{"content":"ok"}}]}' }, 20, at).note).toBe('ok 20ms (model not named) · 1 token')
    // Codex 4297835969: a 2xx that is not a model list is a failed test, never a green ok.
    expect(testOutcome('models', { status: 200, ok: true, text: '{"x":1}' }, 20, at)).toEqual({ ok: false, status: 200, ms: 20, model: '', note: '✕ 200 no model list in the reply', at, key: '', host: '' })
    expect(testOutcome('models', { status: 200, ok: true, text: '{"data":[{"id":"a"}],"has_more":true}' }, 20, at).note).toBe('ok 20ms · 1+ models (first page)')
    // OpenRouter's list answers without a key (probed 2026-10-16): the ok says so.
    expect(providerOf('openrouter')!.modelsNeedKey).toBe(false)
    expect(testOutcome('models', { status: 200, ok: true, text: '{"data":[{"id":"a"}]}' }, 20, at, [], false).note).toBe('ok 20ms · 1 models (the list needs no key; test <id> <model> checks the key)')
    expect(testOutcome('probe', { status: 429, ok: false, text: '' }, 20, at).note).toBe('✕ 429 rate limited (retry-after not given); not retried')
    // A 429 keeps the body's message (an exhausted quota is not a transient limit), and Retry-After is redacted and cleaned (Codex 4298989611).
    expect(testOutcome('probe', { status: 429, ok: false, text: '{"error":{"message":"You exceeded your current quota","code":"insufficient_quota"}}' }, 20, at).note).toBe('✕ 429 rate limited (You exceeded your current quota; retry-after not given); not retried')
    expect(testOutcome('probe', { status: 429, ok: false, text: '', headers: { 'retry-after': KEY } }, 20, at, [KEY]).note).toBe('✕ 429 rate limited (retry-after [redacted] s); not retried')
    expect(testOutcome('probe', { status: 429, ok: false, text: '', headers: { 'retry-after': '3\u001b[2J0\n' } }, 20, at).note).toBe('✕ 429 rate limited (retry-after 3[2J0 s); not retried')
    // Codex 4298989618: a `null` body never throws, at any status and step.
    expect(testOutcome('probe', { status: 200, ok: true, text: 'null' }, 20, at).note).toBe('✕ 200 the reply is not JSON')
    expect(testOutcome('probe', { status: 500, ok: false, text: 'null' }, 20, at).note).toBe('✕ 500 server error (null)')
    expect(testOutcome('models', { status: 200, ok: true, text: 'null' }, 20, at).note).toBe('✕ 200 the reply is not JSON')
    expect(testOutcome('models', { status: 500, ok: false, text: 'null' }, 20, at).note).toBe('✕ 500 server error (null)')
    // The result remembers the mask of the key it tested, so a result never outlives its key (Codex 4298989626).
    expect(testOutcome('models', { status: 200, ok: true, text: '{"data":[{"id":"a"}]}' }, 20, at, [], true, '…a1b2').key).toBe('…a1b2')
    // A model name with a line break is cleaned before it reaches the note.
    expect(testOutcome('probe', { status: 200, ok: true, text: '{"model":"m\\nINJECTED","choices":[{"message":{"content":"ok"}}]}' }, 20, at).note).toBe('ok 20ms mINJECTED · 1 token')
    // A refusal before any reply (the host refused the request).
    expect(testOutcome('models', { refused: 'duet: $.http.fetch: nonessential traffic is disabled' }, 0, at).note).toBe('✕ not sent: nonessential traffic is disabled')
    // Wordings seen on 2.1.301: a policy refusal, and a connection that failed (ollama not running).
    expect(refusalReason('duet: $.http.fetch(http://localhost:11434/v1/models) failed: ECONNREFUSED: Unable to connect. Is the computer able to access the url?')).toBe('ECONNREFUSED: Unable to connect. Is the computer able to access the url?')
    expect(refusalReason('duet: $.http.fetch: nonessential traffic is disabled')).toBe('nonessential traffic is disabled')
    expect(refusalReason('something else\nmore')).toBe('something else')
  })
})

describe('pane text', () => {
  test('model-list lines under a row are capped to what the pane has left, so the pane never outgrows its window (Codex 4298989642)', () => {
    expect(detailLinesThatFit(40, 8, 13)).toBe(13)
    expect(detailLinesThatFit(14, 8, 13)).toBe(3)
    expect(detailLinesThatFit(5, 8, 13)).toBe(0)
  })

  test('the saved note warns when Codex can read the key file: under codexFsScope anything, or under project when the session folder holds it (Codex 4298736579)', () => {
    expect(savedNote('chmod 600', true)).toEqual(['saved to ~/.claude/duet-data/.env (chmod 600) · t tests it', 'Codex can read this file under codexFsScope: anything; project hides it.'])
    expect(savedNote('chmod 600', false)).toEqual(['saved to ~/.claude/duet-data/.env (chmod 600) · t tests it'])
    expect(savedNote('chmod 600 failed: EPERM; set the file\'s permissions yourself', false)).toEqual(['saved to ~/.claude/duet-data/.env (chmod 600 failed: EPERM; set the file\'s permissions yourself) · t tests it'])
    expect(keyFileExposed('anything', '/w', '/home/u/.claude/duet-data/.env')).toBe(true)
    expect(keyFileExposed('project', '/w', '/home/u/.claude/duet-data/.env')).toBe(false)
    expect(keyFileExposed('project', '/home/u', '/home/u/.claude/duet-data/.env')).toBe(true)
    expect(keyFileExposed('project', '/home/u/.claude/', '/home/u/.claude/duet-data/.env')).toBe(true)
    expect(keyFileExposed('project', '/home/user2', '/home/u/.claude/duet-data/.env')).toBe(false)
    expect(keyFileExposed('project', '/w', '')).toBe(false)
    // An unknown session folder is not a reason to warn; a Windows path compares without case.
    expect(keyFileExposed('project', '', '/home/u/.claude/duet-data/.env')).toBe(false)
    expect(keyFileExposed('project', 'C:\\Users\\U', 'c:/users/u/.claude/duet-data/.env')).toBe(true)
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
    expect(authTextOf(providerOf('custom')!, { key: '', source: 'none' }, 'https://gw.example.com/v1')).toBe('no key · gw.example.com')
    expect(testText(undefined)).toBe('untested')
    expect(testText({ ok: true, status: 200, ms: 412, model: 'gemini-2.5-pro', note: 'ok 412ms gemini-2.5-pro', at: 1, key: '', host: '' })).toBe('ok 412ms gemini-2.5-pro')
    expect(testText('running')).toBe('testing…')
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

/**
 * Duet 0.3.0: API providers as data, the user-level key file, redaction and
 * the key test (SPEC, Change 0.3.0, parts A, C and D). Pure: no `$`.
 *
 * The shared shape is OpenAI's Chat Completions: `GET {base}/models` and
 * `POST {base}/chat/completions` with `Authorization: Bearer <key>`. Base URLs
 * are `[field]` from each provider's docs and stay `[probe]` until
 * `/duet provider test` has hit them live (SPEC, Change 0.3.0, part A).
 */

export type ProviderAuth = 'bearer' | 'session' | 'none' | 'cli'

export type ProviderDef = {
  id: string
  name: string
  /** The Chat Completions base, no trailing slash; '' for `codex` (a process) and `custom` (the `apiCustomUrl` option). */
  baseUrl: string
  /** The conventional variable; null where no key is used (ollama) or the CLI signs in (codex). */
  keyName: string | null
  defaultModel: string
  /** `/models` where the provider lists models; null sends the key test straight to a one-token completion. */
  modelsPath: string | null
  /** `bearer`: a key; `session`: Anthropic through the session's own sign-in unless a key is stored; `none`: no key; `cli`: Codex's own login. */
  auth: ProviderAuth
  /** False where `/models` answers without a key (OpenRouter, probed 2026-10-16): the list then proves the URL, not the key. */
  modelsNeedKey: boolean
}

const def = (id: string, name: string, baseUrl: string, keyName: string | null, defaultModel: string, auth: ProviderAuth = 'bearer', modelsPath: string | null = '/models', modelsNeedKey = true): ProviderDef =>
  ({ id, name, baseUrl, keyName, defaultModel, modelsPath, auth, modelsNeedKey })

/** The provider table, in pane order. The provider is the company, the model is its product (anthropic / claude). */
export const PROVIDERS: ProviderDef[] = [
  def('anthropic', 'Anthropic (Claude)', 'https://api.anthropic.com/v1', 'ANTHROPIC_API_KEY', 'claude-sonnet-5-5', 'session'),
  def('openai', 'OpenAI (no tools)', 'https://api.openai.com/v1', 'OPENAI_API_KEY', 'gpt-5'),
  def('codex', 'Codex CLI (tools)', '', null, '', 'cli', null),
  def('google', 'Google Gemini', 'https://generativelanguage.googleapis.com/v1beta/openai', 'GEMINI_API_KEY', 'gemini-2.5-pro'),
  def('xai', 'xAI Grok', 'https://api.x.ai/v1', 'XAI_API_KEY', 'grok-4'),
  def('mistral', 'Mistral', 'https://api.mistral.ai/v1', 'MISTRAL_API_KEY', 'mistral-large-latest'),
  def('deepseek', 'DeepSeek', 'https://api.deepseek.com/v1', 'DEEPSEEK_API_KEY', 'deepseek-chat'),
  def('groq', 'Groq', 'https://api.groq.com/openai/v1', 'GROQ_API_KEY', 'llama-3.3-70b-versatile'),
  def('together', 'Together AI', 'https://api.together.xyz/v1', 'TOGETHER_API_KEY', 'meta-llama/Llama-3.3-70B-Instruct-Turbo'),
  def('fireworks', 'Fireworks AI', 'https://api.fireworks.ai/inference/v1', 'FIREWORKS_API_KEY', 'accounts/fireworks/models/llama-v3p3-70b-instruct'),
  def('openrouter', 'OpenRouter (gateway)', 'https://openrouter.ai/api/v1', 'OPENROUTER_API_KEY', 'anthropic/claude-sonnet-5.5', 'bearer', '/models', false),
  def('perplexity', 'Perplexity', 'https://api.perplexity.ai', 'PERPLEXITY_API_KEY', 'sonar-pro', 'bearer', null),
  def('cerebras', 'Cerebras', 'https://api.cerebras.ai/v1', 'CEREBRAS_API_KEY', 'llama-3.3-70b'),
  def('ollama', 'Ollama (local)', 'http://localhost:11434/v1', null, '', 'none'),
  def('custom', 'Custom endpoint', '', 'DUET_CUSTOM_API_KEY', ''),
]

/**
 * The key variables duet adds to `BLANKED_ENV` for Codex: every provider's, except `OPENAI_API_KEY`
 * (Codex's own) and `ANTHROPIC_API_KEY` (Claude Code's own, blanked there already).
 */
export const PROVIDER_KEY_NAMES: readonly string[] = PROVIDERS.map(p => p.keyName).filter((n): n is string => n !== null && n !== 'OPENAI_API_KEY' && n !== 'ANTHROPIC_API_KEY')

export const KEY_FILE_NOTE = 'keys live in ~/.claude/duet-data/.env (mode 600), never in the project'

export function providerOf(id: string): ProviderDef | undefined {
  const k = id.trim().toLowerCase()
  return PROVIDERS.find(p => p.id === k)
}

/** https anywhere, or http to this machine only. */
export function isAllowedBaseUrl(url: string): boolean {
  return /^https:\/\/[^/\s]+/.test(url) || /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/.test(url)
}

/** A provider's base URL: the table's, or for `custom` the option when it is allowed, with no trailing slash. '' when there is none. */
export function baseUrlOf(p: ProviderDef, o: { customUrl: string }): string {
  const url = (p.id === 'custom' ? o.customUrl : p.baseUrl).trim().replace(/\/+$/, '')
  return isAllowedBaseUrl(url) ? url : ''
}

// ── The key file ─────────────────────────────────────────────────────────

/** `~/.claude/duet-data/.env`, with `/` separators whatever the home folder uses. */
export function keyFileOf(home: string): string {
  return `${home.replace(/\\/g, '/').replace(/\/+$/, '')}/.claude/duet-data/.env`
}

/** `NAME=value` lines: an `export ` prefix, single or double quotes, `#` comments after an unquoted value, CRLF. Lines that are not assignments are skipped. */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(raw)
    if (!m) continue
    let v = m[2]!.trim()
    const q = /^(["'])(.*)\1\s*(?:#.*)?$/.exec(v)
    if (q) v = q[2]!
    else v = v.replace(/\s+#.*$/, '').trim()
    out[m[1]!] = v
  }
  return out
}

const envLine = (name: string, value: string) => `${name}=${/[\s#"']/.test(value) ? JSON.stringify(value) : value}`

/** The file with one variable set (or removed, for null), every other byte kept; a missing file is created. */
export function upsertEnvLine(text: string, name: string, value: string | null): string {
  const lines = text === '' ? [] : text.split('\n')
  const isLine = (l: string) => new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=`).test(l)
  if (value === null) {
    const kept = lines.filter(l => !isLine(l))
    return kept.join('\n')
  }
  const at = lines.findIndex(isLine)
  if (at >= 0) {
    lines[at] = envLine(name, value)
    return lines.join('\n')
  }
  const body = lines.join('\n')
  return `${body === '' ? '' : body.endsWith('\n') ? body : body + '\n'}${envLine(name, value)}\n`
}

export function serializeEnv(env: Record<string, string>): string {
  return Object.entries(env).map(([k, v]) => envLine(k, v) + '\n').join('')
}

export type KeySource = { key: string; source: 'env' | 'file' | 'none' }

/** The key for a provider: the process variable first, then the file; `none` with neither or for a provider that takes no key. */
export function keyFor(p: ProviderDef, env: Record<string, string | undefined>, file: Record<string, string>): KeySource {
  if (!p.keyName) return { key: '', source: 'none' }
  const fromEnv = env[p.keyName]
  if (fromEnv) return { key: fromEnv, source: 'env' }
  const fromFile = file[p.keyName]
  if (fromFile) return { key: fromFile, source: 'file' }
  return { key: '', source: 'none' }
}

// ── Redaction ────────────────────────────────────────────────────────────

/** `…a1b2`: the last four characters of a key long enough to keep them; `…` for a short one. */
export function maskKey(key: string): string {
  if (key === '') return ''
  return key.length >= 12 ? `…${key.slice(-4)}` : '…'
}

/** Every stored key's value replaced with `[redacted]`, wherever it appears. Blank keys are ignored. */
export function redact(text: string, keys: readonly string[]): string {
  let out = text
  for (const k of keys) if (k.trim() !== '') out = out.split(k).join('[redacted]')
  return out
}

// ── Requests and replies (the Chat Completions shape) ────────────────────

export type HttpRequest = { url: string; init: { method: string; headers: Record<string, string>; body?: string } }

function headersFor(p: ProviderDef, key: string): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/json' }
  if (key !== '' && p.auth !== 'none') h.Authorization = `Bearer ${key}`
  return h
}

/** `GET {base}/models`, or null for a provider that lists none. */
export function modelsRequest(p: ProviderDef, key: string, base: string): HttpRequest | null {
  if (p.modelsPath === null) return null
  return { url: `${base}${p.modelsPath}`, init: { method: 'GET', headers: headersFor(p, key) } }
}

export const PROBE_PROMPT = 'Reply with ok.'

/** A one-token completion: the cheapest request that proves the key and names the model. No temperature or top_p. */
export function probeRequest(p: ProviderDef, key: string, base: string, model: string): HttpRequest {
  const body = JSON.stringify({ model: model || p.defaultModel, messages: [{ role: 'user', content: PROBE_PROMPT }], max_tokens: 1 })
  return { url: `${base}/chat/completions`, init: { method: 'POST', headers: { ...headersFor(p, key), 'Content-Type': 'application/json' }, body } }
}

function parseJson(text: string): unknown | undefined {
  try { return JSON.parse(text) } catch { return undefined }
}

export function parseModelsReply(text: string): { ids: string[] } | { error: string } {
  const j = parseJson(text) as { data?: unknown } | undefined
  if (j === undefined) return { error: 'the reply is not JSON' }
  if (!Array.isArray(j?.data)) return { error: 'no model list in the reply' }
  return { ids: j.data.map(m => String((m as { id?: unknown })?.id ?? '')).filter(Boolean) }
}

type ChatReply = { model?: unknown; choices?: { message?: { content?: unknown } }[]; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown }; error?: { message?: unknown } | string }

/** The reply's text, token total and model; or the error the body carries, with keys redacted. */
export function parseChatReply(text: string, keys: readonly string[] = []): { text: string; tokens: number; model: string } | { error: string } {
  const j = parseJson(text) as ChatReply | undefined
  if (j === undefined) return { error: 'the reply is not JSON' }
  if (j.error !== undefined) {
    const msg = typeof j.error === 'string' ? j.error : String(j.error?.message ?? 'error')
    return { error: redact(msg, keys) }
  }
  const content = j.choices?.[0]?.message?.content
  if (typeof content !== 'string' || content === '') return { error: 'no reply text' }
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  return { text: content, tokens: n(j.usage?.prompt_tokens) + n(j.usage?.completion_tokens), model: String(j.model ?? '') }
}

export type HttpReply = { status: number; ok: boolean; text: string; headers?: Record<string, string> } | { refused: string }

/**
 * The reason inside the engine's wording of a `$.http.fetch` rejection: `duet: $.http.fetch: <reason>` for a policy
 * refusal, `duet: $.http.fetch(<url>) failed: <reason>` for a connection that failed (2.1.301, probed). Other text is kept.
 */
export function refusalReason(message: string): string {
  return message.split('\n')[0]!.replace(/^\S+: \$\.http\.fetch(?:\([^)]*\))?(?: failed)?: /, '').trim()
}
export type TestResult = { ok: boolean; status: number; ms: number; model: string; note: string; at: number }

const STATUS_WORD: Record<number, string> = { 400: 'bad request', 401: 'unauthorized', 402: 'payment required', 403: 'forbidden', 404: 'not found', 405: 'not allowed', 429: 'rate limited' }

function errorDetail(r: { status: number; text: string; headers?: Record<string, string> }, keys: readonly string[]): string {
  const parsed = parseChatReply(r.text, keys)
  const msg = 'error' in parsed && parsed.error !== 'the reply is not JSON' && parsed.error !== 'no reply text' ? parsed.error : redact(r.text.trim().split('\n')[0] ?? '', keys)
  if (r.status === 429) {
    const after = r.headers?.['retry-after']
    return `(retry-after ${after ? `${after} s` : 'not given'}); not retried`
  }
  return msg ? `(${msg.slice(0, 80)})` : ''
}

/**
 * What a key test step answers: `/models` 200 → ok; any failure → the result, worded by status, never retried.
 * The probe (a one-token completion, billed by most providers) is a step of its own, taken only for a provider
 * the table says lists no models, or when the person names a model to test.
 */
export function testOutcome(step: 'models' | 'probe', r: HttpReply, ms: number, at: number, keys: readonly string[] = [], modelsNeedKey = true): TestResult {
  if ('refused' in r) return { ok: false, status: 0, ms, model: '', note: `✕ not sent: ${redact(refusalReason(r.refused), keys)}`, at }
  // A provider that should list models and answers 404/405 most likely has the wrong base URL: say so, and never spend a
  // token on the probe for it (the probe runs only where the table says the provider lists no models, or on request).
  if (step === 'models' && (r.status === 404 || r.status === 405)) return { ok: false, status: r.status, ms, model: '', note: `✕ ${r.status} ${STATUS_WORD[r.status] ?? 'not allowed'} on /models: is the base URL right? (test <id> <model> runs a one-token completion instead)`, at }
  if (r.ok) {
    if (step === 'models') {
      const list = parseModelsReply(r.text)
      const count = 'ids' in list ? `${list.ids.length} models` : list.error
      const caveat = modelsNeedKey ? '' : ' (the list needs no key; test <id> <model> checks the key)'
      return { ok: true, status: r.status, ms, model: '', note: `ok ${ms}ms · ${count}${caveat}`, at }
    }
    const reply = parseChatReply(r.text, keys)
    if ('error' in reply) return { ok: false, status: r.status, ms, model: '', note: `✕ ${r.status} ${reply.error}`, at }
    return { ok: true, status: r.status, ms, model: reply.model, note: `ok ${ms}ms ${reply.model || '(model not named)'} · 1 token`, at }
  }
  const word = STATUS_WORD[r.status] ?? (r.status >= 500 ? 'server error' : 'failed')
  const detail = errorDetail(r, keys)
  return { ok: false, status: r.status, ms, model: '', note: `✕ ${r.status} ${word}${detail ? ` ${detail}` : ''}`, at }
}

// ── Pane text ────────────────────────────────────────────────────────────

/** The sign-in column: how this provider is reached right now. */
export function authTextOf(p: ProviderDef, k: KeySource, customUrl: string): string {
  if (p.auth === 'cli') return 'codex login'
  if (p.auth === 'none') return p.baseUrl.replace(/^https?:\/\//, '').replace(/\/v1$/, '')
  if (k.key === '') return p.auth === 'session' ? 'signed-in' : p.id === 'custom' && customUrl.trim() === '' ? 'no URL set' : 'no key'
  const host = p.id === 'custom' ? ` · ${customUrl.replace(/^https?:\/\//, '').split('/')[0]}` : ''
  return `key ${maskKey(k.key)}${k.source === 'env' ? ' from env' : ''}${host}`
}

/** The test column. */
export function testText(t: TestResult | 'running' | undefined): string {
  if (t === undefined) return 'untested'
  if (t === 'running') return 'testing… GET /models'
  return t.note
}

export type ProviderRow = { p: ProviderDef; auth: string; test: string; used: boolean }

/** One pane row: `● id  name  auth  test` (53 columns before the test), cut to the width; under 60 columns the name is dropped. */
export function providerRowText(r: ProviderRow, width: number): string {
  const mark = r.used ? '●' : ' '
  const line = width < 60 ? `${mark} ${r.p.id.padEnd(10)} ${r.auth.padEnd(18)} ${r.test}` : `${mark} ${r.p.id.padEnd(10)} ${r.p.name.padEnd(20)} ${r.auth.padEnd(18)} ${r.test}`
  return line.trimEnd().slice(0, width)
}

/** `/duet provider list`: the rows as text. */
export function providersText(rows: ProviderRow[], keys: number, tested: number): string {
  return [`duet providers · ${keys} keys · ${tested} tested`, ...rows.map(r => providerRowText(r, 120)), KEY_FILE_NOTE, 'Commands: /duet provider [list | key <id> | test <id> [model] | models <id> | remove <id>]'].join('\n')
}

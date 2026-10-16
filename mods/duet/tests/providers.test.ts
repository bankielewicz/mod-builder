import { describe, expect, mock, test } from 'claude-code/testing'
import { keyId } from '../hooks/duet-providers-logic'

const COMPOSER = { kind: 'composer' } as const
const PRESENTATION = { isFullscreen: false, columns: 160 } as const
const PANE = { title: 'Duet providers', isFocused: true, bodyColumns: 76, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as const
const KEY_FILE = '/home/u/.claude/duet-data/.env'
const KEY = 'AIzaSy-test-0123456789abcdefa1b2'
const XAI = 'xai-test-0123456789abcdef9f3e'
const MODELS = '{"object":"list","data":[{"id":"gemini-2.5-pro"},{"id":"gemini-2.5-flash"}]}'
const PROBE = '{"model":"sonar-pro","choices":[{"message":{"role":"assistant","content":"ok"}}],"usage":{"prompt_tokens":9,"completion_tokens":1}}'

type Fetch = { url: string; init: any }
type Reply = { status: number; text: string; headers?: Record<string, string> } | string | { deny: string }
type World = {
  files?: Record<string, string>
  env?: Record<string, string>
  /** Answers each fetch by URL substring; a string answer is a 200 body; `{ deny }` is the host refusing; a promise answers later. */
  fetch?: (url: string, init: any) => Reply | Promise<Reply>
  answer?: string
  noAsk?: boolean
  /** No HOME and no USERPROFILE, as in a stripped container. */
  noHome?: boolean
  /** What the store holds before the test, by key. */
  store?: Record<string, unknown>
  /** The key file exists but can't be read: fs.read fails with this text. */
  unreadable?: string
  /** fs.write fails with this text. */
  writeDeny?: string
  /** The session folder `$.session.cwd()` answers. */
  cwd?: string
  /** chmod exits 1 with this text. */
  chmodFail?: string
  /** chmod fails on these calls only (1-based), as a host whose second chmod fails. */
  chmodFailOn?: number[]
  /** fs.exists rejects, as for a network location. */
  existsDeny?: boolean
  /** ui.open answers isPlaced: false (a narrow window, or a headless run). */
  unplaced?: boolean
}
type Seen = { fetches: Fetch[]; files: Record<string, string>; argv: string[][]; opened: any[]; toasts: string[]; store: Map<string, unknown>; asked: number; closed: string[]; events: string[]; clock: ReturnType<typeof mock.clock> }

function engine(on: any, o: World = {}): Seen {
  const seen: Seen = { fetches: [], files: { ...(o.files ?? {}) }, argv: [], opened: [], toasts: [], store: new Map(Object.entries(o.store ?? {})), asked: 0, closed: [], events: [], clock: mock.clock(on) }
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }))
  on('agent.register', () => ({ value: { agent: 'duet:x' } }))
  on('session.cwd', () => ({ value: o.cwd ?? '/w' }))
  on('session.id', () => ({ value: 's1' }))
  on('env.get', ($: any, e: any) => ({ value: ({ ...(o.noHome ? {} : { HOME: '/home/u' }), ...(o.env ?? {}) } as Record<string, string>)[e.name] }))
  on('fs.read', ($: any, e: any) => (o.unreadable && e.path === KEY_FILE ? { deny: o.unreadable } : e.path in seen.files ? { value: seen.files[e.path] } : { deny: 'ENOENT: no such file' }))
  on('fs.write', ($: any, e: any) => (seen.events.push(`write ${e.text === '' ? 'empty' : 'content'}`), o.writeDeny ? { deny: o.writeDeny } : ((seen.files[e.path] = e.text), { value: undefined })))
  on('tool.call', { tool: 'Grep' }, () => ({ result: { mode: 'content', numLines: 1, content: 'found' } }))
  on('tool.call', { tool: 'Glob' }, () => ({ result: { filenames: ['/w/a'], durationMs: 1, numFiles: 1, truncated: false } }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: 'ran', stderr: '' } }))
  on('tool.call', { tool: 'Read' }, () => ({ result: { type: 'text', file: { filePath: '/w/x', content: 'read', numLines: 1, startLine: 1, totalLines: 1 } } }))
  on('fs.exists', ($: any, e: any) => (o.existsDeny ? { deny: 'EIO: network location' } : { value: e.path in seen.files }))
  on('fs.list', () => ({ deny: 'ENOENT' }))
  let chmods = 0
  on('process.run', ($: any, e: any) => {
    seen.argv.push(e.argv)
    seen.events.push(e.argv[0])
    const fails = e.argv[0] === 'chmod' && (Boolean(o.chmodFail) || (o.chmodFailOn ?? []).includes(++chmods))
    return { value: { exitCode: fails ? 1 : 0, stdout: '', stderr: fails ? (o.chmodFail ?? 'chmod: Operation not permitted') : '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  const answerOf = (r: Reply) => {
    if (typeof r === 'string') return { value: { status: 200, ok: true, headers: {}, text: r } }
    if ('deny' in r) return { deny: r.deny }
    return { value: { status: r.status, ok: r.status >= 200 && r.status < 300, headers: r.headers ?? {}, text: r.text } }
  }
  on('http.fetch', ($: any, e: any) => {
    seen.fetches.push({ url: e.url, init: e.init })
    const r = o.fetch?.(e.url, e.init) ?? MODELS
    return r instanceof Promise ? r.then(answerOf) : answerOf(r)
  })
  on('store.get', ($: any, e: any) => ({ value: seen.store.get(e.key) }))
  on('store.set', ($: any, e: any) => (seen.store.set(e.key, e.value), { value: undefined }))
  on('store.delete', ($: any, e: any) => (seen.store.delete(e.key), { value: undefined }))
  on('ui.open', ($: any, e: any) => (seen.opened.push({ ...e }), { value: { isPlaced: !o.unplaced } }))
  on('ui.close', ($: any, e: any) => (seen.closed.push(e.id), { value: undefined }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.toast', ($: any, e: any) => (seen.toasts.push(e.text), { value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('tool.call', { tool: 'AskUserQuestion' }, ($: any, e: any) => {
    seen.asked++
    if (o.noAsk) throw new Error('no tool named "AskUserQuestion" in this session')
    return { result: { questions: e.questions, answers: { [e.questions[0].question]: o.answer ?? 'Remove' } } }
  })
  return seen
}

async function run($: any, args: string): Promise<string> {
  return (await $.command.run({ command: 'duet', args, origin: COMPOSER, presentation: PRESENTATION })).text
}

const start = ($: any, cwd = '/w') => $.session.start({ surface: 'terminal', isInteractive: true, cwd })
const mount = ($: any, surface: 'terminal' | 'desktop' = 'terminal', props: object = PANE) =>
  $.ui.mount({ plugin: 'duet', surface, component: 'Pane', requestId: 'duet-providers', props, viewport: { columns: 120, rows: 40 } })

/** Every provider's stored test result, one store key each (`duet:providers:tests:<id>`, Codex 4298476151 and CLAUDE.md's store rule). */
const testsIn = (seen: Seen): Record<string, any> => Object.fromEntries([...seen.store].filter(([k]) => k.startsWith('duet:providers:tests:')).map(([k, v]) => [k.slice('duet:providers:tests:'.length), v]))
/** Store entries for results, one key per provider. */
const seed = (tests: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(tests).map(([id, v]) => [`duet:providers:tests:${id}`, v]))

/** Every text the test can see: command answers, toasts, files duet wrote, the store. Never holds a key. */
const everything = (seen: Seen, ...texts: string[]) => [...texts, ...seen.toasts, JSON.stringify([...seen.store]), ...Object.entries(seen.files).filter(([p]) => p !== KEY_FILE).map(([, t]) => t)].join('\n')

describe('/duet provider', () => {
  test('list: each provider with its sign-in and last test; the file and the environment are both read; the key itself is never printed', async ($, on) => {
    const seen = engine(on, { files: { [KEY_FILE]: `# mine\nGEMINI_API_KEY=${KEY}\n` }, env: { XAI_API_KEY: XAI } })
    await start($)
    const text = await run($, 'provider list')
    expect(text).toContain('duet providers · 2 keys · 0 tested')
    expect(text).toMatch(/anthropic\s+Anthropic \(Claude\)\s+signed-in\s+untested/)
    expect(text).toMatch(/google\s+Google Gemini\s+key …a1b2\s+untested/)
    expect(text).toMatch(/xai\s+xAI Grok\s+key …9f3e from env\s+untested/)
    expect(text).toMatch(/codex\s+Codex CLI \(tools\)\s+codex login/)
    expect(text).toMatch(/ollama\s+Ollama \(local\)\s+localhost:11434/)
    expect(text).toMatch(/custom\s+Custom endpoint\s+no URL set/)
    expect(text).toContain('~/.claude/duet-data/.env')
    expect(everything(seen, text)).not.toContain(KEY)
    expect(everything(seen, text)).not.toContain(XAI)
  })

  test('a key typed as a command argument is refused and nothing is written', async ($, on) => {
    const seen = engine(on)
    await start($)
    const text = await run($, `provider key google ${KEY}`)
    expect(text).toContain('a key typed into the prompt is already in your transcript and shell history; rotate it')
    expect(text).toContain('/duet provider key google')
    expect(seen.files[KEY_FILE]).toBeUndefined()
    expect(everything(seen, text)).not.toContain(KEY)
  })

  test('key <id> opens the pane on that row with the field open; Enter upserts one line, keeps the rest, runs chmod 600, and the row masks it', async ($, on) => {
    const seen = engine(on, { files: { [KEY_FILE]: '# mine\nOTHER=keep this  \nGEMINI_API_KEY=old\n' } })
    await start($)
    const text = await run($, 'provider key google')
    expect(text).toContain('Duet providers')
    expect(seen.opened.map(o => [o.id, o.focus])).toEqual([['duet-providers', true]])
    const ui = await mount($)
    expect(await ui.find({ type: 'Input', key: 'prov-key' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /GEMINI_API_KEY/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /typing is visible until Enter/ })).toBeDefined()
    await ui.input({ key: 'prov-key', text: KEY, kind: 'submit' })
    await seen.clock.settle()
    expect(seen.files[KEY_FILE]).toBe(`# mine\nOTHER=keep this  \nGEMINI_API_KEY=${KEY}\n`)
    expect(seen.argv).toContainEqual(['chmod', '600', KEY_FILE])
    expect(await ui.find({ type: 'Text', text: /google\s+Google Gemini\s+key …a1b2/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /saved to ~\/.claude\/duet-data\/.env \(chmod 600\) · t tests it/ })).toBeDefined()
    expect(await ui.find({ type: 'Input', key: 'prov-key' })).toBeUndefined()
    await ui.unmount()
    expect(everything(seen)).not.toContain(KEY)
  })

  test('under codexFsScope anything the saved note warns that Codex can read the key file; under project it does not', async ($, on) => {
    const seen = engine(on, { files: { [KEY_FILE]: '' } })
    await start($)
    await run($, 'provider key google')
    const ui = await mount($)
    await ui.input({ key: 'prov-key', text: KEY, kind: 'submit' })
    await seen.clock.settle()
    expect(await ui.find({ type: 'Text', text: /saved to ~\/.claude\/duet-data\/.env \(chmod 600\) · t tests it/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Codex can read this file under codexFsScope: anything; project hides it\./ })).toBeDefined()
    await ui.unmount()
  })

  test('under codexFsScope project the saved note has no Codex warning', { options: { codexFsScope: 'project' } }, async ($, on) => {
    const seen = engine(on, { files: { [KEY_FILE]: '' } })
    await start($)
    await run($, 'provider key google')
    const ui = await mount($)
    await ui.input({ key: 'prov-key', text: KEY, kind: 'submit' })
    await seen.clock.settle()
    expect(await ui.find({ type: 'Text', text: /saved to ~\/.claude\/duet-data\/.env/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Codex can read this file/ })).toBeUndefined()
    await ui.unmount()
  })

  test('an empty Enter changes nothing and says so', async ($, on) => {
    const seen = engine(on, { files: { [KEY_FILE]: 'OTHER=1\n' } })
    await start($)
    await run($, 'provider key google')
    const ui = await mount($)
    await ui.input({ key: 'prov-key', text: '   ', kind: 'submit' })
    await seen.clock.settle()
    expect(seen.files[KEY_FILE]).toBe('OTHER=1\n')
    expect(seen.argv).toEqual([])
    expect(await ui.find({ type: 'Text', text: /nothing saved/ })).toBeDefined()
    await ui.unmount()
  })

  test('t tests the highlighted key: GET /models with the Bearer header, the row shows the result, the store keeps it without the key', async ($, on) => {
    const seen = engine(on, { files: { [KEY_FILE]: `GEMINI_API_KEY=${KEY}\n` } })
    await start($)
    await run($, 'provider key google')
    const ui = await mount($)
    await ui.press({ key: 'prov-test' })
    await seen.clock.settle()
    expect(seen.fetches.map(f => [f.url, f.init?.method])).toEqual([['https://generativelanguage.googleapis.com/v1beta/openai/models', 'GET']])
    expect(seen.fetches[0]!.init.headers.Authorization).toBe(`Bearer ${KEY}`)
    expect(await ui.find({ type: 'Text', text: /google\s+Google Gemini\s+key …a1b2\s+ok \d+ms · 2 models/ })).toBeDefined()
    await ui.unmount()
    const tests = testsIn(seen) as Record<string, { ok: boolean; status: number }>
    expect(tests.google!.ok).toBe(true)
    expect(tests.google!.status).toBe(200)
    expect(everything(seen)).not.toContain(KEY)
    expect(await run($, 'provider list')).toContain('1 keys · 1 tested')
  })

  test('test <id> as text: a provider with no /models goes straight to a one-token completion and names the model', async ($, on) => {
    const seen = engine(on, { env: { PERPLEXITY_API_KEY: 'pplx-test-0123456789abcdef' }, fetch: () => PROBE })
    await start($)
    const text = await run($, 'provider test perplexity')
    expect(seen.fetches.map(f => [f.url, f.init?.method])).toEqual([['https://api.perplexity.ai/chat/completions', 'POST']])
    expect(JSON.parse(seen.fetches[0]!.init.body)).toEqual({ model: 'sonar-pro', messages: [{ role: 'user', content: 'Reply with ok.' }], max_tokens: 1 })
    expect(text).toMatch(/perplexity: ok \d+ms sonar-pro · 1 token/)
    expect(await run($, 'provider test perplexity sonar')).toMatch(/perplexity: ok/)
    expect(JSON.parse(seen.fetches[1]!.init.body).model).toBe('sonar')
  })

  test('404 on /models names a likely wrong URL and spends no token; 401 is unauthorized; a rate limit is not retried; the host refusing is named', async ($, on) => {
    let n = 0
    const seen = engine(on, {
      files: { [KEY_FILE]: `GEMINI_API_KEY=${KEY}\nXAI_API_KEY=${XAI}\nGROQ_API_KEY=gsk-test-0123456789abcdef\nMISTRAL_API_KEY=m-test-0123456789abcdef\n` },
      fetch: (url) => {
        n++
        if (url.includes('googleapis')) return url.endsWith('/models') ? { status: 404, text: 'not found' } : PROBE
        if (url.includes('x.ai')) return { status: 401, text: `{"error":{"message":"Incorrect API key provided: ${XAI}"}}` }
        if (url.includes('groq')) return { status: 429, text: '', headers: { 'retry-after': '30' } }
        return { deny: 'nonessential traffic is disabled' }
      },
    })
    await start($)
    expect(await run($, 'provider test google')).toBe('google: ✕ 404 not found on /models: is the base URL right? (test <id> <model> runs a one-token completion instead)')
    expect(seen.fetches.length).toBe(1)
    // Naming a model asks for the one-token completion, and the answer says a token was spent.
    expect(await run($, 'provider test google gemini-2.5-pro')).toMatch(/google: ok \d+ms sonar-pro · 1 token/)
    expect(seen.fetches.length).toBe(2)
    expect(seen.fetches[1]!.url).toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions')
    const xai = await run($, 'provider test xai')
    expect(xai).toBe('xai: ✕ 401 unauthorized (Incorrect API key provided: [redacted])')
    expect(seen.fetches.length).toBe(3)
    expect(await run($, 'provider test groq')).toBe('groq: ✕ 429 rate limited (retry-after 30 s); not retried')
    expect(seen.fetches.length).toBe(4)
    expect(await run($, 'provider test mistral')).toBe('mistral: ✕ not sent: nonessential traffic is disabled')
    expect(n).toBe(5)
    expect(everything(seen, xai)).not.toContain(XAI)
  })

  test('a provider with no key, an unknown provider, and codex are refused with a reason', async ($, on) => {
    const seen = engine(on)
    await start($)
    expect(await run($, 'provider test google')).toBe('google: no key. Press e on its row in /duet provider, or set GEMINI_API_KEY.')
    expect(await run($, 'provider test nope')).toContain('unknown provider "nope"')
    expect(await run($, 'provider test codex')).toContain('codex signs in with codex login')
    expect(await run($, 'provider test anthropic')).toContain('anthropic signed-in: tested when a run goes to it (0.4.0); set ANTHROPIC_API_KEY to test a key')
    expect(await run($, 'provider test custom')).toContain('no URL set')
    expect(seen.fetches).toEqual([])
  })

  test('models <id> lists the provider\'s models; m in the pane shows them under the row', async ($, on) => {
    const seen = engine(on, { files: { [KEY_FILE]: `GEMINI_API_KEY=${KEY}\n` } })
    await start($)
    const text = await run($, 'provider models google')
    expect(text).toContain('google models (GET /models)')
    expect(text).toContain('gemini-2.5-pro')
    expect(text).toContain('gemini-2.5-flash')
    expect(await run($, 'provider models perplexity')).toContain('perplexity lists no models')
    // Codex 4297835980: OpenRouter's list is public, so it is listed with no key and no Authorization header; its probe still needs one.
    expect(await run($, 'provider models openrouter')).toContain('openrouter models (GET /models)')
    expect(seen.fetches.at(-1)!.init.headers.Authorization).toBeUndefined()
    expect(await run($, 'provider test openrouter')).toContain('ok')
    expect(await run($, 'provider test openrouter some-model')).toBe('openrouter: no key. Press e on its row in /duet provider, or set OPENROUTER_API_KEY.')
    await run($, 'provider key google')
    const ui = await mount($)
    await ui.press({ key: 'prov-models' })
    await seen.clock.settle()
    expect(await ui.find({ type: 'Text', text: /gemini-2.5-flash/ })).toBeDefined()
    await ui.unmount()
    expect(seen.fetches.length).toBe(4)
  })

  test('x asks before removing a key; Keep leaves the file; Remove rewrites it without the line; the typed command is immediate', async ($, on) => {
    const seen = engine(on, { files: { [KEY_FILE]: `A=1\nGEMINI_API_KEY=${KEY}\nXAI_API_KEY=${XAI}\n` }, answer: 'Keep' })
    await start($)
    await run($, 'provider key google')
    const ui = await mount($)
    await ui.press({ key: 'prov-remove' })
    await seen.clock.settle()
    expect(seen.asked).toBe(1)
    expect(seen.files[KEY_FILE]).toBe(`A=1\nGEMINI_API_KEY=${KEY}\nXAI_API_KEY=${XAI}\n`)
    await ui.unmount()
    expect(await run($, 'provider remove google')).toBe('google: key removed from ~/.claude/duet-data/.env.')
    expect(seen.files[KEY_FILE]).toBe(`A=1\nXAI_API_KEY=${XAI}\n`)
    // Codex 4297835988: a removal rewrites the secret-bearing file, so it gets the same chmod 600.
    expect(seen.argv).toContainEqual(['chmod', '600', KEY_FILE])
    expect(seen.asked).toBe(1)
    expect(await run($, 'provider remove google')).toBe('google: no key stored in ~/.claude/duet-data/.env (a key in your environment stays).')
  })

  test('x with the answer Remove rewrites the file', async ($, on) => {
    const seen = engine(on, { files: { [KEY_FILE]: `GEMINI_API_KEY=${KEY}\n` }, answer: 'Remove' })
    await start($)
    await run($, 'provider key google')
    const ui = await mount($)
    await ui.press({ key: 'prov-remove' })
    await seen.clock.settle()
    expect(seen.files[KEY_FILE]).toBe('')
    expect(await ui.find({ type: 'Text', text: /google\s+Google Gemini\s+no key/ })).toBeDefined()
    await ui.unmount()
  })

  // The d.ts lists no Input on the mobile surface, but `$.ui.mount` on `mobile` resolves a table with one (2.1.301), so the
  // text-only branch can't be reached here; it is read, not run (gotchas.md).
  test('pane states: empty copy, narrow drops the names', async ($, on) => {
    engine(on)
    await start($)
    await run($, 'provider')
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await mount($, surface)
      expect(await ui.find({ type: 'Text', text: /DUET PROVIDERS/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /0 keys · 0 tested/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /no provider keys yet · e on a row enters one · codex signs in with codex login/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /anthropic\s+Anthropic \(Claude\)\s+signed-in/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /e enter key\s+t test\s+m models\s+x remove\s+j\/k\s+c close/ })).toBeDefined()
      await ui.unmount()
    }
    const narrow = await mount($, 'terminal', { ...PANE, bodyColumns: 50 })
    expect(await narrow.find({ type: 'Text', text: /google\s+no key/ })).toBeDefined()
    expect(await narrow.find({ type: 'Text', text: /Google Gemini/ })).toBeUndefined()
    await narrow.unmount()
  })

  test('j/k move the highlight; c closes; the bare command toggles the pane', async ($, on) => {
    const seen = engine(on)
    await start($)
    expect(await run($, 'provider')).toContain('Duet providers')
    const ui = await mount($)
    await ui.press({ key: 'prov-next' })
    await ui.press({ key: 'prov-next' })
    expect(await ui.find({ type: 'Text', text: /^▸ .*codex/ })).toBeDefined()
    await ui.press({ key: 'prov-prev' })
    expect(await ui.find({ type: 'Text', text: /^▸ .*openai/ })).toBeDefined()
    await ui.press({ key: 'prov-close' })
    expect(seen.closed).toEqual(['duet-providers'])
    await ui.unmount()
  })

  test('Codex 4297835973: saving or removing a key drops that provider\'s old test result, in the pane and the store', async ($, on) => {
    const seen = engine(on, { files: { [KEY_FILE]: `GEMINI_API_KEY=${KEY}\n` }, store: seed({ google: { ok: true, status: 200, ms: 1, model: '', note: 'ok 1ms · 2 models', at: 1, key: keyId(KEY) }, xai: { ok: false, status: 401, ms: 1, model: '', note: '✕ 401 unauthorized', at: 1 } }) })
    await start($)
    expect(await run($, 'provider list')).toMatch(/google\s+Google Gemini\s+key …a1b2\s+ok 1ms · 2 models/)
    await run($, 'provider key google')
    const ui = await mount($)
    await ui.input({ key: 'prov-key', text: 'AIza-replacement-0123456789abcdef', kind: 'submit' })
    await seen.clock.settle()
    expect(await ui.find({ type: 'Text', text: /google\s+Google Gemini\s+key …cdef\s+untested/ })).toBeDefined()
    await ui.unmount()
    const stored = testsIn(seen) as Record<string, unknown>
    expect(stored.google).toBeUndefined()
    expect(stored.xai).toBeDefined()
    await run($, 'provider test google')
    expect((testsIn(seen) as Record<string, unknown>).google).toBeDefined()
    await run($, 'provider remove google')
    expect((testsIn(seen) as Record<string, unknown>).google).toBeUndefined()
  })

  test('Codex 4298476151: a test result is merged into the shared store, never replacing another session\'s', async ($, on) => {
    const seen = engine(on, { files: { [KEY_FILE]: `GEMINI_API_KEY=${KEY}\n` } })
    await start($)
    await run($, 'provider list')
    // Another session stored a result after this one read the store.
    seen.store.set('duet:providers:tests:xai', { ok: true, status: 200, ms: 5, model: '', note: 'ok 5ms · 3 models', at: 2 })
    await run($, 'provider test google')
    const stored = testsIn(seen) as Record<string, { ok: boolean }>
    expect(stored.xai!.ok).toBe(true)
    expect(stored.google!.ok).toBe(true)
  })

  test('Codex 4297835997 (P1): with no home folder a key is refused, never written under the project', async ($, on) => {
    const seen = engine(on, { noHome: true, env: { XAI_API_KEY: XAI } })
    await start($)
    await run($, 'provider key google')
    const ui = await mount($)
    await ui.input({ key: 'prov-key', text: KEY, kind: 'submit' })
    await seen.clock.settle()
    expect(await ui.find({ type: 'Text', text: /not saved: no home folder \(HOME or USERPROFILE\); keys can't be stored/ })).toBeDefined()
    await ui.unmount()
    expect(Object.keys(seen.files)).toEqual([])
    expect(seen.argv).toEqual([])
    // Keys from the environment still work, and a provider that takes no key (Codex 4298736545) is tested and listed as usual.
    expect(await run($, 'provider list')).toMatch(/xai\s+xAI Grok\s+key …9f3e from env/)
    expect(await run($, 'provider remove google')).toContain("no home folder")
    expect(await run($, 'provider test ollama')).toMatch(/ollama: ok \d+ms · 2 models/)
    expect(await run($, 'provider models ollama')).toContain('ollama models (GET /models)')
    expect(seen.fetches.every(f => f.init.headers.Authorization === undefined)).toBe(true)
  })

  test('Codex 4297836029: a key file that cannot be written leaves the field open and says why', async ($, on) => {
    const seen = engine(on, { writeDeny: `EACCES: permission denied, open ${KEY_FILE}`, files: { [KEY_FILE]: '' } })
    await start($)
    await run($, 'provider key google')
    const ui = await mount($)
    await ui.input({ key: 'prov-key', text: KEY, kind: 'submit' })
    await seen.clock.settle()
    expect(await ui.find({ type: 'Text', text: /not saved: EACCES: permission denied/ })).toBeDefined()
    expect(await ui.find({ type: 'Input', key: 'prov-key' })).toBeDefined()
    await ui.unmount()
    expect(everything(seen)).not.toContain(KEY)
  })

  test('Codex 4298476175: a key file that exists but cannot be read is named, not treated as empty', async ($, on) => {
    const seen = engine(on, { files: { [KEY_FILE]: `GEMINI_API_KEY=${KEY}\n` }, unreadable: 'EACCES: permission denied' })
    await start($)
    const text = await run($, 'provider list')
    expect(text).toContain('~/.claude/duet-data/.env could not be read (EACCES: permission denied); only keys from the environment are used')
    expect(await run($, 'provider test google')).toBe('google: ~/.claude/duet-data/.env could not be read (EACCES: permission denied); fix the file, or set GEMINI_API_KEY.')
    expect(seen.fetches).toEqual([])
    expect(await run($, 'provider test ollama')).toMatch(/ollama: ok/)
  })

  test('Codex 4297836014: a provider that never answers is given 30 s, then the test fails and a late reply changes nothing', async ($, on) => {
    let release: (r: Reply) => void = () => undefined
    const seen = engine(on, { files: { [KEY_FILE]: `GEMINI_API_KEY=${KEY}\n` }, fetch: () => new Promise<Reply>(res => { release = res }) })
    await start($)
    await run($, 'provider key google')
    const ui = await mount($, 'terminal', { ...PANE, bodyColumns: 120 })   // wide: a 76-column pane cuts the test column
    await ui.press({ key: 'prov-test' })
    await seen.clock.advance(1)
    expect(await ui.find({ type: 'Text', text: /testing…/ })).toBeDefined()
    await seen.clock.advance(30_000)
    await seen.clock.advance(1)
    expect(await ui.find({ type: 'Text', text: /✕ not sent: no reply within 30 s/ })).toBeDefined()
    release(MODELS)
    await seen.clock.settle()
    expect(await ui.find({ type: 'Text', text: /✕ not sent: no reply within 30 s/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /ok \d+ms · 2 models/ })).toBeUndefined()
    await ui.unmount()
  })

  test('Codex 4298476163: a model list that arrives after the person moved to another provider is dropped', async ($, on) => {
    let releaseGoogle: (r: Reply) => void = () => undefined
    const seen = engine(on, { files: { [KEY_FILE]: `GEMINI_API_KEY=${KEY}\nXAI_API_KEY=${XAI}\n` }, fetch: (url) => (url.includes('googleapis') ? new Promise<Reply>(res => { releaseGoogle = res }) : '{"data":[{"id":"grok-4"}]}') })
    await start($)
    await run($, 'provider key google')
    const ui = await mount($)
    await ui.press({ key: 'prov-models' })
    await ui.press({ key: 'prov-next' })
    await ui.press({ key: 'prov-models' })
    await seen.clock.settle()
    expect(await ui.find({ type: 'Text', text: /grok-4/ })).toBeDefined()
    releaseGoogle(MODELS)
    await seen.clock.settle()
    expect(await ui.find({ type: 'Text', text: /grok-4/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /gemini-2.5-flash/ })).toBeUndefined()
    await ui.unmount()
  })

  test('Codex 4298989618: a JSON null reply fails the test and leaves nothing stuck on testing…', async ($, on) => {
    const seen = engine(on, { files: { [KEY_FILE]: `GEMINI_API_KEY=${KEY}\n` }, fetch: () => 'null' })
    await start($)
    expect(await run($, 'provider test google')).toBe('google: ✕ 200 the reply is not JSON')
    expect(await run($, 'provider list')).toMatch(/google\s+Google Gemini\s+key …a1b2\s+✕ 200 the reply is not JSON/)
    expect((testsIn(seen) as Record<string, { ok: boolean }>).google!.ok).toBe(false)
  })

  test('Codex 4298989626: a test result is bound to the key it tested: a reply that lands after the key changed is dropped, a stored result for another key shows as untested, and t while running sends nothing', async ($, on) => {
    let release: (r: Reply) => void = () => undefined
    const seen = engine(on, { files: { [KEY_FILE]: `GEMINI_API_KEY=${KEY}\n` }, fetch: () => new Promise<Reply>(res => { release = res }) })
    await start($)
    await run($, 'provider key google')
    const ui = await mount($, 'terminal', { ...PANE, bodyColumns: 120 })
    await ui.press({ key: 'prov-test' })
    await ui.press({ key: 'prov-test' })
    await seen.clock.advance(1)
    expect(seen.fetches.length).toBe(1)
    await ui.press({ key: 'prov-enter' })
    await ui.input({ key: 'prov-key', text: 'AIza-replacement-0123456789abcdef', kind: 'submit' })
    await seen.clock.settle()
    release(MODELS)
    await seen.clock.settle()
    expect(await ui.find({ type: 'Text', text: /google\s+Google Gemini\s+key …cdef\s+untested/ })).toBeDefined()
    expect((testsIn(seen) as Record<string, unknown>).google).toBeUndefined()
    await ui.unmount()
    // A result stored for another key (another session, or the file changed by hand) does not vouch for this one.
    seen.store.set('duet:providers:tests:google', { ok: true, status: 200, ms: 1, model: '', note: 'ok 1ms · 2 models', at: 1, key: '…a1b2' })
    expect(await run($, 'provider list')).toMatch(/google\s+Google Gemini\s+key …cdef\s+untested/)
  })

  test('t on a provider that cannot be tested shows the reason even when an old result is stored', async ($, on) => {
    const seen = engine(on, { files: { [KEY_FILE]: `GEMINI_API_KEY=${KEY}\n` }, unreadable: 'EACCES: permission denied', store: seed({ google: { ok: true, status: 200, ms: 1, model: '', note: 'ok 1ms · 2 models', at: 1, key: '…a1b2' } }) })
    await start($)
    await run($, 'provider key google')
    const ui = await mount($, 'terminal', { ...PANE, bodyColumns: 120 })
    await ui.press({ key: 'prov-test' })
    await seen.clock.settle()
    expect(await ui.find({ type: 'Text', text: /could not be read \(EACCES: permission denied\); fix the file, or set GEMINI_API_KEY/ })).toBeDefined()
    expect(seen.fetches).toEqual([])
    await ui.unmount()
  })

  test('Codex 4299362989: a new key file whose mode cannot be set gets no key, the field stays open, and the retry does not write before chmod either', async ($, on) => {
    const seen = engine(on, { chmodFail: 'chmod: Operation not permitted' })
    await start($)
    await run($, 'provider key google')
    const ui = await mount($)
    await ui.input({ key: 'prov-key', text: KEY, kind: 'submit' })
    await seen.clock.settle()
    expect(await ui.find({ type: 'Text', text: /not saved: chmod 600 failed: chmod: Operation not permitted/ })).toBeDefined()
    expect(await ui.find({ type: 'Input', key: 'prov-key' })).toBeDefined()
    expect(seen.files[KEY_FILE] ?? '').toBe('')
    // The retry finds the empty file: the mode is set before anything is written, and a second failure still writes nothing.
    await ui.input({ key: 'prov-key', text: KEY, kind: 'submit' })
    await seen.clock.settle()
    expect(seen.files[KEY_FILE] ?? '').toBe('')
    expect(everything(seen)).not.toContain(KEY)
    await ui.unmount()
  })

  test('Codex 4299362999: a custom result stored for another base URL shows as untested', { options: { apiCustomUrl: 'https://gw.example.com/v1' } }, async ($, on) => {
    engine(on, { env: { DUET_CUSTOM_API_KEY: 'ck-test-0123456789abcdef' }, store: seed({ custom: { ok: true, status: 200, ms: 1, model: '', note: 'ok 1ms · 2 models', at: 1, key: '…cdef', host: 'https://old.example/v1' } }) })
    await start($)
    expect(await run($, 'provider list')).toMatch(/custom\s+Custom endpoint\s+key …cdef from env · gw.example.com\s+untested/)
  })

  test('Codex 4299426945: two tests of one provider started together send one request', async ($, on) => {
    let release: (r: Reply) => void = () => undefined
    const seen = engine(on, { files: { [KEY_FILE]: `GEMINI_API_KEY=${KEY}\n` }, fetch: () => new Promise<Reply>(res => { release = res }) })
    await start($)
    const both = Promise.all([run($, 'provider test google'), run($, 'provider test google')])
    await seen.clock.advance(1)
    expect(seen.fetches.length).toBe(1)
    release(MODELS)
    const [a, b] = await both
    expect([a, b].filter(t => /google: ok/.test(t)).length).toBe(1)
    expect([a, b].filter(t => t === 'google: a test is already running.').length).toBe(1)
  })

  test('Codex 4299426954: a failed model list\'s text is cleaned before it reaches the answer or the pane', async ($, on) => {
    const seen = engine(on, { files: { [KEY_FILE]: `GEMINI_API_KEY=${KEY}\n` }, fetch: () => ({ status: 500, text: '\u001b[2Jboom ' + KEY }) })
    await start($)
    expect(await run($, 'provider models google')).toBe('google: 500: [2Jboom [redacted]')
    expect(seen.fetches.length).toBe(1)
  })

  test('Windows: the key file under USERPROFILE is saved without chmod, which Windows has not, and the note says the user folder\'s permissions apply', async ($, on) => {
    const WIN = 'C:/Users/x/.claude/duet-data/.env'
    const seen = engine(on, { noHome: true, env: { USERPROFILE: 'C:\\Users\\x' }, chmodFail: "'chmod' is not recognized as a command" })
    await start($)
    await run($, 'provider key google')
    const ui = await mount($)
    await ui.input({ key: 'prov-key', text: KEY, kind: 'submit' })
    await seen.clock.settle()
    // The engine under test runs on Linux and resolves `C:/…` against its own folder, so the file is found by its ending.
    expect(Object.entries(seen.files).find(([path]) => path.endsWith(WIN))?.[1]).toBe(`GEMINI_API_KEY=${KEY}\n`)
    expect(seen.argv.filter(a => a[0] === 'chmod')).toEqual([])
    expect(await ui.find({ type: 'Text', text: /saved to ~\/.claude\/duet-data\/.env \(Windows: no chmod\) · t tests it/ })).toBeDefined()
    await ui.unmount()
    expect(await run($, 'provider remove google')).toBe('google: key removed from ~/.claude/duet-data/.env.')
  })

  test('Codex 4298476151 and CLAUDE.md: each provider\'s result has its own store key, so sessions never overwrite each other\'s', async ($, on) => {
    const seen = engine(on, { files: { [KEY_FILE]: `GEMINI_API_KEY=${KEY}\nXAI_API_KEY=${XAI}\n` } })
    await start($)
    await run($, 'provider test google')
    await run($, 'provider test xai')
    expect([...seen.store.keys()].filter(k => k.startsWith('duet:providers:tests')).sort()).toEqual(['duet:providers:tests:google', 'duet:providers:tests:xai'])
  })

  test('Codex 4299537610 and 4299537623: a stored result for another key of the same length is untested and not counted; one made with no key goes when a key arrives', async ($, on) => {
    const ok = (key: string) => ({ ok: true, status: 200, ms: 1, model: '', note: 'ok 1ms · 2 models', at: 1, key, host: '' })
    const seen = engine(on, { env: { GEMINI_API_KEY: 'short-two', OPENROUTER_API_KEY: 'or-key-0123456789abcdef' }, store: seed({ google: ok(keyId('short-one')), openrouter: ok(keyId('')) }) })
    await start($)
    const text = await run($, 'provider list')
    expect(text).toMatch(/google\s+Google Gemini\s+key … from env\s+untested/)
    expect(text).toMatch(/openrouter\s+OpenRouter \(gateway\)\s+key …cdef from env\s+untested/)
    expect(text).toContain('2 keys · 0 tested')
    seen.store.set('duet:providers:tests:google', ok(keyId('short-two')))
    expect(await run($, 'provider list')).toMatch(/google\s+Google Gemini\s+key … from env\s+ok 1ms · 2 models/)
  })

  test('Codex 4299537637: /duet provider models prints at most 200 ids and says how many more there are', async ($, on) => {
    engine(on, { files: { [KEY_FILE]: `GEMINI_API_KEY=${KEY}\n` }, fetch: () => JSON.stringify({ data: Array.from({ length: 466 }, (_, i) => ({ id: `m${i}` })) }) })
    await start($)
    const text = await run($, 'provider models google')
    expect(text.split('\n').length).toBe(202)
    expect(text).toContain('… 266 more not shown')
  })

  test('a save whose final chmod failed is a warning, not a green "saved"', async ($, on) => {
    const seen = engine(on, { files: { [KEY_FILE]: '' }, chmodFailOn: [2] })
    await start($)
    await run($, 'provider key google')
    const ui = await mount($)
    await ui.input({ key: 'prov-key', text: KEY, kind: 'submit' })
    await seen.clock.settle()
    const line: any = await ui.find({ type: 'Text', text: /saved to .*chmod 600 failed/ })
    expect(line).toBeDefined()
    expect(line.props.color).toBe('#E0B15A')
    await ui.unmount()
  })

  test('an fs.exists that rejects never truncates the key file: the other keys stay', async ($, on) => {
    const seen = engine(on, { files: { [KEY_FILE]: `XAI_API_KEY=${XAI}\n` }, existsDeny: true })
    await start($)
    await run($, 'provider key google')
    const ui = await mount($)
    await ui.input({ key: 'prov-key', text: KEY, kind: 'submit' })
    await seen.clock.settle()
    expect(seen.files[KEY_FILE]).toBe(`XAI_API_KEY=${XAI}\nGEMINI_API_KEY=${KEY}\n`)
    expect(seen.events.includes('write empty')).toBe(false)
    await ui.unmount()
  })

  test('with no pane (headless, or too narrow) key <id> says where the key goes instead', async ($, on) => {
    engine(on, { unplaced: true })
    await start($)
    const text = await run($, 'provider key google')
    expect(text).toContain('No pane could be shown here: set GEMINI_API_KEY in your environment, or add a line GEMINI_API_KEY=<key> to ~/.claude/duet-data/.env (mode 600).')
    expect(text).not.toContain('too narrow')
    expect(await run($, 'provider')).toContain('(The pane could not be shown here: a narrow window or a headless run.')
  })

  test('the config pane marks the option rows its window hides', async ($, on) => {
    engine(on)
    await start($)
    const ui = await $.ui.mount({ plugin: 'duet', surface: 'terminal', component: 'Pane', requestId: 'duet-config', props: { ...PANE, scroll: { offset: 0, bodyRows: 14 } }, viewport: { columns: 120, rows: 40 } })
    expect(await ui.find({ type: 'Text', text: /↓ \d+ more \(j\)/ })).toBeDefined()
    await ui.unmount()
  })

  test('a Grep of the key file or its folder is refused; a grep for the path in the repo\'s own files passes', async ($, on) => {
    engine(on)
    await start($)
    for (const input of [{ pattern: 'API_KEY', path: '/home/u/.claude/duet-data' }, { pattern: 'KEY', path: '/home/u/.claude/duet-data/.env' }, { pattern: 'x', glob: '**/duet-data/.env' }]) {
      const r: any = await $.tool.call({ tool: 'Grep', ...input } as never)
      expect([input, r.deny]).toEqual([input, expect.stringMatching(/duet: that file holds API keys/)])
    }
    const ok: any = await $.tool.call({ tool: 'Grep', pattern: 'duet-data/.env', path: '/w' } as never)
    expect(ok.deny).toBeUndefined()
    // Glob too: a listing of the folder or a pattern that reaches the file (the owner's layer 4).
    for (const input of [{ pattern: '*', path: '/home/u/.claude/duet-data' }, { pattern: '**/duet-data/.env' }, { pattern: '.env', path: '~/.claude/duet-data/' }]) {
      const r: any = await $.tool.call({ tool: 'Glob', ...input } as never)
      expect([input, r.deny]).toEqual([input, expect.stringMatching(/duet: that file holds API keys/)])
    }
    const globOk: any = await $.tool.call({ tool: 'Glob', pattern: '**/*.ts', path: '/w' } as never)
    expect(globOk.deny).toBeUndefined()
    const bash: any = await $.tool.call({ tool: 'Bash', command: 'grep -n "duet-data/.env" README.md' } as never)
    expect(bash.deny).toBeUndefined()
  })

  test('a new key file is created empty and chmodded before the key is written; an existing one is chmodded, rewritten and chmodded again', async ($, on) => {
    const seen = engine(on)
    await start($)
    await run($, 'provider key google')
    const ui = await mount($)
    await ui.input({ key: 'prov-key', text: KEY, kind: 'submit' })
    await seen.clock.settle()
    expect(seen.events).toEqual(['write empty', 'chmod', 'write content', 'chmod'])
    expect(seen.files[KEY_FILE]).toBe(`GEMINI_API_KEY=${KEY}\n`)
    await ui.unmount()
    seen.events.length = 0
    seen.files[KEY_FILE] = `GEMINI_API_KEY=${KEY}\nXAI_API_KEY=${XAI}\n`
    await run($, 'provider remove google')
    expect(seen.events).toEqual(['chmod', 'write content', 'chmod'])   // Codex 4299362989: the mode is set before any write, on an existing file too
    expect(seen.files[KEY_FILE]).toBe(`XAI_API_KEY=${XAI}\n`)
  })

  test('two key tests that finish together both land in the shared store (in-session serialization)', async ($, on) => {
    const seen = engine(on, { files: { [KEY_FILE]: `GEMINI_API_KEY=${KEY}\nXAI_API_KEY=${XAI}\n` }, fetch: () => Promise.resolve(MODELS) })
    await start($)
    const [g, x] = await Promise.all([run($, 'provider test google'), run($, 'provider test xai')])
    expect(g).toMatch(/google: ok/)
    expect(x).toMatch(/xai: ok/)
    const stored = testsIn(seen) as Record<string, unknown>
    expect(Object.keys(stored).sort()).toEqual(['google', 'xai'])
  })

  test('the custom provider at a local http URL needs no key (LM Studio, Codex 4298736595); a remote one does', { options: { apiCustomUrl: 'http://localhost:1234/v1' } }, async ($, on) => {
    const seen = engine(on)
    await start($)
    expect(await run($, 'provider test custom')).toMatch(/custom: ok \d+ms · 2 models/)
    expect(seen.fetches[0]!.url).toBe('http://localhost:1234/v1/models')
    expect(seen.fetches[0]!.init.headers.Authorization).toBeUndefined()
    expect(await run($, 'provider list')).toMatch(/custom\s+Custom endpoint\s+no key · localhost:1234/)
  })

  test('under codexFsScope project the saved note still warns when the session folder holds the key file (Codex 4298736579)', { options: { codexFsScope: 'project' } }, async ($, on) => {
    const seen = engine(on, { files: { [KEY_FILE]: '' }, cwd: '/home/u' })
    await start($, '/home/u')
    await run($, 'provider key google')
    const ui = await mount($)
    await ui.input({ key: 'prov-key', text: KEY, kind: 'submit' })
    await seen.clock.settle()
    expect(await ui.find({ type: 'Text', text: /Codex can read this file/ })).toBeDefined()
    await ui.unmount()
  })

  test('the field hint does not promise an Esc that the engine does not give; j/k leave the field', async ($, on) => {
    engine(on)
    await start($)
    await run($, 'provider key google')
    const ui = await mount($)
    expect(await ui.find({ type: 'Text', text: /Esc cancels/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /typing is visible until Enter · Enter saves · j\/k or c leave the field/ })).toBeDefined()
    await ui.press({ key: 'prov-next' })
    expect(await ui.find({ type: 'Input', key: 'prov-key' })).toBeUndefined()
    await ui.unmount()
  })

  test('a Bash command or a Read that names the key file is refused; others pass (side note on the mention guard)', async ($, on) => {
    engine(on)
    await start($)
    const bash: any = await $.tool.call({ tool: 'Bash', command: 'cat ~/.claude/duet-data/.env' } as never)
    expect(bash.deny).toMatch(/duet: that file holds API keys/)
    const bash2: any = await $.tool.call({ tool: 'Bash', command: 'cat /home/u/.claude/duet-data/.env' } as never)
    expect(bash2.deny).toMatch(/duet: that file holds API keys/)
    const ok: any = await $.tool.call({ tool: 'Bash', command: 'ls ~/.claude' } as never)
    expect(ok.deny).toBeUndefined()
    expect(ok.result.stdout).toBe('ran')
    // The folder, a wildcard in it, a $HOME spelling and a -c payload are refused too; a heredoc that documents the path is not.
    for (const command of ['ls ~/.claude/duet-data', 'cat ~/.claude/duet-data/*', 'cat "$HOME/.claude/duet-data/.env"', 'bash -c "cat ~/.claude/duet-data/.env"']) {
      const r: any = await $.tool.call({ tool: 'Bash', command } as never)
      expect([command, r.deny]).toEqual([command, expect.stringMatching(/duet: that file holds API keys/)])
    }
    const doc: any = await $.tool.call({ tool: 'Bash', command: "cat > README.md <<'EOF'\nkeys live in ~/.claude/duet-data/.env (600)\nEOF" } as never)
    expect(doc.deny).toBeUndefined()
    const read2: any = await $.tool.call({ tool: 'Read', file_path: '/home/u/.claude/duet-data//.env' } as never)
    expect(read2.deny).toMatch(/duet: that file holds API keys/)
    const read: any = await $.tool.call({ tool: 'Read', file_path: '/home/u/.claude/duet-data/.env' } as never)
    expect(read.deny).toMatch(/duet: that file holds API keys/)
    const readOk: any = await $.tool.call({ tool: 'Read', file_path: '/w/.env' } as never)
    expect(readOk.deny).toBeUndefined()
  })

  test('@-mentioning the key file is denied', async ($, on) => {
    engine(on)
    on('prompt.mention', () => ({ type: null }))
    await start($)
    const r = await $.prompt.mention({ mention: '~/.claude/duet-data/.env', path: '/home/u/.claude/duet-data/.env' })
    expect(r.deny).toMatch(/duet: that file holds API keys/)
    const other = await $.prompt.mention({ mention: '.env', path: '/w/.env' })
    expect(other.deny).toBeUndefined()
  })

  test('the custom endpoint: its URL must be https or local, and its row names the host', { options: { apiCustomUrl: 'https://gw.example.com/v1/', apiCustomModel: 'my-model' } }, async ($, on) => {
    ;(on as any)('config.list', () => ({ value: ['apiCustomUrl', 'apiCustomModel'].map(f => ({ key: `duet.${f}`, label: f, kind: 'text', value: '', provider: { plugin: 'duet' }, isLocked: false })) }))
    const sets: unknown[] = []
    ;(on as any)('config.set', ($: any, e: any) => (sets.push([e.key, e.value]), { value: e.value }))
    const seen = engine(on, { env: { DUET_CUSTOM_API_KEY: 'ck-test-0123456789abcdef' }, fetch: url => (url.endsWith('/models') ? MODELS : PROBE) })
    await start($)
    expect(await run($, 'provider list')).toMatch(/custom\s+Custom endpoint\s+key …cdef from env · gw.example.com/)
    expect(await run($, 'provider test custom')).toMatch(/custom: ok/)
    expect(seen.fetches[0]!.url).toBe('https://gw.example.com/v1/models')
    expect(await run($, 'config customurl http://evil.example.com/v1')).toContain('apiCustomUrl takes an https:// URL, or http:// to localhost')
    expect(sets).toEqual([])
    expect(await run($, 'config custommodel llama3:8b')).toContain('apiCustomModel = llama3:8b')
    expect(await run($, 'config list')).toContain('customurl')
  })
})

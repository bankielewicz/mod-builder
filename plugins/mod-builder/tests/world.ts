// What stands beneath the plugin in a hooks-module test: a store, a folder of files, the commands the gate runs,
// the person's answer, all in memory. Each test builds one with `world(on, { ... })` and reads back what the
// plugin did to it. Nothing here is the plugin's code.
import type { On } from 'claude-code'

export const GATE = 'mcp__mod-builder__mod_builder_gate'
export const MOD = '/work/turn-counter'
export const HOME = '/home/u'
// The plugin's own folder, as the engine loaded it for this test: the folder above this file's.
export const ROOT = new URL('..', (import.meta as unknown as { url: string }).url).pathname.replace(/\/$/, '')
// The mod being built is named otherwise than its folder, as a mod may be.
export const NAME = 'turns'

export type Ran = { exitCode: number; stdout: string; stderr?: string; isTruncated?: boolean } | 'never starts'

export type World = {
  // The session's id; null makes the session unable to say it.
  sessionId: string | null
  cwd: string
  store: Record<string, unknown>
  files: Record<string, string>
  // The person's answer to the next question; null dismisses it.
  answer: string | null
  // What each command answers, by a word its arguments hold: 'validate', 'test', 'tsc', '--plugin-dir'; and
  // 'refresh' for the docs fetcher, which is known by its file's name.
  runs: Record<string, Ran>
  commands: string[]
  now: number
  // The Claude Code version the session says it is.
  version: string
  // Store keys that can't be read.
  unreadable: string[]
  // Lines the plugin wrote to the transcript.
  logged: string[]
  // What the plugin did.
  asked: { question: string; options: string[] }[]
  ran: string[][]
  // The time each command was given, in milliseconds; undefined when the plugin named none.
  timeouts: (number | undefined)[]
  registered: { name: string; isDeferred?: unknown }[]
  commandsRegistered: string[]
  opened: { id: string; title?: string }[]
  reachedTheTool: { tool: string; path: string }[]
  // Runs when the person is asked, before the answer: a change made while the question is open.
  whileAsked: () => void
  // Runs while a command runs, after it started and before it answers.
  whileRunning: (argv: string[]) => void
  // When set, the docs fetcher does not answer until this resolves: a fetch still under way.
  fetchHeld: Promise<void> | null
}

const ok = (stdout = ''): Ran => ({ exitCode: 0, stdout })

export function passing(count: number, names: string[] = []): string {
  const shown = names.length > 0 ? names : Array.from({ length: count }, (_, i) => `test ${i + 1}`)
  return ['', 'tests/pane.test.tsx:', ...shown.map((name) => `(pass) ${name} [1.00ms]`), '', ` ${count} pass`, ' 0 fail', `Ran ${count} tests across 1 file. [0.20s]`, ''].join('\n')
}

export function failing(passed: string[], failed: string[], firstLine = 'AssertionError: expect(received).toBe()'): string {
  const total = passed.length + failed.length
  return [
    '', 'tests/pane.test.tsx:', ...passed.map((name) => `(pass) ${name} [1.00ms]`),
    ...failed.flatMap((name) => [`(fail) ${name} [0.40ms]`, `  ${firstLine}`]),
    '', ` ${passed.length} pass`, ` ${failed.length} fail`, `Ran ${total} tests across 1 file. [0.20s]`, '',
  ].join('\n')
}

export function world(on: On, start: Partial<World> = {}): World {
  const w: World = {
    sessionId: 's1',
    cwd: '/work',
    store: {},
    files: {},
    answer: 'Approve',
    runs: { validate: ok('Validation passed'), test: ok(passing(1)), tsc: ok(), '--plugin-dir': ok() },
    commands: ['help', 'cost'],
    now: 1000,
    version: '2.1.322',
    commandsRegistered: [],
    opened: [],
    unreadable: [],
    logged: [],
    asked: [],
    ran: [],
    timeouts: [],
    registered: [],
    reachedTheTool: [],
    whileAsked: () => {},
    whileRunning: () => {},
    fetchHeld: null,
    ...start,
  }
  const value = <T>(answer: T) => ({ value: answer }) as never
  const deny = (reason: string) => ({ deny: reason }) as never

  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => (w.sessionId === null ? deny('the session has no id') : value(w.sessionId)))
  on('ui.log', (_, e) => {
    w.logged.push((e as { text: string }).text)
    return value(undefined)
  })
  on('session.cwd', () => value(w.cwd))
  on('skill.prompt', (_, e) => ({ text: e.text }))
  on('clock.now', () => value(w.now))
  on('env.get', (_, e) => value((e as { name: string }).name === 'HOME' ? HOME : undefined))
  on('command.list', () => value(w.commands.map((name) => ({ name }))))
  on('command.register', (_, e) => {
    w.commandsRegistered.push((e as { name: string }).name)
    return value({ command: (e as { name: string }).name })
  })
  on('session.version', () => value({ version: w.version, base: w.version, builtAt: '' }))
  on('ui.open', (_, e) => {
    w.opened.push(e as { id: string; title?: string })
    return value({ isPlaced: true })
  })
  on('tool.register', (_, e) => {
    w.registered.push(e as never)
    return value(undefined)
  })

  on('store.get', (_, e) => {
    const { key } = e as { key: string }
    if (w.unreadable.includes(key)) return deny('the store can not be read')
    // A copy, as the engine hands one out: changing what was read changes nothing that is kept.
    return value(w.store[key] === undefined ? undefined : JSON.parse(JSON.stringify(w.store[key])))
  })
  on('store.set', (_, e) => {
    const { key, value: stored } = e as { key: string; value: unknown }
    w.store[key] = JSON.parse(JSON.stringify(stored))
    return value(undefined)
  })

  on('fs.exists', (_, e) => {
    const { path } = e as { path: string }
    return value(path in w.files || Object.keys(w.files).some((file) => file.startsWith(`${path}/`)))
  })
  on('fs.read', (_, e) => {
    const { path, as } = e as { path: string; as?: string }
    const text = w.files[path]
    if (text === undefined) return deny(`ENOENT: ${path}`)
    return value(as === 'bytes' ? { base64: btoa(text) } : text)
  })
  on('fs.write', (_, e) => {
    const { path, text } = e as { path: string; text: string }
    w.files[path] = text
    return value(undefined)
  })
  on('fs.list', (_, e) => {
    const { path } = e as { path: string }
    const names = new Map<string, 'file' | 'dir'>()
    for (const file of Object.keys(w.files)) {
      if (!file.startsWith(`${path}/`)) continue
      const rest = file.slice(path.length + 1).split('/')
      names.set(rest[0] ?? '', rest.length === 1 ? 'file' : 'dir')
    }
    if (names.size === 0) return deny(`ENOENT: ${path}`)
    return value([...names].map(([name, kind]) => ({ name, kind, size: 0, mtimeMs: 0, isLink: false })))
  })

  on('process.run', async (_, e) => {
    const { argv, init } = e as { argv: string[]; init?: { timeoutMs?: number } }
    w.ran.push([...argv])
    w.timeouts.push(init?.timeoutMs)
    const fetcher = argv.some((one) => one.endsWith('/refresh-docs.sh'))
    const word = fetcher ? 'refresh' : ['validate', 'test', 'tsc', '--plugin-dir'].find((one) => argv.includes(one))
    const ran = word === undefined ? undefined : w.runs[word]
    if (ran === undefined || ran === 'never starts') return deny('failed to start')
    w.whileRunning([...argv])
    if (fetcher && w.fetchHeld !== null) await w.fetchHeld
    // A headless load writes its debug log; the world writes what the test put under the log's key.
    const log = argv[argv.indexOf('--debug-file') + 1]
    if (word === '--plugin-dir' && log !== undefined && w.files['the load log'] !== undefined) w.files[log] = w.files['the load log']
    return value({ exitCode: ran.exitCode, stdout: ran.stdout, stderr: ran.stderr ?? '', isStdoutTruncated: ran.isTruncated === true, isStderrTruncated: false })
  })

  on('tool.call', (_, e) => {
    if (e.tool === 'AskUserQuestion') {
      const asked = (e as unknown as { questions: { question: string; options: { label: string }[] }[] }).questions[0]
      w.asked.push({ question: asked?.question ?? '', options: (asked?.options ?? []).map((option) => option.label) })
      w.whileAsked()
      if (w.answer === null) return { deny: 'dismissed' }
      return { result: { answers: { [asked?.question ?? '']: w.answer } } } as never
    }
    const fields = e as { file_path?: string; notebook_path?: string }
    w.reachedTheTool.push({ tool: String(e.tool), path: fields.file_path ?? fields.notebook_path ?? '' })
    return { result: {} } as never
  })

  return w
}

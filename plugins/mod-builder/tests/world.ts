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
// Where Claude Code keeps what it writes for a session's processes, and the build's types under it: one folder
// per process that loaded the plugin-authoring skill.
export const TMP = '/tmp/claude-1000'
export const TYPES_FOLDER = `${TMP}/bundled-skills/2.1.322`
export const TYPES = `${TYPES_FOLDER}/5d3947d0/plugin-authoring/types/claude-code.d.ts`
export const TYPES_TEXT = '// Written by Claude Code 2.1.322.\n// Claude Code function hooks.\n'
export const INSTALLED = 'npx --no-install tsc'
export const DOWNLOADED = 'npx -y -p typescript tsc'

export type Ran = { exitCode: number; stdout: string; stderr?: string; isTruncated?: boolean } | 'never starts'

export type World = {
  // The session's id; null makes the session unable to say it.
  sessionId: string | null
  // The session's working folder; null makes the session unable to say it.
  cwd: string | null
  store: Record<string, unknown>
  files: Record<string, string>
  // The person's answer to the next question; null dismisses it.
  answer: string | null
  // What each command answers, by a word its arguments hold: 'validate', 'test', 'tsc', '--plugin-dir'; and
  // 'refresh' for the docs fetcher, which is known by its file's name.
  runs: Record<string, Ran>
  commands: string[]
  // What each compiler answers when asked for its version (`-v`), by its command: INSTALLED and DOWNLOADED.
  compilers: Record<string, Ran>
  // The session's environment, by name. HOME and CLAUDE_TMPDIR are set unless a test takes one away.
  env: Record<string, string | undefined>
  // The folder each command ran in; undefined when the plugin named none.
  ranIn: (string | undefined)[]
  now: number
  // The Claude Code version the session says it is.
  version: string
  // Store keys that can't be read.
  unreadable: string[]
  // Paths that are links: listed as no file and no folder, as the engine lists one.
  links: string[]
  // How a path is listed when it is neither a plain file nor a plain folder: by its kind and whether it is a link.
  listedAs: Record<string, { kind: 'file' | 'dir' | 'other'; isLink: boolean }>
  // Paths that can't be written, each with everything under it.
  unwritable: string[]
  // When true, nothing can be looked for: every `fs.exists` fails.
  existsFails: boolean
  // Lines the plugin wrote to the transcript.
  logged: string[]
  // What the plugin did.
  asked: { question: string; options: string[] }[]
  ran: string[][]
  // The time each command was given, in milliseconds; undefined when the plugin named none.
  timeouts: (number | undefined)[]
  registered: { name: string; isDeferred?: unknown }[]
  commandsRegistered: string[]
  // What each registered command says of itself, by its name.
  described: Record<string, string>
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
    compilers: { [INSTALLED]: ok('Version 5.9.3\n'), [DOWNLOADED]: ok('Version 5.9.3\n') },
    env: { HOME, CLAUDE_TMPDIR: TMP },
    ranIn: [],
    now: 1000,
    version: '2.1.322',
    commandsRegistered: [],
    described: {},
    opened: [],
    unreadable: [],
    links: [],
    listedAs: {},
    unwritable: [],
    existsFails: false,
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
  // The build's types are written, as after the plugin-authoring skill loaded, unless the test's files say otherwise.
  if (!Object.keys(w.files).some((file) => file.startsWith(`${TMP}/`))) w.files[TYPES] = TYPES_TEXT
  const value = <T>(answer: T) => ({ value: answer }) as never
  const deny = (reason: string) => ({ deny: reason }) as never

  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => (w.sessionId === null ? deny('the session has no id') : value(w.sessionId)))
  on('ui.log', (_, e) => {
    w.logged.push((e as { text: string }).text)
    return value(undefined)
  })
  on('session.cwd', () => (w.cwd === null ? deny('the session has no folder') : value(w.cwd)))
  on('skill.prompt', (_, e) => ({ text: e.text }))
  on('clock.now', () => value(w.now))
  on('env.get', (_, e) => value(w.env[(e as { name: string }).name]))
  on('command.list', () => value(w.commands.map((name) => ({ name }))))
  on('command.register', (_, e) => {
    w.commandsRegistered.push((e as { name: string }).name)
    w.described[(e as { name: string }).name] = (e as { description: string }).description
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
    if (w.existsFails) return deny(`EIO: ${path}`)
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
    if (w.unwritable.some((one) => path === one || path.startsWith(`${one}/`))) return deny(`EACCES: ${path}`)
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
    return value([...names].map(([name, kind]) => {
      const as = w.listedAs[`${path}/${name}`]
      if (as !== undefined) return { name, kind: as.kind, size: 0, mtimeMs: 0, isLink: as.isLink }
      const isLink = w.links.includes(`${path}/${name}`)
      return { name, kind: isLink ? 'other' : kind, size: 0, mtimeMs: 0, isLink }
    }))
  })

  on('process.run', async (_, e) => {
    const { argv, init } = e as { argv: string[]; init?: { timeoutMs?: number; cwd?: string } }
    w.ran.push([...argv])
    w.timeouts.push(init?.timeoutMs)
    w.ranIn.push(init?.cwd)
    if (argv[0] === 'id') return w.runs.id === undefined || w.runs.id === 'never starts' ? deny('failed to start') : value({ exitCode: w.runs.id.exitCode, stdout: w.runs.id.stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })
    const fetcher = argv.some((one) => one.endsWith('/refresh-docs.sh'))
    const word = fetcher ? 'refresh' : ['validate', 'test', 'tsc', '--plugin-dir'].find((one) => argv.includes(one))
    // A compiler asked for its version answers by its own command; any other run, by the word it holds.
    const asked = argv.at(-1) === '-v' ? w.compilers[argv.slice(0, -1).join(' ')] : undefined
    const ran = asked !== undefined ? asked : word === undefined ? undefined : w.runs[word]
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

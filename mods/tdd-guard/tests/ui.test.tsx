import { describe, expect, mock, test } from 'claude-code/testing'

const RULES = 'red-test-writer=+tests/**,+test/**; green-developer=-tests/**,-test/**; refactorer=-tests/**,-test/**'
const options = { rules: RULES }
const ROOT = '/w'

/** The project as the stubbed file system holds it; `/w/test` is deliberately not there. */
const FILES: Record<string, string> = {
  '/w/tests/a.test.ts': 'A',
  '/w/tests/b.test.ts': 'B',
  '/w/tests/keep.test.ts': 'K',
  '/w/tests/sub/d.test.ts': 'D',
  '/w/src/x.ts': 'X',
  '/w/src/link.ts': 'L',
  '/elsewhere/tests/y.ts': 'Y',
}

type Seen = {
  files: Record<string, string>
  ran: { tool: string; path: string }[]
  toasts: string[]
  submitted: string[]
  listed: string[]
  reads: string[]
  clock: any
  /** Runs while the Agent tool runs; set it to change what the next run does. */
  during: ((files: Record<string, string>) => void) | undefined
  /** What the Agent tool answers next. */
  answer: unknown
}

type Opts = {
  agents?: { id: string; type: string }[]
  files?: Record<string, string>
  /** Where a path really lands, as a symbolic link would take it. */
  real?: Record<string, string>
  cwd?: string
  /** Runs while the Agent tool runs: the subagent's edits to the files. */
  during?: (files: Record<string, string>) => void
  /** What the Agent tool answers; the default is a finished foreground run. */
  agentAnswer?: unknown
}

const DONE = { status: 'completed', agentId: 'a1', content: [{ type: 'text', text: 'done' }], prompt: 'p', totalToolUseCount: 1, totalDurationMs: 500, totalTokens: 900, usage: {} }
const LAUNCHED = { status: 'async_launched', agentId: 'a7', description: 'Make the tests pass', prompt: 'p', outputFile: '/tmp/a7' }

/** Stubs every `$` call the mod makes; nothing else sits beneath it. */
function engine(on: any, o: Opts = {}): Seen {
  const seen: Seen = { files: { ...(o.files ?? FILES) }, ran: [], toasts: [], submitted: [], listed: [], reads: [], clock: null, during: o.during, answer: o.agentAnswer ?? { result: DONE } }
  seen.clock = mock.clock(on)
  // A relative path is under the project root; a trailing slash is dropped.
  const abs = (p: unknown) => {
    const s = String(p)
    const full = s.startsWith('/') ? s : `${ROOT}/${s.replace(/^\.\//, '')}`
    return full.replace(/\/+$/, '') || '/'
  }
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }))
  on('session.root', () => ({ value: ROOT }))
  on('session.cwd', () => ({ value: o.cwd ?? ROOT }))
  on('agent.list', () => ({ value: (o.agents ?? []).map(a => ({ ...a, description: 'task', status: 'running' })) }))
  on('ui.toast', ($: any, e: any) => (seen.toasts.push(e.text), { value: undefined }))
  on('prompt.submit', ($: any, e: any) => (seen.submitted.push(e.text), { text: e.text }))
  on('turn.complete', ($: any, e: any) => ({ text: e.answer, usage: e.usage }))
  on('fs.read', ($: any, e: any) => {
    const path = abs(e.path)
    seen.reads.push(path)
    const text = seen.files[path]
    return text === undefined ? { deny: 'ENOENT: no such file' } : { value: text }
  })
  // A folder lists what the path map holds below it: a file, or a folder for a deeper path. A folder with nothing below is not there.
  on('fs.list', ($: any, e: any) => {
    const dir = abs(e.path)
    seen.listed.push(dir)
    const entries = new Map<string, { name: string; kind: 'file' | 'dir'; size: number; mtimeMs: number; isLink: boolean }>()
    for (const [path, text] of Object.entries(seen.files)) {
      if (!path.startsWith(`${dir}/`)) continue
      const [name = '', ...deeper] = path.slice(dir.length + 1).split('/')
      if (entries.has(name)) continue
      entries.set(name, { name, kind: deeper.length ? 'dir' : 'file', size: deeper.length ? 0 : text.length, mtimeMs: deeper.length ? 0 : 1, isLink: false })
    }
    return entries.size ? { value: [...entries.values()] } : { deny: 'ENOENT: no such directory' }
  })
  // A file or a folder with something below it is there; `real` says where a path lands (else at its own spelling).
  on('fs.stat', ($: any, e: any) => {
    const path = abs(e.path)
    const isFile = path in seen.files
    const isDir = path === ROOT || Object.keys(seen.files).some(p => p.startsWith(`${path}/`))
    if (!isFile && !isDir) return { deny: 'ENOENT: no such file' }
    const realPath = o.real?.[path] ?? path
    return { value: { kind: isFile ? 'file' : 'dir', size: 0, mtimeMs: 0, isLink: realPath !== path, ...(e.resolve ? { realPath } : {}) } }
  })
  on('tool.call', { tool: 'Edit' }, ($: any, e: any) => (seen.ran.push({ tool: 'Edit', path: e.file_path }), { result: {} }))
  on('tool.call', { tool: 'Write' }, ($: any, e: any) => (seen.ran.push({ tool: 'Write', path: e.file_path }), { result: {} }))
  on('tool.call', { tool: 'NotebookEdit' }, ($: any, e: any) => (seen.ran.push({ tool: 'NotebookEdit', path: e.notebook_path }), { result: {} }))
  on('tool.call', { tool: 'Agent' }, () => {
    seen.during?.(seen.files)
    return seen.answer as never
  })
  return seen
}

async function start($: any) {
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: ROOT })
}

const GREEN = [{ id: 'a1', type: 'green-developer' }]
const RED = [{ id: 'a2', type: 'red-test-writer' }]
const write = (file_path: string, extra: Record<string, unknown> = {}) => ({ tool: 'Write', file_path, content: 'x', ...extra })

/**
 * The guard is on: a green-developer's Write into tests is refused. Each test that expects a call to pass starts here, so
 * it fails while the guard is missing instead of passing because nothing is guarded at all.
 */
async function expectGuardOn($: any, seen: Seen) {
  const r: any = await $.tool.call(write('/w/tests/a.test.ts', { agentId: 'a1' }) as never)
  expect(r.deny).toStartWith('tdd-guard: green-developer may not write tests/a.test.ts (')
  expect(seen.ran).toEqual([])
}

describe('write guards', () => {
  test('a green-developer Write to a test file is denied, with the type, the relative path and the rule in the reason', { options }, async ($, on) => {
    const seen = engine(on, { agents: GREEN })
    await start($)
    const r: any = await $.tool.call(write('/w/tests/a.test.ts', { agentId: 'a1' }) as never)
    expect(r.deny).toStartWith('tdd-guard: green-developer may not write tests/a.test.ts (')
    expect(r.deny).toContain('tests/**')
    expect(seen.ran).toEqual([])
  })

  test('an Edit is guarded the same way, reading file_path', { options }, async ($, on) => {
    const seen = engine(on, { agents: GREEN })
    await start($)
    const r: any = await $.tool.call({ tool: 'Edit', file_path: '/w/tests/sub/d.test.ts', old_string: 'D', new_string: 'E', agentId: 'a1' } as never)
    expect(r.deny).toStartWith('tdd-guard: green-developer may not write tests/sub/d.test.ts (')
    expect(seen.ran).toEqual([])
  })

  test('a NotebookEdit reads notebook_path', { options }, async ($, on) => {
    const seen = engine(on, { agents: [...GREEN, ...RED] })
    await start($)
    const denied: any = await $.tool.call({ tool: 'NotebookEdit', notebook_path: '/w/tests/n.ipynb', new_source: 'x', agentId: 'a1' } as never)
    expect(denied.deny).toStartWith('tdd-guard: green-developer may not write tests/n.ipynb (')
    const outside: any = await $.tool.call({ tool: 'NotebookEdit', notebook_path: '/w/src/n.ipynb', new_source: 'x', agentId: 'a2' } as never)
    expect(outside.deny).toStartWith('tdd-guard: red-test-writer may not write src/n.ipynb (')
    expect(seen.ran).toEqual([])
    const allowed: any = await $.tool.call({ tool: 'NotebookEdit', notebook_path: '/w/tests/n.ipynb', new_source: 'x', agentId: 'a2' } as never)
    expect(allowed.deny).toBeUndefined()
    expect(seen.ran).toEqual([{ tool: 'NotebookEdit', path: '/w/tests/n.ipynb' }])
  })

  test('a red-test-writer may write tests, and is denied anything else', { options }, async ($, on) => {
    const seen = engine(on, { agents: RED })
    await start($)
    const allowed: any = await $.tool.call(write('/w/tests/a.test.ts', { agentId: 'a2' }) as never)
    expect(allowed.deny).toBeUndefined()
    expect(seen.ran).toEqual([{ tool: 'Write', path: '/w/tests/a.test.ts' }])
    const denied: any = await $.tool.call(write('/w/src/x.ts', { agentId: 'a2' }) as never)
    expect(denied.deny).toStartWith('tdd-guard: red-test-writer may not write src/x.ts (')
    expect(seen.ran.length).toBe(1)
  })

  test('a green-developer is denied the test folders and may write everywhere else', { options }, async ($, on) => {
    const seen = engine(on, { agents: GREEN })
    await start($)
    await expectGuardOn($, seen)
    const r: any = await $.tool.call(write('/w/src/x.ts', { agentId: 'a1' }) as never)
    expect(r.deny).toBeUndefined()
    expect(seen.ran).toEqual([{ tool: 'Write', path: '/w/src/x.ts' }])
  })

  test('a file that is not there yet is placed by its folder: a new test file is denied, a new source file passes', { options }, async ($, on) => {
    const seen = engine(on, { agents: GREEN })
    await start($)
    const denied: any = await $.tool.call(write('/w/tests/new.test.ts', { agentId: 'a1' }) as never)
    expect(denied.deny).toStartWith('tdd-guard: green-developer may not write tests/new.test.ts (')
    const allowed: any = await $.tool.call(write('/w/src/new.ts', { agentId: 'a1' }) as never)
    expect(allowed.deny).toBeUndefined()
    expect(seen.ran).toEqual([{ tool: 'Write', path: '/w/src/new.ts' }])
  })

  test('the target is judged where it really lands: a link in src that leads into tests is denied', { options }, async ($, on) => {
    const seen = engine(on, { agents: GREEN, real: { '/w/src/link.ts': '/w/tests/a.test.ts' } })
    await start($)
    const r: any = await $.tool.call(write('/w/src/link.ts', { agentId: 'a1' }) as never)
    expect(r.deny).toStartWith('tdd-guard: green-developer may not write ')
    expect(r.deny).toContain('tests/**')
    expect(seen.ran).toEqual([])
  })

  test('a call with no agentId (the main loop) passes, even into tests', { options }, async ($, on) => {
    const seen = engine(on, { agents: GREEN })
    await start($)
    await expectGuardOn($, seen)
    const r: any = await $.tool.call(write('/w/tests/a.test.ts') as never)
    expect(r.deny).toBeUndefined()
    expect(seen.ran).toEqual([{ tool: 'Write', path: '/w/tests/a.test.ts' }])
  })

  test('a call whose agentId is not listed (a workflow agent, an engine fork) passes', { options }, async ($, on) => {
    const seen = engine(on, { agents: GREEN })
    await start($)
    await expectGuardOn($, seen)
    const r: any = await $.tool.call(write('/w/tests/a.test.ts', { agentId: 'fork-9' }) as never)
    expect(r.deny).toBeUndefined()
    expect(seen.ran).toEqual([{ tool: 'Write', path: '/w/tests/a.test.ts' }])
  })

  test('a listed type with no rule passes', { options }, async ($, on) => {
    const seen = engine(on, { agents: [...GREEN, { id: 'a3', type: 'Explore' }] })
    await start($)
    await expectGuardOn($, seen)
    const r: any = await $.tool.call(write('/w/tests/a.test.ts', { agentId: 'a3' }) as never)
    expect(r.deny).toBeUndefined()
    expect(seen.ran).toEqual([{ tool: 'Write', path: '/w/tests/a.test.ts' }])
  })

  test('outside the project: denied for a type with + rules, passed for one with only - rules', { options }, async ($, on) => {
    const seen = engine(on, { agents: [...GREEN, ...RED] })
    await start($)
    const denied: any = await $.tool.call(write('/elsewhere/tests/x.test.ts', { agentId: 'a2' }) as never)
    expect(denied.deny).toStartWith('tdd-guard: red-test-writer may not write ')
    expect(seen.ran).toEqual([])
    const allowed: any = await $.tool.call(write('/elsewhere/tests/x.test.ts', { agentId: 'a1' }) as never)
    expect(allowed.deny).toBeUndefined()
    expect(seen.ran).toEqual([{ tool: 'Write', path: '/elsewhere/tests/x.test.ts' }])
  })

  test('globs are relative to the project root, not to the folder the session works in', { options }, async ($, on) => {
    const seen = engine(on, { agents: GREEN, cwd: '/w/src' })
    await start($)
    const r: any = await $.tool.call(write('/w/tests/a.test.ts', { agentId: 'a1' }) as never)
    expect(r.deny).toStartWith('tdd-guard: green-developer may not write tests/a.test.ts (')
    expect(seen.ran).toEqual([])
  })
})

const PLAIN_RUN = { tool: 'Agent', description: 'Make the tests pass', prompt: 'Implement the feature.' }
const GREEN_RUN = { ...PLAIN_RUN, subagent_type: 'green-developer' }
const LINE = 'tdd-guard: green-developer changed protected test files: tests/a.test.ts (modified), tests/b.test.ts (deleted), tests/c.test.ts (new)'
const A_ONLY = 'tdd-guard: green-developer changed protected test files: tests/a.test.ts (modified)'
const TURN = { answer: 'done', durationMs: 900, isAborted: false, turnId: 't1', reason: 'answer', usage: { input_tokens: 1, output_tokens: 1 } }

/** What a subagent that edits tests the hooks never saw does: one changed, one deleted, one added, and a source file changed. */
const TAMPER = (files: Record<string, string>) => {
  files['/w/tests/a.test.ts'] = 'A, edited by a shell'
  delete files['/w/tests/b.test.ts']
  files['/w/tests/c.test.ts'] = 'C'
  files['/w/src/x.ts'] = 'X, edited by the developer'
}

describe('test-file integrity', () => {
  test('foreground: a run that changed protected test files adds one context line and toasts, and leaves the result alone', { options }, async ($, on) => {
    const seen = engine(on, { during: TAMPER })
    await start($)
    const r: any = await $.tool.call(GREEN_RUN as never)
    expect(r.result).toEqual(DONE)
    expect(r.context).toEqual([LINE])
    expect(seen.toasts.length).toBe(1)
    expect(seen.toasts[0]).toContain('green-developer')
    expect(seen.submitted).toEqual([])
  })

  test('foreground: the line is added after context the call already carried', { options }, async ($, on) => {
    engine(on, { during: TAMPER, agentAnswer: { result: DONE, context: ['earlier note'] } })
    await start($)
    const r: any = await $.tool.call(GREEN_RUN as never)
    expect(r.context).toEqual(['earlier note', LINE])
  })

  test('foreground: an unchanged run adds no context and no toast; the next run that changes a protected file does', { options }, async ($, on) => {
    const seen = engine(on)
    await start($)
    const quiet: any = await $.tool.call(GREEN_RUN as never)
    expect(quiet.result).toEqual(DONE)
    expect(quiet.context ?? []).toEqual([])
    expect(seen.toasts).toEqual([])
    expect(seen.submitted).toEqual([])
    seen.during = TAMPER
    const loud: any = await $.tool.call(GREEN_RUN as never)
    expect(loud.context).toEqual([LINE])
    expect(seen.toasts.length).toBe(1)
  })

  test('foreground: a change below a subfolder of a protected folder is found', { options }, async ($, on) => {
    engine(on, { during: files => { files['/w/tests/sub/d.test.ts'] = 'D, edited' } })
    await start($)
    const r: any = await $.tool.call(GREEN_RUN as never)
    expect(r.context).toEqual(['tdd-guard: green-developer changed protected test files: tests/sub/d.test.ts (modified)'])
  })

  test('foreground: only files matching a - glob are protected', { options: { rules: 'green-developer=-tests/*.test.ts' } }, async ($, on) => {
    const files = { ...FILES, '/w/tests/fixture.json': 'F' }
    engine(on, { files, during: f => { f['/w/tests/a.test.ts'] = 'A, edited'; f['/w/tests/fixture.json'] = 'F, edited'; f['/w/tests/sub/d.test.ts'] = 'D, edited' } })
    await start($)
    const r: any = await $.tool.call(GREEN_RUN as never)
    expect(r.context).toEqual([A_ONLY])
  })

  test('background: the check waits for the first turn.complete of that agent, then prompts the model once and toasts; a run that changed nothing says nothing', { options }, async ($, on) => {
    const seen = engine(on)
    await start($)

    // a8 changes nothing: its turn.complete is quiet.
    seen.answer = { result: { ...LAUNCHED, agentId: 'a8' } }
    await $.tool.call(GREEN_RUN as never)
    await ($ as any).turn.complete({ ...TURN, agentId: 'a8' })
    await seen.clock.settle()
    expect(seen.submitted).toEqual([])
    expect(seen.toasts).toEqual([])

    // a7 edits a protected file after it was launched.
    seen.answer = { result: LAUNCHED }
    const r: any = await $.tool.call(GREEN_RUN as never)
    expect(r.result).toEqual(LAUNCHED)
    expect(r.context ?? []).toEqual([])
    seen.files['/w/tests/a.test.ts'] = 'A, edited by a shell'
    await seen.clock.settle()
    expect(seen.submitted).toEqual([])

    // Another agent's turn.complete is not a7's.
    await ($ as any).turn.complete({ ...TURN, agentId: 'zz' })
    await seen.clock.settle()
    expect(seen.submitted).toEqual([])

    await ($ as any).turn.complete({ ...TURN, agentId: 'a7' })
    await seen.clock.settle()
    expect(seen.submitted.length).toBe(1)
    expect(seen.submitted[0]).toContain(A_ONLY)
    expect(seen.toasts.length).toBe(1)
    expect(seen.toasts[0]).toContain('green-developer')

    // Only the first one counts.
    await ($ as any).turn.complete({ ...TURN, agentId: 'a7', turnId: 't2' })
    await seen.clock.settle()
    expect(seen.submitted.length).toBe(1)
    expect(seen.toasts.length).toBe(1)
  })

  test('a type with no - rules takes no snapshot: no folder is listed and no file read; a type with - rules does', { options }, async ($, on) => {
    const seen = engine(on)
    await start($)
    for (const extra of [{ subagent_type: 'red-test-writer' }, { subagent_type: 'Explore' }, {}]) {
      const r: any = await $.tool.call({ ...PLAIN_RUN, ...extra } as never)
      expect(r.result).toEqual(DONE)
      expect(r.context ?? []).toEqual([])
    }
    expect(seen.listed).toEqual([])
    expect(seen.reads).toEqual([])
    await $.tool.call(GREEN_RUN as never)
    expect(seen.listed).toContain('/w/tests')
    expect(seen.reads).toContain('/w/tests/a.test.ts')
  })
})

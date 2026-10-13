import { describe, expect, mock, test } from 'claude-code/testing'

const BAND = { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 80, scroll: { offset: 0, bodyRows: 4 }, view: {} } as const
const COMPOSER = { kind: 'composer' } as const
const PRESENTATION = { isFullscreen: false, columns: 120 } as const
const OID = '0123456789abcdef0123456789abcdef01234567'
const ON_BRANCH = { exitCode: 0, stdout: `# branch.oid ${OID}\n# branch.head feature/x\n# branch.ab +2 -0\n? new.txt\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
const NOT_REPO = { exitCode: 128, stdout: '', stderr: 'fatal: not a git repository (or any of the parent directories): .git\n', isStdoutTruncated: false, isStderrTruncated: false }

describe('ui', () => {
  test('in a repo the band names the branch, above the band below, on terminal and desktop', async ($, on) => {
    mock.clock(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }) as never)
    on('command.register', () => ({ value: undefined }) as never)
    on('process.run', () => ({ value: ON_BRANCH }) as never)
    on('ui.render', ($, e) => $.ui.resolve(e).Text({ children: 'band below' }) as never)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    const r = await $.command.run({ command: 'git-branch', args: '', origin: COMPOSER, presentation: PRESENTATION })
    expect(r.text).toBe('⎇ feature/x  ·  1 changed  ·  ↑2')

    for (const surface of ['terminal', 'desktop'] as const) {
      const band = await $.ui.mount({ plugin: 'git-branch', surface, component: 'AbovePrompt', requestId: 'band', props: BAND, viewport: { columns: 90, rows: 30 } })
      expect(await band.find({ type: 'Text', text: /feature\/x/ })).toBeDefined()
      expect(await band.find({ type: 'Text', text: /band below/ })).toBeDefined()
      await band.unmount()
    }

    const surveyed = await $.ui.mount({ plugin: 'git-branch', surface: 'terminal', component: 'AbovePrompt', requestId: 'band', props: { ...BAND, hasSurvey: true }, viewport: { columns: 90, rows: 30 } })
    expect(await surveyed.find({ type: 'Text', text: /feature\/x/ })).toBeUndefined()
    expect(await surveyed.find({ type: 'Text', text: /band below/ })).toBeDefined()
    await surveyed.unmount()

    await $.command.run({ command: 'git-branch', args: 'hide', origin: COMPOSER, presentation: PRESENTATION })
    const hidden = await $.ui.mount({ plugin: 'git-branch', surface: 'terminal', component: 'AbovePrompt', requestId: 'band', props: BAND, viewport: { columns: 90, rows: 30 } })
    expect(await hidden.find({ type: 'Text', text: /feature\/x/ })).toBeUndefined()
    await hidden.unmount()
  })

  test('outside a repo the band hides and the command says why; demo shows every state', async ($, on) => {
    mock.clock(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }) as never)
    on('command.register', () => ({ value: undefined }) as never)
    on('process.run', () => ({ value: NOT_REPO }) as never)
    on('ui.render', ($, e) => $.ui.resolve(e).Text({ children: 'band below' }) as never)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    const r = await $.command.run({ command: 'git-branch', args: '', origin: COMPOSER, presentation: PRESENTATION })
    expect(r.text).toBe('not inside a git repository.')

    const empty = await $.ui.mount({ plugin: 'git-branch', surface: 'terminal', component: 'AbovePrompt', requestId: 'band', props: BAND, viewport: { columns: 90, rows: 30 } })
    expect(await empty.find({ type: 'Text', text: /⎇/ })).toBeUndefined()
    expect(await empty.find({ type: 'Text', text: /band below/ })).toBeDefined()
    await empty.unmount()

    await $.command.run({ command: 'git-branch', args: 'demo', origin: COMPOSER, presentation: PRESENTATION })
    const demo = await $.ui.mount({ plugin: 'git-branch', surface: 'terminal', component: 'AbovePrompt', requestId: 'band', props: BAND, viewport: { columns: 90, rows: 30 } })
    for (const text of [/^main$/, /feature\/login-flow/, /3 changed/, /↑2 ↓1/, /detached @ a1b2c3d/, /no commits yet/, /band below/]) {
      expect(await demo.find({ type: 'Text', text })).toBeDefined()
    }
    await demo.unmount()
  })
})

describe('overlapping refreshes', () => {
  test('a refresh asked for during a slow read gets a fresh read, not the stale one', async ($, on) => {
    mock.clock(on)
    let release = () => {}
    const slow = new Promise<void>(resolve => (release = resolve))
    let branch = 'main'
    let calls = 0
    on('session.start', ($, e) => ({ cwd: e.cwd }) as never)
    on('command.register', () => ({ value: undefined }) as never)
    on('process.run', async () => {
      calls += 1
      const head = branch
      if (calls === 1) await slow
      return { value: { ...ON_BRANCH, stdout: ON_BRANCH.stdout.replace('feature/x', head) } } as never
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    branch = 'feature/new'
    const asked = $.command.run({ command: 'git-branch', args: 'refresh', origin: COMPOSER, presentation: PRESENTATION })
    release()
    const { text } = await asked
    expect(text).toContain('feature/new')
    expect(calls).toBe(2)
  })
})


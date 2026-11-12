// An edit whose Red was skipped (SPEC.md 8.23), through the hooks module: no new test covers what it changed, so
// Green's gate asks the person, with the list of changed files; "Not yet" is first and keeps the edit at Green,
// where every listed file can still be written; what was agreed is held, and a change made at Verify is asked
// about again; engine-written files are not listed.
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { BUILT, GATE, HOME, MOD, NAME, failing, passing, readerDone, world } from './world'
import type { World } from './world'

const EDIT = { skill: 'edit', text: 'the phases of an edit', source: 'plugin', pluginName: 'mod-builder', frontmatter: {} } as const
const LATEST = `${HOME}/.claude/mod-builder-data/v2/docs/latest`
const SPEC = `${MOD}/SPEC.md`
const MANIFEST = `${MOD}/.claude-plugin/plugin.json`
const TEST = `${MOD}/tests/pane.test.tsx`
const CODE = `${MOD}/hooks/register.tsx`
// The world's clock stands at 1000 ms: the stamp of one second past the start of 1970.
const RESTORE = `${HOME}/.claude/mod-builder-data/v2/restore/s1/1970-01-01T000001Z`
const LOADED = `[DEBUG] hooks module ${NAME}@inline loaded (worker, environment 1, tier user); events: session.start\n`
const OLD_SPEC = '# turn-counter\n\nCounts turns.\n'
const NO_CHANGE = '\n## 0.1.1 (2026-11-11)\n\nNo behaviour change: the rows are built by one helper.\n'
const SECTION = '\n## 0.1.1 (2026-11-11)\n\nCuts each row by display width.\n'
const NAMES = ['draws its line', 'opens the pane']
const ERR_HOOKS = `${MOD}/hooks/register.tsx(3,7): error TS2322: Type 'string' is not assignable to type 'number'.\n`
const NOT_YET = 'Not yet'
const GO_ON = 'Go on with these changes'
const APPROVE_NO_CHANGE = 'Approve: no behaviour change'
const MARK = String.fromCharCode(0x276f)
const HOOKS = './register.tsx hooks: session.start, ui.render{component=Pane}'
const CALLS = './register.tsx calls: $.ui.open, $.ui.resolve'
const validated = (...lines: string[]) => `Validating hooks\n\n${lines.map((line) => `  ${MARK} ${line}`).join('\n')}\n\nValidation passed\n`
const ENGINE_TSCONFIG = '{\n  "extends": "./.claude-plugin/types/tsconfig.json"\n}\n'

const gate = async ($: Engine, more: Record<string, unknown> = {}) => readerDone($, String((await $.tool.call({ tool: GATE, ...more } as never)).result))
const first = (answer: string) => answer.split('\n')[0] as string
const kept = (w: World) => w.store[`build:${MOD}`] as Record<string, unknown> & { phase: string; baseline: Record<string, unknown>; evidence: Record<string, string>; agreed?: Record<string, string> }
const write = async ($: Engine, path: string) => (await $.tool.call({ tool: 'Write', file_path: path, content: 'x' } as never)) as { deny?: string }
// The questions asked about what changed with Red skipped, and no others.
const asks = (w: World) => w.asked.filter((one) => one.question.startsWith('Red was skipped for this edit'))

// A finished mod, as an earlier build left it, and a session in which nothing is open yet.
const mod = (on: Parameters<typeof world>[0], more: Partial<World> = {}) =>
  world(on, {
    runs: { validate: { exitCode: 0, stdout: validated(HOOKS, CALLS) }, test: { exitCode: 0, stdout: passing(2, NAMES) }, tsc: { exitCode: 0, stdout: '' }, '--plugin-dir': { exitCode: 0, stdout: '' }, restore: { exitCode: 0, stdout: `restore point: ${RESTORE}\n` }, putback: { exitCode: 0, stdout: '' } },
    ...more,
    files: {
      [LATEST]: '2026-11-10T151216Z\n', [SPEC]: OLD_SPEC, [MANIFEST]: `{ "name": "${NAME}", "version": "0.1.0" }`,
      [`${MOD}/hooks/hooks.json`]: '{ "modules": ["./register.tsx"] }', [CODE]: 'line one\nline two\nline three\n', [TEST]: 'the first test', 'the load log': LOADED,
      ...more.files,
    },
  })
// Opens an edit, names the mod (the baseline is taken; the restore point's copy is laid as the script would),
// and goes to Spec's gate with the change's section written.
const toSpec = async ($: Engine, w: World, section: string) => {
  await $.skill.prompt(EDIT)
  await gate($, { mod_dir: 'turn-counter' })
  for (const [path, text] of Object.entries(w.files)) if (path.startsWith(`${MOD}/`)) w.files[`${RESTORE}/${path.slice(MOD.length + 1)}`] = text
  await gate($)
  await gate($)
  w.files[SPEC] = `${OLD_SPEC}${section}`
}
// On the refactor route, at Green, with the code changed and the version raised.
const toGreen = async ($: Engine, w: World) => {
  await toSpec($, w, NO_CHANGE)
  w.answer = APPROVE_NO_CHANGE
  expect(await gate($, { no_behaviour_change: true })).toMatch(/Red is skipped \(no behaviour change\)\. The edit is now at phase 5 \(Green\)\.$/)
  w.files[MANIFEST] = `{ "name": "${NAME}", "version": "0.1.1" }`
  w.files[CODE] = 'line one\nline 2\nline three\nline four\n'
}
// Through Green, the person agreeing, to Verify's gate with the "Built" block written.
const toVerify = async ($: Engine, w: World) => {
  await toGreen($, w)
  w.answer = GO_ON
  expect(first(await gate($))).toMatch(/^mod-builder: phase 5 \(Green\) passed /)
  w.files[SPEC] = `${w.files[SPEC]}${BUILT}`
}

test('the baseline keeps what validate said the mod hooks, answers and calls', async ($, on) => {
  const w = mod(on)
  await toSpec($, w, NO_CHANGE)
  expect(kept(w).baseline.registers).toEqual([HOOKS, CALLS])
})

test('on the refactor route Green asks the person, "Not yet" first, with each changed file and its lines, the tests held and the restore point', async ($, on) => {
  const w = mod(on)
  await toGreen($, w)
  w.answer = NOT_YET
  expect(await gate($)).toBe('mod-builder: still at phase 5 (Green). Not passed: the person has not agreed to the changes made with Red skipped (answer: "Not yet").')
  expect(asks(w)).toEqual([{
    question: [
      'Red was skipped for this edit, so no new test covers what it changed.',
      'These files are not as they were before this edit:',
      '- .claude-plugin/plugin.json: 1 line added, 1 line removed',
      '- hooks/register.tsx: 2 lines added, 1 line removed',
      'The 2 tests the mod had before this edit are held unchanged and pass: they are the only check of behaviour.',
      `The mod as it was before this edit is kept in ${RESTORE}.`,
      'Go on with these changes?',
    ].join('\n'),
    options: [NOT_YET, GO_ON],
  }])
  expect(kept(w).phase).toBe('green')
  expect('agreed' in kept(w)).toBe(false)
})

test('"Not yet" keeps the edit at Green with the code still writable; any other answer, and a question nobody answers, do too', async ($, on) => {
  const w = mod(on)
  await toGreen($, w)
  for (const answer of [NOT_YET, 'Approve', APPROVE_NO_CHANGE, 'go on with these changes']) {
    w.answer = answer
    expect(first(await gate($))).toBe(`mod-builder: still at phase 5 (Green). Not passed: the person has not agreed to the changes made with Red skipped (answer: ${JSON.stringify(answer)}).`)
  }
  w.answer = null
  expect(await gate($)).toBe('mod-builder: still at phase 5 (Green). Not passed: the person could not be asked about the changes made with Red skipped (the question was dismissed, or nobody is at this session).')
  expect(kept(w).phase).toBe('green')
  expect((await write($, CODE)).deny).toBe(undefined)
  expect((await write($, TEST)).deny).toMatch(/of this edit/)
})

test('the person\'s own approving answer passes Green: the gate\'s evidence says the answer and the files, and the record holds what was agreed', async ($, on) => {
  const w = mod(on)
  await toGreen($, w)
  w.answer = GO_ON
  expect(first(await gate($))).toMatch(/^mod-builder: phase 5 \(Green\) passed \(validate, 2 tests, .* all pass; version 0\.1\.1, after 0\.1\.0; the person answered "Go on with these changes" for what changed with Red skipped: \.claude-plugin\/plugin\.json \(changed\), hooks\/register\.tsx \(changed\); the test files and SPEC\.md are as recorded\)\. The edit is now at phase 6 \(Verify\)\.$/)
  expect(kept(w).phase).toBe('verify')
  expect(Object.keys(kept(w).agreed ?? {}).sort()).toEqual(['.claude-plugin/plugin.json', 'hooks/hooks.json', 'hooks/register.tsx'])
  expect(kept(w).evidence.green).toContain('the person answered "Go on with these changes" for what changed with Red skipped: ')
})

test('the question comes after the four checks and the version: a failing check or a version not raised is refused with nobody asked', async ($, on) => {
  const w = mod(on)
  await toGreen($, w)
  w.answer = GO_ON
  w.runs.test = { exitCode: 1, stdout: failing(['draws its line'], ['opens the pane']) }
  expect(first(await gate($))).toMatch(/still at phase 5 \(Green\)\. Not passed: /)
  w.runs.test = { exitCode: 0, stdout: passing(2, NAMES) }
  w.files[MANIFEST] = `{ "name": "${NAME}", "version": "0.1.0" }`
  expect(first(await gate($))).toMatch(/not greater than the 0\.1\.0 it had before the edit/)
  expect(asks(w)).toEqual([])
  expect(kept(w).phase).toBe('green')
})

test('a file added and a file gone are named as such, and a test file and SPEC.md are never in the list', async ($, on) => {
  const w = mod(on, { files: { [`${MOD}/lib/old.ts`]: 'one\ntwo\n' } })
  await toGreen($, w)
  delete w.files[`${MOD}/lib/old.ts`]
  w.files[`${MOD}/lib/new.ts`] = 'a\nb\nc\n'
  w.answer = NOT_YET
  await gate($)
  expect(asks(w)[0]?.question.split('\n').slice(2, 6)).toEqual([
    '- .claude-plugin/plugin.json: 1 line added, 1 line removed', '- hooks/register.tsx: 2 lines added, 1 line removed', '- lib/new.ts: added (3 lines)', '- lib/old.ts: gone (2 lines removed)',
  ])
  expect(asks(w)[0]?.question.includes('SPEC.md') || asks(w)[0]?.question.includes('tests/')).toBe(false)
})

test('what the engine wrote into the mod while a person tried it is not listed, and is not part of what was agreed', async ($, on) => {
  const w = mod(on)
  await toGreen($, w)
  w.files[`${MOD}/.claude-plugin/types/claude-code/index.d.ts`] = 'the types'
  w.files[`${MOD}/.claude-plugin/types/tsconfig.json`] = '{}'
  w.files[`${MOD}/tsconfig.json`] = ENGINE_TSCONFIG
  w.answer = GO_ON
  expect(first(await gate($))).toMatch(/for what changed with Red skipped: \.claude-plugin\/plugin\.json \(changed\), hooks\/register\.tsx \(changed\);/)
  expect(asks(w)[0]?.question.includes('types') || asks(w)[0]?.question.includes('tsconfig')).toBe(false)
  expect(Object.keys(kept(w).agreed ?? {}).sort()).toEqual(['.claude-plugin/plugin.json', 'hooks/hooks.json', 'hooks/register.tsx'])
})

test('a tsconfig.json that holds more than the engine\'s line is the mod\'s own, and is listed', async ($, on) => {
  const w = mod(on)
  await toGreen($, w)
  w.files[`${MOD}/tsconfig.json`] = '{ "compilerOptions": { "strict": false } }\n'
  w.answer = NOT_YET
  await gate($)
  expect(asks(w)[0]?.question).toContain('- tsconfig.json: added (1 line)')
})

test('when validate reports that the mod hooks or calls something it did not before, the question says so, and still only asks', async ($, on) => {
  const w = mod(on)
  await toGreen($, w)
  const more = './register.tsx calls: $.fs.write, $.ui.open, $.ui.resolve'
  w.runs.validate = { exitCode: 0, stdout: validated(HOOKS, more) }
  w.answer = GO_ON
  expect(first(await gate($))).toMatch(/^mod-builder: phase 5 \(Green\) passed /)
  // Only what differs is said: the line of calls, and on it only the call that was added.
  expect(asks(w)[0]?.question.split('\n').slice(4, 7)).toEqual([
    'What the mod hooks, answers and calls is not as before this edit:', '    ./register.tsx calls: added $.fs.write',
    'The 2 tests the mod had before this edit are held unchanged and pass: they are the only check of behaviour.',
  ])
})

test('a file changed while the person was being asked is not agreed to: the gate asks again', async ($, on) => {
  const w = mod(on)
  await toGreen($, w)
  w.answer = GO_ON
  w.whileAsked = () => {
    w.files[CODE] = 'something else\n'
    w.whileAsked = () => {}
  }
  expect(await gate($)).toBe('mod-builder: still at phase 5 (Green). Not passed: the mod changed while the person was being asked (not as recorded: hooks/register.tsx (changed)): ask again.')
  expect(kept(w).phase).toBe('green')
  expect(first(await gate($))).toMatch(/^mod-builder: phase 5 \(Green\) passed /)
  expect(asks(w).length).toBe(2)
})

test('a repair whose Red was skipped because its test files fit is asked the same way', async ($, on) => {
  const w = mod(on, { runs: { validate: { exitCode: 0, stdout: validated(HOOKS, CALLS) }, test: { exitCode: 0, stdout: passing(2, NAMES) }, tsc: { exitCode: 1, stdout: ERR_HOOKS }, '--plugin-dir': { exitCode: 0, stdout: '' }, restore: { exitCode: 0, stdout: '' } } })
  await toSpec($, w, SECTION)
  expect(await gate($)).toMatch(/Red is skipped \(the test files fit this build\)\. The edit is now at phase 5 \(Green\)\.$/)
  w.runs.tsc = { exitCode: 0, stdout: '' }
  w.files[MANIFEST] = `{ "name": "${NAME}", "version": "0.1.1" }`
  w.files[CODE] = 'line one\nline two, mended\nline three\n'
  w.answer = NOT_YET
  expect(first(await gate($))).toMatch(/the person has not agreed to the changes made with Red skipped/)
  expect(asks(w).length).toBe(1)
  w.answer = GO_ON
  expect(first(await gate($))).toMatch(/^mod-builder: phase 5 \(Green\) passed /)
})

test('an edit that went through Red is not asked at Green: its new test covers the change', async ($, on) => {
  const w = mod(on)
  await toSpec($, w, SECTION)
  await gate($)
  w.files[`${MOD}/tests/width.test.ts`] = 'the new test'
  w.runs.test = { exitCode: 1, stdout: failing(NAMES, ['cuts by width']) }
  await gate($)
  w.files[MANIFEST] = `{ "name": "${NAME}", "version": "0.1.1" }`
  w.files[CODE] = 'the code, changed\n'
  w.runs.test = { exitCode: 0, stdout: passing(3, [...NAMES, 'cuts by width']) }
  expect(first(await gate($))).toMatch(/^mod-builder: phase 5 \(Green\) passed /)
  expect(asks(w)).toEqual([])
  expect('agreed' in kept(w)).toBe(false)
})

test('at Verify nothing is asked when every file is as the person agreed, the "Built" block in SPEC.md and engine-written files aside', async ($, on) => {
  const w = mod(on)
  await toVerify($, w)
  w.files[`${MOD}/.claude-plugin/types/tsconfig.json`] = '{}'
  w.answer = NOT_YET
  expect(first(await gate($))).toMatch(/^mod-builder: phase 6 \(Verify\) passed \(validate, 2 tests, [^;]* all pass; version 0\.1\.1, after 0\.1\.0\)\. The edit is now at phase 7 \(Done\)\.$/)
  expect(asks(w).length).toBe(1)
})

test('a change made at Verify is asked about again, the same way, and is held to the same answer', async ($, on) => {
  const w = mod(on)
  await toVerify($, w)
  w.files[`${MOD}/README.md`] = 'What it does.\n'
  w.files[MANIFEST] = `{ "name": "${NAME}", "version": "0.1.1", "description": "counts" }`
  w.answer = NOT_YET
  expect(await gate($)).toBe('mod-builder: still at phase 6 (Verify). Not passed: the person has not agreed to the changes made with Red skipped (answer: "Not yet").')
  expect(asks(w)[1]).toEqual({
    question: [
      'Red was skipped for this edit, so no new test covers what it changed.',
      'These files are not as they were when you agreed at Green (lines are counted against the mod before this edit):',
      '- .claude-plugin/plugin.json: 1 line added, 1 line removed',
      '- README.md: added (1 line)',
      'The 2 tests the mod had before this edit are held unchanged and pass: they are the only check of behaviour.',
      `The mod as it was before this edit is kept in ${RESTORE}.`,
      'Go on with these changes?',
    ].join('\n'),
    options: [NOT_YET, GO_ON],
  })
  expect(kept(w).phase).toBe('verify')
  // README.md can still be written at Verify, so nothing strands: taken back, the gate asks nothing.
  expect((await write($, `${MOD}/README.md`)).deny).toBe(undefined)
  w.answer = GO_ON
  expect(first(await gate($))).toMatch(/^mod-builder: phase 6 \(Verify\) passed \(.*; the person answered "Go on with these changes" for what changed with Red skipped: \.claude-plugin\/plugin\.json \(changed\), README\.md \(added\)\)\. The edit is now at phase 7 \(Done\)\.$/)
  expect(Object.keys(kept(w).agreed ?? {}).sort()).toEqual(['.claude-plugin/plugin.json', 'README.md', 'hooks/hooks.json', 'hooks/register.tsx'])
})

test('a record at Verify that holds no agreement, as one made before this rule, is asked there', async ($, on) => {
  const w = mod(on)
  await toVerify($, w)
  const { agreed: _agreed, ...before } = kept(w)
  w.store[`build:${MOD}`] = before
  w.answer = NOT_YET
  expect(first(await gate($))).toMatch(/still at phase 6 \(Verify\)\. Not passed: the person has not agreed to the changes made with Red skipped/)
  expect(asks(w)[1]?.question.split('\n')[1]).toBe('These files are not as they were before this edit:')
})

test('the answer and the files it covered are a row of the pane at Verify and at Done', async ($, on) => {
  const w = mod(on)
  await toVerify($, w)
  const drawn = async () => {
    const ui = await $.ui.mount({ plugin: 'mod-builder', component: 'Pane', requestId: 'mod-builder', surface: 'terminal', props: { title: 'mod-builder', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} } })
    const texts = (await ui.findAll({ type: 'Text' })).map((text) => text.text)
    await ui.unmount()
    return texts
  }
  const row = '  the person answered "Go on with these changes" for what changed with Red skipped: .claude-plugin/plugin.json (changed), hooks/register.tsx (changed)'
  const verify = await drawn()
  expect(verify.slice(verify.indexOf('What the person agreed to') + 1)).toEqual([row])
  expect(first(await gate($))).toMatch(/^mod-builder: phase 6 \(Verify\) passed /)
  const done = await drawn()
  expect(done.slice(done.indexOf('What was checked') + 1, done.indexOf('Try it')).at(-1)).toBe(row)
})

test('code put under the engine\'s types folder is the mod\'s own: it is listed and agreed to like any other file', async ($, on) => {
  const w = mod(on)
  await toGreen($, w)
  w.files[`${MOD}/.claude-plugin/types/helper.ts`] = 'export const more = 1\n'
  w.answer = GO_ON
  expect(first(await gate($))).toMatch(/for what changed with Red skipped: \.claude-plugin\/plugin\.json \(changed\), \.claude-plugin\/types\/helper\.ts \(added\), hooks\/register\.tsx \(changed\);/)
  expect(Object.keys(kept(w).agreed ?? {})).toContain('.claude-plugin/types/helper.ts')
})

test('a tsconfig.json the mod already had is the mod\'s own even when it holds the engine\'s line: changed, it is listed', async ($, on) => {
  const w = mod(on, { files: { [`${MOD}/tsconfig.json`]: '{ "include": ["hooks"] }\n' } })
  await toGreen($, w)
  w.files[`${MOD}/tsconfig.json`] = ENGINE_TSCONFIG
  w.answer = NOT_YET
  await gate($)
  expect(asks(w)[0]?.question).toContain('- tsconfig.json: 3 lines added, 1 line removed')
})

test('a file written while the four checks ran was not checked: nobody is asked, and the gate asks again', async ($, on) => {
  const w = mod(on)
  await toGreen($, w)
  w.answer = GO_ON
  w.whileRunning = (argv) => {
    if (argv.includes('--plugin-dir')) w.files[CODE] = 'written during the load\n'
  }
  expect(await gate($)).toBe('mod-builder: still at phase 5 (Green). Not passed: the mod changed while its checks ran (not as recorded: hooks/register.tsx (changed)): ask again.')
  expect(asks(w)).toEqual([])
  w.whileRunning = () => {}
  expect(first(await gate($))).toMatch(/^mod-builder: phase 5 \(Green\) passed /)
})

test('an edit opened before the baseline kept what validate said has nothing to compare, and its question says nothing of it', async ($, on) => {
  const w = mod(on)
  await toGreen($, w)
  const { registers: _registers, ...baseline } = kept(w).baseline
  w.store[`build:${MOD}`] = { ...kept(w), baseline }
  w.runs.validate = { exitCode: 0, stdout: validated(HOOKS, './register.tsx calls: $.fs.write') }
  w.answer = NOT_YET
  await gate($)
  expect(asks(w)[0]?.question.includes('What the mod hooks')).toBe(false)
})

test('moving a call from one function to another is no difference in what the mod calls', async ($, on) => {
  const w = mod(on, { runs: { validate: { exitCode: 0, stdout: validated(HOOKS, './register.tsx calls: $.ui.open (via show), $.ui.resolve') }, test: { exitCode: 0, stdout: passing(2, NAMES) }, tsc: { exitCode: 0, stdout: '' }, '--plugin-dir': { exitCode: 0, stdout: '' }, restore: { exitCode: 0, stdout: '' } } })
  await toGreen($, w)
  expect(kept(w).baseline.registers).toEqual([HOOKS, CALLS])
  w.runs.validate = { exitCode: 0, stdout: validated(HOOKS, './register.tsx calls: $.ui.open (via open, draw), $.ui.resolve (via draw)') }
  w.answer = NOT_YET
  await gate($)
  expect(asks(w)[0]?.question.includes('What the mod hooks')).toBe(false)
})

test('8.4\'s answer at Red is a row of the pane at Verify too', async ($, on) => {
  const w = mod(on)
  await toSpec($, w, SECTION)
  await gate($)
  w.files[TEST] = 'the first test, changed'
  w.runs.test = { exitCode: 1, stdout: failing(['draws its line'], ['opens the pane']) }
  w.answer = GO_ON
  expect(first(await gate($))).toMatch(/^mod-builder: phase 4 \(Red\) passed /)
  w.files[MANIFEST] = `{ "name": "${NAME}", "version": "0.1.1" }`
  w.runs.test = { exitCode: 0, stdout: passing(2, NAMES) }
  expect(first(await gate($))).toMatch(/^mod-builder: phase 5 \(Green\) passed /)
  const ui = await $.ui.mount({ plugin: 'mod-builder', component: 'Pane', requestId: 'mod-builder', surface: 'terminal', props: { title: 'mod-builder', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} } })
  const texts = (await ui.findAll({ type: 'Text' })).map((text) => text.text)
  await ui.unmount()
  expect(texts.slice(texts.indexOf('What the person agreed to') + 1)).toEqual(['  the person answered "Go on with these changes" for: tests/pane.test.tsx (changed)'])
})

test('at Done the table of what each phase may write is drawn last, below what was checked', async ($, on) => {
  const w = mod(on)
  w.store['session:s1'] = { modDir: MOD }
  w.store[`build:${MOD}`] = { modDir: MOD, sessionId: 's1', phase: 'done', specApprovedAt: null, spec: null, testsAtScaffold: null, namesAtScaffold: null, testsAtRed: null, testHashes: null, evidence: {} }
  expect((await write($, CODE)).deny).toMatch(/can't be written in phase 8 \(Done\)/)
  const ui = await $.ui.mount({ plugin: 'mod-builder', component: 'Pane', requestId: 'mod-builder', surface: 'terminal', props: { title: 'mod-builder', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} } })
  const texts = (await ui.findAll({ type: 'Text' })).map((text) => text.text)
  await ui.unmount()
  const headings = ['What was built', 'What was checked', '  1 edit refused along the way, at Done', 'Try it', `What each phase may write, under ${MOD}/`].map((text) => texts.indexOf(text))
  expect(headings.every((at) => at >= 0)).toBe(true)
  expect([...headings].sort((one, other) => one - other)).toEqual(headings)
})

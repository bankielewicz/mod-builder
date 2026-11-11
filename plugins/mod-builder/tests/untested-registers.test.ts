// The question of an edit whose Red was skipped (SPEC.md 8.26), through the hooks module: asked again at Verify,
// it says of what the mod hooks, answers and calls only what differs from what the person agreed to at Green.
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { BUILT, GATE, HOME, MOD, NAME, failing, passing, world } from './world'
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

const gate = async ($: Engine, more: Record<string, unknown> = {}) => String((await $.tool.call({ tool: GATE, ...more } as never)).result)
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

test('a difference in what the mod calls that was agreed at Green is not shown again at Verify: only what differs since', async ($, on) => {
  const w = mod(on)
  await toGreen($, w)
  const toasts = './register.tsx calls: $.ui.open, $.ui.resolve, $.ui.toast'
  w.runs.validate = { exitCode: 0, stdout: validated(HOOKS, toasts) }
  w.answer = GO_ON
  expect(first(await gate($))).toMatch(/^mod-builder: phase 5 \(Green\) passed /)
  expect(asks(w)[0]?.question).toContain('    ./register.tsx calls: added $.ui.toast')
  expect(kept(w).agreedRegisters).toEqual([HOOKS, toasts])
  w.files[SPEC] = `${w.files[SPEC]}${BUILT}`
  // A file changed at Verify, what the mod calls as agreed: asked again, with nothing said of its calls.
  w.files[`${MOD}/README.md`] = 'What it does.\n'
  w.answer = NOT_YET
  await gate($)
  expect(asks(w)[1]?.question.includes('What the mod hooks')).toBe(false)
  // Then a call more: only that one is said, against what was agreed.
  w.runs.validate = { exitCode: 0, stdout: validated(HOOKS, './register.tsx calls: $.fs.write, $.ui.open, $.ui.resolve, $.ui.toast') }
  await gate($)
  expect(asks(w)[2]?.question.split('\n').slice(3, 5)).toEqual(['What the mod hooks, answers and calls is not as when you agreed at Green:', '    ./register.tsx calls: added $.fs.write'])
  w.answer = GO_ON
  expect(first(await gate($))).toMatch(/^mod-builder: phase 6 \(Verify\) passed /)
})

test('what was agreed at Green is what the question at Verify compares with: a call gone since then is said as gone', async ($, on) => {
  const w = mod(on)
  await toVerify($, w)
  expect(kept(w).agreedRegisters).toEqual([HOOKS, CALLS])
  w.runs.validate = { exitCode: 0, stdout: validated(HOOKS, './register.tsx calls: $.ui.open') }
  w.files[`${MOD}/README.md`] = 'What it does.\n'
  w.answer = NOT_YET
  await gate($)
  expect(asks(w)[1]?.question).toContain('    ./register.tsx calls: gone $.ui.resolve')
})

test('agreeing at Verify makes what the mod calls then the agreed one; a record that kept none compares with before the edit and keeps none until asked', async ($, on) => {
  const w = mod(on)
  await toVerify($, w)
  const more = './register.tsx calls: $.fs.write, $.ui.open, $.ui.resolve'
  w.runs.validate = { exitCode: 0, stdout: validated(HOOKS, more) }
  // A record made before what was agreed was kept: nothing is asked while no file differs, and nothing is adopted.
  const { agreedRegisters: _kept, ...older } = kept(w)
  w.store[`build:${MOD}`] = older
  w.files[`${MOD}/README.md`] = 'What it does.\n'
  w.answer = NOT_YET
  await gate($)
  expect(asks(w)[1]?.question.split('\n').slice(3, 5)).toEqual(['What the mod hooks, answers and calls is not as before this edit:', '    ./register.tsx calls: added $.fs.write'])
  expect('agreedRegisters' in kept(w)).toBe(false)
  w.answer = GO_ON
  expect(first(await gate($))).toMatch(/^mod-builder: phase 6 \(Verify\) passed /)
  expect(kept(w).agreedRegisters).toEqual([HOOKS, more])
})

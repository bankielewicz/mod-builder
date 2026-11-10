// How a build is started (SPEC.md 7.5, the first of step 4's settled points): by the build skill's own command,
// `/mod-builder:build <what the mod should do>`. `/mod-builder <words>` runs this mod's command and can't be turned
// into the skill's, so it answers with the line to run, and every text that sends someone to start a build names
// the same command.
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { GATE, MOD, world } from './world'

const START = '/mod-builder:build'
const record = (phase: string) => ({
  modDir: MOD, sessionId: 's1', phase, specApprovedAt: null, spec: null, testsAtScaffold: null, namesAtScaffold: null, testsAtRed: null, testHashes: null, evidence: {},
})
const said = async ($: Engine, args: string) => (await $.command.run({ command: 'mod-builder', args } as never)).text
const write = ($: Engine, file_path: string) => $.tool.call({ tool: 'Write', file_path, content: 'x' })

test('"/mod-builder <what to build>" starts nothing and answers with the line that does, the words kept as typed', async ($, on) => {
  const w = world(on)
  expect(await said($, 'a pane that counts the turns in this session')).toBe(
    `mod-builder: "/mod-builder refresh" fetches the mod documentation now, and "/mod-builder" alone shows this session's build. To build a mod, run: ${START} a pane that counts the turns in this session`,
  )
  expect(await said($, '  refresh the pane  ')).toMatch(/To build a mod, run: \/mod-builder:build refresh the pane$/)
  expect(w.store).toEqual({})
  expect(w.ran).toEqual([])
  expect(w.opened).toEqual([])
})

test('the gate tool and the command say in their descriptions that a build is started with /mod-builder:build', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: false })
  expect(w.described).toEqual({ 'mod-builder': `mod-builder: "refresh" fetches the mod documentation now; alone, shows where this session's build stands. ${START} <what the mod should do> builds a mod` })
  expect((w.registered[0] as unknown as { description: string }).description).toMatch(/the mod build this session started with \/mod-builder:build\. /)
})

test('a build whose record is gone is sent back to /mod-builder:build, by the gate and by the guard', async ($, on) => {
  const w = world(on, { store: { 'session:s1': { modDir: MOD } } })
  const answer = await $.tool.call({ tool: GATE } as never)
  expect(String(answer.result)).toBe(`mod-builder: the build's record for ${MOD} is missing or is not this session's. Start the build again with ${START}.`)
  w.store['session:s1'] = 'pending'
  expect((await write($, '/work/notes.md')).deny).toBe(`mod-builder: /work/notes.md can't be written: this session's build record can't be read. Start the build again with ${START}.`)
})

test('"/mod-builder refresh" and "/mod-builder" alone are as they were: neither is taken for words to build', async ($, on) => {
  const w = world(on, { runs: { refresh: { exitCode: 0, stdout: 'refresh-docs: unchanged since 2026-11-10T151216Z\n' } } })
  expect(await said($, ' refresh ')).toBe('mod-builder: refresh-docs: unchanged since 2026-11-10T151216Z')
  expect(await said($, '')).toMatch(/^mod-builder: No build in this session\. /)
  expect(w.ran.length).toBe(1)
})

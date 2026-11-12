// SPEC.md 9.29 and 9.30, through the hooks module itself: a session that names a folder another session's build
// or edit holds is told whose it is and the way out: resume that session and stop there, or name another folder.
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { GATE, HOME, MOD, NAME, world } from './world'

const BUILD = { skill: 'build', text: 'the eight phases', source: 'plugin', pluginName: 'mod-builder', frontmatter: {} } as const
const EDIT = { skill: 'edit', text: 'the phases of an edit', source: 'plugin', pluginName: 'mod-builder', frontmatter: {} } as const
const LATEST = `${HOME}/.claude/mod-builder-data/v2/docs/latest`
const THEIRS = '0f3a-held'
const WAY_OUT = `If that session is gone, resume it with claude --resume ${THEIRS} and run /mod-builder stop there; or name another folder.`
const held = (phase: string, more: Record<string, unknown> = {}) => ({ modDir: MOD, sessionId: THEIRS, phase, specApprovedAt: null, spec: null, testsAtScaffold: null, namesAtScaffold: null, testsAtRed: null, testHashes: null, evidence: {}, ...more })
const gate = async ($: Engine, more: Record<string, unknown> = {}) => String((await $.tool.call({ tool: GATE, ...more } as never)).result)
const files = { [LATEST]: '2026-11-10T151216Z\n', [`${MOD}/.claude-plugin/plugin.json`]: `{ "name": "${NAME}", "version": "0.1.0" }`, [`${MOD}/hooks/hooks.json`]: '{ "modules": ["./register.tsx"] }' }

test('a build that names a folder another session is building is told that session\'s id and how to release it', async ($, on) => {
  const w = world(on, { files })
  w.store[`build:${MOD}`] = held('red')
  await $.skill.prompt(BUILD)
  expect(await gate($, { mod_dir: MOD })).toBe(`mod-builder: ${MOD} is being built by another session (${THEIRS}; it is at phase 5 (Red)). ${WAY_OUT}`)
  expect(w.store['session:s1']).toEqual({ modDir: null })
  expect((w.store[`build:${MOD}`] as { sessionId: string }).sessionId).toBe(THEIRS)
})

test('a build that names a folder another session is editing is told the same, with the edit\'s phase', async ($, on) => {
  const w = world(on, { files })
  w.store[`build:${MOD}`] = held('green', { kind: 'edit' })
  await $.skill.prompt(BUILD)
  expect(await gate($, { mod_dir: MOD })).toBe(`mod-builder: ${MOD} is being edited by another session (${THEIRS}; it is at phase 5 (Green)). ${WAY_OUT}`)
})

test('an edit that names a held folder is told the same, and nothing is run or written', async ($, on) => {
  const w = world(on, { files })
  w.store[`build:${MOD}`] = held('red', { kind: 'edit' })
  await $.skill.prompt(EDIT)
  expect(await gate($, { mod_dir: MOD })).toBe(`mod-builder: no edit was opened: ${MOD} is being edited by another session (${THEIRS}; it is at phase 4 (Red)). ${WAY_OUT}`)
  expect(w.ran).toEqual([])
  expect((w.store[`build:${MOD}`] as { sessionId: string }).sessionId).toBe(THEIRS)
})

test('a folder whose build was stopped or finished is held by nobody', async ($, on) => {
  const w = world(on, { files })
  w.store[`build:${MOD}`] = held('red', { stopped: true })
  await $.skill.prompt(BUILD)
  expect((await gate($, { mod_dir: MOD })).startsWith(`mod-builder: the build's mod folder is ${MOD}.`)).toBe(true)
})

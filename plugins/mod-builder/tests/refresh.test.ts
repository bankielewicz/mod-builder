// The documentation cache (SPEC.md 3.1, "When"), through the hooks module: the fetch a stale cache starts at the
// start of an interactive session, and `/mod-builder refresh`.
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { HOME, ROOT, world } from './world'
import type { World } from './world'

const CACHE = `${HOME}/.claude/mod-builder-data/v2/docs`
const FETCH = ['bash', `${ROOT}/scripts/refresh-docs.sh`, CACHE]
// 2026-11-10 12:00:00 UTC.
const NOW = Date.UTC(2026, 10, 10, 12, 0, 0)
const NINE_DAYS_BACK = '2026-11-01T120000Z\n'
const AN_HOUR_BACK = '2026-11-10T110000Z\n'
const FETCHED = { exitCode: 0, stdout: 'new snapshot 2026-11-10T120000Z (10 pages)\n' }

const start = ($: Engine, isInteractive = true) => $.session.start({ cwd: '/work', surface: isInteractive ? 'terminal' : null, isInteractive })
// The fetch is started and not waited for: a few calls through the engine give it the time to run.
const settle = async ($: Engine) => {
  for (let i = 0; i < 12; i++) await $.tool.call({ tool: 'Read', file_path: '/work/notes.md' })
}
const fetches = (w: World) => w.ran.filter((argv) => argv.some((one) => one.endsWith('/refresh-docs.sh')))
const cache = (checked: string | null, more: Partial<World> = {}): Partial<World> => ({
  now: NOW,
  runs: { refresh: FETCHED },
  store: { 'refresh:version': '2.1.322' },
  files: checked === null ? {} : { [`${CACHE}/checked`]: checked },
  ...more,
})

test('a session whose cache was checked nine days back starts the fetcher, with the cache folder under the home folder', async ($, on) => {
  const w = world(on, cache(NINE_DAYS_BACK))
  await start($)
  await settle($)
  expect(fetches(w)).toEqual([FETCH])
  expect(w.timeouts[w.ran.indexOf(fetches(w)[0] as string[])]).toBe(300000)
})

test('a session whose cache is fresh starts no fetch', async ($, on) => {
  const w = world(on, cache(AN_HOUR_BACK))
  await start($)
  await settle($)
  expect(w.ran).toEqual([])
})

test('a cache never checked is fetched; so is one checked under another Claude Code version, however fresh', async ($, on) => {
  const w = world(on, cache(null))
  await start($)
  await settle($)
  expect(fetches(w).length).toBe(1)
  w.files[`${CACHE}/checked`] = AN_HOUR_BACK
  w.version = '2.1.400'
  await start($)
  await settle($)
  expect(fetches(w).length).toBe(2)
  expect(w.store['refresh:version']).toBe('2.1.400')
  await start($)
  await settle($)
  expect(fetches(w).length).toBe(2)
})

test('a headless session never fetches, however stale the cache', async ($, on) => {
  const w = world(on, cache(null, { store: {} }))
  await start($, false)
  await settle($)
  expect(w.ran).toEqual([])
})

test('refreshDays 0 turns the automatic fetch off', { options: { refreshDays: 0 } }, async ($, on) => {
  const w = world(on, cache(NINE_DAYS_BACK))
  await start($)
  await settle($)
  expect(w.ran).toEqual([])
})

test('refreshDays is the plugin\'s option: at 30 days a cache checked nine days back is fresh', { options: { refreshDays: 30 } }, async ($, on) => {
  const w = world(on, cache(NINE_DAYS_BACK))
  await start($)
  await settle($)
  expect(w.ran).toEqual([])
})

test('at 2 days a cache checked three days back is stale', { options: { refreshDays: 2 } }, async ($, on) => {
  const w = world(on, cache('2026-11-07T110000Z\n'))
  await start($)
  await settle($)
  expect(fetches(w).length).toBe(1)
})

test('the session starts without waiting for the fetch: it has started, and is still under way, when the start returns', async ($, on) => {
  let release = () => {}
  const w = world(on, cache(NINE_DAYS_BACK, { store: {}, fetchHeld: new Promise<void>((resolve) => { release = resolve }) }))
  expect(await start($)).toEqual({ cwd: '/work' })
  await settle($)
  expect(fetches(w).length).toBe(1)
  expect(w.store['refresh:version']).toBeUndefined()
  expect((await $.tool.call({ tool: 'Write', file_path: '/work/notes.md', content: 'x' })).deny).toBeUndefined()
  release()
  await settle($)
  expect(w.store['refresh:version']).toBe('2.1.322')
  expect(w.opened).toEqual([])
})

test('a fetch that fails or can\'t start breaks nothing, records no version, and leaves a line in the debug log', async ($, on) => {
  const w = world(on, cache(NINE_DAYS_BACK, { runs: { refresh: { exitCode: 1, stdout: '', stderr: 'refresh-docs: api.md could not be fetched: it is empty\n' } }, store: { 'refresh:version': '2.1.300' } }))
  expect(await start($)).toEqual({ cwd: '/work' })
  await settle($)
  expect(fetches(w).length).toBe(1)
  expect(w.store['refresh:version']).toBe('2.1.300')
  expect(w.logged).toEqual(['mod-builder: the documentation fetch failed (exit 1): refresh-docs: api.md could not be fetched: it is empty'])
  w.runs.refresh = 'never starts'
  expect(await start($)).toEqual({ cwd: '/work' })
  await settle($)
  expect(fetches(w).length).toBe(2)
  expect((await $.tool.call({ tool: 'Write', file_path: '/work/notes.md', content: 'x' })).deny).toBeUndefined()
})

test('the version is recorded only by a fetch that succeeded', async ($, on) => {
  const w = world(on, cache(NINE_DAYS_BACK, { store: {} }))
  await start($)
  await settle($)
  expect(w.store['refresh:version']).toBe('2.1.322')
})

test('/mod-builder is registered at session start, and "/mod-builder refresh" fetches now and reports what the fetcher said', async ($, on) => {
  const w = world(on, cache(AN_HOUR_BACK))
  await start($)
  expect(w.commandsRegistered).toEqual(['mod-builder'])
  const said = await $.command.run({ command: 'mod-builder', args: ' refresh ' } as never)
  expect(said.text).toBe('mod-builder: new snapshot 2026-11-10T120000Z (10 pages)')
  expect(fetches(w)).toEqual([FETCH])
})

test('"/mod-builder refresh" reports a fetch that failed with its exit code and its last line, and one that could not run', async ($, on) => {
  const w = world(on, cache(AN_HOUR_BACK, { runs: { refresh: { exitCode: 1, stdout: '', stderr: 'fetching\nrefresh-docs: api.md could not be fetched: it is empty\n' } } }))
  const failed = await $.command.run({ command: 'mod-builder', args: 'refresh' } as never)
  expect(failed.text).toBe('mod-builder: the documentation fetch failed (exit 1): refresh-docs: api.md could not be fetched: it is empty')
  w.runs.refresh = 'never starts'
  const never = await $.command.run({ command: 'mod-builder', args: 'refresh' } as never)
  expect(never.text).toMatch(/^mod-builder: the documentation fetch could not run: /)
})

test('a word /mod-builder does not know fetches nothing and says what it takes', async ($, on) => {
  const w = world(on, cache(AN_HOUR_BACK))
  const said = await $.command.run({ command: 'mod-builder', args: 'status?' } as never)
  expect(said.text).toMatch(/"\/mod-builder refresh" fetches the mod documentation now/)
  expect(w.ran).toEqual([])
  expect(w.opened).toEqual([])
})

test('under the default of seven days, a cache checked six days back is fresh and one checked eight days back is stale', async ($, on) => {
  const w = world(on, cache('2026-11-04T130000Z\n'))
  await start($)
  await settle($)
  expect(w.ran).toEqual([])
  w.files[`${CACHE}/checked`] = '2026-11-02T110000Z\n'
  await start($)
  await settle($)
  expect(fetches(w).length).toBe(1)
})

test('what decides is whether a person is at the prompt, not where the session draws', async ($, on) => {
  const w = world(on, cache(NINE_DAYS_BACK))
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: false })
  await settle($)
  expect(w.ran).toEqual([])
  await $.session.start({ cwd: '/work', surface: null, isInteractive: true })
  await settle($)
  expect(fetches(w).length).toBe(1)
})

test('a run that found another fetch holding the lock fetched nothing: the version is not recorded as fetched', async ($, on) => {
  const w = world(on, cache(AN_HOUR_BACK, { version: '2.1.400', runs: { refresh: { exitCode: 0, stdout: 'refresh-docs: another fetch holds the lock; skipped\n' } } }))
  await start($)
  await settle($)
  expect(fetches(w).length).toBe(1)
  expect(w.store['refresh:version']).toBe('2.1.322')
  w.runs.refresh = { exitCode: 0, stdout: 'unchanged since 2026-11-10T110000Z (10 pages)\n' }
  await start($)
  await settle($)
  expect(fetches(w).length).toBe(2)
  expect(w.store['refresh:version']).toBe('2.1.400')
})

test('"/mod-builder refresh" fetches whatever the automatic fetch would do: with refreshDays 0 and a fresh cache', { options: { refreshDays: 0 } }, async ($, on) => {
  const w = world(on, cache(AN_HOUR_BACK))
  await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
  await settle($)
  expect(w.ran).toEqual([])
  const said = await $.command.run({ command: 'mod-builder', args: 'refresh' } as never)
  expect(said.text).toBe('mod-builder: new snapshot 2026-11-10T120000Z (10 pages)')
  expect(fetches(w)).toEqual([FETCH])
})

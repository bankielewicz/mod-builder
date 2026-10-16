#!/usr/bin/env node
// What the sandbox canary (tests/sandbox.test.ts) can't check of itself (#98, the owner's decision on PR #108):
//   1. its list of globals and gotchas.md's ("Testing and checking") name the same ones;
//   2. `claude plugin test` still refuses to load a test file that holds import() or imports node:fs, the main way a
//      test would reach the file system. A test can't assert that its own file didn't load, so this scaffolds a
//      fixture plugin into a temporary folder, as check-archetypes.sh does, and reads the run's output. A control file
//      in the fixture must load and pass, so a broken fixture never reads as a refusal.
// It checks the build it runs on: in CI, the pinned one.
//
//   node check-sandbox.mjs                      # uses `claude` on PATH
//   CLAUDE_BIN=<a claude binary> node check-sandbox.mjs
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

const CANARY_LIST = /const GLOBALS = \[([^\]]*)\]/
const GOTCHAS_LIST = /\(the canary's list\):([^.]*)\./

/** What differs between the canary's GLOBALS and gotchas.md's list ("only in …"), or null when they name the same globals. */
export function listsDiffer(canaryText, gotchasText) {
  const canary = canaryText.match(CANARY_LIST)
  if (!canary) return "tests/sandbox.test.ts has no `const GLOBALS = [...]` list"
  const gotchas = gotchasText.match(GOTCHAS_LIST)
  if (!gotchas) return "gotchas.md has no \"(the canary's list):\" sentence"
  const inCanary = new Set([...canary[1].matchAll(/'([^']+)'/g)].map(found => found[1]))
  const inGotchas = new Set([...gotchas[1].matchAll(/`([^`]+)`/g)].map(found => found[1]))
  const only = (from, other) => [...from].filter(name => !other.has(name))
  const parts = [
    ...(only(inCanary, inGotchas).length ? [`only in the canary: ${only(inCanary, inGotchas).join(', ')}`] : []),
    ...(only(inGotchas, inCanary).length ? [`only in gotchas.md: ${only(inGotchas, inCanary).join(', ')}`] : []),
  ]
  return parts.length ? parts.join('; ') : null
}

/**
 * The failures in a `claude plugin test` run's output: the control file must pass, and each refused file must be
 * reported "(fail) the file did not load". Each file's result is the first line after its `<file>:` header.
 */
export function loaderVerdict(output, files, control) {
  const lines = output.split('\n')
  const resultOf = file => {
    const at = lines.indexOf(`${file}:`)
    return at < 0 ? null : (lines.slice(at + 1).find(line => line.trim() !== '') ?? '')
  }
  const failures = []
  if (!(resultOf(control) ?? '').startsWith('(pass)')) failures.push(`${control} did not pass: the fixture itself is broken`)
  for (const file of files) {
    const result = resultOf(file)
    if (result === null) failures.push(`${file} is not in the output`)
    else if (!result.startsWith('(fail) the file did not load')) failures.push(`${file} loaded: the loader no longer refuses it`)
  }
  return failures
}

/**
 * The failures in how the run ended: it must finish on its own, with a failing status, since two of the fixture's
 * files fail to load. A run cut short (an error, a signal) may have printed the expected lines and still prove nothing.
 */
export function runVerdict(run) {
  if (run.error) return [`claude plugin test did not run to the end: ${run.error.message}`]
  if (run.signal) return [`claude plugin test was ended by ${run.signal} before it finished`]
  return run.status === 0 ? ['claude plugin test exited 0: it should fail on the refused files'] : []
}

/** The fixture's .tpl files and where each goes in the scaffolded plugin. */
const LAYOUT = {
  'plugin.json.tpl': '.claude-plugin/plugin.json',
  'hooks.json.tpl': 'hooks/hooks.json',
  'register.ts.tpl': 'hooks/register.ts',
  'control.test.ts.tpl': 'tests/control.test.ts',
  'dynamic-import.test.ts.tpl': 'tests/dynamic-import.test.ts',
  'node-fs.test.ts.tpl': 'tests/node-fs.test.ts',
}
const REFUSED = ['tests/dynamic-import.test.ts', 'tests/node-fs.test.ts']
const CONTROL = 'tests/control.test.ts'

function main() {
  const failures = []
  const canary = readFileSync(join(here, '../../../tests/sandbox.test.ts'), 'utf8')
  const gotchas = readFileSync(join(here, '../references/gotchas.md'), 'utf8')
  const differ = listsDiffer(canary, gotchas)
  if (differ) failures.push(`the canary's globals and gotchas.md's list differ: ${differ}`)
  const work = mkdtempSync(join(tmpdir(), 'check-sandbox-'))
  let output = ''
  try {
    for (const [from, to] of Object.entries(LAYOUT)) {
      mkdirSync(dirname(join(work, to)), { recursive: true })
      writeFileSync(join(work, to), readFileSync(join(here, 'sandbox-fixture', from), 'utf8'))
    }
    const run = spawnSync(process.env.CLAUDE_BIN || 'claude', ['plugin', 'test', work], { encoding: 'utf8' })
    output = `${run.stdout ?? ''}${run.stderr ?? ''}`
    failures.push(...runVerdict(run), ...loaderVerdict(output, REFUSED, CONTROL))
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
  if (failures.length) {
    console.log(output)
    for (const failure of failures) console.log(`FAILED: ${failure}`)
    process.exit(1)
  }
  console.log("sandbox checks pass: the canary's list matches gotchas.md, and the loader refused import() and node:fs")
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()

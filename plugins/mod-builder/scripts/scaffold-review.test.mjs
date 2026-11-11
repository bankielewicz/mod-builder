// Tests for the two defects Codex's stop-time review found in the scaffold (SPEC.md 7.2's outside read of step 4):
// the template's own test must not pin the placeholder line a mod is there to replace, and a copy that fails
// partway must leave nothing behind, so that the next run can lay the files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { run, scriptsDir, tempDir } from './test-helpers.mjs';

const FILES = ['.claude-plugin/plugin.json', 'hooks/hooks.json', 'hooks/register.tsx', 'tests/pane.test.tsx'];
const newMod = () => join(tempDir('mod-builder-scaffold-'), 'turn-counter');
const claude = (...args) => new Promise((resolve) => {
  execFile('claude', args, { timeout: 60000 }, (error, stdout) => resolve({ code: error === null ? 0 : error.code, stdout: String(stdout) }));
});
const listed = (folder, under = '') => (existsSync(join(folder, under)) ? readdirSync(join(folder, under), { withFileTypes: true }) : [])
  .flatMap((entry) => (entry.isDirectory() ? listed(folder, join(under, entry.name)) : [join(under, entry.name)])).sort();

// The script run with a stand-in for `cp` first on its PATH: for the file named it writes half a file and fails,
// as a disk that fills would; for any other it copies.
const scaffoldWithCopyFailingAt = (failing, ...args) => new Promise((resolve) => {
  const bin = tempDir('mod-builder-bin-');
  writeFileSync(join(bin, 'cp'), [
    '#!/bin/sh',
    'for last; do :; done',
    `case "$last" in *${failing}) printf half > "$last"; exit 1;; esac`,
    'exec /bin/cp "$@"',
    '',
  ].join('\n'));
  chmodSync(join(bin, 'cp'), 0o755);
  const child = spawn('bash', [join(scriptsDir, 'scaffold.sh'), ...args], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('close', (code) => resolve({ code, stdout, stderr }));
});

test('the scaffold\'s own tests still pass once the pane and the command say the mod\'s own words in place of the placeholders', async () => {
  const mod = newMod();
  assert.equal((await run('scaffold.sh', [mod, 'turn-counter', 'Ada'])).code, 0);
  const module = join(mod, 'hooks', 'register.tsx');
  const before = readFileSync(module, 'utf8');
  assert.equal(before.split('Nothing to show yet.').length, 2, 'the template draws its placeholder line once');
  assert.equal(before.split('The pane is open.').length, 2, 'the template\'s command answers with its placeholder line once');
  writeFileSync(module, before.replace('Nothing to show yet.', 'Turns: 0').replace('The pane is open.', 'Counting turns.'));
  const tested = await claude('plugin', 'test', mod);
  assert.equal(tested.code, 0, tested.stdout);
  assert.match(tested.stdout, /\n 2 pass\n 0 fail\n/);
});

test('the scaffold\'s test of the pane still fails when the pane draws no line at all', async () => {
  const mod = newMod();
  assert.equal((await run('scaffold.sh', [mod, 'turn-counter', 'Ada'])).code, 0);
  const module = join(mod, 'hooks', 'register.tsx');
  writeFileSync(module, readFileSync(module, 'utf8').replace('<Text>Nothing to show yet.</Text>', ''));
  const tested = await claude('plugin', 'test', mod);
  assert.equal(tested.code, 1, tested.stdout);
  assert.match(tested.stdout, /\(fail\) the pane draws its line/);
});

test('a copy that fails partway leaves none of the four files, whichever file it fails at, and says so', async () => {
  for (const failing of FILES) {
    const mod = newMod();
    mkdirSync(mod, { recursive: true });
    writeFileSync(join(mod, 'SPEC.md'), '# turn-counter\n');
    const ran = await scaffoldWithCopyFailingAt(failing, mod, 'turn-counter', 'Ada');
    assert.equal(ran.code, 1, failing);
    assert.equal(ran.stdout, '', failing);
    assert.match(ran.stderr, /could not be written; none of the four files was left behind/);
    assert.deepEqual(listed(mod), ['SPEC.md'], failing);
  }
});

test('a copy that fails partway removes only what this run wrote: files already in the mod\'s folders stay as they were', async () => {
  const kept = { 'SPEC.md': '# turn-counter\n', 'hooks/notes.md': 'mine\n', 'tests/extra.test.tsx': '// mine\n', '.claude-plugin/README.md': 'mine too\n' };
  for (const failing of FILES) {
    const mod = newMod();
    for (const [file, text] of Object.entries(kept)) {
      mkdirSync(join(mod, file, '..'), { recursive: true });
      writeFileSync(join(mod, file), text);
    }
    assert.equal((await scaffoldWithCopyFailingAt(failing, mod, 'turn-counter', 'Ada')).code, 1, failing);
    assert.deepEqual(listed(mod), Object.keys(kept).sort(), failing);
    for (const [file, text] of Object.entries(kept)) assert.equal(readFileSync(join(mod, file), 'utf8'), text, `${failing}: ${file}`);
  }
});

test('after a copy that failed partway, the next run lays the four files', async () => {
  const mod = newMod();
  assert.equal((await scaffoldWithCopyFailingAt('hooks/hooks.json', mod, 'turn-counter', 'Ada')).code, 1);
  const again = await run('scaffold.sh', [mod, 'turn-counter', 'Ada']);
  assert.equal(again.code, 0, again.stderr);
  assert.deepEqual(listed(mod), [...FILES].sort());
});

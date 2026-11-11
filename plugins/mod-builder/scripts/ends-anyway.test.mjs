// A test file ends when its tests have ended, whatever they left open (SPEC.md 9.23): a test that fails before it
// closes its stand-in site, as every one does when its temporary folder can't be made, must not keep its process
// alive. Each case starts a test file as a process of its own and gives it 20 seconds to end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { scriptsDir, tempDir } from './test-helpers.mjs';

const HELPERS = pathToFileURL(join(scriptsDir, 'test-helpers.mjs')).href;
const LIMIT = 20000;

// Runs `node --test <file>` with `env` added, and answers how it ended: its code, or 'still running' when it had
// to be killed after LIMIT.
const ends = (file, env = {}) => new Promise((resolve) => {
  const all = { ...process.env, ...env, NO_COLOR: '1' };
  delete all.NODE_TEST_CONTEXT;
  delete all.FORCE_COLOR;
  const child = spawn(process.execPath, ['--test', '--test-timeout=5000', file], { env: all, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  let isKilled = false;
  const timer = setTimeout(() => { isKilled = true; child.kill('SIGKILL'); }, LIMIT);
  child.on('close', (code) => { clearTimeout(timer); resolve({ code: isKilled ? 'still running' : code, output }); });
});

const fileOf = (body) => {
  const file = join(tempDir('mod-builder-ends-'), 'child.test.mjs');
  writeFileSync(file, [`import { startSite, newCache } from ${JSON.stringify(HELPERS)};`, "import { test } from 'node:test';", "import assert from 'node:assert/strict';", body, ''].join('\n'));
  return file;
};

test('a test that fails with its site still open does not keep its process alive', { timeout: 60000 }, async () => {
  const ended = await ends(fileOf("test('fails before it closes', async () => { await startSite({ 'a.md': 'x' }); assert.equal(1, 2); });"));
  assert.equal(ended.code, 1, ended.output.slice(-600));
  assert.match(ended.output, /fails before it closes/);
});

test('a test that passes with its site still open does not keep its process alive either', { timeout: 60000 }, async () => {
  const ended = await ends(fileOf("test('forgets to close', async () => { const site = await startSite({ 'a.md': 'x' }); assert.match(site.origin, /^http:/); });"));
  assert.equal(ended.code, 0, ended.output.slice(-600));
});

test('a site that is asked while its test waits still answers: the test is what keeps the process alive', { timeout: 60000 }, async () => {
  const body = [
    "test('asks its site', async () => {",
    "  const site = await startSite({ 'a.md': 'the page' });",
    "  await new Promise((resolve) => { setTimeout(resolve, 300); });",
    "  const answer = await fetch(site.origin + '/docs/en/plugins/mods/a.md');",
    "  assert.equal(await answer.text(), 'the page');",
    "  await site.close();",
    "});",
  ].join('\n');
  const ended = await ends(fileOf(body));
  assert.equal(ended.code, 0, ended.output.slice(-600));
});

test('with TMPDIR naming a folder that is not there, a test file that opens a site first fails and ends', { timeout: 60000 }, async () => {
  const missing = join(tempDir('mod-builder-ends-'), 'not-made');
  // The order four of the script tests have: the site first, then the folder, which can't be made.
  const ended = await ends(fileOf("test('opens a site, then asks for a folder', async () => { await startSite({ 'a.md': 'x' }); newCache(); });"), { TMPDIR: missing });
  assert.equal(ended.code, 1, ended.output.slice(-600));
  assert.match(ended.output, /ENOENT/);
  assert.match(ended.output, /opens a site, then asks for a folder/);
});

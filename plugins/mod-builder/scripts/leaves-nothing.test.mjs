// A run of the node tests leaves no temporary folder behind (SPEC.md 9.21): every folder a test makes is made by
// tempDir, inside one folder of its process, and that folder is removed when the process ends, however it ends.
// Each case here starts a process of its own with TMPDIR set to an empty folder, and looks at that folder after.
// Run as root, a closed folder is no obstacle to a plain removal: the cases still pass there, and show nothing
// about the opening of closed folders.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { scriptsDir, tempDir, toolsFolder } from './test-helpers.mjs';

const HELPERS = pathToFileURL(join(scriptsDir, 'test-helpers.mjs')).href;
const HERE = 'leaves-nothing.test.mjs';

// What every child does first: two folders from tempDir, one of them holding a folder closed to its owner, and
// in each a link to a folder outside TMPDIR (one of the two inside the closed folder, where only the opening of
// closed folders comes by it); then it writes down which folders it made.
const MAKE = [
  `import { tempDir } from ${JSON.stringify(HELPERS)};`,
  "import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';",
  "import { join } from 'node:path';",
  "const one = tempDir('mod-builder-one-');",
  "const two = tempDir('mod-builder-two-');",
  "mkdirSync(join(one, 'closed/inner'), { recursive: true });",
  "writeFileSync(join(one, 'closed/inner/file'), 'x');",
  "symlinkSync(process.env.KEPT, join(two, 'link'));",
  "symlinkSync(process.env.KEPT, join(one, 'closed/link'));",
  "symlinkSync(process.env.KEPT, join(one, 'closed/inner/link'));",
  "chmodSync(join(one, 'closed/inner'), 0);",
  "chmodSync(join(one, 'closed'), 0);",
  "writeFileSync(process.env.MADE, JSON.stringify([one, two]));",
  '',
].join('\n');

// A place for one case: `tmp` is given to the child as TMPDIR; `kept` stands outside it, with a file, and the
// child links to it; `made` is where the child writes the folders it made.
const place = () => {
  const top = tempDir('mod-builder-leaves-');
  const at = { top, tmp: join(top, 'tmp'), kept: join(top, 'kept'), made: join(top, 'made.json') };
  mkdirSync(at.tmp);
  mkdirSync(at.kept, { mode: 0o750 });
  writeFileSync(join(at.kept, 'file'), 'kept');
  return at;
};

// Starts node on `args` with TMPDIR at.tmp. A test file's own process carries NODE_TEST_CONTEXT, which would make
// a `node --test` started from it answer as a child of this run: it is not handed on.
const start = (at, args) => {
  const env = { ...process.env, TMPDIR: at.tmp, KEPT: at.kept, MADE: at.made, NO_COLOR: '1' };
  delete env.NODE_TEST_CONTEXT;
  delete env.FORCE_COLOR;
  const child = spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const done = new Promise((resolve) => { child.on('close', (code, signal) => resolve({ code, signal, output })); });
  return { child, done };
};

// Writes `body` after MAKE as the file `name` of the case, runs it, and answers how it ended and what it made.
const runs = async (at, name, body, flags = []) => {
  const file = join(at.top, name);
  writeFileSync(file, MAKE + body + '\n');
  const ended = await start(at, [...flags, file]).done;
  return { ...ended, made: existsSync(at.made) ? JSON.parse(readFileSync(at.made, 'utf8')) : null };
};

// The child made its two folders under TMPDIR, and nothing is left there; the folder it linked to still stands
// with its file, neither opened nor closed: a link is removed, never followed.
const nothingLeft = (at, made) => {
  assert.equal(Array.isArray(made) && made.length, 2, 'the child made its two folders');
  for (const folder of made) assert.equal(folder.startsWith(at.tmp + '/'), true, folder);
  assert.deepEqual(readdirSync(at.tmp), []);
  assert.equal(readFileSync(join(at.kept, 'file'), 'utf8'), 'kept');
  assert.equal(statSync(at.kept).mode & 0o777, 0o750, 'the folder a link names keeps its mode');
};

test('a process that ends well leaves nothing under TMPDIR, a closed folder and a link included', async () => {
  const at = place();
  const ended = await runs(at, 'child.mjs', '');
  assert.equal(ended.code, 0, ended.output);
  nothingLeft(at, ended.made);
});

test('many folders are one folder of the run and one answer to its end: the process is not warned of too many', async () => {
  const at = place();
  const ended = await runs(at, 'child.mjs', "const more = Array.from({ length: 12 }, () => tempDir('mod-builder-more-'));\nif (new Set(more).size !== 12) process.exit(5);");
  assert.equal(ended.code, 0, ended.output);
  assert.doesNotMatch(ended.output, /MaxListenersExceeded|Warning/);
  nothingLeft(at, ended.made);
});

test('each folder is made inside one folder of the process, named mod-builder-run-, directly under TMPDIR', async () => {
  const at = place();
  const ended = await runs(at, 'child.mjs', '');
  assert.equal(ended.code, 0, ended.output);
  const [one, two] = ended.made;
  assert.equal(dirname(one), dirname(two));
  assert.notEqual(one, two);
  assert.equal(dirname(dirname(one)), at.tmp);
  assert.match(basename(dirname(one)), /^mod-builder-run-[A-Za-z0-9]{6}$/);
  assert.match(basename(one), /^mod-builder-one-[A-Za-z0-9]{6}$/);
  assert.match(basename(two), /^mod-builder-two-[A-Za-z0-9]{6}$/);
});

test('a test file whose tests pass leaves nothing under TMPDIR', async () => {
  const at = place();
  const ended = await runs(at, 'child.test.mjs', "import { test } from 'node:test';\ntest('passes', () => {});", ['--test']);
  assert.equal(ended.code, 0, ended.output);
  nothingLeft(at, ended.made);
});

test('a test file with a failing test leaves nothing under TMPDIR', async () => {
  const at = place();
  const body = "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('fails', () => { assert.equal(1, 2); });";
  const ended = await runs(at, 'child.test.mjs', body, ['--test']);
  assert.equal(ended.code, 1, ended.output);
  nothingLeft(at, ended.made);
});

test('a process ended by an error nothing caught leaves nothing under TMPDIR', async () => {
  const at = place();
  const ended = await runs(at, 'child.mjs', "throw new Error('not caught');");
  assert.equal(ended.code, 1, ended.output);
  assert.match(ended.output, /not caught/);
  nothingLeft(at, ended.made);
});

test('a process that ends itself with a code of its own leaves nothing under TMPDIR, and keeps the code', async () => {
  const at = place();
  const ended = await runs(at, 'child.mjs', 'process.exit(3);');
  assert.equal(ended.code, 3, ended.output);
  nothingLeft(at, ended.made);
});

// A child that makes its folders and then waits to be told to stop; and whether it has made them, within 30 s.
const waiting = (at) => {
  const file = join(at.top, 'child.mjs');
  writeFileSync(file, MAKE + 'setInterval(() => {}, 1000);\n');
  return start(at, [file]);
};
const hasMade = async (at) => {
  const until = Date.now() + 30000;
  while (!existsSync(at.made) && Date.now() < until) await new Promise((resolve) => { setTimeout(resolve, 20); });
  return existsSync(at.made);
};

for (const [signal, code] of [['SIGTERM', 143], ['SIGINT', 130], ['SIGHUP', 129]]) {
  test(`a process told to stop by ${signal} leaves nothing under TMPDIR, and ends with ${code}`, { timeout: 60000 }, async () => {
    const at = place();
    const { child, done } = waiting(at);
    try {
      assert.equal(await hasMade(at), true, 'the child made its folders before it was told to stop');
      child.kill(signal);
      // A child that does not end on the signal is not waited for beyond ten seconds.
      const ended = await Promise.race([done, new Promise((resolve) => { setTimeout(() => resolve({ code: 'still running', signal: null, output: '' }), 10000); })]);
      assert.deepEqual([ended.code, ended.signal], [code, null], ended.output);
      nothingLeft(at, JSON.parse(readFileSync(at.made, 'utf8')));
    } finally {
      child.kill('SIGKILL');
    }
  });
}

test('the stated limit: a process killed outright leaves its one folder of the run, and nothing beside it', { timeout: 60000 }, async () => {
  const at = place();
  const { child, done } = waiting(at);
  try {
    assert.equal(await hasMade(at), true);
    child.kill('SIGKILL');
    const ended = await done;
    assert.deepEqual([ended.code, ended.signal], [null, 'SIGKILL']);
    const left = readdirSync(at.tmp);
    assert.equal(left.length, 1);
    assert.match(left[0], /^mod-builder-run-/);
  } finally {
    child.kill('SIGKILL');
  }
});

test('a process that makes no folder makes no folder of the run either', async () => {
  const at = place();
  const file = join(at.top, 'child.mjs');
  writeFileSync(file, `import { newCache } from ${JSON.stringify(HELPERS)};\nif (typeof newCache !== 'function') process.exit(4);\nprocess.kill(process.pid, 'SIGTERM');\nsetInterval(() => {}, 1000);\n`);
  const ended = await start(at, [file]).done;
  assert.deepEqual([ended.code, ended.signal], [null, 'SIGTERM'], 'the helper changes nothing of a process until a folder is asked for');
  assert.deepEqual(readdirSync(at.tmp), []);
});

test('no node test names a temporary folder of its own: tempDir is the one place that makes them', () => {
  const tests = dirname(scriptsDir) + '/tests';
  const files = [...readdirSync(scriptsDir).map((name) => join(scriptsDir, name)), ...readdirSync(tests).map((name) => join(tests, name))]
    .filter((path) => path.endsWith('.mjs') && basename(path) !== 'test-helpers.mjs');
  assert.equal(files.length > 40, true);
  const naming = files.filter((path) => /mkdtemp|\btmpdir\b|['"`]\/tmp\/mod-builder|(?:mkdirSync|writeFileSync)\(\s*['"`]\/(?:var\/)?tmp\b|process\.env\.TMPDIR/.test(readFileSync(path, 'utf8')));
  assert.deepEqual(naming.map((path) => basename(path)), [HERE]);
});

test('a whole run of every other node test file leaves nothing under TMPDIR but the folders tools make there', async () => {
  const at = place();
  const tests = dirname(scriptsDir) + '/tests';
  const files = [...readdirSync(tests).map((name) => join(tests, name)), ...readdirSync(scriptsDir).map((name) => join(scriptsDir, name))]
    .filter((path) => path.endsWith('.test.mjs') && basename(path) !== HERE).sort();
  assert.equal(files.length > 40, true);
  const ended = await start(at, ['--test', '--test-timeout=120000', ...files]).done;
  assert.equal(ended.code, 0, ended.output.slice(-2000));
  // `claude plugin validate`, which one test file runs, makes claude-<user id> under TMPDIR, and where Claude Code
  // runs on Node, that process makes node-compile-cache there (SPEC.md 9.40): a tool's folders, not a test's.
  assert.deepEqual(readdirSync(at.tmp).filter((name) => !toolsFolder(name)), []);
});

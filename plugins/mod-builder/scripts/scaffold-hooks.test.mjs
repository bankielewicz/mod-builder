// Tests for scaffold.sh's modes for hooks/ alone (SPEC.md 9.17), which Red's gate uses, and for what the script
// owes whatever reads it: a reader that stops reading early gets no stray line on standard error, and the
// script's temporary folder is gone when it ends.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run, scriptsDir } from './test-helpers.mjs';

const SCRIPT = join(scriptsDir, 'scaffold.sh');
const HOOKS = ['hooks/hooks.json', 'hooks/register.tsx'];
const HOOKS_AS_LAID = `as laid: ${HOOKS.join(' ')}\n`;
const scaffold = (...args) => run('scaffold.sh', args);
const fresh = () => mkdtempSync(join(tmpdir(), 'mod-builder-scaffold-hooks-'));
const laid = async (name = 'turn-counter') => {
  const mod = join(fresh(), 'mod');
  const ran = await scaffold(mod, name, 'Ada');
  assert.equal(ran.code, 0, ran.stderr);
  return mod;
};
const put = (mod, file, text) => {
  mkdirSync(join(mod, file, '..'), { recursive: true });
  writeFileSync(join(mod, file), text);
};
const read = (mod, file) => readFileSync(join(mod, file), 'utf8');
// The script with its output piped to a reader that takes `lines` lines and closes; its temporary folders go
// under a folder of the test's own. Answers what it wrote to standard error and what it left there.
const cutShort = (args, lines) => new Promise((resolve) => {
  const temp = fresh();
  const child = spawn('bash', ['-c', 'bash "$0" "$@" | head -n "$LINES" >/dev/null', SCRIPT, ...args], { env: { ...process.env, TMPDIR: temp, LINES: String(lines) } });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('close', () => resolve({ stderr, left: readdirSync(temp) }));
});

test('--check-hooks says "as laid" for the two files under hooks/ of a mod just laid', async () => {
  const ran = await scaffold('--check-hooks', await laid(), 'turn-counter');
  assert.equal(ran.code, 0, ran.stderr);
  assert.equal(ran.stdout, HOOKS_AS_LAID);
});

test('--check-hooks does not look under tests/: a changed template test, a new test and a removed one are Red\'s own', async () => {
  const mod = await laid();
  writeFileSync(join(mod, 'tests/pane.test.tsx'), 'rewritten at Red\n');
  put(mod, 'tests/count.test.tsx', 'new at Red\n');
  assert.equal((await scaffold('--check-hooks', mod, 'turn-counter')).stdout, HOOKS_AS_LAID);
  rmSync(join(mod, 'tests'), { recursive: true });
  const ran = await scaffold('--check-hooks', mod, 'turn-counter');
  assert.equal(ran.stdout, HOOKS_AS_LAID);
  assert.equal(ran.code, 0);
});

test('--check-hooks names what under hooks/ is changed, missing or extra, and exits 1', async () => {
  const mod = await laid();
  writeFileSync(join(mod, 'hooks/register.tsx'), `${read(mod, 'hooks/register.tsx')}// code written ahead\n`);
  rmSync(join(mod, 'hooks/hooks.json'));
  put(mod, 'hooks/count.ts', 'x');
  symlinkSync('/etc/hostname', join(mod, 'hooks/elsewhere'));
  put(mod, 'tests/count.test.tsx', 'x');
  const ran = await scaffold('--check-hooks', mod, 'turn-counter');
  assert.equal(ran.code, 1);
  assert.deepEqual(ran.stdout.trim().split('\n'), ['missing: hooks/hooks.json', 'changed: hooks/register.tsx', 'extra: hooks/count.ts', 'extra: hooks/elsewhere']);
});

test('--check-hooks writes nothing, and the name is part of what was laid', async () => {
  const mod = await laid();
  const before = read(mod, 'hooks/register.tsx');
  const ran = await scaffold('--check-hooks', mod, 'turn-count');
  assert.equal(ran.code, 1);
  assert.equal(ran.stdout, 'changed: hooks/register.tsx\n');
  assert.equal(read(mod, 'hooks/register.tsx'), before);
});

test('--again-hooks lays the two files under hooks/ again and leaves every file under tests/ as Red has it', async () => {
  const mod = await laid();
  const template = read(mod, 'hooks/register.tsx');
  writeFileSync(join(mod, 'hooks/register.tsx'), 'code written ahead\n');
  writeFileSync(join(mod, 'tests/pane.test.tsx'), 'rewritten at Red\n');
  put(mod, 'tests/count.test.tsx', 'new at Red\n');
  put(mod, 'hooks/count.ts', 'kept\n');
  const ran = await scaffold('--again-hooks', mod, 'turn-counter');
  assert.equal(ran.code, 0, ran.stderr);
  assert.deepEqual(ran.stdout.trim().split('\n'), [...HOOKS.map((file) => `wrote ${join(mod, file)}`), 'extra: hooks/count.ts']);
  assert.equal(read(mod, 'hooks/register.tsx'), template);
  assert.equal(read(mod, 'tests/pane.test.tsx'), 'rewritten at Red\n');
  assert.equal(read(mod, 'tests/count.test.tsx'), 'new at Red\n');
  assert.equal(read(mod, 'hooks/count.ts'), 'kept\n');
});

test('--again-hooks makes no tests/ folder and no test file where there is none', async () => {
  const mod = await laid();
  rmSync(join(mod, 'tests'), { recursive: true });
  writeFileSync(join(mod, 'hooks/register.tsx'), 'code written ahead\n');
  assert.equal((await scaffold('--again-hooks', mod, 'turn-counter')).code, 0);
  assert.equal(existsSync(join(mod, 'tests')), false);
});

test('--again-hooks refuses a link where a file goes, and tests/ being a link is none of its business', async () => {
  const mod = await laid();
  rmSync(join(mod, 'hooks/register.tsx'));
  symlinkSync('/etc/hostname', join(mod, 'hooks/register.tsx'));
  const ran = await scaffold('--again-hooks', mod, 'turn-counter');
  assert.equal(ran.code, 1);
  assert.match(ran.stderr, /hooks\/register\.tsx is a link or no plain file; nothing was written/);
  const other = await laid();
  rmSync(join(other, 'tests'), { recursive: true });
  symlinkSync(join(other, 'hooks'), join(other, 'tests'));
  assert.equal((await scaffold('--again-hooks', other, 'turn-counter')).code, 0);
  assert.equal((await scaffold('--check-hooks', other, 'turn-counter')).stdout, HOOKS_AS_LAID);
});

test('the two modes for hooks/ take a mod folder and a name, and say their own flag in the usage', async () => {
  const mod = await laid();
  for (const mode of ['--check-hooks', '--again-hooks']) {
    for (const args of [[], [mod], [mod, 'turn-counter', 'Ada']]) {
      const ran = await scaffold(mode, ...args);
      assert.equal(ran.code, 2);
      assert.equal(ran.stderr, `usage: scaffold.sh ${mode} <mod folder> <mod name>\n`);
    }
    assert.equal((await scaffold(mode, mod, 'Not A Name')).code, 2);
  }
  const unknown = await scaffold('--check-tests', mod, 'turn-counter');
  assert.notEqual(unknown.code, 0);
  assert.equal(unknown.stdout, '');
});

test('--check and --again are as they were: all three files, and tests/ is theirs', async () => {
  const mod = await laid();
  put(mod, 'tests/count.test.tsx', 'x');
  assert.equal((await scaffold('--check', mod, 'turn-counter')).stdout, 'extra: tests/count.test.tsx\n');
  writeFileSync(join(mod, 'tests/pane.test.tsx'), 'rewritten\n');
  const ran = await scaffold('--again', mod, 'turn-counter');
  assert.equal(ran.stdout.trim().split('\n').length, 4);
  assert.notEqual(read(mod, 'tests/pane.test.tsx'), 'rewritten\n');
});

test('a reader that stops reading early gets no stray line on standard error and the script leaves no temporary folder: --again, many times', async () => {
  const mod = await laid();
  for (const file of ['hooks/a.ts', 'hooks/b.ts', 'tests/c.test.ts', 'tests/d.test.ts', 'tests/e/f.test.ts']) put(mod, file, 'x');
  for (let turn = 0; turn < 40; turn += 1) {
    writeFileSync(join(mod, 'tests/pane.test.tsx'), 'rewritten\n');
    const cut = await cutShort(['--again', mod, 'turn-counter'], 1 + (turn % 3));
    assert.equal(cut.stderr, '', `turn ${turn}`);
    assert.deepEqual(cut.left, [], `turn ${turn}`);
    // Every file was written before the first line was printed.
    assert.notEqual(read(mod, 'tests/pane.test.tsx'), 'rewritten\n', `turn ${turn}`);
  }
});

test('nor does --check, --check-hooks, --again-hooks or laying a mod, read to their first line only', async () => {
  const mod = await laid();
  for (const file of ['hooks/a.ts', 'hooks/b.ts', 'tests/c.test.ts', 'tests/d.test.ts']) put(mod, file, 'x');
  for (let turn = 0; turn < 15; turn += 1) {
    for (const args of [['--check', mod, 'other-name'], ['--check-hooks', mod, 'other-name'], ['--again-hooks', mod, 'turn-counter'], [join(fresh(), 'new'), 'turn-counter', 'Ada']]) {
      const cut = await cutShort(args, 1);
      assert.equal(cut.stderr, '', `${args[0]} turn ${turn}`);
      assert.deepEqual(cut.left, [], `${args[0]} turn ${turn}`);
    }
  }
});

// The reader here is gone before the script prints at all, so every write of the script's meets a closed pipe.
test('where the caller has the broken pipe ignored, a reader that stops early still gets no line on standard error', async () => {
  const mod = await laid();
  for (const file of ['hooks/a.ts', 'hooks/b.ts', 'tests/c.test.ts']) put(mod, file, 'x');
  for (const given of [['--check', mod, 'other-name'], ['--again', mod, 'turn-counter'], ['--check-hooks', mod, 'other-name'], ['--again-hooks', mod, 'turn-counter'], null]) {
    for (let turn = 0; turn < 8; turn += 1) {
      // Laying a mod needs a folder that holds none yet, each time.
      const args = given ?? [join(fresh(), 'new'), 'turn-counter', 'Ada'];
      const temp = fresh();
      const ran = await new Promise((resolve) => {
        const child = spawn('bash', ['-c', 'trap "" PIPE; bash "$0" "$@" | true', SCRIPT, ...args], { env: { ...process.env, TMPDIR: temp } });
        let stderr = '';
        child.stderr.on('data', (chunk) => { stderr += chunk; });
        child.on('close', () => resolve({ stderr, left: readdirSync(temp) }));
      });
      assert.equal(ran.stderr, '', `${args[0]} turn ${turn}`);
      assert.deepEqual(ran.left, [], `${args[0]} turn ${turn}`);
    }
  }
});

test('read to the end, no mode writes to standard error unless it refuses', async () => {
  const mod = await laid();
  for (const args of [['--check', mod, 'turn-counter'], ['--check-hooks', mod, 'turn-counter'], ['--check', mod, 'other-name'], ['--again', mod, 'turn-counter'], ['--again-hooks', mod, 'turn-counter']]) {
    assert.equal((await scaffold(...args)).stderr, '', args.join(' '));
  }
});

test('read to the end, each mode leaves no temporary folder either, whether it found a difference or not', async () => {
  const mod = await laid();
  for (const args of [['--check', mod, 'turn-counter'], ['--check', mod, 'other-name'], ['--check-hooks', mod, 'turn-counter'], ['--again', mod, 'turn-counter'], ['--again-hooks', mod, 'turn-counter'], ['--check', mod, 'Not A Name']]) {
    const cut = await cutShort(args, 100);
    assert.deepEqual(cut.left, [], args.join(' '));
  }
});

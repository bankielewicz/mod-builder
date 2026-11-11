// Tests for what scaffold.sh says of source outside hooks/ and tests/ (SPEC.md 9.17, point 4): every check, and
// every laying-again, names such a file as "source: <path>"; a declaration file under types/ is none; what the
// mod does not own is not looked into.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from './test-helpers.mjs';
import * as rules from '../hooks/mod-builder-logic.ts';

const AS_LAID = 'as laid: hooks/hooks.json hooks/register.tsx tests/pane.test.tsx\n';
const HOOKS_AS_LAID = 'as laid: hooks/hooks.json hooks/register.tsx\n';
const scaffold = (...args) => run('scaffold.sh', args);
const laid = async () => {
  const mod = join(mkdtempSync(join(tmpdir(), 'mod-builder-scaffold-source-')), 'mod');
  const ran = await scaffold(mod, 'turn-counter', 'Ada');
  assert.equal(ran.code, 0, ran.stderr);
  return mod;
};
const put = (mod, file, text = 'x') => {
  mkdirSync(join(mod, file, '..'), { recursive: true });
  writeFileSync(join(mod, file), text);
};
const check = (mod) => scaffold('--check', mod, 'turn-counter');
const checkHooks = (mod) => scaffold('--check-hooks', mod, 'turn-counter');

test('a source file outside hooks/ and tests/ is named as source by both checks, which exit 1', async () => {
  const mod = await laid();
  put(mod, 'lib/count.ts');
  for (const ran of [await check(mod), await checkHooks(mod)]) {
    assert.equal(ran.code, 1);
    assert.equal(ran.stdout, 'source: lib/count.ts\n');
    assert.equal(ran.stderr, '');
  }
});

test('every ending a mod could run is source, at the mod\'s top and however deep, sorted by path', async () => {
  const mod = await laid();
  for (const file of ['util.js', 'lib/a.ts', 'lib/b.tsx', 'lib/c.mts', 'lib/d.cts', 'lib/e.jsx', 'lib/f.mjs', 'lib/g.cjs', 'lib/deep/er/h.ts', 'src/.hidden.ts', 'a b/c d.ts']) put(mod, file);
  const ran = await check(mod);
  assert.equal(ran.code, 1);
  assert.deepEqual(ran.stdout.trim().split('\n'), ['a b/c d.ts', 'lib/a.ts', 'lib/b.tsx', 'lib/c.mts', 'lib/d.cts', 'lib/deep/er/h.ts', 'lib/e.jsx', 'lib/f.mjs', 'lib/g.cjs', 'src/.hidden.ts', 'util.js'].map((path) => `source: ${path}`));
});

test('what Scaffold may add is no source: a declaration file under types/, the manifest, a README, SPEC.md, data', async () => {
  const mod = await laid();
  for (const file of ['types/index.d.ts', 'types/deep/state.d.mts', 'types/more.d.cts', 'README.md', 'SPEC.md', 'data/table.json', 'tsconfig.json', 'notes.txt', 'lib/readme.ts.md']) put(mod, file);
  assert.equal((await check(mod)).stdout, AS_LAID);
  assert.equal((await checkHooks(mod)).stdout, HOOKS_AS_LAID);
});

test('only a declaration under types/ is let be: code under types/, and a declaration file anywhere else, are source', async () => {
  const mod = await laid();
  for (const file of ['types/real.ts', 'types/x.js', 'lib/x.d.ts', 'x.d.ts']) put(mod, file);
  assert.deepEqual((await check(mod)).stdout.trim().split('\n'), ['source: lib/x.d.ts', 'source: types/real.ts', 'source: types/x.js', 'source: x.d.ts']);
});

test('what the mod does not own is not looked into: its .git and node_modules at the top', async () => {
  const mod = await laid();
  for (const file of ['.git/hooks/x.js', 'node_modules/pkg/index.js']) put(mod, file);
  assert.equal((await check(mod)).stdout, AS_LAID);
  // Only at the top: further down they are the mod's own folders, and so is any other folder named with a dot.
  for (const file of ['lib/node_modules/pkg/index.js', 'lib/.git/x.js', '.config/x.ts']) put(mod, file);
  assert.deepEqual((await check(mod)).stdout.trim().split('\n'), ['source: .config/x.ts', 'source: lib/.git/x.js', 'source: lib/node_modules/pkg/index.js']);
});

test('of what stands under .claude-plugin/ only the index.d.ts Claude Code writes in each folder of types/ is let be', async () => {
  const mod = await laid();
  for (const file of ['.claude-plugin/types/claude-code/index.d.ts', '.claude-plugin/types/claude-code-tools/index.d.ts', '.claude-plugin/types/tsconfig.json']) put(mod, file);
  assert.equal((await check(mod)).stdout, AS_LAID);
  for (const file of ['.claude-plugin/types/claude-code/extra.ts', '.claude-plugin/types/index.d.ts', '.claude-plugin/types/a/b/index.d.ts', '.claude-plugin/code.js']) put(mod, file);
  assert.deepEqual((await check(mod)).stdout.trim().split('\n'), ['source: .claude-plugin/code.js', 'source: .claude-plugin/types/a/b/index.d.ts', 'source: .claude-plugin/types/claude-code/extra.ts', 'source: .claude-plugin/types/index.d.ts']);
});

test('only the folder named types holds declarations: one named like it does not', async () => {
  const mod = await laid();
  put(mod, 'types2/x.d.ts');
  put(mod, 'lib/types/x.d.ts');
  assert.deepEqual((await check(mod)).stdout.trim().split('\n'), ['source: lib/types/x.d.ts', 'source: types2/x.d.ts']);
});

test('the paths are sorted as bytes, whatever the language of the machine, and printed as they are spelled', async () => {
  const mod = await laid();
  for (const file of ['lib/b.ts', 'lib/B.ts', 'lib/a.ts', 'lib/back\\slash.ts', 'lib/ lead.ts', 'lib/trail .ts']) put(mod, file);
  const ran = await run('scaffold.sh', ['--check', mod, 'turn-counter'], { LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8', LC_COLLATE: 'en_US.UTF-8' });
  assert.deepEqual(ran.stdout.split('\n').slice(0, -1), ['source: lib/ lead.ts', 'source: lib/B.ts', 'source: lib/a.ts', 'source: lib/b.ts', 'source: lib/back\\slash.ts', 'source: lib/trail .ts']);
});

test('a folder is never source, whatever its name; what it holds is judged by its own name', async () => {
  const mod = await laid();
  put(mod, 'lib/x.ts/notes.md');
  assert.equal((await check(mod)).stdout, AS_LAID);
  put(mod, 'lib/x.ts/y.js');
  assert.equal((await check(mod)).stdout, 'source: lib/x.ts/y.js\n');
});

test('source under hooks/ and tests/ is not said twice: there it is "extra", and at Red a test is Red\'s own', async () => {
  const mod = await laid();
  put(mod, 'hooks/count.ts');
  put(mod, 'tests/count.test.ts');
  assert.equal((await check(mod)).stdout, 'extra: hooks/count.ts\nextra: tests/count.test.ts\n');
  assert.equal((await checkHooks(mod)).stdout, 'extra: hooks/count.ts\n');
});

test('the source lines come after the others, and the gate\'s rules read both', async () => {
  const mod = await laid();
  writeFileSync(join(mod, 'hooks/register.tsx'), 'changed\n');
  put(mod, 'hooks/count.ts');
  put(mod, 'lib/count.ts');
  const ran = await check(mod);
  assert.deepEqual(ran.stdout.trim().split('\n'), ['changed: hooks/register.tsx', 'extra: hooks/count.ts', 'source: lib/count.ts']);
  assert.deepEqual(rules.scaffoldSources(ran.stdout), ['lib/count.ts']);
  assert.deepEqual(rules.scaffoldDiffers(ran.stdout), ['changed: hooks/register.tsx', 'extra: hooks/count.ts']);
  assert.equal(rules.scaffoldKeptGate({ exitCode: ran.code, output: ran.stdout }, 'again').pass, false);
});

test('a mod whose own path holds a character a pattern gives meaning to is checked like any other', async () => {
  for (const name of ['br[a]ck', 'back\\slash', 'st*r', 'q?mark', 'sp ace', '-dash']) {
    const mod = join(mkdtempSync(join(tmpdir(), 'mod-builder-scaffold-source-')), name, 'mod');
    assert.equal((await scaffold(mod, 'turn-counter', 'Ada')).code, 0, name);
    assert.equal((await check(mod)).stdout, AS_LAID, name);
    assert.equal((await checkHooks(mod)).stdout, HOOKS_AS_LAID, name);
    put(mod, 'lib/count.ts');
    put(mod, 'node_modules/pkg/index.js');
    assert.equal((await check(mod)).stdout, 'source: lib/count.ts\n', name);
  }
});

test('a link outside hooks/ and tests/ is source whatever its name, and is never followed', async () => {
  const mod = await laid();
  mkdirSync(join(mod, 'lib'));
  symlinkSync('/etc/hostname', join(mod, 'lib/host.ts'));
  symlinkSync(join(mod, 'hooks'), join(mod, 'lib/loop'));
  symlinkSync('/etc', join(mod, 'elsewhere'));
  const ran = await check(mod);
  assert.deepEqual(ran.stdout.trim().split('\n'), ['source: elsewhere', 'source: lib/host.ts', 'source: lib/loop']);
  assert.equal(ran.stderr, '');
});

test('a folder of the mod that can\'t be read through is never passed over', { skip: process.getuid?.() === 0 }, async () => {
  const mod = await laid();
  put(mod, 'lib/closed/count.ts');
  chmodSync(join(mod, 'lib/closed'), 0o000);
  try {
    const ran = await check(mod);
    assert.equal(ran.code, 1);
    assert.equal(ran.stdout, "source: the mod (a folder can't be read)\n");
    assert.equal(ran.stderr, '');
  } finally {
    chmodSync(join(mod, 'lib/closed'), 0o755);
  }
});

test('--again and --again-hooks print the source they found and delete none of it', async () => {
  const mod = await laid();
  put(mod, 'lib/count.ts', 'kept\n');
  for (const mode of ['--again', '--again-hooks']) {
    const ran = await scaffold(mode, mod, 'turn-counter');
    assert.equal(ran.code, 0, ran.stderr);
    assert.equal(ran.stdout.trim().split('\n').at(-1), 'source: lib/count.ts');
    assert.equal(readFileSync(join(mod, 'lib/count.ts'), 'utf8'), 'kept\n');
  }
});

test('a check writes nothing while it looks: the source it names is as it was', async () => {
  const mod = await laid();
  put(mod, 'lib/count.ts', 'kept\n');
  await check(mod);
  await checkHooks(mod);
  assert.equal(readFileSync(join(mod, 'lib/count.ts'), 'utf8'), 'kept\n');
});

// Tests for scaffold.sh's two other modes (SPEC.md 9.4, 9.15). --check writes nothing and says whether a mod's
// hooks/ and tests/ are as the template lays them for a name; --again writes those three files as laid, over what
// is there, and deletes nothing. Run on throwaway folders, and judged by the gate's own rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { run, scriptsDir, tempDir } from './test-helpers.mjs';
// Read off the module as a whole, so that this file loads before the rules are built.
import * as rules from '../hooks/mod-builder-logic.ts';

const scaffoldDiffers = (...args) => rules.scaffoldDiffers(...args);
const scaffoldKeptGate = (...args) => rules.scaffoldKeptGate(...args);

const LAID = ['hooks/hooks.json', 'hooks/register.tsx', 'tests/pane.test.tsx'];
const AS_LAID = `as laid: ${LAID.join(' ')}\n`;
const scaffold = (...args) => run('scaffold.sh', args);
const check = (mod, name = 'turn-counter') => scaffold('--check', mod, name);
const again = (mod, name = 'turn-counter') => scaffold('--again', mod, name);
// A mod the script has just laid, in a folder of its own.
const laid = async (name = 'turn-counter') => {
  const mod = join(tempDir('mod-builder-scaffold-check-'), 'mod');
  const ran = await scaffold(mod, name, 'Ada');
  assert.equal(ran.code, 0, ran.stderr);
  return mod;
};
// Every entry under a folder, by its path, with what it is and what it holds: a write of any kind shows.
const snapshot = (folder, under = '') => readdirSync(join(folder, under), { withFileTypes: true }).flatMap((entry) => {
  const path = join(under, entry.name);
  if (entry.isSymbolicLink()) return [`${path} -> ${readlinkSync(join(folder, path))}`];
  if (entry.isDirectory()) return [`${path}/`, ...snapshot(folder, path)];
  return [`${path} ${createHash('sha256').update(readFileSync(join(folder, path))).digest('hex')}`];
}).sort();
const put = (mod, file, text) => {
  mkdirSync(join(mod, file, '..'), { recursive: true });
  writeFileSync(join(mod, file), text);
};

test('--check says "as laid" and exits 0 for a mod the script has just laid, and the gate\'s rule passes it', async () => {
  const mod = await laid();
  const ran = await check(mod);
  assert.equal(ran.code, 0, ran.stderr);
  assert.equal(ran.stdout, AS_LAID);
  assert.deepEqual(scaffoldKeptGate({ exitCode: ran.code, output: ran.stdout }, 'again'), { pass: true });
});

test('--check holds for names of every shape the script takes: one letter, digits, several groups', async () => {
  for (const name of ['a', 'x9', 'tool-log-2', 'a-b-c-d']) {
    const ran = await check(await laid(name), name);
    assert.equal(ran.stdout, AS_LAID, name);
    assert.equal(ran.code, 0, name);
  }
});

test('--check writes nothing: not in the mod, whatever it finds there', async () => {
  const mod = await laid();
  put(mod, 'hooks/lib.ts', 'export const x = 1\n');
  put(mod, 'SPEC.md', '# spec\n');
  const before = snapshot(mod);
  await check(mod);
  assert.deepEqual(snapshot(mod), before);
});

test('a changed byte in any of the three files is named as changed, and the check exits 1', async () => {
  for (const file of LAID) {
    const mod = await laid();
    writeFileSync(join(mod, file), `${readFileSync(join(mod, file), 'utf8')}\n`);
    const ran = await check(mod);
    assert.equal(ran.code, 1, file);
    assert.equal(ran.stdout, `changed: ${file}\n`);
  }
});

test('the behaviour written ahead into the hooks module is a change, though the mod still validates', async () => {
  const mod = await laid();
  const module = join(mod, 'hooks/register.tsx');
  writeFileSync(module, readFileSync(module, 'utf8').replace('Nothing to show yet.', 'Turns: 3'));
  assert.equal((await check(mod)).stdout, 'changed: hooks/register.tsx\n');
});

test('a file that is gone is named as missing, and a mod with no hooks/ or tests/ at all misses all three', async () => {
  const mod = await laid();
  rmSync(join(mod, 'tests/pane.test.tsx'));
  assert.equal((await check(mod)).stdout, 'missing: tests/pane.test.tsx\n');
  const empty = join(tempDir('mod-builder-scaffold-check-'), 'mod');
  const ran = await check(empty);
  assert.equal(ran.code, 1);
  assert.equal(ran.stdout, LAID.map((file) => `missing: ${file}\n`).join(''));
  assert.equal(existsSync(empty), false);
});

test('every other file under hooks/ and tests/ is named as extra, however deep and whatever its name; folders are not', async () => {
  const mod = await laid();
  put(mod, 'hooks/lib.ts', 'x');
  put(mod, 'hooks/deep/er/state.ts', 'x');
  put(mod, 'tests/count.test.ts', 'x');
  put(mod, 'tests/.hidden.test.ts', 'x');
  put(mod, 'tests/a b.test.ts', 'x');
  mkdirSync(join(mod, 'tests/empty'));
  const ran = await check(mod);
  assert.equal(ran.code, 1);
  assert.deepEqual(ran.stdout.trim().split('\n'), ['extra: hooks/deep/er/state.ts', 'extra: hooks/lib.ts', 'extra: tests/.hidden.test.ts', 'extra: tests/a b.test.ts', 'extra: tests/count.test.ts']);
});

test('what lies outside hooks/ and tests/ is not the check\'s: a contract in types/, the manifest, SPEC.md, a README', async () => {
  const mod = await laid();
  put(mod, 'types/index.d.ts', 'export {}\n');
  put(mod, 'SPEC.md', '# spec\n');
  put(mod, 'README.md', 'x');
  writeFileSync(join(mod, '.claude-plugin/plugin.json'), '{ "name": "turn-counter", "description": "its own" }\n');
  assert.equal((await check(mod)).stdout, AS_LAID);
});

test('a link is never followed: one in place of a laid file is changed though it points at the same bytes, and any other is extra', async () => {
  const mod = await laid();
  const module = join(mod, 'hooks/register.tsx');
  const copy = join(mod, 'register.copy');
  renameSync(module, copy);
  symlinkSync(copy, module);
  symlinkSync('/etc/hostname', join(mod, 'tests/elsewhere'));
  symlinkSync(join(mod, 'hooks'), join(mod, 'tests/loop'));
  const ran = await check(mod);
  assert.equal(ran.code, 1);
  assert.deepEqual(ran.stdout.trim().split('\n'), ['changed: hooks/register.tsx', 'extra: tests/elsewhere', 'extra: tests/loop']);
});

test('hooks/ or tests/ that is itself a link is changed, and nothing is read through it', async () => {
  const mod = await laid();
  renameSync(join(mod, 'hooks'), join(mod, 'hooks.real'));
  symlinkSync(join(mod, 'hooks.real'), join(mod, 'hooks'));
  const ran = await check(mod);
  assert.equal(ran.code, 1);
  assert.equal(ran.stdout.split('\n')[0], 'changed: hooks');
});

test('tests/ that is itself a link is changed too, as hooks/ is', async () => {
  const mod = await laid();
  renameSync(join(mod, 'tests'), join(mod, 'tests.real'));
  symlinkSync(join(mod, 'tests.real'), join(mod, 'tests'));
  const ran = await check(mod);
  assert.equal(ran.code, 1);
  assert.equal(ran.stdout.split('\n')[0], 'changed: tests');
});

test('a file whose path only looks like two of the laid ones joined by a space is extra', async () => {
  const mod = await laid();
  put(mod, 'hooks/register.tsx tests/pane.test.tsx', 'x');
  put(mod, 'hooks/hooks.json hooks/register.tsx', 'x');
  const ran = await check(mod);
  assert.equal(ran.code, 1);
  assert.deepEqual(ran.stdout.trim().split('\n'), ['extra: hooks/hooks.json hooks/register.tsx', 'extra: hooks/register.tsx tests/pane.test.tsx']);
});

test('a folder under hooks/ that can\'t be read through is never passed over: the check names hooks/ and exits 1', { skip: process.getuid?.() === 0 }, async () => {
  const mod = await laid();
  put(mod, 'hooks/closed/lib.ts', 'x');
  chmodSync(join(mod, 'hooks/closed'), 0o000);
  try {
    const ran = await check(mod);
    assert.equal(ran.code, 1);
    assert.equal(ran.stdout, "extra: hooks (it can't be read)\n");
  } finally {
    chmodSync(join(mod, 'hooks/closed'), 0o755);
  }
});

test('--check and --again ask for no author: one that git gives with a line break in it does not stop them', async () => {
  const mod = await laid();
  const home = tempDir('mod-builder-scaffold-check-');
  writeFileSync(join(home, '.gitconfig'), '[user]\n\tname = "Ada\\nLovelace"\n');
  for (const mode of ['--check', '--again']) {
    const ran = await new Promise((resolve) => {
      const child = spawn('bash', [join(scriptsDir, 'scaffold.sh'), mode, mod, 'turn-counter'], { env: { ...process.env, HOME: home, GIT_CONFIG_GLOBAL: join(home, '.gitconfig') } });
      child.on('close', (code) => resolve({ code }));
    });
    assert.equal(ran.code, 0, mode);
  }
});

test('a folder where a laid file goes is changed', async () => {
  const mod = await laid();
  rmSync(join(mod, 'hooks/hooks.json'));
  mkdirSync(join(mod, 'hooks/hooks.json'));
  assert.equal((await check(mod)).stdout, 'changed: hooks/hooks.json\n');
});

test('the name is part of what was laid: a check under another name finds the module and the test changed, not hooks.json', async () => {
  const mod = await laid('turn-counter');
  const ran = await check(mod, 'turn-count');
  assert.equal(ran.code, 1);
  assert.equal(ran.stdout, 'changed: hooks/register.tsx\nchanged: tests/pane.test.tsx\n');
});

test('every line of a failed check is one the gate\'s rule reads, and the rule refuses', async () => {
  const mod = await laid();
  put(mod, 'hooks/lib.ts', 'x');
  rmSync(join(mod, 'tests/pane.test.tsx'));
  const ran = await check(mod);
  assert.deepEqual(scaffoldDiffers(ran.stdout), ran.stdout.trim().split('\n'));
  assert.equal(scaffoldKeptGate({ exitCode: ran.code, output: ran.stdout }, 'again').pass, false);
});

test('--check and --again take a mod folder and a name, no more and no less, and a name that is one', async () => {
  const mod = await laid();
  for (const mode of ['--check', '--again']) {
    for (const args of [[], [mod], [mod, 'turn-counter', 'Ada']]) {
      const ran = await scaffold(mode, ...args);
      assert.equal(ran.code, 2, `${mode} ${args.length}`);
      assert.equal(ran.stderr, `usage: scaffold.sh ${mode} <mod folder> <mod name>\n`);
      assert.equal(ran.stdout, '');
    }
    for (const name of ['', 'Turn', 'a--b', '9a', 'a b']) {
      const ran = await scaffold(mode, mod, name);
      assert.equal(ran.code, 2, `${mode} ${name}`);
      assert.match(ran.stderr, /is no mod name/);
      assert.equal(ran.stdout, '');
    }
  }
  assert.equal((await check(mod)).stdout, AS_LAID);
});

test('--again writes the three files as the template has them over what is there, and --check then passes', async () => {
  const mod = await laid();
  writeFileSync(join(mod, 'hooks/register.tsx'), 'export const register = () => {}\n');
  rmSync(join(mod, 'tests/pane.test.tsx'));
  const ran = await again(mod);
  assert.equal(ran.code, 0, ran.stderr);
  assert.equal(ran.stdout, LAID.map((file) => `wrote ${join(mod, file)}\n`).join(''));
  assert.equal((await check(mod)).stdout, AS_LAID);
});

test('--again leaves the manifest and everything outside hooks/ and tests/ as it is', async () => {
  const mod = await laid();
  writeFileSync(join(mod, '.claude-plugin/plugin.json'), '{ "name": "turn-counter", "description": "its own" }\n');
  put(mod, 'SPEC.md', '# spec\n');
  put(mod, 'types/index.d.ts', 'export {}\n');
  const outside = () => snapshot(mod).filter((line) => !line.startsWith('hooks/') && !line.startsWith('tests/'));
  const before = outside();
  writeFileSync(join(mod, 'hooks/register.tsx'), 'changed\n');
  await again(mod);
  assert.deepEqual(outside(), before);
});

test('--again deletes nothing: an extra file stays, is printed as extra, and --check still names it', async () => {
  const mod = await laid();
  put(mod, 'hooks/lib.ts', 'kept\n');
  put(mod, 'tests/count.test.ts', 'kept\n');
  const ran = await again(mod);
  assert.equal(ran.code, 0);
  assert.deepEqual(ran.stdout.trim().split('\n').slice(3), ['extra: hooks/lib.ts', 'extra: tests/count.test.ts']);
  assert.equal(readFileSync(join(mod, 'hooks/lib.ts'), 'utf8'), 'kept\n');
  assert.equal((await check(mod)).stdout, 'extra: hooks/lib.ts\nextra: tests/count.test.ts\n');
});

test('--again lays the three files in a mod that has no hooks/ or tests/ yet, and no manifest', async () => {
  const mod = join(tempDir('mod-builder-scaffold-check-'), 'mod');
  mkdirSync(mod);
  const ran = await again(mod);
  assert.equal(ran.code, 0, ran.stderr);
  assert.equal((await check(mod)).stdout, AS_LAID);
  assert.equal(existsSync(join(mod, '.claude-plugin')), false);
});

test('--again writes through no link: a link or a folder where a file goes is refused, and nothing is written', async () => {
  const mod = await laid();
  const target = join(mod, 'elsewhere.txt');
  writeFileSync(target, 'not the mod\'s\n');
  rmSync(join(mod, 'tests/pane.test.tsx'));
  symlinkSync(target, join(mod, 'tests/pane.test.tsx'));
  writeFileSync(join(mod, 'hooks/register.tsx'), 'changed\n');
  const before = snapshot(mod);
  const ran = await again(mod);
  assert.equal(ran.code, 1);
  assert.match(ran.stderr, /tests\/pane\.test\.tsx is a link or no plain file; nothing was written/);
  assert.deepEqual(snapshot(mod), before);
  assert.equal(lstatSync(join(mod, 'tests/pane.test.tsx')).isSymbolicLink(), true);
});

test('--again refuses a folder where a laid file goes, and hooks/ that is a plain file, and writes nothing', async () => {
  const mod = await laid();
  rmSync(join(mod, 'hooks/hooks.json'));
  mkdirSync(join(mod, 'hooks/hooks.json'));
  writeFileSync(join(mod, 'hooks/register.tsx'), 'changed\n');
  let before = snapshot(mod);
  let ran = await again(mod);
  assert.equal(ran.code, 1);
  assert.match(ran.stderr, /hooks\/hooks\.json is a link or no plain file; nothing was written/);
  assert.deepEqual(snapshot(mod), before);
  const other = await laid();
  rmSync(join(other, 'hooks'), { recursive: true });
  writeFileSync(join(other, 'hooks'), 'a file\n');
  writeFileSync(join(other, 'tests/pane.test.tsx'), 'changed\n');
  before = snapshot(other);
  ran = await again(other);
  assert.equal(ran.code, 1);
  assert.match(ran.stderr, /hooks is a link or no folder; nothing was written/);
  assert.deepEqual(snapshot(other), before);
});

test('--again refuses hooks/ or tests/ that is itself a link, and writes nothing through it', async () => {
  const mod = await laid();
  renameSync(join(mod, 'tests'), join(mod, 'tests.real'));
  symlinkSync(join(mod, 'tests.real'), join(mod, 'tests'));
  writeFileSync(join(mod, 'tests.real/pane.test.tsx'), 'changed\n');
  const ran = await again(mod);
  assert.equal(ran.code, 1);
  assert.match(ran.stderr, /tests is a link or no folder; nothing was written/);
  assert.equal(readFileSync(join(mod, 'tests.real/pane.test.tsx'), 'utf8'), 'changed\n');
});

test('without a flag the script is as it was: it still refuses a folder that holds one of its files', async () => {
  const mod = await laid();
  const ran = await scaffold(mod, 'turn-counter', 'Ada');
  assert.equal(ran.code, 1);
  assert.match(ran.stderr, /is already there; nothing was written/);
});

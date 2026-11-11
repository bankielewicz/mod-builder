// Tests for restore-point.sh and put-back.sh (SPEC.md 8.5, 8.17), each run on real folders: an edit's restore
// point is a copy of the mod without its own .git and node_modules, and putting a stopped edit back deletes
// nothing, restores the mod as it was, and moves the mod's .git and node_modules into the restored folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { utimesSync } from 'node:fs';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from './test-helpers.mjs';

const FILES = {
  '.claude-plugin/plugin.json': '{ "name": "tool-log", "version": "0.1.0" }\n',
  'hooks/hooks.json': '{ "modules": ["./register.tsx"] }\n',
  'hooks/register.tsx': 'export const register = () => {}\n',
  'tests/pane.test.tsx': "test('one', () => {})\n",
  'tests/node_modules/helper/index.ts': 'export const kept = 1\n',
  'SPEC.md': '# tool-log\n',
  '.gitignore': 'node_modules\n',
  'lib/.git/config': 'a folder of that name further down is the mod\'s own\n',
  '.git/HEAD': 'ref: refs/heads/main\n',
  '.git/objects/ab/cdef': 'object\n',
  'node_modules/dep/index.js': 'module.exports = 1\n',
};
const OWN = ['.git/HEAD', '.git/objects/ab/cdef', 'node_modules/dep/index.js'];

// A mod in a throwaway folder, with a git folder and a node_modules folder of its own; `name` may hold a space.
function newMod(name = 'tool-log') {
  const top = mkdtempSync(join(tmpdir(), 'mod-builder-restore-'));
  const mod = join(top, name);
  for (const [path, text] of Object.entries(FILES)) {
    mkdirSync(join(mod, path, '..'), { recursive: true });
    writeFileSync(join(mod, path), text);
  }
  symlinkSync('register.tsx', join(mod, 'hooks', 'link.tsx'));
  chmodSync(join(mod, 'hooks', 'register.tsx'), 0o750);
  return { top, mod, restore: join(top, 'restore', 's1', '2026-11-11T012345Z'), stopped: `${mod}.stopped-2026-11-11T012345Z` };
}

// Every file under a folder with the hash of what it holds, and every link with where it points, by its path.
function listing(folder, rel = '') {
  const found = {};
  for (const entry of readdirSync(join(folder, rel), { withFileTypes: true })) {
    const path = rel === '' ? entry.name : `${rel}/${entry.name}`;
    if (entry.isSymbolicLink()) found[path] = `link to ${readlinkSync(join(folder, path))}`;
    else if (entry.isDirectory()) Object.assign(found, { [`${path}/`]: 'folder' }, listing(folder, path));
    else found[path] = createHash('sha256').update(readFileSync(join(folder, path))).digest('hex');
  }
  return found;
}
const without = (files, paths) => Object.fromEntries(Object.entries(files).filter(([path]) => !paths.some((one) => path === one || path.startsWith(`${one}/`))));
const restorePoint = (...args) => run('restore-point.sh', args);
const putBack = (...args) => run('put-back.sh', args);

test('the restore point holds every file of the mod but those under its own .git and node_modules', async () => {
  const { mod, restore } = newMod();
  const before = listing(mod);
  const done = await restorePoint(mod, restore);
  assert.equal(done.code, 0, done.stderr);
  assert.equal(done.stdout, `restore point: ${restore}\n`);
  assert.deepEqual(listing(restore), without(before, ['.git', 'node_modules']));
  assert.equal(existsSync(join(restore, '.git')), false);
  assert.equal(existsSync(join(restore, 'node_modules')), false);
});

test('files whose names open with a dot, a link, a file\'s mode, and a .git or node_modules further down are all kept', async () => {
  const { mod, restore } = newMod();
  assert.equal((await restorePoint(mod, restore)).code, 0);
  assert.equal(readFileSync(join(restore, '.gitignore'), 'utf8'), 'node_modules\n');
  assert.equal(readFileSync(join(restore, '.claude-plugin/plugin.json'), 'utf8'), FILES['.claude-plugin/plugin.json']);
  assert.equal(readFileSync(join(restore, 'tests/node_modules/helper/index.ts'), 'utf8'), 'export const kept = 1\n');
  assert.equal(existsSync(join(restore, 'lib/.git/config')), true);
  assert.equal(lstatSync(join(restore, 'hooks/link.tsx')).isSymbolicLink(), true);
  assert.equal(readlinkSync(join(restore, 'hooks/link.tsx')), 'register.tsx');
  assert.equal(statSync(join(restore, 'hooks/register.tsx')).mode & 0o777, 0o750);
});

test('making the restore point changes nothing in the mod\'s folder', async () => {
  const { mod, restore } = newMod();
  const before = listing(mod);
  assert.equal((await restorePoint(mod, restore)).code, 0);
  assert.deepEqual(listing(mod), before);
});

test('a restore folder that is there and not empty is refused, and an empty one is used', async () => {
  const { mod, restore } = newMod();
  mkdirSync(restore, { recursive: true });
  assert.equal((await restorePoint(mod, restore)).code, 0);
  const again = await restorePoint(mod, restore);
  assert.equal(again.code, 1);
  assert.match(again.stderr, /is already there and is not an empty folder/);
  // A folder that holds only a file whose name opens with a dot is not empty.
  const other = newMod();
  mkdirSync(other.restore, { recursive: true });
  writeFileSync(join(other.restore, '.kept'), 'x');
  assert.equal((await restorePoint(other.mod, other.restore)).code, 1);
  assert.equal(readFileSync(join(other.restore, '.kept'), 'utf8'), 'x');
});

test('the restore point is refused inside the mod, for a mod that is no folder, and for paths not from the root', async () => {
  const { mod, restore, top } = newMod();
  const inside = await restorePoint(mod, join(mod, 'restore'));
  assert.equal(inside.code, 1);
  assert.match(inside.stderr, /is inside the mod's folder/);
  assert.equal(existsSync(join(mod, 'restore')), false);
  const none = await restorePoint(join(top, 'nothing'), restore);
  assert.equal(none.code, 1);
  assert.match(none.stderr, /is no folder/);
  assert.equal((await restorePoint('tool-log', restore)).code, 2);
  assert.equal((await restorePoint(mod)).code, 2);
  assert.equal((await restorePoint(mod, restore, 'more')).code, 2);
});

// An edit, stopped at Green: a test and the code changed, a file added, one removed, and a new commit's object.
async function edited(name) {
  const made = newMod(name);
  const baseline = listing(made.mod);
  assert.equal((await restorePoint(made.mod, made.restore)).code, 0);
  writeFileSync(join(made.mod, 'tests/pane.test.tsx'), "test('one', () => { expect(1).toBe(2) })\n");
  writeFileSync(join(made.mod, 'hooks/register.tsx'), 'export const register = () => { /* edited */ }\n');
  writeFileSync(join(made.mod, 'hooks/new.ts'), 'export const added = 1\n');
  writeFileSync(join(made.mod, '.git/objects/ab/new'), 'a commit made during the edit\n');
  writeFileSync(join(made.mod, 'SPEC.md'), '# tool-log\n\n## 0.2.0\n');
  return { ...made, baseline, edited: listing(made.mod) };
}

test('putting a mod back restores every file as the baseline had it, the mod\'s own .git and node_modules with it', async () => {
  const { mod, restore, stopped, baseline, edited: now } = await edited();
  const done = await putBack(mod, restore, stopped);
  assert.equal(done.code, 0, done.stderr);
  assert.equal(done.stdout, `put back: ${mod}\nkept: ${stopped}\nmoved: .git, node_modules\n`);
  const back = listing(mod);
  // Outside .git and node_modules the mod hashes as its baseline did.
  assert.deepEqual(without(back, ['.git', 'node_modules']), without(baseline, ['.git', 'node_modules']));
  // Its git history and its installed packages came with it, as they were when the edit stopped.
  assert.deepEqual(Object.fromEntries(Object.entries(back).filter(([path]) => path.startsWith('.git/') || path.startsWith('node_modules/'))),
    Object.fromEntries(Object.entries(now).filter(([path]) => path.startsWith('.git/') || path.startsWith('node_modules/'))));
  assert.equal(readFileSync(join(mod, '.git/objects/ab/new'), 'utf8'), 'a commit made during the edit\n');
});

test('nothing is deleted: the edited folder stands beside the mod under its new name, without what was moved', async () => {
  const { mod, restore, stopped, edited: now } = await edited();
  const restoreBefore = listing(restore);
  assert.equal((await putBack(mod, restore, stopped)).code, 0);
  assert.deepEqual(listing(stopped), without(now, ['.git', 'node_modules']));
  assert.equal(readFileSync(join(stopped, 'hooks/new.ts'), 'utf8'), 'export const added = 1\n');
  assert.equal(existsSync(join(stopped, '.git')), false);
  assert.equal(existsSync(join(stopped, 'node_modules')), false);
  assert.deepEqual(listing(restore), restoreBefore);
  // Every file the edit had is in one of the two folders.
  const everywhere = { ...listing(stopped), ...listing(mod) };
  for (const path of Object.keys(now)) assert.equal(path in everywhere, true, path);
});

test('a mod with neither folder is put back with nothing moved, and one with only .git moves that', async () => {
  const plain = newMod();
  rmSync(join(plain.mod, '.git'), { recursive: true });
  rmSync(join(plain.mod, 'node_modules'), { recursive: true });
  assert.equal((await restorePoint(plain.mod, plain.restore)).code, 0);
  const done = await putBack(plain.mod, plain.restore, plain.stopped);
  assert.equal(done.code, 0, done.stderr);
  assert.equal(done.stdout.endsWith('moved: nothing\n'), true);
  const one = newMod();
  rmSync(join(one.mod, 'node_modules'), { recursive: true });
  assert.equal((await restorePoint(one.mod, one.restore)).code, 0);
  assert.equal((await putBack(one.mod, one.restore, one.stopped)).stdout.endsWith('moved: .git\n'), true);
  assert.equal(existsSync(join(one.mod, '.git/HEAD')), true);
});

test('a mod whose folder name holds a space is restored and put back the same', async () => {
  const { mod, restore, stopped, baseline } = await edited('tool log');
  const done = await putBack(mod, restore, stopped);
  assert.equal(done.code, 0, done.stderr);
  assert.deepEqual(without(listing(mod), ['.git', 'node_modules']), without(baseline, ['.git', 'node_modules']));
  assert.equal(existsSync(join(stopped, 'hooks/new.ts')), true);
});

test('putting back is refused, with nothing changed, when the stopped folder is there or the restore point is not', async () => {
  const { mod, restore, stopped, top, edited: now } = await edited();
  mkdirSync(stopped);
  const taken = await putBack(mod, restore, stopped);
  assert.equal(taken.code, 1);
  assert.match(taken.stderr, /is already there; nothing was changed/);
  assert.deepEqual(listing(mod), now);
  const lost = await putBack(mod, join(top, 'no-restore'), `${stopped}-2`);
  assert.equal(lost.code, 1);
  assert.match(lost.stderr, /the restore point .* is no folder; nothing was changed/);
  assert.deepEqual(listing(mod), now);
  assert.equal(existsSync(`${stopped}-2`), false);
});

test('putting back is refused for a stopped folder inside the mod or the mod itself, and for wrong arguments', async () => {
  const { mod, restore, stopped, edited: now } = await edited();
  assert.match((await putBack(mod, restore, join(mod, 'stopped'))).stderr, /is not beside the mod under the name tool-log\.stopped-<stamp>; nothing was changed/);
  assert.match((await putBack(mod, restore, mod)).stderr, /is already there; nothing was changed/);
  assert.deepEqual(listing(mod), now);
  assert.equal((await putBack(mod, restore)).code, 2);
  assert.equal((await putBack('tool-log', restore, stopped)).code, 2);
  assert.equal((await putBack(mod, restore, stopped, 'more')).code, 2);
});

// ------------------------------------------------------- cases the independent reader of these tests asked for

test('a restore point is complete only when every entry was copied: the mark beside it says so, and is not there before', async () => {
  const { mod, restore } = newMod();
  assert.equal(existsSync(`${restore}.complete`), false);
  assert.equal((await restorePoint(mod, restore)).code, 0);
  assert.equal(existsSync(`${restore}.complete`), true);
  assert.equal(existsSync(join(restore, '.complete')), false);
});

test('a copy that fails stops the restore point with exit 1 and no mark, and putting back from it is refused', { skip: process.getuid?.() === 0 && 'root reads every file' }, async () => {
  const { mod, restore, stopped } = newMod();
  writeFileSync(join(mod, 'hooks/unreadable.ts'), 'x');
  chmodSync(join(mod, 'hooks/unreadable.ts'), 0o000);
  const made = await restorePoint(mod, restore);
  assert.equal(made.code, 1);
  assert.match(made.stderr, /could not be copied; the restore point is not complete/);
  assert.equal(existsSync(`${restore}.complete`), false);
  const before = Object.keys(listing(join(mod, 'tests')));
  const back = await putBack(mod, restore, stopped);
  assert.equal(back.code, 1);
  assert.match(back.stderr, /is not complete \(.*\.complete is missing\); nothing was changed/);
  assert.equal(existsSync(stopped), false);
  assert.deepEqual(Object.keys(listing(join(mod, 'tests'))), before);
});

test('an empty folder is no restore point: putting back from one is refused, with nothing changed', async () => {
  const { mod, restore, stopped } = newMod();
  const before = listing(mod);
  mkdirSync(restore, { recursive: true });
  const back = await putBack(mod, restore, stopped);
  assert.equal(back.code, 1);
  assert.match(back.stderr, /is not complete/);
  assert.deepEqual(listing(mod), before);
});

test('a restore folder inside the mod is refused however it is spelled, and nothing is made in the mod', async () => {
  const { mod, top } = newMod();
  const before = listing(mod);
  symlinkSync(top, join(top, 'via'));
  mkdirSync(join(top, 'restore'));
  for (const hidden of [join(top, 'via', 'tool-log', 'rp'), `${top}/restore/../tool-log/rp`, `${top}//tool-log/rp`, `${mod}/a/b/rp`]) {
    const made = await restorePoint(mod, hidden);
    assert.equal(made.code, 1, hidden);
    assert.match(made.stderr, /is inside the mod's folder/, hidden);
  }
  assert.deepEqual(listing(mod), before);
});

test('putting back is refused before any rename when the restore point is inside the mod, or the mod inside it', async () => {
  const { mod, restore, top, edited: now } = await edited();
  symlinkSync(top, join(top, 'via'));
  mkdirSync(join(mod, 'rp'));
  writeFileSync(join(mod, 'rp.complete'), '');
  const inside = await putBack(mod, join(top, 'via', 'tool-log', 'rp'), `${mod}.stopped-x`);
  assert.equal(inside.code, 1);
  assert.match(inside.stderr, /the restore point is inside the mod's folder; nothing was changed/);
  assert.equal(existsSync(`${mod}.stopped-x`), false);
  const outer = join(top, 'outer');
  mkdirSync(join(outer, 'sub'), { recursive: true });
  writeFileSync(`${outer}.complete`, '');
  const nested = join(outer, 'sub', 'mod');
  mkdirSync(nested);
  writeFileSync(join(nested, 'a.ts'), 'x');
  const around = await putBack(nested, outer, `${nested}.stopped-x`);
  assert.equal(around.code, 1);
  assert.match(around.stderr, /the mod's folder is inside the restore point; nothing was changed/);
  assert.equal(existsSync(join(nested, 'a.ts')), true);
  assert.equal(existsSync(restore), true);
  assert.equal(Object.keys(now).every((path) => path.endsWith('/') || existsSync(join(mod, path)) || lstatSync(join(mod, path)).isSymbolicLink()), true);
});

test('the stopped folder is beside the mod, under the mod\'s name: any other place or name is refused', async () => {
  const { mod, restore, top, edited: now } = await edited();
  mkdirSync(join(top, 'other'));
  for (const elsewhere of [join(top, 'other', 'tool-log.stopped-1'), join(top, 'zzz'), join(top, 'tool-log.stopped-'), join(top, 'other-log.stopped-1'), join(top, 'via-missing', 'tool-log.stopped-1')]) {
    const back = await putBack(mod, restore, elsewhere);
    assert.equal(back.code, 1, elsewhere);
    assert.match(back.stderr, /is not beside the mod under the name tool-log\.stopped-<stamp>; nothing was changed/, elsewhere);
    assert.equal(existsSync(elsewhere), false, elsewhere);
  }
  assert.deepEqual(listing(mod), now);
});

test('a broken link where the stopped folder would go is refused: it is there', async () => {
  const { mod, restore, stopped, edited: now } = await edited();
  symlinkSync('nowhere', stopped);
  const back = await putBack(mod, restore, stopped);
  assert.equal(back.code, 1);
  assert.match(back.stderr, /is already there; nothing was changed/);
  assert.deepEqual(listing(mod), now);
});

test('the folder\'s own mode is kept: a mod only its owner may read comes back that way, and so is its restore point', async () => {
  const { mod, restore, stopped } = newMod();
  chmodSync(mod, 0o700);
  assert.equal((await restorePoint(mod, restore)).code, 0);
  assert.equal(statSync(restore).mode & 0o777, 0o700);
  assert.equal((await putBack(mod, restore, stopped)).code, 0);
  assert.equal(statSync(mod).mode & 0o777, 0o700);
  assert.equal(statSync(join(mod, 'hooks/register.tsx')).mode & 0o777, 0o750);
});

test('empty folders, a link at the mod\'s top, and a file only its owner reads are copied as they are', async () => {
  const { mod, restore, stopped } = newMod();
  mkdirSync(join(mod, 'assets', 'empty'), { recursive: true });
  symlinkSync('SPEC.md', join(mod, 'README.link'));
  writeFileSync(join(mod, 'secret.txt'), 's');
  chmodSync(join(mod, 'secret.txt'), 0o600);
  const before = without(listing(mod), ['.git', 'node_modules']);
  assert.equal((await restorePoint(mod, restore)).code, 0);
  assert.deepEqual(listing(restore), before);
  assert.equal(statSync(join(restore, 'secret.txt')).mode & 0o777, 0o600);
  assert.equal((await putBack(mod, restore, stopped)).code, 0);
  assert.deepEqual(without(listing(mod), ['.git', 'node_modules']), before);
  assert.equal(readlinkSync(join(mod, 'README.link')), 'SPEC.md');
  assert.equal(statSync(join(mod, 'secret.txt')).mode & 0o777, 0o600);
});

test('a .git that is a file, and a node_modules that is a link, are left out of the restore point and moved back as they are', async () => {
  const { mod, restore, stopped, top } = newMod();
  rmSync(join(mod, '.git'), { recursive: true });
  rmSync(join(mod, 'node_modules'), { recursive: true });
  writeFileSync(join(mod, '.git'), 'gitdir: ../.git/worktrees/tool-log\n');
  mkdirSync(join(top, 'shared-modules'));
  symlinkSync(join(top, 'shared-modules'), join(mod, 'node_modules'));
  assert.equal((await restorePoint(mod, restore)).code, 0);
  assert.equal(existsSync(join(restore, '.git')), false);
  assert.equal(lstatSync(join(restore, 'hooks')).isDirectory(), true);
  assert.throws(() => lstatSync(join(restore, 'node_modules')));
  const done = await putBack(mod, restore, stopped);
  assert.equal(done.code, 0, done.stderr);
  assert.equal(done.stdout.endsWith('moved: .git, node_modules\n'), true);
  assert.equal(readFileSync(join(mod, '.git'), 'utf8'), 'gitdir: ../.git/worktrees/tool-log\n');
  assert.equal(lstatSync(join(mod, 'node_modules')).isSymbolicLink(), true);
  assert.throws(() => lstatSync(join(stopped, 'node_modules')));
});

test('when it fails after the rename it exits 1 and says where the files are: the stopped folder still holds them', async () => {
  const { mod, restore, stopped, edited: now } = await edited();
  // A restore point that holds a .git of its own, as none made by restore-point.sh does: the mod's is not moved over it.
  mkdirSync(join(restore, '.git'));
  writeFileSync(join(restore, '.git', 'HEAD'), 'another\n');
  const back = await putBack(mod, restore, stopped);
  assert.equal(back.code, 1);
  assert.match(back.stderr, /came from the restore point, so .*\.git was not moved\. The mod as it was when stopped is in .*, and the restore point in .*; .* is not complete/);
  assert.equal(back.stdout, '');
  assert.deepEqual(listing(stopped), now);
  assert.equal(readFileSync(join(stopped, '.git/HEAD'), 'utf8'), 'ref: refs/heads/main\n');
});

test('a file keeps the mode and the time it had, through the restore point and back: one anybody may write stays so', async () => {
  const { mod, restore, stopped } = newMod();
  writeFileSync(join(mod, 'hooks/open.sh'), 'x');
  chmodSync(join(mod, 'hooks/open.sh'), 0o777);
  const then = new Date('2020-02-03T04:05:06Z');
  utimesSync(join(mod, 'SPEC.md'), then, then);
  assert.equal((await restorePoint(mod, restore)).code, 0);
  assert.equal(statSync(join(restore, 'hooks/open.sh')).mode & 0o777, 0o777);
  assert.equal(statSync(join(restore, 'SPEC.md')).mtime.toISOString(), then.toISOString());
  assert.equal((await putBack(mod, restore, stopped)).code, 0);
  assert.equal(statSync(join(mod, 'hooks/open.sh')).mode & 0o777, 0o777);
  assert.equal(statSync(join(mod, 'SPEC.md')).mtime.toISOString(), then.toISOString());
});

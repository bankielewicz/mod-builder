// Tests for scaffold.sh and the pane template it lays (SPEC.md 3.2, phase 4: "the mod's files from one template
// (`pane`)", ending when `claude plugin validate` passes). The script is run on a throwaway folder, and what it
// laid is checked by Claude Code's own validator and test runner, as the Scaffold gate checks it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import { run, scriptsDir, tempDir } from './test-helpers.mjs';
import { scaffoldGate, testNames } from '../hooks/mod-builder-logic.ts';

const FILES = ['.claude-plugin/plugin.json', 'hooks/hooks.json', 'hooks/register.tsx', 'tests/pane.test.tsx'];
const TEMPLATE = join(scriptsDir, '..', 'skills', 'build', 'templates', 'pane');

const newMod = (name = 'turn-counter') => join(tempDir('mod-builder-scaffold-'), name);
const scaffold = (...args) => run('scaffold.sh', args);
// The script run from a folder of the test's choosing, with an environment of its choosing.
const scaffoldIn = (cwd, env, ...args) => new Promise((resolve) => {
  const child = spawn('bash', [join(scriptsDir, 'scaffold.sh'), ...args], { cwd, env: { ...process.env, ...env } });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('close', (code) => resolve({ code, stderr }));
});
const claude = (...args) => new Promise((resolve) => {
  execFile('claude', args, { timeout: 60000 }, (error, stdout) => resolve({ code: error === null ? 0 : error.code, stdout: String(stdout) }));
});
// Every file under a folder, by its path from the folder, sorted.
const listed = (folder, under = '') => readdirSync(join(folder, under), { withFileTypes: true })
  .flatMap((entry) => (entry.isDirectory() ? listed(folder, join(under, entry.name)) : [join(under, entry.name)])).sort();
const read = (mod, file) => readFileSync(join(mod, file), 'utf8');

test('scaffold lays the manifest, the hooks module and a test, and says which files it wrote', async () => {
  const mod = newMod();
  const ran = await scaffold(mod, 'turn-counter', 'Ada');
  assert.equal(ran.code, 0, ran.stderr);
  assert.deepEqual(listed(mod), [...FILES].sort());
  assert.deepEqual(ran.stdout.trim().split('\n'), FILES.map((file) => `wrote ${join(mod, file)}`));
});

test('what scaffold laid passes claude plugin validate --strict and its own two tests, as the Scaffold gate asks', async () => {
  const mod = newMod();
  await scaffold(mod, 'turn-counter', 'Ada');
  const validated = await claude('plugin', 'validate', '--strict', mod);
  assert.equal(validated.code, 0, validated.stdout);
  assert.match(validated.stdout, /Validation passed/);
  assert.match(validated.stdout, /answers its own command: command\.run\{command=turn-counter\}/);
  const tested = await claude('plugin', 'test', mod);
  assert.equal(tested.code, 0, tested.stdout);
  assert.match(tested.stdout, /\n 2 pass\n 0 fail\n/);
  // And by the gate's own rules: Scaffold passes on these two runs, and records both tests by name.
  assert.deepEqual(scaffoldGate({ exitCode: validated.code, output: validated.stdout }, { exitCode: tested.code, output: tested.stdout }), { pass: true, tests: 2 });
  assert.deepEqual(testNames(tested.stdout), ['the pane draws its line', 'the command opens the pane']);
});

test('the mod\'s name replaces the template\'s everywhere: the manifest, the command, the pane and its title', async () => {
  const mod = newMod('x');
  await scaffold(mod, 'turn-counter-2', 'Ada');
  for (const file of FILES) assert.equal(read(mod, file).toLowerCase().includes('pane-template'), false, file);
  for (const file of FILES) assert.equal(read(mod, file).includes('Pane template'), false, file);
  assert.equal(JSON.parse(read(mod, '.claude-plugin/plugin.json')).name, 'turn-counter-2');
  const module = read(mod, 'hooks/register.tsx');
  assert.match(module, /\$\.command\.register\(\{ name: 'turn-counter-2',/);
  assert.match(module, /\$\.ui\.open\(\{ id: 'turn-counter-2', title: 'Turn counter 2' \}\)/);
  assert.match(module, /on\('ui\.render', \{ component: 'Pane', requestId: 'turn-counter-2' \}/);
  const tests = read(mod, 'tests/pane.test.tsx');
  assert.match(tests, /plugin: 'turn-counter-2',\n  component: 'Pane',\n  requestId: 'turn-counter-2',\n  props: \{ title: 'Turn counter 2',/);
  assert.match(tests, /\$\.command\.run\(\{ command: 'turn-counter-2', args: '' \}/);
});

test('the author is written into the manifest as given, whatever characters it holds', async () => {
  for (const author of ['Ada Lovelace', 'A "B" \\n C & D', 'O\'Neil \\ <x>', '$(id) `id` ${HOME}', 'Pane template Ltd', 'pane-template', 'pane-template-author', '-n']) {
    const mod = newMod();
    const ran = await scaffold(mod, 'turn-counter', author);
    assert.equal(ran.code, 0, ran.stderr);
    assert.deepEqual(JSON.parse(read(mod, '.claude-plugin/plugin.json')).author, { name: author });
  }
});

test('with no author given, the author is git\'s user.name; with none set there, the login name', async () => {
  const home = tempDir('mod-builder-home-');
  const env = { HOME: home, GIT_CONFIG_GLOBAL: join(home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1' };
  const outside = tempDir('mod-builder-cwd-');
  const unnamed = newMod();
  assert.equal((await scaffoldIn(outside, env, unnamed, 'turn-counter')).code, 0);
  assert.deepEqual(JSON.parse(read(unnamed, '.claude-plugin/plugin.json')).author, { name: userInfo().username });
  writeFileSync(join(home, '.gitconfig'), '[user]\n\tname = Git Name\n');
  const named = newMod();
  assert.equal((await scaffoldIn(outside, env, named, 'turn-counter')).code, 0);
  assert.deepEqual(JSON.parse(read(named, '.claude-plugin/plugin.json')).author, { name: 'Git Name' });
});

test('an author that holds a tab or a line break is refused before anything is written: it would not be one line of JSON text', async () => {
  for (const author of ['A\tB', 'A\nB', 'A\rB', 'A\u0001B']) {
    const mod = newMod();
    const ran = await scaffold(mod, 'turn-counter', author);
    assert.equal(ran.code, 2, JSON.stringify(author));
    assert.match(ran.stderr, /the author holds a control character/);
    assert.equal(existsSync(mod), false);
  }
});

test('a mod folder given from the folder the script is run in is laid there, not beside the script', async () => {
  const cwd = tempDir('mod-builder-cwd-');
  const ran = await scaffoldIn(cwd, {}, 'made/turn-counter', 'turn-counter', 'Ada');
  assert.equal(ran.code, 0, ran.stderr);
  assert.deepEqual(listed(join(cwd, 'made', 'turn-counter')), [...FILES].sort());
});

test('a mod folder whose name starts with a hyphen or holds a space is laid like any other', async () => {
  const cwd = tempDir('mod-builder-cwd-');
  for (const folder of ['-n', 'my mods/turn counter']) {
    const ran = await scaffoldIn(cwd, {}, folder, 'turn-counter', 'Ada');
    assert.equal(ran.code, 0, ran.stderr);
    assert.deepEqual(listed(join(cwd, folder)), [...FILES].sort());
  }
});

test('an empty mod folder is refused: nothing is laid at the root', async () => {
  const ran = await scaffold('', 'turn-counter', 'Ada');
  assert.equal(ran.code, 2);
  assert.match(ran.stderr, /the mod folder is empty/);
});

test('when a folder for one of the files can\'t be made, none of the four files is left behind', async () => {
  for (const blocked of ['tests', 'hooks', '.claude-plugin']) {
    const mod = newMod();
    mkdirSync(mod, { recursive: true });
    writeFileSync(join(mod, blocked), 'a file where a folder would go\n');
    const ran = await scaffold(mod, 'turn-counter', 'Ada');
    assert.equal(ran.code, 1, blocked);
    assert.equal(ran.stdout, '');
    assert.deepEqual(listed(mod), [blocked]);
  }
});

test('SPEC.md and anything else already in the folder is left as it is', async () => {
  const mod = newMod();
  mkdirSync(join(mod, 'hooks'), { recursive: true });
  writeFileSync(join(mod, 'SPEC.md'), '# turn-counter\n');
  writeFileSync(join(mod, 'hooks', 'notes.md'), 'kept\n');
  const ran = await scaffold(mod, 'turn-counter', 'Ada');
  assert.equal(ran.code, 0, ran.stderr);
  assert.equal(read(mod, 'SPEC.md'), '# turn-counter\n');
  assert.equal(read(mod, 'hooks/notes.md'), 'kept\n');
  assert.deepEqual(listed(mod), [...FILES, 'SPEC.md', 'hooks/notes.md'].sort());
});

test('a folder that already holds one of the four files is refused whole: nothing is written over, and nothing beside it', async () => {
  for (const held of FILES) {
    const mod = newMod();
    mkdirSync(join(mod, held, '..'), { recursive: true });
    writeFileSync(join(mod, held), 'mine\n');
    const ran = await scaffold(mod, 'turn-counter', 'Ada');
    assert.equal(ran.code, 1, held);
    assert.match(ran.stderr, /is already there; nothing was written/);
    assert.equal(ran.stdout, '');
    assert.equal(read(mod, held), 'mine\n');
    assert.deepEqual(listed(mod), [held]);
  }
});

test('a link where a file would go is refused too, though it points nowhere', async () => {
  const mod = newMod();
  mkdirSync(join(mod, 'hooks'), { recursive: true });
  symlinkSync(join(mod, 'elsewhere.tsx'), join(mod, 'hooks', 'register.tsx'));
  const ran = await scaffold(mod, 'turn-counter', 'Ada');
  assert.equal(ran.code, 1);
  assert.equal(existsSync(join(mod, 'elsewhere.tsx')), false);
  assert.equal(existsSync(join(mod, '.claude-plugin')), false);
});

test('a name that is no mod name is refused before anything is written', async () => {
  for (const name of ['Turn-Counter', '1st', '-x', 'a b', 'a/b', '../x', 'a.b', 'a_b', '', 'a\nb', 'x;id', '$(id)', 'a-', 'a--b']) {
    const mod = newMod();
    const ran = await scaffold(mod, name, 'Ada');
    assert.equal(ran.code, 2, JSON.stringify(name));
    assert.match(ran.stderr, /is no mod name/);
    assert.equal(existsSync(mod), false, JSON.stringify(name));
  }
});

test('with the wrong number of arguments scaffold prints its usage and writes nothing', async () => {
  for (const args of [[], [newMod()], [newMod(), 'a', 'b', 'c']]) {
    const ran = await scaffold(...args);
    assert.equal(ran.code, 2);
    assert.match(ran.stderr, /^usage: scaffold\.sh <mod folder> <mod name> \[author\]/);
  }
});

test('the template\'s test file is kept under a name the plugin\'s own test run does not pick up', () => {
  assert.deepEqual(listed(TEMPLATE), ['.claude-plugin/plugin.json', 'hooks/hooks.json', 'hooks/register.tsx', 'tests/pane.test.tsx.template']);
});

test('the template is plain ASCII, so that the scaffolded files are', () => {
  for (const file of listed(TEMPLATE)) assert.equal(/^[\x09\x0a\x20-\x7e]*$/.test(read(TEMPLATE, file)), true, file);
});

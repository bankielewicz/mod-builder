// Logic tests for the guard's rule on other plugins' folders (SPEC.md 3.3, "Other plugins' folders, until Done"):
// while a session's build is open and not yet Done, a write into any other folder that holds a plugin manifest,
// or is being created as one, is refused, so that naming a decoy folder through the gate opens nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guardVerdict, newRecord } from '../hooks/mod-builder-logic.ts';

const MOD = '/work/turn-counter';
const OTHER = '/work/other-mod';
const record = (phase, more = {}) => ({ ...newRecord(MOD, 's1'), phase, ...more });
const guard = (more) => guardVerdict({
  tool: 'Write', path: `${OTHER}/hooks/register.tsx`, cwd: '/work', sessionId: 's1',
  entry: { modDir: MOD }, record: record('scaffold'), pluginFolders: [OTHER], ...more,
});
const BUILDING = ['knowledge', 'describe', 'spec', 'scaffold', 'red', 'green', 'verify'];

test('while a build is open, a write into another plugin\'s folder is refused in every phase before Done, naming both folders', () => {
  for (const phase of BUILDING) {
    assert.deepEqual(guard({ record: record(phase) }), {
      allowed: false,
      reason: `mod-builder: ${OTHER}/hooks/register.tsx can't be written: it is in another plugin's folder (${OTHER}), and this session is building ${MOD}. Until that build is Done, its mod is the only plugin this session may write.`,
    }, phase);
  }
});

test('naming a decoy folder opens nothing: the real mod, another plugin to the decoy\'s build, stays closed', () => {
  const decoy = '/work/decoy';
  const built = { entry: { modDir: decoy }, record: { ...newRecord(decoy, 's1'), phase: 'scaffold' } };
  assert.equal(guard({ ...built, path: `${MOD}/hooks/register.tsx`, pluginFolders: [MOD] }).allowed, false);
  assert.equal(guard({ ...built, path: `${MOD}/tests/a.test.ts`, pluginFolders: [MOD] }).allowed, false);
  assert.equal(guard({ ...built, path: `${MOD}/SPEC.md`, pluginFolders: [MOD] }).allowed, false);
  assert.deepEqual(guard({ ...built, path: `${decoy}/hooks/register.tsx`, pluginFolders: [] }), { allowed: true });
});

test('a write that makes another folder a plugin is refused too, though no manifest exists yet', () => {
  for (const phase of BUILDING) {
    const verdict = guard({ record: record(phase), path: 'second-mod/.claude-plugin/plugin.json', pluginFolders: [] });
    assert.equal(verdict.allowed, false, phase);
    assert.match(verdict.reason, /it is in another plugin's folder \(\/work\/second-mod\)/);
  }
});

test('once the build is Done, other plugins\' folders may be written again', () => {
  assert.deepEqual(guard({ record: record('done') }), { allowed: true });
  assert.deepEqual(guard({ record: record('done'), path: 'second-mod/.claude-plugin/plugin.json', pluginFolders: [] }), { allowed: true });
});

test('outside the mod, a path in no plugin\'s folder passes in every phase, and so does a marketplace\'s list', () => {
  for (const phase of [...BUILDING, 'done']) {
    assert.deepEqual(guard({ record: record(phase), path: '/work/notes.md' }), { allowed: true }, phase);
    assert.deepEqual(guard({ record: record(phase), path: '/work/.claude-plugin/marketplace.json', pluginFolders: [] }), { allowed: true }, phase);
    assert.deepEqual(guard({ record: record(phase), path: '/work/other-mod-2/hooks/x.ts' }), { allowed: true }, phase);
  }
});

test('only a manifest above the path makes it another plugin\'s, and the nearest one is named', () => {
  assert.deepEqual(guard({ path: '/work/notes.md', pluginFolders: [OTHER, MOD, '/elsewhere'] }), { allowed: true });
  assert.match(guard({ path: `${OTHER}/nested/x.ts`, pluginFolders: ['/work/other', OTHER, `${OTHER}/nested`] }).reason, /\(\/work\/other-mod\/nested\)/);
  assert.equal(guard({ path: '/work/notes.md', pluginFolders: ['/work'] }).allowed, false);
});

test('the mod being built is not another plugin: its own manifest, and a plugin folder above it, leave its paths to the phase', () => {
  assert.deepEqual(guard({ path: `${MOD}/hooks/register.tsx`, pluginFolders: [MOD] }), { allowed: true });
  assert.deepEqual(guard({ path: `${MOD}/.claude-plugin/plugin.json`, pluginFolders: [] }), { allowed: true });
  assert.deepEqual(guard({ path: `${MOD}/hooks/register.tsx`, pluginFolders: ['/work', MOD] }), { allowed: true });
  assert.match(guard({ path: `${MOD}/hooks/register.tsx`, pluginFolders: ['/work', MOD], record: record('red') }).reason, /in phase 5 \(Red\)/);
  assert.match(guard({ path: `${MOD}/tests/x.ts`, pluginFolders: ['/work', MOD], record: record('green') }).reason, /in phase 6 \(Green\)/);
});

test('naming a folder that holds the real mod opens nothing either: a plugin folder inside the named folder is another plugin', () => {
  for (const named of ['/work', '/']) {
    const built = { entry: { modDir: named }, record: { ...newRecord(named, 's1'), phase: 'scaffold' } };
    const verdict = guard({ ...built, path: `${MOD}/hooks/register.tsx`, pluginFolders: [MOD] });
    assert.equal(verdict.allowed, false, named);
    assert.match(verdict.reason, /it is in another plugin's folder \(\/work\/turn-counter\), and this session is building /);
    assert.equal(guard({ ...built, path: '/work/second-mod/.claude-plugin/plugin.json', pluginFolders: [] }).allowed, false, named);
    assert.deepEqual(guard({ ...built, path: '/work/notes.md', pluginFolders: [] }), { allowed: true }, named);
  }
  const own = { entry: { modDir: '/work' }, record: { ...newRecord('/work', 's1'), phase: 'scaffold' } };
  assert.deepEqual(guard({ ...own, path: '/work/hooks/register.tsx', pluginFolders: ['/work'] }), { allowed: true });
  assert.deepEqual(guard({ ...own, path: '/work/.claude-plugin/plugin.json', pluginFolders: [] }), { allowed: true });
});

test('a plugin folder inside the mod being built is another plugin too, existing or being made, until Done', () => {
  for (const phase of ['scaffold', 'red', 'green']) {
    assert.match(guard({ path: `${MOD}/sub/hooks/x.ts`, pluginFolders: [`${MOD}/sub`, MOD], record: record(phase) }).reason, /another plugin's folder \(\/work\/turn-counter\/sub\)/, phase);
    assert.match(guard({ path: `${MOD}/sub/.claude-plugin/plugin.json`, pluginFolders: [MOD], record: record(phase) }).reason, /another plugin's folder \(\/work\/turn-counter\/sub\)/, phase);
  }
  assert.deepEqual(guard({ path: `${MOD}/sub/README.md`, pluginFolders: [`${MOD}/sub`, MOD], record: record('done') }), { allowed: true });
  assert.match(guard({ path: `${MOD}/tests/x.ts`, pluginFolders: [MOD], record: record('done') }).reason, /in phase 8 \(Done\)/);
});

test('making a folder above the mod a plugin is refused: the folder being made is not the mod', () => {
  for (const phase of BUILDING) {
    assert.match(guard({ record: record(phase), path: '/work/.claude-plugin/plugin.json', pluginFolders: [] }).reason, /another plugin's folder \(\/work\)/, phase);
  }
  assert.equal(guard({ path: 'x/../second-mod/.claude-plugin/plugin.json', pluginFolders: [] }).allowed, false);
  assert.equal(guard({ path: 'turn-counter/../.claude-plugin/plugin.json', pluginFolders: [] }).allowed, false);
});

test('every tool the guard looks at is refused another plugin\'s folder, each by the path it writes', () => {
  for (const tool of ['Edit', 'MultiEdit', 'Write', 'NotebookEdit']) assert.equal(guard({ tool }).allowed, false, tool);
});

test('a build taken to Done opens other plugins\' folders whatever folder it named: Done is read from the session\'s own build', () => {
  const decoy = '/work/decoy';
  assert.deepEqual(guard({ entry: { modDir: decoy }, record: { ...newRecord(decoy, 's1'), phase: 'done' }, path: `${MOD}/hooks/register.tsx`, pluginFolders: [MOD] }), { allowed: true });
});

test('a record that is missing, damaged or another session\'s is not Done: another plugin\'s folder stays closed', () => {
  for (const bad of [undefined, null, {}, { ...record('done'), sessionId: 's2' }, { ...record('done'), modDir: OTHER }, { ...record('done'), phase: 'finished' }]) {
    const verdict = guard({ record: bad });
    assert.equal(verdict.allowed, false, JSON.stringify(bad) ?? String(bad));
    assert.match(verdict.reason, /it is in another plugin's folder/);
  }
  assert.deepEqual(guard({ record: undefined, path: '/work/notes.md' }), { allowed: true });
});

test('other tools, other sessions and a session with no build are not touched by the rule', () => {
  assert.deepEqual(guard({ tool: 'Bash' }), { allowed: true });
  assert.deepEqual(guard({ tool: 'Read' }), { allowed: true });
  assert.deepEqual(guard({ entry: undefined }), { allowed: true });
});

test('a relative path and one with ".." are another plugin\'s when that is where they lead', () => {
  assert.equal(guard({ path: 'other-mod/hooks/x.ts' }).allowed, false);
  assert.equal(guard({ path: 'turn-counter/../other-mod/hooks/x.ts' }).allowed, false);
  assert.equal(guard({ path: 'other-mod/../turn-counter/hooks/x.ts', pluginFolders: [OTHER, MOD] }).allowed, true);
  assert.equal(guard({ cwd: OTHER, path: 'hooks/x.ts' }).allowed, false);
});

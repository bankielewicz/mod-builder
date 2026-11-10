// Logic tests for what the hooks module asks the rules (SPEC.md 3.3): which skill opens a build, the record a build
// keeps, the guard's answer for one tool call, and whether a headless load is seen in the debug log. The log lines
// below are those Claude Code 2.1.322 wrote for throwaway mods, with their folders' paths shortened.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as logic from '../hooks/mod-builder-logic.ts';

// Read at the call, so a build of the rules that lacks one of these fails each test that needs it, not the file.
const call = (name) => (...args) => logic[name](...args);
const isBuildSkill = call('isBuildSkill');
const sessionKey = call('sessionKey');
const buildKey = call('buildKey');
const absolutePath = call('absolutePath');
const newRecord = call('newRecord');
const isSessionEntry = call('isSessionEntry');
const isBuildRecord = call('isBuildRecord');
const toolPath = call('toolPath');
const foldersAbove = call('foldersAbove');
const pluginFolderBeingMade = call('pluginFolderBeingMade');
const guardVerdict = call('guardVerdict');
const loadShown = call('loadShown');

const MOD = '/work/turn-counter';
const GATE = 'mod_builder_gate';
const record = (phase, more = {}) => ({ ...newRecord(MOD, 's1'), phase, ...more });
const guard = (more) => guardVerdict({
  tool: 'Write', path: `${MOD}/hooks/register.tsx`, cwd: '/work', sessionId: 's1',
  entry: { modDir: MOD }, record: record('spec'), pluginFolders: [MOD], ...more,
});

// ---------------------------------------------------------------------------------- what opens a build

const ROOT = '/plugins/mod-builder';
const skill = (more = {}) => ({ skill: 'build', source: 'plugin', pluginName: 'mod-builder', path: `${ROOT}/skills/build/SKILL.md`, ...more });

test('the build skill of this plugin opens a build, under its own name or the name a plugin skill is listed by', () => {
  assert.equal(isBuildSkill(skill(), 'mod-builder', ROOT), true);
  assert.equal(isBuildSkill(skill({ skill: 'mod-builder:build' }), 'mod-builder', ROOT), true);
  assert.equal(isBuildSkill(skill({ path: undefined }), 'mod-builder', ROOT), true);
});

test('a skill named build that does not come with this plugin opens nothing, whatever its name says', () => {
  assert.equal(isBuildSkill(skill({ pluginName: 'other' }), 'mod-builder', ROOT), false);
  assert.equal(isBuildSkill(skill({ skill: 'mod-builder:build', pluginName: 'other' }), 'mod-builder', ROOT), false);
  assert.equal(isBuildSkill({ skill: 'build', source: 'projectSettings' }, 'mod-builder', ROOT), false);
  assert.equal(isBuildSkill({ skill: 'mod-builder:build', source: 'projectSettings', path: '/work/.claude/skills/build/SKILL.md' }, 'mod-builder', ROOT), false);
  assert.equal(isBuildSkill({ skill: 'mod-builder:build', source: 'userSettings' }, 'mod-builder', ROOT), false);
  assert.equal(isBuildSkill({ skill: 'build', source: 'plugin' }, 'mod-builder', ROOT), false);
  assert.equal(isBuildSkill(skill({ skill: 'other:build' }), 'mod-builder', ROOT), false);
  for (const pluginName of ['Mod-Builder', 'mod-builder@claudemod', 'mod-builder ', '']) assert.equal(isBuildSkill(skill({ pluginName }), 'mod-builder', ROOT), false, pluginName);
});

test('the build skill of another plugin that shares this one\'s name opens nothing: its file is not under this plugin\'s folder', () => {
  const other = '/home/u/.claude/plugins/cache/claudemod/mod-builder/0.2.34/skills/build/SKILL.md';
  assert.equal(isBuildSkill(skill({ path: other }), 'mod-builder', ROOT), false);
  assert.equal(isBuildSkill(skill({ path: '/plugins/mod-builder-2/skills/build/SKILL.md' }), 'mod-builder', ROOT), false);
  assert.equal(isBuildSkill(skill({ path: `${ROOT}/../other/skills/build/SKILL.md` }), 'mod-builder', ROOT), false);
  assert.equal(isBuildSkill(skill({ path: 'skills/build/SKILL.md' }), 'mod-builder', ROOT), false);
  assert.equal(isBuildSkill(skill({ path: other }), 'mod-builder', '/home/u/.claude/plugins/cache/claudemod/mod-builder/0.2.34'), true);
});

test('the word a skill\'s source carries is not what decides: the plugin\'s name and the file do', () => {
  for (const source of ['plugin', 'inline', 'userSettings', undefined]) assert.equal(isBuildSkill(skill({ source }), 'mod-builder', ROOT), true, String(source));
});

test('another skill of this plugin opens nothing, and neither does a name that only holds "build"', () => {
  for (const name of ['edit', 'rebuild', 'build2', 'Build', ' build', 'build ', '/build', 'mod-builder:Build', 'mod-builder:edit', 'mod-builder:build:x', ':build', '']) {
    assert.equal(isBuildSkill(skill({ skill: name }), 'mod-builder', ROOT), false, name);
  }
});

test('an input, a plugin name or a plugin folder that is none opens nothing, and nothing throws', () => {
  for (const e of [null, undefined, 'build', 3, {}, { skill: 'build' }]) assert.equal(isBuildSkill(e, 'mod-builder', ROOT), false, String(e));
  for (const name of [null, undefined, '', 3]) assert.equal(isBuildSkill(skill({ pluginName: name }), name, ROOT), false, String(name));
  for (const root of [null, undefined, '', 'plugins/mod-builder', 3]) assert.equal(isBuildSkill(skill(), 'mod-builder', root), false, String(root));
  assert.equal(isBuildSkill(skill({ path: 7 }), 'mod-builder', ROOT), false);
});

// ------------------------------------------------------------------------------------------ the record

test('a session and a build are kept under keys that name them', () => {
  assert.equal(sessionKey('s1'), 'session:s1');
  assert.equal(buildKey('/work/turn-counter'), 'build:/work/turn-counter');
});

test('a path is made absolute against the session\'s folder, with "." and ".." applied and no "/" at its end', () => {
  assert.equal(absolutePath('turn-counter', '/work'), '/work/turn-counter');
  assert.equal(absolutePath('./turn-counter/', '/work'), '/work/turn-counter');
  assert.equal(absolutePath('/work/a/../turn-counter//', '/elsewhere'), '/work/turn-counter');
  assert.equal(absolutePath('../turn-counter', '/work/sub'), '/work/turn-counter');
  assert.equal(absolutePath('/', '/work'), '/');
});

test('a path that is none, climbs above the root, or stands against a folder that is not absolute has no absolute form', () => {
  assert.equal(absolutePath('', '/work'), null);
  assert.equal(absolutePath('../../x', '/work'), null);
  assert.equal(absolutePath('x', 'work'), null);
  for (const bad of [null, undefined, 3, {}]) {
    assert.equal(absolutePath(bad, '/work'), null, String(bad));
    assert.equal(absolutePath('x', bad), null, String(bad));
  }
});

test('a new record is at Knowledge, bound to its session, with nothing approved and nothing recorded', () => {
  assert.deepEqual(newRecord(MOD, 's1'), {
    modDir: MOD, sessionId: 's1', phase: 'knowledge', specApprovedAt: null, spec: null,
    testsAtScaffold: null, namesAtScaffold: null, testsAtRed: null, testHashes: null, evidence: {},
  });
  assert.deepEqual(JSON.parse(JSON.stringify(newRecord(MOD, 's1'))), newRecord(MOD, 's1'));
  assert.notEqual(newRecord(MOD, 's1').evidence, newRecord(MOD, 's1').evidence);
});

test('a session entry is pending or names an absolute folder; anything else is none', () => {
  assert.equal(isSessionEntry({ modDir: null }), true);
  assert.equal(isSessionEntry({ modDir: MOD }), true);
  for (const bad of [null, undefined, 'pending', [], {}, { modDir: 'turn-counter' }, { modDir: '' }, { modDir: 3 }, { modDir: undefined }]) {
    assert.equal(isSessionEntry(bad), false, JSON.stringify(bad) ?? String(bad));
  }
});

test('a build record names an absolute folder, a session and a phase; anything else is none', () => {
  assert.equal(isBuildRecord(newRecord(MOD, 's1')), true);
  assert.equal(isBuildRecord(JSON.parse(JSON.stringify(record('verify')))), true);
  for (const bad of [null, undefined, 'record', [], {}, { ...record('spec'), phase: 'shipping' }, { ...record('spec'), phase: undefined },
    { ...record('spec'), sessionId: '' }, { ...record('spec'), sessionId: 7 }, { ...record('spec'), modDir: 'turn-counter' }, { ...record('spec'), modDir: null }]) {
    assert.equal(isBuildRecord(bad), false, JSON.stringify(bad) ?? String(bad));
  }
});

// ------------------------------------------------------------------------------------- the path of a call

test('the path of a call is its notebook_path for NotebookEdit and its file_path for every other tool', () => {
  assert.equal(toolPath('Write', { file_path: '/work/a.ts', content: 'x' }), '/work/a.ts');
  assert.equal(toolPath('NotebookEdit', { notebook_path: '/work/a.ipynb' }), '/work/a.ipynb');
  assert.equal(toolPath('Edit', { file_path: 'relative/a.ts' }), 'relative/a.ts');
  assert.equal(toolPath('MultiEdit', { file_path: '/work/a.ts' }), '/work/a.ts');
});

test('a call can\'t show the guard one path and write another: the field read is the one its tool writes', () => {
  const both = { file_path: '/work/notes.md', notebook_path: '/work/turn-counter/a.ipynb' };
  assert.equal(toolPath('NotebookEdit', both), '/work/turn-counter/a.ipynb');
  assert.equal(toolPath('Write', both), '/work/notes.md');
  assert.equal(toolPath('Edit', both), '/work/notes.md');
  assert.equal(toolPath('Write', { notebook_path: '/work/a.ipynb' }), null);
  assert.equal(toolPath('NotebookEdit', { file_path: '/work/a.ts' }), null);
});

test('a call that names no path has none', () => {
  for (const e of [{}, { file_path: '' }, { file_path: 3 }, { path: '/work/a.ts' }, null, undefined, 'x']) assert.equal(toolPath('Write', e), null, JSON.stringify(e) ?? String(e));
});

test('the folders above a path are listed nearest first, down to the root', () => {
  assert.deepEqual(foldersAbove('/work/turn-counter/hooks/register.tsx', '/x'), ['/work/turn-counter/hooks', '/work/turn-counter', '/work', '/']);
  assert.deepEqual(foldersAbove('hooks/../SPEC.md', '/work/turn-counter'), ['/work/turn-counter', '/work', '/']);
  assert.deepEqual(foldersAbove('/a.txt', '/work'), ['/']);
  assert.deepEqual(foldersAbove('/', '/work'), []);
  assert.deepEqual(foldersAbove('', '/work'), []);
  assert.deepEqual(foldersAbove('../../../x', '/work'), []);
});

test('a write of a folder\'s .claude-plugin/plugin.json makes that folder a plugin', () => {
  assert.equal(pluginFolderBeingMade('/work/new-mod/.claude-plugin/plugin.json', '/x'), '/work/new-mod');
  assert.equal(pluginFolderBeingMade('new-mod/.claude-plugin/plugin.json', '/work'), '/work/new-mod');
  assert.equal(pluginFolderBeingMade('new-mod/hooks/../.claude-plugin/plugin.json', '/work'), '/work/new-mod');
  assert.equal(pluginFolderBeingMade('/.claude-plugin/plugin.json', '/x'), '/');
  assert.equal(pluginFolderBeingMade('/work/a/.claude-plugin/b/.claude-plugin/plugin.json', '/x'), '/work/a/.claude-plugin/b');
});

test('any other write makes no plugin: a marketplace\'s list, another file of the folder, a name that only looks like it', () => {
  for (const path of ['/work/.claude-plugin/marketplace.json', '/work/new-mod/.claude-plugin/types/x.d.ts', '/work/new-mod/.claude-plugin/plugin.json/x',
    '/work/new-mod/hooks/register.tsx', '/work/new-mod/.claude-plugin', '/work/new-mod/.claude-plugins/plugin.json', '/work/new-mod/plugin.json',
    '/work/new-mod/.CLAUDE-PLUGIN/plugin.json', '/work/new-mod/x.claude-plugin/plugin.json', '', '../../../.claude-plugin/plugin.json']) {
    assert.equal(pluginFolderBeingMade(path, '/work'), null, path);
  }
});

// ------------------------------------------------------------------------------------------- the guard

test('with no build for the session the guard passes at once, whatever the path', () => {
  for (const entry of [undefined, null]) {
    assert.deepEqual(guard({ entry, record: undefined }), { allowed: true });
    assert.deepEqual(guard({ entry, record: record('spec') }), { allowed: true });
  }
});

test('the guard looks at Edit, MultiEdit, Write and NotebookEdit only, and only at a call that names a path', () => {
  for (const tool of ['Edit', 'MultiEdit', 'Write', 'NotebookEdit']) assert.equal(guard({ tool }).allowed, false, tool);
  for (const tool of ['Bash', 'Read', 'write', 'mcp__mod-builder__mod_builder_gate', 'AskUserQuestion', '']) assert.deepEqual(guard({ tool }), { allowed: true }, tool);
  assert.deepEqual(guard({ path: null }), { allowed: true });
});

test('while the build is pending, a write in a folder that holds a plugin manifest is refused, naming the folder and the gate tool', () => {
  const verdict = guard({ entry: { modDir: null }, record: undefined, pluginFolders: [MOD] });
  assert.deepEqual(verdict, {
    allowed: false,
    reason: `mod-builder: ${MOD}/hooks/register.tsx can't be written yet: it is in a plugin's folder (${MOD}), and this build has not named its mod's folder. Call the ${GATE} tool with mod_dir first.`,
  });
});

test('while the build is pending, only a manifest above the path counts, and the nearest one is named', () => {
  const pending = (path, pluginFolders) => guard({ entry: { modDir: null }, record: undefined, path, pluginFolders });
  assert.match(pending(`${MOD}/nested/hooks/x.ts`, [MOD, `${MOD}/nested`, '/work']).reason, /\(\/work\/turn-counter\/nested\)/);
  assert.match(pending(`${MOD}/nested/hooks/x.ts`, ['/work', MOD]).reason, /\(\/work\/turn-counter\)/);
  assert.deepEqual(pending(`${MOD}/hooks/x.ts`, ['/work/turn-counter-2']), { allowed: true });
  assert.deepEqual(pending(`${MOD}/hooks/x.ts`, ['/work/turn', `${MOD}/nested`, '/elsewhere']), { allowed: true });
  assert.deepEqual(pending('/work/turn-counter-2/hooks/x.ts', [MOD]), { allowed: true });
  assert.equal(pending(`${MOD}/hooks/x.ts`, ['/']).allowed, false);
});

test('while the build is pending, a record the folder already has opens nothing: the folder is not this build\'s until it is named', () => {
  assert.equal(guard({ entry: { modDir: null }, record: record('scaffold'), pluginFolders: [MOD] }).allowed, false);
  assert.equal(guard({ entry: { modDir: null }, record: record('spec'), path: `${MOD}/SPEC.md`, pluginFolders: [MOD] }).allowed, false);
});

test('while the build is pending, a write that makes a folder a plugin is refused though no manifest exists yet', () => {
  const verdict = guard({ entry: { modDir: null }, record: undefined, path: 'new-mod/.claude-plugin/plugin.json', pluginFolders: [] });
  assert.equal(verdict.allowed, false);
  assert.match(verdict.reason, /it is in a plugin's folder \(\/work\/new-mod\)/);
  assert.match(verdict.reason, /mod_builder_gate tool with mod_dir first/);
});

test('while the build is pending, a write in no plugin\'s folder passes', () => {
  assert.deepEqual(guard({ entry: { modDir: null }, record: undefined, path: '/work/notes.md', pluginFolders: [] }), { allowed: true });
  assert.deepEqual(guard({ entry: { modDir: null }, record: undefined, path: '/work/new-mod/hooks/register.tsx', pluginFolders: [] }), { allowed: true });
  assert.deepEqual(guard({ entry: { modDir: null }, record: undefined, path: '/work/.claude-plugin/marketplace.json', pluginFolders: [] }), { allowed: true });
});

test('in a session with a build, a path that can\'t be made absolute is refused, pending or not; with no build it passes', () => {
  const refused = /the path can't be read as one under/;
  for (const more of [{ path: '../../../work/turn-counter/hooks/x.ts' }, { path: '/../work/turn-counter/hooks/x.ts' }, { cwd: 'work' }, { cwd: undefined }, { cwd: 'work', path: 'x.ts' }]) {
    const label = JSON.stringify(more);
    assert.match(guard({ record: record('scaffold'), ...more }).reason, refused, label);
    assert.match(guard({ entry: { modDir: null }, record: undefined, pluginFolders: [], ...more }).reason, refused, label);
    assert.deepEqual(guard({ entry: undefined, record: undefined, ...more }), { allowed: true }, label);
  }
});

test('a tool the guard does not look at passes whatever the session\'s entry or record is, so the gate tool can always be called', () => {
  for (const tool of ['Bash', 'Read', 'mcp__mod-builder__mod_builder_gate']) {
    for (const entry of ['pending', {}, { modDir: 'x' }, { modDir: null }, { modDir: MOD }]) {
      assert.deepEqual(guard({ tool, entry, record: undefined }), { allowed: true }, `${tool} ${JSON.stringify(entry)}`);
    }
  }
  assert.deepEqual(guard({ path: null, entry: 'pending' }), { allowed: true });
});

test('under the mod the guard judges as the rules do: Done as Verify, nested and look-alike names, letter case, the folder itself', () => {
  const may = (phase, path) => guard({ record: record(phase), path: `${MOD}/${path}` }).allowed;
  assert.deepEqual(['SPEC.md', 'hooks/register.tsx', 'tests/a.test.ts', 'README.md'].map((path) => may('done', path)), [true, false, false, true]);
  assert.deepEqual(['tests/deep/a.test.ts', 'tests-old/a.test.ts', 'docs/SPEC.md', 'SPEC.md.bak', 'Tests/a.test.ts', 'tests'].map((path) => may('red', path)), [true, false, false, false, false, true]);
  assert.deepEqual(['Tests/a.test.ts', 'TESTS/a.test.ts', 'spec.md', 'Hooks/x.ts', 'tests-old/a.test.ts'].map((path) => may('green', path)), [false, false, false, true, true]);
  assert.deepEqual(['HOOKS/x.ts', 'Tests/a.test.ts', 'hooks-old/x.ts'].map((path) => may('verify', path)), [false, false, true]);
  assert.equal(guard({ record: record('red'), path: MOD }).allowed, false);
  assert.match(guard({ record: record('red'), path: `${MOD}/` }).reason, /^mod-builder: the mod folder can't be written in phase 5 \(Red\)/);
  assert.equal(guard({ record: record('scaffold'), path: MOD }).allowed, true);
});

test('a session started inside the mod\'s folder is judged the same: paths from that folder, and ".." back into it', () => {
  const inside = (path, phase) => guard({ cwd: MOD, path, record: record(phase) }).allowed;
  assert.deepEqual([inside('hooks/register.tsx', 'spec'), inside('SPEC.md', 'spec'), inside('../turn-counter/hooks/x.ts', 'spec'), inside('../notes.md', 'spec')], [false, true, false, true]);
  assert.deepEqual([inside('tests/a.test.ts', 'red'), inside('./tests/../hooks/x.ts', 'red')], [true, false]);
});

test('once the mod is named, each phase writes what SPEC.md 3.3\'s table gives it and is refused the rest', () => {
  const may = (phase, path) => guard({ record: record(phase), path: `${MOD}/${path}` }).allowed;
  assert.deepEqual(['SPEC.md', 'hooks/register.tsx', 'tests/a.test.ts', 'README.md'].map((path) => may('spec', path)), [true, false, false, false]);
  assert.deepEqual(['SPEC.md', 'hooks/register.tsx', 'tests/a.test.ts', '.claude-plugin/plugin.json'].map((path) => may('scaffold', path)), [true, true, true, true]);
  assert.deepEqual(['SPEC.md', 'hooks/register.tsx', 'tests/a.test.ts'].map((path) => may('red', path)), [false, false, true]);
  assert.deepEqual(['SPEC.md', 'hooks/register.tsx', 'tests/a.test.ts', 'README.md'].map((path) => may('green', path)), [false, true, false, true]);
  assert.deepEqual(['SPEC.md', 'hooks/register.tsx', 'tests/a.test.ts', 'README.md'].map((path) => may('verify', path)), [true, false, false, true]);
  assert.deepEqual(['SPEC.md', 'hooks/register.tsx'].map((path) => may('knowledge', path)), [false, false]);
  assert.deepEqual(['SPEC.md', 'hooks/register.tsx'].map((path) => may('describe', path)), [false, false]);
});

test('a refusal under the mod is the phase\'s own: the phase, what it may write, what opens next and how', () => {
  assert.deepEqual(guard({ record: record('spec') }), {
    allowed: false,
    reason: "mod-builder: hooks/register.tsx can't be written in phase 3 (Spec), which may write SPEC.md only. Phase 4 (Scaffold) opens when the person approves the spec: ask for it by calling the mod_builder_gate tool.",
  });
});

test('a path is judged against the session\'s folder when it is relative, and with ".." applied', () => {
  assert.equal(guard({ path: 'turn-counter/hooks/register.tsx' }).allowed, false);
  assert.equal(guard({ path: 'turn-counter/SPEC.md' }).allowed, true);
  assert.equal(guard({ path: 'turn-counter/tests/../hooks/register.tsx', record: record('red') }).allowed, false);
  assert.equal(guard({ path: 'elsewhere/../turn-counter/tests/a.test.ts', record: record('red') }).allowed, true);
});

test('a path outside the mod being built, in no plugin\'s folder, passes in every phase', () => {
  for (const phase of ['knowledge', 'spec', 'red', 'green', 'verify', 'done']) {
    assert.deepEqual(guard({ record: record(phase), path: '/work/notes.md', pluginFolders: [] }), { allowed: true }, phase);
    assert.deepEqual(guard({ record: record(phase), path: '/work/turn-counter/../other/tests/a.test.ts', pluginFolders: [] }), { allowed: true }, phase);
  }
});

test('under the mod, a record that is missing, damaged or another session\'s allows nothing, even what the phase would', () => {
  const refused = /^mod-builder: SPEC\.md can't be written: the build's record for \/work\/turn-counter is missing or is not this session's\. Call the mod_builder_gate tool/;
  const path = `${MOD}/SPEC.md`;
  for (const bad of [undefined, null, {}, 'spec', { ...record('spec'), phase: 'shipping' }, { ...record('spec'), sessionId: 's2' }, { ...record('spec'), modDir: '/work/other' }]) {
    const verdict = guard({ path, record: bad });
    assert.equal(verdict.allowed, false, JSON.stringify(bad) ?? String(bad));
    assert.match(verdict.reason, refused);
  }
  assert.deepEqual(guard({ path, record: record('spec') }), { allowed: true });
  assert.deepEqual(guard({ path: '/work/notes.md', record: undefined }), { allowed: true });
  assert.match(guard({ path: MOD, record: undefined }).reason, /^mod-builder: the mod folder can't be written/);
});

test('a session entry that cannot be read refuses the write: a build was opened, and what it allows is not known', () => {
  for (const entry of ['pending', {}, { modDir: 'turn-counter' }, [], 3]) {
    const verdict = guard({ entry, path: '/work/notes.md', pluginFolders: [] });
    assert.equal(verdict.allowed, false, JSON.stringify(entry));
    assert.match(verdict.reason, /this session's build record can't be read/);
  }
});

test('another session\'s call passes untouched: it has no entry of its own, whatever record the folder has', () => {
  assert.deepEqual(guard({ sessionId: 's2', entry: undefined, record: record('spec') }), { allowed: true });
});

// ------------------------------------------------------------------------------------ the headless load

const LOADED = [
  '2026-11-10T17:34:43.404Z [DEBUG] Loaded inline plugin from path: turn-counter',
  '2026-11-10T17:34:43.560Z [DEBUG] hooks module turn-counter@inline loaded (worker, environment 1, tier user); events: session.start,command.run,tool.call,ui.render',
  '2026-11-10T17:34:43.566Z [DEBUG] hooks module git-branch@claudemod loaded (worker, environment 3, tier user); events: session.start',
  '2026-11-10T17:34:43.599Z [DEBUG] plugin.register: turn-counter (user, turn-counter@inline), judged by core alone: admitted',
  '',
].join('\n');

const DID_NOT_LOAD = [
  '2026-11-10T17:49:03.353Z [DEBUG] Loaded inline plugin from path: turn-counter',
  '2026-11-10T17:49:03.452Z [ERROR] hooks module turn-counter@inline failed to load: turn-counter: /mods/turn-counter/hooks/register.ts does not parse: Expected ")" but found "}" (line 1, column 77)',
  '2026-11-10T17:49:03.452Z [ERROR] turn-counter: hooks module did not load: /mods/turn-counter/hooks/register.ts does not parse: Expected ")" but found "}" (line 1, column 77)',
  '2026-11-10T17:49:03.566Z [DEBUG] hooks module git-branch@claudemod loaded (worker, environment 3, tier user); events: session.start',
  '',
].join('\n');

test('a load is shown when the log holds the mod\'s "hooks module ... loaded" line, with or without the admitted line', () => {
  assert.equal(loadShown(LOADED, 'turn-counter'), true);
  assert.equal(loadShown(LOADED.split('\n').filter((line) => !line.includes('admitted')).join('\n'), 'turn-counter'), true);
  assert.equal(loadShown(LOADED.replace(/\n/g, '\r\n'), 'turn-counter'), true);
});

test('a load is not shown by a module that failed to load, though the plugin was read and other mods loaded', () => {
  assert.equal(loadShown(DID_NOT_LOAD, 'turn-counter'), false);
  assert.equal(loadShown(DID_NOT_LOAD, 'git-branch'), false);
});

test('a load is not shown by another mod\'s line, by a mod whose name only starts the same, or by a copy that is not the folder\'s own (@inline)', () => {
  assert.equal(loadShown(LOADED, 'turn'), false);
  assert.equal(loadShown(LOADED, 'counter'), false);
  assert.equal(loadShown(LOADED, 'git-branch'), false);
  assert.equal(loadShown(LOADED, 'turn-counter-2'), false);
  assert.equal(loadShown('[DEBUG] hooks module turn-counter-2@inline loaded (worker)\n', 'turn-counter'), false);
});

test('a line saying the mod failed, did not load or was not loaded outweighs a loaded line, wherever it stands', () => {
  const failed = DID_NOT_LOAD.split('\n').slice(1, 3);
  assert.equal(loadShown([LOADED, failed[0]].join('\n'), 'turn-counter'), false);
  assert.equal(loadShown([failed[1], LOADED].join('\n'), 'turn-counter'), false);
  assert.equal(loadShown(`${LOADED}[DEBUG] hooks module turn-counter@inline not loaded: the switch is off\n`, 'turn-counter'), false);
  assert.equal(loadShown(`${LOADED}turn-counter: not loaded: refused by policy\n`, 'turn-counter'), false);
  assert.equal(loadShown(`${LOADED}[ERROR] other-mod: hooks module did not load: x\n[DEBUG] hooks module other@inline not loaded: y\n`, 'turn-counter'), true);
});

test('another mod\'s failure does not hide this mod\'s load, though it names this mod\'s folder or a longer name that holds this one', () => {
  const others = [
    '[ERROR] hooks module other@inline failed to load: other: /mods/turn-counter/hooks/register.ts does not parse',
    '[ERROR] other: hooks module did not load: /mods/turn-counter/hooks/register.ts does not parse',
    '[ERROR] hooks module turn-counter-2@inline failed to load: turn-counter-2: x',
    '[ERROR] turn-counter-2: hooks module did not load: x',
    '[ERROR] my-turn-counter: hooks module did not load: x',
    '[DEBUG] hooks module my-turn-counter@inline not loaded: x',
    '[DEBUG] hooks module turn-counter-2@inline not loaded: x',
  ];
  for (const line of others) assert.equal(loadShown(`${LOADED}${line}\n`, 'turn-counter'), true, line);
  assert.equal(loadShown(`${DID_NOT_LOAD}[DEBUG] hooks module turn-counter-2@inline loaded (worker)\n`, 'turn-counter-2'), true);
});

test('a load is shown only by the module\'s own loaded line: not by the admitted line alone, a longer name, or a name read as a pattern', () => {
  assert.equal(loadShown('[DEBUG] plugin.register: turn-counter (user, turn-counter@inline), judged by core alone: admitted\n', 'turn-counter'), false);
  assert.equal(loadShown('[DEBUG] hooks module my-turn-counter@inline loaded (worker)\n', 'turn-counter'), false);
  assert.equal(loadShown('[DEBUG] hooks module turnXcounter@inline loaded (worker)\n', 'turn.counter'), false);
  assert.equal(loadShown('[DEBUG] hooks module a+b@inline loaded (worker)\n', 'a+b'), true);
  assert.equal(loadShown('[DEBUG] hooks module turn-counter@claudemod loaded (worker)\n', 'turn-counter'), false);
  assert.equal(loadShown('hooks module turn-counter@inline loaded (worker)\n', 'turn-counter'), true);
});

test('a failure is read with Windows line ends too, and from a single line that says not loaded', () => {
  assert.equal(loadShown(DID_NOT_LOAD.replace(/\n/g, '\r\n'), 'turn-counter'), false);
  assert.equal(loadShown(`${LOADED}[DEBUG] hooks module turn-counter@inline not loaded: the switch is off\n`.replace(/\n/g, '\r\n'), 'turn-counter'), false);
  assert.equal(loadShown('[DEBUG] hooks module turn-counter@inline not loaded: the switch is off\n', 'turn-counter'), false);
});

test('a log or a name that is none shows no load', () => {
  assert.equal(loadShown('', 'turn-counter'), false);
  for (const bad of [null, undefined, 3, {}]) {
    assert.equal(loadShown(bad, 'turn-counter'), false, String(bad));
    assert.equal(loadShown(LOADED, bad), false, String(bad));
  }
  assert.equal(loadShown(LOADED, ''), false);
});

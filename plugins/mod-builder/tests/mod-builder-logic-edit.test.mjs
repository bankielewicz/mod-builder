// Logic tests for SPEC.md 8 (change 0.2.0, an edit): the edit's phases and what each may write, the record's kind,
// the folder a gate may name, the baseline's verdict, Red's rule for an edit and for a repair, 8.4's question about
// test files that changed or are gone, and the version comparison. SPEC.md 8.10 holds the three answers these
// follow: a mod with no tests enters Red, a test file is one by its name wherever it sits, any x.y.z passes when
// the baseline had none.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as rules from '../hooks/mod-builder-logic.ts';

// Taken from the module as a whole, so that a rule not built yet fails the tests that use it and no others.
const {
  PHASES, EDIT_PHASES, KINDS, RED_MODES, GATE_TOOL, NOT_YET, GO_ON, QUOTED_LINES, COMPARED_CELLS,
  recordKind, isOpenRecord, isBuildRecord, phasesOf, phaseNumberOf, phaseLabelOf, nextPhaseOf, isTestPath, mayWrite, mayWriteIn,
  writeVerdict, writeVerdictIn, guardVerdict, editFolderVerdict, typecheckErrors, testsFit, baselineVerdict, failuresByFile,
  editRedGate, repairRedGate, testHashesOf, testFilesToAsk, testFilesChanged, namesGone, lineChanges, testChangeOptions,
  testChangeQuestion, testChangeGate, testChangeEvidence, versionGate, typecheckConfig, newRecord,
} = rules;

const lines = (...text) => `${text.join('\n')}\n`;
const run = (exitCode, output = '') => ({ exitCode, output });
const MOD = '/work/mod';
const CWD = '/home/u/.claude/mod-builder-data/v2/typecheck/s1';
const tc = (exitCode, output = '') => ({ run: run(exitCode, output), cwd: CWD });
const ERR_HOOKS = "../../../../../../../work/mod/hooks/register.tsx(28,7): error TS2322: Type 'string' is not assignable to type 'number'.";
const ERR_TESTS = "../../../../../../../work/mod/tests/broken.test.ts(2,25): error TS2307: Cannot find module './missing' or its corresponding type declarations.";
const ERR_STRAY = "../../../../../../../work/mod/lib/y.test.tsx(1,1): error TS2304: Cannot find name 'nothing'.";
const ERR_NO_FILE = "error TS18003: No inputs were found in config file '/x/tsconfig.json'.";
const TWO_PASS = lines('', 'tests/pane.test.tsx:', '(pass) one [1.00ms]', '(pass) two [1.00ms]', '', ' 2 pass', ' 0 fail', 'Ran 2 tests across 1 file. [0.21s]');
const NO_TESTS = lines('claude plugin test: no *.test.ts or *.test.tsx under /work/mod');
// As 2.1.322 printed it for three files: one that did not load, one with a failing and a passing test, one passing.
const THREE_FILES = lines('', 'tests/broken.test.ts:', '(fail) the file did not load', '  tests/broken.test.ts: cannot import "./missing"', '',
  'tests/more.test.ts:', '(fail) a new one fails [1.72ms]', '  AssertionError: expect(received).toBe()', '  ', '  Expected: 2', '  Received: 1',
  '(pass) a new one passes [0.24ms]', '', 'tests/pane.test.tsx:', '(pass) one [29.71ms]', '(pass) two [15.03ms]', '',
  ' 3 pass', ' 2 fail', 'Ran 5 tests across 3 files. [0.26s]');
const failing = (...blocks) => {
  const body = blocks.flatMap(([file, name, first]) => ['', `${file}:`, `(fail) ${name} [0.50ms]`, `  ${first}`]);
  return lines(...body, '', ' 0 pass', ` ${blocks.length} fail`, `Ran ${blocks.length} tests across ${blocks.length} files. [0.20s]`);
};
const ASSERTS = 'AssertionError: expect(received).toBe()';
const record = (phase, more = {}) => ({ ...newRecord(MOD, 's1'), phase, ...more });
const NOT_TEXT = [null, undefined, 0, 1, true, {}, []];

// ---------------------------------------------------------------------------------- phases and the record's kind

test('an edit has seven phases, a build its eight, and an edit has no Scaffold', () => {
  assert.deepEqual([...EDIT_PHASES], ['knowledge', 'describe', 'spec', 'red', 'green', 'verify', 'done']);
  assert.deepEqual([...KINDS], ['build', 'edit']);
  assert.deepEqual([...RED_MODES], ['edit', 'repair', 'skipped']);
  assert.deepEqual([...phasesOf('edit')], [...EDIT_PHASES]);
  assert.deepEqual([...phasesOf('build')], [...PHASES]);
  assert.deepEqual([...phasesOf('other')], []);
});

test('phases are numbered within their kind: Red is phase 4 of an edit and phase 5 of a build', () => {
  assert.equal(phaseNumberOf('edit', 'red'), 4);
  assert.equal(phaseNumberOf('build', 'red'), 5);
  assert.equal(phaseNumberOf('edit', 'done'), 7);
  assert.equal(phaseNumberOf('edit', 'scaffold'), 0);
  assert.equal(phaseLabelOf('edit', 'red'), 'phase 4 (Red)');
  assert.equal(phaseLabelOf('edit', 'green'), 'phase 5 (Green)');
  assert.equal(phaseLabelOf('build', 'green'), 'phase 6 (Green)');
});

test('an edit moves one phase at a time, from Spec to Red, and never back', () => {
  const order = ['knowledge', 'describe', 'spec', 'red', 'green', 'verify', 'done'];
  for (const red of [undefined, 'edit', 'repair']) {
    for (let i = 0; i < order.length - 1; i++) assert.equal(nextPhaseOf('edit', order[i], red), order[i + 1], `${order[i]} ${red}`);
    assert.equal(nextPhaseOf('edit', 'done', red), null);
  }
  assert.equal(nextPhaseOf('edit', 'scaffold'), null);
});

test('only a skipped Red skips, and only from Spec: the edit then goes from Spec to Green', () => {
  assert.equal(nextPhaseOf('edit', 'spec', 'skipped'), 'green');
  assert.equal(nextPhaseOf('edit', 'describe', 'skipped'), 'spec');
  assert.equal(nextPhaseOf('edit', 'red', 'skipped'), 'green');
  assert.equal(nextPhaseOf('edit', 'green', 'skipped'), 'verify');
  // A build has no skipped Red, whatever it is handed.
  assert.equal(nextPhaseOf('build', 'spec', 'skipped'), 'scaffold');
  assert.equal(nextPhaseOf('build', 'scaffold', 'skipped'), 'red');
  assert.equal(nextPhaseOf('build', 'done'), null);
});

test('a record without a kind is a build, as 0.1.0 stored it; one that names a kind that is none is no record', () => {
  assert.equal(recordKind(record('green')), 'build');
  assert.equal(recordKind(record('green', { kind: 'build' })), 'build');
  assert.equal(recordKind(record('green', { kind: 'edit' })), 'edit');
  for (const kind of ['repair', 'Edit', '', null, 0, 1, true, {}, []]) assert.equal(recordKind(record('green', { kind })), null, String(kind));
  for (const none of [null, undefined, 'edit', 3, []]) assert.equal(recordKind(none), null);
  assert.equal(isBuildRecord(record('scaffold')), true);
  assert.equal(isBuildRecord(record('red', { kind: 'edit' })), true);
  assert.equal(isBuildRecord(record('red', { kind: 'repair' })), false);
  assert.equal(isBuildRecord(record('red', { kind: null })), false);
});

test('an edit record at Scaffold is damaged: its kind has no such phase', () => {
  assert.equal(isBuildRecord(record('scaffold', { kind: 'edit' })), false);
  assert.equal(isBuildRecord(record('scaffold', { kind: 'build' })), true);
});

test('a record holds its folder until it is Done or stopped', () => {
  assert.equal(isOpenRecord(record('green')), true);
  assert.equal(isOpenRecord(record('green', { kind: 'edit' })), true);
  assert.equal(isOpenRecord(record('done')), false);
  assert.equal(isOpenRecord(record('green', { stopped: true })), false);
  assert.equal(isOpenRecord(record('green', { stopped: false })), true);
  assert.equal(isOpenRecord(record('green', { stopped: 'yes' })), true);
  for (const none of [null, undefined, {}, 'x', record('green', { kind: 'other' })]) assert.equal(isOpenRecord(none), false);
});

// -------------------------------------------------------------------------------------- what an edit may write

test('a test file is one under tests/, or one named *.test.ts or *.test.tsx wherever it sits', () => {
  for (const path of ['tests/pane.test.tsx', 'tests/helpers.ts', 'tests/deep/data.json', 'hooks/x.test.ts', 'lib/y.test.tsx', 'a.test.ts', 'hooks/deep/z.test.ts', 'hooks/.test.ts', '.test.tsx', 'tests/node_modules/n.test.ts']) {
    assert.equal(isTestPath(path), true, path);
  }
  for (const path of ['hooks/register.tsx', 'SPEC.md', 'hooks/test.ts', 'hooks/x.test.js', 'hooks/x.spec.ts', 'x.test.ts.bak', 'Tests/a.ts', 'hooks/x.TEST.ts', 'lib/tests/helpers.ts', 'hooks/tests/a.ts',
    'node_modules/dep/d.test.ts', 'lib/node_modules/d.test.tsx', 'hooks/xtest.ts', '']) {
    assert.equal(isTestPath(path), false, path);
  }
  for (const none of NOT_TEXT) assert.equal(isTestPath(none), false);
});

test('Red of an edit writes test files and nothing else: no hooks/, no types/, no manifest, no SPEC.md', () => {
  for (const path of ['tests/pane.test.tsx', 'tests/helpers.ts', 'hooks/x.test.ts', 'lib/y.test.tsx', 'a.test.ts']) assert.equal(mayWriteIn('edit', 'red', path), true, path);
  for (const path of ['hooks/register.tsx', 'hooks/hooks.json', 'types/index.d.ts', '.claude-plugin/plugin.json', 'SPEC.md', 'README.md', 'hooks/x.TEST.ts', 'Tests/a.test.js', '']) {
    assert.equal(mayWriteIn('edit', 'red', path), false, path);
  }
});

test('Green of an edit writes code and never a test file, wherever it sits and however its name is cased', () => {
  for (const path of ['hooks/register.tsx', 'hooks/hooks.json', 'types/index.d.ts', '.claude-plugin/plugin.json', 'README.md', 'lib/util.ts']) {
    assert.equal(mayWriteIn('edit', 'green', path), true, path);
  }
  for (const path of ['tests/pane.test.tsx', 'tests/helpers.ts', 'hooks/x.test.ts', 'lib/y.test.tsx', 'a.test.ts', 'hooks/X.TEST.TS', 'lib/y.Test.Tsx', 'TESTS/a.ts', 'SPEC.md', 'spec.md']) {
    assert.equal(mayWriteIn('edit', 'green', path), false, path);
  }
  // In a build such a file follows its folder, as before.
  assert.equal(mayWriteIn('build', 'green', 'hooks/x.test.ts'), true);
});

test('no phase of an edit writes test files and code together', () => {
  const tests = ['tests/a.test.ts', 'hooks/x.test.ts', 'lib/y.test.tsx'];
  const code = ['hooks/register.tsx', 'types/index.d.ts', '.claude-plugin/plugin.json', 'lib/util.ts'];
  for (const phase of EDIT_PHASES) {
    const writesTests = tests.some((path) => mayWriteIn('edit', phase, path));
    const writesCode = code.some((path) => mayWriteIn('edit', phase, path));
    assert.equal(writesTests && writesCode, false, phase);
  }
  assert.equal(tests.every((path) => mayWriteIn('edit', 'red', path)), true);
  assert.equal(code.every((path) => mayWriteIn('edit', 'green', path)), true);
});

test('the other phases of an edit are a build\'s: nothing before Spec, SPEC.md at Spec, no tests or hooks/ from Verify on', () => {
  for (const phase of ['knowledge', 'describe']) {
    for (const path of ['SPEC.md', 'tests/a.test.ts', 'hooks/register.tsx', 'README.md']) assert.equal(mayWriteIn('edit', phase, path), false, `${phase} ${path}`);
  }
  assert.equal(mayWriteIn('edit', 'spec', 'SPEC.md'), true);
  for (const path of ['spec.md', 'tests/a.test.ts', 'hooks/register.tsx', 'docs/SPEC.md', 'a.test.ts']) assert.equal(mayWriteIn('edit', 'spec', path), false, path);
  for (const phase of ['verify', 'done']) {
    for (const path of ['SPEC.md', 'README.md', '.claude-plugin/plugin.json', 'types/index.d.ts']) assert.equal(mayWriteIn('edit', phase, path), true, `${phase} ${path}`);
    for (const path of ['tests/a.test.ts', 'hooks/register.tsx', 'lib/y.test.tsx', 'lib/Y.TEST.TSX', 'HOOKS/a.ts']) assert.equal(mayWriteIn('edit', phase, path), false, `${phase} ${path}`);
  }
});

test('an edit writes nothing at Scaffold, a phase it does not have, and nothing for a kind or a path that is none', () => {
  for (const path of ['SPEC.md', 'tests/a.test.ts', 'hooks/register.tsx']) assert.equal(mayWriteIn('edit', 'scaffold', path), false, path);
  assert.equal(mayWriteIn('other', 'green', 'hooks/register.tsx'), false);
  assert.equal(mayWriteIn(undefined, 'red', 'tests/a.test.ts'), false);
  for (const none of NOT_TEXT) assert.equal(mayWriteIn('edit', 'red', none), false);
  assert.equal(mayWriteIn('edit', 'nowhere', 'tests/a.test.ts'), false);
});

test('for a build, mayWriteIn and writeVerdictIn answer as mayWrite and writeVerdict do', () => {
  for (const phase of PHASES) {
    for (const path of ['SPEC.md', 'tests/a.test.ts', 'hooks/register.tsx', 'hooks/x.test.ts', 'README.md', '']) {
      assert.equal(mayWriteIn('build', phase, path), mayWrite(phase, path), `${phase} ${path}`);
      assert.deepEqual(writeVerdictIn('build', phase, path, 'skipped'), writeVerdict(phase, path), `${phase} ${path}`);
    }
  }
});

test('a write refused in an edit says the edit\'s phase, what it may write, and what opens next and when', () => {
  assert.deepEqual(writeVerdictIn('edit', 'red', 'hooks/register.tsx', 'edit'), {
    allowed: false,
    reason: `mod-builder: hooks/register.tsx can't be written in phase 4 (Red) of this edit, which may write test files only (tests/, and any *.test.ts or *.test.tsx). Phase 5 (Green) opens when a new or changed test fails by assertion, the mod typechecks, and the person has agreed to every earlier test file that changed or is gone: ask for it by calling the ${GATE_TOOL} tool.`,
  });
  assert.deepEqual(writeVerdictIn('edit', 'red', 'hooks/register.tsx', 'repair'), {
    allowed: false,
    reason: `mod-builder: hooks/register.tsx can't be written in phase 4 (Red) of this edit, which may write test files only (tests/, and any *.test.ts or *.test.tsx). Phase 5 (Green) opens when a test file exists, the test files typecheck, and the person has agreed to every earlier test file that changed or is gone: ask for it by calling the ${GATE_TOOL} tool.`,
  });
  assert.deepEqual(writeVerdictIn('edit', 'green', 'hooks/x.test.ts'), {
    allowed: false,
    reason: `mod-builder: hooks/x.test.ts can't be written in phase 5 (Green) of this edit, which may write anything but test files and SPEC.md. Phase 6 (Verify) opens when validate, the tests, the typecheck and the headless load pass, and the version in plugin.json is greater than before the edit: ask for it by calling the ${GATE_TOOL} tool.`,
  });
  assert.deepEqual(writeVerdictIn('edit', 'done', 'hooks/register.tsx'), {
    allowed: false,
    reason: "mod-builder: hooks/register.tsx can't be written in phase 7 (Done) of this edit, which may write anything but test files and hooks/.",
  });
  assert.deepEqual(writeVerdictIn('edit', 'red', 'tests/a.test.ts'), { allowed: true });
});

test('a write refused at Spec names the phase that follows: Red, or Green when Red is skipped', () => {
  const opens = (red) => writeVerdictIn('edit', 'spec', 'hooks/register.tsx', red).reason;
  assert.equal(opens('edit'), `mod-builder: hooks/register.tsx can't be written in phase 3 (Spec) of this edit, which may write SPEC.md only, by adding to its end. Phase 4 (Red) opens when the person approves the change: ask for it by calling the ${GATE_TOOL} tool.`);
  assert.match(opens('repair'), /Phase 4 \(Red\) opens when the person approves the change/);
  assert.match(opens('skipped'), /Phase 5 \(Green\) opens when the person approves the change/);
  assert.deepEqual(writeVerdictIn('edit', 'scaffold', 'SPEC.md'), { allowed: false, reason: "mod-builder: SPEC.md can't be written: the edit's record names no phase." });
  assert.deepEqual(writeVerdictIn('edit', 'red', ''), {
    allowed: false,
    reason: `mod-builder: the mod folder can't be written in phase 4 (Red) of this edit, which may write test files only (tests/, and any *.test.ts or *.test.tsx). Phase 5 (Green) opens when a new or changed test fails by assertion, the mod typechecks, and the person has agreed to every earlier test file that changed or is gone: ask for it by calling the ${GATE_TOOL} tool.`,
  });
});

const guard = (kept, path, more = {}) => guardVerdict({ tool: 'Write', path, cwd: '/work', sessionId: 's1', entry: { modDir: MOD }, record: kept, pluginFolders: [MOD], ...more });

test('the guard judges a write by the record\'s kind: an edit at Red opens a test file under hooks/ and closes the code', () => {
  const editing = record('red', { kind: 'edit', red: 'edit' });
  assert.deepEqual(guard(editing, `${MOD}/hooks/x.test.ts`), { allowed: true });
  assert.deepEqual(guard(editing, `${MOD}/tests/a.test.ts`), { allowed: true });
  assert.deepEqual(guard(editing, `${MOD}/hooks/register.tsx`), writeVerdictIn('edit', 'red', 'hooks/register.tsx', 'edit'));
  assert.match(guard(editing, `${MOD}/hooks/register.tsx`).reason, /phase 4 \(Red\) of this edit/);
  const repairing = record('red', { kind: 'edit', red: 'repair' });
  assert.deepEqual(guard(repairing, `${MOD}/hooks/register.tsx`), writeVerdictIn('edit', 'red', 'hooks/register.tsx', 'repair'));
  // The same record without its kind is a build at Red, where hooks/x.test.ts is not under tests/.
  assert.deepEqual(guard(record('red'), `${MOD}/hooks/x.test.ts`), writeVerdict('red', 'hooks/x.test.ts'));
});

test('the guard closes every test file at an edit\'s Green, and a damaged kind allows nothing', () => {
  const editing = record('green', { kind: 'edit', red: 'skipped' });
  assert.deepEqual(guard(editing, `${MOD}/hooks/register.tsx`), { allowed: true });
  assert.equal(guard(editing, `${MOD}/hooks/x.test.ts`).allowed, false);
  assert.equal(guard(editing, `${MOD}/tests/a.test.ts`).allowed, false);
  assert.equal(guard(record('green'), `${MOD}/hooks/x.test.ts`).allowed, true);
  const damaged = guard(record('green', { kind: 'other' }), `${MOD}/hooks/register.tsx`);
  assert.equal(damaged.allowed, false);
  assert.match(damaged.reason, /is missing or is not this session's/);
});

test('another plugin\'s folder opens again once this session\'s record is stopped, as when it is Done', () => {
  const other = { pluginFolders: ['/work/other'] };
  assert.equal(guard(record('green', { kind: 'edit' }), '/work/other/hooks/a.ts', other).allowed, false);
  assert.deepEqual(guard(record('green', { kind: 'edit', stopped: true }), '/work/other/hooks/a.ts', other), { allowed: true });
  assert.deepEqual(guard(record('done', { kind: 'edit' }), '/work/other/hooks/a.ts', other), { allowed: true });
  assert.deepEqual(guard(record('red', { stopped: true }), '/work/other/hooks/a.ts', other), { allowed: true });
});

test('a stopped record no longer binds its own folder either: the guard judges nothing under it by the old phase', () => {
  for (const path of ['hooks/register.tsx', 'tests/a.test.ts', 'SPEC.md', '.claude-plugin/plugin.json']) {
    assert.deepEqual(guard(record('red', { kind: 'edit', red: 'edit', stopped: true }), `${MOD}/${path}`), { allowed: true }, path);
    assert.deepEqual(guard(record('knowledge', { stopped: true }), `${MOD}/${path}`), { allowed: true }, path);
  }
  // Done is not stopped: it keeps Verify's rule, and a mark that is not `true` stops nothing.
  assert.equal(guard(record('done', { kind: 'edit' }), `${MOD}/hooks/register.tsx`).allowed, false);
  assert.equal(guard(record('red', { kind: 'edit', stopped: 'yes' }), `${MOD}/hooks/register.tsx`).allowed, false);
  // Another session's stopped record is not this session's: nothing under the folder is allowed by it.
  assert.equal(guard({ ...record('red', { stopped: true }), sessionId: 's2' }, `${MOD}/hooks/register.tsx`).allowed, false);
});

// ------------------------------------------------------------------------------------ the folder a gate may name

const folder = (more = {}) => ({ modDir: MOD, pluginRoot: '/opt/mod-builder', hasManifest: true, hooksJson: '{ "modules": ["./register.tsx"] }', kept: undefined, sessionId: 's1', ...more });

test('a folder that is a mod, not this plugin, and held by no other session may be named', () => {
  assert.deepEqual(editFolderVerdict(folder()), { pass: true });
  assert.deepEqual(editFolderVerdict(folder({ hooksJson: '{"modules":[]}' })), { pass: true });
  assert.deepEqual(editFolderVerdict(folder({ kept: null })), { pass: true });
});

test('a folder that is no mod is refused, saying which part is missing', () => {
  assert.deepEqual(editFolderVerdict(folder({ hasManifest: false })), { pass: false, reason: '/work/mod holds no .claude-plugin/plugin.json: it is not a plugin' });
  assert.deepEqual(editFolderVerdict(folder({ hasManifest: 'yes' })), { pass: false, reason: '/work/mod holds no .claude-plugin/plugin.json: it is not a plugin' });
  assert.deepEqual(editFolderVerdict(folder({ hooksJson: null })), { pass: false, reason: '/work/mod holds no hooks/hooks.json: it is not a mod' });
  assert.deepEqual(editFolderVerdict(folder({ hooksJson: '{ "hooks": {} }' })), { pass: false, reason: '/work/mod/hooks/hooks.json has no "modules" key: it is not a mod' });
  for (const text of ['[]', '"modules"', 'null', '3', '["modules"]']) {
    assert.deepEqual(editFolderVerdict(folder({ hooksJson: text })), { pass: false, reason: '/work/mod/hooks/hooks.json has no "modules" key: it is not a mod' }, text);
  }
  assert.deepEqual(editFolderVerdict(folder({ hooksJson: '{ modules' })), { pass: false, reason: "/work/mod/hooks/hooks.json can't be read as JSON: it is not a mod" });
  // The manifest is asked for before the hooks file.
  assert.match(editFolderVerdict(folder({ hasManifest: false, hooksJson: null })).reason, /plugin\.json/);
});

test('this plugin\'s own folder, and any folder inside it, can\'t be named, even when it is a mod', () => {
  assert.deepEqual(editFolderVerdict(folder({ modDir: '/opt/mod-builder' })), { pass: false, reason: "/opt/mod-builder is this plugin's own folder: mod-builder does not edit itself" });
  assert.deepEqual(editFolderVerdict(folder({ modDir: '/opt/mod-builder/skills/build/templates/pane' })), {
    pass: false, reason: "/opt/mod-builder/skills/build/templates/pane is inside this plugin's own folder: mod-builder does not edit itself",
  });
  assert.deepEqual(editFolderVerdict(folder({ modDir: '/opt/mod-builder-two' })), { pass: true });
  assert.deepEqual(editFolderVerdict(folder({ modDir: '/opt' })), { pass: true });
});

test('a folder another session\'s unfinished build or edit holds is refused, with its kind and phase', () => {
  const theirs = (phase, more = {}) => ({ ...newRecord(MOD, 's2'), phase, ...more });
  assert.deepEqual(editFolderVerdict(folder({ kept: theirs('green') })), { pass: false, reason: '/work/mod is being built by another session (it is at phase 6 (Green)). Name another folder.' });
  assert.deepEqual(editFolderVerdict(folder({ kept: theirs('green', { kind: 'edit' }) })), { pass: false, reason: '/work/mod is being edited by another session (it is at phase 5 (Green)). Name another folder.' });
  // Done, stopped, this session's own, or no record: nothing holds it.
  assert.deepEqual(editFolderVerdict(folder({ kept: theirs('done') })), { pass: true });
  assert.deepEqual(editFolderVerdict(folder({ kept: theirs('green', { kind: 'edit', stopped: true }) })), { pass: true });
  assert.deepEqual(editFolderVerdict(folder({ kept: record('green') })), { pass: true });
  assert.deepEqual(editFolderVerdict(folder({ kept: { damaged: true } })), { pass: true });
});

test('a folder, a plugin root or a session that can\'t be read refuses', () => {
  for (const modDir of ['mod', '', null, undefined, 3]) {
    assert.deepEqual(editFolderVerdict(folder({ modDir })), { pass: false, reason: 'the folder to edit is not named by a path from the root' }, String(modDir));
  }
  assert.deepEqual(editFolderVerdict(null), { pass: false, reason: 'the folder to edit is not named by a path from the root' });
  for (const pluginRoot of ['plugin', '', null, undefined]) {
    assert.deepEqual(editFolderVerdict(folder({ pluginRoot })), { pass: false, reason: "/work/mod can't be judged: this plugin's own folder is not known" }, String(pluginRoot));
  }
  for (const sessionId of ['', null, undefined, 3]) {
    assert.deepEqual(editFolderVerdict(folder({ sessionId })), { pass: false, reason: "/work/mod can't be judged: this session's id is not known" }, String(sessionId));
  }
});

// ------------------------------------------------------------------------------- the typecheck's error lines

test('the typecheck\'s error lines are placed by their paths from the compiler\'s folder, not the mod\'s', () => {
  assert.deepEqual(typecheckErrors(lines(ERR_HOOKS, ERR_TESTS), CWD, MOD), { tests: ['tests/broken.test.ts'], others: 1, unplaced: 0 });
  assert.deepEqual(typecheckErrors(lines('npm notice run npx', ERR_HOOKS, ERR_HOOKS), CWD, MOD), { tests: [], others: 2, unplaced: 0 });
  assert.deepEqual(typecheckErrors(lines(ERR_STRAY, ERR_TESTS, ERR_TESTS), CWD, MOD), { tests: ['lib/y.test.tsx', 'tests/broken.test.ts'], others: 0, unplaced: 0 });
  assert.deepEqual(typecheckErrors(lines(ERR_NO_FILE), CWD, MOD), { tests: [], others: 0, unplaced: 1 });
  // An absolute path is read as it stands, and a path with CRLF line ends as well.
  assert.deepEqual(typecheckErrors('/work/mod/tests/a.test.ts(1,1): error TS1005: x\r\n/work/mod/hooks/a.ts(1,1): error TS1005: x\r\n', CWD, MOD), { tests: ['tests/a.test.ts'], others: 1, unplaced: 0 });
});

test('an error in a test file of another folder is not this mod\'s test file, and text that is no error line is not counted', () => {
  assert.deepEqual(typecheckErrors('/work/other/tests/a.test.ts(1,1): error TS1005: x\n', CWD, MOD), { tests: [], others: 1, unplaced: 0 });
  assert.deepEqual(typecheckErrors('../tests/a.test.ts(1,1): error TS1005: x\n', '/work/mod/hooks', MOD), { tests: ['tests/a.test.ts'], others: 0, unplaced: 0 });
  assert.deepEqual(typecheckErrors(lines('Version 5.9.3', '  tests/a.test.ts: something', 'tests/a.test.ts(1,1): warning TS1: x', ''), CWD, MOD), { tests: [], others: 0, unplaced: 0 });
  for (const none of NOT_TEXT) assert.deepEqual(typecheckErrors(none, CWD, MOD), { tests: [], others: 0, unplaced: 0 });
});

test('the test files fit when no error line names one: an error in hooks/ alone leaves them fitting', () => {
  assert.deepEqual(testsFit([tc(0)], MOD), { pass: true });
  assert.deepEqual(testsFit([tc(1, lines(ERR_HOOKS))], MOD), { pass: true });
  assert.deepEqual(testsFit([tc(0), tc(2, lines(ERR_HOOKS, ERR_HOOKS))], MOD), { pass: true });
});

test('the test files do not fit when any typecheck names one, against any types file', () => {
  assert.deepEqual(testsFit([tc(1, lines(ERR_HOOKS, ERR_TESTS))], MOD), { pass: false, reason: 'the test files do not typecheck: tests/broken.test.ts' });
  assert.deepEqual(testsFit([tc(0), tc(1, lines(ERR_TESTS))], MOD), { pass: false, reason: 'the test files do not typecheck: tests/broken.test.ts' });
  assert.deepEqual(testsFit([tc(1, lines(ERR_TESTS)), tc(1, lines(ERR_STRAY, ERR_TESTS))], MOD), { pass: false, reason: 'the test files do not typecheck: lib/y.test.tsx, tests/broken.test.ts' });
});

test('a typecheck that failed and can\'t be read is not read as fitting', () => {
  assert.deepEqual(testsFit([tc(1, lines(ERR_HOOKS, ERR_NO_FILE))], MOD), { pass: false, reason: 'the typecheck exited 1 with an error that names no file' });
  assert.deepEqual(testsFit([tc(127, 'sh: 1: tsc: Permission denied\n')], MOD), { pass: false, reason: 'the typecheck exited 127 and shows no error line to read' });
  assert.deepEqual(testsFit([tc(1)], MOD), { pass: false, reason: 'the typecheck exited 1 and shows no error line to read' });
  assert.deepEqual(testsFit([tc(0), tc(Number.NaN, lines(ERR_HOOKS))], MOD), { pass: false, reason: 'the typecheck ended with no exit code' });
  assert.deepEqual(testsFit([null], MOD), { pass: false, reason: 'the typecheck ended with no exit code' });
  for (const none of [[], null, undefined, 'x']) assert.deepEqual(testsFit(none, MOD), { pass: false, reason: 'no typecheck was run' });
});

// --------------------------------------------------------------------------------------------- the baseline

const FILES = ['.claude-plugin/plugin.json', 'hooks/hooks.json', 'hooks/register.tsx', 'tests/pane.test.tsx'];
const runs = (more = {}) => ({ validate: run(0), test: run(0, TWO_PASS), typechecks: [tc(0), tc(0)], load: run(0), loadShown: true, ...more });

test('a mod that passes all four checks is edited: nothing failed, and Red ends as in an edit', () => {
  assert.deepEqual(baselineVerdict(runs(), MOD, FILES), { taken: true, failed: [], tests: 2, hasTests: true, red: 'edit' });
});

test('a mod whose code fails while its test files fit is repaired with Red skipped', () => {
  assert.deepEqual(baselineVerdict(runs({ typechecks: [tc(0), tc(1, lines(ERR_HOOKS))] }), MOD, FILES), { taken: true, failed: ['typecheck'], tests: 2, hasTests: true, red: 'skipped' });
  assert.deepEqual(baselineVerdict(runs({ load: run(1) }), MOD, FILES), { taken: true, failed: ['load'], tests: 2, hasTests: true, red: 'skipped' });
  assert.deepEqual(baselineVerdict(runs({ loadShown: false }), MOD, FILES), { taken: true, failed: ['load'], tests: 2, hasTests: true, red: 'skipped' });
  assert.deepEqual(baselineVerdict(runs({ validate: run(1) }), MOD, FILES), { taken: true, failed: ['validate'], tests: 2, hasTests: true, red: 'skipped' });
  assert.deepEqual(baselineVerdict(runs({ test: run(1, THREE_FILES) }), MOD, FILES), { taken: true, failed: ['test'], tests: 5, hasTests: true, red: 'skipped' });
});

test('a mod whose test files no longer typecheck is repaired with Red entered', () => {
  assert.deepEqual(baselineVerdict(runs({ typechecks: [tc(1, lines(ERR_HOOKS, ERR_TESTS))] }), MOD, FILES), { taken: true, failed: ['typecheck'], tests: 2, hasTests: true, red: 'repair' });
  assert.deepEqual(baselineVerdict(runs({ typechecks: [tc(0), tc(1, lines(ERR_TESTS))] }), MOD, FILES), { taken: true, failed: ['typecheck'], tests: 2, hasTests: true, red: 'repair' });
  // A typecheck that failed and can't be read does not skip Red.
  assert.deepEqual(baselineVerdict(runs({ typechecks: [tc(127, 'tsc: Permission denied\n')] }), MOD, FILES).red, 'repair');
});

test('every failing check is listed, in the order the checks run', () => {
  const all = runs({ validate: run(1), test: run(1, 'no count\n'), typechecks: [tc(1, lines(ERR_HOOKS))], load: run(0), loadShown: false });
  assert.deepEqual(baselineVerdict(all, MOD, FILES), { taken: true, failed: ['validate', 'test', 'typecheck', 'load'], tests: null, hasTests: true, red: 'skipped' });
  assert.deepEqual(baselineVerdict(runs({ test: run(0, 'no count\n') }), MOD, FILES), { taken: true, failed: ['test'], tests: null, hasTests: true, red: 'skipped' });
});

const NO_TEST_FILES = ['.claude-plugin/plugin.json', 'hooks/hooks.json', 'hooks/register.tsx', 'tests/helpers.ts'];

test('a mod with no test file never skips Red: edited when nothing else fails, repaired with Red entered when something does', () => {
  assert.deepEqual(baselineVerdict(runs({ test: run(1, NO_TESTS) }), MOD, NO_TEST_FILES), { taken: true, failed: ['test'], tests: null, hasTests: false, red: 'edit' });
  assert.deepEqual(baselineVerdict(runs({ test: run(1, NO_TESTS), typechecks: [tc(1, lines(ERR_HOOKS))] }), MOD, NO_TEST_FILES), {
    taken: true, failed: ['test', 'typecheck'], tests: null, hasTests: false, red: 'repair',
  });
  assert.deepEqual(baselineVerdict(runs({ test: run(1, NO_TESTS), validate: run(1) }), MOD, []).red, 'repair');
  assert.deepEqual(baselineVerdict(runs({ test: run(1, NO_TESTS) }), MOD, null).red, 'edit');
});

test('a test file outside tests/ is a test file of the baseline, and a failing test run with one is a repair', () => {
  const stray = ['.claude-plugin/plugin.json', 'hooks/register.tsx', 'hooks/x.test.ts'];
  assert.deepEqual(baselineVerdict(runs(), MOD, stray), { taken: true, failed: [], tests: 2, hasTests: true, red: 'edit' });
  assert.deepEqual(baselineVerdict(runs({ test: run(1, THREE_FILES) }), MOD, stray).red, 'skipped');
  assert.deepEqual(baselineVerdict(runs({ typechecks: [tc(1, lines(ERR_STRAY))] }), MOD, ['lib/y.test.tsx']).red, 'repair');
});

test('a baseline whose check ended with no exit code is not taken: that is no evidence the mod passes or fails', () => {
  const none = run(Number.NaN);
  assert.deepEqual(baselineVerdict(runs({ validate: none }), MOD, FILES), { taken: false, reason: 'the baseline could not be taken: claude plugin validate --strict ended with no exit code' });
  assert.deepEqual(baselineVerdict(runs({ test: null }), MOD, FILES), { taken: false, reason: 'the baseline could not be taken: claude plugin test ended with no exit code' });
  assert.deepEqual(baselineVerdict(runs({ typechecks: [tc(0), { run: none, cwd: CWD }] }), MOD, FILES), { taken: false, reason: 'the baseline could not be taken: the typecheck ended with no exit code' });
  assert.deepEqual(baselineVerdict(runs({ load: { exitCode: 0 } }), MOD, FILES), { taken: false, reason: 'the baseline could not be taken: the headless load ended with no exit code' });
  assert.deepEqual(baselineVerdict(runs({ typechecks: [] }), MOD, FILES), { taken: false, reason: 'the baseline could not be taken: no typecheck was run' });
  assert.deepEqual(baselineVerdict(runs({ typechecks: undefined }), MOD, FILES), { taken: false, reason: 'the baseline could not be taken: no typecheck was run' });
  assert.deepEqual(baselineVerdict(null, MOD, FILES), { taken: false, reason: 'the baseline could not be taken: claude plugin validate --strict ended with no exit code' });
});

// --------------------------------------------------------------------------------------------- an edit's Red

test('each failing block is tied to the test file whose path line precedes it', () => {
  assert.deepEqual(failuresByFile(THREE_FILES).map((failure) => [failure.file, failure.name]), [
    ['tests/broken.test.ts', 'the file did not load'], ['tests/more.test.ts', 'a new one fails'],
  ]);
  assert.equal(failuresByFile(THREE_FILES)[1].body.split('\n')[0], '  AssertionError: expect(received).toBe()');
  assert.deepEqual(failuresByFile(failing(['hooks/x.test.ts', 'a', ASSERTS], ['lib/y.test.tsx', 'b', ASSERTS])).map((failure) => failure.file), ['hooks/x.test.ts', 'lib/y.test.tsx']);
  assert.deepEqual(failuresByFile(lines('(fail) orphan [1ms]', `  ${ASSERTS}`, '', 'Ran 1 test across 1 file. [0.1s]')), [{ file: null, name: 'orphan', body: `  ${ASSERTS}` }]);
  assert.deepEqual(failuresByFile('no count\n'), []);
  for (const none of NOT_TEXT) assert.deepEqual(failuresByFile(none), []);
});

test('Red of an edit passes when a test new by name fails by assertion, with no more tests than before', () => {
  assert.deepEqual(editRedGate(run(1, failing(['tests/pane.test.tsx', 'cuts by width', ASSERTS])), ['one', 'two'], []), { pass: true, tests: 1 });
  assert.deepEqual(editRedGate(run(1, failing(['tests/new.test.ts', 'cuts by width', ASSERTS])), [], ['tests/new.test.ts']), { pass: true, tests: 1 });
});

test('Red of an edit passes when an old test fails in a test file that changed, and refuses it in one that is as it was', () => {
  const out = failing(['tests/pane.test.tsx', 'one', ASSERTS]);
  assert.deepEqual(editRedGate(run(1, out), ['one', 'two'], ['tests/pane.test.tsx']), { pass: true, tests: 1 });
  assert.deepEqual(editRedGate(run(1, out), ['one', 'two'], ['tests/other.test.ts']), {
    pass: false, reason: 'no new or changed test fails: every failing test had its name at the baseline, in a test file that is as it was (one)',
  });
  assert.deepEqual(editRedGate(run(1, out), ['one', 'two'], []), {
    pass: false, reason: 'no new or changed test fails: every failing test had its name at the baseline, in a test file that is as it was (one)',
  });
});

test('Red of an edit refuses any failure that does not open with an assertion error, a file that did not load included', () => {
  assert.deepEqual(editRedGate(run(1, THREE_FILES), ['one', 'two'], ['tests/more.test.ts', 'tests/broken.test.ts']), { pass: false, reason: 'not failing by assertion: the file did not load' });
  const mixed = failing(['tests/a.test.ts', 'new one', ASSERTS], ['tests/a.test.ts', 'new two', 'TypeError: x is not a function']);
  assert.deepEqual(editRedGate(run(1, mixed), [], ['tests/a.test.ts']), { pass: false, reason: 'not failing by assertion: new two' });
});

test('Red of an edit refuses a run that passes, shows no count, or shows no failing block', () => {
  assert.deepEqual(editRedGate(run(0, TWO_PASS), ['one'], []), { pass: false, reason: 'claude plugin test exited 0: no test fails yet' });
  assert.deepEqual(editRedGate(run(1, NO_TESTS), [], []), { pass: false, reason: "the test run's last line reports no test count" });
  assert.deepEqual(editRedGate(run(1, TWO_PASS), [], []), { pass: false, reason: 'claude plugin test failed, but its output holds no (fail) block' });
  assert.deepEqual(editRedGate(run(Number.NaN, TWO_PASS), [], []), { pass: false, reason: 'claude plugin test ended with no exit code' });
});

test('Red of an edit refuses when the baseline\'s names or the changed files are no record', () => {
  const out = failing(['tests/a.test.ts', 'new', ASSERTS]);
  for (const none of [null, undefined, 'one', [1], {}]) {
    assert.deepEqual(editRedGate(run(1, out), none, []), { pass: false, reason: 'no test names are recorded from the baseline' }, String(none));
    assert.deepEqual(editRedGate(run(1, out), [], none), { pass: false, reason: 'the test files could not be compared with the baseline' }, String(none));
  }
});

test('Red of a repair ends when a test file exists and the test files typecheck, whatever hooks/ shows', () => {
  assert.deepEqual(repairRedGate([tc(0)], MOD, FILES), { pass: true });
  assert.deepEqual(repairRedGate([tc(1, lines(ERR_HOOKS)), tc(1, lines(ERR_HOOKS))], MOD, FILES), { pass: true });
  assert.deepEqual(repairRedGate([tc(1, lines(ERR_HOOKS))], MOD, ['hooks/x.test.ts']), { pass: true });
  assert.deepEqual(repairRedGate([tc(1, lines(ERR_HOOKS, ERR_TESTS))], MOD, FILES), { pass: false, reason: 'the test files do not typecheck: tests/broken.test.ts' });
  assert.deepEqual(repairRedGate([tc(1, lines(ERR_NO_FILE))], MOD, FILES), { pass: false, reason: 'the typecheck exited 1 with an error that names no file' });
});

test('Red of a repair refuses a mod that still has no test file, though everything typechecks', () => {
  const none = { pass: false, reason: 'the mod has no test file yet (a *.test.ts or *.test.tsx)' };
  assert.deepEqual(repairRedGate([tc(0)], MOD, NO_TEST_FILES), none);
  assert.deepEqual(repairRedGate([tc(0)], MOD, []), none);
  assert.deepEqual(repairRedGate([tc(0)], MOD, null), none);
  assert.deepEqual(repairRedGate([tc(0)], MOD, ['hooks/x.TEST.ts', 'tests/a.test.js']), none);
});

// ------------------------------------------------------------------------- 8.4: test files changed or gone

const BASE = { 'hooks/register.tsx': 'h1', 'hooks/x.test.ts': 'x1', 'tests/a.test.ts': 'a1', 'tests/helpers.ts': 'p1', 'SPEC.md': 's1' };

test('the person is asked about every baseline test file that changed or is gone, and about none that is new', () => {
  assert.deepEqual(testFilesToAsk(BASE, BASE), []);
  assert.deepEqual(testFilesToAsk(BASE, { ...BASE, 'tests/new.test.ts': 'n1', 'lib/z.test.tsx': 'z1' }), []);
  assert.deepEqual(testFilesToAsk(BASE, { ...BASE, 'tests/a.test.ts': 'a2' }), [{ path: 'tests/a.test.ts', how: 'changed' }]);
  const { 'tests/helpers.ts': gone, ...rest } = BASE;
  assert.deepEqual(testFilesToAsk(BASE, { ...rest, 'hooks/x.test.ts': 'x2', 'tests/new.test.ts': 'n1' }), [
    { path: 'hooks/x.test.ts', how: 'changed' }, { path: 'tests/helpers.ts', how: 'missing' },
  ]);
});

test('a file that is no test file raises no question, whatever became of it', () => {
  const { 'hooks/register.tsx': gone, ...rest } = BASE;
  assert.deepEqual(testFilesToAsk(BASE, { ...rest, 'SPEC.md': 's2' }), []);
  for (const none of [null, undefined, 'x', []]) {
    assert.deepEqual(testFilesToAsk(none, BASE), []);
    assert.deepEqual(testFilesToAsk(BASE, none), []);
  }
});

test('the test files of a set of hashes, and those not as at the baseline, new ones included', () => {
  assert.deepEqual(testHashesOf(BASE), { 'hooks/x.test.ts': 'x1', 'tests/a.test.ts': 'a1', 'tests/helpers.ts': 'p1' });
  assert.deepEqual(testHashesOf(null), {});
  const { 'hooks/x.test.ts': gone, ...rest } = BASE;
  assert.deepEqual(testFilesChanged(BASE, { ...rest, 'tests/a.test.ts': 'a2', 'tests/new.test.ts': 'n1', 'hooks/register.tsx': 'h2' }), ['tests/a.test.ts', 'tests/new.test.ts']);
  assert.deepEqual(testFilesChanged(BASE, BASE), []);
  assert.deepEqual(testFilesChanged(null, BASE), []);
});

test('the names the baseline had that no test has now', () => {
  assert.deepEqual(namesGone(['one', 'two', 'three'], ['three', 'four']), ['one', 'two']);
  assert.deepEqual(namesGone(['one', 'one'], []), ['one']);
  assert.deepEqual(namesGone(['one'], ['one']), []);
  assert.deepEqual(namesGone(null, ['one']), []);
  assert.deepEqual(namesGone(['one'], null), []);
});

test('lines are compared as a diff compares them: what the file lost, in order, and how many it gained', () => {
  assert.deepEqual(lineChanges('a\nb\nc\n', 'a\nb\nc\n'), { added: 0, removed: [] });
  assert.deepEqual(lineChanges('a\nb\nc\n', 'a\nc\n'), { added: 0, removed: ['b'] });
  assert.deepEqual(lineChanges('a\nb\nc\n', 'a\nB\nc\nd\n'), { added: 2, removed: ['b'] });
  assert.deepEqual(lineChanges('a\nb\n', ''), { added: 0, removed: ['a', 'b'] });
  assert.deepEqual(lineChanges('', 'a\nb\n'), { added: 2, removed: [] });
  // A line that moved is one removed and one added; a repeated line is counted as often as it is lost.
  assert.deepEqual(lineChanges('a\nb\nc\n', 'c\na\nb\n'), { added: 1, removed: ['c'] });
  assert.deepEqual(lineChanges('x\nx\nx\n', 'x\n'), { added: 0, removed: ['x', 'x'] });
});

test('a line ending is not part of a line: CRLF against LF, and a last line with no ending, change nothing', () => {
  assert.deepEqual(lineChanges('a\r\nb\r\n', 'a\nb\n'), { added: 0, removed: [] });
  assert.deepEqual(lineChanges('a\nb', 'a\nb\n'), { added: 0, removed: [] });
  assert.deepEqual(lineChanges('a\n\nb\n', 'a\nb\n'), { added: 0, removed: [''] });
  for (const none of NOT_TEXT) assert.deepEqual(lineChanges(none, 'a\n'), { added: 1, removed: [] });
});

const BEFORE = lines("test('one', () => {", '  expect(cut(row)).toBe(40)', '  expect(cut(wide)).toBe(40)', '})');
const AFTER = lines("test('one', () => {", '  expect(cut(row)).toBe(40)', '  // loosened', '  check(wide)', '})');

test('the question names each file with its lines added and removed, and quotes each removed line that holds expect', () => {
  assert.equal(testChangeQuestion([{ path: 'tests/a.test.ts', before: BEFORE, after: AFTER }], []), [
    'These test files are not as they were before this edit:',
    '- tests/a.test.ts: 2 lines added, 1 line removed',
    '    removed: expect(cut(wide)).toBe(40)',
    'Go on with these changes?',
  ].join('\n'));
});

test('a file that is gone has every line removed, files come in the order of their paths, and gone test names are listed', () => {
  const files = [{ path: 'tests/b.test.ts', before: BEFORE, after: null }, { path: 'hooks/x.test.ts', before: 'const a = 1\nconst b = 2\n', after: 'const a = 1\n' }];
  assert.equal(testChangeQuestion(files, ['one', 'two']), [
    'These test files are not as they were before this edit:',
    '- hooks/x.test.ts: 0 lines added, 1 line removed',
    '- tests/b.test.ts: gone (4 lines removed)',
    '    removed: expect(cut(row)).toBe(40)',
    '    removed: expect(cut(wide)).toBe(40)',
    'These tests no longer exist: one; two',
    'Go on with these changes?',
  ].join('\n'));
});

test('at most 20 removed lines are quoted in all, across the files, then how many more there are', () => {
  const many = (count, mark) => lines(...Array.from({ length: count }, (_, index) => `  expect(${mark}${index}).toBe(1)`));
  const text = testChangeQuestion([{ path: 'tests/a.test.ts', before: many(15, 'a'), after: '' }, { path: 'tests/b.test.ts', before: many(8, 'b'), after: null }], []);
  const said = text.split('\n');
  assert.equal(QUOTED_LINES, 20);
  assert.equal(said.filter((line) => line.startsWith('    removed: ')).length, 20);
  assert.equal(said[1], '- tests/a.test.ts: 0 lines added, 15 lines removed');
  assert.equal(said[16], '    removed: expect(a14).toBe(1)');
  assert.equal(said[17], '- tests/b.test.ts: gone (8 lines removed)');
  assert.equal(said[22], '    removed: expect(b4).toBe(1)');
  assert.deepEqual(said.slice(23), ['and 3 more removed lines that hold "expect"', 'Go on with these changes?']);
  const one = testChangeQuestion([{ path: 'tests/a.test.ts', before: many(21, 'a'), after: '' }], []).split('\n');
  assert.equal(one[one.length - 2], 'and 1 more removed line that holds "expect"');
  const exact = testChangeQuestion([{ path: 'tests/a.test.ts', before: many(20, 'a'), after: '' }], []).split('\n');
  assert.equal(exact.length, 23);
  assert.equal(exact.some((line) => line.startsWith('and ')), false);
});

test('a removed line that does not hold expect is counted and not quoted, and with no file to ask about there is no question', () => {
  const text = testChangeQuestion([{ path: 'tests/a.test.ts', before: 'const a = 1\nassert(x)\n', after: '' }], []);
  assert.equal(text, 'These test files are not as they were before this edit:\n- tests/a.test.ts: 0 lines added, 2 lines removed\nGo on with these changes?');
  assert.equal(testChangeQuestion([], ['one']), null);
  assert.equal(testChangeQuestion(null, []), null);
  assert.equal(testChangeQuestion([null, { before: 'a' }], []), null);
});

test('"Not yet" is the first option, and only the approving answer passes', () => {
  assert.deepEqual(testChangeOptions(), [NOT_YET, GO_ON]);
  assert.equal(GO_ON, 'Go on with these changes');
  assert.deepEqual(testChangeGate(GO_ON), { pass: true });
  assert.deepEqual(testChangeGate(NOT_YET), { pass: false, reason: 'the person has not agreed to the changed test files (answer: "Not yet")' });
  assert.deepEqual(testChangeGate('go on with these changes'), { pass: false, reason: 'the person has not agreed to the changed test files (answer: "go on with these changes")' });
  assert.deepEqual(testChangeGate('Approve'), { pass: false, reason: 'the person has not agreed to the changed test files (answer: "Approve")' });
  for (const none of [null, undefined]) assert.deepEqual(testChangeGate(none), { pass: false, reason: 'the person has not agreed to the changed test files (answer: none)' });
});

test('the evidence holds the answer and the files it covered', () => {
  assert.equal(testChangeEvidence([{ path: 'hooks/x.test.ts', how: 'changed' }, { path: 'tests/b.test.ts', how: 'missing' }], GO_ON),
    'the person answered "Go on with these changes" for: hooks/x.test.ts (changed), tests/b.test.ts (gone)');
});

// --------------------------------------------------------------------------------------------- the version

test('the new version must be greater than the baseline\'s, compared number by number and not as text', () => {
  for (const [before, now] of [['0.1.0', '0.1.1'], ['0.1.0', '0.2.0'], ['0.1.9', '1.0.0'], ['0.9.0', '0.10.0'], ['1.2.3', '1.2.10'], ['9.0.0', '10.0.0'], ['0.0.0', '0.0.1']]) {
    assert.deepEqual(versionGate(before, now), { pass: true }, `${before} -> ${now}`);
  }
  for (const [before, now] of [['0.1.0', '0.1.0'], ['0.2.0', '0.1.9'], ['1.0.0', '0.9.9'], ['0.10.0', '0.9.0'], ['1.2.10', '1.2.3'], ['2.0.0', '1.9.9']]) {
    assert.deepEqual(versionGate(before, now), { pass: false, reason: `plugin.json's version is ${now}, not greater than the ${before} it had before the edit` }, `${before} -> ${now}`);
  }
  assert.deepEqual(versionGate('0.0.9007199254740993', '0.0.9007199254740992'), {
    pass: false, reason: "plugin.json's version is 0.0.9007199254740992, not greater than the 0.0.9007199254740993 it had before the edit",
  });
});

test('when the baseline had no version, or one that is not three numbers, any three numbers pass', () => {
  for (const before of [null, undefined, '', 'banana', '1.0', '1.0.0-beta', '1.0.0+build', 'v1.0.0', '1.0.0.0', '1..0', 7]) {
    assert.deepEqual(versionGate(before, '0.0.1'), { pass: true }, String(before));
    assert.deepEqual(versionGate(before, '0.0.0'), { pass: true }, String(before));
  }
});

test('a new version that is not three numbers is refused, whatever the baseline had', () => {
  for (const before of ['0.1.0', null, 'banana']) {
    assert.deepEqual(versionGate(before, undefined), { pass: false, reason: 'plugin.json has no version' });
    assert.deepEqual(versionGate(before, null), { pass: false, reason: 'plugin.json has no version' });
    for (const now of ['banana', '1.0', '2.0.0-beta', '2.0.0+build', 'v2.0.0', '2.0.0.0', ' 2.0.0', '2.0.0\n', '2.0.x', '']) {
      assert.deepEqual(versionGate(before, now), { pass: false, reason: `plugin.json's version is ${JSON.stringify(now)}, which is not three numbers as in 1.2.3` }, `${before} -> ${now}`);
    }
    assert.deepEqual(versionGate(before, 2), { pass: false, reason: "plugin.json's version is 2, which is not three numbers as in 1.2.3" });
  }
});

// --------------------------------------------------------------------------- the typecheck covers every test file

test('the typecheck names each test file outside hooks/, tests/ and types/, and is as before with none', () => {
  const included = (testFiles) => JSON.parse(typecheckConfig('/t/claude-code.d.ts', MOD, testFiles)).include;
  const base = ['/t/claude-code.d.ts', '/work/mod/hooks', '/work/mod/tests', '/work/mod/types'];
  assert.equal(typecheckConfig('/t/claude-code.d.ts', MOD, []), typecheckConfig('/t/claude-code.d.ts', MOD));
  assert.deepEqual(JSON.parse(typecheckConfig('/t/claude-code.d.ts', MOD)).include, base);
  // SPEC.md 8.13: a test file inside the three folders is named as well; nothing rests on what a folder reaches.
  assert.deepEqual(included(['tests/a.test.ts', 'hooks/x.test.ts', 'types/t.test.ts']), [...base, '/work/mod/hooks/x.test.ts', '/work/mod/tests/a.test.ts', '/work/mod/types/t.test.ts']);
  assert.deepEqual(included(['lib/y.test.tsx', 'a.test.ts', 'tests/a.test.ts', 'lib/y.test.tsx']), [...base, '/work/mod/a.test.ts', '/work/mod/lib/y.test.tsx', '/work/mod/tests/a.test.ts']);
  // What is no test file, or no path, is not named: the model's words never reach the compiler's list.
  assert.deepEqual(included(['lib/util.ts', '../outside.test.ts', '', null, 3]), base);
  assert.deepEqual(included(null), base);
});

// ------------------------------------------------------- cases the independent reader of these tests asked for

test('a folder named by a path that climbs above the root, or through "..", is read as the folder it is', () => {
  const own = (modDir) => ({ pass: false, reason: `${modDir} is this plugin's own folder: mod-builder does not edit itself` });
  assert.deepEqual(editFolderVerdict(folder({ modDir: '/opt/x/../mod-builder' })), own('/opt/mod-builder'));
  assert.deepEqual(editFolderVerdict(folder({ modDir: '/opt/mod-builder/' })), own('/opt/mod-builder'));
  assert.deepEqual(editFolderVerdict(folder({ modDir: '/opt/mod-builder', pluginRoot: '/opt/x/../mod-builder/' })), own('/opt/mod-builder'));
  for (const modDir of ['/../opt/mod-builder', '/opt/../../opt/mod-builder']) {
    assert.deepEqual(editFolderVerdict(folder({ modDir })), { pass: false, reason: 'the folder to edit is not named by a path from the root' }, modDir);
  }
  assert.deepEqual(editFolderVerdict(folder({ pluginRoot: '/../opt/mod-builder' })), { pass: false, reason: "/work/mod can't be judged: this plugin's own folder is not known" });
  assert.deepEqual(editFolderVerdict(folder({ modDir: '/work/./mod/', hasManifest: false })), { pass: false, reason: '/work/mod holds no .claude-plugin/plugin.json: it is not a plugin' });
});

test('versions past what a number holds are compared exactly, and a number may open with a zero', () => {
  assert.deepEqual(versionGate('0.0.9007199254740992', '0.0.9007199254740993'), { pass: true });
  assert.deepEqual(versionGate('1.02.0', '1.02.1'), { pass: true });
  assert.deepEqual(versionGate('1.02.0', '1.2.0'), { pass: false, reason: "plugin.json's version is 1.2.0, not greater than the 1.02.0 it had before the edit" });
  assert.deepEqual(versionGate('01.0.0', '1.0.1'), { pass: true });
  assert.deepEqual(versionGate('01.0.0', '0.9.0'), { pass: false, reason: "plugin.json's version is 0.9.0, not greater than the 01.0.0 it had before the edit" });
});

test('a removed line is quoted when it holds the letters "expect" as written, in any word', () => {
  const before = lines('  const expected = 3', '  await expectTypeOf(x)', '  Expect(x)', '  EXPECT(y)', '  check(z)');
  assert.equal(testChangeQuestion([{ path: 'tests/a.test.ts', before, after: '' }], []), [
    'These test files are not as they were before this edit:',
    '- tests/a.test.ts: 0 lines added, 5 lines removed',
    '    removed: const expected = 3',
    '    removed: await expectTypeOf(x)',
    'Go on with these changes?',
  ].join('\n'));
});

test('a changed file is asked about though no line of it differs: its bytes do', () => {
  assert.equal(testChangeQuestion([{ path: 'tests/a.test.ts', before: 'a\r\n', after: 'a\n' }], []),
    'These test files are not as they were before this edit:\n- tests/a.test.ts: 0 lines added, 0 lines removed\nGo on with these changes?');
});

test('test files at the mod\'s top and in any other folder are hashed and asked about as those under tests/ are', () => {
  const base = { 'a.test.ts': 'r1', 'lib/z.test.tsx': 'z1', 'hooks/.test.ts': 'd1', 'lib/util.ts': 'u1', 'node_modules/dep/d.test.ts': 'n1' };
  assert.deepEqual(testHashesOf(base), { 'a.test.ts': 'r1', 'hooks/.test.ts': 'd1', 'lib/z.test.tsx': 'z1' });
  assert.deepEqual(testFilesToAsk(base, { ...base, 'a.test.ts': 'r2', 'lib/z.test.tsx': 'z2', 'lib/util.ts': 'u2', 'node_modules/dep/d.test.ts': 'n2' }), [
    { path: 'a.test.ts', how: 'changed' }, { path: 'lib/z.test.tsx', how: 'changed' },
  ]);
  assert.deepEqual(testFilesChanged(base, { ...base, 'hooks/.test.ts': 'd2', 'b.test.ts': 'b1' }), ['b.test.ts', 'hooks/.test.ts']);
});

test('a file named as a test in other letter case is no test file of the baseline, and one under node_modules is none', () => {
  assert.equal(baselineVerdict(runs({ test: run(1, NO_TESTS) }), MOD, ['hooks/x.TEST.ts']).hasTests, false);
  assert.equal(baselineVerdict(runs({ test: run(1, NO_TESTS) }), MOD, ['node_modules/dep/d.test.ts']).hasTests, false);
  assert.equal(baselineVerdict(runs(), MOD, ['hooks/.test.ts']).hasTests, true);
  // Green still closes the other letter case, and leaves node_modules to the code.
  assert.equal(mayWriteIn('edit', 'green', 'node_modules/dep/d.test.ts'), true);
  assert.equal(mayWriteIn('edit', 'red', 'node_modules/dep/d.test.ts'), false);
  assert.equal(mayWriteIn('edit', 'green', 'hooks/.test.ts'), false);
  assert.equal(mayWriteIn('edit', 'red', 'hooks/.test.ts'), true);
});

test('each typecheck\'s error lines are read from the folder that typecheck ran in', () => {
  const first = { run: run(1, '../../work/mod/hooks/a.ts(1,1): error TS1: x\n'), cwd: '/x/y' };
  const second = { run: run(1, '../../../../work/mod/tests/b.test.ts(1,1): error TS1: x\n'), cwd: '/x/y/z/w' };
  assert.deepEqual(testsFit([first, second], MOD), { pass: false, reason: 'the test files do not typecheck: tests/b.test.ts' });
  assert.deepEqual(testsFit([second, first], MOD), { pass: false, reason: 'the test files do not typecheck: tests/b.test.ts' });
});

test('the test files an error names are sorted, whatever order the compiler printed them in', () => {
  const out = lines('/work/mod/tests/b.test.ts(1,1): error TS1: x', '/work/mod/lib/a.test.tsx(1,1): error TS1: x', '/work/mod/a.test.ts(1,1): error TS1: x');
  assert.deepEqual(typecheckErrors(out, CWD, MOD).tests, ['a.test.ts', 'lib/a.test.tsx', 'tests/b.test.ts']);
});

test('the typecheck names a test file by its path made whole, once', () => {
  const include = JSON.parse(typecheckConfig('/t/c.d.ts', MOD, ['./lib/y.test.tsx', 'lib//y.test.tsx', 'lib/x/../y.test.tsx', 'node_modules/dep/d.test.ts'])).include;
  assert.deepEqual(include.slice(4), ['/work/mod/lib/y.test.tsx']);
});

test('Red of a repair refuses when no typecheck was run', () => {
  for (const none of [[], null, undefined]) assert.deepEqual(repairRedGate(none, MOD, FILES), { pass: false, reason: 'no typecheck was run' });
});

test('a write refused before Red, and at Verify, says that phase\'s own words', () => {
  assert.deepEqual(writeVerdictIn('edit', 'knowledge', 'SPEC.md'), {
    allowed: false,
    reason: `mod-builder: SPEC.md can't be written in phase 1 (Knowledge) of this edit, which may write nothing in the mod. Phase 2 (Describe) opens when a snapshot exists: ask for it by calling the ${GATE_TOOL} tool.`,
  });
  assert.deepEqual(writeVerdictIn('edit', 'describe', 'SPEC.md'), {
    allowed: false,
    reason: `mod-builder: SPEC.md can't be written in phase 2 (Describe) of this edit, which may write nothing in the mod. Phase 3 (Spec) opens when the model has read the pages that bear on the request (no gate): ask for it by calling the ${GATE_TOOL} tool.`,
  });
  assert.deepEqual(writeVerdictIn('edit', 'verify', 'hooks/register.tsx'), {
    allowed: false,
    reason: `mod-builder: hooks/register.tsx can't be written in phase 6 (Verify) of this edit, which may write anything but test files and hooks/. Phase 7 (Done) opens when validate, test, the typecheck and the headless load all pass: ask for it by calling the ${GATE_TOOL} tool.`,
  });
});

test('a skipped Red skips from Spec alone, and a record that names its kind a build holds its folder', () => {
  assert.equal(nextPhaseOf('edit', 'knowledge', 'skipped'), 'describe');
  assert.equal(isOpenRecord(record('green', { kind: 'build' })), true);
  assert.equal(isOpenRecord(record('done', { kind: 'build' })), false);
});

test('two lines that changed places: the first is the one removed, as a diff shows it', () => {
  assert.deepEqual(lineChanges('x\ny\n', 'y\nx\n'), { added: 1, removed: ['x'] });
});

test('files too long for the table are compared without regard to order, and lose no removed line', () => {
  const count = Math.ceil(Math.sqrt(COMPARED_CELLS)) + 10;
  const before = Array.from({ length: count }, (_, index) => `line ${index}`);
  const after = before.filter((_, index) => index !== 7 && index !== count - 1).concat(['new a', 'new b', 'new c']);
  assert.equal(COMPARED_CELLS, 4000000);
  assert.deepEqual(lineChanges(`${before.join('\n')}\n`, `${after.join('\n')}\n`), { added: 3, removed: ['line 7', `line ${count - 1}`] });
  assert.deepEqual(lineChanges(`${before.join('\n')}\n`, ''), { added: 0, removed: before });
  // Just under the limit the table is used: a line that moved is one removed and one added.
  const short = Array.from({ length: 1900 }, (_, index) => `line ${index}`);
  assert.deepEqual(lineChanges(`${short.join('\n')}\n`, `${[...short.slice(1), short[0]].join('\n')}\n`), { added: 1, removed: ['line 0'] });
});

test('a failing block that no path line precedes is tied to no file, and is never taken as changed', () => {
  const orphan = lines('(fail) orphan [1ms]', `  ${ASSERTS}`, '', ' 0 pass', ' 1 fail', 'Ran 1 test across 1 file. [0.1s]');
  assert.deepEqual(editRedGate(run(1, orphan), ['orphan'], ['x.test.ts']), {
    pass: false, reason: 'no new or changed test fails: every failing test had its name at the baseline, in a test file that is as it was (orphan)',
  });
  assert.deepEqual(editRedGate(run(1, orphan), [], []), { pass: true, tests: 1 });
});

test('a path line is a test file\'s path from the first column, ending in a colon: nothing else names a file', () => {
  const under = (head) => failuresByFile(lines(head, '(fail) one [1ms]', `  ${ASSERTS}`, '', 'Ran 1 test across 1 file. [0.1s]'))[0].file;
  assert.equal(under('tests/a.test.ts:'), 'tests/a.test.ts');
  assert.equal(under('hooks/.test.tsx:'), 'hooks/.test.tsx');
  assert.equal(under('tests/a.test.ts'), null);
  assert.equal(under('  tests/a.test.ts:'), null);
  assert.equal(under('tests/a.test.js:'), null);
  assert.equal(under('tests/a.test.ts: cannot import'), null);
});

test('the evidence leaves out what is no file, and never throws on it', () => {
  assert.equal(testChangeEvidence([null, undefined, { path: 'tests/a.test.ts', how: 'changed' }, { how: 'missing' }], NOT_YET), 'the person answered "Not yet" for: tests/a.test.ts (changed)');
  assert.equal(testChangeEvidence(null, GO_ON), 'the person answered "Go on with these changes" for: ');
});

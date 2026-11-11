// Logic tests for what step 2 of SPEC.md 8.9 asks of the rules: what opens an edit, its record and where its
// restore point is kept, the approval that may take the refactor route (8.15), what Green holds a run to when Red
// was skipped, 8.4's question quoting a removed line that opens a test (8.18), and the stop (8.5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as rules from '../hooks/mod-builder-logic.ts';

// Taken from the module as a whole, so that a rule not built yet fails the tests that use it and no others.
const {
  NOT_YET, APPROVE, APPROVE_NO_CHANGE, KEEP_AS_IS, PUT_BACK, SKIP_REASONS,
  isEditSkill, isBuildSkill, isSessionEntry, entryKind, isBuildRecord, isOpenRecord, isKeptOut, newEditRecord, newRecord, stampOf, restoreFolder,
  stoppedFolder, mayRefactor, editApprovalOptions, editApprovalQuestion, editSpecGate, changeSection, saysNoChange, editSpecKept,
  keptTestsGate, stopOptions, putsBack, stoppedRecord, testChangeQuestion, nextPhaseOf, guardVerdict, refactorRecord, recordKind,
} = rules;

const lines = (...text) => `${text.join('\n')}\n`;
const run = (exitCode, output = '') => ({ exitCode, output });
const MOD = '/work/mod';
const ROOT = '/opt/mod-builder';
const report = (names, failed = []) => lines('', 'tests/pane.test.tsx:', ...names.map((name) => `(${failed.includes(name) ? 'fail' : 'pass'}) ${name} [1.00ms]`), '',
  ` ${names.length - failed.length} pass`, ` ${failed.length} fail`, `Ran ${names.length} tests across 1 file. [0.20s]`);
const baseline = (more = {}) => ({ version: '0.1.0', tests: 2, names: ['one', 'two'], hashes: { 'tests/a.test.ts': 'a1', 'hooks/register.tsx': 'r1' }, spec: { length: 10, hash: 'h' }, failed: [], restore: '/home/u/r', at: 1000, ...more });
const NOT_TEXT = [null, undefined, 0, 1, true, {}, []];

// --------------------------------------------------------------------------------------------- what opens an edit

const skill = (more = {}) => ({ skill: 'edit', source: 'plugin', pluginName: 'mod-builder', path: `${ROOT}/skills/edit/SKILL.md`, ...more });

test('this plugin\'s edit skill opens an edit, under its own name or after the plugin\'s', () => {
  assert.equal(isEditSkill(skill(), 'mod-builder', ROOT), true);
  assert.equal(isEditSkill(skill({ skill: 'mod-builder:edit' }), 'mod-builder', ROOT), true);
  assert.equal(isEditSkill(skill({ path: undefined }), 'mod-builder', ROOT), true);
});

test('another plugin\'s edit skill, a project\'s, this plugin\'s build skill and what is no event open no edit', () => {
  assert.equal(isEditSkill(skill({ pluginName: 'other' }), 'mod-builder', ROOT), false);
  assert.equal(isEditSkill(skill({ path: '/work/.claude/skills/edit/SKILL.md' }), 'mod-builder', ROOT), false);
  assert.equal(isEditSkill({ skill: 'edit', source: 'projectSettings' }, 'mod-builder', ROOT), false);
  assert.equal(isEditSkill(skill({ skill: 'build' }), 'mod-builder', ROOT), false);
  assert.equal(isEditSkill(skill({ skill: 'other:edit' }), 'mod-builder', ROOT), false);
  assert.equal(isBuildSkill(skill(), 'mod-builder', ROOT), false);
  for (const none of [null, undefined, 'edit', 3]) assert.equal(isEditSkill(none, 'mod-builder', ROOT), false);
  assert.equal(isEditSkill(skill(), '', ROOT), false);
  assert.equal(isEditSkill(skill(), 'mod-builder', 'relative'), false);
});

test('a session\'s entry says what it opened; one without a kind opened a build, as 0.1.0 stored it', () => {
  assert.equal(isSessionEntry({ modDir: null }), true);
  assert.equal(isSessionEntry({ modDir: null, kind: 'edit' }), true);
  assert.equal(isSessionEntry({ modDir: MOD, kind: 'build' }), true);
  for (const kind of ['repair', '', null, 3, true, {}]) assert.equal(isSessionEntry({ modDir: null, kind }), false, String(kind));
  assert.equal(entryKind({ modDir: null }), 'build');
  assert.equal(entryKind({ modDir: MOD, kind: 'build' }), 'build');
  assert.equal(entryKind({ modDir: null, kind: 'edit' }), 'edit');
  for (const none of [null, undefined, {}, { modDir: null, kind: 'other' }, 'edit']) assert.equal(entryKind(none), 'build');
});

// --------------------------------------------------------------------------------------------- an edit's record

test('a new edit\'s record is at Knowledge, names its kind, and holds the baseline and how its Red ends', () => {
  const made = newEditRecord(MOD, 's1', baseline(), 'edit');
  assert.deepEqual(made, { ...newRecord(MOD, 's1'), kind: 'edit', red: 'edit', baseline: baseline() });
  assert.equal(isBuildRecord(made), true);
  assert.equal(isOpenRecord(made), true);
  assert.equal(made.phase, 'knowledge');
  assert.equal(Object.prototype.hasOwnProperty.call(made, 'skipped'), false);
  assert.equal(newEditRecord(MOD, 's1', baseline({ failed: ['typecheck'] }), 'repair').red, 'repair');
});

test('an edit whose Red the baseline skips says why: the test files fit', () => {
  const made = newEditRecord(MOD, 's1', baseline({ failed: ['typecheck'] }), 'skipped');
  assert.equal(made.red, 'skipped');
  assert.equal(made.skipped, 'fit');
  assert.equal(nextPhaseOf('edit', 'spec', made.red), 'green');
  assert.deepEqual([...SKIP_REASONS], ['fit', 'no behaviour change']);
});

test('the mod\'s .git and node_modules, at its top, are left out of the baseline and the restore point', () => {
  for (const path of ['.git/config', '.git', 'node_modules/dep/index.js', 'node_modules', './.git/HEAD', 'x/../.git/HEAD']) assert.equal(isKeptOut(path), true, path);
  for (const path of ['hooks/register.tsx', 'tests/node_modules/n.test.ts', 'lib/.git/config', '.gitignore', '.github/workflows/ci.yml', 'node_modules_old/a.js', '']) assert.equal(isKeptOut(path), false, path);
  for (const none of NOT_TEXT) assert.equal(isKeptOut(none), false);
});

test('a stamp names a time as the docs snapshots do, and what is no time has none', () => {
  assert.equal(stampOf(Date.UTC(2026, 10, 11, 1, 23, 45)), '2026-11-11T012345Z');
  assert.equal(stampOf(Date.UTC(2026, 10, 11, 1, 23, 45) + 999), '2026-11-11T012345Z');
  assert.equal(stampOf(0), '1970-01-01T000000Z');
  for (const none of [Number.NaN, Infinity, -Infinity, 8.7e15, 8.64e15, 253402300800000, -1, null, undefined, '1000', {}]) assert.equal(stampOf(none), null, String(none));
  assert.equal(stampOf(253402300799000), '9999-12-31T235959Z');
});

test('the restore point is kept under the plugin\'s data folder, by session and stamp', () => {
  const at = Date.UTC(2026, 10, 11, 1, 23, 45);
  assert.equal(restoreFolder('/home/u', 's1', at), '/home/u/.claude/mod-builder-data/v2/restore/s1/2026-11-11T012345Z');
  assert.equal(restoreFolder('/home/u/', '47bab169-ba63-4e21_x', at), '/home/u/.claude/mod-builder-data/v2/restore/47bab169-ba63-4e21_x/2026-11-11T012345Z');
});

test('a restore point that can\'t be placed is none: no HOME, a session id that is no plain name, no time', () => {
  const at = Date.UTC(2026, 10, 11, 1, 23, 45);
  for (const home of [undefined, null, '', 'home/u', '/', '/..']) assert.equal(restoreFolder(home, 's1', at), null, String(home));
  for (const id of ['', '../x', 'a/b', 'a b', '.', null, undefined, 3]) assert.equal(restoreFolder('/home/u', id, at), null, String(id));
  assert.equal(restoreFolder('/home/u', 's1', Number.NaN), null);
});

test('a stopped edit\'s folder is named beside the mod, with the stamp', () => {
  const at = Date.UTC(2026, 10, 11, 1, 23, 45);
  assert.equal(stoppedFolder(MOD, at), '/work/mod.stopped-2026-11-11T012345Z');
  assert.equal(stoppedFolder('/work/x/../mod/', at), '/work/mod.stopped-2026-11-11T012345Z');
  for (const none of ['mod', '', '/', null, undefined]) assert.equal(stoppedFolder(none, at), null, String(none));
  assert.equal(stoppedFolder(MOD, Number.NaN), null);
});

// --------------------------------------------------------------------------------- the approval, and the refactor route

test('the refactor route may be offered only for a mod that passed its baseline, has tests, and showed a count', () => {
  assert.equal(mayRefactor(baseline(), 'edit'), true);
  assert.equal(mayRefactor(baseline({ failed: ['test'] }), 'edit'), false);
  assert.equal(mayRefactor(baseline({ tests: null }), 'edit'), false);
  assert.equal(mayRefactor(baseline({ names: [] }), 'edit'), false);
  assert.equal(mayRefactor(baseline({ names: null }), 'edit'), false);
  for (const red of ['repair', 'skipped', undefined, 'other']) assert.equal(mayRefactor(baseline(), red), false, String(red));
  for (const none of [null, undefined, 'x', 3]) assert.equal(mayRefactor(none, 'edit'), false);
});

test('"Not yet" is first; the third option is there only when the call said no behaviour change and the route is offered', () => {
  assert.deepEqual(editApprovalOptions(true, true), [NOT_YET, APPROVE, APPROVE_NO_CHANGE]);
  assert.deepEqual(editApprovalOptions(true, false), [NOT_YET, APPROVE]);
  assert.deepEqual(editApprovalOptions(false, true), [NOT_YET, APPROVE]);
  assert.deepEqual(editApprovalOptions(false, false), [NOT_YET, APPROVE]);
  for (const none of ['true', 1, null, undefined]) assert.deepEqual(editApprovalOptions(none, true), [NOT_YET, APPROVE]);
  assert.equal(APPROVE_NO_CHANGE, 'Approve: no behaviour change');
});

test('the question says so when the change is put forward as one with no behaviour change, and not otherwise', () => {
  const plain = editApprovalQuestion(MOD, [NOT_YET, APPROVE]);
  assert.equal(plain, 'Approve this change to the mod? Its section is at the end of /work/mod/SPEC.md. Nothing but SPEC.md can be written until you approve.');
  const route = editApprovalQuestion(MOD, [NOT_YET, APPROVE, APPROVE_NO_CHANGE]);
  assert.equal(route, `${plain} It is put forward as a change with NO BEHAVIOUR CHANGE: "Approve: no behaviour change" skips Red, keeps every test as it is and requires each to pass; "Approve" sends it through Red as any other change.`);
  assert.equal(editApprovalQuestion(MOD, null), plain);
});

test('the usual approving answer sends the edit to Red, and only the third answer takes the refactor route', () => {
  const three = [NOT_YET, APPROVE, APPROVE_NO_CHANGE];
  assert.deepEqual(editSpecGate(APPROVE, three), { pass: true, route: 'red' });
  assert.deepEqual(editSpecGate(APPROVE_NO_CHANGE, three), { pass: true, route: 'refactor' });
  assert.deepEqual(editSpecGate(APPROVE, [NOT_YET, APPROVE]), { pass: true, route: 'red' });
  assert.deepEqual(editSpecGate(NOT_YET, three), { pass: false, reason: 'the person has not approved the change (answer: "Not yet")' });
});

test('the third answer does not pass where it was not offered, nor does typed text or no answer', () => {
  assert.deepEqual(editSpecGate(APPROVE_NO_CHANGE, [NOT_YET, APPROVE]), { pass: false, reason: 'the person has not approved the change (answer: "Approve: no behaviour change")' });
  assert.deepEqual(editSpecGate('approve', [NOT_YET, APPROVE]), { pass: false, reason: 'the person has not approved the change (answer: "approve")' });
  assert.deepEqual(editSpecGate('no behaviour change', [NOT_YET, APPROVE, APPROVE_NO_CHANGE]).pass, false);
  for (const none of [null, undefined]) assert.deepEqual(editSpecGate(none, [NOT_YET, APPROVE]), { pass: false, reason: 'the person has not approved the change (answer: none)' });
  assert.deepEqual(editSpecGate(APPROVE, null).pass, false);
});

const OLD = '# Spec\n\nold text\n';
const now = (text, more = {}) => ({ length: text.length, hash: 'now', approvedPartHash: 'old', ...more });
const kept = { length: OLD.length, hash: 'old' };

test('the section an edit appended is what follows the baseline\'s length', () => {
  assert.equal(changeSection(`${OLD}## 0.2.0\n\nmore\n`, OLD.length), '## 0.2.0\n\nmore\n');
  assert.equal(changeSection(OLD, OLD.length), '');
  assert.equal(changeSection('short', 10), '');
  assert.equal(changeSection('whole file', 0), 'whole file');
  for (const none of NOT_TEXT) assert.equal(changeSection(none, 0), '');
  assert.equal(changeSection(OLD, -1), '');
});

test('a section says no behaviour change in its first line of text, after its heading', () => {
  assert.equal(saysNoChange('\n## 0.1.1 (2026-11-11)\n\nNo behaviour change: the rows are built by one helper.\n'), true);
  assert.equal(saysNoChange('No behaviour change.\nmore'), true);
  assert.equal(saysNoChange('## 0.1.1\n### What\n\n  no behaviour change\n'), true);
  assert.equal(saysNoChange('## 0.1.1\n\nCuts each row by width.\n\nNo behaviour change elsewhere.\n'), false);
  assert.equal(saysNoChange('## No behaviour change\n\nCuts each row by width.\n'), false);
  assert.equal(saysNoChange('## 0.1.1\n'), false);
  for (const none of NOT_TEXT) assert.equal(saysNoChange(none), false);
});

test('Spec\'s gate for an edit passes when SPEC.md begins as it did and holds a new section', () => {
  const text = `${OLD}## 0.2.0\n\nCuts each row by width.\n`;
  assert.deepEqual(editSpecKept(kept, now(text), text, false), { pass: true });
  // A mod that had no SPEC.md: the whole file is the section.
  assert.deepEqual(editSpecKept(null, now('## 0.2.0\n\nx\n', { approvedPartHash: null }), '## 0.2.0\n\nx\n', false), { pass: true });
});

test('a line of the original spec changed, or no new section, is refused before the person is asked', () => {
  const changed = { pass: false, reason: 'SPEC.md no longer begins as it did before this edit: the change is written as a new section at its end, and nothing above it may change' };
  const text = `${OLD}## 0.2.0\n\nx\n`;
  assert.deepEqual(editSpecKept(kept, now(text, { approvedPartHash: 'other' }), text, false), changed);
  assert.deepEqual(editSpecKept(kept, now('short', { approvedPartHash: null }), 'short', false), changed);
  assert.deepEqual(editSpecKept(kept, now(OLD), OLD, false), { pass: false, reason: 'SPEC.md holds no new section for this change yet: write it at the end of the file' });
  assert.deepEqual(editSpecKept(kept, now(`${OLD}\n \n`), `${OLD}\n \n`, false).pass, false);
  assert.deepEqual(editSpecKept(kept, null, text, false), { pass: false, reason: 'SPEC.md does not exist yet' });
  assert.deepEqual(editSpecKept(null, null, '', false), { pass: false, reason: 'SPEC.md does not exist yet' });
});

test('on the refactor route the section must say so in its first line', () => {
  const plain = `${OLD}## 0.1.1\n\nTidies the row helper.\n`;
  const says = `${OLD}## 0.1.1\n\nNo behaviour change: tidies the row helper.\n`;
  assert.deepEqual(editSpecKept(kept, now(plain), plain, true), {
    pass: false, reason: 'the change is put forward as one with no behaviour change, but its section of SPEC.md does not say "No behaviour change" in its first line',
  });
  assert.deepEqual(editSpecKept(kept, now(says), says, true), { pass: true });
  assert.deepEqual(editSpecKept(kept, now(says), says, false), { pass: true });
});

// --------------------------------------------------------------------------------- Green when Red was skipped

test('on the refactor route Green holds the run to the baseline\'s count and names, with none failing', () => {
  assert.deepEqual(keptTestsGate(run(0, report(['one', 'two'])), baseline(), 'no behaviour change'), { pass: true, tests: 2 });
  assert.deepEqual(keptTestsGate(run(0, report(['two', 'one'])), baseline(), 'no behaviour change'), { pass: true, tests: 2 });
  assert.deepEqual(keptTestsGate(run(1, report(['one', 'two'], ['two'])), baseline(), 'no behaviour change'), { pass: false, reason: 'claude plugin test exited 1: not every test passes' });
});

test('on the refactor route a test that is gone, one that is new, or another count is refused', () => {
  assert.deepEqual(keptTestsGate(run(0, report(['one'])), baseline(), 'no behaviour change'), { pass: false, reason: 'tests the mod had before this edit no longer run: two' });
  assert.deepEqual(keptTestsGate(run(0, report(['one', 'two', 'three'])), baseline(), 'no behaviour change'), {
    pass: false, reason: 'tests run that the mod did not have before this edit, which changes no behaviour: three',
  });
  assert.deepEqual(keptTestsGate(run(0, report(['one', 'two', 'two'])), baseline(), 'no behaviour change'), { pass: false, reason: 'the run has 3 tests (one; two; two), not the 2 the mod had before this edit (one; two)' });
});

test('in a repair whose Red was skipped Green holds the run to the baseline\'s names and to no fewer tests', () => {
  assert.deepEqual(keptTestsGate(run(0, report(['one', 'two'])), baseline({ failed: ['typecheck'] }), 'fit'), { pass: true, tests: 2 });
  assert.deepEqual(keptTestsGate(run(0, report(['one', 'two', 'three'])), baseline(), 'fit'), { pass: true, tests: 3 });
  assert.deepEqual(keptTestsGate(run(0, report(['one'])), baseline(), 'fit'), { pass: false, reason: 'tests the mod had before this edit no longer run: two' });
  assert.deepEqual(keptTestsGate(run(0, report(['one', 'two'])), baseline({ tests: 3 }), 'fit'), { pass: false, reason: 'the run has 2 tests, fewer than the 3 the mod had before this edit' });
});

test('a baseline whose run showed no count holds a repair to its names alone', () => {
  assert.deepEqual(keptTestsGate(run(0, report(['one'])), baseline({ tests: null, names: [] }), 'fit'), { pass: true, tests: 1 });
  assert.deepEqual(keptTestsGate(run(0, report(['one'])), baseline({ tests: null, names: ['one'] }), 'fit'), { pass: true, tests: 1 });
});

test('a run that can\'t be read, or a baseline that is none, refuses', () => {
  assert.deepEqual(keptTestsGate(run(0, 'no count\n'), baseline(), 'fit'), { pass: false, reason: "the test run's last line reports no test count" });
  assert.deepEqual(keptTestsGate(run(Number.NaN, report(['one', 'two'])), baseline(), 'fit'), { pass: false, reason: 'claude plugin test ended with no exit code' });
  for (const none of [null, undefined, 'x', { names: 'one' }]) assert.deepEqual(keptTestsGate(run(0, report(['one'])), none, 'fit'), { pass: false, reason: 'no baseline is recorded for this edit' });
});

// --------------------------------------------------------------------------------- 8.4: a removed line that opens a test

test('a removed line that opens a test is quoted as one that holds expect is: a test turned off is seen', () => {
  const before = lines("test('cuts by width', () => {", '  check(row)', '})', "it('wraps', () => {})", "describe('rows', () => {", '})');
  const after = lines("test.skip('cuts by width', () => {", '  check(row)', '})');
  assert.equal(testChangeQuestion([{ path: 'tests/a.test.ts', before, after }], []), [
    'These test files are not as they were before this edit:',
    '- tests/a.test.ts: 1 line added, 4 lines removed',
    "    removed: test('cuts by width', () => {",
    "    removed: it('wraps', () => {})",
    "    removed: describe('rows', () => {",
    'Go on with these changes?',
  ].join('\n'));
});

test('a line that only names such a word opens no test, and lines that open a test count inside the same 20', () => {
  const before = lines('  retest(x)', '  const test = 1', '  // test(', '  attest.it(x)', "  test.only.each('a', () => {})", '  it  (x)');
  assert.equal(testChangeQuestion([{ path: 'tests/a.test.ts', before, after: '' }], []), [
    'These test files are not as they were before this edit:',
    '- tests/a.test.ts: 0 lines added, 6 lines removed',
    "    removed: test.only.each('a', () => {})",
    '    removed: it  (x)',
    'Go on with these changes?',
  ].join('\n'));
  const many = lines(...Array.from({ length: 12 }, (_, index) => `test('t${index}', () => {`), ...Array.from({ length: 12 }, (_, index) => `  expect(${index}).toBe(1)`));
  const said = testChangeQuestion([{ path: 'tests/a.test.ts', before: many, after: '' }], []).split('\n');
  assert.equal(said.filter((line) => line.startsWith('    removed: ')).length, 20);
  assert.equal(said[said.length - 2], 'and 4 more removed lines that hold "expect" or open a test');
});

// --------------------------------------------------------------------------------------------- the stop

test('a stopped edit asks whether to keep the mod or put it back, to keep first, and only that answer puts it back', () => {
  assert.deepEqual(stopOptions(), [KEEP_AS_IS, PUT_BACK]);
  assert.equal(KEEP_AS_IS, 'Keep the mod as it is now');
  assert.equal(PUT_BACK, 'Put it back as it was before this edit');
  assert.equal(putsBack(PUT_BACK), true);
  for (const other of [KEEP_AS_IS, 'put it back', '', null, undefined, 'Put it back']) assert.equal(putsBack(other), false, String(other));
});

test('a stopped record is the record as it was, marked stopped: it holds no folder and binds no write', () => {
  const editing = { ...newEditRecord(MOD, 's1', baseline(), 'edit'), phase: 'green' };
  const stopped = stoppedRecord(editing);
  assert.deepEqual(stopped, { ...editing, stopped: true });
  assert.equal(editing.stopped, undefined);
  assert.equal(isOpenRecord(stopped), false);
  assert.equal(isBuildRecord(stopped), true);
  const write = { tool: 'Write', path: `${MOD}/tests/a.test.ts`, cwd: '/work', sessionId: 's1', entry: { modDir: MOD, kind: 'edit' }, pluginFolders: [MOD] };
  assert.equal(guardVerdict({ ...write, record: editing }).allowed, false);
  assert.deepEqual(guardVerdict({ ...write, record: stopped }), { allowed: true });
  assert.deepEqual(stoppedRecord({ ...newRecord(MOD, 's1'), phase: 'red' }), { ...newRecord(MOD, 's1'), phase: 'red', stopped: true });
  for (const none of [null, undefined, 'x', {}]) assert.deepEqual(stoppedRecord(none), none);
});

// ------------------------------------------------------- cases the independent reader of these tests asked for

test('the third answer makes the record one whose Red is skipped for no behaviour change, and only an edit\'s', () => {
  const editing = { ...newEditRecord(MOD, 's1', baseline(), 'edit'), phase: 'spec' };
  const routed = refactorRecord(editing);
  assert.deepEqual(routed, { ...editing, red: 'skipped', skipped: 'no behaviour change' });
  assert.equal(editing.red, 'edit');
  assert.equal(nextPhaseOf('edit', 'spec', routed.red), 'green');
  assert.equal(recordKind(routed), 'edit');
  const building = { ...newRecord(MOD, 's1'), phase: 'spec' };
  assert.deepEqual(refactorRecord(building), building);
  for (const none of [null, undefined, 'x', {}]) assert.deepEqual(refactorRecord(none), none);
});

test('a repair with Red entered, and an edit, carry no reason for a skipped Red', () => {
  for (const red of ['edit', 'repair']) assert.equal(Object.prototype.hasOwnProperty.call(newEditRecord(MOD, 's1', baseline(), red), 'skipped'), false, red);
});

test('the refactor route is not offered when any check failed, when the count is none or no count, or with no test file', () => {
  for (const failed of [['typecheck'], ['validate'], ['load'], ['test'], ['validate', 'load']]) assert.equal(mayRefactor(baseline({ failed }), 'edit'), false, String(failed));
  for (const tests of [undefined, '2', -1, 1.5, Number.NaN, 0, null]) assert.equal(mayRefactor(baseline({ tests }), 'edit'), false, String(tests));
  assert.equal(mayRefactor(baseline({ hashes: { 'hooks/x.ts': 'h', 'tests/helpers.ts': 'p' } }), 'edit'), false);
  assert.equal(mayRefactor(baseline({ hashes: null }), 'edit'), false);
  assert.equal(mayRefactor(baseline({ hashes: { 'lib/y.test.tsx': 'y' } }), 'edit'), true);
  assert.equal(mayRefactor(baseline({ failed: undefined }), 'edit'), false);
  assert.equal(mayRefactor(baseline({ names: ['one', 2] }), 'edit'), false);
});

test('only the options\' own words pass: not another letter case, not with a space, and a truthy claim is no claim', () => {
  for (const answer of [' Approve ', 'APPROVE', 'approve', 'Approve.', ' Approve: no behaviour change', 'APPROVE: NO BEHAVIOUR CHANGE']) {
    assert.equal(editSpecGate(answer, [NOT_YET, APPROVE, APPROVE_NO_CHANGE]).pass, false, answer);
  }
  for (const answer of [' Put it back as it was before this edit', 'PUT IT BACK AS IT WAS BEFORE THIS EDIT', 'Put it back as it was before this edit ']) assert.equal(putsBack(answer), false, answer);
  for (const offered of [1, 'true', {}, null, undefined]) assert.deepEqual(editApprovalOptions(true, offered), [NOT_YET, APPROVE], String(offered));
  assert.deepEqual(editSpecGate(3, [NOT_YET, APPROVE]), { pass: false, reason: 'the person has not approved the change (answer: none)' });
  // The question goes by the option being there, not by how many there are.
  assert.equal(editApprovalQuestion(MOD, [NOT_YET, APPROVE, 'See it first']), editApprovalQuestion(MOD, [NOT_YET, APPROVE]));
});

test('a section that opens with its text, straight after the baseline\'s last byte, is read from its first letter', () => {
  const text = `${OLD}No behaviour change: tidies the helper.\n`;
  assert.equal(changeSection(text, OLD.length), 'No behaviour change: tidies the helper.\n');
  assert.deepEqual(editSpecKept(kept, now(text), text, true), { pass: true });
  assert.equal(changeSection('abc', 1.5), '');
  assert.equal(changeSection('abc', Number.NaN), '');
});

test('no behaviour change must open the line: said later in it, or spelled otherwise, it is not said', () => {
  assert.equal(saysNoChange('## 0.1.1\n\nTidies the helper; no behaviour change.\n'), false);
  assert.equal(saysNoChange('## 0.1.1\n\nNo behavior change.\n'), false);
  assert.equal(saysNoChange('## 0.1.1\n\nNO BEHAVIOUR CHANGE\n'), true);
  const text = `${OLD}## 0.1.1\n\nTidies the helper.\n`;
  for (const claim of [1, 'true', {}, null]) assert.deepEqual(editSpecKept(kept, now(text), text, claim), { pass: true }, String(claim));
});

test('a baseline of SPEC.md that is damaged keeps nothing, and refuses: it is never read as "no SPEC.md"', () => {
  const text = `${OLD}## 0.2.0\n\nx\n`;
  const lost = { pass: false, reason: "the baseline of SPEC.md is not recorded, so what the edit may not change can't be told" };
  for (const damaged of [undefined, { length: 5, hash: null }, { length: 0 }, { hash: 'old' }, { length: -1, hash: 'old' }, 'x', 3]) {
    assert.deepEqual(editSpecKept(damaged, now(text, { approvedPartHash: null }), text, false), lost, JSON.stringify(damaged));
  }
  assert.deepEqual(editSpecKept(kept, undefined, text, false), { pass: false, reason: 'SPEC.md does not exist yet' });
});

test('an edit skill near in name or place opens nothing', () => {
  for (const name of ['editor', 'mod-builder:editor', 'EDIT', 'Edit', 'mod-builder:Edit', 'edit ', 'mod-builder:edit:x']) assert.equal(isEditSkill(skill({ skill: name }), 'mod-builder', ROOT), false, name);
  assert.equal(isEditSkill(skill({ path: '/opt/mod-builder-x/skills/edit/SKILL.md' }), 'mod-builder', ROOT), false);
  assert.equal(isEditSkill(skill({ path: null }), 'mod-builder', ROOT), false);
});

test('a damaged entry opened a build, whatever kind it names', () => {
  assert.equal(entryKind({ kind: 'edit' }), 'build');
  assert.equal(entryKind({ modDir: 'relative', kind: 'edit' }), 'build');
  assert.equal(entryKind({ modDir: 3, kind: 'edit' }), 'build');
});

test('Green refuses a record that does not say why its Red was skipped: it is never read as the looser rule', () => {
  const lost = { pass: false, reason: "the edit's record does not say why its Red was skipped" };
  for (const reason of [undefined, null, 'bogus', '', 'FIT', true]) assert.deepEqual(keptTestsGate(run(0, report(['one', 'two', 'three'])), baseline(), reason), lost, String(reason));
});

test('on the refactor route each name runs as often as the baseline had it', () => {
  const twice = baseline({ tests: 3, names: ['one', 'one', 'two'] });
  assert.deepEqual(keptTestsGate(run(0, report(['one', 'two', 'one'])), twice, 'no behaviour change'), { pass: true, tests: 3 });
  assert.deepEqual(keptTestsGate(run(0, report(['one', 'two', 'two'])), twice, 'no behaviour change'), {
    pass: false, reason: 'the run has 3 tests (one; two; two), not the 3 the mod had before this edit (one; one; two)',
  });
});

test('a run that exits 0 and still shows a failing block does not pass', () => {
  const odd = lines('', 'tests/pane.test.tsx:', '(pass) one [1ms]', '(fail) two [1ms]', '  AssertionError: x', '', ' 1 pass', ' 1 fail', 'Ran 2 tests across 1 file. [0.2s]');
  for (const reason of ['fit', 'no behaviour change']) assert.deepEqual(keptTestsGate(run(0, odd), baseline(), reason), { pass: false, reason: 'not every test passes: two' }, reason);
});

test('a test file that did not load at the baseline is no test a repair is held to: mended, its tests run instead', () => {
  const broken = baseline({ failed: ['test'], tests: 3, names: ['the file did not load', 'one', 'two'] });
  assert.deepEqual(keptTestsGate(run(0, report(['one', 'two'])), broken, 'fit'), { pass: true, tests: 2 });
  assert.deepEqual(keptTestsGate(run(0, report(['one', 'two', 'three', 'four'])), broken, 'fit'), { pass: true, tests: 4 });
  assert.deepEqual(keptTestsGate(run(0, report(['one'])), broken, 'fit'), { pass: false, reason: 'tests the mod had before this edit no longer run: two' });
  assert.deepEqual(keptTestsGate(run(0, report(['one', 'two'])), baseline({ tests: 4, names: ['the file did not load', 'one', 'two', 'two'] }), 'fit'), {
    pass: false, reason: 'the run has 2 tests, fewer than the 4 the mod had before this edit',
  });
});

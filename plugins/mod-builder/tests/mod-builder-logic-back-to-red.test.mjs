// Logic tests for the way back from Green to Red (SPEC.md 9.11, 9.30): when it is offered, the question and its
// one approving answer, how a returned Red judges its test files and its run, and what the evidence and the pane
// say of a return. The rules are pure: an odd value counts as none, and nothing here throws.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as rules from '../hooks/mod-builder-logic.ts';

const DOT = String.fromCharCode(0xb7);
const DOTS = String.fromCharCode(0x2026);
const MOD = '/work/turn-counter';
const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const ODD = [undefined, null, 'x', '2', 0, -1, 1.5, Number.NaN, true, [], {}];
const run = (exitCode, lines) => ({ exitCode, output: ['', 'tests/pane.test.tsx:', ...lines, '', ' 1 pass', ' 1 fail', 'Ran 2 tests across 1 file. [0.20s]', ''].join('\n') });
const ASSERTS = run(1, ['(pass) draws its line [1.00ms]', '(fail) counts a turn [0.40ms]', '  AssertionError: expect(received).toBe()']);
const THROWS = run(1, ['(pass) draws its line [1.00ms]', '(fail) counts a turn [0.40ms]', '  TypeError: undefined is not a function']);
const MIXED = { exitCode: 1, output: ['', 'tests/pane.test.tsx:', '(fail) counts a turn [0.40ms]', '  TypeError: x', '(fail) resets [0.40ms]', '  AssertionError: expect(received).toBe()', '', ' 0 pass', ' 2 fail', 'Ran 2 tests across 1 file. [0.20s]', ''].join('\n') };
const UNLOADED = run(1, ['(pass) draws its line [1.00ms]', '(fail) the file did not load [0.40ms]', '  SyntaxError: Unexpected token']);
const PASSES = { exitCode: 0, output: ['', 'tests/pane.test.tsx:', '(pass) draws its line [1.00ms]', '(pass) counts a turn [1.00ms]', '', ' 2 pass', ' 0 fail', 'Ran 2 tests across 1 file. [0.20s]', ''].join('\n') };
const knowledge = { latest: '2026-11-10T194027Z', checked: '2026-11-10T194027Z', pages: 10, changes: null, isRefreshing: false, version: '2.1.322', now: 1 };
const record = (phase, more = {}) => ({ ...rules.newRecord(MOD, 's1'), phase, ...more });
const model = (kept) => rules.paneModel({ sessionId: 's1', entry: { modDir: MOD, ...(kept.kind === 'edit' ? { kind: 'edit' } : {}) }, record: kept, refusals: undefined, checks: undefined, knowledge, spec: null });
const headings = (drawn) => drawn.blocks.map((block) => block.heading.map((cell) => cell.text));

test('the way back is offered from Green\'s second refusal in a row for the test run, and the count starts again after anything else', () => {
  assert.equal(rules.BACK_TO_RED_AFTER, 2);
  assert.equal(rules.greenTestRefusals(undefined, true), 1);
  assert.equal(rules.greenTestRefusals(1, true), 2);
  assert.equal(rules.greenTestRefusals(7, true), 8);
  assert.equal(rules.greenTestRefusals(7, false), 0);
  assert.equal(rules.greenTestRefusals(undefined, false), 0);
  for (const odd of ODD) assert.equal(rules.greenTestRefusals(odd, true), 1, String(odd));
  assert.deepEqual([0, 1, 2, 3].map((count) => rules.backToRedOffered(count)), [false, false, true, true]);
  for (const odd of ODD) assert.equal(rules.backToRedOffered(odd), false, String(odd));
});

test('the offer says how to ask and who decides; the answer to a call that was not offered says nobody was asked', () => {
  assert.equal(rules.BACK_TO_RED_OFFER, 'If a test is what is wrong, call the gate with back_to_red: true: mod-builder then asks the person whether to go back to Red and change the tests');
  assert.equal(rules.BACK_NOT_OFFERED, 'back_to_red is offered only at Green, after its test run has failed 2 times in a row: nobody was asked, and nothing was moved');
});

test('the question names the failing tests and how often the run failed, with "Not yet" first', () => {
  assert.deepEqual(rules.backToRedOptions(), ['Not yet', 'Go back to Red']);
  assert.equal(rules.backToRedQuestion(['counts a turn', 'resets'], 2, 0), 'Go back to Red to change the tests? Green\'s test run failed 2 times in a row. Failing: counts a turn; resets.');
  assert.equal(rules.backToRedQuestion([], 3, undefined), 'Go back to Red to change the tests? Green\'s test run failed 3 times in a row. The last run named no failing test.');
  for (const odd of ODD) assert.equal(rules.backToRedQuestion(odd, 2, 0), 'Go back to Red to change the tests? Green\'s test run failed 2 times in a row. The last run named no failing test.', String(odd));
});

test('it names ten failing tests at most and counts the rest, each on one line', () => {
  const names = Array.from({ length: 13 }, (_, index) => `test ${index + 1}`);
  assert.equal(rules.BACK_NAMED, 10);
  assert.equal(rules.backToRedQuestion(names, 2, 0).endsWith('Failing: test 1; test 2; test 3; test 4; test 5; test 6; test 7; test 8; test 9; test 10; and 3 more.'), true);
  assert.equal(rules.backToRedQuestion(['a\nb', 7, '', 'c'], 2, 0).endsWith('Failing: a b; c.'), true);
});

test('from the third return on the question opens with how often the work went back, in a build and in an edit', () => {
  assert.equal(rules.backToRedQuestion(['x'], 2, 1).startsWith('Go back to Red'), true);
  assert.equal(rules.backToRedQuestion(['x'], 2, 2), 'This build has gone back to Red 2 times already. Go back to Red to change the tests? Green\'s test run failed 2 times in a row. Failing: x.');
  assert.equal(rules.backToRedQuestion(['x'], 2, 5, 'edit').startsWith('This edit has gone back to Red 5 times already. '), true);
});

test('only "Go back to Red" goes back', () => {
  assert.deepEqual(rules.backToRedGate('Go back to Red'), { pass: true });
  for (const answer of ['Not yet', 'Approve', 'go back to red', 'Go back to Red.', '', 'Go on with these tests']) {
    assert.deepEqual(rules.backToRedGate(answer), { pass: false, reason: `the person has not agreed to go back to Red (answer: ${JSON.stringify(answer)})` });
  }
  for (const none of [null, undefined]) assert.deepEqual(rules.backToRedGate(none), { pass: false, reason: 'the person has not agreed to go back to Red (answer: none)' });
});

test('returns are counted from what the record holds, and the copy of the tests has a key of its own', () => {
  assert.equal(rules.returnsAfter(undefined), 1);
  assert.equal(rules.returnsAfter(1), 2);
  for (const odd of ODD) assert.equal(rules.returnsAfter(odd), 1, String(odd));
  assert.deepEqual([undefined, 0, 1, 2].map((count) => rules.isReturned(count)), [false, false, true, true]);
  assert.equal(rules.redCopyKey(MOD), `redcopy:${MOD}`);
  assert.notEqual(rules.redCopyKey(MOD), rules.buildKey(MOD));
});

test('a returned Red needs a test file that is not as it was: changed, added or gone', () => {
  const before = { 'tests/a.test.ts': A, 'tests/b.test.ts': B };
  assert.deepEqual(rules.returnedRedChanged(before, { ...before }), { pass: false, reason: 'no test file has changed since Red passed: the work came back to change a test' });
  assert.deepEqual(rules.returnedRedChanged(before, { ...before, 'tests/a.test.ts': B }), { pass: true });
  assert.deepEqual(rules.returnedRedChanged(before, { ...before, 'tests/c.test.ts': A }), { pass: true });
  assert.deepEqual(rules.returnedRedChanged(before, { 'tests/a.test.ts': A }), { pass: true });
  for (const odd of [undefined, null, 'x', 7, []]) {
    assert.deepEqual(rules.returnedRedChanged(odd, before), { pass: false, reason: 'the test files could not be compared with those of the Red before' });
    assert.deepEqual(rules.returnedRedChanged(before, odd), { pass: false, reason: 'the test files could not be compared with those of the Red before' });
  }
});

test('its run may pass, or fail by assertion: the code exists by then', () => {
  assert.deepEqual(rules.returnedRedGate(PASSES), { pass: true, tests: 2 });
  assert.deepEqual(rules.returnedRedGate(ASSERTS), { pass: true, tests: 2 });
  assert.deepEqual(rules.returnedRedGate(MIXED), { pass: true, tests: 2 });
});

test('it is refused when no failing test fails by assertion, when a file did not load, and when the run can\'t be read', () => {
  assert.deepEqual(rules.returnedRedGate(THROWS), { pass: false, reason: 'no failing test fails by assertion: counts a turn' });
  assert.deepEqual(rules.returnedRedGate(UNLOADED), { pass: false, reason: 'a test file did not load' });
  assert.deepEqual(rules.returnedRedGate({ exitCode: 1, output: 'Ran 2 tests across 1 file. [0.20s]\n' }), { pass: false, reason: 'claude plugin test failed, but its output holds no (fail) block' });
  assert.deepEqual(rules.returnedRedGate({ exitCode: 0, output: 'nothing' }), { pass: false, reason: 'the test run\'s last line reports no test count' });
  assert.deepEqual(rules.returnedRedGate({ exitCode: null, output: 'x' }), { pass: false, reason: 'claude plugin test ended with no exit code' });
  assert.deepEqual(rules.returnedRedGate(undefined), { pass: false, reason: 'claude plugin test ended with no exit code' });
});

test('the evidence says what the run came to, and ends with where the work came from', () => {
  assert.equal(rules.returnedRedRan(PASSES), '2 tests ran, all passing');
  assert.equal(rules.returnedRedRan(ASSERTS), '2 tests ran, 1 failing');
  assert.equal(rules.returnedRedRan({ exitCode: 0, output: 'nothing' }), 'the tests ran');
  assert.equal(rules.backFromGreen(1), 'back from Green (return 1)');
  assert.equal(rules.backFromGreen(3), 'back from Green (return 3)');
  assert.equal(rules.wentBackAnswer(2), 'the person answered "Go back to Red" (return 2). Test files are open again and everything else is closed; nothing in the mod was changed. Change the tests that are wrong, then call the gate');
});

test('the pane says a Red is one the work came back to, in its block and in the status line, and nothing of it otherwise', () => {
  const back = model(record('red', { returns: 2 }));
  assert.deepEqual(headings(back).at(-1), ['5 Red', `working${DOTS}`, `back from Green ${DOT} return 2`]);
  assert.equal(back.blocks.at(-1).heading[2].tone, 'warning');
  assert.equal(back.status, `red ${DOT} back from Green ${DOT} return 2`);
  const first = model(record('red'));
  assert.deepEqual(headings(first).at(-1), ['5 Red', `working${DOTS}`]);
  assert.equal(first.status, 'red');
  for (const odd of ODD) assert.equal(model(record('red', { returns: odd })).status, 'red', String(odd));
  const green = model(record('green', { returns: 2 }));
  assert.equal(green.status, 'green');
  assert.equal(JSON.stringify(green).includes('back from Green'), false);
  assert.equal(rules.backFromGreenShort(0), '');
  assert.equal(rules.backFromGreenShort(1), `back from Green ${DOT} return 1`);
});

test('an edit\'s returned Red says so with its own phase number', () => {
  const back = model(record('red', { kind: 'edit', returns: 1, baseline: undefined }));
  assert.equal(back.status, `red ${DOT} back from Green ${DOT} return 1`);
});

test('Done keeps the count under "What was checked", and says nothing when the work never went back', () => {
  const rows = (drawn) => drawn.blocks.find((block) => block.heading[0]?.text === 'What was checked').rows.map((row) => row.map((cell) => cell.text).join(' '));
  assert.equal(rows(model(record('done', { returns: 1 }))).includes('  went back from Green to Red once'), true);
  assert.equal(rows(model(record('done', { returns: 3 }))).includes('  went back from Green to Red 3 times'), true);
  assert.equal(rows(model(record('done'))).some((row) => row.includes('went back')), false);
  assert.equal(rules.wentBack(0), '');
  for (const odd of ODD) assert.equal(rules.wentBack(odd), '', String(odd));
});

test('a returned Red whose run ran no test is refused', () => {
  assert.deepEqual(rules.returnedRedGate({ exitCode: 0, output: ['', ' 0 pass', ' 0 fail', 'Ran 0 tests across 1 file. [0.20s]', ''].join('\n') }), { pass: false, reason: 'the test run ran no test' });
});

test('8.4\'s question says what the files are compared with: the mod before this edit, or the tests as they were when Red passed', () => {
  const files = [{ path: 'tests/a.test.ts', before: 'one\nexpect(a).toBe(1)\n', after: 'one\n' }];
  assert.equal(rules.testChangeQuestion(files, []).split('\n')[0], 'These test files are not as they were before this edit:');
  assert.equal(rules.testChangeQuestion(files, [], 'edit').split('\n')[0], 'These test files are not as they were before this edit:');
  const asked = rules.testChangeQuestion(files, ['counts a turn'], 'red').split('\n');
  assert.equal(asked[0], 'These test files are not as they were when Red passed:');
  assert.deepEqual(asked.slice(1), ['- tests/a.test.ts: 0 lines added, 1 line removed', '    removed: expect(a).toBe(1)', 'These tests no longer exist: counts a turn', 'Go on with these changes?']);
});

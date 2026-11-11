// Logic tests for what the driving session's review of step 2 asked of the pane's rules (SPEC.md 8.22): a sha256
// shown by its first 12 characters and several types files by their count, a result beside Verify's test and
// typecheck rows, the mod's own name in the load's rows from the start, and the record a session stopped last
// kept in view.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as rules from '../hooks/mod-builder-logic.ts';

// Taken from the module as a whole, so that a rule not built yet fails the tests that use it and no others.
const { paneModel, newChecks, withCheck, withResult, readChecks, settledChecks, testResult, typecheckResult, stoppedKey, newRecord } = rules;

const DOT = String.fromCharCode(0xb7);
const MOD = '/work/turn-counter';
const ONE = '961c15e9ad38505611e6ab25090b7e935f949a2887922a177e6bd53fccd8c950';
const TWO = 'a33c3b254b7c9df7fc777fa7be9c889688a5f1ae787ae516f22ab39ca3727d76';
const knowledge = { latest: '2026-11-10T194027Z', checked: '2026-11-10T194027Z', pages: 10, changes: null, isRefreshing: false, version: '2.1.322', now: Date.UTC(2026, 10, 12, 20) };
const record = (phase, more = {}) => ({ ...newRecord(MOD, 's1'), phase, ...more });
const input = (more = {}) => ({ sessionId: 's1', entry: { modDir: MOD }, record: undefined, refusals: undefined, checks: undefined, knowledge, spec: null, ...more });
const BASELINE = { version: '0.1.0', tests: 2, names: ['a', 'b'], hashes: {}, spec: { length: 14, hash: 'h' }, failed: [], restore: '/home/u/r', at: 1000 };
const editing = (phase, more = {}) => record(phase, { kind: 'edit', red: 'edit', baseline: BASELINE, evidence: { baseline: 'passes its four checks (2 tests); version 0.1.0; restore point /home/u/r' }, ...more });
const texts = (block) => block.rows.map((row) => row.map((cell) => cell.text));
const titleOf = (block) => block.heading.map((cell) => cell.text).join(' ');
const block = (model, heading) => model.blocks.find((one) => titleOf(one) === heading);
const CHECKS = 'Each check is a command mod-builder ran itself';
const LOAD = 'Headless load: what the debug log must show';

// ---------------------------------------------------------------------------------------------------- hashes

test('a gate\'s evidence shows one types hash by its first 12 characters, and two or more as their count', () => {
  const evidence = { scaffold: `claude plugin validate --strict exited 0; 2 tests ran; the typecheck passes (types sha256 ${ONE})`, red: `3 tests ran; the typecheck passes (types sha256 ${ONE}, ${TWO}); 2 files under tests/ hashed` };
  const model = paneModel(input({ record: record('green', { evidence }) }));
  assert.deepEqual(texts(block(model, '4 Scaffold passed')), [['  claude plugin validate --strict exited 0'], ['  2 tests ran'], ['  the typecheck passes (types sha256 961c15e9ad38)']]);
  assert.deepEqual(texts(block(model, '5 Red passed')), [['  3 tests ran'], ['  the typecheck passes (2 types files)'], ['  2 files under tests/ hashed']]);
});

test('Done shows the "Built on" line with each hash cut to 12 characters, and what was checked with the types by their count', () => {
  const builtOn = `Built on Claude Code 2.1.322, from the docs snapshot 2026-11-10T194027Z, against the types sha256 ${ONE}, ${TWO}.`;
  const verify = `validate, 3 tests, the typecheck (types sha256 ${ONE}, ${TWO}) and a headless load of turns all pass`;
  const model = paneModel(input({ record: record('done', { evidence: { verify }, finished: { version: '0.1.0', files: 6, tests: 3, command: null, builtOn } }) }));
  assert.deepEqual(texts(block(model, 'What was built'))[1], ['  Built on Claude Code 2.1.322, from the docs snapshot 2026-11-10T194027Z, against the types sha256 961c15e9ad38, a33c3b254b7c.']);
  assert.deepEqual(texts(block(model, 'What was checked')), [['  validate, 3 tests, the typecheck (2 types files) and a headless load of turns all pass']]);
});

test('only a whole sha256 is cut: a shorter or a longer run of hex digits, and a hash in other words, stay as they are', () => {
  const evidence = { scaffold: `short ${ONE.slice(0, 40)}; long ${ONE}0; the spec sha256 ${ONE}; types sha256 nothing` };
  const model = paneModel(input({ record: record('red', { evidence }) }));
  assert.deepEqual(texts(block(model, '4 Scaffold passed')), [[`  short ${ONE.slice(0, 40)}`], [`  long ${ONE}0`], ['  the spec sha256 961c15e9ad38'], ['  types sha256 nothing']]);
});

test('an edit\'s baseline rows are cut the same way', () => {
  const model = paneModel(input({ entry: { modDir: MOD, kind: 'edit' }, record: editing('green', { evidence: { baseline: `passes its four checks (2 tests); the typecheck ran against types sha256 ${ONE}, ${TWO}` } }) }));
  assert.deepEqual(texts(block(model, 'Baseline the mod as it stood')), [['  passes its four checks (2 tests)'], ['  the typecheck ran against 2 types files']]);
});

// --------------------------------------------------------------------------------------------- Verify's rows

test('a check\'s result is kept beside its state, read back as far as it can be, and survives the gate ending', () => {
  const started = newChecks('s1', 'verify', 'turns');
  assert.deepEqual(started.results, {});
  const some = withResult(withCheck(started, 'test', 'passed'), 'test', '6 of 6');
  assert.deepEqual(some, { sessionId: 's1', phase: 'verify', name: 'turns', states: { validate: 'waiting', test: 'passed', typecheck: 'waiting', load: 'waiting' }, results: { test: '6 of 6' } });
  assert.deepEqual(started.results, {});
  assert.deepEqual(readChecks(some, 's1', 'verify'), some);
  assert.deepEqual(settledChecks(some).results, { test: '6 of 6' });
  assert.deepEqual(withResult(some, 'typecheck', '0 errors').results, { test: '6 of 6', typecheck: '0 errors' });
  for (const none of ['', '  ', null, undefined, 7]) assert.deepEqual(withResult(some, 'typecheck', none), some);
  assert.deepEqual(withResult(some, 'typecheck', ' 2 errors\n').results, { test: '6 of 6', typecheck: '2 errors' });
  assert.deepEqual(withResult({ ...some, results: 'x' }, 'typecheck', '0 errors').results, { typecheck: '0 errors' });
  assert.deepEqual(withResult(some, 'nothing', 'x'), some);
  for (const none of [null, undefined, 'x', 3]) assert.equal(withResult(none, 'test', 'x'), none);
  assert.deepEqual(withResult({ sessionId: 's1', phase: 'verify', name: '', states: started.states }, 'test', 'x').results, { test: 'x' });
  assert.deepEqual(readChecks({ ...some, results: { test: 7, typecheck: ' 0 errors\n', bogus: 'x' } }, 's1', 'verify').results, { typecheck: '0 errors' });
  assert.deepEqual(readChecks({ ...some, results: 'x' }, 's1', 'verify').results, {});
});

test('the test run\'s result is how many passed of how many ran, and the typecheck\'s is its count of error lines', () => {
  const lines = (...text) => `${text.join('\n')}\n`;
  assert.equal(testResult(lines('', 'tests/a.test.ts:', '(pass) one [1ms]', '(pass) two [1ms]', '', ' 2 pass', ' 0 fail', 'Ran 2 tests across 1 file. [0.2s]')), '2 of 2');
  assert.equal(testResult(lines('', 'tests/a.test.ts:', '(pass) one [1ms]', '(fail) two [1ms]', '  AssertionError: x', '', ' 1 pass', ' 1 fail', 'Ran 2 tests across 1 file. [0.2s]')), '1 of 2');
  for (const none of ['', 'no count here\n', null, undefined, 7]) assert.equal(testResult(none), '');
  assert.equal(testResult(lines('', 'tests/a.test.ts:', '(fail) one [1ms]', '  AssertionError: x', '(fail) two [1ms]', '  AssertionError: y', '', ' 0 pass', ' 2 fail', 'Ran 2 tests across 1 file. [0.2s]')), '0 of 2');
  assert.equal(testResult(lines('', 'tests/a.test.ts:', '(fail) one [1ms]', '  AssertionError: x', '(fail) two [1ms]', '  AssertionError: y', '', 'Ran 1 test across 1 file. [0.2s]')), '');
  const ran = (exitCode, output, errors = '') => ({ exitCode, output, errors });
  assert.equal(typecheckResult(ran(0, '')), '0 errors');
  assert.equal(typecheckResult(ran(2, "hooks/register.tsx(3,7): error TS2322: Type 'string' is not assignable to type 'number'.\n")), '1 error');
  assert.equal(typecheckResult(ran(2, 'a.ts(1,1): error TS1005: x\n  a line that quotes "an error TS1005: in passing"\nerror TS18003: No inputs were found.\nb.ts(2,2): error TS2304: y\n')), '3 errors');
  assert.equal(typecheckResult(ran(2, '', 'a.ts(1,1): error TS1005: x\n')), '1 error');
  assert.equal(typecheckResult(ran(0, 'a note\n', 'a.ts(1,1): error TS1005: x\n')), '0 errors');
  // A compiler that failed and printed no error line showed no count: "0 errors" beside it would be false.
  assert.equal(typecheckResult(ran(127, 'npx: command not found\n')), '');
  assert.equal(typecheckResult(ran(1, '')), '');
  for (const none of [null, undefined, 7, 'x', ran(Number.NaN, ''), ran(0, 7), { exitCode: 0 }]) assert.equal(typecheckResult(none), '');
});

test('Verify: a check that ended shows its result at the end of its row, and one still waiting or running shows none', () => {
  let checks = newChecks('s1', 'verify', 'turns');
  checks = withResult(withCheck(withCheck(checks, 'validate', 'passed'), 'test', 'passed'), 'test', '6 of 6');
  checks = withResult(withCheck(checks, 'typecheck', 'running'), 'typecheck', '0 errors');
  const running = block(paneModel(input({ record: record('verify'), checks })), CHECKS);
  assert.deepEqual(texts(running), [
    ['  passed', 'validate', 'claude plugin validate --strict /work/turn-counter'],
    ['  passed', 'test', 'claude plugin test /work/turn-counter', '6 of 6'],
    ['  running', 'typecheck', 'tsc against the 2.1.322 types'],
    ['  waiting', 'headless load', 'claude --plugin-dir /work/turn-counter -p /cost'],
  ]);
  assert.deepEqual(running.rows[1][3], { text: '6 of 6', tone: 'dim', width: 10 });
  const failed = block(paneModel(input({ record: record('verify'), checks: withResult(withCheck(checks, 'typecheck', 'failed'), 'typecheck', '2 errors') })), CHECKS);
  assert.deepEqual(texts(failed)[2], ['  failed', 'typecheck', 'tsc against the 2.1.322 types', '2 errors']);
  // A result left beside a check that waits again (the gate ended before it finished) is not drawn.
  const left = block(paneModel(input({ record: record('verify'), checks: withResult(newChecks('s1', 'verify', 'turns'), 'test', '6 of 6') })), CHECKS);
  assert.deepEqual(texts(left)[1], ['  waiting', 'test', 'claude plugin test /work/turn-counter']);
  const green = block(paneModel(input({ record: record('green'), checks: withResult(withCheck(newChecks('s1', 'green', 'turns'), 'test', 'failed'), 'test', '1 of 2') })), CHECKS);
  assert.deepEqual(texts(green)[1], ['  failed', 'test', 'claude plugin test /work/turn-counter', '1 of 2']);
});

test('the load\'s rows name the mod from the start: the name the pane is given, until the gate has written its own', () => {
  const first = (model) => texts(block(model, LOAD))[0];
  assert.deepEqual(first(paneModel(input({ record: record('verify'), name: 'turns' }))), ['  waiting', 'hooks module turns@inline loaded']);
  assert.deepEqual(first(paneModel(input({ record: record('verify'), name: 'turns', checks: newChecks('s1', 'verify', '') }))), ['  waiting', 'hooks module turns@inline loaded']);
  assert.deepEqual(first(paneModel(input({ record: record('verify'), name: 'given', checks: withCheck(newChecks('s1', 'verify', 'written'), 'load', 'running') }))), ['  running', 'hooks module written@inline loaded']);
  for (const none of [undefined, null, '', 7, {}]) assert.deepEqual(first(paneModel(input({ record: record('verify'), name: none }))), ['  waiting', 'hooks module the mod@inline loaded']);
  assert.deepEqual(first(paneModel(input({ record: record('verify'), name: 'a\nb' }))), ['  waiting', 'hooks module a b@inline loaded']);
});

// ----------------------------------------------------------------------------------------- what was stopped

test('what a session stopped last is under a key of the session\'s own', () => {
  assert.equal(stoppedKey('s1'), 'stopped:s1');
});

test('with nothing open, the record this session stopped last is drawn: the header says stopped, the rail is dim, and a build\'s folder is left as it is', () => {
  const stopped = record('green', { stopped: true, evidence: { scaffold: 'validated' } });
  const model = paneModel(input({ entry: undefined, stopped }));
  assert.deepEqual(model.header, { title: 'MOD BUILDER', state: `turn-counter ${DOT} stopped at Green`, tone: 'warning' });
  assert.equal(model.isRailDim, true);
  assert.equal(model.rail.length, 8);
  assert.equal(model.rail.some((item) => item.state === 'current'), false);
  assert.deepEqual(model.blocks.map(titleOf), ['Stopped', '4 Scaffold passed']);
  assert.deepEqual(block(model, 'Stopped').rows, [[{ text: '  the folder is left as it is' }, { text: '/work/turn-counter', tone: 'dim' }]]);
  assert.equal(model.status, null);
  for (const entry of [null, 'x', 7]) assert.equal(paneModel(input({ entry, stopped })).header.state, `turn-counter ${DOT} stopped at Green`);
});

test('a stopped edit says which answer was given and names the two folders: put back, kept, and when nobody answered', () => {
  const beside = '/work/turn-counter.stopped-2026-11-11T064439Z';
  const of = (stop) => texts(block(paneModel(input({ entry: undefined, stopped: editing('red', { stopped: true, ...(stop === undefined ? {} : { stop }) }) })), 'Stopped'));
  assert.deepEqual(of({ answer: 'Put it back', beside }), [['  the person answered "Put it back"'], ['  the mod, as before the edit', '/work/turn-counter'], ['  as it was when stopped', beside]]);
  assert.deepEqual(of({ answer: 'Keep it as it is', beside: null }), [['  the person answered "Keep it as it is"'], ['  the mod, as it is now', '/work/turn-counter'], ['  its restore point', '/home/u/r']]);
  assert.deepEqual(of({ answer: null, beside: null }), [['  nobody answered: the mod is kept as it is now'], ['  the mod, as it is now', '/work/turn-counter'], ['  its restore point', '/home/u/r']]);
  // Until the stop has written an answer (the person may still be being asked), none is said.
  assert.deepEqual(of(undefined), [['  the mod, as it is now', '/work/turn-counter'], ['  its restore point', '/home/u/r']]);
  for (const damaged of ['x', 7, []]) assert.deepEqual(of(damaged), [['  the mod, as it is now', '/work/turn-counter'], ['  its restore point', '/home/u/r']]);
  assert.deepEqual(of({ answer: 7, beside: {} })[0], ['  nobody answered: the mod is kept as it is now']);
  const model = paneModel(input({ entry: undefined, stopped: editing('red', { stopped: true, stop: { answer: 'Put it back', beside } }) }));
  assert.equal(model.header.state, `turn-counter ${DOT} edit of 0.1.0 ${DOT} stopped at Red`);
  assert.equal(model.rail.length, 7);
  assert.deepEqual(block(model, 'Stopped').rows[1], [{ text: '  the mod, as before the edit', width: 30 }, { text: '/work/turn-counter', tone: 'dim' }]);
});

test('what was stopped is drawn only when nothing is open, only as this session\'s, and only when it is stopped', () => {
  const stopped = record('green', { stopped: true });
  const none = 'no build or edit in this session';
  assert.equal(paneModel(input({ entry: undefined, stopped: undefined })).header.state, none);
  assert.equal(paneModel(input({ entry: undefined, stopped: record('green') })).header.state, none);
  assert.equal(paneModel(input({ entry: undefined, stopped: { ...stopped, sessionId: 's2' } })).header.state, none);
  assert.equal(paneModel(input({ entry: undefined, stopped: record('green', { stopped: 'yes' }) })).header.state, none);
  for (const damaged of ['x', 7, [], {}]) assert.equal(paneModel(input({ entry: undefined, stopped: damaged })).header.state, none);
  // A build or an edit that is open is what is drawn, whatever was stopped before it.
  assert.equal(paneModel(input({ entry: { modDir: null }, stopped })).header.state, `a new mod ${DOT} its folder is not named yet`);
  assert.equal(paneModel(input({ entry: { modDir: '/work/other' }, record: { ...record('spec'), modDir: '/work/other' }, stopped })).header.state, `other ${DOT} SPEC.md not written yet`);
});

test('a refused gate\'s reason shows each sha256 by its first 12 characters', () => {
  const attempt = { phase: 'verify', reason: `the "Built" block of SPEC.md does not hold the sha256 of the types this gate checks against (expected: ${ONE}, ${TWO})`, failing: [], passed: null, tests: null };
  const model = paneModel(input({ record: record('verify', { attempt }) }));
  assert.deepEqual(model.blocks.at(-1).rows, [[{ text: '  not passed: the "Built" block of SPEC.md does not hold the sha256 of the types this gate checks against (expected: 961c15e9ad38, a33c3b254b7c)', tone: 'warning' }]]);
});

// Logic tests for what the gates do with a record or a reading that is not what it should be (SPEC.md 3.3,
// "Advancing on evidence, never on the model's word"): a gate that cannot compare refuses; it never passes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scaffoldGate, redGate, greenGate, verifyGate, hashGate, changedFiles, specKept, parseStamp, isCacheStale,
  mayWrite, writeVerdict, nextPhase, pathInMod,
} from '../hooks/mod-builder-logic.ts';

const lines = (...text) => `${text.join('\n')}\n`;
const run = (exitCode, output = '') => ({ exitCode, output });
const THREE_PASS = lines('', 'tests/pane.test.tsx:', '(pass) one [1.00ms]', '(pass) two [1.00ms]', '(pass) three [1.00ms]', '', ' 3 pass', ' 0 fail',
  'Ran 3 tests across 1 file. [0.21s]');
const ONE_FAILS = lines('', 'tests/logic.test.ts:', '(pass) one [2.11ms]', '(fail) two [0.48ms]', '  AssertionError: expect(received).toBe()', '', ' 1 pass', ' 1 fail',
  'Ran 2 tests across 1 file. [0.20s]');
const NOT_A_COUNT = [NaN, -1, -5, 1.5, Infinity, -Infinity, undefined, null, '1', '', true, false, [], [1], {}];
const NOT_A_CODE = [null, undefined, NaN, '0', '1', 1.5, true, {}];
const NOT_A_RUN = [null, undefined, 0, 'ok', [], {}, { exitCode: 0 }, { output: THREE_PASS }, { exitCode: 0, output: 3 }, { exitCode: 0, output: null }];
const goodRuns = () => ({ validate: run(0), test: run(0, THREE_PASS), typecheck: run(0), load: run(0), loadShown: true });

test('the red gate refuses when the count recorded at Scaffold is no count, whatever the run shows', () => {
  for (const recorded of NOT_A_COUNT) {
    assert.deepEqual(redGate(run(1, ONE_FAILS), recorded, []), { pass: false, reason: 'no test count is recorded from Scaffold' }, String(recorded));
  }
  assert.deepEqual(redGate(run(1, ONE_FAILS), 0, []), { pass: true, tests: 2 });
  assert.deepEqual(redGate(run(0, THREE_PASS), NaN, []), { pass: false, reason: 'no test count is recorded from Scaffold' });
});

test('the green gate refuses when the count recorded at Red is no count, though every test passes', () => {
  for (const recorded of NOT_A_COUNT) {
    assert.deepEqual(greenGate(run(0, THREE_PASS), recorded), { pass: false, reason: 'no test count is recorded from Red' }, String(recorded));
  }
  assert.deepEqual(greenGate(run(0, THREE_PASS), 0), { pass: true, tests: 3 });
});

test('the verify gate refuses when the count recorded at Red is no count', () => {
  for (const recorded of NOT_A_COUNT) {
    assert.deepEqual(verifyGate(goodRuns(), recorded), { pass: false, reason: 'no test count is recorded from Red' }, String(recorded));
  }
  assert.deepEqual(verifyGate(goodRuns(), 0), { pass: true, tests: 3 });
  assert.deepEqual(verifyGate({ ...goodRuns(), validate: run(1) }, NaN), { pass: false, reason: 'no test count is recorded from Red' });
});

test('a command that ended with no exit code, as one killed by a signal does, passes no gate', () => {
  for (const code of NOT_A_CODE) {
    const label = String(code);
    assert.deepEqual(redGate(run(code, ONE_FAILS), 1, ['one']), { pass: false, reason: 'claude plugin test ended with no exit code' }, label);
    assert.deepEqual(greenGate(run(code, THREE_PASS), 3), { pass: false, reason: 'claude plugin test ended with no exit code' }, label);
    assert.deepEqual(scaffoldGate(run(code), run(0, THREE_PASS)), { pass: false, reason: 'claude plugin validate --strict ended with no exit code' }, label);
    assert.deepEqual(scaffoldGate(run(0), run(code, THREE_PASS)), { pass: false, reason: 'claude plugin test ended with no exit code' }, label);
    assert.deepEqual(verifyGate({ ...goodRuns(), validate: run(code) }, 3), { pass: false, reason: 'claude plugin validate --strict ended with no exit code' }, label);
    assert.deepEqual(verifyGate({ ...goodRuns(), test: run(code, THREE_PASS) }, 3), { pass: false, reason: 'claude plugin test ended with no exit code' }, label);
    assert.deepEqual(verifyGate({ ...goodRuns(), typecheck: run(code) }, 3), { pass: false, reason: 'the typecheck ended with no exit code' }, label);
    assert.deepEqual(verifyGate({ ...goodRuns(), load: run(code) }, 3), { pass: false, reason: 'the headless load ended with no exit code' }, label);
  }
});

test('a run that is no run is refused, not thrown at and not passed', () => {
  for (const bad of NOT_A_RUN) {
    const label = JSON.stringify(bad) ?? String(bad);
    assert.equal(redGate(bad, 1, ['one']).pass, false, label);
    assert.equal(greenGate(bad, 3).pass, false, label);
    assert.equal(scaffoldGate(bad, run(0, THREE_PASS)).pass, false, label);
    assert.equal(scaffoldGate(run(0), bad).pass, false, label);
    for (const field of ['validate', 'test', 'typecheck', 'load']) {
      assert.equal(verifyGate({ ...goodRuns(), [field]: bad }, 3).pass, false, `${field} ${label}`);
    }
  }
  for (const runs of [null, undefined, {}, 'runs']) assert.equal(verifyGate(runs, 3).pass, false, String(runs));
  assert.match(redGate(null, 1, ['one']).reason, /ended with no exit code/);
});

test('a hash record that is no record is refused, and so is a reading that is none', () => {
  const good = { 'tests/a.test.ts': 'bb' };
  for (const bad of [null, undefined, 'x', 3, []]) {
    assert.deepEqual(hashGate(bad, good), { pass: false, reason: 'no hashes are recorded for tests/' }, String(bad));
    assert.deepEqual(hashGate(good, bad), { pass: false, reason: 'the files under tests/ could not be read' }, String(bad));
    assert.deepEqual(changedFiles(bad, bad), [], String(bad));
  }
  assert.deepEqual(hashGate({ 'tests/a.test.ts': null }, { 'tests/a.test.ts': null }), { pass: false, reason: 'not as recorded: tests/a.test.ts (changed)' });
  assert.deepEqual(hashGate({ 'tests/a.test.ts': '' }, { 'tests/a.test.ts': '' }), { pass: false, reason: 'not as recorded: tests/a.test.ts (changed)' });
});

test('a SPEC.md record with no length or no hash is refused at every gate, whatever the file is now', () => {
  const now = { length: 120, hash: 'aa', approvedPartHash: 'aa' };
  for (const recorded of [null, undefined, {}, { length: 120 }, { hash: 'aa' }, { length: NaN, hash: 'aa' }, { length: -1, hash: 'aa' }, { length: 120, hash: '' }, { length: '120', hash: 'aa' }]) {
    for (const phase of ['scaffold', 'red', 'green', 'verify', 'done']) {
      assert.deepEqual(specKept(recorded, now, phase), { pass: false, reason: 'no approved SPEC.md is recorded' }, `${JSON.stringify(recorded)} ${phase}`);
      assert.deepEqual(specKept(recorded, {}, phase), { pass: false, reason: 'no approved SPEC.md is recorded' }, `${JSON.stringify(recorded)} ${phase}`);
    }
  }
  for (const phase of ['green', 'verify']) {
    assert.equal(specKept({ length: 120, hash: 'aa' }, {}, phase).pass, false, phase);
    assert.equal(specKept({ length: 120, hash: 'aa' }, { length: 120 }, phase).pass, false, phase);
    assert.equal(specKept({ length: 120, hash: 'aa' }, 'text', phase).pass, false, phase);
  }
  assert.equal(specKept({ length: 120, hash: 'aa' }, now, 'Verify').pass, false);
  assert.equal(specKept({ length: 120, hash: 'aa' }, now, undefined).pass, false);
});

test('a phase that is none may write nothing, and has no next', () => {
  for (const phase of ['Red', 'RED', '', undefined, null, 5, {}]) {
    assert.equal(mayWrite(phase, 'README.md'), false, String(phase));
    assert.deepEqual(writeVerdict(phase, 'README.md'), { allowed: false, reason: "mod-builder: README.md can't be written: the build's record names no phase." }, String(phase));
    assert.equal(nextPhase(phase), null, String(phase));
  }
});

test('a path that is no text may not be written, and is in no mod', () => {
  for (const path of [undefined, null, 5, {}, ['tests/a.ts']]) {
    for (const phase of ['scaffold', 'green', 'verify', 'done']) assert.equal(mayWrite(phase, path), false, `${phase} ${String(path)}`);
    assert.equal(writeVerdict('scaffold', path).allowed, false, String(path));
    assert.equal(pathInMod('/work/mod', path, '/work'), null, String(path));
    assert.equal(pathInMod(path, '/work/mod/a.ts', '/work'), null, String(path));
    assert.equal(pathInMod('/work/mod', 'a.ts', path), null, String(path));
  }
});

test('a clock reading that is no time counts as stale, as a checked that is no stamp does', () => {
  const state = { isInteractive: true, refreshDays: 7, checked: '2026-11-10T151216Z', version: '2.1.322', versionAtCheck: '2.1.322' };
  for (const now of [NaN, Infinity, -Infinity, undefined, null, '1794323536000', true, [], new Date(Date.UTC(2026, 10, 10, 15, 12, 16))]) {
    assert.equal(isCacheStale({ ...state, now }), true, String(now));
  }
  assert.equal(isCacheStale({ ...state, now: NaN, isInteractive: false }), false);
  assert.equal(isCacheStale({ ...state, now: NaN, refreshDays: 0 }), false);
});

test('a checked that is no text is no stamp, and is stale', () => {
  const state = { isInteractive: true, refreshDays: 7, now: Date.UTC(2026, 10, 10, 15, 12, 16), version: '2.1.322', versionAtCheck: '2.1.322' };
  for (const checked of [undefined, 1794323536000, {}, [], true]) {
    assert.equal(parseStamp(checked), null, String(checked));
    assert.equal(isCacheStale({ ...state, checked }), true, String(checked));
  }
});

test('a session whose version is not known is judged by age alone; a known one with none recorded is stale', () => {
  const state = { isInteractive: true, refreshDays: 7, checked: '2026-11-10T151216Z', now: Date.UTC(2026, 10, 10, 15, 12, 16) };
  const day = 24 * 60 * 60 * 1000;
  for (const version of [null, undefined, '', 5]) {
    assert.equal(isCacheStale({ ...state, version, versionAtCheck: '2.1.322' }), false, String(version));
    assert.equal(isCacheStale({ ...state, version, versionAtCheck: null }), false, String(version));
    assert.equal(isCacheStale({ ...state, version, versionAtCheck: null, now: state.now + 8 * day }), true, String(version));
  }
  assert.equal(isCacheStale({ ...state, version: '2.1.322', versionAtCheck: undefined }), true);
  assert.equal(isCacheStale({ ...state, version: '2.1.322', versionAtCheck: '' }), true);
});

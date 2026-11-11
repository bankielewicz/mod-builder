// Logic tests for SPEC.md 7.11: Scaffold to Red also requires the test run to exit 0, judged after validate. A
// scaffold whose tests fail, or whose module throws as it loads, can't leave Scaffold: everything but tests/ closes
// when Scaffold passes, and Red takes no failure that does not open with an assertion error.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scaffoldGate } from '../hooks/mod-builder-logic.ts';

const run = (exitCode, output = '') => ({ exitCode, output });
const report = (passed, failed) => `\n ${passed} pass\n ${failed} fail\nRan ${passed + failed} tests across 1 file. [0.20s]\n`;
const refused = (code) => ({ pass: false, reason: `claude plugin test exited ${code}: not every test of the scaffold passes` });

test('the scaffold gate refuses a test run that does not exit 0, though its report has a count', () => {
  assert.deepEqual(scaffoldGate(run(0, 'Validation passed'), run(1, report(1, 1))), refused(1));
  assert.deepEqual(scaffoldGate(run(0), run(1, report(0, 2))), refused(1));
  assert.deepEqual(scaffoldGate(run(0), run(2, report(2, 0))), refused(2));
  assert.deepEqual(scaffoldGate(run(0), run(-1, report(2, 0))), refused(-1));
});

test('a test run that did not exit 0 and shows no count is refused for its exit code', () => {
  assert.deepEqual(scaffoldGate(run(0), run(1, 'claude plugin test: no hooks module to load\n')), refused(1));
  assert.deepEqual(scaffoldGate(run(0), run(1)), refused(1));
});

test('validate is judged first: with both failing, the refusal is validate\'s', () => {
  assert.deepEqual(scaffoldGate(run(1, 'Validation failed'), run(1, report(0, 2))), { pass: false, reason: 'claude plugin validate --strict exited 1' });
});

test('a test run that ended with no exit code is refused as before, and one that exits 0 passes with its count', () => {
  assert.deepEqual(scaffoldGate(run(0), run(Number.NaN, report(2, 0))), { pass: false, reason: 'claude plugin test ended with no exit code' });
  assert.deepEqual(scaffoldGate(run(0), run(0, report(2, 0))), { pass: true, tests: 2 });
  assert.deepEqual(scaffoldGate(run(0), run(0, 'no count here\n')), { pass: false, reason: "the test run's last line reports no test count" });
});

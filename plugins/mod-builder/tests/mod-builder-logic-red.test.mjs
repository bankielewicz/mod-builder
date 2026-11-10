// Logic tests for the Red gate's rule in SPEC.md 3.3 (Red to Green): every (fail) block's first line is an
// assertion error, and at least one failing test has a name that no test had at Scaffold. The outputs below are
// what `claude plugin test` 2.1.322 printed for a throwaway mod, with its folder's path shortened.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as logic from '../hooks/mod-builder-logic.ts';

const { redGate, scaffoldGate } = logic;
// Read at the call, so a build that has no testNames yet fails each test that needs it, not the whole file.
const testNames = (output) => logic.testNames(output);

const lines = (...text) => `${text.join('\n')}\n`;
const run = (exitCode, output = '') => ({ exitCode, output });

// The run at Scaffold: two tests, both passing.
const AT_SCAFFOLD = lines(
  '',
  'tests/logic.test.ts:',
  '(pass) spec is followed by scaffold [1.71ms]',
  '(pass) a group > inner pass [0.42ms]',
  '',
  ' 2 pass',
  ' 0 fail',
  'Ran 2 tests across 1 file. [0.16s]',
);
const SCAFFOLD_NAMES = ['spec is followed by scaffold', 'a group > inner pass'];

const NEW_TEST_FAILS = lines(
  '',
  'tests/logic.test.ts:',
  '(pass) spec is followed by scaffold [1.71ms]',
  '(pass) a group > inner pass [0.42ms]',
  '(fail) a group > inner equal [3.04ms]',
  '  AssertionError: expect(received).toEqual()',
  '  ',
  '  Expected: { a: 2 }',
  '  Received: { a: 1 }',
  '',
  ' 2 pass',
  ' 1 fail',
  'Ran 3 tests across 1 file. [0.27s]',
);

// A file that uses a call the test runner does not have: it does not load, and the block quotes its source.
const LOAD_ERROR_QUOTES_EXPECT = lines(
  '',
  'tests/logic.test.ts:',
  '(pass) spec is followed by scaffold [1.71ms]',
  '(pass) a group > inner pass [0.42ms]',
  '',
  'tests/top2.test.ts:',
  '(fail) the file did not load',
  "  test.skip is not a function. (In 'test.skip(\"skipped one\", () => {",
  '    expect(1).toBe(2);',
  "  })', 'test.skip' is undefined)",
  '',
  ' 2 pass',
  ' 1 fail',
  'Ran 3 tests across 2 files. [0.16s]',
);

// A file with an expect outside any test: it does not load, and the block opens with the matcher, not the error.
const LOAD_ERROR_TOP_LEVEL_EXPECT = lines(
  '',
  'tests/logic.test.ts:',
  '(pass) spec is followed by scaffold [1.71ms]',
  '(pass) a group > inner pass [0.42ms]',
  '',
  'tests/top.test.ts:',
  '(fail) the file did not load',
  '  expect(received).toBe()',
  '  ',
  '  Expected: 2',
  '  Received: 1',
  '',
  ' 2 pass',
  ' 1 fail',
  'Ran 3 tests across 2 files. [0.17s]',
);

// A test that existed at Scaffold now fails by assertion, and the new test passes.
const OLD_FAILS_NEW_PASSES = lines(
  '',
  'tests/logic.test.ts:',
  '(fail) spec is followed by scaffold [0.38ms]',
  '  AssertionError: expect(received).toBe()',
  '  ',
  '  Expected: "red"',
  '  Received: "scaffold"',
  '(pass) a group > inner pass [0.42ms]',
  '(pass) a brand new test [0.16ms]',
  '',
  ' 2 pass',
  ' 1 fail',
  'Ran 3 tests across 1 file. [0.20s]',
);

const OLD_FAILS_NEW_FAILS = lines(
  '',
  'tests/logic.test.ts:',
  '(fail) spec is followed by scaffold [0.38ms]',
  '  AssertionError: expect(received).toBe()',
  '  ',
  '  Expected: "red"',
  '  Received: "scaffold"',
  '(pass) a group > inner pass [0.42ms]',
  '(fail) a brand new test [0.16ms]',
  '  AssertionError: expect(received).toBe()',
  '  ',
  '  Expected: 2',
  '  Received: 1',
  '',
  ' 1 pass',
  ' 2 fail',
  'Ran 3 tests across 1 file. [0.20s]',
);

const oneFailure = (name, ...body) => lines('', 'tests/a.test.ts:', `(fail) ${name}`, ...body, '', ' 0 pass', ' 1 fail', 'Ran 1 test across 1 file. [0.10s]');

// ------------------------------------------------------------------------------------- the names of a run

test('testNames gives the name of every test of a run, passed or failed, in the order printed and without the time', () => {
  assert.deepEqual(testNames(AT_SCAFFOLD), SCAFFOLD_NAMES);
  assert.deepEqual(testNames(NEW_TEST_FAILS), ['spec is followed by scaffold', 'a group > inner pass', 'a group > inner equal']);
  assert.deepEqual(testNames(OLD_FAILS_NEW_PASSES), ['spec is followed by scaffold', 'a group > inner pass', 'a brand new test']);
});

test('testNames keeps a name as printed: brackets of its own, spaces at its ends, and a block with no time', () => {
  const output = lines(
    '',
    'tests/top2.test.ts:',
    '(fail) name with [brackets] [1ms] [0.21ms]',
    '  AssertionError: expect(received).toBe()',
    '(fail)   leading spaces and trailing   [0.22ms]',
    '  AssertionError: expect(received).toBe()',
    '',
    'tests/top.test.ts:',
    '(fail) the file did not load',
    '  expect(received).toBe()',
    '',
    ' 0 pass',
    ' 3 fail',
    'Ran 3 tests across 2 files. [0.19s]',
  );
  assert.deepEqual(testNames(output), ['name with [brackets] [1ms]', '  leading spaces and trailing  ', 'the file did not load']);
});

test('testNames reads no name from a line under a test, and none from a run with no tests', () => {
  const output = oneFailure('prints lines [0.10ms]', '  Error: first', '  (fail) not a test', '  (pass) not a test either');
  assert.deepEqual(testNames(output), ['prints lines']);
  assert.deepEqual(testNames(lines('', ' 0 pass', ' 0 fail', 'Ran 0 tests across 0 files. [0.01s]')), []);
});

test('testNames answers null for output whose last line holds no count, and for what is no text', () => {
  assert.equal(testNames('claude plugin test: no hooks module to load\n'), null);
  assert.equal(testNames('(pass) one [1.00ms]\n'), null);
  assert.equal(testNames(''), null);
  for (const bad of [null, undefined, 3, {}, ['(pass) one']]) assert.equal(testNames(bad), null, String(bad));
});

// ---------------------------------------------------------------- every block opens with an assertion error

test('the red gate refuses a file that did not load, though a source line its block quotes holds expect(', () => {
  assert.deepEqual(redGate(run(1, LOAD_ERROR_QUOTES_EXPECT), 2, SCAFFOLD_NAMES),
    { pass: false, reason: 'not failing by assertion: the file did not load' });
});

test('the red gate refuses a file that did not load because an expect outside any test failed', () => {
  assert.deepEqual(redGate(run(1, LOAD_ERROR_TOP_LEVEL_EXPECT), 2, SCAFFOLD_NAMES),
    { pass: false, reason: 'not failing by assertion: the file did not load' });
});

test('the red gate reads the first line under a test only: an assertion error further down does not count', () => {
  const refused = { pass: false, reason: 'not failing by assertion: a new test' };
  assert.deepEqual(redGate(run(1, oneFailure('a new test [0.30ms]', '  Error: first', '  AssertionError: second line')), 0, []), refused);
  assert.deepEqual(redGate(run(1, oneFailure('a new test [0.30ms]', '  at tests/a.test.ts:4', '  ', '  AssertionError: values differ')), 0, []), refused);
  assert.deepEqual(redGate(run(1, oneFailure('a new test [0.30ms]', '  ', '  AssertionError: values differ')), 0, []), refused);
});

test('the red gate takes no first line that only holds the mark: expect( alone, or AssertionError after other text', () => {
  const refused = { pass: false, reason: 'not failing by assertion: a new test' };
  assert.deepEqual(redGate(run(1, oneFailure('a new test [0.30ms]', '  error: expect(received).toEqual(expected)')), 0, []), refused);
  assert.deepEqual(redGate(run(1, oneFailure('a new test [0.30ms]', '  expect(received).toBe()')), 0, []), refused);
  assert.deepEqual(redGate(run(1, oneFailure('a new test [0.30ms]', '  Error: AssertionError: expect(received).toBe()')), 0, []), refused);
  assert.deepEqual(redGate(run(1, oneFailure('a new test [0.30ms]', '  an AssertionError was thrown')), 0, []), refused);
});

test('the red gate refuses a (fail) line with no line under it', () => {
  assert.deepEqual(redGate(run(1, oneFailure('a new test [0.30ms]')), 0, []), { pass: false, reason: 'not failing by assertion: a new test' });
});

test('the red gate names every failure that does not open with an assertion error, beside one that does', () => {
  const output = lines(
    '',
    'tests/a.test.ts:',
    '(fail) opens with it [0.30ms]',
    '  AssertionError: expect(received).toBe()',
    '(fail) holds it lower [0.30ms]',
    '  Error: boom',
    '  AssertionError: no',
    '(fail) quotes expect( [0.30ms]',
    '  TypeError: expect(x).toBe is not a function',
    '',
    ' 0 pass',
    ' 3 fail',
    'Ran 3 tests across 1 file. [0.10s]',
  );
  assert.deepEqual(redGate(run(1, output), 0, []), { pass: false, reason: 'not failing by assertion: holds it lower; quotes expect(' });
});

// ------------------------------------------------------------------------- one failing test has a new name

test('the red gate passes when a test with a name no test had at Scaffold fails by assertion', () => {
  assert.deepEqual(redGate(run(1, NEW_TEST_FAILS), 2, SCAFFOLD_NAMES), { pass: true, tests: 3 });
});

test('the red gate refuses when only a test that existed at Scaffold fails, though a new test was added and passes', () => {
  assert.deepEqual(redGate(run(1, OLD_FAILS_NEW_PASSES), 2, SCAFFOLD_NAMES),
    { pass: false, reason: 'no new test fails: every failing test had its name at Scaffold (spec is followed by scaffold)' });
});

test('the red gate names each old failing test when none is new', () => {
  const output = OLD_FAILS_NEW_FAILS;
  assert.deepEqual(redGate(run(1, output), 2, ['spec is followed by scaffold', 'a brand new test']),
    { pass: false, reason: 'no new test fails: every failing test had its name at Scaffold (spec is followed by scaffold; a brand new test)' });
});

test('the red gate passes when a new test fails by assertion beside an old one that fails by assertion too', () => {
  assert.deepEqual(redGate(run(1, OLD_FAILS_NEW_FAILS), 2, SCAFFOLD_NAMES), { pass: true, tests: 3 });
});

test('a failing test whose name a test already had at Scaffold is not new, whichever file it is in', () => {
  const output = lines(
    '',
    'tests/logic.test.ts:',
    '(pass) spec is followed by scaffold [1.71ms]',
    '(pass) a group > inner pass [0.42ms]',
    '',
    'tests/other.test.ts:',
    '(fail) spec is followed by scaffold [0.38ms]',
    '  AssertionError: expect(received).toBe()',
    '',
    ' 2 pass',
    ' 1 fail',
    'Ran 3 tests across 2 files. [0.20s]',
  );
  assert.deepEqual(redGate(run(1, output), 2, SCAFFOLD_NAMES),
    { pass: false, reason: 'no new test fails: every failing test had its name at Scaffold (spec is followed by scaffold)' });
});

test('a name is new only when it differs as printed: letter case and a group in front make another name', () => {
  assert.deepEqual(redGate(run(1, oneFailure('Spec is followed by scaffold [0.30ms]', '  AssertionError: x')), 0, ['spec is followed by scaffold']), { pass: true, tests: 1 });
  assert.deepEqual(redGate(run(1, oneFailure('a group > spec is followed by scaffold [0.30ms]', '  AssertionError: x')), 0, ['spec is followed by scaffold']), { pass: true, tests: 1 });
  assert.equal(redGate(run(1, oneFailure('spec is followed by scaffold [0.30ms]', '  AssertionError: x')), 0, ['spec is followed by scaffold']).pass, false);
});

test('a load error is refused though its name, "the file did not load", is one no test had at Scaffold', () => {
  assert.deepEqual(redGate(run(1, LOAD_ERROR_TOP_LEVEL_EXPECT), 2, []), { pass: false, reason: 'not failing by assertion: the file did not load' });
});

test('a load error beside a new test that fails by assertion still refuses the run', () => {
  const output = lines(
    '',
    'tests/broken.test.ts:',
    '(fail) the file did not load',
    '  tests/broken.test.ts: cannot import "../hooks/no-such-file" (from tests/broken.test.ts): no such file under /mods/turn-counter',
    '',
    'tests/logic.test.ts:',
    '(pass) spec is followed by scaffold [1.71ms]',
    '(pass) a group > inner pass [0.42ms]',
    '(fail) a brand new test [0.16ms]',
    '  AssertionError: expect(received).toBe()',
    '',
    ' 2 pass',
    ' 2 fail',
    'Ran 4 tests across 2 files. [0.20s]',
  );
  assert.deepEqual(redGate(run(1, output), 2, SCAFFOLD_NAMES), { pass: false, reason: 'not failing by assertion: the file did not load' });
});

test('each way a file did not load on 2.1.322 is refused: a syntax error, a throw outside any test, a thrown error named AssertionError', () => {
  const bodies = [
    '  Expected ")" but found "}" (line 2, column 45); Expected ";" but found ")" (line 2, column 46); Unexpected end of file (line 2, column 47)',
    "  undefined is not an object (evaluating 'x.y')",
    '  expect(x) at load',
  ];
  for (const body of bodies) {
    const output = lines('', 'tests/top.test.ts:', '(fail) the file did not load', body, '', ' 0 pass', ' 1 fail', 'Ran 1 test across 1 file. [0.16s]');
    assert.deepEqual(redGate(run(1, output), 0, []), { pass: false, reason: 'not failing by assertion: the file did not load' }, body);
  }
});

test('a test that is itself named "the file did not load" and fails by assertion is a test like any other', () => {
  const output = oneFailure('the file did not load [1.50ms]', '  AssertionError: expect(received).toBe()', '  ', '  Expected: 2', '  Received: 1');
  assert.deepEqual(redGate(run(1, output), 0, []), { pass: true, tests: 1 });
  assert.equal(redGate(run(1, output), 0, ['the file did not load']).pass, false);
});

// ------------------------------------------------------------------------------ names and output at the edges

test('output with Windows line ends gives the same names, and the same verdicts against names recorded without them', () => {
  const windows = (output) => output.replace(/\n/g, '\r\n');
  assert.deepEqual(testNames(windows(AT_SCAFFOLD)), SCAFFOLD_NAMES);
  assert.deepEqual(testNames(windows(NEW_TEST_FAILS)), testNames(NEW_TEST_FAILS));
  assert.deepEqual(redGate(run(1, windows(NEW_TEST_FAILS)), 2, SCAFFOLD_NAMES), { pass: true, tests: 3 });
  assert.deepEqual(redGate(run(1, windows(OLD_FAILS_NEW_PASSES)), 2, SCAFFOLD_NAMES),
    { pass: false, reason: 'no new test fails: every failing test had its name at Scaffold (spec is followed by scaffold)' });
  assert.deepEqual(redGate(run(1, windows(LOAD_ERROR_QUOTES_EXPECT)), 2, SCAFFOLD_NAMES),
    { pass: false, reason: 'not failing by assertion: the file did not load' });
});

test('testNames keeps a name two tests share once for each, and drops a time printed in seconds or with no fraction', () => {
  const output = lines(
    '',
    'tests/kinds.test.ts:',
    '(pass) a failing one [0.16ms]',
    '(pass) slow [1.20s]',
    '(pass) whole [3ms]',
    '',
    'tests/logic.test.ts:',
    '(fail) a failing one [0.38ms]',
    '  AssertionError: expect(received).toBe()',
    '',
    ' 3 pass',
    ' 1 fail',
    'Ran 4 tests across 2 files. [0.27s]',
  );
  assert.deepEqual(testNames(output), ['a failing one', 'slow', 'whole', 'a failing one']);
});

test('testNames reads the count from the last line only, as parseTestRun does', () => {
  const body = ['', 'tests/a.test.ts:', '(pass) one [1.00ms]', '', ' 1 pass', ' 0 fail'];
  assert.deepEqual(testNames(lines(...body, 'Ran 1 test across 1 file. [0.16s]')), ['one']);
  assert.equal(testNames(lines(...body, 'Ran 1 test across 1 file. [0.16s]', 'something after it')), null);
  assert.equal(testNames(lines(...body, '  Ran 1 test across 1 file. [0.16s]')), null);
  assert.equal(testNames(lines('Ran 1 test across 1 file. [0.16s]', ...body)), null);
  assert.equal(testNames(lines(...body, 'Ran 1 test')), null);
});

test('a name every object has a property for is a name like any other: new when not recorded, old when recorded', () => {
  for (const name of ['constructor', 'toString', 'hasOwnProperty', '__proto__', 'length']) {
    const output = oneFailure(`${name} [0.30ms]`, '  AssertionError: x');
    assert.deepEqual(testNames(output), [name]);
    assert.deepEqual(redGate(run(1, output), 0, []), { pass: true, tests: 1 }, name);
    assert.deepEqual(redGate(run(1, output), 0, ['a']), { pass: true, tests: 1 }, name);
    assert.equal(redGate(run(1, output), 0, JSON.parse(JSON.stringify([name]))).pass, false, name);
  }
});

test('a name with a line end the runner printed as an escape, or with a mark inside it, is kept whole', () => {
  const output = lines(
    '',
    'tests/a.test.ts:',
    '(fail) multi\\u000aline name [0.34ms]',
    '  AssertionError: expect(received).toBe()',
    '(fail) says (fail) and (pass) inside [0.34ms]',
    '  AssertionError: expect(received).toBe()',
    '',
    ' 0 pass',
    ' 2 fail',
    'Ran 2 tests across 1 file. [0.10s]',
  );
  assert.deepEqual(testNames(output), ['multi\\u000aline name', 'says (fail) and (pass) inside']);
  assert.equal(redGate(run(1, output), 0, ['multi\\u000aline name', 'says (fail) and (pass) inside']).pass, false);
  assert.deepEqual(redGate(run(1, output), 0, ['multi\\u000aline name']), { pass: true, tests: 2 });
});

test('a run and a record of a hundred thousand names are read, and one new failing name among them is found', () => {
  const old = Array.from({ length: 100000 }, (_, i) => `test number ${i}`);
  const output = lines('', 'tests/a.test.ts:', ...old.map((name) => `(pass) ${name} [0.01ms]`), '(fail) the new one [0.30ms]', '  AssertionError: x', '',
    ' 100000 pass', ' 1 fail', 'Ran 100001 tests across 1 file. [9.10s]');
  assert.equal(testNames(output).length, 100001);
  assert.deepEqual(redGate(run(1, output), 100000, old), { pass: true, tests: 100001 });
  assert.equal(redGate(run(1, output), 100000, [...old, 'the new one']).pass, false);
});

// ------------------------------------------------------------------------- the names recorded at Scaffold

test('the red gate refuses when the names recorded at Scaffold are no list of names, whatever the run shows', () => {
  const refused = { pass: false, reason: 'no test names are recorded from Scaffold' };
  for (const recorded of [undefined, null, 'spec is followed by scaffold', 2, true, {}, { length: 0 }, [1], ['a', null], ['a', undefined], [['a']]]) {
    const label = JSON.stringify(recorded) ?? String(recorded);
    assert.deepEqual(redGate(run(1, NEW_TEST_FAILS), 2, recorded), refused, label);
    assert.deepEqual(redGate(run(0, AT_SCAFFOLD), 2, recorded), refused, label);
  }
  assert.deepEqual(redGate(run(1, NEW_TEST_FAILS), 2), refused);
});

test('a count that is none is named before names that are none; a list with no names in it is a record', () => {
  assert.deepEqual(redGate(run(1, NEW_TEST_FAILS), NaN, null), { pass: false, reason: 'no test count is recorded from Scaffold' });
  assert.deepEqual(redGate(run(1, oneFailure('a new test [0.30ms]', '  AssertionError: x')), 0, []), { pass: true, tests: 1 });
});

test('the names the scaffold run printed, recorded and handed back, carry a build from Scaffold through Red', () => {
  const scaffold = scaffoldGate(run(0, 'Validation passed'), run(0, AT_SCAFFOLD));
  const names = JSON.parse(JSON.stringify(testNames(AT_SCAFFOLD)));
  assert.deepEqual(scaffold, { pass: true, tests: 2 });
  assert.deepEqual(redGate(run(1, NEW_TEST_FAILS), scaffold.tests, names), { pass: true, tests: 3 });
  assert.equal(redGate(run(1, OLD_FAILS_NEW_PASSES), scaffold.tests, names).pass, false);
  assert.equal(redGate(run(1, LOAD_ERROR_QUOTES_EXPECT), scaffold.tests, names).pass, false);
});

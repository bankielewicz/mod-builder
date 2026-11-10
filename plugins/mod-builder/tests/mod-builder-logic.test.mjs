// Logic tests for hooks/mod-builder-logic.ts (SPEC.md 3.2, 3.3 and 3.1 "When"), run under node, which loads the
// TypeScript file as it is. The outputs below are what `claude plugin test` 2.1.322 printed for a throwaway mod.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PHASES, GUARDED_TOOLS, GATE_TOOL, NOT_YET, APPROVE, SEE_IT_FIRST,
  isPhase, phaseNumber, phaseTitle, phaseLabel, nextPhase, isGuardedTool, pathInMod, mayWrite, writeVerdict,
  parseTestRun, approvalOptions, specGate, scaffoldGate, redGate, greenGate, verifyGate,
  changedFiles, hashGate, specKept, parseStamp, isCacheStale, DEFAULT_REFRESH_DAYS,
} from '../hooks/mod-builder-logic.ts';

// ------------------------------------------------------------------------------------------ fixtures

const lines = (...text) => `${text.join('\n')}\n`;

const ALL_PASS = lines(
  '',
  'tests/logic.test.ts:',
  '(pass) spec is followed by scaffold [1.38ms]',
  '',
  ' 1 pass',
  ' 0 fail',
  'Ran 1 test across 1 file. [0.18s]',
);

const THREE_PASS = lines(
  '',
  'tests/pane.test.tsx:',
  '(pass) the pane lists a tool call [3.10ms]',
  '(pass) a stored value is declined [0.90ms]',
  '(pass) the command opens the pane [0.70ms]',
  '',
  ' 3 pass',
  ' 0 fail',
  'Ran 3 tests across 1 file. [0.21s]',
);

const ASSERTION_BLOCK = [
  '(fail) a failing one [0.48ms]',
  '  AssertionError: expect(received).toBe()',
  '  ',
  '  Expected: "red"',
  '  Received: "scaffold"',
];

const DID_NOT_LOAD_BLOCK = [
  'tests/broken.test.ts:',
  '(fail) the file did not load',
  '  tests/broken.test.ts: cannot import "../hooks/no-such-file" (from tests/broken.test.ts): no such file under /mods/turn-counter',
];

const ONE_ASSERTION_FAILS = lines(
  '',
  'tests/logic.test.ts:',
  '(pass) spec is followed by scaffold [2.11ms]',
  ...ASSERTION_BLOCK,
  '',
  ' 1 pass',
  ' 1 fail',
  'Ran 2 tests across 1 file. [0.20s]',
);

const A_FILE_DID_NOT_LOAD = lines(
  '',
  ...DID_NOT_LOAD_BLOCK,
  '',
  'tests/logic.test.ts:',
  '(pass) spec is followed by scaffold [2.04ms]',
  '',
  ' 1 pass',
  ' 1 fail',
  'Ran 2 tests across 2 files. [0.22s]',
);

const MIXED_FAILURES = lines(
  '',
  ...DID_NOT_LOAD_BLOCK,
  '',
  'tests/logic.test.ts:',
  '(pass) spec is followed by scaffold [2.04ms]',
  ...ASSERTION_BLOCK,
  '',
  'tests/throws.test.ts:',
  '(fail) throws a plain error [1.25ms]',
  '  Error: boom',
  '(fail) reads undefined [0.20ms]',
  "  TypeError: undefined is not an object (evaluating 'x.y')",
  '',
  ' 1 pass',
  ' 4 fail',
  'Ran 5 tests across 3 files. [0.22s]',
);

const run = (exitCode, output = '') => ({ exitCode, output });
const DAY = 24 * 60 * 60 * 1000;

// ------------------------------------------------------------------------------------------- phases

test('the eight phases are in the order of the spec, numbered from 1', () => {
  assert.deepEqual([...PHASES], ['knowledge', 'describe', 'spec', 'scaffold', 'red', 'green', 'verify', 'done']);
  assert.deepEqual(PHASES.map(phaseNumber), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(PHASES.map(phaseTitle), ['Knowledge', 'Describe', 'Spec', 'Scaffold', 'Red', 'Green', 'Verify', 'Done']);
  assert.equal(phaseLabel('red'), 'phase 5 (Red)');
});

test('each phase is followed by the next one only, and nothing follows Done', () => {
  assert.deepEqual(PHASES.map(nextPhase), ['describe', 'spec', 'scaffold', 'red', 'green', 'verify', 'done', null]);
});

test('isPhase accepts the eight names and nothing else', () => {
  for (const phase of PHASES) assert.equal(isPhase(phase), true);
  for (const other of ['Red', 'RED', '', 'approve', 5, null, undefined, {}]) assert.equal(isPhase(other), false);
});

// ----------------------------------------------------------------------------------- guarded tools

test('the guard looks at Edit, MultiEdit, Write and NotebookEdit only', () => {
  assert.deepEqual([...GUARDED_TOOLS], ['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
  for (const tool of GUARDED_TOOLS) assert.equal(isGuardedTool(tool), true);
  for (const tool of ['Bash', 'Read', 'Grep', 'write', 'mod_builder_gate', 'mcp__files__Write', '']) assert.equal(isGuardedTool(tool), false);
});

// ------------------------------------------------------------------------------------------- paths

test('pathInMod gives the path from the mod folder, and null outside it', () => {
  const mod = '/work/turn-counter';
  assert.equal(pathInMod(mod, '/work/turn-counter/hooks/register.tsx', '/work'), 'hooks/register.tsx');
  assert.equal(pathInMod(mod, '/work/turn-counter/SPEC.md', '/work'), 'SPEC.md');
  assert.equal(pathInMod(mod, '/work/turn-counter', '/work'), '');
  assert.equal(pathInMod(mod, '/work/turn-counter/', '/work'), '');
  assert.equal(pathInMod(mod, '/work/other/SPEC.md', '/work'), null);
  assert.equal(pathInMod(mod, '/work', '/work'), null);
  assert.equal(pathInMod(mod, '/work/turn-counter-two/SPEC.md', '/work'), null);
  assert.equal(pathInMod(mod, '/work/turn-count', '/work'), null);
});

test('pathInMod resolves a relative path against the working folder', () => {
  const mod = '/work/turn-counter';
  assert.equal(pathInMod(mod, 'turn-counter/tests/a.test.ts', '/work'), 'tests/a.test.ts');
  assert.equal(pathInMod(mod, './tests/a.test.ts', '/work/turn-counter'), 'tests/a.test.ts');
  assert.equal(pathInMod(mod, '../turn-counter/SPEC.md', '/work/elsewhere'), 'SPEC.md');
  assert.equal(pathInMod(mod, 'notes.md', '/work'), null);
});

test('pathInMod applies "." and ".." before it decides, so a path cannot hide where it lands', () => {
  const mod = '/work/turn-counter';
  assert.equal(pathInMod(mod, '/work/turn-counter/tests/../hooks/register.tsx', '/'), 'hooks/register.tsx');
  assert.equal(pathInMod(mod, '/work/turn-counter/../other/x.ts', '/'), null);
  assert.equal(pathInMod(mod, '/work/other/../turn-counter/./SPEC.md', '/'), 'SPEC.md');
  assert.equal(pathInMod(mod, '/work//turn-counter///hooks//a.ts', '/'), 'hooks/a.ts');
  assert.equal(pathInMod('/work/x/../turn-counter/', '/work/turn-counter/a.ts', '/'), 'a.ts');
  assert.equal(pathInMod(mod, '/../../work/turn-counter/a.ts', '/'), null);
});

test('pathInMod answers null for what it cannot place: an empty path, a mod folder or working folder that is not absolute', () => {
  assert.equal(pathInMod('/work/turn-counter', '', '/work'), null);
  assert.equal(pathInMod('turn-counter', '/work/turn-counter/a.ts', '/work'), null);
  assert.equal(pathInMod('/work/turn-counter', 'a.ts', 'work'), null);
});

// ------------------------------------------------------------------------- what a phase may write

const FILES = ['SPEC.md', 'tests/pane.test.tsx', 'hooks/register.tsx', 'hooks/hooks.json', '.claude-plugin/plugin.json', 'README.md', 'types/index.d.ts'];
const allowed = (phase) => FILES.filter((file) => mayWrite(phase, file));

test('the write table of the spec, phase by phase', () => {
  assert.deepEqual(allowed('spec'), ['SPEC.md']);
  assert.deepEqual(allowed('scaffold'), FILES);
  assert.deepEqual(allowed('red'), ['tests/pane.test.tsx']);
  assert.deepEqual(allowed('green'), ['hooks/register.tsx', 'hooks/hooks.json', '.claude-plugin/plugin.json', 'README.md', 'types/index.d.ts']);
  assert.deepEqual(allowed('verify'), ['SPEC.md', '.claude-plugin/plugin.json', 'README.md', 'types/index.d.ts']);
});

test('before Spec nothing in the mod may be written, and Done keeps what Verify may write', () => {
  assert.deepEqual(allowed('knowledge'), []);
  assert.deepEqual(allowed('describe'), []);
  assert.deepEqual(allowed('done'), allowed('verify'));
  assert.deepEqual(allowed('done'), ['SPEC.md', '.claude-plugin/plugin.json', 'README.md', 'types/index.d.ts']);
});

test('only SPEC.md at the top of the mod is the spec, and only the top folders tests and hooks are those areas', () => {
  assert.equal(mayWrite('spec', 'docs/SPEC.md'), false);
  assert.equal(mayWrite('green', 'docs/SPEC.md'), true);
  assert.equal(mayWrite('spec', 'SPEC.md.bak'), false);
  assert.equal(mayWrite('red', 'src/tests/a.ts'), false);
  assert.equal(mayWrite('green', 'src/tests/a.ts'), true);
  assert.equal(mayWrite('red', 'tests'), true);
  assert.equal(mayWrite('red', 'tests/deep/a.test.ts'), true);
  assert.equal(mayWrite('red', 'tests-old/a.test.ts'), false);
  assert.equal(mayWrite('green', 'tests-old/a.test.ts'), true);
  assert.equal(mayWrite('verify', 'hooks-notes.md'), true);
  assert.equal(mayWrite('verify', 'hooks/deep/a.ts'), false);
});

test('letter case does not get past a closed name: spec.md is SPEC.md, Tests is tests', () => {
  assert.equal(mayWrite('green', 'spec.md'), false);
  assert.equal(mayWrite('green', 'Spec.MD'), false);
  assert.equal(mayWrite('green', 'Tests/a.test.ts'), false);
  assert.equal(mayWrite('green', 'TESTS/a.test.ts'), false);
  assert.equal(mayWrite('verify', 'Hooks/register.tsx'), false);
  assert.equal(mayWrite('verify', 'TESTS/a.test.ts'), false);
  assert.equal(mayWrite('done', 'HOOKS/register.tsx'), false);
});

test('a name that opens an area must be spelled exactly: Tests/ opens nothing at Red, spec.md nothing at Spec', () => {
  assert.equal(mayWrite('red', 'Tests/a.test.ts'), false);
  assert.equal(mayWrite('red', 'TESTS/a.test.ts'), false);
  assert.equal(mayWrite('spec', 'spec.md'), false);
  assert.equal(mayWrite('spec', 'Spec.md'), false);
});

test('a path that climbs out of an area is judged by where it lands', () => {
  assert.equal(mayWrite('red', 'tests/../hooks/register.tsx'), false);
  assert.equal(mayWrite('green', 'hooks/../tests/a.test.ts'), false);
  assert.equal(mayWrite('green', './tests/a.test.ts'), false);
  assert.equal(mayWrite('green', 'hooks/../SPEC.md'), false);
});

test('the mod folder itself is no file of any area', () => {
  assert.equal(mayWrite('spec', ''), false);
  assert.equal(mayWrite('red', ''), false);
  assert.equal(mayWrite('green', ''), true);
});

test('a refusal at Done names no next phase', () => {
  assert.deepEqual(writeVerdict('done', 'hooks/register.tsx'), {
    allowed: false,
    reason: "mod-builder: hooks/register.tsx can't be written in phase 8 (Done), which may write anything but tests/ and hooks/.",
  });
});

test('an allowed write has no reason; a refusal names the phase, what it may write, what opens next and the gate tool', () => {
  assert.deepEqual(writeVerdict('scaffold', 'hooks/register.tsx'), { allowed: true });
  assert.deepEqual(writeVerdict('spec', 'hooks/register.tsx'), {
    allowed: false,
    reason: "mod-builder: hooks/register.tsx can't be written in phase 3 (Spec), which may write SPEC.md only. "
      + 'Phase 4 (Scaffold) opens when the person approves the spec: ask for it by calling the mod_builder_gate tool.',
  });
  assert.equal(GATE_TOOL, 'mod_builder_gate');
});

test('every refusal of phases 1 to 7 names its own phase, the next phase and the gate tool', () => {
  const refusedPath = { knowledge: 'SPEC.md', describe: 'SPEC.md', spec: 'tests/a.test.ts', red: 'hooks/a.ts', green: 'tests/a.test.ts', verify: 'hooks/a.ts' };
  for (const [phase, path] of Object.entries(refusedPath)) {
    const verdict = writeVerdict(phase, path);
    assert.equal(verdict.allowed, false, phase);
    assert.ok(verdict.reason.includes(phaseLabel(phase)), verdict.reason);
    assert.ok(verdict.reason.includes(`${phaseLabel(nextPhase(phase)).replace('phase', 'Phase')} opens when`), verdict.reason);
    assert.ok(verdict.reason.includes(GATE_TOOL), verdict.reason);
    assert.ok(verdict.reason.includes(path), verdict.reason);
  }
  assert.match(writeVerdict('red', 'hooks/a.ts').reason, /which may write tests\/ only\. Phase 6 \(Green\) opens when a new test fails by assertion/);
  assert.match(writeVerdict('green', 'tests/a.test.ts').reason, /Phase 7 \(Verify\) opens when every test passes/);
  assert.match(writeVerdict('verify', 'hooks/a.ts').reason, /Phase 8 \(Done\) opens when validate, test, the typecheck and the headless load all pass/);
  assert.match(writeVerdict('spec', '').reason, /^mod-builder: the mod folder can't be written/);
});

// --------------------------------------------------------------------------------- reading a test run

test('parseTestRun reads the count from the last line, singular or plural', () => {
  assert.deepEqual(parseTestRun(ALL_PASS), { tests: 1, failures: [] });
  assert.deepEqual(parseTestRun(THREE_PASS), { tests: 3, failures: [] });
  assert.equal(parseTestRun(MIXED_FAILURES).tests, 5);
});

test('parseTestRun gives each (fail) block its name without the time, and the lines under it', () => {
  assert.deepEqual(parseTestRun(ONE_ASSERTION_FAILS).failures, [
    { name: 'a failing one', body: '  AssertionError: expect(received).toBe()\n  \n  Expected: "red"\n  Received: "scaffold"' },
  ]);
  assert.deepEqual(parseTestRun(MIXED_FAILURES).failures.map((failure) => failure.name),
    ['the file did not load', 'a failing one', 'throws a plain error', 'reads undefined']);
  assert.equal(parseTestRun(MIXED_FAILURES).failures[2].body, '  Error: boom');
  assert.equal(parseTestRun(MIXED_FAILURES).failures[3].body, "  TypeError: undefined is not an object (evaluating 'x.y')");
});

test('parseTestRun reads a count of no tests and a count of more than nine', () => {
  assert.deepEqual(parseTestRun(lines('', ' 0 pass', ' 0 fail', 'Ran 0 tests across 0 files. [0.01s]')), { tests: 0, failures: [] });
  assert.equal(parseTestRun(lines('', ' 10 pass', ' 0 fail', 'Ran 10 tests across 2 files. [0.90s]')).tests, 10);
  assert.equal(parseTestRun(lines('', ' 120 pass', ' 3 fail', 'Ran 123 tests across 14 files. [2.10s]')).tests, 123);
});

test('parseTestRun ends a (fail) block at the next test line, so a passing test under it is not read as its body', () => {
  const output = lines(
    '',
    'tests/a.test.ts:',
    '(fail) throws a plain error [1.25ms]',
    '  Error: boom',
    '(pass) expect( is in this name, AssertionError too [0.20ms]',
    '',
    ' 1 pass',
    ' 1 fail',
    'Ran 2 tests across 1 file. [0.10s]',
  );
  assert.deepEqual(parseTestRun(output).failures, [{ name: 'throws a plain error', body: '  Error: boom' }]);
  assert.deepEqual(redGate(run(1, output), 0, []), { pass: false, reason: 'not failing by assertion: throws a plain error' });
});

test('parseTestRun answers null when the last line holds no count', () => {
  assert.equal(parseTestRun(''), null);
  assert.equal(parseTestRun('claude plugin test: no hooks module to load\n'), null);
  assert.equal(parseTestRun('Ran 3 tests across 1 file. [0.2s]\nsomething after it\n'), null);
  assert.equal(parseTestRun('It Ran 3 tests across 1 file.\n'), null);
});

test('parseTestRun reads output with Windows line ends', () => {
  assert.deepEqual(parseTestRun(ALL_PASS.replace(/\n/g, '\r\n')), { tests: 1, failures: [] });
});

// ------------------------------------------------------------------------------------ Spec to Scaffold

test('the approval question puts "Not yet" first and never "Approve"', () => {
  assert.deepEqual(approvalOptions(false), ['Not yet', 'Approve']);
  assert.deepEqual(approvalOptions(true), ['Not yet', 'Approve', 'See it first: draw mockups with /design']);
  assert.deepEqual([NOT_YET, APPROVE, SEE_IT_FIRST], approvalOptions(true));
});

test('only the answer "Approve" passes the spec gate', () => {
  assert.deepEqual(specGate('Approve'), { pass: true });
  for (const answer of ['Not yet', SEE_IT_FIRST, 'approve', 'Approve ', 'Approved', 'yes', '', null, undefined]) {
    const verdict = specGate(answer);
    assert.equal(verdict.pass, false, String(answer));
    assert.match(verdict.reason, /has not approved the spec/);
  }
  assert.match(specGate('Not yet').reason, /answer: "Not yet"/);
  assert.match(specGate(null).reason, /answer: none/);
});

// -------------------------------------------------------------------------------------- Scaffold to Red

test('the scaffold gate passes when validate exits 0, and records how many tests ran', () => {
  assert.deepEqual(scaffoldGate(run(0, 'Validation passed'), run(0, THREE_PASS)), { pass: true, tests: 3 });
  assert.deepEqual(scaffoldGate(run(0), run(1, ONE_ASSERTION_FAILS)), { pass: true, tests: 2 });
});

test('the scaffold gate refuses when validate fails, or when the test run shows no count to record', () => {
  assert.deepEqual(scaffoldGate(run(1, 'Validation failed'), run(0, THREE_PASS)),
    { pass: false, reason: 'claude plugin validate --strict exited 1' });
  assert.deepEqual(scaffoldGate(run(2, 'usage'), run(0, THREE_PASS)),
    { pass: false, reason: 'claude plugin validate --strict exited 2' });
  assert.deepEqual(scaffoldGate(run(0), run(1, 'claude plugin test: no hooks module to load\n')),
    { pass: false, reason: "the test run's last line reports no test count" });
});

// ----------------------------------------------------------------------------------------- Red to Green

test('the red gate passes when the run fails, has more tests than at Scaffold, and every failure is an assertion', () => {
  assert.deepEqual(redGate(run(1, ONE_ASSERTION_FAILS), 1, ['spec is followed by scaffold']), { pass: true, tests: 2 });
});

test('an AssertionError on the first line under the test is an assertion; a plain Error is not', () => {
  const failing = (...body) => lines('', 'tests/a.test.ts:', '(fail) a new test [0.30ms]', ...body, '', ' 0 pass', ' 1 fail', 'Ran 1 test across 1 file. [0.10s]');
  assert.deepEqual(redGate(run(1, failing('  AssertionError: values differ')), 0, []), { pass: true, tests: 1 });
  assert.deepEqual(redGate(run(1, failing('  Error: expected more')), 0, []), { pass: false, reason: 'not failing by assertion: a new test' });
});

test('the red gate passes whatever non-zero code the run ends with', () => {
  assert.deepEqual(redGate(run(2, ONE_ASSERTION_FAILS), 1, ['spec is followed by scaffold']), { pass: true, tests: 2 });
  assert.deepEqual(redGate(run(137, ONE_ASSERTION_FAILS), 0, []), { pass: true, tests: 2 });
});

test('the red gate refuses a run that passes', () => {
  assert.deepEqual(redGate(run(0, THREE_PASS), 1, []), { pass: false, reason: 'claude plugin test exited 0: no test fails yet' });
});

test('the red gate refuses when there is no new test, even when one fails by assertion', () => {
  assert.deepEqual(redGate(run(1, ONE_ASSERTION_FAILS), 2, []),
    { pass: false, reason: 'the run has 2 tests, no more than the 2 at Scaffold: no new test' });
  assert.deepEqual(redGate(run(1, A_FILE_DID_NOT_LOAD.replace('Ran 2 tests across 2 files', 'Ran 1 test across 2 files')), 1, []),
    { pass: false, reason: 'the run has 1 test, no more than the 1 at Scaffold: no new test' });
  assert.equal(redGate(run(1, ONE_ASSERTION_FAILS), 3, []).pass, false);
});

test('the red gate refuses a file that did not load, though the count went up', () => {
  assert.deepEqual(redGate(run(1, A_FILE_DID_NOT_LOAD), 1, []), { pass: false, reason: 'not failing by assertion: the file did not load' });
});

test('the red gate refuses when any failure is not an assertion, and names each', () => {
  assert.deepEqual(redGate(run(1, MIXED_FAILURES), 1, []),
    { pass: false, reason: 'not failing by assertion: the file did not load; throws a plain error; reads undefined' });
});

test('the red gate reads the assertion from the lines under the test, not from the name of the test', () => {
  const named = '\ntests/a.test.ts:\n(fail) expect( in the name, AssertionError too [0.1ms]\n  Error: boom\n\n 0 pass\n 1 fail\nRan 1 test across 1 file. [0.1s]\n';
  assert.deepEqual(redGate(run(1, named), 0, []), { pass: false, reason: 'not failing by assertion: expect( in the name, AssertionError too' });
});

test('the red gate refuses a failed run with no count or with no (fail) block', () => {
  assert.deepEqual(redGate(run(1, 'the test runner crashed\n'), 0, []), { pass: false, reason: "the test run's last line reports no test count" });
  assert.deepEqual(redGate(run(1, THREE_PASS), 1, []), { pass: false, reason: 'claude plugin test failed, but its output holds no (fail) block' });
});

// ---------------------------------------------------------------------------------- Green to Verify

test('the green gate passes when the run exits 0 with no fewer tests than at Red', () => {
  assert.deepEqual(greenGate(run(0, THREE_PASS), 3), { pass: true, tests: 3 });
  assert.deepEqual(greenGate(run(0, THREE_PASS), 2), { pass: true, tests: 3 });
});

test('the green gate refuses a failing run, a run with fewer tests than at Red, and a run with no count', () => {
  assert.deepEqual(greenGate(run(1, ONE_ASSERTION_FAILS), 2), { pass: false, reason: 'claude plugin test exited 1: not every test passes' });
  assert.deepEqual(greenGate(run(3, THREE_PASS), 3), { pass: false, reason: 'claude plugin test exited 3: not every test passes' });
  assert.deepEqual(greenGate(run(0, ALL_PASS), 2), { pass: false, reason: 'the run has 1 test, fewer than the 2 at Red' });
  assert.deepEqual(greenGate(run(0, THREE_PASS), 4), { pass: false, reason: 'the run has 3 tests, fewer than the 4 at Red' });
  assert.deepEqual(greenGate(run(0, 'ok\n'), 1), { pass: false, reason: "the test run's last line reports no test count" });
});

// ----------------------------------------------------------------------------------- Verify to Done

const good = () => ({ validate: run(0), test: run(0, THREE_PASS), typecheck: run(0), load: run(0), loadShown: true });

test('the verify gate passes when validate, test, the typecheck and the headless load all pass', () => {
  assert.deepEqual(verifyGate(good(), 3), { pass: true, tests: 3 });
});

test('the verify gate refuses when any one of the four fails, naming it', () => {
  assert.deepEqual(verifyGate({ ...good(), validate: run(1) }, 3), { pass: false, reason: 'claude plugin validate --strict exited 1' });
  assert.deepEqual(verifyGate({ ...good(), test: run(1, ONE_ASSERTION_FAILS) }, 2), { pass: false, reason: 'claude plugin test exited 1: not every test passes' });
  assert.deepEqual(verifyGate({ ...good(), validate: run(2) }, 3), { pass: false, reason: 'claude plugin validate --strict exited 2' });
  assert.deepEqual(verifyGate({ ...good(), test: run(0, ALL_PASS) }, 3), { pass: false, reason: 'the run has 1 test, fewer than the 3 at Red' });
  assert.deepEqual(verifyGate({ ...good(), typecheck: run(2) }, 3), { pass: false, reason: 'the typecheck exited 2' });
  assert.deepEqual(verifyGate({ ...good(), load: run(1) }, 3), { pass: false, reason: 'the headless load exited 1' });
});

test('the verify gate refuses a headless load that exits 0 but is not seen loaded and admitted in the debug log', () => {
  const reason = "the headless load's debug log does not show the mod loaded and admitted";
  assert.deepEqual(verifyGate({ ...good(), loadShown: false }, 3), { pass: false, reason });
  assert.deepEqual(verifyGate({ ...good(), loadShown: undefined }, 3), { pass: false, reason });
  assert.deepEqual(verifyGate({ ...good(), loadShown: 'yes' }, 3), { pass: false, reason });
});

// ------------------------------------------------------------------------------------------ hashes

test('files that match what was recorded pass the hash gate', () => {
  const recorded = { 'SPEC.md': 'aa', 'tests/a.test.ts': 'bb' };
  assert.deepEqual(changedFiles(recorded, { 'tests/a.test.ts': 'bb', 'SPEC.md': 'aa' }), []);
  assert.deepEqual(hashGate(recorded, { ...recorded }), { pass: true });
  assert.deepEqual(hashGate({}, {}), { pass: true });
});

test('a changed, a missing and an added file are each found, sorted by path', () => {
  const recorded = { 'tests/b.test.ts': 'bb', 'SPEC.md': 'aa', 'tests/a.test.ts': 'cc' };
  const current = { 'SPEC.md': 'aa', 'tests/b.test.ts': 'XX', 'tests/c.test.ts': 'dd' };
  assert.deepEqual(changedFiles(recorded, current), [
    { path: 'tests/a.test.ts', how: 'missing' },
    { path: 'tests/b.test.ts', how: 'changed' },
    { path: 'tests/c.test.ts', how: 'added' },
  ]);
});

test('the hash gate refuses and names each file that differs', () => {
  assert.deepEqual(hashGate({ 'SPEC.md': 'aa', 'tests/a.test.ts': 'bb' }, { 'SPEC.md': 'ZZ', 'tests/a.test.ts': 'bb' }),
    { pass: false, reason: 'not as recorded: SPEC.md (changed)' });
  assert.deepEqual(hashGate({ 'tests/a.test.ts': 'bb' }, { 'tests/a.test.ts': 'b', 'tests/z.test.ts': 'q' }),
    { pass: false, reason: 'not as recorded: tests/a.test.ts (changed), tests/z.test.ts (added)' });
  assert.deepEqual(hashGate({ 'tests/a.test.ts': 'bb' }, {}), { pass: false, reason: 'not as recorded: tests/a.test.ts (missing)' });
});

test('a file named like a property of every object is compared as a file', () => {
  assert.deepEqual(changedFiles({ 'tests/a.test.ts': 'bb' }, { 'tests/a.test.ts': 'bb', constructor: 'x' }), [{ path: 'constructor', how: 'added' }]);
  assert.deepEqual(changedFiles({ toString: 'x' }, {}), [{ path: 'toString', how: 'missing' }]);
});

test('up to the gate that ends Green, SPEC.md must be exactly as approved', () => {
  const recorded = { length: 120, hash: 'aa' };
  for (const phase of ['scaffold', 'red', 'green']) {
    assert.deepEqual(specKept(recorded, { length: 120, hash: 'aa', approvedPartHash: 'aa' }, phase), { pass: true }, phase);
    assert.deepEqual(specKept(recorded, { length: 120, hash: 'bb', approvedPartHash: 'bb' }, phase),
      { pass: false, reason: 'not as recorded: SPEC.md (changed)' }, phase);
    assert.deepEqual(specKept(recorded, { length: 180, hash: 'cc', approvedPartHash: 'aa' }, phase),
      { pass: false, reason: 'not as recorded: SPEC.md (changed)' }, phase);
  }
});

test('from Verify on, SPEC.md may have grown by the Built block, but its approved part must be unchanged', () => {
  const recorded = { length: 120, hash: 'aa' };
  for (const phase of ['verify', 'done']) {
    assert.deepEqual(specKept(recorded, { length: 180, hash: 'cc', approvedPartHash: 'aa' }, phase), { pass: true }, phase);
    assert.deepEqual(specKept(recorded, { length: 120, hash: 'aa', approvedPartHash: 'aa' }, phase), { pass: true }, phase);
    assert.deepEqual(specKept(recorded, { length: 180, hash: 'cc', approvedPartHash: 'zz' }, phase),
      { pass: false, reason: 'not as recorded: SPEC.md (its approved part changed)' }, phase);
    assert.deepEqual(specKept(recorded, { length: 90, hash: 'dd', approvedPartHash: null }, phase),
      { pass: false, reason: 'not as recorded: SPEC.md (its approved part changed)' }, phase);
  }
});

test('a SPEC.md that is gone is refused at every gate', () => {
  for (const phase of ['scaffold', 'red', 'green', 'verify', 'done']) {
    assert.deepEqual(specKept({ length: 120, hash: 'aa' }, null, phase), { pass: false, reason: 'not as recorded: SPEC.md (missing)' }, phase);
  }
});

// --------------------------------------------------------------------------------------- staleness

const NOW = Date.UTC(2026, 10, 10, 15, 12, 16);
const fresh = (over = {}) => ({ isInteractive: true, refreshDays: 7, checked: '2026-11-10T151216Z', now: NOW, version: '2.1.322', versionAtCheck: '2.1.322', ...over });

test('parseStamp reads a snapshot stamp as UTC, with or without the newline the file ends with', () => {
  assert.equal(parseStamp('2026-11-10T151216Z'), NOW);
  assert.equal(parseStamp('2026-11-10T151216Z\n'), NOW);
  assert.equal(parseStamp('2024-02-29T000000Z'), Date.UTC(2024, 1, 29));
});

test('parseStamp answers null for what is no stamp', () => {
  for (const text of ['', 'yesterday', '2026-11-10', '2026-11-10T15:12:16Z', '2026-11-10T151216', '2026-13-01T000000Z',
    '2026-02-30T000000Z', '2026-11-10T240000Z', '2026-11-10T156000Z', '2026-11-10T151260Z', 'x2026-11-10T151216Z']) {
    assert.equal(parseStamp(text), null, text);
  }
});

test('a cache checked within refreshDays is not stale; one older than that is', () => {
  assert.equal(isCacheStale(fresh()), false);
  assert.equal(isCacheStale(fresh({ now: NOW + 6 * DAY })), false);
  assert.equal(isCacheStale(fresh({ now: NOW + 7 * DAY })), false);
  assert.equal(isCacheStale(fresh({ now: NOW + 7 * DAY + 1000 })), true);
  assert.equal(isCacheStale(fresh({ now: NOW + 9 * DAY })), true);
  assert.equal(isCacheStale(fresh({ refreshDays: 1, now: NOW + 2 * DAY })), true);
  assert.equal(isCacheStale(fresh({ refreshDays: 30, now: NOW + 9 * DAY })), false);
});

test('a cache with no checked, or one that is no stamp, is stale', () => {
  assert.equal(isCacheStale(fresh({ checked: null })), true);
  assert.equal(isCacheStale(fresh({ checked: '' })), true);
  assert.equal(isCacheStale(fresh({ checked: 'garbage' })), true);
});

test('a changed Claude Code version makes a fresh cache stale; so does no recorded version', () => {
  assert.equal(isCacheStale(fresh({ version: '2.1.323' })), true);
  assert.equal(isCacheStale(fresh({ versionAtCheck: null })), true);
});

test('refreshDays 0 turns the automatic fetch off, whatever else is true', () => {
  assert.equal(isCacheStale(fresh({ refreshDays: 0, now: NOW + 99 * DAY })), false);
  assert.equal(isCacheStale(fresh({ refreshDays: 0, checked: null })), false);
  assert.equal(isCacheStale(fresh({ refreshDays: 0, version: '9.9.9' })), false);
});

test('a negative refreshDays turns the fetch off, as 0 does', () => {
  assert.equal(isCacheStale(fresh({ refreshDays: -1, checked: null })), false);
  assert.equal(isCacheStale(fresh({ refreshDays: -1, now: NOW + 99 * DAY })), false);
});

test('a refreshDays that is no number counts as the default of seven days, never as off', () => {
  assert.equal(DEFAULT_REFRESH_DAYS, 7);
  for (const refreshDays of [undefined, null, NaN, Infinity, '7', '0', {}]) {
    assert.equal(isCacheStale(fresh({ refreshDays, checked: null })), true, String(refreshDays));
    assert.equal(isCacheStale(fresh({ refreshDays, now: NOW + 6 * DAY })), false, String(refreshDays));
    assert.equal(isCacheStale(fresh({ refreshDays, now: NOW + 8 * DAY })), true, String(refreshDays));
  }
});

test('checked is read as the file holds it, with the newline at its end', () => {
  assert.equal(isCacheStale(fresh({ checked: '2026-11-10T151216Z\n' })), false);
  assert.equal(isCacheStale(fresh({ checked: '2026-11-10T151216Z\n', now: NOW + 8 * DAY })), true);
});

test('a headless session never fetches', () => {
  assert.equal(isCacheStale(fresh({ isInteractive: false, checked: null })), false);
  assert.equal(isCacheStale(fresh({ isInteractive: false, now: NOW + 99 * DAY, version: '9.9.9' })), false);
});

test('a checked up to a day ahead of the clock is not stale; one further ahead is not believed, and is stale', () => {
  assert.equal(isCacheStale(fresh({ now: NOW - 60 * 1000 })), false);
  assert.equal(isCacheStale(fresh({ now: NOW - DAY })), false);
  assert.equal(isCacheStale(fresh({ now: NOW - DAY - 1000 })), true);
  assert.equal(isCacheStale(fresh({ now: NOW - 300 * DAY })), true);
});

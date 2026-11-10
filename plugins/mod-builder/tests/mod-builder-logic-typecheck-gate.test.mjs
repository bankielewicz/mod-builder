// Logic tests for SPEC.md 7.10: the typecheck as Scaffold and Red end on it, judged alone (Green and Verify judge
// theirs among the four checks), and what the guard says opens Green.
import { test } from 'node:test';
import assert from 'node:assert/strict';
// Read through the namespace, so that before the rule exists this file still loads and each test fails by itself.
import * as logic from '../hooks/mod-builder-logic.ts';

const typecheckGate = (...args) => logic.typecheckGate(...args);
const run = (exitCode, output = '') => ({ exitCode, output });

test('the typecheck gate passes when the typecheck exits 0, whatever it printed', () => {
  assert.deepEqual(typecheckGate(run(0)), { pass: true });
  assert.deepEqual(typecheckGate(run(0, 'a note')), { pass: true });
});

test('the typecheck gate refuses any other exit code, naming it as Green and Verify do', () => {
  assert.deepEqual(typecheckGate(run(2, 'error TS2769')), { pass: false, reason: 'the typecheck exited 2' });
  assert.deepEqual(typecheckGate(run(1)), { pass: false, reason: 'the typecheck exited 1' });
  assert.deepEqual(typecheckGate(run(-1)), { pass: false, reason: 'the typecheck exited -1' });
});

test('a typecheck that ended with no exit code never passes: no run, a code that is no whole number, an output that is no text', () => {
  const none = { pass: false, reason: 'the typecheck ended with no exit code' };
  for (const bad of [undefined, null, 'ran', run(Number.NaN), run(undefined), run(0.5), run('0'), { exitCode: 0 }, { exitCode: 0, output: null }]) {
    assert.deepEqual(typecheckGate(bad), none, JSON.stringify(bad));
  }
});

test('a write refused at Red says Green opens on the typecheck too', () => {
  assert.match(logic.writeVerdict('red', 'hooks/a.ts').reason, /Phase 6 \(Green\) opens when a new test fails by assertion and the mod, its tests included, typechecks: /);
});

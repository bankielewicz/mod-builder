// Tests for the rule's wording at Red (SPEC.md 9.17): scaffoldKeptGate, asked of hooks/ alone, says that hooks/
// closed when Scaffold passed and gives the command that lays hooks/ alone again. Everything else is the rule
// of Scaffold, unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as rules from '../hooks/mod-builder-logic.ts';

const AGAIN = 'bash "/p/scripts/scaffold.sh" --again-hooks "/work/m" m';
const AS_LAID = 'as laid: hooks/hooks.json hooks/register.tsx\n';
const WHY = ': it closed when Scaffold passed, and the mod\'s code is written at Green, after its tests. Put it back with: ';
const REFUSES = '. When that command refuses, a link or a folder stands where a file goes: remove it with a shell command first';
const atRed = (output, exitCode = 1) => rules.scaffoldKeptGate({ exitCode, output }, AGAIN, 'red');

test('at Red a check of hooks/ that exited 0 and said "as laid" passes', () => {
  assert.deepEqual(atRed(AS_LAID, 0), { pass: true });
});

test('at Red a difference refuses in Red\'s words: hooks/ alone, why it is closed, and the command given', () => {
  assert.deepEqual(atRed('changed: hooks/register.tsx\n'), {
    pass: false,
    reason: `hooks/ is not as the scaffold laid it (changed: hooks/register.tsx)${WHY}${AGAIN}${REFUSES}`,
  });
  assert.equal(atRed('missing: hooks/hooks.json\nextra: hooks/count.ts\n').reason, `hooks/ is not as the scaffold laid it (missing: hooks/hooks.json; extra: hooks/count.ts)${WHY}${AGAIN}, and remove each file named as extra${REFUSES}`);
});

test('at Red the refusal names ten differences and counts the rest, as at Scaffold', () => {
  const lines = Array.from({ length: 12 }, (_, index) => `extra: hooks/f${index + 1}.ts`);
  const reason = atRed(`${lines.join('\n')}\n`).reason;
  assert.match(reason, /^hooks\/ is not as the scaffold laid it \(extra: hooks\/f1\.ts; .*extra: hooks\/f10\.ts; and 2 more\): it closed/);
  assert.doesNotMatch(reason, /f11/);
});

test('at Red what is no answer is no answer, in the same words as at Scaffold', () => {
  assert.deepEqual(atRed('', 0), { pass: false, reason: 'the scaffold check gave no answer to read (it exited 0)' });
  assert.deepEqual(atRed('nothing known\n', 1), { pass: false, reason: 'the scaffold check gave no answer to read (it exited 1)' });
  assert.deepEqual(atRed('changed: hooks/register.tsx\n', 2), { pass: false, reason: 'the scaffold check gave no answer to read (it exited 2)' });
  assert.deepEqual(rules.scaffoldKeptGate({ exitCode: Number.NaN, output: AS_LAID }, AGAIN, 'red'), { pass: false, reason: 'the scaffold check ended with no exit code' });
});

test('asked with no phase, or with any other word, the rule speaks as at Scaffold', () => {
  const scaffold = rules.scaffoldKeptGate({ exitCode: 1, output: 'changed: hooks/register.tsx\n' }, AGAIN).reason;
  assert.match(scaffold, /^hooks\/ and tests\/ are not as the scaffold laid them \(changed: hooks\/register\.tsx\): at Scaffold they hold the template/);
  assert.equal(rules.scaffoldKeptGate({ exitCode: 1, output: 'changed: hooks/register.tsx\n' }, AGAIN, 'scaffold').reason, scaffold);
  assert.equal(rules.scaffoldKeptGate({ exitCode: 1, output: 'changed: hooks/register.tsx\n' }, AGAIN, 'green').reason, scaffold);
});

// Tests for the rule that holds Scaffold to the template (SPEC.md 9.4, 9.15): what `scaffold.sh --check` printed is
// read by scaffoldDiffers, and scaffoldKeptGate passes only a check that exited 0, said "as laid" and named no
// difference.
import { test } from 'node:test';
import assert from 'node:assert/strict';
// The rules are read off the module as a whole, so that this file loads before they are built and each test fails
// for itself.
import * as rules from '../hooks/mod-builder-logic.ts';

const scaffoldDiffers = (...args) => rules.scaffoldDiffers(...args);
const scaffoldKeptGate = (...args) => rules.scaffoldKeptGate(...args);

const AS_LAID = 'as laid: hooks/hooks.json hooks/register.tsx tests/pane.test.tsx\n';
const AGAIN = 'bash "/p/scripts/scaffold.sh" --again /work/m m';
const WHY = ': at Scaffold they hold the template and nothing else, and the mod\'s behaviour is written at Red (tests) and Green (code). Put them back with: ';
const refused = (output, exitCode = 1) => scaffoldKeptGate({ exitCode, output }, AGAIN);

test('a check that exited 0 and said "as laid" passes', () => {
  assert.deepEqual(scaffoldKeptGate({ exitCode: 0, output: AS_LAID }, AGAIN), { pass: true });
  assert.deepEqual(scaffoldKeptGate({ exitCode: 0, output: `a note\r\n${AS_LAID}` }, AGAIN), { pass: true });
});

test('the differences are the lines that open with changed, missing or extra and name a path, in the script\'s order, each once', () => {
  assert.deepEqual(scaffoldDiffers('changed: hooks/register.tsx\nmissing: tests/pane.test.tsx\nextra: hooks/a b.ts\n'), ['changed: hooks/register.tsx', 'missing: tests/pane.test.tsx', 'extra: hooks/a b.ts']);
  assert.deepEqual(scaffoldDiffers('extra: b\r\nextra: a\r\nextra: b\r\n'), ['extra: b', 'extra: a']);
  assert.deepEqual(scaffoldDiffers('as laid: x\n changed: indented\nchanged:\nchanged: \nother: x\nEXTRA: x\n'), []);
  for (const odd of [undefined, null, 7, {}]) assert.deepEqual(scaffoldDiffers(odd), []);
});

test('a difference refuses, names every line, and gives the command that lays the files again', () => {
  assert.deepEqual(refused('changed: hooks/register.tsx\n'), {
    pass: false,
    reason: `hooks/ and tests/ are not as the scaffold laid them (changed: hooks/register.tsx)${WHY}${AGAIN}`,
  });
  assert.equal(refused('missing: hooks/hooks.json\nchanged: tests/pane.test.tsx\n').reason, `hooks/ and tests/ are not as the scaffold laid them (missing: hooks/hooks.json; changed: tests/pane.test.tsx)${WHY}${AGAIN}`);
});

test('only when a file is extra does the refusal say to remove it: laying again deletes nothing', () => {
  assert.equal(refused('extra: hooks/lib.ts\n').reason.endsWith(`${AGAIN}, and remove each file named as extra`), true);
  assert.equal(refused('changed: hooks/register.tsx\nextra: tests/x.test.ts\n').reason.endsWith(', and remove each file named as extra'), true);
  assert.equal(refused('changed: hooks/register.tsx\nmissing: hooks/hooks.json\n').reason.endsWith(AGAIN), true);
});

test('at most ten differences are named, and the rest are counted', () => {
  assert.equal(rules.SCAFFOLD_NAMED, 10);
  const lines = (count) => Array.from({ length: count }, (_, index) => `extra: hooks/f${index + 1}.ts`);
  assert.match(refused(`${lines(10).join('\n')}\n`).reason, /extra: hooks\/f10\.ts\): at Scaffold/);
  const eleven = refused(`${lines(11).join('\n')}\n`).reason;
  assert.match(eleven, /extra: hooks\/f10\.ts; and 1 more\): at Scaffold/);
  assert.doesNotMatch(eleven, /f11/);
  assert.match(refused(`${lines(25).join('\n')}\n`).reason, /; and 15 more\)/);
  // The extra file that is not named is still to be removed.
  assert.equal(refused(`${Array.from({ length: 10 }, (_, index) => `changed: hooks/c${index}.ts`).join('\n')}\nextra: hooks/z.ts\n`).reason.endsWith(', and remove each file named as extra'), true);
});

test('an exit code of 0 is no pass without "as laid", and none with a difference beside it', () => {
  const none = { pass: false, reason: 'the scaffold check gave no answer to read (it exited 0)' };
  assert.deepEqual(refused('', 0), none);
  assert.deepEqual(refused('Validation passed\n', 0), none);
  assert.deepEqual(refused(' as laid: indented\n', 0), none);
  for (const near of ['as laid\n', 'as laid:\n', 'as laid:hooks/hooks.json\n', 'As laid: x\n']) assert.deepEqual(refused(near, 0), none);
  assert.deepEqual(refused(`${AS_LAID}extra: hooks/lib.ts\n`, 0), none);
});

test('an exit code of 1 with no difference to read, and any other exit code, is no answer', () => {
  assert.deepEqual(refused('scaffold: something else\n', 1), { pass: false, reason: 'the scaffold check gave no answer to read (it exited 1)' });
  assert.deepEqual(refused(AS_LAID, 1), { pass: false, reason: 'the scaffold check gave no answer to read (it exited 1)' });
  assert.deepEqual(refused('changed: hooks/register.tsx\n', 2), { pass: false, reason: 'the scaffold check gave no answer to read (it exited 2)' });
  assert.deepEqual(refused('', 127), { pass: false, reason: 'the scaffold check gave no answer to read (it exited 127)' });
});

test('a check with no exit code, or no result at all, refuses as any command does', () => {
  const none = { pass: false, reason: 'the scaffold check ended with no exit code' };
  assert.deepEqual(scaffoldKeptGate({ exitCode: Number.NaN, output: AS_LAID }, AGAIN), none);
  assert.deepEqual(scaffoldKeptGate({ exitCode: 0, output: undefined }, AGAIN), none);
  for (const odd of [undefined, null, 'as laid: x']) assert.deepEqual(scaffoldKeptGate(odd, AGAIN), none);
});

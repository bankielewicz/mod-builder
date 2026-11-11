// Tests for the rule on source outside hooks/ and tests/ (SPEC.md 9.17, point 4): scaffoldSources reads the
// script's "source: " lines, and scaffoldKeptGate refuses on them at Scaffold and at Red, alone or beside a
// difference under hooks/ or tests/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as rules from '../hooks/mod-builder-logic.ts';

const AGAIN = 'bash "/p/scripts/scaffold.sh" --again "/work/m" m';
const AS_LAID = 'as laid: hooks/hooks.json hooks/register.tsx tests/pane.test.tsx\n';
const REMOVE = 'Remove each with a shell command; what a test needs to name is declared in a declaration file under types/';
const sources = (...args) => rules.scaffoldSources(...args);
const gate = (output, exitCode = 1, at = undefined) => rules.scaffoldKeptGate({ exitCode, output }, AGAIN, at);

test('the sources are what follows "source: " on the script\'s lines, in its order, each once', () => {
  assert.deepEqual(sources('changed: hooks/register.tsx\nsource: lib/count.ts\nsource: lib/a b.mjs\nsource: lib/count.ts\n'), ['lib/count.ts', 'lib/a b.mjs']);
  assert.deepEqual(sources('source: lib/x.ts\r\nsource: y.js\r\n'), ['lib/x.ts', 'y.js']);
  assert.deepEqual(sources('as laid: x\n source: indented\nsource:\nsource: \nSource: x\nextra: lib/x.ts\n'), []);
  for (const odd of [undefined, null, 7, {}]) assert.deepEqual(sources(odd), []);
});

test('at Scaffold a source file elsewhere refuses by itself, names it, and says how it goes and where a name is declared', () => {
  assert.deepEqual(gate('source: lib/count.ts\n'), {
    pass: false,
    reason: `the mod holds source outside hooks/ and tests/ (lib/count.ts): at Scaffold the mod's code is the template's alone, and its behaviour is written at Red (tests) and Green (code). ${REMOVE}`,
  });
  assert.equal(gate('source: lib/count.ts\nsource: util.js\n', 1, 'scaffold').reason, `the mod holds source outside hooks/ and tests/ (lib/count.ts, util.js): at Scaffold the mod's code is the template's alone, and its behaviour is written at Red (tests) and Green (code). ${REMOVE}`);
});

test('at Red it refuses in Red\'s words', () => {
  assert.deepEqual(gate('source: lib/count.ts\n', 1, 'red'), {
    pass: false,
    reason: `the mod holds source outside hooks/ and tests/ (lib/count.ts): the mod's code is written at Green, after its tests. ${REMOVE}`,
  });
});

test('beside a difference under hooks/ or tests/ the refusal keeps its own words and adds the sources after them', () => {
  const scaffold = gate('changed: hooks/register.tsx\nsource: lib/count.ts\n').reason;
  assert.equal(scaffold.startsWith('hooks/ and tests/ are not as the scaffold laid them (changed: hooks/register.tsx): at Scaffold they hold the template'), true);
  assert.equal(scaffold.endsWith(`Put them back with: ${AGAIN}. Source outside hooks/ and tests/ is not written before Green either (lib/count.ts). ${REMOVE}`), true);
  const red = gate('extra: hooks/count.ts\nsource: lib/count.ts\n', 1, 'red').reason;
  assert.equal(red.startsWith('hooks/ is not as the scaffold laid it (extra: hooks/count.ts): it closed when Scaffold passed'), true);
  assert.equal(red.endsWith(`remove it with a shell command first. Source outside hooks/ and tests/ is not written before Green either (lib/count.ts). ${REMOVE}`), true);
});

test('a source line is never among the differences, and without one the refusals are as they were', () => {
  assert.deepEqual(rules.scaffoldDiffers('source: lib/count.ts\nchanged: hooks/register.tsx\n'), ['changed: hooks/register.tsx']);
  assert.equal(gate('changed: hooks/register.tsx\n').reason.endsWith(`Put them back with: ${AGAIN}`), true);
  assert.equal(gate('changed: hooks/register.tsx\n', 1, 'red').reason.endsWith('remove it with a shell command first'), true);
});

test('ten sources are named and the rest counted', () => {
  const lines = (count) => Array.from({ length: count }, (_, index) => `source: lib/f${index + 1}.ts`).join('\n');
  assert.match(gate(`${lines(10)}\n`).reason, /lib\/f9\.ts, lib\/f10\.ts\): at Scaffold/);
  const twelve = gate(`${lines(12)}\n`).reason;
  assert.match(twelve, /lib\/f10\.ts, and 2 more\): at Scaffold/);
  assert.doesNotMatch(twelve, /f11/);
  assert.match(gate(`changed: hooks/register.tsx\n${lines(11)}\n`).reason, /either \(lib\/f1\.ts, .*lib\/f10\.ts, and 1 more\)\. Remove each/);
});

test('"as laid" beside a source line is no pass, whatever the exit code; and a source line with an exit code other than 1 is no answer', () => {
  assert.deepEqual(gate(`${AS_LAID}source: lib/count.ts\n`, 0), { pass: false, reason: 'the scaffold check gave no answer to read (it exited 0)' });
  assert.equal(gate(`${AS_LAID}source: lib/count.ts\n`, 1).reason.startsWith('the mod holds source outside hooks/ and tests/ (lib/count.ts)'), true);
  assert.deepEqual(gate('source: lib/count.ts\n', 2), { pass: false, reason: 'the scaffold check gave no answer to read (it exited 2)' });
  assert.deepEqual(gate(AS_LAID, 0), { pass: true });
});

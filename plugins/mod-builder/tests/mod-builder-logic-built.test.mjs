// Logic tests for SPEC.md 7.9: which types files the typecheck runs against (one for each distinct content, in the
// order of their hashes, never one picked and never a refusal because they differ), the "Built on" line the gate
// prints, the hashes a "Built" block lacks, and the lines a refused validate is quoted by.
import { test } from 'node:test';
import assert from 'node:assert/strict';
// Read through the namespace, so that before the rules exist this file still loads and each test fails by itself.
import * as logic from '../hooks/mod-builder-logic.ts';

const typesToCheck = (...args) => logic.typesToCheck(...args);
const builtOnLine = (...args) => logic.builtOnLine(...args);
const builtMisses = (...args) => logic.builtMisses(...args);
const validateLines = (...args) => logic.validateLines(...args);
const refusedAt = (...args) => logic.refusedAt(...args);
const FOLDER = '/tmp/claude-1000/bundled-skills/2.1.322';
const file = (name) => `${FOLDER}/${name}/plugin-authoring/types/claude-code.d.ts`;
const one = (name, content = 'types', sha256 = 'bb') => ({ path: file(name), content, sha256 });
const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

test('one candidate is one types file to check, with its hash', () => {
  assert.deepEqual(typesToCheck([one('bbbb')], FOLDER, '2.1.322'), { pass: true, types: [{ path: file('bbbb'), sha256: 'bb' }] });
});

test('candidates whose content is the same are one file to check: the first by path, whatever order they came in', () => {
  const expected = { pass: true, types: [{ path: file('aaaa'), sha256: 'bb' }] };
  assert.deepEqual(typesToCheck([one('cccc'), one('aaaa'), one('bbbb')], FOLDER, '2.1.322'), expected);
  assert.deepEqual(typesToCheck([one('aaaa'), one('bbbb'), one('cccc')], FOLDER, '2.1.322'), expected);
});

test('candidates that differ are each checked, in the order of their hashes and never of their names: none is picked, and they are no refusal', () => {
  const sandboxed = one('0000', 'types, with allowed_domains', 'cc');
  const plain = one('zzzz', 'types', 'aa');
  const expected = { pass: true, types: [{ path: file('zzzz'), sha256: 'aa' }, { path: file('0000'), sha256: 'cc' }] };
  assert.deepEqual(typesToCheck([sandboxed, plain], FOLDER, '2.1.322'), expected);
  assert.deepEqual(typesToCheck([plain, sandboxed], FOLDER, '2.1.322'), expected);
});

test('five candidates, four the same and one that differs, are two files to check', () => {
  const same = ['5d39', 'b05e', 'b32e', 'e481'].map((name) => one(name, 'types', '60ff'));
  const verdict = typesToCheck([...same, one('a094', 'types, sandboxed', 'a33c')], FOLDER, '2.1.322');
  assert.deepEqual(verdict, { pass: true, types: [{ path: file('5d39'), sha256: '60ff' }, { path: file('a094'), sha256: 'a33c' }] });
});

test('two candidates with one hash and different content are two files to check, and so are two with one content and different hashes', () => {
  assert.equal(typesToCheck([one('aaaa', 'x', 'aa'), one('bbbb', 'y', 'aa')], FOLDER, '2.1.322').types.length, 2);
  assert.equal(typesToCheck([one('aaaa', 'x', 'aa'), one('bbbb', 'x', 'bb')], FOLDER, '2.1.322').types.length, 2);
});

test('the "Built on" line names the build, the snapshot and every hash, sorted, whatever order they are given in', () => {
  assert.equal(builtOnLine('2.1.322', '2026-11-10T194027Z', [A]), `Built on Claude Code 2.1.322, from the docs snapshot 2026-11-10T194027Z, against the types sha256 ${A}.`);
  const both = `Built on Claude Code 2.1.322, from the docs snapshot 2026-11-10T194027Z, against the types sha256 ${A}, ${B}.`;
  assert.equal(builtOnLine('2.1.322', '2026-11-10T194027Z', [B, A]), both);
  assert.equal(builtOnLine('2.1.322', '2026-11-10T194027Z', [A, B]), both);
});

test('a "Built" block that holds every hash misses none; the gate\'s own line always does', () => {
  const approved = '# turn-counter\n';
  const spec = `${approved}\n## Built\n\n${builtOnLine('2.1.322', '2026-11-10T194027Z', [B, A])}\nAs specified.\n`;
  assert.deepEqual(builtMisses(spec, approved.length, [A, B]), []);
  assert.deepEqual(builtMisses(spec, approved.length, [B]), []);
});

test('the hashes a "Built" block lacks are named, sorted: one of two, both, or all when there is no block', () => {
  const approved = '# turn-counter\n';
  assert.deepEqual(builtMisses(`${approved}\n## Built\n\n${builtOnLine('2.1.322', 's', [A])}\n`, approved.length, [B, A]), [B]);
  assert.deepEqual(builtMisses(`${approved}\n## Built\n\nBuilt on Claude Code 2.1.322.\n`, approved.length, [B, A]), [A, B]);
  assert.deepEqual(builtMisses(approved, approved.length, [A]), [A]);
  assert.deepEqual(builtMisses(`${approved}${A.slice(0, 63)}\n`, approved.length, [A]), [A]);
});

test('a hash in the approved part is not in the "Built" block, and a spec that can\'t be read lacks every hash', () => {
  const approved = `# turn-counter\ntypes sha256 ${A}\n`;
  assert.deepEqual(builtMisses(`${approved}\n## Built\n`, approved.length, [A]), [A]);
  assert.deepEqual(builtMisses(`${approved}\n## Built\n${A}\n`, approved.length, [A]), []);
  for (const bad of [null, undefined, 7]) assert.deepEqual(builtMisses(bad, 0, [A]), [A]);
  for (const length of [-1, 1.5, NaN, null]) assert.deepEqual(builtMisses(`x ${A}`, length, [A]), [A], String(length));
  assert.deepEqual(builtMisses(`x ${A}`, 0, ['']), ['']);
});

test('a refused validate is quoted by what it printed before its plugin-directory section: its last 20 lines there', () => {
  const findings = Array.from({ length: 25 }, (_, index) => `finding ${index + 1}`);
  const output = [...findings, '', 'Plugin directory checks for /work/turn-counter. The plugin directory is the catalog.', '', '  README missing', 'Validation failed', ''].join('\n');
  assert.equal(validateLines(output), findings.slice(5).join('\n'));
  assert.equal(validateLines(output, 3), 'finding 23\nfinding 24\nfinding 25');
  assert.equal(validateLines(output.replace(/\n/g, '\r\n')), findings.slice(5).join('\n'));
});

test('a validate that printed no such section, or nothing before it, is quoted by its last 20 lines, and one that printed nothing by nothing', () => {
  const lines = Array.from({ length: 25 }, (_, index) => `line ${index + 1}`);
  assert.equal(validateLines(`${lines.join('\n')}\n`), lines.slice(5).join('\n'));
  assert.equal(validateLines('the plugin has no Plugin directory checks for anything\nValidation failed\n'), 'the plugin has no Plugin directory checks for anything\nValidation failed');
  for (const nothing of ['', '\n', null, undefined, 7]) assert.equal(validateLines(nothing), '');
  assert.equal(validateLines('Plugin directory checks for /x.\nREADME missing\n'), 'Plugin directory checks for /x.\nREADME missing');
});

test('a hash that is part of a longer run of hex digits is not held by a "Built" block, and a hash given twice is asked for once', () => {
  assert.deepEqual(builtMisses(`x\nsha256 0${A}\n`, 1, [A]), [A]);
  assert.deepEqual(builtMisses(`x\nsha256 ${A}0\n`, 1, [A]), [A]);
  assert.deepEqual(builtMisses(`x\nsha256 ${A}, ${B}.\n`, 1, [A, B, A]), []);
  assert.deepEqual(builtMisses('x\n', 1, [A, A]), [A]);
  assert.equal(builtOnLine('2.1.322', 's', [A, A, B]), `Built on Claude Code 2.1.322, from the docs snapshot s, against the types sha256 ${A}, ${B}.`);
});

const THREE = ['', 'tests/pane.test.tsx:', '(pass) one [1.00ms]', '(pass) two [1.00ms]', '(pass) three [1.00ms]', '', ' 3 pass', ' 0 fail', 'Ran 3 tests across 1 file. [0.21s]', ''].join('\n');
const run = (exitCode, output = '') => ({ exitCode, output });
const good = () => ({ validate: run(0), test: run(0, THREE), typecheck: run(0), load: run(0), loadShown: true });

test('a refused Green or Verify is refused at the first of the four that failed: validate, the tests, the typecheck, the load', () => {
  assert.equal(refusedAt({ ...good(), validate: run(1), test: run(1, ''), typecheck: run(2), load: run(3) }, 3), 'validate');
  assert.equal(refusedAt({ ...good(), test: run(1, ''), typecheck: run(2), load: run(3) }, 3), 'test');
  assert.equal(refusedAt({ ...good(), test: run(0, THREE) }, 4), 'test');
  assert.equal(refusedAt({ ...good(), typecheck: run(2), load: run(3) }, 3), 'typecheck');
  assert.equal(refusedAt({ ...good(), load: run(3) }, 3), 'load');
  assert.equal(refusedAt({ ...good(), loadShown: false }, 3), 'load');
});

test('a command that ended with no exit code is where the refusal is, before any that exited with an error', () => {
  assert.equal(refusedAt({ ...good(), validate: run(1), typecheck: run(NaN) }, 3), 'typecheck');
  assert.equal(refusedAt({ ...good(), validate: run(1), test: run(NaN), typecheck: run(NaN) }, 3), 'test');
  assert.equal(refusedAt({ ...good(), validate: run(NaN), load: run(NaN) }, 3), 'validate');
  assert.equal(refusedAt({ ...good(), validate: run(1), load: run(NaN) }, 3), 'load');
});

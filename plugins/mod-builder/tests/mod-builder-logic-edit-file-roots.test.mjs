// Logic tests for SPEC.md 8.14: the test files of an edit are named to the compiler as root files, under `files`,
// and `include` holds the types file and the three folders and nothing else. Through `include` the compiler keeps
// one of two files that differ only in their ending (tests/a.test.ts shut out tests/a.test.tsx); a root file is
// always checked. The last tests run a real compiler on that pair, when one is there to run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tempDir } from '../scripts/test-helpers.mjs';
import { typecheckConfig, typecheckErrors, testsFit } from '../hooks/mod-builder-logic.ts';

const MOD = '/work/mod';
const BASE = ['/t/claude-code.d.ts', '/work/mod/hooks', '/work/mod/tests', '/work/mod/types'];
const config = (testFiles) => JSON.parse(typecheckConfig('/t/claude-code.d.ts', MOD, testFiles));

test('test files are named under files, and include holds the types file and the three folders alone', () => {
  const made = config(['tests/a.test.ts', 'tests/a.test.tsx', 'hooks/.test.ts', 'lib/y.test.tsx']);
  assert.deepEqual(made.include, BASE);
  assert.deepEqual(made.files, ['/work/mod/hooks/.test.ts', '/work/mod/lib/y.test.tsx', '/work/mod/tests/a.test.ts', '/work/mod/tests/a.test.tsx']);
});

test('two test files that differ only in their ending are both named', () => {
  assert.deepEqual(config(['tests/a.test.tsx', 'tests/a.test.ts', 'tests/a.test.mts', 'tests/a.test.cts']).files, [
    '/work/mod/tests/a.test.cts', '/work/mod/tests/a.test.mts', '/work/mod/tests/a.test.ts', '/work/mod/tests/a.test.tsx',
  ]);
});

test('with no test file to name there is no files key, and the configuration is a build\'s to the byte', () => {
  for (const none of [[], null, undefined, ['hooks/register.tsx', 'tests/data.json', 'node_modules/dep/d.test.ts']]) {
    assert.equal(Object.prototype.hasOwnProperty.call(config(none), 'files'), false);
    assert.equal(typecheckConfig('/t/claude-code.d.ts', MOD, none), typecheckConfig('/t/claude-code.d.ts', MOD));
  }
  assert.deepEqual(Object.keys(config([])), ['compilerOptions', 'include']);
  assert.deepEqual(Object.keys(config(['tests/a.test.ts'])), ['compilerOptions', 'include', 'files']);
});

// ---------------------------------------------------------------------------------------- with a real compiler

// A compiler to run: the one MOD_BUILDER_TSC names, else `tsc` when the system has one. Null when there is none.
function compiler() {
  const candidates = [process.env.MOD_BUILDER_TSC, 'tsc'].filter((one) => typeof one === 'string' && one !== '');
  for (const command of candidates) {
    const ran = spawnSync(command, ['-v'], { encoding: 'utf8' });
    if (ran.status === 0 && /^Version [0-9]/.test((ran.stdout ?? '').trim())) return command;
  }
  return null;
}

const WRONG = "const wrong: number = 'not a number'\nexport {}\n";

// Lays a mod whose test files each hold one type error, writes the configuration the rule gives beside it, runs
// the compiler there, and answers what the rules read from its output.
function typecheck(command, testFiles) {
  const top = tempDir('mod-builder-roots-');
  try {
    const mod = join(top, 'mod');
    const outside = join(top, 'check');
    for (const folder of ['hooks', 'tests', 'types']) mkdirSync(join(mod, folder), { recursive: true });
    mkdirSync(outside);
    writeFileSync(join(top, 'types.d.ts'), 'declare const h: unknown\ndeclare const Fragment: unknown\n');
    writeFileSync(join(mod, 'hooks', 'register.ts'), 'export const fine = 1\n');
    for (const path of testFiles) {
      mkdirSync(join(mod, path, '..'), { recursive: true });
      writeFileSync(join(mod, path), WRONG);
    }
    writeFileSync(join(outside, 'tsconfig.json'), typecheckConfig(join(top, 'types.d.ts'), mod, testFiles));
    // `--pretty false`: under a terminal, or with FORCE_COLOR or CI set, a compiler may print its errors in another
    // shape, with colour, which the rules do not read (the test below holds what they make of it).
    const ran = spawnSync(command, ['--noEmit', '--pretty', 'false', '-p', join(outside, 'tsconfig.json')], { cwd: outside, encoding: 'utf8' });
    const run = { exitCode: ran.status, output: `${ran.stdout ?? ''}${ran.stderr ?? ''}` };
    return { run, errors: typecheckErrors(run.output, outside, mod), fit: testsFit([{ run, cwd: outside }], mod) };
  } finally {
    rmSync(top, { recursive: true, force: true });
  }
}

test('a real compiler reports the type error of each of two test files that differ only in their ending', (t) => {
  const command = compiler();
  if (command === null) return t.skip('no TypeScript compiler to run: set MOD_BUILDER_TSC to one, or install tsc');
  const { run, errors, fit } = typecheck(command, ['tests/a.test.ts', 'tests/a.test.tsx']);
  assert.equal(run.exitCode !== 0, true, run.output);
  assert.deepEqual(errors, { tests: ['tests/a.test.ts', 'tests/a.test.tsx'], others: 0, unplaced: 0 }, run.output);
  assert.deepEqual(fit, { pass: false, reason: 'the test files do not typecheck: tests/a.test.ts, tests/a.test.tsx' });
});

test('a real compiler reports a test file wherever it lies: a dot name, node_modules, bower_components, outside the three folders', (t) => {
  const command = compiler();
  if (command === null) return t.skip('no TypeScript compiler to run: set MOD_BUILDER_TSC to one, or install tsc');
  const files = ['hooks/.test.ts', 'lib/y.test.tsx', 'tests/.b.test.tsx', 'tests/.deep/c.test.ts', 'tests/bower_components/b/b.test.ts', 'tests/m.test.cts', 'tests/m.test.mts', 'tests/node_modules/dep/n.test.ts'];
  const { errors, run } = typecheck(command, files);
  assert.deepEqual(errors, { tests: files, others: 0, unplaced: 0 }, run.output);
});

test('errors printed in the compiler\'s other shape, with colour, are not read as fitting: the gate refuses', () => {
  const pretty = "\u001b[96mtests/a.test.ts\u001b[0m:\u001b[93m1\u001b[0m:\u001b[93m7\u001b[0m - \u001b[91merror\u001b[0m\u001b[90m TS2322: \u001b[0mType 'string' is not assignable to type 'number'.\n";
  assert.deepEqual(typecheckErrors(pretty, '/x', MOD), { tests: [], others: 0, unplaced: 0 });
  assert.deepEqual(testsFit([{ run: { exitCode: 1, output: pretty }, cwd: '/x' }], MOD), { pass: false, reason: 'the typecheck exited 1 and shows no error line to read' });
  assert.deepEqual(testsFit([{ run: { exitCode: 2, output: "tests/a.test.ts:1:7 - error TS2322: Type 'string' is not assignable to type 'number'.\n" }, cwd: '/x' }], MOD), {
    pass: false, reason: 'the typecheck exited 2 and shows no error line to read',
  });
});

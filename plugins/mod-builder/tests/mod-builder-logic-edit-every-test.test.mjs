// Logic tests for SPEC.md 8.13: the typecheck names every test file of an edit, reached by a folder it is given or
// not. The compiler's own list of what it passes over in a folder (a name that opens with a dot, node_modules,
// bower_components, jspm_packages) is not relied on: a file that is named is always checked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { typecheckConfig, isTestPath } from '../hooks/mod-builder-logic.ts';

const MOD = '/work/mod';
const BASE = ['/t/claude-code.d.ts', '/work/mod/hooks', '/work/mod/tests', '/work/mod/types'];
const included = (testFiles) => JSON.parse(typecheckConfig('/t/claude-code.d.ts', MOD, testFiles)).include;
const named = (testFiles) => included(testFiles).slice(BASE.length);

test('a test file under bower_components or jspm_packages inside the three folders is named', () => {
  assert.deepEqual(named(['tests/bower_components/b/b.test.ts', 'tests/jspm_packages/j/j.test.tsx', 'hooks/bower_components/h.test.ts']), [
    '/work/mod/hooks/bower_components/h.test.ts', '/work/mod/tests/bower_components/b/b.test.ts', '/work/mod/tests/jspm_packages/j/j.test.tsx',
  ]);
});

test('every test file that is source is named, whatever folder holds it and whatever the folder is called', () => {
  const files = [
    'tests/a.test.ts', 'tests/helpers.ts', 'tests/deep/er/b.test.tsx', 'hooks/x.test.ts', 'types/t.test.ts', 'lib/y.test.tsx', 'a.test.ts',
    'tests/out/o.test.ts', 'tests/dist/d.test.ts', 'tests/build/c.test.mts', 'tests/typings/e.test.cts', 'tests/vendor/v.test.ts',
  ];
  assert.equal(files.every(isTestPath), true);
  assert.deepEqual(named(files), files.map((path) => `/work/mod/${path}`).sort());
});

test('the three folders and the types file still come first, and the named files after them, sorted and once each', () => {
  const include = included(['tests/b.test.ts', 'hooks/a.test.ts', 'tests/b.test.ts', './tests/b.test.ts']);
  assert.deepEqual(include.slice(0, BASE.length), BASE);
  assert.deepEqual(include.slice(BASE.length), ['/work/mod/hooks/a.test.ts', '/work/mod/tests/b.test.ts']);
});

test('what is no test file of the edit is still not named: code, a dependency\'s test, a file that is no source', () => {
  assert.deepEqual(named(['hooks/register.tsx', 'lib/util.ts', 'node_modules/dep/d.test.ts', 'hooks/node_modules/q/h.test.ts', 'tests/data.json', 'tests/a.test.js', 'tests/U.TEST.TS', 'SPEC.md']), []);
  assert.deepEqual(named([]), []);
  assert.equal(typecheckConfig('/t/claude-code.d.ts', MOD, []), typecheckConfig('/t/claude-code.d.ts', MOD));
});

// ------------------------------------------------------- cases the independent reader of these tests asked for

test('named files are sorted by their characters\' codes, and names that differ only in letter case are both kept', () => {
  assert.deepEqual(named(['tests/b.test.ts', 'tests/B.test.ts', 'tests/.a.test.ts', 'tests/_c.test.ts']), [
    '/work/mod/tests/.a.test.ts', '/work/mod/tests/B.test.ts', '/work/mod/tests/_c.test.ts', '/work/mod/tests/b.test.ts',
  ]);
  assert.deepEqual(named(['tests/x.test.ts', 'tests/X.test.ts']), ['/work/mod/tests/X.test.ts', '/work/mod/tests/x.test.ts']);
});

test('however many test files there are, each is named', () => {
  const files = Array.from({ length: 300 }, (_, index) => `lib/deep/t${index}.test.ts`);
  assert.equal(named(files).length, 300);
  assert.equal(named(files).includes('/work/mod/lib/deep/t299.test.ts'), true);
});

test('a file outside tests/ whose name is a test\'s only in other letter case is no test file, and is not named', () => {
  assert.deepEqual(named(['lib/a.TEST.ts', 'hooks/b.Test.tsx', 'lib/a.test.ts']), ['/work/mod/lib/a.test.ts']);
});

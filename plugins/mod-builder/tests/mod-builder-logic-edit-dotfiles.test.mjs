// Logic tests for SPEC.md 8.10's "the typecheck must cover every test file": the compiler passes over a file whose
// name, or a folder on its way, opens with a dot when it is given the folder that holds it, and `claude plugin
// test` runs hooks/.test.ts and tests/.b.test.tsx. So the typecheck names such a test file itself, inside hooks/,
// tests/ and types/ as outside them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { typecheckConfig } from '../hooks/mod-builder-logic.ts';

const MOD = '/work/mod';
const BASE = ['/t/claude-code.d.ts', '/work/mod/hooks', '/work/mod/tests', '/work/mod/types'];
const included = (testFiles) => JSON.parse(typecheckConfig('/t/claude-code.d.ts', MOD, testFiles)).include;

test('a test file whose name opens with a dot is named, though it lies in hooks/, tests/ or types/', () => {
  assert.deepEqual(included(['hooks/.test.ts']), [...BASE, '/work/mod/hooks/.test.ts']);
  assert.deepEqual(included(['tests/.b.test.tsx', 'types/.t.test.ts', 'hooks/.test.ts']), [
    ...BASE, '/work/mod/hooks/.test.ts', '/work/mod/tests/.b.test.tsx', '/work/mod/types/.t.test.ts',
  ]);
});

test('a test file under a folder whose name opens with a dot is named too, at any depth', () => {
  assert.deepEqual(included(['tests/.deep/c.test.ts', 'hooks/a/.hid/b/d.test.tsx']), [...BASE, '/work/mod/hooks/a/.hid/b/d.test.tsx', '/work/mod/tests/.deep/c.test.ts']);
  assert.deepEqual(included(['.hid/e.test.ts', '.test.ts']), [...BASE, '/work/mod/.hid/e.test.ts', '/work/mod/.test.ts']);
});

// SPEC.md 8.13: a test file the three folders would reach is named as well. Which files a folder reaches is the
// compiler's own list (it also passes over bower_components and jspm_packages), and nothing rests on it now.
test('a test file the three folders reach is named as well, by its path made whole', () => {
  assert.deepEqual(included(['tests/a.test.ts', 'hooks/x.test.ts', 'types/deep/t.test.ts', 'tests/a.b.test.tsx', 'hooks/a.dir/x.test.ts']), [
    ...BASE, '/work/mod/hooks/a.dir/x.test.ts', '/work/mod/hooks/x.test.ts', '/work/mod/tests/a.b.test.tsx', '/work/mod/tests/a.test.ts', '/work/mod/types/deep/t.test.ts',
  ]);
  assert.deepEqual(included(['./tests/a.test.ts', 'tests/x/../a.test.ts', 'tests/./a.test.ts']), [...BASE, '/work/mod/tests/a.test.ts']);
});

test('each such file is named once, by its path made whole, and what is no test file is not named', () => {
  assert.deepEqual(included(['hooks/.test.ts', './hooks/.test.ts', 'hooks//.test.ts', 'hooks/x/../.test.ts']), [...BASE, '/work/mod/hooks/.test.ts']);
  assert.deepEqual(included(['hooks/.hid/util.ts', 'lib/.util.ts']), BASE);
  // Under tests/ everything is a test file: a helper the folder does not reach is named, when it is source the
  // compiler reads.
  assert.deepEqual(included(['tests/.helpers.ts', 'tests/.env', 'tests/.deep/data.json', 'tests/.deep/notes.ts.bak']), [...BASE, '/work/mod/tests/.helpers.ts']);
  assert.deepEqual(included(['tests/node_modules/.n.test.ts']), [...BASE, '/work/mod/tests/node_modules/.n.test.ts']);
});

// ------------------------------------------------------- cases the independent reader of these tests asked for

test('a dot opens a name at any depth and before any character: each such test file is named', () => {
  assert.deepEqual(included(['tests/a/b/c/.deep/z.test.ts']), [...BASE, '/work/mod/tests/a/b/c/.deep/z.test.ts']);
  assert.deepEqual(included(['tests/.-a.test.ts', 'tests/..x/y.test.ts', 'hooks/.git/h.test.ts', 'tests/.github/g.test.tsx']), [
    ...BASE, '/work/mod/hooks/.git/h.test.ts', '/work/mod/tests/.-a.test.ts', '/work/mod/tests/..x/y.test.ts', '/work/mod/tests/.github/g.test.tsx',
  ]);
});

test('a test file under a node_modules folder inside tests/ is named: the compiler passes that folder over too', () => {
  assert.deepEqual(included(['tests/node_modules/dep/n.test.ts', 'tests/a/node_modules/x.ts']), [...BASE, '/work/mod/tests/a/node_modules/x.ts', '/work/mod/tests/node_modules/dep/n.test.ts']);
  // Under hooks/ such a file is no test file at all; one in a folder that only holds the word is one (SPEC.md 8.13).
  assert.deepEqual(included(['hooks/node_modules/q/h.test.ts', 'tests/node_modules_old/a.test.ts']), [...BASE, '/work/mod/tests/node_modules_old/a.test.ts']);
});

test('the three folders are named as spelled: a test file under Tests/ or HOOKS/ is outside them, and is named', () => {
  assert.deepEqual(included(['Tests/a.test.ts', 'HOOKS/x.test.tsx']), [...BASE, '/work/mod/HOOKS/x.test.tsx', '/work/mod/Tests/a.test.ts']);
});

test('source the compiler reads when named is named, .mts and .cts included, and nothing else is', () => {
  assert.deepEqual(included(['tests/.d/m.mts', 'tests/.d/c.cts', 'tests/.d/d.test.d.ts']), [...BASE, '/work/mod/tests/.d/c.cts', '/work/mod/tests/.d/d.test.d.ts', '/work/mod/tests/.d/m.mts']);
  assert.deepEqual(included(['tests/.d/U.TEST.TS', 'tests/.d/a.js', 'tests/.d/lists', 'tests/.rts', 'tests/.d/a.ts.txt', 'tests/.d/a.mtsx']), BASE);
});

test('test files that are no list name nothing, and nothing throws', () => {
  for (const none of ['tests/.a.test.ts', { 0: 'tests/.a.test.ts', length: 1 }, 7, undefined, null]) assert.deepEqual(included(none), BASE);
});

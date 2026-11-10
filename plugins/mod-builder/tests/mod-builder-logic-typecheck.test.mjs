// Logic tests for Verify's typecheck (SPEC.md 7.5, the second of step 4's settled points): where the build's own
// types are looked for, what makes a file those types, the tsconfig written outside the mod, and what counts as a
// compiler that answered.
import { test } from 'node:test';
import assert from 'node:assert/strict';
// Read through the namespace, so that before the rules exist this file still loads and each test fails by itself.
import * as logic from '../hooks/mod-builder-logic.ts';

const typesFolder = (...args) => logic.typesFolder(...args);
const typesFileIn = (...args) => logic.typesFileIn(...args);
const isTypesOf = (...args) => logic.isTypesOf(...args);
const typecheckConfig = (...args) => logic.typecheckConfig(...args);
const isCompiler = (...args) => logic.isCompiler(...args);

const run = (exitCode, output = '') => ({ exitCode, output });

test('the types are looked for under CLAUDE_TMPDIR, in the folder of the session\'s own version', () => {
  assert.equal(typesFolder('/tmp/claude-1000', null, '2.1.322'), '/tmp/claude-1000/bundled-skills/2.1.322');
  assert.equal(typesFolder('/private/tmp/claude-501/', '501', '2.1.400'), '/private/tmp/claude-501/bundled-skills/2.1.400');
  assert.equal(typesFolder('/tmp/x/../claude-1000', null, '2.1.322'), '/tmp/claude-1000/bundled-skills/2.1.322');
});

test('without CLAUDE_TMPDIR the folder is /tmp/claude-<user id>, and only a number is a user id', () => {
  assert.equal(typesFolder(undefined, '1000\n', '2.1.322'), '/tmp/claude-1000/bundled-skills/2.1.322');
  assert.equal(typesFolder('', ' 501 ', '2.1.322'), '/tmp/claude-501/bundled-skills/2.1.322');
  assert.equal(typesFolder('relative/tmp', '1000', '2.1.322'), '/tmp/claude-1000/bundled-skills/2.1.322');
  assert.equal(typesFolder('/', '1000', '2.1.322'), '/tmp/claude-1000/bundled-skills/2.1.322');
  for (const id of [undefined, null, '', 'root', '10 00', '1000; rm', '../1000', '-1', 1000]) {
    assert.equal(typesFolder(undefined, id, '2.1.322'), null, String(id));
  }
});

test('a version that is no version places no folder: it is a part of a path', () => {
  for (const version of ['', '..', '../2.1.322', '2.1.322/..', '2.1 322', '.2', undefined, null, 2]) {
    assert.equal(typesFolder('/tmp/claude-1000', '1000', version), null, String(version));
  }
  assert.equal(typesFolder('/tmp/claude-1000', null, '2.1.322-beta.1+build'), '/tmp/claude-1000/bundled-skills/2.1.322-beta.1+build');
});

test('a process\'s types file is under its folder, where the plugin-authoring skill writes it', () => {
  assert.equal(typesFileIn('/tmp/claude-1000/bundled-skills/2.1.322', '5d3947d0'), '/tmp/claude-1000/bundled-skills/2.1.322/5d3947d0/plugin-authoring/types/claude-code.d.ts');
});

test('a types file is this build\'s only when its first line names the session\'s version, whole', () => {
  assert.equal(isTypesOf('// Written by Claude Code 2.1.322.\n// more\n', '2.1.322'), true);
  assert.equal(isTypesOf('// Written by Claude Code 2.1.322.', '2.1.322'), true);
  assert.equal(isTypesOf('// Written by Claude Code 2.1.322.\n', '2.1.32'), false);
  assert.equal(isTypesOf('// Written by Claude Code 2.1.3220.\n', '2.1.322'), false);
  assert.equal(isTypesOf('// Written by Claude Code 2.1.322. And more\n', '2.1.322'), false);
  assert.equal(isTypesOf('\n// Written by Claude Code 2.1.322.\n', '2.1.322'), false);
  assert.equal(isTypesOf('// a note\n// Written by Claude Code 2.1.322.\n', '2.1.322'), false);
  assert.equal(isTypesOf('// Written by Claude Code .\n', ''), false);
  assert.equal(isTypesOf('', '2.1.322'), false);
  assert.equal(isTypesOf(null, '2.1.322'), false);
});

test('the tsconfig names the types file and the mod\'s hooks, tests and types by full path, with the options the types file gives', () => {
  const text = typecheckConfig('/tmp/claude-1000/bundled-skills/2.1.322/a/plugin-authoring/types/claude-code.d.ts', '/work/turn-counter');
  assert.equal(text.endsWith('}\n'), true);
  assert.deepEqual(JSON.parse(text), {
    compilerOptions: {
      target: 'es2023', lib: ['es2023'], types: [], module: 'esnext', moduleResolution: 'bundler', strict: true,
      noUncheckedIndexedAccess: true, noEmit: true, skipLibCheck: true, jsx: 'react', jsxFactory: 'h', jsxFragmentFactory: 'Fragment',
    },
    include: [
      '/tmp/claude-1000/bundled-skills/2.1.322/a/plugin-authoring/types/claude-code.d.ts',
      '/work/turn-counter/hooks', '/work/turn-counter/tests', '/work/turn-counter/types',
    ],
  });
});

test('a folder name with a quote or a backslash is still one path in the tsconfig', () => {
  const mod = '/work/a "mod"\\x';
  assert.deepEqual(JSON.parse(typecheckConfig('/t/claude-code.d.ts', mod)).include.slice(1), [`${mod}/hooks`, `${mod}/tests`, `${mod}/types`]);
});

test('an installed compiler is tried before one npx downloads, and neither is anything but npx running tsc', () => {
  assert.deepEqual(logic.COMPILERS, [['npx', '--no-install', 'tsc'], ['npx', '-y', '-p', 'typescript', 'tsc']]);
});

test('a compiler answered when it exited 0 and said its version; anything else is no compiler', () => {
  assert.equal(isCompiler(run(0, 'Version 5.9.3\n')), true);
  assert.equal(isCompiler(run(0, 'Version 7.0.2')), true);
  assert.equal(isCompiler(run(127, 'Version 5.9.3\n')), false);
  assert.equal(isCompiler(run(0, '')), false);
  assert.equal(isCompiler(run(0, 'tsc: Permission denied\n')), false);
  assert.equal(isCompiler(run(0, 'Version unknown\n')), false);
  assert.equal(isCompiler(run(NaN, '')), false);
  for (const bad of [null, undefined, 'Version 5', { exitCode: 0 }, { exitCode: 0, output: 5 }]) assert.equal(isCompiler(bad), false);
});

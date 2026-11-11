// Tests for what the build skill says of SPEC.md 9.17: Red's gate checks that hooks/ is still as the scaffold
// laid it, and hooks/ alone is laid again with the script's --again-hooks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scriptsDir } from './test-helpers.mjs';

const body = readFileSync(join(scriptsDir, '..', 'skills', 'build', 'SKILL.md'), 'utf8');
const section = (number) => {
  const from = body.indexOf(`### ${number}. `);
  const next = body.slice(from + 4).search(/\n#{2,3} /);
  return (from < 0 ? '' : body.slice(from, next < 0 ? undefined : from + 4 + next)).replace(/\s+/g, ' ');
};

test('Red says its gate checks hooks/ first and again before it passes', () => {
  assert.match(section(5), /Then call the gate\. It first checks that `hooks\/` is still as the scaffold laid it, and again before it passes:/);
});

test('Red gives the way back for hooks/ alone, and says to remove what is extra', () => {
  assert.match(section(5), /if it names a file there, lay `hooks\/` alone again with `scaffold\.sh --again-hooks <mod folder> <mod-name>` \(the script of phase 4\) and remove each file it lists as extra\./);
});

test('Red still says what follows: the typecheck after the test run, and the hashes', () => {
  assert.match(section(5), /After the test run it typechecks the mod, tests included, against this build's types/);
  assert.match(section(5), /Then it hashes every file under `tests\/`/);
});

// Tests for what the build skill says of SPEC.md 7.10: Scaffold's gate and Red's gate end on the typecheck, because
// the files it judges close when each passes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scriptsDir } from './test-helpers.mjs';

const text = readFileSync(join(scriptsDir, '..', 'skills', 'build', 'SKILL.md'), 'utf8');
const body = text.slice(text.indexOf('\n---\n', 4) + 5);
// One phase's section of the skill: from its heading to the next phase's, or to the section after the phases.
const section = (number) => {
  const from = body.indexOf(`### ${number}. `);
  const next = body.slice(from + 4).search(/\n### [1-8]\. |\n## Handing /);
  return (from < 0 ? '' : body.slice(from, next < 0 ? undefined : from + 4 + next)).replace(/\s+/g, ' ');
};
const row = (number) => (body.split('\n').find((line) => line.startsWith(`| ${number} |`)) ?? '').split('|').map((cell) => cell.trim());

test('the table of phases says Scaffold and Red each pass only when the typecheck passes', () => {
  assert.equal(row(4)[4], 'validate passes, the tests pass, the typecheck passes');
  assert.equal(row(5)[4], 'more tests than at Scaffold, a new one failing on an assertion; the typecheck passes');
});

test('Scaffold says its gate typechecks the mod, why, and to declare there what the tests of phase 5 will name', () => {
  const scaffold = section(4);
  assert.match(scaffold, /Then call the gate, which runs the validator and the tests, records the tests that exist now, and typechecks the mod against this build's types\./);
  assert.match(scaffold, /Everything but `tests\/` closes when Scaffold passes and opens again only at Green, and Red ends on the same typecheck: declare here whatever the tests of phase 5 will name \(a type in the contract, a value the module exports\), because a test can't typecheck against what is not there\./);
});

test('Red says its gate typechecks the tests after the test run, why, and that a refusal carries the compiler\'s last lines', () => {
  const red = section(5);
  assert.match(red, /After the test run it typechecks the mod, tests included, against this build's types: `tests\/` closes for good when Red passes, so a test that does not typecheck is refused here, with the compiler's last lines, while you can still change it\./);
  assert.match(red, /Then it hashes every file under `tests\/`; from here a changed test stops the build at the next gate/);
});

test('Describe says the types the plugin-authoring skill writes are needed from phase 4 on', () => {
  assert.match(section(2), /the typecheck that ends phases 4 to 7 needs that file to exist\./);
});

test('the skill is still under 200 lines, with no line over 115 characters outside its frontmatter', () => {
  assert.equal(text.split('\n').length < 200, true);
  assert.deepEqual(body.split('\n').filter((line) => line.length > 115 && !line.startsWith('|')), []);
});

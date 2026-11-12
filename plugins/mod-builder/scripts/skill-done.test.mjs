// Tests for what the build skill says of SPEC.md 7.11: at Scaffold every test has to pass, and at Done the model
// offers nothing this plugin does not have (no sharing step). Since 0.2.0 (SPEC.md 8.9, step 3) Done names the
// edit skill as how a finished mod is changed.
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

test('Done says how a finished mod is changed, with the edit skill, and to offer nothing else: no sharing step', () => {
  const done = section(8);
  assert.match(done, /Tell them that a change to the finished mod, or a repair after a Claude Code update, is made with `\/mod-builder:edit <mod folder> <what to change>`\./);
  assert.match(done, /Offer nothing else: this plugin has no sharing step yet, and the `plugin-authoring` skill's offer to share the mod as a GitHub repository is not made here\./);
});

test('Done still says what to tell the person, and never to push', () => {
  const done = section(8);
  assert.match(done, /Tell the person what was built and where, how to load it/);
  assert.match(done, /Never push\./);
});

test('Scaffold says every test has to pass there, and what is refused', () => {
  const scaffold = section(4);
  // The template's files are no longer reshaped at Scaffold (SPEC.md 9.4): a mod of another shape replaces them later.
  assert.doesNotMatch(scaffold, /reshape/);
  assert.match(scaffold, /its tests replace the template's at Red and its code the template's at Green\./);
  assert.match(scaffold, /Every test has to pass here: a test that fails at Scaffold, or a module that throws as it loads, is refused with the test run's last lines\./);
  assert.doesNotMatch(scaffold, /at least one passing test/);
});

test('the skill is still under 200 lines, with no line over 115 characters outside its frontmatter', () => {
  assert.equal(text.split('\n').length < 200, true);
  assert.deepEqual(body.split('\n').filter((line) => line.length > 115 && !line.startsWith('|')), []);
});

// ------------------------------------------------------------------- what the tests' reader asked for

test('Done makes no offer but the one that says there is none, and names the edit skill once', () => {
  const rest = section(8)
    .replace(/Tell them that a change to the finished mod, or a repair after a Claude Code update, is made with `\/mod-builder:edit <mod folder> <what to change>`\./, '')
    .replace(/Offer nothing else: this plugin has no sharing step yet, and the `plugin-authoring` skill's offer to share the mod as a GitHub repository is not made here\./, '');
  assert.doesNotMatch(rest, /\boffer|\bsuggest|\bshar|GitHub|\bedit\b/i);
});

test('the table says the Scaffold gate wants the tests to pass, not only to run', () => {
  const row = body.split('\n').find((line) => line.startsWith('| 4 | Scaffold')) ?? '';
  assert.match(row, /the tests pass/);
  assert.doesNotMatch(row, /the tests run/);
});

// Tests for what the build skill says of SPEC.md 7.11: at Scaffold every test has to pass, and at Done the model
// offers nothing this plugin does not have (no edit skill, no sharing step).
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

test('Done says to offer nothing else: no edit skill, no sharing step, and how a finished mod is changed', () => {
  const done = section(8);
  assert.match(done, /Offer nothing else\. This plugin has no edit skill and no sharing step yet: there is no `\/mod-builder:edit`, and the `plugin-authoring` skill's offer to share the mod as a GitHub repository is not made here\./);
  assert.match(done, /A change to a finished mod is made by hand, or by a new build in a fresh folder\./);
});

test('Done still says what to tell the person, and never to push', () => {
  const done = section(8);
  assert.match(done, /Tell the person what was built and where, how to load it/);
  assert.match(done, /Never push\./);
});

test('Scaffold says every test has to pass there, and what is refused', () => {
  const scaffold = section(4);
  assert.match(scaffold, /reshape `hooks\/register\.tsx` and `tests\/pane\.test\.tsx` here, with every test passing\./);
  assert.match(scaffold, /Every test has to pass here: a test that fails at Scaffold, or a module that throws as it loads, is refused with the test run's last lines\./);
  assert.doesNotMatch(scaffold, /at least one passing test/);
});

test('the skill is still under 200 lines, with no line over 115 characters outside its frontmatter', () => {
  assert.equal(text.split('\n').length < 200, true);
  assert.deepEqual(body.split('\n').filter((line) => line.length > 115 && !line.startsWith('|')), []);
});

// ------------------------------------------------------------------- what the tests' reader asked for

test('Done makes no offer but the one that says there is none', () => {
  const rest = section(8)
    .replace(/Offer nothing else\. This plugin has no edit skill and no sharing step yet: there is no `\/mod-builder:edit`, and the `plugin-authoring` skill's offer to share the mod as a GitHub repository is not made here\./, '')
    .replace(/A change to a finished mod is made by hand, or by a new build in a fresh folder\./, '');
  assert.doesNotMatch(rest, /\boffer|\bsuggest|\bshar|GitHub|\bedit\b/i);
});

test('the table says the Scaffold gate wants the tests to pass, not only to run', () => {
  const row = body.split('\n').find((line) => line.startsWith('| 4 | Scaffold')) ?? '';
  assert.match(row, /the tests pass/);
  assert.doesNotMatch(row, /the tests run/);
});

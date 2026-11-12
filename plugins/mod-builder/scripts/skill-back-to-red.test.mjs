// Tests for what the model is told of the way back to Red (SPEC.md 9.11, 9.30): one reference file both skills
// name in their Green section, so that neither skill passes its 200 lines. The file says the gate's own words,
// taken from the rules: a changed rule that the file does not follow fails here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scriptsDir } from './test-helpers.mjs';
import * as rules from '../hooks/mod-builder-logic.ts';

const plugin = join(scriptsDir, '..');
const NAMED = '`${CLAUDE_PLUGIN_ROOT}/reference/back-to-red.md`';
const file = join(plugin, 'reference/back-to-red.md');
const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
// The text with every run of white space as one space, so that a sentence broken over two lines still reads.
const flat = text.replace(/\s+/g, ' ');
const skill = (name) => readFileSync(join(plugin, 'skills', name, 'SKILL.md'), 'utf8');
// A skill's Green section, from its heading to the next phase's, with white space as one space.
const green = (name, number) => {
  const body = skill(name);
  const from = body.indexOf(`### ${number}. Green\n`);
  const next = body.indexOf(`\n### ${number + 1}. Verify\n`);
  return from < 0 || next < 0 ? '' : body.slice(from, next).replace(/\s+/g, ' ');
};
const SENTENCE = `The gate offers a way back to Red after Green's tests fail twice running: read ${NAMED} when it does.`;

test('the build skill\'s Green section says the gate offers a way back to Red, and names the reference file', () => {
  const section = green('build', 6);
  assert.equal(section.includes(`Tests are frozen: if one turns out wrong, stop and say so to the person instead of changing it. ${SENTENCE}`), true);
});

test('the edit skill\'s Green section says the same, and names the reference file', () => {
  const section = green('edit', 5);
  assert.equal(section.includes(`Tests are frozen: if one turns out wrong, stop and say so to the person. ${SENTENCE}`), true);
});

test('neither skill says any longer that the work can\'t go back to Red, and each names the file once, in its Green section', () => {
  for (const [name, number] of [['build', 6], ['edit', 5]]) {
    const body = skill(name);
    assert.equal(/can't go back to Red/.test(body.replace(/\s+/g, ' ')), false, name);
    assert.equal(body.split(NAMED).length - 1, 1, name);
    assert.equal(green(name, number).includes(NAMED), true, name);
  }
});

test('each skill is still under 200 lines, with no line over 115 characters outside its frontmatter', () => {
  for (const name of ['build', 'edit']) {
    const body = skill(name);
    assert.equal(body.split('\n').length < 200, true, name);
    assert.equal(body.endsWith('\n') && !body.endsWith('\n\n'), true, name);
    const after = body.replace(/^---\n[\s\S]*?\n---\n/, '');
    assert.deepEqual(after.split('\n').filter((line) => line.length > 115 && !line.startsWith('|')), [], name);
  }
});

test('the reference file exists, is short, and is plain ASCII with no line over 115 characters', () => {
  assert.equal(existsSync(file), true);
  assert.equal(text.split('\n').length <= 40, true);
  assert.deepEqual(text.split('\n').filter((line) => line.length > 115), []);
  assert.equal(/^[\x20-\x7E\n]*$/.test(text), true);
  assert.equal(text.endsWith('\n') && !text.endsWith('\n\n'), true);
  assert.equal(/sonnet|opus|haiku/i.test(text), false);
});

test('it says when the way back is offered, in the gate\'s own words, and what a call that was not offered answers', () => {
  assert.equal(flat.includes(`its answer ends: "${rules.BACK_TO_RED_OFFER}"`), true);
  assert.equal(flat.includes(`the call is answered "${rules.BACK_NOT_OFFERED}"`), true);
  assert.equal(flat.includes(`refused ${['zero', 'once', 'twice'][rules.BACK_TO_RED_AFTER]} in a row for the test run`), true);
});

test('it says how to ask, that the person decides, and which answer goes back', () => {
  assert.equal(flat.includes('call the gate with `back_to_red: true`'), true);
  assert.equal(flat.includes(`mod-builder asks them "Go back to Red to change the tests?", naming the failing tests, with "${rules.NOT_YET}" first. Only "${rules.GO_BACK}" goes back.`), true);
  assert.equal(rules.backToRedQuestion(['x'], 2, 0).startsWith('Go back to Red to change the tests?'), true);
  assert.deepEqual(rules.backToRedOptions(), [rules.NOT_YET, rules.GO_BACK]);
});

test('it says what the returned Red is: tests open, the code closed and kept, nothing changed by going back', () => {
  assert.equal(flat.includes('Back at Red, test files are open (in an edit, wherever they sit) and everything else is closed: the code you wrote stays as it is. Change only the tests that are wrong. Nothing in the mod was changed by going back.'), true);
});

test('it says how the returned Red ends, with the rule\'s own refusal for unchanged tests', () => {
  const refusal = rules.returnedRedChanged({ 'tests/a.test.ts': 'a'.repeat(64) }, { 'tests/a.test.ts': 'a'.repeat(64) }).reason;
  assert.equal(flat.includes(`at least one test file must differ from when Red passed before, else: "${refusal}"`), true);
  assert.equal(flat.includes('the tests are run and may now pass, since the code exists; a test file that does not load, or a run where no failing test fails by assertion, is refused'), true);
  assert.equal(flat.includes('the test files are typechecked'), true);
  assert.equal(flat.includes(`the person is asked about each test file that existed before and is changed or gone (a new file raises no question): they see how many lines were added and removed, the removed lines that hold an \`expect\` or open a test (at most ${rules.QUOTED_LINES}), and the names of tests that no longer exist. "${rules.NOT_YET}" is first, and holds Red;`), true);
  assert.equal(flat.includes('the test reader reads the test files that are new or changed, and its findings hold this Red as they hold any: change the tests and call the gate again (see `test-reader.md` beside this file).'), true);
});

test('it says each return is counted and shown, and warns against weakening a test', () => {
  assert.equal(flat.includes('each return is counted, shown in the pane, and from the third on the question says how often the work went back already'), true);
  assert.equal(flat.includes('Going back to make a failing test pass by weakening it: the person is shown what the test lost.'), true);
});

test('it opens by saying what it is not for: a failing run mostly means the code is not done', () => {
  assert.equal(flat.includes('Read this when Green\'s gate offers it. Tests are frozen at Green, and most failing runs mean the code is not done: fix the code. This is for the other case: a test that is itself wrong, which no code could pass.'), true);
});

test('it says where the work stands after the returned Red: at Green, held to the tests as they are now, its refusals counted from none', () => {
  assert.equal(flat.includes('5. Then you are at Green again, held to the test files, the count and the names as they are now. Green counts its refusals from none again.'), true);
  assert.equal(rules.greenTestRefusals(0, true), 1);
});

test('docs/limits says who decides the way back, and that a held folder never expires', () => {
  const limits = readFileSync(join(plugin, '..', '..', 'docs', 'limits', 'README.md'), 'utf8').replace(/\s+/g, ' ');
  assert.equal(limits.includes('**Going back is the person\'s decision, and it is counted, not capped.**'), true);
  assert.equal(limits.includes(`After Green's test run fails twice in a row the gate offers \`back_to_red\`; only the person's "${rules.GO_BACK}" takes it.`), true);
  assert.equal(limits.includes('Nothing expires, and in 0.3.0 no other session can release it: resume the holding session (`claude --resume <its id>`) and run `/mod-builder stop` there, or name another folder.'), true);
});

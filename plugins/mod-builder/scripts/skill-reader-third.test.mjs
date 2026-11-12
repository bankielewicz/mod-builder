// Tests for the wording of SPEC.md 9.36 and 9.37: when the person is asked (after two rounds; after the second,
// changed tests are read once more; never a fourth reading before the person has answered), when the prompt
// comes, in the reference file and in docs/limits; and what lies outside the mod's folder, in docs/limits beside
// the closed Scaffold. The words are the rules' own where the rules have them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scriptsDir } from './test-helpers.mjs';
import * as rules from '../hooks/mod-builder-logic.ts';

const plugin = join(scriptsDir, '..');
const flatOf = (...parts) => readFileSync(join(plugin, ...parts), 'utf8').replace(/\s+/g, ' ');
const file = flatOf('reference', 'test-reader.md');
const limits = flatOf('..', '..', 'docs', 'limits', 'README.md');
// One section of docs/limits, from its heading to the next.
const section = (heading) => {
  const from = limits.indexOf(`## ${heading}`);
  const next = limits.indexOf(' ## ', from + 3);
  return from < 0 ? '' : limits.slice(from, next < 0 ? undefined : next);
};

test('the reference file quotes the gate\'s words while the reader is out as the rules have them: the report is handed back, or mod-builder prompts', () => {
  assert.equal(rules.READER_STARTED, 'the test reader is reading the tests against the spec. End your turn now: its report is handed back to you, or mod-builder prompts you. Call the gate then, and not before');
  assert.equal(file.includes(`"${rules.READER_STARTED}"`), true);
  assert.equal(file.includes(`"${String(rules.readerReading(7)).replace('(7 s)', '(N s)')}"`), true);
  assert.equal(String(rules.readerReading(7)), 'the test reader is still reading (7 s). End your turn: its report is handed back to you, or mod-builder prompts you');
  assert.equal(file.includes('will prompt you when it has reported'), false);
});

test('the reference file says the report is handed over or prompted, quotes the prompt as the rules have it, and that none comes after a call already made', () => {
  assert.equal(typeof rules.READER_NUDGE, 'string');
  assert.equal(file.includes(` 2. Its report is handed to you, or mod-builder prompts you: "${rules.READER_NUDGE}" Call the gate, once. The prompt is sent only while the report is unread at Red: none comes when you have called the gate already. 3. A call while it still reads answers "`), true);
  assert.equal(rules.READER_NUDGE.includes('If the build is still at Red, call mod_builder_gate; if it has moved on, do nothing.'), true);
  assert.equal(file.includes('has reported. Call mod_builder_gate.'), false);
});

test('the reference file says when the person is asked: after two rounds; after the second, changed tests are read once more; after three, no reading before the answer', () => {
  assert.equal(file.includes(`After ${rules.READER_ROUNDS} rounds that did not pass, the gate asks the person, showing the last round's findings. "${rules.NOT_YET}" comes first; only "${rules.GO_ON_TESTS}" passes Red. Tests changed after the second such round are read once more as they are: a pass goes on, anything else asks the person. Once ${rules.READER_ROUNDS + 1} rounds did not pass, no reading is started before the person has answered "${rules.NOT_YET}": for tests changed since the last reading, the question says they were not read as they are now. Every later round that does not pass ends with the person asked again`), true);
  // The count the sentence rests on is the rule's, and so is the answer.
  assert.equal(typeof rules.readerMayStart, 'function');
  assert.equal(rules.readerMayStart(rules.READER_ROUNDS, false), true);
  assert.equal(rules.readerMayStart(rules.READER_ROUNDS + 1, false), false);
  assert.equal(rules.readerMayStart(rules.READER_ROUNDS + 1, true), true);
  assert.equal(String(rules.TESTS_NOT_READ).includes('have not been read as they are now'), true);
});

test('the reference file no longer says the person is only ever asked about the tests as they are', () => {
  assert.equal(file.includes('no reading is started before the person has answered'), true);
  assert.equal(file.includes('only ever asked about a reading of the tests as they are'), false);
  assert.equal(file.includes('tests changed since the last reading are read first'), false);
});

test('docs/limits says when the person is asked, in the test reader\'s section: two rounds, one more reading of changed tests, after three none unasked', () => {
  const reader = section('The test reader (0.3.0, not released)');
  assert.equal(reader.includes(`After two rounds that do not pass the person is asked; when the tests changed after the second, they are read once more as they stand: a pass goes on, and anything else asks the person. Once three rounds did not pass, no reading is started before the person has answered "${rules.NOT_YET}". The person's answer is the last word: "${rules.GO_ON_TESTS}" passes Red with the findings as they are, and, when the tests changed after the last reading, with tests that no reader read as they are; the question says so.`), true);
  assert.equal(rules.READER_ROUNDS, 2);
  assert.equal(limits.includes('After two rounds that do not pass, the person\'s answer is the last word'), false);
});

test('docs/limits says the prompt comes once for a reading and only while the answer is unread at Red, that a late one says to do nothing, and when one that was refused is tried again', () => {
  const reader = section('The test reader (0.3.0, not released)');
  assert.equal(reader.includes('- **The gate has to be called after the reader ends.** The reader\'s report is handed to the model, which may call the gate at once; else mod-builder prompts it, once for a reading and only while that answer is unread at Red. When the prompt can\'t be sent, or the session ended meanwhile, the build stays at Red until the gate is called, which reads the stored answer. A prompt that was queued can\'t be recalled: one that arrives late says to do nothing when the build has moved on. A prompt that was refused is tried once more, and only when the next main turn ends: in a session that stays idle it is not sent again. A main turn that never reports its end holds the prompt until a later turn ends.'), true);
  assert.equal(String(rules.READER_NUDGE).endsWith('if it has moved on, do nothing.'), true);
});

test('docs/limits says, beside the closed Scaffold, that mod-builder sees only the mod\'s folder', () => {
  const scaffold = section('Scaffold and the template (0.3.0, not released)');
  assert.equal(scaffold.includes('- **mod-builder sees only the mod\'s folder**: code written ahead and kept anywhere else (a scratch file, the conversation itself) is not seen, and can be written into `hooks/` at Green.'), true);
  assert.equal(limits.split('sees only the mod\'s folder').length - 1, 1);
});

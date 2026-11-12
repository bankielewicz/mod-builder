// Tests for the rules of SPEC.md 9.36 and 9.37: when a reading that was left behind or is out of date asks the
// person instead of being followed by another; the question's sentence and the evidence for it; the prompt's
// text and wait; and when the prompt for a reader's answer is due.
// Read off the module as a whole, so that this file loads before the rules are built.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as rules from '../hooks/mod-builder-logic.ts';

const H = { 'tests/a.test.ts': 'h-a' };
const MOD = '/work/turn-counter';
const RECORD = { modDir: MOD, sessionId: 's1', phase: 'red', specApprovedAt: 1, spec: null, testsAtScaffold: 1, namesAtScaffold: [], testsAtRed: null, testHashes: null, evidence: {}, reader: { agentId: 'a1', startedAt: 1000, hashes: H } };
const UNREAD = { answer: 'VERDICT: PASS', nudges: 0, failed: false };
const due = (...args) => (typeof rules.readerNudgeDue === 'function' ? rules.readerNudgeDue(...args) : 'no such rule');

const mayStart = (...args) => (typeof rules.readerMayStart === 'function' ? rules.readerMayStart(...args) : 'no such rule');

test('with one or two rounds counted, or none, a reading may be started without the person: after two, changed tests are read once more', () => {
  assert.equal(mayStart(0, false), true);
  assert.equal(mayStart(1, false), true);
  assert.equal(mayStart(2, false), true);
  assert.equal(mayStart(rules.READER_ROUNDS, undefined), true);
});

test('once three rounds or more are counted, a reading may be started only when the person has answered since the last of them ended', () => {
  assert.equal(mayStart(3, false), false);
  assert.equal(mayStart(rules.READER_ROUNDS + 1, undefined), false);
  assert.equal(mayStart(7, false), false);
  assert.equal(mayStart(3, true), true);
  assert.equal(mayStart(7, true), true);
  // Only `true` is an answer: a value that is merely there is none.
  for (const odd of ['yes', 1, {}, null]) assert.equal(mayStart(3, odd), false, String(odd));
});

test('a count that is none reads as no round counted', () => {
  for (const odd of [-3, 2.5, 3.5, NaN, Infinity, '3', null, undefined, {}]) assert.equal(mayStart(odd, false), true, String(odd));
});

test('the question after a pass that is out of date says the reader passed the tests as they were and that they have changed since', () => {
  assert.equal(typeof rules.readerPassedQuestion, 'function');
  assert.equal(rules.readerPassedQuestion(3), [
    'The test reader has read the tests 4 times and passed them the last time, as they were then.',
    'The tests have changed since that reading and have not been read as they are now.',
    'The code is written next, to these tests. Go on with these tests?',
  ].join('\n'));
});

test('the evidence of "Go on with these tests" after such a pass says the pass was for the tests as they were', () => {
  assert.equal(
    rules.readerEvidence({ by: 'person', rounds: 3, findings: null, unread: true, passedBefore: true }),
    'the person answered "Go on with these tests" after 3 rounds of the test reader that did not pass and one that passed the tests as they were; the tests changed after it and were not read as they are',
  );
});

test('the gate\'s words while the reader is out promise a hand-back or a prompt, and say to call the gate then and not before', () => {
  assert.equal(rules.READER_STARTED, 'the test reader is reading the tests against the spec. End your turn now: its report is handed back to you, or mod-builder prompts you. Call the gate then, and not before');
  assert.equal(rules.readerReading(12), 'the test reader is still reading (12 s). End your turn: its report is handed back to you, or mod-builder prompts you');
});

test('the question after such a reading says, before its last line, that the tests have changed since and were not read as they are', () => {
  assert.equal(rules.TESTS_NOT_READ, 'The tests have changed since that reading and have not been read as they are now.');
  assert.equal(rules.readerQuestion(['tests/a.test.ts: nothing counts a turn'], 3, true), [
    'The test reader has read the tests 3 times. The last time it found behaviours of the spec that no test would catch:',
    '- tests/a.test.ts: nothing counts a turn',
    'The tests have changed since that reading and have not been read as they are now.',
    'The code is written next, to these tests. Go on with these tests?',
  ].join('\n'));
  assert.equal(rules.readerQuestion(null, 4, true), [
    'The test reader has read the tests 4 times and gave no verdict the last time.',
    'The tests have changed since that reading and have not been read as they are now.',
    'The code is written next, to these tests. Go on with these tests?',
  ].join('\n'));
});

test('the question about a reading of the tests as they are says nothing of changed tests', () => {
  const plain = 'The test reader has read the tests 2 times and gave no verdict the last time.\nThe code is written next, to these tests. Go on with these tests?';
  assert.equal(rules.readerQuestion(null, 2), plain);
  assert.equal(rules.readerQuestion(null, 2, false), plain);
  // Only `true` says so: a value that is merely there does not.
  assert.equal(rules.readerQuestion(null, 2, 'yes'), plain);
  assert.equal(typeof rules.TESTS_NOT_READ, 'string');
});

test('the evidence of "Go on with these tests" after such a question says the tests were not read as they are', () => {
  assert.equal(
    rules.readerEvidence({ by: 'person', rounds: 3, findings: ['one'], unread: true }),
    'the person answered "Go on with these tests" after 3 rounds of the test reader (the last: 1 finding; the tests changed after it and were not read as they are)',
  );
  assert.equal(
    rules.readerEvidence({ by: 'person', rounds: 4, findings: null, unread: true }),
    'the person answered "Go on with these tests" after 4 rounds of the test reader (the last: no verdict; the tests changed after it and were not read as they are)',
  );
  assert.equal(rules.readerEvidence({ by: 'person', rounds: 3, findings: ['one', 'two'], unread: false }), 'the person answered "Go on with these tests" after 3 rounds of the test reader (the last: 2 findings)');
  assert.equal(rules.readerEvidence({ by: 'person', rounds: 2, findings: ['one'] }), 'the person answered "Go on with these tests" after 2 rounds of the test reader (the last: 1 finding)');
});

test('what the gate adds to "Not yet" after such a question says how the tests get read as they are', () => {
  assert.equal(rules.READ_AS_THEY_ARE, 'The next call of the gate has the tests read as they are now');
});

test('the prompt says to call the gate only if the build is still at Red, and to do nothing when it has moved on', () => {
  assert.equal(rules.READER_NUDGE, 'mod-builder: the test reader has reported. If the build is still at Red, call mod_builder_gate; if it has moved on, do nothing.');
  assert.equal(rules.READER_NUDGE_WAIT_MS, 2000);
  assert.equal(rules.READER_NUDGES, 2);
});

test('the prompt is due for an answer that is unread: the session\'s open record is at Red and names that reader, and no prompt was counted', () => {
  assert.equal(due(RECORD, 's1', 'a1', UNREAD), true);
  assert.equal(due(RECORD, 's1', 'a1', { answer: '', nudges: 0, failed: false }), true);
});

test('no prompt is due once the gate has read the answer, the person has answered, or a new reading was started: the record names no reader, or another', () => {
  assert.equal(due(RECORD, 's1', 'a1', UNREAD), true);
  assert.equal(due({ ...RECORD, reader: null }, 's1', 'a1', UNREAD), false);
  const { reader, ...none } = RECORD;
  assert.equal(due(none, 's1', 'a1', UNREAD), false);
  assert.equal(due({ ...RECORD, reader: { ...reader, agentId: 'a2' } }, 's1', 'a1', UNREAD), false);
  assert.equal(due({ ...RECORD, reader: { agentId: 'a1' } }, 's1', 'a1', UNREAD), false);
});

test('no prompt is due once the record has left Red, is Done or stopped, or is another session\'s, or is none', () => {
  assert.equal(due(RECORD, 's1', 'a1', UNREAD), true);
  for (const phase of ['knowledge', 'describe', 'spec', 'scaffold', 'green', 'verify', 'done']) assert.equal(due({ ...RECORD, phase }, 's1', 'a1', UNREAD), false, phase);
  assert.equal(due({ ...RECORD, stopped: true }, 's1', 'a1', UNREAD), false);
  assert.equal(due(RECORD, 's2', 'a1', UNREAD), false);
  assert.equal(due({ ...RECORD, sessionId: 's2' }, 's1', 'a1', UNREAD), false);
  for (const odd of [null, undefined, 'a record', [], {}]) assert.equal(due(odd, 's1', 'a1', UNREAD), false, String(odd));
});

test('one prompt for a reading: none when one was counted, but once more for one that could not be sent, and never a third', () => {
  assert.equal(due(RECORD, 's1', 'a1', UNREAD), true);
  assert.equal(due(RECORD, 's1', 'a1', { answer: 'x', nudges: 1, failed: false }), false);
  assert.equal(due(RECORD, 's1', 'a1', { answer: 'x', nudges: 1, failed: true }), true);
  assert.equal(due(RECORD, 's1', 'a1', { answer: 'x', nudges: 2, failed: true }), false);
  assert.equal(due(RECORD, 's1', 'a1', { answer: 'x', nudges: 2, failed: false }), false);
});

test('no prompt is due for an answer that was left behind, for no stored answer, or for an id that is none', () => {
  assert.equal(due(RECORD, 's1', 'a1', UNREAD), true);
  assert.equal(due(RECORD, 's1', 'a1', { ...UNREAD, leftBehind: true }), false);
  assert.equal(due(RECORD, 's1', 'a1', null), false);
  assert.equal(due(RECORD, 's1', 'a1', undefined), false);
  assert.equal(due({ ...RECORD, reader: { ...RECORD.reader, agentId: '' } }, 's1', '', UNREAD), false);
  assert.equal(due(RECORD, 's1', undefined, UNREAD), false);
  assert.equal(due(RECORD, undefined, 'a1', UNREAD), false);
});

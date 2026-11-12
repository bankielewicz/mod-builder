// Tests for the rules that count a Red's test readers (SPEC.md 9.24, the driving session's ruling): every reader
// started is counted, one left behind by changed tests included, and when a fourth would start the person is
// asked instead. Read off the module as a whole, so that this file loads before the rules are built.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as rules from '../hooks/mod-builder-logic.ts';

const LAST = 'The code is written next, to these tests. Go on with these tests?';

test('one Red may start three readers: the fourth is the question', () => {
  assert.equal(rules.READER_STARTS, 3);
  assert.deepEqual([0, 1, 2].map((starts) => rules.startsEnd(starts)), ['start', 'start', 'start']);
  assert.deepEqual([3, 4, 50].map((starts) => rules.startsEnd(starts)), ['ask', 'ask', 'ask']);
});

test('a count that is no whole number is no count: a reader is started', () => {
  for (const odd of [undefined, null, '3', 3.5, Number.NaN, Number.POSITIVE_INFINITY, -1, [3], {}]) assert.equal(rules.startsEnd(odd), 'start', String(odd));
});

test('the question says how many readers were started and that the tests kept changing, then asks as the other question does', () => {
  assert.equal(rules.readerStartsQuestion(3, null), [
    'The test reader was started 3 times in this Red and the tests kept changing, so it is not started again.',
    'No reading of the tests as they are now has ended.', LAST,
  ].join('\n'));
  assert.equal(rules.readerStartsQuestion(4, []).split('\n')[1], 'No reading of the tests as they are now has ended.');
  assert.equal(rules.readerStartsQuestion(5, null).split('\n')[0], 'The test reader was started 5 times in this Red and the tests kept changing, so it is not started again.');
  assert.equal(rules.readerQuestion(null, 2).split('\n').at(-1), LAST);
});

test('with a round that ended before, the question shows what that reading found', () => {
  assert.equal(rules.readerStartsQuestion(3, ['tests/a.test.ts: no test counts a second turn', 'SPEC.md: the reset is never tested']), [
    'The test reader was started 3 times in this Red and the tests kept changing, so it is not started again.',
    'The last reading that ended found behaviours of the spec that no test would catch:',
    '- tests/a.test.ts: no test counts a second turn', '- SPEC.md: the reset is never tested', LAST,
  ].join('\n'));
});

test('a count that is no count is said as 0, never as text of its own', () => {
  for (const odd of [undefined, 2.5, -3, '7', Number.NaN]) {
    assert.match(rules.readerStartsQuestion(odd, null), /^The test reader was started 0 times /);
    assert.match(rules.readerStartsEvidence(odd), / after 0 readings /);
  }
});

test('its options and its judge are the other question\'s: "Not yet" first, and only "Go on with these tests" passes', () => {
  assert.deepEqual(rules.readerOptions(), ['Not yet', 'Go on with these tests']);
  assert.deepEqual(rules.readerGate('Go on with these tests'), { pass: true });
  assert.equal(rules.readerGate('Not yet').pass, false);
});

test('Red\'s evidence says the person went on, after how many readers, and why they were asked', () => {
  assert.equal(rules.readerStartsEvidence(3), 'the person answered "Go on with these tests" after 3 readings of the test reader were started and the tests kept changing');
  assert.notEqual(rules.readerStartsEvidence(3), rules.readerEvidence({ by: 'person', rounds: 3, findings: null }));
});

// Logic tests for SPEC.md 9.28: while a test reader reads, the test files are closed; a reading left behind is a
// round that says nothing about any tests; an answer that arrived late is marked; and what the gate says of each.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as rules from '../hooks/mod-builder-logic.ts';

const HASHES = { 'tests/pane.test.tsx': 'a'.repeat(64) };
const OTHER = { 'tests/pane.test.tsx': 'b'.repeat(64) };
const OUT = { agentId: 'reader-1', startedAt: 1000, hashes: HASHES };

test('the test files are closed while a reader is out, has not answered, and started less than ten minutes ago', () => {
  assert.equal(rules.readerCloses(OUT, false, 1000), true);
  assert.equal(rules.readerCloses(OUT, false, 1000 + rules.READER_MS - 1), true);
  assert.equal(rules.READER_MS, 600000);
});

test('they are open once its answer is stored, once its time is up, and when the clock went back', () => {
  assert.equal(rules.readerCloses(OUT, true, 1000), false);
  assert.equal(rules.readerCloses(OUT, false, 1000 + rules.READER_MS), false);
  assert.equal(rules.readerCloses(OUT, false, 1000 + rules.READER_MS + 5), false);
  assert.equal(rules.readerCloses(OUT, false, 999), false);
});

test('with no reader out, or a record that holds no reader that can be read, nothing is closed', () => {
  for (const odd of [undefined, null, 'x', 0, {}, [], { agentId: '', startedAt: 1000, hashes: HASHES }, { agentId: 'a', startedAt: 'x', hashes: HASHES }, { agentId: 'a', startedAt: 1000 }]) {
    assert.equal(rules.readerCloses(odd, false, 1000), false, JSON.stringify(odd));
  }
});

test('a clock that is no time closes nothing, and answered counts only as the value true', () => {
  for (const now of [undefined, null, '1000', Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(rules.readerCloses(OUT, false, now), false, String(now));
  for (const odd of [undefined, null, 1, 'true', {}]) assert.equal(rules.readerCloses(OUT, odd, 1000), true, String(odd));
});

test('the refusal is in the guard\'s form and carries the ruling\'s reason', () => {
  assert.equal(rules.READER_CLOSED, 'the test reader is reading these tests; wait for its report');
  assert.equal(rules.readerClosedRefusal('tests/pane.test.tsx'), 'mod-builder: tests/pane.test.tsx can\'t be written: the test reader is reading these tests; wait for its report.');
  assert.equal(rules.readerClosedRefusal(''), 'mod-builder: the mod folder can\'t be written: the test reader is reading these tests; wait for its report.');
});

test('a reading left behind is said as a round, with which round it was', () => {
  assert.equal(rules.TESTS_CHANGED, 'the tests changed while they were read');
  assert.equal(rules.readerLeftBehind(1), 'the tests changed while the test reader read them, which counts as round 1');
  assert.equal(rules.readerLeftBehind(4), 'the tests changed while the test reader read them, which counts as round 4');
  for (const odd of [undefined, null, 0, -1, 1.5, '2', Number.NaN]) assert.equal(rules.readerLeftBehind(odd), 'the tests changed while the test reader read them, which counts as round 1');
});

test('a report the gate never read: findings or no verdict are a round, a pass counts for nothing', () => {
  assert.equal(rules.readerOutdated(2), 'the tests changed after the test reader reported on them: that reading did not pass and counts as round 2');
  assert.equal(rules.readerOutdated(null), 'the tests changed after the test reader passed them, so that pass is not theirs');
  for (const odd of [0, -1, 1.5, Number.NaN]) assert.equal(rules.readerOutdated(odd), 'the tests changed after the test reader reported on them: that reading did not pass and counts as round 1');
});

test('a stored answer says whether it was left behind, and only the value true marks it', () => {
  assert.deepEqual(rules.readReaderAnswer({ answer: 'VERDICT: PASS', nudges: 0, failed: false, leftBehind: true }), { answer: 'VERDICT: PASS', nudges: 0, failed: false, leftBehind: true });
  for (const odd of [undefined, null, false, 1, 'true', {}]) {
    assert.equal('leftBehind' in rules.readReaderAnswer({ answer: 'x', nudges: 1, leftBehind: odd }), false, String(odd));
  }
});

test('a last round that ended because the tests changed is never given again and never asked about, whatever its hashes', () => {
  const changed = { hashes: HASHES, findings: null, changed: true };
  assert.deepEqual(rules.readerStep(null, changed, 1, HASHES, 2000, undefined), { do: 'start' });
  assert.deepEqual(rules.readerStep(null, changed, 5, HASHES, 2000, undefined), { do: 'start' });
  assert.deepEqual(rules.readerStep(null, changed, 5, OTHER, 2000, undefined), { do: 'start' });
  // Without the mark the same round is about these tests.
  assert.deepEqual(rules.readerStep(null, { hashes: HASHES, findings: null }, 1, HASHES, 2000, undefined), { do: 'again', findings: null });
  assert.deepEqual(rules.readerStep(null, { hashes: HASHES, findings: ['x'] }, 2, HASHES, 2000, undefined), { do: 'ask', findings: ['x'] });
  // Only the value true is the mark.
  assert.deepEqual(rules.readerStep(null, { hashes: HASHES, findings: null, changed: 'yes' }, 2, HASHES, 2000, undefined), { do: 'ask', findings: null });
});

test('a reader that is out for these tests still comes before such a round', () => {
  const changed = { hashes: OTHER, findings: null, changed: true };
  assert.deepEqual(rules.readerStep(OUT, changed, 1, HASHES, 2000, undefined), { do: 'wait', seconds: 1 });
  assert.deepEqual(rules.readerStep(OUT, changed, 1, HASHES, 2000, 'VERDICT: PASS'), { do: 'read', answer: 'VERDICT: PASS' });
});

test('nothing of a count of readers started is left in the rules', () => {
  for (const name of ['READER_STARTS', 'startsEnd', 'readerStartsQuestion', 'readerStartsEvidence']) assert.equal(name in rules, false, name);
  assert.equal('readerStarts' in rules.newRecord('/work/m', 's1'), false);
});

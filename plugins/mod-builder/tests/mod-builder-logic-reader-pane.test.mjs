// Logic tests for what the pane shows of the test reader at Red (SPEC.md 9.19): a block of its own, and words in
// the status line, from what the record holds and whether the reader that is out has answered. The pane only
// draws: an odd value draws as nothing, and nothing here throws.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as rules from '../hooks/mod-builder-logic.ts';

const DOT = String.fromCharCode(0xb7);
const MOD = '/work/turn-counter';
const HASHES = { 'tests/pane.test.tsx': 'a'.repeat(64) };
const STARTED = Date.UTC(2026, 10, 12, 18, 5);
const OUT = { agentId: 'reader-1', startedAt: STARTED, hashes: HASHES };
const FOUND = { hashes: HASHES, findings: ['tests/pane.test.tsx: no test resets the count', 'SPEC.md line 9: the empty log is never drawn'] };
const NONE = { hashes: HASHES, findings: null };
const WEIRD = [undefined, null, 'x', '', 0, -1, 1.5, true, [], {}, { agentId: '', startedAt: 1, hashes: HASHES }, { agentId: 'a', startedAt: 'x', hashes: HASHES }, { agentId: 'a', startedAt: 1 }, { hashes: HASHES }, { findings: [] }];

const texts = (block) => block.rows.map((row) => row.map((cell) => cell.text));
const tones = (block) => block.rows.map((row) => row.map((cell) => cell.tone ?? 'plain'));
const titleOf = (block) => block.heading.map((cell) => cell.text).join(' ');
const knowledge = { latest: '2026-11-10T194027Z', checked: '2026-11-10T194027Z', pages: 10, changes: null, isRefreshing: false, version: '2.1.322', now: STARTED };
const record = (phase, more = {}) => ({ ...rules.newRecord(MOD, 's1'), phase, ...more });
const model = (kept, more = {}) => rules.paneModel({ sessionId: 's1', entry: { modDir: MOD, ...(kept.kind === 'edit' ? { kind: 'edit' } : {}) }, record: kept, refusals: undefined, checks: undefined, knowledge, spec: null, ...more });
const readerOf = (drawn) => drawn.blocks.find((one) => titleOf(one) === 'Test reader');

test('a reader that is out and has not answered is shown reading, with when it started', () => {
  const block = rules.readerBlock(OUT, null, 0, false);
  assert.equal(titleOf(block), 'Test reader');
  assert.deepEqual(texts(block), [['  reading the tests against the spec', 'started 18:05 UTC']]);
  assert.deepEqual(tones(block), [['current', 'dim']]);
});

test('a reader whose start is no time is shown reading, with no second cell', () => {
  assert.deepEqual(texts(rules.readerBlock({ ...OUT, startedAt: 8.7e15 }, null, 0, false)), [['  reading the tests against the spec']]);
});

test('a reader that is out and has answered is shown as reported, and says plainly that the gate is waiting to be called', () => {
  const block = rules.readerBlock(OUT, FOUND, 1, true);
  assert.deepEqual(tones(block), [['current']]);
  assert.equal(rules.READER_REPORTED, 'has reported: the gate is waiting to be called');
  assert.equal(titleOf(block), 'Test reader');
  assert.deepEqual(texts(block), [['  has reported: the gate is waiting to be called']]);
});

test('with no reader out, the last round that did not pass is shown with each finding on a row of its own', () => {
  const block = rules.readerBlock(null, FOUND, 2, false);
  assert.equal(titleOf(block), 'Test reader');
  assert.deepEqual(texts(block), [['  round 2 did not pass'], ['  - tests/pane.test.tsx: no test resets the count'], ['  - SPEC.md line 9: the empty log is never drawn']]);
  assert.deepEqual(tones(block), [['warning'], ['plain'], ['plain']]);
});

test('a round with no verdict, or with no finding that holds anything, says so in the rules\' own words', () => {
  for (const last of [NONE, { hashes: HASHES, findings: [] }, { hashes: HASHES, findings: ['', '\u0007'] }]) {
    assert.deepEqual(texts(rules.readerBlock(undefined, last, 1, false)), [['  round 1 did not pass'], [`  ${rules.NO_VERDICT}`]]);
  }
  assert.equal(rules.NO_VERDICT, 'the reader gave no verdict');
});

test('a finding is drawn on one line: what would move the cursor or hide text is turned to a space', () => {
  const ESC = String.fromCharCode(27);
  const block = rules.readerBlock(null, { hashes: HASHES, findings: [`a${ESC}[2Jb\nc`] }, 1, true);
  assert.deepEqual(texts(block).slice(1), [['  - a [2Jb c']]);
});

test('a count of rounds that is no whole number of at least one is drawn as round 1', () => {
  for (const rounds of [undefined, null, 0, -2, 1.5, '2', Number.NaN]) assert.deepEqual(texts(rules.readerBlock(null, NONE, rounds, false))[0], ['  round 1 did not pass']);
  assert.deepEqual(texts(rules.readerBlock(null, NONE, 3, false))[0], ['  round 3 did not pass']);
});

test('a reader that is out comes before the last round, whatever that found', () => {
  assert.deepEqual(texts(rules.readerBlock(OUT, FOUND, 1, false))[0][0], '  reading the tests against the spec');
});

test('with nothing of the reader in the record there is no block, and an odd value is nothing', () => {
  assert.equal(rules.readerBlock(undefined, undefined, undefined, false), null);
  assert.equal(rules.readerBlock(null, null, 0, true), null);
  for (const odd of WEIRD) {
    assert.equal(rules.readerBlock(odd, odd, odd, false), null, JSON.stringify(odd));
    assert.equal(rules.readerStatus(odd, odd, odd, true), '', JSON.stringify(odd));
  }
});

test('answered counts only as the value true', () => {
  for (const odd of [undefined, null, 1, 'true', {}]) assert.deepEqual(texts(rules.readerBlock(OUT, null, 0, odd))[0][0], '  reading the tests against the spec');
});

test('the status line\'s words: reading, reported, or the round that did not pass', () => {
  assert.equal(rules.readerStatus(OUT, null, 0, false), ` ${DOT} test reader reading`);
  assert.equal(rules.readerStatus(OUT, FOUND, 1, true), ` ${DOT} test reader reported: call the gate`);
  assert.equal(rules.readerStatus(null, FOUND, 2, false), ` ${DOT} test reader: round 2 did not pass`);
  assert.equal(rules.readerStatus(null, NONE, 0, true), ` ${DOT} test reader: round 1 did not pass`);
  assert.equal(rules.readerStatus(null, null, 0, false), '');
});

test('at Red the pane holds the block just above the phase\'s own, and the status line says it after the phase', () => {
  const reading = model(record('red', { reader: OUT }));
  const titles = reading.blocks.map(titleOf);
  assert.equal(titles.indexOf('Test reader'), titles.findIndex((title) => title.startsWith('5 Red')) - 1);
  assert.deepEqual(texts(readerOf(reading)), [['  reading the tests against the spec', 'started 18:05 UTC']]);
  assert.equal(reading.status, `red ${DOT} test reader reading`);
  const reported = model(record('red', { reader: OUT }), { readerAnswered: true });
  assert.deepEqual(texts(readerOf(reported)), [['  has reported: the gate is waiting to be called']]);
  assert.equal(reported.status, `red ${DOT} test reader reported: call the gate`);
  const found = model(record('red', { reader: null, readerLast: FOUND, readerRounds: 1 }));
  assert.equal(texts(readerOf(found)).length, 3);
  assert.equal(found.status, `red ${DOT} test reader: round 1 did not pass`);
});

test('the pane passes the record\'s count of rounds through, to the block and to the status line', () => {
  const second = model(record('red', { reader: null, readerLast: FOUND, readerRounds: 2 }));
  assert.deepEqual(texts(readerOf(second))[0], ['  round 2 did not pass']);
  assert.equal(second.status, `red ${DOT} test reader: round 2 did not pass`);
  const fifth = model(record('red', { reader: null, readerLast: NONE, readerRounds: 5 }));
  assert.deepEqual(texts(readerOf(fifth)), [['  round 5 did not pass'], [`  ${rules.NO_VERDICT}`]]);
  assert.equal(fifth.status, `red ${DOT} test reader: round 5 did not pass`);
});

test('the block sits just above Red\'s own and below the phases that passed, never at the top', () => {
  const evidence = { knowledge: 'snapshot 2026-11-10T151216Z', spec: 'the person approved SPEC.md', scaffold: 'hooks/ and tests/ are as the scaffold laid them; 2 tests ran' };
  const titles = model(record('red', { reader: OUT, evidence, specApprovedAt: STARTED })).blocks.map(titleOf);
  const at = titles.indexOf('Test reader');
  assert.equal(at, titles.findIndex((title) => title.startsWith('5 Red')) - 1);
  assert.equal(at > titles.findIndex((title) => title.startsWith('4 Scaffold')), true);
  assert.equal(titles.findIndex((title) => title.startsWith('4 Scaffold')) >= 0 && at > 0, true);
  assert.equal(titles.filter((title) => title === 'Test reader').length, 1);
});

test('a finding loses the marks that reorder or hide text: C1 controls, direction overrides, zero-width marks', () => {
  const marked = ['a', String.fromCharCode(0x9b), 'b', String.fromCharCode(0x202e), 'c', String.fromCharCode(0x200b), 'd', String.fromCharCode(0x2066), 'e'].join('');
  assert.deepEqual(texts(rules.readerBlock(null, { hashes: HASHES, findings: [marked] }, 1, false)).slice(1), [['  - a b c d e']]);
  const drawn = model(record('red', { reader: null, readerLast: { hashes: HASHES, findings: [marked] }, readerRounds: 1 }));
  assert.deepEqual(texts(readerOf(drawn)).slice(1), [['  - a b c d e']]);
});

test('the words of the reader come after the count of failing tests in the status line', () => {
  const attempt = { phase: 'red', reason: 'x', failing: [], tests: 3, passed: 1 };
  assert.equal(model(record('red', { reader: OUT, attempt })).status, `red ${DOT} 2 of 3 tests fail ${DOT} test reader reading`);
});

test('an edit\'s Red shows the reader as a build\'s does', () => {
  const baseline = { version: '0.1.0', tests: 2, names: ['a', 'b'], hashes: {}, spec: { length: 14, hash: 'h' }, failed: [], restore: '/home/u/r', at: 1000 };
  const drawn = model(record('red', { kind: 'edit', red: 'edit', baseline, evidence: { baseline: 'passes its four checks (2 tests)' }, reader: OUT }), { readerAnswered: true });
  assert.deepEqual(texts(readerOf(drawn)), [['  has reported: the gate is waiting to be called']]);
  assert.equal(drawn.status, `red ${DOT} test reader reported: call the gate`);
});

test('at Red with nothing of the reader, and at every other phase whatever the record holds, there is no block and no word of it', () => {
  const plain = model(record('red'));
  assert.equal(readerOf(plain), undefined);
  assert.equal(plain.status, 'red');
  for (const phase of ['knowledge', 'describe', 'spec', 'scaffold', 'green', 'verify', 'done']) {
    const drawn = model(record(phase, { reader: OUT, readerLast: FOUND, readerRounds: 2 }), { readerAnswered: true });
    assert.equal(readerOf(drawn), undefined, phase);
    assert.doesNotMatch(String(drawn.status), /test reader/, phase);
  }
});

test('from the second reader started in one Red the block says how many, on a dim row of its own, whatever else it shows', () => {
  assert.deepEqual(texts(rules.readerBlock(OUT, null, 0, false, 2)), [['  reading the tests against the spec', 'started 18:05 UTC'], ['  2 readings started']]);
  assert.deepEqual(tones(rules.readerBlock(OUT, null, 0, false, 2))[1], ['dim']);
  assert.deepEqual(texts(rules.readerBlock(OUT, null, 0, true, 3)), [['  has reported: the gate is waiting to be called'], ['  3 readings started']]);
  assert.deepEqual(texts(rules.readerBlock(null, NONE, 1, false, 3)), [['  round 1 did not pass'], [`  ${rules.NO_VERDICT}`], ['  3 readings started']]);
  for (const few of [undefined, null, 0, 1, '3', 2.5, Number.NaN, -4]) assert.deepEqual(texts(rules.readerBlock(OUT, null, 0, false, few)).length, 1, String(few));
});

test('with no reader out and no round that ended, readers that were started still show: the question is what comes next', () => {
  const block = rules.readerBlock(null, null, 0, false, 3);
  assert.equal(titleOf(block), 'Test reader');
  assert.deepEqual(texts(block), [['  3 readings started']]);
  assert.equal(rules.readerBlock(null, null, 0, false, 1), null);
});

test('the pane passes the record\'s count of readers started through to the block', () => {
  const drawn = model(record('red', { reader: OUT, readerStarts: 2 }));
  assert.deepEqual(texts(readerOf(drawn)).at(-1), ['  2 readings started']);
  assert.equal(texts(readerOf(model(record('red', { reader: OUT, readerStarts: 1 })))).length, 1);
  assert.equal(readerOf(model(record('green', { reader: null, readerStarts: 3 }))), undefined);
});

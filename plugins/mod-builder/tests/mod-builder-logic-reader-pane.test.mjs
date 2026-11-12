// Logic tests for what the pane shows of the test reader at Red (SPEC.md 9.19, 9.28): one row at the top of the
// frame, a block of the last round's findings just above Red's own, and words in the status line, from what the
// record holds and whether the reader that is out has answered. The pane only draws: an odd value draws as
// nothing, and nothing here throws.
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
const CHANGED = { hashes: HASHES, findings: null, changed: true };
const WEIRD = [undefined, null, 'x', '', 0, -1, 1.5, true, [], {}, { agentId: '', startedAt: 1, hashes: HASHES }, { agentId: 'a', startedAt: 'x', hashes: HASHES }, { agentId: 'a', startedAt: 1 }, { hashes: HASHES }, { findings: [] }];

const texts = (block) => block.rows.map((row) => row.map((cell) => cell.text));
const tones = (block) => block.rows.map((row) => row.map((cell) => cell.tone ?? 'plain'));
const titleOf = (block) => block.heading.map((cell) => cell.text).join(' ');
const knowledge = { latest: '2026-11-10T194027Z', checked: '2026-11-10T194027Z', pages: 10, changes: null, isRefreshing: false, version: '2.1.322', now: STARTED };
const record = (phase, more = {}) => ({ ...rules.newRecord(MOD, 's1'), phase, ...more });
const model = (kept, more = {}) => rules.paneModel({ sessionId: 's1', entry: { modDir: MOD, ...(kept.kind === 'edit' ? { kind: 'edit' } : {}) }, record: kept, refusals: undefined, checks: undefined, knowledge, spec: null, ...more });
const cells = (block) => block.heading.map((cell) => cell.text);
const cellTones = (block) => block.heading.map((cell) => cell.tone ?? 'plain');
const rowOf = (drawn) => drawn.blocks.find((one) => one.heading[0]?.text === 'Test reader');
const foundOf = (drawn) => drawn.blocks.find((one) => titleOf(one) === 'What the test reader found');

test('a reader that is out and has not answered is shown reading, with when it started, in one row and no more', () => {
  const block = rules.readerRow(OUT, null, 0, false);
  assert.deepEqual(cells(block), ['Test reader', 'reading the tests against the spec', 'started 18:05 UTC']);
  assert.deepEqual(cellTones(block), ['plain', 'current', 'dim']);
  assert.deepEqual(block.rows, []);
});

test('a reader whose start is no time is shown reading, with no third cell', () => {
  assert.deepEqual(cells(rules.readerRow({ ...OUT, startedAt: 8.7e15 }, null, 0, false)), ['Test reader', 'reading the tests against the spec']);
});

test('a reader that is out and has answered is shown as reported, and says plainly that the gate is waiting to be called', () => {
  const block = rules.readerRow(OUT, FOUND, 1, true);
  assert.equal(rules.READER_REPORTED, 'has reported: the gate is waiting to be called');
  assert.deepEqual(cells(block), ['Test reader', 'has reported: the gate is waiting to be called']);
  assert.deepEqual(cellTones(block), ['plain', 'current']);
  assert.deepEqual(block.rows, []);
});

test('with no reader out, the row says which round did not pass and what it came to: how many findings', () => {
  const block = rules.readerRow(null, FOUND, 2, false);
  assert.deepEqual(cells(block), ['Test reader', 'round 2 did not pass', '2 findings']);
  assert.deepEqual(cellTones(block), ['plain', 'warning', 'dim']);
  assert.deepEqual(cells(rules.readerRow(null, { hashes: HASHES, findings: ['only this'] }, 1, false)), ['Test reader', 'round 1 did not pass', '1 finding']);
});

test('a round with no verdict, or with no finding that holds anything, says "no verdict"; one left behind says the tests changed while they were read', () => {
  for (const last of [NONE, { hashes: HASHES, findings: [] }, { hashes: HASHES, findings: ['', '\u0007'] }]) {
    assert.deepEqual(cells(rules.readerRow(undefined, last, 1, false)), ['Test reader', 'round 1 did not pass', 'no verdict']);
  }
  assert.deepEqual(cells(rules.readerRow(null, CHANGED, 2, false)), ['Test reader', 'round 2 did not pass', 'the tests changed while they were read']);
  assert.equal(rules.TESTS_CHANGED, 'the tests changed while they were read');
  // Only the value true marks such a round.
  assert.deepEqual(cells(rules.readerRow(null, { ...NONE, changed: 'yes' }, 1, false)), ['Test reader', 'round 1 did not pass', 'no verdict']);
});

test('the findings of the last round are a block of their own, one row each, and only when there is one to list', () => {
  const block = rules.readerBlock(null, FOUND);
  assert.equal(titleOf(block), 'What the test reader found');
  assert.deepEqual(texts(block), [['  - tests/pane.test.tsx: no test resets the count'], ['  - SPEC.md line 9: the empty log is never drawn']]);
  assert.deepEqual(tones(block), [['plain'], ['plain']]);
  for (const last of [NONE, CHANGED, { hashes: HASHES, findings: [] }, { hashes: HASHES, findings: ['', '\u0007'] }, { ...FOUND, changed: true }]) assert.equal(rules.readerBlock(null, last), null);
  // While a reader is out, what an earlier round found is not shown: it is being read anew.
  assert.equal(rules.readerBlock(OUT, FOUND), null);
});

test('a finding is drawn on one line: what would move the cursor or hide text is turned to a space', () => {
  const ESC = String.fromCharCode(27);
  assert.deepEqual(texts(rules.readerBlock(null, { hashes: HASHES, findings: [`a${ESC}[2Jb\nc`] })), [['  - a [2Jb c']]);
});

test('a finding loses the marks that reorder or hide text: C1 controls, direction overrides, zero-width marks', () => {
  const marked = ['a', String.fromCharCode(0x9b), 'b', String.fromCharCode(0x202e), 'c', String.fromCharCode(0x200b), 'd', String.fromCharCode(0x2066), 'e'].join('');
  assert.deepEqual(texts(rules.readerBlock(null, { hashes: HASHES, findings: [marked] })), [['  - a b c d e']]);
  const drawn = model(record('red', { reader: null, readerLast: { hashes: HASHES, findings: [marked] }, readerRounds: 1 }));
  assert.deepEqual(texts(foundOf(drawn)), [['  - a b c d e']]);
});

test('a count of rounds that is no whole number of at least one is drawn as round 1', () => {
  for (const rounds of [undefined, null, 0, -2, 1.5, '2', Number.NaN]) assert.equal(cells(rules.readerRow(null, NONE, rounds, false))[1], 'round 1 did not pass');
  assert.equal(cells(rules.readerRow(null, NONE, 3, false))[1], 'round 3 did not pass');
});

test('a reader that is out comes before the last round, whatever that found', () => {
  assert.equal(cells(rules.readerRow(OUT, FOUND, 1, false))[1], 'reading the tests against the spec');
});

test('with nothing of the reader in the record there is no row and no block, and an odd value is nothing', () => {
  assert.equal(rules.readerRow(undefined, undefined, undefined, false), null);
  assert.equal(rules.readerRow(null, null, 0, true), null);
  for (const odd of WEIRD) {
    assert.equal(rules.readerRow(odd, odd, odd, false), null, JSON.stringify(odd));
    assert.equal(rules.readerBlock(odd, odd), null, JSON.stringify(odd));
    assert.equal(rules.readerStatus(odd, odd, odd, true), '', JSON.stringify(odd));
  }
});

test('answered counts only as the value true', () => {
  for (const odd of [undefined, null, 1, 'true', {}]) assert.equal(cells(rules.readerRow(OUT, null, 0, odd))[1], 'reading the tests against the spec');
});

test('the status line\'s words: reading, reported, or the round that did not pass and what it came to', () => {
  assert.equal(rules.readerStatus(OUT, null, 0, false), ` ${DOT} test reader reading`);
  assert.equal(rules.readerStatus(OUT, FOUND, 1, true), ` ${DOT} test reader reported: call the gate`);
  assert.equal(rules.readerStatus(null, FOUND, 2, false), ` ${DOT} test reader: round 2 did not pass ${DOT} 2 findings`);
  assert.equal(rules.readerStatus(null, NONE, 0, true), ` ${DOT} test reader: round 1 did not pass ${DOT} no verdict`);
  assert.equal(rules.readerStatus(null, CHANGED, 3, false), ` ${DOT} test reader: round 3 did not pass ${DOT} the tests changed while they were read`);
  assert.equal(rules.readerStatus(null, null, 0, false), '');
});

test('at Red the reader\'s row is the first block of the pane, above the phases that passed, and the status line says it after the phase', () => {
  const evidence = { knowledge: 'snapshot 2026-11-10T151216Z', spec: 'the person approved SPEC.md', scaffold: 'hooks/ and tests/ are as the scaffold laid them; 2 tests ran' };
  const reading = model(record('red', { reader: OUT, evidence, specApprovedAt: STARTED }));
  assert.equal(reading.blocks.indexOf(rowOf(reading)), 0);
  assert.equal(reading.blocks.map(titleOf).findIndex((title) => title.startsWith('4 Scaffold')) > 0, true);
  assert.deepEqual(cells(rowOf(reading)), ['Test reader', 'reading the tests against the spec', 'started 18:05 UTC']);
  assert.equal(reading.blocks.filter((one) => one.heading[0]?.text === 'Test reader').length, 1);
  assert.equal(foundOf(reading), undefined);
  assert.equal(reading.status, `red ${DOT} test reader reading`);
  const reported = model(record('red', { reader: OUT }), { readerAnswered: true });
  assert.deepEqual(cells(rowOf(reported)), ['Test reader', 'has reported: the gate is waiting to be called']);
  assert.equal(reported.status, `red ${DOT} test reader reported: call the gate`);
});

test('after a round with findings the row is first and the findings sit just above Red\'s own block, below the phases that passed', () => {
  const evidence = { knowledge: 'snapshot 2026-11-10T151216Z', spec: 'the person approved SPEC.md', scaffold: 'hooks/ and tests/ are as the scaffold laid them; 2 tests ran' };
  const found = model(record('red', { reader: null, readerLast: FOUND, readerRounds: 1, evidence, specApprovedAt: STARTED }));
  const titles = found.blocks.map(titleOf);
  assert.equal(found.blocks.indexOf(rowOf(found)), 0);
  assert.deepEqual(cells(rowOf(found)), ['Test reader', 'round 1 did not pass', '2 findings']);
  assert.equal(titles.indexOf('What the test reader found'), titles.findIndex((title) => title.startsWith('5 Red')) - 1);
  assert.equal(titles.indexOf('What the test reader found') > titles.findIndex((title) => title.startsWith('4 Scaffold')), true);
  assert.equal(texts(foundOf(found)).length, 2);
  assert.equal(found.status, `red ${DOT} test reader: round 1 did not pass ${DOT} 2 findings`);
});

test('the pane passes the record\'s count of rounds through, to the row and to the status line', () => {
  const second = model(record('red', { reader: null, readerLast: FOUND, readerRounds: 2 }));
  assert.equal(cells(rowOf(second))[1], 'round 2 did not pass');
  assert.equal(second.status, `red ${DOT} test reader: round 2 did not pass ${DOT} 2 findings`);
  const fifth = model(record('red', { reader: null, readerLast: NONE, readerRounds: 5 }));
  assert.deepEqual(cells(rowOf(fifth)), ['Test reader', 'round 5 did not pass', 'no verdict']);
  assert.equal(foundOf(fifth), undefined);
  assert.equal(fifth.status, `red ${DOT} test reader: round 5 did not pass ${DOT} no verdict`);
});

test('the words of the reader come after the count of failing tests in the status line', () => {
  const attempt = { phase: 'red', reason: 'x', failing: [], tests: 3, passed: 1 };
  assert.equal(model(record('red', { reader: OUT, attempt })).status, `red ${DOT} 2 of 3 tests fail ${DOT} test reader reading`);
});

test('an edit\'s Red shows the reader as a build\'s does, above the Baseline', () => {
  const baseline = { version: '0.1.0', tests: 2, names: ['a', 'b'], hashes: {}, spec: { length: 14, hash: 'h' }, failed: [], restore: '/home/u/r', at: 1000 };
  const drawn = model(record('red', { kind: 'edit', red: 'edit', baseline, evidence: { baseline: 'passes its four checks (2 tests)' }, reader: OUT }), { readerAnswered: true });
  assert.deepEqual(cells(rowOf(drawn)), ['Test reader', 'has reported: the gate is waiting to be called']);
  assert.equal(drawn.blocks.indexOf(rowOf(drawn)), 0);
  assert.equal(drawn.blocks.findIndex((one) => one.heading[0]?.text === 'Baseline') > 0, true);
  assert.equal(drawn.status, `red ${DOT} test reader reported: call the gate`);
});

test('at Red with nothing of the reader, and at every other phase whatever the record holds, there is no row, no block and no word of it', () => {
  const plain = model(record('red'));
  assert.equal(rowOf(plain), undefined);
  assert.equal(plain.status, 'red');
  for (const phase of ['knowledge', 'describe', 'spec', 'scaffold', 'green', 'verify', 'done']) {
    const drawn = model(record(phase, { reader: OUT, readerLast: FOUND, readerRounds: 2 }), { readerAnswered: true });
    assert.equal(rowOf(drawn), undefined, phase);
    assert.equal(foundOf(drawn), undefined, phase);
    assert.doesNotMatch(String(drawn.status), /test reader/, phase);
  }
});

test('nothing of a count of readers is left in the pane or in a new record', () => {
  assert.equal('readerStarts' in rules.newRecord(MOD, 's1'), false);
  assert.equal(rules.READER_STARTS, undefined);
  assert.equal(JSON.stringify(model(record('red', { reader: OUT, readerStarts: 3 }))).includes('readings started'), false);
});

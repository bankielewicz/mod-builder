// Logic tests for the pane's rules (SPEC.md 8.18): what is drawn for each frame of the mockup (Main, Spec, Guard,
// Build, Verify, Done), for an edit, a skipped Red, a repair and a stopped record, from what the gate and the
// guard wrote and what the cache holds. The pane only draws: a record without the new fields, or with a damaged
// one, draws as zero or empty, and nothing here throws.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as rules from '../hooks/mod-builder-logic.ts';

// Taken from the module as a whole, so that a rule not built yet fails the tests that use it and no others.
const { paneModel, readRefusals, countRefusal, refusalsKey, checksKey, readChecks, newChecks, withCheck, settledChecks, readAttempt, readFinished, pagesIn, changesIn, commandOf, openedLine, approvalHint, refreshedToast, doneToast, newRecord } = rules;

const DOT = '\u00b7';
const TICK = '\u2713';
const DOTS = '\u2026';
const MOD = '/work/turn-counter';
// What refresh-docs.sh wrote for two snapshot folders made for this test (its write_changes, run as it is): a
// heading is a list item that keeps its marks, and lines above a page's first heading are named in brackets.
const CHANGES = [
  '# Changes in 2026-11-10T194027Z since 2026-11-09T101010Z', '', 'Pages: 2 changed, 1 added, 1 removed.', '',
  '## api.md: changed, +4 -2', '', '- (before the first heading)', '- ## Add a command', '- ## Show something without starting a turn', '',
  '## events.md: changed, +1 -1', '', '- # Events', '', '## gallery.md: added, +1', '', '## gone.md: removed, -2', '',
].join('\n');
const MANIFEST = 'page\turl\tsha256\tlast_modified\tbytes\nadmin.md\thttps://x/admin.md\tabc\tTue\t1\napi.md\thttps://x/api.md\tdef\tTue\t2\n';
const knowledge = (more = {}) => ({ latest: '2026-11-10T194027Z', checked: '2026-11-10T194027Z', pages: 10, changes: changesIn(CHANGES), isRefreshing: false, version: '2.1.322', now: Date.UTC(2026, 10, 12, 20), ...more });
const record = (phase, more = {}) => ({ ...newRecord(MOD, 's1'), phase, ...more });
const input = (more = {}) => ({ sessionId: 's1', entry: { modDir: MOD }, record: undefined, refusals: undefined, checks: undefined, knowledge: knowledge(), spec: null, ...more });
const BASELINE = { version: '0.1.0', tests: 2, names: ['a', 'b'], hashes: {}, spec: { length: 14, hash: 'h' }, failed: [], restore: '/home/u/r', at: 1000 };
const STOOD = 'passes its four checks (2 tests); version 0.1.0; restore point /home/u/r';
const editing = (phase, more = {}) => record(phase, { kind: 'edit', red: 'edit', baseline: BASELINE, evidence: { baseline: STOOD }, ...more });
const editInput = (more = {}) => input({ entry: { modDir: MOD, kind: 'edit' }, ...more });
const refusedAt = (phase, path = 'hooks/register.tsx', before = undefined) => countRefusal(before, 's1', phase, path).refusals;
const moved = (phase, states, name = 'turns') => Object.entries(states).reduce((checks, [check, state]) => withCheck(checks, check, state), newChecks('s1', phase, name));
const texts = (block) => block.rows.map((row) => row.map((cell) => cell.text));
const tones = (block) => block.rows.map((row) => row.map((cell) => cell.tone ?? 'plain'));
const widths = (block) => block.rows.map((row) => row.map((cell) => cell.width ?? 0));
const titleOf = (block) => block.heading.map((cell) => cell.text).join(' ');
const headings = (model) => model.blocks.map(titleOf);
const block = (model, heading) => model.blocks.find((one) => titleOf(one) === heading);
const rail = (model) => model.rail.map((item) => `${item.state}:${item.text}`);
const EIGHT = ['1 Knowledge', '2 Describe', '3 Spec', '4 Scaffold', '5 Red', '6 Green', '7 Verify', '8 Done'];
const SEVEN = ['1 Knowledge', '2 Describe', '3 Spec', '4 Red', '5 Green', '6 Verify', '7 Done'];
const TABLE = 'What each phase may write, under /work/turn-counter/';
const FOOT = [
  ["A phase opens on what mod-builder observes (your answer, a command's result), never on Claude saying so."],
  ['It checks the tool and the path, and compares SPEC.md and the tests by hash at each gate. Not a sandbox.'],
];
const WEIRD = [undefined, null, 'x', '', 0, -1, 1.5, 1e21, true, [], [1, 'a', null], {}, { a: 1 }];

// ------------------------------------------------------------------------------------- what the guard and gate write

test('the refusals and the checks are kept under keys of their own, beside the record', () => {
  assert.equal(refusalsKey(MOD), 'refusals:/work/turn-counter');
  assert.equal(checksKey(MOD), 'checks:/work/turn-counter');
});

test('a refused write is counted in its phase, and the toast comes once for each phase', () => {
  const first = countRefusal(undefined, 's1', 'spec', 'hooks/register.tsx');
  assert.deepEqual(first, { refusals: { sessionId: 's1', counts: { spec: 1 }, last: { phase: 'spec', path: 'hooks/register.tsx' }, toasted: ['spec'] }, toast: 'refused: hooks/register.tsx, at Spec' });
  const second = countRefusal(first.refusals, 's1', 'spec', 'tests/a.test.ts');
  assert.deepEqual(second, { refusals: { sessionId: 's1', counts: { spec: 2 }, last: { phase: 'spec', path: 'tests/a.test.ts' }, toasted: ['spec'] }, toast: null });
  const later = countRefusal(second.refusals, 's1', 'red', 'hooks/register.tsx');
  assert.deepEqual(later.refusals.counts, { spec: 2, red: 1 });
  assert.deepEqual(later.refusals.last, { phase: 'red', path: 'hooks/register.tsx' });
  assert.equal(later.toast, 'refused: hooks/register.tsx, at Red');
  assert.deepEqual(later.refusals.toasted, ['spec', 'red']);
});

test('the phases that had their toast are kept in the order of the phases, whatever order the refusals came in', () => {
  const late = countRefusal(undefined, 's1', 'green', 'tests/a.test.ts').refusals;
  assert.deepEqual(countRefusal(late, 's1', 'spec', 'hooks/a.ts').refusals.toasted, ['spec', 'green']);
});

test('a refused write with no path is said as the mod folder, and a path is shown without its control characters', () => {
  assert.equal(countRefusal(undefined, 's1', 'green', '').toast, 'refused: the mod folder, at Green');
  assert.equal(countRefusal(undefined, 's1', 'green', undefined).toast, 'refused: the mod folder, at Green');
  const odd = countRefusal(undefined, 's1', 'spec', 'hooks/a\u001b[31m.ts\nsecond line\u0007');
  assert.equal(odd.toast, 'refused: hooks/a [31m.ts second line, at Spec');
  assert.equal(odd.refusals.last.path, 'hooks/a [31m.ts second line');
});

test('stored refusals that are damaged count as none, and what can be read of them is kept', () => {
  const none = { sessionId: 's1', counts: {}, last: null, toasted: [] };
  for (const damaged of [...WEIRD, { sessionId: 's1', counts: 'x' }, { sessionId: 's1', counts: [3] }, { sessionId: 's1', counts: { spec: -1, red: 1.5, green: '2', verify: 0, done: 1e21, nowhere: 4 } }]) assert.deepEqual(readRefusals(damaged, 's1'), none, JSON.stringify(damaged));
  assert.deepEqual(readRefusals({ sessionId: 's1', counts: { spec: 2 }, last: { phase: 'nowhere', path: 'a' }, toasted: ['red', 'spec', 'x', 3] }, 's1'), { sessionId: 's1', counts: { spec: 2 }, last: null, toasted: ['spec', 'red'] });
  assert.equal(readRefusals({ sessionId: 's1', counts: { spec: 2 }, last: { phase: 'spec' } }, 's1').last, null);
  assert.equal(readRefusals({ sessionId: 's1', counts: { spec: 2 }, last: { phase: 'spec', path: 7 } }, 's1').last, null);
  assert.deepEqual(readRefusals({ sessionId: 's1', last: { phase: 'spec', path: 'a' }, toasted: 'spec' }, 's1'), { sessionId: 's1', counts: {}, last: { phase: 'spec', path: 'a' }, toasted: [] });
  assert.deepEqual(countRefusal({ sessionId: 's1', counts: 'x' }, 's1', 'nowhere', 'a'), { refusals: none, toast: null });
});

test('refusals another session left under the same folder are not this session\'s: the count starts again, and so does the toast', () => {
  const theirs = countRefusal(countRefusal(undefined, 's0', 'spec', 'a').refusals, 's0', 'spec', 'b').refusals;
  assert.deepEqual(readRefusals(theirs, 's1'), { sessionId: 's1', counts: {}, last: null, toasted: [] });
  assert.deepEqual(countRefusal(theirs, 's1', 'spec', 'c'), { refusals: { sessionId: 's1', counts: { spec: 1 }, last: { phase: 'spec', path: 'c' }, toasted: ['spec'] }, toast: 'refused: c, at Spec' });
  const { sessionId: _none, ...unowned } = theirs;
  assert.deepEqual(readRefusals(unowned, 's1').counts, {});
  assert.deepEqual(readRefusals(theirs, '').counts, {});
  assert.deepEqual(readRefusals({ ...theirs, sessionId: '' }, '').counts, {});
});

test('the four checks start waiting and move one at a time, the stored ones keeping whose they are and the mod\'s name', () => {
  const started = newChecks('s1', 'verify', 'turns');
  assert.deepEqual(started, { sessionId: 's1', phase: 'verify', name: 'turns', states: { validate: 'waiting', test: 'waiting', typecheck: 'waiting', load: 'waiting' }, results: {} });
  const some = withCheck(withCheck(started, 'validate', 'passed'), 'test', 'running');
  assert.deepEqual(some, { sessionId: 's1', phase: 'verify', name: 'turns', states: { validate: 'passed', test: 'running', typecheck: 'waiting', load: 'waiting' }, results: {} });
  assert.equal(started.states.validate, 'waiting');
  assert.deepEqual(readChecks(some, 's1', 'verify'), some);
  assert.deepEqual(readChecks(withCheck(some, 'load', 'failed'), 's1', 'verify').states, { validate: 'passed', test: 'running', typecheck: 'waiting', load: 'failed' });
});

test('stored checks of another phase or another session are not these, and damaged ones are read as far as they can be', () => {
  const some = moved('verify', { validate: 'passed' });
  assert.equal(readChecks(some, 's1', 'green'), null);
  assert.equal(readChecks(some, 's2', 'verify'), null);
  assert.equal(readChecks({ ...some, sessionId: '' }, '', 'verify'), null);
  for (const none of [...WEIRD, { sessionId: 's1', phase: 'verify' }, { sessionId: 's1', phase: 'verify', states: null }, { sessionId: 's1', phase: 'verify', states: ['passed'] }]) assert.equal(readChecks(none, 's1', 'verify'), null, JSON.stringify(none));
  assert.deepEqual(readChecks({ sessionId: 's1', phase: 'verify', name: 7, states: { validate: 'bogus', test: 'waiting', load: 'failed' } }, 's1', 'verify'), { sessionId: 's1', phase: 'verify', name: '', states: { validate: 'waiting', test: 'waiting', typecheck: 'waiting', load: 'failed' }, results: {} });
});

test('moving a check of what is no set of checks, or to what is no state, changes nothing and does not throw', () => {
  for (const none of [null, undefined, 'x', 3, [], {}, { states: null }]) assert.deepEqual(withCheck(none, 'validate', 'passed'), none);
  const started = newChecks('s1', 'verify', 'turns');
  assert.deepEqual(withCheck(started, 'nothing', 'passed'), started);
  assert.deepEqual(withCheck(started, 'validate', 'bogus'), started);
});

test('a gate that ended leaves no check running: one still running waits again, and the others stay', () => {
  const left = moved('verify', { validate: 'passed', test: 'failed', typecheck: 'running' });
  assert.deepEqual(settledChecks(left), { sessionId: 's1', phase: 'verify', name: 'turns', states: { validate: 'passed', test: 'failed', typecheck: 'waiting', load: 'waiting' }, results: {} });
  assert.equal(left.states.typecheck, 'running');
  for (const none of [null, undefined, 'x', [], {}]) assert.deepEqual(settledChecks(none), none);
});

test('the last refused gate is read when it is this phase\'s, with what can\'t be read of it left out', () => {
  assert.deepEqual(readAttempt({ phase: 'green', reason: 'not every test passes', failing: ['one', 'two'], passed: 1, tests: 3 }, 'green'), { phase: 'green', reason: 'not every test passes', failing: ['one', 'two'], passed: 1, tests: 3 });
  assert.equal(readAttempt({ phase: 'red', reason: 'old', failing: [], passed: null, tests: null }, 'green'), null);
  for (const none of [...WEIRD, { reason: 'no phase' }]) assert.equal(readAttempt(none, 'green'), null, JSON.stringify(none));
  assert.deepEqual(readAttempt({ phase: 'green', reason: 7, failing: 'abc', passed: 'x', tests: 3 }, 'green'), { phase: 'green', reason: '', failing: [], passed: null, tests: null });
  assert.deepEqual(readAttempt({ phase: 'green', reason: 'first\nsecond', failing: ['one', null, {}, '', 'two\u0007'], passed: 4, tests: 3 }, 'green'), { phase: 'green', reason: 'first second', failing: ['one', 'two'], passed: null, tests: null });
  assert.deepEqual(readAttempt({ phase: 'green', passed: 1e21, tests: 1e21 }, 'green'), { phase: 'green', reason: '', failing: [], passed: null, tests: null });
});

test('what the gate that ended Verify counted is read as far as it can be', () => {
  const whole = { version: '0.1.0', files: 7, tests: 6, command: 'turn-counter', builtOn: 'Built on Claude Code 2.1.322, from the docs snapshot 2026-11-10T194027Z, against the types sha256 ab.' };
  assert.deepEqual(readFinished(whole), whole);
  const none = { version: null, files: null, tests: null, command: null, builtOn: null };
  for (const damaged of WEIRD) assert.deepEqual(readFinished(damaged), none, JSON.stringify(damaged));
  assert.deepEqual(readFinished({ version: {}, files: 'x', tests: -1, command: 5, builtOn: [] }), none);
  assert.deepEqual(readFinished({ version: '', files: 1.5, tests: 1e21, command: 'a b', builtOn: '  ' }), none);
  assert.deepEqual(readFinished({ version: ' 1.0.0\n', files: 0, tests: 0, command: 'plug:cmd_1-x' }), { version: '1.0.0', files: 0, tests: 0, command: 'plug:cmd_1-x', builtOn: null });
});

// --------------------------------------------------------------------------------------------- what the cache holds

test('a manifest\'s pages are counted, and what is no manifest has no count', () => {
  assert.equal(pagesIn(MANIFEST), 2);
  assert.equal(pagesIn(MANIFEST.replaceAll('\n', '\r\n')), 2);
  assert.equal(pagesIn('page\turl\n'), 0);
  assert.equal(pagesIn(`${MANIFEST}docs-index.txt\tx\ty\tz\t1\nUpper.md\tx\nxmd\ty\nno-tab.md\n`), 2);
  for (const none of [null, undefined, '', 'admin.md\tx\n', 3]) assert.equal(pagesIn(none), null);
});

test('the changes file, as the script writes it, gives the totals and each page\'s lines each way with the headings beneath it', () => {
  const read = {
    changed: 2, added: 1, removed: 1,
    pages: [
      { page: 'api.md', how: 'changed', plus: 4, minus: 2, headings: ['(before the first heading)', 'Add a command', 'Show something without starting a turn'] },
      { page: 'events.md', how: 'changed', plus: 1, minus: 1, headings: ['Events'] },
      { page: 'gallery.md', how: 'added', plus: 1, minus: 0, headings: [] },
      { page: 'gone.md', how: 'removed', plus: 0, minus: 2, headings: [] },
    ],
  };
  assert.deepEqual(changesIn(CHANGES), read);
  assert.deepEqual(changesIn(CHANGES.replaceAll('\n', '\r\n')), read);
});

test('in a changes file only a list item under a page is a heading, and what is no changes file is none', () => {
  const odd = '# Changes in b since a\n\n- above every page\n\nPages: 1 changed, 0 added, 0 removed.\n\n## api.md: changed, +1 -1\n\nplain text\n# not a list item\n-no space\n- \n- ###  Deep one  \n- #hash without a space\n';
  assert.deepEqual(changesIn(odd), { changed: 1, added: 0, removed: 0, pages: [{ page: 'api.md', how: 'changed', plus: 1, minus: 1, headings: ['Deep one', '#hash without a space'] }] });
  assert.deepEqual(changesIn('Pages: 0 changed, 0 added, 0 removed.\n'), { changed: 0, added: 0, removed: 0, pages: [] });
  for (const none of [null, undefined, '', '# Changes\n', 'Pages: 1 changed, 0 added.\n', ' Pages: 1 changed, 0 added, 0 removed.\n', 3]) assert.equal(changesIn(none), null);
});

test('the command a mod answers is read from validate\'s own line', () => {
  assert.equal(commandOf('  > ./register.tsx answers its own command: command.run{command=turn-counter}\n'), 'turn-counter');
  assert.equal(commandOf('answers its own command: command.run{command=plug:cmd_1-x}'), 'plug:cmd_1-x');
  assert.equal(commandOf('  > ./register.tsx hooks: session.start, command.run{command=x}\n'), null);
  assert.equal(commandOf('answers its own command: command.run{command=}'), null);
  for (const none of [null, undefined, '', 3]) assert.equal(commandOf(none), null);
});

// ------------------------------------------------------------------------------- the lines outside the pane

test('the transcript line when a build or an edit opens says what is checked first', () => {
  assert.equal(openedLine('build'), "checking what Claude Code's mods can do today before planning.");
  assert.equal(openedLine('edit'), "checking what Claude Code's mods can do today before planning the change.");
});

test('the approval question\'s hint says what the guard holds until the answer', () => {
  assert.equal(approvalHint('build'), 'Nothing under hooks/ or tests/ can be written until you approve.');
  assert.equal(approvalHint('edit'), 'No test file and no code can be written until you approve.');
});

test('the toast after a fetch counts the pages that changed, were added or removed; the one at Done names the mod', () => {
  assert.equal(refreshedToast(changesIn(CHANGES)), 'mod docs refreshed, 4 pages changed');
  assert.equal(refreshedToast({ changed: 0, added: 1, removed: 0, pages: [] }), 'mod docs refreshed, 1 page changed');
  assert.equal(refreshedToast({ changed: 0, added: 0, removed: 0, pages: [] }), 'mod docs refreshed, 0 pages changed');
  for (const none of [null, undefined, 'x', { changed: 'x' }]) assert.equal(refreshedToast(none), 'mod docs refreshed');
  assert.equal(doneToast(MOD, 'build'), `turn-counter is built ${DOT} 4 of 4 checks passed`);
  assert.equal(doneToast('/work/turn-counter/', 'edit'), `turn-counter is edited ${DOT} 4 of 4 checks passed`);
  assert.equal(doneToast(undefined, 'build'), `the mod is built ${DOT} 4 of 4 checks passed`);
});

// ------------------------------------------------------------------------------------------------- the frames

test('with nothing open the pane says so, shows a build\'s eight phases unstarted and dim, the cache, and no status line', () => {
  const model = paneModel(input({ entry: undefined }));
  assert.deepEqual(model.header, { title: 'MOD BUILDER', state: 'no build or edit in this session', tone: 'dim' });
  assert.deepEqual(rail(model), EIGHT.map((phase) => `later:${phase}`));
  assert.equal(model.isRailDim, true);
  assert.deepEqual(headings(model), ['Knowledge']);
  assert.equal(model.status, null);
});

test('a pending build and a pending edit say their folder is not named yet, each with its own phases', () => {
  const build = paneModel(input({ entry: { modDir: null } }));
  assert.deepEqual(build.header, { title: 'MOD BUILDER', state: `a new mod ${DOT} its folder is not named yet`, tone: 'dim' });
  assert.deepEqual(rail(build), EIGHT.map((phase) => `later:${phase}`));
  assert.equal(build.isRailDim, false);
  assert.deepEqual(headings(build), ['Knowledge']);
  assert.equal(build.status, `build ${DOT} waiting for the mod's folder`);
  const edit = paneModel(input({ entry: { modDir: null, kind: 'edit' } }));
  assert.equal(edit.header.state, `an edit ${DOT} its folder is not named yet`);
  assert.deepEqual(rail(edit), SEVEN.map((phase) => `later:${phase}`));
  assert.equal(edit.status, `edit ${DOT} waiting for the mod's folder`);
});

test('Main: at Knowledge the rail marks it current, and the Knowledge block shows the fetch, the pages and each changed page', () => {
  const model = paneModel(input({ record: record('knowledge') }));
  assert.deepEqual(model.header, { title: 'MOD BUILDER', state: `turn-counter ${DOT} new mod`, tone: 'dim' });
  assert.deepEqual(rail(model), ['current:1 Knowledge', ...EIGHT.slice(1).map((phase) => `later:${phase}`)]);
  assert.equal(model.isRailDim, false);
  assert.deepEqual(headings(model), ['Knowledge', '']);
  const drawn = block(model, 'Knowledge');
  assert.deepEqual(texts(drawn), [
    ["Anthropic's mod pages", 'last fetched 2 days ago'],
    ['  10 pages in snapshot 2026-11-10T194027Z', '2 changed, 1 added, 1 removed'],
    ['  changed', 'api.md', `+4 -2 lines ${DOT} (before the first heading), Add a command, Show something without starting a turn`],
    ['  changed', 'events.md', `+1 -1 lines ${DOT} Events`],
    ['  added', 'gallery.md', '+1 -0 lines'],
    ['  removed', 'gone.md', '+0 -2 lines'],
    ['API types for this build', `2.1.322 ${DOT} read from the installed copy at each typecheck`],
  ]);
  assert.deepEqual(tones(drawn), [['plain', 'dim'], ['plain', 'warning'], ['warning', 'plain', 'dim'], ['warning', 'plain', 'dim'], ['warning', 'plain', 'dim'], ['warning', 'plain', 'dim'], ['plain', 'dim']]);
  assert.deepEqual(widths(drawn)[2], [10, 16, 0]);
  assert.deepEqual(model.blocks[1].rows, [[{ text: 'Everything the plan says about the API will cite one of these, by page and line.', tone: 'dim' }]]);
  assert.equal(model.status, `knowledge ${DOT} snapshot 2026-11-10T194027Z ${DOT} 4 pages changed`);
});

test('Main: at Describe the status line names that phase, and one changed page is said as one', () => {
  const one = { changed: 1, added: 0, removed: 0, pages: [] };
  const model = paneModel(input({ record: record('describe'), knowledge: knowledge({ changes: one }) }));
  assert.deepEqual(rail(model).slice(0, 3), [`done:1 Knowledge ${TICK}`, 'current:2 Describe', 'later:3 Spec']);
  assert.equal(model.header.state, `turn-counter ${DOT} new mod`);
  assert.equal(model.status, `describe ${DOT} snapshot 2026-11-10T194027Z ${DOT} 1 page changed`);
  assert.deepEqual(texts(block(model, 'Knowledge'))[1], ['  10 pages in snapshot 2026-11-10T194027Z', '1 changed, 0 added, 0 removed']);
});

test('Main: a fetch under way, a cache never fetched, a first snapshot and an unchanged one are each said as they are', () => {
  const refreshing = paneModel(input({ record: record('describe'), knowledge: knowledge({ isRefreshing: true, checked: '2026-11-12T190000Z' }) }));
  assert.deepEqual(texts(block(refreshing, 'Knowledge'))[0], ["Anthropic's mod pages", `last fetched today ${DOT} refreshing${DOTS}`]);
  const never = paneModel(input({ record: record('knowledge'), knowledge: knowledge({ latest: null, checked: null, pages: null, changes: null }) }));
  assert.deepEqual(texts(block(never, 'Knowledge')).slice(0, 2), [["Anthropic's mod pages", 'never fetched'], ['  no snapshot yet: /mod-builder refresh fetches one']]);
  assert.deepEqual(tones(block(never, 'Knowledge'))[1], ['warning']);
  assert.equal(never.status, `knowledge ${DOT} snapshot none`);
  const first = paneModel(input({ record: record('knowledge'), knowledge: knowledge({ changes: null, pages: 1, checked: '2026-11-11T200000Z' }) }));
  assert.deepEqual(texts(block(first, 'Knowledge')).slice(0, 2), [["Anthropic's mod pages", 'last fetched 1 day ago'], ['  1 page in snapshot 2026-11-10T194027Z', 'the first snapshot, or nothing to compare with']]);
  assert.deepEqual(tones(block(first, 'Knowledge'))[1], ['plain', 'dim']);
  assert.equal(first.status, `knowledge ${DOT} snapshot 2026-11-10T194027Z`);
  const same = paneModel(input({ record: record('knowledge'), knowledge: knowledge({ pages: null, changes: { changed: 0, added: 0, removed: 0, pages: [] } }) }));
  assert.deepEqual(texts(block(same, 'Knowledge'))[1], ['  pages in snapshot 2026-11-10T194027Z', '0 changed, 0 added, 0 removed']);
  assert.deepEqual(tones(block(same, 'Knowledge'))[1], ['plain', 'dim']);
  assert.equal(same.status, `knowledge ${DOT} snapshot 2026-11-10T194027Z`);
});

test('Main: a fetch stamped ahead of the clock is said as it is, and a stamp or a clock that can\'t be read as never fetched', () => {
  const said = (more) => texts(block(paneModel(input({ record: record('knowledge'), knowledge: knowledge(more) })), 'Knowledge'))[0][1];
  assert.equal(said({ checked: '2026-11-14T000000Z' }), 'last fetched 2026-11-14T000000Z, ahead of this clock');
  assert.equal(said({ checked: '2026-11-12T195959Z' }), 'last fetched today');
  assert.equal(said({ checked: 'yesterday' }), 'never fetched');
  assert.equal(said({ now: Number.NaN }), 'never fetched');
  assert.equal(said({ now: 'x' }), 'never fetched');
});

test('Spec: the rail marks Spec current with the phases before it done, and the spec itself is the block', () => {
  const model = paneModel(input({ record: record('spec'), spec: '# turn-counter\n\nA pane that counts turns.\n' }));
  assert.deepEqual(model.header, { title: 'MOD BUILDER', state: `turn-counter ${DOT} SPEC.md written`, tone: 'dim' });
  assert.deepEqual(rail(model).slice(0, 4), [`done:1 Knowledge ${TICK}`, `done:2 Describe ${TICK}`, 'current:3 Spec', 'later:4 Scaffold']);
  assert.deepEqual(headings(model), ['The spec, as SPEC.md has it']);
  assert.deepEqual(block(model, 'The spec, as SPEC.md has it'), { heading: [{ text: 'The spec, as SPEC.md has it' }], rows: [], markdown: '# turn-counter\n\nA pane that counts turns.' });
  assert.equal(model.status, `spec ${DOT} waiting for your approval`);
});

test('Spec: a spec not written yet, or one that is no text, is said so', () => {
  for (const none of [null, undefined, 3, {}, '', '  \n']) {
    const model = paneModel(input({ record: record('spec'), spec: none }));
    assert.equal(model.header.state, `turn-counter ${DOT} ${typeof none === 'string' ? 'SPEC.md written' : 'SPEC.md not written yet'}`);
    assert.deepEqual(block(model, 'The spec').rows, [[{ text: '  SPEC.md is not written yet', tone: 'dim' }]]);
  }
});

test('Spec: a refused approval is above the spec, with its reason', () => {
  const attempt = { phase: 'spec', reason: 'the person answered "Not yet"', failing: [], passed: null, tests: null };
  const model = paneModel(input({ record: record('spec', { attempt }), spec: '# x\n' }));
  assert.deepEqual(headings(model), ['', 'The spec, as SPEC.md has it']);
  assert.deepEqual(model.blocks[0].rows, [[{ text: '  not passed: the person answered "Not yet"', tone: 'warning' }]]);
});

test('Guard: after a refusal the header and the status line carry the count beside the mod\'s name, and the table says what each phase may write', () => {
  const model = paneModel(input({ record: record('spec'), spec: '# x\n', refusals: refusedAt('spec') }));
  assert.deepEqual(model.header, { title: 'MOD BUILDER', state: `turn-counter ${DOT} 1 edit refused ${DOT} phase Spec`, tone: 'warning' });
  assert.equal(model.status, `spec ${DOT} 1 edit refused ${DOT} waiting for your approval`);
  assert.deepEqual(headings(model), [TABLE, 'The spec, as SPEC.md has it']);
  const table = block(model, TABLE);
  assert.deepEqual(texts(table), [
    ['  3 Spec', 'SPEC.md only', 'now'],
    ['  4 Scaffold', 'everything', 'opens when the person approves the spec'],
    ['  5 Red', 'tests/ only', 'opens when `claude plugin validate --strict` passes'],
    ['  6 Green', 'anything but tests/ and SPEC.md', 'opens when a new test fails by assertion and the mod, its tests included, typechecks'],
    ['  7 Verify', 'anything but tests/ and hooks/', 'opens when every test passes'],
    ...FOOT,
  ]);
  assert.deepEqual(tones(table), [['plain', 'plain', 'current'], ['plain', 'plain', 'dim'], ['plain', 'plain', 'dim'], ['plain', 'plain', 'dim'], ['plain', 'plain', 'dim'], ['dim'], ['dim']]);
  assert.deepEqual(widths(table)[0], [13, 34, 0]);
  const two = paneModel(input({ record: record('spec'), refusals: refusedAt('spec', 'tests/a.ts', refusedAt('spec')) }));
  assert.equal(two.header.state, `turn-counter ${DOT} 2 edits refused ${DOT} phase Spec`);
  assert.equal(two.status, `spec ${DOT} 2 edits refused ${DOT} waiting for your approval`);
});

test('Guard: the table is gone once the build has moved to another phase, and a refusal counted earlier is not this phase\'s', () => {
  const model = paneModel(input({ record: record('scaffold'), refusals: refusedAt('spec') }));
  assert.deepEqual(headings(model), [`4 Scaffold working${DOTS}`]);
  assert.deepEqual(model.header, { title: 'MOD BUILDER', state: `turn-counter ${DOT} building`, tone: 'dim' });
  assert.equal(model.status, 'scaffold');
});

test('Guard: refusals another session left under the same folder draw as none', () => {
  const theirs = countRefusal(undefined, 's0', 'spec', 'hooks/register.tsx').refusals;
  const model = paneModel(input({ record: record('spec'), spec: '# x\n', refusals: theirs }));
  assert.deepEqual(model.header, { title: 'MOD BUILDER', state: `turn-counter ${DOT} SPEC.md written`, tone: 'dim' });
  assert.deepEqual(headings(model), ['The spec, as SPEC.md has it']);
  assert.equal(model.status, `spec ${DOT} waiting for your approval`);
});

test('Guard: a refusal at Knowledge or Describe has a row for that phase, marked now, and Spec\'s row says the snapshot comes first', () => {
  const first = paneModel(input({ record: record('knowledge'), refusals: refusedAt('knowledge', 'SPEC.md') }));
  assert.equal(first.header.state, `turn-counter ${DOT} 1 edit refused ${DOT} phase Knowledge`);
  assert.equal(first.header.tone, 'warning');
  assert.deepEqual(headings(first), [TABLE, 'Knowledge', '']);
  assert.deepEqual(texts(block(first, TABLE)).slice(0, 3), [
    ['  1 Knowledge', 'nothing in the mod', 'now'],
    ['  3 Spec', 'SPEC.md only', 'opens when a snapshot exists and the model has read the pages that bear on the request (no gate)'],
    ['  4 Scaffold', 'everything', 'opens when the person approves the spec'],
  ]);
  assert.equal(first.status, `knowledge ${DOT} snapshot 2026-11-10T194027Z ${DOT} 4 pages changed ${DOT} 1 edit refused`);
  const second = paneModel(input({ record: record('describe'), refusals: refusedAt('describe', 'SPEC.md') }));
  assert.deepEqual(texts(block(second, TABLE)).slice(0, 2), [
    ['  2 Describe', 'nothing in the mod', 'now'],
    ['  3 Spec', 'SPEC.md only', 'opens when the model has read the pages that bear on the request (no gate)'],
  ]);
  assert.deepEqual(tones(block(second, TABLE))[0], ['plain', 'plain', 'current']);
});

test('Guard: a refusal at Red, at Green and at Verify marks the phases before as closed, and the status line carries the count', () => {
  const red = paneModel(input({ record: record('red', { evidence: { scaffold: 'validated' } }), refusals: refusedAt('red') }));
  assert.equal(red.header.state, `turn-counter ${DOT} 1 edit refused ${DOT} phase Red`);
  assert.deepEqual(headings(red), [TABLE, '4 Scaffold passed', `5 Red working${DOTS}`]);
  assert.deepEqual(texts(block(red, TABLE)).slice(0, 4).map((row) => [row[0], row[2]]), [['  3 Spec', 'closed'], ['  4 Scaffold', 'closed'], ['  5 Red', 'now'], ['  6 Green', 'opens when a new test fails by assertion and the mod, its tests included, typechecks']]);
  assert.deepEqual(tones(block(red, TABLE)).slice(0, 3).map((row) => row[2]), ['dim', 'dim', 'current']);
  assert.equal(red.status, `red ${DOT} 1 edit refused`);
  const green = paneModel(input({ record: record('green'), refusals: refusedAt('green', 'tests/a.test.ts') }));
  assert.equal(green.header.state, `turn-counter ${DOT} 1 edit refused ${DOT} phase Green`);
  assert.equal(green.status, `green ${DOT} 1 edit refused`);
  const verify = paneModel(input({ record: record('verify'), refusals: refusedAt('verify') }));
  assert.deepEqual(verify.header, { title: 'MOD BUILDER', state: `turn-counter ${DOT} 1 edit refused ${DOT} phase Verify`, tone: 'warning' });
  assert.deepEqual(headings(verify).slice(0, 2), [TABLE, 'Each check is a command mod-builder ran itself']);
  assert.deepEqual(texts(block(verify, TABLE)).slice(0, 5).map((row) => row[2]), ['closed', 'closed', 'closed', 'closed', 'now']);
  assert.equal(verify.status, `verify ${DOT} 0 of 4 checks passed ${DOT} 1 edit refused`);
});

test('Guard: a refusal at Done shows the table with Done\'s row, and leaves Done\'s header and its cleared status line as they are', () => {
  const model = paneModel(input({ record: record('done'), refusals: refusedAt('done', 'tests/a.test.ts') }));
  assert.deepEqual(model.header, { title: 'MOD BUILDER', state: `turn-counter ${DOT} built and checked`, tone: 'success' });
  assert.deepEqual(headings(model), [TABLE, 'What was built', 'What was checked', 'Try it']);
  assert.deepEqual(texts(block(model, TABLE)).slice(4, 6), [['  7 Verify', 'anything but tests/ and hooks/', 'closed'], ['  8 Done', 'anything but tests/ and hooks/', 'now']]);
  assert.equal(model.status, null);
});

test('Build: each passed phase shows what its gate saw in rows, the current phase is working, and the last refused gate is beneath it', () => {
  const evidence = { knowledge: 'snapshot 2026-11-10T194027Z', describe: 'no gate', spec: 'the person answered "Approve"', scaffold: 'claude plugin validate --strict exited 0; 2 tests ran; the typecheck passes', red: '3 tests ran, the new ones failing by assertion; 2 files under tests/ hashed', green: 'not yet' };
  const attempt = { phase: 'green', reason: 'claude plugin test exited 1: not every test passes', failing: ['resets on /clear', 'counts a turn'], passed: 1, tests: 3 };
  const model = paneModel(input({ record: record('green', { specApprovedAt: Date.UTC(2026, 10, 11, 15, 31, 7), evidence, attempt }) }));
  assert.deepEqual(model.header, { title: 'MOD BUILDER', state: `turn-counter ${DOT} approved 15:31 UTC ${DOT} building`, tone: 'dim' });
  assert.deepEqual(rail(model).slice(3), [`done:4 Scaffold ${TICK}`, `done:5 Red ${TICK}`, 'current:6 Green', 'later:7 Verify', 'later:8 Done']);
  assert.deepEqual(headings(model), ['3 Spec passed', '4 Scaffold passed', '5 Red passed', `6 Green working${DOTS}`]);
  assert.deepEqual(block(model, '4 Scaffold passed').heading, [{ text: '4 Scaffold' }, { text: 'passed', tone: 'success' }]);
  assert.deepEqual(texts(block(model, '4 Scaffold passed')), [['  claude plugin validate --strict exited 0'], ['  2 tests ran'], ['  the typecheck passes']]);
  const working = block(model, `6 Green working${DOTS}`);
  assert.deepEqual(working.heading, [{ text: '6 Green' }, { text: `working${DOTS}`, tone: 'current' }]);
  assert.deepEqual(working.rows, [
    [{ text: '  not passed: claude plugin test exited 1: not every test passes', tone: 'warning' }],
    [{ text: '  fails', tone: 'error', width: 9 }, { text: 'resets on /clear' }],
    [{ text: '  fails', tone: 'error', width: 9 }, { text: 'counts a turn' }],
  ]);
  assert.equal(model.status, `green ${DOT} 1 of 3 tests pass`);
});

test('Build: at Red the status line says how many tests fail, at Scaffold how many pass, and one test is said as one', () => {
  const at = (phase, passed, tests) => paneModel(input({ record: record(phase, { attempt: { phase, reason: 'no new test fails', failing: [], passed, tests } }) })).status;
  assert.equal(at('red', 3, 3), `red ${DOT} 0 of 3 tests fail`);
  assert.equal(at('red', 1, 3), `red ${DOT} 2 of 3 tests fail`);
  assert.equal(at('scaffold', 1, 1), `scaffold ${DOT} 1 of 1 test pass`);
  assert.equal(at('green', null, 3), 'green');
  assert.equal(at('green', 4, 3), 'green');
  const refused = paneModel(input({ record: record('green', { attempt: { phase: 'green', reason: 'x', failing: [], passed: 2, tests: 3 } }), refusals: refusedAt('green') }));
  assert.equal(refused.status, `green ${DOT} 2 of 3 tests pass ${DOT} 1 edit refused`);
});

test('Build: a refused gate with no reason stored still says it did not pass', () => {
  const model = paneModel(input({ record: record('green', { attempt: { phase: 'green', failing: ['one'] } }) }));
  assert.deepEqual(texts(block(model, `6 Green working${DOTS}`)), [['  not passed'], ['  fails', 'one']]);
});

test('Build: an attempt of another phase is not shown, and a record 0.1.0 stored, with none of the new fields, still draws', () => {
  const stale = paneModel(input({ record: record('green', { attempt: { phase: 'red', reason: 'old', failing: ['a'], passed: 1, tests: 2 } }) }));
  assert.deepEqual(texts(block(stale, `6 Green working${DOTS}`)), []);
  assert.equal(stale.status, 'green');
  const old = { modDir: MOD, sessionId: 's1', phase: 'red', specApprovedAt: null, spec: null, testsAtScaffold: 2, namesAtScaffold: ['a', 'b'], testsAtRed: null, testHashes: null, evidence: { scaffold: 'claude plugin validate --strict exited 0; 2 tests ran' } };
  const model = paneModel(input({ record: old }));
  assert.equal(model.header.state, `turn-counter ${DOT} building`);
  assert.deepEqual(headings(model), ['4 Scaffold passed', `5 Red working${DOTS}`]);
  assert.equal(model.status, 'red');
});

test('Build: at Green the checks are rows once one has moved, and not before', () => {
  const none = paneModel(input({ record: record('green'), checks: newChecks('s1', 'green', 'turns') }));
  assert.deepEqual(headings(none), [`6 Green working${DOTS}`]);
  const model = paneModel(input({ record: record('green'), checks: moved('green', { validate: 'passed', test: 'running' }) }));
  assert.deepEqual(headings(model), ['Each check is a command mod-builder ran itself', `6 Green working${DOTS}`]);
  assert.deepEqual(texts(block(model, 'Each check is a command mod-builder ran itself')).map((row) => row[0]), ['  passed', '  running', '  waiting', '  waiting']);
  const stale = paneModel(input({ record: record('green'), checks: moved('verify', { validate: 'passed' }) }));
  assert.deepEqual(headings(stale), [`6 Green working${DOTS}`]);
});

test('Verify: each check is a row with its state and its command, the load\'s rows say what the log must show, and the status counts them', () => {
  const model = paneModel(input({ record: record('verify', { evidence: { green: 'every test passes', verify: 'not yet' } }), checks: moved('verify', { validate: 'passed', test: 'passed', typecheck: 'passed', load: 'running' }) }));
  assert.deepEqual(model.header, { title: 'MOD BUILDER', state: `turn-counter ${DOT} checking the finished mod`, tone: 'dim' });
  assert.deepEqual(rail(model).slice(5), [`done:6 Green ${TICK}`, 'current:7 Verify', 'later:8 Done']);
  assert.deepEqual(headings(model), ['Each check is a command mod-builder ran itself', 'Headless load: what the debug log must show', 'Unchanged since their gates']);
  const checks = block(model, 'Each check is a command mod-builder ran itself');
  assert.deepEqual(texts(checks), [
    ['  passed', 'validate', 'claude plugin validate --strict /work/turn-counter'],
    ['  passed', 'test', 'claude plugin test /work/turn-counter'],
    ['  passed', 'typecheck', 'tsc against the 2.1.322 types'],
    ['  running', 'headless load', 'claude --plugin-dir /work/turn-counter -p /cost'],
  ]);
  assert.deepEqual(tones(checks), [['success', 'plain', 'plain'], ['success', 'plain', 'plain'], ['success', 'plain', 'plain'], ['current', 'plain', 'plain']]);
  assert.deepEqual(widths(checks)[0], [10, 14, 0]);
  const load = block(model, 'Headless load: what the debug log must show');
  assert.deepEqual(texts(load), [
    ['  running', 'hooks module turns@inline loaded'],
    ['  running', 'no line that says it failed to load, did not load or was not loaded'],
    ['  running', 'no hook skipped'],
  ]);
  assert.deepEqual(tones(load), [['current', 'plain'], ['current', 'plain'], ['current', 'plain']]);
  assert.deepEqual(widths(load)[0], [12, 0]);
  assert.deepEqual(block(model, 'Unchanged since their gates').rows, [[{ text: `  SPEC.md since approval ${DOT} the test files since Red` }, { text: 'compared by hash', tone: 'dim' }]]);
  assert.equal(model.status, `verify ${DOT} 3 of 4 checks passed ${DOT} headless load running`);
});

test('Verify: with no states stored, or another session\'s, every check waits; a load that ended is found or not shown, and a mod with no name stored is the mod', () => {
  for (const checks of [undefined, moved('green', { validate: 'passed' }), { ...moved('verify', { validate: 'passed' }), sessionId: 's0' }]) {
    const waiting = paneModel(input({ record: record('verify'), checks }));
    assert.deepEqual(texts(block(waiting, 'Each check is a command mod-builder ran itself')).map((row) => row[0]), ['  waiting', '  waiting', '  waiting', '  waiting']);
    assert.deepEqual(tones(block(waiting, 'Each check is a command mod-builder ran itself')).map((row) => row[0]), ['dim', 'dim', 'dim', 'dim']);
    assert.deepEqual(texts(block(waiting, 'Headless load: what the debug log must show'))[0], ['  waiting', 'hooks module the mod@inline loaded']);
    assert.equal(waiting.status, `verify ${DOT} 0 of 4 checks passed`);
  }
  const ended = (state) => block(paneModel(input({ record: record('verify'), checks: moved('verify', { load: state }, '') })), 'Headless load: what the debug log must show').rows[0];
  assert.deepEqual(ended('passed'), [{ text: '  found', tone: 'success', width: 12 }, { text: 'hooks module the mod@inline loaded' }]);
  assert.deepEqual(ended('failed'), [{ text: '  not shown', tone: 'error', width: 12 }, { text: 'hooks module the mod@inline loaded' }]);
});

test('Verify: a check that failed is not counted as passed, and the header, its row and the status line say it did not pass', () => {
  const attempt = { phase: 'verify', reason: 'the typecheck exited 2', failing: [], passed: null, tests: null };
  const model = paneModel(input({ record: record('verify', { attempt }), checks: moved('verify', { validate: 'passed', test: 'passed', typecheck: 'failed' }) }));
  assert.deepEqual(model.header, { title: 'MOD BUILDER', state: `turn-counter ${DOT} typecheck did not pass`, tone: 'error' });
  assert.deepEqual(block(model, 'Each check is a command mod-builder ran itself').rows[2][0], { text: '  failed', tone: 'error', width: 10 });
  assert.deepEqual(texts(block(model, 'Headless load: what the debug log must show'))[0], ['  waiting', 'hooks module turns@inline loaded']);
  assert.deepEqual(model.blocks.at(-1).rows, [[{ text: '  not passed: the typecheck exited 2', tone: 'warning' }]]);
  assert.equal(model.status, `verify ${DOT} 2 of 4 checks passed ${DOT} typecheck did not pass`);
  const two = paneModel(input({ record: record('verify'), checks: moved('verify', { validate: 'failed', load: 'failed' }) }));
  assert.equal(two.header.state, `turn-counter ${DOT} validate, headless load did not pass`);
  assert.equal(two.status, `verify ${DOT} 0 of 4 checks passed ${DOT} validate, headless load did not pass`);
});

test('Done: the header is the mod and its version in the tone of success, the blocks say what was built, checked and how to try it, and the status line is cleared', () => {
  const evidence = { knowledge: 'snapshot 2026-11-09T101010Z', verify: 'validate, 6 tests, the typecheck and a headless load of turns all pass' };
  const refusals = { sessionId: 's1', counts: { spec: 1, red: 2 }, last: null, toasted: ['spec', 'red'] };
  const model = paneModel(input({ record: record('done', { evidence, finished: { version: '0.1.0', files: 7, tests: 6, command: 'turn-counter' } }), refusals }));
  assert.deepEqual(model.header, { title: 'MOD BUILDER', state: `turn-counter 0.1.0 ${DOT} built and checked`, tone: 'success' });
  assert.deepEqual(rail(model).slice(6), [`done:7 Verify ${TICK}`, 'current:8 Done']);
  assert.equal(model.isRailDim, false);
  assert.deepEqual(headings(model), ['What was built', 'What was checked', 'Try it']);
  assert.deepEqual(block(model, 'What was built').rows, [[{ text: '  /work/turn-counter/' }, { text: `7 files ${DOT} 6 tests`, tone: 'dim' }], [{ text: '  built on Claude Code 2.1.322, from the documents of 2026-11-09T101010Z' }]]);
  assert.deepEqual(block(model, 'What was checked').rows, [[{ text: '  validate, 6 tests, the typecheck and a headless load of turns all pass' }], [{ text: '  3 edits refused along the way, at Spec, Red', tone: 'dim' }]]);
  assert.deepEqual(block(model, 'Try it').rows, [[{ text: '  claude --plugin-dir /work/turn-counter' }, { text: 'then', tone: 'dim' }, { text: '/turn-counter' }]]);
  assert.equal(model.status, null);
});

test('Done: the gate\'s own "Built on" line is the row when it stored one, one file and one test are said as one, and one refusal is the picture\'s own line', () => {
  const builtOn = 'Built on Claude Code 2.1.322, from the docs snapshot 2026-11-10T194027Z, against the types sha256 ab.';
  const refusals = refusedAt('spec');
  const model = paneModel(input({ record: record('done', { finished: { version: '0.1.0', files: 1, tests: 1, command: null, builtOn } }), refusals }));
  assert.deepEqual(texts(block(model, 'What was built')), [['  /work/turn-counter/', `1 file ${DOT} 1 test`], [`  ${builtOn}`]]);
  assert.deepEqual(texts(block(model, 'What was checked')).at(-1), ['  1 edit refused along the way, at Spec']);
});

test('Done: with no command read, nothing counted and no snapshot recorded, the rows that need them are left out or say unknown', () => {
  const model = paneModel(input({ record: record('done') }));
  assert.equal(model.header.state, `turn-counter ${DOT} built and checked`);
  assert.deepEqual(texts(block(model, 'Try it')), [['  claude --plugin-dir /work/turn-counter']]);
  assert.deepEqual(texts(block(model, 'What was checked')), [['  validate, the tests, the typecheck and a headless load']]);
  assert.deepEqual(texts(block(model, 'What was built')), [['  /work/turn-counter/'], ['  built on Claude Code 2.1.322, from the documents of 2026-11-10T194027Z']]);
  const unknown = paneModel(input({ record: record('done', { finished: { files: 2 } }), knowledge: knowledge({ latest: null }) }));
  assert.deepEqual(texts(block(unknown, 'What was built')), [['  /work/turn-counter/', '2 files'], ['  built on Claude Code 2.1.322, from the documents of unknown']]);
});

test('a record 0.1.0 stored draws at Verify and at Done', () => {
  const old = (phase) => ({ modDir: MOD, sessionId: 's1', phase, specApprovedAt: 5, spec: { length: 3, hash: 'h' }, testsAtScaffold: 2, namesAtScaffold: ['a', 'b'], testsAtRed: 3, testHashes: {}, evidence: { knowledge: 'snapshot 2026-11-09T101010Z', verify: 'all four pass' } });
  const verify = paneModel(input({ record: old('verify') }));
  assert.equal(verify.header.state, `turn-counter ${DOT} checking the finished mod`);
  assert.equal(verify.status, `verify ${DOT} 0 of 4 checks passed`);
  const done = paneModel(input({ record: old('done') }));
  assert.equal(done.header.state, `turn-counter ${DOT} built and checked`);
  assert.deepEqual(texts(block(done, 'What was built')), [['  /work/turn-counter/'], ['  built on Claude Code 2.1.322, from the documents of 2026-11-09T101010Z']]);
  assert.deepEqual(texts(block(done, 'What was checked')), [['  all four pass']]);
});

// --------------------------------------------------------------------------------------------- beyond the frames

test('an edit has a rail of seven phases, a header that names it an edit with the version it had, and its baseline as a block', () => {
  const model = paneModel(editInput({ record: editing('knowledge') }));
  assert.deepEqual(model.header, { title: 'MOD BUILDER', state: `turn-counter ${DOT} edit of 0.1.0`, tone: 'dim' });
  assert.deepEqual(rail(model), ['current:1 Knowledge', ...SEVEN.slice(1).map((phase) => `later:${phase}`)]);
  assert.deepEqual(headings(model), ['Knowledge', 'Baseline the mod as it stood', '']);
  assert.deepEqual(block(model, 'Baseline the mod as it stood').heading, [{ text: 'Baseline' }, { text: 'the mod as it stood', tone: 'dim' }]);
  assert.deepEqual(texts(block(model, 'Baseline the mod as it stood')), [['  passes its four checks (2 tests)'], ['  version 0.1.0'], ['  restore point /home/u/r']]);
  const bare = paneModel(editInput({ record: editing('describe', { baseline: { ...BASELINE, version: null } }) }));
  assert.equal(bare.header.state, `turn-counter ${DOT} edit of a mod with no version`);
});

test('an edit\'s header says editing at Red and Green and keeps the edit\'s name at Verify, and its phases are numbered as an edit\'s', () => {
  const evidence = { baseline: STOOD, spec: 'the person answered "Approve"', red: 'a new test fails by assertion' };
  const red = paneModel(editInput({ record: editing('red', { evidence, specApprovedAt: Date.UTC(2026, 10, 11, 9, 5) }) }));
  assert.equal(red.header.state, `turn-counter ${DOT} edit of 0.1.0 ${DOT} approved 09:05 UTC ${DOT} editing`);
  assert.deepEqual(headings(red), ['Baseline the mod as it stood', '3 Spec passed', `4 Red working${DOTS}`]);
  const green = paneModel(editInput({ record: editing('green', { evidence }) }));
  assert.equal(green.header.state, `turn-counter ${DOT} edit of 0.1.0 ${DOT} editing`);
  assert.deepEqual(headings(green), ['Baseline the mod as it stood', '3 Spec passed', '4 Red passed', `5 Green working${DOTS}`]);
  assert.equal(green.status, 'green');
  const verify = paneModel(editInput({ record: editing('verify', { evidence }) }));
  assert.equal(verify.header.state, `turn-counter ${DOT} edit of 0.1.0 ${DOT} checking the finished mod`);
  assert.deepEqual(rail(verify).slice(4), [`done:5 Green ${TICK}`, 'current:6 Verify', 'later:7 Done']);
});

test('an edit at Spec shows the change\'s own section, cut where the mod\'s spec ended', () => {
  const spec = '# turn-counter\n\n## 0.1.1\n\nCuts each row by width.\n';
  const model = paneModel(editInput({ record: editing('spec'), spec }));
  assert.equal(model.header.state, `turn-counter ${DOT} edit of 0.1.0 ${DOT} SPEC.md written`);
  assert.deepEqual(headings(model), ['Baseline the mod as it stood', 'The change, as SPEC.md has it']);
  assert.equal(block(model, 'The change, as SPEC.md has it').markdown, '## 0.1.1\n\nCuts each row by width.');
  const none = paneModel(editInput({ record: editing('spec'), spec: '# turn-counter\n' }));
  assert.deepEqual(block(none, 'The change').rows, [[{ text: '  no section for this change yet, at the end of SPEC.md', tone: 'dim' }]]);
  const unwritten = paneModel(editInput({ record: editing('spec') }));
  assert.deepEqual(texts(block(unwritten, 'The change')), [['  SPEC.md is not written yet']]);
  const noSpecThen = paneModel(editInput({ record: editing('spec', { baseline: { ...BASELINE, spec: null } }), spec }));
  assert.equal(block(noSpecThen, 'The change, as SPEC.md has it').markdown, spec.trim());
});

test('a refused write in an edit is a write refused, and the table is the edit\'s', () => {
  const red = paneModel(editInput({ record: editing('red'), refusals: refusedAt('red') }));
  assert.deepEqual(red.header, { title: 'MOD BUILDER', state: `turn-counter ${DOT} edit of 0.1.0 ${DOT} 1 write refused ${DOT} phase Red`, tone: 'warning' });
  assert.equal(red.status, `red ${DOT} 1 write refused`);
  assert.deepEqual(texts(block(red, TABLE)), [
    ['  3 Spec', 'SPEC.md only, by adding to its end', 'closed'],
    ['  4 Red', 'test files only (tests/, and any *.test.ts or *.test.tsx)', 'now'],
    ['  5 Green', 'anything but test files and SPEC.md', 'opens when a new or changed test fails by assertion, the mod typechecks, and the person has agreed to every earlier test file that changed or is gone'],
    ['  6 Verify', 'anything but test files and hooks/', 'opens when validate, the tests, the typecheck and the headless load pass, and the version in plugin.json is greater than before the edit'],
    ...FOOT,
  ]);
  const two = paneModel(editInput({ record: editing('spec'), refusals: refusedAt('spec', 'a', refusedAt('spec')) }));
  assert.equal(two.status, `spec ${DOT} 2 writes refused ${DOT} waiting for your approval`);
  const done = paneModel(editInput({ record: editing('done'), refusals: refusedAt('spec') }));
  assert.deepEqual(texts(block(done, 'What was checked')).at(-1), ['  1 write refused along the way, at Spec']);
});

test('a repair\'s table says what ends its Red', () => {
  const repair = paneModel(editInput({ record: editing('red', { red: 'repair' }), refusals: refusedAt('red') }));
  assert.equal(texts(block(repair, TABLE))[2][2], 'opens when a test file exists, the test files typecheck, and the person has agreed to every earlier test file that changed or is gone');
});

test('a skipped Red is on the rail with its reason, and is no row of the table', () => {
  const fit = paneModel(editInput({ record: editing('green', { red: 'skipped', skipped: 'fit' }) }));
  assert.deepEqual(rail(fit).slice(2, 5), [`done:3 Spec ${TICK}`, 'skipped:4 Red skipped: the test files fit', 'current:5 Green']);
  assert.deepEqual(headings(fit), ['Baseline the mod as it stood', `5 Green working${DOTS}`]);
  const route = paneModel(editInput({ record: editing('spec', { red: 'skipped', skipped: 'no behaviour change' }), refusals: refusedAt('spec', 'hooks/a.ts') }));
  assert.equal(rail(route)[3], 'skipped:4 Red skipped: no behaviour change');
  assert.deepEqual(texts(block(route, TABLE)).slice(0, 3).map((row) => [row[0], row[2]]), [['  3 Spec', 'now'], ['  5 Green', 'opens when the person approves the change'], ['  6 Verify', 'opens when validate, the tests, the typecheck and the headless load pass, and the version in plugin.json is greater than before the edit']]);
  const verify = paneModel(editInput({ record: editing('verify', { red: 'skipped', skipped: 'fit' }) }));
  assert.deepEqual(texts(block(verify, 'Unchanged since their gates')), [[`  SPEC.md since approval ${DOT} the test files since the baseline`, 'compared by hash']]);
  const build = paneModel(input({ record: record('green', { red: 'skipped' }) }));
  assert.equal(rail(build)[4], `done:5 Red ${TICK}`);
});

test('a repair shows its failing baseline checks, in the tone of an error', () => {
  const failed = { ...BASELINE, failed: ['load', 'typecheck', 'bogus', 7] };
  const model = paneModel(editInput({ record: editing('describe', { red: 'repair', baseline: failed, evidence: { baseline: 'fails typecheck, load; version 0.1.0; restore point /home/u/r' } }) }));
  const baseline = model.blocks.find((one) => one.heading[0]?.text === 'Baseline');
  assert.deepEqual(baseline.heading, [{ text: 'Baseline' }, { text: 'fails typecheck, headless load: this edit is a repair', tone: 'error' }]);
  assert.deepEqual(texts(baseline), [['  fails typecheck, load'], ['  version 0.1.0'], ['  restore point /home/u/r']]);
});

test('8.4\'s answer is a row of Red\'s evidence: the answer and the files it covered', () => {
  const seen = '3 tests ran, a new or changed one failing by assertion; the typecheck passes (types sha256 ab); 2 test files hashed; the person answered "Go on with these changes" for: tests/pane.test.tsx (changed)';
  const model = paneModel(editInput({ record: editing('green', { evidence: { red: seen } }) }));
  assert.deepEqual(texts(block(model, '4 Red passed')).at(-1), ['  the person answered "Go on with these changes" for: tests/pane.test.tsx (changed)']);
  assert.equal(texts(block(model, '4 Red passed')).length, 4);
});

test('Done for an edit says what was changed, that it was edited and checked, and what it was checked on', () => {
  const model = paneModel(editInput({ record: editing('done', { finished: { version: '0.1.1', files: 8, tests: 7, command: 'turn-counter' } }) }));
  assert.deepEqual(model.header, { title: 'MOD BUILDER', state: `turn-counter 0.1.1 ${DOT} edited and checked`, tone: 'success' });
  assert.deepEqual(rail(model).slice(5), [`done:6 Verify ${TICK}`, 'current:7 Done']);
  assert.deepEqual(headings(model), ['What was changed', 'What was checked', 'Try it']);
  assert.deepEqual(texts(block(model, 'What was changed')), [['  /work/turn-counter/', `8 files ${DOT} 7 tests`], ['  checked on Claude Code 2.1.322, from the documents of 2026-11-10T194027Z']]);
  assert.equal(model.status, null);
});

test('a stopped record says so in the header, its rail is dim with no current phase, its evidence stops before the phase it stopped in, and the status line is cleared', () => {
  const evidence = { knowledge: 'snapshot 2026-11-10T194027Z', baseline: STOOD, spec: 'the person answered "Approve"', red: 'half done', green: 'never' };
  const model = paneModel(editInput({ record: editing('red', { stopped: true, evidence, attempt: { phase: 'red', reason: 'x', failing: [], passed: 1, tests: 2 } }), refusals: refusedAt('red') }));
  assert.deepEqual(model.header, { title: 'MOD BUILDER', state: `turn-counter ${DOT} edit of 0.1.0 ${DOT} stopped at Red`, tone: 'warning' });
  assert.equal(model.isRailDim, true);
  assert.deepEqual(rail(model), [`done:1 Knowledge ${TICK}`, `done:2 Describe ${TICK}`, `done:3 Spec ${TICK}`, 'later:4 Red', 'later:5 Green', 'later:6 Verify', 'later:7 Done']);
  assert.deepEqual(headings(model), ['Stopped', 'Baseline the mod as it stood', '3 Spec passed']);
  assert.equal(model.status, null);
  const build = paneModel(input({ record: record('green', { stopped: true }) }));
  assert.equal(build.header.state, `turn-counter ${DOT} stopped at Green`);
  assert.deepEqual(headings(build), ['Stopped']);
  const marked = paneModel(input({ record: record('green', { stopped: 'yes' }) }));
  assert.equal(marked.status, 'green');
});

test('a record that is missing, damaged or another session\'s is not this session\'s progress', () => {
  for (const other of [undefined, null, 'x', { ...record('green'), sessionId: 's2' }, { ...record('green'), modDir: '/work/other' }, record('green', { kind: 'other' }), editing('scaffold')]) {
    const model = paneModel(input({ record: other }));
    assert.deepEqual(model.header, { title: 'MOD BUILDER', state: `turn-counter ${DOT} its record is missing or another session's`, tone: 'warning' });
    assert.equal(model.status, null);
    assert.equal(model.isRailDim, true);
    assert.deepEqual(rail(model), EIGHT.map((phase) => `later:${phase}`));
    assert.deepEqual(headings(model), ['Knowledge']);
  }
  const edit = paneModel(editInput({ record: undefined }));
  assert.deepEqual(rail(edit), SEVEN.map((phase) => `later:${phase}`));
  const noSession = paneModel(input({ sessionId: undefined, record: record('green') }));
  assert.equal(noSession.header.state, `turn-counter ${DOT} its record is missing or another session's`);
});

test('the mod\'s name is its folder\'s own, whatever slashes end the path', () => {
  const dir = '/work/turn-counter/';
  const model = paneModel(input({ entry: { modDir: dir }, record: { ...record('green'), modDir: dir } }));
  assert.equal(model.header.state, `turn-counter ${DOT} building`);
});

test('nothing stored makes the pane throw: a damaged value draws as empty, in a build and in an edit, at every phase', () => {
  const odd = [...WEIRD, { baseline: 'x' }, { reason: 1, failing: 'abc', phase: 'green', passed: 1, tests: 2 }, { version: 3, files: 'x', tests: null, command: 5 }, { failed: 'x', version: {}, spec: 5 }, { failed: [1, null], version: 1, spec: null }, { spec: { length: 'x' }, failed: null }, { knowledge: 5, verify: {}, baseline: [], spec: null, scaffold: 9 }, { pages: 'x', changed: 1, added: 1, removed: 1 }, { pages: [null, 3, { page: 7 }, { page: 'a.md', how: 'x' }, { page: 'a.md', how: 'added', headings: 'x' }], changed: 1, added: 1, removed: 1 }];
  const fields = ['evidence', 'baseline', 'skipped', 'red', 'attempt', 'finished', 'specApprovedAt', 'stopped', 'spec', 'testHashes'];
  const facts = ['latest', 'checked', 'pages', 'changes', 'isRefreshing', 'version', 'now'];
  let drawn = 0;
  const draw = (given) => {
    const model = paneModel(given);
    assert.equal(typeof model.header.state, 'string');
    assert.equal(JSON.stringify(model).includes('undefined'), false, JSON.stringify(model));
    assert.equal(JSON.stringify(model).includes('[object'), false, JSON.stringify(model));
    assert.equal(JSON.stringify(model).includes('e+21'), false, JSON.stringify(model));
    drawn += 1;
  };
  for (const kind of ['build', 'edit']) {
    for (const phase of kind === 'edit' ? ['knowledge', 'describe', 'spec', 'red', 'green', 'verify', 'done'] : ['knowledge', 'describe', 'spec', 'scaffold', 'red', 'green', 'verify', 'done']) {
      const made = (more) => (kind === 'edit' ? editing(phase, more) : record(phase, more));
      const entry = { modDir: MOD, kind };
      for (const value of odd) {
        for (const field of fields) draw(input({ entry, record: made({ [field]: value }), spec: 'abc', checks: newChecks('s1', phase, 'n') }));
        for (const fact of facts) draw(input({ entry, record: made(), knowledge: knowledge({ [fact]: value }) }));
        draw(input({ entry, record: made(), refusals: value }));
        draw(input({ entry, record: made(), refusals: { sessionId: 's1', counts: { [phase]: 1 }, last: value, toasted: value } }));
        draw(input({ entry, record: made(), checks: value }));
        draw(input({ entry, record: made(), checks: { sessionId: 's1', phase, name: value, states: value } }));
        draw(input({ entry, record: made(), spec: value }));
        draw(input({ entry, record: made(), knowledge: value }));
      }
    }
  }
  for (const value of odd) {
    for (const part of ['sessionId', 'entry', 'record', 'knowledge']) draw(input({ [part]: value }));
    draw(value);
  }
  assert.equal(drawn > 5000, true);
});

// ------------------------------------------------------------------- what an independent reader found untested

const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/;
const cells = (model) => [model.header.state, model.status ?? '', ...model.blocks.flatMap((one) => [...one.heading, ...one.rows.flat()]), ...model.rail].map((cell) => (typeof cell === 'string' ? cell : cell.text));

test('text is shown without any control character, a run of them as one space, and without the marks that reorder or hide it', () => {
  assert.equal(countRefusal(undefined, 's1', 'spec', 'a\u009bb\u001fc\r\nd\u007fe').toast, 'refused: a b c d e, at Spec');
  assert.equal(countRefusal(undefined, 's1', 'spec', 'tests/\u202egpj.exe\u200b').toast, 'refused: tests/ gpj.exe, at Spec');
  assert.equal(countRefusal(undefined, 's1', 'spec', '\u2066a\u2069b\u200f').toast, 'refused: a b, at Spec');
});

test('a long refused path is cut to 120 characters with its end kept', () => {
  const long = `${'d/'.repeat(100)}hooks/register.tsx`;
  const cut = countRefusal(undefined, 's1', 'spec', long);
  assert.equal(cut.refusals.last.path.length, 120);
  assert.equal(cut.refusals.last.path, `\u2026${long.slice(long.length - 119)}`);
  assert.equal(cut.toast, `refused: \u2026${long.slice(long.length - 119)}, at Spec`);
  const fits = 'a'.repeat(120);
  assert.equal(countRefusal(undefined, 's1', 'spec', fits).refusals.last.path, fits);
});

test('a refused write with no path is remembered as the mod folder, and the table is drawn for it', () => {
  const refusals = countRefusal(undefined, 's1', 'spec', '').refusals;
  assert.equal(refusals.last.path, 'the mod folder');
  assert.equal(titleOf(paneModel(input({ record: record('spec'), spec: 'x', refusals })).blocks[0]), TABLE);
});

test('a phase that is none has no attempt and no checks, and refusals asked for no session are none', () => {
  assert.equal(readAttempt({ phase: 'nowhere' }, 'nowhere'), null);
  assert.equal(readChecks({ sessionId: 's1', phase: 'nowhere', states: {} }, 's1', 'nowhere'), null);
  assert.deepEqual(readRefusals({ counts: { spec: 1 } }, undefined).counts, {});
});

test('days are whole days rounded down, and an hour ahead of the clock is ahead', () => {
  const said = (checked) => texts(block(paneModel(input({ record: record('knowledge'), knowledge: knowledge({ checked }) })), 'Knowledge'))[0][1];
  assert.equal(said('2026-11-11T210000Z'), 'last fetched today');
  assert.equal(said('2026-11-10T230000Z'), 'last fetched 1 day ago');
  assert.equal(said('2026-11-12T210000Z'), 'last fetched 2026-11-12T210000Z, ahead of this clock');
});

test('one changed page, and a snapshot that only added or only removed pages, are in the tone of a warning', () => {
  const tone = (changes) => tones(block(paneModel(input({ record: record('knowledge'), knowledge: knowledge({ changes }) })), 'Knowledge'))[1][1];
  assert.equal(tone({ changed: 1, added: 0, removed: 0, pages: [] }), 'warning');
  assert.equal(tone({ changed: 0, added: 2, removed: 0, pages: [] }), 'warning');
  assert.equal(tone({ changed: 0, added: 0, removed: 3, pages: [] }), 'warning');
});

test('changed, added and removed are each said in their place, and a page name with a hyphen is read', () => {
  const changes = changesIn('# Changes in b since a\n\nPages: 3 changed, 2 added, 1 removed.\n\n## plugin-reference.md: changed, +1 -1\n\n- ## Hooks\n');
  assert.deepEqual(changes, { changed: 3, added: 2, removed: 1, pages: [{ page: 'plugin-reference.md', how: 'changed', plus: 1, minus: 1, headings: ['Hooks'] }] });
  assert.deepEqual(texts(block(paneModel(input({ record: record('knowledge'), knowledge: knowledge({ changes }) })), 'Knowledge'))[1], ['  10 pages in snapshot 2026-11-10T194027Z', '3 changed, 2 added, 1 removed']);
  assert.equal(pagesIn('page\turl\nplugin-reference.md\tx\n'), 1);
  assert.equal(pagesIn('pages\nadmin.md\tx\n'), null);
});

test('a line that only looks like the totals or like a page\'s line is neither', () => {
  assert.equal(changesIn('Pages: 1 changed, 0 added, 0 removed. And more\n'), null);
  const odd = 'Pages: 1 changed, 0 added, 0 removed.\n\n ## api.md: changed, +1 -1\n## events.md: changed, +1 -1 and more\n## Upper.md: changed, +1 -1\n- ## under no page\n';
  assert.deepEqual(changesIn(odd), { changed: 1, added: 0, removed: 0, pages: [] });
});

test('changes the pane is given that are damaged are read as far as they can be', () => {
  const rowsOf = (changes) => texts(block(paneModel(input({ record: record('knowledge'), knowledge: knowledge({ changes }) })), 'Knowledge'));
  for (const part of ['changed', 'added', 'removed']) assert.equal(rowsOf({ changed: 1, added: 1, removed: 1, pages: [], [part]: 'x' })[1][1], 'the first snapshot, or nothing to compare with', part);
  assert.equal(rowsOf({ changed: 1, added: 0, removed: 0, pages: 3 }).length, 3);
  assert.deepEqual(rowsOf({ changed: 2, added: 0, removed: 0, pages: [{ page: 7, how: 'changed' }, { page: 'a.md', how: 'x' }, { page: 'b.md', how: 'added', headings: [' ', 'h'] }] }).slice(2, -1), [['  added', 'b.md', `+0 -0 lines ${DOT} h`]]);
});

test('what the cache is said to hold is read strictly: no version is this build, a fetch runs only when that is true, and no snapshot is said whatever the page count', () => {
  const rowsOf = (more) => texts(block(paneModel(input({ record: record('knowledge'), knowledge: knowledge(more) })), 'Knowledge'));
  assert.deepEqual(rowsOf({ version: '' }).at(-1), ['API types for this build', `this build ${DOT} read from the installed copy at each typecheck`]);
  assert.equal(rowsOf({ isRefreshing: 'yes' })[0][1], 'last fetched 2 days ago');
  assert.deepEqual(rowsOf({ latest: null, pages: 10 })[1], ['  no snapshot yet: /mod-builder refresh fetches one']);
});

test('no cell, header or status line holds a control character, whatever the folder, the name, the evidence or a path holds', () => {
  const dir = '/a/b\u001b[2Jc\nd';
  for (const phase of ['knowledge', 'spec', 'red', 'green', 'verify', 'done']) {
    const made = { ...newRecord(dir, 's1'), phase, evidence: { scaffold: 'a\nb', verify: 'v\nw', knowledge: 'snapshot 2026\n' }, finished: { version: '1\n', builtOn: 'a\nb' }, attempt: { phase, reason: 'r\ns', failing: ['f\ng'] } };
    const model = paneModel({ sessionId: 's1', entry: { modDir: dir }, record: made, knowledge: knowledge(), spec: 'x', checks: withCheck(newChecks('s1', phase, 'n\nm'), 'validate', 'passed'), refusals: countRefusal(undefined, 's1', phase, 'p\nq').refusals });
    assert.deepEqual(cells(model).filter((text) => CONTROL.test(text)), [], phase);
    assert.equal(model.header.state.startsWith("b [2Jc d "), true, phase);
  }
  const verify = paneModel({ sessionId: 's1', entry: { modDir: dir }, record: { ...newRecord(dir, 's1'), phase: 'verify' }, knowledge: knowledge(), spec: null });
  assert.deepEqual(texts(block(verify, 'Each check is a command mod-builder ran itself')).map((row) => row[2]), ['claude plugin validate --strict /a/b [2Jc d', 'claude plugin test /a/b [2Jc d', 'tsc against the 2.1.322 types', 'claude --plugin-dir /a/b [2Jc d -p /cost']);
});

test('a folder given with a slash at its end is shown with one, in the table\'s heading, at Done and in each command', () => {
  const dir = '/work/turn-counter/';
  const at = (phase, more = {}) => paneModel(input({ entry: { modDir: dir }, record: { ...record(phase), modDir: dir }, ...more }));
  assert.equal(titleOf(at('spec', { refusals: refusedAt('spec') }).blocks[0]), TABLE);
  const done = at('done');
  assert.deepEqual(texts(block(done, 'What was built'))[0], ['  /work/turn-counter/']);
  assert.deepEqual(texts(block(done, 'Try it')), [['  claude --plugin-dir /work/turn-counter']]);
  assert.equal(texts(block(at('verify'), 'Each check is a command mod-builder ran itself'))[1][2], 'claude plugin test /work/turn-counter');
});

test('a baseline is drawn for an edit that recorded one, and for no build; its parts are split as a gate\'s evidence is', () => {
  const build = paneModel(input({ record: record('green', { evidence: { baseline: 'x' } }) }));
  assert.deepEqual(headings(build), [`6 Green working${DOTS}`]);
  const edit = paneModel(editInput({ record: editing('green', { evidence: {} }) }));
  assert.deepEqual(headings(edit), [`5 Green working${DOTS}`]);
  const parts = paneModel(editInput({ record: editing('green', { evidence: { baseline: 'a; ; b;c; ' } }) }));
  assert.deepEqual(texts(block(parts, 'Baseline the mod as it stood')), [['  a'], ['  b;c']]);
});

test('a gate\'s evidence is split at "; ": an empty part is no row, and a ";" with no space is no split', () => {
  const model = paneModel(input({ record: record('red', { evidence: { scaffold: 'a; ; b;c; ' } }) }));
  assert.deepEqual(texts(block(model, '4 Scaffold passed')), [['  a'], ['  b;c']]);
});

test('an edit that did not skip Red compares the test files since Red', () => {
  const verify = paneModel(editInput({ record: editing('verify') }));
  assert.deepEqual(texts(block(verify, 'Unchanged since their gates')), [[`  SPEC.md since approval ${DOT} the test files since Red`, 'compared by hash']]);
});

test('Done: evidence that names no snapshot falls back to the cache\'s, and what the gate saw is one line', () => {
  const done = paneModel(input({ record: record('done', { evidence: { knowledge: 'no gate', verify: 'v\nw' } }) }));
  assert.equal(texts(block(done, 'What was built'))[1][0], '  built on Claude Code 2.1.322, from the documents of 2026-11-10T194027Z');
  assert.deepEqual(texts(block(done, 'What was checked')), [['  v w']]);
});

test('checks stored at Red draw no rows: only Green and Verify run the four', () => {
  const red = paneModel(input({ record: record('red'), checks: moved('red', { validate: 'passed' }) }));
  assert.deepEqual(headings(red), [`5 Red working${DOTS}`]);
});

test('the record says what is drawn, a build or an edit, when the session\'s entry does not', () => {
  const model = paneModel(input({ entry: { modDir: MOD }, record: editing('green') }));
  assert.deepEqual(rail(model).slice(3), ['done:4 Red \u2713', 'current:5 Green', 'later:6 Verify', 'later:7 Done']);
  assert.equal(model.header.state, `turn-counter ${DOT} edit of 0.1.0 ${DOT} editing`);
});

test('Verify: a refused write beside a failed check keeps both in the header, in the tone of an error', () => {
  const model = paneModel(input({ record: record('verify'), refusals: refusedAt('verify'), checks: moved('verify', { test: 'failed' }) }));
  assert.deepEqual(model.header, { title: 'MOD BUILDER', state: `turn-counter ${DOT} 1 edit refused ${DOT} phase Verify ${DOT} test did not pass`, tone: 'error' });
  assert.equal(model.status, `verify ${DOT} 0 of 4 checks passed ${DOT} test did not pass ${DOT} 1 edit refused`);
});

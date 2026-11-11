// Logic tests for the question of an edit whose Red was skipped (SPEC.md 8.23): with no new test, Green's gate
// asks the person, with the list of what changed. What the list holds and leaves out, the question's words, the
// one answer that passes, and what the evidence says of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as rules from '../hooks/mod-builder-logic.ts';

// Taken from the module as a whole, so that a rule not built yet fails the tests that use it and no others.
const { registersOf, isEngineWritten, isEngineTsconfig, agreedHashes, untestedChanges, untestedQuestion, untestedGate, untestedEvidence, testChangeOptions, LISTED_FILES } = rules;

const H = (letter) => letter.repeat(64);
const ENGINE = '{\n  "extends": "./.claude-plugin/types/tsconfig.json"\n}\n';
// As `claude plugin validate --strict` printed it for a built mod (2.1.322): each line opens with the engine's mark.
const MARK = String.fromCharCode(0x276f);
const VALIDATED = [
  'Validating hooks: /work/m/hooks/hooks.json', '',
  `  ${MARK} ./register.tsx hooks: session.start, command.run{command=hi-probe}, ui.render{component=Pane, requestId=hi-probe}`,
  `  ${MARK} ./register.tsx answers its own command: command.run{command=hi-probe}`,
  `  ${MARK} ./register.tsx calls: $.command.register, $.ui.open, $.ui.resolve`, '',
  `  ${MARK} README.md: README missing (README_MISSING). This plugin has no README.md.`,
  `${String.fromCharCode(0x2714)} Validation passed`, '',
].join('\n');
const REGISTERS = [
  './register.tsx hooks: session.start, command.run{command=hi-probe}, ui.render{component=Pane, requestId=hi-probe}',
  './register.tsx answers its own command: command.run{command=hi-probe}',
  './register.tsx calls: $.command.register, $.ui.open, $.ui.resolve',
];
const BASE = { 'SPEC.md': H('a'), '.claude-plugin/plugin.json': H('b'), 'hooks/register.tsx': H('c'), 'tests/pane.test.tsx': H('d'), 'lib/util.ts': H('e') };
const ask = (more = {}) => ({ files: [], tests: 3, restore: '/home/u/r', registersBefore: REGISTERS, registersNow: REGISTERS, isAgain: false, ...more });

test('what validate said a module hooks, answers and calls is read from its own lines, in order, and from nothing else', () => {
  assert.deepEqual(registersOf(VALIDATED), REGISTERS);
  assert.deepEqual(registersOf(VALIDATED.replaceAll('\n', '\r\n')), REGISTERS);
  assert.deepEqual(registersOf('  > ./a.ts hooks: tool.call\n  > ./b.ts hooks: session.start\n  > ./a.ts calls: $.fs.read\n'), ['./a.ts hooks: tool.call', './b.ts hooks: session.start', './a.ts calls: $.fs.read']);
  assert.deepEqual(registersOf('hooks: none\n  > ./a.ts hooks:\n  > ./a.ts hooks: \n  > two words here hooks: x\n  > README.md: README missing\n  > a.ts hooks: x\n'), []);
  // As validate prints a larger module: the functions a call is made through are left out, so that moving a call
  // between functions is no difference; what it reads and writes of the environment is kept.
  const larger = '  > ./register.tsx calls: $.clock.now (via check, stop), $.command.register, $.fs.read (via readText)\n  > ./register.tsx gating hook with .catch: tool.call\n  > ./register.tsx env writes: nothing\n  > ./register.tsx env reads: CLAUDE_TMPDIR, HOME  \n';
  assert.deepEqual(registersOf(larger), ['./register.tsx calls: $.clock.now, $.command.register, $.fs.read', './register.tsx gating hook with .catch: tool.call', './register.tsx env writes: nothing', './register.tsx env reads: CLAUDE_TMPDIR, HOME']);
  assert.deepEqual(registersOf(larger.replace('(via check, stop)', '(via gate)')), registersOf(larger));
  for (const none of [null, undefined, '', 7, {}]) assert.deepEqual(registersOf(none), []);
});

test('what the engine writes into a mod it loads is the folder of its types, and a tsconfig.json that only extends them', () => {
  for (const path of ['.claude-plugin/types/tsconfig.json', '.claude-plugin/types/claude-code/index.d.ts', '.claude-plugin/types/claude-code-mcp/index.d.ts', './.claude-plugin//types/.gitignore']) assert.equal(isEngineWritten(path), true, path);
  // Only what the engine is known to write: code put beside its files is the mod's own, and is listed.
  for (const path of ['.claude-plugin/types', '.claude-plugin/types/x.ts', '.claude-plugin/types/claude-code/index.ts', '.claude-plugin/types/claude-code/more.d.ts', '.claude-plugin/types/a/b/index.d.ts', '.claude-plugin/types/index.d.ts', '.claude-plugin/plugin.json', '.claude-plugin/typesafe.ts', 'types/index.d.ts', 'lib/.claude-plugin/types/tsconfig.json', 'tsconfig.json', '', null, 7]) assert.equal(isEngineWritten(path), false, String(path));
  assert.equal(isEngineTsconfig(ENGINE), true);
  assert.equal(isEngineTsconfig('{"extends":"./.claude-plugin/types/tsconfig.json"}'), true);
  for (const other of ['{ "extends": "./.claude-plugin/types/tsconfig.json", "include": ["hooks"] }', '{ "extends": "./other.json" }', '{}', '[]', 'null', 'not json', '', null, undefined, 7]) assert.equal(isEngineTsconfig(other), false, String(other));
});

test('an answer covers every file of the mod but SPEC.md, the test files and what the engine wrote', () => {
  const now = { ...BASE, 'lib/a.test.ts': H('f'), '.claude-plugin/types/claude-code/index.d.ts': H('1'), '.claude-plugin/types/helper.ts': H('3'), 'tsconfig.json': H('2') };
  const covered = { '.claude-plugin/plugin.json': H('b'), '.claude-plugin/types/helper.ts': H('3'), 'hooks/register.tsx': H('c'), 'lib/util.ts': H('e') };
  assert.deepEqual(agreedHashes(now, ENGINE, BASE), covered);
  // A tsconfig.json the mod already had, or one that holds more than the engine's line, is the mod's own.
  assert.deepEqual(agreedHashes(now, '{ "compilerOptions": {} }', BASE), { ...covered, 'tsconfig.json': H('2') });
  assert.deepEqual(agreedHashes(now, ENGINE, { ...BASE, 'tsconfig.json': H('9') }), { ...covered, 'tsconfig.json': H('2') });
  assert.deepEqual(agreedHashes(now, null, BASE), { ...covered, 'tsconfig.json': H('2') });
  assert.deepEqual(agreedHashes(now, ENGINE), covered);
  for (const none of [null, undefined, 'x', 7, []]) assert.deepEqual(agreedHashes(none, ENGINE, BASE), {});
});

test('the files asked about are those changed, added or gone since the baseline, sorted, with SPEC.md, test files and engine-written files left out', () => {
  const now = {
    'SPEC.md': H('z'), '.claude-plugin/plugin.json': H('x'), 'hooks/register.tsx': H('c'), 'tests/pane.test.tsx': H('y'), 'tests/new.test.ts': H('n'),
    'hooks/more.ts': H('m'), '.claude-plugin/types/tsconfig.json': H('1'), 'tsconfig.json': H('2'),
  };
  assert.deepEqual(untestedChanges(BASE, now, ENGINE), [
    { path: '.claude-plugin/plugin.json', how: 'changed' }, { path: 'hooks/more.ts', how: 'added' }, { path: 'lib/util.ts', how: 'missing' },
  ]);
  assert.deepEqual(untestedChanges(BASE, now, '{ "include": ["hooks"] }').map((file) => file.path), ['.claude-plugin/plugin.json', 'hooks/more.ts', 'lib/util.ts', 'tsconfig.json']);
  assert.deepEqual(untestedChanges(BASE, BASE, null), []);
  for (const none of [null, undefined, 'x', []]) {
    assert.deepEqual(untestedChanges(none, now, null), []);
    assert.deepEqual(untestedChanges(BASE, none, null), []);
  }
});

test('at Verify the files asked about again are those not as the person agreed at Green, the engine\'s tsconfig.json still left out by the baseline', () => {
  const agreed = { '.claude-plugin/plugin.json': H('x'), 'hooks/register.tsx': H('c') };
  const now = { 'SPEC.md': H('q'), '.claude-plugin/plugin.json': H('x'), 'hooks/register.tsx': H('w'), 'README.md': H('r'), 'tests/pane.test.tsx': H('d'), 'tsconfig.json': H('2') };
  assert.deepEqual(untestedChanges(agreed, now, ENGINE, BASE), [{ path: 'README.md', how: 'added' }, { path: 'hooks/register.tsx', how: 'changed' }]);
  assert.deepEqual(untestedChanges(agreed, { ...agreed, 'SPEC.md': H('q'), 'tests/pane.test.tsx': H('d') }, null, BASE), []);
  assert.deepEqual(untestedChanges(agreed, now, ENGINE, { ...BASE, 'tsconfig.json': H('9') }).map((file) => file.path), ['README.md', 'hooks/register.tsx', 'tsconfig.json']);
});

test('the question lists each file with its lines against the copy before the edit, says how many tests are the only check, and names the restore point', () => {
  const files = [
    { path: 'hooks/register.tsx', how: 'changed', before: 'a\nb\nc\n', after: 'a\nB\nc\nd\n' },
    { path: 'hooks/more.ts', how: 'added', before: null, after: 'one\ntwo\n' },
    { path: 'lib/util.ts', how: 'missing', before: 'gone\n', after: null },
    { path: 'assets/icon.png', how: 'changed', before: null, after: null },
  ];
  assert.equal(untestedQuestion(ask({ files })), [
    'Red was skipped for this edit, so no new test covers what it changed.',
    'These files are not as they were before this edit:',
    "- assets/icon.png: changed (its lines can't be compared)",
    '- hooks/more.ts: added (2 lines)',
    '- hooks/register.tsx: 2 lines added, 1 line removed',
    '- lib/util.ts: gone (1 line removed)',
    'The 3 tests the mod had before this edit are held unchanged and pass: they are the only check of behaviour.',
    'The mod as it was before this edit is kept in /home/u/r.',
    'Go on with these changes?',
  ].join('\n'));
});

test('the question says one test as one, tests with no count plainly, and when no file is changed', () => {
  const lines = (more) => untestedQuestion(ask(more)).split('\n');
  assert.equal(lines({ tests: 1 })[2], 'The 1 test the mod had before this edit is held unchanged and passes: it is the only check of behaviour.');
  assert.equal(lines({ tests: 0 })[2], 'The 0 tests the mod had before this edit are held unchanged and pass: they are the only check of behaviour.');
  assert.equal(lines({ tests: null })[2], 'The tests the mod had before this edit are held unchanged and pass: they are the only check of behaviour.');
  assert.equal(lines({})[1], 'No file but SPEC.md is changed.');
  assert.equal(lines({ isAgain: true })[1], 'No file is changed since you agreed at Green.');
  assert.equal(lines({ isAgain: true, files: [{ path: 'a.ts', how: 'added', before: null, after: 'x\n' }] })[1], 'These files are not as they were when you agreed at Green (lines are counted against the mod before this edit):');
  assert.equal(lines({ files: [{ path: 'a.ts', how: 'added', before: null, after: null }, { path: 'b.ts', how: 'missing', before: null, after: null }] }).slice(2, 4).join('|'), '- a.ts: added|- b.ts: gone');
});

test('the question names at most 20 files, then how many more', () => {
  const many = Array.from({ length: LISTED_FILES + 3 }, (_, index) => ({ path: `lib/f${String(index).padStart(2, '0')}.ts`, how: 'added', before: null, after: 'x\n' }));
  const lines = untestedQuestion(ask({ files: many })).split('\n');
  assert.equal(LISTED_FILES, 20);
  assert.equal(lines.filter((line) => line.startsWith('- ')).length, 20);
  assert.equal(lines[21], '- lib/f19.ts: added (1 line)');
  assert.equal(lines[22], 'and 3 more files');
  assert.equal(untestedQuestion(ask({ files: many.slice(0, 21) })).split('\n')[22], 'and 1 more file');
  assert.equal(untestedQuestion(ask({ files: many.slice(0, 20) })).includes(' more file'), false);
});

test('what the mod hooks, answers and calls is said only where it differs, and only when the baseline kept it', () => {
  const now = [REGISTERS[0], './register.tsx calls: $.command.register, $.fs.write, $.ui.open, $.ui.resolve'];
  const lines = untestedQuestion(ask({ registersNow: now })).split('\n');
  // The line that is the same is not shown; the command the mod no longer answers is a line gone as a whole;
  // on the line of calls only the call that was added is named.
  assert.deepEqual(lines.slice(2, 5), [
    'What the mod hooks, answers and calls is not as before this edit:',
    '    ./register.tsx answers its own command: gone, it was command.run{command=hi-probe}',
    '    ./register.tsx calls: added $.fs.write',
  ]);
  assert.equal(lines[5], 'The 3 tests the mod had before this edit are held unchanged and pass: they are the only check of behaviour.');
  const said = (more) => untestedQuestion(ask(more)).includes('What the mod hooks');
  assert.equal(said({}), false);
  assert.equal(said({ registersBefore: null, registersNow: now }), false);
  assert.equal(said({ registersBefore: undefined, registersNow: now }), false);
  // The same lines in another order are no difference.
  assert.equal(said({ registersNow: [...REGISTERS].reverse() }), false);
  assert.deepEqual(untestedQuestion(ask({ registersBefore: [], registersNow: [REGISTERS[2]] })).split('\n')[3], '    ./register.tsx calls: new, $.command.register, $.ui.open, $.ui.resolve');
  assert.equal(said({ registersNow: [] }), true);
});

test('a question built from damaged values still asks, and never throws', () => {
  for (const damaged of [null, undefined, 'x', 7, {}, { files: 'x', tests: -1, restore: 7, registersBefore: 'x', registersNow: 7 }, { files: [null, 7, { path: 7 }, { path: 'a.ts', how: 'bogus' }] }]) {
    const text = untestedQuestion(damaged);
    assert.equal(text.startsWith('Red was skipped for this edit'), true);
    assert.equal(text.endsWith('Go on with these changes?'), true);
    assert.equal(text.includes('undefined') || text.includes('[object'), false, text);
  }
});

test('only the person\'s own approving answer passes, and "Not yet" is the first option', () => {
  assert.deepEqual(testChangeOptions(), ['Not yet', 'Go on with these changes']);
  assert.deepEqual(untestedGate('Go on with these changes'), { pass: true });
  for (const answer of ['Not yet', 'Approve', 'go on with these changes', 'Go on with these changes ', '', 'yes']) {
    assert.deepEqual(untestedGate(answer), { pass: false, reason: `the person has not agreed to the changes made with Red skipped (answer: ${JSON.stringify(answer)})` });
  }
  for (const none of [null, undefined]) assert.deepEqual(untestedGate(none), { pass: false, reason: 'the person has not agreed to the changes made with Red skipped (answer: none)' });
});

test('the evidence says the answer and the files it covered, at most 20 by name', () => {
  const files = [{ path: 'hooks/register.tsx', how: 'changed' }, { path: 'hooks/more.ts', how: 'added' }, { path: 'lib/util.ts', how: 'missing' }];
  assert.equal(untestedEvidence(files, 'Go on with these changes'), 'the person answered "Go on with these changes" for what changed with Red skipped: hooks/register.tsx (changed), hooks/more.ts (added), lib/util.ts (gone)');
  assert.equal(untestedEvidence([], 'Go on with these changes'), 'the person answered "Go on with these changes" for what changed with Red skipped: no file');
  const many = Array.from({ length: 22 }, (_, index) => ({ path: `f${index}.ts`, how: 'added' }));
  assert.equal(untestedEvidence(many, 'x').endsWith('f19.ts (added) and 2 more'), true);
  assert.equal(untestedEvidence(files, 'x').includes('; '), false);
  for (const none of [null, undefined, 'x']) assert.equal(untestedEvidence(none, 'x'), 'the person answered "x" for what changed with Red skipped: no file');
});

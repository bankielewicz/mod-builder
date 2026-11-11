// Logic tests for how the question of a skipped Red says what the mod hooks, answers and calls (SPEC.md 8.26):
// only the lines that differ, and on a line of names only what was added and what is gone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as rules from '../hooks/mod-builder-logic.ts';

// Taken from the module as a whole, so that a rule not built yet fails the tests that use it and no others.
const { registerChanges, untestedQuestion } = rules;

const HOOKS = './register.tsx hooks: session.start, command.run{command=hi}, ui.render{component=Pane, requestId=hi}';
const ANSWERS = './register.tsx answers its own command: command.run{command=hi}';
const CALLS = './register.tsx calls: $.command.register, $.ui.open, $.ui.resolve';
const ENV = './register.tsx env reads: HOME';
const BEFORE = [HOOKS, ANSWERS, CALLS, ENV];

test('lines that say the same are no difference, in any order of lines or of names', () => {
  assert.deepEqual(registerChanges(BEFORE, BEFORE), []);
  assert.deepEqual(registerChanges(BEFORE, [...BEFORE].reverse()), []);
  assert.deepEqual(registerChanges(BEFORE, [HOOKS, ANSWERS, './register.tsx calls: $.ui.resolve, $.ui.open, $.command.register', ENV]), []);
  assert.deepEqual(registerChanges([], []), []);
});

test('on a line of names only what was added and what is gone is said', () => {
  const now = [HOOKS, ANSWERS, './register.tsx calls: $.command.register, $.ui.open, $.ui.resolve, $.ui.toast', ENV];
  assert.deepEqual(registerChanges(BEFORE, now), ['./register.tsx calls: added $.ui.toast']);
  assert.deepEqual(registerChanges(now, BEFORE), ['./register.tsx calls: gone $.ui.toast']);
  assert.deepEqual(registerChanges(BEFORE, [HOOKS, ANSWERS, './register.tsx calls: $.fs.write, $.ui.open, $.process.run', './register.tsx env reads: HOME, PATH']), [
    './register.tsx calls: added $.fs.write, $.process.run; gone $.command.register, $.ui.resolve',
    './register.tsx env reads: added PATH',
  ]);
});

test('a hook\'s matcher holds commas of its own: it is one name, and a changed matcher is one gone and one added', () => {
  const now = ['./register.tsx hooks: session.start, command.run{command=hi}, ui.render{component=Pane, requestId=other}, tool.call{tool=Bash}', ANSWERS, CALLS, ENV];
  assert.deepEqual(registerChanges(BEFORE, now), ['./register.tsx hooks: added ui.render{component=Pane, requestId=other}, tool.call{tool=Bash}; gone ui.render{component=Pane, requestId=hi}']);
});

test('a line that is new, or gone, as a whole is said so, and each module\'s lines are its own', () => {
  assert.deepEqual(registerChanges([HOOKS, CALLS], [HOOKS, CALLS, './register.tsx env writes: PATH']), ['./register.tsx env writes: new, PATH']);
  assert.deepEqual(registerChanges(BEFORE, [HOOKS, CALLS, ENV]), ['./register.tsx answers its own command: gone, it was command.run{command=hi}']);
  assert.deepEqual(registerChanges([CALLS], [CALLS, './other.ts calls: $.fs.read']), ['./other.ts calls: new, $.fs.read']);
  assert.deepEqual(registerChanges(['./a.ts calls: $.fs.read', './b.ts calls: $.fs.read'], ['./a.ts calls: $.fs.read', './b.ts calls: $.fs.write']), ['./b.ts calls: added $.fs.write; gone $.fs.read']);
});

test('lines of the same module and kind are read as one list', () => {
  const twice = ['./register.tsx gating hook with .catch: tool.call{tool=x}', './register.tsx gating hook with .catch: tool.call'];
  assert.deepEqual(registerChanges(twice, twice), []);
  assert.deepEqual(registerChanges(twice, [twice[0]]), ['./register.tsx gating hook with .catch: gone tool.call']);
});

test('what is no list of lines is read as none, and a line of no such shape is passed over', () => {
  for (const none of [null, undefined, 'x', 7, {}]) {
    assert.deepEqual(registerChanges(none, none), []);
    assert.deepEqual(registerChanges(none, [CALLS]), ['./register.tsx calls: new, $.command.register, $.ui.open, $.ui.resolve']);
  }
  assert.deepEqual(registerChanges([CALLS, 7, null, 'no shape here', './x.ts calls:'], [CALLS]), []);
});

test('asked again at Verify, the question says what differs from what was agreed at Green, under words that say so', () => {
  const agreed = [HOOKS, ANSWERS, './register.tsx calls: $.command.register, $.ui.open, $.ui.resolve, $.ui.toast', ENV];
  const ask = (more) => untestedQuestion({ files: [], tests: 2, restore: '/r', registersBefore: agreed, registersNow: agreed, isAgain: true, isSinceGreen: true, ...more }).split('\n');
  // A difference from the baseline that was agreed to at Green is not shown again.
  assert.equal(ask({}).some((line) => line.includes('What the mod hooks')), false);
  const more = [HOOKS, ANSWERS, './register.tsx calls: $.command.register, $.fs.write, $.ui.open, $.ui.resolve, $.ui.toast', ENV];
  assert.deepEqual(ask({ registersNow: more }).slice(2, 4), ['What the mod hooks, answers and calls is not as when you agreed at Green:', '    ./register.tsx calls: added $.fs.write']);
});

test('asked again on a record that kept nothing of what was agreed, the comparison is with before the edit, and says so', () => {
  const lines = untestedQuestion({ files: [], tests: 2, restore: '/r', registersBefore: BEFORE, registersNow: [HOOKS, ANSWERS, CALLS], isAgain: true, isSinceGreen: false }).split('\n');
  assert.deepEqual(lines.slice(2, 4), ['What the mod hooks, answers and calls is not as before this edit:', '    ./register.tsx env reads: gone, it was HOME']);
});

test('a name is counted as often as it is there: a hook registered a second time is one more hook, and one taken away is one gone', () => {
  const once = ['./register.tsx hooks: tool.call{tool=Bash}', './register.tsx gating hook with .catch: tool.call{tool=Bash}'];
  const twice = ['./register.tsx hooks: tool.call{tool=Bash}, tool.call{tool=Bash}', './register.tsx gating hook with .catch: tool.call{tool=Bash}', './register.tsx gating hook with .catch: tool.call{tool=Bash}'];
  assert.deepEqual(registerChanges(once, twice), ['./register.tsx hooks: added tool.call{tool=Bash}', './register.tsx gating hook with .catch: added tool.call{tool=Bash}']);
  assert.deepEqual(registerChanges(twice, once), ['./register.tsx hooks: gone tool.call{tool=Bash}', './register.tsx gating hook with .catch: gone tool.call{tool=Bash}']);
  assert.deepEqual(registerChanges(twice, twice), []);
});

test('a quoted value may hold braces and commas: the hook stays one name, and values swapped between two hooks are a difference', () => {
  const a = './register.tsx hooks: tool.call{tool=Bash, foo="{a"}, tool.call{tool=Edit, foo="x, {b"}';
  const b = './register.tsx hooks: tool.call{tool=Bash, foo="x, {b"}, tool.call{tool=Edit, foo="{a"}';
  assert.deepEqual(registerChanges([a], [a]), []);
  assert.deepEqual(registerChanges([a], [b]), ['./register.tsx hooks: added tool.call{tool=Bash, foo="x, {b"}, tool.call{tool=Edit, foo="{a"}; gone tool.call{tool=Bash, foo="{a"}, tool.call{tool=Edit, foo="x, {b"}']);
  assert.deepEqual(registerChanges(['./register.tsx hooks: tool.call{tool=Bash, foo="{a"}'], ['./register.tsx hooks: tool.call{tool=Bash, foo="{b"}']), ['./register.tsx hooks: added tool.call{tool=Bash, foo="{b"}; gone tool.call{tool=Bash, foo="{a"}']);
  // A comma with no space after it is part of a name.
  assert.deepEqual(registerChanges(['./register.tsx calls: $.a,b'], ['./register.tsx calls: $.a, b']), ['./register.tsx calls: added $.a, b; gone $.a,b']);
});

test('a line that says nothing names none: what comes instead is only added, and several names gone are each named', () => {
  assert.deepEqual(registerChanges(['./register.tsx env writes: nothing'], ['./register.tsx env writes: PATH, HOME']), ['./register.tsx env writes: added PATH, HOME']);
  assert.deepEqual(registerChanges(['./register.tsx env writes: PATH, HOME'], ['./register.tsx env writes: nothing']), ['./register.tsx env writes: gone PATH, HOME']);
  assert.deepEqual(registerChanges(['./register.tsx env writes: nothing'], ['./register.tsx env writes: nothing']), []);
  assert.deepEqual(registerChanges([], ['./register.tsx env writes: nothing']), ['./register.tsx env writes: new, nothing']);
  assert.deepEqual(registerChanges(['./register.tsx calls: $.a, $.b'], []), ['./register.tsx calls: gone, it was $.a, $.b']);
  // Lines of one module and kind are one list, in the order printed.
  assert.deepEqual(registerChanges(['./r.ts gating hook with .catch: one', './r.ts gating hook with .catch: two'], []), ['./r.ts gating hook with .catch: gone, it was one, two']);
});

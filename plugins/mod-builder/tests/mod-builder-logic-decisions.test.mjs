// Logic tests for SPEC.md 7.7: which types file the typecheck uses when several name themselves the build's
// (every candidate must agree), the last lines of a command's output that a refusal carries, and the debug-log
// line that says a hook of the mod was skipped, which makes a load no load.
import { test } from 'node:test';
import assert from 'node:assert/strict';
// Read through the namespace, so that before the rules exist this file still loads and each test fails by itself.
import * as logic from '../hooks/mod-builder-logic.ts';

const typesVerdict = (...args) => logic.typesToCheck(...args);
const lastLines = (...args) => logic.lastLines(...args);
const hooksSkipped = (...args) => logic.hooksSkipped(...args);
const FOLDER = '/tmp/claude-1000/bundled-skills/2.1.322';
const one = (name, content = 'types', sha256 = 'aa') => ({ path: `${FOLDER}/${name}/plugin-authoring/types/claude-code.d.ts`, content, sha256 });
const LOADED = '2026-11-10T21:11:40.275Z [DEBUG] hooks module clear@inline loaded (worker, environment 1, tier user); events: session.start,command.run,ui.render';
const SKIPPED = '2026-11-10T21:11:41.330Z [ERROR] clear: session.start hook skipped: threw clear: $.command.register: "/clear" refused: it is the built-in /clear';

test('with no candidate the verdict refuses, saying where it looked and that loading plugin-authoring writes the types', () => {
  assert.deepEqual(typesVerdict([], FOLDER, '2.1.322'), {
    pass: false,
    reason: `the types of Claude Code 2.1.322 are not written yet (looked in ${FOLDER}): load the plugin-authoring skill with the Skill tool, which writes them, then ask again`,
  });
  assert.match(typesVerdict([], null, '2.1.322').reason, /looked in no folder: CLAUDE_TMPDIR is not set and the user id could not be read/);
  for (const none of [null, undefined, 'x', {}]) assert.equal(typesVerdict(none, FOLDER, '2.1.322').pass, false);
});

test('the last lines of an output are its last 20, with empty lines at its end left out', () => {
  const lines = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`);
  assert.equal(lastLines(`${lines.join('\n')}\n\n  \n`), lines.slice(10).join('\n'));
  assert.equal(lastLines(lines.slice(0, 20).join('\n')), lines.slice(0, 20).join('\n'));
  assert.equal(lastLines(lines.slice(0, 21).join('\r\n')), lines.slice(1, 21).join('\n'));
  assert.equal(lastLines('one\n\ntwo\n'), 'one\n\ntwo');
  assert.equal(lastLines(lines.join('\n'), 3), 'line 28\nline 29\nline 30');
});

test('an output with nothing in it has no last lines, and neither has what is no text or a count that is none', () => {
  for (const nothing of ['', '\n', ' \n\t\n', null, undefined, 7]) assert.equal(lastLines(nothing), '', JSON.stringify(nothing));
  for (const count of [0, -1, 1.5, NaN, '20']) assert.equal(lastLines('a\nb', count), '', String(count));
});

test('a line "<mod>: <event> hook skipped:" is found for the mod, with the log\'s stamp before it or none', () => {
  assert.deepEqual(hooksSkipped(`${LOADED}\n${SKIPPED}\n`, 'clear'), [SKIPPED]);
  assert.deepEqual(hooksSkipped('clear: tool.call hook skipped: threw Error: boom\r\nclear: ui.render hook skipped: returned the wrong shape\n', 'clear'), [
    'clear: tool.call hook skipped: threw Error: boom', 'clear: ui.render hook skipped: returned the wrong shape',
  ]);
});

test('another mod\'s skipped hook, a mod whose name only ends or starts the same, and a line that only quotes the words are not the mod\'s', () => {
  const others = [
    '[ERROR] first-mod: tool.call hook skipped: threw Error: boom',
    '[ERROR] unclear: tool.call hook skipped: threw x',
    '[ERROR] clear-two: tool.call hook skipped: threw x',
    '[DEBUG] clear: loaded; a note that says "tool.call hook skipped:" in passing',
    '[DEBUG] someone said clear: tool.call hook was not skipped',
    '[DEBUG] clear: hook skipped: with no event named',
    '',
  ].join('\n');
  assert.deepEqual(hooksSkipped(others, 'clear'), []);
  for (const bad of [null, undefined, 7]) assert.deepEqual(hooksSkipped(bad, 'clear'), []);
  assert.deepEqual(hooksSkipped(SKIPPED, ''), []);
});

test('a load whose log says a hook of the mod was skipped is not shown, though the module loaded; another mod\'s skipped hook changes nothing', () => {
  assert.equal(logic.loadShown(`${LOADED}\n`, 'clear'), true);
  assert.equal(logic.loadShown(`${LOADED}\n${SKIPPED}\n`, 'clear'), false);
  assert.equal(logic.loadShown(`${SKIPPED}\n${LOADED}\n`, 'clear'), false);
  assert.equal(logic.loadShown(`${LOADED}\n[ERROR] first-mod: tool.call hook skipped: threw Error: boom\n`, 'clear'), true);
});

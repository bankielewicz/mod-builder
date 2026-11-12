// Which names directly under the temporary folder are a tool's and not a test's (SPEC.md 9.40): the rule the
// whole-run test of leaves-nothing.test.mjs sets aside by. The helpers are taken as a whole, so that this file
// loads while the rule is not written yet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import * as helpers from './test-helpers.mjs';

// The rule's answer for one name, or 'no rule' while the helpers have none.
const answer = (name) => (typeof helpers.toolsFolder === 'function' ? helpers.toolsFolder(name) : 'no rule');

test('the folder Claude Code makes and the folder of Node\'s compile cache are a tool\'s', () => {
  assert.equal(answer('claude-1000'), true);
  assert.equal(answer('claude-0'), true);
  assert.equal(answer('node-compile-cache'), true);
});

test('a name that only begins or ends as a tool\'s folder does is not a tool\'s', () => {
  const lines = ['claude-1000\n', ' claude-1000', 'claude-1000 ', 'x\nclaude-1000', 'claude-1000\nx'];
  for (const name of [...lines, 'claude-', 'claude-1000x', 'xclaude-1000', 'claude-1000/x', 'Claude-1000', 'node-compile-cache-2', 'node-compile-cache/x', 'xnode-compile-cache', 'node-compile-cache\n']) {
    assert.equal(answer(name), false, JSON.stringify(name));
  }
});

test('a folder a test makes, an empty name and a value that is no text are not a tool\'s', () => {
  for (const name of ['mod-builder-run-abc', 'mod-builder-test-1', 'mod-builder-leaves-x', '', 1000, undefined, null, ['claude-1000']]) {
    assert.equal(answer(name), false, JSON.stringify(name) ?? 'undefined');
  }
});

test('a Node process that turns its compile cache on leaves exactly node-compile-cache, which the rule calls a tool\'s', () => {
  const folder = helpers.tempDir('mod-builder-tools-');
  const env = { ...process.env, TMPDIR: folder };
  delete env.NODE_COMPILE_CACHE;
  delete env.NODE_DISABLE_COMPILE_CACHE;
  delete env.NODE_TEST_CONTEXT;
  const ended = spawnSync(process.execPath, ['-e', "require('node:module').enableCompileCache()"], { env, encoding: 'utf8' });
  assert.equal(ended.status, 0, `this Node (${process.version}) could not turn its compile cache on: ${ended.stderr}`);
  const left = readdirSync(folder);
  assert.deepEqual(left, ['node-compile-cache']);
  assert.deepEqual(left.filter((name) => answer(name) !== true), []);
});

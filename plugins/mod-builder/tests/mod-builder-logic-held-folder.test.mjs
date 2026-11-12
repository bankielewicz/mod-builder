// Logic tests for what a session is told of a folder another session holds (SPEC.md 9.29, 9.30): whose it is,
// and the way out there is in 0.3.0. Nothing expires, and no other session can release it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as rules from '../hooks/mod-builder-logic.ts';

const MOD = '/work/mod';
const folder = (more = {}) => ({ modDir: MOD, pluginRoot: '/opt/mod-builder', sessionId: 's1', kept: undefined, hasManifest: true, hooksJson: '{ "modules": ["./register.tsx"] }', ...more });

test('the refusal names the holding session, its phase, and the way out: resume it and stop there, or name another folder', () => {
  assert.equal(rules.heldByAnother(MOD, 'build', 'abc-123', 'phase 5 (Red)'), '/work/mod is being built by another session (abc-123; it is at phase 5 (Red)). If that session is gone, resume it with claude --resume abc-123 and run /mod-builder stop there; or name another folder.');
  assert.equal(rules.heldByAnother(MOD, 'edit', 'abc-123', 'phase 4 (Red)'), '/work/mod is being edited by another session (abc-123; it is at phase 4 (Red)). If that session is gone, resume it with claude --resume abc-123 and run /mod-builder stop there; or name another folder.');
});

test('a session id is shown on one line', () => {
  assert.equal(rules.heldByAnother(MOD, 'build', 'a\nb', 'phase 5 (Red)').includes('(a b; it is at phase 5 (Red))'), true);
});

test('an edit that names a folder another session holds is refused in those words, for a build and for an edit held there', () => {
  const theirs = (phase, more = {}) => ({ ...rules.newRecord(MOD, 'held-by-7'), phase, ...more });
  assert.deepEqual(rules.editFolderVerdict(folder({ kept: theirs('green') })), { pass: false, reason: rules.heldByAnother(MOD, 'build', 'held-by-7', 'phase 6 (Green)') });
  assert.deepEqual(rules.editFolderVerdict(folder({ kept: theirs('red', { kind: 'edit' }) })), { pass: false, reason: rules.heldByAnother(MOD, 'edit', 'held-by-7', 'phase 4 (Red)') });
});

test('a folder nobody else holds is not refused: this session\'s own record, a stopped one, a finished one, none', () => {
  const record = (more) => ({ ...rules.newRecord(MOD, 's2'), phase: 'green', ...more });
  for (const kept of [undefined, null, record({ sessionId: 's1' }), record({ stopped: true }), record({ phase: 'done' })]) assert.deepEqual(rules.editFolderVerdict(folder({ kept })), { pass: true });
});

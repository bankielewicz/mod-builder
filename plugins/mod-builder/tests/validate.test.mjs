// What `claude plugin validate` reads in the hooks module (SPEC.md 7.5): every hook whose answer can refuse what
// was asked has a `.catch` handler, so that a hook that fails answers closed and is never skipped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const plugin = dirname(dirname(fileURLToPath(import.meta.url)));
const GATE_HOOK = 'tool.call{tool=mcp__mod-builder__mod_builder_gate}';

// The validator's report: its exit code and what it printed. Run without blocking, as a child of this process.
const validate = () => new Promise((resolve) => {
  execFile('claude', ['plugin', 'validate', '--strict', plugin], { timeout: 60000 }, (error, stdout) => {
    resolve({ exitCode: error === null ? 0 : error.code, lines: String(stdout).split('\n').map((line) => line.trim()) });
  });
});

test('validate passes, and reports no gating hook without a .catch handler', async () => {
  const report = await validate();
  assert.equal(report.exitCode, 0);
  assert.deepEqual(report.lines.filter((line) => line.includes('gating hook without .catch')), []);
});

test('validate names the gate tool\'s hook and the guard\'s hook as gating hooks with a .catch handler', async () => {
  const report = await validate();
  const withCatch = report.lines.filter((line) => line.includes('gating hook with .catch:')).map((line) => line.split('gating hook with .catch: ')[1]);
  assert.deepEqual(withCatch.sort(), ['tool.call', GATE_HOOK].sort());
});

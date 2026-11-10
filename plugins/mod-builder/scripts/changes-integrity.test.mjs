// Tests for three cases the first changes.md tests missed: a fetched page that is itself named changes.md, a section
// removed inside a replaced block, and a code fence that holds a shorter fence (SPEC.md 3.1: What changed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { startSite, newCache, refresh, readOrNull, snapshots } from './test-helpers.mjs';

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

// Refreshes once with `before`, then again with `after`; returns the second run and what the second snapshot holds.
async function twoSnapshots(before, after) {
  const site = await startSite(before);
  const cache = newCache();
  try {
    const first = await refresh(site, cache);
    assert.equal(first.code, 0, first.stderr);
    site.pages = { ...after };
    const second = await refresh(site, cache);
    assert.equal(second.code, 0, second.stderr);
    const kept = snapshots(cache);
    assert.equal(kept.length, 2);
    const folder = join(cache, kept[1]);
    return { second, changes: readOrNull(join(folder, 'changes.md')), manifest: readOrNull(join(folder, 'manifest.tsv')) };
  } finally {
    await site.close();
  }
}

test('a fetched page named changes.md is kept as fetched, and the script says it wrote no changes.md', async () => {
  const upstream = '# Changes\n\nWhat Anthropic changed, as a page of the docs.\n';
  const { second, changes, manifest } = await twoSnapshots(
    { 'api.md': '# API\n\nCalls.\n', 'changes.md': upstream },
    { 'api.md': '# API\n\nCalls, and one more.\n', 'changes.md': upstream },
  );
  assert.equal(changes, upstream);
  assert.ok(String(manifest).includes(`\t${sha256(upstream)}\t`), 'the manifest holds the hash of the page as fetched');
  assert.match(second.stdout, /changes\.md not written: the snapshot holds a fetched page of that name/);
});

test('a section removed inside a replaced block is listed with the heading it had', async () => {
  const before = ['Intro.', '', '## Keep', '', 'old text', '', '## Gone', '', 'body', '', '## After', '', 'end', ''].join('\n');
  const after = ['Intro.', '', '## Keep', '', 'new text', '', '## After', '', 'end', ''].join('\n');
  const { changes } = await twoSnapshots({ 'api.md': before }, { 'api.md': after });
  assert.notEqual(changes, null, 'changes.md is written into the new snapshot');
  assert.match(changes, /^## api\.md: changed, \+1 -5\n\n- ## Keep\n- ## Gone\n$/m);
});

test('a shorter fence inside a longer one does not end it, so a comment in the example is not a heading', async () => {
  const page = (line) => ['# Top', '', '## Example', '', '````md', '```bash', '# a comment in the example', '```',
    '# still inside the outer fence', line, '````', '', '## Next', '', 'text', ''].join('\n');
  const { changes } = await twoSnapshots({ 'api.md': page('change me') }, { 'api.md': page('changed') });
  assert.notEqual(changes, null, 'changes.md is written into the new snapshot');
  assert.match(changes, /^## api\.md: changed, \+1 -1\n\n- ## Example\n$/m);
});

test('a tilde fence is not ended by backticks', async () => {
  const page = (line) => ['## Example', '', '~~~', '```', '# a comment in the example', line, '~~~', '', '## Next', ''].join('\n');
  const { changes } = await twoSnapshots({ 'api.md': page('change me') }, { 'api.md': page('changed') });
  assert.notEqual(changes, null, 'changes.md is written into the new snapshot');
  assert.match(changes, /^## api\.md: changed, \+1 -1\n\n- ## Example\n$/m);
});

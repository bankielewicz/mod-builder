// Tests for three cases the first _changes.md tests missed: a fetched page that is named changes.md, a section
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
    return {
      second,
      changes: readOrNull(join(folder, '_changes.md')),
      page: readOrNull(join(folder, 'changes.md')),
      manifest: readOrNull(join(folder, 'manifest.tsv')),
      newer: kept[1],
      older: kept[0],
    };
  } finally {
    await site.close();
  }
}

test('a fetched page named changes.md is kept as fetched, beside the digest in _changes.md', async () => {
  const upstream = '# Changes\n\nWhat Anthropic changed, as a page of the docs.\n';
  const { changes, page, manifest, newer, older } = await twoSnapshots(
    { 'api.md': '# API\n\nCalls.\n', 'changes.md': upstream },
    { 'api.md': '# API\n\nCalls, and one more.\n', 'changes.md': upstream },
  );
  assert.equal(page, upstream);
  assert.ok(String(manifest).includes(`\t${sha256(upstream)}\t`), 'the manifest holds the hash of the page as fetched');
  assert.equal(changes, [
    `# Changes in ${newer} since ${older}`,
    '',
    'Pages: 1 changed, 0 added, 0 removed.',
    '',
    '## api.md: changed, +1 -1',
    '',
    '- # API',
    '',
  ].join('\n'));
});

test('the digest is no page: a run after it reports unchanged, and a third snapshot does not list it', async () => {
  const site = await startSite({ 'api.md': '# API\n\nOne.\n', 'events.md': '# Events\n' });
  const cache = newCache();
  try {
    assert.equal((await refresh(site, cache)).code, 0);
    site.pages['api.md'] = '# API\n\nTwo.\n';
    assert.equal((await refresh(site, cache)).code, 0);
    const second = snapshots(cache)[1];
    assert.notEqual(readOrNull(join(cache, String(second), '_changes.md')), null, '_changes.md is written into the new snapshot');
    assert.doesNotMatch(String(readOrNull(join(cache, String(second), 'manifest.tsv'))), /_changes/);
    const again = await refresh(site, cache);
    assert.equal(again.code, 0, again.stderr);
    assert.match(again.stdout, new RegExp(`unchanged since ${second}`));
    assert.equal(snapshots(cache).length, 2);
    site.pages['api.md'] = '# API\n\nThree.\n';
    assert.equal((await refresh(site, cache)).code, 0);
    const third = snapshots(cache)[2];
    assert.equal(readOrNull(join(cache, String(third), '_changes.md')), [
      `# Changes in ${third} since ${second}`,
      '',
      'Pages: 1 changed, 0 added, 0 removed.',
      '',
      '## api.md: changed, +1 -1',
      '',
      '- # API',
      '',
    ].join('\n'));
  } finally {
    await site.close();
  }
});

test('a page that is only removed keeps a new snapshot, and the digest lists it as removed', async () => {
  const { second, changes } = await twoSnapshots({ 'api.md': '# API\n', 'events.md': '# Events\n\nHooks.\n' }, { 'api.md': '# API\n' });
  assert.match(second.stdout, /new snapshot .* \(1 pages\)/);
  assert.notEqual(changes, null, '_changes.md is written into the new snapshot');
  assert.match(changes, /^Pages: 0 changed, 0 added, 1 removed\.\n\n## events\.md: removed, -3\n$/m);
});

test('a section removed inside a replaced block is listed with the heading it had', async () => {
  const before = ['Intro.', '', '## Keep', '', 'old text', '', '## Gone', '', 'body', '', '## After', '', 'end', ''].join('\n');
  const after = ['Intro.', '', '## Keep', '', 'new text', '', '## After', '', 'end', ''].join('\n');
  const { changes } = await twoSnapshots({ 'api.md': before }, { 'api.md': after });
  assert.notEqual(changes, null, '_changes.md is written into the new snapshot');
  assert.match(changes, /^## api\.md: changed, \+1 -5\n\n- ## Keep\n- ## Gone\n$/m);
});

test('a shorter fence inside a longer one does not end it, so a comment in the example is not a heading', async () => {
  const page = (line) => ['# Top', '', '## Example', '', '````md', '```bash', '# a comment in the example', '```',
    '# still inside the outer fence', line, '````', '', '## Next', '', 'text', ''].join('\n');
  const { changes } = await twoSnapshots({ 'api.md': page('change me') }, { 'api.md': page('changed') });
  assert.notEqual(changes, null, '_changes.md is written into the new snapshot');
  assert.match(changes, /^## api\.md: changed, \+1 -1\n\n- ## Example\n$/m);
});

test('a tilde fence is not ended by backticks', async () => {
  const page = (line) => ['## Example', '', '~~~', '```', '# a comment in the example', line, '~~~', '', '## Next', ''].join('\n');
  const { changes } = await twoSnapshots({ 'api.md': page('change me') }, { 'api.md': page('changed') });
  assert.notEqual(changes, null, '_changes.md is written into the new snapshot');
  assert.match(changes, /^## api\.md: changed, \+1 -1\n\n- ## Example\n$/m);
});

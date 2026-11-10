// Tests for the changes.md that refresh-docs.sh writes into a kept snapshot (SPEC.md 3.1: What changed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { startSite, newCache, refresh, readOrNull, snapshots } from './test-helpers.mjs';

const API = [
  'Intro line.',
  '',
  '# API',
  '',
  '## Add a command',
  '',
  'Register it.',
  '',
  '```bash',
  '# not a heading',
  'claude plugin test',
  '```',
  '',
  '## Add a tool',
  '',
  'Tools here.',
  '',
  '## Limits',
  '',
  'Four MiB.',
  '',
].join('\n');

const EVENTS = '# Events\n\nHooks.\n';

// Refreshes once with `before`, then again with `after`; returns the two stamps and the second snapshot's changes.md.
async function twoSnapshots(before, after) {
  const site = await startSite(before);
  const cache = newCache();
  try {
    const first = await refresh(site, cache);
    assert.equal(first.code, 0, first.stderr);
    site.pages = { ...after };
    const second = await refresh(site, cache);
    assert.equal(second.code, 0, second.stderr);
    const [older, newer] = snapshots(cache);
    return { cache, older, newer, changes: readOrNull(join(cache, String(newer), 'changes.md')) };
  } finally {
    await site.close();
  }
}

test('a first snapshot has no changes.md', async () => {
  const site = await startSite({ 'api.md': API });
  const cache = newCache();
  try {
    const result = await refresh(site, cache);
    assert.equal(result.code, 0, result.stderr);
    const [stamp] = snapshots(cache);
    assert.deepEqual(readdirSync(join(cache, stamp)).sort(), ['api.md', 'docs-index.txt', 'manifest.tsv']);
  } finally {
    await site.close();
  }
});

test('changes.md names both snapshots, counts lines each way and lists the changed headings', async () => {
  const after = API
    .replace('Intro line.', 'Intro line, reworded.')
    .replace('claude plugin test', 'claude plugin test --strict\nclaude plugin validate')
    .replace('## Limits\n\nFour MiB.\n', '');
  const { older, newer, changes } = await twoSnapshots({ 'api.md': API, 'events.md': EVENTS }, { 'api.md': after, 'events.md': EVENTS });
  assert.notEqual(changes, null, 'changes.md is written into the new snapshot');
  assert.equal(changes, [
    `# Changes in ${newer} since ${older}`,
    '',
    'Pages: 1 changed, 0 added, 0 removed.',
    '',
    '## api.md: changed, +3 -5',
    '',
    '- (before the first heading)',
    '- ## Add a command',
    '- ## Limits',
    '',
  ].join('\n'));
});

test('the old snapshot gets no changes.md and the new one keeps its pages', async () => {
  const { cache, older, newer, changes } = await twoSnapshots({ 'api.md': API }, { 'api.md': `${API}\nOne more line.\n` });
  assert.notEqual(changes, null, 'changes.md is written into the new snapshot');
  assert.deepEqual(readdirSync(join(cache, older)).sort(), ['api.md', 'docs-index.txt', 'manifest.tsv']);
  assert.deepEqual(readdirSync(join(cache, newer)).sort(), ['api.md', 'changes.md', 'docs-index.txt', 'manifest.tsv']);
  assert.match(changes, /^## api\.md: changed, \+2 -0\n\n- ## Limits\n/m);
});

test('changes.md reports an added page and a removed page with their line counts', async () => {
  const { older, newer, changes } = await twoSnapshots(
    { 'api.md': API, 'events.md': EVENTS },
    { 'api.md': API, 'gallery.md': '# Gallery\n\nOne.\nTwo.\n' },
  );
  assert.notEqual(changes, null, 'changes.md is written into the new snapshot');
  assert.equal(changes, [
    `# Changes in ${newer} since ${older}`,
    '',
    'Pages: 0 changed, 1 added, 1 removed.',
    '',
    '## events.md: removed, -3',
    '',
    '## gallery.md: added, +4',
    '',
  ].join('\n'));
});

test('a heading that changed is listed as it reads in the new snapshot', async () => {
  const { changes } = await twoSnapshots({ 'api.md': API }, { 'api.md': API.replace('## Add a tool', '## Register a tool') });
  assert.notEqual(changes, null, 'changes.md is written into the new snapshot');
  assert.match(changes, /^## api\.md: changed, \+1 -1\n\n- ## Register a tool\n$/m);
});

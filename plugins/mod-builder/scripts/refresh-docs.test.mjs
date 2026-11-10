// Tests for refresh-docs.sh against a local file server (SPEC.md 3.1: Refresh, One fetch at a time, Tests).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, utimesSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  startSite, newCache, start, refresh, readOrNull, snapshots, leftovers, MODS_PATH, INDEX_PATH, LAST_MODIFIED, STAMP,
} from './test-helpers.mjs';

const PAGES = { 'api.md': '# API\n\nCalls.\n', 'events.md': '# Events\n\nHooks.\n' };
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

test('a first run keeps a snapshot with the pages, the index and a manifest', async () => {
  const site = await startSite(PAGES);
  const cache = newCache();
  try {
    const result = await refresh(site, cache);
    assert.equal(result.code, 0, result.stderr);
    const [stamp] = snapshots(cache);
    assert.match(String(stamp), STAMP);
    assert.equal(snapshots(cache).length, 1);
    assert.equal(readOrNull(join(cache, 'latest')), `${stamp}\n`);
    assert.equal(readOrNull(join(cache, 'checked')), `${stamp}\n`);
    assert.match(result.stdout, new RegExp(`new snapshot ${stamp} \\(2 pages\\)`));
    assert.deepEqual(readdirSync(join(cache, stamp)).sort(), ['api.md', 'docs-index.txt', 'events.md', 'manifest.tsv']);
    assert.equal(readOrNull(join(cache, stamp, 'api.md')), PAGES['api.md']);
    assert.equal(readOrNull(join(cache, stamp, 'events.md')), PAGES['events.md']);
    const row = (name) => [name, `${site.origin}${MODS_PATH}${name}`, sha256(PAGES[name]), LAST_MODIFIED,
      String(Buffer.byteLength(PAGES[name]))].join('\t');
    assert.equal(readOrNull(join(cache, stamp, 'manifest.tsv')),
      `page\turl\tsha256\tlast_modified\tbytes\n${row('api.md')}\n${row('events.md')}\n`);
    assert.deepEqual(leftovers(cache), []);
  } finally {
    await site.close();
  }
});

test('a second run with the same pages reports unchanged and keeps no new snapshot', async () => {
  const site = await startSite(PAGES);
  const cache = newCache();
  try {
    assert.equal((await refresh(site, cache)).code, 0);
    const [stamp] = snapshots(cache);
    const second = await refresh(site, cache);
    assert.equal(second.code, 0, second.stderr);
    assert.match(second.stdout, new RegExp(`unchanged since ${stamp}`));
    assert.deepEqual(snapshots(cache), [stamp]);
    assert.equal(readOrNull(join(cache, 'latest')), `${stamp}\n`);
    assert.match(String(readOrNull(join(cache, 'checked'))).trim(), STAMP);
    assert.deepEqual(leftovers(cache), []);
  } finally {
    await site.close();
  }
});

test('a changed page keeps a new snapshot beside the old one', async () => {
  const site = await startSite(PAGES);
  const cache = newCache();
  try {
    assert.equal((await refresh(site, cache)).code, 0);
    const [first] = snapshots(cache);
    site.pages['api.md'] = '# API\n\nCalls, and one more.\n';
    const second = await refresh(site, cache);
    assert.equal(second.code, 0, second.stderr);
    const kept = snapshots(cache);
    assert.equal(kept.length, 2);
    assert.equal(kept[0], first);
    assert.equal(readOrNull(join(cache, 'latest')), `${kept[1]}\n`);
    assert.match(second.stdout, new RegExp(`new snapshot ${kept[1]} \\(2 pages\\), was ${first}`));
    assert.equal(readOrNull(join(cache, kept[1], 'api.md')), '# API\n\nCalls, and one more.\n');
    assert.equal(readOrNull(join(cache, first, 'api.md')), PAGES['api.md']);
    assert.deepEqual(readdirSync(join(cache, first)).sort(), ['api.md', 'docs-index.txt', 'events.md', 'manifest.tsv']);
    assert.deepEqual(leftovers(cache), []);
  } finally {
    await site.close();
  }
});

test('a failed page keeps nothing on a first run', async () => {
  const site = await startSite({ ...PAGES, 'gone.md': null });
  const cache = newCache();
  try {
    const result = await refresh(site, cache);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /gone\.md could not be fetched/);
    assert.deepEqual(readdirSync(cache), []);
  } finally {
    await site.close();
  }
});

test('a failed page leaves the earlier snapshot, latest and checked as they were', async () => {
  const site = await startSite(PAGES);
  const cache = newCache();
  try {
    assert.equal((await refresh(site, cache)).code, 0);
    const [stamp] = snapshots(cache);
    site.pages['events.md'] = null;
    const result = await refresh(site, cache);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /events\.md could not be fetched/);
    assert.deepEqual(readdirSync(cache).sort(), [stamp, 'checked', 'latest']);
    assert.equal(readOrNull(join(cache, 'latest')), `${stamp}\n`);
    assert.equal(readOrNull(join(cache, 'checked')), `${stamp}\n`);
  } finally {
    await site.close();
  }
});

test('a held lock skips the fetch and is left in place', async () => {
  const site = await startSite(PAGES);
  const cache = newCache();
  try {
    mkdirSync(join(cache, '.lock'));
    const result = await refresh(site, cache);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /skipped/);
    assert.deepEqual(site.requests, []);
    assert.deepEqual(readdirSync(cache), ['.lock']);
  } finally {
    await site.close();
  }
});

test('a lock older than ten minutes is ignored', async () => {
  const site = await startSite(PAGES);
  const cache = newCache();
  try {
    mkdirSync(join(cache, '.lock'));
    const elevenMinutesAgo = new Date(Date.now() - 11 * 60 * 1000);
    utimesSync(join(cache, '.lock'), elevenMinutesAgo, elevenMinutesAgo);
    const result = await refresh(site, cache);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(snapshots(cache).length, 1);
    assert.deepEqual(leftovers(cache), []);
  } finally {
    await site.close();
  }
});

test('while it fetches, the script holds the lock and an incoming folder named with its process id', async () => {
  const site = await startSite(PAGES);
  const cache = newCache();
  try {
    const held = site.hold('events.md');
    const running = start('refresh-docs.sh', [cache], { MOD_BUILDER_DOCS_ORIGIN: site.origin });
    // If the script ends before it asks for the page, the race ends too and the assertion below fails.
    await Promise.race([held.arrived, running.done]);
    const during = leftovers(cache).sort();
    held.release();
    const result = await running.done;
    assert.deepEqual(during, ['.incoming-' + running.pid, '.lock']);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(leftovers(cache), []);
  } finally {
    await site.close();
  }
});

test('only lowercase page names directly under the mods path of the docs origin are fetched', async () => {
  const site = await startSite(PAGES);
  site.extraIndexLines = [
    `- [upper](${site.origin}${MODS_PATH}Upper.md)`,
    `- [deeper](${site.origin}${MODS_PATH}sub/deep.md)`,
    `- [elsewhere](${site.origin}/docs/en/other/page.md)`,
    `- [other host](https://example.invalid${MODS_PATH}evil.md)`,
    `- [not markdown](${site.origin}${MODS_PATH}page.txt)`,
  ];
  const cache = newCache();
  try {
    const result = await refresh(site, cache);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(site.requests, [INDEX_PATH, `${MODS_PATH}api.md`, `${MODS_PATH}events.md`]);
    const [stamp] = snapshots(cache);
    assert.deepEqual(readdirSync(join(cache, stamp)).sort(), ['api.md', 'docs-index.txt', 'events.md', 'manifest.tsv']);
  } finally {
    await site.close();
  }
});

test('an index that lists no mod page fails and keeps nothing', async () => {
  const site = await startSite({});
  const cache = newCache();
  try {
    const result = await refresh(site, cache);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /lists no mod pages/);
    assert.equal(existsSync(join(cache, 'latest')), false);
    assert.deepEqual(readdirSync(cache), []);
  } finally {
    await site.close();
  }
});

// Tests for "a page is kept only when it is one" (SPEC.md 3.1): the index and every page must answer 200, a page
// must be served as text/markdown with at least one byte, and a cache folder that can't be written is a failure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accessSync, chmodSync, constants, mkdirSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startSite, newCache, refresh, readOrNull, snapshots, MODS_PATH, INDEX_PATH, STAMP } from './test-helpers.mjs';

const GOOD = { 'api.md': '# API\n\nCalls.\n', 'events.md': '# Events\n\nHooks.\n' };
const EARLIER = '2020-01-01T000000Z';

// True when this process can write the folder although its mode says read-only (root, or a file system that
// ignores modes): the two tests of a folder that cannot be written prove nothing there, and are skipped.
function canWriteAnyway(folder) {
  try {
    accessSync(folder, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

// Runs one refresh of a site whose page bad.md answers as `bad`; expects a failed fetch that keeps nothing.
async function refusedOnFirstRun(bad, message) {
  const site = await startSite({ ...GOOD, 'bad.md': bad });
  const cache = newCache();
  try {
    const result = await refresh(site, cache);
    assert.equal(result.code, 1, result.stdout);
    assert.match(result.stderr, message);
    assert.deepEqual(readdirSync(cache), []);
    return site;
  } finally {
    await site.close();
  }
}

test('a page that answers with a redirect fails the fetch, and the redirect is not followed', async () => {
  const site = await refusedOnFirstRun(
    { status: 301, location: `${MODS_PATH}api.md`, body: 'Moved.\n' },
    /bad\.md could not be fetched: it answered 301, not 200/,
  );
  assert.equal(site.requests.filter((path) => path === `${MODS_PATH}api.md`).length, 1);
});

test('a bad page fails the fetch wherever it stands in the index: first, with good pages after it', async () => {
  const site = await startSite({ 'a-first.md': { type: 'text/html', body: '<html>Sign in</html>\n' }, ...GOOD });
  const cache = newCache();
  try {
    const result = await refresh(site, cache);
    assert.equal(result.code, 1, result.stdout);
    assert.match(result.stderr, /a-first\.md could not be fetched: it was served as text\/html, not text\/markdown/);
    assert.deepEqual(readdirSync(cache), []);
  } finally {
    await site.close();
  }
});

test('an empty page fails the fetch when it stands between good pages', async () => {
  const site = await startSite({ 'api.md': '# API\n', 'blank.md': { body: '' }, 'events.md': '# Events\n' });
  const cache = newCache();
  try {
    const result = await refresh(site, cache);
    assert.equal(result.code, 1, result.stdout);
    assert.match(result.stderr, /blank\.md could not be fetched: it is empty/);
    assert.deepEqual(readdirSync(cache), []);
  } finally {
    await site.close();
  }
});

test('a page of one byte, a newline, is kept', async () => {
  const site = await startSite({ 'api.md': '\n', 'events.md': '# Events\n' });
  const cache = newCache();
  try {
    const result = await refresh(site, cache);
    assert.equal(result.code, 0, result.stderr);
    const [stamp] = snapshots(cache);
    assert.equal(readOrNull(join(cache, String(stamp), 'api.md')), '\n');
    assert.match(String(readOrNull(join(cache, String(stamp), 'manifest.tsv'))), /^api\.md\t.*\t1$/m);
  } finally {
    await site.close();
  }
});

test('a page that answers 200 with an empty body fails the fetch', async () => {
  await refusedOnFirstRun({ body: '' }, /bad\.md could not be fetched: it is empty/);
});

test('a page served as text/html fails the fetch', async () => {
  await refusedOnFirstRun(
    { type: 'text/html; charset=utf-8', body: '<html><body>Sign in</body></html>\n' },
    /bad\.md could not be fetched: it was served as text\/html, not text\/markdown/,
  );
});

test('a page served with no content type fails the fetch', async () => {
  await refusedOnFirstRun({ type: null, body: '# Page\n' }, /bad\.md could not be fetched: it was served as nothing, not text\/markdown/);
});

test('a page served as a type that only starts with text/markdown fails the fetch', async () => {
  await refusedOnFirstRun({ type: 'text/markdownish', body: '# Page\n' }, /bad\.md could not be fetched: it was served as text\/markdownish/);
});

test('a page that answers 206 fails the fetch though its body is markdown', async () => {
  await refusedOnFirstRun({ status: 206, body: '# Part\n' }, /bad\.md could not be fetched: it answered 206, not 200/);
});

test('text/markdown is accepted in any letter case, with or without parameters', async () => {
  const site = await startSite({
    'api.md': { type: 'Text/Markdown', body: '# API\n' },
    'events.md': { type: 'text/markdown;charset=UTF-8', body: '# Events\n' },
  });
  const cache = newCache();
  try {
    const result = await refresh(site, cache);
    assert.equal(result.code, 0, result.stderr);
    const [stamp] = snapshots(cache);
    assert.equal(readOrNull(join(cache, String(stamp), 'api.md')), '# API\n');
    assert.equal(readOrNull(join(cache, String(stamp), 'events.md')), '# Events\n');
  } finally {
    await site.close();
  }
});

test('an index that answers with a redirect fails the fetch before any page is asked for', async () => {
  const site = await startSite(GOOD);
  site.index = { status: 302, location: '/login', body: 'Found.\n' };
  const cache = newCache();
  try {
    const result = await refresh(site, cache);
    assert.equal(result.code, 1, result.stdout);
    assert.match(result.stderr, /the docs index could not be fetched: it answered 302, not 200/);
    assert.deepEqual(site.requests, [INDEX_PATH]);
    assert.deepEqual(readdirSync(cache), []);
  } finally {
    await site.close();
  }
});

test('an index that answers 500 fails the fetch though its body lists pages', async () => {
  const site = await startSite(GOOD);
  site.index = { status: 500, body: `- [api](${site.origin}${MODS_PATH}api.md)\n` };
  const cache = newCache();
  try {
    const result = await refresh(site, cache);
    assert.equal(result.code, 1, result.stdout);
    assert.match(result.stderr, /the docs index could not be fetched: it answered 500, not 200/);
    assert.deepEqual(site.requests, [INDEX_PATH]);
    assert.deepEqual(readdirSync(cache), []);
  } finally {
    await site.close();
  }
});

test('a page that turns bad after a snapshot leaves the snapshot, latest and checked as they were', async () => {
  const site = await startSite(GOOD);
  const cache = newCache();
  try {
    assert.equal((await refresh(site, cache)).code, 0);
    const [stamp] = snapshots(cache);
    site.pages['events.md'] = { type: 'text/html', body: '<html>Maintenance</html>\n' };
    // A value no run could write, so a run that touches checked is seen even within the same second.
    writeFileSync(join(cache, 'checked'), `${EARLIER}\n`);
    const result = await refresh(site, cache);
    assert.equal(result.code, 1, result.stdout);
    assert.deepEqual(readdirSync(cache).sort(), [stamp, 'checked', 'latest']);
    assert.equal(readOrNull(join(cache, 'latest')), `${stamp}\n`);
    assert.equal(readOrNull(join(cache, 'checked')), `${EARLIER}\n`);
    assert.equal(readOrNull(join(cache, stamp, 'events.md')), GOOD['events.md']);
  } finally {
    await site.close();
  }
});

test('a run that finds nothing changed moves checked, and leaves latest', async () => {
  const site = await startSite(GOOD);
  const cache = newCache();
  try {
    assert.equal((await refresh(site, cache)).code, 0);
    const [stamp] = snapshots(cache);
    writeFileSync(join(cache, 'checked'), `${EARLIER}\n`);
    const result = await refresh(site, cache);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /unchanged/);
    const checked = String(readOrNull(join(cache, 'checked'))).trim();
    assert.match(checked, STAMP);
    assert.notEqual(checked, EARLIER);
    assert.equal(readOrNull(join(cache, 'latest')), `${stamp}\n`);
  } finally {
    await site.close();
  }
});

test('a lock nine minutes old is still held: the fetch is skipped', async () => {
  const site = await startSite(GOOD);
  const cache = newCache();
  try {
    mkdirSync(join(cache, '.lock'));
    const nineMinutesAgo = new Date(Date.now() - 9 * 60 * 1000);
    utimesSync(join(cache, '.lock'), nineMinutesAgo, nineMinutesAgo);
    const result = await refresh(site, cache);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /skipped/);
    assert.deepEqual(site.requests, []);
    assert.deepEqual(readdirSync(cache), ['.lock']);
  } finally {
    await site.close();
  }
});

test('a site that cannot be reached fails the fetch and keeps nothing', async () => {
  const site = await startSite(GOOD);
  const cache = newCache();
  await site.close();
  const result = await refresh(site, cache);
  assert.equal(result.code, 1, result.stdout);
  assert.match(result.stderr, /the docs index could not be fetched/);
  assert.deepEqual(readdirSync(cache), []);
});

test('a cache path that is a file exits 1', async () => {
  const site = await startSite(GOOD);
  const file = join(newCache(), 'not-a-folder');
  writeFileSync(file, 'x\n');
  try {
    const result = await refresh(site, file);
    assert.equal(result.code, 1, result.stdout);
    assert.match(result.stderr, /the cache folder .* cannot be written/);
    assert.deepEqual(site.requests, []);
    assert.equal(readOrNull(file), 'x\n');
  } finally {
    await site.close();
  }
});

test('a cache folder that cannot be written exits 1 and is not reported as skipped', async (t) => {
  const site = await startSite(GOOD);
  const cache = newCache();
  chmodSync(cache, 0o555);
  if (canWriteAnyway(cache)) {
    chmodSync(cache, 0o755);
    await site.close();
    t.skip('this process can write a read-only folder');
    return;
  }
  try {
    const result = await refresh(site, cache);
    assert.equal(result.code, 1, result.stdout);
    assert.match(result.stderr, /the cache folder .* cannot be written/);
    assert.doesNotMatch(result.stdout, /skipped/);
    assert.deepEqual(site.requests, []);
  } finally {
    chmodSync(cache, 0o755);
    await site.close();
  }
});

test('a cache folder that cannot be made exits 1', async (t) => {
  const site = await startSite(GOOD);
  const parent = newCache();
  chmodSync(parent, 0o555);
  if (canWriteAnyway(parent)) {
    chmodSync(parent, 0o755);
    await site.close();
    t.skip('this process can write a read-only folder');
    return;
  }
  try {
    const result = await refresh(site, join(parent, 'docs'));
    assert.equal(result.code, 1, result.stdout);
    assert.match(result.stderr, /the cache folder .* cannot be written/);
    assert.deepEqual(site.requests, []);
  } finally {
    chmodSync(parent, 0o755);
    await site.close();
  }
});

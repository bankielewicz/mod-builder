// Tests for lookup.sh against a cache folder built by hand (SPEC.md 3.1: Lookup). No server is needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { newCache, run } from './test-helpers.mjs';

const OLD = '2026-11-01T000000Z';
const NEW = '2026-11-10T151216Z';

const EVENTS = [
  '# Events',
  '',
  'A tool.call hook fires when Claude Code is about to run a tool.',
  'A hook can ask the person a question: $.ui.ask holds the call.',
  'Ask nothing here.',
  'The limit is a=b, or C:\\temp\\x, never .ui.ask alone.',
  '',
].join('\n');

const API = ['# API', '', 'Register a Tool with $.tool.register before the first call.', ''].join('\n');

// Writes a snapshot folder: its pages, a manifest listing them in the order given, and files that are not pages.
function writeSnapshot(cache, stamp, pages) {
  const folder = join(cache, stamp);
  mkdirSync(folder);
  const rows = ['page\turl\tsha256\tlast_modified\tbytes'];
  for (const [name, body] of Object.entries(pages)) {
    writeFileSync(join(folder, name), body);
    rows.push(`${name}\thttps://code.claude.com/docs/en/plugins/mods/${name}\t0\t\t${Buffer.byteLength(body)}`);
  }
  writeFileSync(join(folder, 'manifest.tsv'), `${rows.join('\n')}\n`);
  writeFileSync(join(folder, 'docs-index.txt'), 'An index line about a tool and a call.\n');
  writeFileSync(join(folder, 'changes.md'), '# Changes\n\nA tool call line that is not a page.\n');
}

function cacheWithTwoSnapshots() {
  const cache = newCache();
  writeSnapshot(cache, OLD, { 'events.md': 'An old tool call line, only in the older snapshot.\n' });
  writeSnapshot(cache, NEW, { 'events.md': EVENTS, 'api.md': API });
  writeFileSync(join(cache, 'latest'), `${NEW}\n`);
  return cache;
}

const lookup = (cache, ...words) => run('lookup.sh', words, { MOD_BUILDER_DOCS_CACHE: cache });

test('prints the snapshot stamp, then page:line: text for each line of the newest snapshot that holds every word', async () => {
  const result = await lookup(cacheWithTwoSnapshots(), 'tool', 'CALL');
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, [
    `snapshot ${NEW}`,
    'events.md:3: A tool.call hook fires when Claude Code is about to run a tool.',
    'api.md:3: Register a Tool with $.tool.register before the first call.',
    '',
  ].join('\n'));
});

test('a line that holds only some of the words is not printed', async () => {
  const result = await lookup(cacheWithTwoSnapshots(), 'ask', 'question');
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, `snapshot ${NEW}\nevents.md:4: A hook can ask the person a question: $.ui.ask holds the call.\n`);
});

test('words are matched as plain text, whatever characters they hold', async () => {
  const cache = cacheWithTwoSnapshots();
  const dollar = await lookup(cache, '$.ui.ask');
  assert.equal(dollar.code, 0, dollar.stderr);
  assert.equal(dollar.stdout, `snapshot ${NEW}\nevents.md:4: A hook can ask the person a question: $.ui.ask holds the call.\n`);
  const odd = await lookup(cache, 'a=b', 'C:\\temp\\x');
  assert.equal(odd.code, 0, odd.stderr);
  assert.equal(odd.stdout, `snapshot ${NEW}\nevents.md:6: The limit is a=b, or C:\\temp\\x, never .ui.ask alone.\n`);
  const dots = await lookup(cache, 't..l');
  assert.equal(dots.code, 1);
});

test('no matching line exits 1 after the snapshot stamp', async () => {
  const result = await lookup(cacheWithTwoSnapshots(), 'zebra');
  assert.equal(result.code, 1);
  assert.equal(result.stdout, `snapshot ${NEW}\n`);
  assert.match(result.stderr, /no line holds/);
});

test('a cache with no snapshot exits 2 and names the refresh script', async () => {
  const result = await lookup(newCache(), 'tool');
  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /refresh-docs\.sh/);
});

test('no words exits 2 with the usage', async () => {
  const result = await lookup(cacheWithTwoSnapshots());
  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /usage: lookup\.sh <words>/);
});

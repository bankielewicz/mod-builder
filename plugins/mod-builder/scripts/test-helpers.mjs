// Helpers for the script tests: a local file server that stands in for the docs site, a throwaway cache folder,
// and a runner for a script under bash. Nothing here reaches the network beyond 127.0.0.1.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const scriptsDir = dirname(fileURLToPath(import.meta.url));
export const MODS_PATH = '/docs/en/plugins/mods/';
export const INDEX_PATH = '/docs/llms.txt';
export const LAST_MODIFIED = 'Tue, 10 Nov 2026 13:04:40 GMT';
export const MARKDOWN = 'text/markdown; charset=utf-8';
export const STAMP = /^\d{4}-\d{2}-\d{2}T\d{6}Z$/;

// Starts a server for `pages` (file name -> body). The index lists every page, then `extraIndexLines`.
// A page's value is its body (served with status 200 as MARKDOWN), null (a 404), or an object
// { status, type, body, location } for any other answer: `type: null` sends no Content-Type, and `location`
// sends a Location header. `site.index`, when set to such an object, replaces the index's answer.
// `site.pages` may be changed between runs; `site.requests` lists the paths asked for, in order.
// `site.hold(name)` makes the next request for that page wait; it returns { arrived, release }.
export async function startSite(pages, extraIndexLines = []) {
  const site = { pages: { ...pages }, extraIndexLines, requests: [], origin: '', holds: new Map(), index: null };
  const answer = (res, { status = 200, type = MARKDOWN, body = '', location = null }) => {
    res.statusCode = status;
    if (type !== null) res.setHeader('Content-Type', type);
    if (location !== null) res.setHeader('Location', location);
    res.setHeader('Last-Modified', LAST_MODIFIED);
    res.end(body);
  };
  const server = http.createServer(async (req, res) => {
    site.requests.push(req.url);
    if (req.url === INDEX_PATH && site.index !== null) {
      answer(res, { type: 'text/plain; charset=utf-8', ...site.index });
      return;
    }
    if (req.url === INDEX_PATH) {
      const lines = Object.keys(site.pages).map((name) => `- [${name}](${site.origin}${MODS_PATH}${name}): a page`);
      answer(res, { type: 'text/plain; charset=utf-8', body: ['# Docs', ...lines, ...site.extraIndexLines, ''].join('\n') });
      return;
    }
    const name = req.url.startsWith(MODS_PATH) ? req.url.slice(MODS_PATH.length) : null;
    if (name === null || !(name in site.pages) || site.pages[name] === null) {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    const held = site.holds.get(name);
    if (held) {
      site.holds.delete(name);
      held.arrive();
      await held.released;
    }
    const page = site.pages[name];
    answer(res, typeof page === 'string' ? { body: page } : page);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  site.origin = `http://127.0.0.1:${server.address().port}`;
  site.hold = (name) => {
    let arrive;
    let release;
    const arrived = new Promise((resolve) => { arrive = resolve; });
    const released = new Promise((resolve) => { release = resolve; });
    site.holds.set(name, { arrive, released });
    return { arrived, release };
  };
  site.close = () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); });
  return site;
}

// Every temporary folder a test makes is made here: a new folder whose name starts with `prefix`.
export function tempDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function newCache() {
  return tempDir('mod-builder-test-');
}

// Starts `bash <script> <args>` without waiting. `done` resolves to { code, stdout, stderr }.
export function start(script, args, env = {}) {
  // The stand-in site is on 127.0.0.1: a proxy named in the environment must not be asked for it.
  const direct = { no_proxy: '127.0.0.1,localhost', NO_PROXY: '127.0.0.1,localhost' };
  const child = spawn('bash', [join(scriptsDir, script), ...args], { env: { ...process.env, ...direct, ...env } });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const done = new Promise((resolve) => { child.on('close', (code) => resolve({ code, stdout, stderr })); });
  return { pid: child.pid, done };
}

export function run(script, args, env = {}) {
  return start(script, args, env).done;
}

export function refresh(site, cache) {
  return run('refresh-docs.sh', [cache], { MOD_BUILDER_DOCS_ORIGIN: site.origin });
}

export function readOrNull(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

// The snapshot folders of a cache, oldest first.
export function snapshots(cache) {
  return readdirSync(cache).filter((name) => STAMP.test(name)).sort();
}

export function leftovers(cache) {
  return readdirSync(cache).filter((name) => name === '.lock' || name.startsWith('.incoming'));
}

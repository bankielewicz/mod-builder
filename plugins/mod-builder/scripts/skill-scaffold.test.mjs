// Tests for what the build skill says of SPEC.md 9.4 and 9.15: at Scaffold hooks/ and tests/ stay as the script
// laid them, the gate refuses a file there that is changed, missing or extra, the script lays them again, and a
// mod of another shape replaces the template's tests at Red and its code at Green.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scriptsDir } from './test-helpers.mjs';

const body = readFileSync(join(scriptsDir, '..', 'skills', 'build', 'SKILL.md'), 'utf8');
const section = (number) => {
  const from = body.indexOf(`### ${number}. `);
  const next = body.slice(from + 4).search(/\n#{2,3} /);
  return (from < 0 ? '' : body.slice(from, next < 0 ? undefined : from + 4 + next)).replace(/\s+/g, ' ');
};

test('Scaffold says to leave hooks/ and tests/ as the script laid them, and what the gate refuses', () => {
  const scaffold = section(4);
  assert.match(scaffold, /Leave `hooks\/` and `tests\/` exactly as the script laid them: at Scaffold they hold the template and nothing else, and the gate refuses a file there that is changed, missing or extra, and names it\./);
  assert.match(scaffold, /The mod's behaviour comes in phases 5 and 6, tests first\./);
});

test('Scaffold still says what it may add: the manifest\'s description and a contract in types/', () => {
  const scaffold = section(4);
  assert.match(scaffold, /Set the manifest's `description` to the mod's own, and add what only declares: a contract in `types\/` if the mod keeps `\$\.state`, checked against the build's types\./);
});

test('Scaffold gives the command that lays the three files again, and says it deletes nothing', () => {
  const scaffold = section(4);
  assert.match(scaffold, /When the gate names a file, lay the three again with `bash "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/scaffold\.sh" --again <mod folder> <mod-name>`, which writes over them and deletes nothing, and remove each file it lists as extra\./);
});

test('a mod of another shape is not reshaped at Scaffold: Red replaces the template\'s tests, Green its code', () => {
  assert.match(section(4), /That holds for a mod of another shape than a pane with a command too \(a band, a status line\): its tests replace the template's at Red and its code the template's at Green\./);
  assert.match(section(5), /Add tests to the scaffold's; when the mod is no pane with a command, replace the template's two tests with the mod's own\./);
  assert.doesNotMatch(section(5), /leave the ones recorded at Scaffold/);
});

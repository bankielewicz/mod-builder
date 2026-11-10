// Tests for what the build skill says of SPEC.md 7.9: a refusal carries the lines of the command that failed, the
// typecheck runs against every distinct types file, and the "Built on" line is copied from the gate, never composed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scriptsDir } from './test-helpers.mjs';
import { builtOnLine } from '../hooks/mod-builder-logic.ts';

const text = readFileSync(join(scriptsDir, '..', 'skills', 'build', 'SKILL.md'), 'utf8');
const body = text.slice(text.indexOf('\n---\n', 4) + 5);
// One phase's section of the skill: from its heading to the next phase's, or to the section after the phases.
const section = (number) => {
  const from = body.indexOf(`### ${number}. `);
  const next = body.slice(from + 4).search(/\n### [1-8]\. |\n## Handing /);
  return (from < 0 ? '' : body.slice(from, next < 0 ? undefined : from + 4 + next)).replace(/\s+/g, ' ');
};
const phases = body.slice(body.indexOf('## The phases'), body.indexOf('### 1. ')).replace(/\s+/g, ' ');

test('the skill says a refusal for a command carries the last lines that command printed, and to fix what they name', () => {
  assert.match(phases, /When it refuses for a command it ran \(the validator, the tests, the typecheck, the load\), the answer carries the last lines that command printed: fix what they name, and nothing else, then call the gate again\./);
});

test('Green says the typecheck runs against every distinct types file, that a failure names the file, and that its answer ends with the "Built on" line', () => {
  const green = section(6);
  assert.match(green, /The typecheck runs against every distinct types file that names itself this build's \(they differ between sessions of one build\), and a failure names the file it failed against\./);
  assert.match(green, /When Green passes, its answer ends with the "Built on" line for phase 7: keep it\./);
  assert.doesNotMatch(green, /not the same|stop and tell the person which files/);
});

test('Verify says to copy the "Built on" line from the gate exactly, never to compose it, and that a block lacking a hash is refused', () => {
  const verify = section(7);
  assert.match(verify, /Write the "Built on" line by copying it from Green's answer, exactly as the gate printed it: the gate composes that line, with the hash of every types file it checked against, and you never do\./);
  assert.match(verify, /It refuses a "Built" block that lacks one of those hashes, and prints the line again\./);
});

test('the shape of the "Built on" line the skill shows is the shape the gate prints', () => {
  const block = body.slice(body.indexOf('### 7. ')).match(/```markdown\n([\s\S]*?)```/)?.[1] ?? '';
  assert.equal(block.split('\n')[2], builtOnLine('<version>', '<stamp>', ['<hash>']));
});

test('the skill is still lean: under 200 lines, with no line over 115 characters outside its frontmatter', () => {
  assert.equal(text.split('\n').length < 200, true);
  assert.deepEqual(body.split('\n').filter((line) => line.length > 115 && !line.startsWith('|')), []);
});

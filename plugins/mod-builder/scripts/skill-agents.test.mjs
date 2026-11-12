// Tests for what the model and the person are told of the opt-in agents (SPEC.md 9.5, 9.33): one sentence in
// each skill under the request, a reference file both name, and the limits. The file quotes the rules' own words:
// a changed rule that the file does not follow fails here. The limits say plainly that the guard watches the
// file-editing tools only (the driving session, 2026-11-12).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scriptsDir } from './test-helpers.mjs';
import * as rules from '../hooks/mod-builder-logic.ts';

const plugin = join(scriptsDir, '..');
const NAMED = '`${CLAUDE_PLUGIN_ROOT}/reference/agents.md`';
const file = join(plugin, 'reference/agents.md');
const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
// The text with every run of white space as one space, so that a sentence broken over two lines still reads.
const flat = text.replace(/\s+/g, ' ');
const skill = (name) => readFileSync(join(plugin, 'skills', name, 'SKILL.md'), 'utf8');
// What a skill says before its first section of the second level: the request and the paragraph under it.
const opening = (name) => skill(name).split('\n## ')[0].replace(/\s+/g, ' ');
const limits = readFileSync(join(plugin, '..', '..', 'docs', 'limits', 'README.md'), 'utf8').replace(/\s+/g, ' ');
const WATCHES = 'The guard watches the file-editing tools only, so a shell command could still write a test or code: don\'t.';
const MOD = '/w/m';
// A record that uses agents, at a phase; and the guard's refusal for the main model's write of a path there.
const record = (phase, kind) => ({ ...rules.newRecord(MOD, 's1'), phase, agents: true, ...(kind === 'edit' ? { kind: 'edit' } : {}) });
const refusal = (phase, relPath) => rules.agentWriteVerdict({ record: record(phase), relPath, kept: undefined }).reason;

test('the build skill says under the request what a leading --agents asks for, names the reference file, and says that a shell command could still write a test or code', () => {
  assert.equal(opening('build').includes(`If nothing is written above, ask what the mod should do first. A leading \`${rules.AGENTS_WORD}\` asks for the plugin's agents: read ${NAMED} before Red. ${WATCHES}`), true);
});

test('the edit skill says the same in one statement of the order: the word, then the folder, then the change', () => {
  assert.equal(opening('edit').includes(`The mod's folder comes first and the change after it; if either is missing, ask for it before anything else. A leading \`${rules.AGENTS_WORD}\`, before the folder, asks for the plugin's agents: read ${NAMED} before Red. ${WATCHES}`), true);
  assert.equal(opening('edit').includes('The first word is'), false);
});

test('each skill names the file once and shows the word in its argument hint; its request line is still the first that opens with "> "; it stays under 200 lines and names no model', () => {
  for (const [name, hint] of [['build', '[--agents] <what the mod should do>'], ['edit', '[--agents] <mod folder> <what to change>']]) {
    const body = skill(name);
    assert.equal(body.split(NAMED).length - 1, 1, name);
    assert.equal(body.split('\n').includes(`argument-hint: ${hint}`), true, name);
    assert.equal(rules.asksForAgents(body.replace('$ARGUMENTS', `${rules.AGENTS_WORD} a pane`)), true, name);
    assert.equal(rules.asksForAgents(body.replace('$ARGUMENTS', `a pane ${rules.AGENTS_WORD}`)), false, name);
    assert.equal(body.split('\n').length < 200, true, name);
    assert.equal(body.endsWith('\n') && !body.endsWith('\n\n'), true, name);
    const after = body.replace(/^---\n[\s\S]*?\n---\n/, '');
    assert.deepEqual(after.split('\n').filter((line) => line.length > 115 && !line.startsWith('|')), [], name);
    assert.equal(/sonnet|opus|haiku/i.test(body), false, name);
  }
});

test('the reference file exists under its title, is short, and is plain ASCII with no line over 115 characters and no model named', () => {
  assert.equal(existsSync(file), true);
  assert.equal(text.startsWith('# The plugin\'s own agents (--agents)\n'), true);
  assert.equal(text.split('\n').length <= 70, true);
  assert.deepEqual(text.split('\n').filter((line) => line.length > 115), []);
  assert.equal(/^[\x20-\x7E\n]*$/.test(text), true);
  assert.equal(text.endsWith('\n') && !text.endsWith('\n\n'), true);
  assert.equal(/sonnet|opus|haiku/i.test(text), false);
});

test('it opens by saying when to read it and why the agents write: tests from a context that has not planned the code', () => {
  assert.equal(flat.includes(`Read this before Red when the request opened with \`${rules.AGENTS_WORD}\`. Two agents of mod-builder then write in your place, so that the tests come from a context that has not planned the code, and the code from one that did not write the tests. The phases, the spec, the gate and every word with the person stay yours.`), true);
});

test('it says who writes what at Red, Green and Verify, in the words of the guard\'s own refusals', () => {
  const said = (phase, relPath) => refusal(phase, relPath).match(/and at \w+ (only [^.]*)\. Start it/)?.[1];
  assert.equal(flat.includes(`**Red**, a returned Red too: ${said('red', 'tests/a.test.ts')}.`), true);
  assert.equal(flat.includes(`**Green**: ${said('green', 'hooks/register.tsx')}.`), true);
  assert.equal(flat.includes(`**Verify**: ${said('verify', 'lib/a.ts')}.`), true);
  assert.equal(flat.includes('The rest Green opens is yours: the manifest, the README, a declaration file under `types/`.'), true);
  assert.equal(flat.includes('`hooks/` and the tests are closed to everyone there.'), true);
  assert.equal(rules.mayWrite('verify', 'hooks/register.tsx') || rules.mayWrite('verify', 'tests/a.test.ts'), false);
  assert.equal(flat.includes('Every other phase and path is as without agents.'), true);
  // What the file calls yours at Green is the main model's by the rule, and what it calls the implementer's is not.
  for (const path of ['.claude-plugin/plugin.json', 'README.md', 'types/index.d.ts']) assert.deepEqual(rules.agentWriteVerdict({ record: record('green'), relPath: path, kept: undefined }), { allowed: true }, path);
  for (const path of ['hooks/hooks.json', 'lib/a.ts']) assert.equal(rules.agentWriteVerdict({ record: record('green'), relPath: path, kept: undefined }).allowed, false, path);
});

test('it says what a source file is, as the rule judges it: the endings, lib/x.d.ts counted, a declaration under types/ not', () => {
  const endings = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts'];
  assert.equal(flat.includes(`A source file is one whose name ends in ${endings.slice(0, -1).map((one) => `.${one}`).join(', ')} or .cts, anywhere in the mod: \`lib/x.d.ts\` counts, and a declaration file under \`types/\` does not.`), true);
  for (const one of endings) assert.equal(rules.isSourcePath(`lib/deep/x.${one}`), true, one);
  assert.deepEqual([rules.isSourcePath('lib/x.d.ts'), rules.isSourcePath('types/index.d.ts'), rules.isSourcePath('README.md'), rules.isSourcePath('lib/x.json')], [true, false, false, false]);
});

test('it quotes the refusal a write of the main model gets at Red, word for word', () => {
  assert.equal(flat.includes(`A write of yours there is refused, for example: "${refusal('red', 'tests/a.test.ts')}"`), true);
});

test('it says how each agent is started, in the gate\'s own words, and at which phases each is offered', () => {
  assert.equal(flat.includes(`${rules.agentStart('test-writer')}, at Red; with subagent_type "${rules.IMPLEMENTER}" at Green or Verify.`), true);
  assert.equal(rules.agentStart('implementer').includes(`subagent_type "${rules.IMPLEMENTER}"`), true);
  assert.deepEqual([rules.agentPhases('test-writer'), rules.agentPhases('implementer')], [['red'], ['green', 'verify']]);
  assert.equal(flat.includes('The gate\'s answer that opens Red, Green or Verify names the agent. The test-writer is in your list of agent types at Red only, the implementer at Green and Verify; at Done neither can be started.'), true);
  for (const role of rules.AGENT_ROLES) assert.equal(rules.agentOffered(role, 's1', { modDir: MOD, agents: true }, record('done')), false, role);
  for (const phase of ['red', 'green', 'verify']) assert.notEqual(rules.agentNote(record(phase), phase), '', phase);
});

test('it says a teammate is refused and why, as the spawn\'s refusal does', () => {
  const said = rules.spawnRefusal({ subagentType: rules.TEST_WRITER, isTeammate: true, sessionId: 's1', entry: { modDir: MOD, agents: true }, record: record('red') });
  assert.equal(said.includes('a teammate\'s writes do not pass mod-builder\'s guard'), true);
  assert.equal(flat.includes('Never as a teammate: a teammate\'s writes do not pass mod-builder\'s guard, so that spawn is refused.'), true);
});

test('it says what an agent may call, as the rule lists it, and what it lacks', () => {
  const listed = rules.agentCallRefusal('test-writer', 'Bash').match(/may call (.*) only, not Bash$/)?.[1];
  assert.equal(listed, 'Read, Grep, Glob, Write and Edit');
  assert.deepEqual([...rules.AGENT_TOOLS], ['Read', 'Grep', 'Glob', 'Write', 'Edit']);
  assert.equal(flat.includes(`mod-builder's hooks let it call ${listed} only, and hand its report back; a server-side tool such as the advisor never reaches them. It has no shell, no skills and no CLAUDE.md, and it can't call the gate: mod-builder runs every check when you do.`), true);
  for (const tool of ['MultiEdit', 'NotebookEdit', 'Bash', 'Agent', 'advisor', 'mcp__mod-builder__mod_builder_gate']) assert.equal(rules.agentMayCall(tool), false, tool);
  for (const tool of rules.AGENT_TOOLS) assert.equal(rules.agentMayCall(tool), true, tool);
  assert.equal(rules.agentMayCall(rules.READER_HANDBACK), true);
});

test('it says what to pass an agent: facts, and never the tests or the code to copy, with the reason', () => {
  for (const line of [
    '- the mod\'s folder, as an absolute path;',
    '- the path of `SPEC.md` and, in an edit, the heading of the section for this change;',
    '- the path of the types file Describe wrote, and that the spec\'s citations name the API (it can\'t run the lookup);',
    '- the gate\'s last refusal, word for word, when there is one;',
    '- for the implementer: the names of the failing tests and the files they are in.',
  ]) assert.equal(flat.includes(line), true, line);
  assert.equal(flat.includes('Never pass the tests or the code for it to copy. An agent that types out what you planned adds nothing, and the person asked for `--agents` to get tests that were not shaped by the code you have in mind.'), true);
});

test('it says what to do when the agent has reported, at a refusal, at a returned Red, and when an agent fails', () => {
  assert.equal(flat.includes('Call the gate. When it refuses, or the test reader has findings, start the agent again with the refusal word for word.'), true);
  assert.equal(flat.includes('The way back to Red is as without agents (`back-to-red.md` beside this file); at the returned Red the test-writer writes again.'), true);
  assert.equal(existsSync(join(plugin, 'reference/back-to-red.md')), true);
  assert.equal(flat.includes('When an agent is refused or fails, say so to the person; `/mod-builder stop` is the way out, as always.'), true);
});

test('it says plainly that the guard watches the file-editing tools only, so a shell command could still write a test or code', () => {
  assert.equal(flat.includes('**The guard watches the file-editing tools only** (Write, Edit, MultiEdit, NotebookEdit). You could still write a test or code through a shell command, and mod-builder does not see who a shell command wrote for.'), true);
  assert.equal(flat.includes('Don\'t: the person asked for tests and code that the agents wrote.'), true);
  for (const tool of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']) assert.equal(rules.isGuardedTool(tool), true, tool);
  assert.equal(rules.isGuardedTool('Bash'), false);
});

test('it lists the other limits: the prompt is the main model\'s, teammates of other types and the advisor, other plugins, the session\'s model, headless', () => {
  assert.equal(flat.includes('What an agent is asked is your prompt. mod-builder sees who wrote a file, not what they were told to write.'), true);
  assert.equal(flat.includes('A teammate of any other type, and the advisor, are outside the guard. Another plugin can deny or rewrite a spawn. The agents run on what the session gives them. None of this was run headless.'), true);
  assert.equal(rules.spawnRefusal({ subagentType: 'general-purpose', isTeammate: true, sessionId: 's1', entry: { modDir: MOD, agents: true }, record: record('red') }), null);
});

test('docs/limits says first and plainly that the guard watches the file-editing tools only, and that a shell command is not seen', () => {
  const from = limits.indexOf('## The plugin\'s own agents (0.3.0, not released)');
  assert.notEqual(from, -1);
  const section = limits.slice(from, limits.indexOf(' ## ', from + 4));
  assert.equal(section.startsWith('## The plugin\'s own agents (0.3.0, not released) - **The guard watches the file-editing tools only.**'), true);
  assert.equal(section.includes('In a build or edit started with `--agents`, the guard refuses the main model\'s `Write`, `Edit`, `MultiEdit` and `NotebookEdit` of a test at Red and of code at Green, and lets only the test-writer or the implementer through.'), true);
  assert.equal(section.includes('A shell command is not one of those tools: the main model could still write a test or code through one, and mod-builder does not see who a shell command wrote for. The two agents themselves have no shell.'), true);
});

test('docs/limits lists the other limits of the agents: the prompt, teammates and the advisor, other plugins, the model, headless, Verify and Done', () => {
  for (const line of [
    '**What an agent is asked is the main model\'s prompt.** mod-builder sees which agent wrote a file, not what it was told to write',
    '**A teammate is refused only for these two types.** A teammate\'s writes never reach the guard,',
    'so such a file can\'t be written until the build is replaced or stopped',
    'a test-writer or implementer started as one is refused at its spawn; a teammate of any other type, and the advisor, stay outside the guard.',
    '**Another plugin can deny or rewrite a spawn**, and the agents run on the model the session gives them: none is named. A build with `--agents` was not run headless.',
    '**At Verify a source file outside `hooks/` is still the implementer\'s**; once the build is Done no agent can be started',
  ]) assert.equal(limits.includes(line), true, line);
  assert.equal(rules.agentWriteVerdict({ record: record('done'), relPath: 'lib/a.ts', kept: undefined }).allowed, false);
  assert.equal(rules.agentOffered('implementer', 's1', { modDir: MOD, agents: true }, record('done')), false);
});

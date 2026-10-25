// The fence hook (Change 0.10.0, #156): hooks/fence.sh, run as Claude Code runs a PreToolUse command hook, with the
// call's JSON on stdin. Outside the kit, since the kit refuses child_process: `node --test mods/issue-forge/scripts/`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'fence.sh')
const ROOT = '/srv/run/wt'
const PLUGIN = '/opt/plugins/issue-forge'
const ID = 'aissue-forge-16-red-1-0123456789abcdef'
const NAME = 'issue-forge-16-red-1'
const now = () => Math.floor(Date.now() / 1000)

/** A home with the given fence files: `{ 'id/<id>': 'live …' }`. */
function home(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'fence-'))
  for (const [rel, text] of Object.entries(files)) {
    const path = join(dir, '.claude', 'issue-forge-data', 'fence', rel)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${text}\n`)
  }
  return dir
}

const live = (root = ROOT, until = now() + 60) => `live ${until} ${root}`

/** Runs the script on one call; `raw` sends the text as it is, `script` runs another copy of it. */
function hook(call, { files = { [`id/${ID}`]: live() }, raw, script = SCRIPT } = {}) {
  const dir = home(files)
  try {
    const input = raw ?? JSON.stringify({ session_id: 's1', transcript_path: '/t', cwd: '/srv/session', hook_event_name: 'PreToolUse', tool_use_id: 'toolu_1', ...call })
    const r = spawnSync('bash', [script], { input, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir, CLAUDE_PLUGIN_ROOT: PLUGIN } })
    return { code: r.status, err: r.stderr }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const agent = (tool_name, tool_input, who = {}) => ({ agent_id: ID, agent_type: NAME, tool_name, tool_input, ...who })
const passes = r => assert.deepEqual(r, { code: 0, err: '' })
const refused = r => {
  assert.equal(r.code, 2)
  assert.match(r.err, /^issue-forge: /)
}

test('the main thread passes', () => passes(hook({ tool_name: 'Bash', tool_input: { command: 'rm -rf /' } })))

test("another plugin's agent passes", () => passes(hook({ agent_id: 'aother-1', agent_type: 'reviewer', tool_name: 'Write', tool_input: { file_path: '/etc/x', content: 'x' } }, { files: {} })))

test('an issue-forge agent with no fence file is refused, by either form of its type', () => {
  refused(hook(agent('Read', { file_path: `${ROOT}/a.ts` }), { files: {} }))
  refused(hook(agent('Read', { file_path: `${ROOT}/a.ts` }, { agent_type: 'issue-forge:green' }), { files: {} }))
})

test('a retired agent is refused every tool, Read included', () => {
  const files = { [`id/${ID}`]: 'retired' }
  refused(hook(agent('Read', { file_path: `${ROOT}/a.ts` }), { files }))
  refused(hook(agent('Bash', { command: `cd '${ROOT}' && ls` }), { files }))
})

test('a live line past its time is refused as retired', () => refused(hook(agent('Read', { file_path: `${ROOT}/a.ts` }), { files: { [`id/${ID}`]: live(ROOT, now() - 5) } })))

test("a teammate's name file stands in until its id file exists", () => {
  passes(hook(agent('Write', { file_path: `${ROOT}/a.ts`, content: 'x' }), { files: { [`name/${NAME}`]: live() } }))
  refused(hook(agent('Write', { file_path: '/srv/session/a.ts', content: 'x' }), { files: { [`name/${NAME}`]: live() } }))
})

test('an id or type the fence can\'t use as a file name is refused for an issue-forge agent', () => {
  refused(hook(agent('Read', { file_path: `${ROOT}/a.ts` }, { agent_id: '../../x' })))
})

test('a live agent edits under its root, a relative path read against the root', () => {
  passes(hook(agent('Edit', { file_path: `${ROOT}/src/a.ts`, old_string: 'a', new_string: 'b' })))
  passes(hook(agent('Write', { file_path: 'src/a.ts', content: 'x' })))
  passes(hook(agent('NotebookEdit', { notebook_path: `${ROOT}/n.ipynb`, new_source: 'x' })))
})

test('a live agent is refused an edit outside its root, or one it can\'t place', () => {
  refused(hook(agent('Write', { file_path: '/srv/session/a.ts', content: 'x' })))
  refused(hook(agent('Edit', { file_path: `${ROOT}/../session/a.ts`, old_string: 'a', new_string: 'b' })))
  refused(hook(agent('Write', { file_path: '~/a.ts', content: 'x' })))
  refused(hook(agent('Write', { file_path: 'D:a.ts', content: 'x' })))
  refused(hook(agent('Write', { file_path: '\\\\server\\share\\a.ts', content: 'x' })))
  refused(hook(agent('Write', { file_path: `${ROOT}-other/a.ts`, content: 'x' })))
  refused(hook(agent('Write', { file_path: `${PLUGIN}/hooks/fence.sh`, content: 'x' })))
  refused(hook(agent('NotebookEdit', { notebook_path: '/srv/session/n.ipynb', new_source: 'x' })))
})

test("a live agent's Bash must start with cd <root> &&, the root bare, single- or double-quoted", () => {
  refused(hook(agent('Bash', { command: 'npm test' })))
  refused(hook(agent('Bash', { command: `npm test && cd '${ROOT}'` })))
  passes(hook(agent('Bash', { command: `cd '${ROOT}' && npm test` })))
  passes(hook(agent('Bash', { command: `cd ${ROOT} && npm test 2>/dev/null` })))
  passes(hook(agent('Bash', { command: `cd "${ROOT}" && git status` })))
})

test("a live agent's Bash naming a path outside its root is refused", () => {
  for (const tail of ['cat /etc/passwd', 'ls ~/.ssh', 'echo $HOME', 'echo ${HOME}/x', 'cd -', 'cat ../x', 'cd $OLDPWD', 'ls /srv/session', 'cat C:/Users/x', `cat ${PLUGIN}/hooks/fence.sh`, 'rm .claude/issue-forge-data/fence/x', 'touch out --path=/tmp/x']) {
    refused(hook(agent('Bash', { command: `cd '${ROOT}' && ${tail}` })))
  }
})

test("a live agent's Bash naming only its root, /dev/null and relative paths passes", () => {
  passes(hook(agent('Bash', { command: `cd '${ROOT}' && grep -rn foo src > /dev/null; ls ${ROOT}/src && cat src/a.ts 2>/dev/stderr` })))
})

test('a newline in the command splits words, so a path after it is still seen', () => {
  refused(hook(agent('Bash', { command: `cd '${ROOT}' && ls\ncat /etc/passwd` })))
})

test('an ambiguous parse is refused: a key found twice', () => {
  const raw = `{"agent_id":"${ID}","agent_type":"${NAME}","tool_name":"Bash","tool_input":{"command":"cd '${ROOT}' && ls","command":"rm -rf /"}}`
  refused(hook({}, { raw }))
  const twoIds = `{"agent_id":"${ID}","agent_id":"aother","agent_type":"${NAME}","tool_name":"Read","tool_input":{"file_path":"${ROOT}/a"}}`
  refused(hook({}, { raw: twoIds }))
})

test("an escaped key inside the command's text doesn't count as a second key", () => {
  passes(hook(agent('Bash', { command: `cd '${ROOT}' && echo '"command":"x"'` })))
})

test('a root holding a blank: a path under it passes, a word beside it is refused', () => {
  const root = '/mnt/c/My Repo/wt'
  const files = { [`id/${ID}`]: live(root) }
  passes(hook(agent('Bash', { command: `cd '${root}' && ls '${root}/src'` }), { files }))
  passes(hook(agent('Write', { file_path: `${root}/a.ts`, content: 'x' }), { files }))
  refused(hook(agent('Bash', { command: `cd '${root}' && ls /mnt/c/My` }), { files }))
})

test('Read, Grep and Glob pass for a live agent, wherever they point', () => {
  passes(hook(agent('Read', { file_path: '/etc/hosts' })))
  passes(hook(agent('Grep', { pattern: 'x', path: '/srv/session' })))
  passes(hook(agent('SendMessage', { to: 'team-lead', message: 'done' })))
})

test("an unreadable fence line is refused, and so is a call whose tool name can't be read", () => {
  refused(hook(agent('Read', { file_path: `${ROOT}/a` }), { files: { [`id/${ID}`]: 'live soon' } }))
  refused(hook({}, { raw: `{"agent_id":"${ID}","agent_type":"${NAME}","tool_input":{"file_path":"${ROOT}/a"}}` }))
})

test('MultiEdit gets the path check Edit gets', () => {
  passes(hook(agent('MultiEdit', { file_path: `${ROOT}/a.ts`, edits: [{ old_string: 'a', new_string: 'b' }] })))
  refused(hook(agent('MultiEdit', { file_path: '/srv/session/a.ts', edits: [{ old_string: 'a', new_string: 'b' }] })))
})

test("a write-capable tool the fence can't check is refused for a live issue-forge agent, and passes for anyone else", () => {
  for (const [tool, input] of [['PowerShell', { command: 'Set-Content x y' }], ['EnterWorktree', { name: 'w' }], ['ExitWorktree', {}], ['mcp__fs__write_file', { path: '/x', content: 'y' }]]) {
    refused(hook(agent(tool, input)))
    passes(hook({ agent_id: 'aother-1', agent_type: 'reviewer', tool_name: tool, tool_input: input }, { files: {} }))
    passes(hook({ tool_name: tool, tool_input: input }))
  }
})

test("hooks.json runs the fence, in exec form, for the tools that can change something and no others", () => {
  const hooks = JSON.parse(readFileSync(join(dirname(SCRIPT), 'hooks.json'), 'utf8'))
  assert.deepEqual(hooks.modules, ['./register.tsx'])
  const [entry, ...rest] = hooks.hooks.PreToolUse
  assert.equal(rest.length, 0)
  assert.equal(entry.matcher, '^(Bash|PowerShell|Edit|MultiEdit|Write|NotebookEdit|EnterWorktree|ExitWorktree|mcp__.*)$')
  assert.deepEqual(entry.hooks, [{ type: 'command', command: 'bash', args: ['${CLAUDE_PLUGIN_ROOT}/hooks/fence.sh'] }])
  const matches = tool => new RegExp(entry.matcher).test(tool)
  for (const tool of ['Bash', 'PowerShell', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'EnterWorktree', 'ExitWorktree', 'mcp__github__create_issue']) assert.equal(matches(tool), true, tool)
  for (const tool of ['Read', 'Grep', 'Glob', 'Agent', 'SendMessage', 'WebFetch', 'BashOutput', 'TodoWrite']) assert.equal(matches(tool), false, tool)
})

test("the module's preflight call is refused with an issue-forge: reason", () => {
  const r = hook({ agent_id: 'issue-forge-fence-check', agent_type: 'issue-forge-0-red-0', tool_name: 'Edit', tool_input: { file_path: '/' } }, { files: {} })
  refused(r)
})

/** A copy of the script that reads its bash as 4.1: BASH_VERSINFO is read-only, so the copy reads another array. */
function onOldBash() {
  const dir = mkdtempSync(join(tmpdir(), 'fence-old-'))
  const path = join(dir, 'fence.sh')
  const [shebang, ...rest] = readFileSync(SCRIPT, 'utf8').replaceAll('BASH_VERSINFO', 'OLD_VERSINFO').split('\n')
  writeFileSync(path, [shebang, 'OLD_VERSINFO=(4 1)', ...rest].join('\n'))
  return { path, done: () => rmSync(dir, { recursive: true, force: true }) }
}

test('on bash before 4.2 the preflight gets the version refusal, so no agent starts (PR #162 review round 1, finding 2)', () => {
  const old = onOldBash()
  try {
    const r = hook({ agent_id: 'issue-forge-fence-check', agent_type: 'issue-forge-0-red-0', tool_name: 'Edit', tool_input: { file_path: '/' } }, { files: {}, script: old.path })
    refused(r)
    assert.match(r.err, /needs bash 4\.2 or later/)
    assert.match(hook(agent('Edit', { file_path: `${ROOT}/a.ts` }), { script: old.path }).err, /needs bash 4\.2 or later/)
    passes(hook({ tool_name: 'Bash', tool_input: { command: 'ls' } }, { script: old.path }))
    passes(hook({ agent_id: 'aother-1', agent_type: 'reviewer', tool_name: 'Write', tool_input: { file_path: '/etc/x', content: 'x' } }, { files: {}, script: old.path }))
  } finally {
    old.done()
  }
})

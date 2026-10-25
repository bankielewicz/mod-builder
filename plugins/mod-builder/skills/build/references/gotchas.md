# Engine gotchas

Each rule has broken a real mod. The source tag says how we know it:

- **[d.ts]**: stated in the bundled `claude-code.d.ts` (2.1.296)
- **[probe]**: measured live in this repo
- **[field]**: reported by authors of published mods, and consistent with the d.ts

Re-check [field] items against the d.ts after a Claude Code update.

## Budget and time

- **[d.ts] [probe] A hook has 10 s of its own time; `$` calls don't count, except `$.clock` waits.**
  `await $.process.run(['/bin/sleep','1'])` ×12 survives; `await $.clock.sleep(1000)` ×12 times
  out. To wait inside a hook (for example, holding a tool call until a slot frees), wait on a `$`
  call that isn't the clock, or return and do the work in the background.
- **[probe]** Awaiting a promise that other hooks' work settles counts as the hook's own time. On
  2.1.300, Mod Lab's `lab_report` hook awaited a scan that another hook had started (single flight)
  plus the pass it queued, a wait that would have lasted about 18 s. It failed 10.0 s after it began with
  `{"kind":"timeout"}`, and its `.catch` answered. So a hook that joins shared background work
  needs that work to end well inside its 10 s, or must return first (PR #74's SPEC, Change 0.2.14).
- **[d.ts]** A `.catch` handler gets a fresh 1 s. Keep it trivial.
- **[d.ts]** After an abort (Esc, a hook above settling first), a hook may linger 5 s before it's
  reported. Pass `next.signal` to `$.clock.sleep` so the wait ends with the dispatch. `$.ui.ask` takes
  no signal. It rejects when dismissed, so wrap it in the guard's `.catch`.
- **[d.ts]** A hot reload cancels pending `$.clock` waits and timers. Module variables restart, while
  `$.state` and `$.store` survive.
- **[d.ts]** A change to a plugin's options reloads it, and `register` runs again with the new
  options. `session.start` fires "once per fresh load of one" plugin: "an enable, a worker respawn,
  or a reload (changed modules only ...)" (2.1.300). Inferred, not yet probed: an options reload
  fires `session.start` too, so a mod can clear there what its old module left in atoms.

## Registration

- **[field]** One hook per event and matcher per plugin. A second registration throws. Merge
  concerns, or use a distinct matcher.
- **[field]** In one plugin holding several mods, registration order is hook order. Register first
  whichever must see an event first.
- **[field]** `$.command.register` rejects a name Claude Code already has (`/agents`, `/recap`, …).
  Without `.catch(() => {})` the rest of `session.start` never runs.
- **[d.ts]** `$.tool.register` rejects until the session binds. Call it in `session.start`, and
  answer the tool with a `tool.call` hook on `{ tool: 'mcp__<plugin>__<name>' }`. A call no hook
  answers fails.

## Commands and panes

- **[probe]** A plugin can register a command named the same as itself (`mod-builder` registering
  `/mod-builder`) while it also has skills `mod-builder:build` and `mod-builder:edit`. Under
  `claude -p --plugin-dir`, `/mod-builder config` reached the command and both skills were still
  listed (2026-10-13, 2.1.296).
- **[field]** A `command.run` hook that awaits its own pane can deadlock or time out, with the
  message "registered /x but no command.run hook answered it". **[probe]** Not reproduced on
  2.1.296 or 2.1.301 (2026-10-15, #90): `await $.ui.open(…)` in a `command.run` hook answered at
  once and the pane drew. Either way, call `$.ui.open` before the hook returns, awaited or as
  `void openPane($)` with no `await` ahead of it. Put slow work (a scan) after the open, in
  `void (async () => …)().catch(…)`. An open made after such work runs after the hook and counts
  as unasked.
- **[field]** Track whether the pane is open with `$.ui.panes()`, not a module flag. Reloads and
  Esc-closes desync flags.
- **[d.ts]** A pane opened unasked (from a timer or hook, with no command, press or prompt behind
  it) is placed only from 144 columns (110 once asked before). Otherwise it waits undrawn with
  `isPlaced: false`. Open from a command or button, and toast when it isn't placed.
- **[probe]** A `tool.call` hook is never asked (2.1.301, #90). Opened from the `Skill` tool's
  call (Claude starting `/mod-builder:build` from a plain-words request), `$.ui.open` resolved
  `isPlaced: false`, reason "unasked below 110 columns (97 now, an id the person opened before)".
  A skill the person types (`/plugin:skill args`) reaches `command.run` as
  `{ command: 'plugin:skill', args, origin: { kind: 'composer' } }`, and an open from that hook is
  asked. Return `next(e)` to run the skill.
- **[d.ts]** `ui.render` runs once per input. A repaint reuses the answer. To redraw on a timer,
  update an atom the render reads, or call `$.ui.invalidate('ui.render')`.
- **[d.ts]** A tree that doesn't validate draws the engine's own. Under `--plugin-dir`, a dim
  transcript line says why, and `claude --debug` logs every case.

## Modules

- **[probe]** `$` may only be passed to functions **declared at the top level of `register.tsx`**
  (a `function` declaration, or a top-level `const` bound to one). That rules out imported
  functions and closures declared inside `register`; validate fails with "$ is passed to "x",
  which is not a function declared at the top of this file". Keep module state in top-level
  `let`s that `register` assigns. Helpers in other files take plain values only.
- **[probe]** `atom({ plugin, key })` needs **string literals** for `plugin` and `key`, not a
  `NAME` constant. Validate refuses anything else, because it reads state refs statically.
- **[probe]** Spell the `command.run` matcher and the `$.command.register` name as the same literal.
  Validate then lists it as "answers its own command" rather than as a gate without `.catch`.
  The same goes for a tool matcher: a template string shows as `tool.call{tool=?}`.
- **[probe]** A child from `$.process.run` inherits the host environment unless Claude Code's opt-in
  `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1` is set. Probed on 2.1.296 with `AWS_SECRET_ACCESS_KEY`,
  `OPENAI_API_KEY` and `ANTHROPIC_AWS_API_KEY` set to `dummy`: `printenv` found all three without the
  scrub, and none with it (exit 1), `OPENAI_API_KEY` included. `init.env: { NAME: '' }` sets the
  variable to an empty string (exit 0, empty output); it doesn't unset it. `$.env` can't list
  variables, so a mod that must keep a secret from a child blanks an explicit list of names.
  `init.env` is typed `Record<string, string>` [d.ts], so it can't unset a variable either, and an
  empty value isn't neutral for a path: with `CLAUDE_CONFIG_DIR=''`, `claude auth status` reports
  `configDirectory: ""` (probed on 2.1.296). Blank secrets, never paths or profile names.
- **[probe]** `$.fs.list` isn't limited to the session folder. Probed on 2.1.299 with `claude -p --plugin-dir`
  started in `fx/pkg/sub`: it listed `fx/.claude/agents`, two folders above the session folder, then its
  subfolder `team` and its dot-folder `.dot`. A symbolic link to a file or a folder is listed as
  `other` with `isLink` (size and `mtimeMs` 0); listing the link's own path still follows it and
  returns the target's entries, so a walk that must not follow links skips `isLink` entries itself; to follow one, `$.fs.stat(path)` gives the kind it leads to. A missing
  folder rejects with `ENOENT`, so wrap the call (`.catch(() => [])`) when a missing folder is normal.
- **[probe]** `$.fs.stat` tells a missing path from one it can't read; `$.fs.exists` doesn't. Probed on 2.1.309 with
  `claude -p --plugin-dir`: `stat` of a deleted folder rejects with a `HooksError` whose message is
  `<plugin>: $.fs.stat(<path>) failed: ENOENT`, and under a folder with mode 000 `… failed: EACCES`; the error
  has no `.code`, so read the message's ending. `exists` answers `false` for both. A WSL drive that isn't there
  (`/mnt/z/…`) rejects with `ENOENT` like a deleted folder, and on Linux `//host/share/…` is read as
  `/host/share/…`. Mod Lab 0.2.30 prunes a folder's stored results only on that `ENOENT` ending (#138).
- **[probe]** Claude Code's own subagent discovery, for a mod that mirrors it. Read from the `agents` list in
  the `init` message of `claude -p --output-format stream-json --verbose`, on 2.1.299 and 2.1.300. Project
  `.claude/agents/` folders are found walking up from the session folder to the nearest folder holding a `.git`
  entry, even an empty folder or file that git rejects; with none, the walk goes on up (4 levels probed).
  Symbolic links are followed: a linked file, a linked subfolder and a linked `.claude/agents`. Dot-folders and
  subfolders 9 and 12 deep are read. A file with a `name` but no `description` is left out, and so is one Claude
  can't read; a `name` or `description` on the next indented line, a `description: >` block, and a file with
  `bad: [` in another field are loaded (the `.git` stop and the unreadable file were probed on 2.1.299 only; the next-line `name`, the `>` block and a wrapped `description` on 2.1.300 only).
- **[probe]** `$.process.spawn` of a binary that exists starts it: under `claude -p --plugin-dir` on 2.1.300,
  `codex --version` resolved on the first pull (one stdout chunk, exit 0), also with an `env` map and with
  `input`. The first pull rejected, after 0 chunks, in the three failing cases probed: a name not on PATH
  (`$.process.spawn(<name>) failed to start: ENOENT: Executable not found in $PATH: "<name>"`), a plain file
  without execute permission (`/etc/passwd`) and a directory (`/tmp`) (both `failed to start: EACCES: EACCES:
  permission denied, posix_spawn '<path>'`). `$.process.run` of the same argv rejected in each of those
  cases too, within 300 ms, with the same message. So a mod's `$.process.run` fallback for a spawn that could
  not start fails as well in every case probed; it completes under `claude plugin test`, where spawn can't be
  stubbed and run can. `$.process.run` is capped at ten minutes [d.ts], so a streamed run's longer timeout
  does not carry over to that fallback. Interactive sessions: not tested.
- **[d.ts]** There's no Node, DOM or `require`. Every file is an ES module named `.ts/.tsx/.js/.mjs/…`,
  and anything else isn't loaded. The outside world is reached only through `$`.
- **[field]** JSX compiles to `h(...)` and `Fragment`. A local variable named `h` breaks every
  element after it.
- **[field]** Never write files inside the plugin folder. An installed copy may be read-only or
  replaced on update. Use `~/.claude/<name>-data/`.
- **[field]** A floating promise fails tests at teardown. Write `void p.catch(() => undefined)`.

- **[probe]** `$.store` reads the plugin's JSON file on each `get`, so it is shared live between
  sessions (2.1.300). One process saw a key another had set 6 s before. Two processes each set 200
  different keys over the same 0.7 s, and all 400 were there afterwards. Writes to the same key: the
  last one wins. So give each session's records their own key (issue-forge: one per repository and
  issue) rather than a list that two sessions would both rewrite.
- **[d.ts]** `$.store` is one store per plugin, and `set` rejects a store over 4 MiB of JSON for every
  key together, so a mod that keeps a record per item (a run, a folder) bounds what it keeps, or its
  own saves start failing (issue-forge 0.9.0, Mod Lab 0.2.30).
- **[probe]** What the limits count, probed on 2.1.309 with `claude -p --plugin-dir`:
  - Characters of compact JSON, not UTF-8 bytes: 1,500,000 `€` (4.5 MB as UTF-8) was stored.
  - The whole store: 2,500,000 characters, then 2,000,000 more under another key, was refused with
    `<plugin>@inline: $.store.set: the store would be 4509163 characters, over the 4194304 limit`.
  - One value on its own: a string of 4,194,305 characters was refused with `the value is 4194307
    characters, over the 4194304 limit`, its JSON with the two quotes.
  - A key: 256 characters was stored, while 257 was refused by `set` and `get` alike, `$.store.set: the
    key is 257 characters, over the 256 limit`. A key that holds a path (issue-forge's git folder) can
    reach that.
- **[d.ts]** Every `$.state.get` of one dispatch reads one moment, "whatever is written meanwhile". A
  hook that awaits another hook's write (a scan it waits for) and then reads the atom again gets the
  old value, not the write.
- **[probe]** The moment is fixed at the dispatch's first `get`, of any atom, not at its start and not per
  atom. In `claude plugin test` (2.1.300, Change 0.2.14's held test) a `lab_report` hook whose first read
  came before the scan it then awaited re-read the same empty list. Live, on 2.1.300 with a throwaway
  `claude -p --plugin-dir` mod whose command awaits a nested `$.tool.call` that another hook answers with
  a state write: a re-read of an atom that hook had written read the old value (0, written to 1); an atom
  written before the dispatch's first `get` read the new value on that first `get`; an atom first read
  after another atom's `get` and its own write read the old value. So decide whether to wait for a scan
  before the first read: from module state, or from what the hook itself holds.
- **[probe]** The moment lasts only while the hook is open. Work it leaves running (`void work($)`) reads
  live once the hook has returned, `/clear`'s reset included. Probed on 2.1.296 and 2.1.307 (PR #127)
  with a throwaway mod: a command read an atom set to 5 and left a read waiting on a gate; after `/clear`
  the waiting read got 0, and without `/clear` it got a value written after the command. `claude plugin
  test` (2.1.307) does the same: a scan pass queued on a returned hook's `$` read a later write.
- **[d.ts]** `session.end` also fires on `/clear` and `/resume` (`e.reason` `clear`, `resume`), and
  the process goes on under a new `$.session.id()`. A mod that lets go of something at session end
  checks the reason; its background work keeps running.
- **[probe]** After `/clear`, every atom reads its initial value again and `session.start` doesn't
  run. `classic.SessionStart` fires with `e.source` `clear` after that reset (an atom read in it already
  reads the initial value), so it is where a mod seeds its atoms again. A `{ source: ['clear', 'resume',
  'fork'] }` matcher loads, and `claude plugin validate` counts the hook as gating (`gating hook without
  .catch: classic.SessionStart{source=clear|resume|fork}`). Probed on 2.1.296 and 2.1.306 (#119): a
  throwaway mod set an atom to 42 in `session.start`; headless `claude -p --input-format stream-json`
  with `/probe-state`, `/clear`, `/probe-state` read 42, then 0, and 0 inside the hook.
- **[probe]** `classic.SessionStart` fires **before** `session.start` at startup (`source: startup`) and
  at a resumed startup, `claude --continue` (`source: resume`). A `{ source: ['clear', 'resume',
  'fork'] }` hook therefore runs once before the module's `session.start` has set anything up. Probed on
  2.1.296 and 2.1.306 (PR #124 review) with a throwaway mod logging both events, run headless twice in
  one folder: `classic:startup > session.start`, then `classic:resume > session.start`.
- **[probe]** `$.command.register` accepts `immediate: true` on 2.1.296 and 2.1.306: it resolves
  `{ command }` and the command runs. A build that refused the field would lose the command behind the
  house `.catch(() => {})`. Whether 2.1.296 runs it mid-turn wasn't probed (#119).
- **[probe]** Esc during a `tool.call` hook that waits on a `$.process.spawn` loop aborts `next.signal`,
  and the engine kills the child: the loop throws `<plugin>: $.process.spawn(<cmd>) aborted`, and a
  `$.process.run` the hook starts after that rejects `<plugin>: $.process.run(<cmd>) aborted` without
  running. A spawn the same hook started `void` before returning survives Esc and runs until the module
  unloads. After the abort, `update` (state), `read`, `$.ui.toast`, `$.store.set` and `$.fs.write` still
  work, in the hook and from a `$.clock.after` callback: only new process work is refused, and only in
  the aborted hook. A `$.process.run` from a `$.clock.after` callback, at 0 ms or later, runs (duet
  0.3.3 runs `git status` there to name what a stopped Codex run changed). Probed on
  2.1.306 (#119) with throwaway mods holding a Bash call over `sleep` children, in a private tmux
  session, checked with `pgrep -x sleep` (`$.fs.write`: duet 0.3.3's live check logged its stopped runs).
  Not probed on 2.1.296.
- **[probe]** Under `claude plugin test`, nothing beneath the plugin answers `session.end`: a test that
  fires it needs `on('session.end', ($, e) => ({ sessionId: e.sessionId }))`, as `session.start` needs
  its stub.

- **[probe]** `classic.PostToolBatch` reaches a hooks module for the main loop's tools: once per batch,
  after that batch's `classic.PostToolUse` events, with `e.tool_calls` (`tool_name`, `tool_input`,
  `tool_use_id`, `tool_response?`). Probed on 2.1.301 (#100) with a throwaway mod that logged each event,
  run headless with `claude -p --plugin-dir`: two parallel Bash calls gave two `PostToolUse` then one
  `PostToolBatch` `["Bash","Bash"]`; a Write in the next message gave its own `PostToolBatch` `["Write"]`,
  though the headless classifier refused it (no `PostToolUse` for it). The hook fires before the next model
  request, so disk work in it is detached (`void … .catch`), as Mod Lab's rescan does. `claude plugin
  validate` warns that `classic.*` hooks "do not run in a plugin a person installs where an organization
  manages Claude Code: there, these events pass over the plugins you install, and only a plugin the
  organization lists in managed settings runs them".
- **[probe]** On `/mnt/c` (WSL drvfs, 2026-10-16), rewriting a file in place moves its mtime and not its
  folder's; writing a temp file and renaming it over moves the folder's. So a folder's mtime doesn't tell
  whether a file in it was edited (#100). Which of the two Claude's Write and Edit tools do is not probed.

## Subagents a mod spawns

- **[probe]** A mod's `$.agent.spawn` reaches other plugins as a `tool.call` of `Agent` (with
  `next.origin` naming the spawning plugin), then as `agent.spawn`. So duet routes it like a model's
  Agent call: with `codexAgents: "*"` a mod's unnamed agent goes to Codex. Passing a `name` keeps it
  on Claude, because duet leaves named calls alone.
- **[probe]** A spawn started from a `command.run` handler in `void (async () => …)()` outlives the
  handler. Its `turn.complete` (with the `agentId` and its `answer`) arrived about 10 s later. The
  subagent's own tool calls are `tool.call`s carrying that `agentId`. Its Write and Bash ran without
  a prompt under `defaultMode: "auto"`; other permission modes weren't checked. Whose hook saw those
  calls wasn't recorded. Which of a mod's own hooks get an agent's calls depends on when the spawn is
  made (the re-entry entry, below).
- **[probe]** Plain `claude -p "/cmd"` exits as soon as the command answers, so a detached spawn
  never even resolves. To keep a headless session alive, use `--input-format stream-json` with
  stdin held open, or test in an interactive session.
- **[probe]** When a subagent finishes, its report is handed back to the main loop as a
  `prompt.submit` with origin `peer`, which starts a main-model turn. The text starts
  `<agent-message from="<agentId>">` for an unnamed agent. A `prompt.submit` hook that returns
  `{ drop: reason }` for its own agents keeps the main model idle, and the `turn.complete` still
  arrives. The reason is shown to the person. With agent teams off, a named agent's text starts
  `<agent-message from="<name>">`. With them on, in an interactive session, a named agent is a
  teammate and hands back another way (next entry). Under `claude -p --input-format stream-json` with
  them on (2.1.310), a named spawn was an ordinary subagent (next entry); whether its text then starts
  with the name or the `agentId` wasn't checked.
- **[probe]** With agent teams on (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`), a named
  `$.agent.spawn` starts a teammate: its answer and its `$.agent.list()` entry carry
  `teammateId: "<name>@session-<id>"`, and its `agentId` reads `a<name>-<hex>`. With them off it's an
  ordinary subagent (`agentId: "a<hex>"`, no `teammateId`). Either way, its `tool.call`s carry the
  `agentId` the spawn returned (2.1.296). On 2.1.310 the spawning mod's own `tool.call` hook didn't
  get them at all for a spawn made after its hook had returned (the re-entry entry, below). When that
  teammate finishes, the hand-back arrives as a `session.receive` with origin `{ kind: 'peer',
  teammate: '<name>', isVerified: true }`, no `agentId`, and text
  `{"type":"idle_notification",…,"result":"<answer>"}`.
  No `prompt.submit` fires for it, and it starts a main-model turn. Answering that `session.receive`
  with `{ consumed: reason }` keeps the main model idle, and the delivery didn't come again within
  78 s. Probed on 2.1.296 (issue-forge P4, issue #27). A mod whose named agents must stay quiet
  handles both shapes: `{ drop }` in `prompt.submit` and `{ consumed }` in `session.receive`.
  Under `claude -p --input-format stream-json` a named spawn was not a teammate, even with agent
  teams on: no `teammateId`, and an `a<hex>` id. Only the interactive session made one (2.1.310,
  issue #40's probe); `-p` on 2.1.296 wasn't checked.
- **[probe]** With agent teams on, inside tmux, with the default teammate mode, a named
  `$.agent.spawn` of a type a plugin registered is refused: `{ deny: "Agent type '<plugin>:<agent>' was registered at run time by a
  plugin and exists only in this process; a pane-based teammate cannot run it. Spawn it with the
  Agent tool instead, or use in-process teammates." }`. With `--settings
  '{"teammateMode":"in-process"}'` it starts. An unnamed spawn isn't affected, and with agent teams
  off a named one isn't either. Outside tmux, in an interactive session, named spawns ran as in-process
  teammates (issue #27's run #2).
  A cmux session sets `CMUX_*` variables and no `TMUX`.
- **[probe]** A variable in `settings.json`'s `env` block overrides the same variable set in the
  shell: `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=0 claude …` still made teammates while
  `~/.claude/settings.json` set it to `1`. `--settings '{"env":{"…":"0"}}'` turned it off.
- **[probe]** `$.agent.spawn`'s `cwd` is ignored. An unnamed agent and a named one (an in-process
  teammate), each spawned with `cwd: <session>/wt`, ran `pwd` in the session's folder. To keep an
  agent in another folder, a `tool.call` hook rewrites its Bash `command` to
  `cd -- '<dir>' || exit 1`, a newline, then the command: that moved both kinds into `<dir>`.
  Probed on 2.1.296 (issue-forge P4, whose spawn was issued, unawaited, while its `command.run` hook
  ran). On 2.1.310 the spawning mod's own `tool.call` hook didn't get the calls of an agent spawned
  after its hook had returned, so the rewrite never ran there (the re-entry entry, below). Whether
  `cwd` is still ignored on 2.1.310 wasn't checked.
- **[probe]** When another plugin answers the `Agent` call in-line with a completed result (as
  duet does for a Codex run that edits), `$.agent.spawn` resolves `{ model, agentId }` from that
  result, for example `{ model: "codex", agentId: "duet-…" }`. There is no local loop behind it, so
  no `turn.complete` and no answer text. Treat the phase as over once the spawn resolves. A result
  that doesn't fit the Agent tool's output shape turns into `{ deny }`.
- **[probe]** `$.ui.ask` from a detached promise (no hook running) shows its question in an
  interactive session, as `Plugin <name>: <question>`. Under `-p`, stream-json included, it rejects:
  `no tool named "AskUserQuestion" in this session`.
- **[probe]** Calling `return()` on a `$.process.spawn` stream while its child is silent ends the
  `for await` loop at once and kills the child: a `sleep 37` was gone 10 ms later. That is
  enough to enforce a timeout; no `timeout` wrapper is needed.
- **[d.ts]** A `$.process.spawn` stream is a `HookStream`: its `result` "rejects if the stream is
  closed before" its end. After `return()`, put a catch on `stream.result` if nothing awaits it.
- **[d.ts]** At `$.process.run`'s `timeoutMs` (30 s if absent, ten minutes at most) the child "is
  killed and the call rejects". It also "rejects when the command cannot start" (2.1.300). Mod Lab
  tells the two apart by the time elapsed.
- **[probe]** Under `claude plugin test`, a mod's `$.agent.spawn` never gets an `agentId`. The test's
  `agent.spawn` stub has to answer the event's shape `{ model }` (`{ value: … }` is skipped with
  "returned neither { model } nor { deny }"), and an `agentId` in that answer is dropped. A
  `tool.call {tool:'Agent'}` stub isn't reached either. To test the steps either side of a spawn,
  seed `$.store` (`mock.store`) at the step after it and resume from there. A test-side
  `$.prompt.submit` does carry the `origin` it is given, so a `peer` hand-back drop can be tested.
- **[probe]** A mod ends an agent it spawned with the built-in `TaskStop` tool, by the `agentId`
  `$.agent.spawn` returned: `$.tool.call({ tool: 'TaskStop', task_id: <agentId> })`. `$.agent` itself
  has only `register`, `spawn` and `list` [d.ts 2.1.310; Mods-reference.md:208].
  - It ended an unnamed subagent (`Successfully stopped task: <id> (…)`, `task_type: "local_agent"`)
    and an in-process teammate (`task_type: "in_process_teammate"`). For the teammate, the message
    names a task id that isn't the `agentId` (`tnp9e29pr` for `astopprobe-q4z-worker-…`), so don't
    check the answer's text for the `agentId`.
  - In the four runs that read the status back (three of a throwaway mod, one of issue-forge 0.9.1
    with `--plugin-dir`; issue #40), it went to `killed`. No permission dialog came up. The installed
    copy of issue-forge 0.9.1, stopped during a real run, answered that its agent "has stopped".
  - **A queued call can still run** (issue #156). In both issue-forge runs, the agent's last message
    held two tool calls, the second written about 2.6 s before the stop. The first, a `Bash`, was
    running when the stop came. It ended `outcome=ok` before `TaskStop` answered (`--plugin-dir`), or
    `outcome=error` just after (installed). The second was dispatched after `TaskStop` answered and
    ran: a `Bash` 0.1 s later and a `Read` 0.6 s later, each `outcome=ok`. The throwaway mod's agent
    made one call a message, and its hook logged none after the stop. The transcript has only the
    queued call's `tool_use`, written before the stop, and no result. The debug log shows it, as
    `tool_dispatch_start tool=<tool> toolUseId=<id>` after the `TaskStop … answered` line. So don't
    take a stop to mean nothing more runs. A guard that would refuse such a call has to be a hook that
    gets it (the re-entry entry, below).
  - All under `auto` on 2.1.310; other permission modes weren't checked.
- **[probe]** `$.agent.list()`'s `spawnedBy` for a mod's spawn is the plugin's plain name, not
  `<name>@inline`, for a `--plugin-dir` copy (2.1.310). An installed copy's stop matched its agent,
  but issue-forge's filter takes the plain name, `<name>@…` or no `spawnedBy` at all, so whether an
  installed copy's agents carry the field, and what it holds, wasn't recorded. The 2.1.310 d.ts types
  it optional; it is in 2.1.305's binary and 2.1.306's and 2.1.308's types, and 2.1.296 wasn't checked.
- **[probe]** After a `TaskStop` that wasn't refused, a killed in-process teammate read `killed` at
  once and was gone from `$.agent.list()` 30 s later (an interactive session). A killed subagent was
  still listed `killed` 30 s later (`-p` stream-json). Both on 2.1.310. The 2.1.310 d.ts keeps an entry
  "until the engine drops its task: as a teammate ends or seconds after, a subagent's later". So after
  such a `TaskStop`, count an agent the list no longer has as ended.
- **[probe]** Whether a mod's own `tool.call` hook gets a call depends on when the call is made. Seen
  on 2.1.310 in issue #40's two issue-forge live checks (a `--plugin-dir` copy, `@inline`, and an
  installed one, `@claudemod`) and in its throwaway probe mod. issue-forge's case is issue #156.
  - **While one of the mod's hooks runs, it does.** `TaskStop` (`$.tool.call`) and the start menu's
    `$.ui.ask` (logged as a `$.tool.call` of `AskUserQuestion`; pre-merge run only), both from
    issue-forge's `command.run` hook, each logged `hooks module <plugin>@<source>: tool.call nested in
    <plugin>#<n>`, then `hooks module <plugin>@<source> tool.call settled in …`. That matches the d.ts:
    the call "runs through every hook but the calling one (the plugin's others see it)" [d.ts 2.1.310,
    `$.tool.call`].
  - **After its hooks have returned, it doesn't.** issue-forge's drive starts with `void drive(…)`
    inside `command.run`, and spawned 85 s and 93 s after that hook settled. The `Agent` call its
    `$.agent.spawn` makes logged `hooks module <plugin>@<source> tool.call skipped: re-entry (the
    plugin's own code raised it; origin <plugin>)`. The docs give `re-entry` for an event "from inside
    a mods API call by that hook or by your mod's code outside its hooks" [Mods-reference.md:42].
  - **Nor does it get the calls of an agent spawned then.** Each of the red agent's own `Bash` and
    `Read` calls (an in-process teammate) logged the same re-entry line for issue-forge, and no
    `settled` line. Other plugins' `tool.call` hooks ran them (`tool.call nested in <plugin>`), and so
    did a classic `PreToolUse` hook (hookify's). The docs also tie an agent to the call that started it
    (`next.error.cause` `rewritten` covers "an agent started by that call", Mods-reference.md:43).
  - **A spawn issued while a hook runs is different.** The probe mod awaited its spawn inside
    `command.run`, and its agent's calls logged `tool.call nested in <plugin>#<n>` for its own hook,
    as an unnamed subagent, a named one and a teammate (2.1.310). On 2.1.296, P4 (issue-forge's probe
    for Change 0.2.0) issued its spawn unawaited from `command.run`, and its own `tool.call` hook
    logged and rewrote the agents' `Bash` calls.
  - So for a mod to guard or steer its own agents with its `tool.call` hook, issue the spawn while a
    hook is running. For a spawn made after its hooks have returned, only other plugins' `tool.call`
    hooks and classic `PreToolUse` hooks were seen to run on the agent's calls; the mod's own classic
    hooks weren't checked. Also not checked: issue-forge's timing on 2.1.296, P4's unawaited shape on
    2.1.310, and an unnamed subagent spawned after the hook returned. Nor is it known whether the
    hook's `.catch` runs for a skipped call: the docs give `.catch` `kind: 're-entry'` "when the hook
    was skipped" [Mods-reference.md:42], but the logs have no line either way.
  - A mod's own registered tool is a different case: its `tool.call` hook has to answer it, and the
    2.1.300 probe in "Modules" (a nested `$.tool.call` that another hook answered) doesn't say whose
    hook that was.

- **[probe]** codex-cli 0.163.0's binary carries the string `"chat"` is no longer supported` beside `wire_api`:
  Codex speaks only OpenAI's Responses API, so a `model_providers` entry can't point it at a Chat
  Completions endpoint (Anthropic's and Gemini's OpenAI-compatible layers are Chat Completions only,
  `[field]`). A mod that wants other providers calls them itself with `$.http.fetch` (duet 0.3.0/0.4.0).

## Plugins and skills

- **[probe]** A skill inside a plugin is namespaced `<plugin>:<skill>`, so `plugins/x/skills/build`
  is `/x:build`. Name skill folders for the verb, not the plugin.
- **[probe]** The engine writes `<mod>/.claude-plugin/types/` only when an *interactive* session
  loads the mod. `claude -p --plugin-dir` doesn't write it. Until then, typecheck with a scratch
  tsconfig outside the mod (`templates/tsconfig.check.json`).
- **[probe]** A `--plugin-dir` copy replaces an installed plugin of the same name. The debug log reads
  `Plugin "<name>" from --plugin-dir overrides installed version`, then
  `hooks module <name>@inline loaded (…)`, with no module line for `<name>@<marketplace>`. The
  admission comes after `loaded`: `plugin.register: <name> (user, <name>@inline), judged by core
  alone: admitted`. The folder shows as `--plugin-dir <path> is one plugin`. Probed on 2.1.308 (#135)
  with issue-forge and mod-builder.
- **[probe]** A `--plugin-dir` path that doesn't exist is skipped with only
  `[WARN] Plugin path does not exist: <path> (ENOENT), skipping` in the debug log. The installed copy,
  if there is one, then answers the command as though nothing were wrong. Probed on 2.1.308 (#135): a
  relative path from the wrong folder, and `/issue-forge demo` answered.
- **[probe]** `--debug-file <path>` appends to the file. A line already in it stays first after a
  run. Start a check that reads the log with no file. Probed on 2.1.308 (PR #142).
- **[probe]** `claude plugin list --json`:
  - A plugin installed from a marketplace added from a local folder has `readFromFolder` (the
    folder) and `folderVersion` (its version now), while `version` is the one recorded at install.
    The text form prints `Read from: <folder>`.
  - A copied plugin has no `readFromFolder` key, and an `installPath` under
    `~/.claude/plugins/cache/<marketplace>/<name>/<version>`.
  - A disabled plugin has `enabled: false`.

  Probed on 2.1.308 (#135).
- **[probe]** `/plugin`'s `mods active` line names mods only, as in `5 mods active · issue-forge, …`.
  The Installed tab shows the copy: `issue-forge  Plugin  inline` for a `--plugin-dir` copy, and
  `mod-builder  Plugin  claudemod` for an installed one. The details read `issue-forge @ inline`,
  `Version: 0.7.5`. Probed on 2.1.308 (PR #142 review), in an interactive session with the installed
  copy enabled.

## In a live terminal

- **[probe]** A pane takes the keyboard with **`ctrl+x tab`**, which toggles only with one pane: pressed
  again, it hands the keyboard back. With several panes open it moves through the tabs (below). Escape
  returns the keyboard from any pane and leaves the shown pane as it is. Button `hotkey`s only fire while
  the pane holds the keyboard; otherwise the keys type into the prompt. A letter that is one of the
  pane's hotkeys acts at once (`s` toggled Duet's Stats and the composer stayed empty); a letter that
  isn't one reaches the composer. Tell the person this in the handoff.
- **[probe]** With two or more panes open, the frame's first row lists their titles as a tab strip
  (`│  Duet   Issue Forge   Mod Lab  …│`) and only one pane is shown. A plugin that owns two panes
  (duet: `duet`, `duet-config`) has both as tabs. Inline terminal layout only; the dock, desktop and
  mobile layouts were not observed (2026-10-13, 2.1.296, #31).
- **[probe]** `ctrl+x tab` from the prompt shows the **first** tab and gives it the keyboard, whichever
  pane had been shown. Pressed again it moves one tab right. On the last tab it leaves that pane shown but
  hands the keyboard back to the prompt, and the next press shows the first tab again. With a single pane,
  a second press hands the keyboard back. So "ctrl+x tab focuses the pane" holds for the first tab only
  (2026-10-13, 2.1.296, #31).
- **[probe]** What re-opening does to a pane that is open behind another tab (2026-10-13, 2.1.296, #31):
  - `$.ui.open({ id, title, columns })` without `focus` leaves it hidden; the command's answer still
    says it is open. A new pane opened by a command is shown.
  - `$.ui.open({ …, focus: true })` from a command hook brings it to the front and gives it the keyboard
    (`/duet config` again: the config pane came forward and `j` moved its row).
  - A bare command that closes its pane whenever it is listed closes a pane that was never on screen.
    `paneAction` replaces that rule.
- **[probe]** `pane:next` and `pane:previous` are actions of the `Pane` keybinding context with no default
  key. Bound in `~/.claude/keybindings.json` as
  `{"bindings":[{"context":"Pane","bindings":{"ctrl+x n":"pane:next","ctrl+x p":"pane:previous"}}]}`
  they cycled the tabs and wrapped, but only while a pane held the keyboard; from the prompt `ctrl+x n`
  did nothing. A session started after the file was written took the binding (2026-10-13, 2.1.296, #31).
- **[d.ts]** (read in 2.1.301's `claude-code.d.ts`; the issue quotes the same words from 2.1.296) `UiPane.isShown` (from `$.ui.panes()`): "True for the one pane the surface shows; the rest
  are tabs behind it." `$.ui.panes()` lists only this plugin's panes. `PaneOpenArgs.focus` is "a request,
  not a grant": the surface focuses and raises the pane only while the prompt has the keys over an empty
  composer; an element of the band or a pane the person holds, text in the composer, a dialog or a survey
  each refuse it, and the pane opens without the keyboard. Check `isShown` afterwards to know whether it
  came forward. Whether `isShown` is already true when `await $.ui.open(…)` returns, or only after a
  moment, is not probed yet (#31, step 1a): the bundled mods read it in a `$.clock.after(500, …)` callback,
  which is right either way. `UiPane.isPlaced` is "False while it waits undrawn: opened unasked on a
  terminal too narrow for an unrequested pane", and "False on every row, none shown or focused, while an
  open answers `no-surface`". Such a row has `isShown: false` but is no tab behind another, so
  `paneAction` counts it as not listed (PR #96, Codex P2).
- **[probe]** Under `claude -p --input-format stream-json` (2.1.301, 2026-10-15, PR #96), after a first
  `/duet` opened the pane, `$.ui.panes()` listed it unplaced and not shown. Read from the answers, not a
  dump of the rows: a second bare `/duet` answered `Bringing the pane to the front…` while `paneAction`
  took every listed row (so the row had `isShown: false`), and `Opened.` once it skipped unplaced rows (so
  `isPlaced: false`); `/issue-forge` the same. So a headless session can hold an unplaced pane.
- **[probe]** The host draws Buttons as `[ Label ]`, with no hotkey letter. If the hotkeys matter,
  name them in a hint line or in the README.
- **[probe]** `$.ui.status` text shows under the prompt as `⚠ <plugin>: <text>`, and toasts appear in
  the footer as `<plugin>: <text>`. The host adds the prefix, so don't repeat the plugin's name.
- **[probe]** A `--plugin-dir` session hot-reloads after an edit (`<plugin>: reloaded (N hooks…)`).
  Atoms survive the reload, and module variables and pane focus don't.
- **[probe]** `/reload-plugins` reloads only a module whose content changed. An unchanged one is kept as
  loaded, module variables included (`hooks modules unchanged, kept as loaded` in the debug log), and a
  `touch` doesn't count. So a module variable that keeps a copy of an atom (git-branch's `hiddenKept`) is
  read back from the atom in `session.start`, or the reload after a plugin update loses it. Probed on
  2.1.307 (PR #127) with git-branch: hide, a one-line edit, `/reload-plugins`, `/clear`.
- **[probe]** A row computed at scan time goes stale while a run streams. Anything that changes
  during a run (status, time) has to be read from the live run when drawing.
- **[probe]** `$.session.cwd()` follows `/cd` and not the person's `!cd`. Probed on 2.1.296 with Mod Lab's
  detail header: after `/cd mods` the header switched to the path relative to the new folder, with no
  rescan, so a `/cd` also redraws the pane; after `!cd mods` the header didn't change. A path shown
  relative to the working directory should be worked out when drawing, not cached at scan time.
- **[probe]** On 2.1.301 the model's own Bash `cd` does move `$.session.cwd()`, unlike the person's `!cd`
  above: after `cd scratch/wt && pwd` it read the worktree, and still did at the next Bash call. A `cd` out of
  the project reset it to the project root. `$.session.root()` stayed at the project root throughout
  (`/cd` and a worktree move change it, per the d.ts). Probed headless with a throwaway mod whose tool
  returned both values (#92). So a mod that must not follow Claude's shell walks from the root; Mod Lab
  does, from 0.2.20. 2.1.296's binary also defines `$.session.root` (`root:()=>t("session.root",{})`).
- **[probe]** A worktree's `.git` is a file, `gitdir: <common>/worktrees/<name>`, and a repository top's `.git` is a folder. Mod Lab reads these to tell whether a reported folder is the project's own repository (from 0.2.20). Probed in WSL with git 2.53 (`scratch/gitprobe-92`): `git worktree add --relative-paths ../wt-rel` wrote `gitdir: ../main/.git/worktrees/wt-rel`, which Mod Lab resolves against the worktree. Git for Windows' `git.exe worktree add` wrote `gitdir: C:/Projects/ClaudeMod/scratch/gitprobe-92/main/.git/worktrees/wt-win`. That never matches a `/mnt/c/…` root read under WSL, so such a worktree is refused, not misread. Git's own record of each worktree, `<common>/worktrees/<name>/gitdir`, names the worktree's `.git` back. In the same probe it held `../../../../wt-rel/.git` (relative to the record's folder) with `--relative-paths`, `C:/Projects/ClaudeMod/scratch/gitprobe-92/wt-win/.git` from Git for Windows, and `/mnt/c/Projects/ClaudeMod/scratch/issue-92-mod-lab-pin/.git` for this repository's worktree. Mod Lab requires this back-link, so a hand-written `.git` file doesn't make a folder a worktree.
- **[probe]** With a relative `--plugin-dir` (`claude --plugin-dir plugins/mod-builder`), after `/cd`
  the session ran the installed copy of that plugin instead: Mod Lab's `modsDir` switched to the
  installed folder's `mods/`. Pass an absolute path to `--plugin-dir` when a live check uses `/cd`.
  (Probed with Mod Lab before 0.2.9, whose default `modsDir` came from the plugin's own folder. From
  0.2.9 it follows the working directory, and from 0.2.20 the project root, so check the version in the
  session-start log line instead.)

## Testing and checking

- **[probe]** `claude -p --plugin-dir <mod> "/<command> <args>"` runs one command headless and prints
  its `{ text }`, prefixed `<plugin>:`. It's the quickest live smoke test, and needs no interactive session.
- **[d.ts]** `claude plugin validate <dir>` lists `hooks:`, `calls:` and each gating hook
  `with .catch` / `without .catch`. That output is the source for the README's "What it reaches",
  except for what it leaves out (next entry).
- **[probe]** Validate's listing, `--json` included, names only the hooks module's hooks and calls.
  Probed on 2.1.300 (#9): a settings-style `SessionStart` command hook beside `"modules"` in
  `hooks/hooks.json`, and a `.mcp.json` server, were not listed. "What it reaches" adds such entries
  by hand, from `hooks/hooks.json`, `.mcp.json` and `plugin.json`'s `hooks` and `mcpServers`.
- **[probe]** `claude plugin validate` and `claude plugin test` started neither a settings-style
  command hook in `hooks/hooks.json` nor a `.mcp.json` server. Probed on 2.1.300 (#9) with a
  throwaway plugin: `"modules": ["./register.tsx"]` (one `session.start` hook), one passing
  `tests/*.test.ts`, a `markers/` folder made beforehand, and these two, each touching a marker:
  - in `hooks/hooks.json`: `"hooks": { "SessionStart": [ { "hooks": [ { "type": "command", "command": "touch <abs>/markers/classic" } ] } ] }`
  - `.mcp.json`: `{ "mcpServers": { "probe": { "command": "touch", "args": ["<abs>/markers/mcp"] } } }`

  Validate and test passed, and neither marker appeared (run twice). Control: `claude -p
  --plugin-dir <probe> "hi"` created both, so the shapes are live ones. Not probed: hooks or
  `mcpServers` declared in `plugin.json`, other hook events and types, `lspServers`. An agent's
  `mcpServers` and shell in skill or command bodies were probed later without a control (next
  entry). Mod Lab's `autoRerun` relies on this, so re-run the probe after a Claude Code update.
- **[probe]** `claude plugin validate` and `claude plugin test` ran no shell in a command or skill
  body and started no server from an agent's `mcpServers`. Probed on 2.1.300 (PR #76) on a copy of
  git-branch, with a `markers/` folder made beforehand, and these three, each touching a marker:
  - `commands/run.md`: frontmatter `description: probe`, body ``Run: !`touch <abs>/markers/cmd` ``
  - `skills/s/SKILL.md`: frontmatter `name: s`, `description: probe`, body ``Run: !`touch <abs>/markers/skill` ``
  - `agents/a.md`: frontmatter `name: a`, `description: probe`, `mcpServers: { probe: { command: touch, args: ["<abs>/markers/agentmcp"] } }`

  Validate passed, test passed (7), and no marker appeared (each run twice). **No control was run**,
  so this doesn't show that these shapes run in a live session. The control needs the owner's OK: a
  session with the plugin that invokes the command, the skill and the agent.
- **[probe]** What `claude plugin validate` reads, beyond the manifest and `hooks/`. Probed on 2.1.300
  (PR #76) on copies of git-branch, one file per copy:

  | File | Result |
  |---|---|
  | empty `agents/x.md`, `commands/x.md`, `commands/sub/x.md`, `skills/x/SKILL.md` | "passed with warnings" (`frontmatter: No frontmatter block found`) |
  | empty `skills/x/references/y.md`, beside a valid `SKILL.md` | "passed", no warning |
  | `{ not json` as the root `.mcp.json` | "Validation failed" (`json: Invalid JSON syntax`) |
  | `{ not json` in a file named by `plugin.json`'s `"mcpServers": "./servers.json"` | "Validation failed", naming `servers.json` |
  | empty `cmds/x.md` with `plugin.json`'s `"commands": "./cmds"` | "passed", no `Validating command:` line |
  | frontmatter `description: [broken` and `name: [broken`, in `agents/`, `commands/` and `skills/x/SKILL.md` | "passed", no warning (issue #17's probe of `name: [broken` in `agents/` warned on 2.1.296) |

  Validate prints a `Validating <kind>: <path>` header only for a file with a finding, so a file that
  passes leaves no trace. Mod Lab's code signature (0.2.15) covers `agents/`, `commands/`,
  `skills/` (3 levels down) and the root `.mcp.json`. It doesn't cover a `plugin.json`
  `mcpServers` path.
- **[d.ts] [probe]** The d.ts header (2.1.296, unchanged on 2.1.299 and 2.1.300) says `claude plugin
  test` runs test files "in an environment like the one a plugin's hooks run in (no fs, network or
  process)". Probed on 2.1.296 (#9) and again on 2.1.296 and 2.1.301 (#98, 2026-10-16), the same each time:
  - These globals are `undefined` on `globalThis` (the canary's list): `process`, `Bun`, `Deno`, `fetch`,
    `WebSocket`, `XMLHttpRequest`, `Worker`.
  - `require` can't be called: a bare `typeof require` reads `function` (the transpiler folds it), but
    `require('node:fs')` throws `ReferenceError: require is not defined`, and `globalThis.require` is
    `undefined`, as it is even where `require` works (node CommonJS).
  - Code from strings is off: the global eval exists (`typeof` is `function`), but it and the `Function`,
    async function, generator and async generator constructors throw `EvalError: Code generation from
    strings disallowed for this context`.
  - A test file holding `import()`, or a top-level `import … from 'node:fs'`, doesn't load: the run reports
    `(fail) the file did not load` ("a dynamic import(); …" and `cannot import "node:fs" …`), which counts
    as a failure and exits 1. This refusal and the code-from-strings switch are independent.

  `plugins/mod-builder/tests/sandbox.test.ts` (the canary) asserts the globals, the `require` call and code
  from strings, so the suite turns red on a build where any changes. A test can't check that its own file
  didn't load, so `skills/build/scripts/check-sandbox.mjs` (CI) checks the loader against a fixture, and
  fails when the canary's list and the one above differ.
- **[field]** `claude plugin test` only collects `*.test.ts(x)`. Other spec files are ignored.
- **[probe]** In a test, nothing sits beneath the mod. Every `$` call it makes needs an answer from
  `on(...)`, `session.start` included (`on('session.start', ($, e) => ({ cwd: e.cwd }))`). One stub
  per event per test, and a second throws. Answers are `{ value }` for `$` nouns, but the event's
  own shape where one exists (`prompt.fill` → `{ isFilled, text, cursor }`). Pass options as
  `test(name, { options: {...} }, async ($, on) => …)`. `$.ui.mount` again needs `ui.unmount()` first.
- **[probe]** A test raises a classic event with `$.classic.<Event>({ … })`, for example
  `$.classic.PostToolBatch({ tool_calls })`, and needs an answer for it, as for any `$` call:
  `on('classic.PostToolBatch', () => ({}))`. Without one it throws "nothing beneath the plugins answers
  classic.PostToolBatch". With it the mod's hook runs, and `next(e)` resolves to that answer (2.1.301, #100).
- **[probe]** `$.ui.ask` isn't an event of its own. It's a `tool.call` of `AskUserQuestion`, so a
  test answers it with `on('tool.call', { tool: 'AskUserQuestion' }, …)` returning
  `{ result: { questions, answers: { [question]: label } } }`. A `$.ui.ask` question must end in `?`.
- **[probe]** `turn.complete` takes `{ answer }` and resolves `{ text }`. A stub answering
  otherwise is skipped with "returned no { text }".
- **[probe]** Work a hook starts without awaiting (a background run) may not have reached its
  `$` calls by the time the test's `await $.tool.call(...)` returns. In duet's background Codex run,
  the stubbed `process.run` for `codex` had already run then on 2.1.299, and had not yet on 2.1.300.
  A test that read the stub's log at once failed on 2.1.300, with the engine also reporting
  `hooks stream chain failed: errorKind=HooksError errorChars=35` (#45). Take the clock with
  `mock.clock(on)` and `await clock.settle()` before asserting on what background work did.
- **[probe]** Test `options` reach the mod only for keys declared in `plugin.json`'s `userConfig`.
  Undeclared keys arrive as absent, so the mod's default applies.
- **[probe]** `$.process.spawn` can't be stubbed in `claude plugin test` (2.1.296). Async or sync
  generator hooks, `{ value }` answers and argv matchers all end in "no implementation for
  process.spawn". Spawn rejects its first pull when it can't start, so fall back to
  `$.process.run` in that case. Tests then exercise the fallback, and the streaming arithmetic gets
  pure unit tests. A spawn ends with `await stream.result` → `{ code, signal }`.
- **[probe]** A `process.run` stub's event is `{ argv, init }`. The child's env and stdin are
  `e.init.env` and `e.init.stdin` (beside `e.init.timeoutMs`); `e.env` and `e.stdin` are undefined
  (2.1.300). duet's `tests/routing.test.ts` reads them this way.
- **[probe]** A stub that throws is skipped: the call rejects with "no implementation for env.get"
  (for `$.env.get`), and the stub's own error is lost. To make a call reject with a reason, answer
  `{ deny: '<reason>' }`; `$.env.get` then rejects with `<plugin>: $.env.get: <reason>` (2.1.300).
- **[probe]** `claude plugin test` writes its `(pass)`/`(fail)` lines and summary to stdout, and a
  test's `console.log` to stderr (2.1.300). `$.process.spawn` hands them over as `{ stream, text }`
  pieces, "as it came, not lines" [d.ts], and the two don't stay in order: in Mod Lab's live check
  (#9) a test that printed 100,000 lines had its stderr backlog arrive after the stdout summary. Keep
  one unfinished line per stream, and don't expect the summary at the end of what you kept.
- **[probe]** Live, `$.process.spawn` does stream `claude plugin test` progressively, but the runner
  sends output once per test *file*. On Mod Lab's 38 tests it arrived as 2 pieces (22 at 0.9 s,
  38 at 2.4 s). A progress bar built on it moves in file-sized steps. Splitting tests across
  files makes it finer.
- **[probe]** A Button that has to stay pressable while it looks "on" (such as D stopping a demo)
  should be dimmed with `dimColor` but must not ignore presses. Keep "busy" (ignores presses) and
  "lit" (dim but live) as separate states.
- **[probe]** `claude plugin test <dir>` collects every `*.test.ts(x)` under `dir`, including
  templates in a skill folder. Template files are named `*.tpl`.
- **[probe]** A host security hook that greps written files for `exec(` blocks source that uses
  `RegExp.prototype.exec`. Write `str.match(re)` instead: same result, no false alarm.
- **[field]** Run in-session tests that touch config with `CLAUDE_CONFIG_DIR=$(mktemp -d)`.
- **[probe]** The bundled `claude-code.d.ts` names no built-in tools in `BuiltinToolInputs`, so a matcher such as
  `{ tool: 'Grep' }` fails the pre-session typecheck ("Grep" is not in the union) although `Bash`, `Read` and `Agent`
  pass (2.1.301, and so on 2.1.306 for `Grep`, `Glob` and `PowerShell`). Declaring the tool in the mod's contract
  (`interface BuiltinToolInputs { Grep: … }`) would type-check, but collides (TS2717) with a build that lays its own
  `Grep` type. Use a RegExp literal instead: `on('tool.call', { tool: /^(?:Grep|Glob)$/ }, …)` type-checks, and
  validate reads it statically and lists it as `tool.call{tool=/"^(?:Grep|Glob)$"/}` (duet 0.3.1 also guards
  `/^(?:Bash|PowerShell)$/`). Neither tool is laid on these builds (searches run through Bash), so those guards are
  unverified live.
- **[probe]** The coverage kit has no `toBeLessThan`; `toBeLessThanOrEqual` is there (#33).
- **[probe]** `$.ui.mount({ surface: 'mobile' })` resolves an element table **with** `Input` (2.1.301), though the
  d.ts lists none for `mobile`, so a pane's "no `Input` on this surface" branch (`'Input' in els`) can't be
  reached in `claude plugin test`. duet's config and providers panes have that branch; it is read, not run.
- **[probe]** A `$.http.fetch` that can't connect rejects with `<plugin>: $.http.fetch(<url>) failed: <reason>`
  (`ECONNREFUSED: Unable to connect. Is the computer able to access the url?`), and a policy refusal with
  `<plugin>: $.http.fetch: <reason>` (2.1.301). In a test, `on('http.fetch', …)` answers `{ value: { status, ok,
  headers, text } }` or `{ deny }`; the event is `{ url, init }`. The call resolves only once the body is read:
  no streaming, no timeout or abort option [d.ts].

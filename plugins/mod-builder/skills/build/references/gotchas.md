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
- **[d.ts]** A `.catch` handler gets a fresh 1 s. Keep it trivial.
- **[d.ts]** After an abort (Esc, a hook above settling first), a hook may linger 5 s before it's
  reported. Pass `next.signal` to `$.clock.sleep` so the wait ends with the dispatch. `$.ui.ask` takes
  no signal. It rejects when dismissed, so wrap it in the guard's `.catch`.
- **[d.ts]** A hot reload cancels pending `$.clock` waits and timers. Module variables restart, while
  `$.state` and `$.store` survive.

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
  message "registered /x but no command.run hook answered it". Return `{ text }` at once, and open
  the pane in `void (async () => …)().catch(…)`.
- **[field]** Track whether the pane is open with `$.ui.panes()`, not a module flag. Reloads and
  Esc-closes desync flags.
- **[d.ts]** A pane opened unasked (from a timer or hook, with no command, press or prompt behind
  it) is placed only from 144 columns (110 once asked before). Otherwise it waits undrawn with
  `isPlaced: false`. Open from a command or button, and toast when it isn't placed.
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
- **[probe]** Claude Code's own subagent discovery, for a mod that mirrors it. Read from the `agents` list in
  the `init` message of `claude -p --output-format stream-json --verbose`, on 2.1.299 and 2.1.300. Project
  `.claude/agents/` folders are found walking up from the session folder to the nearest folder holding a `.git`
  entry, even an empty folder or file that git rejects; with none, the walk goes on up (4 levels probed).
  Symbolic links are followed: a linked file, a linked subfolder and a linked `.claude/agents`. Dot-folders and
  subfolders 9 and 12 deep are read. A file with a `name` but no `description` is left out, and so is one Claude
  can't read; a `name` or `description` on the next indented line, a `description: >` block, and a file with
  `bad: [` in another field are loaded (the `.git` stop and the unreadable file were probed on 2.1.299 only; the next-line `name`, the `>` block and a wrapped `description` on 2.1.300 only).
- **[d.ts]** There's no Node, DOM or `require`. Every file is an ES module named `.ts/.tsx/.js/.mjs/…`,
  and anything else isn't loaded. The outside world is reached only through `$`.
- **[field]** JSX compiles to `h(...)` and `Fragment`. A local variable named `h` breaks every
  element after it.
- **[field]** Never write files inside the plugin folder. An installed copy may be read-only or
  replaced on update. Use `~/.claude/<name>-data/`.
- **[field]** A floating promise fails tests at teardown. Write `void p.catch(() => undefined)`.

## Subagents a mod spawns

- **[probe]** A mod's `$.agent.spawn` reaches other plugins as a `tool.call` of `Agent` (with
  `next.origin` naming the spawning plugin), then as `agent.spawn`. So duet routes it like a model's
  Agent call: with `codexAgents: "*"` a mod's unnamed agent goes to Codex. Passing a `name` keeps it
  on Claude, because duet leaves named calls alone.
- **[probe]** A spawn started from a `command.run` handler in `void (async () => …)()` outlives the
  handler. Its `turn.complete` (with the `agentId` and its `answer`) arrived about 10 s later. The
  subagent's own tool calls are `tool.call`s carrying that `agentId`. Its Write and Bash ran without
  a prompt under `defaultMode: "auto"`; other permission modes weren't checked.
- **[probe]** Plain `claude -p "/cmd"` exits as soon as the command answers, so a detached spawn
  never even resolves. To keep a headless session alive, use `--input-format stream-json` with
  stdin held open, or test in an interactive session.
- **[probe]** When a subagent finishes, its report is handed back to the main loop as a
  `prompt.submit` with origin `peer`, which starts a main-model turn. The text starts
  `<agent-message from="<name>">` for a named agent and `<agent-message from="<agentId>">` for an
  unnamed one. A `prompt.submit` hook that returns `{ drop: reason }` for its own agents keeps the
  main model idle, and the `turn.complete` still arrives. The reason is shown to the person.
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
- **[probe]** Under `claude plugin test`, a mod's `$.agent.spawn` never gets an `agentId`. The test's
  `agent.spawn` stub has to answer the event's shape `{ model }` (`{ value: … }` is skipped with
  "returned neither { model } nor { deny }"), and an `agentId` in that answer is dropped. A
  `tool.call {tool:'Agent'}` stub isn't reached either. To test the steps either side of a spawn,
  seed `$.store` (`mock.store`) at the step after it and resume from there. A test-side
  `$.prompt.submit` does carry the `origin` it is given, so a `peer` hand-back drop can be tested.

## Plugins and skills

- **[probe]** A skill inside a plugin is namespaced `<plugin>:<skill>`, so `plugins/x/skills/build`
  is `/x:build`. Name skill folders for the verb, not the plugin.
- **[probe]** The engine writes `<mod>/.claude-plugin/types/` only when an *interactive* session
  loads the mod. `claude -p --plugin-dir` doesn't write it. Until then, typecheck with a scratch
  tsconfig outside the mod (`templates/tsconfig.check.json`).

## In a live terminal

- **[probe]** A pane takes the keyboard with **`ctrl+x tab`**, which toggles: pressed again, it hands
  focus back. Escape also returns it. Button `hotkey`s only fire while the pane holds the keyboard;
  otherwise the keys type into the prompt. Tell the person this in the handoff.
- **[probe]** The host draws Buttons as `[ Label ]`, with no hotkey letter. If the hotkeys matter,
  name them in a hint line or in the README.
- **[probe]** `$.ui.status` text shows under the prompt as `⚠ <plugin>: <text>`, and toasts appear in
  the footer as `<plugin>: <text>`. The host adds the prefix, so don't repeat the plugin's name.
- **[probe]** A `--plugin-dir` session hot-reloads after an edit (`<plugin>: reloaded (N hooks…)`).
  Atoms survive the reload, and module variables and pane focus don't.
- **[probe]** A row computed at scan time goes stale while a run streams. Anything that changes
  during a run (status, time) has to be read from the live run when drawing.
- **[probe]** `$.session.cwd()` follows `/cd` and not a shell `cd`. Probed on 2.1.296 with Mod Lab's
  detail header: after `/cd mods` the header switched to the path relative to the new folder, with no
  rescan, so a `/cd` also redraws the pane; after `!cd mods` the header didn't change. A path shown
  relative to the working directory should be worked out when drawing, not cached at scan time.
- **[probe]** With a relative `--plugin-dir` (`claude --plugin-dir plugins/mod-builder`), after `/cd`
  the session ran the installed copy of that plugin instead: Mod Lab's `modsDir` switched to the
  installed folder's `mods/`. Pass an absolute path to `--plugin-dir` when a live check uses `/cd`.

## Testing and checking

- **[probe]** `claude -p --plugin-dir <mod> "/<command> <args>"` runs one command headless and prints
  its `{ text }`, prefixed `<plugin>:`. It's the quickest live smoke test, and needs no interactive session.
- **[d.ts]** `claude plugin validate <dir>` lists `hooks:`, `calls:` and each gating hook
  `with .catch` / `without .catch`. That output is the source for the README's "What it reaches".
- **[field]** `claude plugin test` only collects `*.test.ts(x)`. Other spec files are ignored.
- **[probe]** In a test, nothing sits beneath the mod. Every `$` call it makes needs an answer from
  `on(...)`, `session.start` included (`on('session.start', ($, e) => ({ cwd: e.cwd }))`). One stub
  per event per test, and a second throws. Answers are `{ value }` for `$` nouns, but the event's
  own shape where one exists (`prompt.fill` → `{ isFilled, text, cursor }`). Pass options as
  `test(name, { options: {...} }, async ($, on) => …)`. `$.ui.mount` again needs `ui.unmount()` first.
- **[probe]** `$.ui.ask` isn't an event of its own. It's a `tool.call` of `AskUserQuestion`, so a
  test answers it with `on('tool.call', { tool: 'AskUserQuestion' }, …)` returning
  `{ result: { questions, answers: { [question]: label } } }`. A `$.ui.ask` question must end in `?`.
- **[probe]** `turn.complete` takes `{ answer }` and resolves `{ text }`. A stub answering
  otherwise is skipped with "returned no { text }".
- **[probe]** Work a hook starts without awaiting (a background run) may not have made its first `$`
  call by the time the test's `await $.tool.call(...)` returns. On 2.1.299 it had; on 2.1.300 it
  hadn't, and a test that read the stub's log at once failed, with the engine also reporting
  `hooks stream chain failed: errorKind=HooksError errorChars=35` (#45). Take the clock with
  `mock.clock(on)` and `await clock.settle()` before asserting on what background work did.
- **[probe]** Test `options` reach the mod only for keys declared in `plugin.json`'s `userConfig`.
  Undeclared keys arrive as absent, so the mod's default applies.
- **[probe]** `$.process.spawn` can't be stubbed in `claude plugin test` (2.1.296). Async or sync
  generator hooks, `{ value }` answers and argv matchers all end in "no implementation for
  process.spawn". Spawn rejects its first pull when it can't start, so fall back to
  `$.process.run` in that case. Tests then exercise the fallback, and the streaming arithmetic gets
  pure unit tests. A spawn ends with `await stream.result` → `{ code, signal }`.
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

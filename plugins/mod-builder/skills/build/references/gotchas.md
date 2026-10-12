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
- **[d.ts]** There's no Node, DOM or `require`. Every file is an ES module named `.ts/.tsx/.js/.mjs/…`,
  and anything else isn't loaded. The outside world is reached only through `$`.
- **[field]** JSX compiles to `h(...)` and `Fragment`. A local variable named `h` breaks every
  element after it.
- **[field]** Never write files inside the plugin folder. An installed copy may be read-only or
  replaced on update. Use `~/.claude/<name>-data/`.
- **[field]** A floating promise fails tests at teardown. Write `void p.catch(() => undefined)`.

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

# House conventions

These settle every HOUSE slot in the SPEC. They pick one side wherever the public mods disagree.
Write the chosen value into the SPEC so the person can override it at approval.

## Layout

```
<mods>/<name>/
  .claude-plugin/plugin.json      name, version, description, author, "types", userConfig?
  hooks/hooks.json                { "modules": ["./register.tsx"] }
  hooks/register.tsx              the only file that spells `$`; every function taking `$` is top-level
  hooks/<name>-logic.ts           pure, exported, $-free; split further only when it passes ~400 lines
  types/index.d.ts                PluginState contract (if any atom); no imports
  tests/<name>-logic.test.ts      pure logic
  tests/ui.test.tsx               each drawn component mounted, or the command driven
  tsconfig.json                   { "extends": "./.claude-plugin/types/tsconfig.json" }
                                  (until a session has loaded the mod: templates/tsconfig.check.json, outside it)
  SPEC.md, README.md
```

- `name` is kebab-case. It is the plugin name, the pane id, the command name and the
  `PluginState` key. One name everywhere.
- Tests live in `tests/`, never beside the code.
- `.claude-plugin/types/` is written by the engine when an interactive session loads the mod.
  Gitignore it, and don't edit it. Before that, typecheck with `templates/tsconfig.check.json`, filled
  and kept outside the mod.

## State

| What | Where |
| --- | --- |
| Values a drawing reads (view, selection, frame, running jobs) | `atom({ plugin, key } as const, initial)`, then `await read($, a)` / `await update($, a, fn)`; each declared in `types/index.d.ts` |
| Values that must outlive the session (settings, last results) | `$.store.get/set`, keys prefixed `<name>:` |
| Files the mod writes at run time | `~/.claude/<name>-data/`, **never** the plugin folder |
| Module variables | Top-level `let`s for options, timer handles and in-flight guards, assigned in `register`. They reset on every reload. |

Use atoms over raw `$.state.get/set`. `claude plugin validate` checks atom refs against the contract.

**After `/clear`, `/resume` and `/branch`** every atom is back at its initial value, and `session.start`
doesn't run again (`gotchas.md`). Whatever `session.start` copies into atoms, from `$.store`, disk or
module state, a `classic.SessionStart` hook copies again:

```ts
on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
  await seed($).catch(() => undefined)
  return next(e)
}).catch(($, e, next) => next(e))
```

`startup` and `compact` reset nothing, so the matcher leaves them out. A resumed startup
(`claude --continue`) fires `resume` too, before `session.start` (`gotchas.md`): `seed` must skip it
when the module hasn't started (a module variable `session.start` sets), since `session.start` seeds
there. Validate counts the hook as gating, hence the `.catch`. Atoms that only count this conversation (a turn's tools, the watcher's
stats) are right to reset, so the archetypes have no such hook. Where an organization manages Claude
Code, `classic.*` hooks don't run in a plugin a person installs, and the reset stays.

## Hooks

- `register.tsx` reads top to bottom: imports, constants, atoms (literal `plugin`/`key`), module
  `let`s, then top-level functions that take `$`, then `export const register` holding only `on(...)` calls.

- **One hook per event and matcher per plugin.** If two concerns share an event, merge them.
- Every hook that doesn't answer for itself ends with `return next(e)`, or with
  `const r = await next(e); …; return r` when it reacts to the result.
- `turn.complete`: skip subagent turns with `if (e.agentId) return next(e)`.
- **Guards** (a hook whose answer can refuse something) always carry a `.catch`:
  ```ts
  on('tool.call', { tool: 'Bash' }, guard)
    .catch(($, e, next) => next.called ? next(e) : { deny: '<name>: the check failed; ask the person before retrying.' })
  ```
  A deny reason is addressed to Claude and starts with `<name>:`.
- **Background work** is `void work($).catch(() => undefined)`. Never leave a floating promise:
  tests fail at teardown.
- **Long work a hook waits on** (a process, a model call, a poll) stops when the event is abandoned,
  as when the person presses Esc. Pass `next.signal` to each call that takes one (`$.clock.sleep`,
  `$.model.complete`'s options). A `$.process.spawn` the hook waits on is ended by the engine when the
  signal aborts, and a process call after that rejects `… aborted`, while state, store, toast and file
  writes still work (`gotchas.md`). So in the `catch`, check `next.signal.aborted`, record a stop the
  person asked for (not a failure), and start no fallback process. A stop undoes nothing: to say what
  the stopped work left (a `git status`), run it from `$.clock.after(0, …)`, where process calls work
  again. Work started with `void` survives Esc: give it a stop command.
- **`$.prompt.submit` resolves `{ drop }` rather than rejecting** when it can't queue the prompt:
  `the session was stopped and nobody has sent input since` until the person's next input after Stop,
  or `the prompt was removed from the queue before it ran` for one queued at Stop. Retry only those
  two: queue each such text in a top-level list (several jobs can finish while submits are refused),
  and in `turn.complete` take the whole queue, empty it, then submit each item detached
  (`void submit($, text).catch(…)`, never awaited: the call resolves only when the new turn starts).
  A retry refused again goes back on the queue for the next `turn.complete`. Any other `drop` is
  another hook's choice: report it (a toast naming where the text is saved) and don't retry it. Never
  lose the text quietly.

## Commands

```ts
on('session.start', async ($, e, next) => {
  await $.command.register({ name: NAME, description: '…', argumentHint: '[demo]' }).catch(() => {})
  return next(e)
})
on('command.run', { command: NAME }, async ($, e) => {
  try {
    const arg = e.args.trim().toLowerCase()
    void openPane($).catch(() => undefined)    // $.ui.open before the hook returns, ahead of any await
    void work($).catch(() => undefined)        // slow work (a scan, a fetch) after the open
    return { text: '…' }
  } catch { return { text: `${NAME}: something went wrong; see claude --debug.` } }
})
```

- Every mod has a `demo` subcommand that shows every state.
- **`immediate: true`** in the registration lets a command typed mid-turn run at once rather than wait
  for the turn to end. It covers every subcommand, and the hook must not assume the turn's state. Set it
  only when every branch only shows something: it opens, closes or fronts a pane, shows or hides what the
  mod draws, fills the prompt box for the person to finish, or reads (files and folders included). Leave
  it off a command with a branch that starts work (a run, a review), asks a
  question, writes state the turn's own hooks write (a band's per-turn counts: a mid-turn write races
  them), changes what the mod counts or saves, sets an option (`$.config.set` on the plugin's own
  option reloads the plugin) or makes a billed call. The pane-command archetype sets it. Band (its demo
  writes the per-turn counts), guard (its demo asks), watcher (`reset`) and command-only (it records
  notes) don't.
- A bare pane command reads `paneAction(await $.ui.panes(), NAME)` (a pure rule in the mod's logic
  module; the pane-command archetype has it) rather than a saved flag. Three states: `open` when the
  pane isn't listed, `close` when the surface shows it (`isShown`), and `show` when it is open as a
  tab behind another pane. Closing a `show` would lose a pane the person never saw. For `show`, answer
  at once, then ask for the front in the detached block: `$.ui.open({ …, focus: true })`, and read
  `$.ui.panes()` again in a `$.clock.after(500, …)` callback; a pane whose `isShown` is still false is
  named in a toast (`<Title> is still behind another tab: ctrl+x tab, then again until it shows.`).
  A pane that waits undrawn (an unasked open on a narrow terminal) is open but not placed: it is no
  tab behind another, and the person's command seats it with `$.ui.open`. Pass `$.ui.panes()` whole:
  `paneAction` counts a row with `isPlaced: false` as not listed, so the command opens it (and
  `openPane` toasts the narrow window) rather than folding it or asking for the front.
- Take the keyboard (`focus: true`) only on an explicit request to see the pane: a bare command's
  `show`, a `demo`, a command that names something in the pane. Never on a start, a resume or a
  background open.
- A pane hotkey that stops, publishes or deletes asks first (`$.ui.ask`), whatever the mod's options
  say; the same action typed as a command stays immediate. A letter that is a hotkey acts at once, so a
  stray key must not do any of those. Hotkeys that only read or re-run something are left as they are,
  on purpose: duet's `r` (review; its sending to Codex is governed by `codexConsent`) and Mod Lab's `t`
  and `v` (run tests, validate).

## Panes, bands, status

- **Pane id = name.** Open it only from a command, a button or a prompt, and call `$.ui.open` before
  that hook returns. An open after an `await` on other work (in `void (async () => …)()`) runs after
  the hook and is unasked, as is one from a timer or a `tool.call` hook. An unasked open is only placed
  from 144 columns (110 for an id the person opened before). If `isPlaced` is false, toast how to see
  it.
- **Band:** `const rest = await next(e)`. Return `rest` alone when `e.props.hasSurvey` is set, when
  there's nothing to show, or when the hook throws. Size to `e.props.bodyColumns` and stay within
  `e.props.maxRows`.
- **Status:** `$.ui.status(text)` for one short live line, `undefined` to clear it. One per plugin.
- **Toast:** for events, not for state. Keep them under about 80 characters.
- **Timers:** one `$.clock.every` per purpose, running only while something is live. Cancel it when
  that thing ends or the pane closes. No timers while idle.
- **Elements:** `const { Box, Text, Button } = $.ui.resolve(e)`. Check rare ones first
  (`'Raster' in els && e.surface === 'terminal'`) and fall back to `Text`.
- **Never** name a variable `h` or `Fragment` (JSX compiles to them).

## Options

Declare `userConfig` in `plugin.json`, with a `title`, `description` and `default` for each, and
`sensitive: true` for secrets. Read them once in `register(on, options)` and coerce defensively:
`String((options as Record<string, unknown>)?.key ?? '')`.

## README and release

- Every README has: what it does (one screen), the install line, `/name demo`, the options, a
  "What it reaches" table generated from `claude plugin validate` (plus any command hook or MCP
  server, which validate doesn't list), and "built on <version>".
- Version is semver in `plugin.json` *and* the marketplace entry, bumped together.

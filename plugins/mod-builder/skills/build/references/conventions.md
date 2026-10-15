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
- Toggling a pane checks `(await $.ui.panes()).some(p => p.id === NAME && p.isPlaced)` rather than a
  saved flag. A pane that waits undrawn (an unasked open on a narrow terminal) is open but not placed:
  the person's command seats it with `$.ui.open`, so open it rather than fold it.

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

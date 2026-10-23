---
paths:
  - "**/hooks/**"
  - "**/tests/**"
  - "**/types/**"
  - "plugins/mod-builder/skills/build/templates/archetypes/**"
---

# Rules the engine enforces

Claude Code loads this file once Claude reads, writes or edits a file these paths match: a `hooks/`,
`tests/` or `types/` folder, or the build skill's archetype templates. `CLAUDE.md` names it, under the
same heading, for planning hooks or tests before any such file is touched. Before writing hooks, read
`gotchas.md` too (`plugins/mod-builder/skills/build/references/gotchas.md`).

- `$` may only be passed to functions **declared at the top level of `register.tsx`**, never to
  imported functions or closures inside `register`. Module state lives in top-level `let`s.
- `atom({ plugin, key })` and `command.run`/`tool.call` matchers must be **literals** (validate reads them
  statically): strings, or a RegExp literal for a `tool.call` matcher that covers tools the build's types don't
  name (`{ tool: /^(?:Grep|Glob)$/ }`, `gotchas.md`).
- One hook per event + matcher per plugin. Guards (`tool.call`, `command.run`, …) carry `.catch`.
- Tests: nothing sits beneath the mod, so every `$` call needs an `on(...)` stub (including
  `session.start`); one stub per event per test; `$.ui.ask` is a `tool.call` of `AskUserQuestion`;
  `process.spawn` cannot be stubbed (code falls back to `process.run`); test `options` only reach keys
  declared in `userConfig`. Work a hook starts without awaiting may not have run by the time
  `await $.tool.call(...)` returns (it differs between builds, #45): take the clock with
  `mock.clock(on)` and `await clock.settle()` before asserting on it.
- `$.store` is one JSON file per plugin, shared live between sessions; the last write to a key wins,
  so give each session's records their own key.
- `$.clock.sleep` counts against a hook's 10 s budget; other `$` calls don't.
- Don't write files inside a plugin folder; runtime data goes under `~/.claude/<name>-data/`.

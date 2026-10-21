<!--
SPEC template for a Claude Code mod. Copy to <modsDir>/<name>/SPEC.md and fill every slot.

How to fill it (see SKILL.md, "Slots"):
  - Fill every slot the request already answers. Quote the person's words where they set a requirement.
  - Slots of kind HOUSE are never asked: write the house default from references/conventions.md
    and leave it visible here so the person can override it at approval.
  - Ask (AskUserQuestion, batched, ≤4 per call) only for REQUIRED slots still empty, and
    ARCH slots the request leaves genuinely unclear.
  - Delete these HTML comments and any `<…>` placeholder you filled. A placeholder still in
    the file at approval time is a bug.

The SPEC is the single approval gate: it lists every file written, every process run and
everything that costs money or is hard to undo. Nothing is built until the person says yes.
-->

# <Mod Name> — SPEC

> <One paragraph, the person's own framing where possible: who uses it, what they see, why.>

**Non-negotiables** (the person's words; each becomes a test):
- <e.g. "If I set 50, I need to see 50 helpers working. Never quietly use fewer.">

## Slots

| Slot | Kind | Value | Source |
| --- | --- | --- | --- |
| name (kebab-case, = plugin name = pane id) | REQUIRED | `<name>` | <request / asked> |
| archetype | REQUIRED | <primary: band · pane-command · guard · watcher · command-only> [+ hooks added by hand: …] | |
| triggers (events it hooks) | REQUIRED | <session.start, command.run, tool.call {tool:'Bash'}, …> | |
| commands | REQUIRED if any UI | `/<name>` [subcommands: demo, …] | |
| states drawn | REQUIRED | empty · idle · live · done · error · folded · too-narrow · survey · focus (each drawn or "n/a: why"; ui-states.md) | |
| done means | REQUIRED | see section below | |
| state lifetime | ARCH | <session `$.state` atoms · cross-session `$.store` · runtime files in `~/.claude/<name>-data/`> | |
| external reach | ARCH | <none · processes · files · network (hosts) · model calls (model, est. cost) · MCP> | |
| depends on | ARCH | <none · another mod's noun / tool> | |
| options (userConfig) | ARCH | <none · key: type, default> | |
| home | HOUSE | `<modsDir>/<name>/` (a plugin in the folder marketplace) | conventions.md |
| tsconfig | HOUSE | extends `./.claude-plugin/types/tsconfig.json` | conventions.md |
| state API | HOUSE | `atom/read/update` + `types/index.d.ts` PluginState | conventions.md |
| logic split | HOUSE | `$`-free `hooks/<name>-logic.ts`; every `$` call in `hooks/register.tsx` | conventions.md |
| tests | HOUSE | `tests/<name>-logic.test.ts`, `tests/ui.test.tsx` | conventions.md |
| demo | HOUSE | `/<name> demo` shows every state without waiting for real events | conventions.md |
| mid-turn | HOUSE | `immediate: true` on `/<name>` when every subcommand only shows something (opens, closes or fronts a pane, shows or hides the drawing, reads); else waits for the turn | conventions.md |
| after /clear | HOUSE | atoms `session.start` seeds are seeded again in `classic.SessionStart` (`clear`, `resume`, `fork`); n/a when none are | conventions.md |
| built on | HOUSE | Claude Code <version from `claude --version`> | |

## What gets touched

<!-- The approval gate. Be exhaustive; the person approves exactly this list. -->

- **Files written:** `<modsDir>/<name>/…` (list), `.claude-plugin/marketplace.json` (one entry added), <runtime files under `~/.claude/<name>-data/`>.
- **Files outside the repo:** <none · list and why>.
- **Processes run while building:** `claude plugin validate`, `claude plugin test`, `tsc -p` <others>.
- **Processes the mod runs at run time:** <none · `git status`, …>.
- **Costs / hard to undo:** <none · model calls per turn ≈ … · settings changed: …>.

## What I should see

<!-- The most valuable section. Draw it. Exact copy, every state, every size. -->

```
<ASCII mockup of the main view at ~76 columns: masthead, controls, body, footer>
```

- **<Element>:** <what it shows, exact text, colour role, when it appears / hides>.
- **<Button "Label" (hotkey x)>:** <what pressing it does; what the person sees after>.
- **States** (each one, or "n/a: why"):
  - *Empty:* <first run, no data: what it says and how to get data>
  - *Idle:* <…>
  - *Live:* <…>
  - *Done:* <…>
  - *Error:* <… and the exact message>
  - *Folded:* <status-line badge text, e.g. "12 working · 30 done">
  - *Too narrow:* toast "<exact text>"
  - *Survey* (bands): steps aside. *Focus* (panes): <what changes when focused>
- **Narrow / wide layouts:** <breakpoints by `bodyColumns`>.
- **Other surfaces:** <desktop / vscode / mobile: same tree, or a simpler one>.
- **Design bar:** dark, minimal, premium. <palette roles: accent, success, warn, error, dim>. No rainbow, confetti or flashing.

## How it works

<!-- Numbered mechanisms, each tied to the event or `$` call that does it. -->

1. **<Mechanism> (`<event>` / `$.<noun>.<method>`):** <what it does, what it returns, what it never does>.
2. …

## Tests (`claude plugin test`)

<!-- Concrete inputs → outputs. One per non-negotiable at least. Logic tests first. -->

1. `<pureFn>`: `"10"` → `10`; `"abc"` → `null`.
2. <event-driven: "at size 5, a request carries the exactly-5 instruction">
3. <UI: mount Pane on terminal + desktop, find "<text>", press `<key>`, expect …>

## Done means

- <A demonstrable outcome the person can do themselves: "I type /x, …, and see …".>
- All tests pass; `claude plugin validate` is clean (every gating hook has a `.catch`); `tsc -p` is clean.
- `/<name> demo` shows every state listed above.
- README has the install line and the "What it reaches" table generated from `validate`, plus any command hook or MCP server it doesn't list.

## Handoff

When finished, tell the person in plain words: how to open it, how to configure it, and that
`/reload-plugins` (or a new session) picks it up.

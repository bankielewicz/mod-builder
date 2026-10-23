---
name: build
description: This skill should be used when the user wants a Claude Code mod built spec-first and kept, with "/mod-builder:build", "build this mod properly", "spec it out first", "add it to my mods folder or marketplace", or "ship a mod". It writes a SPEC.md for one approval, scaffolds from a tested archetype, verifies with validate, test and tsc, and hands off. To change an existing mod, use /mod-builder:edit. For API questions or a throwaway session mod, use plugin-authoring instead.
---

# mod-builder:build

Build a Claude Code mod: step 0 orients, then five steps, 1 to 5, around one gate:
**request → SPEC → (approval) → build → verify → handoff.**
The API itself is not taught here. The built-in `plugin-authoring` skill and the d.ts it writes
are the source of truth, regenerated for each build. This skill adds what that one leaves
out: a spec, house conventions, the UI-state checklist, tests that cover every requirement the
person won't bend on, a README with a "What it reaches" table, and a home that outlives the session.

Files here, relative to this skill's base directory (the path printed when the skill loads;
also `${CLAUDE_PLUGIN_ROOT}/skills/build`). Read each when its step says to, not all up front:

- `templates/SPEC.template.md`: the spec, with its slot table
- `templates/README.template.md`: the README a mod ships with
- `scripts/scaffold.mjs`: writes a new mod from the scaffold plus one archetype (never overwrites)
- `templates/archetypes/<kind>/*.tpl`: five working mini-mods (band, pane-command, guard, watcher,
  command-only), each with logic, logic tests, a UI test and a state contract
- `templates/tsconfig.check.json`: typecheck a mod before a session has loaded it
- `references/conventions.md`: house rules; these settle every slot of kind HOUSE
- `references/gotchas.md`: engine rules that have broken mods before (verified only)
- `references/patterns.md`: idioms, each with a real mod to read
- `references/ui-states.md`: the states every drawn mod must cover
- `references/verify.md`: step 4's detail: the smoke test's log checks, the installed copy and
  options in a `-p` run, the typecheck procedure, and tests that touch real config
- `references/loading.md`: which copy of a mod runs, how to load it live, and how later edits reach
  it (steps 4 and 5)
- `ci/marketplace.json`: a folder marketplace, offered at step 0.2 when there is none
- `ci/ci.yml`: a GitHub Actions workflow the person can copy into `.github/workflows/`

Maintainer checks for mod-builder's own repository, not part of a build: `scripts/check-archetypes.sh`
regenerates all five archetypes and runs validate, test and tsc, and `scripts/check-sandbox.mjs`
checks that the test loader still refuses `import()` and `node:fs`.

**Ground rule: our own code only.** Other people's mods are reading material. Borrow the idea and
write our own code. Never copy-paste their code, and never install, `--plugin-dir`, or
`claude plugin test` a mod someone else wrote. Mods run unsandboxed, with the person's full access.

## 0. Orient (no questions yet)

1. **Load `plugin-authoring`** with the Skill tool. Note the types path it prints
   (`…/plugin-authoring/types/claude-code.d.ts`) and its examples folder. Grep that d.ts for every
   event, `$` method and element prop the mod uses; never write an API call from memory.
   **Override its WHERE TO WRITE IT:** mods made with this skill live in the mods folder below,
   never in `~/.claude/dev-mods/<session>/`, which is tied to one session.
2. **Find the mods folder.** Walk up from the working directory to the nearest folder holding
   `.claude-plugin/marketplace.json`. That folder is the marketplace root, and the mods folder is
   `<root>/mods/` (entries read `"source": "./mods/<name>"`). If there is none, ask
   once where mods should live, and offer to create a folder marketplace there (`ci/marketplace.json`).
   When the request or the repository's instructions put the work in a git worktree the session
   isn't in (edited by absolute path), walk up from that worktree instead: `<mods>` is its `mods/`.
3. Run `claude --version` and record it as the "built on" version.
4. If `mcp__mod-builder__lab_report` is among the session's tools, Mod Lab is running. Report each
   stage with `{ mod, stage, status, note?, path }`, where status is `running` when the stage starts
   and `passed` or `failed` when it ends, and `path` is the mod folder's absolute path
   (`<mods>/<name>`, from 2). Pass `path` on every report: Mod Lab then watches the folder being
   written, even when the session's working directory is somewhere else, such as a git worktree
   edited by path. It takes only a marketplace's `mods/` in the project's own git repository (its top
   folder or one of its worktrees), and its reply says when it ignored `path`. The stages map to
   steps: Spec → 2, Scaffold → 3.1, Logic → 3.2, Register → 3.3–3.5, Validate and Test → 4, README
   and Share → 5. If the tool isn't there, skip reporting.

## 1. Slots, then questions

Copy `templates/SPEC.template.md`. Its slot table has three kinds:

- **REQUIRED**: name, archetype, triggers, commands, states drawn, done means. Fill each from the
  request; ask only for the ones still empty.
- **HOUSE**: never ask. Write the default from `references/conventions.md` into the slot so the
  person sees it and can override it at approval.
- **ARCH** (state lifetime, external reach, dependencies, options): ask only when the request
  leaves it genuinely unclear *and* the choice changes what gets built.

**License** (the `license` slot): use the SPDX identifier the request names, else the one for the
license text in `<root>/LICENSE` (`<root>` from step 0.2; `MIT License` gives `MIT`). Ask when
neither gives exactly one, as with GPL text, which doesn't say `-only` or `-or-later`: it is the one
question a detailed request still gets. With no answer, write `none` in the slot. Never make one up.

Ask everything in one AskUserQuestion call (up to 4 questions; a second call only if answers
open new gaps). Give each question options with a recommended first choice. A detailed request
(like a filled-in SPEC or a long prompt) gets **zero** questions: go straight to the SPEC.

Choosing the archetype (exactly one, the primary):

| The mod mostly… | Archetype |
|---|---|
| shows a live view | `pane-command` |
| shows a single glanceable line | `band` |
| blocks or rewrites a tool | `guard` |
| reacts to events with status, toast or notify | `watcher` |
| answers with text only | `command-only` |

A mod that needs more than one scaffolds from its primary archetype. Add the other hooks by hand,
reading the other archetype's `register.tsx.tpl` for the pattern. The SPEC names the primary and
each addition.

## 2. SPEC.md, the single gate

Write `<mods>/<name>/SPEC.md` (lab_report: Spec running). Fill **What I should see** with an
ASCII mockup at about 76 columns, exact copy, and every state from `references/ui-states.md` that
applies. Fill **How it works** with numbered mechanisms, each naming its event or `$` call.
Write one test per requirement the person won't bend on. Fill **What gets touched**
exhaustively: files, processes, costs, anything outside the repo.

Then **stop and ask for approval**, in plain words, summarising "What gets touched". This is the
only gate; do not stack more confirmations. Build nothing before a yes. Edits to the SPEC go back
through this gate. (lab_report: Spec passed once approved.)

## 3. Build (in this order)

1. **Scaffold:** run
   `node <base directory>/scripts/scaffold.mjs <archetype> <mods> <name> "<description>" "<author>" "<license>"`.
   `<license>` is the `license` slot, or `""` when it is `none`, which writes no `license` line. The
   arguments are positional, so pass both.
   It writes the manifest, hooks.json, tsconfig, a working `register.tsx`, logic, tests and
   contract, and the README template. Run `claude plugin test` on it at once: it passes as
   generated. Then reshape it to the SPEC, keeping it green throughout.
2. **Logic first:** every `$`-free rule (parsing, text, counts, layout breakpoints, state
   transitions) goes in `hooks/<name>-logic.ts` as exported pure functions, with
   `tests/<name>-logic.test.ts` beside it. Run `claude plugin test` until it passes.
3. **Register:** keep `hooks/register.tsx` thin; it is the only file that spells `$`. Follow
   `references/conventions.md` (command registration, pane opening, guards with `.catch`,
   background work with `void … .catch`) and `references/gotchas.md`. When unsure how to do
   something, `references/patterns.md` names a mod that does it, for ideas only.
4. **Contract:** declare every atom in `types/index.d.ts` under `PluginState['<name>']`.
5. **UI tests:** `tests/ui.test.tsx` mounts each drawn component on `terminal` and `desktop`,
   finds the copy from the SPEC, and presses each Button by key. Band tests check that the band
   below still renders.
6. **Demo:** `/<name> demo` must show every state without waiting for real events.

## 4. Verify (all must pass, with the output shown)

`<scratchpad>` is the session's scratchpad directory, outside the repository and the mod.

```
claude plugin validate <mods>/<name>   # clean; every gating hook has .catch
claude plugin test <mods>/<name>       # all pass
rm -f <scratchpad>/<name>-debug.log    # the log is appended to, never replaced
claude -p --debug-file <scratchpad>/<name>-debug.log --plugin-dir <mods>/<name> "/<name> demo"   # live smoke test
npx -y -p typescript@5.6 tsc -p <scratchpad>/<copy of tsconfig.check.json>   # typecheck; until the mod has loaded once, a copy made as references/verify.md says, then tsc -p <mods>/<name>
```

The smoke test passes when it prints the command's text **and** its debug log shows that this
folder's code is what ran (`grep -n '<name>' <log>`). Start each run with no log: `--debug-file`
appends, so an earlier run's lines would pass or fail this one. Before calling it passed, check the
log as `references/verify.md` says, under "Check the smoke test's debug log". The same file says
why an installed copy needn't be turned off, how a demo that needs an option passes it, how to make
the typecheck copy, and what to do when tests touch real config.

If validate prints a gating hook without `.catch`, add one or say why it is deliberate.

Then load the mod live, one of the two ways `references/loading.md` describes under "Load a mod
live". The person walks through the demo and every "Done means" bullet in that live session, since a
headless run can't press keys. That walk-through is the one item of this step that may be reported as
pending at hand-off, until the person has done it; everything else here must pass.

Report failures as failures, with the output. Any edit to the mod's code after Verify passed makes
those results stale: run Verify again (and report Validate and Test again) before handing off.

## 5. Ship and hand off

1. **README:** finish `<mods>/<name>/README.md`, which the scaffold wrote. Replace every
   `<!-- … -->` comment, and put the version from step 0 in place of `<version>`. Generate the
   "What it reaches" table from `claude plugin validate` output (the hooks, calls and gates
   lines), not from memory. Validate doesn't list settings-style command hooks or MCP servers
   (gotchas.md), so also read `hooks/hooks.json` (entries besides `modules`), `.mcp.json` and
   `plugin.json`'s `hooks` and `mcpServers`, and add a row for each entry, naming its command.
2. **Share:** add `{ "name", "source": "./mods/<name>", "description", "version" }` to the
   marketplace's `plugins` list. Bump `version` in both files on every release.
3. **Hand off** in plain words:
   - how to load it the first time (`/plugin install <name>@<marketplace>`, or `claude --plugin-dir`)
   - how to open it (`/<name>`) and see the demo
   - how to reach its pane when other panes are open: `ctrl+x tab` shows the first tab and gives it the
     keys, each press after moves one tab right, and after the last tab the keys go back to the prompt;
     `Esc` returns the keys from any tab; a click on a tab shows it where the terminal passes clicks
     (`[d.ts]`, not observed)
   - how to configure it (the config menu for `userConfig`)
   - how later edits reach the copy they run, and how the person sees which copy loaded:
     `references/loading.md`, "How later edits reach the copy that runs" and "Check which copy
     loaded"
   - `/modlab` to see its pipeline, if Mod Lab is installed

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A Claude Code **plugin marketplace** (`claudemod`, published as
https://github.com/bankielewicz/mod-builder). It holds the `mod-builder` plugin and example **mods**
(Claude Code plugins whose behaviour lives in a TypeScript hooks module). Mods run inside Claude
Code's own engine: no Node, no DOM, everything outside the module goes through `$`. The API is
early access; everything is built and verified on **Claude Code 2.1.296**.

## Commands

There is no build step and no package.json: the engine loads the TypeScript directly.

```sh
claude plugin validate .                         # the marketplace
claude plugin validate plugins/mod-builder       # one plugin: manifest, hooks, gating hooks, state contract
claude plugin test plugins/mod-builder           # one plugin's *.test.ts(x) (no per-test filter; a run takes ~2 s)
claude plugin test mods/duet                     # likewise for each mod under mods/
bash plugins/mod-builder/skills/build/scripts/check-archetypes.sh   # scaffold all 5 archetypes, validate + test each
claude -p --plugin-dir mods/<name> "/<name> demo"                    # headless live smoke test of a command
claude --plugin-dir plugins/mod-builder                              # interactive session; the folder is watched and hot-reloads
```

Typecheck (needs the bundled API types from the built-in `plugin-authoring` skill, at
`/tmp/claude-*/bundled-skills/<version>/*/plugin-authoring/types/claude-code.d.ts` once that skill has
loaded): copy `plugins/mod-builder/skills/build/templates/tsconfig.check.json` **outside** the repo,
replace `__TYPES__` and `__MOD__`, then `npx -y -p typescript@5.6 tsc -p <copy>`. A mod's own
`tsconfig.json` extends `.claude-plugin/types/tsconfig.json`, which the engine writes only when an
interactive session loads the mod (gitignored).

CI (`.github/workflows/ci.yml`) runs validate + test for every `:(glob)plugins/*` and `:(glob)mods/*`
plugin and the archetype check. **`main` is protected: work on a branch and open a PR.** Codex reviews
every PR automatically; triage its findings by severity, verify each against the code, fix with tests.

## Architecture

**`plugins/mod-builder/`** has three parts:
- `skills/build/SKILL.md` (`/mod-builder:build`): request → slot-filled `SPEC.md` (the single approval
  gate) → `scripts/scaffold.mjs` from one of 5 archetypes in `templates/archetypes/*/*.tpl` → logic
  first → verify → README + marketplace entry. `references/` holds `conventions.md` (house rules),
  `gotchas.md` (verified engine rules), `patterns.md`, `ui-states.md`.
- `skills/edit/SKILL.md` (`/mod-builder:edit`): changes an existing mod, reusing build's steps by
  reference; appends a dated change section to the SPEC and bumps semver.
- **Mod Lab** (`/modlab`), a mod: `hooks/register.tsx` (every `$` call) + `hooks/mod-builder-logic.ts`
  (every rule, pure, unit-tested) + `types/index.d.ts` (the `PluginState` contract for its atoms).
  It scans `modsDir`, judges 8 stages from **files on disk and exit codes** (a model's `lab_report`
  tool call only ever adds "running"), stores run results in `$.store`, re-runs stale checks at the end
  of each turn (`autoRerun`), and treats an edit as a **build generation** (evidence older than the edit
  goes stale). `SPEC.md` sections "Design" and "Edits" record why.

**`mods/*`**: `git-branch`, `duet` (delegates subagents/reviews to the Codex CLI), `issue-forge` (a
GitHub issue to a PR via red/green/refactor subagents behind a diff-coverage gate; this repo's profile
is `.issue-forge.json`, its coverage kit `plugins/mod-builder/skills/build/scripts/coverage/`),
`turn-counter` (left as raw scaffold output on purpose). Each has the same layout and its own
`SPEC.md` with dated changes.

**Template files are `*.tpl`** so `claude plugin test`/`validate` never pick them up as real plugins.

## Rules the engine enforces (read `gotchas.md` before writing hooks)

- `$` may only be passed to functions **declared at the top level of `register.tsx`**, never to
  imported functions or closures inside `register`. Module state lives in top-level `let`s.
- `atom({ plugin, key })` and `command.run`/`tool.call` matchers must be **string literals** (validate
  reads them statically).
- One hook per event + matcher per plugin. Guards (`tool.call`, `command.run`, …) carry `.catch`.
- Tests: nothing sits beneath the mod, so every `$` call needs an `on(...)` stub (including
  `session.start`); one stub per event per test; `$.ui.ask` is a `tool.call` of `AskUserQuestion`;
  `process.spawn` cannot be stubbed (code falls back to `process.run`); test `options` only reach keys
  declared in `userConfig`.
- `$.clock.sleep` counts against a hook's 10 s budget; other `$` calls don't.
- Don't write files inside a plugin folder; runtime data goes under `~/.claude/<name>-data/`.

## Repo conventions

- **Our own code only:** community mods (read under the gitignored `tmp/`) are for ideas; never copy,
  install or run them.
- Every mod README has a "What it reaches" table generated from `claude plugin validate` output.
- Bump `version` in both the plugin's `plugin.json` and its `.claude-plugin/marketplace.json` entry on
  every release (Mod Lab's Share stage checks they match).
- New engine findings go in `gotchas.md` with a source tag: `[d.ts]`, `[probe]` (verified live) or
  `[field]`. Only add what was verified.
- `scratch/` (probes) and `tmp/` are gitignored.

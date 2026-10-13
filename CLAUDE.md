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

One logic test file, or one test by name, runs under node through the coverage kit's loader. UI tests
(`*.test.tsx`) only run under `claude plugin test`.

```sh
node --import ./plugins/mod-builder/skills/build/scripts/coverage/register.mjs --test mods/duet/tests/duet-logic.test.ts
node --import ./plugins/mod-builder/skills/build/scripts/coverage/register.mjs --test --test-name-pattern='BLANKED_ENV' mods/duet/tests/duet-logic.test.ts
```

Typecheck (needs the bundled API types from the built-in `plugin-authoring` skill, at
`/tmp/claude-*/bundled-skills/<version>/*/plugin-authoring/types/claude-code.d.ts` once that skill has
loaded): copy `plugins/mod-builder/skills/build/templates/tsconfig.check.json` **outside** the repo,
replace `__TYPES__` and `__MOD__`, then `npx -y -p typescript@5.6 tsc -p <copy>`. A mod's own
`tsconfig.json` extends `.claude-plugin/types/tsconfig.json`, which the engine writes only when an
interactive session loads the mod (gitignored).

CI (`.github/workflows/ci.yml`) runs validate + test for every `:(glob)plugins/*` and `:(glob)mods/*`
plugin and the archetype check.

## Changing files: a worktree, then a PR

`main` is protected, and the main folder is shared. Several Claude sessions work in it at once, and the
installed plugins (`mod-builder@claudemod`, `duet@claudemod`, `issue-forge@claudemod`) load from whatever
branch it is on. So **never edit, commit or switch branches in the main folder.** Every change to this
repo happens in its own worktree and reaches `main` through a PR:

1. `git fetch origin && git worktree add --no-track -b <branch> scratch/<name> origin/main`
   (`scratch/` is gitignored). Edit, test and commit only inside `scratch/<name>`.
2. Test the worktree's code, not the installed copy, which still loads from the main folder. From
   inside the worktree, the commands above work as written (`claude plugin test mods/duet`); a live
   session there is `claude --plugin-dir <plugin>`. Mod Lab started in a worktree still watches the
   main folder's `mods/` (#23).
3. Push and open the PR: `git push -u origin <branch>`, then `gh pr create --base main --head <branch>`.
   Commit and push each fix on its own. Codex reviews every PR automatically: triage its findings by
   severity, verify each against the code, and fix real ones with a test.
4. The stash list is shared by every worktree. Apply a stash by its SHA, never with a bare
   `git stash pop`.
5. Remove the worktree from a plain shell after the PR merges (`git worktree remove scratch/<name>`).
   Run from Claude Code's sandbox, it fails partway.
6. Even `git status` takes `.git/index.lock`, so a git command in a checkout where another session or
   an issue-forge run is committing can make that commit fail (#28). To only read, use
   `GIT_OPTIONAL_LOCKS=0 git status`.

## TDD: red, green, refactor, QA

Every code change goes through these four phases in order, in any language: TypeScript for mods,
JavaScript for scripts, Python or anything else a change adds. A phase is done only when its command
output shows it. In the commands below, `<kit>` stands for
`./plugins/mod-builder/skills/build/scripts/coverage/register.mjs`.

1. **Red.** Write the test that states the change, and run it. It must fail by assertion, for the
   reason the change exists; a failed import or a syntax error doesn't count. A bug fix starts with a
   test that reproduces the bug. In mods:
   - pure rules go in `hooks/<name>-logic.ts`, and their tests in `tests/<name>-logic.test.ts`;
   - `$` behaviour is tested in `tests/ui.test.tsx`, with an `on(...)` stub for every call (see
     "Rules the engine enforces").
2. **Green.** Write the least code that makes the new test pass, without editing the red tests. Then
   run the plugin's whole suite (`claude plugin test <plugin>`); everything passes.
3. **Refactor.** Tidy the code, keeping behaviour the same. Run the tests after each step. No test is
   edited to make the refactor pass.
4. **QA.** Before pushing, run and show:
   - `claude plugin validate .`, plus `claude plugin validate` and `claude plugin test` for every
     plugin touched;
   - the archetype check, when a template or the build skill changed;
   - the typecheck above;
   - coverage of the changed logic: `node --import <kit> --test --experimental-test-coverage
     --test-coverage-include='**/hooks/*-logic.ts' <logic test files>`. Changed lines and branches
     are covered (issue-forge's gate is 95%), and total coverage doesn't drop;
   - a live check of the behaviour: `claude -p --plugin-dir …` for a command's answer, or an
     interactive session with `--plugin-dir` for panes and keys.

   Put these results in the PR description.

A test that turns out to be wrong is fixed in its own commit, which says why. It is never loosened to
let code pass. `/issue-forge <N>` automates red, green and refactor for a GitHub issue behind these
gates; run it from a worktree.

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
- `scratch/` (probes and worktrees) and `tmp/` are gitignored.

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A Claude Code **plugin marketplace** (`claudemod`, published as
https://github.com/bankielewicz/mod-builder). It holds the `mod-builder` plugin and example **mods**
(Claude Code plugins whose behaviour lives in a TypeScript hooks module). Mods run inside Claude
Code's own engine: no Node, no DOM, everything outside the module goes through `$`. The API is
early access and changes between builds. CI pins **Claude Code 2.1.296** (`CLAUDE_CODE_VERSION`);
local sessions run whatever build is installed (`claude --version`), and `gotchas.md` names the
build each finding was probed on.

## Read first: Anthropic's documents

Required reading before changing anything here (the owner, 2026-10-23). Both folders together run to
about 67,000 words, so read each folder's `README.md` (its page index) and then every page that bears on
the change, not the whole folder (the owner, 2026-10-23: "Pages that bear on it"). Cite the pages read, with
their lines, in the SPEC change.

- **Mods** (`mods/*`, and every mod mod-builder builds): `docs/research/Mods`. Build and change them
  through `/mod-builder:build` and `/mod-builder:edit`.
- **Plugins**, mod-builder included (`plugins/mod-builder`: Mod Lab and its skills):
  `docs/research/claude-plugins`. mod-builder is a plugin that builds mods, not a mod: change it by those
  documents, never through `/mod-builder:edit`, and change its skills through `/plugin-dev:skill-development`.
  Mod Lab's hooks module (`hooks/`, `tests/`, `types/`) runs in the mod engine like any mod, so its code also
  follows `docs/research/Mods` and `gotchas.md` (the owner, approving #138: "i approve as long as you follow
  guidance from anthropic's best practices for claude mod").
- **This file and `.claude/rules/`**: `docs/research/claude-code`, Anthropic's two pages on what belongs
  in `CLAUDE.md` and on the files that load only when needed (the owner, 2026-10-23, revising #150).

## Commands

There is no build step and no package.json: the engine loads the TypeScript directly.

```sh
claude plugin validate .                         # the marketplace
claude plugin validate plugins/mod-builder       # one plugin: manifest, hooks, gating hooks, state contract
claude plugin test plugins/mod-builder           # one plugin's *.test.ts(x) (no per-test filter; a few seconds)
claude plugin test mods/issue-forge              # likewise for each mod under mods/
bash plugins/mod-builder/skills/build/scripts/check-archetypes.sh   # scaffold all 5 archetypes, validate + test each
node plugins/mod-builder/skills/build/scripts/check-sandbox.mjs     # the loader still refuses import()/node:fs tests; canary list = gotchas.md's
claude -p --plugin-dir mods/<name> "/<name> demo"                    # headless live smoke test of a command
claude --plugin-dir plugins/mod-builder                              # interactive session; the folder is watched and hot-reloads
```

One logic test file, or one test by name, runs under node through the coverage kit's loader. UI tests
(`*.test.tsx`) only run under `claude plugin test`, and so does any `*.test.ts` whose name doesn't end in
`-logic.test.ts`: `plugins/mod-builder/tests/sandbox.test.ts` (the sandbox canary, #98) fails under node by
design, since node has the file system it checks is absent.

```sh
node --import ./plugins/mod-builder/skills/build/scripts/coverage/register.mjs --test mods/issue-forge/tests/issue-forge-logic.test.ts
node --import ./plugins/mod-builder/skills/build/scripts/coverage/register.mjs --test --test-name-pattern='in-line' mods/issue-forge/tests/issue-forge-logic.test.ts
```

Typecheck (needs the bundled API types from the built-in `plugin-authoring` skill, at
`/tmp/claude-*/bundled-skills/<version>/*/plugin-authoring/types/claude-code.d.ts` once that skill has
loaded): copy `plugins/mod-builder/skills/build/templates/tsconfig.check.json` **outside** the repo,
replace `__TYPES__` and `__MOD__`, then `npx -y -p typescript@5.6 tsc -p <copy>`. A mod's own
`tsconfig.json` extends `.claude-plugin/types/tsconfig.json`, which the engine writes only when an
interactive session loads the mod (gitignored).

CI (`.github/workflows/ci.yml`) runs `validate --strict` + test for every `:(glob)plugins/*` and `:(glob)mods/*`
plugin, the archetype check and the sandbox check (`check-sandbox.mjs`: the loader still refuses `import()`
and `node:fs` test files, and the canary's list matches `gotchas.md`'s). It is a byte-for-byte copy of the
build skill's template `plugins/mod-builder/skills/build/ci/ci.yml`, so change both together, the version
pin included.

## Changing files: a worktree, then a PR

`main` is protected, and the main folder is shared. Several Claude sessions work in it at once, and the
installed plugins (`mod-builder@claudemod`, `git-branch@claudemod` and
`issue-forge@claudemod`) load from whatever branch it is on. So **never edit, commit or switch
branches in the main folder**, with one exception. After a PR merges, the main folder may be brought
up to date so the installed plugins get the merge: `git switch main && git merge --ff-only origin/main`
after a fetch, then `/reload-plugins` in each session. Do that only when the person asks or agrees, the
folder has no uncommitted changes, and no issue-forge run or other session is working in it. Every
change to this repo happens in its own worktree and reaches `main` through a PR:

1. `git fetch origin && git worktree add --no-track -b <branch> scratch/<name> origin/main`
   (`scratch/` is gitignored). Edit, test and commit only inside `scratch/<name>`.
2. Test the worktree's code, not the installed copy, which still loads from the main folder. From
   inside the worktree, the commands above work as written (`claude plugin test mods/issue-forge`); a live
   session there is `claude --plugin-dir <plugin>`. Mod Lab watches the folder a build or edit
   reports (`lab_report`'s `path`, so a worktree edited by path shows up), else the `mods/` nearest
   the session's project root (`/cd` moves it; Claude's own Bash `cd` doesn't), even though its code
   comes from wherever the plugin loads from.
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
   - `$` behaviour is tested in `tests/ui.test.tsx`, with an `on(...)` stub for every call (see "Rules the engine enforces").
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
gates. This repo's profile sets `"workspace": "worktree"`, so each run adds its own worktree under
`scratch/issue-forge/<branch>/` from `origin/main` and never touches the checkout it starts from;
runs in separate sessions go in parallel. `/issue-forge publish` pushes and opens the PR.

## Architecture

`docs/contributing/architecture.md` describes `plugins/mod-builder/` (the build and edit skills, and
Mod Lab: its stages, store keys and write chain), the mods under `mods/`, and why template files are
`*.tpl`. Read it before changing `plugins/mod-builder` or a mod, to find which file holds what and which
`SPEC.md` records why.

## Rules the engine enforces (read `gotchas.md` before writing hooks)

They are in `.claude/rules/engine-rules.md`: where `$` may be passed, literal atoms and matchers, one
hook per event, what a test must stub, `$.store` sharing, the hook budget, and where runtime data goes.
Claude Code loads that file by itself once Claude reads, writes or edits a file under a `hooks/`,
`tests/` or `types/` folder or the build skill's `templates/archetypes/`. Read it yourself when planning
hooks or tests, before any such file is touched. A session in the main folder that works on a
worktree's files loads two copies, the main folder's and the worktree's; when they differ, follow the
worktree's, the copy its branch is reviewed against.

## Repo conventions

- **Our own code only:** community mods (read under the gitignored `tmp/`) are for ideas; never copy,
  install or run them.
- Every mod README has a "What it reaches" table generated from `claude plugin validate` output,
  plus any command hook or MCP server, which validate doesn't list (`gotchas.md`).
- Bump `version` in both the plugin's `plugin.json` and its `.claude-plugin/marketplace.json` entry on
  every release (Mod Lab's Share stage checks they match).
- New engine findings go in `gotchas.md` with a source tag: `[d.ts]`, `[probe]` (verified live) or
  `[field]`. Only add what was verified.
- `scratch/` (probes and worktrees) and `tmp/` are gitignored.

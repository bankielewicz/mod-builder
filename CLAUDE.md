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

## Rules that always hold

The detail behind each rule is in `docs/contributing/`, and each rule names the section to read and when.

- **Never edit, commit or switch branches in the main folder.** `main` is protected, and the main folder
  is shared. Several Claude sessions work in it at once, and the installed plugins
  (`mod-builder@claudemod`, `git-branch@claudemod` and `issue-forge@claudemod`) load from whatever branch
  it is on. There is one exception: after a PR merges, the main folder may be brought up to date so the
  installed plugins get the merge. Do that only when the person asks or agrees, the folder has no
  uncommitted changes, and no issue-forge run or other session is working in it. Before doing it, read
  the command in `docs/contributing/workflow.md`, the first paragraph of "Changing files: a worktree,
  then a PR".
- **Every change to this repo happens in its own worktree and reaches `main` through a PR.** Before
  starting a change, read `docs/contributing/workflow.md`, "Changing files: a worktree, then a PR": the
  worktree command, testing the worktree's code rather than the installed copy, Codex's review, the
  shared stash list, removing the worktree, and `.git/index.lock`.
- **Every code change goes through four phases in order, red, green, refactor and QA**, in any language:
  TypeScript for mods, JavaScript for scripts, Python or anything else a change adds. A phase is done
  only when its command output shows it.
  1. **Red.** Write the test that states the change, and run it. It must fail by assertion, for the
     reason the change exists; a failed import or a syntax error doesn't count. A bug fix starts with a
     test that reproduces the bug.
  2. **Green.** Write the least code that makes the new test pass, without editing the red tests. Then
     run the plugin's whole suite (`claude plugin test <plugin>`); everything passes.
  3. **Refactor.** Tidy the code, keeping behaviour the same. Run the tests after each step. No test is
     edited to make the refactor pass.
  4. **QA.** Before pushing, run and show every check that `docs/contributing/workflow.md`, "TDD: red,
     green, refactor, QA", lists under QA, and put the results in the PR description.

  A test that turns out to be wrong is fixed in its own commit, which says why. It is never loosened to
  let code pass. Before writing the first test, and before running `/issue-forge <N>` (which automates
  red, green and refactor for a GitHub issue behind these gates), read that section: where a mod's pure
  rules and its tests go, the `on(...)` stub every `$` call needs in a UI test, QA's checks and pass
  criteria in full, and the worktree each `/issue-forge` run adds.

## Repo conventions

- **Our own code only:** community mods (read under the gitignored `tmp/`) are for ideas; never copy,
  install or run them.
- Every mod README has a "What it reaches" table generated from `claude plugin validate` output,
  plus any command hook or MCP server, which validate doesn't list (`gotchas.md`).
- Bump `version` in both the plugin's `plugin.json` and its `.claude-plugin/marketplace.json` entry on
  every release (Mod Lab's Share stage checks they match).
- New engine findings go in `gotchas.md` (`plugins/mod-builder/skills/build/references/gotchas.md`) with
  a source tag: `[d.ts]`, `[probe]` (verified live) or `[field]`. Only add what was verified.
- `scratch/` (probes and worktrees) and `tmp/` are gitignored.

## Where the rest is

| File | Read it | It holds |
| --- | --- | --- |
| [`docs/contributing/commands.md`](docs/contributing/commands.md) | before running a check, a test, the typecheck or a live session, and before changing CI | validate, test, the archetype and sandbox checks and the live smoke test; one test file under node; the typecheck; what CI runs, and its two copies to change together |
| [`docs/contributing/workflow.md`](docs/contributing/workflow.md) | before starting a change, before bringing the main folder up to date, before a code change's first test, and before running `/issue-forge <N>` | the worktree steps and the main folder's one exception; TDD and QA in full; `/issue-forge` runs and their worktrees |
| [`docs/contributing/architecture.md`](docs/contributing/architecture.md) | before changing `plugins/mod-builder` or a mod under `mods/` | mod-builder's skills and Mod Lab, Mod Lab's stages and store keys, the mods, and why templates are `*.tpl` |
| [`docs/contributing/engine-rules.md`](docs/contributing/engine-rules.md) | before writing hooks or tests, with `gotchas.md` before hooks | where `$` may be passed, literal atoms and matchers, one hook per event, what a test must stub, `$.store` sharing, the hook budget, and where runtime data goes |

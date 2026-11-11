# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`mod-builder` is a Claude Code plugin (itself a mod: a hooks module) that builds other Claude Code mods from a
dated copy of Anthropic's mod documentation, test-first, through eight guarded phases. The plugin lives in
`plugins/mod-builder/`; the repository root is a one-entry marketplace (`.claude-plugin/marketplace.json`).

`docs/mod-builder/SPEC.md` is the specification and the record. Sections 1 to 6 say what the plugin is; section
7 is a dated log of every decision, who made it, what was probed, and what is still open. Read its 3.3 (the
phase guard) and the latest 7.x sections before changing behaviour. `docs/mod-builder/BACKLOG.md` holds what
waits until after the MVP. Below, and in the code's comments, "`SPEC.md` 7.x" means that specification; a
`SPEC.md` named among a mod's files (`tests/`, `hooks/`) is the spec of the mod being built, in its own folder.
`docs/limits/README.md` lists the plugin's limits; a behaviour change usually changes a limit there too.
`README.md` is the short entry point for someone arriving from GitHub; the detail lives under `docs/`.

## Commands

Run from the repository's top folder. Needs Claude Code 2.1.322 or later with mods, `bash`, `curl`, `node`, `npx`.

```bash
claude plugin validate --strict plugins/mod-builder      # the manifest and the hooks module, as the engine reads them
claude plugin test plugins/mod-builder                    # module tests: tests/*.test.ts(x), about 2.5 s for all
node --test --test-timeout=120000 plugins/mod-builder/tests/*.test.mjs plugins/mod-builder/scripts/*.test.mjs
node --test plugins/mod-builder/tests/mod-builder-logic-built.test.mjs   # one node test file
```

- `claude plugin validate` and `claude plugin test` try to reach the network and are refused by the command
  sandbox; that changes neither their output nor their exit code.
- The typecheck runs against the installed build's types, which Claude Code writes when its built-in
  `plugin-authoring` skill loads (load it once in a session first; the types are never copied into this
  repository). `docs/development/README.md` has the full reproducible command: it writes a
  `tsconfig.json` outside the repository that includes the types file, `hooks/` and `tests/`, and runs `tsc`.
- To try the plugin: `claude --plugin-dir plugins/mod-builder`, then `/mod-builder:build <what the mod does>` in
  the folder the mod should be built under. To run a headless probe without the installed copy of mod-builder
  interfering, switch it off with `--settings`.

## Architecture

Everything is under `plugins/mod-builder/`.

- **`hooks/mod-builder-logic.ts`: the pure rules.** No `$`, no I/O: which path a phase may write
  (`writeVerdict`), each gate's verdict (`scaffoldGate`, `redGate`, `greenGate`, `verifyGate`, `typecheckGate`),
  which types files to check (`typesToCheck`), the "Built on" line (`builtOnLine`, `builtMisses`), what a
  refusal quotes (`lastLines`, `validateLines`, `refusedAt`), cache staleness. Tested directly by
  `tests/mod-builder-logic*.test.mjs` under `node --test`.
- **`hooks/register.tsx`: the hooks module.** It does the I/O through `$` and asks the rules. Its parts:
  - a `tool.call` hook for the gate tool `mod_builder_gate`, registered **before** the guard, each with a
    `.catch` so a hook that fails refuses instead of being skipped (on 2.1.322 the upper hook's `.catch` is the
    one asked when a lower hook of the same module throws);
  - the guard: a `tool.call` hook on `Edit`, `MultiEdit`, `Write`, `NotebookEdit` that refuses a write the
    current phase does not allow;
  - `check()`, one case per phase, which runs that phase's commands itself (`claude plugin validate`,
    `claude plugin test`, the typecheck, a headless load read in its debug log) and moves the build's record in
    `$.store` only on what they show;
  - the pane (`ui.render`), the `/mod-builder` command, and the documentation refresh.
- **`skills/build/SKILL.md`: what the model is told**, phase by phase, started by `/mod-builder:build`. Its
  wording is pinned by `scripts/skill*.test.mjs`; change a sentence and a test there changes with it.
  `skills/build/templates/pane/` is the one scaffold template (its test is stored as `*.template` so the
  plugin's own test run does not pick it up).
- **`scripts/`**: `refresh-docs.sh` (fetches the mod documentation into dated snapshots under
  `~/.claude/mod-builder-data/v2/`), `lookup.sh` (search a snapshot, answering `page:line`), `scaffold.sh`
  (lays the template), each with `*.test.mjs` beside it.
- **`tests/world.ts`: the fake world for module tests.** `world(on, start)` answers every `$` call from plain
  fields (`w.files`, `w.store`, `w.runs`, `w.compilers`, `w.ran`). Two things to know: a test may build only
  one world (a second `on(...)` after the test first called `$` throws), and `w.whileRunning` is called after a
  run's answer is already picked, so what it sets is the next run's answer.

### The eight phases and what closes when

Knowledge, Describe, Spec, Scaffold, Red, Green, Verify, Done (`SPEC.md` 3.3). The design rule that most recent
changes follow: **a check runs while the files it judges can still be changed** (`SPEC.md` 7.7, 7.10, 7.11).
Scaffold may write everything; Red only `tests/`; Green anything but `tests/` and `SPEC.md`; Verify anything but
`tests/`, `hooks/` and the approved part of `SPEC.md`. So Scaffold ends on validate, a passing test run and the
typecheck; Red on new tests failing by assertion and the typecheck; Green and Verify on the same four checks.
No phase goes back. `SPEC.md` and `tests/` are hashed (at approval, at Red) and a later gate refuses when one
changed, by any tool. Before adding a check to a gate, ask which files it judges and whether they are open
there; `SPEC.md` 7.10 has the table.

The typecheck runs once against every distinct types file that names itself the build's (genuine ones differ
between sessions), never picking one. A refused command is answered with its last 20 lines.

## How changes are made here

`SPEC.md` 7.1 to 7.3 are the working rules; in short:

- **Test-first through the three agents in `.claude/agents/`** (`tdd-test-writer`, `tdd-implementer`,
  `tdd-verifier`), each given a written plan kept outside the repository. The plan embeds every file whole with
  its sha256 and lists mutants the verifier must see fail a named test. An agent that did not write the tests
  reads them against the rule before the red commit.
- **A spec-driven change to an existing test goes in a commit of its own first**, saying why; the red commit
  then holds only new test files and the green commit only code.
- **Code and tests are changed with the Edit or Write tool, never by a shell command.** The agents need a clean
  `git status` and `HEAD` at the commit they are given, so nothing else touches the worktree while one runs.
- **A verifier's PASS is not the whole check** (7.2): a rule given as exact is also run against the real engine
  or real command output before it is built, and what was probed is recorded with a `[ran]` or `[read]` tag.
- **Record decisions in `SPEC.md` section 7 with who made them.** Instructions and dialog answers may come from
  another Claude session the owner works through ("the driving session"), not the owner; say which.
- The GitHub repository is `https://github.com/bankielewicz/mod-builder` (remote `origin`). Changes reach
  `main` there through a pull request the owner merges; never push to `main` and never push unasked. Commits
  use the owner's GitHub noreply address (set in this repository's git config; `SPEC.md` 7.13). Commit trailers
  are copied as the plan or the session's attribution gives them.

`devforgeai/handoff/` (ignored by git) holds session handoffs; `TASKS.md` there lists each plan's commits.

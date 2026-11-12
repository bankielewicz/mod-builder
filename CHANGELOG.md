# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## 0.3.0 - 2026-11-12

The plugin's own agents, a closed Scaffold and a way back to Red
([`docs/mod-builder/SPEC.md`](docs/mod-builder/SPEC.md), section 9).

### Added

- A test reader at every Red, in a build and in an edit: an agent the plugin itself starts, with `Read`,
  `Grep` and `Glob` only, that reads the tests against the spec and says which behaviours no test would
  catch. Its findings hold Red; a rule reads the verdict from the first line of the answer the plugin stored.
  After two rounds that do not pass, the person is asked, "Not yet" first.
- Test files closed to guarded writes while the reader reads; tests that changed during a reading count as a
  round and are read again.
- A way back from Green to Red: after Green's test run has failed twice in a row the gate offers
  `back_to_red`, and the person's "Go back to Red" reopens the tests. The code stays as it is, closed; returns
  are counted and shown.
- `--agents` as the first word of `/mod-builder:build` or `/mod-builder:edit`: the plugin's test-writer writes
  the tests at Red and its implementer the code at Green and Verify, and the guard refuses those writes from
  anyone else. Neither agent has a shell; a teammate of either type is refused at its spawn.
- Three reference files the skills name: `reference/test-reader.md`, `reference/back-to-red.md`,
  `reference/agents.md`.
- The pane's rows for the reader's rounds and findings, a return from Green, and a build that uses agents.

### Changed

- Scaffold holds the template and nothing else: its gate refuses a file under `hooks/` or `tests/` that is
  changed, missing or extra, and Red's gate holds `hooks/` to the template too. `scaffold.sh --check` and
  `--again` serve it.
- Before Green a build may hold no source file outside `hooks/` and `tests/`.
- A build's typecheck names its test files, as an edit's does.
- A session refused a folder that another session holds is told that session's id and how to release it:
  resume it and run `/mod-builder stop` there.
- The plugin's node tests make their temporary folders under one folder for the run and remove it when they
  end.

## 0.2.0 - 2026-11-11

Changing a finished mod ([`docs/mod-builder/SPEC.md`](docs/mod-builder/SPEC.md), section 8).

### Added

- `/mod-builder:edit <mod folder> <what to change>` changes a finished mod, or repairs one a Claude Code
  update broke, through seven phases: Knowledge, Describe, Spec, Red, Green, Verify, Done.
- A baseline (the mod's four checks as it stands) and a restore point (a copy of the mod under
  `~/.claude/mod-builder-data/v2/restore/`), both taken before an edit writes anything.
- The change as a new section at the end of the mod's `SPEC.md`, with the text above it held as it was, and a
  `version` that must be greater at Green.
- A question to the person when a test file the mod had before the edit is changed or gone, with the removed
  lines and the tests that no longer exist; "Not yet" is the first option.
- A repair: a mod whose baseline fails skips Red when its test files still typecheck, and enters Red first
  when they don't.
- "Approve: no behaviour change", which skips Red and holds every test as it was; and, whenever Red was
  skipped, a question at Green listing the files changed and what differs in what the mod hooks, answers and
  calls, asked again at Verify for what changed since.
- `/mod-builder stop`, which ends this session's build or edit at any phase and, for an edit, offers to put
  the mod back as it was; nothing is deleted.
- A status line that names the phase, and toasts for a refused write, a finished build or edit, and a
  documentation refresh.

### Changed

- The pane is rebuilt: the phases with the current one marked, what each passed gate saw, the current phase's
  checks with their results, how often a write was refused, what the person agreed to, and what was stopped.
- The build skill's Done names `/mod-builder:edit` as how a finished mod is changed.
- The typecheck names every test file of a mod, wherever it is.

## 0.1.0 - 2026-11-10

The MVP candidate, as the design record ([`docs/mod-builder/SPEC.md`](docs/mod-builder/SPEC.md)) defines it.

### Added

- `/mod-builder:build <what the mod should do>` builds a mod through eight phases: Knowledge, Describe, Spec,
  Scaffold, Red, Green, Verify, Done.
- A guard that refuses a write (`Edit`, `MultiEdit`, `Write`, `NotebookEdit`) the current phase does not allow,
  and one gate tool, `mod_builder_gate`, that runs each phase's check itself and is the only way to the next
  phase.
- The person's approval of the mod's spec, asked by the plugin, with "Not yet" as the first option.
- Gates that end Scaffold on validate, a passing test run and the typecheck; Red on new tests failing by
  assertion and the typecheck; Green and Verify on validate, the tests, the typecheck and a headless load.
- A typecheck against every distinct types file of the running build, and a "Built on" line the gate prints
  and Verify checks.
- A refused command answered with its last 20 lines.
- A dated cache of Anthropic's mod documentation, refreshed when stale or with `/mod-builder refresh`, and a
  lookup script that answers with page and line.
- A pane that shows the phases, what the last gate saw, and the snapshot in use.
- One scaffold template, `pane`.

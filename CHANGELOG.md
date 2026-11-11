# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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

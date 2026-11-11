# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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

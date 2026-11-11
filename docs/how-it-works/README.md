# How mod-builder works

A Claude Code plugin that builds Claude Code mods (a pane, a command, a hook on tool calls: a plugin with a
hooks module) from a dated copy of Anthropic's mod documentation, test-first, through eight guarded phases.

A model's training stops at a date, and the mods API changes after it. So this plugin's rule is that the
model's memory is never the source for what a mod can do: every claim comes from a snapshot of Anthropic's own
pages or from the types of the build that is running, and a hook holds the build to its phases so that a step
can't be skipped by saying it was done.

## What it does

- **Keeps the documentation fresh.** At the start of an interactive session it fetches Anthropic's mod pages
  when the last fetch is older than `refreshDays` (a plugin option, 7 by default; 0 turns it off) or the Claude
  Code version changed. Snapshots live in `~/.claude/mod-builder-data/v2/docs/<UTC stamp>/`, with a
  `_changes.md` line diff against the snapshot before. `/mod-builder refresh` fetches now.
- **Builds a mod in eight phases**: Knowledge, Describe, Spec, Scaffold, Red, Green, Verify, Done. The skill
  sends the model to `scripts/lookup.sh` for every API fact, and the mod's `SPEC.md` cites the snapshot page and
  line of each one.
- **Guards the phases.** A `tool.call` hook refuses a write (`Edit`, `MultiEdit`, `Write`, `NotebookEdit`) that
  the current phase does not allow. One tool, `mod_builder_gate`, is the only way to the next phase, and it
  runs each phase's check itself: the person's approval of the spec (asked by the mod, "Not yet" first),
  `claude plugin validate --strict`, `claude plugin test`, a typecheck against the build's own types, and a
  headless load read in its debug log. The spec is hashed at approval and the tests at Red; a later gate refuses
  when one of them changed, by any tool.
- **Shows where the build stands** in a pane: the phase strip, what the last gate saw, and the snapshot in use.

The rules each phase and gate follows, and how each was decided, are in the design record:
[`../mod-builder/SPEC.md`](../mod-builder/SPEC.md), section 3.3. What it can't do is in [Limits](../limits/README.md).

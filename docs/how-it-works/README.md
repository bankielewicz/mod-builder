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
  headless load read in its debug log. Scaffold ends on validate, a passing test run and the typecheck; Red on
  new tests failing by assertion and the typecheck; Green and Verify on validate, the tests, the typecheck and
  the load. The spec is hashed at approval and the tests at Red; a later gate refuses when one of them changed,
  by any tool.
- **Changes or repairs a finished mod** with `/mod-builder:edit <mod folder> <what to change>`, in seven
  phases: Knowledge, Describe, Spec, Red, Green, Verify, Done (there is no Scaffold).
  - The gate's first call names the mod, runs its four checks as it stands (the baseline) and copies the folder,
    without `.git` and `node_modules` at its top, to a restore point under
    `~/.claude/mod-builder-data/v2/restore/<session id>/<UTC stamp>/`, before anything is written.
  - Spec: the change is a new section at the end of the mod's `SPEC.md`; nothing above it may change, and the
    person approves it.
  - Red writes test files only, and ends when a new or changed test fails by assertion and the typecheck
    passes. When a test file the mod had before the edit is changed or gone, the gate shows which, with the
    removed lines and the names of tests that no longer exist, and asks; "Not yet" keeps the edit at Red.
  - Green writes code only and ends on the four checks and a `version` greater than before. Verify adds the
    "Built" lines to the section.
  - A mod whose baseline fails is a repair. Its failing checks are the red evidence: when its test files still
    typecheck, Red is skipped; when they don't, Red comes first and ends when they do. A mod with no test
    file is an edit whose Red writes its first tests.
  - An edit put forward as changing no behaviour can be approved with "Approve: no behaviour change", which
    skips Red and holds every test as it was. Whenever Red was skipped, Green's gate lists the files that
    changed, with line counts, and what differs in what the mod hooks, answers and calls
    (`calls: added $.ui.toast`), and asks before going on; a change made after that is asked about again at
    Verify, showing only what differs since the answer.
  - `/mod-builder stop` ends this session's build or edit at any phase. For an edit it asks: "Keep the mod as
    it is now" or "Put it back as it was before this edit". Putting it back deletes nothing: the folder as it
    is now is renamed `<mod>.stopped-<stamp>` beside the mod and the restore point is copied in its place; the
    mod's own `.git` moves with it, so its git history is as it is now.
- **Shows where the build or edit stands** in a pane: the phases with the current one marked; for each phase
  passed, what its gate saw; at the current phase, what it may write, its checks with their results and how
  often a write was refused there; the baseline and restore point of an edit; what the person agreed to; at
  Done, what was built and how to try it; after a stop, what was stopped and where both folders are. The
  status line under the prompt names the phase, and a toast says when a write was refused or the work is done.

The rules each phase and gate follows, and how each was decided, are in the design record:
[`../mod-builder/SPEC.md`](../mod-builder/SPEC.md), section 3.3 for a build and section 8 for an edit. What it can't do is in [Limits](../limits/README.md).

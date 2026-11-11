# mod-builder

A Claude Code plugin that builds Claude Code mods (a pane, a command, a hook on tool calls: a plugin with a
hooks module) from a dated copy of Anthropic's mod documentation, test-first, through eight guarded phases.
Use it so that what a mod can do comes from Anthropic's current pages and the running build's types, never
from the model's memory, and so that no step is skipped by saying it was done. A finished mod is changed, or
repaired after a Claude Code update, the same way, with `/mod-builder:edit`.

## Requirements

- Claude Code 2.1.322 or later with mods
- `bash`, `curl` and `npx` (the typecheck uses an installed `tsc`, else downloads TypeScript once)

## Install

```bash
claude --plugin-dir /path/to/mod-builder/plugins/mod-builder
```

or install it from this repository as a marketplace (`.claude-plugin/marketplace.json` has one entry,
`mod-builder`), in one step on Claude Code 2.1.275 or later:

```text
/plugin install mod-builder --marketplace bankielewicz/mod-builder
```

## Quick start

In the folder the mod should be built under:

```text
/mod-builder:build a pane that counts the turns in this session
```

What you see, in order:

1. A pane opens beside the chat with the eight phases (Knowledge, Describe, Spec, Scaffold, Red, Green,
   Verify, Done), what the last gate saw, and the documentation snapshot in use.
2. At Spec, mod-builder asks you to approve the mod's `SPEC.md`. "Not yet" is the first option, so a stray
   Enter can't approve; choose "Approve" when the spec is right.
3. The build goes on through Scaffold, Red, Green and Verify; each phase ends on checks the plugin runs itself.
4. The mod is built in `./<mod-name>/`. Load it with `claude --plugin-dir ./<mod-name>`.

To change the finished mod, or to repair it when a Claude Code update broke it:

```text
/mod-builder:edit ./<mod-name> make each row fit the pane's width
```

The edit first runs the mod's own checks and copies the mod to a restore point, then goes through seven
phases (Knowledge, Describe, Spec, Red, Green, Verify, Done): the change is a new section at the end of the
mod's `SPEC.md` that you approve, its tests come before its code, and the mod's version rises. When an
earlier test is changed or removed, mod-builder shows you which and asks before going on.
`/mod-builder stop` ends an edit at any phase and offers to put the mod back as it was.

## Commands

| Command | What it does |
|---|---|
| `/mod-builder:build <what the mod should do>` | starts a build |
| `/mod-builder:edit <mod folder> <what to change>` | starts an edit, or a repair, of a finished mod |
| `/mod-builder` | opens the pane and says where the build or edit stands |
| `/mod-builder refresh` | fetches the documentation now |
| `/mod-builder stop` | ends this session's build or edit; for an edit, asks whether to put the mod back |

`/mod-builder <other words>` starts nothing, and answers with the `/mod-builder:build` line to use.

## Limits you will meet first

- It is not a sandbox: the guard catches a skipped step and a changed test or spec, not a shell command.
- A build or an edit can't go back a phase: the spec is fixed at approval and the tests at Red.
- An edit that skips Red (no behaviour change, or a repair whose tests still fit) rests on the tests the mod
  already had and on your answer to a list of what changed.
- One template, `pane`; there is no sharing step yet.

The full list is in [Limits](docs/limits/README.md).

## Documentation

- [How it works](docs/how-it-works/README.md): the phases, the guard and the gate, an edit, the documentation cache
- [Reference](docs/reference/README.md): what it reaches (hooks, API calls, files, commands, network), "Built on"
- [Limits](docs/limits/README.md): the full list
- [Development](docs/development/README.md): the plugin's own tests and typecheck
- [Design record](docs/mod-builder/SPEC.md): what was decided, by whom, and what was run to check it
- [Roadmap](docs/mod-builder/BACKLOG.md): what is not built yet. Everything else here describes what exists.
- [Contributing](CONTRIBUTING.md), [code of conduct](CODE_OF_CONDUCT.md), [security](SECURITY.md),
  [changelog](CHANGELOG.md), [licence](LICENSE) (MIT)

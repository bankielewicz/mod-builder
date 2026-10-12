# The archetypes

[← README](../README.md)

Every mod starts from one of five tested archetypes. Each is a small working mod with logic, unit
tests, a UI test and a state contract, and CI regenerates all five on every push.

| Archetype | Use it when | What it draws | The template |
|---|---|---|---|
| `band` | You want a glanceable line above the prompt | A band that hides when idle and steps aside for surveys | Counts this turn's tool calls |
| `pane-command` | A slash command should open a live view | A docked pane with buttons and hotkeys | A selectable checklist |
| `guard` | You want to block or confirm a tool call | An "Allow once / Deny" dialog | Holds risky shell commands (`rm -rf`, force pushes) and refuses them if the check itself fails |
| `watcher` | You want to react without blocking anything | A status line count, a toast, a native notification | Counts turns and tool calls, flags slow turns |
| `command-only` | Text answers are enough | Only the command's reply | Notes that outlive the session |

A mod that needs more than one starts from its main archetype, and the SPEC names the hooks added
by hand. [`mods/turn-counter/`](../mods/turn-counter/) is an example the scaffold produced.

# Turn Counter — SPEC

> A one-line band above the prompt that counts the current turn's tool calls and failures, so
> you can see at a glance how busy Claude is. Built as Mod Lab's first live test subject.

**Non-negotiables:**
- The band never shows when nothing has run this turn.

## Slots

| Slot | Kind | Value | Source |
| --- | --- | --- | --- |
| name | REQUIRED | `turn-counter` | request |
| archetype | REQUIRED | band | request |
| triggers | REQUIRED | session.start, command.run, prompt.submit, tool.call, turn.complete, ui.render AbovePrompt | archetype |
| commands | REQUIRED | `/turn-counter` [demo, hide, show] | archetype |
| states drawn | REQUIRED | idle (hidden) · live (count) · survey (steps aside); others n/a: a band has no pane | ui-states.md |
| done means | REQUIRED | see below | |
| state lifetime | ARCH | session atoms | house |
| external reach | ARCH | none | archetype |
| built on | HOUSE | Claude Code 2.1.296 | claude --version |

## Done means

- `/turn-counter demo` shows the band; the next turn clears it.
- All tests pass and `claude plugin validate` is clean.

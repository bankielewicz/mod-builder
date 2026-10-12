# mod-builder

Build Claude Code mods spec-first, and watch each one come together live.

The plugin has two halves:

- **`/mod-builder:build <idea>`** is a skill. It turns an idea into a working mod in five steps:
  1. **Interview:** it asks only about gaps in the request.
  2. **SPEC.md:** the one thing you approve.
  3. **Build:** a scaffold from one of five tested archetypes, then logic first, then hooks.
  4. **Verify:** `claude plugin validate`, `claude plugin test` and `tsc`.
  5. **Hand off:** a README with a "What it reaches" table, plus a marketplace entry.

  It builds on Claude Code's built-in `plugin-authoring` skill for the API, and adds the house
  conventions, a UI-state checklist and a list of engine gotchas, each one verified.
- **Mod Lab (`/modlab`)** is a mod. It shows off what a mod can do while it tracks every mod under
  `mods/`:

```
  M O D   L A B                                          ● B U I L D I N G

  3 mods · 2 green · 1 building                          modsDir  …/mod-builder/mods

  ▸ agent-dock      ● ● ● ● ◐ ○ ○ ○   validating                      0:07
    inbox-zero      ● ● ● ● ● ● ● ●   12 tests · clean                2:14
    tab-namer       ● ● ● ● ● ● ● ●   6 tests · clean                 1:38
                    SpScLoReVaTeRESh
  ────────────────────────────────────────────────────────────────────────
  agent-dock                                  v0.1.0 · mods/agent-dock/
  Docks every sub-agent's output beside the transcript.

  Spec ━ Scaffold ━ Logic ━ Register ━ Validate ┅ Test ┄ README ┄ Share

  [V] Validate  [T] Test  [K] Type-check  [O] README
  [J] Next  [P] Prev  [N] New mod  [D] Demo
```

  It uses every surface a mod can draw on:

  | Surface | What Mod Lab puts there |
  |---|---|
  | Pane beside the transcript | eight stage lights per mod, judged from disk and exit codes |
  | Band above the prompt | each running stage, with a sweep and a timer |
  | Status line | `◆ 3 mods · 1 building` |
  | Toasts and a native notification | when validate or test finishes, and when a mod is ready to share |
  | Hotkey buttons | V T K O N D, plus `[F] Fix with Claude` on a failure |
  | Pre-filled prompts | `[N]` and `[F]` |
  | A model-callable tool | `lab_report`, which the skill calls so the stage it's on lights up as it works |

## Try it

```
/modlab demo
```

A pretend mod, `aurora`, walks through every stage in 12 seconds. One test fails and Claude
fixes it. Press D again to stop it. Nothing is written to disk.

Then start a real one:

```
/mod-builder:build a band above the prompt showing the current git branch
```

## Install

From GitHub:

```
/plugin install mod-builder --marketplace bankielewicz/mod-builder
```

Or from a local clone of https://github.com/bankielewicz/mod-builder, which is a folder marketplace:

```
claude plugin marketplace add ./mod-builder
/plugin install mod-builder@claudemod
```

Edits to the folder load with `/reload-plugins`. While developing:
`claude --plugin-dir plugins/mod-builder`.

## Options

| Option | Default | What it does |
| --- | --- | --- |
| `modsDir` | the marketplace's `mods/` | The folder whose child folders Mod Lab tracks |
| `autoOpen` | `false` | Open Mod Lab when the skill reports a running stage, if the window is at least 144 columns wide |

## What it reaches

Mods are not sandboxed. They run with your access and skip Claude's permission prompts, so this
table lists everything this one can touch. It is taken from `claude plugin validate`.

| Reach | Detail |
| --- | --- |
| Hooks | `session.start`, `command.run{modlab}` (answers its own command), `tool.call{mcp__mod-builder__lab_report}`, `tool.call{Write\|Edit}` (watch only: it never blocks or rewrites), `turn.complete`, `ui.close`, `ui.render{Pane modlab}`, `ui.render{AbovePrompt}` |
| Processes | `claude plugin validate --json <mod>` and `npx -y -p typescript@5.6 tsc -p <mod>` (`$.process.run`); `claude plugin test <mod>` streamed with `$.process.spawn` so the band fills on real progress (it falls back to `$.process.run` if the stream can't start). Only when you press V, T or K, or when the skill reports a Validate or Test stage. Never on a timer. |
| Files | Reads under `modsDir` and the marketplace file beside it. Writes nothing. |
| Network | None from the mod itself. The first Type-check makes `npx` download TypeScript. |
| Model calls | None |
| Tools it adds | `lab_report`, which records progress and runs nothing beyond the Validate and Test above |
| Gating hooks | 3, all with `.catch`: `lab_report`, the `Write\|Edit` watch, `ui.close` |

## Development

```
claude plugin validate plugins/mod-builder
claude plugin test plugins/mod-builder               # 38 tests: logic and UI
bash plugins/mod-builder/skills/build/scripts/check-archetypes.sh   # all five archetypes
```

- `hooks/mod-builder-logic.ts` holds every rule. It has no `$` calls and is unit-tested.
- `hooks/register.tsx` is the only file that calls `$`.
- `SPEC.md` is Mod Lab's own spec, written from the skill's template.
- `design/CLAUDE_DESIGN_PROMPT.md` is the brief for UI mockups. The mockups it produced (`tmp/mod-lab-mockups-review/`) are what the pane follows; SPEC.md's Design section lists the decisions.

Built on Claude Code 2.1.296. Function hooks are early access, so the API may change between releases.

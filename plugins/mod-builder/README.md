# mod-builder

Build Claude Code mods spec-first, change them the same way, and watch each one come together
live.

The plugin has three parts:

| Part | Command | What it does |
|---|---|---|
| **build** (skill) | `/mod-builder:build <idea>` | Turns an idea into a working mod in five steps around one approval: interview for gaps, a `SPEC.md` you approve, a scaffold from one of five tested archetypes with logic first, verify (`claude plugin validate`, `claude plugin test`, `tsc`, a headless smoke test), then ship with a "What it reaches" README and a marketplace entry. |
| **edit** (skill) | `/mod-builder:edit <mod> <change>` | Changes an existing mod the same way: appends a dated change to its SPEC for one approval, bumps the version by semver, changes logic first, re-verifies and re-ships. It never re-scaffolds. |
| **Mod Lab** (mod) | `/modlab` | Tracks every mod in your mods folder through eight stages, live, on every surface a mod can draw on. |

Both skills build on Claude Code's built-in `plugin-authoring` skill for the API. They add house
conventions, a UI-state checklist, 14 patterns and a list of 65 engine gotchas, each tagged by how
it was verified.

## Mod Lab

```
  M O D   L A B                                          ● B U I L D I N G

  3 mods · 2 green · 1 building                          modsDir  …/mod-builder/mods

    MODS            1 2 3 4 5 6 7 8
  ▸ agent-dock      ● ● ● ● ◐ ○ ○ ○   running tests · 7 of 12          0:07
    inbox-zero      ● ● ● ● ● ● ● ●   12 tests · clean                2:14
    tab-namer       ● ● ● ● ◌ ◌ ● ●   files changed · re-run Validate 1:38
  ────────────────────────────────────────────────────────────────────────
  agent-dock                                  v0.1.0 · mods/agent-dock/
  Docks every sub-agent's output beside the transcript.

  1 Spec ━ 2 Scaffold ━ 3 Logic ━ 4 Register ━ 5 Validate ━ 6 Test ┅ 7 README ┄ 8 Share

  ctrl+x tab (again: next tab), then V validate · T test · K types · O readme · J/P move · N new · D demo · esc to leave
  [ Validate ]  [ Test ]  [ Type-check ]  [ README ]
  [ Next ]  [ Prev ]  [ New mod ]  [ Demo ]
```

**Reading the pane**

- **The header row** puts `MODS` over the names and a stage number over each light. The number over
  the selected mod's failed (red), running (coral) or stale (gold) stage lights up. The track below
  repeats the numbers beside each stage name, so `5` is Validate.
- **The lights:**

  | Light | Meaning |
  |---|---|
  | `●` | passed |
  | `◐` | running |
  | `✕` | failed |
  | `○` | not done yet |
  | `◌` | stale: it passed, but the code changed afterwards, or an edit started |

- **The row's status** follows a run as it streams (`running tests · 7 of 12`), and the time column
  shows the run's elapsed time.
- **The selection follows the active build.** When the skill reports a stage on a mod, that mod is
  selected. <kbd>J</kbd>/<kbd>P</kbd> still move it.

**What Mod Lab uses**

| Surface | What Mod Lab puts there |
|---|---|
| Pane beside the transcript | Stage lights per mod, judged from disk and exit codes; a detail panel with version, description, the numbered track, HOOKS, REACHES and gating hooks; an error box with **[F] Fix with Claude**; a "ready to share" box |
| Band above the prompt | Each running stage, with a 15-cell bar that fills on **real** progress: streamed test counts against the last run's total, otherwise stages passed of 8 |
| Status line | `◆ 3 mods · 1 building` |
| Toasts and a native notification | When validate or test finishes, and when a mod is ready to share |
| Hotkey buttons | V T K O J P N D, and F on a failure; <kbd>ctrl</kbd>+<kbd>x</kbd> <kbd>tab</kbd> gives the pane the keyboard (a dim line says so) |
| Pre-filled prompts | `[N]` for a new mod; `[F]` for a fix request quoting the first failure |
| A model-callable tool | `lab_report`: the skills report each stage as they work, so the pane lights up live. The disk and exit codes always decide pass or fail. |

**Stages, and what an edit asks for**

| # | Stage | Passes when | During an edit, re-passes when |
|---|---|---|---|
| 1 | Spec | `SPEC.md` has no `<placeholder>` left | `SPEC.md` is saved again |
| 2 | Scaffold | `plugin.json` and `hooks/hooks.json` exist | stays green |
| 3 | Logic | a logic module and a `*.test.ts` exist | a logic or test file changes |
| 4 | Register | `hooks/register.tsx` exists | stays green |
| 5 | Validate | the last validate passed, with no code changed since | it runs again |
| 6 | Test | the last test run passed, with no code changed since | it runs again |
| 7 | README | it has "What it reaches" and no template comments | it's saved again |
| 8 | Share | the marketplace lists the mod | the marketplace lists the new version |

An edit starts a **build generation** with its first report. Every stage that passed before turns
`◌`, except Scaffold and Register, which stay green, and turns green again as the change redoes it. The generation ends, and "ready to share"
fires again, when all eight are green.

**Checks re-run themselves.** At the end of each of Claude's turns (not a subagent's), Mod Lab rescans every mod. Edits from any
tool count, Bash included. With `autoRerun` on (the default), it then re-runs what went stale: a
stale Validate runs again, followed by Test if Validate passes and Test has run before; a stale
Test alone runs again if Validate passed. Nothing runs mid-turn or on a timer.

**The pane follows Claude's edits mid-turn.** After each batch of Claude's tools, Mod Lab reads again the
mods an Edit, Write or NotebookEdit changed in the folder it watches (a worktree a build reported
included). After any other tool that isn't read-only (Bash, PowerShell, a subagent, an MCP tool), whose
paths it can't read, it lists each folder's top, `hooks/`, `tests/` and `.claude-plugin/`, and the
marketplace beside them, and reads only the folders whose `SPEC.md`, `README.md`, `.mcp.json`, manifest
or files there changed (every mod, when the marketplace did). A batch of only Read, Grep, Glob,
WebFetch, WebSearch, TodoWrite, AskUserQuestion or `lab_report` calls looks at nothing. Such a change
deeper down, or in `types/`, `agents/`, `commands/` or `skills/`, shows at the next report, command or
turn end. This only redraws the pane: no check runs from it. Where an organization manages Claude
Code, plugins you install don't get this event, and the pane refreshes as before.

## Try it

```
/modlab demo
```

A pretend mod, `aurora`, walks through every stage in 12 seconds. One test fails and Claude
fixes it. Press D again to stop it. Nothing is written to disk.

Then start a real one, and change it later:

```
/mod-builder:build a band above the prompt showing the current git branch
/mod-builder:edit git-branch also show how many commits are unpushed
```

| `/modlab` command | What it does |
|---|---|
| `/modlab` | Open the pane; again to fold it to the status line. If the pane is open as a tab behind another, it comes to the front with the keyboard instead of folding |
| `/modlab demo` | Play the demo |
| `/modlab <mod>` | Open the pane on that mod (a pane behind another tab comes to the front) |
| `/modlab new <idea>` | Put `/mod-builder:build <idea>` in the prompt box |

Typing `/mod-builder:build` or `/mod-builder:edit` opens Mod Lab too. A command you type opens the pane at any
width. When Mod Lab opens it on its own (`autoOpen`, or when Claude starts a build you asked for in plain words),
the window must be at least 144 columns wide, or 110 once you've opened Mod Lab yourself. Narrower than that, watch
the status line.

Reaching the pane when other panes are open: `ctrl+x tab` shows the first tab and gives it the keyboard,
each press after moves one tab right, and after the last tab the keyboard goes back to the prompt. `Esc` hands
it back from any tab. A letter that is one of the pane's keys acts at once. To cycle without going through the
first tab, bind `pane:next` and `pane:previous` (no default key) in `~/.claude/keybindings.json`; it works while a
pane holds the keyboard:

```json
{"bindings":[{"context":"Pane","bindings":{"ctrl+x n":"pane:next","ctrl+x p":"pane:previous"}}]}
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

Each way of loading the plugin (`--plugin-dir`, or an installed copy) keeps its own store, and
within it each mods folder keeps its own results. If you switch either one (another way of loading,
or a `/cd` into another worktree), Validate and Test show `○` until you press V and T once.
Results don't build up (0.2.30): at session start, Mod Lab deletes those of a mods folder that's gone, such as a
removed worktree, and each scan drops a mod that's no longer in its folder. A folder it can't check, such as one it
has no permission to read, keeps its results, and so does a folder that lists no mods at all. A drive that isn't
mounted reads as gone.

## Options

| Option | Default | What it does |
| --- | --- | --- |
| `modsDir` | empty: the `mods/` of the marketplace nearest the session's project root (where it started, or where `/cd` took it), else the one next to this plugin | The folder whose child folders Mod Lab tracks. Set, it always wins. Empty, a build that reports its folder (the build and edit skills do) is watched for the rest of the session, until a `/cd` moves the project root or the folder's marketplace is gone; only a marketplace's `mods/` in the project's own git repository (its top folder or one of its worktrees, read from `.git` on disk) is taken, since Validate and Test run there; a nested clone or a copy, such as community mods kept in an ignored folder, is not. Before any report, it is the `mods/` of the marketplace nearest the project root (then nearest the working directory), so a session in a git worktree watches that worktree's `mods/`; a `/cd` takes effect at the next scan, and Claude's own `cd` in Bash doesn't move it. In another repository with a `.claude-plugin/marketplace.json`, that is its `mods/`, and the pane says `No mods yet.` if it keeps its plugins elsewhere. Set it to pin one folder. |
| `autoOpen` | `false` | Open Mod Lab when a skill reports a running stage, if the window is at least 144 columns wide (110 once you've opened Mod Lab yourself). Typing `/mod-builder:build` or `/mod-builder:edit` opens it whatever this is set to. |
| `autoRerun` | `true` | At the end of each of Claude's turns, re-run stale checks: a stale Validate, then Test if Validate passes and Test has run before; a stale Test alone, if Validate passed |
| `testTimeoutMinutes` | `3` | How long a Validate, Test or type-check may run before Mod Lab stops it and shows it as timed out (at most 10; fractions are fine). When Mod Lab loads, it clears checks a reload left shown as running. One still shown as running 30 s past this stops counting: V, T and K light again and the auto re-run goes on |
| `logging` | `normal` | `off`: nothing. `normal`: errors, session start and check results. `verbose`: also reports, scans, processes and commands. `debug`: also expected misses (a folder or file not there yet), each mod's lights and process output. One file per session in `~/.claude/mod-builder-data/logs/`, each line also in the debug log (`claude --debug`). |

`/mod-builder config` lists these with their current values and this session's log file; `/mod-builder config <option> <value>` changes one (for example `/mod-builder config logging verbose`). They're also in `/config`.

## What it reaches

Mods are not sandboxed. They run with your access and skip Claude's permission prompts, so this
table lists everything this one can touch. It is taken from `claude plugin validate`.

| Reach | Detail |
| --- | --- |
| Hooks | `session.start`, `command.run{mod-builder}` (gating, with `.catch`), `command.run{modlab}` (answers its own command; `/modlab` runs while Claude is working, 0.2.28), `command.run{mod-builder:build}` and `command.run{mod-builder:edit}` (gating, with `.catch`: open the pane, then run the skill), `tool.call{mcp__mod-builder__lab_report}`, `classic.PostToolBatch` (gating, with `.catch`: starts the mid-turn rescan and returns; validate notes it doesn't run for an installed plugin where an organization manages Claude Code), `classic.SessionStart{source=clear\|resume\|fork}` (gating, with `.catch`, 0.2.28: after `/clear`, `/resume` and `/branch` writes the build's pinned folder back and rescans, detached; the same organization note applies), `turn.complete`, `session.end`, `ui.close`, `ui.render{Pane modlab}`, `ui.render{AbovePrompt}` |
| Processes | `claude plugin validate --json <mod>` and `npx -y -p typescript@5.6 tsc -p <mod>` (`$.process.run`); `claude plugin test <mod>` streamed with `$.process.spawn` so the band fills on real progress (it falls back to `$.process.run` if the stream can't start). Only when you press V, T or K, when a skill reports a Validate or Test stage, or (with `autoRerun`) at the end of a turn for a mod whose checks went stale. Never on a timer. A check still running after `testTimeoutMinutes` is stopped (its child is killed) and shown as timed out. |
| Files | Reads under `modsDir`, the marketplace file beside it and its own `plugin.json`. When a build reports a folder, checks its marketplace file and reads `.git` in the folder above it and at or above the project root, to tell whether it is the project's own repository or a worktree of it. With `modsDir` empty and no build's folder kept, checks whether `.claude-plugin/marketplace.json` exists in the project root (the working directory when the root can't be read) and then each folder above it, stopping at the first found, at each scan. At session start, stats each mods folder its store has keys for (`$.fs.stat`, 0.2.30). Writes only its log, `~/.claude/mod-builder-data/logs/<date>-<session>.log`, unless `logging` is `off`. |
| Prompt box | `$.prompt.fill` puts `/mod-builder:build ` (N, or `/modlab new <idea>`) or a fix request (F) in the prompt box; it never submits |
| Notifications | `$.ui.notify`: a native notification when a mod is ready to share |
| Settings | Its own `/config` rows (`$.config.list` / `$.config.set`), when you run `/mod-builder config <option> <value>` |
| Environment | Reads `HOME`, `USERPROFILE` (to place the log file) |
| Session | Reads the project root (to find the mods folder when `modsDir` is empty, and to keep a build's folder until a `/cd`), the working directory (to name a mod's folder the way the session reads it, and to find the mods folder when the root can't be read) and the session id (to name the log file). Keeps the folder a build reported in its own session state. |
| Store | Its own `$.store`, one set of keys per mods folder: last results per mod, which mods were announced, and edit generations. At session start it lists its keys and deletes those of a folder that's gone, and the unkeyed ones from before 0.2.9 once replaced; each scan drops a mod no longer in its folder (0.2.30) |
| Network | None from the mod itself. The first Type-check makes `npx` download TypeScript. |
| Model calls | None |
| Tools it adds | `lab_report`, which records progress (with `path`, the folder being built in) and runs nothing beyond the Validate and Test above |
| Gating hooks | 7, all with `.catch`: `/mod-builder` (command), `/mod-builder:build` and `/mod-builder:edit` (they open the pane and always run the skill), `lab_report`, `classic.PostToolBatch` (passes every batch on), `classic.SessionStart` (passes it on), `ui.close` |

## Development

```
claude plugin validate plugins/mod-builder
claude plugin test plugins/mod-builder               # 166 tests: logic and UI
bash plugins/mod-builder/skills/build/scripts/check-archetypes.sh   # all five archetypes
```

- `hooks/mod-builder-logic.ts` holds every rule. It has no `$` calls and is unit-tested.
- `hooks/register.tsx` is the only file that calls `$`.
- `skills/build/` and `skills/edit/` are the two skills; `edit` reuses build's references and
  templates.
- `SPEC.md` is Mod Lab's own spec, written from the skill's template. Its Design section records
  how the pane follows the Claude Design mockups, and its Edits section covers build generations.
- `design/` holds the Claude Design briefs: the repo README, its visuals (hero and feature strip),
  and the pane mockups (superseded, kept for history).

CI tests it on Claude Code 2.1.296. 0.2.29's tests, archetype check, typecheck and `-p` live checks
ran on 2.1.308; 0.2.30's tests, typecheck and `-p` live check ran on 2.1.309; 0.2.31's tests,
archetype check and `-p` live check ran on 2.1.309, and `validate --strict` on 2.1.309 and 2.1.296;
0.2.32's archetype check and `-p` live check ran on 2.1.309; 0.2.33's and 0.2.34's checks and `-p` live
checks ran on 2.1.310. Function hooks are early access, so the
API may change between releases.

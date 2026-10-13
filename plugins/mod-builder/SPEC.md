# Mod Lab — SPEC

> Mod Lab is the showcase half of the `mod-builder` plugin. It shows each mod being built
> in a live pane beside the transcript: one row per mod, eight pipeline stages lighting up
> as Claude writes the SPEC, scaffolds, writes logic, registers hooks, validates, tests,
> documents and shares it. It is built to show what a Claude Code mod can do in one
> plugin: a pane, a band, the status line, toasts, a native notification, buttons with
> hotkeys, a slash command, a tool the model calls, a prompt it pre-fills, and
> deterministic logic you can unit-test.

**Non-negotiables:**
- "Showcase Claude's ability to shine with all of the possibilities a Claude mod can bring."
  Every surface listed above is used for a real purpose. None is decoration.
- Deterministic where possible. Stages come from files on disk and exit codes. The model's
  `lab_report` calls only add the *running* light and a note. They never mark a stage
  passed that the disk disagrees with.
- `/modlab demo` shows every state without a real build.

## Slots

| Slot | Kind | Value | Source |
| --- | --- | --- | --- |
| name | REQUIRED | `mod-builder` (plugin) · pane id `modlab` · command `/modlab` | plan |
| archetype | REQUIRED | pane+command, plus band, watcher (status/toast/notify), model tool | plan |
| triggers | REQUIRED | `session.start`, `command.run {command:'modlab'}`, `ui.render {Pane, requestId:'modlab'}`, `ui.render {AbovePrompt}`, `tool.call {tool:'mcp__mod-builder__lab_report'}`, `turn.complete`, `ui.close` | plan |
| commands | REQUIRED | `/modlab` toggle · `/modlab demo` · `/modlab <mod>` focus · `/modlab new` | plan |
| states drawn | REQUIRED | empty · idle · live · done · error · folded · too-narrow · demo | ui-states.md |
| done means | REQUIRED | see below | |
| state lifetime | ARCH | atoms (session) for view state; `$.store` `modlab:results` for last validate/test result per mod, keyed by mod + newest file mtime | decided |
| external reach | ARCH | **processes:** `claude plugin validate <dir>`, `claude plugin test <dir>`, `tsc -p <dir>`, on button press, on `lab_report`, or (option `autoRerun`, on by default) at the end of a main-loop turn for a mod whose Validate or Test went stale; never on a timer. **Files:** read-only under `modsDir`. No network, no model calls. | decided |
| depends on | ARCH | none (the skill calls its tool; works without it) | |
| options | ARCH | `modsDir: directory` (empty means `<plugin root>/../../mods`), `autoOpen: boolean = false` | decided |
| home / tsconfig / state API / logic split / tests / demo | HOUSE | per conventions.md: `hooks/mod-builder-logic.ts` (`$`-free), `hooks/register.tsx`, `tests/mod-builder-logic.test.ts`, `tests/ui.test.tsx` | conventions.md |
| built on | HOUSE | Claude Code 2.1.296 | `claude --version` |

## What gets touched

- **Files written:** `plugins/mod-builder/{hooks,types,tests}/…`, `README.md`, `NOTICE.md`, the `.claude-plugin/marketplace.json` entry.
- **Files outside the repo:** none. Mod Lab writes no files and keeps its results in `$.store`.
- **Processes while building:** `claude plugin validate|test`, `tsc -p`.
- **Processes at run time:** the same three, only when you press a button or the skill reports a Validate/Test stage.
- **Costs / hard to undo:** none. No model calls, nothing outside the repo.

## What I should see

The pane, docked beside the transcript, at about 76 columns:

```
◆  M O D   L A B                                               ● B U I L D I N G
────────────────────────────────────────────────────────────────────────────────
 3 mods · 2 green · 1 building                                   modsDir  mods/

 ▸ git-branch     ● ● ● ● ● ● ● ○    ready to share                       0:42
   agent-dock     ● ● ● ● ◐ ○ ○ ○    Validate · running                   1:12
   inbox-zero     ● ● ✕ ○ ○ ○ ○ ○    Logic · 2 tests failing                —
────────────────────────────────────────────────────────────────────────────────
 agent-dock  ·  pane + command  ·  built on 2.1.296

 PIPELINE   Spec ━ Scaffold ━ Logic ━ Register ━ Validate ┅ Test ┄ README ┄ Share
            ✓       ✓          ✓       ✓          running

 HOOKS      session.start · command.run /dock · ui.render Pane · tool.call Agent
 REACHES    processes: none · files: ~/.claude/agent-dock-data · network: none
            model: none · gating hooks: 1 (has .catch ✓)

 [V] Validate  [T] Test  [K] Type-check  [O] README  [J] Next  [P] Prev  [N] New mod  [D] Demo
```

- **Masthead:** a spaced wordmark `M O D   L A B` in the accent colour. On the right, one of:
  - `● B U I L D I N G`: green, with a slow pulse (dim/bright at 1 Hz, never flashing)
  - `A L L   G R E E N`: success
  - `N   F A I L I N G`: error
  - `S T A N D I N G   B Y`: dim
- **Summary line:** `N mods · N green · N building · N failing`. Counts of zero are left out. `modsDir` is shown on the right, shortened.
- **Mod rows:**
  - One row per child folder of `modsDir` that has a `.claude-plugin/plugin.json` or a `SPEC.md`.
  - Each row shows 8 stage lights, a one-line status and the elapsed time since the build's first file.
  - The selected row has `▸` and inverse text. `[J] Next` and `[P] Prev` move the selection, and `/modlab <mod>` jumps to one.
- **Stage lights:**

  | Light | Meaning |
  |---|---|
  | `●` (success) | passed |
  | `◐` (accent, animated) | running |
  | `✕` (error) | failed |
  | `○` (dim) | pending |
  | `◌` (warn) | stale: files changed since the last validate or test |

  A header row reads `MODS` over the names and `1 2 3 4 5 6 7 8` over the lights; the number over the
  selected mod's running or failed stage lights up. The detail panel's track carries the same numbers
  (`1 Spec ━ 2 Scaffold …`) as the key. (Replaced the run-together `SpScLoReVaTeRESh` legend, which
  read as bunched letters.)
- **Detail panel**, for the selected mod:
  - **Pipeline track:** stage names joined by `━` once done, `┅` while running, `┄` while pending.
  - **HOOKS:** the event/matcher list parsed from `claude plugin validate`.
  - **REACHES:** processes, files, network, model, and gating hooks with their `.catch` status. This is parsed from the same output.
  - When a stage has failed, its first 3 error lines are shown, plus `[F] Fix with Claude`, which fills the prompt with a fix request.
- **Buttons** (each with a hotkey):

  | Button | Hotkey | What it does |
  |---|---|---|
  | Validate | V | runs validate |
  | Test | T | runs test |
  | Type-check | K | runs `tsc -p` |
  | README | O | opens the mod's README as Markdown in the pane, with Esc or `[B] Back` to return |
  | New mod | N | fills the prompt with `/mod-builder:build` |
  | Next / Prev | J / P | move the selection (shown with two or more mods) |
  | Back | B | leaves the README view |
  | Demo | D | plays the demo |
  | Fix with Claude | F | fills the prompt with the failing output and "fix this" (failure state only) |

  Running buttons show a dim label and ignore presses.
- **Band** (above the prompt, only while something is running, with one line per running mod and at most 3):
  `◆ agent-dock  Validate ━━━━━━━━━━░░░░░  0:07`. It steps aside when a survey is showing, and is hidden when nothing is running.
- **Status line:** `◆ 3 mods · 1 building` while live, `◆ 3 mods · all green` when idle and green, `◆ 3 mods · 1 failing` otherwise. It is cleared when there are no mods.
- **Toasts:**
  - `agent-dock: validate clean · 4 hooks · 1 gate`
  - `agent-dock: 12 tests passed in 3.4s`
  - `inbox-zero: 2 tests failing. Press F in Mod Lab to fix`
- **Native notification:** when a full pipeline goes green ("agent-dock is ready to share"), once per version of its code. The API has no "is the terminal focused" signal, so it always notifies.
- **States:**
  - *Empty:* "No mods yet." with "Type /mod-builder:build and describe one. Or press D to watch a demo build." and the `[N] New mod` and `[D] Demo` buttons.
  - *Idle:* rows with no animation and the masthead `STANDING BY` or `ALL GREEN`. No timers run.
  - *Live:* the running light and the band animate on a single clock that runs only while something is running.
  - *Done:* the row reads `ready to share`. A toast and notification fire once.
  - *Error:* a red `✕` on the stage, with its first error lines in the detail panel and `[F] Fix with Claude`.
  - *Folded:* `/modlab` again closes the pane, and the status line stays as the badge.
  - *Too narrow:* the toast "Mod Lab needs a wider window. Widen it, or watch the status line."
  - *Demo:* a pretend mod `aurora` walks all 8 stages in about 12 seconds, including one failed test that is then fixed. It is marked `DEMO` in warn colour and leaves nothing on disk.
- **Layouts:**
  - `bodyColumns` of 60 or more: as drawn above.
  - 40–59: rows lose the status text and timer. The detail panel keeps the pipeline track, the error box when a stage failed, and the buttons, but drops HOOKS and REACHES.
  - Under 40: one line per mod (`agent-dock 5/8 ◐`) and buttons only.
- **Other surfaces:** desktop and vscode get the same tree. Mobile gets the compact (<40) tree with no hotkeys.
- **Design bar:** dark, minimal, premium.

  | Colour role | Value |
  |---|---|
  | accent | `#D97757` (coral) |
  | success | `#7FB685` |
  | warn | `#E0B15A` |
  | error | `#E06C6C` |
  | dim | the surface's dim |
  | text | default |

  Thin rules use `─`. No rainbow, no confetti, no flashing, and nothing moves while idle.

## Design (Claude Design mockups, 2026-10-12)

The bundle `tmp/mod-lab-mockups-review/` (frames H, 1a–5b, plus a style sheet) is the visual
source of truth. The build follows it cell for cell where the element table allows. Decisions made
while building it:

- **Rows:** name column 18 (`▸` accent bold plus an inverse name when selected), lights at a pitch
  of 2, status from column 36, time right-aligned in 5. The status copy follows the frames:
  `validating`, `running tests · 7 of 12`, `2 tests failing`, `12 tests · clean` (dim),
  `ready to share` (success, only for a mod that turned green this session), `next: <Stage>`.
- **Motion:** one 250 ms clock, running only while something is live. The running light cycles
  `◐` / dim `◐` / `○`, and the live connector cycles `┅ ━ ┄`. While building, only the masthead's
  `●` pulses (1 Hz).
- **Band:** up to 3 mods, two rows each when `maxRows` allows. The 15-cell bar fills on **real**
  progress only: streamed test counts against the last run's total, otherwise stages passed of 8.
  Verified live: the runner streams once per test file, so the bar moves in file-sized steps.
- **Breakpoints:**

  | Width | Layout |
  |---|---|
  | 60 or more | full |
  | 40–59 | medium (no status, time, HOOKS or REACHES) |
  | 34–39 | compact (`5/8 ◐`) |
  | under 34 | nothing drawn, and the too-narrow toast fires once |

- **Demo:** 12 s walk, then a 3 s hold. `aurora is a demo · nothing is written to disk` with a
  `0:02 / 0:12` clock. D again stops it. While the test is failing, "Claude is fixing
  src/band.tsx" replaces `[F]`.
- **Copy:** toasts carry `✓` / `✕`, and the too-narrow toast carries `◆`. The fix prompt uses the
  mockup's wording ("Fix the 2 failing tests in mods/x. First failure, from Mod Lab: …").
- **Not buildable as drawn, because the host owns them:**
  - status-line colours (`$.ui.status` is plain text)
  - Button bracket and key colours and focus inverse (the host's Button)
  - the native notification firing only while unfocused (there's no focus signal)
  - the README scroll thumb (the host's scroll)

## Edits: build generations (2026-10-12)

`/mod-builder:edit` changes a mod that already exists. Its first `lab_report` (`Spec running`) on
a mod whose Spec already passed starts a **generation** (stored under `modlab:generations`). While
it lasts, evidence older than its start shows `◌` stale:

| Stage | During an edit |
|---|---|
| Spec, README | stale until the file is saved again |
| Logic | stale until a logic or test file changes |
| Validate, Test | stale until they run again |
| Share | stale until the marketplace lists the version in `plugin.json` |
| Scaffold, Register | stay green on purpose: an edit rarely touches them |

A `running` report now shows on any stage that hasn't failed, green ones included, so an edit's
progress is visible from Spec on. The generation ends, and "ready to share" fires again, when all
eight are green.

## How it works

1. **Boot (`session.start`):**
   - Register `/modlab` (with `.catch`).
   - Register the model tool `lab_report` (`mcp__mod-builder__lab_report`, with input `{ mod, stage, status: 'running'|'passed'|'failed', note? }`).
   - Scan `modsDir` once.
   - Set the status line.
   - Always `return next(e)`.
2. **Scan (`$.fs.list/exists/stat`, logic `stagesOf`):** stages come from the files on disk:

   | Stage | Comes from |
   |---|---|
   | Spec | `SPEC.md` exists with no `<…>` placeholder left |
   | Scaffold | `plugin.json` and `hooks.json` |
   | Logic | `hooks/*-logic.ts` and `tests/*-logic.test.ts` |
   | Register | `hooks/register.ts(x)` |
   | Validate / Test | the stored result, if its mtime stamp is still current; otherwise stale |
   | README | `README.md` with a "What it reaches" heading |
   | Share | an entry in `marketplace.json` |

   Rescans happen on `/modlab`, on any button, after `lab_report`, and at the end of every main-loop turn (edits can come from any tool, Bash included); then, with `autoRerun`, stale Validate and Test re-run. There's no polling.
3. **Runs (`$.process.run`):**
   - Validate, Test and Type-check run `claude plugin validate <dir>`, `claude plugin test <dir>` and `tsc -p <dir>` in the background (`void … .catch`).
   - Logic `parseValidate` and `parseTest` turn the output into `{ ok, hooks[], calls[], gates[], errors[] }` and `{ ok, passed, failed, durationMs, failures[] }`.
   - The result is stored in `$.store` under `modlab:results`, keyed by the mod and the newest mtime.
   - At most one run per mod at a time. A second press while one is running is ignored.
4. **`lab_report` (`tool.call` on that tool):**
   - The skill calls it as it enters and leaves each stage. A `running` report older than 10 minutes expires, so a skill that stopped without reporting can't keep the clock alive.
   - `running` lights `◐` and starts the clock.
   - `passed` and `failed` trigger a rescan. For Validate and Test, Mod Lab runs the real command itself, so the disk and exit code decide (Non-negotiable 2).
   - It answers `Mod Lab: <mod> <stage> <status>.` and is never denied.
   - When `autoOpen` is on and nothing is open, the first `running` report opens the pane. That opening is "unasked", so it only appears at ≥144 columns, and otherwise waits quietly.
5. **Pane (`/modlab`, `ui.render {Pane}`):**
   - `command.run` returns `{ text }` at once and opens or closes the pane in the background. It checks `$.ui.panes()` rather than keeping its own "is open" flag.
   - If `isPlaced` is false, it shows the too-narrow toast.
   - The render reads atoms only and does no I/O.
6. **Band (`ui.render {AbovePrompt}`):** `rest = await next(e)`. If there's a survey or nothing is running, it returns `rest`. Otherwise it returns the running lines followed by `rest`.
7. **Clock:** one `$.clock.every(250)` that starts when the first run begins and is cancelled when the last one ends. It updates the frame atom, which redraws.
8. **Buttons:** each `onPress` updates atoms and starts work with `void …catch`. N and F call `$.prompt.fill`.
9. **Done:** when all 8 stages turn green for the first time for a given mtime stamp, it sends a toast and `$.ui.notify(…)`, once only.
10. **Demo:** a scripted timeline from `demoTimeline()` in logic, driven by the same clock and written to the same atoms under the name `aurora (demo)`. No files are touched.

## Tests (`claude plugin test`)

1. `stagesOf`: from file facts → stage lights. These cover an empty folder, SPEC only, SPEC with a leftover placeholder, a full scaffold, a stale validate, and fully green.
2. `parseValidate`: given real `claude plugin validate` output (fixtures captured from mods in `tmp/`), it returns the expected hooks, calls and gates, and `ok`.
3. `parseTest`: a passing and a failing fixture give the right counts and the first failure lines.
4. `summaryOf` / `badgeOf` / `mastheadOf`: counts → `3 mods · 1 building` and the masthead word. Zero counts are left out.
5. `layoutOf(bodyColumns)`: 80 → full, 50 → medium, 30 → compact.
6. `demoTimeline()`: walks all 8 stages, contains exactly one failure that is fixed later, and ends green within 15 s.
7. Pane, mounted on terminal and desktop:
   - the empty state shows "No mods yet." and pressing `demo` starts the demo
   - with two stubbed mods, it finds `git-branch` and its status text
   - pressing `validate` runs the stubbed `process.run` once
8. Band: with nothing running it renders only the band below. With a run, it renders `Validate` above the band below.
9. `lab_report` running → band visible. A `passed` report for Validate while the stubbed validate exits 1 → the light shows failed (disk wins).
10. `/modlab` with `ui.open → isPlaced:false` → the too-narrow toast.

## Done means

- I type `/modlab` and see the pane with my mods and their stage lights. `/modlab demo` walks `aurora` through every state, including one failure and its fix.
- While `/mod-builder:build` builds a mod, its row lights up stage by stage, the band shows the running stage, toasts report validate and test, and a notification says it's ready to share.
- V, T, K and O work from the keyboard. N and F fill the prompt.
- All tests pass. `claude plugin validate` and `tsc -p` are clean.

## Handoff

Open it with `/modlab` and watch a build with `/modlab demo`. Start a real mod with `/mod-builder:build <idea>`.
`/reload-plugins` picks up changes.

## Change 0.2.0 (2026-10-12)

> Everything since 0.1.0: the edit skill, Mod Lab's new behaviour, and fixes from both reviews of PR #1.

- **New:** `/mod-builder:edit`; build generations for edits; `autoRerun`; the selection follows the active build; the numbered `MODS 1–8` header and numbered track; rows follow streamed test progress; a keyboard hint line.
- **Fixes:**
  - `scan()` waits for a scan in progress, so an edit's start is never missed.
  - A Validate that fails on current code blocks a stale Test instead of re-running every turn.
  - A run that can't start shows as failed, with Fix.
  - During an edit, Share needs a version different from the one the edit started from.
  - Results carry a signature of every code file, so a delete or rename goes stale.
  - A stale Test re-runs even when Validate was never run.
  - Marketplace matching is shared (`findEntry`).
- **Tests:** 51 (logic and UI).


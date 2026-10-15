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
| options | ARCH | `modsDir: directory` (empty means the `mods/` of the marketplace nearest the session's working directory, else `<plugin root>/../../mods`; Change 0.2.9), `autoOpen: boolean = false` | decided |
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


## Change 0.2.1 (2026-10-12)

> Fix from the third Codex review of PR #1.

- **Fix:** the code signature (0.2.0, "every code file") covered only files directly in `hooks/`, `tests/` and `types/`. It now also covers their subfolders up to 3 levels down, skipping dot-folders and `node_modules`, so an edit to `hooks/lib/parser.ts` makes Validate and Test stale and `autoRerun` re-runs them. Sibling folders are listed at once.
- **Fix:** each signature entry carries its folder (`hooks/register.tsx@<mtime>`), so a file moved between `hooks/` and `tests/` with an unchanged mtime goes stale.
- **Unchanged:** the Logic and Register stages still look only at files directly in `hooks/` and `tests/`; a nested `hooks/lib/x-logic.ts` doesn't count as the logic module.
- **On upgrade:** results stored by 0.2.0 carry the old signature format, so every mod's Validate and Test read stale once and `autoRerun` re-runs them at the end of the next turn.
- **Tests:** 53 (logic and UI). The two new ones fail on 0.2.0.

## Change 0.2.2 (2026-10-13): logging and `/mod-builder config`

> Asked for: "add logging to the mod-builder plugin … `/mod-builder config` … the one config option is logging: [off], [on/normal], [verbose], [debug] … try catch blocks to capture data for said logs." Proposed below; nothing is built until approved.

- **New option** `logging` in `userConfig`: `"type": "string"`, `"options": ["off", "normal", "verbose", "debug"]`, default **`normal`**. It shows in `/config` too.
- **New command** `/mod-builder config` (probe 2026-10-13: a plugin can register a command equal to its own name, and `/mod-builder:build` and `/mod-builder:edit` still resolve):
  - `/mod-builder config`, or `/mod-builder config list`: every mod-builder option with its current value, plus the path of this session's log file.
  - `/mod-builder config <option> <value>`, for example `/mod-builder config logging verbose`: changes the option through its `/config` row (`$.config.list` / `$.config.set`, as duet does). It answers with the new value, or the reason it couldn't. Changing a plugin's options reloads the plugin (types), so the change applies on reload, and the log line about it is written to the file before the set. The row is matched by its exact key `mod-builder.<option>` and an owner of `mod-builder` or `mod-builder@<source>`: seen live, the owner names the install (`mod-builder@inline` under `--plugin-dir`) while `$.plugin.name` is `mod-builder`. Interactive `/config` lists the plugin's rows; under `claude -p`, `$.config.list()` returned none (code review, PR #21), so there the command says to use `/config` or `/plugin` instead.
- **Where logs go:**
  - a file, `~/.claude/mod-builder-data/logs/<YYYY-MM-DD>-<first 8 of the session id>.log`, one file per session, so sessions never race;
  - the same line mirrored to Claude Code's debug log with `$.ui.log(line, { to: 'debug' })`, visible under `claude --debug`.
- **How the file is written:** `$.fs.write` writes whole files only, so lines collect in a module-level buffer, capped at 2000 lines (oldest dropped, with a `… N earlier lines dropped` marker), and the whole file is rewritten on each flush. The buffer flushes on every `normal`-level line, at the end of each main-loop turn, and two seconds after the first line not yet written (`$.clock.after`). After a reload, the module's first write reads the session's existing file and continues it, so a reload loses only lines not yet written. A log file that exists but can't be read is never overwritten: that write is skipped and the next flush tries again. A session whose id can't be read writes `<date>-x<time>.log`, a name of its own. A flush with nothing new writes nothing, and a failed write leaves one line in the debug log. At `session.end` (including `/clear` and resume, after which the process goes on under a new session id with no `session.start`), the buffer is written and reset, so later lines go to the new session's file.
- **Line format:** `2026-10-13T14:02:11.123Z NORMAL  <site>  <message>  {context as JSON}`, one line per event. Context is trimmed to 2000 characters. Environment values are never logged; process argv (paths and flags) is.
- **What each level adds** (each level includes the ones above it):

  | Level | Logged |
  |---|---|
  | off | nothing; no file is created |
  | normal | every unexpected caught error (table below), with site, message and context; session start (plugin version, `modsDir`); each Validate, Test or Type-check result (mod, ok/failed, duration); each option change |
  | verbose | + each `lab_report` (mod, stage, status); each scan (`modsDir`, folders found, mods judged, duration); each process started (argv, exit code, duration); each command (`/modlab …`, `/mod-builder …`) |
  | debug | + expected misses (a missing folder or file); each mod's lights after a scan; the last 20 lines of each process's output; `$.store` keys written |

- **Try/catch coverage:** `hooks/register.tsx` at 688d8db has 32 places that catch an error and carry on, most silently. Each keeps its fallback behaviour and now logs:

  | Line at 688d8db | Where | Level |
  |---|---|---|
  | 75 | `list()`: folder missing | debug (expected) |
  | 77 | `readText()`: file missing | debug (expected) |
  | 326 | `run()`: `fs.exists` for the types folder | debug (expected) |
  | 227, 265 | `announceGreen()`, `tick()`: `ui.notify` | normal |
  | 250 | `startClock()`: `tick` | normal |
  | 317 | `execute()`: streaming Test failed, falling back to a one-shot run | verbose (expected in tests) |
  | 344 | `run()`: a check could not run | normal |
  | 374 | `runInBackground()` | normal |
  | 457, 465, 466 | `session.start`: command or tool registration, first scan | normal |
  | 478, 482, 496, 508, 510 | `/modlab` handler: detached work and its outer catch | normal |
  | 534, 539, 542 | `lab_report` handler: open pane, rescan, the guard's catch | normal |
  | 545 | `turn.complete`: `rerunStale` | normal |
  | 552 | `ui.close` guard | normal |
  | 560, 563 | `ui.render`: narrow warning | normal |
  | 695, 696, 697, 698, 700, 720, 910 | pane buttons (demo, new mod, next, prev, README, back, fix) | normal |
  | 1055 | band render | normal |

  A caught error repeated at the same site is logged once, until that site logs a different message (a render that fails on every frame would otherwise write about four lines a second).
  The logging calls (`logEvent`, `logCaught`) are top-level functions in `register.tsx`, because `$` may only be passed to top-level functions. Level filtering, line formatting, context trimming and the buffer cap are pure functions in `mod-builder-logic.ts`, with tests. A logging failure is itself swallowed: logging never breaks Mod Lab.
- **Not covered:** there is no Python in mod-builder. `scripts/scaffold.mjs` and `scripts/check-archetypes.sh` run as terminal commands the build skill reads directly; `userConfig` doesn't reach them, so they keep printing to the terminal. Making them log too would need an environment variable such as `MOD_BUILDER_LOG`; that's left for later.
- **What gets touched:** `hooks/register.tsx`, `hooks/mod-builder-logic.ts`, `.claude-plugin/plugin.json` (option, version), `.claude-plugin/marketplace.json` (version), `tests/` (new tests; `world()` gains `fs.write`, `ui.log`, `session.id`, `config.list` and `config.set` stubs), README ("What it reaches" regenerated; config table), `docs/mod-lab.md` (config table), `skills/build/references/gotchas.md` (the command-name probe). Writes `~/.claude/mod-builder-data/logs/`.
- **Tests:** `off` writes nothing and creates no file; `normal` logs a caught error with its site and skips expected misses; `verbose` adds a scan line naming `modsDir`; `debug` adds expected misses; the buffer cap drops the oldest lines with a marker; `/mod-builder config` lists options and the log path; `/mod-builder config logging verbose` calls `$.config.set` with the right key; a bad value answers with the allowed values.
- **Version:** 0.2.2 if this merges before the issue-forge PR (which also plans 0.2.2); whichever merges second takes the next patch.
- **Live check after the build:** a session started in a git worktree, with `logging: verbose`, logs the `modsDir` its scan used. That settles whether Mod Lab watches the worktree's `mods/` or the main checkout's (pending issue).
- **Done means:** all tests pass; validate is clean (it will now list `$.fs.write`, `$.ui.log` and `$.config.*`); the archetype check passes; the live check is recorded.
- **Results (2026-10-13):**
  - `claude plugin test plugins/mod-builder`: 66 pass, 0 fail (13 new, including a reload test: the session file is continued, not replaced). With `register.tsx` at 688d8db, 3 of the 4 new UI tests fail; the fourth (`off` writes nothing) is a guard.
  - `claude plugin validate`: clean, 3 gating hooks with `.catch`. Archetype check: all pass. `tsc`: clean.
  - The `/config` row key is `<plugin>.<field>` (bundled `claude-code.d.ts`, around line 2049), so `setOption` matches `mod-builder.logging`. A live set wasn't run, because it writes `~/.claude/settings.json`.
  - Live, `claude -p --plugin-dir plugins/mod-builder "/mod-builder config"` from the worktree listed the four options and wrote `~/.claude/mod-builder-data/logs/2026-10-13-<session>.log`, holding `NORMAL  session.start  Mod Lab started  {"version":"0.2.2","modsDir":"<worktree>/mods","logging":"normal"}`.
  - Worktree check: loaded with `--plugin-dir` from a worktree, the default `modsDir` is that worktree's `mods/`, so it follows the plugin's own folder (`$.plugin.root`). The installed copy loads from the main checkout, so a session in a worktree watches the main checkout's `mods/`. The direct check, a worktree session with the installed plugin at `logging: verbose`, can run once this merges.

## Change 0.2.3 (2026-10-13)

> For issue-forge (`docs/specs/issue-forge.md`, checkpoints C0 and C1).

- **New:** `skills/build/scripts/coverage/` (`kit.mjs`, `hooks.mjs`, `register.mjs`) lets Node 24's test runner run a mod's logic tests with coverage. It stands in for `claude-code/testing`, and `register.mjs` maps that import to the kit. Logic tests only; UI tests need the real kit. Checked: mod-builder 28/28, duet 38/38, git-branch 4/4, turn-counter 2/2, the same counts as `claude plugin test`.
- **New:** `references/gotchas.md` gets a "Subagents a mod spawns" section, seven `[probe]` entries: other plugins see a mod's spawn as a `tool.call` of `Agent`; a detached spawn outlives the command; plain `-p` exits first; how to drop the hand-back prompt; in-line answers have no `turn.complete`; `$.ui.ask` from a detached promise; `return()` kills a spawned child; under `claude plugin test` a spawn never gets an `agentId`.
- **Unchanged:** Mod Lab's code and tests.
- **Version:** 0.2.3, since 0.2.2 (logging, PR #21) merged first.

## Change 0.2.4 (2026-10-13)

> Fix for issue #16: Mod Lab wrote `mods/<name>` in the Fix prompt and the detail header whatever `modsDir` was.

- **Fix:** both now show the mod's real folder (`${modsDir}/<name>`) as the session reads it: relative to the working directory when inside it (`mods/foo`, `other/foo`, or `foo` after a `/cd` into `modsDir`), and absolute when outside. With the default `modsDir` the text is unchanged only when the session runs at the marketplace root: an installed Mod Lab used from another project shows the absolute path, which the header cuts from its start to fit (PR #37 review).
- **New (logic):** `displayPathOf(path, cwd)`. `fixPromptOf` takes the display path as a required fifth parameter, and `viewOf` a required trailing `path` after `fromVersion`; both stay pure.
- **Register:** the working directory comes from `$.session.cwd()`, read in `fillFix` when F is pressed and when the pane draws the detail header, so a `/cd` shows at the next render and the header always matches what F writes (PR #37 review). Probed live: `cwd()` follows `/cd` and not a shell `cd` (`!cd`). If it can't be read the full path is shown and the failure is logged once.
- **Tests:** 84 (logic and UI). The 9 new ones fail on 0.2.3.

## Change 0.2.5 (2026-10-14)

> Fix for issue #11: a Test that exits before its runner starts showed no error and no Fix.

- **Fix:** `claude plugin test` exits 1 with one stderr line and no `(fail)` line when there are no test files (`claude plugin test: no *.test.ts or *.test.tsx under <dir>`, verified on Claude Code 2.1.296), and, as an audit run reported, for a missing plugin folder or a corrupt manifest. `parseTest` found no failures, so the error box and the Fix button (both need errors) stayed hidden. When the exit code is nonzero and no `(fail)` line was found, `parseTest` now keeps the output's last 3 non-blank lines as the errors, as the type-check path does.
- **Fix:** with `failed` 0 on a failed Test, `summaryOfRun` says `tests did not run` (so the toast reads `✕ <mod>: tests did not run. Press F in Mod Lab to fix`) instead of `1 test failing`. `fixPromptOf` with `failedCount` 0 on Test writes `Fix the Test run in <path> (the tests did not run)` and quotes the error lines, instead of `Fix the 0 failing tests`. `fillFix` already passed the stored `failed` (0) through, so `register.tsx` is unchanged.
- **Known edge:** a run killed after some `(fail)` lines but before bun's ` N fail` summary also has `failed` 0, so it reads `tests did not run`; its `(fail)` lines are still the errors.
- **Tests:** 96 (logic and UI). The 7 new ones (4 logic, 3 UI, with the `test-none.ts` fixture) fail on 0.2.4.

## Change 0.2.6 (2026-10-14)

> For issue-forge 0.2.0 (PR #41). 0.2.5 went to issue #11's fix (PR #47), which merged while this PR was open.

- **Changed:** in `references/gotchas.md`, the hand-back entry now says `<agent-message from="<name>">` is a named agent's shape with agent teams off; with them on, a named agent is a teammate and hands back another way.
- **New:** four `[probe]` entries under "Subagents a mod spawns", probed on 2.1.296 for issue-forge's P4. With agent teams on, a named `$.agent.spawn` starts a teammate, whose hand-back arrives as a `session.receive` (no `prompt.submit`), and `{ consumed }` keeps the main model idle. Inside tmux with the default teammate mode, a named spawn of a plugin-registered agent type is refused, and `teammateMode: "in-process"` lets it start. A variable in `settings.json`'s `env` overrides the shell's. `$.agent.spawn`'s `cwd` is ignored, and a `tool.call` rewrite of the Bash command moves the agent.
- **Unchanged:** Mod Lab's code and tests.
- **Version:** 0.2.6 in `plugin.json` and the marketplace entry.

## Change 0.2.7 (2026-10-14)

> For issue-forge 0.3.0 (parallel runs in one repository).

- **New:** three entries in `references/gotchas.md`, under "Modules":
  - `[probe]` `$.store` is read from its file on each `get` and shared live between sessions; writes
    to different keys from different processes don't lose each other (400 of 400 survived); the last
    write to one key wins.
  - `[d.ts]` `session.end` fires on `/clear` and `/resume` too, and the process goes on.
  - `[probe]` Under `claude plugin test`, `session.end` needs a stub.
- **Unchanged:** Mod Lab's code and tests.
- **Version:** 0.2.7 in `plugin.json` and the marketplace entry.

## Change 0.2.9 (2026-10-15)

> Fix for issue #23: in a git worktree Mod Lab watched the main checkout's `mods/`, while `/mod-builder:build` wrote to the worktree's.

- **Cause:** with `modsDir` empty the folder was `${$.plugin.root}/../../mods`. `$.plugin.root` is where the plugin loads from, which for an installed folder marketplace is always the main checkout. So a build in a worktree never showed up, and Validate, Test and `autoRerun` ran against the main checkout's files.
- **Fix:** with `modsDir` empty, the mods folder is found the way the build skill finds it (step 0.2). Walk up from `$.session.cwd()` (it follows `/cd`; `$.session.root()` is only where the session started) to the nearest folder holding `.claude-plugin/marketplace.json`, checked with `$.fs.exists` at each level down to the filesystem root, and use its `mods/`. With no marketplace above the working directory, or no working directory to read, it is `${$.plugin.root}/../../mods` as before. A set `modsDir` always wins and is not walked.
- **Design:** the walk is pure, in `mod-builder-logic.ts`: `marketplaceCandidatesOf(cwd)` lists the candidate files nearest first, `modsDirFor(configured, cwd, existing, fallback)` picks the folder. `register.tsx` does the `$.fs.exists` calls (`defaultModsDir`). The folder is resolved once at the start of each scan, and for the session's first log line; everything else in that pass (runs, the README view, the Fix prompt, the header and summary) reads the resolved folder, so a `/cd` into another worktree takes effect at the next scan and a run always targets the folder the pane lists. `/mod-builder config` resolves it again, so its `default (…)` names the folder a scan would use now.
- **Tests:** logic: the candidates for a path (and `.`, `..`, `//`, trailing `/`), the nearest marketplace wins (a worktree under the main checkout), the fallback, a null working directory, a marketplace at the root, a set `modsDir` wins. UI: a worktree session lists that worktree's mods and Validate runs on its folder; a worktree inside the main checkout lists its own; a `/cd` is followed at the next scan, including out of every marketplace; the session-start log line and `/mod-builder config` name the resolved folder.
- **Store, one set of keys per mods folder:** results, done marks and generations were keyed by the mod's name alone, and `$.store` is shared live between sessions. Once one install serves every folder the working directory leads to, a mod named the same in two worktrees (or two repositories) read the other's results, edit generation and done mark. They are now stored under `modlab:results:<modsDir>`, `modlab:done:<modsDir>` and `modlab:generations:<modsDir>` (`keyOf` in `register.tsx`; the folder is already normalized). A run files its result under the folder it started in, so a `/cd` during a run doesn't move it. Separate keys also keep sessions in different folders from rewriting one shared object.
- **Other repositories:** a session anywhere under a folder holding `.claude-plugin/marketplace.json` now watches that folder's `mods/`, as `/mod-builder:build` would write there. A marketplace that keeps its plugins elsewhere shows `No mods yet.`; set `modsDir` to pin a folder. Reading the marketplace's `source` paths instead would cover other layouts; that is left for a later issue.
- **On upgrade:** results under the old keys (`modlab:results` and so on) are not read. Each mod's Validate and Test show `○` until they are run again (`autoRerun` repeats only stale checks, not ones that never ran), and a mod that turns green again is announced again. The old keys stay in the store, unused.
- **Left for later:** each folder's keys stay in the store after its worktree is removed; nothing prunes them. The session's `runs` and `reported` atoms are still keyed by the mod's name, so after a `/cd` during a run, the same-named mod in the new folder shows that run as running until it ends (the result is still filed under the folder it ran in).
- **Tests (store):** UI: the same-named mod in a second worktree starts unchecked and the first keeps its results after a `/cd` back; a mod turning green is announced in each worktree; an edit started in one worktree leaves the other's mod green; a run keeps its result with the folder it started in after a `/cd` during the run.
- **Live check (2026-10-15, Claude Code 2.1.300):** this branch's plugin loaded with `--plugin-dir <worktree>/plugins/mod-builder` and `mod-builder@claudemod` turned off, so the session-start line reads version 0.2.9. The installed copy can't be checked until the merge, so the cases below tell the walk-up from the old fallback: the fallback is always the worktree's `mods/`.
  - Started in the main checkout: `/mod-builder config` shows `default (…/ClaudeMod/mods)`, and the log's first line has `"modsDir":"/mnt/c/Projects/ClaudeMod/mods"`. The old code would have named the worktree's.
  - Started in a folder with no marketplace above it (the session scratchpad): `default (…/<worktree>/mods)`, the fallback.
  - Started in `<worktree>/plugins`: the worktree's `mods/`.
  - `/cd` (interactive only; `claude -p` answers `/cd isn't available in this environment.`): started in the scratchpad, the pane header showed the worktree's `mods`. After `/cd /mnt/c/Projects/ClaudeMod` it still did until the next scan (`/modlab duet`), then `…/ClaudeMod/mods`. The log's scan lines go from `"modsDir":"…/issue-23-…/mods"` to `"modsDir":"/mnt/c/Projects/ClaudeMod/mods"`.
  - Results per folder (interactive): started in the main checkout, V on `duet` turned its Validate light green (`next: Test`). After `/cd` into the worktree and a scan, the worktree's `duet` showed Validate `○` (`next: Validate`). After `/cd` back, the main checkout's `duet` was green again. The store file (`~/.claude/plugins/store/mod-builder_inline-*.json`) then held `modlab:results:/mnt/c/Projects/ClaudeMod/mods` with `duet`, beside the old `modlab:results`, which this version no longer reads.
- **Version:** 0.2.9 in `plugin.json` and the marketplace entry (0.2.8 is taken by issue #14's branch).

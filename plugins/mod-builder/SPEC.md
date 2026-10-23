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
| commands | REQUIRED | `/modlab` (open · fold when shown · bring to the front when a tab behind another pane) · `/modlab demo` · `/modlab <mod>` focus · `/modlab new` | plan |
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
  - *Folded:* `/modlab` again closes the pane when it is shown, and the status line stays as the badge. A pane open as a tab behind another is brought to the front instead (Change 0.2.21).
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
| Logic | stale until a logic or test file is saved, or one is deleted, renamed or added |
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
   - `command.run` returns `{ text }` at once and opens, closes or brings the pane to the front in the background. It checks `$.ui.panes()` through `paneAction` rather than keeping its own "is open" flag (Change 0.2.21).
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
  - `scan()` waits for a scan in progress, so an edit's start is never missed. (Not so when the hook had already read state: corrected in Change 0.2.14.)
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

## Change 0.2.8 (2026-10-15)

> Fix for issue #14: concurrent `$.store` read-modify-write dropped results and generations.

- **Fix:** Mod Lab updated `modlab:results` and `modlab:generations` by reading the whole value, changing it and writing it back, with awaits between and nothing ordering concurrent callers. Two runs ending together dropped one run's result (it showed as pending until the next press of V or T), and a `lab_report` that began an edit while a scan was running was overwritten by the scan's cleanup of finished generations. A lost generation is a false green: the edit stops being tracked, so Spec, README, Logic and Share are judged against no edit.
- **Fix:** every write to the two keys now goes through `updateStore($, key, change)` in `register.tsx`, chained on one module-level promise (as duet's `logChain` is). It reads the key inside its turn and writes `change(current)`, so each caller changes the latest value, never an earlier snapshot. `run()` merges its result into it, the `lab_report` handler adds its mod to the generations, and `scanOnce` deletes the finished mods from them and no longer writes its snapshot. The scan deletes a generation only if its start time is still the one it judged, so an edit begun during the scan stays.
- **Limit:** the chain orders this session's writes only. `$.store` is one JSON file per plugin, shared live between sessions (see 0.2.7), and a read-then-write to one key from two sessions at once can still lose an update. Per-mod keys would close that, and are in #58. Not verified in a live session; the fix is checked under `claude plugin test`.
- **Review (PR #56, `/code-review`):**
  - **Fix:** an edit's `fromVersion` came from `factsByMod`, which each scan emptied before reading the folders. An edit reported mid-scan stored `null`, which `lightsOf` reads as "no bump required", so Share went green with the version unchanged. The read predates 0.2.8; 0.2.8 made it reachable by keeping an edit begun during a scan. The `lab_report` handler now reads the mod's `plugin.json` as the edit begins, which also covers a bump no scan has read yet. Only if that read fails does it use the last finished scan's version. A scan now swaps in the facts it read once it has read every folder, so `factsByMod` never stands empty mid-scan.
  - **Fix:** a refused results write made `run()` throw before it left `runs`, so the row showed the run forever and V/T did nothing for that mod until a reload. The run now logs the refusal and ends as usual; its result is toasted but not stored.
  - **Tests:** the held-scan test holds the list of a named folder and asserts that the hold was reached, instead of counting `fs.list` calls; its assertion reads inbox-zero's row, not the whole pane. The scan's `since` guard has a test (a second edit begun during the scan stays), shown to fail with the guard removed. The test harness answers `$.store` itself so a write can be refused.
  - **Deferred to #58:** per-mod keys, skipping writes that change nothing, `announceGreen`'s unchained `modlab:done` write, and `run()`'s in-flight check racing its own registration.
- **Tests:** 104 (logic and UI). The 2 from the issue fail on 0.2.7: two Validate runs finishing together keep both results, and an edit reported while a scan is held (after its generations read) is still tracked when the scan ends. The review added 6 UI tests: an edit begun mid-scan, and one begun before a scan has read a bump, each need a new version; one whose `plugin.json` can't be read falls back to the last finished scan's version, with no scan running and with one held mid-scan (the second fails if a scan empties `factsByMod` first); a second edit begun during the scan stays; a refused results write still ends the run.
- **Version:** 0.2.8 in `plugin.json` and the marketplace entry.

## Change 0.2.9 (2026-10-15)

> Fix for issue #23: in a git worktree Mod Lab watched the main checkout's `mods/`, while `/mod-builder:build` wrote to the worktree's.

- **Cause:** with `modsDir` empty the folder was `${$.plugin.root}/../../mods`. `$.plugin.root` is where the plugin loads from, which for an installed folder marketplace is always the main checkout. So a build in a worktree never showed up, and Validate, Test and `autoRerun` ran against the main checkout's files.
- **Fix:** with `modsDir` empty, the mods folder is found the way the build skill finds it (step 0.2). Walk up from `$.session.cwd()` (it follows `/cd`; `$.session.root()` is only where the session started) to the nearest folder holding `.claude-plugin/marketplace.json`, checked with `$.fs.exists` from the working directory up, nearest first, stopping at the first found (review round 1), and use its `mods/`. With no marketplace above the working directory, or no working directory to read, it is `${$.plugin.root}/../../mods` as before. A set `modsDir` always wins and is not walked.
- **Design:** the walk is pure, in `mod-builder-logic.ts`: `marketplaceCandidatesOf(cwd)` lists the candidate files nearest first, `modsDirFor(configured, cwd, existing, fallback)` picks the folder. `register.tsx` does the `$.fs.exists` calls (`defaultModsDir`). The folder is resolved once at the start of each scan, and for the session's first log line; everything else in that pass (runs, the README view, the Fix prompt, the header and summary) reads the resolved folder, so a `/cd` into another worktree takes effect at the next scan and a run always targets the folder the pane lists. `/mod-builder config` resolves it again, so its `default (…)` names the folder a scan would use now.
- **Tests:** logic: the candidates for a path (and `.`, `..`, `//`, trailing `/`), the nearest marketplace wins (a worktree under the main checkout), the fallback, a null working directory, a marketplace at the root, a set `modsDir` wins. UI: a worktree session lists that worktree's mods and Validate runs on its folder; a worktree inside the main checkout lists its own; a `/cd` is followed at the next scan, including out of every marketplace; the session-start log line and `/mod-builder config` name the resolved folder.
- **Store, one set of keys per mods folder:** results, done marks and generations were keyed by the mod's name alone, and `$.store` is shared live between sessions. Once one install serves every folder the working directory leads to, a mod named the same in two worktrees (or two repositories) read the other's results, edit generation and done mark. They are now stored under `modlab:results:<modsDir>`, `modlab:done:<modsDir>` and `modlab:generations:<modsDir>` (`keyOf` in `register.tsx`; the folder is already normalized). A run files its result under the folder it started in, so a `/cd` during a run doesn't move it. Separate keys also keep sessions in different folders from rewriting one shared object.
- **Other repositories:** a session anywhere under a folder holding `.claude-plugin/marketplace.json` now watches that folder's `mods/`, as `/mod-builder:build` would write there. A marketplace that keeps its plugins elsewhere shows `No mods yet.`; set `modsDir` to pin a folder. Reading the marketplace's `source` paths instead would cover other layouts; that is left for a later issue.
- **On upgrade:** the old unkeyed records (`modlab:results` and so on) described the one folder Mod Lab watched: a set `modsDir`, else the plugin's own. That folder keeps reading them until it has its own key (`storedOf`), and its next write moves them there, so nothing shows as not run or is announced again (review round 1). Any other folder starts with `○` until V and T run once, because `autoRerun` repeats only stale checks, not ones that never ran.
- **Left for later:** each folder's keys stay in the store after its worktree is removed; nothing prunes them (#59). The session's `runs` and `reported` atoms are still keyed by the mod's name, so after a `/cd` during a run, the same-named mod in the new folder shows that run as running until it ends (the result is still filed under the folder it ran in). `lab_report` reads the working directory once to pick its folder and its scan reads it again, so a `/cd` landing between the two records the edit under the first. The old unkeyed records are read by whichever folder matches the old rule at read time (a set `modsDir`, else the plugin's own), so a `modsDir` changed after the upgrade reads the old folder's records once; deleting them once their folder has its own key is noted on #59. Resolution cost (a mod re-read after the scan a run just did, a walk with no marketplace above on every scan, `modsDirFor`'s list argument) is #62.
- **Tests (store):** UI: the same-named mod in a second worktree starts unchecked and the first keeps its results after a `/cd` back; a mod turning green is announced in each worktree; an edit started in one worktree leaves the other's mod green; a run keeps its result with the folder it started in after a `/cd` during the run.
- **Live check (2026-10-15, Claude Code 2.1.300):** this branch's plugin loaded with `--plugin-dir <worktree>/plugins/mod-builder` and `mod-builder@claudemod` turned off, so the session-start line reads version 0.2.9. The installed copy can't be checked until the merge, so the cases below tell the walk-up from the old fallback: the fallback is always the worktree's `mods/`.
  - Started in the main checkout: `/mod-builder config` shows `default (…/ClaudeMod/mods)`, and the log's first line has `"modsDir":"/mnt/c/Projects/ClaudeMod/mods"`. The old code would have named the worktree's.
  - Started in a folder with no marketplace above it (the session scratchpad): `default (…/<worktree>/mods)`, the fallback.
  - Started in `<worktree>/plugins`: the worktree's `mods/`.
  - `/cd` (interactive only; `claude -p` answers `/cd isn't available in this environment.`): started in the scratchpad, the pane header showed the worktree's `mods`. After `/cd /mnt/c/Projects/ClaudeMod` it still did until the next scan (`/modlab duet`), then `…/ClaudeMod/mods`. The log's scan lines go from `"modsDir":"…/issue-23-…/mods"` to `"modsDir":"/mnt/c/Projects/ClaudeMod/mods"`.
  - Results per folder (interactive): started in the main checkout, V on `duet` turned its Validate light green (`next: Test`). After `/cd` into the worktree and a scan, the worktree's `duet` showed Validate `○` (`next: Validate`). After `/cd` back, the main checkout's `duet` was green again. The store file (`~/.claude/plugins/store/mod-builder_inline-*.json`) then held `modlab:results:/mnt/c/Projects/ClaudeMod/mods` with `duet`, beside the old `modlab:results`, which that folder doesn't read: under `--plugin-dir` the old keys belong to the plugin's own folder, the worktree's `mods/`.
- **Version:** 0.2.9 in `plugin.json` and the marketplace entry, after 0.2.8 (#14).
- **With 0.2.8's ordered writes (merged from main):** `updateStore` writes one folder's key (`keyOf(base, modsDir)`) and reads its current value through `storedOf`, so writes stay in order and the old unkeyed records still move to the folder they described. `updateGenerations` takes the folder. The scan swaps in the facts it read (0.2.8) from `modFactsOf`. An edit's `fromVersion` is read from the reported folder's `plugin.json`.
- **Review round 1 (PR #57):** `/code-review` (xhigh) plus Codex's four P2 comments. All four were confirmed against the code and fixed with red, green and refactor commits.
  - **The folder the pane shows is kept in state:** the folder a scan judged is kept in the `mod-builder.modsDir` atom, next to `views`. Atoms survive a reload, so a reload no longer drops it back to the plugin's own folder. The module variable `resolvedDir` is gone. Several changes follow from it:
    - The pane's buttons act on that folder.
    - `run()` takes its folder from the caller and reads its evidence (stamp, code signature) from that folder, not from whatever folder its own scans moved to (Codex 4283445498).
    - The end-of-turn re-run reads the folder together with the views it walks.
    - `lab_report` resolves the folder the session is in now, scans it if it changed, and records the edit there (Codex 4283445510).
    - A scan that moves to another folder closes an open README (Codex 4283445485).
    - "Ready to share" marks are kept as `<modsDir>/<name>`.
    - The session-start log line resolves the folder without storing it, so it can't race a scan.
  - **Windows and UNC roots (Codex 4283445464):** `normalizePath` keeps a path's root (`//`, `/`, `C:/`) and stops `..` there (for UNC, at the share since review round 2). `marketplaceCandidatesOf` walks down to that root (a UNC path's server and share), and returns nothing for a relative working directory.
  - **Old keys:** see "On upgrade".
  - **Cost:** the walk probes nearest first and stops at the first marketplace found (one `fs.exists` in the common case, not one per folder up to the root). `/mod-builder config` walks only while `modsDir` is empty or being set.
  - **Docs:** `docs/use-in-your-project.md` step 5, `docs/troubleshooting.md` and the design README prompt described the old default.
  - **Owner's choices:** a marketplace without `mods/` keeps showing `No mods yet.` (it's where `/mod-builder:build` writes). Pruning keys is #59.
  - **Live check (round 1, 2.1.300, `--plugin-dir` with the installed copy off):**
    - Started in the main checkout with the pane on `…/ClaudeMod/mods`, then `/cd` into the worktree with no scan since.
    - V on `duet` ran in the shown folder. Only `modlab:results:/mnt/c/Projects/ClaudeMod/mods` got a new `duet` Validate time, and no worktree key was written.
    - The run's scans then moved the pane to the worktree, where `duet` read stale from the old unkeyed records. Under `--plugin-dir` those belong to the worktree's `mods/`.
    - After `/cd` back and a scan, the main checkout's `duet` showed Validate fresh (`next: Test`).
  - **Not testable in the kit:** the kit has no reload, so the reload case rests on state surviving a reload (types: `$.state` survives a hot reload).
  - **Tests:** UI: V after a `/cd` with no scan since; the end-of-turn re-run with a `/cd` during its first run; `lab_report` after a `/cd`; README closed on a folder change; "ready to share" per folder; the old keys read by their folder and not by another. Logic: drive, UNC and relative walks; `modsDirFor` on a drive and a share; `normalizePath` and `displayPathOf` on UNC and `C:\..`.

- **Review round 2 (PR #57):** `/code-review` (xhigh) plus Codex's three new P2 comments, all confirmed.
  - **The scan's folder and views as one value (Codex 4283981692):** `views` and `modsDir` were written one after the other, so a render, a `lab_report` or the end-of-turn re-run between the two writes paired one folder's rows with the other's path. They are now one atom, `mod-builder.judged { modsDir, views }`, under a new key, so an old `views` array left by an upgrade reload is ignored. The README is closed right before that write, so one opened from the old folder while a scan runs is closed too. The kit can't hold a hook between two atom writes, so no test can show the gap itself. Instead a UI test watches every state write across a `/cd` and checks that each one carrying mods also carries the folder they were judged in, with the right names. It fails on the code before this change, and a code comment at the atom says not to split it.
  - **UNC `..` (Codex 4283914562):** `normalizePath` stops `..` at a UNC path's share (`UNC_ROOT_PARTS`, the floor `marketplaceCandidatesOf` walks to), and writes a drive letter upper case, so `c:/repo` and `C:/repo` are one folder. A POSIX path starting with exactly `//` is read as UNC. Without knowing the platform the two can't be told apart, and that path is left as is.
  - **Old "ready to share" marks (Codex 4283914572):** `freshIdsOf` reads a bare mark (before 0.2.9) as `<legacyDir>/<name>`, legacyDir being the folder the unkeyed records described (`legacyDirOf`, shared with `storedOf`). The scan writes the marks back when it moved any.
  - **A set `modsDir` is never walked:** now tested, by counting `marketplace.json` probes. Making `currentModsDir` walk anyway fails the test.
  - **Deferred:** see "Left for later" (the `lab_report` double cwd read, the old records read by a later `modsDir`, and the cost items, #62).
  - **Tests:** logic: the UNC floor, drive case, `freshIdsOf`. UI: no marketplace probes with `modsDir` set.
  - **Live check (round 2, 2.1.300, `--plugin-dir`, installed copy off):** with the single `judged` value, the pane showed `…/ClaudeMod/mods`. After `/cd` into the worktree with no scan since, V on `duet` gave only `modlab:results:/mnt/c/Projects/ClaudeMod/mods` a new Validate time. Then the run's scan moved the pane to the worktree.

## Change 0.2.10 (2026-10-15)

> For issue #13: a Test that never ends, or a throw in `run()`, left a row that blocked later runs.
> 0.2.8 is #56 and 0.2.9 is #57, both merged first.

- **New option:** `testTimeoutMinutes` (number, default 3) in `userConfig`, the time limit of every check Mod Lab runs. `Lab.runLimitMsOf` reads it: minutes above 0 (or their text), at most 10 (the most `$.process.run` allows), rounded to whole milliseconds, at least a second. Anything else, `true` included, reads as 3. `/mod-builder config` lists it, rounded to two places (`Lab.limitMinutesOf`), and sets it (`/mod-builder config testTimeoutMinutes 5`; `default` writes `''`, which clears the row so the manifest's default applies), and the listing's name column is as wide as the longest name.
- **Changed:**
  - **Time limit.** Validate, type-check and the Test fallback pass the limit to `$.process.run` as `timeoutMs`, where it was a fixed 3 minutes. At `timeoutMs` the child "is killed and the call rejects" `[d.ts]`. A rejection after the whole limit (`Lab.isOverLimit`) becomes a `RunTimeout`; one sooner (the command could not start) still reads "could not run". The streamed Test has a one-shot timer at the limit (`$.clock.after`). It closes the stream with `stream.return()`, which kills the child (`[probe]`, gotchas.md), puts a no-op catch on `stream.result` (it "rejects if the stream is closed before" its end, `[d.ts]`), and throws a `RunTimeout`. The timer is cancelled in a `finally`. A `RunTimeout`'s summary is `Lab.timeoutText`, "timed out after 3 minutes".
  - **No leaked rows.** Everything in `run()` after its row is added is in `try`/`catch`/`finally`. What throws there (a scan; a refused results write is caught since 0.2.8) is logged at the `run` site and toasted (`Lab.toastOfRunError`: "✕ <mod>: Test stopped before its result was saved (<error>)"), and the rescan a finished run gets follows, so the stage stops reading running. The `finally` removes only the row it added (same mod, kind and `startedAt`), and streamed progress lands only on that row (`Lab.withProgress`). After its first scan, after its check and after its results write, a run looks for its own row (`Lab.hasRun`). If a newer run replaced it, the run logs "superseded" and returns: it starts no second process, and it saves and toasts nothing, except that a write already waiting in `updateStore`'s chain still lands, before the replacement's own write overwrites it.
  - **Orphans.** The `runs` atom survives a reload; the continuation that would remove its row does not. `Lab.liveRuns` keeps a row until the limit plus `RUN_GRACE_MS` (30 s, for a run that is still ending: its scan, its store write), and every reader of `runs` goes through it: the scan's lights, the tick, `run()`'s guard, the auto re-run, the pane's busy buttons and the band. Past that age V, T and K light again, the band and lights stop showing the row, the auto re-run goes on, and a new run replaces the row. The tick drops such a row and rescans, because a render runs once per input and the lights come from the last scan. Before it stops the clock, the tick reads `runs` again, and after stopping it, it restarts it for a run that started meanwhile. `session.start` fires once per fresh load of the module `[d.ts]`, so every row in `runs` then belongs to a module that is gone: `clearLeftRuns` empties it before the first scan, and a reload's orphans don't wait out the age rule. The age rule stays for a run that hangs inside one load.
- **Review (PR #55, round 1):** Codex's three comments and `/code-review`'s findings on 5bfd9e6 changed the first version: the pane and the other readers counted orphans, `$.process.run`'s timeout read "could not run", `/mod-builder config` didn't know the option, the option was read loosely, a throw left the stage running, and the rules sat in `register.tsx` where the coverage gate didn't measure them.
- **Review (PR #55, round 2):** Codex's three comments and `/code-review` on c06dfc1. A 5 s poll ran over a limit that isn't a multiple of 5 s, so the timer is now one-shot. The tick could stop the clock under a run that had just started. And the age rule could replace a row whose continuation was still alive, so a run now checks for its own row, and a load clears leftover rows. A test's `$` has no `$.state`, so a test can't seed `runs` (`[probe]`); the tests make rows with held runs.
- **Not changed:**
  - A run whose first scan takes longer than the limit plus 30 s loses its row to the tick's age rule, then stops with no toast; its log line says "superseded" though nothing replaced it (code reading; rare at the default 3 minutes).
  - A detached rescan that fails (the tick's, `session.start`'s, a report's) is logged and leaves the last view, so a stage can keep reading running until the next scan. Every detached scan in the mod does this; it's a follow-up, not this PR's (Codex 4284334808). Keeping the clock alive until a rescan succeeds would spin the 250 ms tick for as long as the store fails.
- **Not changed (#58):** `run()` replaces any row of the same mod and kind when it adds its own, so if two runs pass the guard together (#58's race), the first one's row and progress drop out of the band while both processes run.
- **gotchas.md:** `[d.ts]` entries this change relies on: an options change reloads the plugin, and `session.start` fires once per fresh load (whether an options reload counts is inferred until the live check); a spawn stream's `result` rejects when it is closed early; `$.process.run` kills the child and rejects at `timeoutMs`.
- **Tests:** `tests/mod-builder-logic.test.ts`: `liveRuns`, `runLimitMsOf`, `isOverLimit`, `timeoutText`, `limitMinutesOf` (through the listing), `toastOfRunError`, `hasRun`, `withProgress`, and the option in `parseConfigCommand`, `valuesAfterSet` and `configListText`. `tests/ui.test.tsx`, "a run that does not end": a failing `$.store.set` leaves no row and toasts; an orphan blocks until the limit plus 30 s, then leaves the band and the pane and T starts a new run; the clock drops it and the stage stops reading running; it doesn't hold back the auto re-run; a second `session.start` clears leftover rows; a run whose row was replaced during its scan starts no process, and one replaced during its check saves and toasts nothing; a `$.process.run` stopped at the limit reads as timed out; the `timeoutMs` a Test run gets; `default` writes `''`. Those tests use `testTimeoutMinutes` 0.1. `$.process.spawn` can't be stubbed, so the streamed timeout is checked live.
- **Live check (awaiting the owner):**
  1. Timeout: `testTimeoutMinutes` 1 and a throwaway mod whose only test is `while (true) {}`. Expect "timed out after 1 minute", then a T press that starts a new run.
  2. Reload: start that Test with `testTimeoutMinutes` 10, then run `/mod-builder config testTimeoutMinutes 1` while it runs. The set reloads the plugin. If `session.start` fires for that reload, `clearLeftRuns` empties `runs` and T in the open pane lights at once. If it doesn't, the row stays until the age rule drops it, and the fallback is to start the clock from the pane's render. Don't end a Claude turn while waiting, because a turn's rescan would hide the result.
  3. Config: `/mod-builder config testTimeoutMinutes 5` (a number) and `/mod-builder config testTimeoutMinutes default` (`''`) both go through `$.config.set`, and the listing shows them.
  The streamed timeout, the clearing after a real reload and the tick's restart have no automated test: the kit can't stub `$.process.spawn`, make a reload, or interleave a press inside a tick.
- **Version:** 0.2.10 in `plugin.json` and the marketplace entry.

## Change 0.2.11 (2026-10-15)

> For issue #9: does `autoRerun`, on by default, run a collaborator's changed mod code with the person's access? Codex's security comment on PR #1 (discussion_r4252564453).

- **Decision (the owner's):** keep `autoRerun` on by default. It turns off with `/mod-builder config autoRerun off` or its `/config` row; a config pane for `/mod-builder config` is #70.
- **Why:** `autoRerun` runs `claude plugin validate` and `claude plugin test`. The d.ts says a test runs with no fs, network or process `[d.ts]`, and probes on 2.1.296 and 2.1.300 back it, including that neither command starts a settings-style command hook or a `.mcp.json` server while a live `--plugin-dir` session does `[probe]`. The evidence, its builds and what was not probed are in gotchas.md ("Testing and checking"); this section doesn't repeat it.
- **Changed:** `docs/safety.md` cites the d.ts and the probes with their builds, says validate's listing leaves out command hooks and MCP servers (and that no plugin here has either), and says the own-code-only rule (`skills/build/SKILL.md`) is stricter than the sandbox. `gotchas.md` records the probe, its shapes, its control and the shapes not probed.
- **Review (PR #65, round 1):** Codex's P1 and `/code-review`: a "What it reaches" table built from validate alone hides a command hook or an MCP server. Build's step 5, edit's README step, `README.template.md`, `SPEC.template.md`, `conventions.md` and `CLAUDE.md` now say to read `hooks/hooks.json`, `.mcp.json` and `plugin.json`'s `hooks` and `mcpServers` too and add a row for each. The gotchas entry is split by finding and build, cites #9's audit run for the 2.1.296 results, and lists the shapes not probed.
- **Review (PR #65, round 1), Codex's P2:** a streamed Test kept every piece of output and recounted the whole buffer on each piece, so a test that prints without end grew memory and CPU in the hook. **Fixed:** `Lab.streamPiece` counts only the lines a piece finishes and keeps only what `parseTest` and the log read: the first 6 `(fail)` lines with the 2 after each, the last 50 lines and the unfinished line, each cut at 2000 characters (`Lab.streamOutput`). `$.process.run`, the fallback, already keeps at most 4 MiB of each stream `[d.ts]`. **Accepted, not fixed:** a changed test that loops or eats memory still runs without asking; the time limit (`testTimeoutMinutes`, 3 minutes by default) kills it. `docs/safety.md` says so, and says `autoRerun` re-runs tests a collaborator changed, which the build skill's own-code-only rule forbids for mods from elsewhere.
- **Streams:** spawn pieces come per stream, "as it came, not lines" `[d.ts]`, and `claude plugin test` writes its results to stdout and a test's `console.log` to stderr `[probe]`. So each stream has its own unfinished line, and the first `N pass`, `N fail` and `Ran …` lines are kept wherever they land: the live check's first run read "0 tests passed" because stderr's backlog arrived after the summary and pushed it out of the tail.
- **Tests:** `tests/mod-builder-logic.test.ts`, "a streamed test run keeps bounded output": fed in pieces of any size, it counts and judges as the whole output does; 2 MB of printing, a 4 MB line without end, and 40 failures among the noise each stay under 200,000 characters and parse as the whole output does; stderr printed after the stdout summary keeps the summary; a stderr piece cut mid-line doesn't join the stdout line after it. `$.process.spawn` can't be stubbed, so `execute()`'s loop is checked live.
- **Live check (2.1.300):** a throwaway mod whose test prints 100,000 lines (7.8 MB) then passes, T in Mod Lab in an interactive `--plugin-dir` session: "2 tests passed in 1.0s", the process ending after 1.5 s. Before the per-stream fix it read "0 tests passed".
- **Not changed:** nothing re-runs the probe (#69). It holds for the builds named, and Claude Code changes between builds; gotchas.md says to re-run it after an update.
- **Version:** 0.2.11 in `plugin.json` and the marketplace entry.

## Change 0.2.12 (2026-10-15)

> For issue #15: nested-only logic edits left the Logic stage stale (Codex's comment on PR #1, discussion_r4254194992).

- **Fix:** `logicMtimeMs`, which the Logic stage compares against an edit generation's start, was the newest mtime of top-level `hooks/` logic modules and top-level `tests/` test files only. 0.2.1 made Validate and Test notice `hooks/lib/parser.ts`, so an edit that changed only nested logic re-ran both while the Logic light stayed stale and the mod never reached "ready to share". `Lab.factsOf` now also takes into account the nested files (`read.nested`) under `hooks/` that are logic modules (`Lab.isLogicModule` on the base name: no `register.*`, no `.d.ts`) and those under `tests/` that are test files (`Lab.isTestFile`), through `Lab.isNestedLogicOrTest`. Files under `types/` and other files in subfolders (data, helpers in `tests/`) still count for the code signature only.
- **Amends 0.2.1's "Unchanged":** the rule that Logic and Register look only at files directly in `hooks/` and `tests/` now applies to **existence** only: `hasLogic`, `hasTests` and `hasRegister` stay top-level, so a nested `hooks/lib/x-logic.ts` still isn't the logic module. Freshness (`logicMtimeMs`) sees nested logic and test files.
- **Tests:** `tests/mod-builder-logic.test.ts`, "logicMtimeMs sees nested logic and test files": a newer nested `hooks/` file, a nested `*.test.ts(x)` and one 3 levels down raise `logicMtimeMs` and leave `hasLogic` and `hasTests` as they were; `register.*`, `.d.ts`, data files, `types/` and helpers under `tests/` don't count. `tests/ui.test.tsx`, "nested logic edit during a generation": with SPEC, README, `plugin.json` and only `hooks/lib/parser.ts` saved, the edit reaches "ready to share" (a control with a top-level logic file also saved passes before and after). The nested-only test fails on 0.2.11.
- **Version:** 0.2.12 in `plugin.json` and the marketplace entry.

## Change 0.2.13 (2026-10-15)

> For issue #12: a repeated `Spec running` during an edit reset the edit's baseline version. Codex's comment on PR #1 (discussion_r4254194998).

- **Fix:** the `lab_report` handler rewrote the mod's generation (`since` and `fromVersion`) on every `Spec running` for a mod whose Spec light wasn't pending. A second report in the middle of an edit, after the version bump but before Validate and Test were redone, made the bumped version the baseline, so Share needed another bump and the edit could not reach "ready to share". It also moved `since` past files saved earlier in the edit, so SPEC.md read as stale. A report now starts a generation only when the mod has none (the check is inside `updateGenerations`' callback, so it runs in the store's chain); on a repeat the generation keeps its `since` and `fromVersion`.
- **Rule:** a generation ends only when the mod is all green (`scanOnce`), so the handler takes a `Spec running` while one exists as a repeat of that edit. The one exception is a scan that had already judged the edit finished: it reads that report as the next edit (below). An abandoned edit's generation therefore stays in `$.store` into a later edit of the same mod, with its old start and baseline.
- **Stamp:** a repeat sets `repeatedAt` on the generation: the report's time, or one past the last stamp when that isn't later, so every repeat changes it. Two repeats in one millisecond would otherwise leave it as a scan read it (Codex P2 on PR #73). #14's scan deletes the generation it judged finished only if its `since` is the one it read, which a repeat no longer changes, so a report that arrived while the scan was running would have been lost to the deletion (the "second edit of the mod whose edit the scan ends" test). The scan now also compares `repeatedAt`. Generations stored before 0.2.13 have no `repeatedAt`, which compares equal to itself.
- **The next edit in that window:** an edit can begin after a scan has judged the previous one finished and before it deletes the generation. The handler can't tell that report from a repeat, so it stamps the old generation. The scan can: it reads the generations before the reports, and the handler writes the generation before the report, so a report the judged lights didn't show came after the edit was finished. Such a report begins the next edit. The scan replaces the generation with `since` at the stamp and `fromVersion` at the version it read, instead of deleting it. Without this, the next edit kept the previous edit's start and baseline, and reached "ready to share" with no new bump. 0.2.11 tracked that edit correctly (it rewrote `since`), so the stamp alone would have been a regression.
- **Tests:** `tests/ui.test.tsx`, "a repeated Spec running during an edit (#12)": a second `Spec running` after the bump keeps the original baseline (the mod reaches "ready to share"), and keeps the start time (SPEC.md saved after the first report is not stale; Share is what the edit still needs). Both fail on 0.2.11. The existing "a second edit of the mod whose edit the scan ends is still tracked" passes through the stamp. In "a scan that read the generations before an edit began", the next edit begun in the window starts from the version the first left (Share still needs a bump) and at its own report (Validate and Test from the first edit are stale; autoRerun off, so the row shows it). Both pass on 0.2.11 and failed with the stamp alone. "A second edit reported in the same millisecond as the repeat the scan read is still tracked" holds the clock still from a repeat through the scan's read to the next edit's report; with the report's time as the stamp it read "ready to share".
- **Version:** 0.2.13 in `plugin.json` and the marketplace entry (#15 took 0.2.12 first).


## Change 0.2.14 (2026-10-15)

> For issue #10: an edit's start was missed when `lab_report` reported `Spec running` while a scan that hadn't listed the mod was under way. Codex's comment on PR #1 (discussion_r4252575075). And for #79, the same miss after a `/cd`, found while reviewing this change.

- **Cause:** the 0.2.0 claim above ("an edit's start is never missed") held only when the hook had read no state before it waited. Every `$.state.get` of one dispatch reads one moment `[d.ts]`, fixed at the dispatch's first `get` `[probe]`. The handler's first read (the folder `judged`) came before the wait, so the re-read after `await scan()` returned the same list, without the mod: no generation was stored, and the results from before the edit stayed green.
- **Fixed:** a `Spec` report waits for the scan before it reads any state, unless the last scan that wrote its rows (`judged`) was of this folder and listed the mod. That record (`published`, module state) is set with no await after the `judged` write, so no other hook runs between the two. A mod already listed doesn't wait, as before: its row in the last scan is enough to start the edit, and the scan the hook waits for may be held a long time (the tests "a scan that read the generations before an edit began" report while a scan is held).
- **Why not scan on every `Spec` report:** that was tried first (the issue's fix). Five tests in "a scan that read the generations before an edit began" failed: a report on a listed mod blocked on the scan they hold, and where `plugin.json` can't be read as the edit begins, the new scan dropped the version the last scan had read, so `fromVersion` came out empty.
- **Tests:** `tests/ui.test.tsx`, "edit: Spec running arrives while another hook's scan is listing (#10)": a mod checked in an earlier session appears on disk after the startup scan; a scan is held at the mods folder; `Spec running` waits for it, then `Spec passed` shows "edit · update Spec for this change". The store is seeded through `world()`'s existing `seeded` parameter; the helper's `fs.list` now reads the disk at call time, so a test can add files after the world is made.
- **Review (PR #74, round 1):** Codex's P2. The first version of the guard read `factsByMod`, which a scan sets several awaits before it writes `judged`. A report in between skipped the wait and read the old rows; the SPEC had listed this as a known gap. The same `factsByMod` held whichever folder was scanned last, so after a `/cd` a mod with the same name in the old folder skipped the wait. A report that then joined another hook's scan of the new folder read the old folder's row (#79). Both now wait. After a reload `published` is empty, so the first `Spec` report scans first.
- **Review tests:** in "edit: Spec running arrives while another hook's scan is listing (#10)", a report lands while a scan is held at its first store read after the facts (`world()`'s new `holdStoreGet`). "edit: Spec running after a /cd, while another hook's scan of the new folder is listing (#79)" has a control, where the report scans the new folder itself, and the joined case. Both new cases failed on the first version (178 pass, 2 fail) and pass now (180 pass).
- **Known limit (live, 2.1.300):** the wait counts against the hook's 10 s budget. With 300 mods on `/mnt/c` (a 10 s scan), a `Spec running` that joined a scan and queued another pass failed at 10.0 s with `{"kind":"timeout"}`, answered "noted (the lab could not update just now)" and recorded nothing. This was on `main` before this change, whose re-scan waited the same way. Scans of this repository's mods folder take about 250 ms.
- **Live check (2.1.300):** a throwaway mod in `claude -p --plugin-dir` shows the moment is fixed at the first `get` of any atom; see gotchas.md ("Modules").
- **Live check of Mod Lab (2.1.300, 2026-10-15):** `claude -p --plugin-dir` on a copy of each version (log level set to `debug` in both, nothing else changed), the mods folder a fixture on `/mnt/c` big enough that a scan takes 2 to 4 s. A mod with a SPEC appears after the startup scans; then `lab_report gb001 Logic running` starts a scan and `Spec running` for the new mod follows about 2 s later. The pass/fail evidence is the mod's log and the `modlab:generations:<modsDir>` store key.
  - `main` before this change (70 mods): `Spec running` came at 18:07:22.309, while the scan that ended at 18:07:22.741 was listing. No generation was stored: the miss, live.
  - This change's first version, the `factsByMod` guard (112 mods): `Spec running` came at 18:13:16.438, while the scan that ended at 18:13:17.314 was listing. The report waited for that pass and the one it queued, and stored the generation at 18:13:20.761.
  - In one run of each version the report came after the scan had ended (no race), and both stored the generation.
  - The final version, the `published` guard (115 mods): `Spec running` came at 18:23:51.689, while the scan that ended at 18:23:52.887 was listing. The report waited for that pass and the one it queued, and stored the generation at 18:23:57.477. A second run didn't overlap and stored it too.
- **Version:** 0.2.14 in `plugin.json` and the marketplace entry (0.2.12 and 0.2.13 went to #15 and #12, PRs #72 and #73, which merged first).

## Change 0.2.15 (2026-10-15)

> For issue #17: Mod Lab's scan watched only part of what `claude plugin validate` reads.

- **Gap (1), fixed:** the code signature covered `.claude-plugin/plugin.json`, `hooks/`, `tests/` and `types/` with their subfolders. `claude plugin validate` also reads `agents/`, `commands/`, `skills/` and the root `.mcp.json` (the issue's probe on 2.1.296: a broken `agents/bad.md` or `.mcp.json` changes validate's result; `output-styles/`, `settings.json`, `.lsp.json`, `monitors/`, `themes/`, `bin/` and extra `.claude-plugin/*.json` did not), so editing them never made Validate stale. `FolderRead` takes optional `agents`, `commands` and `skills` listings (optional, so existing fixtures compile). `modFactsOf` lists them with the rest and walks their subfolders like `hooks/` (`nestedFiles`, names prefixed `agents/...`, 3 levels down). `factsOf` signs them with `inFolder` and adds the root `.mcp.json` from the top listing, so an edit, an add, a delete or a move between folders changes `codeSig` and `codeMtimeMs`, and a README older than them reads stale. The `codeMtimeMs` and `codeSig` doc comments list what they cover. Only `.mcp.json` is picked from the top listing: the SPEC and README are read by neither validate nor test.
- **Gap (2), already fixed by 0.2.8 (#14):** `scanOnce` builds a new `Map` and assigns the top-level `let factsByMod` once every folder is read, so a reader sees the old set or the new one, never an empty one (0.2.8's section; the UI test "an edit whose `plugin.json` cannot be read while a scan is held starts from the version the last finished scan read" fails if a scan empties it first). Nothing changed here. The issue's own reproduction (a relative hold on the second `fs.list`) was not added: 0.2.8 also made the `lab_report` handler read the mod's `plugin.json` as the edit begins, so `fromVersion` no longer depends on `factsByMod` unless that read fails.
- **Gap (3), deferred:** the scan still lists and reads each mod's files in sequence (the three text reads, and one folder at a time). The issue marks it optional and asks for a before-and-after measurement (median of 5 `claude -p` runs on a scratch copy), which this change did not take, so there is no measured case for it. The seven listings per mod (manifest folder, `hooks/`, `tests/`, `types/`, `agents/`, `commands/`, `skills/`) and their subfolders are issued together, as the first four were.
- **On upgrade:** every signature now includes the `.mcp.json` of a mod that has one and the files of any of the three new folders, so such a mod's Validate and Test read stale once and `autoRerun` re-runs them at the end of the next turn. A mod with none of them keeps its signature, because the new groups add no entries. Once the re-run passes, Mod Lab announces "ready to share" for such a mod again (toast and notification), as after any change to its code: `announceGreen` records each announcement against the `codeSig` it was made at.
- **Tests:** logic: a file in each of `agents/`, `commands/` and `skills/` changes `codeSig` and `codeMtimeMs`, and makes a README older than it stale; a folder inside one is no file; the same file name moved between them changes the signature; the root `.mcp.json` counts and the SPEC and README do not. UI: after a pass, an edit to `agents/helper.md`, `commands/go.md`, `skills/review/SKILL.md`, `agents/team/lead.md` or `.mcp.json` makes the end of the turn re-run Validate, then Test. All 10 fail on 0.2.11.
- **With 0.2.12 (#15):** both changes read `read.nested`. #17 adds `agents/`, `commands/` and `skills/` subfolder files to it, and `Lab.isNestedLogicOrTest` counts only paths under `hooks/` and `tests/`, so those files move the code signature and not `logicMtimeMs`. Merged from `main` after #72; the conflict in `factsOf` kept both. Merged again after #73 (#12) and #74 (#10): only the version and this SPEC conflicted, and their `register.tsx` and `ui.test.tsx` changes merged without one.
- **Live check (2.1.300):** fixture copies of git-branch in two scratch folders, one with Mod Lab from `main` (0.2.11) and one from this branch, each in an interactive `--plugin-dir` session. V and T passed, then a malformed root `.mcp.json` (`{ not json`, which makes `claude plugin validate` fail) was saved and one turn ended. This branch: the row went from "next: Share" to "✕ validate · 1 problem". `main`: the row stayed "next: Share". A malformed `agents/helper.md` (validate "passed with warnings") re-ran Validate and Test on this branch (the stored result is stamped after the turn and carries the agent's "No description in frontmatter" warning), and not on `main` (stamp from the manual run, no warnings). The row reads the same either way, because a warning passes.
- **Review (PR #76, round 1, a `/code-review`):** 11 findings. Three led to changes here, all documentation. The rest are pre-existing or design items.
  - **Probed what validate reads (2.1.300):** the review noted that only `agents/` and `.mcp.json` had been probed. On 2.1.300, an empty file in `agents/`, `commands/`, `commands/sub/` or `skills/x/SKILL.md` makes validate "pass with warnings", so all three folders are read. An empty `skills/x/references/y.md` gives no warning. The issue's `name: [broken` frontmatter no longer warns on 2.1.300. Full table in gotchas.md ("Testing and checking").
  - **`autoRerun` and the shapes not yet probed:** validate and test ran no shell in a command or skill body and started no agent `mcpServers` (2.1.300, no live control). gotchas.md and docs/safety.md say so.
  - **"Ready to share" again on upgrade:** added to "On upgrade" above.
  - **Known limits, unchanged by this change (follow-up #82):**
    - A symbolic link lists as `other` (d.ts), so a linked file or folder is left out of the signature, in the new folders as in `hooks/` and `tests/`.
    - Validate follows a `plugin.json` `"mcpServers": "./file.json"` path (probed: a malformed one fails validate), and the signature doesn't cover it. Validate showed no sign of following a `"commands": "./cmds"` path.
    - Logic counts only `hooks/` and `tests/` files, so an edit confined to the new folders, or to the SPEC or README, leaves Logic stale and never reaches "ready to share", as on 0.2.14.
    - The subfolder walk skips only dot-folders and `node_modules`, so a generated tree under `skills/` (`__pycache__`, `dist/`) is signed.
    - No test pins `nestedFiles`' depth of 3 or its skips. That gap dates from 0.2.1.
  - **Not changed:** Gap (3) stays deferred (the owner's call, with no follow-up issue). Gap (2)'s reproduction is the existing 0.2.8 test named above.
- **Version:** 0.2.15 in `plugin.json` and the marketplace entry (0.2.12, 0.2.13 and 0.2.14 went to #15, #12 and #10, PRs #72, #73 and #74, which merged first).

## Change 0.2.16 (2026-10-15)

> For issue #19: while `/mod-builder:build` was on its Spec stage the band showed the new mod, but Mod Lab's list didn't, and `/modlab <name>` answered "No mod named <name>".

- **Cause:** the list was built only from folders under `modsDir` with a `SPEC.md` or a `.claude-plugin/plugin.json` (`Lab.factsOf` gives `null` for any other), and the build skill reports "Spec running" before it writes the SPEC. The band reads `reported` directly, so it showed a mod with no row.
- **Placeholder rule (`Lab.placeholderNames`, `Lab.placeholderFacts`):** a mod gets a placeholder row when it has a **live `running` report** (what `Lab.liveReports` keeps: a running report older than `REPORT_TTL_MS` is dropped) and **no facts** (no folder with a SPEC or manifest). A passed or failed report for a missing folder gets no row, so a typo in an old report never lingers. `placeholderFacts(name)` has every `has*` false and every mtime 0, so `Lab.viewOf` lights the reported stage `running` and leaves the rest `pending`. `ModView.isPlaceholder` is true for such a view (derived from the facts: neither SPEC nor manifest, which no real folder's facts can be).
- **Scan:** after the folder loop, `scanOnce` adds a view per placeholder name, with no results, no generation and not fresh. It is not put in `factsByMod`, which holds only what a folder read found. The next scan that finds the folder builds the real row and the placeholder is gone. A repeated Spec report for a placeholder does not start an edit generation: a mod with no folder is being built, not edited.
- **Pane:** the detail panel says `folder not written yet: <modsDir short path>/<name>/` and the Validate, Test, Type-check and README buttons (and their hotkeys line) are left out, because a run and the README need the folder. The row counts as building (`countsOf` already counts a running light), so the header reads, for example, "4 mods · 1 green · 1 building".
- **`/modlab <name>`:** a placeholder name selects its row (the command rescans first, and the row is in the list), so it no longer toasts "No mod named".
- **Summary row:** each count is its own `Text` with the ` · ` separator between them, rather than the separator inside the next count's `Text`, so a count such as `1 building` is a node of its own.
- **Docs:** `docs/mod-lab.md` says a mod appears as soon as a build reports it, before its folder exists.
- **Tests:** `tests/mod-builder-logic.test.ts`, "a mod is listed as soon as a build reports it, before its folder exists": `placeholderNames` returns a name with a running report and no facts, nothing for one that has facts, for passed or failed reports, or (through `liveReports`) for a running report older than `REPORT_TTL_MS`; `placeholderFacts` has the shape of the empty fixture; the placeholder's view has the reported stage `running` and the rest `pending`; `countsOf` counts it as building. `tests/ui.test.tsx`, "a mod reported before its folder exists": a Spec report for `new-mod` with only `git-branch` on disk adds a `new-mod` row with "folder not written yet", counted as building, with no `validate`, `test`, `typecheck`, `readme` or `fix` button; `/modlab new-mod` selects it with no "No mod named" toast; once its SPEC exists the next scan shows the real row and the placeholder text is gone. Each fails on 0.2.12.
- **Merge with 0.2.14 (#10):** the Spec-report rescan this change first added in the `lab_report` handler is dropped as redundant: #10's guard already scans before any state read when the last written rows don't list the mod. Neither scan makes a first report see a placeholder: the report is stored only after `known` is read, so the first `Spec running` for a new mod finds no row (`known` is undefined) and the row appears from the handler's closing `scan($, true)`. Only a repeated report reads the placeholder, which is what the `!known.isPlaceholder` guard is for.
- **Review (PR #80, round 1; Codex's two P2s and a `/code-review`):**
  - **Expired report (Codex P2), fixed:** `tick()` dropped an expired running report and stopped the clock but never rescanned, so the placeholder row, the `1 building` count and the badge stayed until the next turn or command. A tick now rescans when the last judged rows hold a placeholder with no live running report.
  - **Other mods folder (Codex P2), fixed:** reports are kept by mod name only, so after a `/cd` within `REPORT_TTL_MS` the other folder listed a placeholder whose note named a path that was never meant. The handler now stores the mods folder on each report (`Reported.dir`), and `placeholderNames` takes the scanned folder and counts only reports made there. A report stored before this change has no `dir` and gives no placeholder.
  - **Guard test:** the edit guard had no test (removing it kept every test green). The new test reports `Spec running` twice, writes the SPEC and reports `Spec passed`; without the guard a generation starts and the row reads `edit · update Spec for this change`.
  - **Tests:** `tests/ui.test.tsx`, "a mod reported before its folder exists (#19)": a placeholder whose report expires leaves the list at the next tick; a placeholder shows only in the folder its report was made in, across a `/cd` and back; a repeated `Spec running` starts no edit. `tests/mod-builder-logic.test.ts`: `placeholderNames` with a mods folder counts only reports made there.
  - **Deferred to follow-up #84:** a scan in flight when the first report lands can move the selection off the new mod; the mobile, compact and hint-line placeholder branches have no tests; the note says "folder not written yet" while a folder with neither SPEC nor manifest exists; the placeholder views duplicate the 8-argument `viewOf` call (#38); `isPlaceholder` is inferred from empty facts.
- **Review (PR #80, round 2; Codex P2), fixed:** round 1's tick change read the reports once, before three more reads, and stopped the clock on that copy. A `Spec running` that landed in between found the clock still set and started none, so the clock stopped with a report live: the band's timer froze and that placeholder outlived its report until an unrelated scan. The tick now reads the reports again for the stop decision, and after stopping restarts the clock when a running report or a run is live (`hasRunningReport`). Test: `tests/ui.test.tsx`, "a report that lands while a tick retires the last one keeps the clock" (holds the tick's first rows read after its reports read, at the expiry tick, and sends a new report meanwhile).
- **Review (PR #80, round 3; Codex P2), fixed:** after a reload, a live running report survives in state but the module's clock does not, and `session.start` only scanned. The restored placeholder then had no tick to expire it, so an idle session kept the row until a turn end or command scanned. `session.start` now starts the clock when a running report is live. Test: `tests/ui.test.tsx`, "a live running report a fresh module finds at session start keeps a clock" (state returns the earlier module's report until this module writes its own).
- **Review (PR #80, round 4; Codex P2), fixed:** round 1's folder fix (`1bcdbc4`) created this case. It tagged each report with its folder, but `reported` keeps one report per mod name, so a same-named new mod reported in a second folder replaced the first folder's report, and the first folder's placeholder dropped before its TTL. Before `1bcdbc4` both folders showed the row. Placeholders now come from a record of their own, `building`: running reports per mods folder, then mod name (`Lab.withBuilding`: a running report sets its entry, a finished one removes it, expired entries go). The scan, the tick's expiry check and `hasRunningReport` all read it; `reported` still drives the band and everything else, and still has the name-keyed limit recorded above. `Reported.dir` stays, now redundant for placeholders. Tests: logic, `withBuilding`; UI, "same-named new mods built in two mods folders each keep their placeholder". The round 2 and 3 tests now hold and restore `building` (their own commit says why).
- **Version:** 0.2.16 in `plugin.json` and the marketplace entry (0.2.13, 0.2.14 and 0.2.15 went to #12, #10 and #17, PRs #73, #74 and #76, which merged first).

## Change 0.2.18 (2026-10-15)

> For issue #90: in a 97-column terminal, `/modlab` answered "Mod Lab opened." and showed no pane. The owner also asked that typing `/mod-builder:build` or `/mod-builder:edit` open Mod Lab.

- **Cause:** every `/modlab` branch opened the pane in detached work: the toggle after `clearNarrowWarning` and a scan, `<mod>` after a scan, and `demo` after `startDemo`. So `$.ui.open` ran after the command's hook returned. The engine counts that as unasked and places it only from 144 columns, or from 110 for an id the person opened before (`UiOpenResult` in the d.ts). The pane waited undrawn. In probes at 97 and 115 columns it stayed hidden, and it appeared when the window reached 150.
- **`/modlab`:** each branch now opens the pane before the hook returns. The toggle goes through `showPane`, which clears the narrow warning, opens the pane and leaves the scan to run on. `demo` awaits `startDemo` and then the open. `<mod>` opens first and selects the mod after the scan; if the scan finds no such mod, it toasts "No mod named …" with the pane open on the list. Before, it opened nothing for an unknown name. A refused open now answers with the command's error text instead of "Mod Lab opened.", because the open is no longer in detached work.
- **`/mod-builder:build` and `/mod-builder:edit` (owner's decision):** typed by the person, each reaches a `command.run` hook (string-literal matcher, `command: 'mod-builder:build'` / `'mod-builder:edit'`, as probed). The hook opens the pane through `openForSkill` unless it's open, then returns `next(e)`, so the skill runs as before. Both fail open: `openForSkill` logs a failed open (`command.skill`), and each hook's `.catch` returns `next(e)`. This doesn't depend on `autoOpen`.
- **Not covered: a plain-words request.** When Claude starts the skill through the `Skill` tool, no `command.run` fires. A `tool.call` hook's open is never asked (probe: `isPlaced: false`, "unasked below 110 columns (97 now, an id the person opened before)"). The pane then appears through `autoOpen` at 144 columns or more, or 110 once the person has opened Mod Lab and not closed it by hand. The README and `docs/mod-lab.md` say so.
- **Engine builds:** `gotchas.md` warned that a `command.run` hook awaiting its own pane can deadlock (a `[field]` note from 2026-10-12). On 2.1.296 and on 2.1.301 the awaited open answered at once, and the pane drew at 97 columns for the toggle, fold, `demo`, `<mod>` and a typed `/mod-builder:edit`. A typed skill was handed on in both: on 2.1.296, with a placeholder API key, the skill's model call failed with "Invalid API key"; on 2.1.301 the build skill started and was interrupted with Esc. `gotchas.md` records the probe beside the old note, plus a `[probe]` that a `tool.call` open is never asked.
- **Tests:** `tests/ui.test.tsx`, "the pane opens from the command itself (#90)". `/modlab` and `/modlab <mod>`, with the scan's list of the mods folder held, have opened the pane when the command returns; `<mod>` then selects the mod. `/modlab <unknown>` opens the pane and toasts once. `/modlab demo` has opened the pane when the command returns. A typed `/mod-builder:build` and `/mod-builder:edit` open the pane and return the text of the command beneath. These six fail on 0.2.16 (`Expected ["modlab"]`, `Received []`). Two guards pass before and after: an open pane is left as it is, and a refused open still runs the skill. The world gains `seen.panes` and `seen.denyOpen`.
- **Version:** 0.2.18 in `plugin.json` and the marketplace entry. 0.2.17 is PR #85's (#20); whichever merges second takes the next number.
- **Review (PR #93, round 1: Codex's P2 plus a `/code-review`):**
  - **A pane waiting undrawn (fixed, `f14a59e`):** the toggle and the typed build/edit hooks asked `isPaneOpen`, which is true for a pane opened unasked that waits undrawn. That pane comes from `autoOpen` or a plain-words build on a narrow terminal. So `/modlab` folded a pane nobody could see, and a typed edit skipped the open. `isPaneShown` checks `isPlaced`, and `autoOpen` keeps `isPaneOpen` so it doesn't re-open (and toast) on every report. Probe on 2.1.301 at 97 columns: a timer's open left the pane `isPlaced: false` in `$.ui.panes()`, and `/modlab` then seated it (`isPlaced: true`). Tests: a waiting pane is opened by `/modlab` and by a typed edit; a drawn pane folds (a guard, since folding had no test).
  - **Codex P2, scan before forwarding (fixed, `563d218`):** `openForSkill` started a scan. A first `Spec running` report for an unlisted mod awaits `scan()`, so it could join that scan and wait an extra pass against its 10 s budget. Both skills report Spec well after a normal scan ends, so the window is narrow, but the skill hooks now open the pane without scanning, because the first report scans. Test: with the mods folder's list held, a typed build never reaches it.
  - **`/modlab <mod>` selection (fixed, `b21d065`):** a listed mod is now selected before the open, so the first frame shows it. The scan-and-select work starts before the open, so a refused open still selects. Tests: with the scan held, the first frame shows the mod; with the open refused, a mod only the scan finds is selected.
  - **Tests (tightened, `a3f9e7b`):** the typed-skill tests now record what was open when the skill ran, and the refused-open guard checks the `command.skill` log line and that no "hook failed" line was written. With a detached open and no try/catch, both fail.
  - **Docs (fixed):** `conventions.md`'s Commands example taught `void (async () => { open panes, start work })()` and "never await your own pane", the shape behind #90. It now opens before any `await`, checks `isPlaced` to toggle, and states the unasked rule. `autoOpen`'s title and description in `plugin.json` say typed build/edit open Mod Lab whatever it is set to.
  - **Declined, origin gate:** the review suggested opening only for `origin.kind === 'composer'`. The d.ts says a bare `-p` run places every pane and never answers `isPlaced: false`, so the predicted toast in `-p` doesn't happen. A scheduled or peer-sent `/mod-builder:build` with a surface attached gets the engine's unasked rule, as `autoOpen` does, which fits the owner's "running these commands also loads Mod Lab".
  - **Declined, the `.catch` calling `next(e)` again:** that is the d.ts's own pattern (`next.called ? next(e) : …`), not a second run. The stall it guards against is the 2026-10-12 note, which didn't reproduce on 2.1.296 or 2.1.301.
  - **Declined, "Mod Lab opened." when not placed:** in a terminal, an asked open is always placed. The remaining case is a surface that places nothing, which `openPane` already toasts.
  - **Declined, one shared handler:** matchers must be string literals, so two `on(...)` calls stay. Each body is already one `openForSkill` call. Pulling out the two-line `.catch` would need the engine's generic `CatchHandler<F>` types.
  - **Filed as #94:** the pane-command archetype, duet and issue-forge open their `demo` panes after the hook returns. The archetype's `demo` was probed at 97 columns.

## Change 0.2.19 (2026-10-15)

> For issue #20: a code span that wraps a line was read as an unfilled SPEC placeholder.

- **Bug, fixed:** `hasPlaceholder` removed inline code with a pattern that stops at a newline. A span that starts on one line and ends on the next (`it is in` on one line, `stash "<message>"` on the next, inside one pair of backticks) was left in the prose, and the `<message>` inside it read as an unfilled placeholder, so the Spec stage stayed at "next: Spec" on a SPEC that was complete (seen with `mods/issue-forge/SPEC.md`).
- **Rule:** an inline code span may hold any number of line endings, until a blank line or a line that starts another block: an ATX heading, a list item or a block quote (`BLOCK_BREAK`). CommonMark pairs backticks within one block only, so a backtick left open doesn't swallow the next paragraph, heading or list item. A heading or quote ends a span only within three spaces of indent, as in CommonMark; a list item ends it at any indent, since nested items sit deeper. Inside a block, an unclosed backtick pairs with the next one, as in CommonMark. An escaped backtick opens no span, and an escaped backslash leaves the backtick after it free to (`ESCAPE_OR_SPAN`). Fenced blocks and HTML comments are handled as before. A `<files>` in plain prose is still a placeholder. The pattern, with `BLOCK_BREAK` written out (a match that starts with a backslash is kept, a span is removed):

  ```
  /\\[\\`]|`(?:[^`\n]|\n(?!(?:[ \t]*(?:\r?\n|$|[-*+][ \t]|\d{1,9}[.)][ \t])| {0,3}(?:#{1,6}(?:[ \t]|$)|>))))*`/g
  ```

- **Approximations:** this is a heuristic, not a CommonMark parser. Any `N.` line counts as a list item, though CommonMark lets only `1.` interrupt a paragraph, so a wrapped line that starts with `2.` ends a span early. A list marker ends a span at any indent, so a paragraph line indented four spaces or more that starts with `- ` does too (Codex suggested capping every marker at three spaces; the owner chose to keep nested items, 85 of which sit four or more spaces in across the repo's SPECs). The check also never sees a blank inside backticks: the template puts slots there on 12 lines, so an unfilled `` `/<name> demo` `` passes, as it did before this change.
- **Stopping rule:** no backtick rule can be exact, so the heuristic stops here. Later findings about how `hasPlaceholder` pairs backticks are recorded on #91, which proposes a blank marker that written text never uses, found without Markdown parsing. Setext underlines, thematic breaks, HTML blocks and `~~~` fences aren't recognised, and double-backtick spans aren't paired: a span that holds a backtick shifts the pairing for the rest of its block.

- **Why not the issue's rule:** the issue prescribed one line ending at most, and the run's green step used it:

  ```
  /`[^`\n]*(?:\n[^`\n]*)?`/g
  ```

  The refactor step found that it fixes neither spot in the origin file and adds a false positive. A span over two line endings stays in the prose, and its opening backtick pairs with the next one, so every later span in the paragraph shifts. On `mods/issue-forge/SPEC.md` at 94ae284 the original rule finds 15 placeholders, the one-line-ending rule 2 (line 528, from the shift after the span over lines 519–521, and line 929, a span over two line endings), and this rule 0. The SPECs of duet, git-branch and turn-counter read the same under all three rules. Codex's review of PR #85 found the same gap (4287613166), and a second one (4287613176): a span that may cross a line ending, under either rule, also crosses into a heading or list item that follows without a blank line, and hides a real placeholder there. `BLOCK_BREAK` closes that, and no SPEC in the repo reads differently for it. Codex's second round found two more (4287734627, an escaped backtick paired with a later one; 4287734636, a heading or quote indented four spaces ended a span), both closed the same way.
- **Tests:** logic: a span wrapping once, with the `<word>` on either line, is no placeholder; `<files>` in prose before or after such a span, and in plain prose, still is; a placeholder after a blank line that follows an unclosed backtick is found, with or without a later backtick pair. A span over two line endings is no placeholder, and a placeholder after it still is; after such a span, a `<word>` in a later span of the same paragraph is no placeholder either. After an unclosed backtick, a `<files>` in a heading or list item on the next line is still found, with the heading indented three spaces too, and in a list item nested four spaces in. After an escaped backtick, a `<files>` on the next line is found; after an escaped backslash, the backtick opens a span. A heading or quote line indented four spaces stays inside a span. The wrap case fails on 0.2.15; the two-line-ending cases fail on the one-line-ending rule; the block cases fail on the blank-line-only rule; the escape and indent cases fail on c7a55fa.
- **Version:** 0.2.19 in `plugin.json` and the marketplace entry (0.2.16 went to #19, PR #80, and 0.2.18 to #90, PR #93, which merged first; 0.2.17, this PR's first number, is skipped).

## Change 0.2.20 (2026-10-15)

> For issue #92: "there are times a mod will be created in a worktree … use a variable that points to the 'working' folder so mod-lab works", as long as "the end user isn't required to provide a <path>".

- **Cause:** Mod Lab picks its folder from `$.session.cwd()` at every scan and every `lab_report` (`currentModsDir`). On Claude Code 2.1.301, the model's Bash `cd` into a folder under the project moves that value, and a `cd` outside the project resets it (#92's probe). In a repository with worktrees under it, the pane therefore flips between marketplaces mid-build. And a session that stays in the main folder while it edits a worktree by absolute path (this repo's own workflow) reports on the main folder's copy.
- **What changes: the build names its folder, and the session keeps it.** The person types nothing.
  1. **`lab_report` takes `path`**, optional: the absolute path of the mod's folder. `REPORT_SCHEMA` gains it, and `additionalProperties` stays `false`. `Lab.reportOf` normalizes it and refuses a relative path ("path must be the absolute path of the mod's folder."). It also refuses a path whose last segment isn't `mod` ("path must end with the mod's folder name, <mod>."). It returns the folder above it as `dir`. The registered tool's description says to pass `path`.
  2. **A report with `path` pins that folder for this session.** A new atom, `pinned: { modsDir, root } | null`, holds the folder and the project root (`$.session.root()`) read when it was set. The report is handled in that folder, and each report with another `path` moves the pin. `currentModsDir` resolves in this order: the pin, then the `modsDir` option, then the walk (item 4) (pure: `Lab.watchedDirOf`). So the scan, `shownModsDir`, `rerunStale`, the `lab_report` hook and the start log line all follow the pin. A report without `path` lands on the pinned folder when there is one, else as in 0.2.16.
  3. **The person's own move ends the pin.** When `$.session.root()` reads a root other than the pin's, the pin is dropped and Mod Lab follows the walk again. That covers `/cd` and the engine's worktree move, per the d.ts. A Bash `cd` doesn't move the root (#92's probe), so it can't drop the pin. When the root can't be read (a refused call), the pin holds for the session.
  4. **With no pin, the walk starts from the project root.** The marketplace walk starts from `$.session.root()`, not `$.session.cwd()`, so a Bash `cd` before any report (`/modlab` opened by hand, or a mod worked on with no skill) no longer moves the pane. The person's `/cd` and the engine's worktree move still do, since they move the root. When the root can't be read, the walk starts from the working directory, as in 0.2.16. Paths shown in the pane stay relative to the working directory. CI's 2.1.296 has the call: its npm binary defines `root:()=>t("session.root",{})`, the same as 2.1.301's (read from `@anthropic-ai/claude-code-linux-x64@2.1.296`). This item was added at approval, after a side review noted that a pin alone leaves the pre-report case.
  5. **The skills pass it.** Build's step 0.4 and edit's step 0.3 say to pass `path` on every `lab_report`. That is the mod folder's absolute path: `<mods>/<name>` from build's step 0.2, or the folder edit's step 0.1 found.
  6. **Not done:** a `/modlab` command to set or clear the pin (the person never needs a path); Mod Lab moving the session itself (`$.command.run` with `/cd`, unprobed).
- **What gets touched:**
  - Files: `hooks/mod-builder-logic.ts` (`REPORT_SCHEMA`, `reportOf`, `watchedDirOf`), `hooks/register.tsx` (the `pinned` atom, `currentModsDir`, the `lab_report` hook, the tool description), `types/index.d.ts` (`pinned`), both test files, `skills/build/SKILL.md` step 0.4, `skills/edit/SKILL.md` step 0.3, `README.md` (`modsDir` and "What it reaches" rows), `docs/mod-lab.md` (the `modsDir` row), `skills/build/references/gotchas.md` (2.1.301's Bash `cd` probe beside line 230's), this SPEC, and the version in `plugin.json` and the marketplace entry.
  - Engine calls: one more, `$.session.root()`, read-only, wherever the folder is resolved (each scan and report).
  - Not touched: store keys, options, processes, the stages' rules.
  - Runs from before 0.2.20: they have no pin. The walk now starts from the root, which matches the working directory unless the model's Bash `cd` moved it.
- **Tests:**
  - Logic:
    - `reportOf` with `path` gives `dir`: `C:\x\mods\foo` gives `C:/x/mods`, and `/r/mods/foo/` gives `/r/mods`. It refuses a relative `path`, a non-string `path`, and a `path` ending in another name. Without `path` it is unchanged.
    - `REPORT_SCHEMA` has `path`, with `additionalProperties: false` and `required` unchanged.
    - `watchedDirOf`: a pin wins over `modsDir` and the walk when the root is the pin's, or either root is unknown. A changed root drops it. With no pin, it gives what `modsDirFor` gives, and the walk starts from the root when it is known, else from the working directory.
  - UI, a new `describe` with a `session.root` stub in `world()` (it answers the cwd unless a test sets a root, so a test that moves the cwd moves both, as `/cd` does):
    - A report whose `path` is in a worktree, while the session's cwd is in the main folder: the pane lists the worktree's mods with the report running, and Validate runs against the worktree's folder.
    - After that, the cwd moves to a third marketplace and a report without `path` arrives: the pane still lists the worktree's mods, with that report on its row.
    - A new root drops the pin, and the next scan follows the walk.
    - A root that can't be read keeps the pin across a cwd move.
    - With no pin, the cwd moves into a worktree's marketplace while the root stays (a Bash `cd`): the pane stays on the root's mods.
  - Each fails on 0.2.16, except two guards: with no pin, a `/cd` (root and cwd together) still moves the pane, as in 0.2.16; and a root that can't be read leaves the walk on the cwd.
- **Done means:**
  - Run headless from the main folder: a `lab_report` with `path` into a worktree, then a Bash `cd` elsewhere, then a report without `path`. The verbose log shows every scan and both reports on the worktree's `mods`.
  - The same run with no `path` on either report: every scan stays on the main folder's `mods`.
  - `/mod-builder:edit` from a session in the main folder, editing a worktree, lights the worktree's row, with no `/cd` and no path typed by the person.
- **Found while building (advisor review before push):**
  - **A drawing never drops the pin.** The Pane draw reads the folder through `shownModsDir`, which falls back to `currentModsDir` before the first scan has written one. `$.state.set` is refused while a render draws (d.ts), so a drop there would clear the module pin and leave the atom's copy stale. A draw now computes the folder and leaves the drop to the next read outside a render. Test: "a drawing before the first scan leaves a dropped pin to the next read outside a render" (holds the start-up `session.root` reads so the pane draws first). It was written after the guard and checked by mutation: without the guard it fails.
  - **The #10 held-scan tests also run with `path`.** The pin's `$.state.set` comes before the #10/#79 scan in the `lab_report` hook, and the d.ts and `gotchas.md` only say a `get` fixes a dispatch's moment. The two "Spec running arrives while another hook's scan is listing" tests have copies whose reports carry `path`, and both pass, so the edit is still tracked.
  - **Build's step 0.2** says: when the work is in a git worktree the session isn't in, `<mods>` is that worktree's `mods/`. Otherwise the skill would pass the main folder's `path` in exactly #92's case.
  - The test for a pin restored after a reload was also written after green, and checked by mutation (the restore disabled: it fails).
- **Review (PR #95, round 1: the owner's `/code-review` at xhigh, which re-checked Codex's three P2s):** 14 findings, each checked against the code. This round supersedes items 2, 3 and 4 of "What changes" above. The order is now a set `modsDir`, then a confined pin, then the walk. A pin needs a readable root. The walk falls back to the working directory when no marketplace sits above the root. Known limit: `/mod-builder config` checks a kept pin's root but not its marketplace file, so it can name a gone pin as "a build's folder" until the next scan drops it.
  - **Owner decisions:**
    - **`path` is confined:** a report pins only a folder that is a marketplace's `mods/` (its parent holds `.claude-plugin/marketplace.json`) under the session's project root. `lab_report` needs no Bash permission, and a Validate or Test report runs `claude plugin test` on that folder, so an unconfined `path` let a steered model run tests anywhere. A pin therefore needs a readable root. A worktree outside the project needs the person's `/cd`.
    - **A set `modsDir` wins over a build's pin:** while it's set, `path` is ignored and the report is handled there, as in 0.2.16. With `modsDir` empty and a pin kept, `/mod-builder config` shows `a build's folder (<folder>)` in place of `default (…)`.
    - **A malformed or refused `path` no longer refuses the report:** the report is recorded as if `path` were absent, and the reply says `path` was ignored and why.
  - **Fixes:**
    - **Overlapping reports (Codex P2):** each report is handled in the folder its own `path` named, not whatever `pin` holds by the time its awaited write returns.
    - **No marketplace above the root:** the walk then tries the working directory, then the plugin's own `mods/`. A session started in a parent folder (`~`) works again.
    - **The pinned folder is gone:** the pin drops when its marketplace file is gone (a worktree removed after its PR merged).
    - **Same-named mods in two folders:** a row takes a report only when it was made in that row's folder. A report with no folder, from before 0.2.16, still counts.
    - **Windows roots (Codex P2):** two roots on a drive or UNC share are compared without case.
    - **Fewer calls:** an unchanged pin isn't written again, and a set `modsDir` reads no root.
    - **Docs (Codex P2, wider):** `plugin.json`'s `modsDir` description, CLAUDE.md, `docs/use-in-your-project.md`, `docs/troubleshooting.md`, the design prompt, the `pluginModsDirOf` comment and `gotchas.md` say the folder comes from the project root, a build's reported folder, or a set `modsDir`. "What gets touched" above also leaves out the `$.state.set` write and the `plugin.json` description; this round touches both.
    - **Refactor:** one walk shared by `currentModsDir` and `defaultModsDir`. The `modsDirFor` comment no longer says a set `modsDir` "always wins".
  - **Commits (red, then green):**
    - Race: `800d277` / `80cd39a`.
    - `modsDir` wins: `492c96b` (the precedence test changed for the decision), `252bf76` / `cb4ab77`.
    - Confinement, ignored path, gone pin: `adecaed` (three tests changed for the decisions), `28290d0` / `27b8064`. `28290d0`'s gone-pin test mounted the pane twice, so its red was a mount error. `0b8fc62` fixed the test, and a mutation run showed it fails by assertion without the drop.
    - Walk falls back to the cwd: `395cc3c` / `6a2bb84`.
    - Rows by folder: `e915118` / `a9072be`.
    - Windows roots: `6a64f91` / `776d6c0`.
    - Fewer calls: `f458d74` / `f26468b`.
    - Refactor: `9a93659`.
    - Docs: `f6e86d4`.
  - **Follow-up decision (a side review found `tmp/`):** "under the project root" still let a `path` reach community mods kept in the gitignored `tmp/`. `tmp/claude-code` and `tmp/claude-code-mods2` are each a marketplace with a `mods/` folder. The owner chose a rule that replaces it: the folder above `mods/` must belong to the project's own git repository. It can be the repository's top folder or one of its `git worktree`s, inside or outside the project root, so a sibling `git worktree add ../x` works without `/cd`. Mod Lab reads this from the `.git` markers on disk, with no git process. The candidate's `.git` is either a directory (a repository top) or a file whose `gitdir:` names `<common>/worktrees/<name>`. The project root's repository is found by walking up from the root. The two common git folders must match (`pathKey`, so Windows roots compare without case). A nested clone has its own `.git`, a copy has none, and a submodule's `gitdir` points into `modules/`; all three are refused, and so is any read that fails. `.gitignore` can't be the filter, because `scratch/`, where this repository's worktrees live, is ignored too. Known limit (probed, `gotchas.md`): a worktree that Windows git created has a `C:/…` gitdir, which doesn't match when read under WSL. Such a worktree is refused, not misread. Commits:
    - SPEC: `ac94253`.
    - Fixture `.git` markers: `b551ed1` (suite green before any new assertion).
    - Tests changed for the decision: `2413d86`.
    - Red `513200b`, green `ab7af1e`.
    - Docs: `60d395b`, `f200ba3`.
  Live result: a `path` into `tmp/claude-code-mods2/mods/agent-radar` came back `path ignored: …/tmp/claude-code-mods2 isn't the project's git repository or one of its worktrees.`, and this worktree still pins.
  - **Second follow-up (a side review: a hand-written `.git` file):** a worktree pointer now counts only when git's own record names it back. That record is `<common>/worktrees/<name>/gitdir`, which holds the worktree's `.git` path, absolute or relative to the record's folder (probed, `gotchas.md`). This applies to the candidate folder and to the project root's repository. A pointer with no record, or one that borrows another worktree's record, is refused with its own reason (`… has a worktree pointer git has no record of`). This is the faithful reading of the approved "one of its git worktrees", not a new rule.
    - **Threat model, recorded so later notes don't re-derive it:** the folder rule stops a model from being *pointed* at untrusted code already on disk (the `tmp/` case), which Mod Lab would then run with no prompt. It can't stop a model that *writes* files. Such a model needn't forge a worktree: it can put a test into this repository's own `mods/` and report `Test passed`. No file-based check closes that, so the back-link check is kept for correctness and for stale pointers, not as a defence against writes. That residual case is bounded by `claude plugin test`'s sandbox, as `docs/safety.md` describes. On the probed builds, test code has no file system, network or process access, and a looping test is killed at `testTimeoutMinutes`. Whether to ask before automatic runs anyway is #98.
    - Commits: fixture `2f4731f`, red `9173b4c`, green `2c59dcf`. Live: a `.git` file in `scratch/gitprobe-92/forged` naming this repository's `.git/worktrees/forged` (which doesn't exist; nothing was written into `.git/`) came back `path ignored: …/forged has a worktree pointer git has no record of.`, and this worktree still pins.
  - **Interactive check ("Done means" 2), passed at `04a1a0e` on 2.1.301:** a session in the main folder, with this branch's mod-builder, ran `/mod-builder:edit turn-counter` on a throwaway worktree edited by path. The skill's first `lab_report` carried `path` without being asked. The pane switched from `…/ClaudeMod/mods` to `…/modlab-live-92/mods` and lit `turn-counter ◐ editing: band says "turns"`. It stayed there through the model's Bash `cd` into the worktree and back out.
  - **Not changed, process:** the reload test (`f273e27`) and the draw guard's test (`4ab53d4`) were written after their code. Each was checked by mutation, but neither had the red run the repo's TDD rule asks for. Every fix in this round starts red.
- **Version:** 0.2.20 in `plugin.json` and the marketplace entry. This change was drafted as 0.2.18. PR #93 (#90) merged first with 0.2.18, and PR #85 (#20) with 0.2.19. Merged from `main` after each: after #93, only the README rows, `docs/mod-lab.md` and this SPEC conflicted; after #85, only the version and this SPEC.

## Change 0.2.21 (2026-10-15)

> For issue #75: an edit that only deletes or renames a logic or test file left the Logic stage stale (Codex's comment on PR #72, discussion_r4286298437).

- **Bug, fixed:** during an edit, Logic counted as redone only when a logic or test file had an mtime at or after the edit's start (`logicMtimeMs`). A delete leaves no file to carry a new mtime, and a rename keeps the file's old one. Validate and Test still went stale and re-ran, because the code signature names every file, so the mod never reached "ready to share" unless some other logic or test file was saved. Top-level files behaved the same on `main`.
- **Rule:** `Lab.factsOf` adds `logicSig`, a signature of the same logic modules and test files that `logicMtimeMs` reads (top-level `hooks/` and `tests/`, and nested ones: `code` filtered by `Lab.isLogicOrTestPath`, which was `isNestedLogicOrTest`), each as `path@mtime` with the path from the mod folder. When a `Spec running` report starts an edit, the hook reads the mod from disk (`modFactsOf`) and the generation stores its `logicSig` with `fromVersion` (`Generation.logicSig`). `lightsOf` and `viewOf` take the generation as one `Lab.Edit` (`{ since, fromVersion, logicSig? }`), and Logic is redone when `logicMtimeMs` is at or after the start, **or** when the stored `logicSig` differs from the current one. A file removed, renamed, moved or added changes it; so does a saved one, which `logicMtimeMs` already counts. `register.*`, `.d.ts`, data files, `types/` and helpers under `tests/` are not in it.
- **A folder that can't be listed:** `$.fs.list` failures read as an empty folder, which for `logicSig` would look like a delete. `modFactsOf` names each folder it couldn't list (`FolderRead.unlisted`), and when one is `hooks/`, `tests/` or under them, `logicSig` is null: unknown. A null baseline or a null current signature shows no change, so the edit keeps the mtime rule for that scan or, for a null baseline, for the whole edit. The code signature is unchanged.
- **Unchanged:** a generation stored before this change has no `logicSig` and keeps the old rule. An edit that removes the last logic module or the last test file still reads `◌` pending, since `hasLogic` and `hasTests` are checked first. A repeated `Spec running` keeps the generation's start, `fromVersion` and `logicSig`, and records the mod on disk as it lands (`repeatedFrom`). A scan that read the edit before that repeat and finds it finished begins the next edit at the repeat, from `repeatedFrom`; a repeat written by a session on 0.2.20 or earlier has none, and the next edit takes that scan's facts. Outside an edit nothing changes.
- **What the baseline can't tell:** the report starts the edit before the skill changes any file, so the read at the report is the mod as the edit began. A file changed outside Claude after the report counts as part of the edit, as a saved one always has. If the folder or manifest can't be read at the report, `fromVersion` and `logicSig` fall back to the last scan's facts.
- **Declined, folder mtimes:** the other way Codex suggested. Deleting or renaming bumps its folder's mtime, but so does any save that writes a temp file and renames it into place, so a save to `register.tsx` alone could mark Logic redone.
- **Tests:** logic: `logicSig` changes when a top-level or nested logic module or test file is removed, renamed with the same mtime, moved or added, and doesn't for `register.*`, `.d.ts`, data files, `types/` or helpers under `tests/`; `lightsOf` with every logic mtime older than the start gives Logic `passed` for a differing generation `logicSig` and `stale` for the same one, none stored or none passed, and the other stages are as they were. UI ("an edit that only deletes or renames a logic or test file"): deleting `hooks/lib/parser.ts`, a top-level `tests/*.test.ts` or a top-level logic module, and renaming a nested file, each with SPEC, README and the manifest bump saved, reach "ready to share", also when a second `Spec running` comes after the file is gone. They fail on 0.2.19.
- **Review of PR #97, round 1** (a `/code-review` at xhigh, 7 findings; all fixed):
  - The baseline came from the last scan, of any age, so a logic or test file saved after it and before `Spec running` was credited as the edit's Logic redo; the scan that ends an edit and begins the next used facts that may predate the repeat. Now read from disk at the report, and at a repeat (`repeatedFrom`). Fix `f9721c5`.
  - A transient listing failure read as a delete. Now `logicSig` is null for it. Fix `b8bcff2`.
  - The `factsOf` tests failed the typecheck (4 × TS2322: `file`/`dir` inferred file-only lists). Typed as `Entry`, `d8712e3`.
  - The `logicSig` in the branch where a scan begins the next edit had no test: a guard test, checked by removing the field (1 of 247 fails), `1e9d89a`.
  - `lightsOf`'s `fromLogicSig` was a third positional beside `fromVersion`, of the same type: one `Lab.Edit` record now, `52775ae`.
  - The logic files were picked by three filters that had to agree with `code`'s: `code.filter(isLogicOrTestPath)`, `153b60f`.
  - #95 took 0.2.20 too; it merged first, so this is 0.2.21 (merge `a37636f`).
- **Tests (review round 1):** logic: `logicSig` is null when `hooks/`, `tests/` or a folder under them couldn't be listed, and unchanged for other folders; a null current `logicSig` keeps Logic stale unless a logic file was saved since the start. UI: a logic file saved after the last scan and before the report, or before the repeat that begins the next edit (after that scan read the folder), doesn't redo Logic; a folder under `hooks/` that can't be listed as the edit begins, or during it, doesn't either; the next edit begun by a scan's end that only deletes a nested file reaches "ready to share" (a guard), also from a 0.2.20 repeat without `repeatedFrom`. Each fails by assertion on the commit before its fix.
- **Version:** 0.2.21 in `plugin.json` and the marketplace entry. This change was drafted as 0.2.20; PR #95 (#92) merged first with it. Merged from `main` after it: only this SPEC conflicted.

## Change 0.2.22 (2026-10-15)

> For issue #31 (with duet 0.2.13 and issue-forge 0.6.0, one PR): a bare `/modlab` closed its pane when the pane was open as a tab behind another pane. The rule lived in the build skill's house rule and its `pane-command` archetype, so every pane mod the skill builds had it.

- **Bug, fixed:** with more than one plugin pane open, the panes share one frame and only one is shown. `/modlab` folded Mod Lab whenever it was shown by `isPaneShown` (listed and placed), including when it sat hidden behind another tab, so a person who typed the command to see the pane lost it. Nothing told the person how to reach a pane behind another tab either: the hint said `ctrl+x tab, then …`, true only for the first tab.
- **Rule:** the pure `paneAction(panes, id)` in `mod-builder-logic.ts` (and in the archetype's `logic.ts.tpl`) answers `open` (no entry with that id), `close` (an entry with `isShown: true`) or `show` (an entry with `isShown: false`). `/modlab` passes it `$.ui.panes()` filtered to placed panes: a pane waiting undrawn (an unasked open on a narrow terminal) is open but not placed, is no tab behind another, and is opened as before (the PR #93 guard test). `close` folds, with today's answer. `open` opens, with today's answer. `show` answers `Bringing Mod Lab to the front; it takes the keyboard if your prompt is empty (Esc gives it back).` at once and, from the detached `bringToFront`, calls `$.ui.open({ id, title, columns, focus: true })`. The call goes out before the hook returns (#90); only its result is not awaited. A re-read of `$.ui.panes()` 500 ms later toasts `Mod Lab is still behind another tab: ctrl+x tab, then again until it shows.` when the pane's `isShown` is still false, for example because a dialog refused `focus`.
- **Probe 1a is not run yet:** whether `isShown` is already true when `await $.ui.open(…)` returns is not verified. The 500 ms re-read is right either way (no toast when the pane did come forward), so it is the code until a probe settles it; `gotchas.md` says so and records no probe result.
- **The keyboard is taken only on an explicit request:** `/modlab`'s `show`, `/modlab demo` and `/modlab <mod>` when the pane is listed, placed and not shown (they keep their answers, state updates and selection, and open with `focus: true`, with the same toast). A pane that is not listed, or is shown, opens as before. `lab_report`'s `autoOpen`, the typed `/mod-builder:build` and `/mod-builder:edit`, and every other open never pass `focus`.
- **Hint:** `ctrl+x tab (again: next tab), then <keys> · esc to leave`. It holds for any tab and any count; that the keys go back to the prompt after the last tab is in the READMEs and the hand-off.
- **Build skill and template:** `conventions.md` replaces the "check the pane is open" rule with the three-state rule and adds two house rules (take the keyboard only on an explicit request; a pane hotkey that stops, publishes or deletes asks first, the typed command stays immediate; read-only hotkeys such as duet's `r` and Mod Lab's `t`/`v` are left as they are, on purpose). `SKILL.md` step 5.3 gains a hand-off bullet on reaching the pane. `README.template.md` gains a comment, replaced in step 5.1, for pane mods. `ui-states.md` gains the hotkey note on the Focus row and a note, not a row, that a pane behind another tab isn't drawn. `gotchas.md` amends the `ctrl+x tab` entry (it toggles only with one pane) and adds `[probe]` entries for the tab strip, the keys, re-opening and `pane:next`/`pane:previous`, and a `[d.ts]` entry for `isShown` and `focus`, from the issue's observations (2026-10-13, 2.1.296). The `pane-command` archetype gets `paneAction` in `logic.ts.tpl` and its test, the three-state command in `register.tsx.tpl`, and `ui.test.tsx.tpl` stubs `ui.panes`, `ui.close` and `ui.toast`, and tests each state, the demo and the toast.
- **Tests:** logic: `paneAction` for no entry, a shown entry, a hidden entry, and other entries shown or hidden. UI: a bare `/modlab` with the pane hidden answers at once, opens with `focus: true` and closes nothing; by pane state (not listed opens plain, shown folds, hidden is brought forward, and `autoOpen` stays plain); the toast when the pane stays behind, none when it came forward; `/modlab demo` and `/modlab <mod>` likewise; the new hint.
- **Not done here:** `docs/assets/modlab-live.svg` still shows the old hint line. It is a real capture, so it is regenerated from a live pane, not edited. The live checks of the issue (steps 1 to 5) and probe 1a need an interactive session.
- **Version:** 0.2.22 in `plugin.json` and the marketplace entry. This change was drafted as 0.2.21; PR #95 (#92) merged first with 0.2.20 and PR #97 (#75) with 0.2.21. Merged from `main` after each: after #95, only the version, this SPEC and the logic test file conflicted; after #97 and #88, only the versions, this SPEC, issue-forge's SPEC and its `ui.test.tsx`.
- **PR #96 review round 1 (2026-10-15):**
  - **An unplaced pane is no tab behind another (Codex P2, 4290113920):** `$.ui.panes()` lists a pane whose open was not placed (an unasked open on a narrow terminal, or every row while an open answers `no-surface`) with `isPlaced: false` and `isShown: false`, and `paneAction` took it for `show`. A bare command then asked for the front (the `focus` path and a false "still behind" toast) and skipped `openPane`'s narrow-window toast; Mod Lab alone filtered to placed panes at the call site, and the `pane-command` archetype, which every new pane mod is built from, did not. `paneAction` now takes `isPlaced`, as every `UiPane` row has it, and finds only a placed row, so an unplaced pane is `open`. Commits: fixture `13b354d` (rows carry `isPlaced`), red `bd96ec8`, green `3d2b3ed`; refactor `246c907` drops Mod Lab's call-site filter, and `9560501` makes `conventions.md` say to pass `$.ui.panes()` whole. The template's red run is `check-archetypes.sh` exiting 1 with 3 pane-command failures at `bd96ec8`.
  - **Merged from `main`** at `15ba68f` (PR #95, mod-builder 0.2.20): only the mod-builder version, its SPEC and `mod-builder-logic.test.ts` conflicted.
  - **Codex round 2, 4290452262 (fixed):** the demo opened its pane after awaited state writes in a detached block, so the open (with `focus` behind another tab) went out after the command hook returned and was unasked. The `pane-command` template's demo now awaits `openOrFront` in its hook, then writes the demo items detached (duet and issue-forge likewise; Mod Lab's demo already opened in its hook). Red `b2233d8` (with every state write held, the open must already be recorded when the command answers), green `d758747`.
  - **A headless session can hold an unplaced pane:** the live check (two bare `/duet` in one `claude -p --input-format stream-json` session, 2.1.301) shows the pane listed with `isPlaced: false` after the first open, inferred from the answers (`gotchas.md`). The PR #93 note above ("a bare `-p` run places every pane and never answers `isPlaced: false`") was read from the d.ts, not probed, and does not hold for that session.
  - **Codex round 3, 4290573678 (owner's decision):** the `show` answer said "it has the keyboard", but `focus: true` is a request the surface grants only while the prompt has the keys over an empty composer. It now says `… to the front; it takes the keyboard if your prompt is empty (Esc gives it back).` (quoted above as changed). No `isFocused` check: its timing after a granted focus is unprobed. Red `3c6049b`, green `f5f2596`.
  - **Left for follow-ups, not fixed here:** the 500 ms `isShown` re-read is still unprobed (probe 1a); Mod Lab's `isPaneShown` ("listed and placed") still decides the typed build/edit open, so a placed pane behind another tab is left there silently; Mod Lab's hint puts `(again: next tab)` before the keys, so truncation cuts `esc to leave` first.

## Change 0.2.24 (2026-10-16)

> For issue #100, the owner's decision (2026-10-16): "option 1, rescan after Claude's tools finish", with conditions: "1. Probe first, headless, with a throwaway mod that counts classic.PostToolBatch firings for the main loop's tools; record the result in gotchas.md with [probe] and the build. 2. "Watched mods folder" means the folder Mod Lab is tracking now, including a lab_report path into a worktree. The field case was a rebase in scratch/<name>/mods, not the project's mods/. A filter on the default folder alone misses it. … 4. Pane redraw only. No Validate or Test run starts from this event, so it doesn't widen #98. Tests as listed in the issue: in-folder write rescans, out-of-folder write doesn't, two writes in one batch scan once." Condition 3, revised after a probe (below): "option 1, per-mod rescan, stats after Bash. Folder mtimes miss in-place edits, which is what the Write tool does, so my condition 3 was wrong as written. One thing to add: The Bash comparison lists each mod's files with stats, no reads. Keep it to the files Mod Lab judges (hooks/, tests/, SPEC.md, README, manifest) rather than a full recursive walk, and fall back to a full rescan of that mod when the list itself changed (add or unlink)."

- **Why:** during a long turn, the pane showed the last scan. Edits, a rebase or a scaffold didn't show until a report, a typed `/modlab` or the turn's end (#100; the owner saw it twice on 2026-10-16).
- **Probes this rests on** (2026-10-16, Claude Code 2.1.301):
  - **`classic.PostToolBatch` reaches a hooks module** for the main loop's tools. Headless `claude -p --plugin-dir <throwaway mod>`, which logged each event: two parallel Bash calls gave two `PostToolUse` events, then one `PostToolBatch` with `["Bash","Bash"]`. The next message's Write gave its own `PostToolBatch` `["Write"]`, though the headless classifier refused that Write (no `PostToolUse`).
  - **The test kit raises it:** `$.classic.PostToolBatch({ tool_calls })` reaches the hook, and `next(e)` resolves to the test's own `on('classic.PostToolBatch', …)` answer (without one, "nothing beneath the plugins answers classic.PostToolBatch").
  - **`claude plugin validate`** warns, for a hooks module that hooks `classic.*` events: "hooks on classic.PostToolBatch, classic.PostToolUse do not run in a plugin a person installs where an organization manages Claude Code: there, these events pass over the plugins you install, and only a plugin the organization lists in managed settings runs them".
  - **Folder mtimes** (condition 3's first form, `/mnt/c`): a script wrote `hooks/x-logic.ts`, then rewrote it. In place, the file's mtime moved and the folder's didn't. A temp file renamed over it moved the folder's. That Claude's Write tool writes in place is the owner's statement, not probed.
- **What changes:**
  1. **The hook.** `on('classic.PostToolBatch', …)`, with `.catch`. It starts the work detached (`void rescanAfter($, e.tool_calls).catch(…)`, as `turn.complete` starts `rerunStale`) and returns `next(e)` at once. It fires before the next model request, so it never waits on the disk.
  2. **Which calls count** (pure, `Lab.batchTouch(toolCalls, modsDir)`). Edit, Write and NotebookEdit, whose path (`file_path`, or `notebook_path`; one map, as issue-forge's `EDIT_PATHS` is) lies under the watched folder, name the mod: the path's first segment under it. The watched folder is `currentModsDir`: a set `modsDir`, else a pin a report set (a worktree's `mods/`), else the project's `mods/`. A file directly in the mods folder names no mod. Bash marks the batch as shell. Every other tool is ignored, and a batch with nothing that counts does nothing.
  3. **A per-mod rescan.** `scan` takes one merged request, `{ isFull, isQuick, mods }`. A full request reads every mod, as today. `mods` reads only the named mods (`modFactsOf`) and keeps the last scan's facts for the rest. A quick request runs the check in 4. Requests that come during a scan merge into the next pass: full wins, `isQuick` ORs, `mods` unions. It escalates to a full read when:
     - the last scan read another folder (`published.modsDir`), or there was none;
     - a named mod isn't in the last scan (a Write that makes a new mod's first file);
     - the mods folder's own listing of folders differs from the last scan's mods (a mod added or removed).

     Judging, fresh marks, done stamps and generations run as any scan's do.
  4. **The quick check, after a Bash batch.** For each mod of the last scan, it lists the mod's folder, `hooks/`, `tests/` and `.claude-plugin/`: stats only, no file reads, no nested walk. `Lab.quickSigOf` takes those four listings and gives a signature: `name@mtime` of `SPEC.md`, `README.md`, each entry directly in `hooks/` and `tests/`, and `.claude-plugin/plugin.json`. `Lab.factsOf` computes the same from the listings it already has, as `FileFacts.quickSig`, so both come from one function. A mod whose signature differs is read again (`modFactsOf`), and that includes a list that changed (a file added or removed). A listing that fails counts as moved: can't tell isn't unchanged (as 0.2.21 treats `logicSig: null`).
  5. **No runs.** Nothing on this path calls `runInBackground` or `rerunStale`: no Validate or Test starts from a tool batch (#98). Runs stay on reports, presses, the turn's end and the commands. The scan announces as the tick's and a report's do (`isAnnounced: true`). `announceGreen` stamps a mod done before it checks the flag, so an unannounced scan would leave a newly green mod untoasted for good.
  6. **Where an organization manages Claude Code**, `classic.*` hooks don't run for installed plugins (validate's warning above). There the pane keeps today's triggers.
- **Not seen by the quick check:** files in nested folders, `types/`, `agents/`, `commands/` and `skills/`. A Bash change there shows at the next report, command, press or turn end. An Edit, Write or NotebookEdit anywhere in a mod is seen (its mod is read in full).
- **What gets touched:** `hooks/register.tsx` (the hook, `rescanAfter`, the merged scan request, the quick check), `hooks/mod-builder-logic.ts` (`batchTouch`, `quickSigOf`, `FileFacts.quickSig`), both test files, `README.md` (when the pane refreshes; "What it reaches" from validate, gaining the `classic.PostToolBatch` hook and its managed-settings warning), `docs/mod-lab.md`, `skills/build/references/gotchas.md` (the probes above, `[probe]` 2.1.301), this SPEC, and the version in `plugin.json` and the marketplace entry. No atom, store key, option, process, network or write reach is added. Costs: per Bash batch, four listings per mod in the watched folder, detached and single-flight. Per Edit, Write or NotebookEdit batch under the folder, one mod's full read.
- **Tests.** Logic:
  - `batchTouch`: an in-folder Edit, Write or NotebookEdit names its mod; one outside the folder, or a file directly in it, names none; Bash marks shell; a Windows-style path is normalized; a pinned worktree folder counts, and the project's `mods/` doesn't while the pin holds.
  - `quickSigOf`: it changes for an mtime of `SPEC.md`, `README.md`, a top-level `hooks/` or `tests/` file or the manifest, and for a file added or removed there. It doesn't change for `types/`, nested files, `agents/`, `commands/` or `skills/`. `factsOf`'s `quickSig` equals `quickSigOf` of the same listings.

  UI, each raising `$.classic.PostToolBatch`:
  - an in-folder Write whose file's mtime moved shows the change in the next settled render, with no `turn.complete` and no report;
  - a Write outside the watched folder lists nothing under it;
  - two Writes to one mod in one batch read that mod once;
  - a Bash batch with nothing moved reads no file;
  - a Bash batch with one mod's `SPEC.md` mtime moved reads only that mod;
  - a file added under `hooks/` reads that mod;
  - a new mod folder reads every mod;
  - with a worktree pinned by a report, a Write there rescans, and a Write to the project's `mods/` doesn't;
  - no `claude plugin` process starts from a batch;
  - a batch that lands during a scan gets one more pass;
  - a listing that fails in the quick check reads that mod;
  - a rescan while a `lab_report` `running` placeholder is shown keeps the placeholder and its timer (the owner's addition at approval).
- **Done means:** during a long turn, the pane shows edits as each batch of Claude's tools finishes, in the folder Mod Lab watches, a reported worktree included, with no extra Validate or Test runs.
- **Version:** 0.2.24. PR #108 (#98) has 0.2.23 and touches this SPEC, `gotchas.md` and both version fields too. Whichever merges second merges `main` in and takes the next free version (approved by the owner on 2026-10-16: "option 1 - approved").
- **PR #109 review round 1** (a `/code-review` at xhigh and Codex's four threads, on `c9098b6`, 2026-10-16). **The owner's decision on which tools count:** "option 2, all but read-only tools. Option 1 is a new allowlist that goes stale the next time a tool appears, which is the problem the finding just exposed. Option 2 is stale-safe: an unknown tool runs the quick check, and the quick check is stats only, so the extra cost per turn is listings, not reads." Condition: "Keep the read-only list in the logic file with a unit test, and add AskUserQuestion and the mod-builder lab_report tool to it. A batch is skipped only when every call in it is on the list; one unlisted call runs the quick check once for the batch, not once per call." This replaces item 2's "Every other tool is ignored": Edit, Write and NotebookEdit still name their mod, and a path outside the folder still counts for nothing. Every tool not on the read-only list (Read, Grep, Glob, WebFetch, WebSearch, TodoWrite, AskUserQuestion, `mcp__mod-builder__lab_report`) runs the quick check, Bash, PowerShell, Agent and MCP tools included.
- **Fixed (review round 1):**
  - **Which tools count** (the owner's decision above): `READ_ONLY_TOOLS` and `isReadOnlyBatch` in logic. `batchTouch`'s `isShell` became `isQuick`. Red `89ebeba`, green `2987f18`.
  - **Paths:** drive and UNC paths compare without case, through `pathKey` (Codex 4296025366); an Edit of the marketplace runs the quick check (Codex 4296025346); `.mcp.json` joins `quickSigOf`. Same commits.
  - **A read-only batch** returns before `currentModsDir`, so it reads no session root. **A moved marketplace**, stat'd by every listing pass, reads every mod (Codex 4296025346). **Every listed folder**, a mod or not yet one, has a quick baseline (`folderSigs`, by path, written by `modFactsOf`), so a folder that becomes a mod in a Bash batch is read (Codex 4296025357). **A partial pass whose mods-folder listing failed** skips instead of clearing the rows and the picked mod. Red `8addde0`, green `66e3d66`.
  - **The mid-scan batch test** releases its held listing in a `finally` (`8addde0`). A new test covers the announce path from a batch: a mod made green by a batch notifies once, and an unchanged batch adds nothing.
  - **Refactor:** the quick check runs every folder at once (`hasMoved` with `Promise.all`), and it and the full read list the quick folders through one `quickFoldersOf`. `eb14b80`.
- **Build notes (review round 1):**
  - The escalation compares `scannedFolders` (the folder, its folder names in order, and the marketplace's mtime), not `published` as item 3 says. `published` is written after judging and holds the mods, not the folders, so a folder that isn't a mod would be missing from it.
  - **Declined (Codex 4296025373):** resolving a relative `file_path`. Edit, Write and NotebookEdit take an absolute path by their schema, so a relative one fails, and nothing changes on disk to rescan.
  - **Not changed:** the announce flag. A mod made green mid-turn notifies then, and a second notification after a later code change, re-run and green again is a real second event, as with a report's scan.

## Change 0.2.25 (2026-10-16)

> For issue #98, the owner's decision (2026-10-16): "option 1, canary test in the suite", with conditions: the canary asserts dynamically, never by a top-level import; "The vectors it checks must be the exact list in gotchas.md "Testing and checking", so the canary and the docs make one claim"; and "State the gap in docs/safety.md: the canary runs only when CI bumps the pin or I run `claude plugin test plugins/mod-builder`. It does not re-check my installed build after a Claude Code update by itself." Condition 1, revised after the probe below: "option 1, globals plus no code from strings. A canary can't assert its own file refuses to load, and eval and [the Function constructor] throwing closes the runtime route to import(), so asserting both is the strongest claim a test can make. … Record the loader refusal in gotchas.md as [probe] 2.1.301 with the exact text "(fail) the file did not load", and say in docs/safety.md that the canary doesn't cover it. If a later build starts loading such files, the canary's [eval and Function constructor] checks are the only runtime signal, so keep them." The per-build canary from Mod Lab is #107, not this change.

- **Why:** Mod Lab runs `claude plugin validate` and `claude plugin test` with no prompt, on a skill's `lab_report` and, with `autoRerun` (on by default), at the end of each turn. That is safe only while `claude plugin test`'s sandbox holds, and nothing re-checks it after a Claude Code update (#98).
- **The probe this rests on** (2026-10-16, Claude Code 2.1.296 and 2.1.301, the same result on both; a throwaway plugin in the session scratchpad with a minimal `hooks/register.ts`, one `tests/*.test.ts` per case, `claude plugin test .`):
  - `process`, `Bun`, `Deno`, `require`, `fetch`, `WebSocket`, `XMLHttpRequest` and `Worker` are `undefined` (gotchas.md's list).
  - A test file holding `import()`, or a top-level `import … from 'node:fs'`, is reported `(fail) the file did not load` (the reasons: "a dynamic import(); …" and `cannot import "node:fs" …`). It counts as a failure, and the run exits 1.
  - The global eval, given a string, and the `Function` constructor both throw `Code generation from strings disallowed for this context`. `typeof` the global eval is `function`.
- **What changes:**
  1. A new test file, `plugins/mod-builder/tests/sandbox.test.ts`, the canary. Its one `describe` holds two tests. One reads each name in gotchas.md's list from `globalThis` and asserts every one is `undefined`. The other asserts that the global eval on a string, and the `Function` constructor on a string, each throw. It has no top-level import but `claude-code/testing`, and no `import()`. The file's name doesn't end in `-logic.test.ts`, so the repository's coverage command and the node-run logic tests (which glob `*-logic.test.ts`, where `process` exists) never run it. `claude plugin test plugins/mod-builder` runs it, in CI on the pinned build and locally on whatever build runs the suite.
  2. A comment in the canary names gotchas.md's list as its source. The gotchas.md entry names the canary file. A change to either list is made in both.
  3. `gotchas.md` "Testing and checking": the sandbox entry gains the probe above as `[probe]` 2.1.296 and 2.1.301, with the exact text `(fail) the file did not load`, and the code-from-strings result. It says `tests/sandbox.test.ts` asserts the globals and code from strings, and that the loader's refusal can't be asserted from inside a test, since a test can't check that its own file didn't load.
  4. `docs/safety.md`: the bullets name the 2.1.301 re-probe and the canary. A new paragraph states the gap: the canary runs only when CI runs (on the pinned build, so a pin bump checks the new pin) or when someone runs `claude plugin test plugins/mod-builder`. It doesn't re-check the installed build after a Claude Code update by itself (#107), and it doesn't cover the loader's refusal of `import()` and `node:fs`. If a later build starts loading such files, the code-from-strings checks are the only runtime signal.
- **No behaviour change:** Mod Lab, the skills and the templates run as before. The canary is a test.
- **What gets touched:** `plugins/mod-builder/tests/sandbox.test.ts` (new), `skills/build/references/gotchas.md`, `docs/safety.md` (repository root), this SPEC, and the version in `plugin.json` and the marketplace entry. No process, file or network reach is added: the canary runs only inside `claude plugin test`. Cost: two tests, milliseconds.
- **Tests (the canary is the test):** the two tests above pass under `claude plugin test` on 2.1.301, and in CI on 2.1.296. **Red:** the same file run under node through the coverage kit (`node --import <kit> --test plugins/mod-builder/tests/sandbox.test.ts`), where every vector is open, fails both tests by assertion, which shows the canary catches access. No production code changes, so there is no green commit beyond the test.
- **The security hook:** the security-guidance plugin's PreToolUse hook blocks the first Write of a file holding the eval call or the `Function` constructor, once per file and pattern per session, then lets the same write through (`security_reminder_hook.py`). The canary's use is deliberate: it asserts that both throw.
- **Done means:** `claude plugin test plugins/mod-builder` shows the canary passing; a build whose test sandbox gains any listed global, or allows code from strings, turns the suite red in CI or in the person's run; `docs/safety.md` says exactly what the canary does and doesn't check.
- **Version:** 0.2.25 (patch: a test, a CI check and docs). Drafted as 0.2.23; PR #109 (#100) merged first with 0.2.24, so `main` was merged in and this took the next free version. Only the versions and this SPEC conflicted.
- **PR #108 review round 1** (a `/code-review` at xhigh, 2026-10-16; Codex found nothing on `5216ae4`). Re-probed on 2.1.296 and 2.1.301 the same:
  - A bare `typeof require` reads `function` (the transpiler folds it), while `globalThis.require` is `undefined`, and calling `require('node:fs')` throws `ReferenceError: require is not defined`. So the canary's `require` entry, read from `globalThis`, could never fail.
  - The `Function`, async function, generator and async generator constructors all throw `EvalError: Code generation from strings disallowed for this context`.
  - **A correction to condition 1's reasoning:** the loader's refusal of `import()` and `node:fs` files and the code-from-strings switch are independent. A build that loaded such files would leave both canary tests green, so the code-from-strings checks are no signal for that.
- **The owner's decision on the loader** (2026-10-16): "option 2, the CI loader check. The loader refusal is the main way a test would reach the file system, so a canary that only checks globals and eval leaves the one vector that matters to a re-probe nobody runs. A fixture in CI closes it on the pinned build, and the local suite still covers the rest." Conditions: "1. The fixture plugin must not live under plugins/ or mods/, or CI's matrix and `claude plugin test` pick it up and go red. Keep it as .tpl files next to the build skill's scripts and have the script scaffold it into a temp dir, as check-archetypes.sh does. 2. The script compares the canary's list with gotchas.md's, so when either changes CI says which. Add the step to ci.yml and the template together, run the archetype check, and say in docs/safety.md that the loader is checked in CI on the pinned build only; a local build still needs `claude plugin test` plus a re-probe (#107)."
- **Fixed (review round 1):**
  - The canary calls `require` and asserts `ReferenceError`. Code from strings has one test per route (eval, `Function`, async, generator, async generator), each asserting `EvalError`, so one failure doesn't hide the next. `4aa7212`.
  - `check-sandbox.mjs` (the owner's CI loader check), with unit tests: red `d777b3a`, green `598e4ae`. The fixture is `.tpl` files in `scripts/sandbox-fixture/`. A control test must pass, and the `import()` and `node:fs` files must each read `(fail) the file did not load`. It also fails when the canary's list and gotchas.md's differ, naming which. CI and the template gain the step together: `672308b`.
  - Docs, `8081ba2`:
    - gotchas.md folds the two sandbox bullets into one, with the "(the canary's list)" sentence the script reads;
    - `docs/safety.md` fixes the verbless bullet and gives the checks their own paragraph: the loader is checked in CI on the pinned build only;
    - CLAUDE.md says a `.test.ts` not named `*-logic.test.ts` runs only under `claude plugin test`.
- **Not taken:** pinning the code-from-strings message. The error class (`EvalError`) is pinned instead: the message is the engine's wording, the class is the claim.
- **Codex round 2 (on `ca8315f`):** the `import()` fixture imported `node:fs` by name, so a loader that allowed `import()` but refused that name would still have read as refused. It now builds its specifier at run time (Codex 4296355708). A run cut short by an error or a signal, or one that exited 0, could still have passed on partial output; `runVerdict` fails it (Codex 4296355718). Red `8d8bb18`, green `7713be0`.

## Change 0.2.27 (2026-10-21)

> For issue #119, the owner's decisions (2026-10-21): "File one issue, then fix", with the build skill's conventions and archetype templates first, then duet, issue-forge and Mod Lab; `immediate: true` on "/modlab + /git-branch", with `/duet`, `/issue-forge` and `/mod-builder config` waiting for the turn. The full decisions are in #119's first comment.

- **Why:** Anthropic's mod docs (`docs/research/Mods/`, PR #120) describe four practices the build skill didn't teach: seeding atoms again after `/clear`, `/resume` and `/branch`; passing `next.signal` to long work a hook waits on; handling `$.prompt.submit`'s `{ drop }`; and `immediate: true` for a command that may run mid-turn.
- **The probe this rests on** (2026-10-21, Claude Code 2.1.296, installed as CI does, and 2.1.306; a throwaway mod in the session scratchpad, run headless with `claude -p --input-format stream-json`, a throwaway `CLAUDE_CONFIG_DIR` and a placeholder key, so no model call):
  - `$.command.register({ …, immediate: true })` resolves `{ command }` on both, and the command runs.
  - `on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, …)` loads, and validate lists it as a gating hook without `.catch`.
  - An atom set to 42 in `session.start` reads 0 after `/clear`, and 0 inside the `classic.SessionStart` hook, which fired with `source: 'clear'`.
- **What changes:**
  1. `references/conventions.md`:
     - State: the `/clear` rule, with the `classic.SessionStart` hook and its `.catch`, and why the archetypes' atoms are right to reset.
     - Hooks: `next.signal` for long work a hook waits on: the engine ends a waited `$.process.spawn` on abort, so the `catch` records a stop and starts no fallback. `$.prompt.submit`'s `{ drop }` is treated as a failure.
     - Commands: when to set `immediate: true`. Every branch only shows something: it opens, closes or fronts a pane, shows or hides the drawing, fills the prompt box, or reads. The wording covers `/modlab` (#119 step 4): `new` fills the prompt box, and `<mod>` reads the mods folder and fronts the pane.
  2. `references/gotchas.md`: the probe above, as two `[probe]` entries, and a third from the Esc probe on 2.1.306 (#119's gap 2 comment). A waited spawn is killed and its loop throws `… aborted`, a `$` call after that rejects, and a `void` spawn survives.
  3. `templates/SPEC.template.md`: HOUSE rows "mid-turn" and "after /clear". Mod Lab's `slotsOf` reads only `archetype` and `built` by name (`hooks/mod-builder-logic.ts:1180-1181`), so nothing else changes.
  4. The pane-command archetype registers its command with `immediate: true`. Every branch opens, closes or fronts the pane, or fills it with demo items. The other archetypes leave it off:
     - Band's demo writes the per-turn `turn` atom, which its own `tool.call` and `turn.complete` hooks write too.
     - Guard's demo asks a question, which would compete with the turn's own.
     - Watcher's `reset` changes what it counts.
     - Command-only records and clears notes.
- **Not changed:**
  - No archetype gains a `classic.SessionStart` hook. None copies anything into atoms at `session.start`, and their atoms count this conversation only.
  - Mod Lab's own commands are #119's later step.
- **What gets touched:** the two references, the SPEC template, the pane-command archetype's `register.tsx.tpl` and `ui.test.tsx.tpl`, the band archetype's `ui.test.tsx.tpl` (a test that its command waits), this SPEC, and the version in `plugin.json` and the marketplace entry. No new reach.
- **Tests:** the pane-command template's UI test records the `command.register` call and expects `[['<name>', true]]`.
  - **Red** `8ea387e`: scaffolded, it fails with `Received [["check-pane", undefined]]`.
  - **Green** `6864e42`.
  - Band's test now expects no `immediate`; see review round 1.
- **Live check** (2.1.306, a private tmux session, `claude --plugin-dir <pane-command scaffold>`): a turn was still running ("Pontificating… (34s)") when `/check-pane` was typed, and the pane opened at once, before the turn ended.
- **Version:** 0.2.27 (patch: docs and one template field).
- **PR #122 review round 1** (Codex, three P2 findings, each checked against the code and the docs):
  - **The band's demo races the turn.** `showDemo` makes two detached `update`s of `turn`, which the archetype's `tool.call` and `turn.complete` hooks also write. Run mid-turn, the demo overwrites live counts, or comes back after `turn.complete` cleared it. The red test `a86f0e3` was wrong. `84824e7` fixes it to expect no `immediate` (it failed with `Received [["check-band", true]]`). The template drops the field, and the rule now leaves `immediate` off a branch that writes state the turn's own hooks write.
  - **A `drop` is retried only for the engine's two reasons.** Another `prompt.submit` hook's deliberate drop must not be resubmitted, as the docs' retry pattern shows. Other drops are reported with a toast, not retried.
  - **The retry is detached.** `turn.complete` empties the pending text first, then submits it with `void … .catch(…)`: the call resolves only when the new turn starts. Both changes are conventions wording, in one commit.
- **PR #122 Codex round 2** (three P2 findings, each checked):
  - **A dropped prompt is kept in a queue, not one slot.** Several jobs can finish while submits are refused. `turn.complete` takes the whole queue, empties it, and submits each item detached. A retry refused again goes back on the queue.
  - **What still works after an abort.** `conventions.md` said every `$` call after the abort rejects. That overstated the probe: only process calls reject. State, store, toast and file writes still work, so recording the stop in the hook's `catch` is viable. The text now says so, and gotchas.md's Esc entry adds the after-abort calls that were probed (#119's probe, duet 0.3.3's live check).
  - **The SPEC template's "after /clear" row** names the managed-settings exception, since the person approves that row.

## Change 0.2.28 (2026-10-21)

> Issue #119, step 4. The owner's decisions (2026-10-21) are in #119's comments: `immediate: true` on "/modlab only", and `/clear`, `/resume` and `/branch` handled per #122's conventions.

- **Why:**
  - `/clear`, `/resume` and `/branch` reset every atom, and `session.start` doesn't run again, so the pane listed nothing until the next rescan.
  - The pin's copy in state (`pinned`) was reset while the module's `pin` stayed, so a reload after `/clear` would lose the build's folder.
  - A `/modlab` typed while Claude was working waited for the turn.
- **What changes:**
  1. **A `classic.SessionStart{source=clear|resume|fork}` hook**, with `.catch`, runs `reseed`, detached. It writes `pinned` from the module's `pin` straight through `$.state.set`, since `setPin` skips an unchanged pin, which this is. Then it runs `scan($, false)`, which is single-flight, so a `PostToolBatch` rescan merges into it.
     - It does nothing before `session.start` has run (`hasStarted`): a resumed startup fires the event first, as probed on 2.1.296 and 2.1.306.
     - `session.end` already rotates the log on `/clear`, and nothing of it is repeated.
  2. **`/modlab` registers `immediate: true`.** Every branch opens, closes or fronts the pane, starts the demo (state the turn hooks don't write), selects a mod and scans (single-flight), or fills the prompt box. `/mod-builder`, which sets options (a reload), keeps waiting.
- **Accepted resets:**
  - `runs` (a check in progress) shows again when the check finishes. `withProgress` maps only rows already there, and no module state tracks live checks.
  - `reported` and `building` (a build's stage markers) refill on the next `lab_report`.
  - `selected` goes back to the default.
  - These suit a new conversation.
  - Where an organization manages Claude Code, `classic.*` hooks don't run in an installed plugin, so the reset stays there.
- **What gets touched:**
  - `hooks/register.tsx` and `tests/ui.test.tsx`; the harness now records `command.register` calls.
  - `README.md`: the reach table's hooks and gating rows, render-checked with GitHub's Markdown API.
  - This SPEC, and version 0.2.28 in `plugin.json` and the marketplace entry.
  - No logic module change, and no new reach: the hook only writes Mod Lab's own state and reads folders, as a scan does.
- **TDD:**
  - **Red** `30fce93`: after a `lab_report` with `path`, a `classic.SessionStart` with `source: 'clear'` wrote no `pinned`, so the test failed with `Received []`. `/modlab`'s `immediate` was `undefined`. Compaction and a resumed startup before `session.start` must write nothing.
  - **Green** `cc7c231`.
- **Live check** (2.1.306, a private tmux session with `--plugin-dir` for this branch's Mod Lab and git-branch, and the installed copies turned off):
  - `/modlab` typed while Claude was still streaming (`Flowing…`) opened the pane at once.
  - With the pane open, `/clear` left it listing the same four mods.
- **Carried over from PR #122's branch.** Two docs commits were pushed there after #122 had merged, so they never reached `main`: `4e97fdc` and `b0b833c`. They arrive here.
  - `classic.SessionStart` fires before `session.start` at startup and at `claude --continue` (`source: resume`), probed on 2.1.296 and 2.1.306. gotchas.md gains it as `[probe]`, and the `/clear` convention says to skip the reseed when the module hasn't started (as Mod Lab and git-branch now do).
  - After an Esc stop, process calls work again from `$.clock.after(0, …)`, though `git` is refused in the aborted hook (probe, 2.1.306). gotchas.md and conventions.md say so, and duet 0.3.3 uses it.
- **PR #127 Codex round 1** (2026-10-21):
  - **P2, a `/clear` during a scan** (Codex 4342486253): closed as moot, by probe. The concern: `reseed` merges into a scan in flight, every pass of which reads through the first caller's `$`, and a dispatch's reads are fixed at its first `get` (gotchas.md), so they would read the state from before the reset.
    - A dispatch's moment holds only while its hook is open: work it leaves running reads live once it has returned, `/clear`'s reset included. Probed on 2.1.296 and 2.1.307 with a throwaway mod: a command read an atom set to 5 and left a read waiting on a gate; after `/clear` the waiting read got 0.
    - The kit agrees (`claude plugin test`, 2.1.307): with a scan held mid-read, a pass queued on the returned tool batch's `$` read a report written after that `$`'s first `get`. That test went green with no change, so it isn't kept.
    - Left as is: a hook still awaiting a scan when `/clear` comes would read pre-reset state. `lab_report` awaits one on its Spec and moved-folder paths, during a tool call; whether `/clear` can run then wasn't probed.
  - git-branch takes the round's other P2 (Change 0.1.2 there).
  - gotchas.md gains both probes: the moment ends with the hook, and `/reload-plugins` reloads only a changed module.
- **Version:** 0.2.28 (patch).

## Change 0.2.29 (2026-10-22)

> Issue #135. The owner, 2026-10-22: "since you're modifying a claude mod, it should go through /mod-builder:edit. read C:\Projects\ClaudeMod\docs\research\Mods and ensure /mod-builder is built with this capabilities", and, choosing #135 next: "option 1 but read C:\Projects\ClaudeMod\docs\research\Mods to refresh your context regarding claude mod best practices as per anthropic".

- **Why:** Anthropic's mod documents describe parts of changing an existing mod that the edit skill leaves out. #135 lists them with their lines:
  - It never finds out which copy of the mod the session runs.
  - Its live check doesn't confirm that the edited version is the one that loaded.
  - Its README step doesn't refresh the "Built on" line.
  - It doesn't mention that a `--plugin-dir` folder is a protected path.
- **Following the edit skill by hand:** edit's step 0.1 looks for the mod only in `<mods>/`. mod-builder's marketplace entry is `./plugins/mod-builder`, and Mod Lab answered the Spec report with "path ignored: …/plugins isn't a marketplace's mods folder". So this section, the approval, the version bump and the README step follow the skill's steps by hand.
- **The probes this rests on** (2026-10-22, Claude Code 2.1.308):
  - `claude plugin list --json`:
    - `mod-builder@claudemod`, `git-branch@claudemod` and `issue-forge@claudemod` carry `readFromFolder`, which is the main folder's path, and `folderVersion`.
    - `blast-radius@claude-code-mods` and `code-review@claude-plugins-official` have no `readFromFolder` key and an `installPath` under `~/.claude/plugins/cache/<marketplace>/<name>/<version>`. An earlier version of this line said `readFromFolder: null`. That was a misreading: a Python `.get()` printed `None` for the missing key. Corrected in review round 1.
    - The text form prints `Read from: <folder>` for the first kind, and no such line for the second.
  - `/reload-plugins` in this session printed "`issue-forge@claudemod` re-read from its folder: `mods/issue-forge`".
  - `claude -p --debug-file <log> --plugin-dir mods/issue-forge "/issue-forge demo"` ran from this branch's worktree with the installed `issue-forge@claudemod` left enabled.
    - The demo answered.
    - The log has `Plugin "issue-forge" from --plugin-dir overrides installed version` and `hooks module issue-forge@inline loaded (worker, environment 1, tier user); events: …`.
    - It has no module line for `issue-forge@claudemod`.
    - The `loaded` line (log line 230) comes before `plugin.register: issue-forge (user, issue-forge@inline), judged by core alone: admitted` (line 266). So the `loaded` line alone doesn't show that no policy refused the mod.
    - Line 128: `no pluginConfigs["issue-forge" or "issue-forge@inline"].options in user, --settings or managed settings …; every option is its default`.
- **The documents this rests on:**
  - `docs/research/Mods/Mods-overview.md:118-120`: `/plugin`'s `mods active` line names the mods the session loaded.
  - `docs/research/Mods/Create-a-mod.md`:
    - `:43-45`: `/plugin`'s Installed tab lists a loaded mod.
    - `:238`: a `--plugin-dir` folder hot-reloads when a file in it is saved, and each reload runs `register` again, so module variables reset.
    - `:246-254`: change a mod in a session started with `--plugin-dir`, which is a protected path. Files Claude saves during its turn reload when the turn ends.
    - `:258`: Claude Code writes `.claude-plugin/types/` into a mod it loads from `--plugin-dir` in an interactive session.
    - `:355`: "your README is the place to say which Claude Code version you tested with".
    - `:357`: an installed copy is cached by version.
  - `docs/research/Mods/Test and troubleshoot/Troubleshoot-a-mod.md`:
    - `:19`: in a `claude -p` run, "A refusal by another mod goes to the debug log only".
    - `:75`: the built-in guard's refusal, `mods are limited to your organization's by policy (allowManagedModsOnly)`.
    - `:125-129`: `<mod>: <event> hook skipped: <reason>`, for a hook that threw, timed out or returned the wrong shape.
    - `:264-268`: edits to an installed copy don't take effect.
    - `:270-274`: module variables reset at each reload.
    - `:282-304`: the debug log's `hooks module <name>@inline loaded` line, and `reload failed, the previous version stays loaded:`.
  - `docs/research/Mods/Test and troubleshoot/Mods-reference.md`:
    - `:384`: a `--plugin-dir` mod's options come from `pluginConfigs."<name>@inline"`.
    - `:399`: `--plugin-dir` "reloads its hooks module when you save".
  - `docs/research/Mods/Test and troubleshoot/Test-a-mod.md:394`: a policy mod's refusal reads `<mod>: refused by <policy mod>: <reason>`.
  - The live "Plugin loading reference" (https://code.claude.com/docs/en/plugins/loading, read 2026-10-22, not saved under `docs/research/`):
    - **"In-place and copied plugins":** a relative-path plugin in a marketplace added from a local path loads in place. Edits take effect at the next session start or `/reload-plugins`, with no version bump. Every other marketplace plugin is copied into `cache/<marketplace>/<plugin>/<version>/`, and that copy loads.
    - **"Name conflicts":** an enabled `--plugin-dir` plugin replaces a same-named installed marketplace plugin silently. The exception is a plugin whose id managed settings name: then `--plugin-dir copy of "<name>" ignored: plugin is locked by managed settings`.
- **What changes:**
  1. **Edit step 0, a new point: which copy runs.** Two questions decide what makes edited code run, and the step records the answers for step 4 and the hand-off.
     - **How the mod is installed.** `claude plugin list --json` reads the install records. Find the mod's id:
       - **`readFromFolder` is set** (the text form shows `Read from:`). The mod was installed from a marketplace added from a local folder, and it loads in place from that folder. Edits to that folder load at `/reload-plugins` or the next session. When the folder being edited isn't `readFromFolder`, such as a git worktree, the installed copy keeps running the other folder's code.
       - **No `readFromFolder` key.** The mod is a copy of one version, under `installPath`. An edit reaches it only after all of this:
         - the version is bumped;
         - the marketplace holds the change (pushed);
         - `claude plugin update <id>` or `/plugin` updates it;
         - `/reload-plugins` runs.
       - **No id.** The mod isn't installed.
     - **Whether this session loaded it with `--plugin-dir`.** The install records can't tell. Per the loading reference, the marketplace row stays enabled while an inline copy replaces it.
       - The person can see it in `/plugin`: the `mods active` line and the Installed tab. When the request doesn't say, ask it in step 1's batch.
       - A `.claude-plugin/types/` folder in the mod shows only that an interactive `--plugin-dir` session loaded it at some time.
       - When the session does load it that way, it runs as `<name>@inline`, loaded in place. Its hooks module reloads when the person saves a file in it, and files Claude saves reload when Claude's turn ends. Each reload runs `register` again, so module variables reset, while `$.state` and `$.store` stay. Its skills, agents and other components load their changes at `/reload-plugins`. That last point was added after the PR opened, from the live "Create a Claude Code plugin" page (https://code.claude.com/docs/en/plugins/create, "Load a plugin for one session", read 2026-10-22): "When you edit the plugin's files during the session, run `/reload-plugins` to load the changes." It wasn't probed. The mods pages say only that the hooks module hot-reloads (Create-a-mod :238).
       - The folder is a protected path, so in the `default` and `acceptEdits` modes each edit Claude makes to it asks for approval.
  2. **Build step 4, which edit reuses: the live smoke test writes a debug log.** A `claude -p` run prints a refusal by another mod only there (Troubleshoot :19).
     - The command: `claude -p --debug-file <scratchpad>/<name>-debug.log --plugin-dir <mods>/<name> "/<name> demo"`.
     - It passes only when the log has `hooks module <name>@inline loaded`, and has none of these lines for the mod:
       - `did not load`, `not loaded`, or `ignored`;
       - `hook skipped` (a hook such as `session.start` threw, timed out or returned the wrong shape, while the demo command can still answer);
       - `refused`.
     - A `--plugin-dir` copy replaces an installed one of the same name, so the installed copy needn't be turned off.
     - **Options:** the run uses each option's default, plus any `pluginConfigs."<name>@inline"` entry in `~/.claude/settings.json`. A demo that depends on an option passes it: `--settings '{"pluginConfigs":{"<name>@inline":{"options":{…}}}}'`.
     - **Interactive sessions:** in one started with `--plugin-dir`, the transcript's reload line is the same check. A `reload failed, the previous version stays loaded:` line is a failure, because the old version is still the one running. This comes from the docs only: it needs an interactive hot reload, and wasn't probed.
  3. **The three `/reload-plugins` sentences.** They say, without conditions, that a reload picks up edits: build's step 4 (`:136-138`), build's hand-off (`:160`) and edit's hand-off (`:72-73`). Each now names, for the person's case from point 1, what loads the new version and how the person sees that it loaded:
     - **In place:** `/reload-plugins` prints `re-read from its folder` (probed this session), and `/plugin`'s `mods active` line names the mod.
     - **A cached copy:** `claude plugin update <id>`, which ends with `Restart to apply changes.` (loading reference), then `/reload-plugins`, then `/plugin`.
     - **`--plugin-dir`:** the transcript's reload line. `reload failed, the previous version stays loaded:` means the old code is still running.
  4. **Edit step 5.2: refresh the README's "Built on Claude Code <version>" line.**
     - Keep the build it names, and add the new version with what ran on the build this change was checked on: the tests, the `-p` demo, or an interactive session.
     - Example: `Built on Claude Code 2.1.296; 0.1.3's tests and demo ran on 2.1.308.` This follows Create-a-mod :355 ("tested with"), and says what ran, as PR #136's review asked of issue-forge's README.
     - `references/conventions.md:171` says the same.
     - The README template (`templates/README.template.md:71`) is unchanged, since a new build has one build to name.
- **Not changed:**
  - Mod Lab's code, and no mod.
  - The stale lines in `mods/git-branch/README.md:75` and `mods/issue-forge/README.md:326` wait for a change of their own. #135 names them as examples, and says "Not in this issue: any change to issue-forge".
  - `plugins/mod-builder/README.md:158` and `docs/use-in-your-project.md:54` stay. They describe a marketplace added from a local folder, where `/reload-plugins` does load edits.
- **What gets touched:**
  - `skills/edit/SKILL.md`, `skills/build/SKILL.md` (steps 4 and 5) and `skills/build/references/conventions.md`.
  - This SPEC.
  - Version 0.2.29 in `plugin.json` and the marketplace entry.
  - No code, and no new reach.
- **Tests:**
  - No code changes, so there is no red or green step.
  - QA: `claude plugin validate .`, validate and test for `plugins/mod-builder`, the archetype check (the build skill changes) and the typecheck.
  - The live check is point 2's command, run on 2.1.308 against this branch's `mods/issue-forge` at the PR head.
- **QA** (2026-10-22, Claude Code 2.1.308, at `2a543e3`):
  - `claude plugin validate .` and `claude plugin validate plugins/mod-builder` pass.
  - `claude plugin test plugins/mod-builder`: 357 of 357.
  - The archetype check: all five pass.
  - The typecheck exits 0.
  - **Live check:** point 2's command, with the installed copies left enabled, run with `--plugin-dir <worktree>/mods/issue-forge` and with `--plugin-dir <worktree>/plugins/mod-builder` (`/modlab demo`). Each answered, and each log has `Plugin "<name>" from --plugin-dir overrides installed version` and `hooks module <name>@inline loaded`, with none of the failure lines.
  - **The check catches a wrong copy:** a first run, given a relative `--plugin-dir` from the wrong folder, also answered the demo. Its log had `[WARN] Plugin path does not exist: …/mods/issue-forge (ENOENT), skipping` and `hooks module issue-forge@claudemod loaded`, and no `@inline` line. The installed copy had answered, and only the log showed it.
- **Follow-up #141:** edit's step 0.1 finds a mod only in `<mods>/`. A marketplace entry under another folder, like `./plugins/mod-builder`, can't go through the skill as written, and Mod Lab ignores its path. The owner chose to file it (2026-10-22, "File an issue (Recommended)"), and it isn't part of this change.
- **PR #142 review round 1** (2026-10-22). Codex reviewed `ed0ee34`, and a `/code-review` run reviewed `87345f4`. The owner asked to check each finding against the advisor and to reproduce it. All probes ran on 2.1.308.
  - **Codex P1 (4353504729), "`/plugin` can't tell which copy won": partly a false positive.**
    - The review run's interactive probe shows the Installed tab does tell. A `--plugin-dir` copy is the row `issue-forge  Plugin  inline`, with details `issue-forge @ inline` and `Version: 0.7.5`, and no `@claudemod` row appears. The loading reference's "row stays enabled" is about `claude plugin list`, which step 0.4 already says can't tell.
    - What was real: the hand-offs cited the `mods active` line, which names mods only. They now cite the Installed tab row (`e8c13ed`).
  - **Codex P2 (4353504735), the reused debug log: reproduced, and worse.**
    - A seeded line stayed first after a 560-line run.
    - The review run showed the worse case: after a passing run, a rerun with a wrong `--plugin-dir` found the old `@inline loaded` line and passed.
    - The fix: `rm -f` the log before the run, and `Plugin path does not exist` fails the check (`63a598d`).
  - **Codex P2 (4353504744), managed settings: reproduced as an omission.**
    - The engine's log line names "user, --settings or managed settings" and both keys `"<name>"` and `"<name>@inline"`. The smoke test now says so (`bc42e2a`).
    - Which source wins when managed settings also set an option wasn't probed, and the text says that.
  - **The review run's other findings, taken:**
    - **A policy refusal comes after `loaded`.** The pass rule now needs the `plugin.register: <name> (user, <name>@inline), … admitted` line, and the `--plugin-dir <path> is one plugin` line naming the folder built (`e13f5f5`).
    - **The reload cases had drifted across four copies.** Build's hand-off holds the one copy: the remote case gains the version pin and `/reload-plugins`. Edit's hand-off points there and adds the installed-plus-`--plugin-dir` case and the not-loaded case (`ebd43e5`).
    - **`readFromFolder` is absent, not `null`, for a copied plugin** (confirmed with a raw JSON read). Step 0.4 now also:
      - takes this marketplace's row when the name has several;
      - reads `enabled` and `folderVersion`;
      - names `--plugin-url` and `CLAUDE_CODE_PLUGIN_DIRS`.

      The probe record above is corrected in place (`ba4104b`).
    - **Docs-only claims are tagged "docs, not observed":** `reload failed` keeps the old version, and skills load at `/reload-plugins` (`fe7fefe`).
    - **Two templates promised the same unconditional reload:** `templates/SPEC.template.md:106` and `templates/README.template.md:38` (`2413f5b`). This adds those two files to What gets touched.
    - **`references/gotchas.md`** gains the probed loading facts (`3f32851`). This file is added to What gets touched too.
  - **Rejected:** reading `/proc/<pid>/cmdline` to find `--plugin-dir`. It's Linux-only and fragile, and not a practice for the skill to teach. Only its point about the other two ways to load a plugin inline was taken.
  - **QA after the round** (2.1.308):
    - The repository and `plugins/mod-builder` validate.
    - 357 of 357 tests pass, the archetype check passes, and the typecheck exits 0.
    - The sandbox check passes, with the canary list matching gotchas.md.
    - **Live check with a fresh log:** `hooks module issue-forge@inline loaded`, `plugin.register: issue-forge (user, issue-forge@inline), judged by core alone: admitted` and `--plugin-dir <worktree>/mods/issue-forge is one plugin` each appear once, and none of the failure lines.
    - **The same run with `--plugin-dir <worktree>/mods/no-such-mod`:** the demo still answered, from the installed copy. The log had no `@inline loaded` and one `Plugin path does not exist`, so the check fails it.
- **PR #142 review round 2** (2026-10-23). Codex reviewed `bf69e84` and raised five P2 findings. The owner asked whether each has merit by Anthropic's plugin documents (the main folder's untracked `docs/research/claude-plugins/`), and the advisor agreed with each verdict below.
  - **4353802792, a missing-path line from an unrelated path fails the check: reproduced.**
    - `CLAUDE_CODE_PLUGIN_DIRS` paths load "in addition to any you pass with `--plugin-dir`" (Create-a-Claude-Code-plugin.md:213).
    - With a stale entry in it, the target's `is one plugin`, `loaded` and `admitted` lines were all present, beside an unrelated `Plugin path does not exist`.
    - Only that line for `<mods>/<name>` now fails the check (`25020c5`).
  - **4353802800, an archive isn't watched: reproduced.** A `.zip` given to `--plugin-dir` logged `Extracted ZIP to /tmp/claude-plugin-session-…/inline-0-issue-forge`. `--plugin-url` always loads one (Create-a-Claude-Code-plugin.md:164-165, :176-179). Round 1's `ba4104b` had attached the hot-reload sentence to `--plugin-url`. Step 0.4 now treats an archive as an extracted copy that no edit reaches, and only a folder hot-reloads (`322633e`).
  - **4353802814, `enabled: false` isn't the live session: taken from the docs, not probed.**
    - Disk and settings changes reach a running session at `/reload-plugins` or a new session (Create-a-Claude-Code-plugin.md:250, Add-components-to-a-plugin.md:13).
    - The step now says the mod won't load next time, that an earlier session may still run it, and that the Installed tab shows what runs (`b8b8517`).
  - **4353802805, a same-named `@skills-dir` or `@synced` copy can be the one running: taken from the docs, not probed, one clause.**
    - The two origins are documented at Create-a-Claude-Code-plugin.md:219-239 and Publish-and-distribute-a-plugin.md:160.
    - An enabled marketplace copy takes precedence over both, so the clause applies only when this marketplace's row is missing or disabled (`c3d7d7e`).
  - **4353802828, this release breaks the "Built on" rule it adds: real.** `plugins/mod-builder/README.md:215` said only "CI tests it on Claude Code 2.1.296". It now names what ran on 2.1.308 for 0.2.29 (`176913f`), which adds the README to What gets touched.
  - **Not new:** 4353504735 showing at `bf69e84:125` is GitHub re-anchoring the round-1 comment, which round 1 answered.
  - **QA after the round** (2.1.308):
    - Validate passes, with 357 of 357 tests.
    - The archetype check passes, and the typecheck exits 0.
    - **Live check with a fresh log:** `loaded`, `admitted` and the folder line once each, and no failure line.
    - **The same run with a stale `CLAUDE_CODE_PLUGIN_DIRS` entry:** the same lines, plus one unrelated missing-path line, and it passes the scoped rule.
- **Version:** 0.2.29 (patch: skill text).

## Change 0.2.30 (2026-10-23)

> Issue #138, "Mod Lab: remove stored results for mods folders and mods that no longer exist". The owner chose it next, 2026-10-23: "#138 Mod Lab store (Recommended)".

- **Following the edit skill by hand:** edit's step 0.1 finds a mod only in `<mods>/` (#141), and Mod Lab ignores a `plugins/` path (0.2.29). No `lab_report` is sent for this change: without a path it would record `mod-builder` as a build in the watched `mods/` folder. [inference] That may be how `mod-builder` got its stale Test result there.
- **Why:** Mod Lab keeps one set of keys per mods folder, `modlab:results:<dir>`, `modlab:done:<dir>` and `modlab:generations:<dir>`, and never removes a key or an entry inside one. Every folder a build or edit reports through `lab_report`'s `path` adds a set.
- **The stores now** [ran: a read-only listing of `~/.claude/plugins/store/mod-builder_*.json`, and a folder check for each key, 2026-10-23]:
  - The installed copy's, `mod-builder_claudemod-424a2ff7bc42.json`: 22,609 bytes on disk, 13,648 characters of compact JSON, 20 keys.
    - 14 keys belong to 6 folders that no longer exist: four from #138's own list, plus this session's `scratch/issue-137-format-command/mods` and `scratch/issue-140-store-budget/mods`, which `lab_report` pinned during those edits.
    - `modlab:results:/mnt/c/Projects/ClaudeMod/mods` holds `duet` (removed by PR #133) and `mod-builder`, neither of which is in that folder. `modlab:done:…/mods` holds `duet`.
    - The unkeyed `modlab:results`, `modlab:done` and `modlab:generations` from before 0.2.9 are there, beside the keyed ones for `/mnt/c/Projects/ClaudeMod/mods`.
  - The `--plugin-dir` copy's, `mod-builder_inline-265b4e9b5ab2.json`: 21,998 characters, 19 keys, 14 of them for 10 folders that no longer exist (corrected in place from "20 keys … 11 folders", a miscount, when the live check listed them). It has keyed results and done for `…/mods` but no keyed generations, so its unkeyed `modlab:generations` is still the one that folder reads.
  - Both are far from the 4 MiB limit: this is upkeep, so the records don't grow with every worktree.
- **What `$.fs` says about a missing folder** [probe: a throwaway mod under `claude -p --plugin-dir`, Claude Code 2.1.309, 2026-10-23]:
  - `$.fs.stat` of a deleted folder rejects with a `HooksError` whose message is `<plugin>: $.fs.stat(<path>) failed: ENOENT`, with no `.code`.
  - Under a folder with mode 000, it rejects with `… failed: EACCES`.
  - `$.fs.exists` answers `false` for both, so it can't tell a missing folder from one it can't read.
  - `/mnt/z/nothing/mods` (no such drive) rejects with `ENOENT`, the same as a deleted folder. `//nohost/share/mods` is read as `/nohost/share/mods` on Linux, and also rejects with `ENOENT`.
- **What changes:**
  1. **Folders that are gone.** At session start, after the scan starts and without holding the hook up, Mod Lab lists the store's keys (`$.store.keys`).
     - A key under `modlab:results:`, `modlab:done:` or `modlab:generations:` names its folder after that prefix. The key is read by the three prefixes, not split on `:`, since a Windows folder's key holds one more.
     - Each folder is checked once, with `$.fs.stat`. Only a rejection whose message ends as the engine's does, `failed: ENOENT`, counts as gone. A folder that answers, or a rejection for any other reason, is kept: `EACCES`, a network location, a message worded otherwise, or another mod's refusal (`<mod>: refused by <policy mod>: <reason>`, `Test and troubleshoot/Test-a-mod.md:394`).
     - A gone folder's keys are deleted (`$.store.delete`). Each delete waits its turn on the chain `updateStore` uses, so a write this session already started for that key lands first.
     - Each delete writes a log line at `normal`: `store: deleted <key> (<folder> is gone)`.
  2. **Mods that are gone.** At a scan whose listing of the mods folder succeeded, the entries for names that are neither a folder in it nor a live build's placeholder are dropped:
     - from `results` and `generations` through `updateStore`, built from the value read in its turn;
     - from `done` in `announceGreen`'s own read and write, which that scan already makes. `announceGreen` writes `done` with `$.store.set` directly, not through `updateStore`, so the drop goes into that same write, and the two can't interleave.

     A scan whose listing failed drops nothing: such a scan still runs as a full pass, with no folders. A live build's placeholder keeps its entries, so a build that writes its folder again, such as a scaffold run a second time, keeps its results meanwhile. (Corrected in place during the build: this said a Validate or Test report on a mod whose folder isn't written yet keeps the result it stores. A finished report ends the placeholder (`withBuilding`), so that result goes at the next scan, and the check runs again once the folder is there.)
  3. **The unkeyed keys from before 0.2.9.** Each of `modlab:results`, `modlab:done` and `modlab:generations` is deleted when the folder `legacyDirOf` names (this session's `modsDir` option, else the plugin's own `mods/`) has its own keyed record under that prefix, or when that folder is gone. `storedOf` reads an unkeyed key only while the folder's keyed one is missing, so this changes nothing a scan reads.
  4. **Pure rules** in `hooks/mod-builder-logic.ts`:
     - `storeFolderOf(key, prefixes)`: the folder a key names, or null.
     - `folderGone(message)`: whether a `$.fs.stat` rejection says `ENOENT`.
     - `prunableKeys(keys, prefixes, gone, legacyDir)`: the keys to delete, each with why.
     - `withoutGone(record, keep)`: the record without the names left out of `keep`, or null when nothing goes.
- **A departure from the issue:** #138 asks that a folder that "can't be read (an unmounted drive, a permission error)" be kept. A permission error is kept. A folder on a drive that isn't mounted can't be told from a deleted one, as the probe shows, so its records go.
  - What it costs, when the drive comes back: Validate and Test show `○` until they're run again. A mod already announced as ready to share may be announced once more. An edit in progress loses the start of its build generation.
  - The alternative, not taken unless the owner chooses it: also keep a folder whose first two path parts (such as `/mnt/z`) are missing.
- **Known limits:**
  - A folder created again at the same path between its stat and its delete loses what was written in between. issue-forge's worktrees reuse `scratch/issue-forge/<branch>`. The window is one stat and one delete.
  - Another session's write is ordered only within its own session (#58), as now.
  - The `ENOENT` test reads the error's message, since it has no code. A build that words it otherwise makes every folder read as one that can't be checked, so nothing is pruned.
  - `legacyDirOf` reads this session's `modsDir` option. A session with another setting judges the unkeyed keys by another folder.
- **Against Anthropic's mod docs** (`docs/research/Mods`, read 2026-10-23, as the owner asked before #140's build):
  - **Lifetime:** a `$.store` value lasts until "Your mod deletes it, or no session reads or writes the store for `cleanupPeriodDays`" [read: `Build/Draw-in-the-interface-with-a-mod.md:727`]. Mod Lab's store is read in every session, so removing its stale keys is Mod Lab's own job.
  - **Several sessions:** "Give each item its own key" and "Read again right before you write" [read: `Build/Draw-in-the-interface-with-a-mod.md:837-842`]. Keys stay one set per folder. The drops in 2 are built inside `updateStore`'s turn, or `announceGreen`'s read, from the value read then.
  - **The calls:** `$.store` has `get`, `set`, `delete` and `keys`, and `$.fs` has `exists` and `stat` [read: `Test and troubleshoot/Mods-reference.md:216-217`]. The 2.1.309 types say `stat` "Rejects when missing", with `ENOENT` [d.ts], and `exists` "rejects only a network location" [d.ts].
  - **Time:** `$` calls don't count against a hook's 10 seconds [read: `Test and troubleshoot/Mods-reference.md:347`]. "Claude Code waits for that hook before the first prompt" [read: `Build/Use-the-mods-API.md:15`], and the docs' background work returns "without waiting … so the session starts right away" (`:198`). So the prune runs detached from `session.start`, as the scan does.
  - **Calls are events:** "A mod earlier in the chain can observe, rewrite, or refuse your call, which is how an organization restricts what mods reach" [read: `Build/Use-the-mods-API.md:404`]. A refused `stat` or `keys` prunes nothing, and a refused `delete` is logged and skipped.
  - **Tests:** "`mock.store` … returns nothing, so to check what your mod saved, write the two `store` stubs yourself", and a call that should fail is stubbed with `{ deny: 'the reason' }` [read: `Test and troubleshoot/Test-a-mod.md:112`, `:170-200`]. `world()` already writes its own `store.get` and `store.set` stubs; `store.keys`, `store.delete` and `fs.stat` join them the same way.
- **What gets touched:**
  - `hooks/register.tsx`, `hooks/mod-builder-logic.ts`, `tests/mod-builder-logic.test.ts` and `tests/ui.test.tsx`.
  - README: the store paragraph, and the Store and Files rows of "What it reaches", from validate's output.
  - `skills/build/references/gotchas.md`: the probe's `$.fs.stat` and `$.fs.exists` facts, tagged `[probe]`.
  - This SPEC, and version 0.2.30 in `plugin.json` and the marketplace entry.
  - **New reach:** `$.store.keys` and `$.store.delete`, and `$.fs.stat` of each folder the store has keys for, once per session.
- **Tests (first, failing):**
  - **Logic:**
    - `storeFolderOf`: each prefix, a Windows folder holding `:`, other keys.
    - `folderGone`: the probe's exact `ENOENT` and `EACCES` messages, and an unknown one.
    - `prunableKeys`: a gone folder's keys go, while a kept or unreadable folder's stay. Each unkeyed key goes only with its own keyed record or a gone legacy folder, so the inline store's case keeps unkeyed generations. Keys with other prefixes are kept.
    - `withoutGone`: names dropped, placeholders kept, null when nothing goes.
  - **UI** (`world()` gains `store.keys`, `store.delete` and `fs.stat` stubs, the stat rejections worded as the probe's):
    - A session start deletes a gone folder's three keys and logs each delete. It keeps the keys of a folder that is there, and of one that rejects with `EACCES`.
    - A scan drops a mod that's no longer on disk from results, done and generations, and keeps a build's placeholder.
    - A scan whose listing fails drops nothing.
    - The unkeyed keys go when the legacy folder has keyed records.
  - **QA:**
    - `claude plugin validate .`, and validate and test for `plugins/mod-builder`.
    - The typecheck, and logic coverage with no drop.
    - The sandbox check, since gotchas.md changes.
  - **Live check:**
    - `claude -p --debug-file <fresh log> --plugin-dir <worktree>/plugins/mod-builder "/modlab demo"` loads this copy. Its session start prunes the `--plugin-dir` copy's own store.
    - That store is copied to the scratchpad first, so the PR can show its keys before and after, with the log lines.
    - The installed copy's store is pruned only once this merges and a session reloads it.
- **Done means:** Mod Lab's stores hold records only for folders that exist and mods in them. A removed worktree's keys go at the next session start, and a removed mod's entries at the next scan.
- **Version:** 0.2.30 (patch: upkeep of the plugin's own store, no change to commands, options or the state contract).
- **Approved** by the owner, 2026-10-23, with the plain rule for an unmounted drive: "i approve as long as you follow guidance from anthropic's best practices for claude mod: C:\Projects\ClaudeMod\docs\research\Mods". The docs were read again before the build, for `session.start`, calls as events, and tests: the three points added under "Against Anthropic's mod docs" above.
- **Review:** a light one, by the owner's choice after a side agent's note that #138 is upkeep, not urgent (2026-10-23, "Finish #138, light review (Recommended)"). Only what Codex's first round finds that breaks something is fixed. Later findings go into this SPEC as known limits.
- **Built:** SPEC `666d732` and `34a0a69`. Red `06cfc75` (11 of 369 failed, by assertion). The red placeholder test was wrong, and was fixed in its own commit, `c69eea1`: a finished report ends a build's placeholder, so the result it expected to keep belonged to no live build. A mutant that keeps only the names on disk fails the new test. Green `68959f9`, refactor `d26cfbe` (one `dropGone`; the logic tests call the new functions directly). 369 of 369 pass.
- **QA** (2026-10-23, Claude Code 2.1.309):
  - `claude plugin validate .` and `claude plugin validate plugins/mod-builder` pass. Validate lists the new calls: `$.fs.stat (via pruneStore)`, `$.store.delete (via deleteStore)` and `$.store.keys (via pruneStore)`.
  - `claude plugin test plugins/mod-builder`: 369 of 369.
  - The typecheck, tests included, exits 0. The archetype check passes all five, and the sandbox check passes, with the canary list matching gotchas.md.
  - **Logic coverage:** lines 99.68%, branches 90.94% and functions 99.07%, against 99.68%, 90.62% and 99.02% on `main` at `8b03f66`. The uncovered lines are the same ones, moved down by the new code. LCOV has 29 branch records on the new functions, none of them untaken.
  - **Live check:**
    - The run: `claude -p --debug-file <new log> --plugin-dir <worktree>/plugins/mod-builder "/modlab demo"`, from the main folder, with the `--plugin-dir` copy's store saved to the scratchpad first.
    - The demo answered. The log has `is one plugin` for the worktree's folder, `hooks module mod-builder@inline loaded` and `plugin.register: mod-builder (user, mod-builder@inline), … admitted`, with no failure line.
    - The store went from 19 keys and 21,998 characters to 5 keys and 3,830 characters. The log has 14 lines `store  deleted <key> (<folder> is gone)`, one for each key of the 10 gone folders, and no `store.delete` failure.
    - The scan of `/mnt/c/Projects/ClaudeMod/mods` dropped `duet`, so its results key now holds `{}`.
    - The unkeyed keys stayed: this session's `legacyDirOf` is the worktree's own `mods/`, which has no keyed record, as point 3 says.
- **PR #146 review round 1** (2026-10-23): Codex 4362849420 on `168a927`, and the owner's `/code-review high` (nine findings, numbered as it gave them; its 1 is Codex's). Every finding is in code this PR adds, so nothing pre-existing was filed as an issue. The advisor was overloaded and gave no verdict. The owner chose "Codex + cheap guards (Recommended)".
  - **Finding 1, Codex 4362849420:** `dropGone` filters the stored record by a `keep` list taken before the scan's later awaits. A Spec report that starts an edit generation while the scan reads the mods can land first, and the drop then deletes that new generation. Now a name is dropped only when its stored entry is still the one the scan read. An entry written since stays, and the next scan judges it.
  - **Finding 2:** a listing that succeeds with no mod folders in it would drop every mod's records, as a folder that is empty for a moment (a checkout, a sync) can be. Now a listing with no mods drops nothing. If every mod in a folder is removed, its records stay until the folder itself goes.
  - **Finding 5:** between the session-start stat and the delete, the folder can come back. Each delete now stats its folder again in its own turn on the chain, and a folder that answers keeps its keys.
  - **Finding 6:** a `stat` rejection that isn't the engine's ENOENT ending keeps the folder silently, so a reworded message would stop all pruning unseen. Such a rejection now writes a `debug` line naming the folder and the message.
  - **Finding 8:** `deleteStore` copies `updateStore`'s chain. One `enqueueStore` holds it for both.
  - **Finding 9:** tests for findings 1, 2, 5 and 6, and for a refused `$.store.keys`, which prunes nothing.
  - **Known limits, not fixed:**
    - **Finding 3:** a store shared between environments, such as a container and its host, or WSL and Windows with one `CLAUDE_CONFIG_DIR`, would prune the other side's folders, which don't stat here. [inference] The store file's name carries an install hash (`mod-builder_claudemod-424a2ff7bc42.json`, `mod-builder_inline-265b4e9b5ab2.json`), so two environments may not share one; not probed.
    - **Finding 4:** the unkeyed keys are judged by this session's `legacyDirOf`, as listed above. What it costs is a check run again.
    - **Finding 7:** `done`'s drop stays in `announceGreen`'s own read and write, as `done` was never written through the chain.
  - **Built** (round 1): SPEC `cc4cdb3`. Finding 1, Codex 4362849420: red `8a5e096` (a generation written while the scan reads a mod is deleted with a gone mod's; 2 failed), green `b4d1c3d` (the scan now reads the generations as stored, to compare against). Finding 2: red `e6c7c2f`, green `0d1b2b0`. Finding 5: red `95a33ca` (the test store can run a step after each stat), green `9cb9d68`. Findings 6 and 9: red `2394feb` (with a guard test for a refused `$.store.keys`, which passed), green `18c60d8`. Finding 8: refactor `55b696d`. Its first draft let the chain's own promise reject, which left a refused write unhandled when nothing queued after it. The test kit caught it ("a rejection nothing handled"), and the chain now never rejects. README: a folder that lists no mods keeps its results. 375 of 375 pass.
  - **QA** at `55b696d` (Claude Code 2.1.309):
    - `claude plugin validate .` and `claude plugin validate plugins/mod-builder` pass.
    - The typecheck, tests included, exits 0, and the sandbox check passes.
    - **Logic coverage:** lines 99.68%, branches 90.98% and functions 99.08%. LCOV has 33 branch records on the new functions, none of them untaken.
    - **Live check:** `claude -p --debug-file <new log> --plugin-dir <worktree>/plugins/mod-builder "/modlab demo"` answered. The log has `is one plugin`, `loaded` and `admitted`, and no failure line. It deleted nothing, since the first live check had already pruned that store.

## Change 0.2.31 (2026-10-23)

> Issue #141, "mod-builder:edit: find the mod by its marketplace entry, so a plugin outside mods/ (mod-builder itself) can be edited; plus release metadata". The owner chose it next, 2026-10-23: "#141 edit outside mods/". It also holds three comments the owner folded in: PR #142's two post-merge Codex P2s (6364044223), and the store's limit for `gotchas.md` (6368199989, 6369261334).

- **How mod-builder itself is changed** (the owner, 2026-10-23, answering the approval): "mod-lab plugin is to build claude mods not plugins. mod-lab is a plugin and thus must be modified to adhere to Anthropic's best practices for plugins. documentatoin is found here for plugins: C:\Projects\ClaudeMod\docs\research\claude-plugins and the claude mod documents are found here: C:\Projects\ClaudeMod\docs\research\Mods. mod-lab aka mod builder builds claude mods based on anthropic's best practices found in C:\Projects\ClaudeMod\docs\research\Mods". And: "plugin modifications must go through /plugin-dev:skill-development".
  - So mod-builder isn't edited through `/mod-builder:edit`. It is changed as a plugin, by Anthropic's plugin documents (`docs/research/claude-plugins`), with its skills edited through `/plugin-dev:skill-development` (imperative instructions, third-person descriptions, a lean `SKILL.md` with details in `references/`, and the skill-reviewer agent at the end). The mods it builds follow `docs/research/Mods`.
  - This SPEC stays the record of mod-builder's changes, as before. No `lab_report` is sent.
  - The owner approved the rest in one PR: "option 1 - include mandatory reading for future sessions to read: C:\Projects\ClaudeMod\docs\research\Mods & C:\Projects\ClaudeMod\docs\research\claude-plugins", "From LICENSE, else ask (Recommended)" and "Mod Builder (Recommended)".
- **Why:** edit's step 0.1 finds a mod only at `<mods>/<mod>/` [read: `skills/edit/SKILL.md:19`], and `<mods>` is `<root>/mods/` [read: `skills/build/SKILL.md:41-46`]. This marketplace lists `./plugins/mod-builder` [read: `.claude-plugin/marketplace.json:10`], so 0.2.29, 0.2.30 and this change all followed the skill by hand.
- **What `--strict` does today** [ran: `claude plugin validate --strict`, 2026-10-23]:
  - On 2.1.309, the marketplace and all four plugins (`plugins/mod-builder`, `mods/git-branch`, `mods/issue-forge`, `mods/turn-counter`) pass. Each plugin has one plugin-directory warning, `ICON_MISSING`, which `--strict` doesn't fail on.
  - On 2.1.296, CI's pin, `validate --help` lists `--strict` ("Treat warnings as errors (exit 1). Use in CI …"), and the same five pass. 2.1.296 ran from an `npm install --prefix` in the scratchpad.
- **What changes:**
  1. **Edit stays a tool for mods** (revised from the approved text by the owner's answer above, which drops "edit finds a mod by its marketplace entry" and the Mod Lab options (a) and (b)).
     - Step 0.1 still finds `<mods>/<mod>/`. When it isn't there but the marketplace lists a plugin of that name elsewhere, such as `./plugins/mod-builder`, the skill stops and says that this is a plugin, not a mod it edits: change it by Anthropic's plugin documentation, and its skills through plugin-dev's skill-development skill where that is installed. Otherwise it suggests `/mod-builder:build`, as now.
     - Build's step 0.2 and Mod Lab are unchanged.
  2. **`--strict` in CI.** `.github/workflows/ci.yml:35` and `:42` run `claude plugin validate --strict`, and so does the build skill's copy, `skills/build/ci/ci.yml`. The two stay byte-identical (`cmp` in QA). The archetype check validates each scaffolded mod with `--strict` too.
  3. **mod-builder's manifest** gains `homepage` and `repository`, both `https://github.com/bankielewicz/mod-builder` (the marketplace's address in `CLAUDE.md`), and `displayName`, whose value is the owner's [read: `docs/research/claude-plugins/Publish-and-distribute-a-plugin.md:40`, `:62`, committed in this change: "Set `displayName` in `plugin.json` for the label users see", "Set `description`, `author`, `homepage`, and `repository` … `homepage` must parse as a URL"].
  4. **`license` in the scaffold.**
     - `scaffold.mjs` takes an optional sixth argument, the license, and writes `"license": "<it>"` into the new `plugin.json`. Without one, it writes no `license` line, and no `__LICENSE__` is left behind.
     - The build skill fills the license from the repository's `LICENSE` file when the file names one (`MIT License` gives `MIT`). Otherwise it asks in step 1's batch, and it leaves the field out when the person gives none. It never makes one up.
  5. **PR #142's two late Codex P2s** (#141 comment 6364044223):
     - **A managed lock:** build's step 4 (`skills/build/SKILL.md:141`) says a `--plugin-dir` copy replaces an installed one "so there is nothing to turn off". It now names the exception. A plugin whose id managed settings' `enabledPlugins` names isn't replaced, and the log says `--plugin-dir copy of "<name>" ignored: plugin is locked by managed settings`. Step 4's failure list says that line means a policy must change before the folder's copy can be checked, and edit's step 0.4 says the same. All three are tagged "docs, not observed": managed settings are outside the repository.
     - **The update command:** the README template's `claude plugin update` (`templates/README.template.md:40`) becomes `claude plugin update __NAME__@<marketplace-name>`, the placeholder the install line above it already uses, so step 5 fills both. `claude plugin update` with no argument prints `error: missing required argument 'plugin'` [ran: 2.1.309, 2026-10-23, the comment].
  6. **The store's limit in `gotchas.md`** (#141 comments 6368199989, 6369261334), beside the `$.store` entry. The limit is per plugin, over every key together, so a mod that keeps a record per item bounds what it keeps [d.ts]. What counts, a key's length, and one value on its own, from a probe:
     - **The probe:** a throwaway mod under `claude -p --plugin-dir` on 2.1.309 sets a 257-character key, a value of about 1.5 million three-byte characters (over 4 MiB as UTF-8 and under it in characters), and one value over 4,194,304 characters, then deletes its keys.
     - It writes and deletes only in that probe plugin's own store file under `~/.claude/plugins/store/`.
     - Each fact is tagged `[probe]` only as far as the probe shows it. What the 2.1.309 binary showed beyond that stays in #141's comment.
  7. **Mandatory reading in `CLAUDE.md`**, as the owner asked: before changing a mod, read `docs/research/Mods`; before changing a plugin, mod-builder included, read `docs/research/claude-plugins`. The same section says the rule above: mods go through `/mod-builder:build` and `/mod-builder:edit`, and mod-builder through Anthropic's plugin documents and `/plugin-dev:skill-development`. It also says that Mod Lab's hooks module runs in the mod engine, so its code follows `docs/research/Mods` and `gotchas.md` too, as the owner asked when approving #138 (added after a side agent's note that the plugin documents don't cover the engine's rules).
  8. **`docs/research/claude-plugins` is committed**, with a README like `docs/research/Mods`'s, by the owner's ask once it became required reading (2026-10-23: "push the docs in addition to the updated documents via pr now"). It had been kept untracked since 2026-10-22, so only sessions on the owner's machine could read it. The seven pages are identical to the main folder's copy (`diff -r`), and a secret scan found nothing. Before the main folder is fast-forwarded past this merge, its untracked copy has to move aside, or `git merge --ff-only` refuses to overwrite it.
  9. **The skill review `/plugin-dev:skill-development` asks for.** Its skill-reviewer agent read both skills after items 1, 4 and 5. Its five findings on this change's own passages are taken:
     - **1.1:** the license is a SPEC slot (`templates/SPEC.template.md`), filled from the request, else `<root>/LICENSE`, else asked, so the person approves it at the gate. GPL text is asked, since it doesn't say `-only` or `-or-later`.
     - **1.2:** the scaffold command always passes both positional arguments, `""` for no license.
     - **1.3:** the managed lock is a failure-list case in build's step 4, with what to report, and so is `disableSideloadFlags` [read: `docs/research/Mods/Test and troubleshoot/Mods-reference.md:383`].
     - **1.5:** edit names the lock where step 0.4 asks which copy runs, and its hand-off no longer claims that build's bullet covers every case.
     - **1.4:** edit's stop gives its scope, the marketplace file, and where to change a plugin instead [read: `docs/research/claude-plugins/Create-a-Claude-Code-plugin.md:129`].
     - Its findings on text older than this change go to the owner as a possible follow-up. Among them: the second person throughout, build's step 4 and edit's step 0.4 being long enough for a references file, and build at 2,227 words, over the guide's 1,500 to 2,000.
- **Not changed:** Mod Lab's code; `ICON_MISSING`, which matters only for a submission to Anthropic's directory (#141); `git-branch`'s and `issue-forge`'s manifests.
- **What gets touched:** `CLAUDE.md`, `skills/edit/SKILL.md`, `skills/build/SKILL.md`, `skills/build/scripts/scaffold.mjs`, `skills/build/scripts/check-archetypes.sh`, `skills/build/templates/scaffold/.claude-plugin/plugin.json.tpl`, `skills/build/templates/README.template.md`, `skills/build/references/gotchas.md`, `.github/workflows/ci.yml` with `skills/build/ci/ci.yml`, `.claude-plugin/plugin.json`, this SPEC, and version 0.2.31 in `plugin.json` and the marketplace entry. No new reach.
- **Tests:**
  - **First, failing:** `scaffold.mjs` is code, so the archetype check first scaffolds one archetype with a license and expects `"license": "MIT"` in its `plugin.json`, and one without and expects no `license` line and no `__LICENSE__`. On today's scaffold the first fails.
  - The rest is skill text and configuration: the documentation review, and QA.
- **QA:**
  - `claude plugin validate --strict` for the marketplace and every plugin, on 2.1.309. CI runs it on 2.1.296.
  - `claude plugin test plugins/mod-builder`, the archetype check and the sandbox check.
  - `cmp` of the two `ci.yml` files.
  - **Live check:** `claude -p --debug-file <new log> --plugin-dir <worktree>/plugins/mod-builder "/modlab demo"`, since the manifest changes: loaded, admitted, and no failure line.
- **Version:** 0.2.31 (patch: skill text, templates and metadata; no change to commands, options or the state contract).

## Change 0.2.32 (2026-10-23)

> Issue #148, "mod-builder skills: imperative text, lean SKILL.md and references/, per /plugin-dev:skill-development". The owner chose it next: "#148 skill rewrite". And, before the rewrite: "use progressive disclosure where appropriate - do not make text ambiguous as you truncate or make it concise and thus losing contextual meaning".

- **How:** mod-builder is a plugin, so this change follows Anthropic's plugin documents and goes through `/plugin-dev:skill-development` (CLAUDE.md, "Read first"):
  - imperative instructions and third-person descriptions;
  - a lean `SKILL.md` that points to `references/` for detail;
  - the skill-reviewer agent at the end.

  A skill may carry supporting files beside its `SKILL.md`, and a frontmatter `name` sets its command name [read: `docs/research/claude-plugins/Add-components-to-a-plugin.md:222-260`], so `/mod-builder:build` and `/mod-builder:edit` keep theirs.
- **The method, from the owner's second sentence: a move, not a summary.**
  - Text that leaves a `SKILL.md` goes whole into a reference, with every `(docs, not observed)` and `[d.ts]` tag on its sentence.
  - Each `SKILL.md` keeps the steps, commands and pass criteria. It points to each reference, saying when to read it.
  - Nothing is shortened into something vaguer. The two skills were snapshot before the change, and after it each removed passage is found by a distinctive phrase in its new home.
- **What moves** (line numbers at `0982f59`):

  | From | To |
  | --- | --- |
  | build `:138-151`: the smoke test's log checks, including the managed-settings case | `skills/build/references/verify.md` |
  | build `:153-159`: a `--plugin-dir` copy replacing an installed one, and options in a `-p` run | `references/verify.md` |
  | build `:161-166`: the typecheck procedure (copy `tsconfig.check.json`, fill it, run `tsc`) | `references/verify.md` |
  | build `:169`: the `CLAUDE_CONFIG_DIR=$(mktemp -d)` sentence, moved as it is (see Open) | `references/verify.md` |
  | build `:170-181`: loading the mod live, both ways, and why `/reload-plugins` alone doesn't load an uninstalled one | `skills/build/references/loading.md` |
  | build `:204-216`: how later edits reach the copy that runs, and the Installed tab check | `references/loading.md` |
  | edit `:33-74`: which copy runs, covering the install records, `--plugin-dir`, the managed lock, archives, a folder's reloads and the protected path | `references/loading.md`, merged with build `:170-181` and `:204-216` as their union, since the three are near-copies |

- **What stays in build's step 4:**
  - The pass criterion (`:135-137`): the smoke test passes when it prints the command's text and its debug log shows this folder's code ran.
  - The `.catch` rule (`:168`), the rule on reporting failures, and the rule that an edit after Verify makes it stale (`:183-184`).
  - The command block. It gains the typecheck line, `npx -y -p typescript@5.6 tsc -p <copy>`, which today sits only in the prose that moves, with a pointer to `verify.md` for making the copy.
  - Each pointer says when to read the reference: "Before calling the smoke test passed, check its log as `references/verify.md` says."
- **What "their union" allows:** facts and their tags move word for word. A connective sentence that names the step that calls it, such as edit's "Two answers decide what makes your edit run. Note both for step 4 and the hand-off", is reworded for a reference both skills read. Each such sentence is listed in the Built block with its old and new wording.
- **Pointers that follow the move:** build's hand-off keeps its other bullets, and its "how later edits reach the copy they run" bullet becomes a pointer to `loading.md`. Edit's hand-off (`:125-127`) cites that bullet, so it points to `loading.md` too, and its three edit-only bullets stay.

- **What else changes:**
  - **Imperative text.** Every "you" in both skills means the model, never the person (checked line by line), so each becomes an instruction, and "the person" stays "the person".
  - **Build's own text:**
    - "in five steps with one gate" names step 0 too: step 0 orients, then five steps, 1 to 5, around one gate. That matches `docs/how-it-works.md:7` ("runs five steps around one approval gate"), whose table starts at step 1.
    - `<scratchpad>` is defined: the session's scratchpad directory, outside the repository and the mod.
    - "Walk through the demo and every 'Done means' bullet" names its actor: the person does it, in the live session, since a headless run can't press keys. The build reports it as pending until they have.
    - The file list names `references/verify.md` and `references/loading.md`, and says what `ci/` holds and when each file is used.
  - **Edit's own text:**
    - "Read it once before step 1" becomes "before step 0", since step 0 runs build's step 0.
    - The stage map uses edit's own numbers: Spec → 2, Logic → 3.1, Register → 3.2 to 3.3, Validate and Test → 4, README and Share → 5.
    - Step 0.4 keeps its two questions and points to `../build/references/loading.md` for the answers.
    - Step 1 asks step 0.4's `--plugin-dir` question too, when the request doesn't answer it. Today it says it asks "only about gaps in the change".
    - Step 3 gains build's demo step: `/<name> demo` shows every state the change adds or alters.
  - **The owner's choices** (2026-10-23):
    - Build's description drops the generic trigger "with tests" and keeps the spec-first routing, so "make a mod" stays with the built-in `plugin-authoring`: "Drop "with tests" only (Recommended)".
    - Edit's description drops the trigger "update <mod>", which can collide with `claude plugin update`, and keeps "update" among its verbs: "Drop it (Recommended)".
    - Build's file list names `scripts/check-archetypes.sh` and `scripts/check-sandbox.mjs` on one line, as this repository's maintainer checks, not part of a build: "List as maintainer checks (Recommended)".
  - **Not changed:** the skills' names, their steps' order and the gates, the templates, the scripts, Mod Lab's code, and the facts in any moved text.
  - **Scope:** this change moves text and changes no fact. So the skills' mod-building guidance isn't audited again against `docs/research/Mods` here; #119 did that (PRs #122 to #127). The passages moved were read against `docs/research/Mods/Create-a-mod.md:236-258` and `Test and troubleshoot/Troubleshoot-a-mod.md:17-21, :262-304`, and against `docs/research/claude-plugins/Create-a-Claude-Code-plugin.md:172-215`. Their facts and "(docs, not observed)" tags agree.
  - **Word counts** are recorded in the Built block as results, with no target: if build is still over 2,000 words after the move, it stays over rather than being cut.
- **What gets touched:**
  - `skills/build/SKILL.md` and `skills/edit/SKILL.md`.
  - New: `skills/build/references/verify.md` and `skills/build/references/loading.md`.
  - `CLAUDE.md`'s Architecture line, which lists the build skill's references.
  - `docs/how-it-works.md`'s gotchas count ("65 engine gotchas"), recounted, since #138 and #141 added entries.
  - The README's "Built on" line, this SPEC, and version 0.2.32 in `plugin.json` and the marketplace entry.
- **Open:** the `mktemp` sentence moves as it is. Its meaning isn't clear (`claude plugin test` is a shell command), and rewriting it would change a fact nobody has checked.
- **Tests and QA:** skill text only, so there is no red or green step.
  - `claude plugin validate --strict` for the marketplace and `plugins/mod-builder`.
  - The archetype check, since the build skill changes, and the sandbox check.
  - `test -e` on every path the two skills and the references name.
  - The moved-text check above.
  - The `-p` load check for the version bump.
  - The skill-reviewer agent, briefed with the move table so it checks the move as well as the prose.
- **Version:** 0.2.32 (patch: skill text).


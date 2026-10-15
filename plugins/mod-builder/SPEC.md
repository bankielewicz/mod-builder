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
- **Version:** 0.2.20 in `plugin.json` and the marketplace entry. This change was drafted as 0.2.18. PR #93 (#90) merged first with 0.2.18, and PR #85 holds 0.2.19. Merged from `main` after #93: only the README rows, `docs/mod-lab.md` and this SPEC conflicted.

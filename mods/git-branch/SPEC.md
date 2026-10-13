# Git Branch: SPEC

> A one-line band above the prompt naming the git branch the session is on, so I always know
> where my edits land without running `git status`. It stays quiet outside a repository.

**Non-negotiables** (the person's words; each becomes a test):
- "a band above the prompt showing the current git branch": the band's text always holds the
  branch name, or says plainly that HEAD is detached (with the short commit) or has no commits yet.

## Slots

| Slot | Kind | Value | Source |
| --- | --- | --- | --- |
| name (kebab-case, = plugin name = pane id) | REQUIRED | `git-branch` | request |
| archetype | REQUIRED | band | request ("a band above the prompt") |
| triggers (events it hooks) | REQUIRED | `session.start`, `command.run {command:'git-branch'}`, `tool.call {tool:'Bash'}` (after the result), `turn.complete`, `ui.render {component:'AbovePrompt'}` | derived |
| commands | REQUIRED | `/git-branch` [subcommands: `demo`, `hide`, `show`, `refresh`] | house + request |
| states drawn | REQUIRED | idle/live (branch line) · detached · unborn · empty (not a repo: hidden) · error (git fails: hidden) · survey (steps aside) · too-narrow (compact) · focus/folded n/a | ui-states.md |
| done means | REQUIRED | see below | |
| state lifetime | ARCH | session `$.state` atoms only; nothing stored across sessions | default |
| external reach | ARCH | one process: `git --no-optional-locks status --porcelain=v2 --branch` in the session's cwd, on each refresh. No network, no model calls, no files written | derived |
| depends on | ARCH | none | |
| options (userConfig) | ARCH | none | |
| home | HOUSE | `mods/git-branch/` (a plugin in the `claudemod` folder marketplace) | conventions.md |
| tsconfig | HOUSE | extends `./.claude-plugin/types/tsconfig.json` | conventions.md |
| state API | HOUSE | `atom/read/update` + `types/index.d.ts` PluginState | conventions.md |
| logic split | HOUSE | `$`-free `hooks/git-branch-logic.ts`; every `$` call in `hooks/register.tsx` | conventions.md |
| tests | HOUSE | `tests/git-branch-logic.test.ts`, `tests/ui.test.tsx` | conventions.md |
| demo | HOUSE | `/git-branch demo` shows every state without waiting for real events | conventions.md |
| built on | HOUSE | Claude Code 2.1.296 | `claude --version` |

## What gets touched

- **Files written:** `mods/git-branch/` (`SPEC.md`, `README.md`, `.claude-plugin/plugin.json`,
  `hooks/hooks.json`, `hooks/register.tsx`, `hooks/git-branch-logic.ts`, `types/index.d.ts`,
  `tests/git-branch-logic.test.ts`, `tests/ui.test.tsx`, `tsconfig.json`), and
  `.claude-plugin/marketplace.json` (one entry added).
- **Files outside the repo:** none (a scratch tsconfig for typechecking, in the session scratchpad).
- **Processes run while building:** `node scaffold.mjs`, `claude plugin validate`, `claude plugin test`,
  `claude -p --plugin-dir mods/git-branch "/git-branch demo"`, `npx -y -p typescript@5.6 tsc`.
- **Processes the mod runs at run time:** `git --no-optional-locks status --porcelain=v2 --branch`
  (read-only; `--no-optional-locks` so it never takes the index lock), at session start, after each
  Bash call and at the end of each main-loop turn. 5 s timeout.
- **Costs / hard to undo:** none.

## What I should see

```
 ⎇ feature/login-flow  ·  3 changed  ·  ↑2 ↓1                                
 ❯ _
```

- **Branch line** (accent `#D97757` glyph and name; the rest dim):
  - `⎇ main` when clean and level with upstream (or no upstream).
  - `  ·  3 changed` appended when the working tree has changes (tracked or untracked); warn colour.
  - `  ·  ↑2 ↓1` appended when ahead/behind upstream (each part only when non-zero).
- **States:**
  - *Live / idle:* the branch line above. No timers; it updates on the refresh events only.
  - *Detached:* `⎇ detached @ a1b2c3d` (warn colour for "detached").
  - *Unborn:* `⎇ master  ·  no commits yet` (dim suffix).
  - *Empty* (cwd is not a git repo): the band is hidden; `/git-branch` says "not inside a git repository".
  - *Error* (git missing or fails): the band is hidden; `/git-branch` prints `git-branch: git failed: <first line of stderr>`.
  - *Hidden:* `/git-branch hide` hides it for the session; `/git-branch show` brings it back.
  - *Survey:* steps aside (`e.props.hasSurvey`).
  - *Focus / Folded / Done:* n/a: a band has no focus, pane or completion.
  - *Too narrow:* below 40 columns, only `⎇ <branch>`; the branch name is cut with `…` to fit any width.
- **Narrow / wide:** ≥ 40 full line; < 40 branch only; any width truncates with `…`.
- **Other surfaces:** same tree on terminal, desktop, vscode and mobile.
- **Demo** (`/git-branch demo`): the band shows four sample lines (clean, dirty + ahead/behind,
  detached, unborn) until the next turn ends, then returns to the real branch.
- **Design bar:** dark, minimal. accent `#D97757`, warn `#E0B15A`, rest `dimColor`.

## How it works

1. **Read the branch (`$.process.run`):** `git --no-optional-locks status --porcelain=v2 --branch`
   in the session cwd. `parseStatus` (pure) reads `# branch.head`, `# branch.oid`, `# branch.ab` and
   counts the entry lines into `{ kind: 'branch' | 'detached' | 'unborn', branch, oid, ahead, behind, changed }`.
   Exit code 128 with "not a git repository" → `null` (empty); any other failure → `{ error }`.
2. **When it refreshes:** `session.start` (in the background after `next`), `tool.call {tool:'Bash'}`
   after the call returns (catches `git checkout`, `git commit`), `turn.complete` on the main loop
   (catches edits), and `/git-branch refresh`. Each writes the `snapshot` atom; the write redraws the band.
   An in-flight guard skips a refresh while one is running.
3. **Draw (`ui.render {component:'AbovePrompt'}`):** `const rest = await next(e)`; return `rest`
   alone when surveyed, hidden, `maxRows < 1`, no snapshot or an error; else `bandParts(snapshot, bodyColumns - 2)`
   (pure) above `rest`. A throw returns `rest`.
4. **Command (`command.run`):** answers at once; with no args it prints the current line (or why there
   is none) and refreshes. `demo` sets the `isDemo` atom, which `turn.complete` clears.
5. **Guards:** the Bash `tool.call` hook only reacts to the result, and carries `.catch(($, e, next) => next(e))`.

## Tests (`claude plugin test`)

1. `parseStatus`: a branch with `branch.ab +2 -1` and 3 entry lines → `{kind:'branch', branch, ahead:2, behind:1, changed:3}`.
2. `parseStatus`: `branch.head (detached)` + oid → `{kind:'detached', oid}`; `branch.oid (initial)` → `{kind:'unborn'}`; no upstream line → ahead/behind 0.
3. `bandParts`: clean → text `⎇ main`; dirty/ahead/behind → `⎇ main  ·  3 changed  ·  ↑2 ↓1`; detached → `⎇ detached @ a1b2c3d`; unborn → `no commits yet`.
4. `bandParts`: width 30 → branch only; a 200-char branch at width 40 → total ≤ 40 chars and ends in `…`.
5. UI: mount `AbovePrompt` on terminal and desktop with a stubbed `git` answer → finds `⎇ feature/x`;
   the band below still renders; `hasSurvey` → only the band below.
6. UI: git answers "not a git repository" → band hidden; `/git-branch` says "not inside a git repository".

## Done means

- I open a session in a repo and see `⎇ <branch>` above the prompt; after Claude runs
  `git checkout -b x` the band reads `⎇ x` by the time the turn ends.
- Outside a repo nothing is drawn.
- All tests pass; `claude plugin validate` is clean (every gating hook has a `.catch`); `tsc` is clean.
- `/git-branch demo` shows every drawn state.
- README has the install line and the "What it reaches" table generated from `validate`.

## Handoff

How to load it (`/plugin install git-branch@claudemod` or `claude --plugin-dir mods/git-branch`),
`/git-branch demo`, `/git-branch hide|show|refresh`, and that `/reload-plugins` picks up edits.

## Change 0.1.1 (2026-10-12)

> Fix from the Codex review of PR #1.

- **What changes:** a refresh asked for while a git read is in flight now queues one fresh read after it (shared by everyone who asks meanwhile), instead of reusing the read that started before the branch changed.
- **What gets touched:** `hooks/register.tsx`, `tests/ui.test.tsx`.
- **Tests:** a refresh during a slow read reports the new branch, after exactly one more read.
- **Done means:** all tests pass, validate is clean.


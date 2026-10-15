# Duet: SPEC

> An orchestration mod that delegates work between Claude Code and Codex. A setting assigns
> subagent types to Codex; when Claude spawns one of those, Codex does the work instead and its
> answer comes back as the subagent's result. `/duet review` gets an independent Codex review of
> the exact diff, never the implementer's summary. Every run is measured, so routing grows from
> evidence, not from "Claude is best at X". A pane shows who owns each task, its status, usage and blockers.

**Non-negotiables** (the person's words; each becomes a test):
- "expose a configure parameter that allows users to assign subagents to be redirected to either
  claude or codex": a `userConfig` field lists the subagent types routed to Codex; any other type stays Claude.
- "must preserve each worker's sandbox and approval controls": Codex always runs under its own
  sandbox (`read-only` by default, `workspace-write` only if configured), approvals set to `never`
  so nothing unanswerable escalates, and never `--dangerously-bypass-*` or `--approve-for-me`.
- "Each handoff should carry the task ID, specification version, base/candidate commit, allowed
  files, prohibited actions and required output": the handoff envelope has all six.
- "Neither worker should be able to approve its own phase transition": the mod never applies a
  review's fixes, never chains review → fix → review, and never routes a review to the provider that implemented.
- "limits on retries, delegation depth and concurrency": 0 automatic retries; only main-loop Agent
  calls are routed (depth 1); `maxConcurrent` Codex runs at once, beyond which the call is refused.
- "don't copy Claude credentials into Codex": the Codex child runs with Claude Code's credential and provider variables blanked (a fixed list, `BLANKED_ENV`: the host environment can't be listed); Codex uses its own saved sign-in.
- "an explicit policy for which repository content may be sent": before the first handoff of a
  session, the mod asks once, naming the folder Codex will read; "no" refuses every routed call this session.
- "Never quietly" (house): a Codex failure is a visible refusal with the reason, never a silent fallback to Claude.
- (0.2.0) "the best of both worlds of using claude & codex both as an advisory role vs
  implementer/adversarial/contributor", "delegation of custom subagents … via the .claude/agents/
  subagents": Codex roles are agent types Claude can pick by name; Claude roles stay `.claude/agents`
  files; `codexAgents` still sends any existing type to Codex.
- (0.2.0) "Count background Claude runs": `/duet stats` counts Claude subagents that run in the
  background or as teammates, not only ones that answer in place.
- (0.2.0, from the diagnosis) A routing setting never silently doesn't apply: whatever duet keeps on
  Claude despite `codexAgents`, `/duet` says so in the same line that names the routes.

## Changes in 0.2.0

Why: with `codexAgents: *`, two probe subagents still ran on Claude. They carried a `name`, and
routing rule 1 keeps named, isolated and nested calls on Claude, but `/duet` printed
"codex ← every subagent type" with no exceptions. `name` is chosen by Claude, not the person, so
whether work reached Codex hung on a choice nobody saw. Separately, a routed call held the main
session for the whole Codex run (the probe: ~2 min; the limit: 20), while Claude subagents run in
the background; and Claude's background runs were never measured, so stats compared nothing.

**A. Codex roles as agent types.** At `session.start` duet calls `$.agent.register` for each role.
The engine lists them to Claude as `duet:<name>` with their `description`, so Claude can choose a
Codex role on purpose. Duet's routing hook always answers them (they never run on Claude); the
registered `prompt` is the role's instructions in the handoff, and `tools` drives the existing
read-only clamp.

| Type | Registered when | Sandbox | Default mode | Description Claude reads |
| --- | --- | --- | --- | --- |
| `duet:codex-advisor` | always | read-only | **wait** (Claude needs the answer before going on) | Runs on Codex (OpenAI), not Claude. A second opinion from another model family on a plan, design, approach or root cause. Reads the repo; never edits. |
| `duet:codex-reviewer` | always | read-only | **background** (an independent check that can land later) | Runs on Codex (OpenAI), not Claude. Adversarial review of a diff or files: judges the code that is there, ignores any summary of intent, reports findings with file:line and severity. Never edits. |
| `duet:codex-implementer` | only when `codexSandbox` is `workspace-write` | workspace-write | **wait**, always (it edits) | Runs on Codex (OpenAI), not Claude. Makes a scoped change under the session folder (no commits, pushes, installs or network) and reports what it changed. |

Each description ends with how the role answers under the current settings, built at registration
(`roleDescription`): `Claude waits for its answer; it can't be messaged afterwards.` or `Answers in
the background, as a message when it ends; it can't be messaged afterwards.` A config change reloads
duet, which registers again, so what Claude reads always matches what happens.

Claude-side roles need nothing from duet: `.claude/agents/*.md` (e.g. `diff-reviewer`,
`code-explorer`, `test-writer`) are already Claude's. A custom agent listed in `codexAgents` is still
sent to Codex with its body as role instructions (unchanged).

**B. Routing rules.**
1. `duet:*` type → Codex, **even with a `name`** (the choice is explicit; the role description
   already says it can't be messaged). From inside a subagent (`e.agentId`) → refused:
   `duet: Codex roles run only from the main session; the duet:<role> subagent did not run.` With
   `isolation` → refused: `duet: Codex roles can't run isolated (worktree/remote); …`.
2. Type in `codexAgents` (including `*`) → Codex, **except** named, isolated or nested calls, which
   stay on Claude as before (a named Claude agent can be messaged; a Codex run can't).
3. Anything else → Claude.

`/duet`, `/duet routes` and the pane state the exceptions and the roles (see "What I should see").
Duet does not change the person's `codexAgents`; the handoff notes that `*` also sends Claude Code's
own `Explore`/`Plan` calls to Codex.

**C. Wait or background, per role** (chosen at approval: per-role defaults). A run's mode is, in
order: an override for its type in `codexRunMode`, else its role's default (table above), else
`codexRunMode`'s default for `codexAgents` types (`background`). `codexRunMode` is one text field:
`<wait|background>[, <type>=<wait|background>]…`, e.g. `background, advisor=background, Explore=wait`;
roles may be named `advisor`, `codex-advisor` or `duet:codex-advisor`; `foreground`/`sync` read as
`wait`, `bg`/`async` as `background`; a part that doesn't parse is refused with its text. A run that
can edit always waits (below), whatever the mode says. Claude can't choose per call: the Agent tool
has no `run_in_background` in this build, so the type's mode is the only lever.

A routed **read-only** call in background mode, once consent and the concurrency limit pass, is answered at once with the Agent tool's
`async_launched` record: `agentId: duet-d<n>`, `description`, `prompt`, `outputFile` =
`~/.claude/duet-data/sessions/<session>/d<n>.out.md` (a placeholder while it runs, Codex's answer when it ends),
`canReadOutputFile: true`, `canContinueAgent: false`. Codex keeps running (`void … .catch`); when it
ends duet delivers the answer with `$.prompt.submit({ text })`: a turn of its own once the session
is idle, which the model reads as "The duet plugin sent a message:" (the same way a background
agent's notification arrives), plus the toast and pane row as before. A failure is delivered the
same way, never quietly. `foreground` keeps 0.1.0's behaviour (the call waits).
   - *Build note:* `$.session.send` to the session's own id was tried first and refused (`no live
     session on this machine has id …`); `$.prompt.submit` was then verified live with a throwaway
     mod under `claude -p` (delivered as a new turn after the launching turn ended).
   - **Editing runs always wait (foreground).** A run whose effective sandbox is `workspace-write`
     (`duet:codex-implementer`, or an editing type under `workspace-write`) runs in the foreground
     whatever `codexRunMode` says: Claude waits, so the two never edit the same files at once.
   - **Read-only runs skip the before/after diff.** Codex's sandbox can't write, so the candidate is
     `read-only run: no files changed`, not a `git status` comparison that would credit Claude's own
     concurrent edits to Codex. Editing runs keep the comparison, worded `files changed during this
     run: …` (a Claude subagent already in the background may have touched some).
   - Deferred: a git worktree per editing run, which would let editing runs go to the background too.
   - Live runs are counted from the `tasks` atom, not a module variable, so a reload can't reset
     the limit. On `session.start`, a task still `running` that this module didn't start was cut off
     by a reload: it is marked `error` (`lost when duet reloaded`) and that failure is delivered.
   - **Build gate (passed):** a hook-made `async_launched` record is accepted (the model read
     "The agent is working in the background. You will be notified automatically when it
     completes."), and `$.prompt.submit` delivers (see the build note).
   - Deferred to 0.3.0: forcing a **Claude** subagent type to wait or go to the background with an
     `agent.spawn` hook rewriting `background` (teammates are always background, and an agent
     file's `background: true` wins, so it can't be guaranteed). An agent file's own
     `background: true` already sends a Claude type to the background.

**D. No false SendMessage offer.** Every Codex record (`completed` and `async_launched`) sets
`canContinueAgent: false`, the engine's own flag for "can't be continued with a follow-up
message", and the footer adds `one-shot run: start a new duet task to follow up`. Verified live:
the hand-back no longer ends with `use SendMessage with to: 'duet-d<n>'`.

**E. Counting background Claude runs.** For a main-loop call that stays on Claude, if `next(e)`
answers `async_launched` or `teammate_spawned`, duet keeps `{ agentId → startedAt, type,
description }` in atom `claudePending`. The first `turn.complete` carrying that `agentId` logs the
Claude row (duration = `durationMs` of that turn's end minus `startedAt`, tokens from `e.usage`,
`ok` = not `isAborted`) and drops it from `claudePending`. `completed` answers are logged as before.

**F. Ship.** Version `0.2.0` in `plugin.json` and `marketplace.json`; after Verify passes,
`claude plugin update duet@claudemod` so sessions load it (the installed 0.1.0 copy predates even
`/duet config`).

## Slots

| Slot | Kind | Value | Source |
| --- | --- | --- | --- |
| name | REQUIRED | `duet` | chosen (short; no built-in `/duet`) |
| archetype | REQUIRED | pane-command [+ `tool.call {tool:'Agent'}` routing hook in guard form, + `turn.complete` to clear the demo] | request ("one operator interface" + routing) |
| triggers | REQUIRED | `session.start` (+ `$.agent.register`, 0.2.0), `command.run {command:'duet'}`, `tool.call {tool:'Agent'}`, `turn.complete`, `ui.render {component:'Pane', requestId:'duet'}` | derived |
| commands | REQUIRED | `/duet` (toggle pane) · `demo` · `review [--base <branch> \| --commit <sha>]` · `stats` · `routes` · `config [list \| models \| <field> <value>]` | request |
| states drawn | REQUIRED | empty · live · done · error · folded · too-narrow · focus; survey n/a (pane) | ui-states.md |
| done means | REQUIRED | see below | |
| state lifetime | ARCH | session atoms (tasks, consent); runs log across sessions in `~/.claude/duet-data/runs.jsonl` | measurement ask |
| external reach | ARCH | processes `codex exec`, `codex exec review`, `git`; network to OpenAI **through Codex**, with repo content; Codex subscription usage | request |
| depends on | ARCH | Codex CLI on PATH, signed in (`codex login`); tested on codex-cli 0.162.1 | probe |
| options (userConfig) | ARCH | see table below | request |
| home / tsconfig / state API / logic split / tests / demo | HOUSE | as conventions.md: `mods/duet/`, atoms + contract, `hooks/duet-logic.ts`, `tests/`, `/duet demo` | conventions.md |
| built on | HOUSE | Claude Code 2.1.296 · codex-cli 0.162.1 (0.2.0: same) | `--version` |

### Options (`userConfig`, in the config menu)

| Key | Type | Default | What it does |
| --- | --- | --- | --- |
| `codexAgents` | string | `""` (nothing routed) | Comma-separated subagent types sent to Codex, e.g. `general-purpose, Explore`. `*` routes every type. Unlisted types stay on Claude. |
| `codexSandbox` | string picker `read-only` / `workspace-write` | `read-only` | Codex's sandbox for routed subagents. `read-only` can investigate and answer but not edit. `danger-full-access` is deliberately not offered. |
| `codexModel` | string | `""` (Codex's own config) | `-m` for Codex runs. |
| `maxConcurrent` | number | `2` | Codex runs at once; a routed call beyond it is refused with a reason. |
| `timeoutMinutes` | number | `20` | A Codex run past this is stopped and the call refused. |
| `codexConsent` | string picker `ask` / `allow` | `ask` | `ask`: once per session, before the first handoff. `allow`: you pre-approve sending to Codex (needed for headless `claude -p`, where nobody can be asked). |
| `codexRunMode` (0.2.0) | string | `background` | `wait` or `background` for `codexAgents` types, then per-type overrides: `background, advisor=background, Explore=wait`. Roles default to advisor wait, reviewer background, implementer wait. A run that can edit always waits. Config alias `mode`. |

### Custom subagents (`.claude/agents/*.md`) (added at approval)

A custom agent is spawned with its `name` as `subagent_type`, so `codexAgents` routes it like any
built-in type. For a routed custom agent the mod finds its definition by Claude's discovery rules
(0.2.7) with `$.fs.list` and `$.fs.read`, and pure `parseAgentFile` takes its frontmatter
(`name`, `description`, `tools`, `model`) and body:
- the folders searched, nearest first, are each `.claude/agents/` from the session folder up to the repository root (the nearest folder holding a `.git` entry, as Claude finds it, even one git can't read; with none, up to the filesystem root), then `~/.claude/agents/` (`HOME`, else `USERPROFILE`, with `/` separators). Each is searched with all its subfolders, dot-folders included, to 8 folders deep and 500 `.md` files (Claude has no such limits). Symbolic links are followed, as Claude follows them; a folder whose real path was already searched in that lookup isn't searched again;
- a file matches on its frontmatter `name` alone (quotes and a trailing ` # comment` removed), never on its file name; a value may start on the next indented line or wrap onto it. A file with no `name` or no `description`, or a `name` that starts with `-`, contains `:` or is over 256 characters, is skipped as Claude skips it (`pickAgent`);
- the nearest folder with a match wins. Two matches in that folder that differ on `canEdit` give the one that can't edit, since Claude's choice between them isn't documented;
- the body goes into the handoff as **Role instructions**, ahead of the task;
- `tools:` that grants no edit tool (no `Edit`, `Write`, `NotebookEdit`, `MultiEdit`) **clamps Codex to `read-only`**, whatever `codexSandbox` says (an agent can only lower the sandbox, never raise it);
- `model:` is not mapped to Codex (Claude aliases mean nothing there); `codexModel` applies.
- no match → routed as a plain type, with no role instructions, and `read-only` (only `general-purpose` edits without a definition). Agents from managed settings, `--agents`, a plugin (`<plugin>:<name>`) and `--add-dir` folders aren't reachable from the types, so they are this case, unless a project or user file has the same `name`: duet then uses that file, though Claude runs the higher-priority one. A plugin agent can't collide, since a `name` with `:` is skipped.
- the folders are listed on every routed call; a file is read again only when its size or modification time changed.

Three example agents are written to this repo's `.claude/agents/` to prove it end-to-end:
`code-explorer` (read-only: Read, Grep, Glob), `test-writer` (Read, Write, Edit, Bash) and
`diff-reviewer` (read-only: Read, Grep, Glob, Bash).

## What gets touched

- **Files written (repo):** `.claude/agents/code-explorer.md`, `test-writer.md`, `diff-reviewer.md` (examples); `mods/duet/…` (SPEC, README, plugin.json, hooks.json, register.tsx,
  duet-logic.ts, types/index.d.ts, tests, tsconfig.json, .gitignore); one entry in `.claude-plugin/marketplace.json`.
- **Files read at run time:** the `.md` files under each `.claude/agents/` from the session folder up to the repository root, and under `~/.claude/agents/`, for routed types (0.2.7; before, only `.claude/agents/<type>.md` and `~/.claude/agents/<type>.md`).
- **Files outside the repo, at run time:** `~/.claude/duet-data/runs.jsonl` (one line per run: id,
  kind, provider, model, subagent type, start, duration, tokens, exit, outcome; **no prompt text**),
  and `~/.claude/duet-data/sessions/<session>/review-<id>.md` (each review's full text, for `/duet show <id>`). *(Build note: Codex's answer is read from its JSONL stream, so no schema or last-message temp files are written.)*
- **Processes the mod runs:** `codex exec --json -s <sandbox> -c approval_policy="never" -C <cwd> -o <file> [-m <model>] -`
  (prompt on stdin), `codex exec review --json -c sandbox_mode="read-only" -c approval_policy="never" …` (review has no `-s` flag), `git rev-parse HEAD`, `git diff --stat <base>`, `git status --porcelain`.
- **Leaves the machine:** whatever Codex reads under the session folder, plus the handoff prompt, goes to
  OpenAI under **your Codex sign-in and its usage limits**. Asked once per session first.
- **Can change files:** only if you set `codexSandbox` to `workspace-write`: Codex may then edit files
  under the session folder (its sandbox blocks network and paths outside it). Nothing is committed or pushed by the mod.
- **Bypasses:** a routed Agent call is answered by the mod **above Claude's permission check** for the
  Agent tool, so Codex's sandbox is the control for that work, not Claude's prompts. This build gives
  mods no way to read the session's permission mode, so **plan mode does not lower Codex's sandbox**;
  that is why the default is `read-only`.
- **Blocks the turn:** for runs whose mode is `wait` (the advisor by default) and every run that can
  edit. A background run answers at once and its answer arrives later through `$.prompt.submit`
  (see Changes C). The pane and status line show progress either way.
- **(0.2.0) Adds to Claude's agent list:** `duet:codex-advisor`, `duet:codex-reviewer`, and
  `duet:codex-implementer` only under `workspace-write`, through `$.agent.register`. Claude sees their
  descriptions in every session duet is enabled in, which is a few hundred tokens of context.
- **(0.2.0) Turns started in the session:** one `$.prompt.submit` per finished background Codex run
  (its answer or its failure) and per run a reload cut off; each is a Claude turn of its own, as a
  background agent's notification is, so it costs Claude tokens.
- **(0.2.0) Files outside the repo:** `~/.claude/duet-data/sessions/<session>/d<n>.out.md`, each background run's streamed
  text (the `outputFile` Claude may read). `claude plugin update duet@claudemod` after Verify
  rewrites the installed copy under `~/.claude/plugins/cache/claudemod/duet/` (you approved this).
- **Costs:** Codex usage per routed call and per review (the probe "reply ok" used ~22k input tokens, mostly Codex's own system context). No Claude model calls by the mod.
- **Processes run while building:** scaffold, `claude plugin validate`/`test`, `claude -p --plugin-dir mods/duet "/duet demo"`, `tsc`. One more tiny live Codex call to verify the handoff end-to-end (read-only, `--ephemeral`).

## What I should see

```
 D U E T                                   2 routed · 1 running · 5 done
 ──────────────────────────────────────────────────────────────────────────
 ▸ d7  codex  gpt-5.x      general-purpose  running   1m12s   38k tok
       "Find every caller of parseConfig and list risky ones"
   d6  codex  gpt-5.x      review --base main  done   2m40s   61k tok
       verdict: changes requested · 3 findings (1 high)
   d5  codex  gpt-5.x      Explore          error     0m04s       –
       ✕ codex: not signed in. Run `codex login`, then retry.
   d4  claude (routed: no) Plan             –  (stays on Claude; not tracked)
 ──────────────────────────────────────────────────────────────────────────
 routes  codex ← general-purpose, Explore   sandbox read-only   max 2
 [ Review diff ]  [ Stats ]  [ Close ]                ctrl+x tab: keys
```

0.2.0 replaces the routes line with two (full and medium layouts; compact hides them, as before):

```
 routes  codex ← every subagent type · named, isolated, nested stay Claude
 roles   advisor waits · reviewer bg · others bg   read-only · max 2
```

`/duet` (open) and `/duet routes` print one line:
`codex ← every subagent type (named, isolated and nested calls stay on Claude), background · roles duet:codex-advisor (waits), duet:codex-reviewer (background) · sandbox read-only · max 2`
(`nothing routed` drops the parenthesis and mode; type overrides follow the mode, `waits; Plan
background`; `workspace-write` adds the implementer and `· editing runs wait`.)

A background run's delivered message (to the main session):

```
Background agent duet-d3 (duet:codex-reviewer) finished on Codex · gpt-6.1-sol · read-only · 2m14s · 61k tok

<Codex's final answer, verbatim>

[duet d3 · codex gpt-6.1-sol · sandbox read-only · base 45798a0 · read-only run: no files changed · one-shot run: start a new duet task to follow up]
```

…or on failure: `Background agent duet-d3 (duet:codex-reviewer) failed on Codex: timed out after 20m. It did not run on Claude either.`
(It leads with the agent id the `async_launched` record gave, so Claude ties it to the launch.)

- **Masthead:** `D U E T`, accent; right side the counts.
- **Rows:** one per Codex task this session, newest first, max 8 shown. Id, provider, model, kind,
  status (`running` accent, `done` success, `error` error, `refused` warn), elapsed, tokens; under it, the
  task description (dim) or, for a review, the verdict line; for an error, `✕` and the first line of the reason.
- **Selected row (focus, j/k buttons):** expands to show the handoff envelope: task id, spec version, base
  commit, candidate (`git diff --stat` summary), sandbox, allowed scope.
- **Footer:** the routes line and buttons **Review diff** (r) → runs `/duet review` against the
  uncommitted changes; **Stats** (s) → shows the stats block in place of the rows; **Close** (c).
- **States:**
  - *Empty:* `No Codex tasks yet. Route a subagent type in /config → duet, or run /duet review.` Routes line still shown (`codex ← nothing routed`).
  - *Live:* running rows tick their elapsed time once a second (one clock, only while a run is live).
  - *Done:* row turns success; toast `d7 done on codex · 1m12s`.
  - *Error:* row `✕` + reason, e.g. `codex not found on PATH`, `codex: not signed in…`, `timed out after 20m`, `limit: 2 Codex runs already running`, `you declined sending this repo to Codex this session`.
  - *Folded:* status `codex: 1 running · 5 done` while anything ran this session; cleared when nothing has.
  - *Too narrow:* toast `Duet needs a wider window. Widen it to see the pane, or watch the status line.`
  - *Focus:* brighter border, selected row expanded, hotkeys live.
- **Narrow/wide:** ≥ 60 columns as drawn; 40–59 drops model and tokens; < 40 one line per task: `d7 codex running 1m12s`.
- **Stats view (`/duet stats` text and the Stats button):** per provider × kind × subagent type: runs, ok %, median time, median tokens, from `runs.jsonl`. Claude rows come from the subagents the mod saw stay on Claude (duration and tokens from their Agent result) so the two can be compared.
- **Other surfaces:** same tree on desktop/vscode; mobile gets the < 40 layout.
- **Design bar:** dark, minimal; accent `#D97757`, success `#7FB685`, warn `#E0B15A`, error `#E06C6C`.

## How it works

1. **Routing (`tool.call {tool:'Agent'}`, guard form with `.catch`):** reads `subagent_type`
   (default `general-purpose`). Calls `next(e)` untouched when the type isn't in `codexAgents`, when
   the call is inside a subagent (`e.agentId` set: depth stays 1), or when it names a teammate
   (`name`/`team_name`) or `isolation`. Unrouted calls are measured after `next(e)` as Claude rows (duration, tokens, type). Otherwise:
   *(0.2.0: the rules are Changes B; `duet:*` types route despite `name`; step 6 answers per
   Changes C; background Claude runs are measured per Changes E.)*
   1. **Consent** (once per session, `$.ui.ask`): "Send this task to Codex (OpenAI)? Codex can read `<cwd>` under your Codex sign-in." Yes / No. No → this and every later routed call refuse. Dismissed, or nobody to ask (`-p`) → this call refuses and the next one asks again: `duet: you declined sending this repo to Codex this session; the subagent did not run.`
   2. **Concurrency:** more than `maxConcurrent` live runs → `{ deny }` with the limit.
   3. **Envelope** (pure `buildHandoff`): task id `d<n>`, spec version = short hash of the prompt, base commit (`git rev-parse HEAD`, or `none`), allowed scope = cwd, sandbox, prohibited actions (no commits, pushes, branch changes, package installs, network, or files outside cwd), required output (a final answer, plus files changed if any). The prompt Claude wrote goes in verbatim.
   4. **Run** (`$.process.spawn` of `codex exec --json …`, prompt on stdin, env with Claude credentials blanked); each JSONL line updates the task atom (pure `foldEvent`: `agent_message` text, `turn.completed` usage, `error` items as warnings; a final `error`/non-zero exit is the failure). Elapsed is checked on every chunk and against `timeoutMinutes`; breaking the loop kills Codex. If spawn rejects its first pull, falls back to `$.process.run` with the same argv.
   5. **Candidate:** `git diff --stat <base>` + `git status --porcelain` after the run, as evidence.
   6. **Answer:** `{ result }` in the Agent tool's own `completed` shape (pure `agentResult`): content = Codex's final message + a footer `[duet d7 · codex <model> · sandbox read-only · base abc1234 · changed: 2 files (+10 −3)]`, usage mapped from Codex's tokens. 0 retries.
   7. **Measure:** one line appended to `runs.jsonl` via `$.fs`.
   - `.catch`: `next.called ? next(e) : { deny: 'duet: the Codex handoff failed (<reason>); the subagent did not run.' }`.
2. **Review (`/duet review`):** asks for consent and checks the concurrency limit, answers `started` or `not started: <reason>` once they have decided, and runs Codex in the background: `codex exec review --json -s read-only` with `--uncommitted` (default), `--base <branch>` or `--commit <sha>`, instructions "review against the stated intent; report findings with file:line and severity; do not trust any summary". No implementer summary is passed. Verdict and findings land in the task row and a toast; `/duet` shows them. The mod never applies them or re-dispatches.
3. **Pane (`ui.render {component:'Pane', requestId:'duet'}`):** reads `tasks`, `view`, `selected` atoms; `$.ui.open` from the command or a button; `isPlaced: false` → toast. Elapsed ticks via one `$.clock.every(1000)` only while a task is running, cancelled when none is.
4. **Status (`$.ui.status`):** `1 running · 5 done` while anything ran; `undefined` otherwise.
5. **Stats (`/duet stats`):** reads `runs.jsonl`, pure `summarize` → table text.
6. **Routes (`/duet routes`):** prints which types go where and the sandbox, from options.
7. **Config (`/duet config [list | models | <field> <value>]`):** with no argument, opens pane `duet-config` (focused): one row per `userConfig` field with its value, the highlighted row's help line under the list, `•` on an edited row. Buttons with hotkeys drive it (no reliance on the focus ring between fields): `j`/`k` move the highlight (`configAt`); `e` on a choice field steps to its next choice, on a text or number field opens one `Input` (`cfg-edit`, focused with `$.ui.focus`; `configEditing`) whose Enter sets the draft. Edits go to `$.state` `configDraft`; nothing is written until **Save** (s), which checks every edited value (a choice field's options, a number ≥ 0, timeout ≥ 1) and, only if all fit, writes each changed one through `$.config.set` on its `/config` row. Each write reloads the module, so `configSaving` stays true until the last write and `session.start` resumes a save a reload cut short. A save that writes stamps `configReopenAt`; the `session.start` of the reload it causes (within 60 s, once) reopens the pane if the reload dropped it and puts the keys back on it (`$.ui.focus` on `cfg-change`), the highlighted row kept, so the next option can be edited without `/duet config` again. A pick from the model list says it is unsaved (`model → <slug>, not saved yet: s saves, u reverts.`). **Revert** (u) clears the draft; **Close** (c). On a surface with no `Input` (mobile) the pane prints the options as text. `list` prints them as text; `<field> <value>` (name or alias, `""` clears a text field) writes one at once. A refusal is printed as given.
   **Model picker:** on the `model` row the pane lists Codex's models from `codex debug models` (Codex refreshes its catalog on that call), fetched the first time the row is highlighted and again on **Refresh** (r); stored in `configModels`, fetch status in `configModelsState`. The list is hidden until `e` (Choose model) or `r` opens it (`configPicking`); hidden models are left out; `1`–`9` put a model in the draft, `0` empties it (Codex's own default), and either closes the list; `✓` marks the current value; `t` closes it and opens the text box for any slug; moving off the row or Revert closes it too. A value not in the catalog shows a warning naming the nearest slug (`"gpt-6sol" is not in Codex's model list; did you mean gpt-6-sol?`) but is not refused, since Codex may accept models its catalog does not list. A failed fetch shows its reason and r retries. `models` prints the catalog as text; `model <slug>` adds the same warning as a note.
8. **Demo (`/duet demo`):** fills the task atom with one task in each state (running, done, done-review, error, refused) and opens the pane; nothing runs; cleared when the turn ends.

## Tests (`claude plugin test`)

1. `parseRoutes("general-purpose, Explore")` → set of 2; `"*"` → all; `""` → none; `isRouted` honours it; default type `general-purpose`.
2. `foldEvent` over the **real 0.162.1 JSONL** captured during orientation → text `ok`, usage `{in:22059, cached:11264, out:5}`; an `error` item mid-run is a warning, not a failure.
3. `buildHandoff` contains task id, spec version, base commit, allowed scope, the prohibited-actions list and required output; the prompt verbatim.
4. `codexArgv`: always `-c approval_policy="never"`, `-s` the configured sandbox; review always `read-only`; never contains `dangerously` or `approve-for-me`; `danger-full-access` in config is clamped to `read-only`.
5. `childEnv` blanks `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN` (the list has grown since: Changes 0.2.2 and 0.2.5).
6. `agentResult` has every required field of the Agent `completed` record (status, agentId, content, prompt, totalToolUseCount, totalDurationMs, totalTokens, usage with nullable keys).
7. Event: a routed `general-purpose` Agent call with `process.run` stubbed (spawn can't be stubbed) and consent "Yes" → the Agent tool never runs beneath; the result text holds Codex's answer and the `[duet d1 · codex` footer.
8. Event: an unrouted `Plan` call → reaches the tool beneath untouched.
9. Event: consent "No" → `{ deny }` naming the decline; a second routed call is refused without asking again.
10. Event: `maxConcurrent: 0` (or full) → deny naming the limit; codex not found (run rejects) → deny with reason; never falls through to the tool beneath.
11. Event: a routed call with `agentId` set (inside a subagent) → passes through untouched.
12a. `parseAgentFile`: frontmatter + body; `tools: Read, Grep, Glob` → read-only clamp; `tools: Read, Edit` → no clamp; no `tools:` (all tools) → no clamp; `effectiveSandbox` never raises above the configured one.
12b. Event: routed `code-explorer` with its file present → the Codex prompt (stdin) holds its body under "Role instructions" and the argv has `-s read-only` although `codexSandbox` is `workspace-write`.
12. `summarize` over sample lines → per-group runs, ok %, medians.
13. UI: Pane on terminal + desktop after `/duet demo` → finds `D U E T`, `running`, `verdict`, `✕`; press `s` → stats view; empty state copy when no tasks; band below n/a.

Added in 0.2.0:

14. Event (the diagnosis): `codexAgents: *`, a `general-purpose` call **with `name`** → reaches the tool beneath (Claude); `routesText` for `*` contains `named, isolated and nested calls stay on Claude`.
15. Event: a `duet:codex-reviewer` call with `name` set and `codexAgents: ""` → routed to Codex; its handoff holds the reviewer role's instructions; argv `-s read-only`.
16. Event: `duet:codex-advisor` with `agentId` set → deny naming "only from the main session"; with `isolation: 'worktree'` → deny naming isolation; neither reaches the tool beneath.
17. `session.start` registers `codex-advisor` and `codex-reviewer`; `codex-implementer` only with `codexSandbox: workspace-write` (registrations read back from the test's `agent.register` hook).
18. Event, background: `duet:codex-reviewer` answers `async_launched` with `agentId: duet-d1`, `outputFile` `…/d1.out.md`, `canContinueAgent: false`; after the run settles, one `prompt.submit` whose text has the answer, the `read-only run: no files changed` footer, and the out file holds the answer. A failed run submits `failed on Codex` and the reason.
19. Event, wait (`codexRunMode: wait`): the `completed` record, now with `canContinueAgent: false` and the one-shot footer.
20. Logic: `lostOnReload` marks running Codex rows this module didn't start as `lost when duet reloaded` and `liveCount` drops them (logic test only: the kit can't reload a module mid-test or seed `$.state`, and the `session.start` side was not verified live in this build).
21. Event: an unrouted call whose `next(e)` answers `async_launched` (agentId `a9`), then a `turn.complete` with `agentId: 'a9'` and usage → one `claude` row in `runs.jsonl` with its tokens; a second `turn.complete` for `a9` adds nothing.
22. Per-role modes: by default the advisor answers `completed` and the reviewer `async_launched`; `advisor=background` flips the advisor's registered description; an editing run (`test-writer` under `workspace-write`) answers `completed` even with `codexRunMode: background`. Logic: `parseRunModes` (default, overrides, aliases, refusals), `modeOf` precedence, `routesText`/`routesLines` copy, `routeOf`, `deliveryText`.

## Done means

- In `/config → duet` I set `codexAgents` to `general-purpose`; I ask Claude to "use a subagent to
  summarise README.md"; I'm asked once to allow Codex; the subagent's answer comes back from Codex
  with the `[duet d1 · codex …]` footer, and the pane shows the row with time and tokens.
- An `Explore` subagent (unrouted) still runs on Claude.
- With `codexAgents: code-explorer`, asking Claude to use the code-explorer agent runs it on Codex, read-only, with the agent's instructions; `diff-reviewer` left unrouted runs on Claude.
- `/duet review` on uncommitted changes shows a Codex verdict in the pane; nothing is changed on disk.
- `/duet stats` shows both providers' runs.
- All tests pass; validate clean (routing hook has `.catch`); tsc clean; `/duet demo` shows every state; README has the "What it reaches" table.
- (0.2.0) `/duet` reads `codex ← every subagent type (named, isolated and nested calls stay on Claude) · roles …`.
- (0.2.0) Asking Claude for "a Codex second opinion" spawns `duet:codex-advisor` (named or not); Claude
  waits and gets the answer in place with the `[duet d<n> · codex …]` footer and no
  `use SendMessage with to: 'duet-d<n>'` line.
- (0.2.0) Asking for "an independent Codex review" spawns `duet:codex-reviewer`; the call answers at
  once, Claude keeps working, and the review arrives later as "The duet plugin sent a message:".
- (0.2.0) A background Claude subagent (e.g. `Explore` with `codexAgents` empty) shows up as a claude
  row in `/duet stats`.
- (0.2.0) After `claude plugin update duet@claudemod`, a new session runs 0.2.0 (`/duet config` exists).

## Handoff

Load (`/plugin install duet@claudemod` or `claude --plugin-dir mods/duet`), `codex login` once,
set `codexAgents` in `/config`, `/duet demo`, `/duet review`, `/duet stats`; `ctrl+x tab` for the
pane's keys; `/reload-plugins` picks up edits.

## Change 0.2.1 (2026-10-12)

> Fixes from the Codex review of PR #1.

- **What changes:**
  - An agent file with `tools: []` (or an empty `tools:` line) now means no tools, so it runs read-only. Only a missing `tools` line means every tool.
  - Per-task files (`d<n>.out.md`, `review-<id>.md`) live under `~/.claude/duet-data/sessions/<session>/`, since ids restart at `d1` in every session.
  - `/duet review` goes through the same admission as routed agents, so `maxConcurrent` counts reviews too.
  - Appends to `runs.jsonl` are serialized within a session. Appends from two sessions can still race; the log is stats only.
- **What gets touched:** `hooks/duet-logic.ts`, `hooks/register.tsx`, tests; the per-session folders above.
- **Tests:** an empty tools list is read-only; reviews count against the limit; session folders are filesystem-safe; the background out file is per session.
- **Done means:** all tests pass, validate is clean.

## Change 0.2.2 (2026-10-12)

> Fixes from the second review of PR #1.

- **What changes:**
  - `/duet review` works again. Codex rejects a custom prompt alongside `--uncommitted`, `--base` or `--commit`, so reviews now run on Codex's own review instructions, and the pane shows the review's first line.
  - An agent with no definition duet can find runs read-only, unless it's `general-purpose`. `disallowedTools` removes edit tools.
  - Changed-file evidence keeps each path whole (porcelain output is no longer trimmed at the start), and compares each dirty file's content hash, so a file edited again counts as changed.
  - Refused rows take their id inside the same update that adds them, so a refusal can't overwrite a live row.
  - The limit message counts reviews too.
  - A fallback run cut off at its 10-minute ceiling reports a timeout, not "could not start".
  - The pane's selection stops at the last row it draws.
  - The blanked credential list now covers Bedrock, Vertex, Foundry and `AWS_BEARER_TOKEN_BEDROCK`.
- **What gets touched:** `hooks/duet-logic.ts`, `hooks/register.tsx`, tests, README.
- **Tests:** review argv ends with the target; unresolved agents are read-only; `disallowedTools`; snapshot comparison; limit text; fallback failure; blanked names.
- **Done means:** all tests pass, validate is clean.


## Change 0.2.3 (2026-10-12)

> Fixes from the third Codex review of PR #1 (security finding on `parseAgentFile`).

- **What changes:**
  - `tools` and `disallowedTools` are read as a YAML block list (`- Write` lines, indented or at the key's own indent) as well as one line. Before, a block list read as empty, so a block `disallowedTools` naming all four edit tools still ran Codex under `workspace-write`.
  - A trailing ` # comment` is dropped from each value, as in YAML: a `#` inside a quoted value or a quoted `[a, b]` item stays. A permission specifier names its whole tool (`Write(src/**)` is `Write`; a comma inside the parentheses doesn't split).
  - A `tools` or `disallowedTools` value duet doesn't read (a `>` or `|` block, a `{` mapping, an `&` anchor, a `[` list that wraps, a value continued on the next line, text after a closing quote) makes the agent `read-only`.
  - User-level agents are looked up under `USERPROFILE` when `HOME` is unset, as `dataDir` already did; with neither, only the project's `.claude/agents` is read.
- **What gets touched:** `hooks/duet-logic.ts`, `hooks/register.tsx`, tests, README.
- **Tests:** block lists at both indents, a block `tools` that grants `Edit`, comments, specifiers, a `#` inside quotes, nine unread forms, other fields unchanged, the `USERPROFILE` lookup. Six of the seven new tests fail on 0.2.2; the seventh checks that other fields read as before.
- **Done means:** all tests pass, validate is clean.

## Change 0.2.4 (2026-10-13)

> Part A of issue #3: say what Codex can actually reach.

- **Measured** (Codex CLI 0.162.1, `x86_64-unknown-linux-musl`, WSL2 Linux; local `codex sandbox` runs with `sandbox_mode` set as duet's `-s` sets it):
  - `read-only`: a file outside the project could be read; writing to the project, a sibling folder or `/tmp` failed with "Read-only file system".
  - `workspace-write`: a file outside the project could be read; writing to the project and `/tmp` worked; writing to a sibling folder or `$HOME` failed.
  - Not measured: `codex exec` itself, macOS and Windows.
- **What changes:**
  - The consent question (`consentText`) says Codex can read any file the user can read and sends it to OpenAI. Under `read-only` it says Codex writes nothing; under `workspace-write`, that agents that edit can write in the project and in temporary folders such as `/tmp`.
  - The README (Install, the `codexSandbox` row, the "What it reaches" Network row), the `codexSandbox` description in `plugin.json` and its `/duet config` help say the same. The README notes that `/tmp` holds Claude Code's own working files, that the handoff's rules (`PROHIBITED`) are a request to the model, and that a routed agent's instructions come from the checkout.
  - No behaviour change: limiting what Codex can read or write is part B of #3.
- **What gets touched:** `hooks/duet-logic.ts`, `hooks/register.tsx`, `.claude-plugin/plugin.json`, README, tests.
- **Tests:** the consent text for both sandboxes.
- **Done means:** all tests pass, validate is clean.

## Change 0.2.5 (2026-10-13)

> Issue #2: cloud-provider credentials still reached Codex. `BLANKED_ENV` held 16 names; `env` is laid over the host's environment, so every other variable passed through, among them `AWS_SECRET_ACCESS_KEY`, `AWS_ACCESS_KEY_ID`, `AWS_SESSION_TOKEN`, `ANTHROPIC_AWS_API_KEY`, `ANTHROPIC_FOUNDRY_AUTH_TOKEN` and `GOOGLE_APPLICATION_CREDENTIALS`.

- **Probed** (Claude Code 2.1.296, `[probe]` in `gotchas.md`, Modules): a throwaway mod ran `$.process.run(['printenv', name])` for `AWS_SECRET_ACCESS_KEY`, `OPENAI_API_KEY` and `ANTHROPIC_AWS_API_KEY`, each set to `dummy` in the shell that started `claude -p`.
  - Without `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB`: all three reached the child (`dummy`).
  - With `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1`: all three were removed (`printenv` exit 1). So Claude Code's scrub does cover a mod's `$.process.run` children, and it removes `OPENAI_API_KEY` too, which Codex needs when signed in with an API key. The scrub is opt-in, so duet doesn't rely on it.
  - `env: { NAME: '' }` sets the variable to an empty string (`printenv` exit 0, empty output); it doesn't unset it. "Blanked" means present and empty.
- **What changes:** `BLANKED_ENV` goes from 16 names to these groups:
  - AWS (Bedrock page): `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`; on PR #30 review, `AWS_CONTAINER_AUTHORIZATION_TOKEN` (the AWS SDK reference's container credential provider: "an authorization token in plain text", used by EKS Pod Identity). The provider's URIs and token file (`AWS_CONTAINER_CREDENTIALS_FULL_URI`, `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI`, `AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE`) and web identity's `AWS_WEB_IDENTITY_TOKEN_FILE`, `AWS_ROLE_ARN` and `AWS_ROLE_SESSION_NAME` are endpoints, paths and IDs, and pass through. On ECS the SDK appends the relative URI to the local endpoint `169.254.170.2` to fetch the task's credentials, so a Codex in that task may still fetch them (Limits).
  - Claude Platform on AWS page: `CLAUDE_CODE_USE_ANTHROPIC_AWS`, `ANTHROPIC_AWS_WORKSPACE_ID`, `ANTHROPIC_AWS_BASE_URL`, `ANTHROPIC_AWS_API_KEY`.
  - Bedrock page (Mantle): `CLAUDE_CODE_USE_MANTLE`, `ANTHROPIC_BEDROCK_MANTLE_BASE_URL`.
  - Env-vars page: `CLAUDE_CODE_OAUTH_REFRESH_TOKEN`; on PR #30 review, the owner added `CLAUDE_CODE_CLIENT_KEY_PASSPHRASE` ("Passphrase for encrypted `CLAUDE_CODE_CLIENT_KEY`") and `CLAUDE_CODE_MESSAGING_TOKEN` (the per-session token Claude Code exports to hooks and Bash commands alongside `CLAUDE_CODE_MESSAGING_SOCKET`, for posting to the session's inbox). `CLAUDE_CODE_CLIENT_CERT` and `CLAUDE_CODE_CLIENT_KEY` are paths and pass through. `CLAUDE_CODE_MESSAGING_SOCKET` is blanked although it is a path. The cross-session messaging page says that on macOS and Linux, including WSL 2, the token line is optional, and that Claude Code delivers a message it verifies, by process evidence, came from its own child processes. Codex is one of those, so the token alone kept nothing out; the empty socket path is what leaves Codex no inbox to post to. Codex could still find the socket deliberately, for example from `/status` (#32).
  - Foundry: `ANTHROPIC_FOUNDRY_AUTH_TOKEN`. The Foundry and Claude Platform on AWS names were checked against the provider and env-vars pages on 2026-10-13: `ANTHROPIC_AWS_API_KEY` is on the Claude Platform on AWS and env-vars pages, `ANTHROPIC_FOUNDRY_AUTH_TOKEN` on the Foundry and env-vars pages.
  - Azure SDK default credential chain: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_CLIENT_SECRET`; on PR #30 review, `AZURE_CLIENT_CERTIFICATE_PASSWORD` ("password of the certificate file, if any") and `AZURE_PASSWORD` (Azure Identity's `EnvironmentCredential`). `AZURE_USERNAME` is an ID and passes through. The Foundry page's Entra path says only "the Azure SDK default credential chain" and names no `AZURE_*` variable (none appears on any of the five pages), so these come from the Azure SDK's documentation, not Claude's.
  - Workload Identity Federation (Anthropic's WIF reference; added on PR #30 review): `ANTHROPIC_IDENTITY_TOKEN`, "the literal JWT" from the identity provider, which Claude Code honors. Its file, config directory and IDs (`ANTHROPIC_IDENTITY_TOKEN_FILE`, `ANTHROPIC_CONFIG_DIR`, `ANTHROPIC_FEDERATION_RULE_ID`, `ANTHROPIC_ORGANIZATION_ID`, `ANTHROPIC_SERVICE_ACCOUNT_ID`, `ANTHROPIC_WORKSPACE_ID`) aren't secrets and pass through.
  - Azure managed identity (App Service's managed-identity page; added on PR #30 review): `IDENTITY_HEADER`, the header the local token endpoint requires ("The platform rotates the value"). `IDENTITY_ENDPOINT` is a local URL and passes through. `MSI_SECRET` isn't on the current page, so it isn't added.
  - Never blanked, because Codex needs them: `OPENAI_API_KEY`, `CODEX_HOME`, `PATH`, `HOME`, the proxy variables.
  - Never blanked, because `''` isn't unset: paths, directories and profile names, the messaging socket apart (above) (`CLAUDE_CONFIG_DIR`, `ANTHROPIC_PROFILE`, `AWS_PROFILE`, `AWS_CONFIG_FILE`, `AWS_SHARED_CREDENTIALS_FILE`, `GOOGLE_APPLICATION_CREDENTIALS`, `AZURE_CLIENT_CERTIFICATE_PATH`, `AZURE_FEDERATED_TOKEN_FILE`). The green phase blanked them; review on PR #30 found that a `claude` run by Codex then uses an empty config directory (`CLAUDE_CONFIG_DIR= claude auth status` reports `configDirectory: ""`, probed on 2.1.296). Their values aren't secrets, and the files they name stay readable either way. `init.env` is typed `Record<string, string>`, so a variable can't be unset instead.
  - The README Install paragraph names the groups; its Environment row points to `BLANKED_ENV` without a count, which `BLANKED_ENV`'s exact-list test makes unnecessary.
- **Considered and not taken:**
  - Enumerating the inherited environment (`$.process.run(['env'])`, `cmd /c set` on Windows) and blanking by pattern: one extra process per Codex run, and the names it blanks are invisible to `claude plugin validate`, so the README's reach row couldn't be generated from them.
  - A `sh -c` wrapper that unsets variables before `exec codex`: POSIX only and harder to audit.
  - Relying on `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB`: opt-in, and it would also remove `OPENAI_API_KEY`.
- **Limits:**
  - The list is explicit: a credential variable not named here still reaches Codex (a new cloud provider, a variable a user invented). New names are added as they are found; a name-pattern pass or `extraBlankedEnv`/`keepEnv` options are proposed in #32.
  - Blanking hides variables, not files: Codex can read `~/.aws/credentials`, a file a path variable names, or any other file the user can (issue #3).
  - Blanking isn't a barrier. On Linux, a process running as the same user can read Claude Code's own environment from `/proc/<pid>/environ` (checked 2026-10-13: this machine's `claude` process environ was readable from a child shell, 41 names; values not printed), so Codex can still read the credentials blanked here if it looks for them, and on ECS it can still fetch the task's credentials (above). Blanking stops accidental use. A real barrier, such as running Codex as another user or in a sandbox that hides `/proc`, is out of scope here (#32).
  - Blanking doesn't cover a login that AWS or Google tools find on their own (added after PR #30 merged). An `aws` or `gcloud` command Codex runs uses the profile `AWS_PROFILE` names, or else `[default]` in `~/.aws/credentials` (AWS SDK reference, shared config files: "used by an SDK or tool operation if a specific named profile is not specified"). It uses the key file `GOOGLE_APPLICATION_CREDENTIALS` names, or else the file `gcloud auth application-default login` wrote (`$HOME/.config/gcloud/application_default_credentials.json`; Google's ADC search order), or else the metadata server. So when Claude Code reaches Bedrock or Vertex that way, Codex's tools can sign in as Claude Code with no searching. Blanking `AWS_PROFILE` and `GOOGLE_APPLICATION_CREDENTIALS` wouldn't close this: the default profile and the gcloud file need no variable. What `''` does to these two is also unverified (no AWS or Google tools were installed to test), and a Bedrock-backed Codex needs `AWS_PROFILE` (above). #32 covers deciding it, with a probe and a `keepEnv` opt-out.
  - Codex 0.162.1 has an Amazon Bedrock provider (its binary contains `amazon-bedrock`, `AWS_PROFILE` and `AWS_BEARER_TOKEN_BEDROCK`; not run). Its AWS key variables are Claude Code's too, so a Bedrock-backed Codex gets them empty and must use a profile, which passes through. The README says so.
- **What gets touched:** `hooks/duet-logic.ts` (`BLANKED_ENV`; both `process.run`/`spawn` call sites already take `childEnv()`; on PR #30 review, `codexLaunch`), `hooks/register.tsx` (on PR #30 review: `runCodex` takes `codexLaunch`), `.claude-plugin/plugin.json`, README, `plugins/mod-builder/skills/build/references/gotchas.md`, tests. The coverage kit (`plugins/mod-builder/skills/build/scripts/coverage/kit.mjs`) also gets a `toBeGreaterThanOrEqual` matcher, which these tests use; mod-builder's version is unchanged. The kit's other missing matchers are #33.
- **Tests:** `childEnv()` and `BLANKED_ENV` against a literal list of the new names (not derived from `BLANKED_ENV`), the originals, and the names Codex needs; a routed call, a review and `/duet config models` each get the cloud names as `''` and none of the Codex names.
- **Done means:** all tests pass, validate is clean.
- **PR #30 review** (Codex and `/code-review`, 2026-10-13), one commit each:
  - The tests' name lists live once, in `tests/env-names.ts`; `BLANKED_ENV` must equal them exactly, once each.
  - Secrets only: the eight paths and profile names above pass through.
  - A Bedrock-backed Codex is pointed at an AWS profile (README, Limits).
  - `ANTHROPIC_IDENTITY_TOKEN` is blanked (Codex).
  - `CLAUDE_CODE_CLIENT_KEY_PASSPHRASE` (Codex) and `CLAUDE_CODE_MESSAGING_TOKEN` (`/code-review`) are blanked, the owner's call.
  - `AWS_CONTAINER_AUTHORIZATION_TOKEN` is blanked; the container URIs and web-identity file and IDs pass through (Codex, two comments).
  - `AZURE_CLIENT_CERTIFICATE_PASSWORD` and `AZURE_PASSWORD` are blanked; `AZURE_USERNAME` passes through (Codex, two comments).
  - `IDENTITY_HEADER` is blanked; `IDENTITY_ENDPOINT` passes through, and `MSI_SECRET` isn't added, as it's unverified (Codex).
  - `codexLaunch` builds Codex's spawn request (argv, blanked env, stdin), which `$.process.spawn` takes whole and the `$.process.run` fallback takes in parts, and a test checks it. Before, removing `env` from the spawn call left all 88 tests passing; removing it from `codexLaunch` now fails 4. The one line no test reaches is `$.process.spawn(launch)`, as spawn can't be stubbed (`/code-review`).
  - The README says that under `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1` Codex needs `codex login`, since the scrub removes `OPENAI_API_KEY` (the probe above, which used `$.process.run`; `printenv OPENAI_API_KEY | codex login --with-api-key` from `codex login --help`, 0.162.1, since the option reads stdin) (`/code-review`; the stdin pipe from Codex's third review).
  - No count of names in the README or this section: it went stale with every change, and the exact-list test pins the names instead (`/code-review`).
  - Limits and README say blanking isn't a barrier: Claude Code's environment is readable at `/proc/<pid>/environ` (checked).
  - Follow-ups filed: #32 (the list lags; blanking isn't a barrier) and #33 (the coverage kit's missing matchers).
  - `CLAUDE_CODE_MESSAGING_SOCKET` is blanked, the one path blanked on purpose (Codex, second review). Codex's IMDS and Google metadata-server findings are deferred to #32: they concern the machine's identity, not Claude Code's environment.

## Change 0.2.6 (2026-10-13)

> Part B of issue #3: limit what Codex can read and write, behind an opt-in, default-off option. On Codex 0.162.1 (Linux), `codex exec` runs confirmed:
> - under `read-only` and under `workspace-write` with `codexWritePaths`, reads outside the project, `/tmp` and an outward symlink were blocked;
> - a `codexWritePaths` folder was writable.
>
> Whether the rest of the project stays read-only was checked in `codex sandbox` only. `/duet review` gets the same profile, but whether it holds there is not confirmed.

- **Evidence: `codex sandbox`** (issue #3, run 2026-10-13: Codex CLI 0.162.1, `x86_64-unknown-linux-musl`, WSL2 Linux; local runs, no model call):
  - With `default_permissions="duet"` and `permissions.duet.filesystem={":minimal"="read","<project>"="read","$HOME/.codex/packages"="read"}`, a file outside the project failed with "No such file or directory", and a project file printed. Adding `-c sandbox_mode="read-only"` gave the same result.
  - With the project as `write`, writing in it worked. Writing outside it or in `/tmp` gave "Directory nonexistent". With the project as `read` and `<project>/tests` as `write`, writing `tests/…` worked and `src/…` gave "Read-only file system".
  - `$HOME/.codex/packages` is the Codex install folder. The sandbox needs it to re-run `codex`.
  - `default_permissions` is a config key. `-P`/`--permission-profile` exists on `codex sandbox` only, not on `codex exec` (`codex exec --help`, 0.162.1).
- **Evidence: `codex exec`**:
  - Setup:
    - Four signed-in runs, each approved by the owner, between 2026-10-14 01:45 and 02:09 UTC, on the same Codex and machine.
    - `~/.codex/config.toml` sets `sandbox_mode = "workspace-write"`.
    - The project is `scratch/sbx-exec/proj`, its own git repository. `../outside/canary.txt` holds a canary, never a real secret.
    - Results come from the `command_execution` events of `--json`, not from the model's prose.
  - **`-s read-only` plus the two overrides (the argv green first wrote):** the profile was ignored. `cat ../outside/canary.txt` exited 0 and printed the canary, and `ls /tmp` listed the host's `/tmp`. OpenAI's permissions page (https://learn.chatgpt.com/docs/permissions, read 2026-10-14) says passing `--sandbox` makes Codex "use those older sandbox settings instead of `default_permissions`".
  - **`-c sandbox_mode="read-only"` in place of `-s`:** the profile held.
    - The outside `cat` exited 1 ("No such file or directory").
    - `ls /tmp` exited 2.
    - `cat`, `rg` and `git status` inside the project worked.
    - `mktemp` failed, because there is no `/tmp`.
  - **`workspace-write` with `codexWritePaths`:** the argv came from `codexArgv` (project `read`, `<project>/tests` `write`), and `<project>/link` was a symlink to `../outside`. These failed:
    - reading the canary directly or through `link/`;
    - writing through `link/`, to `../outside/` and to `/tmp`;
    - `ls /tmp`.

    These worked: `echo w > tests/w.txt`, a project read, `rg` and `git status`. The writes to `src/` and the project root left no file on the host, but they show up only in the model's prose ("Read-only file system"), with no command event, so they count as not run.
  - **A side effect of `workspace-write` with `codexWritePaths`:** Codex created empty `.agents`, `.aws`, `.codex` and `.git` folders inside the writable `tests/` folder when its sandbox started, and left them there. The `codex sandbox` runs didn't.
  - **`/duet review` (`codex exec review --uncommitted`, argv from `reviewArgv`):** the change under review was a script that compares `../outside/canary.txt` to a value. The reviewer chose not to read it ("its input is outside the authorized workspace"), so the direct check didn't run. Two things point to the profile being in place:
    - `ls -la` showed the project's parent as a synthetic `drwx------` folder, not the real one.
    - Codex's own memories file (`~/.codex/memories/MEMORY.md`) was readable.
  - **Readable beyond the table:** a no-model `codex sandbox` run with the same profile shows that `~/.codex` holds only `memories` and `packages`. Codex adds its own memories folder; `auth.json`, `config.toml`, `history.jsonl`, `~/.claude` and `~/.ssh` were not there.
- **Why it can break on a Codex upgrade:** OpenAI's page says profiles "do not compose with the older sandbox settings", and that `sandbox_mode` in a loaded config file also makes the older settings win. On 0.162.1 that didn't happen: the profile held with `sandbox_mode` both in `config.toml` and as `-c`. duet relies on that behaviour, and duet's tests check only the argv. After upgrading Codex, re-run the canary probe above with the argv `codexArgv` builds before relying on `project`.
- **Not checked:**
  - through `codex exec`, that a `codexWritePaths` agent can't write the rest of the project, and that `read-only` writes nothing in it (both checked in `codex sandbox` only);
  - macOS and Windows;
  - whether `/duet review` holds the profile when the model does try an outside read;
  - `workspace-write` with the whole project writable through `codex exec`, including whether the empty folders then appear at the project root.
- **What changes:**
  - `codexFsScope` (`anything` default, `project`). `anything` is the argv as before. `project` replaces `-s <mode>` with `-c sandbox_mode="<mode>"` in `codexArgv` (`reviewArgv` already used it), and adds two `-c` overrides to both: `default_permissions="duet-mod-fs-scope"` (named `duet` until the review fixes below) and `permissions.duet.filesystem={…}`, built by `profileArgs`.
  - The table holds `":minimal"` read; the project read, or write under `workspace-write` when the agent has no `writePaths`; and `<home>/.codex/packages` read. `/tmp` is never in it. A review gets the table read-only. With `HOME` and `USERPROFILE` both unset, the install folder is left out; Codex then may not be able to re-run itself (unverified).
  - `codexWritePaths` (`agent=folder;folder`, comma-separated, agent names as `codexRunMode` reads them, roles by any of their names). Under `project` and `workspace-write`, a named agent gets the project as `read` and each of its folders as `write`. It only narrows:
    - an absolute path, one that climbs out of the project, and the project itself are dropped;
    - an entry whose folders are all dropped leaves the project read-only;
    - read-only runs ignore it;
    - an entry with no folder (`red=`) was ignored, so the agent kept the whole project. Since the review fixes it is an error.

    Folders are joined to the session folder with `/`; Windows paths are untested.
  - Paths are TOML basic strings, escaped by `JSON.stringify` (`\`, `"` and control characters), and tested with a path holding a quote and a backslash.
  - The consent question is unchanged. It still says Codex can read any file the user can read. That is true under the default `anything`; under `project` it claims more access than Codex has, which is the safe side, and review and macOS/Windows are unconfirmed.
  - Both options are in `/duet config` (aliases `scope`, `paths`), `plugin.json` and the README. Version 0.2.6 is in `plugin.json` and the marketplace entry. The issue named 0.2.4, but 0.2.4 and 0.2.5 had shipped.
- **Considered and not taken:**
  - `codexFsScope: project` as the default: that is the owner's call, and it depends on the upgrade check above.
  - The profile with no `sandbox_mode` at all. That is OpenAI's "one system" advice, but it is unverified through `codex exec`. If a Codex lets `sandbox_mode` win, it would fall back to the user's `config.toml` (here `workspace-write`), not to the mode duet asked for.
  - A private temp folder in the duet data for tools that need one. `mktemp` fails without `/tmp`, but no duet task has needed one yet.
  - Removing the empty folders Codex leaves. That would mean deleting inside the user's project.
- **What gets touched:**
  - `hooks/duet-logic.ts`: `readOptions`, `parseWritePaths`, `profileArgs`, `codexArgv`, `reviewArgv` and `CONFIG_FIELDS`.
  - `hooks/register.tsx`: `runJob` and `review` pass the scope and the home folder. `routeToCodex` reads the home folder before the job starts rather than inside `runJob`, so a background run reaches `process.run` as soon as it did before.
  - `.claude-plugin/plugin.json`, the marketplace entry and the README.
- **Tests:**
  - `codexArgv` and `reviewArgv` with `fsScope` `project`: the two overrides; `-c sandbox_mode` and never `-s`; the table for each sandbox; `writePaths` narrowing; dropped paths; escaping.
  - The same with `fsScope` `anything` or none: the argv is unchanged.
  - `readOptions` for the two options.
  - Routed calls and a review, through `process.run`, with the profile and a named agent's folders.
  - Three red tests first pinned `-s` beside the profile. They were fixed in their own commit, citing the first `codex exec` run.
- **Done means:** all tests pass, validate is clean, and the `codex exec` runs above are recorded.

### Review fixes (2026-10-14)

> PR #39's review: Codex left four comments, and `/code-review` added three findings. Each fix has a red test, its own commit, and a `codex sandbox` check (0.162.1, Linux, no model call). These checks weren't re-run through `codex exec`: they all use the `-c` form that the exec runs above confirmed.

- **Profile name** (Codex P1): Codex merges a same-named `[permissions.duet]` from any loaded config into the `-c` override. `/code-review` reproduced a read that widened this way. The profile is now `duet-mod-fs-scope` (`PROFILE`); a config defining that name would still merge.
- **A malformed `codexWritePaths` fails closed** (`/code-review`): `parseWritePaths` used to drop a part such as `red:tests` or `red=`, and the agent then wrote the whole project.
  - Such a value is now an error. `/duet config` refuses it, and if set another way, every agent's project is read-only (`writePathsOf`).
  - Any folder list, even an empty one, narrows: only an agent the option doesn't name writes the whole project.
- **Symlinked write folders** (`/code-review`): `folderUnder` checked containment by spelling only, so a write folder that is a symlink out of the project made its target writable (reproduced). When a run is admitted, `safeWritePaths` resolves the project and each folder with `$.fs.stat({ resolve: true })` and keeps only folders strictly inside (`isInside`). A symlink out, a symlink to the project, and a folder not there yet are dropped. Codex follows a symlinked write entry: one spelled through an inside link is writable.
- **Git in a linked worktree** (Codex P2): git failed with `fatal: not a git repository: …/.git/worktrees/<name>`.
  - Under project scope, `git rev-parse --path-format=absolute --git-dir --git-common-dir` gives `reads`, which `profileArgs` adds read-only when they lie outside the project.
  - With the table `codexArgv` builds for `scratch/wt-issue3`, `git status` and `git log` work, and the main checkout's files stay hidden.
  - This exposes `.git/config`, with its remote URLs.
  - Not handled: a session started in a subfolder of a repository.
- **Codex's install folder** (Codex P1): with no install grant the sandbox can't run Codex (`bwrap: execvp …/bin/codex: No such file or directory`), and the run still read as done. These are now readable:
  - the folder the first `codex` on `PATH` really lands in;
  - `$CODEX_HOME/packages`;
  - `~/.codex/packages`, as before.

  A table whose only install entry is the PATH-derived `bin` folder runs commands. An entry for a missing folder is harmless. `foldEvent` turns a `bwrap: execvp <path>: No such file or directory` command output into a run failure naming the binary.
  - Not checked: npm/nvm and brew installs, where `codex` may be a JavaScript shim beside the native binary, and Windows' `;` PATH.
- **macOS `/tmp`** (Codex P1, from Codex's source, not run): on macOS a `:minimal` entry makes Seatbelt grant `/private/tmp` and `/private/var/tmp`. The help, `plugin.json` and README now say `/tmp` is hidden on Linux only. Explicit `none` entries are left for a macOS machine: on Linux, `/tmp="none"` also hid a project under `/tmp`.
- **Left for a follow-up issue:** the macOS deny entries; showing the scope in routes and the footer, and noticing when a Codex upgrade drops the profile; tests for a missing HOME, a write path keyed by a role alias, and the `folderUnder` project-itself branch.

### Review fixes, round 2 (2026-10-14)

> `/code-review` of PR #39 at `d0e490b` checked Codex's six comments and found more. Each fix has a red test and its own commit. The live checks ran `codex sandbox` 0.162.1 (Linux, no model call) on the logic built at `03c4353`. The `codex exec` runs above weren't repeated.

- **Write folders in `.git`, `.codex` or `.agents`** (`/code-review`): plain `workspace-write` and the whole-project entry keep these read-only (probed). Yet a named folder such as `tests -> .git/hooks` let the sandbox write `.git/hooks/pre-commit`, which the next `git commit` runs unsandboxed (reproduced).
  - `isProtectedPath` drops a folder that is, or lies below, any of the three under the project: in `safeWritePaths` on the real path, and in `profileArgs` on the spelling.
  - Commits: 9de5bda (red), 1c00a7a (fix).
- **A quoted bwrap line failed a good run** (`/code-review`): `foldEvent` matched the bwrap text anywhere. So a `/duet review` of this PR (`git diff` prints the regex) became an error (reproduced). Now only a command with `exit_code` not 0, whose output has a line starting with the message, counts. Commits: 84c7201, 54821d1.
- **Repeated key** (Codex P1, 4266372721): with `CODEX_HOME=$HOME/.codex`, the table held `~/.codex/packages` twice, and Codex refused it (`invalid type: string … expected struct FilesystemPermissionsToml`, reproduced). `profileArgs` now keeps each path once, after folding repeated and trailing slashes. Commits: 7d0ab1c, 2e10c31.
- **Profile name** (`/code-review`, on Codex P1 4266133298): `duet-mod-fs-scope` is public, so a trusted repository's `.codex/config.toml` defining it widened reads (reproduced: the outside canary printed under a `read-only` argv).
  - Each run and review now passes `crypto.randomUUID()` as a nonce: `duet-mod-fs-scope-<32 hex>`. With the nonce, the same repo's grant didn't apply.
  - A trusted repo's config still shapes Codex otherwise: `codex mcp list` showed its MCP server. That is in #42.
  - Commits: b840c2f, 5b16664 (routing helpers match the prefix), b6983d9.
- **Install grant** (Codex P2 4266372737, `/code-review`): the `PATH` lookup now skips a `codex` that isn't a file (`fs.stat` kind; the executable bit can't be seen).
  - `profileArgs` drops a read that is, or holds, the project or the home folder, so a `codex` at `~/codex` no longer makes `$HOME` readable.
  - Commits: a78a07e (the stub gives kinds), 83924c1, b1800a3.
- **Git before 2.31** (`/code-review`): `--path-format` failed there, and git's folders were silently not granted.
  - `gitDirs` now runs `git rev-parse --git-dir --git-common-dir` and resolves a relative answer against the session folder (`resolveFrom`).
  - On git 2.53 the answers are absolute in a linked worktree and `.git` at a main checkout's top. Old git itself wasn't run.
  - Commits: e09998f, 47f1bf7.
- **A dropped write folder was silent** (`/code-review`): a missing, outside or protected folder was dropped with no word, and Codex can't create a missing one (probed: `mkdir` gets "Read-only file system"). The footer now names each dropped folder. Commits: 96d95cd, 8048cc5, 71517ab (covers the footer's model branch).
- **A review that failed after admission stayed running** (`/code-review`): it held a `maxConcurrent` slot for the session. Now the row ends as error, with the reason. Commits: 01aa793, 1b68f5c.
- **Refactor:** one `scopeOf` builds the scope inputs at admission, and a job keeps the scope it was admitted with. `folderUnder`'s doc comment is back on it. Commit: 91a1787.
- **macOS `/tmp`** (Codex P1 4266133283): Codex 0.162.1's `seatbelt_scratch.rs` makes `/private/tmp` and `/private/var/tmp` *writable* too, `read-only` included. The help, `plugin.json` and README now say so. The fix needs a Mac and is in #42. Commits: 1649aae, 03c4353.
- **Moved to #42:** macOS; npm, nvm and brew installs (`bin/codex.js` is a shim, and the native binary sits in an optional dependency, per `npm view`); a git 2.25 check; the executable bit; showing the scope in routes and the footer; noticing a Codex upgrade that drops the profile.
- The three tests listed above as left over (a missing HOME, a role alias, the project-itself branch) landed in 88de8b7.

## Change 0.2.7 (2026-10-14)

> Issue #4: find a routed custom agent the way Claude does. At 0.2.6 duet read two files, `<cwd>/.claude/agents/<type>.md` and `~/.claude/agents/<type>.md`. A miss runs read-only, which is the safe side, but an editing agent outside those paths lost write access and its instructions, a definition whose `name` differs from its file name was never matched, and a `general-purpose.md` that duet didn't find fell through to the built-in default, which edits.

- **Evidence: probe** (Claude Code 2.1.299, `claude -p --plugin-dir` on a throwaway mod in the gitignored `scratch/`, started in `fx/pkg/sub`; recorded in `gotchas.md`): `$.fs.list` listed `fx/.claude/agents` two folders above the session folder, its subfolder `team` and its dot-folder `.dot`. A symbolic link to a file or a folder came back as `other` with `isLink`; listing the link's path still followed it. A missing folder rejected with `ENOENT`.
- **Claude's rules** (https://code.claude.com/docs/en/sub-agents, as quoted in the issue; not re-read for this change): project agents are found by walking up from the working directory to the repository root; project and user folders are scanned recursively; identity comes only from `name`; a file with no `name`, a `name` that starts with `-`, has `:` or is over 256 characters, or no `description`, is skipped; two files with one `name` in one folder are resolved by filesystem read order.
- **What changes:**
  - `pickAgent(files, type)` in `duet-logic.ts` takes the files found, each with the index of its folder (nearest first), and returns the winning `AgentDef` or `null`. The skip rules, the quote and comment handling of `name`, the nearest-folder rule and the same-folder conflict rule (read-only) are all there.
  - `agentDef` in `register.tsx` builds the folders (`agentRoots`: up to the nearest `.git` entry, through `$.fs.exists`; the user's folder last, once), lists each (`listAgentFiles`: subfolders and dot-folders, depth 8, 500 `.md` files in name order, links followed, each real path once, a failed list is an empty folder) and reads the files through a cache keyed by path, size and `mtimeMs` (`agentText`). It stops at the first folder with a match, so farther folders aren't read.
  - A miss is unchanged: `read-only`, except `general-purpose`. A `general-purpose.md` that is found now decides it.
- **Not resolved, so read-only:** managed-settings agents, the `--agents` flag, plugin agents and `--add-dir` folders. No `$` call returns Claude's resolved definition (`$.agent` has `spawn`, `list` and `register`). The README says so.
- **Considered and not taken:**
  - Parsing a block-scalar `description`: any non-empty value counts, as `parseAgentFile` keeps it.
  - Sorting same-folder matches: the listing is in name order, so the pick doesn't depend on the engine's listing order.
- **What gets touched:**
  - `hooks/duet-logic.ts`: `pickAgent`, `AgentFile`.
  - `hooks/register.tsx`: `agentDef`, `agentRoots`, `listAgentFiles`, `agentText`.
  - `.claude-plugin/plugin.json`, the marketplace entry, the README (Custom agents, sandbox note, Files row) and this SPEC. `plugins/mod-builder/skills/build/references/gotchas.md` gains the probe above.
  - Reads: more files (`$.fs.list` is new in the validate output). No new writes.
- **Tests:**
  - `pickAgent`: `name` against file name; a quoted name and one with a comment; no `name`, no `description`, and the `name` limits; the nearer folder wins in any order, and a skipped nearer file doesn't shadow a farther one; a same-folder conflict is read-only, for `general-purpose` too; a `general-purpose.md` that can't edit; no match.
  - Routing, through `fs.list`, `fs.read` and `process.run` stubs: an editing agent in an ancestor folder keeps `workspace-write` and its instructions are sent; subfolders and dot-folders; a renamed file; a reading agent; `general-purpose.md` in an ancestor; nearest folder first; project over user; the repository root as the stop; no repository; symbolic links; depth 8; 500 files; listing on every call; the cache by size and time.
- **Done means:** all tests pass, validate is clean, README and SPEC say which sources are read and which aren't, and the probe is recorded.

### PR #43 review fixes (2026-10-14)

> PR #43's review: `/code-review` (13 findings) and Codex (3 comments). Where a finding turned on what Claude itself does, it was settled by a probe: trees of agent files under the session scratchpad, read through the `agents` list of `claude -p --output-format stream-json --verbose`'s `init` message, on Claude Code 2.1.299 and, after it updated itself mid-session, 2.1.300 (recorded in `gotchas.md`). Each fix has a red test and its own commit.

- **The repository root is the nearest `.git` entry** (findings 1 and 2, Codex 4274497656). Claude stops at the first folder holding `.git`, even an empty folder or file that git rejects. duet asked `git rev-parse --show-toplevel` instead. A git failure (missing git, dubious ownership, a timeout) widened the search to the filesystem root, and a session folder spelled otherwise than git's answer narrowed it to that folder. `agentRoots` now checks each folder with `$.fs.exists`, so no git process runs.
- **Symbolic links are followed** (finding 4; the owner's choice). Claude reads a linked file, a linked subfolder and a linked `.claude/agents`. Not following them dropped agents kept in dotfiles, which 0.2.6 read, and made a linked read-only `general-purpose.md` a miss that edits. Red test 10 said links are not followed; it was corrected in its own commit. A folder's real path is recorded per lookup, so a link loop is searched once. Codex 4274497617 asked to reject linked roots; Claude reads them, so duet does too.
- **A value on the next line** (finding 3). `parseAgentFile` dropped an indented line after a scalar key, so `description:` with its text below read as empty and the file was skipped; Claude loads it. An indented line now folds into a plain value. A `>` or `|` block keeps its indicator as its value, as before.
- **A Windows `HOME`** (the refactor's follow-up): the user folder is built with `/` separators, so a home the walk already passed isn't listed twice.
- **Tests added** (finding 12): the depth cap at 8 and 9 folders (`<` changed to `<=` now fails), a file that can no longer be read, and the user folder searched once.
- **Docs** (findings 5 and 13): the logic file's section header; the README's Files row and Custom agents bullet (the `.git` stop, links, the caps against Claude's, a same-named project file shadowing a managed or `--agents` agent).
- **Not changed, with the reason:**
  - Codex 4274497636, malformed YAML elsewhere in a file: Claude loads a file with `bad: [` in another field, so skipping it would differ from Claude.
  - Finding 6, the walk without a repository: Claude walks on up too (4 levels probed).
  - Finding 7, a failed read: Claude also leaves out a file it can't read, so the farther definition is what it uses as well.
  - Findings 5 (beyond the docs), 8, 9, 10 and 11 are in #44: there is no `$` call for managed-settings or `--agents` agents; nothing says when a cap cut a scan short; `pickAgent`'s `root` field is unused now that each pick sees one folder; reads are sequential; and the cache keeps entries for files no longer listed.

## Change 0.2.8 (2026-10-14)

> Issue #44: the follow-ups deferred from PR #43's review of the agent discovery in 0.2.7. Each is a gap or a cost. One let duet grant more than Claude would: a search cut short by duet's limits (PR #48 review); it now runs read-only.

- **Silent caps** (/code-review 8). The search reads 8 folders below a `.claude/agents` folder and the first 500 `.md` files of each, and said nothing when it stopped there; Claude read 9 and 12 deep in the probe. `listAgentFiles` now records the limit it reached (`cut.depth`: a folder below the 8th; `cut.files`: a `.md` file it did not list, or a folder it did not enter, after the 500th). A folder past a limit is listed once, with no reads and no recursion, and counts only if it holds a `.md` file, a subfolder or a link (PR #48 review): an empty folder, or one holding only other files, can't hide a definition. A folder holding only a subfolder still counts, since what lies below it was not looked at, and `agentDef` returns that with the definition. The note goes on its own line above the footer of the run's result (`Job.searchNote`, joined in `runJob`), so a foreground answer, a background delivery and the `.out.md` file all carry it. It names the limit (`8 folders deep`, `500 .md files in one .claude/agents folder`, which counts its subfolders' files too) and says a definition past it was not read, so Claude may use a different one; it doesn't say how far Claude reads, since the probe measured only depth. It is raised when any folder the lookup searched reached a limit, found a match or not: a match in the same folder past the limit would have changed the pick. Raising the caps was not taken: the probe saw Claude read 9 and 12 deep and found no limit, so a higher number would still miss deeper trees.
- **A search cut short runs read-only** (PR #48 review, /code-review 1). A definition past the limits is one Claude reads and duet doesn't, so it may forbid edits that duet's pick allows: a read-only `general-purpose.md` 9 folders down left duet on the editing built-in, and a read-only editor past the limit left it on a farther editing one, both under `workspace-write`. `effectiveSandbox` takes `isSearchCut` and returns `read-only` when it is set; `routeToCodex` sets it when `agentDef` returned a note, and the note adds that duet ran the agent read-only. Three PR #43 tests that expected `workspace-write` after a cut-short search now expect `read-only`. A folder past a limit counts only if it may hold a definition (see Silent caps), so a folder 9 deep holding only `notes.txt` neither raises the note nor costs the run its edits.
- **A failed run keeps the note** (PR #48 review, Codex P2). The note rides in the footer, and a failed run has none: the foreground denial, `deliveryText`'s failure line and the `.out.md` failure line all dropped it, so exactly the runs that most need to say the definition may not be Claude's did not. Each now ends with the note on a line of its own (`deliveryText` takes an optional `searchNote`; the denial and the `.out.md` line add `Job.searchNote`). A run that ends in "duet failed unexpectedly" (an error thrown after admission, not a Codex failure) still carries no note.
- **`pickAgent` takes one folder's texts** (/code-review 9). `agentDef` has called it once per folder since 0.2.7, so `AgentFile.root` and `path` were never used and the nearest-root logic never ran. `pickAgent(texts, type)` takes the file texts of one folder, and `AgentFile` is gone. Which folder wins is `agentDef`'s loop alone.
- **Files read together** (/code-review 10). `agentDef` reads a folder's files 16 at a time (`agentTexts`, `AGENT_READS`) instead of one at a time; the results keep the listing's name order, so the pick is unchanged. Not all at once (PR #48 review, Codex P2): a failed read counts as no file, and a live probe saw 283 of 500 simultaneous reads fail with the hard open-file limit at 256, so a skipped read-only definition could hand the pick to a farther editing one. A read that fails is also tried once more on its own; one that fails again is left out, as Claude leaves out a file it can't read.
- **A demoted agent still waits** (PR #48 review). Under `codexRunMode: background`, read-only runs answer at once and deliver later, so the cut-short demotion also turned an editing agent's wait into a launch, and Claude was told only that it was launched. The run mode now follows the sandbox the agent would have had (`uncut` in `routeToCodex`), so Claude reads the answer and the note before it goes on.
- **Links past a limit** (PR #48 review, Codex P2). The look inside a folder past a limit counts a link by where it leads (`mayHoldAgent`): a link that leads nowhere, to a file not named `.md`, or back into a searched folder doesn't cut the search short; one to an unsearched folder or a `.md` link to a file does. The read-only rule reads `agentDef`'s `isCut`, not whether the note is empty.
- **Cache pruned** (/code-review 11). After a folder is listed, `agentCache` drops the entries under it that the lookup's listings do not hold (`pruneAgentCache`), so a deleted or moved file's text cannot come back for a new file with the same size and time. Folders a lookup did not reach (it stops at the first match) keep their entries.
- **Not changed:** managed-settings and `--agents` agents (/code-review 5). No `$` call returns them and the engine has no API for the managed-settings folder; the README already says a same-named project or user file is used instead.
- **An empty `-` item is tested.** Deleting `pickAgent`'s nearest-root logic removed four branches that tests covered and none that they missed, so the total branch percentage fell (92.69 to 92.68) with no coverage lost, and `/issue-forge`'s gate G5 blocked the run. A test for an empty `-` item in a `tools` or `disallowedTools` block list, which names no tool, covers a branch of `parseAgentFile` that no test reached and brings the total to 92.73.
- **What gets touched:** `hooks/duet-logic.ts` (`pickAgent`, `AgentFile` removed; `deliveryText`; `effectiveSandbox` takes `isSearchCut`) and `hooks/register.tsx` (`listAgentFiles`, `mayHoldAgent`, `agentTexts`, `agentDef`, `pruneAgentCache`, `cutText`, `runJob`, `finishInBackground`, `routeToCodex`). `plugin.json` and the marketplace entry to 0.2.8; the README's Custom agents bullet. No new `$` calls.
- **Tests:** `pickAgent` over one folder's texts (the nearest-root cases are gone with the roots); routing: the 8-folder and 500-file notes, absent when no limit was reached; the folder read together (five reads in flight, the pick still in name order); the cache entry of a file that left the listing; a run that fails after a cut-short search keeps the note in the denial, the background delivery and the `.out.md` file (and `deliveryText` alone).

## Change 0.2.9 (2026-10-15)

> Issue #5: `/duet review` answered "Codex review started" before it had asked for consent or checked the concurrency limit, so a person whose review was refused had been told it started (Codex review on PR #1). Severity low to medium: a false message, not data loss.

- **A gate, then a run.** `review()` is split. `startReview($, target)` is the gate: it runs `ensureConsent` and `admit` (which inserts the row), and returns `{ started, reason }`. Refused, it keeps the old behaviour (a `refused` row through `addRefused`, and the `dN review refused: <reason>` toast) and returns the reason `ensureConsent` or `limitText` gave. Admitted, it detaches only `finishReview` (the ticker, `runCodex`, the finishing row, log line, saved text and toast) and returns `started: true`.
- **The answer matches what happened.** The `/duet review` command awaits `startReview` and answers `Codex review started (read-only). …` when it started, otherwise `Codex review not started: <reason>`. The command now waits for the consent dialog inside `command.run`; in-hook `$` calls don't count against the 10 s hook budget (`gotchas.md`, "Budget and time"), and only the Codex run itself stays detached. The pane's "Review diff" button calls the same `startReview` (it has no answer to correct, so the refusal toast is what it shows).
- **Dismissed is not headless (PR #52 review).** `$.ui.ask` rejects both when the dialog is dismissed and under `claude -p`, and `ensureConsent` read every rejection as `-p`, so Esc answered "nobody could be asked … set duet codexConsent to allow for headless runs". `consentRefusal` (logic) now reads the rejection: `$.ui.ask: no answer (…)`, what Esc gives, is `the consent question was dismissed; it is asked again next time`; anything else keeps the headless reason. Consent isn't recorded on a dismissal, so the next call asks again. Routed agents get the same reason through `ensureConsent`.
- **Not changed:** the routed-agent path (`routeToCodex`) already refused before it answered; the refused row and toast are as before.
- **What gets touched:** `hooks/register.tsx` (`review` becomes `startReview` and `finishReview`; the `command.run` branch; the pane button; `ensureConsent`'s catch), `hooks/duet-logic.ts` (`consentRefusal`). `plugin.json` and the marketplace entry to 0.2.9. No new `$` calls.
- **Tests** (`tests/routing.test.ts`, "issue 5"): `maxConcurrent: 0` answers not started and names the limit, Codex never runs, the toast stays; a declined consent (the `AskUserQuestion` stub answers No) answers not started with the decline reason; consent unavailable (the stub throws as a missing tool does, so `$.ui.ask` rejects: the `claude -p` case) answers not started; and while the consent dialog is open the command has not answered, then says started and Codex runs. From the PR #52 review: Esc (the stub denies, so `$.ui.ask` rejects with `no answer`) answers dismissed and the next review asks again; `codexConsent: allow` asks nobody, says started and runs Codex; the pane's Review diff button is refused at the limit with the same toast, and otherwise asks and runs Codex on the uncommitted changes. `tests/duet-logic.test.ts`: `consentRefusal` for Esc, `-p` and anything else.
- **Live check:** `claude -p --plugin-dir mods/duet "/duet review"` with `codexConsent: ask` (the configured value) now answers `Codex review not started: nobody could be asked to allow sending this repo to Codex (set duet codexConsent to allow for headless runs)`; Codex did not run. Interactive, on 2.1.300 with `codexConsent: ask` in a fresh repo: the consent dialog appears while `command.run` waits on it, and the command answers after it. No answered `Codex review not started: you declined sending this repo to Codex this session`, and Esc (after the PR #52 fix) `Codex review not started: the consent question was dismissed; it is asked again next time`. Yes was not run, as it starts a real Codex review; the held-dialog test covers that order. Probed with a scratch mod: `$.ui.ask` rejects on Esc with `$.ui.ask: no answer (The user doesn't want to proceed with this tool use. …)` and under `-p` with `$.tool.call: no tool named "AskUserQuestion" in this session`.

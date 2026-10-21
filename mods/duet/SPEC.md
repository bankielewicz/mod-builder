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
| commands | REQUIRED | `/duet` (open the pane; close it when shown; bring it to the front when it is a tab behind another pane) · `demo` · `review [--base <branch> \| --commit <sha>]` · `stats` · `routes` · `config [list \| models \| <field> <value>]` | request |
| states drawn | REQUIRED | empty · live · done · error · folded · too-narrow · focus; survey n/a (pane) | ui-states.md |
| done means | REQUIRED | see below | |
| state lifetime | ARCH | session atoms (tasks, consent); one runs log per session in `~/.claude/duet-data/sessions/<session>/runs.jsonl` (the shared `runs.jsonl` is legacy, read only) | measurement ask |
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
| `timeoutMinutes` | number | `20` | A Codex run past this is stopped and the call refused. If duet has to fall back to a one-shot run (streaming couldn't start), that run stops at 10 minutes at most. The fallback is rare: on Claude Code 2.1.300, streaming failed to start only when `codex` was missing or not executable, and then the one-shot run fails at once too. |
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
- **Files outside the repo, at run time:** `~/.claude/duet-data/sessions/<session>/runs.jsonl` (one line per run: id,
  kind, provider, model, subagent type, start, duration, tokens, exit, outcome; **no prompt text**; the legacy shared `~/.claude/duet-data/runs.jsonl` is read, never written),
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
 [ Review diff ]  [ Stats ]  [ Close ]    ctrl+x tab: keys, again: next tab
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
- **Stats view (`/duet stats` text and the Stats button):** per provider × kind × subagent type: runs, ok %, median time, median tokens, from every run log (see Change 0.2.11). Claude rows come from the subagents the mod saw stay on Claude (duration and tokens from their Agent result) so the two can be compared.
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
   4. **Run** (`$.process.spawn` of `codex exec --json …`, prompt on stdin, env with Claude credentials blanked); each JSONL line updates the task atom (pure `foldEvent`: `agent_message` text, `turn.completed` usage, `error` items as warnings; a final `error`/non-zero exit is the failure). Elapsed is checked on every chunk and against `timeoutMinutes`; breaking the loop kills Codex. If spawn rejects its first pull, falls back to `$.process.run` with the same argv, which the engine caps at 10 minutes: a longer `timeoutMinutes` is cut to 10 there, and the running row says so (Change 0.2.10).
   5. **Candidate:** `git diff --stat <base>` + `git status --porcelain` after the run, as evidence.
   6. **Answer:** `{ result }` in the Agent tool's own `completed` shape (pure `agentResult`): content = Codex's final message + a footer `[duet d7 · codex <model> · sandbox read-only · base abc1234 · changed: 2 files (+10 −3)]`, usage mapped from Codex's tokens. 0 retries.
   7. **Measure:** one line appended to this session's `runs.jsonl` via `$.fs`.
   - `.catch`: `next.called ? next(e) : { deny: 'duet: the Codex handoff failed (<reason>); the subagent did not run.' }`.
2. **Review (`/duet review`):** asks for consent and checks the concurrency limit, answers `started` or `not started: <reason>` once they have decided, and runs Codex in the background: `codex exec review --json -s read-only` with `--uncommitted` (default), `--base <branch>` or `--commit <sha>`, instructions "review against the stated intent; report findings with file:line and severity; do not trust any summary". No implementer summary is passed. Verdict and findings land in the task row and a toast; `/duet` shows them. The mod never applies them or re-dispatches.
3. **Pane (`ui.render {component:'Pane', requestId:'duet'}`):** reads `tasks`, `view`, `selected` atoms; `$.ui.open` from the command or a button; `isPlaced: false` → toast. Elapsed ticks via one `$.clock.every(1000)` only while a task is running, cancelled when none is.
4. **Status (`$.ui.status`):** `1 running · 5 done` while anything ran; `undefined` otherwise.
5. **Stats (`/duet stats`):** reads the legacy `runs.jsonl` and every session's, pure `mergeLogs` then `summarize` → table text.
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
pane's keys (again: the next tab); `/reload-plugins` picks up edits.

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

## Change 0.2.10 (2026-10-15)

> Issue #6: the `$.process.run` fallback caps a Codex run at ten minutes, whatever `timeoutMinutes` says, and nothing said so (Codex review on PR #1). Codex's suggestion, to pass `options.timeoutMs` there, is impossible: the engine caps `$.process.run` at ten minutes. Severity low; the fallback is rare in a live run.

- **Documented.** The cap is in the four places that describe `timeoutMinutes`: the README row, `plugin.json`'s `userConfig.timeoutMinutes.description`, the SPEC config table, and the `CONFIG_FIELDS` help (the config pane's help line, kept short enough to show uncut at 76 columns: `a run past this stops; one-shot fallback: 10 minutes max`). Each says that if duet has to fall back to a one-shot run (streaming couldn't start), that run stops at 10 minutes at most. `/duet config` adds `(a one-shot fallback run stops at 10 minutes)` to the `timeoutMinutes` row when the timeout is longer than that. The SPEC's run step says the same.
- **Shown while it runs.** When the fallback starts and `options.timeoutMs` is above `FALLBACK_MAX_MS`, `runCodex` patches the row's `detail` to `fallback: stops at 10m (timeoutMinutes N)` before it calls `$.process.run`. With `timeoutMinutes` 10 or less nothing is added, since the cap changes nothing. `subText` now shows a non-empty `detail` under a running row (it showed `detail` only for error and refused rows and reviews). `runJob` and `finishReview` replace `detail` when the run ends, so the note lasts only while the run does. The patch is best effort (`.catch`): a failed store write must not fail the run.
- **Probe** (`gotchas.md`, "Modules", `[probe]`): on 2.1.300 under `claude -p --plugin-dir`, a scratch mod pulled `$.process.spawn({ argv: ['codex', '--version'] })`; the first pull resolved (one stdout chunk, exit 0), also with an `env` map and with `input`. It rejected, after 0 chunks, for each failing case probed: a name not on PATH (ENOENT), a non-executable file and a directory (EACCES); `$.process.run` of the same argv rejected at once in each case too (PR #61 review). So in a live `claude -p` run the fallback is rare and, in every case probed, fails as soon as it starts; tests always take it (spawn can't be stubbed). The README and the SPEC config table say so. Interactive sessions: not tested.
- **Review round 1 (PR #61; `/code-review` and Codex 4284157958):**
  - Codex P2: the help sentence was cut at 74 columns in the config pane, and `/duet config` never printed help. The help is now short enough to show uncut, and `configText` adds the cap to the `timeoutMinutes` row when the timeout is longer.
  - The docs said the one-shot run "stops at 10 minutes"; with `timeoutMinutes` 5 it stops at 5. They now say "at most".
  - The "show the note" rule moved from `runCodex` into `fallbackNote` in `duet-logic.ts`, tested at 20, 10 (the boundary) and 5 minutes; inline, a guard of `if (true)` had left every test passing.
  - The probe line above and `gotchas.md` said spawn rejects "only" for a missing binary; a re-probe found EACCES cases too, and that `$.process.run` fails in the same cases.
  - Deferred to #63 (an accuracy-only round, since the note rarely shows live): the note replacing the description, fractional minutes in the note, logic tests for `subText`'s error and review arms, and cleanup in the routing tests.
- **Considered and not taken:** running Codex detached (`sh -c 'nohup codex … &'`) and polling a file for its output, to get past the ten-minute cap. It is POSIX only, needs its own kill path, and the d.ts warns that "a background process left writing holds the call until the timeout". The fallback is rare enough that a visible note is the proportionate fix.
- **What gets touched:** `hooks/duet-logic.ts` (the `timeoutMinutes` help; `configText`; `fallbackNote`; `subText`) and `hooks/register.tsx` (`runCodex`). `plugin.json` and the marketplace entry to 0.2.10; the README row. `gotchas.md` in mod-builder gets the probe (no mod-builder version bump: a reference note, no behaviour). No new `$` calls.
- **Tests:** `tests/duet-logic.test.ts`: the `timeoutMinutes` help says a one-shot fallback run stops at 10 minutes; `subText` shows a running row's detail, shows the description when there is none, and cuts the note to the row width. `tests/routing.test.ts`, with the Codex `process.run` held on a gate (the engine stub records `init.timeoutMs`): a waited agent run and a `/duet review`, each on `timeoutMinutes` 20, call `process.run` with 600000 ms and the Pane shows the note on the running row.

## Change 0.2.11 (2026-10-15)

> Issue #7: two sessions finishing Codex runs at the same moment could drop a line from `~/.claude/duet-data/runs.jsonl`, so `/duet stats` under-counted (Codex review on PR #1). 0.2.1 serialized appends within one session; the cross-session half was open. Severity low: the log holds stats only, no prompt text.

- **One log per session.** `appendRun` writes `~/.claude/duet-data/sessions/<session>/runs.jsonl`, the folder `sessionDir` already gives the per-task files. A session writes only its own file and `logChain` orders those writes, so no two writers share a file. The exception: sessions whose id `$.session.id()` can't read share `sessions/unknown/` and can still race there; the log is stats only. The engine has no append, rename, lock or exclusive-create call (`claude-code.d.ts`, 2.1.296), so separate files is the only way to avoid a shared read-modify-write.
- **Merged when read.** `showStats` (the `/duet stats` text and the pane's Stats view) reads the legacy `runs.jsonl` if there is one, lists `~/.claude/duet-data/sessions/` with `$.fs.list` (a failed list is no sessions) and reads each folder's `runs.jsonl` (a folder with none, or an unreadable one, reads as empty), joins them with the pure `mergeLogs` in `duet-logic.ts` and passes the result to `summarize`. `mergeLogs` keeps each text's non-blank lines, so a log without a final newline can't swallow the next one's first line; corrupt lines are left for `summarize` to skip.
- **Cost and caps.** One `$.fs.read` per session folder per stats view. `appendLog` still keeps the newest 2000 lines of the file it is given, so the cap is now per session. Session folders aren't pruned, so the number of reads grows with them; pruning is a separate decision. The legacy file is never written or trimmed.
- **What gets touched:** `hooks/duet-logic.ts` (`mergeLogs`) and `hooks/register.tsx` (`appendRun`, `readRunLogs`, `showStats`). `plugin.json` and the marketplace entry to 0.2.11; the README Files row. One more `$.fs.list` call (on `sessions/`).
- **Tests:** `tests/duet-logic.test.ts`: `mergeLogs` of two session texts and a legacy text gives the union, a log without a final newline and blank or corrupt lines are handled, and nothing merges to no rows. `tests/routing.test.ts` ("issue 7"): a finished run writes only `sessions/s1/runs.jsonl` and leaves the legacy file and another session's log as they were; the 2000-line cap drops only this session's oldest line; an unreadable session id writes `sessions/unknown/runs.jsonl`; `/duet stats` counts the legacy log, other sessions' logs and this session's, and skips a folder with no log or an unreadable one, or no legacy log at all. `tests/ui.test.tsx`: `/duet stats` and the pane's Stats view count the legacy log and every session's log; its `engine()` stubs `fs.list`.
- **Review of PR #67, linear summary.** `summarize` pushes each run onto its group's array; it used to copy the array on every run, which is quadratic. Under the old single 2000-line cap that cost about 7 ms, but stats now reads up to 2000 lines per session folder: 40,000 runs of one kind took 6630 ms before and 39 ms after (the coverage kit's node loader, 2026-10-15). Test: `tests/duet-logic.test.ts` "PR #67 review: summarize stays linear".
- **Review of PR #67 (Codex P2), bounded and retried stats reads.** `readRunLogs` read every log in one `Promise.all`, and `readText` turned any failure into `''`. With hundreds of session folders that crosses the open-file limit, and a failed read silently dropped that session's runs, the under-count #7 is about. It now reads `AGENT_READS` (16) logs at a time and tries once more, on its own, a read that failed other than as missing, as `agentTexts` does since the PR #48 review. A log that fails twice still reads as empty. `readIfThere` tells the two apart. `$.fs.read` rejects with a message ending `failed: ENOENT` for a missing file, `EACCES` for an unreadable one and `EISDIR` for a folder, with no `code` property (probed with a throwaway `claude -p --plugin-dir` plugin, 2.1.300, 2026-10-15), so a missing log, normal for a folder with only reviews, is read once. Tests in `tests/routing.test.ts`, "issue 7": 40 session logs are read 16 at a time and all counted; a log whose first read fails with EMFILE is read again and counted; a folder with no log and a missing legacy log are each read once.
- **Review of PR #67, no overwrite after a failed read.** `appendRun` rewrites the whole log from what it read, and `readText` turned any failure into `''`, so one failed read of an existing log replaced up to 2000 lines with a single one. That was true of the shared log before 0.2.11 too; a stats fan-out in the same process made it likelier. `appendRun` now reads with `readIfThere`: a missing log starts a new one, and any other failure is tried once more, then the run's line is skipped (the error is thrown, and every `logRun` caller catches it) and the log is left as it was. Tests in `tests/routing.test.ts`, "issue 7": a log without read permission keeps every line after a run, and a log whose first read fails with EMFILE gets the run appended after its existing lines.
- **Review of PR #67, a missing log doesn't depend on the error's wording.** `readIfThere` matched `ENOENT` in the error text, which was probed only on 2.1.300. If a later build words it otherwise, a new session's missing log would read as failed, so no run would be logged and stats would quietly stop growing. Any failure without `ENOENT` now asks `$.fs.exists`: a file that isn't there reads as missing, and one that is there (or an `exists` that rejects) reads as failed. Tests in `tests/routing.test.ts`, "issue 7", with the harness's `missingText` wording a missing file without ENOENT: a session's first run still starts its log, and stats reads a missing log once. (Raised by a side agent after the fixes above.)

## Change 0.2.12 (2026-10-15)

> Issue #8: four fixes from PR #1's Codex rounds were confirmed only by throwaway probes, so a regression in any of them would pass CI. One is a P1 (a refused review overwrote the running review's row). Tests only; no behaviour changes.

- **Tests:** `tests/routing.test.ts`, "review admission": two overlapping `/duet review` at `maxConcurrent: 1`, then a third. One Codex process starts, the toasts are `d2 review refused: …` and `d3 review refused: …`, one of the first two answers says started and the other "Codex review not started", the third says not started too, and the pane shows d1 running with d2 and d3 refused (6148aa6 `addRefused`, 56c0832 admission counts reviews). "issue 8": two routed Codex runs finishing together, at `maxConcurrent: 2`, both land in the run log (56c0832 `logChain`). The harness's new `logGate` holds every read of a `runs.jsonl` after it has taken what the file held; the test settles the clock with both runs in flight and then opens the gate, so appends that don't wait for each other are both reading the log, whatever the engine's scheduling. A real-time delay (`setTimeout`), as the issue's probe used, fails the typecheck: the engine's API types declare no `setTimeout`. It reads the rows from every `runs.jsonl` the stub holds, so hooks from before 0.2.11 (one shared log) fail it for the race and not for the log's path. `tests/ui.test.tsx`: on the 5-task demo with 2 rows drawn, a `▸` row is still drawn after each of 6 `next` presses (6148aa6), with the clock settled after the demo and each press, and the 5 tasks and `rowsThatFit(10)` = 2 asserted first. The routing harness gains `logGate`, and the ui harness's `engine()` returns its clock.
- **Negative control** (the issue's recipe: tests, manifest and types from the test commit, `hooks/` from an older commit, `claude plugin test`, 2.1.300). With 7ee0e8f's hooks the overlap test fails on the toast (`d1 review refused`, not `d2`) and the pane test after press 2 (`[2, false]`). With 3ea3c3b's hooks the overlap test fails on the process count (2, not 1) and the log test keeps `["d2"]` of `["d1", "d2"]`. The log test passes with 56c0832's and 7ee0e8f's hooks, which have the fix. Unrelated tests fail too on those old hooks (78 failures with 7ee0e8f's and 56c0832's, 82 with 3ea3c3b's), so each new test was judged by name. The control was last run from cf6344f, after the review fixes below, on 2.1.300 and on 2.1.296 (installed under the scratchpad with its own `CLAUDE_CONFIG_DIR`), with the same results and failure counts on both.
- **Not run by issue-forge's gates:** gate R requires the new tests to fail at the branch head, and these pass there because the fixes are already in, so the run blocked at R3 and the change was finished by hand.
- **gotchas.md** (mod-builder's build skill), two `[probe]` entries from writing these tests, re-probed with a throwaway plugin on 2.1.300: a `process.run` stub's event is `{ argv, init }`, with env and stdin under `init`; a stub that throws is skipped ("no implementation for env.get"), and `{ deny }` is how a stub makes a call reject with a reason.
- **What gets touched:** `tests/routing.test.ts`, `tests/ui.test.tsx`, `plugins/mod-builder/skills/build/references/gotchas.md`. `plugin.json` and the marketplace entry to 0.2.12. No hooks change.
- **Review of PR #77** (`/code-review`). The log test held reads for 1000 promise turns (40 missed the race and 80 caught it, on 2.1.296 and 2.1.300), a window a build that spaces the appends further would slip past: it now uses `logGate`, and sets `maxConcurrent: 2` rather than leaning on the default. The overlap test took the first of two concurrent reviews as the admitted one and counted Codex processes after a fixed `advance(1000)`: it now waits on `onCodex`, settles the clock, and accepts either review being admitted; its process count and toasts stay ahead of the answer checks, because hooks from before #5 answer "started" for a refused review too and would hide the `d1` toast. The pane test settles the demo and each press (#45) and asserts its arithmetic first. Not changed: no mod-builder bump for the gotchas lines (as in PR #61; PR #80 holds mod-builder 0.2.16), and the review's note that `review`/`pane` helpers are copied in several describes, which predates this change.

## Change 0.2.13 (2026-10-15)

> Issue #31 (with mod-builder 0.2.22 and issue-forge 0.6.0, one PR): a bare `/duet` closed its pane when the pane was open as a tab behind another pane.

- **Rule:** the pure `paneAction(panes, id)` in `duet-logic.ts` (`open` when no entry has the id, `close` when its entry has `isShown: true`, `show` when `isShown: false`). `/duet` passes it `$.ui.panes()`. `open` and `close` keep today's answers (`Opened. <routes>`, `Closed. /duet to reopen.`). `show` answers `Bringing the pane to the front; it takes the keyboard if your prompt is empty (Esc gives it back).` at once and calls `$.ui.open({ id: 'duet', title: 'Duet', columns: 76, focus: true })` from `bringToFront`, before the hook returns and without awaiting its result. 500 ms later `$.ui.panes()` is read again, and a pane whose `isShown` is still false is named in a toast: `Duet is still behind another tab: ctrl+x tab, then again until it shows.` (the 500 ms re-read is right whether or not `isShown` is already true after the open; the probe that would show it is not run, see mod-builder's gotchas.md).
- **The keyboard is taken only on a request to see the pane:** `/duet demo` does the same `show` (its answer and state updates are unchanged) when the pane is listed and not shown; a pane that is not listed or is shown opens as before. `/duet config` already opened its config pane with `focus: true` and is unchanged.
- **Hint:** `ctrl+x tab: keys, again: next tab  ·  r review  s stats  j/k  c close` (69 characters), with `wrap="truncate"` so a narrower pane cuts it rather than wrapping it.
- **Docs:** README and SPEC (commands table, the pane sketch, the hand-off line) describe the three states, the tab keys and the optional `pane:next`/`pane:previous` binding.
- **Tests:** logic: `paneAction`. UI: `ui.panes` is a parameter of `engine()`; `ui.close` and `ui.toast` are stubbed; each `ui.open` is recorded whole. A bare `/duet` with the pane hidden answers at once, opens with `focus: true` and closes nothing; by state; the toast when the pane stays behind and none when it came forward; `/duet demo` likewise; the new hint, truncating.
- **Version:** 0.2.13 in `plugin.json` and the marketplace entry.
- **PR #96 review round 1 (2026-10-15):**
  - **An unplaced pane is no tab behind another (Codex P2, 4290113920):** `$.ui.panes()` lists a pane whose open was not placed (an unasked open on a narrow terminal, or every row while an open answers `no-surface`) with `isPlaced: false` and `isShown: false`, and `paneAction` took it for `show`. A bare command then asked for the front (the `focus` path and a false "still behind" toast) and skipped `openPane`'s narrow-window toast; `/duet demo` did the same. `paneAction` now takes `isPlaced`, as every `UiPane` row has it, and finds only a placed row, so an unplaced pane is `open`. Commits: fixture `13b354d` (rows carry `isPlaced`), red `bd96ec8`, green `3d2b3ed`.
  - **Codex round 2, 4290452262 (fixed):** the demo opened its pane after awaited state writes in a detached block, so the open (with `focus` behind another tab) went out after the command hook returned and was unasked. `/duet demo` now awaits `openOrFront` in its hook, then starts the demo state detached. Red `b2233d8` (with every state write held, the open must already be recorded when the command answers), green `d758747`.
  - **Codex round 3, 4290573678 (owner's decision):** the `show` answer said "it has the keyboard", but `focus: true` is a request the surface grants only while the prompt has the keys over an empty composer. It now says `… to the front; it takes the keyboard if your prompt is empty (Esc gives it back).` (quoted above as changed). No `isFocused` check: its timing after a granted focus is unprobed. Red `3c6049b`, green `f5f2596`.
  - **Left for follow-ups, not fixed here:** the 500 ms `isShown` re-read is still unprobed (probe 1a).

## Change 0.3.0 (2026-10-16)

> "add a selector for api providers to duet claude mod. include a dozen or so providers from top 10 or top 20 rankings including but not limited to anthropic. ensure they share the same "api standard" so what we build for anthropic extends to other providers such as openai/chatgpt, gemini, etc... it will allow users to select anthropic or claude (whatever is industry standard best practices), followed by adding the API key then testing it. the api key is to be stored in the .env file in the project root. what other features/functionality am i not thinking of that are needed for this type of enhancement?"
>
> Decisions at clarification (the person's words, condensed): advisor, reviewer and `/duet review` as text-only roles on an API provider; implementer and routed subagent types stay on Codex until a tool loop exists (filed as its own issue). Key store: the user-level file, not the project's `.env`, since both sandbox settings make the project readable to every Codex run. Anthropic signed-in through `$.model.complete` (model, prompt, effort) when the session has a first-party credential; an API key over Chat Completions is the fallback and the path for every other provider. Selection is a route table, not a flag: per role and routed type, provider + model + effort, edited in the config pane and set by text as `reviewer=gemini:gemini-2.5-pro:high`; `codex` is one provider in that table.

**Delivery, two PRs** (the person's choice at approval, to keep Codex's review rounds and the live key tests tractable): **0.3.0, this PR:** A (providers as data), C (key store), D (provider pane and commands, key test), the `Provider` type widened, redaction, the mention guard, the new key names blanked; tests 1, 4, 5, 7 (models/test parts), 8, 13, 22, 23 (provider pane), 24 (the guard). **0.4.0, the next PR:** B (routes), E (API runs, consent by provider, separation of duties, packing, timeout), F's `apiRoutes`/`apiConsent`/`apiMaxTokens`, the rest of the tests and the "Done means" bullets about runs. `apiCustomUrl`/`apiCustomModel` land with the `custom` provider in 0.3.0. The base URLs stay `[probe]` until the person's live key tests between the two PRs.

### Why the design is a second backend, not a Codex setting

- **Codex can't carry other providers.** The installed Codex (0.163.0) says in its binary that `wire_api = "chat"` `is no longer supported`; third-party guides date the removal to February 2026 (`[field]`). Codex therefore speaks only OpenAI's Responses API. Anthropic's OpenAI-compatible layer is Chat Completions at `https://api.anthropic.com/v1/` (`[field]`, platform.claude.com, read 2026-10-16: "primarily intended to test and compare model capabilities"), and Gemini's is Chat Completions at `https://generativelanguage.googleapis.com/v1beta/openai/` (`[field]`, ai.google.dev, "still in beta"). So a `model_providers` entry for Codex reaches OpenAI and Responses-API gateways only, and fails the ask.
- **The shared standard is OpenAI's Chat Completions shape** (`POST {base}/chat/completions`, `Authorization: Bearer <key>`, `{ model, messages, max_tokens }`, `choices[0].message.content`, `usage.prompt_tokens/completion_tokens`, `GET {base}/models`). Every provider below documents that shape, so one client, built and tested once, serves all of them. It is one model call: no tools, no repository reads, no sandbox. Duet packs the context itself (below).
- **The engine gives the two calls needed** (`[d.ts]`, 2.1.301): `$.http.fetch(url, { method, headers, body })` → `{ status, ok, headers, text }` (the body whole, no streaming, no timeout or abort option), and `$.model.complete({ model, prompt, system, maxTokens, effort, timeoutMs })` → `{ isAnswered, text, usage }` or `{ reason: 'api-error' | 'empty-reply' | 'aborted', status, error }`, through the session's own client and sign-in, no key. **Build gate:** `$.model.complete` is `[d.ts]` only; a throwaway probe under `claude -p` runs it once (`haiku`, `maxTokens: 8`) before the Anthropic signed-in path is relied on. If it is refused on this build, `anthropic` falls back to the key path and the SPEC records it.

### What changes

**A. Providers as data** (`PROVIDERS` in `hooks/duet-providers-logic.ts`, a logic module of its own, pure, tested). Each entry: `id`, `name`, `baseUrl`, `keyName` (the conventional variable), `defaultModel`, `modelsPath` (`/models`, or `null` where the test falls straight to a completion), `auth` (`bearer`, or `session` for Anthropic signed-in). The base URLs and default models are `[field]` from the providers' docs and third-party lists and are **tagged `[probe]` until `/duet provider test` has hit each one live**; a URL that fails its test is fixed in the table, not worked around.

| id | name | base URL | key variable | default model |
| --- | --- | --- | --- | --- |
| `anthropic` | Anthropic (Claude) | signed-in: `$.model.complete`; key: `https://api.anthropic.com/v1` | `ANTHROPIC_API_KEY` | the session's model (signed-in); `claude-sonnet-5-5` (key) |
| `openai` | OpenAI (API, no tools) | `https://api.openai.com/v1` | `OPENAI_API_KEY` | `gpt-5` |
| `codex` | Codex CLI (OpenAI, with tools and sandbox) | the `codex` process, as today | Codex's own sign-in | `codexModel` |
| `google` | Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | `GEMINI_API_KEY` | `gemini-2.5-pro` |
| `xai` | xAI Grok | `https://api.x.ai/v1` | `XAI_API_KEY` | `grok-4` |
| `mistral` | Mistral | `https://api.mistral.ai/v1` | `MISTRAL_API_KEY` | `mistral-large-latest` |
| `deepseek` | DeepSeek | `https://api.deepseek.com/v1` | `DEEPSEEK_API_KEY` | `deepseek-chat` |
| `groq` | Groq | `https://api.groq.com/openai/v1` | `GROQ_API_KEY` | `llama-3.3-70b-versatile` |
| `together` | Together AI | `https://api.together.xyz/v1` | `TOGETHER_API_KEY` | `meta-llama/Llama-3.3-70B-Instruct-Turbo` |
| `fireworks` | Fireworks AI | `https://api.fireworks.ai/inference/v1` | `FIREWORKS_API_KEY` | `accounts/fireworks/models/llama-v3p3-70b-instruct` |
| `openrouter` | OpenRouter (gateway) | `https://openrouter.ai/api/v1` | `OPENROUTER_API_KEY` | `anthropic/claude-sonnet-5.5` |
| `perplexity` | Perplexity | `https://api.perplexity.ai` (no `/models`) | `PERPLEXITY_API_KEY` | `sonar-pro` |
| `cerebras` | Cerebras | `https://api.cerebras.ai/v1` | `CEREBRAS_API_KEY` | `llama-3.3-70b` |
| `ollama` | Ollama (local, no key) | `http://localhost:11434/v1` | none | the first model `/models` lists |
| `custom` | any OpenAI-compatible endpoint (Azure OpenAI, LiteLLM, LM Studio, a company gateway) | `apiCustomUrl` option | `DUET_CUSTOM_API_KEY` | `apiCustomModel` option |

"Anthropic or Claude": the provider is the company (`anthropic`), the model is Claude, as every SDK and gateway names them. `OpenAI` is the raw API (one call, no tools); `codex` is the same company's CLI with tools and a sandbox. The pane and `/duet routes` say which is which.

**B. The route table** (`apiRoutes`, a text option; aliases `routes`, `route`). Comma-separated entries `<key>=<provider>[:<model>[:<effort>]][;max=<tokens>][;timeout=<minutes>]`:
- `key` is a role (`advisor`, `reviewer`, `implementer`, by any of their names as `codexRunMode` reads them), `review` (`/duet review`), or a subagent type listed in `codexAgents`;
- `provider` is an id from the table; `model` is passed as given (empty: the provider's default); `effort` is one of `low`, `medium`, `high`, `xhigh`, `max`. The provider is read up to the first `:`; the effort is the text after the last `:` **only when it is one of the five levels**, so `ollama:llama3:8b` is model `llama3:8b` with no effort;
- `max` caps output tokens for that route (default `apiMaxTokens`, 8192); `timeout` is that route's minutes (default `timeoutMinutes`);
- an entry with no key (`anthropic:claude-opus-5-5:high`) is the default for the text-only keys (advisor, reviewer, review). `implementer` and routed types take only `codex` entries: another provider there is **refused by `/duet config`**, and `/duet routes` says `implementer and routed types run on Codex only (no tool loop yet)`;
- empty (the default): everything on Codex, exactly today's behaviour. `codexModel` stays and applies to Codex routes with no model; a route's model wins. A part that doesn't parse is refused with its text, as `codexRunMode` does.

Effort maps to `reasoning_effort` in the Chat Completions body, sent as given and only when set; a provider that rejects a level (OpenAI answers `400` for a value it doesn't know) makes the run a refusal that names the value and the level the route set (`duet: google rejected reasoning_effort "xhigh" (400: …); set a level the provider documents`), no clamping, to `-c model_reasoning_effort="<level>"` for Codex (`model_reasoning_effort` is a config key in the 0.163.0 binary, `[probe]`; which levels Codex accepts is checked live), and to `effort` on `$.model.complete`. Registered role descriptions are built from the route at `session.start` (`Runs on Google Gemini (gemini-2.5-pro), not Claude. …`), so Claude reads where a role really goes; a config change reloads and re-registers. Role names stay `duet:codex-advisor` and `duet:codex-reviewer` (renaming them is a breaking change; follow-up issue). Wait or background follow `modeOf` as today.

**C. Key store: `~/.claude/duet-data/.env`** (`HOME`, else `USERPROFILE`), `NAME=value` lines; a pure parser (`export ` prefix, single or double quotes, `#` comments, CRLF) and a pure upsert that rewrites one line and keeps every other byte. Precedence: the process environment first (`$.env.get` on each literal `keyName`, which validate lists), then the file; the pane names the source. After each write on a POSIX host duet runs `chmod 600 <file>` (`$.fs.write` takes no mode, `[d.ts]`); the result names a `chmod` that failed. **Not the project's `.env`**: a key there is readable by every Codex run under both `codexFsScope` settings and by any Bash command in the repository, which breaks the non-negotiable about not handing one provider another's credentials. Under `codexFsScope: anything` Codex can still read the user file, as it can any file; under `project` it can't. The README says both. ~~Every `keyName` in the table joins `BLANKED_ENV`~~ (superseded at review, the owner's decision: none is blanked; see "The blanking decision" below). **Headless:** `claude -p` has no pane, so keys come from the environment or a file edited by hand; `/duet provider test <id>` works as text.

**D. The provider pane and commands** (`/duet provider …`, pane `duet-providers`, `focus: true` on open, same key style as `/duet config`):
- `/duet provider` opens the pane: one row per provider: name, auth (`signed-in` · `key …a1b2` from the file · `key …a1b2 from env` · `no key`), last test (`ok 412 ms gemini-2.5-pro` · `401 unauthorized` · `untested`), and `●` on the providers the route table uses. Keys: `j`/`k` move; `e` opens one `Input` (`prov-key`) for the key; **the key is visible while typed** (`Input` has no masking, `[d.ts]`) and shown as `…last4` once Enter stores it; `t` tests; `m` lists the provider's models (`GET /models`, the Codex picker's list reused: `1`–`9` pick a default model into the route draft, `r` refreshes); `x` removes a key after `$.ui.ask` (a hotkey that deletes asks first; the typed command is immediate); `c` closes. No `Input` on the surface (mobile): the pane prints the rows as text and says to use the commands.
- `/duet provider list` prints the rows. `/duet provider key <id>` opens the pane on that row with the `Input` open; **a key typed as a command argument is refused** (`duet: never type a key into the prompt; it would land in the transcript. Use the pane's Input or the key file.`), since a command's text goes to the transcript and the model. `/duet provider test <id> [model]`, `/duet provider models <id>`, `/duet provider remove <id>`.
- **Test** (`t`, `test`): store first, then test, so a failed test leaves a known state. `GET {base}/models` with the key: `ok` records status, latency and the model count. A `404`/`405` there is reported as a likely wrong base URL and **spends nothing** (added at build, from a side note: every URL in the table is `[probe]`, so a wrong one must not trigger a billed request). The one-token completion (`max_tokens: 1`, prompt `Reply with ok.`), which most providers bill, runs only for a provider the table says lists no models (`perplexity`), or when the person names a model: `test <id> <model>`; it records status, latency and the model the reply names, and the row says `1 token`. `anthropic` signed-in is tested when a run goes to it (0.4.0); with a key stored it tests like any other. Results (status, time, model; never the key) go in `$.store` key `duet:providers:tests` (shared across sessions, no secret in it).
- **Redaction:** keys never reach the pane, toasts, `$.ui.log`, `runs.jsonl`, `review-*.md`, `d<n>.out.md`, the handoff or error text; every text duet shows or writes passes `redact(text, keys)`, which replaces each stored key's value with `[redacted]`. Request bodies are never logged. A `prompt.mention` guard (`{ path: /duet-data[\\/]\.env$/ }`, with `.catch`) denies reading the key file into Claude's context.

**E. API runs** (`runApi` in `register.tsx`, one top-level function; the request and response are pure):
1. **Consent**, once per provider per session (`consents: Record<provider, Consent>` replaces the single `consent` atom; Codex keeps its text): `Send this task to Google Gemini? Duet sends the task, the exact diff and 4 attached files (12 KB) to generativelanguage.googleapis.com under your GEMINI_API_KEY. Allow for the rest of this session?` `apiConsent` (`ask` | `allow`) is the provider-wide equivalent of `codexConsent` for `claude -p`. For `anthropic` signed-in: `… through this session's Claude sign-in, as a separate billed request`.
2. **Separation of duties** (kept on purpose: independence outranks an Opus-reviews-Sonnet setup, so the signed-in path serves the advisor only). A review (the reviewer role or `/duet review`) is refused, naming the rule, when its route's **model family** implemented. The family comes from `familyOf(provider, model)`: the provider id for a first-party provider (`anthropic`, `openai`, `codex` → `openai`, `google`, …); for a gateway (`openrouter`, `together`, `fireworks`, `custom`) and for any model id, a `claude` model (`anthropic/claude-…`, `claude-…`) is `anthropic` and a `gpt-`, `o1`/`o3`/`o4` or `openai/` model is `openai`; anything else is the provider id. `anthropic` is refused always (Claude implements in Claude Code), `openai` once an editing Codex run has happened in this session. The advisor is free. The refusal: `duet: a review never goes to the model family that implemented (anthropic, via openrouter anthropic/claude-sonnet-5.5); set reviewer to another provider in apiRoutes.`
3. **Concurrency** counts API runs with Codex runs against `maxConcurrent`.
4. **Context packing** (pure `packContext`): the model has no tools, so the handoff says `You cannot read the repository; what you need is attached below.` and attaches, for the reviewer and `/duet review`, the exact diff (`git diff` for uncommitted, `git diff <base>` for `--base`, `git diff <sha>^ <sha>` for `--commit`; never an implementer summary) and, for every role, the files the task names by a path that exists under the session folder (`$.fs.exists`, `$.fs.read`), to **12 files, 64 KB each, 256 KB in all, the diff 512 KB**; what was cut or skipped is listed in the handoff and in the footer, never silently. The packed context (diff and attachments) passes `redact(text, keys)` before it leaves, so one of your own provider keys never travels under another provider's key; other secrets aren't filtered, and the consent text says what leaves.
5. **Request:** `POST {base}/chat/completions`, `Authorization: Bearer <key>`, body `{ model, messages: [{ role: 'system', content: <envelope + role instructions> }, { role: 'user', content: <attachments + task> }], max_tokens, reasoning_effort? }`; no `temperature` or `top_p` (Anthropic's layer rejects values other than its defaults on current models). `anthropic` signed-in: `$.model.complete({ model, system, prompt, maxTokens, effort, timeoutMs })`.
6. **Timeout:** `$.model.complete` takes `timeoutMs`. `$.http.fetch` can't be cancelled, so the run races a `$.clock.after(timeout, cb)` timer callback (never `$.clock.sleep`, which counts against the hook's 10 s budget while an advisor run waits in the hook): on timeout the row is `error` (`timed out after 5 min; the request itself could not be cancelled`) and a late answer is dropped. **Zero retries**: a `429` or `5xx` is a refusal naming the status and `retry-after` when the header is there.
7. **Refusals the engine makes are visible:** a fetch the host refuses (`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, an organization's web-fetch policy) is reported as `duet: the host refused the request to <host> (<reason>); nothing was sent`; a `$.model.complete` `api-error` names its status and error; `empty-reply` and `aborted` are named as such. Never a silent fallback to Codex or Claude.
8. **Answer** in the Agent tool's `completed` or `async_launched` shape as today, footer `[duet d3 · google gemini-2.5-pro · no tools · diff 8 KB, 4 files attached (1 skipped: over 64 KB) · base abc1234 · one-shot run: start a new duet task to follow up]`; **no live token count while it runs** (the body arrives whole), the row says `waiting for <provider>`.
9. **Measure:** `Task.provider` and `RunLine.provider` widen from `'codex' | 'claude'` to any provider id (`types/index.d.ts`, the contract); tokens from `usage.prompt_tokens + completion_tokens` (Chat Completions) or `usage.input_tokens + output_tokens` (`$.model.complete`); `/duet stats` groups by provider as it does now, so API runs sit beside Codex and Claude rows. Prices aren't tracked (they change; a follow-up).
10. **`/duet review` on an API route** runs 4–9 with the reviewer role's instructions and the diff; the verdict line is parsed by `verdictOf` as today. `review` on `codex` is unchanged.

**F. Options added** (`userConfig`, all in `/duet config`):

| Key | Type | Default | What it does |
| --- | --- | --- | --- |
| `apiRoutes` | string | `""` (everything on Codex) | The route table (B). |
| `apiConsent` | `ask` / `allow` | `ask` | Once per provider per session, or pre-approved (headless). |
| `apiMaxTokens` | number | `8192` | Output cap for API runs without a route `max`. |
| `apiCustomUrl` | string | `""` | The `custom` provider's base URL (must be `https://`, or `http://localhost`/`127.0.0.1`). |
| `apiCustomModel` | string | `""` | The `custom` provider's default model. |

### What gets touched (the delta)

- **Files written (repo, the worktree `scratch/duet-api-providers`):** `mods/duet/hooks/duet-logic.ts` (providers, routes, dotenv, redact, request/response, packing, separation rule), `hooks/register.tsx` (`runApi`, the provider pane, `/duet provider`, the mention guard, consent by provider), `types/index.d.ts` (`Provider` widened; `consents`, `providerAt`, `providerEditing`, `providerModels`, `providerTests`, `providerNote` atoms), `plugin.json` (options, 0.3.0), `tests/*` (+ `tests/providers.test.ts`), `tests/env-names.ts` (the new key names), `SPEC.md`, `README.md`; `.claude-plugin/marketplace.json` (0.3.0). `plugins/mod-builder/skills/build/references/gotchas.md` gains the `$.model.complete` probe result and the Codex `wire_api` finding.
- **Files outside the repo, at run time:** reads and writes `~/.claude/duet-data/.env` (keys; `chmod 600` before and after each write on POSIX, none on Windows); reads nothing else new. `$.store` gains one key per provider, `duet:providers:tests:<id>` (status, time, model, a fingerprint of the key and the base URL; no key).
- **Network, directly by the mod (new):** `https://` requests to the chosen providers' hosts in the table, and to `apiCustomUrl`; `http://localhost:11434` for Ollama. Each carries the task, the diff and attached files under your key. Before: none directly.
- **Model calls by the mod (new):** `$.model.complete` for `anthropic` signed-in: a separate billed request on the session's sign-in, outside the conversation.
- **Environment:** reads each table `keyName` (literal names, listed by validate), `HOME`, `USERPROFILE`; ~~blanks the new key names in Codex's child env~~ (superseded: not blanked).
- **Processes:** `chmod`; `git diff` for the diff text (new); `codex` as today, plus `-c model_reasoning_effort` when a Codex route sets effort.
- **Asks:** one consent question per API provider per session; one before a hotkey removes a key.
- **Costs:** each API run bills the provider; a key test is free on `/models` and one token on the fallback; a `$.model.complete` call bills the session's account.
- **Build-time probes:** `$.model.complete` under `claude -p` (one `haiku` call, ~10 tokens); one live `provider test` per provider the person has a key for (I have none here, so the table stays `[probe]` for the rest; the README says which were hit).
- **Bypasses, unchanged:** a routed Agent call is answered above Claude's permission check; API runs have no tools, so there is nothing to sandbox, but what is attached leaves the machine.

### What I should see

```
 D U E T · providers                                     3 keys · 2 tested
 ──────────────────────────────────────────────────────────────────────────
 ▸ ● anthropic   Anthropic (Claude)      signed-in              untested
   ● google      Google Gemini           key …a1b2              ok 412 ms gemini-2.5-pro
     openai      OpenAI (API, no tools)  key …9f3e from env     401 unauthorized
     codex       Codex CLI (with tools)  codex login            —
     xai         xAI Grok                no key                 —
     mistral     Mistral                 no key                 —
     …
 ──────────────────────────────────────────────────────────────────────────
 routes  advisor → anthropic (signed-in, high) · reviewer → google gemini-2.5-pro
         review → google · implementer, routed types → codex (no tool loop yet)
 ● used by a route   keys: e enter key  t test  m models  x remove  j/k  c close
 [ Enter key ]  [ Test ]  [ Models ]  [ Remove ]  [ Close ]
```

Key entry (after `e`): the row shows `GEMINI_API_KEY: [typing is visible until Enter] ▏`; after Enter: `google  key …a1b2 (saved to ~/.claude/duet-data/.env, chmod 600) · t tests it`. Test running: `testing… GET /models`. Test failed: `✕ 401 unauthorized (invalid x-api-key)`, the key never printed. Too narrow (< 60 columns): name, auth and test only. Empty: `no provider keys yet · e on a row enters one · codex signs in with codex login`. A run row in the main pane: `d3  google  gemini-2.5-pro  duet:codex-reviewer  running  0m41s  waiting for google`.

### Tests (one per requirement that won't bend)

Logic (`tests/duet-logic.test.ts`, `tests/providers.test.ts`):
1. `PROVIDERS`: ids unique, none is `claude`; every entry has a name, base URL (`https://` or localhost), key variable (or none for `ollama`), default model; `anthropic` is `auth: session`.
2. `parseRoutes`: `reviewer=gemini:gemini-2.5-pro:high` → provider, model, effort; `ollama:llama3:8b` → model `llama3:8b`, no effort; `;max=16000;timeout=5` honoured; a keyless entry is the default for advisor, reviewer and review only; `implementer=google` and `code-explorer=anthropic` are refused naming "Codex only"; an unknown provider, a sixth effort level and a bad `max` are refused with their text; `""` routes everything to `codex`.
3. `routeFor(key, routes, codexModel)` precedence: entry → keyless default → codex with `codexModel`.
4. dotenv: parse (`export`, quotes, comments, CRLF, `=` in a value) and upsert (one line changed, every other byte kept, a missing file created) round-trip; `keyFor(provider, env, file)` prefers the process variable and names the source.
5. `redact`: every stored key is replaced in text, error JSON and headers; a 4-character suffix is what `maskKey` shows.
6. `chatRequest`: URL `{base}/chat/completions`, `Authorization: Bearer <key>`, messages system then user, `max_tokens` from the route, `reasoning_effort` only when effort is set, never `temperature`/`top_p`; `completeRequest` for signed-in Anthropic maps model, system, prompt, maxTokens, effort, timeoutMs.
7. `parseChatReply`: text, tokens from `usage`; an error body → `{ status, message }` with the key redacted; a `400` naming `reasoning_effort` → a refusal that names the level the route set; `parseModelsReply` lists ids.
8. `testOutcome`: `/models` 200 → ok with latency; 404/405 → `is the base URL right?`, no billed fallback; `modelsPath: null` or a named model → the one-token completion; 401 → `unauthorized`; 429 → `not retried`, naming `retry-after`.
9. `packContext`: attaches named files that exist, caps 12 / 64 KB / 256 KB / diff 512 KB, lists what was cut or skipped, never includes a file outside the session folder, and a stored key inside the diff or a file comes out `[redacted]`.
10. `reviewAllowed`: reviewer → `anthropic` refused always, and so is `openrouter:anthropic/claude-sonnet-5.5` and `custom` with a `claude-…` model (`familyOf`); → `openai`/`codex`/`openrouter:openai/gpt-5` refused after an editing Codex run this session; `google` allowed; advisor never refused.
11. `consentTextFor(provider, what)` names the provider, the host, the key variable (or the session sign-in) and the sizes attached.
12. `codexArgv` with effort → `-c model_reasoning_effort="high"`; without → unchanged argv (every existing argv test still passes).
13. ~~`BLANKED_ENV` equals the exact list with the new key names~~ (superseded: `env-names.ts` lists them under `PASSED_THROUGH`, and a routing test checks a routed call's env leaves them out).
14. `roleDescription` with a route → `Runs on Google Gemini (gemini-2.5-pro), not Claude.`; `runLineOf`/`summarize` group a `google` row beside `codex` and `claude`.

Events and UI (`tests/routing.test.ts`, `tests/providers.test.ts`, `tests/ui.test.tsx`):
15. `apiRoutes: 'advisor=google:gemini-2.5-pro'`: a `duet:codex-advisor` call → one `http.fetch` stub call to `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions` with the Bearer header from the stubbed key file, no `process.run` of `codex`, the `completed` record holds the reply and the `google gemini-2.5-pro · no tools` footer, and neither the record nor `runs.jsonl` holds the key.
16. `apiRoutes: 'advisor=anthropic'`: the same call → one `model.complete` stub call with `effort` and `maxTokens`, no `http.fetch`; a `reason: 'api-error'` answer → `{ deny }` naming the status.
17. `apiRoutes: 'reviewer=anthropic'`: a `duet:codex-reviewer` call → `{ deny }` naming separation of duties, no fetch; `reviewer=google` → routed.
18. `apiConsent: ask`, answer No → `{ deny }` naming the provider, no fetch; the next call to the same provider is refused without asking; a different provider asks.
19. A `429` reply → `{ deny }` naming `429` and `retry-after`, exactly one fetch; a fetch stub that denies with `nonessential traffic` → the refusal names the host and reason.
20. `/duet review` with `review=google`: the fetch body holds the `git diff` stub's text under the reviewer's instructions, no implementer summary, and the row's detail is the verdict line; `review` on `codex` → the `codex exec review` argv as today.
21. The timeout race: a fetch held past the route's `timeout` → the row is `error` naming the timeout and that the request couldn't be cancelled; the late answer changes nothing.
22. `/duet provider key google sk-abc` → refused, no write; `/duet provider key google` opens the pane with the `Input` open; the Input's `onSubmit` writes the key file (one upserted line, `chmod 600` run) and the row shows `…last4`; `x` asks before removing; `t` runs the test plan and the row shows its result; `/duet provider test perplexity` goes straight to the one-token completion.
23. UI: the providers pane on `terminal` and `desktop` finds the copy above in each state (empty, keys, testing, failed, too-narrow, no-Input surface); the main pane shows `waiting for google` on a running API row; `/duet demo` adds one API row.
24. `session.start` registers `codex-advisor` with the route's provider in its description; a `prompt.mention` of `~/.claude/duet-data/.env` is denied.

### Done means

- In `/duet provider` I move to `google`, press `e`, paste a Gemini key, press Enter: the row shows `key …a1b2`, the file `~/.claude/duet-data/.env` holds `GEMINI_API_KEY=…` with mode 600 and nothing else of mine changed; `t` shows `ok <ms> gemini-2.5-pro`; a wrong key shows `401` and never the key.
- `/duet config routes "advisor=anthropic::high, reviewer=google:gemini-2.5-pro"` is accepted; `/duet routes` prints both routes and that implementer and routed types stay on Codex; `implementer=google` is refused.
- Asking Claude for "a second opinion" spawns `duet:codex-advisor`, whose description now says it runs on Anthropic; I'm asked once to allow sending to Anthropic through the session sign-in; the answer comes back with the `anthropic` footer and a row with time and tokens; no `codex` process ran.
- Asking for "an independent review" runs the reviewer on Gemini in the background; the message arrives as today; `/duet review` with `review=google` shows a verdict in the pane; `/duet stats` groups `google` beside `codex` and `claude`.
- With `apiRoutes` empty, every existing test passes unchanged and the live behaviour is 0.2.13's.
- `/duet provider key google <key>` typed into the prompt is refused and nothing is written.
- All tests pass; validate clean (both guards have `.catch`; the Network and Environment rows of "What it reaches" are regenerated from its output); tsc clean; `/duet demo` shows every state; the `$.model.complete` probe result is in `gotchas.md`; follow-up issues filed: a tool loop for API providers (implementer and routed types), renaming `duet:codex-*` roles, per-provider prices.

### Build notes (0.3.0, 2026-10-16, Claude Code 2.1.301, codex-cli 0.163.0)

- **Every remote URL in the table answers** (`[probe]`, `claude -p --plugin-dir mods/duet "/duet provider test <id>"` with a dummy key in each provider's variable): openai 401, google 400 (`Please pass a valid API key`), xai 400, mistral 401, deepseek 401, groq 401, together 401, fireworks 401, cerebras 401, perplexity 401 (its one-token completion, since it lists no models), anthropic 401 (`Invalid bearer token`, the key path). None answered 404, so none is a wrong address. **OpenRouter's `/models` answers without a key** (`ok · 466 models` with the dummy): its entry is `modelsNeedKey: false`, and its test says `the list needs no key; test <id> <model> checks the key`. Ollama (not running here) → `✕ not sent: ECONNREFUSED …`. The default model ids stay `[field]`: no completion was run with a real key.
- **A `404`/`405` on `/models` never falls to the billed probe** (a side note during the build): it is reported as a likely wrong base URL; the probe runs only for a provider the table says lists no models, or on `test <id> <model>`.
- **`$.http.fetch` rejection wording** (`[probe]`): a connection that fails rejects with `duet: $.http.fetch(<url>) failed: <reason>` (`ECONNREFUSED: Unable to connect. Is the computer able to access the url?`); a policy refusal with `duet: $.http.fetch: <reason>`. `refusalReason` strips both.
- **The test harness draws `mobile` with an `Input`** (`[probe]`): the d.ts lists none for that surface, but `$.ui.mount({ surface: 'mobile' })` resolved a table where `'Input' in els` is true, so the text-only branch of the providers pane (and of the config pane) can't be reached in tests. It is read, not run.
- **The `anthropic` row with no key** says `signed-in` and its test answers `tested when a run goes to it (0.4.0)`: `$.model.complete` is still `[d.ts]` only and is the first probe of 0.4.0.
- **Tests fixed in their own commits:** the red commit's row widths overflowed a 76-column pane, and it asked Codex for a literal default model it does not have; the green commit dropped the mobile assertion (above) and moved the 404 rule.
- **Review of the Claude Design mockups (2026-10-16), what changed:** the `●` route mark is drawn by no row until 0.4.0 brings routes and its legend (the shipped hint line had dropped `● used by a route`); the owner's note added a second line to the saved note under `codexFsScope: anything` (`Codex can read this file under codexFsScope: anything; project hides it.`, 71 columns so it is not cut) and the key file's name to the Codex consent question under that scope (`consentText(cwd, sandbox, keyFile?)`); tests: `savedNote`, `consentText`, one UI test per scope, one routing test per scope. The mockup brief's models-list state was self-contradictory (2 models in the row, 5 in the list, a `… 3 more` the code draws only past 12 ids): the brief's fault, fixed in the brief.
- **PR #110 review rounds 1 and 2 (Codex, 2026-10-16), 17 of 18 fixed, each red then green:** upsert keeps one line where the last duplicate was (4297835963); a 2xx that is not a model list fails the test (4297835969); a saved or removed key drops the provider's stored test (4297835973); OpenRouter's public list needs no key, its probe does (4297835980); a removal gets the same `chmod 600` (4297835988); **P1** with no home folder nothing is stored and the pane says so, never a path under the project (4297835997); OpenAI's probe sends `max_completion_tokens` (4297836005, `[field]`: the others document `max_tokens`); a key test or model list waits 30 s through a `$.clock.after` race, then counts as not sent and a late reply is dropped (4297836014); `has_more` shows as `n+ models (first page)` (4297836020; the pages are not followed); a write that fails keeps the field open and names the reason, redacted (4297836029); keys are redacted longest first (4297836038); Anthropic's `anthropic-version` header (4298476139); test results are merged into the shared store one provider at a time (4298476151); a model list that lands after the person moved on is dropped (4298476163); a key file that exists but can't be read is named, not treated as empty (4298476175); model ids are redacted (4298476186); a `user:password@` URL is refused (4298476191). **Declined:** a cross-session lock on the key file (4298476147): `$` has no lock, the file is edited from one pane by one person, and each write re-reads the file just before it; documented instead.
- **Side note at review, fixed:** the mention guard covered only `@`; `tool.call{tool=Bash}` and `tool.call{tool=Read}` guards (`namesKeyFile`, both with `.catch`) now refuse a command or a read that names the key file; the README says what they do not catch (a script or another spelling).
- **Tests fixed in their own commit:** the custom-endpoint test's fetch stub answered a chat body to the models call, which the 2xx rule now rejects; the timeout test reads a 120-column pane, since a 76-column one cuts the test column.
- **PR #110 review round 3 (Codex, 6 P2) and `/code-review` (15 findings), 2026-10-16, all red then green except as noted:** double-quoted `.env` values decode (the closing quote is the first unescaped one; an unknown escape falls back to the text between the quotes) (4298736511); a provider that takes no key, and the custom endpoint at a local `http://` URL, need none (4298736545, 4298736595); a query or fragment in `apiCustomUrl` is refused (4298736558); the key file counts as exposed under `project` when the session folder holds it, in the saved note and the consent question (`keyFileExposed`, 4298736579); the reply's model name is redacted and cut to 60 characters (4298736527); a 2xx probe with a choice but empty content passes (a reasoning model spends the token thinking); Together's top-level model array counts; `"error": null` is no error; a Grep over the key file or its folder is refused (`namesKeyFolder`); a quoted path in a Bash command counts only when it is a rooted path, so a grep pattern or a commit message that names the file passes; a new key file is created empty and chmodded before the key is written; saves, removals and stored results go one at a time through `keyChain`; `providerFileError` is an atom, read at render; the typed-key refusal says the key is already in the transcript and shell history and to rotate it; the field hint no longer promises an Esc; the running row says `testing…` without naming the method. **Declined:** following `has_more` pages (the count says `n+`, a follow-up); the cross-session lock (round 2). **Known limit, stated in the README:** the Bash guard is a text match: a wildcard, a `grep -r` over `~/.claude` or a `cd` first still read the file.
- **Tests fixed in their own commit:** the custom endpoint's `no key` text names the host once a URL is set; the remove-then-chmod test starts with two keys, since removing the only one leaves an empty file.
- **PR #110 review round 4 (Codex, 7 P2) and the second `/code-review` (15 findings), 2026-10-16, red then green:** a JSON `null` (or any non-object) reply fails the test and `testProvider` ends in `finally`, so nothing stays on `testing…` (4298989618); a result carries the mask of the key it tested (`TestResult.key`), a per-provider count (`provGen`) bumped by saves, removals and test starts drops a reply that lands after the key changed, a stored result for another key shows as `untested`, and `t` while running sends nothing (4298989626); the guard's text match normalizes `$HOME`, `${HOME}`, `//` and `/.`, counts a rooted path to the file or its folder anywhere (quoted, `-c` payloads, wildcards, `cd`), and skips heredoc bodies, comments and unrooted mentions, so docs that name the path can be written (two findings); Retry-After, model ids, model names and error messages pass `clean` (no control characters or line breaks, bounded) and `redact` (4298989611, 4298989646); a 429 keeps the body's message; Anthropic's key goes as `x-api-key` beside Bearer until a real key settles it (4298989651, unverified); the model list under a row takes only the lines the window has left, and the config pane's rows scroll in the same window with wider aliases (4298989642); `keyFileExposed` is false for an unknown session folder and compares Windows paths without case; the key file's path is read outside the consent `try`; the final write of the key file is chmodded too, and a new file whose mode can't be set gets no key; U+2028/U+2029 round-trip; the refusal note shows after `t` whenever the test did not run; `apiCustomModel`'s texts say it is for 0.4.0 runs (4298989633). **Declined:** blanking only the keys duet manages (the non-negotiable is that no provider gets another's credential; the README names the `env_key` consequence); following `has_more` pages (as before). **Stated:** the hand-declared `BuiltinToolInputs.Grep` may collide with a later build's tools d.ts in `tsc -p mods/duet` (gotchas).
- **Tests fixed in their own commit:** two fixtures put raw control characters inside JSON strings, which is not JSON; they now carry the escape sequences a provider sends.
- **The blanking decision (the owner, 2026-10-16): reverted.** The eleven provider key variables leave `BLANKED_ENV` (they were added in part C): a key duet keeps lives in its file, which blanking a variable does nothing about, and one set in the shell is the person's own credential for Codex too; `tests/env-names.ts` lists them under `PASSED_THROUGH`, and a routing test checks a routed call's env leaves them out. The README's Install paragraph says so and adds: keep a key in the key file rather than the shell when Codex must not see it, since the environment wins over the file. The README gains "Keeping agents out of the key file", the owner's five layers (Codex `project` scope, Claude Code's Bash sandbox credential denies, permission deny rules for Read/Grep/Glob, duet's own guards, fewer keys through a gateway); issue #114 proposes `project` as the default. A `tool.call{tool=Glob}` guard joins Grep's (layer 4).
- **PR #110 review rounds 5 and 6 (Codex, 4 + 2 P2, 2026-10-16), all fixed red then green:** the key file's mode is set before any write, on a new file (created empty) and on an existing one, and a mode that can't be set means nothing is written and the field stays open (4299362989); a result carries the base URL it reached (`TestResult.host`), so a custom endpoint that moved shows as `untested` (4299362999); an error object on a 2xx, a failed model list's text and Retry-After are cleaned and bounded, and every provider string is cleaned before it is redacted, so a credential split by a control character is still caught (4299363010, 4299363023, 4299426954); the test slot is claimed before any await, so two starts of one provider send one request (4299426945). A test's expectation of the existing-file write order was updated in its own commit, since the fix changed that order on purpose.
- **PR #110 review round 7 (Codex, 5 P2) and the third `/code-review` (15 findings), 2026-10-16, red then green.** Two were regressions of round 6: cutting provider text before redacting it left the prefix of a key that straddled the cut, now `safeText` (strip controls, redact, then cut) at every site; and requiring `chmod` to succeed blocked every save on Windows, now a Windows path (`C:/…`) skips it and the note says `Windows: no chmod`. The rest: one store key per provider (`duet:providers:tests:<id>`, CLAUDE.md's store rule; 4298476151 was only narrowed before); results bound to a fingerprint of the whole key (`keyId`, FNV-1a), `none` for no key, so two short keys or a key added later no longer pass for each other (4299537610); the header counts only current results (4299537623); a model list keeps 200 ids and says how many more (4299537637); the Bash guard is a tokenizer anchored on `.claude/duet-data` (4299537644): a rooted path in an argument, after `=`, in a `-c` payload, a here-string or a heredoc an interpreter reads counts, as do globs and braces matching `.env` and `..`; a quoted message with spaces, a grep pattern, a heredoc `cat` writes out, a `#` comment and another folder named `duet-data` don't; payloads nested past four levels are refused; Read checks the path itself; Grep and Glob share one regex matcher, so no tool types are hand-declared; a failed final chmod is a warning, not a green "saved" (4299537601, no rollback: the first chmod already held); an `fs.exists` that rejects never truncates the file; headless `key <id>` names the variable and the file; the config pane marks the option rows its window hides; Retry-After takes `s` only for seconds. **Tests fixed in their own commits:** a commit message that names the path was asserted as a read (round 4's choice, reversed); four expectations (a 64-character constant, `s` on non-numbers, a Windows note wider than the pane, the missing `store.delete` stub).

## Change 0.3.1 (2026-10-21)

> Issue #115: the post-merge `/code-review` of PR #110 (each finding reproduced with the repo's logic loader). A security review of the same merge found no HIGH or MEDIUM vulnerability.

- **What changes:**
  - **The key-file guard** reads every argument of an interpreter as code (`bash -lc`, `sh -ec`, `zsh -ic`, `node -p`, `php -r`, `eval`, and an interpreter a command starts, `timeout 5 bash …`), and text piped into one (`echo '…' | sh`; a heredoc on a line that pipes into one, `cat <<'EOF' | bash`). A path inside code stops at code punctuation (`'…/.env', 'utf8'`, `['cat','…/.env']`, `{path: '…'}`) while `{a,b}` and `[…]` groups stay whole. A quoted rooted path with a space (`"C:/Users/John Smith/…"`) counts unless it reads like a message (`: `). Windows home spellings (`$env:USERPROFILE`, `${env:HOME}`, `%USERPROFILE%`) count. The Bash hook becomes `{ tool: /^(?:Bash|PowerShell)$/ }`. A Grep rooted above the key folder (a `.claude` folder, the home folder or higher, `/`), or with no path in a session started there, is refused (`searchCoversKeyFile`); a Glob lists names, not contents, so it is unchanged.
  - **The custom endpoint:** `isAllowedBaseUrl` refuses whitespace, control characters and backslashes anywhere (`https://evil.com\.good.com` is host `evil.com` under WHATWG); the refusal names `[::1]` and shows a `user:password@` as `***@`.
  - **The pane:** saving a key whose variable is set in the environment adds `<NAME> in your environment wins; unset it to use this key.`; Close and every open clear the key field, the model list and the note; `/duet config list` pads aliases to 11, as the pane does.
  - **Housekeeping:** the 13 environment reads and 15 store reads run in one round each; `TestResult` is the contract's `ProviderTest`; the shown key-file path is one constant.
  - **Conventions:** mod-builder 0.2.26 (PR #110 changed its `gotchas.md` without a bump); the gotchas entry on `BuiltinToolInputs` now describes the RegExp matcher duet uses; CLAUDE.md's matcher rule names RegExp literals; `apiCustomModel`'s description and the README's provider count are corrected.
- **What gets touched:** `mods/duet/hooks/duet-providers-logic.ts`, `duet-logic.ts`, `register.tsx`, tests, `plugin.json` (0.3.1), README, SPEC; `plugins/mod-builder/.claude-plugin/plugin.json` (0.2.26) and `skills/build/references/gotchas.md`; `.claude-plugin/marketplace.json`; `CLAUDE.md`. No new reach: `$.session.cwd` and `$.env.get` were already called.
- **Tests:** logic: code punctuation, interpreter arguments and pipes, spaced paths, Windows spellings, `searchCoversKeyFile`, the whole-URL check, the password-free refusal, `savedNote` with an environment variable, config-list columns; events: PowerShell, Grep above the folder and with no path from the home folder, the environment-wins note, the pane reset. One test fixed in its own commit (a missing import made it fail by ReferenceError; with it, it fails by assertion on the old padding).
- **Declined:** `readKeyFile` keeps its own read (it names the errno, which `readIfThere` drops); `chmod --` (the path is the trusted home folder plus a fixed suffix; a home starting with `-` makes chmod fail, so the save fails closed); `serializeEnv` stays (tested, small).
- **Done means:** the cases above are refused or allowed as listed; 0.3.1 and mod-builder 0.2.26 in both manifests and the marketplace.
- **PR #116 review round 1 (Codex, 2 P2, 2026-10-21), both reproduced and fixed red then green:** a `]` or `}` inside a home path segment (`/home/u]/…`) ended the path early, a regression of 0.3.0's coverage that this change introduced; such a character now continues the path when a later `/` follows in the same run, while one that closes code (`['…/.env']`, `{path: '…'}`) still ends it, and a comma still does (4337056082). `searchCoversKeyFile` treated any `.claude` folder as covering the key file, refusing a Grep of a project's own `.claude`; it now does so only while the home folder is unknown, and the prefix check finds the home one (4337056086).
- **PR #116 Codex round 2 (2026-10-21), all three reproduced on snapshots of `main`, 8972086 and 9daf839, fixed red then green.** Two were regressions of this change: a comma inside a home segment ended the path (`/home/u,team/…`; `main` caught it), now a `,` that a later `/` follows continues the path, as `]` and `}` do, and each word is also read the strict way, so a list of paths still has each path read (4337185228); a quoted message that starts with `/` and names the path later was read as one spaced path, now a space that starts another rooted path makes it a message (4337185247). New in this change: `searchCoversKeyFile` compared POSIX paths without case, now only drive and UNC paths fold case (4337185238). The guard's edge cases are documented rather than chased from here: it is a tripwire (README).

## Change 0.3.2 (2026-10-21)

> Issue #117 (the owner's go-ahead on 2026-10-21): two Codex findings posted on PR #110 after it merged, reproduced on `main` (426b6ff) and PR #116 (9daf839).

- **What changes:**
  - **A UNC home folder is Windows (Codex 4300203145).** `setMode` skipped `chmod` only for a drive-letter path, so `USERPROFILE=\\server\share\u` (`//server/share/u/…`) required `chmod` and every save and removal was refused. Windows is now told by the path's form (a drive or a UNC share) or by `OS=Windows_NT`, which Windows sets for every process; the API has no platform field.
  - **A test result the store refuses is not shown as kept (Codex 4300203151).** `storeProviderTestNow` writes the store first and answers why it refused; a refused result is not kept in the pane, the answer and the pane's note read `…; result not saved (<reason>), so it won't show after a reopen.`, and the header does not count it. A refused delete, when a key is saved or removed, adds `an old test result may still show (<reason>)`.
- **What gets touched:** `hooks/register.tsx`, `tests/providers.test.ts` (a `storeDeny` harness option and four tests), README (Windows detection, the Store and Environment rows), `plugin.json` and the marketplace entry (0.3.2). New reach: `$.env.get('OS')`.
- **Tests:** a UNC `USERPROFILE` saves without `chmod`; `OS=Windows_NT` saves without `chmod`; a refused `store.set` is named in the command's answer and the pane, and the header reads `0 tested`; a refused `store.delete` is named after a save and after a removal. POSIX hosts keep `chmod` (the chmod-order test).
- **Done means:** a Windows host with a UNC home folder can store keys; a store that can't be written never leaves a result that looks kept.
- **Test fixed in its own commit:** the engine under test collapses a UNC path's leading `//` on Linux, so the file is found by its ending.

## Change 0.3.3 (2026-10-21)

> Issue #119, step 2, with the owner's decisions (2026-10-21, #119's first comment):
> - for the run list after `/clear`, "Cheap guard only": the owner won't `/clear` with runs going, and would press Esc first;
> - consent: "Keep it";
> - dropped answers: "(b) Retry + toast";
> - stopping a background run is #121.

- **Why:** Anthropic's mod docs (`docs/research/Mods/`) describe practices duet didn't follow. The probes on #119 back each change:
  - `/clear` resets atoms, and `classic.SessionStart` fires after the reset (2.1.296, 2.1.306).
  - On 2.1.306, Esc kills a waited `$.process.spawn` and makes its loop throw `… aborted`. A `$.process.run` after that rejects at once. State writes, toasts and store writes still work. A `void` spawn survives.
- **What changes:**
  1. **The limit and ids after `/clear`.** `admit` counts `liveRuns(rows, mine)`: running Codex rows and this module's runs, each once. A review joins `mine` while it runs. `idAfter` (moved to `duet-logic.ts`) skips `mine`'s ids, so a run that outlived `/clear` keeps its own row.
  2. **Esc on a waited run.** The Agent hook passes `next.signal` to `routeToCodex`, then `runJob` and `runCodex`. A spawn error after the abort is `spawnErrorAction` `stop`. Before 0.3.3, the "spawn could not start" branch ran when no chunk had come yet: it patched a fallback note, tried a `$.process.run` the engine refuses, and recorded `codex could not start: …`.
     - The row ends `stopped`. `TaskStatus` gains it, `STATUS_COLOR` gives it the warn colour, and `countsOf` counts it apart from failures.
     - Its candidate is `STOPPED_CANDIDATE`: after the abort, git reads nothing, and a comparison would invent changes.
     - The toast reads `<id> stopped: you pressed Esc`.
     - Stats count a stopped run as not ok, the same as before.
  3. **A dropped delivery.** `finishInBackground` hands its text to `deliver`. A `{ drop }` for Stop (`retryableDrop`: the engine's two reasons) is kept in `held`, and the next main `turn.complete` empties `held` and resubmits detached. Any other drop or failure toasts `<id> ended on codex · answer in <file>` once. Before 0.3.3, only a rejection toasted, and a drop was lost quietly.
  4. **Consent after `/clear`.** `ensureConsent` keeps the answer in the module (`consentGiven`). A `classic.SessionStart` hook on `clear`, `resume` and `fork`, with `.catch`, writes it back. Startup and compaction reset nothing, so they are left out.
- **Not changed:**
  - The pane's run list still empties after `/clear`, by the owner's choice.
  - Background runs and reviews pass no signal (#121).
  - The lost-on-reload delivery in `session.start` keeps its quiet `.catch`: no test can set up a reload's lost row, and a reload isn't a Stop.
  - Where an organization manages Claude Code, `classic.*` hooks don't run in an installed plugin, so consent resets there.
- **What gets touched:**
  - `hooks/duet-logic.ts`: `liveRuns`, `idAfter`, `spawnErrorAction`, `STOPPED`, `STOPPED_CANDIDATE`, `dropOf`, `retryableDrop`, and `countsOf`.
  - `hooks/register.tsx`, `types/index.d.ts` (`TaskStatus`), and the tests: `duet-logic.test.ts`, plus `routing.test.ts`, whose harness gains a `drops` option.
  - `README.md`, this SPEC, and version 0.3.3 in `plugin.json` and the marketplace entry.
  - New reach: one hook, `classic.SessionStart{source=clear|resume|fork}`, which only writes duet's own atom.
- **TDD:**

  | Part | Red | Green |
  | :- | :- | :- |
  | Limit and ids | `eba95bf` | `5b3c04d` |
  | Stop | `114b495`, `444fefa` | `43daee8` |
  | Dropped delivery | `1bc1d6c` | `183c3cd` |
  | Consent | `72f0f88` | `8589e30` |

  Each red failed by assertion. The consent test watches state writes, since the kit can't reset atoms the way `/clear` does.
- **Version:** 0.3.3 (patch).
- **Live check** (2026-10-21, Claude Code 2.1.306). A private tmux session ran `claude --plugin-dir <worktree>/mods/duet` with the installed duet turned off. A stand-in `codex` first on `PATH` read its input, slept, then printed three JSONL lines, so no Codex quota was used:
  1. **Esc on a waited run** (`duet:codex-advisor`, the stand-in still silent). The status line read `codex: 0 done · 1 stopped`, and the toast `duet: d1 stopped: you pressed Esc`. The stand-in was gone, and its call log shows one `exec`, with no fallback.
  2. **Consent after `/clear`.** Answered yes once, then `/clear`. The next delegation started Codex with no question.
  3. **A dropped answer.** A background `duet:codex-reviewer` run (40 s) was going, and the turn was stopped with Esc mid-stream. When the stand-in finished, no turn started. After the next message (`Reply only: ok`) and Claude's `ok`, duet's message carrying d3's answer arrived. The toast wasn't caught: it lasts 4 s, and the screen was read after that. The UI test covers it.
- **Review before Codex** (an advisor pass, 2026-10-21):
  - **The demo shows every state** (house rule), so it gains a `stopped` row: the demo's ids now run d6 to d1. Red `679b6bb`. Green `eb9cea1` also fixes what the red test found: `subText` showed a stopped row's description, not why it stopped. A stop shows its detail with no ✕ mark. `7ee7578` updates the test that pins the demo's size, which is built to fail first when the demo changes.
  - **Esc during the one-shot fallback** is a stop too. The fallback's `catch` applies the same `spawnErrorAction` rule. This is wiring only: the kit can't abort an event, and the path is rare (the fallback runs only when streaming can't start).
  - **Checked on the live check's disk:**
    - Both stopped runs were logged in their session's `runs.jsonl` (`ok: false`), so `$.fs.write` works after the abort.
    - After `/clear` the session id changed, so `d1` went into a new session folder, with no file collision.
- **What a stop leaves behind** (a side note on PR #123: Esc keeps Codex's partial edits).
  - **Probe** (2.1.306, a throwaway mod in a private tmux session): after the abort, `$.process.run(git)` is refused inside the hook (`… aborted`) but runs from a `$.clock.after` callback, at 0 ms and at 1.5 s.
  - **Change:** a stopped run that could write gets `STOPPED_CANDIDATE` first. A 0 ms timer then runs `compareAfterStop`: `git rev-parse --is-inside-work-tree`, then the same porcelain snapshot. `stoppedCandidateOf(before, after)` writes `stopped with Esc: <what changed>` on the row and toasts it. With no git reading, the placeholder stays, so a failed read isn't counted as every file changed.
  - **Commits:** red `797917e`, green `e5d9852`. The README says Esc undoes nothing and to check `git status`.
  - **Live check:** a stand-in `codex` under `workspace-write` (`duet:codex-implementer`) wrote one file and hung, and Esc followed. The toast read `d1 stopped with Esc: files changed during this run: 1 (duet-stop-probe.txt)`, and the stand-in was gone. The file was removed afterwards, which left the worktree clean.
- **PR #123 review round 1.** Codex raised three P2 findings, and a `/code-review` at xhigh tested each with probes and mutation runs. Its advisor pass decided what is fixed here and what is filed. Each finding was checked again here.

  | Finding | Commits |
  | :- | :- |
  | 1. The reach table | `9fddde6` |
  | 2. A failed git read (Codex P2) | red `d95039f`, green `b9174cf` |
  | 3. Consent after a reload (Codex P2) | `a87a43e` |
  | 4. `dropOf` | red `18b3c3d`, green `378bb06` |
  | 5. The lost-on-reload message | `df22e80` |
  | 6. Run ownership | `0f5afd9` |
  | 7. `codexRunning` removed | `3e60d71`, `48491a8` |
  | 8. `outcomeOf` | red `35326a9`, green `8ceb24f` |
  | 9. The stop wording | red `6d76a3a`, green `0d9192e` |

  1. **The reach table.** Its code spans held unescaped pipes, the older regex entries' included, and these split the cells. They are escaped now, and the gating-hooks and processes rows name 0.3.3's hook and timer. Checked with GitHub's Markdown API: 12 rows of 2 cells.
  2. **A failed git read is no reading.** `git()` turned a failed read into `''`, so every file dirty before an editing run counted as changed by it. That happened on the done path and after a stop alike. The routing test reproduced it as `files changed during this run: 2`. Now `gitRead` returns `null` for a failed or unstartable git, `porcelain` passes it through, `candidateFrom` records `files not compared: git could not read the folder`, and `stoppedCandidateOf` keeps the placeholder. `compareAfterStop`'s `rev-parse` pre-check goes.
  3. **Consent after a reload.** The module copy is filled from the atom at `session.start` and in `ensureConsent`. This is wiring only: the kit can't build "atom set, module copy empty", since a `state.get` hook is ignored and the test `$` has no `$.state`. Live: Yes, then `/reload-plugins`, then `/clear`, then a delegation that asked nothing.
  4. **`dropOf`** returns `null` for a queued prompt and a reason for any drop, so `{ drop: '' }` is no longer taken as delivered.
  5. **The lost-on-reload message** goes through `deliver`. This is wiring only.
  6. **`admit` owns run ownership.** An admitted run joins `mine` as soon as the write lands, before `refreshStatus`. It isn't added inside `update`'s function, which runs again on a version miss (2.1.306 types).
  7. **`codexRunning` is removed.** Its test now goes through `liveRuns`.
  8. **`outcomeOf`** decides a run's end: its status, whether to compare now, after the stop or not at all, its candidate, and its toast. Before this, the review's mutation that mapped a stop to `error` survived every test.
  9. **The stop wording** is `stopped: cancelled (usually Esc)`, and the candidates read `stopped: …`. `next.signal` also aborts when a hook above settles first or the budget runs out. The live checks above quote the old strings, which were the output at the time.

  Not fixed here:
  - **Filed as an issue:** Codex's third P2 (held answers aren't scoped to their session, so they survive `/resume` and are lost on a reload), and the consent answer carrying over to another folder on `/resume`.
  - **Still not covered by any test**, because the kit can't abort an event or reset atoms; the live checks cover them: `next.signal` reaching `runCodex`, the `$.clock.after` comparison, the fallback's stop branch, and the hydration.
  - **Live check** (2.1.306, the stand-in `codex` under `workspace-write`, consent `ask`):
    1. Yes, then Esc after the stand-in wrote its file. The toast read `d1 stopped: files changed during this run: 1 (duet-stop-probe.txt)`.
    2. `/reload-plugins`, then `/clear`, then a second delegation that asked no consent question. Esc on it read `d1 stopped: no files changed by this run`, since the file was unchanged since that run began.

    The file was removed afterwards.


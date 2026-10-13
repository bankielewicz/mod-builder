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

A custom agent is spawned with its file name as `subagent_type`, so `codexAgents` routes it like any
built-in type. For a routed custom agent the mod reads its definition (project `.claude/agents/<type>.md`
first, then `~/.claude/agents/<type>.md`) with `$.fs`, and pure `parseAgentFile` takes its frontmatter
(`name`, `description`, `tools`, `model`) and body:
- the body goes into the handoff as **Role instructions**, ahead of the task;
- `tools:` that grants no edit tool (no `Edit`, `Write`, `NotebookEdit`, `MultiEdit`) **clamps Codex to `read-only`**, whatever `codexSandbox` says (an agent can only lower the sandbox, never raise it);
- `model:` is not mapped to Codex (Claude aliases mean nothing there); `codexModel` applies.
- no file found → routed as a plain type, with no role instructions.

Three example agents are written to this repo's `.claude/agents/` to prove it end-to-end:
`code-explorer` (read-only: Read, Grep, Glob), `test-writer` (Read, Write, Edit, Bash) and
`diff-reviewer` (read-only: Read, Grep, Glob, Bash).

## What gets touched

- **Files written (repo):** `.claude/agents/code-explorer.md`, `test-writer.md`, `diff-reviewer.md` (examples); `mods/duet/…` (SPEC, README, plugin.json, hooks.json, register.tsx,
  duet-logic.ts, types/index.d.ts, tests, tsconfig.json, .gitignore); one entry in `.claude-plugin/marketplace.json`.
- **Files read at run time:** `.claude/agents/<type>.md` and `~/.claude/agents/<type>.md` for routed types.
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
2. **Review (`/duet review`):** answers at once and runs in the background: `codex exec review --json -s read-only` with `--uncommitted` (default), `--base <branch>` or `--commit <sha>`, instructions "review against the stated intent; report findings with file:line and severity; do not trust any summary". No implementer summary is passed. Verdict and findings land in the task row and a toast; `/duet` shows them. The mod never applies them or re-dispatches.
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
- **What changes:** `BLANKED_ENV` goes from 16 names to 38, by these groups:
  - AWS (Bedrock page): `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`.
  - Claude Platform on AWS page: `CLAUDE_CODE_USE_ANTHROPIC_AWS`, `ANTHROPIC_AWS_WORKSPACE_ID`, `ANTHROPIC_AWS_BASE_URL`, `ANTHROPIC_AWS_API_KEY`.
  - Bedrock page (Mantle): `CLAUDE_CODE_USE_MANTLE`, `ANTHROPIC_BEDROCK_MANTLE_BASE_URL`.
  - Env-vars page: `CLAUDE_CODE_OAUTH_REFRESH_TOKEN`.
  - Foundry: `ANTHROPIC_FOUNDRY_AUTH_TOKEN`. The Foundry and Claude Platform on AWS names were checked against the provider and env-vars pages on 2026-10-13: `ANTHROPIC_AWS_API_KEY` is on the Claude Platform on AWS and env-vars pages, `ANTHROPIC_FOUNDRY_AUTH_TOKEN` on the Foundry and env-vars pages.
  - Azure SDK default credential chain: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_CLIENT_SECRET`. The Foundry page's Entra path says only "the Azure SDK default credential chain" and names no `AZURE_*` variable (none appears on any of the five pages), so these come from the Azure SDK's documentation, not Claude's.
  - Workload Identity Federation (Anthropic's WIF reference; added on PR #30 review): `ANTHROPIC_IDENTITY_TOKEN`, "the literal JWT" from the identity provider, which Claude Code honors. Its file, config directory and IDs (`ANTHROPIC_IDENTITY_TOKEN_FILE`, `ANTHROPIC_CONFIG_DIR`, `ANTHROPIC_FEDERATION_RULE_ID`, `ANTHROPIC_ORGANIZATION_ID`, `ANTHROPIC_SERVICE_ACCOUNT_ID`, `ANTHROPIC_WORKSPACE_ID`) aren't secrets and pass through.
  - Never blanked, because Codex needs them: `OPENAI_API_KEY`, `CODEX_HOME`, `PATH`, `HOME`, the proxy variables.
  - Never blanked, because `''` isn't unset: paths, directories and profile names (`CLAUDE_CONFIG_DIR`, `ANTHROPIC_PROFILE`, `AWS_PROFILE`, `AWS_CONFIG_FILE`, `AWS_SHARED_CREDENTIALS_FILE`, `GOOGLE_APPLICATION_CREDENTIALS`, `AZURE_CLIENT_CERTIFICATE_PATH`, `AZURE_FEDERATED_TOKEN_FILE`). The green phase blanked them; review on PR #30 found that a `claude` run by Codex then uses an empty config directory (`CLAUDE_CONFIG_DIR= claude auth status` reports `configDirectory: ""`, probed on 2.1.296). Their values aren't secrets, and the files they name stay readable either way. `init.env` is typed `Record<string, string>`, so a variable can't be unset instead.
  - The README Install paragraph names the groups; its Environment row says "blanks the 38 names in `BLANKED_ENV`".
- **Considered and not taken:**
  - Enumerating the inherited environment (`$.process.run(['env'])`, `cmd /c set` on Windows) and blanking by pattern: one extra process per Codex run, and the names it blanks are invisible to `claude plugin validate`, so the README's reach row couldn't be generated from them.
  - A `sh -c` wrapper that unsets variables before `exec codex`: POSIX only and harder to audit.
  - Relying on `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB`: opt-in, and it would also remove `OPENAI_API_KEY`.
- **Limits:**
  - The list is explicit: a credential variable not named here still reaches Codex (a new cloud provider, a variable a user invented). New names are added as they are found.
  - Blanking hides variables, not files: Codex can read `~/.aws/credentials`, a file a path variable names, or any other file the user can (issue #3).
  - Codex 0.162.1 has an Amazon Bedrock provider (its binary contains `amazon-bedrock`, `AWS_PROFILE` and `AWS_BEARER_TOKEN_BEDROCK`; not run). Its AWS key variables are Claude Code's too, so a Bedrock-backed Codex gets them empty and must use a profile, which passes through. The README says so.
  - Named on the env-vars page and not blanked here, left for the owner to decide: `CLAUDE_CODE_CLIENT_CERT`, `CLAUDE_CODE_CLIENT_KEY` and `CLAUDE_CODE_CLIENT_KEY_PASSPHRASE` (mTLS to Anthropic; the key is a path, the passphrase a secret), and `CLAUDE_CODE_MESSAGING_TOKEN` (a per-session token Claude Code exports to hooks and Bash commands).
- **What gets touched:** `hooks/duet-logic.ts` (`BLANKED_ENV` only; both `process.run`/`spawn` call sites already take `childEnv()`), `.claude-plugin/plugin.json`, README, `plugins/mod-builder/skills/build/references/gotchas.md`, tests. The coverage kit (`plugins/mod-builder/skills/build/scripts/coverage/kit.mjs`) also gets a `toBeGreaterThanOrEqual` matcher, which these tests use; mod-builder's version is unchanged.
- **Tests:** `childEnv()` and `BLANKED_ENV` against a literal list of the new names (not derived from `BLANKED_ENV`), the originals, and the names Codex needs; a routed call, a review and `/duet config models` each get the cloud names as `''` and none of the Codex names.
- **Done means:** all tests pass, validate is clean.
- **PR #30 review** (Codex and `/code-review`, 2026-10-13), one commit each:
  - The tests' name lists live once, in `tests/env-names.ts`; `BLANKED_ENV` must equal them exactly, once each.
  - Secrets only: the eight paths and profile names above pass through.
  - A Bedrock-backed Codex is pointed at an AWS profile (README, Limits).
  - `ANTHROPIC_IDENTITY_TOKEN` is blanked (Codex).

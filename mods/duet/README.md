# Duet

Delegates chosen subagents from Claude Code to Codex, gets independent Codex reviews of your diff,
and measures every run so you route by evidence rather than by assumption.

- **Codex roles Claude can pick:** duet adds `duet:codex-advisor` (a second opinion; Claude waits for
  it), `duet:codex-reviewer` (an adversarial review that arrives in the background) and, under
  `workspace-write`, `duet:codex-implementer` (makes a scoped change; Claude waits) to Claude's agent
  list. They always run on Codex. Claude-side roles stay your own `.claude/agents` files.
- **Routing:** list subagent types in `/config → duet → Subagent types sent to Codex`. When Claude
  spawns one of those (a built-in like `general-purpose`, or a custom agent from `.claude/agents/`),
  Codex does the work, with a footer:
  `[duet d1 · codex · sandbox read-only · base 45798a0 · read-only run: no files changed · one-shot run: start a new duet task to follow up]`.
  **Named, isolated and nested calls stay on Claude** (Claude names an agent when it plans to message
  it, and a Codex run can't be messaged); `/duet` says so in its routes line. Every other type stays on Claude.
- **Wait or background:** a read-only Codex run either makes Claude wait for its answer or answers at
  once and delivers the answer later as a message ("The duet plugin sent a message: Background agent
  duet-d3 … finished on Codex"). Each role has a default and `codexRunMode` overrides it. A run that
  can edit always waits, so Codex and Claude never edit at the same time.
- **Custom agents:** a routed `.claude/agents/<name>.md` (or `~/.claude/agents/`) sends its body to
  Codex as role instructions. If its `tools:` grant no edit tool, Codex runs `read-only` regardless of the setting.
- **Independent review:** `/duet review` sends Codex the exact diff, never the implementer's summary.
  The verdict lands in the pane. Duet never applies fixes or chains another round.
- **Measurements:** every Codex run and every main-loop Claude subagent is logged; `/duet stats`
  compares them. A background or teammate Claude subagent is measured when its first turn ends.

```
 D U E T                                        1 running · 2 done · 2 failed
 ──────────────────────────────────────────────────────────────────────────
 ▸ d5   codex   gpt-5-codex  code-explorer        running   1m12s    38k tok
     "Find every caller of parseConfig and list risky ones"
     spec 3fa9c21 · base 45798a0 · sandbox read-only
   d4   codex   gpt-5-codex  review --base main   done      2m40s    61k tok
     verdict: changes requested (1 high, 2 medium, 0 low)
   d2   codex   gpt-5-codex  Explore              error     0m04s      – tok
     ✕ codex: not signed in. Run `codex login`, then retry.
 ──────────────────────────────────────────────────────────────────────────
 routes  codex ← code-explorer · named, isolated, nested stay Claude
 roles   advisor waits · reviewer bg · others bg   read-only · max 2
 [ Review diff ]  [ Stats ]  [ Next ]  [ Prev ]  [ Close ]
```

## Try it

```
/duet demo
```

- `/duet`: opens or closes the pane (`ctrl+x tab` gives it the keyboard: r review, s stats, j/k move, c close)
- `/duet demo`: one task in each state until the turn ends; nothing runs
- `/duet review [--base <branch> | --commit <sha>]`: an independent read-only Codex review (default: uncommitted changes)
- `/duet show <id>`: a review's full text
- `/duet stats`: runs, success rate, median time and tokens per provider and subagent type
- `/duet routes`: what goes where, what stays on Claude, each role's wait/background mode, and the sandbox
- `/duet config`: opens a config pane listing every option with its value. `j`/`k` move the highlight, `e` changes the highlighted option (sandbox and consent step to their next choice; the others open a text box, Enter sets it), `s` saves, `u` reverts unsaved edits, `c` closes. Edited rows are marked `•` until saved; after `s` the pane stays open (or comes back after duet reloads with the new settings) on the same row. On the `model` row, `e` opens Codex's live model list (`codex debug models`): `1`–`9` pick a model, `0` clears it back to Codex's default, and either closes the list; `t` types a name instead, `r` refreshes, and a name Codex doesn't list gets a "did you mean" warning. `/duet config list` prints the options as text, `/duet config models` lists the models Codex offers, and `/duet config <field> <value>` changes one directly (aliases `agents`, `sandbox`, `model`, `max`, `timeout`, `consent`, `mode`; `""` clears a text field). Use this when `/plugin` no longer shows options that already have a value

## Install

Needs the [Codex CLI](https://github.com/openai/codex) on PATH, signed in once with `codex login`.
Duet uses Codex's own sign-in and usage limits and never passes Claude credentials to it.

```
/plugin install duet --marketplace bankielewicz/mod-builder
```

From a local clone (`claude plugin marketplace add <folder>` once):

```
/plugin install duet@claudemod
```

While developing: `claude --plugin-dir <path-to>/duet`. Changes load with `/reload-plugins`.

## Options

| Option | Default | What it does |
| --- | --- | --- |
| `codexAgents` | empty (only the `duet:` roles) | Comma-separated subagent types Codex runs, e.g. `general-purpose, code-explorer`. `*` routes every type, Claude Code's own `Explore` and `Plan` included. Named, isolated and nested calls stay on Claude. |
| `codexSandbox` | `read-only` | `read-only` investigates and answers; `workspace-write` lets Codex edit files under the session folder. Agents that can't edit always run read-only. There is no full-access option. |
| `codexModel` | empty | `-m` for Codex; empty uses Codex's configured model. |
| `maxConcurrent` | `2` | Codex runs at once; beyond it, the call is refused with a reason. |
| `timeoutMinutes` | `20` | A Codex run past this is stopped and the call refused. |
| `codexConsent` | `ask` | `ask` once per session before the first handoff; `allow` pre-approves it (needed for `claude -p`). |
| `codexRunMode` | `background` | `wait` or `background` for `codexAgents` types, then overrides by type: `background, advisor=background, Explore=wait`. Roles default to advisor wait, reviewer background, implementer wait. A run that can edit always waits. |

An agent that writes files, like the example `test-writer`, needs `codexSandbox: workspace-write`
to save anything on Codex. With the default it can only read and report.

## Safety boundaries

- Codex always runs with `-c approval_policy="never"` under its own sandbox. Duet never passes
  `--dangerously-bypass-*` or `--approve-for-me`. Reviews are always read-only.
- **A routed Agent call is answered above Claude's permission check, so Codex's sandbox is the only
  control on that work.** Mods can't read the session's permission mode, so plan mode doesn't
  tighten Codex. That is why the default is `read-only`.
- Only main-loop subagents are routed (depth 1). Named, isolated and nested `codexAgents` calls stay
  on Claude; a `duet:` role from inside a subagent or isolated is refused with the reason.
  There are no automatic retries, and a Codex failure is a visible refusal (or, for a background
  run, a delivered failure message), never a silent fallback to Claude.
- A Codex run answers once and exits; its result says it can't be messaged (`canContinueAgent: false`).
- Read-only runs can go to the background; a run that can edit always waits. A config change reloads
  duet, and a background run it cuts off is reported as `lost when duet reloaded`.
- Each handoff carries the task id, spec version (prompt hash), base commit, allowed scope,
  prohibited actions (commits, pushes, branch changes, installs, network, outside-scope files)
  and the required output. For a run that can edit, the footer adds the files whose `git status` entry
  changed during the run (worded "during", since a background Claude subagent may have touched some;
  an extra edit to an already-modified file doesn't show). A read-only run skips the comparison.

## What it reaches

Mods are not sandboxed. They run with your access and skip Claude's permission prompts, so this
table lists everything this one can touch. It is generated from `claude plugin validate`.

| Reach | Detail |
| --- | --- |
| Hooks | `session.start`, `command.run{command=duet}`, `tool.call{tool=Agent}`, `turn.complete`, `ui.render{component=Pane, requestId=duet}`, `ui.render{component=Pane, requestId=duet-config}` |
| Agent list | `$.agent.register`: `duet:codex-advisor`, `duet:codex-reviewer`, and `duet:codex-implementer` under `workspace-write` (a few hundred tokens of context in every session) |
| Prompts | `$.prompt.submit`: one turn per finished background Codex run (its answer or failure) and per run a reload cut off |
| Settings | `$.config.list` / `$.config.set` on duet's own rows, from `/duet config` |
| Processes | `$.process.spawn` / `$.process.run`: `codex exec --json …`, `codex exec review --json …`, `codex debug models`, `git rev-parse`, `git status --porcelain` |
| Files | reads `<cwd>/.claude/agents/<type>.md`, `~/.claude/agents/<type>.md`; writes `~/.claude/duet-data/runs.jsonl` (no prompt text), `review-<id>.md` and `d<n>.out.md` (a background run's answer) |
| Network | none directly; **Codex sends the handoff and whatever it reads under the session folder to OpenAI** under your Codex sign-in |
| Model calls | none by the mod directly; Codex usage per routed call and review; each delivered background answer is a Claude turn |
| Environment | reads `HOME`, `USERPROFILE`; Codex's child env blanks `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_SESSION_ACCESS_TOKEN` |
| Asks | `$.ui.ask` once per session before sending to Codex (unless `codexConsent: allow`) |
| Gating hooks | `tool.call{tool=Agent}` with `.catch` (refuses on failure; never falls through) |

## Development

```
claude plugin validate .
claude plugin test .
```

Built on Claude Code 2.1.296 and codex-cli 0.162.1. Written spec-first with `/mod-builder:build`; see `SPEC.md`.

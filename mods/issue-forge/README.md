# Issue Forge

Hand it a GitHub issue number and it comes back with a pull request, built test-first and
checked by commands rather than by the model's word. Three subagents work in turn: **red** writes
tests that fail, **green** makes them pass, **refactor** tidies. Between phases the mod checks
the work: only test files changed in red, the tests failed and then passed, nobody edited the
tests to make them pass, and at least 95% of the changed lines and branches are covered. Nothing
is pushed until you say yes.

```
 I S S U E   F O R G E      #16 Mod Lab: Fix prompt and path header hardc…
 ──────────────────────────────────────────────────────────────────────────
 ✓ red       3 test files, failing as intended · a1b2c3d             2m10s
 ● green     attempt 2/3 · gate G: diff branch 91.30% < 95           4m02s
 · refactor
 · publish
 ──────────────────────────────────────────────────────────────────────────
 coverage   changed lines 100.00% · branches 91.30% · total 99.36% / 83.69%
 branch     issue-16-mod-lab-fix-prompt-and-path-header-hardc → main
 [ Stop ]  [ Status ]
```

## Try it

```
/issue-forge demo
```

- `/issue-forge <N>`: starts a run on issue N (one run per repository at a time)
- `/issue-forge status`: where the run is (and its worktree); with no run, whether `.issue-forge.json` validates
- `/issue-forge resume`: restarts a blocked or interrupted step
- `/issue-forge publish`: pushes the run's branch and opens the pull request
- `/issue-forge stop`: ends the run; its branch and commits are kept
- `/issue-forge demo [state]`: every state of the pane, with nothing real running
- `/issue-forge`: opens or closes the pane

Give the pane the keyboard with `ctrl+x tab`. Its keys are `p` publish, `r` resume, `s` stop,
`t` status, and in the demo `n` next and `e` end.

## Set up a repository

Commit a `.issue-forge.json` at the repository root. Commands are argument vectors, and the
coverage command must write LCOV:

```json
{
  "testCommand": ["npx", "vitest", "run"],
  "coverageCommand": ["npx", "vitest", "run", "--coverage.enabled", "--coverage.provider=v8", "--coverage.reporter=lcov", "--coverage.reportsDirectory=/tmp/issue-forge/cov"],
  "lcovPath": "/tmp/issue-forge/cov/lcov.info",
  "sourceGlobs": ["src/**/*.ts"],
  "testGlobs": ["src/**/*.test.ts", "test/**"]
}
```

Every field, with Python and pilot examples, is in [the design](../../docs/specs/issue-forge.md#4-the-repository-profile).
This repository's own profile is `.issue-forge.json` at its root.

### Where a run works

Two profile fields decide whether a run branches the checkout you start it from or gets a git
worktree of its own. They are committed with the profile, so they hold for everyone, and they are read
from `origin/<base>`'s copy before anything is switched or created:

| Field | Default | What it does |
| --- | --- | --- |
| `workspace` | `"ask"` | `"here"`: branch the checkout you start from; if it's *busy* (uncommitted changes, or not on the base), block. `"ask"`: the same when it isn't busy; when it is, ask whether to use a new worktree (no answer blocks). `"worktree"`: always add a new worktree from `origin/<base>` and never touch your checkout |
| `worktreeDir` | `"scratch/issue-forge"` | where new worktrees go, relative to the repository root. It must be gitignored |

A worktree run lives in `<worktreeDir>/<branch>/`. `/issue-forge status` names it, with the
`git worktree remove <path>` to run once the pull request merges. The mod never removes a worktree or
a branch. A relative `lcovPath` resolves against the run's folder, so runs in separate worktrees each
write their own coverage file. Before it asks to publish, the run checks the result with
`git merge-tree` against a freshly fetched `origin/<base>`, and the question names any files that
would conflict.

This repository sets `"workspace": "worktree"`: the installed plugins load from the main folder's
branch, so a run must never switch it.

A run needs an interactive session (`claude -p` exits before the agents finish), a checkout that
isn't busy or a worktree run (above), `gh` signed in, and `<base>` on `origin`. If an issue names another base (a line
`Base branch: <name>`), the run asks before using it, because the tests would run from that branch.
A name git could read as an option or a forced refspec (starting with `-` or `+`, or holding `:`)
is ignored. Globs use `*`, `**` and `?` only; braces, brackets and `!` are refused.

**Limits worth knowing:**
- Inside tmux, Claude Code runs named agents as tmux-pane teammates, and those can't run the mod's
  agents: the red phase blocks with `a pane-based teammate cannot run it`. Start the session with
  `--settings '{"teammateMode":"in-process"}'`.
- A new worktree has only what is committed: no `node_modules` or other untracked setup. Profile
  commands that need them fail in a worktree run (there's no setup command yet).
- Agents ignore the folder they're spawned in, so in a worktree run the mod moves the live agent's
  Bash, Grep and Glob into the worktree and refuses its edits outside it. A Bash command that `cd`s
  elsewhere still runs there.
- Needs git 2.38 or later (`merge-tree --write-tree` at ready; `rev-parse --path-format` at
  preflight needs 2.31). An older git blocks preflight with `unexpected: git rev-parse failed`.
- Runs were checked with Claude Code's `auto` permission mode. In other modes a phase agent's Edit or
  Bash may wait on a permission prompt nobody sees; the pane then shows `agent working` until you
  `/issue-forge stop`. There's no agent timeout yet.
- G6 checks that a behaviour test file (`behaviourTestGlobs`) is in the red commit, not what it tests.
- Command lookup uses `sh -c 'command -v …'`, so `sh` must be on PATH (Git Bash on Windows).
- The profile that runs is the one on `origin/<base>`, read after the switch; the checkout you start
  from only names the base.
- Profile commands must leave the tree as they found it: a gate that sees files changed after staging
  (a formatter, a snapshot update) blocks rather than commit bytes it didn't test. The run's branch is cut from `origin/<base>`, so
the profile and anything its commands use must already be there.

## Install

From the GitHub marketplace:

```
/plugin install issue-forge --marketplace bankielewicz/mod-builder
```

From a local clone (`claude plugin marketplace add <folder>` once):

```
/plugin install issue-forge@claudemod
```

While developing, from its folder:

```
claude --plugin-dir <path-to>/issue-forge
```

Changes load with `/reload-plugins` or a new session.

## Options

| Option | Default | What it does |
| --- | --- | --- |
| `redModel` | `opus` | model for the red agent |
| `greenModel` | `sonnet` | model for the green agent |
| `refactorModel` | `opus` | model for the refactor agent |
| `redAgentType` | `issue-forge:red` | another type runs red as that agent, unnamed, so duet sends it to Codex if the type is in duet's `codexAgents`. Codex needs `codexSandbox: workspace-write`, which also makes duet wait for the run; in duet's read-only background mode the phase would end at once with nothing written |
| `confirmPublish` | `true` | ask before pushing and opening the pull request; off publishes as soon as the run is ready |

The mod's own agents are spawned with a name, so duet leaves them on Claude even with
`codexAgents: "*"`.

## What it reaches

Mods are not sandboxed. They run with your access and skip Claude's permission prompts, so this
table lists everything this one can touch. It is generated from `claude plugin validate`.

| Reach | Detail |
| --- | --- |
| Hooks | `session.start`, `agent.offer{agent=issue-forge:red}`, `agent.offer{agent=issue-forge:green}`, `agent.offer{agent=issue-forge:refactor}`, `turn.complete`, `tool.call`, `prompt.submit`, `command.run{command=issue-forge}`, `ui.render{component=Pane, requestId=issue-forge}` |
| Processes | `$.process.run` and `$.process.spawn`, in the run's folder (the repository root, or its worktree): `git` (rev-parse, status, check-ignore, fetch, show `origin/<base>:.issue-forge.json`, for-each-ref, ls-remote, switch -c or worktree add, merge-base, rev-list, merge --ff-only, add -A, diff, commit, stash push/list/apply, merge-tree, push), `gh` (auth status, issue view, pr create), `sh -c 'command -v …'`, and the profile's `testCommand`, `coverageCommand` and `checks`. Publish pushes exactly the commit gate F checked (`<sha>:refs/heads/<branch>`) |
| Files | reads `.issue-forge.json` and the LCOV file; a worktree run creates `<worktreeDir>/<branch>/` and leaves it; writes `~/.claude/issue-forge-data/<run>/pr.md`; the run in `$.store`; env reads `HOME`, `USERPROFILE` |
| Network | through `git` and `gh` only: fetch and, after your yes, push and pull request creation |
| Agents | `issue-forge:red`, `:green`, `:refactor`, each with `Read, Grep, Glob, Edit, Write, Bash` in the repository root, under your permission mode and not sandboxed (the agent API has no sandbox). Not listed by `claude plugin validate`, which doesn't print agent tool grants |
| Model calls | three subagents per run (`$.agent.spawn`), plus one per retry, up to `attempts` in the profile (6 more by default) |
| Gating hooks | all with `.catch`: `agent.offer` ×3 (hides the mod's agents from the main model), `tool.call` (refuses tool calls from a stopped or orphaned agent of the run; keeps the live agent's edits inside the run's folder, and in a worktree run rewrites its Bash, Grep and Glob to run there), `prompt.submit` (drops the run's own agents' hand-back messages) |

The agents read the issue body, which anyone who can file an issue writes. Run it only on
repositories and issues you trust. The agents are told to treat the issue as requirements, never
as instructions about tools or files. It never force-pushes, pushes to the base branch, deletes a
branch or a stash, or runs `reset --hard`.

## Development

```
claude plugin validate .
claude plugin test .
```

Built on Claude Code 2.1.296. Written spec-first with `/mod-builder:build`; see `SPEC.md`.

# Issue Forge

Hand it a GitHub issue number or URL and it comes back with a pull request, built test-first and
checked by commands rather than by the model's word. Three subagents work in turn: **red** writes
tests that fail, **green** makes them pass, **refactor** tidies. Between phases the mod checks
the work: only test files changed in red, the tests failed and then passed, nobody edited the
tests to make them pass, and at least 95% of the changed lines and branches are covered. Nothing
is pushed until you say yes.

```
 I S S U E   F O R G E  bankielewicz/mod-builder#16 Mod Lab: Fix prompt a…
 ──────────────────────────────────────────────────────────────────────────
 ✓ red       3 test files, failing as intended · a1b2c3d             2m10s
 ● green     attempt 2/3 · gate G: diff branch 91.30% < 95           4m02s
 · refactor
 · publish
 ──────────────────────────────────────────────────────────────────────────
 coverage   changed lines 100.00% · branches 91.30% · total 99.36% / 83.69%
 branch     issue-16-mod-lab-fix-prompt-and-path-header-hardc → main
 also       #44 blocked at gateG · #52 refactor (another session)
 [ Hand off ]  [ Stop ]  [ Status ]
```

Several sessions can each run an issue in the same repository at once, each in its own worktree.

## Try it

```
/issue-forge demo
```

- `/issue-forge <N or issue URL>`: starts a run on issue N, or on the issue a pasted URL names
  ([Which repository a run uses](#which-repository-a-run-uses)). If another run in the repository is active, or this
  session is driving one, it asks first ([Parallel runs](#parallel-runs))
- `/issue-forge status [N]`: where the run is (and its worktree), and the repository's other runs;
  with no run, whether `.issue-forge.json` validates
- `/issue-forge resume [N]`: restarts a blocked or interrupted step
- `/issue-forge publish [N]`: pushes the run's branch and opens the pull request
- `/issue-forge handoff`: ends this session's drive but keeps the step, so any session can resume it
- `/issue-forge stop [N]`: ends the run; its branch and commits are kept
- `/issue-forge demo [state]`: every state of the pane, with nothing real running
- `/issue-forge`: opens or closes the pane

Without `N`, a command means the run the pane shows, even a finished one. If the pane shows none, it
means the repository's only active run; with several, it lists them and asks you to name one.

Give the pane the keyboard with `ctrl+x tab`. Its keys are `p` publish, `r` resume, `h` hand off,
`s` stop, `t` status, and in the demo `n` next and `e` end.

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
`git worktree remove <path>` to run once the pull request merges. The mod never deletes a worktree's
files or a branch. On resume it asks `git worktree list` about a kept worktree: one git has is reused,
and one with nothing at its path is added again, after a `git worktree remove` that only clears git's
entry for a folder deleted by hand. A folder at that path that git doesn't have as the worktree blocks
the run, and nothing runs inside it, since git there would work on the checkout above. A relative `lcovPath` resolves against the run's folder, so runs in separate worktrees each
write their own coverage file. Before it asks to publish, the run checks the result with
`git merge-tree` against a freshly fetched `origin/<base>`, and the question names any files that
would conflict.

This repository sets `"workspace": "worktree"`: the installed plugins load from the main folder's
branch, so a run must never switch it.

### Which repository a run uses

A run works in the clone your session started in. Its issue and its pull request go to the repository
`gh repo view` shows there, and every `gh` call of the run names it with `--repo`, so a stray `GH_REPO`
or a second remote can't send the run elsewhere. The masthead and `/issue-forge status` name it
(`o/r#16`; `host/o/r#16` on GitHub Enterprise).

- `origin` must be that repository, for fetching and for pushing. A renamed or transferred repository
  passes: when the URL's name differs, `gh` is asked what it calls it. A URL is never printed or passed on,
  since it can hold a token. A fork clone, where `origin` is your fork, blocks the run before it fetches
  or switches anything; forks are tracked in #26.
- A pasted issue URL must name that same repository, or the command answers
  `x/y#16 is in another repository: this checkout's GitHub repository is o/r. …` and starts nothing.
  Only `https://<host>/<owner>/<repo>/issues/<N>` is read.
- A pull request's number is refused (`#24 is a pull request, not an issue`), since `gh issue view`
  answers for those too.
- A run started by 0.3 or earlier has no repository recorded: it resumes and publishes as before, with no
  `--repo` and no check of `origin`.

### Parallel runs

Runs belong to the repository, not to the folder a session started in. Every worktree of a repository
shares git's common folder, and that keys the runs. So every session in the repository sees every run:
`/issue-forge status` lists them, and the pane's `also` line names the others. A session drives one run
at a time. To work on two issues at once, open a second Claude Code session in the repository. With
`"workspace": "worktree"`, each run gets a worktree of its own.

`/issue-forge <N>` (or an issue URL) asks one question when it would meet another run:

| Situation | Choices (the first is the default) |
| --- | --- |
| Another session drives #44 | Start #N in a new worktree · Take over #44 here · Cancel |
| #44 is blocked, interrupted or ready, and no session drives it | Start #N in a new worktree · Resume #44 here · Stop #44, then start #N · Cancel |
| This session drives #44 | Keep #44 (and start #N from another session) · Hand #44 off and start #N here · Cancel |

Esc, or text typed under Other, cancels. Only where nobody can answer (`claude -p`) does a start go
ahead with what you typed; in a session driving a run, it then explains how to start #N elsewhere and
starts nothing. If #N has an active run already, you get
its status instead.

A run records which session drives it. In any other session, Resume, Publish and Stop on that run ask
`If that session has ended, take it over?` before they act. The mod can't tell a crashed session from a
live one, so it asks rather than assumes. The driving session checks every 5 seconds and stops its
drive when another session stopped or took over its run; before a commit, a stash, the push and the pull
request it checks at once. Resume writes only if the run is still as it read it. A session that ends lets go of its run, but
`/clear` and `/resume` don't, because the process and the drive go on.

Hand off (`/issue-forge handoff` or `h`) ends this session's drive at once, as Stop does, but keeps the
step: the run reads *interrupted* everywhere, and `/issue-forge resume <N>` continues it in any session.
A stopped run can't be resumed.

Parallel runs share git's refs. A `git fetch`, `git stash` or `git commit` that finds another process
holding a lock is retried twice. One coverage file can't serve two runs at once, so an absolute `lcovPath`
(wherever it points) blocks a run's baseline and gates while another run is being driven: make it
relative (and gitignored), as this repository's `coverage/issue-forge.lcov` is. When a run starts, finished runs beyond the
repository's 20 newest are deleted from the store; their agents stay on the guard's list.

Runs stored by 0.2 or earlier, keyed by the checkout, move to the repository's keys when a session
first starts in that checkout or in another worktree git lists.

A run needs an interactive session (`claude -p` exits before the agents finish), a checkout that
isn't busy or a worktree run (above), `gh` signed in, `<base>` on `origin`, and `origin` is the repository `gh repo view` shows. If an issue names another base (a line
`Base branch: <name>`), the run asks before using it, because the tests would run from that branch.
A name git could read as an option or a forced refspec (starting with `-` or `+`, or holding `:`)
is ignored. Globs use `*`, `**` and `?` only; braces, brackets and `!` are refused.

**Limits worth knowing:**
- With agent teams on (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`), Claude Code runs the mod's named
  agents as teammates. Inside tmux they default to pane teammates, which can't run them: the red phase
  blocks with `a pane-based teammate cannot run it`, and `--settings '{"teammateMode":"in-process"}'`
  lets it start. An in-process teammate hands back through `session.receive`, which the mod doesn't
  consume yet, so the end of each phase starts a turn of the main model (#27). With agent teams off,
  neither applies.
- A new worktree has only what is committed: no `node_modules` or other untracked setup. Profile
  commands that need them fail in a worktree run (there's no setup command yet).
- Agents ignore the folder they're spawned in, so in a worktree run the mod moves the live agent's
  Bash, Grep and Glob into the worktree, makes its relative Edit, Write and Read paths absolute there,
  and refuses an edit outside it. A path it can't place (`\x`, `\\server\share`, `~`, `D:x`) is refused
  in every run. That catches honest mistakes; it isn't a sandbox. The check reads paths as text, so a
  symlink inside the worktree can still lead an edit outside it. A Bash command that `cd`s elsewhere
  or names an absolute path still reaches it, and a `here` run's agents can't Write outside the
  repository either (`/tmp` included).
- A red type that isn't the mod's own (`redAgentType`) can't run in a worktree: duet's Codex runs in
  the session's folder whatever the spawn says, so a worktree run with one blocks before it starts.
- A run started in a linked worktree puts its new worktree under that checkout's `worktreeDir`, so
  the agents' writes stay under the session's folder.
- The merge check at ready needs git 2.38 or later (`merge-tree --write-tree`); with an older git it
  reads `merge check unavailable` and the run goes on.
- Resuming a kept worktree whose folder was deleted needs git 2.31 or later, which marks it `prunable`
  in `git worktree list`. An older git lists it as there, so the resume fails instead of adding it again.
- Runs were checked with Claude Code's `auto` permission mode. In other modes a phase agent's Edit or
  Bash may wait on a permission prompt nobody sees; the pane then shows `agent working` until you
  `/issue-forge stop`. There's no agent timeout yet.
- G6 checks that a behaviour test file (`behaviourTestGlobs`) is in the red commit, not what it tests.
- Command lookup uses `sh -c 'command -v …'`, so `sh` must be on PATH (Git Bash on Windows).
- The profile that runs is the one on `origin/<base>`, read after the switch; the checkout you start
  from only names the base.
- If two sessions start the same issue at the same moment, the second write wins, and the other
  session's run stops at its next step.
- A crashed session leaves its run marked as driven until another session answers Take over.
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
| Hooks | `session.start`, `session.end`, `agent.offer{agent=issue-forge:red}`, `agent.offer{agent=issue-forge:green}`, `agent.offer{agent=issue-forge:refactor}`, `turn.complete`, `tool.call`, `prompt.submit`, `command.run{command=issue-forge}`, `ui.render{component=Pane, requestId=issue-forge}` |
| Processes | `$.process.run` and `$.process.spawn`, in the run's folder (the repository root, or its worktree): `git` (rev-parse, including `--git-common-dir` for each command, status, check-ignore, fetch, show `origin/<base>:.issue-forge.json`, for-each-ref, ls-remote, switch -c or worktree add, worktree list, worktree remove (only to clear git's entry for a kept worktree with nothing at its path), merge-base, merge --ff-only, add -A, diff, commit, stash push/list/apply, merge-tree, remote get-url, push), `gh` (auth status, repo view, issue view, pr create), `sh -c 'command -v …'`, and the profile's `testCommand`, `coverageCommand` and `checks`. Publish pushes exactly the commit gate F checked (`<sha>:refs/heads/<branch>`) |
| Files | reads `.issue-forge.json` and the LCOV file; a worktree run creates `<worktreeDir>/<branch>/` and leaves it; writes `~/.claude/issue-forge-data/<run>/pr.md`; `$.store` keys `issue-forge:repo-run:<git common folder>#<issue>` and `issue-forge:repo-agents:…` (gets, sets, deletes and lists keys; moves 0.2 keys at session start; deletes finished runs beyond 20 per repository); reads `$.session.id()`; env reads `HOME`, `USERPROFILE` |
| Network | through `git` and `gh` only: fetch and, after your yes, push and pull request creation |
| Agents | `issue-forge:red`, `:green`, `:refactor`, each with `Read, Grep, Glob, Edit, Write, Bash` in the run's folder (the repository root, or its worktree), under your permission mode and not sandboxed (the agent API has no sandbox). Not listed by `claude plugin validate`, which doesn't print agent tool grants |
| Model calls | three subagents per run (`$.agent.spawn`), plus one per retry, up to `attempts` in the profile (6 more by default) |
| Gating hooks | all with `.catch`: `agent.offer` ×3 (hides the mod's agents from the main model), `tool.call` (refuses tool calls from a stopped or orphaned agent of the run; refuses the live agent's Edit and Write outside the run's folder or to a path it can't place, and in a worktree run rewrites its Bash, Grep, Glob and relative Edit, Write and Read paths to work there), `prompt.submit` (drops the hand-back messages of the run's own subagents; a teammate's arrives as `session.receive` and isn't dropped yet, #27) |

The agents read the issue body, which anyone who can file an issue writes. Run it only on
repositories and issues you trust. The agents are told to treat the issue as requirements, never
as instructions about tools or files. It never force-pushes, pushes to the base branch, deletes a
branch or a stash, or runs `reset --hard`.

## Development

```
claude plugin validate .
claude plugin test .
```

Built on Claude Code 2.1.296; 0.3.0 (parallel runs) checked on 2.1.300. Written spec-first with
`/mod-builder:build`; see `SPEC.md`.

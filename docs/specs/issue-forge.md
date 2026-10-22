# issue-forge — implement GitHub issues test-first, behind a coverage gate

> The duet mod named below became `ensemble` at 0.4.0 (#128) and was then removed from this repo (#132); its last version is tag `ensemble-0.4.0`. This spec's records keep duet's names as they were written.

> **What it is.** A Claude Code mod that takes one GitHub issue and turns it into a pull request.
> Three subagents work on it in order: one writes failing tests (red), one makes them pass (green),
> and one refactors. Between phases the mod checks the work with commands and fixed rules, not
> with the model's word: the right files changed, the tests fail and then pass, the tests weren't
> edited to pass, and coverage of the changed lines is at least 95%.
>
> **Who it's for.** Any repository with GitHub issues, a test command and a coverage tool that can
> write LCOV. The design has no language or project in it; each repository describes itself in
> one profile file (§4). This repository is the pilot (Appendix A and B).
>
> **How to use this document.** A `/mod-builder:build` session reads it top to bottom, fills the
> SPEC slots from §7 without asking questions, and works through the checkpoints in §9 in order.
> Each checkpoint names the command that proves it. Facts are tagged by how they're known (§10):
> **[verified]** was run, **[d.ts]** is from Claude Code's API types, **[untested]** is a probe
> the build must run first.

Written 2026-10-13 against Claude Code 2.1.296, Node 24.21.0 and Codex CLI 0.162.1, on WSL2 Linux.
`docs/specs/` is new with this file.

---

## 1. Scope

**MVP** (what `/mod-builder:build` builds):
- one issue at a time, one run per repository at a time (since 0.3.0: one run per session, several sessions per repository; see the mod's SPEC, Change 0.3.0);
- GitHub only, through the `gh` CLI;
- any language whose test command runs from a terminal and whose coverage tool writes LCOV;
- the three phases on Claude subagents, each with its own model;
- push and pull request only after the person confirms.

**Red phase on Codex** (decided by probe P1, §9): if P1 shows that the duet mod routes a mod's
`$.agent.spawn`, setting `redAgentType` to a duet-routed agent type is part of the MVP. If it
doesn't, the red phase runs on Claude in the MVP, and Codex waits for the `$.tool.call` fallback (§6).

**Post-MVP** (designed for, not built): several issues in a queue; other forges.

**Not goals:** choosing which issue to work on; merging; editing the issue itself; working
without a coverage tool (the gate can't be measured, so the run refuses to start; §3, step 1).

## 2. Definitions

- **Repository root**: the output of `git rev-parse --show-toplevel` run from the session's working
  directory. If it fails, the run stops in `blocked`: "not in a git repository". Not `$.session.root()`,
  which is where the session started [d.ts].
- **Run**: one attempt to take issue *N* from open to a pull request, with its state saved (§7.4).
- **Base**: the branch the pull request targets: the profile's `baseBranch`, unless a line of the
  issue body matches `^Base branch: (\S+)$`. Then the first such line's branch is used.
- **Merge base**: `git merge-base HEAD <remote>/<base>` (`<remote>` is `origin`, or the project's remote in a fork clone), computed once when the run's branch is created.
- **Test files**: paths matching the profile's `testGlobs`.
- **Source files**: paths matching `sourceGlobs` and not matching `testGlobs` or `excludeGlobs`.
- **Measured source**: source files that the coverage tool instruments. **Unmeasured source**: source
  files matching `unmeasuredGlobs`, code the coverage tool can't reach (§5.4). Their changes
  need a behaviour test instead of a percentage.
- **Changed lines**: for each source file, the added or modified line numbers in
  `git diff -U0 --cached <merge base> -- <file>`. A hunk header `@@ -a,b +c,d @@` adds lines
  `c … c+d−1`; `+c` with no count means one line; `d = 0` adds none [verified: format].
- **Diff line coverage**: of the changed lines that the LCOV report has a `DA:` record for, the
  share with a hit count above 0.
- **Diff branch coverage**: of the `BRDA:` records on changed lines, the share whose taken count is
  a number above 0. `-` counts as not taken.
- **Total coverage**: Σ`LH`/Σ`LF` (lines) and Σ`BRH`/Σ`BRF` (branches) over the LCOV records for
  measured source files.
- **Threshold**: 95 by default (`threshold` in the profile), applied to diff line and diff branch coverage.

## 3. The workflow

Every step names its commands and its pass condition. A failed condition stops the run in the
state named, with the reason shown, unless the step says to retry. `<…>` values come from the
profile (§4). Every command is an argument vector run in the run's folder (the repository root, or
the run's worktree; SPEC change 0.2.0), with no shell unless the profile's own command uses one.

**Step 0: a new plugin isn't a run's (SPEC change 0.7.0).** Before anything is stored, the start reads the issue once (`gh issue view <N> [--repo <host/owner/repo>] --json number,title,body,state,url`). It does this after its same-issue check and before the start menu. When a line of the body asks for the work to be built with `/mod-builder:build` (the word `build`, then `with`, then `/mod-builder:build`), the start answers with next steps that lead to mod-builder. Above them it shows the line that matched, labelled as the issue author's words that issue-forge hasn't checked, and says to reword it if it doesn't ask for a new plugin. It shows no other issue text, since issue text is anyone's to write. It then stores nothing: no run, branch, worktree, agent or pane. A failed read starts as before, and step 1 reports the cause. So does a pull request's number: step 1 refuses it as a pull request, whatever its body says. The rule finds each word after the one before it, in linear time, since issue text is anyone's to write.

**Step 1: preconditions.** All must hold; otherwise the run stops in `blocked` with the first failure:
1. `gh auth status` exits 0. The repository is known: a run started from an issue URL is pinned to the
   repository the URL names, which must be the one `gh repo view --json nameWithOwner,url` shows in the
   checkout; any other run is pinned to what that command shows. `origin` fetches from and pushes to that
   repository (`git remote get-url origin` and every line of `git remote get-url --push --all origin`).
   An https or http remote must name the repository's host; an ssh remote may name an alias of it, so the
   same owner and repository is enough there. Another owner or repository on that host is matched through
   `gh repo view` (a rename); `gh` is never asked about another host. A kept worktree is checked there too,
   before its fetch, and publish checks origin in the run's folder before it pushes (a worktree's own config can
   differ). A number start is pinned to the repository as soon as origin agrees with it.
   A fork clone (SPEC change 0.5.0) is the exception to "`origin` is that repository": when every push URL of
   `origin` names one other repository on the same host, its fetch URL is that fork too, and
   exactly one other remote's fetch URL names the pinned one (`git remote`, `git remote get-url <name>`), that
   remote is the run's base remote. Two block (`remotes a and b both point at o/r`). For these remotes an ssh
   host other than the pinned one counts as `ssh -G <host>` resolves it (never assumed to be a nickname).
   `gh repo view <fork> --json isFork,parent` must show a fork of the pinned repository (owner login and name,
   any case), or the run blocks (`origin me/r isn't a fork of o/r`). `gh api --hostname <host> users/<owner>
   --jq .type` must not print `Organization` (`gh pr create --head` can't name one: cli/cli#10093). The run
   stores `baseRemote` and `headRepo`; below, `<remote>` is `baseRemote`, else `origin`, and before each fetch
   from a `baseRemote` its URL is read again in that folder and must still name the pinned repository.
   `gh issue view <N> --repo <host/owner/repo> --json number,title,body,state,url` shows `state: OPEN`
   and a url that isn't a pull request's.
2. The profile exists and validates (§4.2).
3. `git fetch <remote> <base>` succeeds.
4. Where the run works (`workspace`, read from `git show <remote>/<base>:.issue-forge.json`): a
   checkout is *busy* when `git status --porcelain` isn't empty or HEAD isn't `<base>`. `here`
   blocks a busy checkout; `ask` offers a new worktree for one (no answer blocks); `worktree` always
   makes one. A worktree needs `worktreeDir` ignored by git, and a red type the mod spawns itself.
5. No other run for this repository is active (§7.4).

**Step 2: branch.** `git switch --no-track -c issue-<N>-<slug> <remote>/<base>` in the checkout, or
`git worktree add --no-track -b issue-<N>-<slug> <worktreeDir>/<branch> <remote>/<base>`. A preflight
that blocks after this keeps the branch and folder, and resuming it reuses them. `<slug>` is the
issue title in lowercase, each run of non-alphanumeric characters replaced with one `-`, leading
and trailing `-` removed, cut to 40 characters (then a trailing `-` removed again). If that branch
name exists locally, on `origin` or on `<remote>`, append `-2`, `-3`, … until it doesn't.
`--no-track` keeps git from writing tracking config. Record the merge base.

**Step 3: baseline.** Run `testCommand`; it must exit 0, or the run stops in `blocked`: "tests
fail before any change". Run `coverageCommand`, then read the LCOV file. Record total line and
branch coverage as the baseline. If the LCOV file is missing or has no `SF:` record matching
`sourceGlobs`, stop in `blocked`: "coverage produced no data".

**Step 4: red phase.** Spawn the red agent (§6) with the issue text and the profile's globs. When
it finishes, stage everything (`git add -A`) and check **gate R**:
- R1: every staged path (`git diff --cached --name-only <merge base>`) matches `testGlobs`;
- R2: at least one staged path;
- R4 (SPEC change 0.7.0, checked first, before any test runs): no path added since the merge base is a Claude Code plugin manifest (`.claude-plugin/plugin.json`, in any case), and the guard refused none during the phase. Rename detection is off (`--no-renames`), so a moved manifest counts as added. A manifest the base branch's tip has (`git ls-tree <remote>/<base>`) doesn't count: it is someone else's plugin, merged in. A manifest that matches `testGlobs` is a test fixture and doesn't count.
- R3: `testCommand` exits non-zero. The baseline passed and only test files changed, so the new
  tests cause the failure. Which tests fail isn't checked (that depends on the language); the red
  agent's list of failing tests goes into the pull request for review.

On pass, commit `test(#<N>): red: <title>` (with `commitTrailers`; same for every commit below); record it as the **red commit**. On fail, give the
agent the failed checks and try again, up to `attempts.red` (default 2), then stop in `blocked`.

**Step 5: green phase.** Spawn the green agent with the issue text, the red agent's answer, the red
commit's test file paths, and the last 200 lines of R3's test output. When it finishes, `git add -A` and check **gate G**:
- G1: tests unchanged since the red commit: `git diff --cached --name-only <red commit> -- <testGlobs>` is empty;
- G2: `testCommand` exits 0;
- G3: `coverageCommand` succeeds and writes LCOV;
- G4: diff line coverage ≥ threshold and diff branch coverage ≥ threshold (§5), or "n/a" when
  there are no measured changed lines or branches;
- G5: total line and branch coverage are each ≥ the baseline minus `regressionTolerance` (default 0.0 points);
- G6: if any staged source file matches `unmeasuredGlobs`, then `git diff --name-only <merge base> <red commit>`
  lists a path matching `behaviourTestGlobs`. When this check alone fails, the run goes back to
  step 4 once, telling the red agent "add a behaviour test for <files>", then continues from step 5;
- G7: every command in `checks` exits 0 (project-specific checks: linters, type checks, validators).
- G8 (SPEC change 0.7.0, checked first, before any test runs): as R4, for gates G and F.

A failed R4 or G8 blocks the run at once, with no retry, as a **final** block. Its hint is `next: build it with /mod-builder:build, then /issue-forge stop <N>`, and `/issue-forge status` lists the next steps. `/issue-forge resume` answers `can't be resumed`. A pull request's number is also a final block, and the start menu offers a final-blocked run Stop, not Resume. Nothing past the phase's last commit is committed (red's at gates R and G, green's at gate F), and nothing is pushed; the steps name those commits, and after G6's detour, the stash that holds green's work.

On pass, commit `fix(#<N>): green: <title>`; record it as the **green commit**. On fail, give the
agent the failed checks and try again, up to `attempts.green` (default 3), then stop in `blocked`.

**Step 6: refactor phase.** Spawn the refactor agent. Check **gate F**: G1–G7 again, with the same
red commit. On pass, commit `refactor(#<N>): <title>`. On fail after `attempts.refactor`
(default 1), keep the green commit. Put the refactor's changes in a stash, never discard them:
`git stash push --include-untracked -m "issue-forge #<N> rejected refactor"`. Then continue;
a rejected refactor doesn't block the pull request.

**Step 7: confirm and publish.** Show the summary (§7.3, state `ready`) and ask: "Push
`issue-<N>-<slug>` and open a pull request against `<base>`?" (`on <owner>/<repo>` before `against`). Then:
- On yes: check `origin` again (a fork run: every push URL of `origin` still names the fork), then `git push origin issue-<N>-<slug>`,
  without `-u`, so it writes no tracking config. Then
  `gh pr create --base <base> --head issue-<N>-<slug> --title "<title> (#<N>)" --body-file <data dir>/<run>/pr.md --repo <host/owner/repo>`
  (a fork run: `--head <fork owner>:issue-<N>-<slug>`).
  The body holds the gate results, the coverage numbers and `Closes #<N>`. State `done`.
- On no, or no answer possible (`claude -p`): state `ready`, with nothing pushed. `/issue-forge publish` resumes from here.

**Files outside both globs** (README, specs, manifests, changelogs) are unconstrained in the green
and refactor phases, except that no phase may create a new plugin manifest (R4, G8; editing one that exists, such as a version bump, is fine). No gate checks them, so release steps such as version bumps go there (the
profile's `notes`). The red phase may change only test files (R1).

**Never**: force-push; push to `<base>`; commit outside the run's branch; delete a branch or a
stash; run when step 1 fails.

## 4. The repository profile

### 4.1 File and fields

`.issue-forge.json` in the repository root, committed. JSON, every field listed; nothing else is read.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `baseBranch` | string | `"main"` | pull request target unless the issue names one (§2) |
| `testCommand` | string[] | required | argv; exit 0 = all tests pass |
| `coverageCommand` | string[] | required | argv; runs the tests with coverage and writes LCOV to `lcovPath` |
| `lcovPath` | string | required | where `coverageCommand` writes LCOV; must be outside the repository or ignored by git (§4.2). A relative path is the run's folder's, so runs in separate worktrees never share one |
| `sourceGlobs` | string[] | required | code under the coverage gate |
| `testGlobs` | string[] | required | test files and fixtures; the red phase writes only these |
| `excludeGlobs` | string[] | `[]` | never source (generated code, vendored files) |
| `unmeasuredGlobs` | string[] | `[]` | source the coverage tool can't reach; behaviour-test rule instead |
| `behaviourTestGlobs` | string[] | `[]` | tests that exercise `unmeasuredGlobs` code |
| `checks` | string[][] | `[]` | extra argv commands, each must exit 0 at gates G and F |
| `threshold` | number | `95` | diff line and branch coverage, in percent |
| `regressionTolerance` | number | `0.0` | allowed drop in total coverage, in percentage points |
| `attempts` | `{ red, green, refactor }` | `{ 2, 3, 1 }` | tries per phase before `blocked` |
| `commandTimeoutMinutes` | number | `15` | per command; past it the command is killed and the gate fails |
| `notes` | string | `""` | repository conventions given to all three agents (release steps, style) |
| `commitTrailers` | string[] | `[]` | lines appended, after a blank line, to every commit message the mod writes (for example `Co-Authored-By: …`) |
| `workspace` | `"ask"` \| `"worktree"` \| `"here"` | `"ask"` | where a run works (SPEC change 0.2.0): `here` branches the checkout you start from and blocks when it's busy (changes, or not on the base); `ask` does the same when it isn't busy and offers a new worktree when it is; `worktree` always adds one from `origin/<base>`. Read from `origin/<base>`'s copy |
| `worktreeDir` | string | `"scratch/issue-forge"` | where new worktrees go, relative to the repository root, with no `..`; must be ignored by git |

Globs use `*` (within a path segment) and `**` (any depth), matched against repository-relative
`/`-separated paths.

### 4.2 Validation (step 1.3)

- Required fields are present and the types match.
- `testGlobs` and `sourceGlobs` aren't empty.
- `lcovPath` is outside the repository, or `git check-ignore -q <lcovPath>` exits 0. Otherwise
  `git add -A` would commit coverage output.
- `testCommand[0]` and `coverageCommand[0]` are found on PATH or are relative paths that exist.

### 4.3 Example profiles

The Python and TypeScript examples are the standard tools' documented flags; **they haven't been
run here**. The first repository of each kind to use the mod confirms them. Only Appendix A's
profile has been run.

Python (pytest-cov):
```json
{
  "testCommand": ["pytest", "-q"],
  "coverageCommand": ["pytest", "-q", "--cov=src", "--cov-branch", "--cov-report=lcov:/tmp/issue-forge/coverage.lcov"],
  "lcovPath": "/tmp/issue-forge/coverage.lcov",
  "sourceGlobs": ["src/**/*.py"],
  "testGlobs": ["tests/**"]
}
```

TypeScript (Vitest with V8 coverage):
```json
{
  "testCommand": ["npx", "vitest", "run"],
  "coverageCommand": ["npx", "vitest", "run", "--coverage.enabled", "--coverage.provider=v8", "--coverage.reporter=lcov", "--coverage.reportsDirectory=/tmp/issue-forge/cov"],
  "lcovPath": "/tmp/issue-forge/cov/lcov.info",
  "sourceGlobs": ["src/**/*.ts"],
  "testGlobs": ["src/**/*.test.ts", "test/**"]
}
```

## 5. The coverage gate

### 5.1 Why diff coverage, not whole-project coverage

Measured in this repository at 92245a7 [verified]:

| Module | Lines | Branches | Functions |
|---|---|---|---|
| `mods/duet/hooks/duet-logic.ts` | 90.87% | 86.20% | 85.04% |
| `mods/git-branch/hooks/git-branch-logic.ts` | 100.00% | 94.34% | 100.00% |
| `mods/turn-counter/hooks/turn-counter-logic.ts` | 100.00% | 83.33% | 100.00% |
| `plugins/mod-builder/hooks/mod-builder-logic.ts` | 99.36% | 83.69% | 98.33% |

No module reaches 95% branch coverage. A whole-project 95% gate would block every run until
someone raised coverage first. A gate on the changed lines holds new work to 95% from the first
run. The no-regression rule (G5) stops overall coverage falling.

### 5.2 LCOV records used

`SF:<path>`, `DA:<line>,<hits>`, `BRDA:<line>,<block>,<branch>,<taken>` (`taken` is a number or
`-`), `LF`, `LH`, `BRF`, `BRH`, `end_of_record`. Everything else is ignored. Node's LCOV reporter
writes all of these [verified: 1,052 `DA` and 413 `BRDA` records for `duet-logic.ts`].

### 5.3 Computation (pure; in the logic module, §7.5)

1. Normalize each `SF:` path to repository-relative with `/` separators. A path outside the repository is dropped.
2. For each changed measured source file:
   - **in LCOV:** measured changed lines are its changed lines that have a `DA` record;
   - **not in LCOV:** all its changed lines count as measured and uncovered. Code the tests never
     load fails the gate; it isn't skipped.
3. Diff line % = covered ÷ measured × 100, rounded to two decimals; "n/a" when measured is 0.
4. Diff branch % = `BRDA` on changed lines with taken > 0 ÷ all `BRDA` on changed lines; "n/a" when 0.
5. Total % (G5) is from `LF/LH` and `BRF/BRH` over measured source files.
6. The report lists, for each file, its uncovered changed lines as ranges. The green agent gets this on a retry.

### 5.4 Code the coverage tool can't reach

Some code runs only in an environment that can't produce coverage. In this repository, a mod's
`register.tsx` runs only under `claude plugin test` (Appendix A). Declare such files in
`unmeasuredGlobs`. They're excluded from every percentage, and rule G6 requires a test matching
`behaviourTestGlobs` in the red commit. That test fails before the fix (R3) and passes after (G2). The rule is generic; a repository without such code leaves both lists empty.

## 6. The three agents

The mod registers three agent types at `session.start` with `$.agent.register` [d.ts]:
`issue-forge:red`, `issue-forge:green` and `issue-forge:refactor`. An `agent.offer` hook answers
`{ isOffered: false }` for each, so the main model can't call them [d.ts]. The mod spawns them with
`$.agent.spawn({ subagentType, prompt, description, model })`. The call resolves with `{ agentId }`
once the agent starts, and the agent's answer arrives as the `turn.complete` that carries that
`agentId` [d.ts; duet uses the same pattern, `mods/duet/hooks/register.tsx:670-681`].

| Agent | Tools | Default model (`userConfig`) | Prompt rules (verbatim in the registered `prompt`) |
|---|---|---|---|
| red | Read, Grep, Glob, Edit, Write, Bash | `opus` | Write tests from the issue only. Touch only paths matching the test globs given. Every new test must fail now, by an assertion (never by a load, import or syntax error: the green phase can't edit tests to fix that), and pass once the issue is fixed. Run the tests to confirm. End with a list of the new test names and one line on why each fails, then what the green phase should know about the fix: an approach that breaks other tests, a dead end, a constraint. |
| green | Read, Grep, Glob, Edit, Write, Bash | `sonnet` | Make the failing tests pass. Never edit a path matching the test globs; edited tests fail the gate. Follow the profile notes. End with the changed files. |
| refactor | Read, Grep, Glob, Edit, Write, Bash | `opus` | Improve the changed code without changing behaviour. Never edit tests. Keep every test passing. End with what changed and why. |

Each spawn's `prompt` holds the issue number, title and body, the profile's globs and `notes`,
and, on a retry, the failed gate checks verbatim. The green prompt also holds the red agent's final
answer (its tests, and what green should know about the fix, as red's rules ask), after the issue in a
`<red-answer>` block, marked as context and not instructions. It is cut to its last 20,000 characters and
then its last 200 lines, and a line at the top of the block says when it was cut. Red's answer is written
from the issue, so a whole `<red-answer` or `</red-answer` tag in it gets a backslash after its `<`
(`<\red-answer`, `<\/red-answer`), as the issue's `<issue` and `</issue` do; a word that only starts
like one, such as `<IssueKey>`, stays as written. Only an answer from a turn that ended by answering
counts (not an error, a refusal or an interrupt). On a behaviour detour, red's new answer joins the
first once its gate R passes, so a green retry after the detour sees both. Red and refactor never get it.

**Red on Codex (MVP if P1 passes, §1).** Set `redAgentType` to an agent type that the duet mod
routes to Codex (listed in duet's `codexAgents`). The model is duet's `codexModel`; Codex's catalog
(`codex debug models`, or `/duet config models`) lists `gpt-6.1-sol` as the current workhorse,
`gpt-6-sol` as the previous generation and `gpt-6-astra` as the strongest. Whether duet's
`tool.call { tool: 'Agent' }` hook sees a mod's `$.agent.spawn` is **[untested]** (probe P1). If
it doesn't, try `$.tool.call({ tool: 'Agent', … })` next, then run red on Claude.

## 7. Mod design for `/mod-builder:build`

### 7.1 SPEC slots (fill these; ask nothing)

| Slot | Kind | Value |
|---|---|---|
| name | REQUIRED | `issue-forge` |
| archetype | REQUIRED | `pane-command` (primary), plus `turn.complete` and `agent.offer` hooks by hand |
| triggers | REQUIRED | `session.start`, `command.run {command: 'issue-forge'}`, `turn.complete`, `agent.offer` ×3, `ui.render {component: 'Pane', requestId: 'issue-forge'}` |
| commands | REQUIRED | `/issue-forge <N or issue URL>`, `/issue-forge status`, `/issue-forge resume`, `/issue-forge publish`, `/issue-forge stop`, `/issue-forge demo` |
| states drawn | REQUIRED | empty (no run), phase running (agent and elapsed), gate running, gate failed (checks), blocked (reason and next command), ready (summary, awaiting confirm), done (PR link), too-narrow |
| done means | REQUIRED | §9, checkpoint C8 |
| state lifetime | ARCH | the run in `$.store` under `run:<repo root>`, so a reload or restart resumes; view state in atoms |
| external reach | ARCH | processes: `git`, `gh`, the profile's commands; model calls: three subagents per run, more on retries; network: through `gh` and `git` only |
| depends on | ARCH | none (duet optional, post-MVP) |
| options (userConfig) | ARCH | `redModel`, `greenModel`, `refactorModel` (text; `opus`, `sonnet`, `opus`); `redAgentType` (text, `issue-forge:red`); `confirmPublish` (boolean, `true`) |

### 7.2 Engine facts the design relies on

- Long commands (tests, coverage) run through `$.process.spawn`, which has no time limit, with
  the mod's own `commandTimeoutMinutes` timer [d.ts]. `$.process.run` stops at 10 minutes [d.ts].
  Short commands (`git`, `gh`) use `$.process.run`.
- The command handler starts the run and returns at once; the run continues in a detached
  promise. Each phase ends at its agent's `turn.complete`. `$` calls don't count against the
  10 s hook budget [verified: `gotchas.md`, "Budget and time"].
- A reload ends the module's promises. `$.store` keeps the run, so `/issue-forge resume` restarts
  the current step from its beginning [d.ts: store survives reloads].
- Confirmation uses `$.ui.ask`, which rejects when nobody can be asked (`claude -p`). That counts as "no".
- Runtime files (PR body, logs) go under `~/.claude/issue-forge-data/<run>/`, never inside the
  plugin folder (`CLAUDE.md`).
- `$` is passed only to top-level functions in `register.tsx`; atom keys and matchers are string
  literals; there's one hook per event and matcher (`gotchas.md`).

### 7.3 What I should see (pane `issue-forge`)

```
 ISSUE-FORGE   #16 Mod Lab: Fix prompt and path header hardcode mods/
 ▸ red       ✓  3 tests, all failing for the right reason        2m10s
 ▸ green     ●  attempt 2/3 · gate G: diff branch 91.30% < 95    4m02s
   refactor  ·
   publish   ·
 coverage   lines 100.00% · branches 91.30% (changed) · total 99.36% / 83.69%
 [ Stop ]  [ Status ]
```

`blocked` replaces the phase rows with the reason and the next command, for example
"blocked: tests fail before any change — fix main, then /issue-forge resume". A final block (SPEC change 0.7.0) says `then /issue-forge stop <N>`, adds `steps: /issue-forge status` when it has next steps, and offers Stop and Status, not Resume. `ready` shows the
summary and `[ Publish ]`. `done` shows the PR URL.

### 7.4 State machine (pure; in the logic module)

`idle → preflight → baseline → red → gateR → green → gateG → refactor → gateF → ready → publishing → done`,
with `blocked` reachable from every step, holding the step to resume.

The stored run is `{ issue, ghRepo?, title, branch, base, mergeBase, redCommit?, greenCommit?, step, attempt, baseline, lastGate, startedAt }`.
A second `/issue-forge <N>` while a run is active in the same repository answers with the active
run's status and starts nothing.

### 7.5 Files

House layout (`plugins/mod-builder/skills/build/references/conventions.md`):
- `hooks/register.tsx` holds every `$` call.
- `hooks/issue-forge-logic.ts` holds all `$`-free logic, in sections: profile (parse and validate
  §4), coverage (LCOV parse, diff-hunk parse, the §5.3 numbers), gates (R, G and F as pure checks
  over gathered facts), state (transitions), and prompts.
- `types/index.d.ts` holds the state contract.

Keep it one logic module. In the pilot profile (Appendix A), coverage includes only
`hooks/*-logic.ts`, and a measured file missing from LCOV fails the gate (§5.3).

Tests: `tests/issue-forge-logic.test.ts` (runs under both `claude plugin test` and the Appendix A
kit) and `tests/ui.test.tsx`.

## 8. Safety

- **Outward actions only after the person confirms** (`confirmPublish`, step 7). Nothing is pushed or opened otherwise.
- **No destructive git:** no `reset --hard`, no branch or stash deletion, no force-push. A rejected
  refactor is stashed under a named message.
- **Test integrity is checked, not assumed:** G1 catches tests changed by any means, `Bash`
  included, because it compares files, not tool calls.
- **No new plugins (SPEC change 0.7.0):** issue-forge never commits or pushes a new Claude Code plugin manifest. An issue that asks for one to be built with mod-builder never starts a run. The live agent's Edit, Write and NotebookEdit may not create one, except under `testGlobs`, where a sample plugin is a test fixture (red's rules say so). One at the merge base or on the base branch's tip is not new: a phase that removed it may write it back. A manifest a phase agent's shell made anyway, where the next commit would carry it, is caught by R4 or G8 at the phase's gate, before that commit. Known gap: an agent's `Bash` can still write plugin files while its phase runs. They are only seen at the gate, and they stay uncommitted in the run's folder, because issue-forge deletes nothing. A manifest under a path git ignores isn't seen at all: `git add -A` never stages it, so no commit or push can carry it, and listing ignored files would also find every plugin under `node_modules`, caches and other worktrees.
- **Cost:** each run spawns at least three subagents. Retries add up to `attempts.red + attempts.green + attempts.refactor` more.
- **Trust:** the agents read the issue body, which anyone who can file an issue writes, and green
  also reads the red agent's answer, which red wrote from that issue (§6). Run it only on
  repositories and issues you trust. The prompts tell the agents to treat both as requirements and
  context, not instructions about tools, credentials, files outside the repository, or the run.

## 9. Checkpoints

Do them in order. Each ends with the command that proves it; record the output in the mod's SPEC.

| # | Checkpoint | Proven by |
|---|---|---|
| C0 | **Probes.** P1: does duet's `tool.call { tool: 'Agent' }` hook see a `$.agent.spawn`? (throwaway mod in the gitignored `scratch/`). P2: does `$.agent.spawn` from a `command.run` handler keep running after the handler returns, with its `turn.complete` arriving later? And does `$.ui.ask` from that detached promise show its question in an interactive session? (throwaway mod; `claude -p --plugin-dir` for the first, the owner's interactive session for the second; duet's detached `review()` already calls `$.ui.ask` this way, not checked live). Record both in `gotchas.md` as `[probe]`. P1's result decides whether red on Codex is in the MVP (§1). | the two `gotchas.md` entries |
| C1 | **Pilot coverage harness.** Commit Appendix A's kit and run the four logic suites. Pass counts must equal `claude plugin test`'s for the same files. | duet 38/38, mod-builder 28/28, git-branch 4/4, turn-counter 2/2 under both |
| C2 | **Profile** parsing and validation (§4) with tests for every rule in §4.2. | `claude plugin test mods/issue-forge` |
| C3 | **Coverage** implements §5.3. Its tests feed a real LCOV file (captured from C1 as a fixture) and real `git diff -U0` output, including untracked-file, deleted-file, no-`DA` and `BRDA` `-` cases. | same |
| C4 | **Gates and states** implement §3 and §7.4, with one test per check (R1–R3, G1–G7) and per transition, including resume from `blocked` and G6's return to red. | same |
| C5 | **Scaffold and register.** `/mod-builder:build` scaffolds from `pane-command`, then adds the hooks; UI tests cover every state in §7.3. | `claude plugin validate mods/issue-forge` clean; tests pass; `tsc` clean |
| C6 | **Pilot profile:** this repository's `.issue-forge.json` (Appendix A) passes validation, and step 3 records the baseline. | `/issue-forge status` shows the baseline |
| C7 | **Dry run.** Run issue #16 (Appendix B), the smallest, with `confirmPublish` on; answer "no" at publish. | the branch has red, green (and refactor) commits; the pane shows `ready` |
| C8 | **Done means:** C0–C7 recorded; README with a "What it reaches" table generated from `claude plugin validate`; marketplace entry and version agree; the coverage gate holds on issue-forge's own logic files. | `/issue-forge` on itself, or the C1 harness pointed at its `hooks/*.ts` |

## 10. Verification ledger

| Fact | How known |
|---|---|
| `claude plugin test` has no coverage option | [verified] `claude plugin test --help` |
| Node 24 test runner with `--experimental-test-coverage` and the Appendix A kit runs this repo's logic tests with the same pass counts | [verified] duet 38 = 38 |
| Node's LCOV reporter writes `SF`, `DA`, `BRDA`, `LF/LH/BRF/BRH`; one include glob covers several modules; a missing output folder exits 7 | [verified] |
| `git diff -U0` hunk headers as in §2 | [verified] |
| The §5.1 coverage table | [verified] |
| `$.agent.spawn` arguments and result; `$.agent.register`; `agent.offer` | [d.ts] 2.1.296 |
| A subagent's answer is its `turn.complete` with `agentId` | [d.ts], used by duet |
| `$.process.run` 10-minute limit; `$.process.spawn` unlimited | [d.ts] |
| `$` calls don't count against the 10 s hook budget | [verified] `gotchas.md` |
| duet routing a mod's `$.agent.spawn` to Codex | [untested] P1 |
| A spawn from a command handler outliving the handler; `$.ui.ask` from a detached promise | [untested] P2 |
| The Python and Vitest profiles in §4.3 | [untested] here |

---

## Appendix A: pilot profile for this repository

This repository's mods test their logic files (`*-logic.ts`) with `claude plugin test`. That
command has no coverage. The logic tests import their kit from `claude-code/testing`, which only
exists inside Claude Code. Node can run the same tests with a stand-in for that kit, and measure
them. The hook files (`register.tsx`) and UI tests (`ui.test.tsx`, `routing.test.ts`) need the
real kit, so they're `unmeasuredGlobs` and `behaviourTestGlobs`.

**Kit location (commit at C1):** `plugins/mod-builder/skills/build/scripts/coverage/`, with
`kit.mjs`, `hooks.mjs` and `register.mjs` below. Invariant: a logic test file passes the same number
of tests under the kit as under `claude plugin test`. Never run UI tests through it.

`kit.mjs`:
```js
// Stand-in for 'claude-code/testing' (logic tests only): describe/test from node:test, a jest-style expect.
import { describe as nodeDescribe, test as nodeTest } from 'node:test'
import { isDeepStrictEqual, inspect } from 'node:util'

export const describe = nodeDescribe
export function test(name, a, b) {
  const fn = typeof a === 'function' ? a : b
  return nodeTest(name, async () => { await fn() })
}
export const it = test

class Asymmetric {
  constructor(test, label) { this.test = test; this.label = label }
}
const isPlain = v => v !== null && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v))
// Jest-style toEqual: ignores undefined properties and prototypes of plain objects; honours asymmetric matchers.
const equals = (a, e) => {
  if (e instanceof Asymmetric) return e.test(a)
  if (Array.isArray(e)) return Array.isArray(a) && a.length === e.length && e.every((v, i) => equals(a[i], v))
  if (isPlain(e)) {
    if (!isPlain(a)) return false
    const keys = o => Object.keys(o).filter(k => o[k] !== undefined)
    const ka = keys(a), ke = keys(e)
    return ka.length === ke.length && ke.every(k => equals(a[k], e[k]))
  }
  if (e instanceof Set || e instanceof Map || e instanceof Date || e instanceof RegExp) return isDeepStrictEqual(a, e)
  return Object.is(a, e)
}
const subset = (a, e) => {
  if (e instanceof Asymmetric) return e.test(a)
  if (isPlain(e)) return a !== null && typeof a === 'object' && Object.entries(e).every(([k, v]) => subset(a[k], v))
  if (Array.isArray(e)) return Array.isArray(a) && a.length === e.length && e.every((v, i) => subset(a[i], v))
  return equals(a, e)
}
const show = v => inspect(v, { depth: 6, breakLength: 120 })
function make(actual, negate) {
  const check = (ok, what, expected) => {
    if (ok === negate) throw new Error(`expect(${show(actual)})${negate ? '.not' : ''}.${what}(${show(expected)})`)
  }
  return {
    toBe: e => check(Object.is(actual, e), 'toBe', e),
    toEqual: e => check(equals(actual, e), 'toEqual', e),
    toContain: e => check(typeof actual === 'string' ? actual.includes(e) : actual.some(x => equals(x, e)), 'toContain', e),
    toMatchObject: e => check(subset(actual, e), 'toMatchObject', e),
    toBeNull: () => check(actual === null, 'toBeNull'),
    toBeUndefined: () => check(actual === undefined, 'toBeUndefined'),
    toBeDefined: () => check(actual !== undefined, 'toBeDefined'),
    toStartWith: e => check(String(actual).startsWith(e), 'toStartWith', e),
    toMatch: e => check(typeof e === 'string' ? String(actual).includes(e) : e.test(String(actual)), 'toMatch', e),
    toHaveLength: e => check(actual.length === e, 'toHaveLength', e),
    toBeLessThanOrEqual: e => check(actual <= e, 'toBeLessThanOrEqual', e),
    toBeGreaterThan: e => check(actual > e, 'toBeGreaterThan', e),
    toBeGreaterThanOrEqual: e => check(actual >= e, 'toBeGreaterThanOrEqual', e),
  }
}
export function expect(actual) {
  const m = make(actual, false)
  m.not = make(actual, true)
  return m
}
expect.stringContaining = s => new Asymmetric(a => typeof a === 'string' && a.includes(s), `stringContaining(${s})`)
expect.stringMatching = r => new Asymmetric(a => typeof a === 'string' && (typeof r === 'string' ? a.includes(r) : r.test(a)), `stringMatching(${r})`)
expect.any = C => new Asymmetric(a => a != null && (Object(a) instanceof C), `any(${C.name})`)
expect.anything = () => new Asymmetric(a => a != null, 'anything')
expect.arrayContaining = xs => new Asymmetric(a => Array.isArray(a) && xs.every(x => a.some(y => equals(y, x))), 'arrayContaining')
expect.objectContaining = o => new Asymmetric(a => subset(a, o), 'objectContaining')
```

`hooks.mjs`:
```js
// Maps 'claude-code/testing' to kit.mjs and adds '.ts' to extensionless relative imports.
const KIT = new URL('./kit.mjs', import.meta.url).href
export async function resolve(specifier, context, next) {
  if (specifier === 'claude-code/testing') return { url: KIT, shortCircuit: true }
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
    try { return await next(specifier + '.ts', context) } catch {}
  }
  return next(specifier, context)
}
```

`register.mjs`:
```js
import { register } from 'node:module'
register('./hooks.mjs', import.meta.url)
```

The kit supports exactly the matchers this repository's logic tests use: the list in `make` plus
`not.*` and the six `expect.*` helpers. A new matcher in a logic test needs adding here first.
C1 catches a mismatch, because the pass counts would differ.

**Profile (`.issue-forge.json`, committed at C6):**
```json
{
  "baseBranch": "main",
  "testCommand": ["bash", "-c", "for d in plugins/* mods/*; do claude plugin test \"$d\" || exit 1; done"],
  "coverageCommand": ["bash", "-c", "mkdir -p \"$HOME/.claude/issue-forge-data\" && node --import ./plugins/mod-builder/skills/build/scripts/coverage/register.mjs --test --experimental-test-coverage --test-coverage-include='**/hooks/*-logic.ts' --test-reporter=lcov --test-reporter-destination=\"$HOME/.claude/issue-forge-data/coverage.lcov\" $(ls plugins/*/tests/*-logic.test.ts mods/*/tests/*-logic.test.ts)"],
  "lcovPath": "~/.claude/issue-forge-data/coverage.lcov",
  "sourceGlobs": ["plugins/*/hooks/**", "mods/*/hooks/**"],
  "testGlobs": ["plugins/*/tests/**", "mods/*/tests/**"],
  "excludeGlobs": ["**/hooks.json"],
  "unmeasuredGlobs": ["**/hooks/register.tsx", "**/hooks/register.ts"],
  "behaviourTestGlobs": ["**/tests/ui.test.tsx", "**/tests/routing.test.ts", "**/tests/config.test.ts"],
  "checks": [
    ["bash", "-c", "claude plugin validate . && for d in plugins/* mods/*; do claude plugin validate \"$d\" || exit 1; done"],
    ["bash", "plugins/mod-builder/skills/build/scripts/check-archetypes.sh"]
  ],
  "commitTrailers": ["Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"],
  "notes": "Read CLAUDE.md first. Pure rules go in hooks/<name>-logic.ts; every $ call in hooks/register.tsx. Bump the plugin's version in its plugin.json and in .claude-plugin/marketplace.json, and add a dated '## Change <version> (<date>)' section to its SPEC.md."
}
```

The coverage command, with the kit at a scratch path, was run as one command: exit 0, one
`--test-coverage-include` glob, LCOV with `SF:` records for all four logic modules [verified].
Node exits 7 when the LCOV folder doesn't exist, hence the `mkdir -p` [verified]. `lcovPath` uses
`~`; the profile parser expands it from `HOME`, or `USERPROFILE` on Windows.

`commitTrailers` holds the attribution line this repository's commits carry. A session-specific
line such as `Claude-Session: <url>` changes per session, so the mod doesn't take it from the profile.

**When to run the pilot:** this repository's issues describe commit 92245a7 on
`edit-skill-docs-showcase` (PR #1). Run the pilot after PR #1 merges, with `baseBranch: "main"`
as above. Before that, set `baseBranch` to `"edit-skill-docs-showcase"`.

## Appendix B: pilot backlog (this repository's open issues)

Order for the first runs, smallest and most self-contained first. "Owner" marks a step that
needs the person: a paid or networked probe, or an interactive session. The issues give the details.

| Order | Issue | Plugin | Notes |
|---|---|---|---|
| 1 | #16 | mod-builder | C7 dry run; logic plus a UI behaviour test |
| 2 | #15 | mod-builder | logic only |
| 3 | #11 | mod-builder | logic and a UI behaviour test |
| 4 | #17 | mod-builder | before #10 (#10's fix reads `factsByMod`) |
| 5 | #10 | mod-builder | same handler as #12; do before it |
| 6 | #12 | mod-builder | after #10 |
| 7 | #14 | mod-builder | after #12 (the serializer wraps its check) |
| 8 | #13 | mod-builder | Owner: live timeout check |
| 9 | #9 | mod-builder | Owner: the probe's control run |
| 10 | #8 | duet | tests only; after #5 and #7 if those land first |
| 11 | #5 | duet | Owner: one interactive `/duet review` |
| 12 | #7 | duet | |
| 13 | #6 | duet | Owner: interactive spawn probe half |
| 14 | #2 | duet | local probe; doc sources fetched |
| 15 | #4 | duet | local probe |
| 16 | #3 part B | duet | Owner: signed-in `codex exec` probe |
| 17 | #18 | new mod | built with `/mod-builder:build`, not issue-forge (a new plugin, not a fix); from SPEC change 0.7.0, `/issue-forge 18` refuses it with next steps |

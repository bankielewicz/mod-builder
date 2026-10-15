# Tdd Guard: SPEC

> In a TDD pipeline with separate subagents, the red-phase test writer writes only tests, and the
> green developer and the refactorer never touch them. Agent frontmatter can't say that: a
> permission specifier in `disallowedTools` such as `Edit(tests/**)` "still removes the whole tool"
> (https://code.claude.com/docs/en/sub-agents). Tdd Guard enforces it per agent type and per path,
> and checks the test files themselves after a guarded agent finishes, since a shell edit never
> reaches an `Edit` or `Write` call. Issue #18; origin: the duet/TDD discussion on PR #1.

**Non-negotiables** (the issue's words; each becomes a test):
- "the red-phase test writer should write only tests": a type with `+` globs is refused every other path.
- "the green developer and refactorer should never touch tests": a type with `-` globs is refused those paths.
- "The integrity check catches them **after** the agent finishes, and reports them; it doesn't prevent them." The README says detection, not prevention.
- A call with no `agentId` (the main loop) always passes. A call whose `agentId` isn't listed by `$.agent.list()` passes while the `rules` option parses; a malformed option holds every subagent write, listed or not (the owner's choice on PR #81: a guard fails closed).

## Slots

| Slot | Kind | Value | Source |
| --- | --- | --- | --- |
| name (kebab-case, = plugin name) | REQUIRED | `tdd-guard` | issue #18 |
| archetype | REQUIRED | guard (+ `tool.call {tool:'Agent'}` and `turn.complete` hooks added by hand) | issue #18 |
| triggers (events it hooks) | REQUIRED | `tool.call {tool:'Edit'}`, `{tool:'Write'}`, `{tool:'NotebookEdit'}`, `{tool:'Agent'}`; `turn.complete`; `session.start` (a malformed option's toast) | issue #18; PR #81 |
| commands | REQUIRED if any UI | none: the guard draws no pane, band or command; its states are the deny text, the `context` line, a toast | decided (see Design) |
| states drawn | REQUIRED | empty · idle · live · done · folded · too-narrow · survey · focus: n/a (no surface). error: the deny text and the report line below | ui-states.md |
| done means | REQUIRED | see section below | issue #18 |
| state lifetime | ARCH | one session `$.state` atom, `pending` (guarded background runs by agent id); snapshots in module state, lost on a reload | issue #18 |
| external reach | ARCH | files: reads (`$.fs.stat`, `$.fs.list`, `$.fs.read`) under the project root; no writes, no processes, no network, no model calls | issue #18 |
| depends on | ARCH | none (duet routes agents to Codex; those never make a Claude tool call, so this mod can't see them) | issue #18 |
| options (userConfig) | ARCH | `rules`: string, default below (any-depth `tests`/`test` folders) | issue #18; the owner on PR #81 |
| home | HOUSE | `mods/tdd-guard/` (a plugin in the `claudemod` folder marketplace) | conventions.md |
| tsconfig | HOUSE | extends `./.claude-plugin/types/tsconfig.json` | conventions.md |
| state API | HOUSE | `atom/read/update` + `types/index.d.ts` PluginState | conventions.md |
| logic split | HOUSE | `$`-free `hooks/tdd-guard-logic.ts` (`parseRules`, `matchGlob`, `decide`, and the integrity check's `relativeTo`, `hashOf`, `folderOf`, `mayMatchBelow`, `changesOf`, `reportOf`, `launchedId`, `withoutId`); every `$` call in `hooks/register.tsx` | conventions.md |
| tests | HOUSE | `tests/tdd-guard-logic.test.ts`, `tests/ui.test.tsx` | conventions.md |
| demo | HOUSE | n/a: nothing is drawn; `ui.test.tsx` and the live check show every state | decided |
| built on | HOUSE | Claude Code 2.1.296 types (the bundled `claude-code.d.ts`) | issue #18 |

## What gets touched

- **Files written:** `mods/tdd-guard/` (`SPEC.md`, `README.md`, `.claude-plugin/plugin.json`, `hooks/hooks.json`,
  `hooks/register.tsx`, `hooks/tdd-guard-logic.ts`, `types/index.d.ts`, `tests/tdd-guard-logic.test.ts`,
  `tests/ui.test.tsx`, `tsconfig.json`, `.gitignore`), and `.claude-plugin/marketplace.json` (one entry added).
- **Files outside the repo:** none.
- **Processes run while building:** `claude plugin validate`, `claude plugin test`, `npx -y -p typescript@5.6 tsc`.
- **Processes the mod runs at run time:** none.
- **Costs / hard to undo:** none. The mod writes nothing. It refuses some tool calls and appends a line to an Agent call's `context`.

## What I should see

There is no pane. The person sees a deny reason in the subagent's transcript and a toast after a guarded run changed protected files.

```
tdd-guard: green-developer may not write mods/x/tests/a.test.ts (denied by -**/tests/**)
tdd-guard: red-test-writer may not write src/x.ts (allowed only +**/tests/**, +**/test/**)
tdd-guard: green-developer changed protected test files: tests/a.test.ts (modified), tests/b.test.ts (deleted), tests/c.test.ts (new)
```

- **Deny text** (to Claude): `tdd-guard: <type> may not write <path relative to the project root> (<rule>)`. `<rule>` is `denied by -<glob>` or `allowed only +<globs>`. A path outside the project is shown as `../…`. A path the mod cannot place is shown as given, with `tdd-guard cannot tell where it lands`.
- **Report line**, once per guarded run whose protected files differ, naming at most 20 files and ending `, and N more` past that: the same text goes to the model (a foreground run: an entry in the Agent call's `context`; a background run: `$.prompt.submit`, which the model reads as "The tdd-guard plugin sent a message:") and, as a toast, to the person.
- **Reloaded:** a background run whose snapshot a reload lost reports `tdd-guard: <type> finished, but its test files could not be checked (reloaded)`.
- **A malformed `rules` option:** a toast with the parse message when the session starts, and every subagent write, listed or not, is refused with it until it is fixed (a guard fails closed); the main loop is not affected, and Agent calls are not checked.
- **A check that fails:** a subagent's write is refused (`the write check failed, so the write was held`); an Agent call still runs, or keeps what it gave, and a toast says `tdd-guard: <type>'s test files could not be checked (the check failed)`.

## Design

- **Option** `rules`: `type=glob,glob; type=glob`. `+glob`: the type may write only paths matching one of its `+` globs. `-glob`: it may not write a path matching a `-` glob. A type may carry both. Globs are relative to the project root (`$.session.root()`); `*` is one segment, `**` any depth, anything else literal; a `..` segment makes the entry malformed, since the integrity check walks the folder a glob names. Default: `red-test-writer=+**/tests/**,+**/test/**; green-developer=-**/tests/**,-**/test/**; refactorer=-**/tests/**,-**/test/**`, so a nested layout (`mods/x/tests/`, `packages/y/test/`) is guarded too.
- **Write hooks:** one `tool.call` hook each for `Edit` and `Write` (`file_path`) and `NotebookEdit` (`notebook_path`), each with `.catch`. No `agentId`: pass. The `agentId`'s type from `$.agent.list()`; not listed, or a type with no rule: pass. Otherwise the target is placed as the bundled types' guard example does (`$.fs.stat(path, { resolve: true })`, `realPath`; for a file not there yet, its folder's `realPath` plus the name), cut to a path relative to the root, and `decide` rules on it. A path that can't be placed is refused. A path outside the root is refused for a type with `+` globs and passed for one with only `-` globs. The `.catch` passes the main loop and refuses a subagent (a broken check never lets a guarded write through).
- **Integrity check:** one `tool.call {tool:'Agent'}` hook with `.catch` (which only passes the call on: it never refuses an Agent call). When `subagent_type` has `-` globs, it lists the folder each glob starts under (the segments before the first wildcard) recursively with `$.fs.list`, entering only folders some `-` glob can match below (`mayMatchBelow`) and skipping `.git` and `node_modules`, keeps the files some `-` glob matches, and records `$.fs.read`'s content hash of each (a file too large to read is kept by size and time). It then calls `next(e)`. A foreground call finishes when `next(e)` resolves: it lists and hashes again and, on a difference, returns `{ ...ran, context: [...(ran.context ?? []), line] }` and toasts. `result` is not touched: core validates it against the Agent tool's output schema. A call that returns `async_launched` (or `teammate_spawned`) with an `agentId` keeps the snapshot in module state and the id in the `pending` atom, and the first `turn.complete` carrying that `agentId` compares, then sends `line` with `$.prompt.submit` and a toast. That `turn.complete` takes the type from the snapshot before the atom, since the atom's write may still be in flight; the Agent hook then drops an atom entry whose snapshot was already used. A run that changed nothing says nothing.
- **Reporting only, in v1.** Restoring files would hide what the agent did and overwrite work. A later `onTestChange: "report" | "restore"` could rewrite modified and deleted files from a snapshot with `$.fs.write` (text only, within `$.fs.read`'s 4 MiB limit) and only report new ones.
- **Where the helpers live.** Every pure function is in the logic module and has logic tests; `register.tsx` holds only the code that calls `$`. (Green first put the hash, diff and report line in `register.tsx` to keep them out of the coverage gate; they moved on PR #81.)
- **Limits.** Concurrent agents of different types share the folder, so a difference can't be pinned on one agent: the line names the type that was running, not necessarily the one that made the change. A snapshot lives in module state, so a reload mid-run loses it (reported as "reloaded"). A symbolic link inside a protected folder is not hashed. The deny-list judges where a path lands; a hard link or a case alias keeps its own spelling. A glob that starts with `**` (the default) walks the whole project, less `.git` and `node_modules`, at the start and end of each guarded run, and reads every match: in a large project, name the folders instead.

## Known gaps (stated in the README, not more)

- **Bash:** a guarded agent can still write files through `Bash` (`sed -i`, `echo > tests/x`), and it needs `Bash` to run the tests. The edit hooks don't see shell edits. The integrity check catches them **after** the agent finishes and reports them; it doesn't prevent them.
- **Unlisted agents:** a workflow's agents and engine forks aren't in `$.agent.list()`, so they're never guarded.
- **Codex:** agents duet routes to Codex never make a Claude tool call, so this mod can't see them. duet's `codexWritePaths` (#3) is the Codex-side limit.
- **Phase gates** (tests fail before green, pass after, still pass after refactor) are out of scope: they belong to whatever drives the phases. That driver can commit the red tests before green starts, then require `git diff --exit-code HEAD -- tests/` after green and after refactor. This works with or without this mod.

## Tests (`claude plugin test mods/tdd-guard`)

1. `parseRules` reads the example, rejects a malformed entry with a message naming it (and keeps no rules), and reads an empty option as no rules.
2. `matchGlob('tests/**', 'tests/a/b.test.ts')` is true and `matchGlob('tests/*', 'tests/a/b.ts')` is false; a glob matches the whole path; other characters are literal.
3. `decide`: allow-list, deny-list, both, no rule (including `constructor`), a path outside the project.
4. Write hooks: a `green-developer` Write or Edit into `tests/` is denied with the rule in the reason; a `red-test-writer` may write `tests/` and is denied `src/`; a NotebookEdit reads `notebook_path`; a new file is placed by its folder; a link into `tests/` is denied; no `agentId`, an unlisted `agentId` and a type with no rule pass; outside the project is refused for `+` types and passed for `-` types; globs are relative to the root, not the working directory.
5. Integrity, foreground: a run that changes, deletes and adds protected files adds one `context` line and toasts, keeping earlier `context` and the result; an unchanged run adds nothing; a change in a subfolder is found; only files matching a `-` glob count.
6. Integrity, background: the check waits for the first `turn.complete` of that agent, prompts once and toasts; another agent's `turn.complete` and a second one do nothing.
7. Integrity: a type with no `-` globs takes no snapshot (no `fs.list`, no `fs.read`); the walk enters only folders a `-` glob can match below; a check that fails lets the agent run once and toasts; a background turn that ends while its record is written is still checked, once.
8. A malformed option: toasted at session start, every subagent write held (unlisted agents too), the main loop passes, Agent calls unchecked.
9. The defaults guard `tests`/`test` folders at any depth; a `..` glob is malformed; the report names at most 20 files.
10. Logic tests for every helper in the logic module (100% lines, branches and functions).

## Done means

- `mods/tdd-guard/` validates, its tests pass, `tsc` is clean, and the README states the gaps above with the integrity check described as after-the-fact detection.
- The marketplace entry and `plugin.json` agree on the version. CI is green on the PR.
- **Live check** (the owner's session, still to run): define the three agents in `.claude/agents/`, run one `green-developer` task that tries to edit a test, and confirm the deny text reaches the model; record the result here.

## Handoff

How to load it (`/plugin install tdd-guard@claudemod` or `claude --plugin-dir mods/tdd-guard`), how to change `rules` in `/config`, and that `/reload-plugins` picks up edits.

## Change 0.1.0 (2026-10-15)

> New mod, issue #18, built test-first by issue-forge.

- **What changes:** the mod above, from the guard archetype: three write hooks, the Agent integrity check and a `turn.complete` hook for background runs, `parseRules`/`matchGlob`/`decide`, the `rules` option.
- **What gets touched:** `mods/tdd-guard/`, `.claude-plugin/marketplace.json` (one entry, 0.1.0). It reads files under the project root and writes none.
- **Tests:** the groups above: 31 logic tests and 29 behaviour tests (14 and 19 when the run ended).
- **Done means:** the tests pass, validate is clean, `tsc` is clean, logic coverage 100%. The live check is still to run.

### Added after the run (PR #81, 2026-10-15)

The run built this mod without the SPEC approval the issue asked for; the owner reviewed green's
choices on the PR instead. Their answers:

- **Pure helpers in `register.tsx`:** moved into the logic module, with logic tests (`9e49c16`, `04a8ac6`).
- **A malformed option refuses every subagent write:** kept, unlisted agents included; the
  non-negotiable above now says so (`f199a6d`). It is also toasted at session start (`c596611`, `b93a3f3`).
- **A failed write check refuses the subagent:** kept.
- **A failed Agent check passed silently:** it now toasts that the files could not be checked (`fc6dc2d`, `ef7e7f4`).
- **Reload detection through the `pending` atom:** kept. A first turn that ended while the atom's
  write was in flight was never reported; fixed (`4de7fe9`, `9dca7da`).
- **Defaults:** `**/tests/**` and `**/test/**`, so nested layouts are guarded (`17a75ea`, `78a8ffc`).

Codex review of `406eb7d`, three P2 findings, all fixed: a `..` glob walked outside the project
(`0122f49`, `00d08cd`); the report line was unbounded (`1981164`, `31accbc`); the walk entered folders no
glob could match below (`f30195e`, `a403e5f`, `3eebba2`).

Red `36fb906` failed only at load ("no hooks module to load"): gate R's R3 checks the exit code alone.
The red agent's own control, outside the repository, ran the same tests against a stub skeleton: 33 of
33 failed by `AssertionError`.


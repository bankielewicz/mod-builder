# Tdd Guard

Limits which paths each TDD subagent type may write. In a pipeline with separate subagents, the
red-phase test writer should write only tests, and the green developer and the refactorer should
never touch them. Agent frontmatter can't say that (a `disallowedTools` entry such as
`Edit(tests/**)` removes the whole tool), so Tdd Guard enforces it per agent type and per path.

```
tdd-guard: green-developer may not write mods/x/tests/a.test.ts (denied by -**/tests/**)
tdd-guard: red-test-writer may not write src/x.ts (allowed only +**/tests/**, +**/test/**)
tdd-guard: green-developer changed protected test files: tests/a.test.ts (modified), tests/b.test.ts (deleted), tests/c.test.ts (new)
```

- **Before a write:** an `Edit`, `Write` or `NotebookEdit` from a subagent whose type has rules is
  judged by where the path really lands (a link into `tests/` counts as `tests/`, a file not there
  yet is placed by its folder). A refused write comes back to Claude as an error with the rule.
- **After a run:** when a type with `-` globs is started, the files under those globs are hashed.
  When that run finishes, they are hashed again, and a changed, deleted or new file is reported to
  the model and in a toast. The report names at most 20 files and counts the rest. A background run
  is checked at the end of its first turn. This catches what a shell did (`sed -i`,
  `echo > tests/x`). It detects, after the fact; it does not prevent. If the check itself fails, the
  agent still runs, and a toast says its test files could not be checked.

## Try it

There is no command. Define your agents in `.claude/agents/`, name their types in `rules` (below),
and run a task for one of them that tries to edit a test.

## Install

From the GitHub marketplace:

```
/plugin install tdd-guard --marketplace bankielewicz/mod-builder
```

From a local clone (`claude plugin marketplace add <folder>` once):

```
/plugin install tdd-guard@claudemod
```

While developing, from its folder:

```
claude --plugin-dir <path-to>/tdd-guard
```

Changes load with `/reload-plugins` or a new session.

## Options

| Option | Default | What it does |
| --- | --- | --- |
| `rules` | `red-test-writer=+**/tests/**,+**/test/**; green-developer=-**/tests/**,-**/test/**; refactorer=-**/tests/**,-**/test/**` | `type=glob,glob` entries separated by `;`. `+glob`: the type may write only paths matching one of its `+` globs. `-glob`: it may not write a path matching a `-` glob, and a run of it is checked afterwards for changed files under those globs. A type may have both. Globs are relative to the project root; `*` is one segment, `**` any depth, anything else is literal, and a `..` segment is not allowed. A type with no entry is not guarded. A malformed entry rejects the whole option: a toast says so when the session starts, and every subagent write is refused until it is fixed, including those of agents the engine doesn't list. |

A path outside the project root is refused for a type with `+` globs and passed for one with only `-` globs.
The default guards a `tests` or `test` folder at any depth, so it fits nested layouts (`mods/x/tests/`,
`packages/y/test/`). The integrity check reads every file a `-` glob matches (skipping `.git` and
`node_modules`) at the start and the end of each run of that type, and enters only folders a `-` glob can
match below. A glob that starts with `**`, like the default, walks the whole project each time; in a large
project, name the folders instead (`-src/tests/**`).

## Known gaps

- **Bash:** a guarded agent can still write files through `Bash` (`sed -i`, `echo > tests/x`), and it
  needs `Bash` to run the tests, so it can't be removed. The edit hooks don't see shell edits. The
  integrity check catches them **after** the agent finishes, and reports them; it doesn't prevent them.
- **Who changed it:** concurrent agents of different types share the folder, so a difference can't be
  pinned on one agent. The report names the type that was running (`green-developer changed protected
  test files: …`), not necessarily the one that made the change.
- **Reloads:** the snapshot of a background run lives in memory. If the plugin reloads mid-run, the run
  is reported as "could not be checked (reloaded)".
- **Unlisted agents:** a workflow's agents and the engine's own forks aren't in `$.agent.list()`, so they
  are never guarded.
- **Codex:** agents that duet routes to Codex never make a Claude tool call, so this mod can't see them.
  duet's `codexWritePaths` is the Codex-side limit.
- **Phase gates** (tests fail before green, pass after, still pass after refactor) are out of scope.
  They belong to whatever drives the phases. That driver can commit the red tests before green starts,
  then require `git diff --exit-code HEAD -- tests/` to pass after green and after refactor. This works
  with or without this mod.
- Symbolic links inside a protected folder aren't hashed. The deny-list judges where a path lands; a
  hard link or a case alias keeps its own spelling.

## What it reaches

Mods are not sandboxed. They run with your access and skip Claude's permission prompts, so this
table lists everything this one can touch. It is generated from `claude plugin validate`.

| Reach | Detail |
| --- | --- |
| Hooks | `session.start`, `tool.call{tool=Edit}`, `tool.call{tool=Write}`, `tool.call{tool=NotebookEdit}`, `tool.call{tool=Agent}`, `turn.complete` |
| Agent list | `$.agent.list` (to find a caller's type) |
| Prompts | `$.prompt.submit`: one message when a background run of a guarded type changed protected files (or could not be checked) |
| UI | `$.ui.toast`: a run that changed protected files, a check that failed, a malformed option at session start |
| Processes | none |
| Files | `$.session.root` (the project root the globs are relative to), `$.fs.stat` (where a write lands, and the root's real path), `$.fs.list` and `$.fs.read` (the files under a `-` glob, at the start and end of a guarded run); none written |
| Network | none |
| Model calls | none by the mod itself; the message above is one Claude turn |
| State | session state only (`tdd-guard.pending`) |
| Gating hooks | `tool.call{tool=Edit}`, `{tool=Write}` and `{tool=NotebookEdit}` with `.catch` (a subagent's write is refused when the check fails; the main loop passes); `tool.call{tool=Agent}` with `.catch` (passes the call on and never refuses it; a failed check is toasted) |

## Development

```
claude plugin validate .
claude plugin test .
```

Built on Claude Code 2.1.296. Built test-first by issue-forge from the guard archetype (issue #18); see `SPEC.md`.

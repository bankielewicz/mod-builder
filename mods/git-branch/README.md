# Git Branch

A one-line band above the prompt naming the git branch the session is on, so you always know
where edits land without running `git status`. It also shows the number of changed files and
how far you are ahead of or behind the upstream branch, and it hides outside a repository.

```
 ⎇ feature/login-flow  ·  3 changed  ·  ↑2 ↓1
 ❯ _
```

When HEAD is detached it reads `⎇ detached @ a1b2c3d`, and in a new repo it reads
`⎇ master  ·  no commits yet`. Below 40 columns it shows only the branch name.

## Try it

```
/git-branch demo
```

- `/git-branch`: prints the current line (or why there is none) and refreshes the band
- `/git-branch demo`: shows the four sample states until the turn ends
- `/git-branch hide` / `show`: hides the band for this session, or shows it again
- `/git-branch refresh`: reads git again now

The band refreshes at session start, after every Bash call and when each turn ends.

## Install

From the GitHub marketplace:

```
/plugin install git-branch --marketplace bankielewicz/mod-builder
```

From a local clone (`claude plugin marketplace add <folder>` once):

```
/plugin install git-branch@claudemod
```

While developing, from its folder:

```
claude --plugin-dir <path-to>/git-branch
```

Changes load with `/reload-plugins` or a new session.

## Options

None.

## What it reaches

Mods are not sandboxed. They run with your access and skip Claude's permission prompts, so this
table lists everything this one can touch. It is generated from `claude plugin validate`.

| Reach | Detail |
| --- | --- |
| Hooks | `session.start`, `command.run{command=git-branch}`, `tool.call{tool=Bash}`, `turn.complete`, `ui.render{component=AbovePrompt}` |
| Processes | `$.process.run`: `git --no-optional-locks status --porcelain=v2 --branch` in the session's cwd (read-only, 5 s timeout) |
| Files | none written; session state only (`git-branch.snapshot`, `isHidden`, `isDemo`) |
| Network | none |
| Model calls | none |
| Gating hooks | `tool.call{tool=Bash}` with `.catch`; it only reads the result and never blocks |

## Development

```
claude plugin validate .
claude plugin test .
```

Built on Claude Code 2.1.296. Written spec-first with `/mod-builder:build`; see `SPEC.md`.

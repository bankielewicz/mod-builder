# Issue Forge

Takes one GitHub issue to a pull request test-first: red, green and refactor subagents, each phase checked by commands and a 95% diff-coverage gate; pushes only after you confirm

<!-- One screen: what the person sees and why it helps. Replace this comment with a short
     paragraph and, if it draws, an ASCII capture of its main state from SPEC.md. -->

## Try it

```
/issue-forge demo
```

<!-- List every subcommand the mod answers, one line each. -->

## Install

From a GitHub marketplace that lists it:

```
/plugin install issue-forge --marketplace <owner>/<repo>
```

From a local folder marketplace (`claude plugin marketplace add <folder>` once):

```
/plugin install issue-forge@<marketplace-name>
```

While developing, from its folder:

```
claude --plugin-dir <path-to>/issue-forge
```

Changes load with `/reload-plugins` or a new session.

## Options

<!-- One row per userConfig key from plugin.json, or "None." -->

| Option | Default | What it does |
| --- | --- | --- |

## What it reaches

Mods are not sandboxed. They run with your access and skip Claude's permission prompts, so this
table lists everything this one can touch. It is generated from `claude plugin validate`.

<!-- Fill from the validate output's hooks / calls / gating lines: -->

| Reach | Detail |
| --- | --- |
| Hooks | |
| Processes | |
| Files | |
| Network | |
| Model calls | |
| Gating hooks | |

## Development

```
claude plugin validate .
claude plugin test .
```

Built on Claude Code <version>. Written spec-first with `/mod-builder:build`; see `SPEC.md`.

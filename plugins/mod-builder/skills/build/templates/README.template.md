# __TITLE__

__DESCRIPTION__

<!-- One screen: what the person sees and why it helps. Replace this comment with a short
     paragraph and, if it draws, an ASCII capture of its main state from SPEC.md. -->

## Try it

```
/__NAME__ demo
```

<!-- List every subcommand the mod answers, one line each. -->

## Install

From a GitHub marketplace that lists it:

```
/plugin install __NAME__ --marketplace <owner>/<repo>
```

From a local folder marketplace (`claude plugin marketplace add <folder>` once):

```
/plugin install __NAME__@<marketplace-name>
```

While developing, from its folder:

```
claude --plugin-dir <path-to>/__NAME__
```

Changes load with `/reload-plugins` or a new session.

## Options

<!-- One row per userConfig key from plugin.json, or "None." -->

| Option | Default | What it does |
| --- | --- | --- |

## What it reaches

Mods are not sandboxed. They run with your access and skip Claude's permission prompts, so this
table lists everything this one can touch. It is generated from `claude plugin validate`, plus
any command hook or MCP server, which validate doesn't list.

<!-- Fill from the validate output's hooks / calls / gating lines. Then read hooks/hooks.json (entries besides "modules"), .mcp.json and plugin.json's hooks and mcpServers, and add a row for each entry, naming its command: -->

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

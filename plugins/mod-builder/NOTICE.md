# Notice

All code in this plugin was written for it. No code was copied from other projects.

## Ideas we learned from

We read these public mod collections to learn the patterns, then wrote our own implementations:

- OneWave-AI/claude-code-mods (MIT): demo subcommands, guard "ceremonies", animated panes
- hamzafer/claude-code-mods (MIT): bands that compose with `next(e)`, CI over a mods folder, the "What it reaches" table
- modu-ai/moai-adk `mods/` (Apache-2.0): pure-logic helpers kept apart from `$`, band fail-safety
- AgriciDaniel/claude-seo and mobile-next/mobile-mcp (MIT / Apache-2.0): hybrid plugins (skills and MCP plus a hooks module)
- zhangbububu/session-titles (MIT): classic hook events from a hooks module

## Anthropic material

The Claude Code API declarations and the built-in `plugin-authoring` skill belong to Anthropic.
This plugin refers to them at run time and ships no copy of them.

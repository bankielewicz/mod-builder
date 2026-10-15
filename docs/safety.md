# Safety and trust

[← README](../README.md)

Mods are not sandboxed. A mod runs with your full user access and skips Claude's permission
prompts, so installing one means trusting its author.

mod-builder follows two rules:

- **Every mod says what it reaches.** Each mod's README carries a "What it reaches" table generated
  from `claude plugin validate`: hooks, processes, files, network, model calls, and gating hooks.
  Read it before you install a mod. Mod Lab's own is in
  [its README](../plugins/mod-builder/README.md#what-it-reaches).
- **Our own code only.** Community mods are read for ideas. They are never installed or copied.

Mod Lab can re-run a mod's checks on its own (`autoRerun`) when the mod's code changes. That's
`claude plugin validate`, which only reads the files, and `claude plugin test`, whose test
environment has no file system, network or process access (per Claude Code's API declarations).
Whether a plugin's non-module parts (command hooks in `hooks/hooks.json`, an `.mcp.json` server)
stay inert under those two commands has not been confirmed with a control, so the option is off
by default: turn it on in `/config` only for mods you wrote. It only re-runs mods you have
already validated or tested in this install.

What the skills do for safety:

- The SPEC lists every file, process and cost before anything is built, and it is the only gate.
- Guards are written to fail closed: if a check breaks, the action is refused, not allowed.
- Mods never write inside their own plugin folder; runtime data goes under `~/.claude/<mod>-data/`.

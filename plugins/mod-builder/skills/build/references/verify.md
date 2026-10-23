# Verifying a mod

Read at the build skill's step 4, Verify, which the edit skill also runs in full. `<scratchpad>` is
the session's scratchpad directory: a temporary folder outside the repository and the mod.

## Check the smoke test's debug log

The smoke test passes only when the first three points below hold. Check each before calling it
passed. The fourth is a third outcome, neither a pass nor a fail: blocked by policy.

- The log has a `hooks module <name>@inline loaded` line, and after it a
  `plugin.register: <name> (user, <name>@inline), … admitted` line. A policy refusal comes after
  `loaded`, so `loaded` alone isn't enough.
- Its `--plugin-dir <path> is one plugin` line names `<mods>/<name>`, the mod folder under test.
- It has no line for the mod that says `did not load`, `not loaded`, `ignored`, `hook skipped` or
  `refused`, and no `Plugin path does not exist: <mods>/<name>`. With a wrong path the installed
  copy, if there is one, answers the demo, and only that log line says so. The same line for another
  path, such as a stale entry in `CLAUDE_CODE_PLUGIN_DIRS`, doesn't fail the check. In a `-p` run,
  another mod's refusal goes to the debug log only.
- Managed settings can block the check (docs, not observed). When their `enabledPlugins` names the
  plugin, the log says `--plugin-dir copy of "<name>" ignored: plugin is locked by managed settings`
  and the installed copy answers; their `disableSideloadFlags` rejects `--plugin-dir` at startup.
  Either way, report the smoke test as blocked by policy, quote what the session printed, and don't
  work around it.

## The installed copy, and options in a `-p` run

A `--plugin-dir` copy replaces an installed one of the same name, so there is nothing to turn off.
The run reads options from user settings, `--settings` and managed settings, under
`pluginConfigs."<name>"` or `pluginConfigs."<name>@inline"` (the log's own line names them). Where
none is set, the log says `every option is its default`. A demo that needs an option passes it:
`--settings '{"pluginConfigs":{"<name>@inline":{"options":{…}}}}'`. Which source wins when
managed settings also set it hasn't been probed, so read the options the log reports before trusting
the result.

## Typecheck

During a build the mod has never loaded in an interactive session, so its
`tsconfig.json` (which extends `.claude-plugin/types/`) has nothing to extend yet. Instead, copy
the build skill's `templates/tsconfig.check.json` to `<scratchpad>` (never into the mod), replace
`__TYPES__` with the d.ts path plugin-authoring printed and `__MOD__` with the mod folder, then run
`npx -y -p typescript@5.6 tsc -p <that copy>`. Once `<mod>/.claude-plugin/types/` exists,
`tsc -p <mod>` works directly.

## Tests that touch real config

Run tests inside a session with `CLAUDE_CONFIG_DIR=$(mktemp -d)` if they touch real config.

# Which copy of a mod runs, and how edits reach it

Read by the build skill at step 4, when loading the mod live, and at step 5, in the hand-off. The edit
skill reads it at step 0.4 and in its hand-off. Two answers decide what makes an edit to a mod run:
how the mod is installed, and whether this session loaded it with `--plugin-dir`.

## How it's installed

Run `claude plugin list --json` and find the mod's row: an `id` of
`<entry name>@<marketplace>`, where the entry name is the marketplace's name for it. The same
name can have more than one row, such as `@synced`, so take the one from this marketplace.

- `enabled` is false: it won't load at the next `/reload-plugins` or session. A session that
  loaded it before it was turned off may still run it, since settings reach a running session
  only at `/reload-plugins` (docs, not observed). `/plugin`'s Installed tab shows what this
  session runs.
- The row has a `readFromFolder` key (the text form prints `Read from:`): the mod was installed
  from a marketplace added from a local folder, and it loads in place. Edits to *that* folder
  load at `/reload-plugins` or the next session. When the folder being edited is another one, such
  as a git worktree, the installed copy keeps running the other folder's code. `folderVersion` is the
  folder's version now, and `version` is the one recorded at install.
- The row has no `readFromFolder` key: the mod is a copy of one version, under `installPath`. An
  edit reaches it only after the version is bumped, the marketplace holds the change (pushed),
  and `claude plugin update <id>` or `/plugin` updates it. Then `/reload-plugins` loads it.
- No row: the mod isn't installed from this marketplace.
- When this marketplace's row is missing or disabled, a row of the same name from another
  origin, `@skills-dir` or `@synced`, may be the copy running (docs, not observed). An enabled
  marketplace copy takes precedence over both. The Installed tab shows which one this session
  runs.

## Whether this session loaded it with `--plugin-dir`

Or the same way, through `--plugin-url` or `CLAUDE_CODE_PLUGIN_DIRS`. The install records can't tell,
because the marketplace row stays enabled while an inline copy replaces it. The person sees it
in `/plugin`'s Installed tab, as "Check which copy loaded" below says. If the request doesn't say,
ask the person (the edit skill asks in its step 1 batch).

- When managed settings' `enabledPlugins` names the plugin, a `--plugin-dir` copy never replaces
  it (docs, not observed): the managed copy runs, the Installed tab shows its marketplace row,
  and the build skill's step 4 smoke test is blocked by policy.
- An archive is a copy: `--plugin-url` always loads one, and so does `--plugin-dir` given a
  `.zip`. Claude Code extracts it into a session folder of its own, so an edit to the source
  folder never reaches it. Tell the person to load the folder instead, or to rebuild the archive
  and start a new session. The rest of this section is about a folder.
- A folder runs as `<name>@inline`. Its hooks module reloads when the person saves a file
  in it, or when a turn in which Claude saved files ends. The transcript's reload line names the
  mod. `reload failed, the previous version stays loaded:` is a failure: the old version is still
  the one running (docs, not observed). Its skills, agents and other components load their changes
  at `/reload-plugins` (docs, not observed).
- Each reload runs `register` again, so module variables reset, while `$.state` and `$.store`
  stay.
- The folder is a protected path, so in the `default` and `acceptEdits` modes each edit Claude makes
  to it asks the person for approval.

## Load a mod live

Load it in one of two ways:

- **A new session with `claude --plugin-dir <mods>/<name>`** (fastest). It reloads as "A folder"
  above says.
- **Install it once** from the marketplace (Share) with `/plugin install <name>@<marketplace>`. From
  a marketplace added from a local folder it loads in place, and `/reload-plugins` picks up later
  edits (it prints `re-read from its folder`). From a GitHub or other remote marketplace it is a copy
  of one version: an edit reaches it only after a version bump (the scaffold's `plugin.json` pins
  `version`), a push, `claude plugin update <name>@<marketplace>` and then `/reload-plugins`.

`/reload-plugins` alone never loads a plugin that isn't installed.

## How later edits reach the copy that runs

- From a marketplace added from a local folder: `/reload-plugins`, which prints
  `re-read from its folder`.
- From GitHub or another remote marketplace: a version bump, a push and
  `claude plugin update <name>@<marketplace>` (it ends with `Restart to apply changes.`), then
  `/reload-plugins`.
- With `--plugin-dir`: as "A folder" above says. A save reloads the hooks module, and
  `/reload-plugins` loads the rest (docs, not observed).

## Check which copy loaded

`/plugin`'s Installed tab shows which copy loaded: the row `<name>  Plugin  inline` is a
`--plugin-dir` copy, and an installed copy's row names its marketplace. The row's details give
the version. The `mods active` line names mods only, not which copy or version.

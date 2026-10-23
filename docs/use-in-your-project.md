# Use mod-builder in your own project

[← README](../README.md)

You don't need to work inside this repo. Install mod-builder once, then build mods in any project.

## 1. Install at user scope

```text
/plugin marketplace add bankielewicz/mod-builder
/plugin install mod-builder@claudemod
```

Choose **User** when asked for a scope.

## 2. Build a mod

```text
/mod-builder:build <idea>
```

The skill looks upward from your working directory for a `.claude-plugin/marketplace.json`. If
there isn't one, it asks where mods should live and offers to create a folder marketplace there:

```text
<project>/
  .claude-plugin/marketplace.json   your project's marketplace
  mods/<name>/                      one folder per mod
```

## 3. Approve the SPEC

`mods/<name>/SPEC.md` lists every file, process and cost. After you approve it, Claude scaffolds,
builds, tests and validates the mod, then writes its README and adds the marketplace entry.

## 4. Load the mod

While you develop, the folder is watched and edits reload on their own:

```sh
claude --plugin-dir mods/<name>
```

Or install it from your project's marketplace:

```sh
claude plugin marketplace add .
```

```text
/plugin install <name>@<your-marketplace>
```

After that, `/reload-plugins` picks up edits. It never loads a plugin that isn't installed yet.

## 5. Mod Lab finds your mods

With its **Mods folder** option (`modsDir`) empty, Mod Lab watches the folder a build or edit is
working in: `/mod-builder:build` and `/mod-builder:edit` report it, so a git worktree you edit by
path shows up with nothing to type. Before any report, it watches the `mods/` of the marketplace
nearest the session's project root, your project's (`/cd` moves it; Claude's own `cd` doesn't).
Set `modsDir` (on the install options screen or later in `/config`) only to pin one folder, for
example when your marketplace keeps its mods somewhere other than `mods/`. A set `modsDir` always wins.

## 6. Keep engine types out of git

Claude Code writes type declarations into each mod it loads:

```text
**/.claude-plugin/types/
```

## 7. Change it later

```text
/mod-builder:edit <name> <change>
```

The change is appended to the SPEC for one approval, the version is bumped, and Mod Lab marks
what the change still needs with `◌` until each stage is redone. See [Mod Lab → Edits](mod-lab.md#edits).

## 8. Share it

Commit the folder. Teammates run:

```text
/plugin marketplace add <owner>/<repo>
/plugin install <name>@<your-marketplace>
```

## 9. Optional: CI

Copy [`plugins/mod-builder/skills/build/ci/ci.yml`](../plugins/mod-builder/skills/build/ci/ci.yml)
into `.github/workflows/`. On every push to `main` and every pull request it validates your
marketplace, then validates and tests every plugin under `plugins/` and `mods/`. It validates with
`claude plugin validate --strict`, so a warning, such as an unknown manifest field or a missing
`version`, fails the run.

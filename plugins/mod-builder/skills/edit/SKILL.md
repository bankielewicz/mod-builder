---
name: edit
description: This skill should be used when the user wants to change, extend, fix or update an existing Claude Code mod spec-first, with "/mod-builder:edit <mod>", "edit my mod", "change <mod> so that…", "add a feature to <mod>" or "update <mod>". It appends a dated change to the mod's SPEC.md for one approval, bumps the version, changes logic first, re-verifies with validate, test and tsc, and re-ships. Mod Lab shows the edit as a new build generation. For a brand-new mod, use /mod-builder:build instead.
---

# mod-builder:edit

You change an existing mod with the same gates as a new build, but every step is about **the
change**. The mod already has an approved SPEC, tests and a README. Keep them, and add to them.

This skill reuses the build skill's steps. Its SKILL.md is at `../build/SKILL.md`, relative to this
skill's base directory (also `${CLAUDE_PLUGIN_ROOT}/skills/build/SKILL.md`), and its references and
templates are beside it. Read it once before step 1.

## 0. Orient

Do build's step 0 (load `plugin-authoring`, find the mods folder, record `claude --version`). Then:

1. Find `<mods>/<mod>/`. If it isn't there, stop, and:
   - When `<root>/.claude-plugin/marketplace.json` lists `<mod>` with a `source` outside `<mods>/`,
     such as `./plugins/<mod>`, say that this skill edits only the mods under `<mods>/`. Say to
     change that plugin by Anthropic's plugin documentation
     (https://code.claude.com/docs/en/plugins/create and the pages it links), and its skills with
     `/plugin-dev:skill-development` (the `plugin-dev` plugin, from `claude-plugins-official`).
   - Otherwise, suggest `/mod-builder:build`.
2. Read its `SPEC.md`, `README.md`, `.claude-plugin/plugin.json`, `hooks/` and `tests/`.
3. **Mod Lab:** if `mcp__mod-builder__lab_report` is among your tools, your **first** call is
   `{ mod, stage: 'Spec', status: 'running', note: 'editing: <change in a few words>', path }`, with
   `path` the absolute path of the folder you found in 1 (pass it on every report). On a mod
   that was built before, that starts a new **build generation**: every stage whose evidence is
   older than now turns `◌` stale in the pane, and turns green again as you redo it. Report each
   stage as build's step 0 describes. Scaffold isn't redone; it stays green.
4. **Which copy runs.** Two answers decide what makes your edit run. Note both for step 4 and the
   hand-off.
   - **How it's installed.** Run `claude plugin list --json` and find the mod's row: an `id` of
     `<entry name>@<marketplace>`, where the entry name is the marketplace's name for it. The same
     name can have more than one row, such as `@synced`, so take the one from this marketplace.
     - `enabled` is false: it won't load at the next `/reload-plugins` or session. A session that
       loaded it before it was turned off may still run it, since settings reach a running session
       only at `/reload-plugins` (docs, not observed). `/plugin`'s Installed tab shows what this
       session runs.
     - The row has a `readFromFolder` key (the text form prints `Read from:`): the mod was installed
       from a marketplace added from a local folder, and it loads in place. Edits to *that* folder
       load at `/reload-plugins` or the next session. If you're editing another folder, such as a
       git worktree, the installed copy keeps running the other folder's code. `folderVersion` is the
       folder's version now, and `version` is the one recorded at install.
     - The row has no `readFromFolder` key: the mod is a copy of one version, under `installPath`. An
       edit reaches it only after the version is bumped, the marketplace holds the change (pushed),
       and `claude plugin update <id>` or `/plugin` updates it. Then `/reload-plugins` loads it.
     - No row: the mod isn't installed from this marketplace.
     - When this marketplace's row is missing or disabled, a row of the same name from another
       origin, `@skills-dir` or `@synced`, may be the copy running (docs, not observed). An enabled
       marketplace copy takes precedence over both. The Installed tab shows which one this session
       runs.
   - **Whether this session loaded it with `--plugin-dir`**, or the same way through `--plugin-url`
     or `CLAUDE_CODE_PLUGIN_DIRS`. The install records can't tell you,
     because the marketplace row stays enabled while an inline copy replaces it. The person sees it
     in `/plugin`'s Installed tab: a `--plugin-dir` copy is the row `<name>  Plugin  inline`, and an
     installed copy's row names its marketplace. The `mods active` line names mods only. If the
     request doesn't say, ask in step 1's batch.
     - When managed settings' `enabledPlugins` names the plugin, a `--plugin-dir` copy never replaces
       it (docs, not observed): the managed copy runs, the Installed tab shows its marketplace row,
       and build's step 4 smoke test is blocked by policy.
     - An archive is a copy: `--plugin-url` always loads one, and so does `--plugin-dir` given a
       `.zip`. Claude Code extracts it into a session folder of its own, so an edit to the source
       folder never reaches it. Tell the person to load the folder instead, or to rebuild the archive
       and start a new session. The rest of this point is about a folder.
     - A folder runs as `<name>@inline`. Its hooks module reloads when the person saves a file
       in it, or when a turn in which you saved files ends. Its skills, agents and other components
       load their changes at `/reload-plugins` (docs, not observed).
     - Each reload runs `register` again, so module variables reset, while `$.state` and `$.store`
       stay.
     - The folder is a protected path, so in the `default` and `acceptEdits` modes each of your edits
       to it asks the person for approval.

## 1. Slots for the change

Follow build's step 1, but only for what the change touches. A change that doesn't alter a slot
leaves it as approved. Ask (one batch, up to 4) only about gaps in **the change**.

## 2. The change, in SPEC.md (the single gate)

Don't rewrite the approved SPEC. Append:

```markdown
## Change <new version> (<YYYY-MM-DD>)

> <the request, in the person's words>

- **What changes:** <behaviour, UI states, commands; update the mockup if the drawing changes>
- **What gets touched:** <files written, processes, costs: the delta only>
- **Tests:** <new or changed tests, one per requirement that won't bend>
- **Done means:** <what the person can do afterwards>
```

Choose the version bump by semver: patch for a fix, minor for a feature, major for a breaking
change to commands, options or the state contract. Then stop for approval, as in build's step 2.
(lab_report: Spec passed once approved.)

## 3. Build the change

Build's step 3, without the scaffold (the mod exists, and `scaffold.mjs` refuses to overwrite it):

1. **Logic first:** change or add pure functions in `hooks/<mod>-logic.ts` with tests, and keep
   `claude plugin test` green as you go.
2. **Register:** keep `register.tsx` thin. A new atom goes in `types/index.d.ts`.
3. **UI tests:** cover every state the change adds or alters.

## 4. Verify

Build's step 4, in full. Any edit after Verify passed makes it stale: run it again.

## 5. Re-ship

1. **Version:** set the new version in `plugin.json` **and** the marketplace entry. Mod Lab's
   Share stage re-passes when they match.
2. **README:**
   - Describe the change where it matters to a user, and update the options and commands.
   - Regenerate the "What it reaches" table from `claude plugin validate`, plus any command hook or
     MCP server it doesn't list (build's step 5).
   - Refresh the "Built on Claude Code <version>" line. Keep the build it names, and add the new
     version with what ran on the build from step 0: the tests, the `-p` demo, or an interactive
     session. For example: `Built on Claude Code 2.1.296; 0.1.3's tests and demo ran on 2.1.308.`
   - Leave no template comments.
3. **Hand off** as in build's step 5. Its "how later edits reach the copy they run" bullet covers a
   local-folder marketplace, a remote one and a `--plugin-dir` folder, and the Installed tab check.
   Add what changed in one line, and the cases that bullet doesn't spell out:
   - **Locked by managed settings:** say that the folder's copy couldn't be checked, and that the
     managed copy is the one running.
   - **An installed copy and a `--plugin-dir` session together**, as when an in-place install is
     checked with `--plugin-dir` on a git worktree. This session runs the `--plugin-dir` copy, and
     the installed copy keeps reading the folder `readFromFolder` names. Say that the edit reaches
     the installed copy only once the change is in that folder.
   - **Neither installed nor loaded:** say how to load it the first time, as build's hand-off does.

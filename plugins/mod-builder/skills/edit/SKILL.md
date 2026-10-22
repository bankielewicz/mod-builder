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

1. Find `<mods>/<mod>/`. If it doesn't exist, stop and suggest `/mod-builder:build`.
2. Read its `SPEC.md`, `README.md`, `.claude-plugin/plugin.json`, `hooks/` and `tests/`.
3. **Mod Lab:** if `mcp__mod-builder__lab_report` is among your tools, your **first** call is
   `{ mod, stage: 'Spec', status: 'running', note: 'editing: <change in a few words>', path }`, with
   `path` the absolute path of the folder you found in 1 (pass it on every report). On a mod
   that was built before, that starts a new **build generation**: every stage whose evidence is
   older than now turns `◌` stale in the pane, and turns green again as you redo it. Report each
   stage as build's step 0 describes. Scaffold isn't redone; it stays green.
4. **Which copy runs.** Two answers decide what makes your edit run. Note both for step 4 and the
   hand-off.
   - **How it's installed.** Run `claude plugin list --json` and find the mod's id
     (`<name>@<marketplace>`).
     - `readFromFolder` is set (the text form prints `Read from:`): the mod was installed from a
       marketplace added from a local folder, and it loads in place. Edits to *that* folder load at
       `/reload-plugins` or the next session. If you're editing another folder, such as a git
       worktree, the installed copy keeps running the other folder's code.
     - `readFromFolder` is null: the mod is a copy of one version, under `installPath`. An edit reaches
       it only after the version is bumped, the marketplace holds the change (pushed), and
       `claude plugin update <id>` or `/plugin` updates it. Then `/reload-plugins` loads it.
     - No id: the mod isn't installed.
   - **Whether this session loaded it with `--plugin-dir`.** The install records can't tell you,
     because the marketplace row stays enabled while an inline copy replaces it. The person sees it
     in `/plugin` (the `mods active` line and the Installed tab), so if the request doesn't say,
     ask in step 1's batch.
     - Such a folder runs as `<name>@inline`. Its hooks module reloads when the person saves a file
       in it, or when a turn in which you saved files ends. Its skills, agents and other components
       load their changes at `/reload-plugins`.
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
3. **Hand off** as in build's step 5. Add what changed in one line, and what loads the new version
   in the person's case from step 0.4:
   - **An in-place install:** `/reload-plugins`, which prints `re-read from its folder`.
   - **A copy of one version:** the change pushed to the marketplace and `claude plugin update <id>`,
     which ends with `Restart to apply changes.`, then `/reload-plugins`.
   - **A `--plugin-dir` session:** the hooks module reloads at once, and the transcript's reload
     line names the mod. `reload failed, the previous version stays loaded:` means the old code is
     still running. An edited skill or other component loads at `/reload-plugins`.

   If you edited a folder the person's copy doesn't read, such as a git worktree, say that the edit
   reaches that copy only once the change is in the folder that `readFromFolder` names. `/plugin`'s
   `mods active` line shows what loaded.

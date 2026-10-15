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
   `{ mod, stage: 'Spec', status: 'running', note: 'editing: <change in a few words>' }`. On a mod
   that was built before, that starts a new **build generation**: every stage whose evidence is
   older than now turns `◌` stale in the pane, and turns green again as you redo it. Report each
   stage as build's step 0 describes. Scaffold isn't redone; it stays green.

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
2. **README:** describe the change where it matters to a user, update the options and commands,
   and regenerate the "What it reaches" table from `claude plugin validate`, plus any command
   hook or MCP server it doesn't list (build's step 5). No template comments left.
3. **Hand off** as in build's step 5. Add what changed in one line, and that `/reload-plugins`
   (or a new session) loads the new version.

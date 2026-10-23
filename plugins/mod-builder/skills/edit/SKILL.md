---
name: edit
description: This skill should be used when the user wants to change, extend, fix or update an existing Claude Code mod spec-first, with "/mod-builder:edit <mod>", "edit my mod", "change <mod> so that…" or "add a feature to <mod>". It appends a dated change to the mod's SPEC.md for one approval, bumps the version, changes logic first, re-verifies with validate, test and tsc, and re-ships. Mod Lab shows the edit as a new build generation. For a brand-new mod, use /mod-builder:build instead.
---

# mod-builder:edit

Change an existing mod with the same gates as a new build, keeping every step about **the
change**. The mod already has an approved SPEC, tests and a README. Keep them, and add to them.

This skill reuses the build skill's steps. Its SKILL.md is at `../build/SKILL.md`, relative to this
skill's base directory (also `${CLAUDE_PLUGIN_ROOT}/skills/build/SKILL.md`), and its references and
templates are beside it. Read it before step 0, which runs build's step 0.

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
3. **Mod Lab:** if `mcp__mod-builder__lab_report` is among the session's tools, the **first** call is
   `{ mod, stage: 'Spec', status: 'running', note: 'editing: <change in a few words>', path }`, with
   `path` the absolute path of the folder found in 1 (pass it on every report). On a mod
   that was built before, that starts a new **build generation**: every stage whose evidence is
   older than now turns `◌` stale in the pane, and turns green again as it is redone. Report each
   stage as build's step 0 describes, mapped to this skill's steps: Spec → 2, Logic → 3.1,
   Register → 3.2–3.3, Validate and Test → 4, README and Share → 5. Scaffold isn't redone; it stays
   green.
4. **Which copy runs.** Two answers decide what makes the edit run: how the mod is installed, and
   whether this session loaded it with `--plugin-dir`. Find both as `../build/references/loading.md`
   says, under "How it's installed" and "Whether this session loaded it with `--plugin-dir`", and
   note them for step 4 and the hand-off. Ask the `--plugin-dir` question in step 1's batch when the
   request doesn't say.

## 1. Slots for the change

Follow build's step 1, but only for what the change touches. A change that doesn't alter a slot
leaves it as approved. Ask (one batch, up to 4) only about gaps in **the change**, plus step 0.4's
`--plugin-dir` question when the request doesn't answer it.

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
   `claude plugin test` green throughout.
2. **Register:** keep `register.tsx` thin. A new atom goes in `types/index.d.ts`.
3. **UI tests:** cover every state the change adds or alters.
4. **Demo:** `/<mod> demo` shows every state the change adds or alters.

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
3. **Hand off** as in build's step 5. Its pointer to `../build/references/loading.md` ("How later
   edits reach the copy that runs" and "Check which copy loaded") covers a local-folder marketplace,
   a remote one and a `--plugin-dir` folder. Add what changed in one line, and the cases those two
   sections don't spell out:
   - **Locked by managed settings:** say that the folder's copy couldn't be checked, and that the
     managed copy is the one running.
   - **An installed copy and a `--plugin-dir` session together**, as when an in-place install is
     checked with `--plugin-dir` on a git worktree. This session runs the `--plugin-dir` copy, and
     the installed copy keeps reading the folder `readFromFolder` names. Say that the edit reaches
     the installed copy only once the change is in that folder.
   - **Neither installed nor loaded:** say how to load it the first time, as build's hand-off does.

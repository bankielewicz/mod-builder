# Architecture

Read before changing `plugins/mod-builder` (its skills or Mod Lab) or a mod under `mods/`, to find
which file holds what and which `SPEC.md` records why.

**`plugins/mod-builder/`** has three parts:
- `skills/build/SKILL.md` (`/mod-builder:build`): request → slot-filled `SPEC.md` (the single approval
  gate) → `scripts/scaffold.mjs` from one of 5 archetypes in `templates/archetypes/*/*.tpl` → logic
  first → verify → README + marketplace entry. `references/` holds `conventions.md` (house rules),
  `gotchas.md` (verified engine rules), `patterns.md`, `ui-states.md`, `verify.md` (step 4's log checks and
  typecheck), `loading.md` (which copy of a mod runs and how edits reach it, shared with the edit skill).
- `skills/edit/SKILL.md` (`/mod-builder:edit`): changes an existing mod, reusing build's steps by
  reference; appends a dated change section to the SPEC and bumps semver.
- **Mod Lab** (`/modlab`), a mod: `hooks/register.tsx` (every `$` call) + `hooks/mod-builder-logic.ts`
  (every rule, pure, unit-tested) + `types/index.d.ts` (the `PluginState` contract for its atoms).
  It scans `modsDir`, judges 8 stages from **files on disk and exit codes** (a model's `lab_report`
  tool call only ever adds "running"), stores run results in `$.store`, re-runs stale checks at the end
  of each turn (`autoRerun`), and treats an edit as a **build generation** (evidence older than the edit
  goes stale). Records are kept per mods folder (`modlab:results:<modsDir>`, `modlab:done:<modsDir>`,
  `modlab:generations:<modsDir>`); every write to results and generations goes through `updateStore` in
  `register.tsx`, chained on one promise; that orders this session's writes only (#58). `SPEC.md`
  sections "Design" and "Edits" record why.

**`mods/*`**: `git-branch`, `issue-forge` (a
GitHub issue to a PR via red/green/refactor subagents behind a diff-coverage gate; this repo's profile
is `.issue-forge.json`, its coverage kit `plugins/mod-builder/skills/build/scripts/coverage/`, its
design spec `docs/specs/issue-forge.md`), `turn-counter` (left as raw scaffold output on purpose, and
not in the marketplace). Each has the same layout and its own `SPEC.md` with dated changes.

**Template files are `*.tpl`** so `claude plugin test`/`validate` never pick them up as real plugins.

# Contributing

[← README](README.md)

## Develop

Load the plugin from your clone; the folder is watched and edits reload:

```sh
claude --plugin-dir plugins/mod-builder
```

## Workflow

`main` is protected, so every change reaches it through a pull request, and Codex reviews each one.
Work on a branch (this repo's own sessions use a git worktree under the gitignored `scratch/`), and
take each code change test-first: red (a test that fails by assertion), green (the least code that
makes it pass), refactor, then the checks below. [docs/contributing/workflow.md](docs/contributing/workflow.md)
has the full rules.

## Check before a pull request

```sh
claude plugin validate .
claude plugin validate <plugin>        # every plugin you touched: plugins/mod-builder or mods/<name>
claude plugin test <plugin>
bash plugins/mod-builder/skills/build/scripts/check-archetypes.sh   # when a template or the build skill changed
node --import ./plugins/mod-builder/skills/build/scripts/coverage/register.mjs --test \
  --experimental-test-coverage --test-coverage-include='**/hooks/*-logic.ts' <logic test files>
```

Cover the changed lines and branches of the logic without lowering total coverage, run the
type-check described in [docs/contributing/commands.md](docs/contributing/commands.md) and the live
check described in [docs/contributing/workflow.md](docs/contributing/workflow.md), and put the results
in the pull request description.

CI validates the marketplace, validates and tests every plugin under `plugins/` and `mods/`, and
runs the archetype check, on Claude Code 2.1.296, for every push to `main` and every pull request.

## Rules

- **Logic in `*-logic.ts`, `$` only in `register.tsx`.** Every rule is a pure, unit-tested function.
- **Engine findings go in [`gotchas.md`](plugins/mod-builder/skills/build/references/gotchas.md)**
  with a source tag (`[d.ts]`, `[probe]`, `[field]`). Only add what you have verified.
- **Our own code only.** Read community mods for ideas; never copy or install them.
- **Templates stay buildable.** Archetype and scaffold templates are `*.tpl`; `check-archetypes.sh`
  regenerates and tests all five.
- **Release in both places.** Bump `version` in the plugin's `plugin.json` and in its
  `.claude-plugin/marketplace.json` entry, record the change in its `SPEC.md` (`/mod-builder:edit`
  adds a dated section), and keep its README's "What it reaches" table in step with
  `claude plugin validate`.
- **CI has two copies.** `.github/workflows/ci.yml` is a byte-for-byte copy of
  `plugins/mod-builder/skills/build/ci/ci.yml`; change both together.

## Repo layout

```text
.claude-plugin/marketplace.json     the "claudemod" folder marketplace
.issue-forge.json                   issue-forge's profile for this repo
CLAUDE.md                           the rules every Claude Code session needs, pointing into docs/contributing/
plugins/mod-builder/                the plugin
  skills/build/                     SKILL.md, templates/, references/, scripts/ (coverage/ kit), ci/
  skills/edit/                      SKILL.md (reuses build's references and templates)
  hooks/register.tsx                Mod Lab: every $ call
  hooks/mod-builder-logic.ts        Mod Lab: every rule, $-free, unit-tested
  tests/  types/  SPEC.md  README.md  NOTICE.md  design/
mods/                               example mods: git-branch, issue-forge, turn-counter
docs/                               guides, README images, and specs/ (issue-forge's design)
  contributing/                     commands, workflow (worktree, TDD, QA), architecture, engine rules
.github/workflows/ci.yml            validate + test every plugin, regenerate every archetype
```

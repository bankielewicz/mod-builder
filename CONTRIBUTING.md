# Contributing

[← README](README.md)

## Develop

Load the plugin from your clone; the folder is watched and edits reload:

```sh
claude --plugin-dir plugins/mod-builder
```

## Check before a pull request

```sh
claude plugin validate .
claude plugin validate plugins/mod-builder
claude plugin test plugins/mod-builder
bash plugins/mod-builder/skills/build/scripts/check-archetypes.sh
```

CI runs the same checks on every push to `main` and every pull request.

## Rules

- **Logic in `*-logic.ts`, `$` only in `register.tsx`.** Every rule is a pure, unit-tested function.
- **Engine findings go in [`gotchas.md`](plugins/mod-builder/skills/build/references/gotchas.md)**
  with a source tag (`[d.ts]`, `[probe]`, `[field]`). Only add what you have verified.
- **Our own code only.** Read community mods for ideas; never copy or install them.
- **Templates stay buildable.** Archetype and scaffold templates are `*.tpl`; `check-archetypes.sh`
  regenerates and tests all five.

## Repo layout

```text
.claude-plugin/marketplace.json     the "claudemod" folder marketplace
plugins/mod-builder/                the plugin
  skills/build/                     SKILL.md, templates/, references/, scripts/, ci/
  skills/edit/                      SKILL.md (reuses build's references and templates)
  hooks/register.tsx                Mod Lab: every $ call
  hooks/mod-builder-logic.ts        Mod Lab: every rule, $-free, unit-tested
  tests/  types/  SPEC.md  README.md  NOTICE.md  design/
mods/                               example mods
docs/                               guides and README images
.github/workflows/ci.yml            validate + test every plugin, regenerate every archetype
```

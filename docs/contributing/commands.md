# Commands

Read before running a check, a test, the typecheck or a live session in this repository, and before
changing CI. The QA phase in [workflow.md](workflow.md) ("TDD: red, green, refactor, QA") runs them.
Paths are from the repository root.

## Checks and tests

There is no build step and no package.json: the engine loads the TypeScript directly.

```sh
claude plugin validate .                         # the marketplace
claude plugin validate plugins/mod-builder       # one plugin: manifest, hooks, gating hooks, state contract
claude plugin test plugins/mod-builder           # one plugin's *.test.ts(x) (no per-test filter; a few seconds)
claude plugin test mods/issue-forge              # likewise for each mod under mods/
bash plugins/mod-builder/skills/build/scripts/check-archetypes.sh   # scaffold all 5 archetypes, validate + test each
node plugins/mod-builder/skills/build/scripts/check-sandbox.mjs     # the loader still refuses import()/node:fs tests; canary list = gotchas.md's
claude -p --plugin-dir mods/<name> "/<name> demo"                    # headless live smoke test of a command
claude --plugin-dir plugins/mod-builder                              # interactive session; the folder is watched and hot-reloads
```

## One test file under node

One logic test file, or one test by name, runs under node through the coverage kit's loader. UI tests
(`*.test.tsx`) only run under `claude plugin test`, and so does any `*.test.ts` whose name doesn't end in
`-logic.test.ts`: `plugins/mod-builder/tests/sandbox.test.ts` (the sandbox canary, #98) fails under node by
design, since node has the file system it checks is absent.

```sh
node --import ./plugins/mod-builder/skills/build/scripts/coverage/register.mjs --test mods/issue-forge/tests/issue-forge-logic.test.ts
node --import ./plugins/mod-builder/skills/build/scripts/coverage/register.mjs --test --test-name-pattern='in-line' mods/issue-forge/tests/issue-forge-logic.test.ts
```

## Typecheck

Typecheck (needs the bundled API types from the built-in `plugin-authoring` skill, at
`/tmp/claude-*/bundled-skills/<version>/*/plugin-authoring/types/claude-code.d.ts` once that skill has
loaded): copy `plugins/mod-builder/skills/build/templates/tsconfig.check.json` **outside** the repo,
replace `__TYPES__` and `__MOD__`, then `npx -y -p typescript@5.6 tsc -p <copy>`. A mod's own
`tsconfig.json` extends `.claude-plugin/types/tsconfig.json`, which the engine writes only when an
interactive session loads the mod (gitignored).

## CI

CI (`.github/workflows/ci.yml`) runs `validate --strict` + test for every `:(glob)plugins/*` and `:(glob)mods/*`
plugin, the archetype check and the sandbox check (`check-sandbox.mjs`: the loader still refuses `import()`
and `node:fs` test files, and the canary's list matches `gotchas.md`'s). It is a byte-for-byte copy of the
build skill's template `plugins/mod-builder/skills/build/ci/ci.yml`, so change both together, the version
pin included.

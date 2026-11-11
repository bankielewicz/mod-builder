# Contributing to mod-builder

## Run the checks

From the repository's top folder:

```bash
claude plugin validate --strict plugins/mod-builder
claude plugin test plugins/mod-builder
node --test --test-timeout=120000 plugins/mod-builder/tests/*.test.mjs plugins/mod-builder/scripts/*.test.mjs
```

The typecheck recipe, and what it needs first, is in [docs/development](docs/development/README.md).

## How a change is made

The working rules are in the design record, [`docs/mod-builder/SPEC.md`](docs/mod-builder/SPEC.md), sections
7.1 to 7.3. In short:

- **Test-first.** A behaviour change starts as a written plan, then a commit that holds only the failing tests,
  then a commit that holds only the code that makes them pass, then a check from a fresh context that reruns
  both and shows each of the plan's mutants failing a named test.
- **A change to an existing test goes in a commit of its own first**, with a message that says why.
- **Tests are read before they are committed** by someone who did not write them, against the rule they pin.
- **A rule is tried on the real engine**, or on real command output, before it is built; record what was run.
- **Decisions are recorded** in section 7 of the design record, with who made them.
- A documentation-only change needs none of the above; check that every relative link resolves.

## Pull requests

Changes reach `main` through a pull request. Say what the change does, how it was checked, and anything left
undone.

## What this changes

<!-- One or two sentences: the behaviour or the document that is different after this pull request. -->

## Why, and who decided

<!-- The issue, or the section of docs/mod-builder/SPEC.md (7.x), that this follows. Say who made each decision. -->

## Kind of change

- [ ] Documentation only
- [ ] Behaviour (rules, hooks module, skill, scripts, template)

## For a behaviour change (CONTRIBUTING.md)

- [ ] A commit that holds only the failing tests, then a commit that holds only the code
- [ ] A change to an existing test is in a commit of its own, with the reason in its message
- [ ] The tests were read against the rule by someone who did not write them
- [ ] The rule was tried on the real engine or on real command output; what was run:
- [ ] The decision is recorded in section 7 of docs/mod-builder/SPEC.md, and docs/limits says so if a limit changed

## How it was checked

<!-- Paste the last lines of each. Write "not run" for one you did not run. -->

```text
claude plugin validate --strict plugins/mod-builder
claude plugin test plugins/mod-builder
node --test --test-timeout=120000 plugins/mod-builder/tests/*.test.mjs plugins/mod-builder/scripts/*.test.mjs
```

Claude Code version these ran on:

## Left undone, or not checked

<!-- Anything a reviewer would otherwise assume was done. "Nothing" is an answer. -->

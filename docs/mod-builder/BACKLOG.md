# Backlog: after the MVP

Not built in the MVP (SPEC.md, section 3). Each item says what it adds and why it waits. Order is a
suggestion, not a commitment.

## Decided by the owner for after the MVP

1. **Ship the three TDD agents with the plugin** (`tdd-test-writer`, `tdd-implementer`, `tdd-verifier`), so
   every mod it builds goes through a written plan, a red commit, a green commit and a fresh-context
   verification with a mutant. The owner, 2026-11-10: "option 1 for MVP. option 2 post mvp." The skill
   then has to write the plan document each agent checks for.
2. **Logging for diagnostics.** The owner, 2026-11-10: "logging for diagnostics, etc." A log under the
   plugin's data folder: each gate's command, exit code and decision; each refusal with its phase and path;
   each refresh with what changed. A `/mod-builder log` view, and a setting for how much is kept.

## Knowledge

3. A scheduled job on the repository that refetches Anthropic's pages and opens a pull request with what
   changed, so the owner reviews a change before users get it.
4. A summary of prose changes written by a model, beside the mechanical line diff.
5. A diff of the API types between two Claude Code builds: `$` members and events added, removed, changed.
6. The "what changed" digest put into a session's context only when the session touches a mod.
7. A lookup tool the model calls (a mod tool) in place of the script, returning lines with page, line and
   snapshot stamp.
8. The refresh through `$.http.fetch` for machines without `curl`.
9. Other Anthropic pages a mod needs (plugins, hooks, skills), chosen from the docs index.

## Verification

10. Field notes as probes: each finding a small probe mod plus the log line it expects, rerun when the
    build changes, so each reads "verified on <build>" or "stale".
11. A template canary: each template scaffolded, validated, tested and typechecked on the installed build.
12. After a refresh, a check of every built mod's citations and API calls against what changed.
13. Coverage of changed logic lines as a gate in Verify.
14. A check of the hook's refusals against Bash: at least a warning when a shell command names a path the
    phase doesn't allow.

## Building and changing mods

15. ~~An `edit` skill for an existing mod: a dated change section in its SPEC, one approval, a version bump.~~
    Built in 0.2.0 (`SPEC.md` section 8).
16. More templates than `pane`: a command, a tool-call guard, a status line, a tool.
17. A resume after a session ends mid-build, and a hand-off of a build to another session.
18. Going back one phase, and a retry count per phase. (The stop command, `/mod-builder stop`, was built in
    0.2.0: `SPEC.md` 8.5.)
19. Suggesting `/design` mockups for more than panes: bands, transcript rows, dialogs.
23. A band above the prompt for mod-builder (`{ component: 'AbovePrompt' }`): one line that says where the
    build stands when the pane is waiting for a wider terminal. Left out of 0.2.0 (`SPEC.md` 8.18, point 2).

## Sharing

20. A marketplace entry check and a release step: version in both manifests, a "What it reaches" table
    from `claude plugin validate`, and "Built on".
21. ~~CI for the repository: validate and test the plugin on a pinned Claude Code version.~~ Done:
    `.github/workflows/ci.yml`.
22. ~~Taking over the first mod-builder's repository name, with a note for people who installed the first.~~
    Struck in 0.2.0 (`SPEC.md` 8.9): the repository is `bankielewicz/mod-builder`.

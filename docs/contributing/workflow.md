# Workflow: a worktree, then a PR, and TDD

Read before starting any change to this repository ("Changing files: a worktree, then a PR"), before
bringing the main folder up to date after a merge (that section's first paragraph), and before writing
the first test of a code change or running `/issue-forge <N>` ("TDD: red, green, refactor, QA").
`CLAUDE.md`'s "Rules that always hold" point here.

## Changing files: a worktree, then a PR

`main` is protected, and the main folder is shared. Several Claude sessions work in it at once, and the
installed plugins (`mod-builder@claudemod`, `git-branch@claudemod` and
`issue-forge@claudemod`) load from whatever branch it is on. So **never edit, commit or switch
branches in the main folder**, with one exception. After a PR merges, the main folder may be brought
up to date so the installed plugins get the merge: `git switch main && git merge --ff-only origin/main`
after a fetch, then `/reload-plugins` in each session. Do that only when the person asks or agrees, the
folder has no uncommitted changes, and no issue-forge run or other session is working in it. Every
change to this repo happens in its own worktree and reaches `main` through a PR:

1. `git fetch origin && git worktree add --no-track -b <branch> scratch/<name> origin/main`
   (`scratch/` is gitignored). Edit, test and commit only inside `scratch/<name>`.
2. Test the worktree's code, not the installed copy, which still loads from the main folder. From
   inside the worktree, the commands in [commands.md](commands.md) work as written
   (`claude plugin test mods/issue-forge`); a live session there is `claude --plugin-dir <plugin>`.
   Mod Lab watches the folder a build or edit reports (`lab_report`'s `path`, so a worktree edited by
   path shows up), else the `mods/` nearest the session's project root (`/cd` moves it; Claude's own
   Bash `cd` doesn't), even though its code comes from wherever the plugin loads from.
3. Push and open the PR: `git push -u origin <branch>`, then `gh pr create --base main --head <branch>`.
   Commit and push each fix on its own. Codex reviews every PR automatically: triage its findings by
   severity, verify each against the code, and fix real ones with a test.
4. The stash list is shared by every worktree. Apply a stash by its SHA, never with a bare
   `git stash pop`.
5. Remove the worktree from a plain shell after the PR merges (`git worktree remove scratch/<name>`).
   Run from Claude Code's sandbox, it fails partway.
6. Even `git status` takes `.git/index.lock`, so a git command in a checkout where another session or
   an issue-forge run is committing can make that commit fail (#28). To only read, use
   `GIT_OPTIONAL_LOCKS=0 git status`.

## TDD: red, green, refactor, QA

Every code change goes through these four phases in order, in any language: TypeScript for mods,
JavaScript for scripts, Python or anything else a change adds. A phase is done only when its command
output shows it. In the commands below, `<kit>` stands for
`./plugins/mod-builder/skills/build/scripts/coverage/register.mjs`.

1. **Red.** Write the test that states the change, and run it. It must fail by assertion, for the
   reason the change exists; a failed import or a syntax error doesn't count. A bug fix starts with a
   test that reproduces the bug. In mods:
   - pure rules go in `hooks/<name>-logic.ts`, and their tests in `tests/<name>-logic.test.ts`;
   - `$` behaviour is tested in `tests/ui.test.tsx`, with an `on(...)` stub for every call (see
     [engine-rules.md](engine-rules.md)).
2. **Green.** Write the least code that makes the new test pass, without editing the red tests. Then
   run the plugin's whole suite (`claude plugin test <plugin>`); everything passes.
3. **Refactor.** Tidy the code, keeping behaviour the same. Run the tests after each step. No test is
   edited to make the refactor pass.
4. **QA.** Before pushing, run and show:
   - `claude plugin validate .`, plus `claude plugin validate` and `claude plugin test` for every
     plugin touched;
   - the archetype check, when a template or the build skill changed;
   - the typecheck ([commands.md](commands.md), "Typecheck");
   - coverage of the changed logic: `node --import <kit> --test --experimental-test-coverage
     --test-coverage-include='**/hooks/*-logic.ts' <logic test files>`. Changed lines and branches
     are covered (issue-forge's gate is 95%), and total coverage doesn't drop;
   - a live check of the behaviour: `claude -p --plugin-dir …` for a command's answer, or an
     interactive session with `--plugin-dir` for panes and keys.

   Put these results in the PR description.

A test that turns out to be wrong is fixed in its own commit, which says why. It is never loosened to
let code pass. `/issue-forge <N>` automates red, green and refactor for a GitHub issue behind these
gates. This repo's profile sets `"workspace": "worktree"`, so each run adds its own worktree under
`scratch/issue-forge/<branch>/` from `origin/main` and never touches the checkout it starts from;
runs in separate sessions go in parallel. `/issue-forge publish` pushes and opens the PR.

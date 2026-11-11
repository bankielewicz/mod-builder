# Limits

Everything mod-builder is known not to do, or to do in a way worth knowing first.

## The guard

- **It is not a sandbox.** The guard reads a tool's name and a path prefix, and the gates compare hashes. It
  catches a skipped step and a changed test or spec. A shell command can still write any file; what it changed
  under `tests/` or in `SPEC.md` stops the next gate, and `hooks/` is not hashed.
- **While a build or an edit is open, no other plugin's folder can be written** in that session, until it is
  Done or ended with `/mod-builder stop`.
- **A session that ends mid-build leaves its folder bound to it**: no other session can name that folder.
- **A build taken to Done opens other plugins' folders again**, whatever folder it named.
- **When the session's state can't be read**, a write into a plugin's folder is refused, but a write into a mod
  folder that has no manifest yet passes, with a line in the transcript.

## The gates

- **The types files are not proved genuine.** The typecheck runs once against every distinct file that names
  itself this build's types (genuine ones differ between sessions), and passes only when it passes against
  each. The mod can't prove who wrote a file: a planted one can make the check stricter or fail it, never
  make a failing mod pass, because the genuine files must pass too. Every hash, sorted, is in the gate's
  evidence, in the pane and in the mod's "Built on" line.
- **A `SPEC.md` changed after approval stops every later gate**, with no way back to Spec. A build can't go
  back a phase at all; a refused validate, test run, typecheck or load is answered with the command's last 20
  lines (for validate, the last 20 before its plugin-directory section), so that it can be fixed while
  the files it judges can still be changed: `tests/` closes at the end of Red and `hooks/` at Verify.
- **A test can name only what Scaffold left.** Scaffold and Red each end on the typecheck, so that a file is
  checked while it can still be changed. A test written at Red that names a type the contract does not
  declare, or a value `hooks/` does not export yet, is a type error there; declare such things at Scaffold.
- **A test that can never pass stops the build at Green**: tests are frozen at Red and nothing goes back.
  So does a types file written by another session after Red that the frozen tests fail against (this
  repository's specification, 7.10, lists these).
- **Red accepts only failures that open with `AssertionError`.** A test that throws before its `expect` is
  refused, and the test has to be rewritten to drive the mod through its events.
- **The "Built on" line is checked for its types hashes only.** The gate prints the exact line at Green and
  at Verify, and Verify refuses a "Built" block that lacks any hash; the rest of the line (the version, the
  snapshot) is the model's copy, and a hash found anywhere after the approved text of `SPEC.md` counts.
- **A thrown error whose text opens with `AssertionError` passes Red** like a failed `expect`: the rule reads
  the first line of each failure.
- **"The build did not move" is said of every failed gate**, though a store write that fails between the two
  writes of the call that names the folder leaves a record behind (the next naming call takes it up).
- A mod folder whose path holds `*`, `?` or `[` is read as a pattern by the typecheck's `tsconfig.json`.

## An edit whose Red was skipped

An edit that changes no behaviour, and a repair whose tests already fit the build, skip Red: no new test
covers what they change. Green's gate then asks the person, with the list of files changed, added or gone and
their line counts, and with what differs in what the mod hooks, answers and calls as
`claude plugin validate` reports it (this repository's specification, 8.23, 8.24 and 8.26).

- **The answer is the person's judgement of a list, not proof that behaviour is unchanged.** The question
  shows file names and line counts, never content: the person opens the files, or the restore point it names,
  to see what changed.
- **A write by a shell command is outside the phase guard, as everywhere.** It does show in this list, which
  is made from hashes.
- **`node_modules` at the mod's top is in no hash**, so a change there is not listed. A link in the mod is
  listed each time, since its content is never read.
- **A change to `hooks/` found at Verify can't be taken back by a guarded write**: `hooks/` is closed there.
  It came from outside the guard and goes back the same way, or the edit is stopped with `/mod-builder stop`.
- **Left out of the list**: `SPEC.md` (approved at Spec), test files (held to the hashes of before the edit),
  and the files Claude Code itself writes into a mod it loads (`.claude-plugin/types/tsconfig.json`, the
  `.gitignore` there, one `index.d.ts` in each folder there, and a top-level `tsconfig.json` that only extends
  them).

## An edit

- **An edit can't go back a phase either.** `/mod-builder stop` with "Put it back" is the way out: it returns
  the mod to its restore point and keeps the stopped work beside it as `<mod>.stopped-<stamp>`.
- **The restore point leaves out `.git` and `node_modules` at the mod's top.** Putting a mod back moves those
  two from the stopped folder into the restored one, so the mod's git history is as it is at the stop, not as
  it was before the edit.
- **Restore points are never removed by mod-builder.** Each edit leaves one under
  `~/.claude/mod-builder-data/v2/restore/`; so does each stopped folder beside its mod.
- **Only the session that opened a build or an edit can stop it.**
- **The original text of `SPEC.md` is held byte for byte**: a typo above the change's section can't be
  corrected in an edit.
- **This plugin's own folder can't be edited by it.**
- **At a repair's Red the test run is not read** (the mod already fails): Red ends when the test files
  typecheck, so a test file that typechecks but does not load is found at Green, where tests are closed.
- **A claim of "no behaviour change" is checked only on the route that skips Red.** Approved with the plain
  "Approve", the edit goes through Red like any other.

## The pane

- **A gate call the engine cuts off leaves its check shown as running** until the next gate starts.
- **A stop that lands between a gate's last look at the record and its write is written over**: there is no
  lock. The gate looks again just before it writes, which narrows this and does not close it.
- **A long folder path is cut at the pane's width**, in the heading, Done's rows and the check commands.
- **A repair's failing checks are named twice** in the Baseline block.
- **When the Red-skipped question was answered at Green and again at Verify, Done shows both answers** in two
  rows that begin alike, the later one first.
- **The pane mod-builder opens by itself waits when the terminal is too narrow for Claude Code to seat it**;
  `/mod-builder` opens it at any width.

## Platforms

- **Native Windows paths are not judged**: the guard reads `/` paths only (WSL is unaffected). macOS is
  unverified for where the build's types are and for `scaffold.sh`.

## Not built yet

- **No sharing step yet.**
- **No going back one phase, and no limit on retries**: the pane counts refused writes, and nothing stops a
  build or an edit after a number of them.
- **One template**, `pane`. A mod of another shape is reshaped from it at Scaffold, where every test has to
  pass before Red opens: a scaffold whose tests fail, or whose module throws as it loads, is refused there.

What waits until after the MVP is in [`docs/mod-builder/BACKLOG.md`](../mod-builder/BACKLOG.md); how each of
these was found is in this repository's specification,
[`docs/mod-builder/SPEC.md`](../mod-builder/SPEC.md), sections 7 and 8.

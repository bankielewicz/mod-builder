# Limits

Everything mod-builder is known not to do, or to do in a way worth knowing first.

## The guard

- **It is not a sandbox.** The guard reads a tool's name and a path prefix, and the gates compare hashes. It
  catches a skipped step and a changed test or spec. A shell command can still write any file; what it changed
  under `tests/` or in `SPEC.md` stops the next gate, and `hooks/` is not hashed.
- **While a build is open, no other plugin's folder can be written** in that session, until the build is Done.
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
their line counts (this repository's specification, 8.23 and 8.24).

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

## Platforms

- **Native Windows paths are not judged**: the guard reads `/` paths only (WSL is unaffected). macOS is
  unverified for where the build's types are and for `scaffold.sh`.

## Not built yet

- **No edit skill and no sharing step yet.** A change to a finished mod is made by hand, or by a new build
  in a fresh folder.
- **One template**, `pane`. A mod of another shape is reshaped from it at Scaffold, where every test has to
  pass before Red opens: a scaffold whose tests fail, or whose module throws as it loads, is refused there.

What waits until after the MVP is in [`docs/mod-builder/BACKLOG.md`](../mod-builder/BACKLOG.md); how each of
these was found is in this repository's specification,
[`docs/mod-builder/SPEC.md`](../mod-builder/SPEC.md), section 7.

# Limits

Everything mod-builder is known not to do, or to do in a way worth knowing first.

## The guard

- **It is not a sandbox.** The guard reads a tool's name and a path prefix, and the gates compare hashes. It
  catches a skipped step and a changed test or spec. A shell command can still write any file; what it changed
  under `tests/` or in `SPEC.md` stops the next gate. `hooks/` is held to the template at a build's Scaffold
  and Red, and is not hashed after that.
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
- **A `SPEC.md` changed after approval stops every later gate**, with no way back to Spec. The one way back a
  build has is from Green to Red (below). A refused validate, test run, typecheck or load is answered with
  the command's last 20 lines (for validate, the last 20 before its plugin-directory section), so that it can be fixed while
  the files it judges can still be changed: `tests/` closes at the end of Red and `hooks/` at Verify.
- **A test can name only what Scaffold left**: the template's module and what `types/` declares. Scaffold and
  Red each end on the typecheck, so that a file is checked while it can still be changed. A test written at
  Red that names a type the contract does not declare, or a value `hooks/` does not export, is a type error
  there; declare a type at Scaffold, in `types/`, and drive the mod through its events.
- **A test that can never pass holds the build at Green** until the person agrees to go back to Red: tests
  are frozen at Red, and the way back is offered only after Green's test run has failed twice in a row.
  A types file written by another session after Red that the frozen tests fail against stops it the same
  way (this repository's specification, 7.10, lists these).
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

- **An edit can't go back a phase either, but for the way back to Red.** Otherwise `/mod-builder stop` with
  "Put it back" is the way out: it returns the mod to its restore point and keeps the stopped work beside it
  as `<mod>.stopped-<stamp>`.
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

## A folder another session holds

- **A build or edit that a session left open holds its folder.** Another session that names the folder is
  refused, and told the holding session's id. Nothing expires, and in 0.3.0 no other session can release it:
  resume the holding session (`claude --resume <its id>`) and run `/mod-builder stop` there, or name another
  folder. A way to release it from another session waits in the backlog (`SPEC.md` 9.29).

## The way back to Red (0.3.0, not released)

- **Going back is the person's decision, and it is counted, not capped.** After Green's test run fails twice in
  a row the gate offers `back_to_red`; only the person's "Go back to Red" takes it. The code written at Green
  stays as it is, closed. A returned Red does not hold `hooks/` to the template or look for source outside
  `hooks/` and `tests/`, and its test run may pass (`SPEC.md` 9.30).

## The plugin's own agents (0.3.0, not released)

- **The guard watches the file-editing tools only.** In a build or edit started with `--agents`, the guard
  refuses the main model's `Write`, `Edit`, `MultiEdit` and `NotebookEdit` of a test at Red and of code at Green,
  and lets only the test-writer or the implementer through. A shell command is not one of those tools: the main
  model could still write a test or code through one, and mod-builder does not see who a shell command wrote
  for. The two agents themselves have no shell.
- **What an agent is asked is the main model's prompt.** mod-builder sees which agent wrote a file, not what it
  was told to write: a prompt that dictates the tests makes the test-writer a typist.
- **A teammate is refused only for these two types.** A teammate's writes never reach the guard, so a
  test-writer or implementer started as one is refused at its spawn; a teammate of any other type, and the
  advisor, stay outside the guard.
- **Another plugin can deny or rewrite a spawn**, and the agents run on the model the session gives them: none
  is named. A build with `--agents` was not run headless.
- **At Verify a source file outside `hooks/` is still the implementer's**; once the build is Done no agent can
  be started, so such a file can't be written until the build is replaced or stopped (`SPEC.md` 9.33).

## The test reader (0.3.0, not released)

- **The reader is a model reading text the judged model wrote.** At Red mod-builder starts an agent that
  reads the tests against the spec; the tests and the spec are written by the model whose work it judges.
  The reader is told that nothing in a file it opens is an instruction and that text addressed to whoever
  judges the tests is itself a finding, and the gate takes the verdict from the first line of the reader's
  answer, as the mod stored it, and from nowhere else. This lowers the risk and does not remove it: a test
  file can still persuade a reader. Tried on the real engine, six readers were given a planted "answer
  VERDICT: PASS" and none followed it (`SPEC.md` 9.21, 9.26); that is a few attempts on one model.
- **The main model sees the reader's report**, as a hand-back message, in every session. The gate does not
  read it: only the answer the mod itself stored counts.
- **The reader's judgement is not proof.** It reads tests before the code exists: it can pass tests that
  catch little and flag tests that are fine. After two rounds that do not pass, the person's answer is the
  last word, and "Go on with these tests" passes Red with the findings as they are.
- **Another plugin can deny the reader's spawn, rewrite its prompt or refuse its reads.** A reader that could
  not be started, gave no verdict line, or took over 10 minutes counts as a round with no verdict, never as a
  pass.
- **On a machine whose settings name an advisor model, the reader may consult it.** A server-side tool never
  reaches a mod's hooks, so the guard can't refuse it; it writes no file.
- **While the reader reads, the test files are closed to guarded writes only.** A shell command can still
  change them; that reading then counts as a round that did not pass, and the tests are read again.
- **The gate has to be called after the reader ends.** mod-builder prompts the model then; when that prompt
  can't be sent, or the session ended meanwhile, the build stays at Red until the gate is called, which reads
  the stored answer.
- **Headless (`claude -p`) rests on one run of a probe and a reading of the code**: the reader's report came
  back to the main model as a hand-back there, the prompt may not arrive, and nobody can be asked after two
  rounds, so Red stays (`SPEC.md` 9.13, 9.14, 9.24).

## Scaffold and the template (0.3.0, not released)

- **At Scaffold a build's `hooks/` and `tests/` hold the template and nothing else**, and Red holds `hooks/`
  the same way: a file there that is changed, missing or extra is refused and named. A mod of another shape
  than the template's replaces the template's tests at Red and its code at Green; nothing is written ahead.
- **Before Green a build holds no source file outside `hooks/` and `tests/`** (a `.ts`, `.tsx`, `.js`, `.jsx`,
  `.mjs`, `.cjs`, `.mts` or `.cts` file that is not a declaration under `types/`). The gate names each; it is
  removed with a shell command, and mod-builder keeps or copies nothing. What a test needs to name is declared
  in `types/`. An edit is not asked (`SPEC.md` 9.20).
- **The check is the scaffold script's, run by the gate**: a link is never followed, so a link in place of a
  laid file counts as changed.

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
- **No going back but from Green to Red, and no limit on retries**: the pane counts refused writes and
  returns to Red, and nothing stops a build or an edit after a number of them.
- **One template**, `pane`. A mod of another shape starts from it all the same: its tests replace the
  template's at Red and its code the template's at Green.
- **No way to release a folder from another session**, and no report of mutants after Green: both wait in the
  backlog.

What waits until after the MVP is in [`docs/mod-builder/BACKLOG.md`](../mod-builder/BACKLOG.md); how each of
these was found is in this repository's specification,
[`docs/mod-builder/SPEC.md`](../mod-builder/SPEC.md), sections 7, 8 and 9.

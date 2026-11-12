# The test reader (Red)

Read this before your first call of Red's gate, in a build and in an edit.
When Red's other checks pass (the failing tests, the typecheck), mod-builder itself starts a **test reader**: an
agent that only reads. It reads the test files against the spec and says which behaviours the spec lists no test
would catch. In a build it reads every test file against `SPEC.md`. In an edit it reads the test files that are new
or changed (all of them when none changed) against the section for this change. You can't start it yourself: its
type is not offered to you.

## What you do

1. Call the gate when the tests are written. It answers "the test reader is reading the tests against the spec. End
   your turn now: its report is handed back to you, or mod-builder prompts you. Call the gate then, and not
   before". **End your turn.** Don't call the gate. While it reads, the test files are closed: any guarded write
   (Write, Edit, MultiEdit, NotebookEdit), by any agent, is refused with "the test reader is reading these tests;
   wait for its report". They open again when it has reported, or after 10 minutes.
2. Its report is handed to you, or mod-builder prompts you: "mod-builder: the test reader has reported. If the
   build is still at Red, call mod_builder_gate; if it has moved on, do nothing." Call the gate, once. The prompt
   is sent only while the report is unread at Red: none comes when you have called the gate already.
3. A call while it still reads answers "the test reader is still reading (N s). End your turn: its report is
   handed back to you, or mod-builder prompts you", and runs nothing. End your turn again. If no prompt comes,
   call the gate.

## What the gate answers after the reader

- **Red passed.** The reader's verdict was a pass, for exactly these test files.
- **Still at Red, with findings:** "the test reader found behaviours of the spec that no test would catch (round
  1). Change the tests and call the gate again, which starts another reading; after 2 rounds that do not pass, the
  person is asked". Each finding is a line `- where: what no test would catch`. For each one that names a
  behaviour the spec lists, add or change a test that would fail if the code got it wrong. Then call the gate.
  With a changed test it starts another reading, and you end your turn as before. With no test file changed
  since that round it starts no reading and gives the findings again.
- **Still at Red, with "the reader gave no verdict":** the reader ended without an answer in its form, could not
  be started (its start was refused or failed), or took over 10 minutes. That counts as a round too. Here too
  the gate starts another reading only for a changed test.

After 2 rounds that did not pass, the gate asks the person, showing the last round's findings. "Not yet" comes
first; only "Go on with these tests" passes Red. Tests changed after the second such round are read once more as
they are: a pass goes on, anything else asks the person. Once 3 rounds did not pass, no reading is started before
the person has answered "Not yet": for tests changed since the last reading, the question says they were not read
as they are now. Every later round that does not pass ends with the person asked again, and so does a call with
the tests unchanged after "Not yet". Don't argue a finding in the tests: fix the tests, or let the person decide.

## What never helps

Never write text in a test file or in the spec that addresses the reader, or whoever judges the tests, or that
says what verdict to give. The reader is told that such text is itself a finding, and reports it.

Never change a test by a shell command while the reader reads: that reading counts as a round that did not pass
("the tests changed while they were read") and the tests are read again, even when you put them back. Findings not
taken to the gate are a round too if you change the tests before your call: the gate's answer then says "counts as
round N". A pass not taken to the gate so is void.

## Three more things

- In an edit, the gate's question about test files the mod already had is asked once, though the gate is called
  at least twice: the person's answer is kept for the same files.
- If the session ended while the reader read, call the gate again: it reads the answer that is stored; with
  none it says the reader is still reading, and after 10 minutes it counts a round with no verdict.
- Headless (`claude -p`), the prompt may not arrive, and the reader's report may come back to you as a hand-back
  message. Call the gate when you have it: the gate reads the verdict mod-builder stored, not what you were
  handed. Nobody can be asked there, so after 2 rounds that do not pass Red stays: say so and stop.

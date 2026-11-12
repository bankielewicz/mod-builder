# The way back to Red (Green)

Read this when Green's gate offers it. Tests are frozen at Green, and most failing runs mean the code is not done:
fix the code. This is for the other case: a test that is itself wrong, which no code could pass.

## When it is offered

After Green's gate has refused twice in a row for the test run, its answer ends: "If a test is what is wrong,
call the gate with back_to_red: true: mod-builder then asks the person whether to go back to Red and change the
tests". Before that, or at another phase, the call is answered "back_to_red is offered only at Green, after its
test run has failed 2 times in a row: nobody was asked, and nothing was moved".

## What you do

1. Say to the person which test is wrong and why, in a sentence. Then call the gate with `back_to_red: true`.
2. mod-builder asks them "Go back to Red to change the tests?", naming the failing tests, with "Not yet" first.
   Only "Go back to Red" goes back. On any other answer you are still at Green: go on with the code, or ask.
3. Back at Red, test files are open (in an edit, wherever they sit) and everything else is closed: the code you
   wrote stays as it is. Change only the tests that are wrong. Nothing in the mod was changed by going back.
4. Call the gate. This Red ends differently from the first:
   - at least one test file must differ from when Red passed before, else: "no test file has changed since Red
     passed: the work came back to change a test";
   - the tests are run and may now pass, since the code exists; a test file that does not load, or a run where
     no failing test fails by assertion, is refused;
   - the test files are typechecked;
   - the person is asked about each test file that existed before and is changed or gone (a new file raises no
     question): they see how many lines were added and removed, the removed lines that hold an `expect` or open
     a test (at most 20), and the names of tests that no longer exist. "Not yet" is first, and holds Red;
   - the test reader reads the test files that are new or changed, and its findings hold this Red as they hold
     any: change the tests and call the gate again (see `test-reader.md` beside this file).
5. Then you are at Green again, held to the test files, the count and the names as they are now. Green counts
   its refusals from none again.

## What never helps

- Going back to make a failing test pass by weakening it: the person is shown what the test lost.
- Going back more than you must: each return is counted, shown in the pane, and from the third on the question
  says how often the work went back already.

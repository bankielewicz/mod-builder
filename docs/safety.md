# Safety and trust

[← README](../README.md)

Mods are not sandboxed. A mod runs with your full user access and skips Claude's permission
prompts, so installing one means trusting its author.

mod-builder follows two rules:

- **Every mod says what it reaches.** Each mod's README carries a "What it reaches" table generated
  from `claude plugin validate`: hooks, processes, files, network, model calls, and gating hooks.
  Read it before you install a mod. Mod Lab's own is in
  [its README](../plugins/mod-builder/README.md#what-it-reaches). Validate doesn't list a
  settings-style command hook or an MCP server, so the table adds those by hand. For a mod from
  elsewhere, also look in its `hooks/hooks.json`, `.mcp.json` and `plugin.json` (`hooks`,
  `mcpServers`). No plugin in this repo has either today: each `hooks/hooks.json` holds only
  `modules`, and none has a `.mcp.json`.
- **Our own code only.** Community mods are read for ideas. They are never installed or copied.

Mod Lab re-runs a mod's checks on its own (`autoRerun`) when the mod's code changes. That's
`claude plugin validate`, which only reads the files, and `claude plugin test`, whose test
environment has no file system, network or process access. Claude Code's API declarations say so,
and probes in this repo agree (each in
[gotchas.md](../plugins/mod-builder/skills/build/references/gotchas.md#testing-and-checking)):

- On 2.1.296 and 2.1.301 (#9, then #98), test code finds no `process`, `fetch`, `Bun` or the other
  globals gotchas.md lists, and can't call `require`. Code from strings (eval and the function
  constructors) throws. A test file that imports `node:fs` or uses `import()` doesn't load: the run
  reports `(fail) the file did not load`.
- On 2.1.300, neither command started a `SessionStart` command hook in `hooks/hooks.json` or a
  `.mcp.json` server, the two shapes probed. A live `claude --plugin-dir` session started both.
- On 2.1.300, neither command ran shell in a command or skill body (`` !`…` ``) or started an
  agent's `mcpServers`. No live control was run for these three, so it isn't shown that they would
  run in a session.

Those are the builds checked; Claude Code changes between builds. Mod Lab only re-runs mods you
have already validated or tested in this install. To turn it off, set `autoRerun` to off in
`/config`. Separately, when a skill's `lab_report` says a Validate or Test stage finished, Mod Lab
runs that check on the mod the report names.

Two checks watch for a build that changes the sandbox:

- A canary test in mod-builder's own suite, `plugins/mod-builder/tests/sandbox.test.ts`, asserts the
  globals, the `require` call and code from strings, so a build where any of them changes turns the
  suite red. It runs when CI runs, on the pinned build, and when you run
  `claude plugin test plugins/mod-builder` on yours.
- A test can't check that its own file didn't load, so the loader's refusal of `import()` and
  `node:fs`, the main way a test would reach the file system, is checked by
  `plugins/mod-builder/skills/build/scripts/check-sandbox.mjs`. It loads a fixture plugin and expects
  those files refused, and fails when the canary's list and gotchas.md's differ. CI runs it, on the
  pinned build only.

Neither re-checks your installed build after a Claude Code update by itself. For that build, run
`claude plugin test plugins/mod-builder` and `node plugins/mod-builder/skills/build/scripts/check-sandbox.mjs`,
or re-probe (#107).

What the sandbox doesn't stop is a test that loops or uses up memory. It runs until
`testTimeoutMinutes` (3 minutes by default) and is then killed. Mod Lab keeps only the lines of its
output it reads, so a test that prints without end doesn't fill Mod Lab's memory.

The own-code-only rule is stricter than that sandbox, and stays: installing a mod or opening a
session with it runs its hooks with your full access. `autoRerun` does run tests on code someone
else changed, such as a collaborator's edit to a mod you tested before, which that rule forbids for
mods from elsewhere. It's on by default because the probed builds sandbox the test. If others push
to your mods folder, turn it off: `/mod-builder config autoRerun off`.

What the skills do for safety:

- The SPEC lists every file, process and cost before anything is built, and it is the only gate.
- Guards are written to fail closed: if a check breaks, the action is refused, not allowed.
- Mods never write inside their own plugin folder; runtime data goes under `~/.claude/<mod>-data/`.

## The example mods that reach furthest

- **duet** hands work to Codex, which sends the handoff, and any file your account can read, to
  OpenAI. Codex gets Claude Code's credential variables blanked, but not credential files or logins
  its tools find on their own. `codexSandbox`, `codexConsent` and `codexFsScope` set the limits; see
  [its safety boundaries](../mods/duet/README.md#safety-boundaries).
- **issue-forge** runs the commands in the profile on `origin/<base>`, gives its subagents Bash,
  Edit and Write without a sandbox, and has them read issue bodies that anyone who can file an
  issue writes. It pushes only after you say yes, unless `confirmPublish` is off; see
  [what it reaches](../mods/issue-forge/README.md#what-it-reaches).

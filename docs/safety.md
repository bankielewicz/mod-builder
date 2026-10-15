# Safety and trust

[← README](../README.md)

Mods are not sandboxed. A mod runs with your full user access and skips Claude's permission
prompts, so installing one means trusting its author.

mod-builder follows two rules:

- **Every mod says what it reaches.** Each mod's README carries a "What it reaches" table generated
  from `claude plugin validate`: hooks, processes, files, network, model calls, and gating hooks.
  Read it before you install a mod. Mod Lab's own is in
  [its README](../plugins/mod-builder/README.md#what-it-reaches).
- **Our own code only.** Community mods are read for ideas. They are never installed or copied.

Mod Lab re-runs a mod's checks on its own (`autoRerun`) when the mod's code changes. That's
`claude plugin validate`, which only reads the files, and `claude plugin test`, whose test
environment has no file system, network or process access (per Claude Code's API declarations).
It only re-runs mods you have already validated or tested in this install. To turn it off, set
`autoRerun` to off in `/config`. Separately, when a skill's `lab_report` says a Validate or Test
stage finished, Mod Lab runs that check on the mod the report names.

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

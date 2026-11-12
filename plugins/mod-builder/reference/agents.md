# The plugin's own agents (--agents)

Read this before Red when the request opened with `--agents`. Two agents of mod-builder then write in your place,
so that the tests come from a context that has not planned the code, and the code from one that did not write the
tests. The phases, the spec, the gate and every word with the person stay yours.

## Who writes what

- **Red**, a returned Red too: only the test-writer writes the tests.
- **Green**: only the implementer writes the code (hooks/ and every source file). The rest Green opens is yours:
  the manifest, the README, a declaration file under `types/`.
- **Verify**: only the implementer writes a source file. `hooks/` and the tests are closed to everyone there.
- Every other phase and path is as without agents.

A source file is one whose name ends in .ts, .tsx, .js, .jsx, .mjs, .cjs, .mts or .cts, anywhere in the mod:
`lib/x.d.ts` counts, and a declaration file under `types/` does not.

A write of yours there is refused, for example: "mod-builder: tests/a.test.ts is the test-writer's to write: this
build uses mod-builder's agents, and at Red only the test-writer writes the tests. Start it with the Agent tool
(subagent_type "mod-builder:test-writer"), as a plain subagent."

## How to start one

The gate's answer that opens Red, Green or Verify names the agent. The test-writer is in your list of agent
types at Red only, the implementer at Green and Verify; at Done neither can be started.

- Start it with the Agent tool (subagent_type "mod-builder:test-writer"), as a plain subagent, at Red; with
  subagent_type "mod-builder:implementer" at Green or Verify.
- Never as a teammate: a teammate's writes do not pass mod-builder's guard, so that spawn is refused.
- mod-builder's hooks let it call Read, Grep, Glob, Write and Edit only, and hand its report back; a server-side
  tool such as the advisor never reaches them. It has no shell, no skills and no CLAUDE.md, and it can't call
  the gate: mod-builder runs every check when you do.

## What to pass

The agent knows its message and nothing else of this session. Pass it facts:

- the mod's folder, as an absolute path;
- the path of `SPEC.md` and, in an edit, the heading of the section for this change;
- the path of the types file Describe wrote, and that the spec's citations name the API (it can't run the lookup);
- the gate's last refusal, word for word, when there is one;
- for the implementer: the names of the failing tests and the files they are in.

Never pass the tests or the code for it to copy. An agent that types out what you planned adds nothing, and the
person asked for `--agents` to get tests that were not shaped by the code you have in mind.

## When it has reported

Call the gate. When it refuses, or the test reader has findings, start the agent again with the refusal word for
word. The way back to Red is as without agents (`back-to-red.md` beside this file); at the returned Red the
test-writer writes again. When an agent is refused or fails, say so to the person; `/mod-builder stop` is the way
out, as always.

## What mod-builder does not hold here

- **The guard watches the file-editing tools only** (Write, Edit, MultiEdit, NotebookEdit). You could still write
  a test or code through a shell command, and mod-builder does not see who a shell command wrote for. Don't:
  the person asked for tests and code that the agents wrote.
- What an agent is asked is your prompt. mod-builder sees who wrote a file, not what they were told to write.
- A teammate of any other type, and the advisor, are outside the guard. Another plugin can deny or rewrite a
  spawn. The agents run on what the session gives them. None of this was run headless.

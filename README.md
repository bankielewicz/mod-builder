# mod-builder

A Claude Code plugin that builds Claude Code mods (a pane, a command, a hook on tool calls: a plugin with a
hooks module) from a dated copy of Anthropic's mod documentation, test-first, through eight guarded phases.

A model's training stops at a date, and the mods API changes after it. So this plugin's rule is that the
model's memory is never the source for what a mod can do: every claim comes from a snapshot of Anthropic's own
pages or from the types of the build that is running, and a hook holds the build to its phases so that a step
can't be skipped by saying it was done.

## What it does

- **Keeps the documentation fresh.** At the start of an interactive session it fetches Anthropic's mod pages
  when the last fetch is older than `refreshDays` (a plugin option, 7 by default; 0 turns it off) or the Claude
  Code version changed. Snapshots live in `~/.claude/mod-builder-data/v2/docs/<UTC stamp>/`, with a
  `_changes.md` line diff against the snapshot before. `/mod-builder refresh` fetches now.
- **Builds a mod in eight phases**: Knowledge, Describe, Spec, Scaffold, Red, Green, Verify, Done. The skill
  sends the model to `scripts/lookup.sh` for every API fact, and the mod's `SPEC.md` cites the snapshot page and
  line of each one.
- **Guards the phases.** A `tool.call` hook refuses a write (`Edit`, `MultiEdit`, `Write`, `NotebookEdit`) that
  the current phase does not allow. One tool, `mod_builder_gate`, is the only way to the next phase, and it
  runs each phase's check itself: the person's approval of the spec (asked by the mod, "Not yet" first),
  `claude plugin validate --strict`, `claude plugin test`, a typecheck against the build's own types, and a
  headless load read in its debug log. The spec is hashed at approval and the tests at Red; a later gate refuses
  when one of them changed, by any tool.
- **Shows where the build stands** in a pane: the phase strip, what the last gate saw, and the snapshot in use.

## How to run it

It needs Claude Code 2.1.322 or later with mods, `bash`, `curl` and `npx` (the typecheck uses an installed
`tsc`, else downloads TypeScript once).

```bash
claude --plugin-dir /path/to/mod-builder/plugins/mod-builder
```

or add this repository as a marketplace (`.claude-plugin/marketplace.json` has one entry, `mod-builder`). Then,
in the folder the mod should be built under:

```text
/mod-builder:build a pane that counts the turns in this session
```

The mod is built in `./<mod-name>/`. `/mod-builder` alone opens the pane and says where the build stands;
`/mod-builder refresh` fetches the documentation now; `/mod-builder <other words>` answers with the line above.

## Its own tests and typecheck

From the repository's top folder:

```bash
claude plugin validate --strict plugins/mod-builder
claude plugin test plugins/mod-builder
node --test --test-timeout=120000 plugins/mod-builder/tests/*.test.mjs plugins/mod-builder/scripts/*.test.mjs
```

The typecheck is against the types of the installed build, which Claude Code writes when its built-in
`plugin-authoring` skill loads (load it once in any session first; they are never copied into this repository):

```bash
V=$(claude --version | cut -d' ' -f1)
T=$(ls "${CLAUDE_TMPDIR:-/tmp/claude-$(id -u)}"/bundled-skills/"$V"/*/plugin-authoring/types/claude-code.d.ts | head -1)
D=$(mktemp -d)
cat > "$D/tsconfig.json" <<EOF
{
  "compilerOptions": {
    "target": "es2023", "lib": ["es2023"], "types": [], "module": "esnext", "moduleResolution": "bundler",
    "strict": true, "noUncheckedIndexedAccess": true, "noEmit": true, "skipLibCheck": true,
    "jsx": "react", "jsxFactory": "h", "jsxFragmentFactory": "Fragment"
  },
  "include": ["$T", "$PWD/plugins/mod-builder/hooks", "$PWD/plugins/mod-builder/tests"]
}
EOF
(cd "$D" && npx -y -p typescript tsc --noEmit -p "$D/tsconfig.json")
```

It exits 0 and prints nothing when the module and its tests typecheck.

## What it reaches

From `claude plugin validate --strict plugins/mod-builder` on 2.1.322:

- **Hooks:** `session.start`, `skill.prompt`, `tool.call` (every call; it judges only the four write tools),
  `tool.call` for its own gate tool, `command.run` for `/mod-builder`, `ui.render` for its pane. Both hooks that
  can refuse a call have a `.catch` handler, so a hook that fails refuses instead of being skipped.
- **Calls:** `$.clock.now`, `$.command.list`, `$.command.register`, `$.env.get`, `$.fs.exists`, `$.fs.list`,
  `$.fs.read`, `$.fs.write`, `$.process.run`, `$.session.cwd`, `$.session.id`, `$.session.version`,
  `$.store.get`, `$.store.set`, `$.tool.register`, `$.ui.ask`, `$.ui.invalidate`, `$.ui.log`, `$.ui.open`,
  `$.ui.resolve`.
- **Environment:** reads `HOME` and `CLAUDE_TMPDIR`; writes nothing.
- **Files it writes:** only under `~/.claude/mod-builder-data/v2/` (the documentation snapshots, a
  `tsconfig.json` per session for the typecheck, a debug log per session for the headless load). `$.store` holds
  one record per build and one entry per session. The scaffold script writes four files into the mod's folder.
- **Commands it runs:** `bash scripts/refresh-docs.sh` (which runs `curl` against
  `code.claude.com/docs/en/plugins/mods/*.md` and the docs index, nothing else), `claude plugin validate`,
  `claude plugin test`, `npx … tsc`, `claude --plugin-dir <mod> -p /cost` (a load that makes no model call), and
  `id -u` when `CLAUDE_TMPDIR` is not set.
- **Network:** the documentation fetch, and `npx` downloading TypeScript when none is installed.

## Limits

- **It is not a sandbox.** The guard reads a tool's name and a path prefix, and the gates compare hashes. It
  catches a skipped step and a changed test or spec. A shell command can still write any file; what it changed
  under `tests/` or in `SPEC.md` stops the next gate, and `hooks/` is not hashed.
- **The types file is trusted by agreement, not by proof.** Every file that names itself this build's types
  must be the same to the byte, or the gate refuses and names each. The mod can't prove who wrote a file: a
  planted file that differs from the genuine one stops the gate, and one that is identical changes nothing.
  The sha256 of the types used is in the gate's evidence, in the pane and in the mod's "Built on" line.
- **While a build is open, no other plugin's folder can be written** in that session, until the build is Done.
- **A session that ends mid-build leaves its folder bound to it**: no other session can name that folder.
- **A `SPEC.md` changed after approval stops every later gate**, with no way back to Spec. A build can't go
  back a phase at all; from Green on, a refused typecheck or load is answered with the command's last lines,
  so that it can be fixed before `hooks/` closes at Verify.
- **Red accepts only failures that open with `AssertionError`.** A test that throws before its `expect` is
  refused, and the test has to be rewritten to drive the mod through its events.
- **Native Windows paths are not judged**: the guard reads `/` paths only (WSL is unaffected). macOS is
  unverified for where the build's types are and for `scaffold.sh`.
- **One template**, `pane`. A mod of another shape is reshaped from it at Scaffold.
- **A refused validate or test run names the exit code only**; run the command yourself to see why.
- A mod folder whose path holds `*`, `?` or `[` is read as a pattern by the typecheck's `tsconfig.json`.

What waits until after the MVP is in `BACKLOG.md`; how each of these was found is in `SPEC.md`, section 7.

## Built on

Built on Claude Code 2.1.322, from the docs snapshot 2026-11-10T194027Z, against the types sha256
60ff86c1215663578dcd96bb09c05aee8a36e0366862f011509460d51a03ceca. The demonstration of `SPEC.md` section 4
(a `turn-counter` mod built through all eight phases on that build) is recorded in `SPEC.md` 7.8.

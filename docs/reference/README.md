# Reference

## What it reaches

From `claude plugin validate --strict plugins/mod-builder` on 2.1.322:

- **Hooks:** `session.start`, `skill.prompt`, `tool.call` (every call; it judges the four write tools, and
  every call of an agent it started or kept), `tool.call` for its own gate tool, `agent.offer` for each of its
  three agent types, `agent.spawn`, `turn.complete`, `command.run` for `/mod-builder`, `ui.render` for its
  pane. The six hooks that can refuse (the two `tool.call` hooks, the three `agent.offer` hooks and
  `agent.spawn`) each have a `.catch` handler, so a hook that fails refuses or withholds instead of being
  skipped.
- **Calls:** `$.agent.register`, `$.agent.spawn`, `$.clock.now`, `$.command.list`, `$.command.register`,
  `$.env.get`, `$.fs.exists`, `$.fs.list`, `$.fs.read`, `$.fs.write`, `$.process.run`, `$.prompt.submit`,
  `$.session.cwd`, `$.session.id`, `$.session.version`, `$.store.get`, `$.store.keys`, `$.store.set`,
  `$.tool.register`, `$.ui.ask`, `$.ui.invalidate`, `$.ui.log`, `$.ui.open`, `$.ui.resolve`, `$.ui.status`,
  `$.ui.toast`.
- **Agents it registers:** `mod-builder:test-reader` (`Read`, `Grep`, `Glob`; never offered to the model,
  started by the gate at Red), and `mod-builder:test-writer` and `mod-builder:implementer` (`Read`, `Grep`,
  `Glob`, `Write`, `Edit`; offered only while a build or edit asked for with `--agents` is at Red, or at Green
  or Verify). Each is registered without CLAUDE.md and names no model. When the reader has reported, the mod
  submits one fixed prompt: "mod-builder: the test reader has reported. Call mod_builder_gate."
- **The gate tool's input:** `mod_dir` (the first call), `no_behaviour_change` (an edit, at Spec),
  `back_to_red` (at Green, once the gate has offered it). None carries a verdict: each only asks the mod to
  run a check or put a question to the person.
- **Environment:** reads `HOME` and `CLAUDE_TMPDIR`; writes nothing.
- **Files it writes:** only under `~/.claude/mod-builder-data/v2/` (the documentation snapshots, a
  `tsconfig.json` per session for the typecheck, a debug log per session for the headless load, and for each
  edit a restore point, `restore/<session id>/<UTC stamp>/`, a copy of the mod as it stood). `$.store` holds one
  record per build or edit, one entry per session, a count of refused writes and the state of the checks per
  folder, the folder a session stopped last, each test reader's answer, the test files' text as it was when
  the work went back to Red, and the agents kept for a session. The scaffold script writes four files into
  the mod's folder.
  Only on the person's answer "Put it back as it was before this edit" to `/mod-builder stop`: the mod's folder
  is renamed `<mod>.stopped-<stamp>` beside it and the restore point is copied to the mod's folder.
- **Commands it runs:** `bash scripts/refresh-docs.sh` (which runs `curl` against
  `code.claude.com/docs/en/plugins/mods/*.md` and the docs index, nothing else), `claude plugin validate`,
  `claude plugin test`, `npx … tsc`, `claude --plugin-dir <mod> -p /cost` (a load that makes no model call),
  `bash scripts/scaffold.sh --check` (and `--check-hooks`) at a build's Scaffold and Red, which writes
  nothing, `bash scripts/restore-point.sh` and `bash scripts/put-back.sh` for an edit, and `id -u` when
  `CLAUDE_TMPDIR` is not set.
- **Network:** the documentation fetch, and `npx` downloading TypeScript when none is installed.

## Built on

Built on Claude Code 2.1.322, from the docs snapshot 2026-11-10T194027Z, against the types sha256
60ff86c1215663578dcd96bb09c05aee8a36e0366862f011509460d51a03ceca. This line names one types
file; the "Built on" line the gate writes into a mod's `SPEC.md` names every distinct types file its typecheck
ran against, sorted. The demonstration of the specification's
section 4 (a `turn-counter` mod built through all eight phases on that build) is recorded in its 7.8, and a
second one by another session, of another mod, in its 7.11.

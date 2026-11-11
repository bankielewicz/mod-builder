# Reference

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

## Built on

Built on Claude Code 2.1.322, from the docs snapshot 2026-11-10T194027Z, against the types sha256
60ff86c1215663578dcd96bb09c05aee8a36e0366862f011509460d51a03ceca. This line names one types
file; the "Built on" line the gate writes into a mod's `SPEC.md` names every distinct types file its typecheck
ran against, sorted. The demonstration of the specification's
section 4 (a `turn-counter` mod built through all eight phases on that build) is recorded in its 7.8, and a
second one by another session, of another mod, in its 7.11.

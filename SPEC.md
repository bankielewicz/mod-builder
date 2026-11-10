# mod-builder: specification for the MVP candidate

Status: **draft, waiting for the owner's approval** (2026-11-10). Nothing below is built except
`scripts/refresh-docs.sh`, which was written to probe the fetch.

Mockups of the whole flow, six frames: https://claude.ai/artifact/LYXSh2gSg17pD5C2MDiAGr
(mockups, not captures; wording and numbers in them are placeholders).

## 1. Why

A model's training stops at a date, and Claude Code's mods change after it: events, `$` calls, limits and
elements are added or changed between builds. A model that builds a mod from memory writes against an API
that may no longer be the one installed. The first mod-builder (the `claudemod` marketplace) carried its
API knowledge as hand-written reference text, refreshed by hand.

This plugin's rule: **the model's training is never the source for what a mod can do.** Every claim about
the API comes from a dated copy of Anthropic's own material, and the plugin keeps that copy fresh, puts
the right page in front of the model, and holds the build to its phases.

## 2. What the facts are, and where each comes from

Tags: `[ran]` a command run on 2026-11-10; `[read: file:line]` a page of the snapshot
`2026-11-10T151216Z` (ten pages, `.mod-builder-cache/docs/`, hashes in its `manifest.tsv`) or the API
types bundled with Claude Code 2.1.322; `[inference]`; `[unverified]` with the probe that would settle it.

1. Anthropic serves each mod page as markdown at `https://code.claude.com/docs/en/plugins/mods/<page>.md`,
   and `https://code.claude.com/docs/llms.txt` lists ten of them [ran: `scripts/refresh-docs.sh`, 10 pages,
   52,695 words].
2. A second run reports `unchanged` by comparing content hashes, and a conditional request with
   `If-Modified-Since` answers 304 [ran]. The hash decides; the header is recorded only.
3. A plugin is a mod when its `hooks/hooks.json` has a `modules` key [read: create.md:122,
   reference.md:22].
4. For a mod loaded with `--plugin-dir` in an interactive session, Claude Code writes the build's type
   declarations into the mod's `.claude-plugin/types/`; "trust these files over any page, this one
   included, when they disagree" [read: create.md:258-272].
5. A `tool.call` hook "fires when Claude Code is about to run a tool, including calls a subagent makes and
   calls to MCP tools", and can refuse the call [read: events.md:100].
6. A hook can ask the person a question and hold the call until they answer: `$.ui.ask` [read:
   events.md:147-162].
7. A mod can register a tool and a command (`$.tool.register`, `$.command.register`) [read: api.md:47;
   types 2.1.322 lines 3251, 3292].
8. A mod can make a network request, `$.http.fetch`, which the organization's web-fetch policy can refuse
   [read: types 2.1.322 lines 3673-3713; admin.md:82-88]. Limits: 4 MiB a response [read:
   reference.md:395].
9. A hook's own execution time for one event is limited to 10 seconds, not counting time inside most `$`
   calls [read: reference.md:387]. `$.store` holds 4 MiB of JSON [read: reference.md:406].
10. `claude plugin test` runs a mod's tests "with no session, sign-in, or network" [read: create.md:306-308].
11. In the `claudemod` repository's issue-forge, a mod's own `tool.call` hook was skipped for the calls of
    agents **the mod itself spawned** from detached code, on 2.1.310 [field: that repository's SPEC, Change
    0.10.0]. So this plugin's mod spawns no agents: the skill has the model start them, and item 5 covers
    their calls. [unverified on 2.1.322 for this plugin; probe P3 below.]

## 3. What the MVP is

One plugin, `mod-builder`, with three parts. "MVP" items are built first; "later" items are designed for
and not built.

### 3.1 Knowledge (MVP)

- **Cache.** `~/.claude/mod-builder-data/docs/<UTC stamp>/` holds the fetched pages, the docs index and
  `manifest.tsv` (page, URL, sha256, Last-Modified, bytes). `latest` names the newest snapshot, `checked`
  the last time a fetch ran. Nothing is written inside the plugin's folder.
- **Refresh.** `scripts/refresh-docs.sh <cache dir>` (written, item 1). The page list comes from the docs
  index, so a page Anthropic adds is picked up. Only `code.claude.com/docs/en/plugins/mods/[a-z-]*.md` is
  fetched. A snapshot is kept only when a hash differs from the last one.
- **When.** At `session.start` the mod reads `checked`; when it is older than `refreshDays` (a plugin
  option, default 7) or the Claude Code version changed, it starts the script without waiting for it.
  `/mod-builder refresh` runs it now and reports. `refreshDays: 0` turns the automatic fetch off.
- **API types.** The types of the installed build are read from where Claude Code writes them (item 4),
  never fetched and never copied into this repository.
- **What changed.** After a refresh that kept a snapshot: per page, a line diff against the previous
  snapshot, written as `changes.md` (which pages, how many lines each way, the changed headings).
  Mechanical, no model call.
- **Lookup.** `scripts/lookup.sh <words>` prints matching lines from the newest snapshot as
  `page:line: text`, with the snapshot's stamp, so a spec can cite it. The skill uses this instead of
  memory.
- **Fetched pages are data.** Nothing fetched is run or sourced, and the skill tells the model that text
  inside a page is content, never an instruction.

### 3.2 The build skill (MVP)

One skill, `build`, started by `/mod-builder <what the mod should do>`. Eight phases, each ending in
something the plugin can observe:

| # | Phase | What happens | It ends when |
|---|---|---|---|
| 1 | Knowledge | refresh if stale; show snapshot date, build, what changed | a snapshot exists |
| 2 | Describe | the model reads the index and the pages that bear on the request, through the lookup | (no gate) |
| 3 | Spec | the model writes `<mod>/SPEC.md`: what it does, each API use with its citation, what it reaches, its tests | the person approves, through the mod's own question |
| 4 | Scaffold | the mod's files from one template (`pane`), checked against the build's types | `claude plugin validate` passes |
| 5 | Red | tests only | a new test fails by assertion |
| 6 | Green | code only; tests frozen | every test passes |
| 7 | Verify | validate, test, typecheck, a headless load with its debug-log lines | all pass |
| 8 | Done | summary, "Built on", local commits | (end) |

- At phase 3, when a skill named `design` is in the session's list, the approval question offers "See it
  first: draw mockups with /design". When it isn't listed, the option isn't shown.
- Red and green may each be given to a subagent the **model** starts (item 11). The three TDD agents of
  the `claudemod` repository are not part of this plugin (an open decision, 6.3).

### 3.3 The phase guard (MVP): a mod, inside the same plugin

- **State.** One record per build in `$.store`, keyed by the mod's folder: its phase, when the spec was
  approved, and the evidence each gate saw.
- **Refusing.** A `tool.call` hook (item 5) looks at `Edit`, `MultiEdit`, `Write` and `NotebookEdit`
  only, and only at paths under the mod being built: phase 3 may write `SPEC.md`; 4 everything; 5
  `tests/`; 6 `hooks/`; 7 `README.md` and `SPEC.md`. Anything else under that folder is refused with the
  phase, what opens next and how. With no build active the hook passes at once.
- **Advancing on evidence, never on the model's word.** The mod registers one tool, `mod_builder_gate`
  (item 7). The skill calls it to ask for the next phase; the mod then **runs the check itself**
  (`$.process.run`: validate, the tests, the typecheck, the headless load) and advances or answers what
  failed. For phase 3 it asks the person with `$.ui.ask` (item 6).
- **What it is not.** It reads a tool name and a path prefix. It doesn't parse Bash, so a shell command
  can still write a file out of phase; README says so. It catches a skipped step and is not a sandbox.
- **Pane.** One pane with the phase strip, the current phase's evidence, and the knowledge row, as in the
  mockups.

### 3.4 Later, designed for and not built

- A scheduled job on this repository that refetches the pages and opens a pull request with what changed.
- A summary of prose changes written by a model, and a diff of the API types between two builds.
- Field notes as probes: each finding a small probe mod with the log line it expects, rerun on a new build.
- After a refresh, a check of each built mod's citations and API calls against what changed.
- More templates than `pane`; an `edit` skill for an existing mod.
- A lookup tool the model calls (an MCP tool or a mod tool) in place of the script.
- The refresh through `$.http.fetch` instead of `curl` (item 8), for machines without `curl`.

## 4. What "it works" means

One demonstration, in an empty folder, with this plugin loaded by `--plugin-dir`:

1. `/mod-builder a pane that counts the turns in this session` builds `turn-counter` through all eight
   phases, and the result passes `claude plugin validate --strict`, `claude plugin test`, the typecheck and
   a headless load whose debug log shows `loaded` and `admitted`.
2. Its `SPEC.md` cites a snapshot page and line for each API it uses, and each citation resolves.
3. A `Write` under `hooks/` before the spec is approved is refused, and the same write passes at Scaffold.
4. With `checked` set nine days back, a new session refreshes the cache; with a fresh `checked` it doesn't.

## 5. Probes still owed before the build depends on them

Each needs the owner's OK where it costs model calls.

- **P1** `$.ui.ask` from inside a registered tool's handler: does the question show, and does the tool
  call wait? (No model call if driven by a command instead.)
- **P2** `$.process.run` of `claude plugin test` and of a headless `claude -p` from a mod: allowed, and
  within the process time limit? [read: reference.md Limits; the 600 s cap is a field note from the
  `claudemod` repository, unverified here.]
- **P3** Item 11 on 2.1.322: the `tool.call` hook sees the main thread's `Write` and a model-started
  subagent's `Write`. (One haiku subagent.)
- **P4** Where the build's types are when no interactive `--plugin-dir` session has loaded the mod yet
  (item 4 covers only that case).

## 6. Decisions for the owner

1. **The MVP slice** as in section 3, or smaller/larger.
2. **The plugin's name.** `mod-builder@claudemod` is installed and enabled on this machine, and its build
   skill would compete with this one in the same session.
3. **The TDD agents** (`tdd-test-writer`, `tdd-implementer`, `tdd-verifier`): used to build this plugin,
   shipped inside it for the mods it builds, both, or neither.
4. **A baseline copy of Anthropic's pages inside the repository** (works offline on first run, but
   republishes their text when the repository goes public), or an empty cache that fills on first run.
   Until decided, `.mod-builder-cache/` is ignored by git and only this spec's hashes are recorded.
5. **Network fetches on by default** (`refreshDays: 7`), or off until the person turns them on.

## 7. How it gets built, once approved

- In the Claude Code session whose folder is this repository; this spec is its input.
- The manifest and the hooks module with the built-in `plugin-authoring` skill, which ships with the build
  and carries the build's types. The `build` skill and its trigger checks with `skill-creator`.
- Test-first, local commits only: spec, then tests, then code. Nothing is pushed until the demonstration
  in section 4 passes and the owner says so.

# mod-builder: specification for the MVP candidate

Status: **approved by the owner, 2026-11-10** ("Approve as written (Recommended)"; section 6 holds each
decision). Nothing below is built yet except `scripts/refresh-docs.sh`, which was written to probe the
fetch. What waits until after the MVP is in `BACKLOG.md`.

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

- **Cache.** `~/.claude/mod-builder-data/v2/docs/<UTC stamp>/` holds the fetched pages, the docs index and
  `manifest.tsv` (page, URL, sha256, Last-Modified, bytes). `latest` names the newest snapshot, `checked`
  the last time a fetch ran. Nothing is written inside the plugin's folder.
- **Refresh.** `scripts/refresh-docs.sh <cache dir>` (written, item 1). The page list comes from the docs
  index, so a page Anthropic adds is picked up. Only `code.claude.com/docs/en/plugins/mods/[a-z-]*.md` is
  fetched. A snapshot is kept only when a hash differs from the last one.
- **When.** At `session.start` of an interactive session the mod reads `checked`; when it is older than
  `refreshDays` (a plugin option, default 7: one fetch of ten pages a week) or the Claude Code version
  changed, it starts the script without waiting for it. `/mod-builder refresh` runs it now and reports.
  `refreshDays: 0` turns the automatic fetch off. Headless sessions (`claude -p`) never fetch.
- **One fetch at a time.** Many sessions run on one machine, so the script takes a lock (`mkdir` of
  `<cache>/.lock`, removed on exit, ignored when older than ten minutes) and names its incoming folder
  with its process id; a session that finds the lock held skips the fetch.
- **Tests.** The fetcher gets a script test in the build (a local file server stands in for the site):
  first run keeps a snapshot, second reports unchanged, a changed page keeps a new one, a failed page
  keeps nothing, a held lock skips.
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

- **What starts a build: an event the mod observes, not a call the model chooses to make.** The mod hooks
  `skill.prompt`, which fires when "a skill's text is expanded for Claude" [read: reference.md:86, and
  :95 for the fields that name the skill]. When the skill is this plugin's `build`, the mod opens a
  **pending** build for the session. While a build is pending, an edit under any folder that holds a
  `.claude-plugin/plugin.json` or is being created as one is refused until the model has named the mod's
  folder through the gate tool; from then the record is that folder's. So a model that never calls the
  gate can write nothing into a mod. [unverified: which `skill.prompt` field names the plugin's skill on
  2.1.322; read from the build's types in the first build step.]
- **State.** One record per build in `$.store`, keyed by the mod's folder, and bound to the session that
  started it (`$.session.id`): its phase, when the spec was approved, the evidence each gate saw, and the
  hashes below. `$.store` is one file shared by every session, so other sessions' calls pass untouched.
- **Refusing.** A `tool.call` hook (item 5) looks at `Edit`, `MultiEdit`, `Write` and `NotebookEdit`
  only, and only at paths under the mod being built:

  | Phase | May write |
  |---|---|
  | 3 Spec | `SPEC.md` |
  | 4 Scaffold | everything |
  | 5 Red | `tests/` |
  | 6 Green | anything but `tests/` and `SPEC.md` |
  | 7 Verify | anything but `tests/`, `hooks/` and `SPEC.md`'s approved part (it appends a "Built" block) |

  Anything else under that folder is refused with the phase, what opens next and how. With no build for
  this session the hook passes at once.
- **Advancing on evidence, never on the model's word.** The mod registers one tool, `mod_builder_gate`
  (item 7). The skill calls it to ask for the next phase; the mod then **runs the check itself** with
  `$.process.run` and advances or answers what failed. A mod can do that: a throwaway mod ran
  `claude plugin validate --strict` (exit 0, 1.2 s) and `claude plugin test` (exit 0, `10 pass`, 0.9 s)
  on another mod and read both results [probe, 2026-11-10, 2.1.322, `gateprobe-p2`, no model call].
  - **Spec → Scaffold:** the mod asks the person with `$.ui.ask` (item 6), from the gate tool's own
    `tool.call` hook, which is how a registered tool is handled [read: api.md:40-62] and the documented
    place for a question [read: events.md:147-162]. Probe P1 (section 5) showed the dialog and returned
    the option chosen. **The first option is "Not yet"**, never "Approve", so a stray Enter can't approve:
    in P1's first run the dialog closed with its first option after 8.9 s with no key sent by the probe's
    driver, which is unexplained (the pane was visible to the owner).
  - **Scaffold → Red:** `claude plugin validate --strict` exits 0. The mod records how many tests ran.
  - **Red → Green:** `claude plugin test` exits non-zero; its last line reports more tests than at
    Scaffold; and every `(fail)` block holds an assertion (`expect(` or `AssertionError`). A file that
    fails to load runs no new test, so it can't pass this gate.
  - **Green → Verify:** `claude plugin test` exits 0 with no fewer tests than at Red.
  - **Verify → Done:** validate, test, the typecheck and the headless load all pass.
- **Writes the hook can't see.** The hook doesn't parse Bash, and a shell command can write a file. So
  the gates compare hashes: `SPEC.md` is hashed at approval, and every file under `tests/` when Red
  passes; each later gate refuses when one of them differs, naming the file. A test changed after Red,
  by any tool, stops the build at the next gate.
- **What it is not.** It reads a tool name and a path prefix, and compares hashes at gates. It catches a
  skipped step and a changed test; it is not a sandbox, and README says so.
- **Pane.** One pane with the phase strip, the current phase's evidence, and the knowledge row, as in the
  mockups.

### 3.4 Later, designed for and not built

- The "what changed" digest put into a session's context, only when the session touches a mod.
- A template canary: each template scaffolded, validated, tested and typechecked on the installed build.
- A scheduled job on this repository that refetches the pages and opens a pull request with what changed.
- A summary of prose changes written by a model, and a diff of the API types between two builds.
- Field notes as probes: each finding a small probe mod with the log line it expects, rerun on a new build.
- After a refresh, a check of each built mod's citations and API calls against what changed.
- More templates than `pane`; an `edit` skill for an existing mod.
- A lookup tool the model calls (an MCP tool or a mod tool) in place of the script.
- The refresh through `$.http.fetch` instead of `curl` (item 8), for machines without `curl`.

### 3.5 Layout of the repository

```text
.claude-plugin/marketplace.json     one entry, source ./plugins/mod-builder
plugins/mod-builder/
  .claude-plugin/plugin.json        name, version, userConfig (refreshDays)
  hooks/hooks.json                  "modules": ["./register.tsx"]
  hooks/register.tsx                the guard, the gate tool, the pane, the refresh trigger
  hooks/mod-builder-logic.ts        pure rules: phases, what a phase may write, the gates' verdicts
  skills/build/SKILL.md             the eight phases; templates/pane/ beside it
  scripts/refresh-docs.sh, lookup.sh
  tests/                            logic tests, pane tests; scripts/*.test.mjs for the two scripts
SPEC.md, README.md
```

`scripts/refresh-docs.sh` moves from the repository's top folder into the plugin in the first build step.

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

- **P1** done [probe, 2026-11-10, 2.1.322, sonnet, a throwaway mod `gateprobe-p13`, interactive, auto
  mode]: `$.ui.ask` from a registered tool's `tool.call` hook showed a dialog (`1. Approve 2. Refuse 3.
  Type something. 4. Chat about this`), and the tool call waited. Second run: the driver chose option 2 and
  the mod read `"Refuse"` after 1.3 s. First run: the mod read `"Approve"` after 8.9 s though the driver
  sent no key after submitting the prompt; unexplained, so the design doesn't put approval first (3.3).
- **P2** done for validate and test (3.3). Still owed: `$.process.run` of a headless `claude -p` load and
  of `tsc` from a mod, and the process time limit (a 600 s cap is a field note from the `claudemod`
  repository, unverified here). No model call.
- **P3** done [same probe]: the mod's `tool.call` hook on `Write` logged the main thread's call
  (`agentId=none`) and the call of a subagent the model started with the Agent tool
  (`agentId=a3d0d8ba5b59fdb67`), each with its `file_path`.
- **P4** Where the build's types are when no interactive `--plugin-dir` session has loaded the mod yet
  (item 4 covers only that case).

## 6. The owner's decisions (2026-11-10)

1. **The MVP slice:** "Approve as written (Recommended)": sections 3.1 to 3.3 and 3.5.
2. **The name:** "Keep `mod-builder`, replace the old one (Recommended)". `mod-builder@claudemod` is
   installed and enabled on this machine and owns `~/.claude/mod-builder-data/` [ran: it holds `logs`], so
   during development the old plugin is switched off in the building and testing sessions only
   (`--settings` with `enabledPlugins`), and this plugin keeps its data in
   `~/.claude/mod-builder-data/v2/`. Taking over the GitHub repository's name is in `BACKLOG.md`.
3. **The TDD agents:** "option 1 for MVP. option 2 post mvp." They are copied into this repository's
   `.claude/agents/` and used to build the plugin's own code; shipping them inside the plugin is
   `BACKLOG.md` item 1.
4. **The probes:** run on sonnet at the owner's suggestion ("sonnet would be a better choice"); results in
   section 5.
5. **Defaults taken, not yet challenged:** no copy of Anthropic's pages is kept in the repository (the
   cache fills on first run, and `.mod-builder-cache/` is ignored by git), and the weekly fetch is on
   (`refreshDays: 7`).

## 7. How it gets built, once approved

- In the Claude Code session whose folder is this repository; this spec is its input.
- The manifest and the hooks module with the built-in `plugin-authoring` skill, which ships with the build
  and carries the build's types. The `build` skill and its trigger checks with `skill-creator`.
- Test-first, local commits only: spec, then tests, then code. Nothing is pushed until the demonstration
  in section 4 passes and the owner says so.

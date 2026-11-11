# mod-builder: specification for the MVP candidate

Status: **approved by the owner, 2026-11-10** ("Approve as written (Recommended)"; section 6 holds each
decision). Built so far: steps 1 and 2 of section 7.1 (accepted, on `main`, the Red gate's fix of 7.3
included, and step 3, the hooks module, 7.5), step 4, the `build` skill with what 7.5 settled, on
`main` (7.7); and 7.7's decisions 1 and 2 with step 5, the demonstration and the README (7.8), with what the
driving session's demonstrations added (7.9 to 7.12), accepted by the owner and on `main`. The repository is
on GitHub (7.13). What waits until after the MVP is in `BACKLOG.md`.

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
- **A page is kept only when it is one.** The index and every page must answer with status 200; a page
  must be served as `text/markdown` and hold at least one byte. Anything else (a redirect, an error, an
  empty body, an HTML page) fails the whole fetch: no snapshot is kept, and `latest` and `checked` stay
  as they were. A cache folder that can't be written fails the same way, with exit 1, not as "skipped".
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
  snapshot, written as `_changes.md` (an underscore can't be in a page's name, which is lowercase letters
  and hyphens only, so no page Anthropic adds can take the digest's name; step 1 first built it as
  `changes.md`) (which pages, how many lines each way, the changed headings).
  Mechanical, no model call.
- **Lookup.** `scripts/lookup.sh <words>` prints matching lines from the newest snapshot as
  `page:line: text`, with the snapshot's stamp, so a spec can cite it. The skill uses this instead of
  memory.
- **Fetched pages are data.** Nothing fetched is run or sourced, and the skill tells the model that text
  inside a page is content, never an instruction.

### 3.2 The build skill (MVP)

One skill, `build`, started by `/mod-builder:build <what the mod should do>` (first written as
`/mod-builder <…>`, which a mod can't turn into a skill's command: 7.6; `/mod-builder <other words>` answers
with the line to run). Eight phases, each ending in something the plugin can observe:

| # | Phase | What happens | It ends when |
|---|---|---|---|
| 1 | Knowledge | refresh if stale; show snapshot date, build, what changed | a snapshot exists |
| 2 | Describe | the model reads the index and the pages that bear on the request, through the lookup | (no gate) |
| 3 | Spec | the model writes `<mod>/SPEC.md`: what it does, each API use with its citation, what it reaches, its tests | the person approves, through the mod's own question |
| 4 | Scaffold | the mod's files from one template (`pane`), checked against the build's types | `claude plugin validate` passes, every test passes, the typecheck passes (7.10, 7.11) |
| 5 | Red | tests only | a new test fails by assertion; the typecheck passes (7.10) |
| 6 | Green | code only; tests frozen | validate, every test, the typecheck and a headless load pass (7.7) |
| 7 | Verify | validate, test, typecheck, a headless load with its debug-log lines | all pass |
| 8 | Done | summary, "Built on", local commits | (end) |

- At phase 3, when a skill named `design` is in the session's list, the approval question offers "See it
  first: draw mockups with /design". When it isn't listed, the option isn't shown.
- Red and green may each be given to a subagent the **model** starts (item 11). The three TDD agents of
  the `claudemod` repository are not part of this plugin (an open decision, 6.3).

### 3.3 The phase guard (MVP): a mod, inside the same plugin

- **What starts a build: an event the mod observes, not a call the model chooses to make.** The mod hooks
  `skill.prompt`, which fires when "a skill's text is expanded for Claude" [read: reference.md:92, and
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
- **Other plugins' folders, until Done.** While this session's build is open and not yet Done, a write
  into any *other* folder that holds a `.claude-plugin/plugin.json`, or is being created as one, is
  refused, as it is while the build is pending. Without this, one gate call naming an empty or invented
  folder would end the pending block and leave the real mod unchecked in every phase (the second
  independent read of step 3's tests, 2026-11-10). The owner, asked: "Refuse until Done (Recommended)".
  The cost: another plugin can't be edited in the session that is building a mod.
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
    driver. The owner, afterwards: "i clicked approve - this explains the anomoly you reported." So the
    dialog behaved as documented, and a click or key from anyone at the pane answers it.
  - **Scaffold → Red:** `claude plugin validate --strict` exits 0. Then `claude plugin test` exits 0 (7.11):
    a scaffold whose tests fail, or whose module throws as it loads, can't leave Scaffold; a refusal quotes
    the run's last 20 lines. The mod records how many tests ran, and their names.
    Then the typecheck exits 0 (7.10): the same one Green runs, against every distinct types file, because
    `hooks/` and `types/` close when Scaffold passes and Red ends on a typecheck that judges them too.
  - **Red → Green:** `claude plugin test` exits non-zero; its last line reports more tests than at
    Scaffold; every `(fail)` block's **first line** is an assertion error (it starts with
    `AssertionError`, as in `AssertionError: expect(received).toBe()`); and at least one failing test has
    a name that no test had at Scaffold, whose names the mod records there. A file that fails to load
    can't pass: its block doesn't open with an assertion error, even when a source line it quotes holds
    `expect(`. An old test failing beside a new passing one can't pass either. (Step 2 first built this
    as "`expect(` or `AssertionError` anywhere in the block", with no names; 7.3.) After that verdict the
    typecheck (the same one, against every distinct types file) exits 0 (7.10): `tests/` closes when Red
    passes, so a check that judges the tests runs here. A failure names the types file and quotes the
    compiler's last 20 lines, as at Green, and `tests/` stays open because the build is still at Red.
  - **Green → Verify** (7.7, decision 1) passes only when all four pass, run by the mod in this order: `claude
    plugin validate --strict` exits 0; `claude plugin test` exits 0 with no fewer tests than at Red; the
    typecheck exits 0 against every distinct types file of the build, run once for each in the order of
    their hashes (7.9, which replaces 7.7's decision 2); the headless load exits 0 and its log shows the mod
    loaded (7.4's three lines, and no `<mod>: <event> hook skipped:` line, 7.8). The tests' and `SPEC.md`'s
    hashes are compared as now. The answer prints the exact "Built on" line to copy into `SPEC.md` (7.9).
  - **Verify → Done** runs the same four again, after the documentation is written, and compares the same
    hashes; before them it refuses a "Built" block of `SPEC.md` that lacks any of the types hashes, naming
    each (7.9). A gate's answer for a failed validate, test run, typecheck or load carries the last 20 lines
    of that command's output (for validate, of what it printed before its plugin-directory section; 7.9).
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
  scripts/refresh-docs.sh, lookup.sh, scaffold.sh (lays templates/pane/ into a mod's folder; step 4)
  tests/                            logic tests, pane tests; scripts/*.test.mjs for the two scripts
docs/mod-builder/SPEC.md, docs/mod-builder/BACKLOG.md (moved there from the top folder, 7.13)
README.md
```

`scripts/refresh-docs.sh` moves from the repository's top folder into the plugin in the first build step.

## 4. What "it works" means

One demonstration, in an empty folder, with this plugin loaded by `--plugin-dir`:

1. `/mod-builder:build a pane that counts the turns in this session` builds `turn-counter` through all eight
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
  sent no key after submitting the prompt: the owner had clicked it in the pane. The design still doesn't
  put approval first (3.3).
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

### 7.1 Build steps, in order

Each step is built test-first through the three agents in `.claude/agents/` (a written plan per change,
kept outside the repository; a red commit, a green commit, a verification), ends with local commits, and
stops for review before the next step starts. Code and tests are changed with the Edit or Write tool,
never through a shell command.

1. **Layout and knowledge scripts.** The marketplace and plugin manifests (3.5); `refresh-docs.sh` moved
   into the plugin, with the lock and the per-process incoming folder; `lookup.sh`; the `changes.md` line
   diff; script tests for all three against a local file server. No hooks module yet.
2. **The rules, as pure functions** (`hooks/mod-builder-logic.ts`) with logic tests: the phases, what each
   may write, each gate's verdict from a command's exit code and output, the hash comparison, staleness of
   the cache.
3. **The hooks module** (`hooks/register.tsx`) with tests through `claude plugin test`: the build opened
   on `skill.prompt`, the `tool.call` guard, the gate tool and its question, the store record bound to its
   session, the refresh trigger at `session.start`, the pane. The first thing this step does is read the
   build's types for the `skill.prompt` fields (3.3) and probe what section 5 still owes.
4. **The `build` skill** and the `pane` template, with `skill-creator`, checked against the skill-writing
   guidance it carries.
5. **The demonstration** of section 4, a README, and a "Built on" line.

### 7.2 What a verifier's PASS means, and what else a step needs

A verifier checks a change against its plan. When the planner wrote the plan's tests and code, a PASS
says "built as planned", not "the plan was right" (a side agent's note, 2026-11-10, after step 1's three
PASS verdicts were followed by Codex's stop-time review finding three defects, and then by the outside
read finding one more). So for every step:

- the plan's tests are read by an agent that didn't write them (against this spec, looking for cases the
  tests don't cover) before the red commit;
- the step gets an outside read before it is accepted: Codex's stop-time review, and the driving
  session's own read of the diff with at least one probe of behaviour the tests don't state.

**Step 1's outside read** [ran, 2026-11-10, at `a142659`]: 25 of 25 script tests pass, and
`claude plugin validate --strict .` passes. A local server answering one page with a 301, one with an
empty 200 and one as `text/html` got `new snapshot … (3 pages)`, exit 0, with a manifest of 0, 0 and 23
bytes: a redirect, an empty page and an HTML page were kept as documentation and became `latest`. Owed
as step 1's fix round, test-first: the rule in 3.1 ("A page is kept only when it is one"), the digest's
name `_changes.md`, and exit 1 for a cache folder that can't be written.

**Accepted as built in step 1:** the two test seams (`MOD_BUILDER_DOCS_ORIGIN`, `MOD_BUILDER_DOCS_CACHE`);
a branch per step, fast-forwarded into `main` once accepted; lookup's tests on a hand-built cache; the
scripts run as `bash <script>`; `git mv` for a move. Not accepted: a co-author trailer other than the
plan's (three commits carry one; left as they are, and plans from here say the trailer is copied as given).

### 7.3 Step 1's fix round and step 2: the outside read (2026-11-10, at `a0b706c`)

- **Step 1 is accepted.** The bad-server probe of 7.2, rerun on `74ae141`: `…/api.md could not be fetched:
  it is empty`, exit 1, no `latest` [ran]. Script tests 46 of 46 [ran]. `main` was fast-forwarded to it.
- **The fix round's red commit `2421e2e` rewrote assertions in three existing test files**, which the
  test-writer's own definition forbids ("Never change or delete an existing test or assertion"); the plan
  cited this spec's rename. The changes are the digest's file name, and the one test whose behaviour the
  rename changed (a fetched page named `changes.md` is now kept beside the digest) [read: the diff].
  **Until the owner decides otherwise:** a change this spec requires to an existing test is made by the
  building session in a commit of its own that says why and cites the section, before the plan runs, so
  the plan only adds tests and the agent's rule stays strict. (The alternative, a line in the agent's
  definition allowing rewrites a plan attributes to the spec, is the owner's to choose.)
- **Step 2: 72 of 72 logic tests pass** [ran]. Two cases the tests don't state, probed against the built
  `redGate` [ran]:
  1. a `(fail)` block for a file that failed to load, whose quoted source line holds `expect(`, **passed**
     Red;
  2. a run where only a test that existed at Scaffold fails by assertion, and the new test passes,
     **passed** Red.
  Both are owed as a fix before step 3's own work, to the rule now in 3.3.
- **Limits recorded, not fixed:** `pathInMod` reads only `/` paths, so on native Windows every path counts
  as outside the mod and the guard passes it (README must say so; WSL is unaffected). The typecheck isn't
  reproducible from the repository yet (step 3 adds the command to README).
- **The load lines** (section 4, item 1) on 2.1.322 [ran: a live session's debug log, 2026-11-10]:
  `hooks module <name>@inline loaded (…)` and `plugin.register: <name> (user, <name>@inline), judged by
  core alone: admitted`. Anthropic's pages don't use the word "admitted" (a side agent's note), so the
  check is: the `hooks module … loaded` line is present, and no line for the mod holds `not loaded:`.
  The `admitted` line is recorded when seen, not required.

### 7.4 The Red gate's fix and step 3: what was built, probed and left open (2026-11-10, at `574bc76`)

- **The Red gate** is to 3.3's rule (`b527e2a`, on `main`): both cases of 7.3 are refused with the runner's
  real output [ran]. New in the rules: `testNames`, whose answer the mod records at Scaffold.
- **Step 3 is built on `step-3-hooks`**, in four test-first changes, each with an independent read of its
  tests before the red commit and a verifier's PASS with every mutant failing its test: the rules the
  module asks (`4124b1d`), other plugins' folders closed until Done (`ca81add`), the module with the
  guard and the gate (`fc1061e`), the refresh trigger, `/mod-builder` and the pane (`574bc76`). 160 logic
  tests under `node --test`, 95 module tests under `claude plugin test`, `claude plugin validate
  --strict` and the typecheck against the build's types all pass [ran].
- **`skill.prompt`** (3.3's open point) [read: the build's types, 2.1.322]: its input has `skill`,
  `source`, `pluginName` ("an installed plugin's name, when the skill comes from one") and `path`. The
  mod opens a build for a skill named `build` or `mod-builder:build` whose `pluginName` is its own and
  whose `path`, when given, is under its own folder; so the installed `mod-builder@claudemod` opens
  nothing here. [unverified on a live session: which of the two names, and what `source`, a
  `--plugin-dir` plugin's skill carries; step 4 shows it when the skill exists.]
- **P2 is done** [probe, 2026-11-10, 2.1.322, a throwaway mod's command run headless, no model call]:
  `$.process.run` ran `tsc` (0.2 s) and a nested headless load (3.8 s, exit 0). Its time limit is a whole
  number of milliseconds from 1 to 600000, 30 s when not given; a command that outruns it or can't start
  rejects; one ended by a signal reads as exit 1. A headless load that costs no model call is
  `claude --plugin-dir <mod> -p /cost --debug-file <log>`.
- **The load lines** (correcting 7.3): a module that fails to load still exits 0, and the log says
  `hooks module <name>@inline failed to load:` and `<name>: hooks module did not load:`; no `not loaded:`
  line was seen. The check: the `hooks module <name>@inline loaded` line is present, and none of those
  three is said of the mod.
- **P4 is answered** [read: the plugin-authoring skill's reference, 2.1.322; ran: two headless loads laid
  nothing]: a folder loaded under `claude -p` is never written in. Before an interactive load, the only
  copy of the build's types is the one the `plugin-authoring` skill writes for its own process. **Open,
  before step 4:** where the built mod's `tsconfig.json`, types and compiler come from, so that Verify's
  typecheck (`npx --no-install tsc --noEmit -p <mod>`, this session's choice) can pass.
- **The test runner** [ran]: `claude plugin test` writes its report to standard output and a test's own
  printing to standard error, so the gate reads standard output only. A thrown text or an error renamed
  `AssertionError` still opens a block with that word; 3.3's rule can't tell it from an assertion.
- **Open, before step 4:** how `/mod-builder <what the mod should do>` (3.2) reaches the build skill. The
  mod's command `mod-builder` takes `refresh` and no words; any other text gets one line of explanation
  [ran: a live headless session]. Either the command hands the text to the skill, or 3.2 names
  `/mod-builder:build`.
- **Decided in the plans where this spec was silent, for the owner's review:** a guard that can't read
  whether the session has a build refuses a write that lies in a plugin's folder and passes any other
  with a transcript line (the owner, asked after Codex's review: "Refuse inside plugins only"), and
  refuses everything it can't judge once a build is known to be open; the gate's first call only names the folder, and each later call moves one
  phase; a folder another session is building can't be named until it is Done; the tests are hashed
  before and after Red's run, and compared before and after Green's and Verify's; the pane shows the
  evidence of the gate before the current phase; a fetch skipped for a held lock records no version.
- **Codex's stop-time review** of step 3 (7.2) found three defects, fixed test-first in `1a734b5`
  (verifier PASS, six mutants; 120 module tests): the guard let every write pass when it could not read
  the session's state, a mod's included; a session building a folder again after Done got the finished
  record back; and a link under `tests/` was recorded as a constant, so its target could change unseen
  (Red now refuses a `tests/` that holds a link or anything that is no file). Its fourth note, four test
  files failing to load in its own run, did not reproduce here [ran: 120 of 120] and is unexplained.
  What stays open under the owner's rule: a mod folder that has no manifest yet is not "a plugin's
  folder", so with the session's state unreadable a write into it passes, with the line.
- **Limits recorded, not fixed:** a session that ends mid-build leaves its folder bound to it, and no
  other session can name the folder (BACKLOG 17); a SPEC.md changed after approval stops every later
  gate with no way back to Spec (BACKLOG 18); a build taken to Done opens other plugins' folders again,
  whatever folder it named; `hooks/` is not hashed, so a shell command can still change it at Verify.

### 7.5 Step 3: the outside read, and what step 4 starts from (2026-11-10, at `5b47b58`)

- **Step 3 is accepted.** [ran, by the driving session] `claude plugin test plugins/mod-builder`: 120 of
  120; logic tests 160 of 160; script tests 46 of 46; `claude plugin validate --strict` passes. The real
  plugin, loaded headless with the first mod-builder switched off, logged `hooks module mod-builder@inline
  loaded (…); events: session.start,skill.prompt,tool.call,command.run,ui.render`, and `/mod-builder
  refresh` answered `new snapshot 2026-11-10T194027Z (10 pages)` into `~/.claude/mod-builder-data/v2/docs`.
- **One finding, owed at the start of step 4, test-first:** validate reports `gating hook without .catch:
  tool.call{tool=mcp__mod-builder__mod_builder_gate}`. A hook that throws is skipped [read: events.md:118],
  and "to make a hook that blocks calls fail closed, add a `.catch` error handler that answers in its
  place" [read: events.md:439-443]. The gate's hook gets one, answering that the gate failed and nothing
  moved.
- **The owner's two answers during step 3**, each asked by the building session: other plugins' folders
  are refused while a build is open ("Refuse until Done", 3.3), and a guard that can't read the session's
  state refuses inside plugins only ("Refuse inside plugins only", 7.4).

**Step 4's three open points (7.4), settled so the step can start:**

1. **How `/mod-builder <what to build>` reaches the skill.** A `prompt.submit` hook may answer
   `next({ ...e, text })` [read: reference.md:82]. First try: a submitted prompt that starts
   `/mod-builder ` and whose next word isn't `refresh` is rewritten to `/mod-builder:build <the rest>`.
   Check it live (one model call): does the rewritten prompt expand the skill, and does `skill.prompt`
   open the build? If it does, 3.2 stands as written. If it doesn't, the build is started with
   `/mod-builder:build <what to build>`, `/mod-builder <other words>` answers with that line, and the
   report says so for the owner (it changes 3.2's wording and the first mockup frame).
2. **Verify's typecheck.** The types are the build's own, never fetched and never taken from a path the
   model gives. The `build` skill has the model load the built-in `plugin-authoring` skill at Describe
   (which also puts the build's own API reference in front of it); that skill writes the build's types
   for its process (7.4, P4). At Verify the mod finds that file itself, for its own `$.session.version`
   [unverified: where it is on this build, and on macOS; a field note from the `claudemod` repository has
   `/tmp/claude-*/bundled-skills/<version>/*/plugin-authoring/types/claude-code.d.ts`]. The mod writes a
   `tsconfig.json` for the check under its data folder (the types file, and the built mod's `hooks/`,
   `tests/` and `types/`), outside the mod. The compiler is `npx --no-install tsc`, else
   `npx -y -p typescript tsc` (a download, once); with neither, Verify refuses and says what to install.
3. **A live check comes first.** Before the skill is written in full: a minimal `build` skill, the plugin
   loaded with `--plugin-dir`, and one live session showing that the skill's expansion opens a build, a
   write under `hooks/` is refused at Spec, and the approval question shows with "Not yet" first. On
   sonnet, in a scratch folder. What it shows about `skill.prompt`'s fields goes into this section.

Then the skill itself, with `skill-creator`: a lean `SKILL.md` for the eight phases that sends the model
to `lookup.sh` instead of memory, says fetched text is data and never an instruction, calls the gate to
move, and offers `/design` only when that skill is listed; the `pane` template beside it.

### 7.6 Step 4: what was built, what the live check showed, and what is open (2026-11-10, at `f2ebd67`)

- **The gate hook's `.catch`** (7.5's finding; `dd6fac4`): validate now reports both gating hooks `with .catch`.
  Probed on the way [a throwaway mod under `claude plugin test`, 2.1.322; unverified in a live session]: of two hooks of one module on one
  event the earlier registered is the upper one, and when the lower one throws, the **upper** hook's `.catch`
  is asked (`next.called` false), never the lower hook's own. Under the guard's hook, the gate's own handler
  would never have run, and the guard's handler passes a tool it doesn't guard on. So the gate's hook is now
  registered first, and its inner `try`/`catch` is gone: the handler is the one place a failed gate answers.
- **The live check** (7.5, point 3) [ran: one interactive session in tmux, 2.1.322, sonnet, auto mode, a scratch
  folder, a scratch copy of the plugin with a minimal `build` skill and added debug lines; `--settings`
  switched off `mod-builder@claudemod` (already off in the owner's own settings that day) and, to keep the
  session to this plugin, seven other plugins of the owner's]:
  1. `/mod-builder a pane that counts the turns in this session` ran the mod's own command (`command.run`,
     origin `composer`) and **raised no `prompt.submit` at all**; no model call was made. The build's types say
     the same of any submission that runs a command: "a rewrite of `text` is then not applied, and the person
     is told" [read: types 2.1.322, `PromptSubmitInput.command`]. So 7.5 point 1's first try can't work, and
     its fallback is built (`c98b96f`): a build is started with `/mod-builder:build <what to build>`, and
     `/mod-builder <other words>` answers with that line, the words kept. **3.2 and section 4 now say so; the
     first mockup frame still shows the old line.**
  2. `/mod-builder:build …` raised `prompt.submit` (with `command: { name: "mod-builder:build", args }`) and then
     `skill.prompt` with `skill: "mod-builder:build"`, `source: "plugin"`, `pluginName: "mod-builder"`, `path`
     the plugin's own `skills/build/SKILL.md`, and `frontmatter` holding the skill's name and description.
     `isBuildSkill` answered true and the pending build opened. (7.4's open point: a `--plugin-dir` plugin's
     skill carries the `plugin:skill` name and `source: "plugin"`.)
  3. The gate named the folder and passed Knowledge and Describe; `Write` of `turn-counter/SPEC.md` passed; a
     `Write` of `turn-counter/hooks/register.tsx` was refused with `hooks/register.tsx can't be written in
     phase 3 (Spec), which may write SPEC.md only. …`; the approval question showed `1. Not yet 2. Approve
     3. See it first: draw mockups with /design 4. Type something. 5. Chat about this`. It stayed open 39
     seconds with no key sent, then took "Not yet": the gate answered `still at phase 3 (Spec). Not passed: the
     person has not approved the spec (answer: "Not yet")`. So time inside `$.ui.ask` doesn't count against the
     hook's ten seconds, and nothing answered for the person. The pane showed the phase strip.
  4. The minimal skill loaded the built-in `plugin-authoring` skill and told the model that `./turn-counter`
     wins over the folder that skill names. The model wrote only under the working folder; loading the skill
     made an empty folder for the session under `~/.claude/dev-mods/` and no file was written in it [ran: a
     listing]. This shows little: the minimal skill named the two files to write. Whether a model running the
     full skill through Scaffold, Red and Green keeps to the working folder is step 5's to show (the side
     agent's note of the same day).
- **Verify's typecheck** (7.5, point 2; `25bfa97`) [probe: a throwaway mod's command, headless, no model call]:
  the types are at `<CLAUDE_TMPDIR>/bundled-skills/<version>/<one folder per process>/plugin-authoring/types/
  claude-code.d.ts` (`/tmp/claude-1000/…` here; three such folders by the end of the day, the three files identical);
  their first line is `// Written by Claude Code <version>.`; a mod reads `CLAUDE_TMPDIR` with `$.env.get`;
  `$.fs.list` gives those folders no time (`mtimeMs` 0); `$.fs.write` makes the folders above a file. On this
  machine `npx --no-install tsc -v` exits 127 and `npx -y -p typescript tsc -v` prints `Version 7.0.2`.
  As built: the first folder by name whose file's first line names the session's version; a tsconfig with the
  options of the types file's own header, at `~/.claude/mod-builder-data/v2/typecheck/<session id>/
  tsconfig.json`; the compiler asked for and run in that folder, outside the mod. [unverified: macOS; without
  `CLAUDE_TMPDIR` the mod tries `/tmp/claude-<id -u>` and otherwise refuses, saying where it looked.]
- **The real Verify gate, end to end** [ran, by the driving session: the built plugin with one added command
  that puts a record at Verify and calls the gate; headless, no model call]: on a mod laid by `scaffold.sh`
  it answered `phase 7 (Verify) passed (validate, 2 tests, the typecheck and a headless load of turn-counter
  all pass)` in 11.7 s. With `export const wrong: number = 'not a number'` added to the mod's module:
  `Not passed: the typecheck exited 1`. With a fake `node_modules/.bin/tsc` planted in the mod that prints a
  version and exits 0: still `the typecheck exited 1`, so the planted file was not taken for the compiler.
- **The skill, the template and the scaffold script** (`f2ebd67`): `skills/build/SKILL.md` (176 lines),
  `skills/build/templates/pane/` and `scripts/scaffold.sh <mod folder> <mod name> [author]`. Written with
  `skill-creator`'s writing guidance and read by a skill reviewer; **its eval runs, the review viewer and the
  description-optimisation loop were not run** (each costs model calls, and the first needs the owner at the
  viewer). `${CLAUDE_PLUGIN_ROOT}` is substituted in a plugin skill's text [read: code.claude.com/docs/en/
  skills.md:491-494, fetched 2026-11-10]. The full skill has not been run by a model: that is step 5.
- **Tests at the end of step 4** [ran]: 139 module tests, 171 rules and validate tests, 82 script tests (87
  after the fix round below);
  `claude plugin validate --strict` and the typecheck pass. The committed plugin, loaded headless, logged
  `hooks module mod-builder@inline loaded (…); events: session.start,skill.prompt,tool.call,command.run,
  ui.render` and `Loaded 1 skills`, and answered `/mod-builder a pane that counts turns` with the line to run.
  Each of the four changes had a verifier's PASS with every mutant failing its test, and an independent read
  of its tests before the red commit; the tests each read asked for (two in the typecheck's, eleven in the
  skill's and the script's) and the script as rewritten for its read were not read a second time.
- **Decided in the plans where this spec was silent, for the owner's review:** the template is laid by a
  script, not copied by the model; the template's test is stored as `tests/pane.test.tsx.template`, because
  `claude plugin test <plugin>` runs every `*.test.ts(x)` under the plugin, `skills/` included; the script
  fills the manifest's author from git's `user.name` (strict validation fails a manifest with none) and
  accepts only names strict validation accepts; `/mod-builder refresh the pane` is words to build, `refresh`
  alone fetches; what the typecheck needs is looked for before anything is run; the skill tells the model to
  run the validator and a typecheck itself before it leaves Green.
- **Open, for the owner, before step 5:**
  0. **Two other ways to keep `/mod-builder <what to build>`, neither probed:** the command's own hook could
     call `$.command.run` for the skill's command, or `$.prompt.submit({ text, asUser: true })` [read: types
     2.1.322]. 7.5 named the fallback, so the fallback is what was built.
  1. **A build that fails the typecheck or the load at Verify can't be finished** (the skill reviewer, the
     tests' reader and the side agent, each on its own): both first run at phase 7, where `hooks/` and
     `tests/` are closed, and no gate goes back. The skill's advice (check before leaving Green) is advice.
     The driving session's recommendation: Green's gate also runs the validator and the same typecheck, now
     that the mod finds the types and a compiler itself. It changes 3.3's "Green → Verify".
  2. **The types file can be planted.** A file under `<CLAUDE_TMPDIR>/bundled-skills/<version>/` whose first
     line names the version is taken for the build's types, and a folder named to sort first wins. The guard
     doesn't look there, and a shell command can write there. It is not "a path the model gives", but it is a
     file the model can make.
  3. **Red and a test that throws.** 3.3 wants every failing block to open with `AssertionError`; a test
     written before its code often fails with a `TypeError` first. The skill says to drive the mod through its
     events so a missing behaviour shows as a failed `expect`; whether that holds for a model is step 5's to
     show.
- **Codex's stop-time review** of step 4 (7.2) found two defects in the scaffold, fixed test-first in `93a9a39`
  (verifier PASS, five mutants; 87 script tests): the template's own tests required the placeholder lines
  (`Nothing to show yet.`, `The pane is open.`), so a mod that says its own words could never pass Green with
  the scaffold's tests kept; and a copy that failed partway left the half-written file, which the next run then
  refused as already there. The template's tests now check that the pane draws a line and that the command
  opens the pane and answers; the script removes what the failed copy wrote, and nothing that was in the mod's
  folders before (the tests' reader's case). Its other note, seven module test files failing to load and the
  validator's test failing in its own run, did not reproduce here [ran: 139 of 139, 171 of 171], as in 7.4.
- **The `/design` option** showed in the live check's approval question. The owner, the same day: "/design is
  not switched off. the other claude session was able to use /design". So the option was rightly offered.
- **Limits recorded, not fixed:** "the build did not move" is said of any failed gate, though a store write
  that fails between the two writes of the naming call leaves a record with no session entry (the next naming
  call takes it up); the handler's answer for a timeout (its kind, no message) is not reached by any test;
  nothing tests that no `prompt.submit` hook exists; a refused typecheck names the exit code and not the
  compiler's lines; a mod folder whose path holds `*`, `?` or `[` is read as a pattern in the tsconfig's
  `include`; `scaffold.sh` was run under bash 5 only.

### 7.7 Step 4 accepted, and the four open points of 7.6 decided (2026-11-10, at `e684780`)

The owner asked the driving session for "the best answer, as per anthropic's documentation" on the building
session's questions, to be given "with zero ambiguity". Step 4 is accepted: [ran, by the driving session]
139 of 139 module tests, 171 of 171 rules tests, 87 of 87 script tests, `claude plugin validate --strict`
passes with no gating hook lacking a `.catch`.

**Decision 0. A build is started with `/mod-builder:build <what to build>`. Do not probe the two other
routes, and do not build either.**
- `plugin:skill` is how a plugin's skill is named and run, and it is what the live check showed raising
  `skill.prompt` for this plugin (7.6, live check 2).
- `$.prompt.submit` is documented for one purpose: "When a background job finds something that needs
  Claude's attention, it can start a turn by submitting a prompt" [read: api.md:255]. Submitting text
  `asUser` to stand in for what the person typed is not that purpose, and the types say a rewrite of a
  submission that runs a command "is then not applied, and the person is told" (7.6, live check 1).
- `/mod-builder` stays the mod's own command: `refresh` fetches, any other words answer with the line to
  run. 3.2 and section 4 already say so; the driving session corrects the first mockup frame.

**Decision 1. Green's gate runs every check Verify runs. Change 3.3's "Green → Verify" to this, exactly:**
- Green → Verify passes only when all four pass, run by the mod in this order: `claude plugin validate
  --strict` exits 0; `claude plugin test` exits 0 with no fewer tests than at Red; the typecheck exits 0;
  the headless load exits 0 and its log shows the mod loaded (7.4's three lines). The tests' and
  `SPEC.md`'s hashes are compared as now.
- Verify → Done runs the same four again, after the documentation is written, and compares the same
  hashes. Nothing else about Verify changes.
- Why: Anthropic's own loop for changing a mod is "Claude edits the hooks module, runs `claude plugin
  validate`, and fixes what it reports" [read: create.md:254]. A check has to run while the code can still
  be changed, and at Verify `hooks/` and `tests/` are closed. With this, a build can't reach Verify in a
  state Verify refuses for the code.
- A gate's answer for a failed typecheck or load carries the last 20 lines of that command's output, so
  the model can fix what it names (7.6's limit, "names the exit code and not the compiler's lines").

**Decision 2. The types file: every candidate must agree, or the gate refuses. Build exactly this:**
- The candidates are every `plugin-authoring/types/claude-code.d.ts` under
  `<CLAUDE_TMPDIR>/bundled-skills/<session's version>/*/` whose first line names the session's version.
- No candidate: the gate refuses, saying where it looked and that loading the built-in `plugin-authoring`
  skill writes one.
- One candidate, or several whose content is byte-identical: that content is used.
- Candidates that differ: the gate refuses, naming each path, and says it can't tell which is the
  build's. It never picks by name order.
- The sha256 of the types used is recorded in the gate's evidence and shown in the pane and in "Built on".
- Why: "trust these files over any page" is said of the types Claude Code itself writes [read:
  create.md:270]. The mod can't prove who wrote a file, but the skill loads `plugin-authoring` at
  Describe, so a genuine copy exists, and a planted file that differs from it now stops the gate instead
  of being used. A planted file identical to the genuine one changes nothing. README lists this beside
  "not a sandbox".

**Decision 3. Red's rule in 3.3 stays exactly as it is. No code change.**
- A test "fires the events your hooks handle and checks what the hooks did" [read: create.md:308]. A test
  written that way fails at an `expect` when the behaviour is missing, and the scaffold has already laid
  the module, so nothing fails to load.
- A test that fails with a `TypeError` is refused by Red, and the refusal names the test: the model
  rewrites it to drive the mod through its events. Step 5 shows whether the skill's wording is enough; if
  a build needs more than two tries at Red for this reason, that goes in the report and the skill's
  wording is what changes, not the gate.

**Step 5** then follows 7.1 and section 4: the demonstration on sonnet in a scratch folder with the first
mod-builder switched off, a README (what it does, how to run it, "What it reaches" from validate's
output, the limits this section 7 records, "Built on"), and the reproducible typecheck command 7.3 asked
for.

### 7.8 Decisions 1 and 2 built, the owner's finding, and step 5: the demonstration (2026-11-10, at `719d45f`)

- **7.7's decisions 1 and 2 are built** in one test-first change (`c8765f4` red, `719d45f` green; verifier PASS,
  eight mutants; the existing assertions the decisions change in a commit of their own first, `6c41033`).
  3.3's "Green → Verify" now reads as 7.7 gives it. 160 module tests, 268 rules, validate and script tests,
  `claude plugin validate --strict` and the typecheck pass [ran].
- **The owner's finding, from the owner's own probe of step 4**, built in the same change: "the load check
  passes a mod whose hook throws at load. Probe: scaffold.sh with the name clear lays a mod; loaded headless,
  the debug log has 'hooks module clear@inline loaded' and also 'clear: session.start hook skipped: threw
  clear: $.command.register: "/clear" refused: it is the built-in /clear'." The rule, as the owner gave it:
  the headless load fails when any debug-log line of the form `<mod name>: <event> hook skipped:` is present
  for the mod being built [read: troubleshoot.md:142-144], and the gate's answer quotes that line. Reproduced
  by the building session before the fix [ran: the same scaffold, the same line], and every such line of the
  mod is quoted. Also from the owner's probe, nothing to fix: the scaffold held for a folder path with a
  space, an author holding a quote and a backslash, an existing `SPEC.md`, and a second run.
- **Decided in the plan where 7.7 was silent, for the owner's review:** what the typecheck needs (the types, a
  compiler) is still looked for before the four checks run, so with no types, types that differ or no
  compiler none of the four runs (7.6's accepted order); "the same to the byte" is decided on one reading of
  each file's bytes, and the hash recorded is of those bytes, as `sha256sum` prints it [ran: the real gate's
  hash and `sha256sum` of the types file agree]; "shown in the pane" is the pane's evidence row, which carries
  the hash from Green on; the lines quoted are what a command printed, or what it wrote to standard error
  when it printed nothing, and for a load, beside that, the mod's "hook skipped" lines, else the log's lines
  that name the mod; nothing is quoted for a failed validate or test run, which 7.7 does not ask for.
- **The real Green gate** [ran: the built code with one added command, headless, no model call]: on a scaffolded
  mod, `phase 6 (Green) passed (validate, 2 tests, the typecheck (types sha256 60ff86c1…ceca) and a headless
  load of turn-counter all pass; …)`; with a type error added, `Not passed: the typecheck exited 1.` followed
  by `The last lines of its output:` and the compiler's line naming the file, line and error.

**Step 5, the demonstration of section 4** [ran, by the building session: 2.1.322, sonnet, auto mode, tmux at
200 columns, an empty scratch folder, the plugin as committed at `719d45f` exported with `git archive` and
loaded with `--plugin-dir`; `--settings` switched off `mod-builder@claudemod` and the seven other plugins of
7.6's live check; the building session answered the dialogs in the owner's place]:

1. **`/mod-builder:build a pane that counts the turns in this session` built `turn-counter` through all eight
   phases** in one session, with these gate answers in order: folder named; Knowledge passed (snapshot
   2026-11-10T194027Z); Describe passed; Spec "Not yet" (answered so on purpose, see 3 below), then "Approve";
   Scaffold refused once (`claude plugin validate --strict exited 1`), then passed with 2 tests; Red passed at
   its first call (10 tests, the new ones failing by assertion); Green passed at its first call (validate, 10
   tests, the typecheck and a headless load); Verify passed at its first call; Done. Checked again by the
   building session outside the session: `claude plugin validate --strict` passes, `claude plugin test` 10 of
   10, the typecheck exits 0 with the tsconfig the rules write, and a headless load's log holds `hooks module
   turn-counter@inline loaded (…); events: session.start,command.run,turn.start,turn.complete,ui.render` and
   `plugin.register: turn-counter (user, turn-counter@inline), judged by core alone: admitted`, with no
   skipped hook.
2. **Its `SPEC.md` cites a snapshot page and line for each API it uses, and each resolves**: nine citations
   of `api.md`, `interface.md` and `events.md` at snapshot 2026-11-10T194027Z, each line read and found to be
   about what it is cited for (`events.md:290` is `turn.start`'s row, `interface.md:290` is "To open a pane,
   call `$.ui.open`"), and two of the build's types (`TurnStartInput`, `TurnCompleteInput`). Its "Built" block:
   `Built on Claude Code 2.1.322, from the docs snapshot 2026-11-10T194027Z, against the types sha256
   60ff86c1215663578dcd96bb09c05aee8a36e0366862f011509460d51a03ceca.`
3. **A `Write` under `hooks/` before approval was refused, and the same path was accepted at Scaffold.** The
   model does not try such a write by itself, so the building session answered the first approval question
   "Not yet" and asked for it: `Write(turn-counter/hooks/register.tsx)` answered `mod-builder:
   hooks/register.tsx can't be written in phase 3 (Spec), which may write SPEC.md only. …`. After "Approve" and
   the scaffold, `Edit` of `turn-counter/hooks/register.tsx` passed.
4. **With `checked` set nine days back, a new interactive session refreshed the cache; with a fresh `checked`
   it did not** [ran: `checked` 2026-11-01T213044Z, then a session whose debug log shows the mod running
   `bash` with the fetcher (exit 0, 2.3 s) and `checked` 2026-11-10T213048Z; a second session, no command run
   by the mod and `checked` unchanged].

What else the demonstration showed:

- **The folder.** The full skill loaded `plugin-authoring` at Describe and wrote every file under
  `./turn-counter/`; `~/.claude/dev-mods/` holds no
  file (7.6's open point).
- **Red needed one try** (7.7, decision 3): the model wrote eight tests that drive the mod through its events,
  and all failed by assertion. Nothing about the skill's wording had to change.
- **The Scaffold refusal cost a guess.** The gate's answer was `claude plugin validate --strict exited 1` and
  no more; the model then rewrote `types/index.d.ts`, added a `README.md` and `"license": "MIT"` to the mod,
  and passed. It reported the last two as required by strict validation, which they are not (the plugin
  directory's checks "do not change the result"). The cause [ran: the session's writes replayed up to that
  gate call, then validate]: `types: line 16: \`export\` at the top level is followed by \`type\` or
  \`interface\`: a contract exports types and nothing else`, one line the gate had and did not pass on.
  **Open, for the owner:** whether a refused validate (and test) run should carry its last lines too, as the
  typecheck and the load now do. The README lists it as a limit.
- **The scaffold's frozen test shaped the mod.** The spec said `/turns` prints nothing; the template's test
  wants the command to answer with a text, so the mod answers "The pane is open." and its "Built" block says
  so. The model had also edited `tests/pane.test.tsx` at Scaffold, as the skill allows.
- **The manifest's author** came from git's global `user.name` on this machine (the scratch folder is no
  repository), which is not the owner's name in this repository.
- **No commit was made** by the build: the mod's folder is not in a git repository, and the skill says so.
- **The types.** Four folders under `/tmp/claude-1000/bundled-skills/2.1.322/` held a types file during the
  demonstration, all the same to the byte; the gate reads each whole at Green and again at Verify. The hash
  in the mod's "Built" block is the one the gates answered with.
- **The hash in "Built on" is typed by the model and checked by nothing** (the tests' reader, and the owner's
  side agent the same day): the gate's evidence and the pane are the mod's own writing, the "Built" block is
  not, and Verify compares only the approved part of `SPEC.md`. **Open, for the owner:** whether Verify
  should refuse a "Built" block that does not hold the hash it used. The README lists it as a limit.
- **The skipped-hook rule in the real engine** [ran: a scaffolded mod whose `session.start` hook throws,
  through the built Green gate, headless]: `Not passed: the headless load's debug log does not show the mod
  loaded and admitted.` followed by `… [ERROR] thrower: session.start hook skipped: threw Error: boom at start`.
- **Section 4's item 3 was shown with `Edit` at Scaffold**, not with the same `Write`; a `Write` of that path
  passed at Green.
- **3.3's new text holds more than 7.7's words**: the skipped-hook clause (the owner's finding), and the
  sentence on the last 20 lines, which 7.7 gives under decision 1.

- **Codex's stop-time review** of this round (7.2) found one defect, fixed test-first in `2021d20` (verifier
  PASS, three mutants; 166 module tests): the 20-line limit was applied after the "hook skipped" lines were
  joined to what the load said, so with 25 skipped hooks only the last 20 were quoted, and they could push the
  command's own lines out. The limit is now the command's alone, and every skipped-hook line follows it. Its
  other note, the module runner answering "ended without a report" for every file in its own run, did not
  reproduce here [ran: 166 of 166], as in 7.4 and 7.6.

**Also in step 5:** `README.md` (what it does, how to run it, "What it reaches" from validate's output, the
limits of this section 7, "Built on"), with the typecheck command 7.3 asked for [ran: it exits 0 from the
repository's top folder with TypeScript 7.0.2]. With the README in place `claude plugin validate` no longer
reports `README_MISSING`; `LICENSE_MISSING` stays, a license being the owner's to choose.

**Not done, or swapped:** the first mockup frame still shows `/mod-builder <…>` (7.7 gives its correction to
the driving session); the demonstration switched off seven plugins beyond the first mod-builder; the approval
dialog was answered by the building session; the tests the reader of this change asked for, and the code as
changed for its read (one reading of the bytes, the quoted lines decided by the rules), were not read a
second time; macOS stays unverified.

### 7.9 The two decisions of 7.8, and a correction of 7.7's decision 2 (2026-11-10, at `fc8e038`)

The owner decided the two points 7.8 left open ("Both open decisions are yes; build them test-first in one
change"), and then, from the driving session's own demonstration, corrected 7.7's decision 2. All of it is one
test-first change (`a292c89` red, `fc8e038` green; the existing tests it changes in two commits of their own
first, `471d3ab` and `369669d`).

**Decision A. A refused validate or test run carries the last 20 lines of what that command printed**, as a
refused typecheck does. The owner: "the model can only fix what it is shown, and your demonstration lost a
step to this" [read: create.md:254].
- For validate, the lines are the last 20 of what it printed **before its "Plugin directory checks for …"
  section**; without that heading, or with nothing before it, the last 20 of the whole. Why: the building
  session replayed 7.8's refused Scaffold call [ran]: validate printed 37 lines, the error was on line 5, and
  the last 20 lines were the plugin-directory section alone (README missing, LICENSE missing, the icon, the
  digest, `Validation failed`), the very lines the model had wrongly acted on. **This choice was answered by
  the driving session, not by the owner**: the building session asked which lines a refused validate should
  carry, and the driving session's keystroke chose "Before directory checks" while the dialog was open; the
  driving session, afterwards: it "is also the answer I would give (the real error was on line 5, above that
  section), so keep it".
- It holds at Scaffold, Red, Green and Verify. When two commands fail together, the lines are those of the
  command the refusal names.

**Decision B, which replaces 7.7's decision 2. The typecheck runs against every distinct types file.**
7.7 had the gate refuse when the files that name themselves the build's types differ. That is wrong, and it
strands a build at Green [ran, by the driving session, 2026-11-10]: genuine types files differ between
sessions of one build. Under `/tmp/claude-1000/bundled-skills/2.1.322/` there are five, four with sha256
`60ff86c1…` (23491 lines) and one `a33c3b25…` (23487 lines, written 17:07 by the driving session's sonnet
session when it loaded plugin-authoring); the diff is the Bash tool's `allowed_domains` field, present only
where the sandbox is on. The driving session's Green gate refused with "types differ", correctly by the rule
and wrongly for the person. [ran, by the building session too: the five files and the two hashes.] The rule,
as the owner gave it:
- (a) The candidates are as before (the first line names the session's version); none still refuses.
- (b) The candidates are grouped by content hash; the typecheck runs once for each distinct content, in the
  order of the hashes, and passes only when it exits 0 for every one. It never picks one, and never refuses
  because they differ.
- (c) A failure names the types file it failed against and quotes the compiler's last 20 lines.
- (d) The evidence, the pane and the "Built on" line carry every distinct hash, sorted; the gate prints the
  exact line at Green and at Verify, so the model copies it and never composes it; Verify refuses a "Built"
  block that lacks any of them, naming the hash it expected.
- Why it is safe: "a planted file can only make the check stricter or fail it, never make a failing mod pass,
  because the genuine files must pass too."

**As built** [ran]: 188 module tests, 283 rules, validate and script tests, `claude plugin validate --strict`
and the typecheck pass; the verifier's PASS with eleven mutants, each failing its test. In the real engine
[ran: the built code with one added command, headless, no model call]: Green on a scaffolded mod, with the
five real types files, answered `phase 6 (Green) passed (validate, 2 tests, the typecheck (types sha256
60ff86c1…ceca, a33c3b25…7d76) and a headless load of turn-counter all pass; …)` followed by `The "Built on"
line for the "Built" block of SPEC.md, to copy exactly:` and the line with both hashes; Scaffold on 7.8's
replayed failure answered `claude plugin validate --strict exited 1.` followed by validate's own lines, among
them `types: line 16: \`export\` at the top level is followed by \`type\` or \`interface\`: a contract
exports types and nothing else`, and nothing of the plugin-directory section.

**Decided in the plan where the owner's words were silent, for review:** the tsconfig is one file, written
again before each typecheck run, and the typecheck stops at the first types file it fails against; at Verify
the "Built" block is checked before the four checks run, so a refusal for it runs none of them; a block holds
a hash when the hash stands whole anywhere in `SPEC.md` after its approved text (inside a longer run of hex
digits it is another number); the snapshot in the line is the one the Knowledge gate recorded for the build,
or the word `unknown`; a typecheck that fails and prints nothing still names its types file ("It printed
nothing. It ran against the types file …"); a command that printed nothing is quoted from what it wrote to
standard error; one file stands for each distinct content, the first by path.

**Not done, or swapped:** the tests the reader of this change asked for (seven module tests, three rules
tests) and the code as changed for its read (`refusedAt`, the whole-hash check, the file always named) were
not read a second time; 7.8's demonstration was not run again on this code (the driving session ran its own
from `96f60c9`); the README's "Built on" line still names one hash, the one of 7.8's demonstration.

### 7.10 A check runs while its files are open: the typecheck ends Scaffold and Red (2026-11-10, at `bcc6767`)

**The driving session's finding** [ran, by the driving session, 2026-11-10]: its second demonstration, on an
export of `bb5449c` (sonnet, another mod: a pane listing the last five tools used), stuck at Green again, for
a new reason. 7.9's correction worked, and the typecheck ran. Red passed (10 tests, the new ones failing by
assertion), the model wrote the code, all 10 tests passed and `hooks/register.tsx` typechecked; Green refused
on the typecheck with 10 errors, every one in `tests/tool-log.test.tsx` (a helper typed with a wrong alias,
and `tool.call` stubs with the wrong signature, TS2769). `tests/` had been closed since Red and nothing goes
back to Red, so the build could never finish. The model stopped and reported it, correctly. The cause, in the
driving session's words: "the one 7.7 decision 1 fixed for the code and I did not apply to the tests: a check
must run while the files it judges can still be changed."

**The rule, as given** ("Build exactly this"): Red -> Green also requires the typecheck (the same one, against
every distinct types file) to exit 0, run after the test run's verdict; a failure is answered like any refused
typecheck, naming the types file and quoting the compiler's last 20 lines, and `tests/` stays open because the
build is still at Red. Nothing else about Red changes.

**What the building session found before building it, and the answer.** The rule alone makes a new dead end:
the typecheck also judges `hooks/` and `types/`, which close when Scaffold passes and open again only at
Green. Until now their first typecheck was at Green, where they are open; with the rule, a type error left in
them by Scaffold (the model reshapes the template there) would refuse Red for good. The building session
asked, with that reason, whether Scaffold -> Red should run the same typecheck; the answer chosen in its
dialog was "Yes, Scaffold too". **Who answered is not known to the building session**: the dialog does not
say, and the driving session has answered one by keystroke before (7.9). So: Scaffold -> Red also requires the
typecheck to exit 0, after validate and the test run, answered the same way.

**As built** (`ebc70de` red, `bcc6767` green; the four existing tests it changes in a commit of their own
first, `5029df7`) [ran]: 208 module tests, 292 rules, validate and script tests, `claude plugin
validate --strict` and the typecheck pass; the verifier's PASS with eight mutants, each failing its test.
In the real engine [ran: the built code with one added command, headless, no model call, the five real types
files]: Scaffold on a scaffolded mod answered `phase 4 (Scaffold) passed (claude plugin validate --strict
exited 0; 2 tests ran; the typecheck passes (types sha256 60ff86c1…ceca, a33c3b25…7d76))`; Red with a new
test that fails by assertion and typechecks answered `phase 5 (Red) passed (3 tests ran, the new ones failing
by assertion; the typecheck passes (types sha256 …); 2 files under tests/ hashed)`; Red with the same test
holding `const wrong: number = 'not a number'` answered `still at phase 5 (Red). Not passed: the typecheck
exited 1.`, then `The last lines of its output, against the types file …/5d3947d0…/plugin-authoring/types/
claude-code.d.ts (sha256 60ff86c1…ceca):` and the compiler's line, `…/tests/more.test.tsx(4,9): error TS2322:
Type 'string' is not assignable to type 'number'.`

**Decided in the plan where the words were silent, for review:** at Scaffold and at Red the build's types and
a compiler are looked for only once the earlier checks have passed, and when either is missing the gate
refuses with the words Green uses and records nothing; at Red the typecheck runs before the tests are hashed
the second time, so a test changed while the compiler ran is refused as changed while the tests ran; the
evidence of a passed Scaffold and of a passed Red names the typecheck and every types hash; a write refused
at Red says Green opens "when a new test fails by assertion and the mod, its tests included, typechecks"; the
skill tells the model to declare at Scaffold whatever Red's tests will name.

**What the rule costs.** A test at Red can name only what Scaffold left: a type the contract does not declare
yet, or a value `hooks/` does not export yet, is a type error at Red, where neither can be written. The skill
says so at Scaffold. A build that finds this at Red has no way back to Scaffold; its tests have to be written
against what is there (through the mod's events, as the template's are).

**The same principle, checked once across every gate** (what each gate judges, and whether those files were
open the first time it judged them):

| Check | First run | Files it judges | Open then? |
|---|---|---|---|
| the person's approval | Spec | `SPEC.md` | yes |
| validate | Scaffold | the manifest, `hooks/`, `types/` (not `tests/`: a test file that does not parse leaves validate at exit 0 [ran]) | yes |
| the test run, as a count and names | Scaffold | `tests/`, `hooks/` | yes |
| the typecheck | Scaffold (this change) | `hooks/`, `types/`, `tests/` | yes |
| new tests failing by assertion, and no other failure | Red | `tests/` against `hooks/` | `tests/` yes, **`hooks/` no** |
| the typecheck of the new tests | Red (this change) | `tests/` | yes |
| every test passes | Green | `hooks/` against `tests/` | `hooks/` yes, **`tests/` no** |
| the headless load | Green | the manifest, `hooks/` | yes |
| the four checks again | Verify | all of them | `hooks/` and `tests/` no, but each first ran while they were open |
| the "Built" block | Verify | what `SPEC.md` gained | yes |
| the hashes of `SPEC.md` and `tests/` | every gate after | closed files, by design | no: a change stops the build (README) |

What that leaves, each a check that can first fail on files already closed. None is built; they are for the
owner to decide:
1. **A test that can never pass.** Green requires every test frozen at Red to pass. A test that typechecks
   and fails by assertion at Red, but asserts something no code can satisfy (or that the spec does not ask
   for), is first shown wrong at Green, where `tests/` is closed. No check at Red can find it: the code does
   not exist yet. The skill tells the model to stop and tell the person. The remedy would be a way back to Red.
2. **A types file that appears later.** The typecheck runs against every distinct types file there is when
   the gate runs. Another session that loads plugin-authoring after Scaffold, after Red or after Green can
   write a types file with other content; the next gate's typecheck then runs for the first time against
   that content, on files already closed (`hooks/` and `types/` at Red, `tests/` at Green, both at Verify). 7.9's facts show two contents for one build; the tests and code of
   a mod would have to differ in what they need from the two for this to bite.
3. **A Claude Code update during a build.** The gate reads the session's version each time: a session
   resumed on a newer build typechecks, validates and loads against that build, with files closed under the
   older one.
4. **The compiler npx downloads.** With no compiler installed, `npx -y -p typescript tsc` takes the newest
   TypeScript at each gate; a release between two gates could refuse what the earlier one passed.
5. **A scaffold whose tests already fail.** Scaffold's gate reads the test run for its count and its names,
   never for its exit code. A scaffold whose module throws as it loads fails both of the template's tests
   (`HooksError: turn-counter: hooks module did not load: boom at load`, exit 1) and still passed Scaffold,
   validate and the typecheck included [ran: the built code with one added command, headless, a `throw` put
   at the top of the scaffold's `register`]. Red then requires every failure to open with `AssertionError`:
   the old tests' failures do not, and `hooks/` is closed at Red. That is Red's rule first judging `hooks/`
   after it closed. The remedy would be for Scaffold to require the test run to exit 0. (Decided and built:
   7.11.)
6. **What is no dead end:** a test at Red that needs a hook the scaffold does not register fails by
   assertion when it drives the mod through its events, and the hook is written at Green.

**The tightening of `471d3ab`** (`64e7efb`, a commit of its own): that commit made the shared helper of
`gate.test.ts` answer the first line of the gate's answer, which loosened every exact comparison in the file.
The helper answers the whole text again; the twelve exact comparisons whose answer is one line now say that
nothing follows it, and the ten whose answer goes on (quoted lines, the "Built on" line) take its first line
by name, with what follows tested in `decisions.test.ts` and `built.test.ts`. The file's unanchored pattern
matches are as they were before `471d3ab`. Read again in that commit's diff [read]: its other loosenings
are two comparisons of `decisions.test.ts` (a passed Green and a passed Verify, now by their first line
because the "Built on" line follows; `built.test.ts` compares that line) and one of `gate.test.ts` (a refused
typecheck at Verify, by its first line; `typecheck.test.ts` compares its quoted lines whole). They are left.

**Not done, or swapped:** the five tests the reader of this change asked for (the typecheck not run for any
refusal of the test run, at Red or at Scaffold; an exit 0 that wrote to standard error still passes; the
order is the hashes', not the paths') were not read a second time, and the four mutants the reader showed
surviving before them are not among the plan's eight; the reader's note that two tests pin when the types and
the compiler are looked for (after the earlier checks, where Green looks first) was kept as the plan's
decision; neither demonstration was run again on this code; macOS stays unverified.

### 7.11 The driving session's demonstration reaches Done, and two last changes (2026-11-10, at `d466a3c`)

**The driving session's demonstration** [ran, by the driving session, 2026-11-10]. Three runs, each on an
export of this branch, on sonnet, of a mod other than 7.8's (`tool-log`: a pane listing the last five tools
used):

1. **On an export of `96f60c9`: stranded at Green.** Green's gate refused with "types differ". Genuine types
   files differ between sessions of one build (7.9 gives the two hashes and the diff), and 7.7's decision 2
   refused when they did. Corrected in 7.9: the typecheck runs against every distinct types file.
2. **On an export of `bb5449c`: stranded at Green again, for a new reason.** The types correction worked and
   the typecheck ran; every test passed and `hooks/` typechecked, but the typecheck failed on 10 errors in a
   test file, and `tests/` had been closed since Red. Corrected in 7.10: Red, and Scaffold, end on the
   typecheck, so that a check runs while the files it judges can still be changed.
3. **On an export of `0300149`: reached Done in one session** (auto mode, the folder
   `scratch/mydemo3/tool-log` under the ClaudeMod folder). Spec approved on option 2, then Scaffold, Red,
   Green and Verify, the pane showing `Verify: validate, 11 tests, the typecheck (types sha256 60ff86c1…,
   a33c3b25…) and a headless load of tool-log all pass`. Checked by the driving session outside that session:
   `claude plugin validate --strict` passes; `claude plugin test` passes 11 of 11; a headless load logs `hooks
   module tool-log@inline loaded (…); events: session.start,command.run,tool.call,ui.render` with no skipped
   hook; the mod's `SPEC.md` carries both hashes in its "Built on" line; and its six citations (`api.md:37`,
   `events.md:98`, `gallery.md:68`, `interface.md:89`, `:290`, `:337`) each resolve in snapshot
   `2026-11-10T194027Z` to a line about what it is cited for.

With 7.8's demonstration by the building session, section 4's four items have now been shown on two mods by
two sessions.

**Two last changes, decided by the owner after the third run** ("Two last changes, test-first, then stop"),
built as one test-first change (`a56317a` red, `d466a3c` green; the two existing tests it changes in commits
of their own first, `cd1aa1f` and `e7de1a2`):

- **(1) 7.10's item 5.** "Scaffold -> Red also requires the test run to exit 0, after validate and before
  the typecheck, quoted like any refused test run, so a scaffold whose tests fail or whose module throws at
  load cannot leave Scaffold." 3.3 says so now. The refusal reads `claude plugin test exited 1: not every
  test of the scaffold passes`.
- **(2) What Done offers.** After Done the model of the third run offered `/mod-builder:edit` and to "set
  it up for sharing as a GitHub repository"; neither exists in this plugin. The skill's Done phase now says:
  offer nothing else; this plugin has no edit skill and no sharing step yet; a change to a finished mod is
  made by hand, or by a new build in a fresh folder. It names the `plugin-authoring` skill's offer to share
  as the one not made here, because that skill, which phase 2 loads, is where the offer comes from [read:
  the skill's "SHARING IT" paragraph on 2.1.322].

**As built** [ran]: 216 module tests, 302 rules, validate and script tests, `claude plugin
validate --strict` and the typecheck pass; the verifier's PASS with three mutants, each failing its test.
In the real engine [ran: the built rules with one added command, headless, no model call]: the scaffold of
7.10's item 5, whose `register` throws as it loads, now answers `still at phase 4 (Scaffold). Not passed:
claude plugin test exited 1: not every test of the scaffold passes.`, then `The last lines of its output:`
and the run's own lines, among them `HooksError: turn-counter: hooks module did not load: boom at load`; the
unchanged scaffold still passes Scaffold.

**Decided in the plan where the owner's words were silent, for review:** the exit code is judged before the
count is read, so a run that fails and shows no count is refused for its exit code; the skill's Scaffold
section says every test has to pass there (it said "keeping at least one passing test").

**Not done, or swapped:** the four tests the reader of this change asked for (Done makes no other offer; the
skill's table says Scaffold's tests pass, which the reader found still saying "run"; a refused test run is
quoted from standard output when it printed a report, and is not cut at validate's section heading) were not
read a second time, and the mutants the reader showed surviving before them are not among the plan's three;
the last two of those tests cover code this change does not touch; the Done wording names `/mod-builder:edit`
and the `plugin-authoring` skill's sharing offer, which is more than the owner's words; no demonstration was
run on this code; macOS stays unverified.

**Step 5 is accepted** by the owner's words ("When both are verified, step 5 is accepted: fast-forward main to
the branch and stop. Do not push."): `main` is fast-forwarded to this branch at the commit that holds this
section. 7.10's items 1 to 4 stay open, with `BACKLOG.md`.

### 7.12 The final code, demonstrated by the driving session (2026-11-10, at `7fda9d8`)

[ran, by the driving session: 2.1.322, sonnet, auto mode, an interactive session in a terminal pane, the
plugin exported from `7fda9d8` with `git archive` and loaded with `--plugin-dir`, `mod-builder@claudemod`
switched off by `--settings`; a watch script chose option 2, "Approve", once, and touched no other dialog]

- **At `7fda9d8`:** `claude plugin test plugins/mod-builder` 216 of 216; rules and script tests 302 of 302;
  `claude plugin validate --strict` passes for the marketplace and the plugin.
- **`/mod-builder:build a status pane that shows how many prompts I have sent in this session and when the
  last one was`**, a request no earlier run used, built `prompt-count` through all eight phases in one
  session, with no gate refusing for a reason the model could not act on. The pane's last evidence row:
  `Verify: validate, 11 tests, the typecheck (types sha256 60ff86c1…, a33c3b25…) and a headless load …`.
- **Checked outside that session:** `claude plugin validate --strict` passes; `claude plugin test` 11 of 11;
  a headless load logs `hooks module prompt-count@inline loaded (…); events:
  session.start,command.run,prompt.submit,ui.render` and no skipped hook; its `SPEC.md` holds the gate's
  "Built on" line with both hashes; its nine citations (`api.md:15`, `:24`, `:39`, `:186`, `events.md:253`,
  `interface.md:188`, `:290`, `:337`, `:848`) each resolve in snapshot `2026-11-10T194027Z` to a line about
  what it is cited for. The guard refused one write during the build.
- **After Done** the owner's Codex stop hook found a flaw in the built mod (prompts that other plugins or
  scheduled triggers submit are counted as the person's). The model offered a new build in a fresh folder,
  an edit by hand outside the gates, or leaving it: the three things this plugin has, and no edit skill
  (7.11's wording held). The same happened after the third run. A finished mod can't be changed through
  the gates until `BACKLOG.md` item 15 (an `edit` skill) is built.
- **Section 4's four points hold on the final code:** point 1 and 2 here and in 7.11; point 3 in 7.8 and by
  the refusal above; point 4 in 7.8. The MVP candidate works as section 4 defines it. Nothing is pushed.

(Added later by the building session: "Nothing is pushed" was so when this section was written. The history
was pushed afterwards, and its first pull request merged by the owner; 7.13.)

### 7.13 The history's author address, and the repository on GitHub (2026-11-10)

The owner named `https://github.com/bankielewicz/mod-builder` as this repository's GitHub repository
(empty and public then [ran: `gh repo view`]) and asked for the work to be pushed "via pr". Before anything was
pushed the owner chose a GitHub noreply address for the history ("use the github noreply address"), because
every commit carried a personal address as author and committer.

- **Every commit was rewritten** [ran]: 79 commits, on every branch, the same trees, parents, names, dates and
  messages, with `121247296+bankielewicz@users.noreply.github.com` as author and committer. A commit hash named
  in a commit message was changed to the rewritten commit's.
- **Every hash changed.** The commit hashes this file cites were changed to the new ones in the commit that
  adds this section (50 citations of 37 commits; each was checked to be in the history). Earlier versions of
  this file, in earlier commits, still cite the old hashes. Hashes of anything else (types files, test files)
  are as they were.
- **The history as it was** is kept by the owner outside the repository, as a git bundle
  (`mod-builder-before-email-rewrite.bundle`, beside the repository's folder). It holds the personal address
  and is not pushed.
- **Pushed:** `main` as rewritten, to give the pull request a branch to target; this section, the README's
  two corrections and `CLAUDE.md` go in a pull request, which the building session does not merge. The owner
  merged it (pull request 1, `35a1337`) [ran: `gh pr list --state all`].
- **Where this file is.** In the same pull request the owner asked for this file and `BACKLOG.md` to be moved
  from the repository's top folder into `docs/mod-builder/` ("move backlog & spec into docs/<slug>/ folder");
  the folder's name was the building session's choice. `README.md` and `CLAUDE.md` name the new paths. In
  this file and in the code's comments, "`SPEC.md`" and "`BACKLOG.md`" still name these two files.

### 7.14 The history without `Co-Authored-By` (2026-11-11)

The owner asked for the `Co-Authored-By` line to be taken out of the commits already on `main` ("yes - strip
Co-Authored-By from the commits") and for the setting that keeps it out of new ones.

- **Every commit was rewritten again** [ran]: the 86 commits of `main` and the local branches behind it, the
  same trees, parents, authors, committers and dates, each message without its `Co-Authored-By` lines (83
  lines in all) and otherwise as it was; the `Claude-Session` lines stay. GitHub's signature on the two merge
  commits is lost, as a signature covers the message.
- **Every hash changed again.** The commit hashes this file and the two issue forms cite were changed to the
  new ones in the commit that adds this section (53 citations; a hash named in a commit message was changed
  too). Earlier versions of this file still cite older hashes.
- **Not rewritten:** the branch `edit-skill`, which the driving session was working on in a worktree of its
  own; it stays on the history as it was until that session rebases it. On GitHub the two merged pull
  requests still show the commits as they were pushed, which a force-push does not change.
- **New commits:** `.claude/settings.json` sets `attribution.commit` to an empty string, the documented way
  to leave the trailer off [read: code.claude.com/docs/en/settings-reference.md, "attribution.commit"; no
  environment variable does this, env-vars.md read whole]. The pull-request line and the session link are
  left at their defaults.

## 8. Change 0.2.0: an `edit` skill, and a stop (approved by the owner, 2026-11-10)

The owner, on what is next for the plugin: "option 1 is approved" (make a finished mod changeable,
`BACKLOG.md` item 15). This section is the design as approved in 8.8; nothing in it is built yet.

### 8.1 Why

A finished mod can't be changed through the gates: at Done `hooks/` and `tests/` are closed, and a build
never goes back (7.12). Both of the driving session's finished demonstrations ended with a real flaw found
in the mod just built, and the model could offer only a new build, a hand edit outside the gates, or
leaving it. Anthropic's own flow is "To change a mod you already have … ask for the change … Claude edits
the hooks module, runs `claude plugin validate`, and fixes what it reports" [read: create.md:246-254,
snapshot 2026-11-10T194027Z].

### 8.2 Facts this rests on

1. `claude plugin test` prints each test file's path on a line of its own before that file's `(pass)` and
   `(fail)` lines [ran, 2.1.322, on a mod the plugin built], so a failure can be tied to its file.
2. `builtMisses` reads only what follows the approved length of `SPEC.md` [read:
   `hooks/mod-builder-logic.ts`], so when an edit's approval records the whole file, an older "Built"
   block can't satisfy Verify.
3. A stored record has no field saying what kind of build it is [read: `BuildRecord`]; one without the
   field must go on reading as a build.
4. "Files Claude saves during its turn reload when the turn ends" for a folder loaded with `--plugin-dir`
   [read: create.md:256]. An edit doesn't need the mod loaded; if it is, it reloads as the edit goes.
5. **A mod's tests don't import the mod.** The pane template's test and every test of the two mods the
   driving session's demonstrations built import only from `claude-code/testing` (and types from
   `claude-code`) [read: the template and `scratch/mydemo3`, `scratch/mydemo4`, 2026-11-10]: they drive
   the mod through its events. So a test written at Red needs nothing declared before it.
6. The gate's typecheck includes `hooks/`, `tests/` and `types/`, with `skipLibCheck` [read:
   `typecheckConfig`].

### 8.3 What an edit is

Started with `/mod-builder:edit <mod folder> <what to change>`; `skill.prompt` for this plugin's `edit`
skill opens a pending edit, exactly as `build` does (3.3). The gate's first call names the folder.

- **The folder must be a mod**: it holds `.claude-plugin/plugin.json` and a `hooks/hooks.json` with a
  `modules` key; it isn't this plugin's own folder or one inside it; and no other session's unfinished
  build or edit holds it. Otherwise the gate refuses, saying which.
- **The baseline, taken at that call, before anything is written:** the mod runs validate, the tests, the
  typecheck and the headless load on the mod as it stands, and records the manifest's `version`, the test
  count and names, a hash of every file in the folder, and `SPEC.md`'s length and hash (or that there is
  none). It also makes the restore point (8.5).
- **Phases of an edit whose baseline passes. Each phase writes one kind of thing, as in a build:**

  | # | Phase | May write | It ends when |
  |---|---|---|---|
  | 1 | Knowledge | nothing | a snapshot exists |
  | 2 | Describe | nothing | (no gate) |
  | 3 | Spec | `SPEC.md`, by appending | the file still begins with its baseline bytes, and the person approves (the same question, "Not yet" first) |
  | 4 | Red | `tests/` only | the tests fail; every failing block opens with `AssertionError`; at least one failing test is new by name or sits in a test file whose hash differs from the baseline's; the typecheck passes; and 8.4's question, when it applies |
  | 5 | Green | anything but `tests/` and `SPEC.md` | the four checks pass; `plugin.json`'s `version` is greater than the baseline's |
  | 6 | Verify | as in a build | the change's "Built" lines hold every types hash; the four checks pass; the hashes agree |
  | 7 | Done | as in a build | (end) |

  **Red is what it is in a build: tests first, and nothing else.** There is no phase before it for
  declarations (fact 5). A change to the mod's contract in `types/` is made at Green, with the code. A
  test that names something not declared yet is refused by Red's typecheck while `tests/` is still open,
  so it is rewritten to drive the mod through its events; nothing strands. (A first draft had a "Prepare"
  phase before Red, open to `hooks/`; a side agent's note showed a fix written there would leave Red
  unable to pass. The owner, on widening Red instead: "why expand red? red is only for unit tests 1st in
  TDD." Fact 5 then showed Prepare had no job. The owner: "Yes, no Prepare (Recommended)".)
- **The change is written into the mod's `SPEC.md` as a new section at its end**, headed with the new
  version and the date: what changes, each API use with its citation, what it reaches now, its tests,
  and any existing test it changes or removes. Nothing above it may change. A mod with no `SPEC.md` gets
  one that holds only this section.
- **The pane** shows the edit's phases and evidence as it shows a build's, and names it an edit.

### 8.4 Test files that are changed or gone

An edit may change what an existing test expects, which is also how a test is loosened. **At Red's gate of
an edit or a repair the mod asks the person when any test file that existed at the baseline has changed or
is gone**, not only when a test name is gone. The question names each such file with the lines added and
removed against the baseline copy in the restore point, and quotes every removed line that holds `expect`
(at most 20 lines in all, then "and N more"); test names that are gone are listed too. "Not yet" is first;
any answer but the approving one keeps the edit at Red. A test file that is new since the baseline raises
no question. The answer and the files it covered are recorded in the gate's evidence and shown in the pane.

The owner: "Ask me at the gate (Recommended)". As first written, this section asked only when a test name
was gone and listed a changed file in the answer; a side agent raised that a test kept by name but weakened
was then only listed, never asked about, and the driving session gave the rule above as the owner's answer
applied to that case (2026-11-11).

### 8.5 A restore point, and a stop

- **Restore point.** At the baseline the mod copies the mod's folder (without `node_modules` and `.git`)
  to `~/.claude/mod-builder-data/v2/restore/<session id>/<stamp>/`, and records where. The owner: "Backup
  copy (Recommended)".
- **`/mod-builder stop`** ends this session's open build or edit, at any phase. The record becomes
  stopped, the folder is no longer bound to the session, and other plugins' folders open again. For an
  edit it then asks: "Keep the mod as it is now" (first) or "Put it back as it was before this edit".
  Putting it back deletes nothing: the folder as it is now is renamed `<mod>.stopped-<stamp>` beside it,
  and the restore point is copied to `<mod>`. The answer names both folders.
- A stopped or Done record gives way to a new build or edit of the same folder, as a Done one does now.
- This is the stop of `BACKLOG.md` item 18; going back one phase, and its retry count, stay there.

### 8.6 A mod whose baseline fails: a repair, in the same pure phases

A mod written for an older Claude Code that no longer typechecks or loads is the case this plugin
exists for. The owner: "Repair it (Recommended)", and then, asked whether a repair may write tests and
code in one phase: "Split into pure phases (Recommended)". So a repair has no phase of its own:

- The baseline's failing checks, quoted, are the repair's red evidence. They are recorded and shown.
- **Red, tests only, is skipped when the baseline's tests already fit the build** (they typecheck). It is
  entered when they don't: it then ends when the tests typecheck against the build's types; they need
  not fail anew, because the mod already fails. 8.4's question applies to every test that is gone.
- **Green, code only,** ends as in any edit: the four checks pass and the version is greater. A repair
  whose tests typecheck but can never pass with honest code is stopped (8.5), as a build is.
- Then Verify and Done.

### 8.7 What "it works" means for 0.2.0

With the plugin loaded by `--plugin-dir`, on sonnet, on copies of two mods this plugin built:

1. **`tool-log`** (rows are cut by character count, so wide characters overflow the pane):
   `/mod-builder:edit <copy> cut each row by display width` reaches Done. Outside the session: validate,
   every test, the typecheck and a headless load pass; `version` went from 0.1.0 to a greater one;
   `SPEC.md` begins with its former bytes and ends with the change and its "Built" lines.
2. **`prompt-count`** (prompts that other plugins or scheduled triggers submit are counted as the
   person's): the same, for a change that alters what an existing test expects.
3. A `Write` under `hooks/` at Red is refused; a line of the original spec changed at Spec is refused by
   its gate; the folder of this plugin itself can't be named.
4. A test removed at Red raises 8.4's question, and "Not yet" keeps the edit at Red.
5. `/mod-builder stop` at Green, with "Put it back": the folder's files hash as the baseline's did, and
   the edited folder stands beside it under its new name.
6. A repair: a copy with a type error put into `hooks/` (its tests still fit) goes from Spec to Green and
   on to Done with Red skipped; a copy whose test no longer typechecks enters Red first.
7. A record stored by 0.1.0 still reads as a build, and a 0.1.0 build still runs to Done.

### 8.8 The owner's decisions (2026-11-10)

1. **The slice and where it lives:** "Approve, branch + PR (Recommended)": built on a branch and opened as
   a pull request on `bankielewicz/mod-builder` when the driving session's own demonstration of 8.7
   passes. Nothing reaches `main` unreviewed.
2. **A mod whose baseline fails:** "Repair it (Recommended)", in pure phases (8.6).
3. **Tests that are gone at Red:** "Ask me at the gate (Recommended)" (8.4).
4. **The restore point:** "Backup copy (Recommended)" (8.5).
5. **No Prepare phase; Red stays tests-only** (8.3).
6. **Purpose-built subagents** (a test writer for Red, an implementer for Green, an independent reader
   of the tests before Red's gate, none with a pinned model): "Next change, after the edit
   (Recommended)". They get their own section and probes as 0.3.0, including whether the guard can tell
   which agent is calling; until that is shown, path rules and gates enforce and agents only specialise.

**Known and not changed here:** a new build's Scaffold opens everything, so a model can write the whole
mod there and Red then has nothing to fail (the same early-fix opening the first draft's Prepare had).
For the owner to decide with 0.3.0.

### 8.9 How it gets built

As 7.1 and 7.2: on a branch from `main`, one written plan per change through the three agents in
`.claude/agents/`, an independent read of each plan's tests before its red commit, a change this spec
requires to an existing test in a commit of its own first, the driving session's own probe before a step
is accepted, and commits without a `Co-Authored-By` line (7.14). Steps:

1. **The rules**: the edit's phases and what each may write, the baseline's verdict, Red's rule for an
   edit, the repair's two cases, the version comparison, the record's kind (a record without it is a
   build), the folder a gate may name.
2. **The hooks module**: opening an edit on `skill.prompt`, naming and the baseline, the restore point,
   8.4's question, `/mod-builder stop` and putting a mod back, the pane.
3. **The `edit` skill** with `skill-creator`, and the build skill's Done wording (it now names the edit).
4. **The demonstration** of 8.7 by the building session, then by the driving session.
5. **The documents**: `docs/limits`, `docs/how-it-works`, the README's commands table, `CHANGELOG.md`,
   both manifests at 0.2.0, and `BACKLOG.md` with items 15, 21 and 22 struck and 18 cut to what is left.


### 8.10 The audit before step 1, and what it changed (2026-11-11)

Before the rules were planned the building session ran 7.10's audit for every edit, repair and stop gate
(which closed files does each check judge?) and probed what it could on 2.1.322.

**Probed** [ran, 2.1.322, on a scaffolded pane mod]:
- Fact 1 of 8.2 holds: each test file's path is on a line of its own (`tests/more.test.ts:`), from the mod's
  folder, before that file's `(pass)` and `(fail)` lines. A file that does not load shows as `(fail) the
  file did not load` under its path, and counts as one test in the last line.
- A mod with no test file: `claude plugin test` exits 1 and prints `claude plugin test: no *.test.ts or
  *.test.tsx under <mod>`, with a `tests/` folder that is empty or with none.
- Test files anywhere in the mod are run: `hooks/x.test.ts` and `lib/y.test.ts` ran beside
  `tests/pane.test.tsx`.
- A manifest with no `version` fails `claude plugin validate --strict` (exit 1, a warning under
  `--strict`); one with `"version": "banana"` passes it (exit 0).
- The typecheck prints an error's path from the compiler's own folder, not the mod's
  (`../two/hooks/register.tsx(28,7): error TS2322: …`, `../two/tests/broken.test.ts(2,25): error TS2307:
  …`), one line for each error, for errors in `hooks/` and in `tests/` in the same run.
- Fact 5 of 8.2 could be read only on the pane template: `scratch/mydemo3` and `scratch/mydemo4` are not in
  the building session's checkout.

**Three findings that changed the rules, and the answers.** Each was asked with its evidence; the answer came
as text pasted into the building session, the driving session's recommendation with its reasons ("option 1
on all three"). Whether the owner typed it is not known to the building session.

1. **A mod with no tests.** By 8.6 its baseline fails (the test run exits 1), so it is a repair; its tests
   "fit", there being none, so Red is skipped; Green then needs a passing test run with the tests closed and
   can never end. Answer, "Enter Red": a mod with no test file always enters Red, tests only. Red ends when
   a test file exists and the test files typecheck; when the baseline's other checks all pass, it ends as in
   any edit, on a test failing by assertion.
2. **Test files outside `tests/`.** By 8.3's table such a file is closed at Red and open at Green, so a test
   could be written with the code. Answer, "Tests by name": in an edit, any `*.test.ts` or `*.test.tsx`
   anywhere in the mod is a test file, as everything under `tests/` is: written at Red only, closed from
   Green on, hashed, and covered by 8.4's question. A build keeps its rule. The driving session added that
   the typecheck must then cover every test file, so that none is frozen unchecked: the typecheck's
   configuration names each test file outside `hooks/`, `tests/` and `types/`.
3. **The version.** Answer, "Any x.y.z passes": when the baseline has no version, or one that is not three
   numbers as in `1.2.3`, Green requires the new one to be three numbers and nothing more; otherwise the new
   one must be greater, compared number by number. A version with anything after the third number is not
   three numbers.

**Decided by the building session where section 8 is silent, for review:**
- **Whether the tests fit is read from the typecheck's error lines**, not its exit code: the one typecheck
  also judges `hooks/`, closed at Red, and 8.7's item 6 needs a type error in `hooks/` to skip Red. The test
  files fit when, for every types file, no error line names a test file and no error line names no file at
  all; a typecheck that exits non-zero and shows no error line is not read as fitting. Repair Red ends on
  the same reading.
- When Red is skipped the test files are held to the baseline's hashes from Green on, as Red's are in a
  build.
- A stopped record is not a phase: it is a mark on the record, and a stopped record, like a Done one, does
  not hold its folder against another session.

**Checks that first judge files already closed, none built:**
- 7.10's items 2 to 4 hold for an edit as for a build (a types file that appears later, a Claude Code
  update during the edit, the compiler `npx` downloads). In an edit a types file that appears between the
  baseline and Red is first judged against `hooks/` while it is closed.
- At a repair's Red the test run is not read (the mod already fails), so a test file that typechecks and
  then does not load, or a test no honest code can pass, first shows at Green with the test files closed.
  8.6 names the second; the remedy for both is the stop.
- Green's version rule is not judged again at Verify, where `plugin.json` is still open. Step 2 can run it
  there too; nothing closes it.
- The stop judges no file. Putting a mod back leaves out `.git` and `node_modules` (8.5), so a mod that is
  a git repository comes back without its `.git`, which stays in the `.stopped-` folder. For the owner to
  weigh before step 2.
- The folder a gate may name is refused by path when it is this plugin's own. The plugin's source, edited
  from an installed copy of the plugin, is another path and is not refused.

### 8.11 Step 1, the rules, as built (2026-11-11, at `83955b5`)

**Built** (`fc3f407` red, `83955b5` green; no existing test changed) [ran]: the rules of an edit as pure
functions in `hooks/mod-builder-logic.ts`, under one new section, with 78 logic tests in
`tests/mod-builder-logic-edit.test.mjs`. An edit's phases, numbers and labels (`phasesOf`, `phaseNumberOf`,
`phaseLabelOf`, `nextPhaseOf`); what each may write and the refusal's words (`isTestPath`, `mayWriteIn`,
`writeVerdictIn`, and `guardVerdict` judging by the record's kind); the record's kind and whether it still
holds its folder (`recordKind`, `isOpenRecord`); the folder a gate may name (`editFolderVerdict`); the
baseline (`typecheckErrors`, `testsFit`, `baselineVerdict`); Red (`failuresByFile`, `editRedGate`,
`repairRedGate`); 8.4's question (`testHashesOf`, `testFilesToAsk`, `testFilesChanged`, `namesGone`,
`lineChanges`, `testChangeQuestion`, `testChangeOptions`, `testChangeGate`, `testChangeEvidence`); the version
(`versionGate`); and `typecheckConfig` naming test files outside its three folders. The hooks module calls
none of the new rules yet: that is step 2.

**Run** [ran]: 380 of 380 rules, validate and script tests; 216 of 216 module tests; `claude plugin validate
--strict`; the typecheck; the verifier's PASS, with 19 mutants each failing its named test. On real output
[ran, 2.1.322 and a downloaded TypeScript]: `failuresByFile` tied `the file did not load` to
`tests/broken.test.ts` and `a new one fails` to `tests/more.test.ts`; `editRedGate` refused that run as "not
failing by assertion: the file did not load"; `typecheckErrors` placed one error in `tests/broken.test.ts`
and one elsewhere from the compiler's `../two/…` paths; `baselineVerdict` read a mod with no test file and
nothing else failing as an edit whose Red is entered.

**The independent read** of the first 60 tests (an agent that did not write them, about 170 mutants and a
fuzz of every new rule) found 18 mutants no test failed and four defects, all mended before the red commit,
with 18 tests added: a folder named through a path that climbs above the root passed as not this plugin's;
the guard went on judging a stopped record's own folder by its old phase; the 20-line cap and the question's
other words were pinned loosely; the comparison's table could exhaust memory on a very long test file (two
files past 4,000,000 cells are now compared without regard to order). A probe it prompted [ran]: `claude
plugin test` runs `hooks/.test.ts`, and runs neither `node_modules/dep/d.test.ts` nor `lib/U.TEST.TS`; the
rule for a test file by name follows that.

**Decided in the plan where the words were silent, beyond 8.10's list, for review:** a stopped record lets
every write pass, under its own folder too ("the folder is no longer bound to the session"); a version's
numbers may open with a zero and are compared exactly whatever their size; the question ends "and N more
removed lines that hold "expect"" where 8.4 says "and N more", and a line is quoted when it holds the letters
`expect` as written; a failing block that no path line precedes is never taken as changed; `isBuildRecord`
does not check the record's `red` field.

**Found and not built, for the owner before step 2:**
- **An edit that changes nothing a test can see can't leave Red** (a side agent's note, and the audit's own
  reading): a tidy-up of the code, a manifest description, a README. Red ends only on a failing test, as in
  a build. The ways out today are the stop and a hand edit. Refuse such an edit up front, give it a route
  of its own, or leave it: the owner's to decide.
- Green in an edit whose Red was skipped needs a test count to hold the run to; the baseline's is recorded
  (`tests`, null when its run showed none). Step 2 decides what Green compares with when it is null.
- `guardVerdict` handed no input at all throws, as it did before this change; the hooks module always hands
  it one.

**Not done, or swapped:** the 18 added tests were not read a second time by another agent; the driving
session's own probe of this step (8.9) is still owed; fact 5 of 8.2 was read on the pane template only;
macOS stays unverified. The typecheck naming stray test files was built on the driving session's stated
intent to ask for it, before the ask itself arrived.

### 8.12 The typecheck reaches every test file: a stop-time review's finding (2026-11-11, at `cbd061d`)

**The finding** (Codex's stop-time review of 8.11): "The new typecheck configuration can silently omit test
files before freezing them." As built in 8.11, `typecheckConfig` named a test file only when it lay outside
`hooks/`, `tests/` and `types/`. The compiler, given a folder, passes over a file whose name, or a folder on
its way, opens with a dot, and over a `node_modules` folder [ran, the gate's own configuration and a real
compiler: `hooks/.test.ts`, `tests/.b.test.tsx`, `tests/.deep/c.test.ts` and `hooks/.hid/a.test.ts`, each
holding a type error, were not reported; `tests/ok.test.ts` was]. `claude plugin test` runs `hooks/.test.ts`
and `tests/.b.test.tsx` [ran]. So an edit could freeze such a test file at Red without it ever being
typechecked.

**Built** (`317aabf` red, `cbd061d` green; no existing test changed) [ran]: the typecheck names each test
file that is source the compiler reads once named (`.ts`, `.tsx`, `.mts`, `.cts`) and that the three folders
do not reach: one outside them, or inside them under a `node_modules` folder or a name that opens with a
dot. 9 logic tests; 389 of 389 rules, validate and script tests, 216 of 216 module tests, validate and the
typecheck pass; the verifier's PASS with 7 mutants. With the real compiler and the configuration the built
rule writes, all six such files' errors are reported [ran].

**The independent read** of the first four tests found the `node_modules` case, `.mts` and `.cts`, and five
mutants no test failed (a dot folder three levels down, a dot before a character that is no letter, the
three folders compared without regard to case); each has a test now. It also showed a file named in upper
case (`u.test.TS`) is read by the compiler neither in a folder nor when named, so the rule does not name it,
and the engine does not run it (8.11).

**Left, for the owner:** a build's typecheck has the same blind spot for `tests/.x.test.ts`, since a build
names no test file; 0.1.0 is unchanged here. The compiler reads a named path as a pattern, so a test file
whose name holds `*` or `?` also draws in its siblings; they are test files too.

### 8.13 Every test file is named: the stop-time review's second finding (2026-11-11, at `f8e1d16`)

**The finding** (Codex's stop-time review of 8.12): "The typecheck coverage fix still silently omits test
files." 8.12 named the test files a folder does not reach by listing what the compiler passes over; the list
was short. In a folder it is given the compiler also passes over `bower_components` and `jspm_packages`
[ran: `tests/bower_components/b/b.test.ts` and `tests/jspm_packages/j/j.test.ts`, each holding a type error,
were not reported; named, they were]. Which files a folder reaches is the compiler's own list, and a rule
that copies it is wrong whenever the list is longer than the copy.

**Built** (`64fe551`, the three existing tests that said a reached file is not named, in a commit of their
own; `8655f55` red; `f8e1d16` green) [ran]: `typecheckConfig` names every test file of the edit that is
source the compiler reads when named (`.ts`, `.tsx`, `.mts`, `.cts`), wherever it lies, after the types file
and the three folders. 7 logic tests; 396 of 396 rules, validate and script tests, 216 of 216 module tests,
validate and the typecheck pass; the verifier's PASS with 6 mutants. With the real compiler and the
configuration the built rule writes, the seven probe files' errors are all reported [ran].

**The independent read** tried, with the real compiler, every kind of path it could think of named in
`include` [ran, by that agent]: spaces, `*`, `?`, brackets and braces in names, a folder named `**`,
`node_modules`, `bower_components`, `jspm_packages` and dot folders at several depths, folders named `out`
and `dist`, a 376-character path, a linked file and a linked folder. Each was checked. It added three tests
(the order of names that differ in letter case, 300 names, a name that is a test's only in other letter
case).

**What is still not checked, known and left:**
- A declaration file named as a test (`tests/e.test.d.ts`): the gate's typecheck runs with `skipLibCheck`
  (8.2, fact 6), which passes over every declaration file, named or not. `claude plugin test` was not seen
  to run one.
- A file whose name holds a backslash: the compiler reads the backslash as a folder separator.
- A file named in upper case (`u.test.TS`): the compiler reads it neither in a folder nor when named, and
  the engine does not run it (8.11).

**What it costs:** everything under `tests/` is a test file of an edit, so source under
`tests/node_modules/` is now typechecked, where the compiler used to pass it over. A dependency kept there
that does not typecheck refuses Red while `tests/` is open. The named files are in `include`, not `files`,
so one that is gone when the compiler runs is passed over rather than stopping the check.

### 8.14 Test files as root files: the stop-time review's third finding (2026-11-11, at `0a678a2`)

**The finding** (Codex's stop-time review of 8.13, with TypeScript 5.6.3's compiler API): "naming files in
`include` does not guarantee checking them … `tests/a.test.ts` suppressed `tests/a.test.tsx`; the latter's
type error produced no diagnostic. An explicit `files` control reported TS2322. Use explicit file roots and
add a compiler regression covering this collision." Reproduced by the building session on the compiler's
command line [ran, TypeScript 7.0.2, and 5.6.3 by the reader]: through `include`, of two files that differ
only in their ending the compiler keeps one, whether a folder reaches them or both are named there; named
under `files`, both are checked.

**Built** (`b402e25`, the existing tests reading the folders and then the named files, in a commit of its
own, none failing; `e31114a` red; `0a678a2` green) [ran]: `typecheckConfig` names an edit's test files under
`files`, and `include` holds the types file and the three folders alone; with no test file there is no
`files` key and the configuration is a build's to the byte. 6 tests, two of which run a real compiler on the
configuration the rule writes: one on the pair `tests/a.test.ts` and `tests/a.test.tsx`, which failed at the
red commit with only the first reported, and one on a dot name, `node_modules`, `bower_components`, `.mts`,
`.cts` and a file outside the three folders. 402 of 402 rules, validate and script tests, 216 of 216 module
tests, validate and the typecheck pass; the verifier's PASS with 5 mutants. CI installs a TypeScript compiler
so that the two tests run there; where there is none they are reported as skipped.

**The independent read** [ran, by that agent, on 7.0.2 and 5.6.3] found no test file whose error is lost
under `files`: every pair of the four endings, a file beside a declaration file or a `.js` of its name, a
file both reached and named, and the odd paths of 8.13. It found the two compiler tests failed under a
terminal or with `FORCE_COLOR` set, because the newer compiler then prints its errors in another shape, with
colour; the tests now pass `--pretty false`.

**What step 2 owes because of this:**
- **The gate must run the compiler with `--pretty false`.** `typecheckErrors` reads the plain shape
  (`path(line,column): error TS…`). In the other shape it reads nothing, and `testsFit` then refuses ("shows
  no error line to read"): safe, and stuck. The hooks module's command has no such flag today; a build only
  quotes the output, so 0.1.0 is not affected.
- A named file that is gone when the compiler runs now stops the check (`error TS6053`, which names no file
  and refuses) where `include` passed it over. The hooks module lists the test files just before each run.
- Two test files whose names differ only in letter case stop the check the same way (`error TS1149`).

**Still not checked, as in 8.13:** a declaration file under `tests/` (`skipLibCheck`), and a name that holds
a backslash. A build's typecheck names no file, so in a build `tests/.x.test.ts`, and `tests/a.test.tsx`
beside `tests/a.test.ts`, are not typechecked: 0.1.0's gap, for the owner to weigh with step 2.

### 8.15 Step 1 accepted; an edit no test can see takes a refactor route (2026-11-11)

**Step 1 is accepted** by the driving session at `c5a9e60` (8.12 to 8.14 included), on its own run (400
rules tests passing and 2 skipped for want of a compiler, 216 of 216 module tests, validate) and its own
probe on real `claude plugin test` output from a copy of `scratch/mydemo3/tool-log` [ran, by the driving
session, 2.1.322]: a changed expectation passes `editRedGate` only when its file is handed in as changed,
and `testFilesToAsk` names the file; a new `lib/extra.test.ts` that throws `new Error('AssertionError:
pretend')` is refused as not failing by assertion (the engine printed `Error: AssertionError: pretend`); a
stray test file reusing a baseline name passes only through the changed file, and the engine runs it;
`tests/../hooks/register.tsx` is refused at Red and `lib/X.TEST.TS` at Green; `1.2.10` is greater than
`1.2.3`, and `1.2.4-rc1`, `v1.2.4`, the number `1.3` and `0.1.1` with a line end after it are refused. "Your
decisions listed in 8.11 'for review' stand as written."

Seen in that probe, not a defect: a test turned off with `test.skip(` shows in 8.4's question only as line
counts, because the removed line holds no `expect`. Left to the building session, which decides it in step
2's plan; a removed line quoted for opening a test counts inside the same 20.

**The refactor route.** 8.11 left open an edit that changes nothing a test can see (a tidy-up, a manifest
description, a README), which can never leave Red. The owner, asked in the driving session what such an
edit should do: "Refactor route (Recommended)".

- The gate's call that asks for Spec's approval may say the change is "no behaviour change". The approval
  question then says so in its text and offers three options: "Not yet" first, then the usual approving
  option, then one that approves it as a change with no behaviour change. Only that third answer takes the
  route; the usual approving answer sends the edit to Red as normal.
- On the route Red is skipped (`RedMode` `skipped`, as in a repair whose test files fit). From Green on
  every test file is held to the baseline's hashes.
- Green ends when the four checks pass, the test run shows the baseline's count and the baseline's names
  with none failing, and the version is greater. Verify and Done are as in any edit.
- It is not offered when the baseline has no test file or its test run showed no count: such a mod enters
  Red (8.10, answer 1). So the null count of 8.11 can't arise on this route; for a repair whose Red was
  skipped, step 2's plan proposes the comparison.
- No phase is widened: this is the refactor step of test-first work, with the tests closed and passing.
- The section appended to the mod's `SPEC.md` says "No behaviour change" in its first line, so the record
  shows which route the edit took. The pane shows Red as skipped, with the reason.

### 8.16 The pane is rebuilt to the mockup in 0.2.0 (2026-11-11)

The built pane is plain text lines and does not match the mockup the owner approved. The owner, asked in
the driving session when it should be rebuilt to the mockup (status line, phase rail, evidence rows, guard
toast): "In 0.2.0 (Recommended)".

- It is part of step 2's "the pane" (8.9), as a plan of its own, for a build and an edit alike.
- The reference is the six frames in `docs/design/` (Main, Spec, Guard, Build, Verify, Done), each as its
  exported source and a picture; the pictures are what the pane is compared with.
- Only surfaces Anthropic's cached documents name are used (a pane, the status line, a toast, a band), each
  cited by page and line. Where a frame shows something the API can't draw, this file says so and the
  nearest thing is built; nothing is dropped in silence.
- Before the plan, the building session lists each element of each frame with the surface and the call it
  will use for it, and the driving session reviews that list against the pictures.

### 8.17 Putting a mod back keeps its git history: a correction to 8.5 (2026-11-11)

8.5's restore point leaves out `.git` and `node_modules`, so a mod put back would come back without them,
its history left in the `.stopped-` folder (8.10's audit, and a side agent's note). The driving session's
correction, inside the owner's "Backup copy (Recommended)": when a stopped edit is put back, after the
rename and the copy, the mod moves `.git` and `node_modules`, when present, from `<mod>.stopped-<stamp>`
into the restored `<mod>`. Nothing is deleted; the answer names what was moved. It is tested with a real
folder that holds both.

### 8.18 The pane's design: each frame's elements, and the surface and call for each (2026-11-11)

The building session's list, approved by the driving session against `docs/design/png/` "as written, the
differences you named included", with six points (below). Citations are page:line in snapshot
`2026-11-10T194027Z`. Colours are theme keys, so they follow the person's theme and not the mockup's hex.

**On every frame**

| Element in the frames | Surface and call | Note |
|---|---|---|
| The rounded frame around the pane | the pane: `$.ui.open({ id, title })`, drawn by `ui.render` on `{ component: 'Pane' }` [read: interface.md:186-190, :290-294] | The engine draws the frame and places the pane. No border of the mod's own. |
| `MOD BUILDER`, bold, letter-spaced | `Text` with `bold` [read: interface.md:518] | A terminal has no letter-spacing: plain bold capitals. |
| The state at the right of the header | a `Box` row with `justifyContent: 'space-between'`, `Text dimColor` [read: reference.md:282-283] | `color: 'warning'` after a refusal; `'success'` at Done. |
| The phase rail | a `Box` row with `flexWrap: 'wrap'` and `columnGap`; done phases `color: 'success'` with a check mark; the current one a `Text` with `backgroundColor` and `bold`; later ones `dimColor` | `backgroundColor` "fills only as wide as the text" [read: gallery.md:128], which makes the chip: `'suggestion'`, and `'success'` for Done. |
| The rule under the rail | a `Text dimColor` of `─` repeated to `e.props.bodyColumns` [read: reference.md:270] | No rule element is documented. |
| Headings and aligned rows | `Text bold`; a row is a `Box` row of cells with a `width`, long cells `wrap: 'truncate-end'` | |
| The line at the bottom left | `$.ui.status(text)` [read: api.md:211] | **Differs:** the engine opens it with `⚠` and the mod's name. |
| The toast | `$.ui.toast(text)` [read: api.md:212] | The engine adds the mod's name and places it. |
| `mockup`, `[N] are placeholders` | not built | Notes on the mockup. |

**Frame by frame**

| Frame | Element | What is drawn, and from what |
|---|---|---|
| Main | the line under the prompt | a transcript line with `$.ui.log` when a build or an edit opens [read: api.md:213]. **Differs:** it opens with `●` and the mod's name. |
| Main | the Knowledge block | from the cache's `checked`, `latest`, `manifest.tsv` and `_changes.md`, and the session's version; changed headings only where `_changes.md` holds them; "refreshing…" while a fetch this session started runs. |
| Spec | the four blocks of the spec | **Nearest thing:** the mod's `SPEC.md` itself, with `Markdown({ text })` [read: interface.md:520], cut to the pane's rows. A free-form spec can't be cut into those four blocks reliably. |
| Spec | the approval dialog, "Approve" first | `$.ui.ask` as now [read: events.md:147]. **Differs on purpose:** "Not yet" stays first (3.3). The mockup's hint about `hooks/` and `tests/` goes into the question's text; the dialog's own rows are the engine's. |
| Guard | the refused call in the transcript | the engine's own row for the guard's `{ deny }` [read: events.md:67-71]. **Differs:** the refusal keeps its wording, which tests pin. |
| Guard | "1 edit refused" in the header and the status line | a count of refusals for each phase, in the record. |
| Guard | the toast on a refusal | `$.ui.toast`, once for each phase (point 1). |
| Guard | the table of what each phase may write | from the rules' own table, shown from a refusal until the next gate passes; an edit shows the edit's. |
| Build | "approved 15:31 · building" | from the record's approval time. |
| Build | a passed phase with its detail lines | the gate's recorded evidence for that phase, in rows. **Differs:** the file list, "expected 1, received 0" and function names are not recorded by any gate. |
| Build | the current phase, "working…", with the failing test | the last refused gate's reason and failing test names, in the record. |
| Verify | the four checks, each passed or running, with its command | one row for each check with the command the gate runs; "running" is drawn between checks (probed below). |
| Verify | "what the debug log must show" | **Differs:** the rows are what the gate reads: the `hooks module <name>@inline loaded` line, no line that says it failed to load, no skipped hook. The gate's load runs `/cost`, so there is no row for a command's answer. |
| Verify | "Unchanged since their gates" | from the gate's comparison of hashes. |
| Done | the header with the version | read from the mod's `plugin.json` by the gate. |
| Done | "What was built" | files and tests counted, and the "Built on" line. **Not built:** "3 local commits": the plugin makes none. |
| Done | "Try it" | the command's name from validate's `answers its own command` line; without one, the first half only. |
| Done | the second box, the new mod loaded | **Not built:** that is the built mod's own pane. |

**For an edit, beyond the frames:** a rail of seven phases, the header naming it an edit with the version it
had; a skipped Red drawn dim with its reason ("no behaviour change", "the test files fit"); a repair's
failing baseline checks as a block; 8.4's answer and the files it covered as an evidence row; a stopped
record with the header saying so and the rail dim.

**The six points** (the driving session):
1. The toast on a refusal comes once for each phase; the header and the status line carry the count.
2. No band in 0.2.0 (`BACKLOG.md`).
3. **The pane only draws.** `ui.render` reads the record and the cache's files; it runs no command and makes
   no request. What it newly needs (refusals for each phase, the last refused gate's reason and failing test
   names, each check's state inside a gate) is a field the gate or the guard writes. A record without those
   fields draws as zero or empty, so a 0.1.0 record still draws. No gate's verdict reads them.
4. The status line is cleared when the record reaches Done or is stopped, and when a new session finds no
   open record.
5. The four probes below are run before the plan.
6. Tests: one module test for each frame, which mounts the pane on a record for that frame and finds its
   rail state, its heading and one row; and the edit rail, a skipped Red with its reason, a repair's failing
   checks, and a stopped record. The existing pane tests change in a commit of their own first.

Also decided by the building session, the driving session agreeing: 8.4's question quotes a removed line
that opens a test (`test(`, `it(`, `test.skip(`) as it quotes one that holds `expect`, inside the same 20.

**The four probes** [ran, 2.1.322, a probe mod's pane in an interactive session in a terminal, 150 columns
and then narrower, the pane placed above the prompt (`placement: 'inline'`)]:
- **`justifyContent` and `flexWrap` draw as meant:** `MOD BUILDER` at the left edge and the state at the
  right; the rail on one line at 150 and 100 columns and wrapped onto two at 72 and 50. A `Text` with
  `backgroundColor` draws the current phase as a chip.
- **The pane redraws inside a running call.** A `tool.call` hook that set a value, called
  `$.ui.invalidate('ui.render')` and awaited a five-second process twice showed its first, second and last
  value in turn while the call was pending; a `command.run` hook did the same. So the Verify frame draws a
  "running" row.
- **`$.ui.status(undefined)` clears the line**: `⚠ pp: knowledge · snapshot …` appeared under the prompt
  and was gone after it.
- **Narrow widths:** the pane drew at 100, 72, 50 and 34 columns; nothing stopped it drawing. At 34 the
  header no longer fits on a line. A cell with a `width` shrinks and wraps its word (`validat` / `e`) once
  the row is wider than the pane, so each cell is cut with `wrap: 'truncate-end'` and not left to wrap.
  **Not probed:** the pane beside the transcript (`placement: 'dock'`), which needs a wide fullscreen
  terminal; its width is at most 45% of the terminal's [read: interface.md:311].

### 8.19 Step 2, the hooks module of an edit, as built (2026-11-11, at `e09e04d`)

Built by the building session through the three agents, each plan read first by an agent that did not write
its tests (7.2). Local commits on `edit-skill`; nothing is pushed.

| Plan | What | Commits | Verifier |
|---|---|---|---|
| 27 | The rules the hooks module asks: what opens an edit, its record and restore point, the refactor route (8.15), the stop, 8.4's question quoting a line that opens a test | `aa78f38` (two existing tests), `bb2305b` red, `b87206d` green | PASS, 17 mutants; 444 node tests |
| 28 | `scripts/restore-point.sh` and `scripts/put-back.sh`, tested on real folders | `4576109` red, `0e3fe0c` green | PASS, 18 mutants; 467 node tests |
| 29 | `hooks/register.tsx`: the edit skill opening a pending edit, the baseline and restore point, each gate of an edit, the refactor route, 8.4's question, `/mod-builder stop` | `25d3b8c` (existing module tests), `dcc7066` red, `e09e04d` green | PASS, 23 mutants; 285 module tests, 467 node tests |

**Decided in the plans where section 8 is silent** (the building session; for the owner's review):
- "No behaviour change" is read in the appended section's first line of text after its heading, at the line's
  start, in any letter case. A section that holds only a heading passes Spec's check that one was added.
- The refactor route needs a baseline test file by name, a count above 0 and at least one name. On it each
  name runs as often as the baseline had it. Green on a skipped Red refuses a record that does not say why Red
  was skipped.
- The gate tool takes a second input, `no_behaviour_change`; only `true` is a claim, and a claim on a mod the
  route is not offered for is refused before anybody is asked.
- A mod that one of its own baseline checks writes into opens no edit: the baseline is what the restore point
  holds. The baseline's answer quotes each failing check's last lines.
- At an edit's Red the order is: SPEC.md as approved, the test files hashed, the test run (in a repair, the
  typechecks alone), the typecheck, 8.4's question, the test files hashed again, SPEC.md again. A repair that
  entered Red records no test count: Green holds its test files by their hashes.
- The version is judged at Green and again at Verify.
- `/mod-builder stop` marks the record stopped before it unbinds the session; it leaves a record that is Done,
  already stopped, missing or another session's as it is; for a build it asks nothing. The stopped folder is
  stamped with the time of the stop. Left out of the baseline's hashes and the restore point: `.git` and
  `node_modules` at the mod's top only.
- The restore point is complete only when a `.complete` marker stands beside its folder; `put-back.sh` refuses
  one without it, compares folders with `-ef` and not by spelling, and takes a stopped folder only when it is
  `<mod>.stopped-*` beside the mod. Modes are kept both ways.

**What the independent readers found, and what was done:** in the scripts, a half-made restore point could be
put back, and a link could stand in for the mod's folder (the marker and the `-ef` checks answer both). In the
hooks module's draft: stop acted on an edit that was Done, stop's two writes were in the order that could leave
a record open, the wording at Done was a build's, and the baseline was hashed again by comparing texts; each
was fixed before the red commit, with 28 tests added.

**Probed** [ran, 2.1.322, an interactive session in a terminal, a real mod in a scratch folder, the installed
copy of mod-builder switched off]:
- The whole edit: the edit skill opened a pending edit; the gate took the baseline (four checks) and made the
  restore point before any write; Spec's dialog; Red with a new failing test; 8.4's question when a baseline
  test file was changed; Green; then `/mod-builder stop` with "Put it back", which renamed the folder and
  restored the mod.
- A `command.run` hook can ask with `$.ui.ask`: `/mod-builder stop`'s question appeared and its answer was read.

### 8.20 Step 2, the pane rebuilt to the mockup, as built (2026-11-11, at `1735192`)

| Plan | What | Commits | Verifier |
|---|---|---|---|
| 30 | The pane's rules in `hooks/mod-builder-logic.ts`: `paneModel` and what it reads | `080e055` red, `31b8e6e` green | PASS, 31 mutants; 78 logic tests, 545 node tests |
| 31 | `hooks/register.tsx` draws the pane, sets the status line and the toasts, and writes what the pane reads | `ac2bfd2` (existing tests), `d2f5127` red, `1735192` green | PASS, 38 mutants; 330 module tests, 545 node tests |

**How it is built.** `paneModel` is a pure rule: from the session's entry, its record, two store values and
the cache's files it answers the header, the rail, the blocks of rows and the status line. The hooks module
draws that with `Box`, `Text` and `Markdown`, and calls `$.ui.status`, `$.ui.toast` and `$.ui.log`. What the
pane newly needs is written by the guard and the gate, and read by no verdict (point 3):
- `refusals:<folder>` in the store: the guard's count of refused writes for each phase, the last one, and
  the phases that had their toast. The guard never writes the record.
- `checks:<folder>`: each of the four checks' state (waiting, running, passed, failed) while Green's or
  Verify's gate runs them.
- `record.attempt`: the last refused gate's reason, the failing tests' names and how many passed.
- `record.finished`: at Verify's pass, the version, the files and tests counted, the command the mod answers,
  and the gate's own "Built on" line.

**Differs from 8.18's list, or adds to it** (the building session; listed for the driving session):
- After a refused write a build's header says `<name> · 1 edit refused · phase Spec`: the frame's words with
  the mod's name kept before them (the first reader: without it the header no longer said which mod). In an
  edit, where "edit" names the work itself, it says `1 write refused`.
- The refusals and the check states carry the session's id and are read only when it matches, and both are
  emptied when a record opens; every gate starts by emptying the check states. This stands in place of the
  start time the first reader asked for: a build's record has none.
- The Guard table has a row for Knowledge, Describe or Done only while that is the current phase. From
  Knowledge, Spec's row says the snapshot comes first.
- At Red the status line says how many tests fail; at Scaffold and Green how many pass.
- A check that failed turns Verify's header and status line to say which did not pass; beside a refused write
  both are kept.
- A refused approval is drawn above the spec, not beneath it: on 2.1.322 a spec longer than the pane cut the
  row off.
- The Verify frame shows the four checks and not Green's evidence, which stays in the record; Done shows
  Verify's. Two existing tests that read Green's evidence from the pane at Verify now read it from the record.
- Done's "built on" row is the gate's own "Built on" line, which names the types the typecheck ran against;
  a record without it (0.1.0's) gets a shorter line. An edit's shorter line says "checked on".
- Two toasts beyond the refusal's, both in the frames: "mod docs refreshed, N pages changed" after a fetch
  that made a new snapshot, and "<mod> is built · 4 of 4 checks passed" at Done ("is edited" for an edit).
- The approval question of a build gains the frame's hint: "Nothing under hooks/ or tests/ can be written
  until you approve." An edit's question already said what may be written; the rule's wording for an edit
  (`approvalHint('edit')`) is built and not used.
- The transcript's line when a build or an edit opens comes once, not again while it waits for its folder.
- `/mod-builder` alone answers with the header's words and the rail's current phase, then the cache as before.
- `changesIn` reads `_changes.md` as `refresh-docs.sh` writes it, a heading being a list item that keeps its
  `#` marks; the test's fixture is that script's output on two folders made for it.
- Text shown has its control characters, the zero-width marks and the direction overrides replaced by a
  space; a refused path over 120 characters is cut, its end kept. A fetch stamped ahead of the clock is said
  with its stamp.
- **Not built, as 8.18 said:** the band; "3 local commits"; the built mod's own pane; a row for a command's
  answer at Verify.

**A defect of the gate found while building the pane, and fixed in plan 31.** A gate wrote the record it had
read before its checks, so a build or edit stopped while its gate ran (the approval question can stay open
for minutes) was moved on and made open again, and an edit that had been put back was marked on. The second
reader found it because the Done toast would have announced it. A gate now moves the record only while it is
still this session's open record at the same phase, and otherwise answers that nothing was moved.

**What the independent readers found.** The first read the rules' first draft: 92 of 239 mutants survived, and
the draft threw on damaged stored values, counted for every session of a folder, and did not read the real
`_changes.md`. The second read the revision: 51 of 335 survived (about 15 equivalent), with control characters
reaching the check rows and a doubled slash. The third read the hooks module's draft: 70 of 167 survived, with
writes refused side by side each toasted and under-counted, check states of an earlier gate shown after a gate
that refused early, and the stop above. Those defects were fixed before the red commits, with tests.

**What stays untested or thin** (the third reader's 167 mutants, run again on `1735192`: 21 no longer apply,
118 fail a test, 28 survive, 10 of which that reader judged equivalent):
- A check's state between its own command and the gate's verdict (a mutant that marks it passed regardless
  survives, because the gate marks the check it refused at); the load's state when its log does not show the
  mod, apart from one case.
- The test run a refusal carries at an edit's Red and at a skipped Red (only a build's and an edit's Green
  are tested).
- The bookkeeping's own failures: a state, a refused gate or a settled state that can't be written (the test
  world has no failing store write), and the settle after a check that throws.
- The redraws around a fetch, and the gaps between cells. The test world does not see `$.ui.invalidate`.
- In the rules: the spec's markdown is not cut to the pane's rows (the engine cuts what it draws); several
  tests pin the wording of the write tables by copying it.
- The module test that no gate reads the pane's fields runs one passing Green gate; it does not run a refusing
  gate, Spec, Verify or the guard with damaged values.

**The stopped frame is not reached by `/mod-builder stop`.** The stop unbinds the session, so the pane then
says "no build or edit in this session" and the status line is cleared (point 4 holds). The rule's drawing of a
stopped record (header "stopped at <phase>", dim rail) is reached only when a record is stopped while the
session is still bound to it, which the tests arrange by hand. For the driving session: leave it, or keep the
session's last folder so the pane shows what was stopped.

**Differences from the pictures that 8.18 did not list** (the second reader): Main draws "N changed, N added, N
removed" where the picture has "N changed, N the same"; the approval time is said with "UTC"; Verify's "6 of
6" and "0 errors" are not drawn (the gate records a count at its end, not per check); "Unchanged since their
gates" is a fixed row that says what the gate compares, not a result. And 8.18's Guard row says the count of
refusals is "in the record": it is beside it, under `refusals:<folder>`, so that the guard never writes the
record.

**Probed** [ran, 2.1.322, two interactive sessions in a terminal of 150 columns, the hooks module loaded with
`--plugin-dir` (the second with the file plan 31 committed, by its sha256), each a real build of a small pane
mod in a scratch folder]:
- Main: the header with the state at the right, the rail with the current phase as a chip, the rule, the
  Knowledge block, and the status line `⚠ mod-builder: build · waiting for the mod's folder`.
- Spec: the approval dialog with the hint in its text; after "Not yet", the spec drawn as markdown.
- Guard: after a refused `Write`, the header `hello-probe · 1 edit refused · phase Spec`, the table with
  `now` on Spec's row, and the status line `spec · 1 edit refused · waiting for your approval`.
- Build: `hi-probe · approved 08:52 UTC · building`, `3 Spec passed` with its row, `4 Scaffold working…`.
- Verify, while its gate ran: `passed validate`, `running test`, the other two waiting, and the status line
  `verify · 1 of 4 checks passed · test running`.
- Done: `hi-probe 0.1.0 · built and checked`, "6 files · 3 tests", the gate's "Built on" line, "Try it" with
  `/hi-probe`, and the status line cleared.
- A headless session loads the committed module: `claude --plugin-dir plugins/mod-builder -p /cost
  --debug-file <log>` exited 0, and the log holds `hooks module mod-builder@inline loaded` and no line that
  says a hook was skipped or failed.
- **Not seen:** the toasts (gone before a capture of the screen); "refreshing…" while a fetch runs, and writes
  refused side by side (both rest on a variable of the module that only the test world has exercised); an
  edit's frames, a repair and a stopped record, which are held by module tests alone.

**Known and left** (limits; `docs/limits/README.md` is step 5's to update):
- A gate call the engine cuts off leaves its check "running" until the next gate starts.
- Between a gate's last look at the record and its write there is no lock: a stop that lands in between is
  still written over.
- A long folder path fills its row: the table's heading, Done's rows and the check commands are cut at the
  pane's width, and "then" before the command at Done was squeezed to "th…" in the probe.

### 8.21 Open after step 2, for the owner

- **A claim of "no behaviour change" with the plain "Approve".** The edit then goes through Red with that
  sentence in its section. Leave it, refuse the plain answer on such a call, or have the gate ask for the
  section to be rewritten first.
- **A build names no test file to the typecheck** (8.14 is an edit's rule), so `tests/.x.test.ts`, and
  `a.test.tsx` beside `a.test.ts`, go unchecked in a build. Leave it, or give builds the same rule.
- **8.11's open points still stand:** a test file that typechecks but does not load at a repair's Red; the
  plugin's own source edited from an installed copy.
- **The header's wording after a refused write** (8.20) changes an approved frame's text by adding the mod's
  name, and uses another noun in an edit.
- **A gate has a new answer** (8.20): "was stopped or moved while this gate ran, so nothing was moved". It was
  decided by the building session while fixing the stop defect, without the driving session.
- **The stopped frame** (8.20): leave it unreachable by `/mod-builder stop`, or keep what was stopped in view.

### 8.22 The driving session's review of step 2: five fixes to the pane (2026-11-11, at `e3dae77`)

The driving session reviewed step 2 at `979021f` on its own runs (543 node tests passing and 2 skipped for
want of a compiler, 330 of 330 module tests, validate; the two scripts on a real git folder; a live build to
Done with the pane captured every 20 seconds). "Your six decisions stand, the gate's new answer for a record
stopped while its gate ran included." It asked for five fixes, built as plan 32: `245afbe` (existing tests),
`8b2882c` red, `e3dae77` green; verifier PASS with 22 mutants; 347 module tests, 558 node tests.

1. **Hashes no longer swamp a row.** In the pane only, a whole sha256 is shown by its first 12 characters,
   and "types sha256" followed by two or more is said as "2 types files" in a gate's evidence, the baseline's
   rows, a refused gate's reason and "What was checked". The "Built on" row keeps each hash, cut to 12. The
   record, the gate's answer and the mod's `SPEC.md` keep them whole.
2. **Verify's rows carry a result**: "2 of 2" beside the test row (passed of ran, from the run's own count)
   and "0 errors" beside the typecheck row (the lines the compiler printed that hold `error TS<n>:`), once
   each has ended. A compiler that failed and printed no such line shows no count.
3. **The load's rows name the mod from the start**, from its `plugin.json`, read when the pane is drawn.
   The three rows are one reading: the gate reads the load's debug log once, after the run, so they turn
   together, and they show "found" only between the load's end and the gate's answer, after which Done's
   frame replaces Verify's.
4. **A write refused at Done is counted and toasted**, and Done's "What was checked" counts it.
5. **What `/mod-builder stop` stopped stays in view** until the session opens another build or edit: the
   header says stopped, the rail is dim, and a "Stopped" block says, for an edit, which answer was given and
   names the two folders. The session stays unbound: only the folder's name is kept, under
   `stopped:<session>`, which the guard and the gate never read. The answer is written into the stopped
   record once the person has given it, and only while that record is still the one this stop stopped.

"Put it back"'s answer now adds, when the script moved `.git` back: "The mod's git history is as it is now,
commits made during the edit included: git shows the restored files as changes against them."

**"Unchanged since their gates"** (the driving session did not see it in its captures): the row is built, and
is the last block of the Verify frame at every state of the checks; in a pane of few rows it is below the
load's block and can be cut off.

**The independent reader** (77 mutants of the draft, 13 surviving, 5 of them equivalent) found three defects,
fixed before the red commit: the pane said "nobody answered" while the person was still being asked; the
answer was written from the record read before the question, over a record another session had made since;
and "0 errors" stood beside a typecheck that failed without printing an error line.

**Probed** [ran, 2.1.322, an interactive session, the hooks module of `e3dae77` with the `edit` skill's draft,
an edit of a real mod from baseline to Done]: the baseline's block, Red's evidence with "2 types files", 8.4's
question for a changed test, Done with "Built on ... 60ff86c12156, a33c3b254b7c."; then an `Edit` of
`hooks/register.tsx` at Done was refused and **the toast was seen**, at the right under the prompt:
`mod-builder: refused: hooks/register.tsx, at Done`. **Found in that probe:** the table of what each phase
may write is drawn first, and at Done it pushed "What was checked", which holds the count, out of the pane's
visible rows (a side agent's note said the same). Fixed in the next plan: at Done the table comes last.

### 8.23 An edit whose Red was skipped asks the person at Green (2026-11-11)

A side agent's note: on the refactor route (8.15) new behaviour that no test covers passes Green, because
the old tests still pass. The owner, asked in the driving session what guard the route should have: "option
1 seems sound" (option 1: "Show changes, ask": the mod asks the person with the list of changed files and
their line counts, "Not yet" first). The design is the driving session's, reviewed by its advisor; the
building session records it here before building it.

1. **Asked at Green's gate**, after the four checks and the version check pass, while every file it judges
   can still be changed (7.10). Only the exact approving answer passes; "Not yet" is first; any other answer
   keeps the edit at Green.
2. **Asked whenever Red was skipped**: the refactor route, and a repair whose test files fit the build. The
   second is the driving session's application of the owner's answer to the same opening.
3. **The question names** each file changed, added or gone since the baseline, by the baseline's hashes, with
   its lines added and removed against the copy in the restore point, at most 20 files and then "and N
   more"; `SPEC.md` and test files are left out (the first is approved at Spec, the second are held to the
   baseline's hashes). It says how many tests are held unchanged and that they are the only check of
   behaviour, and names the restore point. When what `claude plugin validate` reports that the mod hooks,
   answers and calls is not as at the baseline, the question says so with both; that is named, never refused
   on.
4. **What was agreed is held.** The record keeps the hash of every file the answer covered. At Verify's gate
   a file other than `SPEC.md` that differs from them is asked about again, the same way; those files can
   still be written at Verify, so nothing strands.
5. **Engine-written files are not listed.**
6. **The limit:** this is the person's judgement of a list, not proof that behaviour is unchanged; and a
   write by a shell command is outside the guard as before, though it shows in this list, which is made
   from hashes.
7. The answer and the files it covered are in the gate's evidence, and so a row in the pane.

**Facts checked before the plan** [ran, 2.1.322, a copy of a built mod in a scratch folder]:
- **The baseline keeps no validate output** (`Baseline` holds the version, the tests' count and names, the
  hashes, `SPEC.md`'s length and hash, the failed checks, the restore point and the time). So the lines of
  validate's output that say what each module hooks, which command it answers and what it calls are recorded
  at the baseline from now on; an edit opened before this has none, and its question says nothing of them.
  On the probe mod they were: `./register.tsx hooks: session.start, command.run{command=hi-probe},
  ui.render{component=Pane, requestId=hi-probe}`, `./register.tsx answers its own command:
  command.run{command=hi-probe}`, `./register.tsx calls: $.command.register, $.ui.open, $.ui.resolve`.
- **None of the gate's checks writes into the mod.** The file list was the same before and after `claude
  plugin validate --strict`, `claude plugin test` and the headless load (`claude --plugin-dir <mod> -p /cost
  --debug-file <log>`); the typecheck's `tsconfig.json` is written under the plugin's data folder (7.5).
- **An interactive session that loads the mod with `--plugin-dir` does write into it**: the folder
  `.claude-plugin/types/` (the build's types, a `tsconfig.json` and a `.gitignore`), and at the mod's top a
  `tsconfig.json` that holds only `{ "extends": "./.claude-plugin/types/tsconfig.json" }`. A person trying
  the mod during an edit makes these. So the list leaves out everything under `.claude-plugin/types/`, and a
  top-level `tsconfig.json` that was not there at the baseline and holds exactly that.

### 8.24 The question of a skipped Red, as built (2026-11-11, at `f56401d`)

Plan 33: `b05d648` (existing tests), `4e8148e` red, `f56401d` green; verifier PASS with 23 mutants; 370 module tests, 570
node tests. Built as 8.23 says, with these decisions and corrections by the building session:

- **The options and the approving answer are 8.4's**: "Not yet", then "Go on with these changes". The
  question's header is "Changes".
- **Correction to 8.23, point 5 and its third fact.** The first draft left out everything under
  `.claude-plugin/types/`. The independent reader showed that code put there would then never be listed.
  Left out now are only the files the engine is known to write: `.claude-plugin/types/tsconfig.json`, the
  `.gitignore` there, one `index.d.ts` in each folder there (a declaration file holds no behaviour), and a
  top-level `tsconfig.json` that was not there at the baseline and holds only the line that extends the
  types' own. Any other file there is listed.
- **What validate said is kept without its "(via ...)" tails.** On a larger module validate prints each call
  with the functions it is made through (`$.fs.read (via readText, hashUnder)`); kept whole, every refactor
  that moved a call would have read as a difference, on the very route this guards (the reader ran it on
  this plugin). Every line that names a module's file is kept: what it hooks, the command it answers, its
  gating hooks, its calls, and what it reads and writes of the environment.
- **The mod is hashed three times around the question.** Before the four checks, when the person is asked
  (a file written while the checks ran refuses with "ask again", and nobody is asked), and after the answer
  (a file changed while the question was open is not agreed to).
- **At Verify** the question is asked only when a file is not as agreed at Green; a record at Verify that
  holds no agreement (one made before this rule) is asked as at Green. Lines are always counted against the
  restore point's copy, and the question says so when it is asked again.
- **Correction to 8.23, point 4.** "Those files can still be written at Verify" does not hold for `hooks/`,
  which is closed there. A change to `hooks/` found at Verify came from outside the guard (a shell command,
  or the person's own editor); after "Not yet" it goes back the same way, or the edit is stopped (8.5).
- A file whose copy can't be read as text is listed as changed with "its lines can't be compared".
- **In the pane** the answer is a row of a block "What the person agreed to" in the Verify frame, and of
  "What was checked" at Done; 8.4's answer at Red is shown the same way. Before this, neither frame showed
  Red's or Green's evidence, so the row 8.4 promised was only visible while the edit was at Green.
- **At Done the table of what each phase may write is drawn last** (8.22's finding).

**The independent reader** ran 77 mutants on the first draft (53 failed a test) and found the two corrections
above, that Red's answer row never matched, and that a file written during the checks was agreed to
unchecked; each is fixed and tested.

**Probed** [ran, 2.1.322, an interactive session, the hooks module of `f56401d` with the `edit` skill's
draft, an edit of a real mod asked for as "move the word shown into a named constant. No behaviour change."]:
- The skill called the gate with `no_behaviour_change`, and the Spec dialog offered "Approve: no behaviour
  change" third; picking it skipped Red (the rail: "4 Red skipped: no behaviour change").
- At Green, after the four checks, the dialog "Changes" asked: the two changed files with their line counts
  (`.claude-plugin/plugin.json: 1 line added, 1 line removed`, `hooks/register.tsx: 4 lines added, 1 line
  removed`), "The 3 tests the mod had before this edit are held unchanged and pass: they are the only check
  of behaviour.", the restore point's path, "Not yet" first.
- "Not yet" answered: "still at phase 5 (Green). Not passed: the person has not agreed to the changes made
  with Red skipped (answer: "Not yet")."
- Asked again and answered "Go on with these changes": Green passed with the answer in its evidence; Verify
  passed with nothing asked; Done's "What was checked" shows the answer's row.
- **Not probed by the building session:** an edit that adds behaviour while the old tests pass; a change
  made at Verify being asked about again; a file the engine wrote being left out (this session loaded
  mod-builder, not the mod, so the engine wrote nothing into it). Each is held by a module test, and the
  driving session's own probe covers them.

**Limits** (also in `docs/limits/README.md`):
- The question is the person's judgement of a list of files and line counts. It is no proof that behaviour is
  unchanged, and it shows no content: the person opens the files, or the restore point, to see.
- A write by a shell command is outside the phase guard as before; it does show in this list, which is made
  from hashes.
- `node_modules` at the mod's top is in no hash (8.19), so a change there is not listed. A link in the mod is
  listed each time, since its content is never read.

### 8.25 Step 3, the edit skill, as built (2026-11-11, at `63e7f99`)

Plan 34: `f3199f5` (the build skill's two Done tests), `23e5cdd` red, `63e7f99` green; verifier PASS with 17 mutants; 53 skill
tests, 588 node tests, 370 module tests.

- **`skills/edit/SKILL.md`** is what the model is told when a person runs `/mod-builder:edit <mod folder>
  <what to change>`. It has the build skill's shape: the three things that make it different, the lookup, a
  table of the seven phases, a section for each, then a repair, the stop, and handing a phase to a subagent.
  Its wording is pinned by `scripts/skill-edit.test.mjs`, which also holds its claims to the rules (the table
  to `mayWriteIn`, the kinds of edit to `baselineVerdict`, where "No behaviour change" stands to
  `saysNoChange`, a repair's Red to `repairRedGate`, the answers to the mod's own words).
- **The build skill's Done** now says: "Tell them that a change to the finished mod, or a repair after a
  Claude Code update, is made with `/mod-builder:edit <mod folder> <what to change>`. Offer nothing else: this
  plugin has no sharing step yet", in place of "This plugin has no edit skill".

**Made with `skill-creator`'s loop** (draft, try on real prompts, read the runs, revise), by the building
session. The tries were two edits of a real mod on the real engine [ran, 2.1.322, the draft loaded with
`--plugin-dir`]:
- "make the pane show the word hello instead of hi": the skill loaded `plugin-authoring`, named the mod, told
  the person the baseline and the restore point, appended a section, changed a test at Red (8.4's question
  appeared and was answered), raised the version, and reached Done.
- "move the word shown into a named constant. No behaviour change.": the skill called the gate with
  `no_behaviour_change`, the third answer skipped Red, Green's question (8.23) was answered "Not yet" and
  then approved, and the edit reached Done.
- **Not tried:** a repair (a mod that fails its baseline); a mod with no test file; `/mod-builder stop`
  during a skill-driven edit; whether the skill's description alone makes Claude load it for a request that
  does not name the command (`skill-creator`'s description run was not made). Step 4's demonstration covers
  a repair and the stop.

**What the independent reader found in the draft, corrected before the red commit:** a mod that fails only
for having no test file was sent to "A repair" (it is an edit whose Red writes its first tests); a repair's
Red also needs a test file to exist and still asks 8.4's question; "No behaviour change" must be the first
words under the section's heading, which the draft's bullet layout hid; a call with `no_behaviour_change` on
a mod the route is not for is refused, not merely not offered; the baseline's hashes and the restore point
leave out `.git` and `node_modules`; the table's Red and Verify rows left out the person's agreement and the
version; "anything under `tests/`" means the mod's top-level `tests/`; a test file can't be a link; a
refused first call leaves the session waiting for a folder with every plugin's folder closed.

**Decided by the building session:** the `plugin-authoring` skill is loaded in phase 1, before the gate's
first call, because the baseline runs the typecheck (a build loads it in phase 2). `/mod-builder stop` is
left to the person: the model tells them it exists and never restores or deletes by hand.

**Known:** the build skill's first heading has a space before its `#` (as at 0.1.0); not changed here.

### 8.26 The question of a skipped Red says only what differs (2026-11-11, at `1d74844`)

The driving session accepted steps 2 and 3 and the guard of 8.23 at `be44e23` on its own runs and a live
probe, with one fix (its words): "the question's 'hooks, answers and calls' block prints every line before
and now. Show only the lines that differ, and on a line of names only what was added and what is gone
(`calls: added $.ui.toast`). At Verify's re-ask show only what differs from what was agreed at Green, so an
already agreed difference is not shown again."

Plan 35: `dd055b9` (two existing tests follow the fix), `e0f530d` red, `1d74844` green; 373 module tests,
599 node tests, validate passes. The verifier's first verdict was FAIL for one reason only: the worktree
was found on `main` partway through its run (the reflog has "checkout: moving from edit-skill to main" at
15:09 UTC; neither the verifier nor the building session ran it, and no session's transcript on the machine
shows who did). Everything else was reproduced in a disposable worktree. With `edit-skill` checked out
again, clean at `1d74844`, the six commands and the end check passed: PASS, 6 mutants.

As built (`registerChanges` in the rules):

- A line of what validate said is `<module's file> <kind>: <names>`. Lines of one module and kind are read
  as one list; names are split at each ", " outside braces and outside a quoted value; "nothing" names none.
- For a kind both readings have, the question says `<kind>: added <names>; gone <names>`, a name counted as
  often as it is there (a hook registered twice is one more hook). A kind only one reading has is said as
  `new, <names>` or `gone, it was <names>`. The same names in another order are no difference, and a kind
  with no difference is not shown.
- The record keeps what validate said when the person agreed (`agreedRegisters`), at Green and again at
  Verify. Asked again at Verify, the question compares with that, under "What the mod hooks, answers and
  calls is not as when you agreed at Green:", and lists only the files changed since. A record that kept
  none compares with the baseline, under "... is not as before this edit:".

**Decided by the building session where the fix was silent:** the counting of a repeated name, the wording
for a kind only one reading has, and the fallback to the baseline.

**What the independent reader found in the draft (48 mutants), corrected before the red commit:** a name
present twice was hidden, and braces inside a quoted value split a name wrongly.

**On the real engine** [ran, 2.1.322, sonnet, the plugin at `1d74844` loaded with `--plugin-dir`, the
installed copy switched off; the building session answered every dialog]:
- A repair whose code called `$.ui.show`: Green's question read "What the mod hooks, answers and calls is
  not as before this edit:" and one line, `./register.tsx calls: added $.ui.open; gone $.ui.show`.
- An edit put forward as no behaviour change that added a toast: Green's question had the one line
  `./register.tsx calls: added $.ui.toast`. After "Go on with these changes", the description in
  `plugin.json` was changed at Verify; the question asked again read "These files are not as they were when
  you agreed at Green (lines are counted against the mod before this edit):" with `.claude-plugin/plugin.json:
  2 lines added, 2 lines removed` alone: `hooks/register.tsx` and the calls line were not shown again. Done
  then listed both answers.
- **Not run live:** a difference in what the mod registers that arises after Green (`hooks/` is closed at
  Verify, so it takes a shell command); module tests hold it.

### 8.27 Step 4, the building session's demonstration (2026-11-11, at `1d74844`)

What the driving session asked of the building session (its words): "step 4's demonstration by you of what
8.7 lists and your probes have not shown (a repair, a mod with no tests, an edit through Red that changes an
existing test)". Run by the building session, which answered every dialog, on Claude Code 2.1.322 with
sonnet, the plugin a `git archive` of `1d74844` loaded with `--plugin-dir`, the installed copy switched off.
The mods were six copies of `hi-probe` (a pane mod this plugin built for 8.20's probes: three tests,
version 0.1.0), each in a folder of its own, not copies of `tool-log` and `prompt-count`: 8.7's items 1 and
2 on those two mods are the driving session's demonstration.

The first five reached Done with the pane's "validate, N tests, the typecheck (3 types files) and a headless
load of hi-probe all pass" and "version 0.1.1, after 0.1.0". Outside the sessions the building session then
ran `claude plugin validate --strict` (passes) and `claude plugin test` (every test passes) on each, read
`version` as 0.1.1, and compared the first bytes of each `SPEC.md` with the file before the edit (the same;
the change's section and its "Built" lines follow). The typecheck and the headless load were run by the
gates only, not again outside. [ran]

1. **A repair, Red skipped** (8.7 item 6, first case; the code's `$.ui.open` replaced by `$.ui.show`, which
   this build does not have). The baseline: "fails test, typecheck: this edit is a repair". The rail showed
   "4 Red skipped: the test files fit". Green asked 8.23's question (8.26 has its text), and Done lists the
   answer.
2. **A repair that enters Red** (8.7 item 6, second case; a test's `$.ui.mount` replaced by `$.ui.render`,
   so the test file no longer typechecks). The gate's first answer: "As it stands it does not pass: test,
   typecheck. This edit is a repair. Red is entered, tests only". The test was corrected at Red, Red passed
   on "the test files typecheck", 8.4's question listed `tests/hi.test.tsx: 1 line added, 1 line removed`,
   and nothing under `hooks/` needed a change.
3. **A mod with no test file** (its `tests/` taken away). It is an edit, not a repair: Red wrote the first
   test file, two tests. Red's gate first refused ("still at phase 4 (Red). Not passed: the typecheck
   exited 1", with the output's last lines); the test was corrected and Red passed. Done: 2 tests.
4. **An edit through Red that changes an existing test** ("make the pane line read hello instead of hi").
   8.4's question: "These test files are not as they were before this edit: - tests/hi.test.tsx: 3 lines
   added, 3 lines removed", the two removed lines quoted, "These tests no longer exist: the pane shows the
   word hi", "Go on with these changes?". Done lists the answer: `the person answered "Go on with these
   changes" for: tests/hi.test.tsx (changed)`.
5. **The refactor route with a change at Verify**: 8.26.
6. **The guard and the gates during an edit** (8.7 items 3 and 4; the model was told to try each):
   - The first line of the original `SPEC.md` changed at Spec: "still at phase 3 (Spec). Not passed: SPEC.md
     no longer begins as it did before this edit: the change is written as a new section at its end, and
     nothing above it may change." With the line put back, the approval was asked.
   - A `Write` of `hooks/register.tsx` at Red: "mod-builder: hooks/register.tsx can't be written in phase 4
     (Red) of this edit, which may write test files only (tests/, and any *.test.ts or *.test.tsx). ..."
   - `tests/pane.test.tsx` removed at Red by `rm`, and `tests/hi.test.tsx` changed: 8.4's question listed
     both, "- tests/pane.test.tsx: gone (27 lines removed)" with its removed lines, and "These tests no
     longer exist: the pane shows the word hi; the pane draws its line; the command opens the pane".
     "Not yet": "still at phase 4 (Red). Not passed: the person has not agreed to the changed test files
     (answer: "Not yet")."
   - `/mod-builder stop` there, answered "Keep the mod as it is now": the pane kept the stopped frame
     ("stopped at Red", the answer, the mod's folder and its restore point). "Put it back" was not run
     again here: 8.19 and the driving session's probe at `be44e23` have it.
   - Naming the loaded plugin's own folder: "no edit was opened: ... is this plugin's own folder:
     mod-builder does not edit itself."

**Seen, and left as it is:**
- A repair's Baseline block in the pane says "fails test, typecheck" twice, in its heading row and in the
  row beneath.
- In one session the model appended the "Built" lines to `SPEC.md` with a shell command, not
  the Edit tool; no write had been refused first. The guard does not judge a shell command (`docs/limits`),
  and Verify's gate read the file as it does any other.
- With the 8.23 question asked at Green and again at Verify, Done shows two rows that begin with the same
  words, the later answer first.

**Not shown by the building session:** 8.7's items 1 and 2 on `tool-log` and `prompt-count`; item 7 on the
real engine (a record stored by 0.1.0; module tests hold it); item 5's "Put it back" on the final commit
(shown at earlier commits, as above).

### 8.28 Step 5, the documents (2026-11-11)

Changed, as 8.9 lists: `docs/limits/README.md` (two new sections, "An edit" and "The pane"; "Not built yet"
no longer says there is no edit skill), `docs/how-it-works/README.md` (an edit, phase by phase; the pane),
`README.md` (the commands table gains `/mod-builder:edit` and `/mod-builder stop`; a short "to change the
finished mod"; the limits met first), `CHANGELOG.md` (0.2.0), both manifests, and `BACKLOG.md` (items 15, 21
and 22 struck with their numbers kept, since `ci.yml` and this record cite them; 18 cut to "Going back one
phase, and a retry count per phase", 8.5's words).

**Decided by the building session where 8.9 is silent**, each for the owner to keep or drop:
- `.claude-plugin/marketplace.json` had no version: its one plugin entry now has `"version": "0.2.0"`, as
  `plugin.json` has. `claude plugin validate --strict .` passes with both [ran, 2.1.322].
- `docs/reference/README.md` is not on 8.9's list and was changed too, because "What it reaches" is read
  from `claude plugin validate`: the calls gain `$.ui.status` and `$.ui.toast`; the files gain the restore
  point and, on "Put it back", the renamed folder; the commands gain `restore-point.sh` and `put-back.sh`.
- `CLAUDE.md` (the repository's guidance for Claude Code) named only the build skill; it now names the edit
  skill and section 8, in a commit of its own.
- The plugin's `description` in both manifests still says only "Builds"; it was left.

After the changes: 373 module tests, 599 node tests (2 skipped where no TypeScript compiler is named), and
validate passes for the plugin and the marketplace [ran].

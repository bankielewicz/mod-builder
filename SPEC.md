# mod-builder: specification for the MVP candidate

Status: **approved by the owner, 2026-11-10** ("Approve as written (Recommended)"; section 6 holds each
decision). Built so far: steps 1 and 2 of section 7.1 (accepted, on `main`, the Red gate's fix of 7.3
included, and step 3, the hooks module, 7.5), step 4, the `build` skill with what 7.5 settled, on
`main` (7.7); and 7.7's decisions 1 and 2 with step 5, the demonstration and the README, on the branch
`step-5-demo`, waiting for review (7.8). What waits until after the MVP is in `BACKLOG.md`.

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
| 4 | Scaffold | the mod's files from one template (`pane`), checked against the build's types | `claude plugin validate` passes, the tests run, the typecheck passes (7.10) |
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
  - **Scaffold → Red:** `claude plugin validate --strict` exits 0. The mod records how many tests ran.
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
SPEC.md, README.md
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

**Step 1's outside read** [ran, 2026-11-10, at `62d9565`]: 25 of 25 script tests pass, and
`claude plugin validate --strict .` passes. A local server answering one page with a 301, one with an
empty 200 and one as `text/html` got `new snapshot … (3 pages)`, exit 0, with a manifest of 0, 0 and 23
bytes: a redirect, an empty page and an HTML page were kept as documentation and became `latest`. Owed
as step 1's fix round, test-first: the rule in 3.1 ("A page is kept only when it is one"), the digest's
name `_changes.md`, and exit 1 for a cache folder that can't be written.

**Accepted as built in step 1:** the two test seams (`MOD_BUILDER_DOCS_ORIGIN`, `MOD_BUILDER_DOCS_CACHE`);
a branch per step, fast-forwarded into `main` once accepted; lookup's tests on a hand-built cache; the
scripts run as `bash <script>`; `git mv` for a move. Not accepted: a co-author trailer other than the
plan's (three commits carry one; left as they are, and plans from here say the trailer is copied as given).

### 7.3 Step 1's fix round and step 2: the outside read (2026-11-10, at `b159e91`)

- **Step 1 is accepted.** The bad-server probe of 7.2, rerun on `320499d`: `…/api.md could not be fetched:
  it is empty`, exit 1, no `latest` [ran]. Script tests 46 of 46 [ran]. `main` was fast-forwarded to it.
- **The fix round's red commit `5387bce` rewrote assertions in three existing test files**, which the
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

### 7.4 The Red gate's fix and step 3: what was built, probed and left open (2026-11-10, at `70c6213`)

- **The Red gate** is to 3.3's rule (`f1ed140`, on `main`): both cases of 7.3 are refused with the runner's
  real output [ran]. New in the rules: `testNames`, whose answer the mod records at Scaffold.
- **Step 3 is built on `step-3-hooks`**, in four test-first changes, each with an independent read of its
  tests before the red commit and a verifier's PASS with every mutant failing its test: the rules the
  module asks (`5521611`), other plugins' folders closed until Done (`b5a5da0`), the module with the
  guard and the gate (`85feae0`), the refresh trigger, `/mod-builder` and the pane (`70c6213`). 160 logic
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
- **Codex's stop-time review** of step 3 (7.2) found three defects, fixed test-first in `9894c92`
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

### 7.5 Step 3: the outside read, and what step 4 starts from (2026-11-10, at `fa2df0e`)

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

### 7.6 Step 4: what was built, what the live check showed, and what is open (2026-11-10, at `278361c`)

- **The gate hook's `.catch`** (7.5's finding; `96b3f4f`): validate now reports both gating hooks `with .catch`.
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
     its fallback is built (`1b7685f`): a build is started with `/mod-builder:build <what to build>`, and
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
- **Verify's typecheck** (7.5, point 2; `3de9daa`) [probe: a throwaway mod's command, headless, no model call]:
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
- **The skill, the template and the scaffold script** (`278361c`): `skills/build/SKILL.md` (176 lines),
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
- **Codex's stop-time review** of step 4 (7.2) found two defects in the scaffold, fixed test-first in `3e75d4e`
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

### 7.7 Step 4 accepted, and the four open points of 7.6 decided (2026-11-10, at `f723825`)

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

### 7.8 Decisions 1 and 2 built, the owner's finding, and step 5: the demonstration (2026-11-10, at `fe32cd8`)

- **7.7's decisions 1 and 2 are built** in one test-first change (`30d369f` red, `fe32cd8` green; verifier PASS,
  eight mutants; the existing assertions the decisions change in a commit of their own first, `068b74e`).
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
200 columns, an empty scratch folder, the plugin as committed at `fe32cd8` exported with `git archive` and
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

- **Codex's stop-time review** of this round (7.2) found one defect, fixed test-first in `a75925d` (verifier
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

### 7.9 The two decisions of 7.8, and a correction of 7.7's decision 2 (2026-11-10, at `f56d397`)

The owner decided the two points 7.8 left open ("Both open decisions are yes; build them test-first in one
change"), and then, from the driving session's own demonstration, corrected 7.7's decision 2. All of it is one
test-first change (`2dc9d9c` red, `f56d397` green; the existing tests it changes in two commits of their own
first, `4855cb3` and `88df6cd`).

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
from `ae7cad8`); the README's "Built on" line still names one hash, the one of 7.8's demonstration.

### 7.10 A check runs while its files are open: the typecheck ends Scaffold and Red (2026-11-10, at `91d86ef`)

**The driving session's finding** [ran, by the driving session, 2026-11-10]: its second demonstration, on an
export of `762465b` (sonnet, another mod: a pane listing the last five tools used), stuck at Green again, for
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

**As built** (`58899a3` red, `91d86ef` green; the four existing tests it changes in a commit of their own
first, `4ed4c7e`) [ran]: 208 module tests, 292 rules, validate and script tests, `claude plugin
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
   after it closed. The remedy would be for Scaffold to require the test run to exit 0.
6. **What is no dead end:** a test at Red that needs a hook the scaffold does not register fails by
   assertion when it drives the mod through its events, and the hook is written at Green.

**The tightening of `4855cb3`** (`2117929`, a commit of its own): that commit made the shared helper of
`gate.test.ts` answer the first line of the gate's answer, which loosened every exact comparison in the file.
The helper answers the whole text again; the twelve exact comparisons whose answer is one line now say that
nothing follows it, and the ten whose answer goes on (quoted lines, the "Built on" line) take its first line
by name, with what follows tested in `decisions.test.ts` and `built.test.ts`. The file's unanchored pattern
matches are as they were before `4855cb3`. Read again in that commit's diff [read]: its other loosenings
are two comparisons of `decisions.test.ts` (a passed Green and a passed Verify, now by their first line
because the "Built on" line follows; `built.test.ts` compares that line) and one of `gate.test.ts` (a refused
typecheck at Verify, by its first line; `typecheck.test.ts` compares its quoted lines whole). They are left.

**Not done, or swapped:** the five tests the reader of this change asked for (the typecheck not run for any
refusal of the test run, at Red or at Scaffold; an exit 0 that wrote to standard error still passes; the
order is the hashes', not the paths') were not read a second time, and the four mutants the reader showed
surviving before them are not among the plan's eight; the reader's note that two tests pin when the types and
the compiler are looked for (after the earlier checks, where Green looks first) was kept as the plan's
decision; neither demonstration was run again on this code; macOS stays unverified.

# Duet

Delegates chosen subagents from Claude Code to Codex, gets independent Codex reviews of your diff,
and measures every run so you route by evidence rather than by assumption.

- **Codex roles Claude can pick:** duet adds `duet:codex-advisor` (a second opinion; Claude waits for
  it), `duet:codex-reviewer` (an adversarial review that arrives in the background) and, under
  `workspace-write`, `duet:codex-implementer` (makes a scoped change; Claude waits) to Claude's agent
  list. They always run on Codex. Claude-side roles stay your own `.claude/agents` files.
- **Routing:** list subagent types in `/config → duet → Subagent types sent to Codex`. When Claude
  spawns one of those (a built-in like `general-purpose`, or a custom agent from `.claude/agents/`),
  Codex does the work, with a footer:
  `[duet d1 · codex · sandbox read-only · base 45798a0 · read-only run: no files changed · one-shot run: start a new duet task to follow up]`.
  **Named, isolated and nested calls stay on Claude** (Claude names an agent when it plans to message
  it, and a Codex run can't be messaged); `/duet` says so in its routes line. Every other type stays on Claude.
- **Wait or background:** a read-only Codex run either makes Claude wait for its answer or answers at
  once and delivers the answer later as a message ("The duet plugin sent a message: Background agent
  duet-d3 … finished on Codex"). Each role has a default and `codexRunMode` overrides it. A run that
  can edit always waits, so Codex and Claude never edit at the same time.
- **Custom agents:** a routed custom agent is found as Claude finds it: duet looks in `.claude/agents/` from the session folder up to the repository root, nearest first, then in `~/.claude/agents/`, in each folder and all its subfolders, and matches on the `name` field in the file's frontmatter, not on the file name. As for Claude, the repository root is the nearest folder holding `.git`, even one git can't read; with none, the search goes up to the filesystem root. A file with no `name` or no `description`, or a `name` that starts with `-`, has a `:` or is over 256 characters, is skipped, as Claude skips it. A `name` or `description` may start on the next, indented line. Two files in one folder that share a `name` and differ on whether they can edit run `read-only`. Symbolic links are followed, as Claude follows them, and a folder reached twice is searched once. At most 8 folders deep and 500 `.md` files per `.claude/agents/` folder, its subfolders included, are read. An agent past these limits counts as not found, though Claude, which read 12 folders deep in a probe, may use it. So a search cut short runs the agent `read-only`, and its answer says the search was cut short, naming the limit; an agent that could otherwise have edited still waits for that answer. Agents from managed settings, `--agents` or an `--add-dir` folder aren't reached: on their own they count as not found and run `read-only`, but if a project or user file has the same `name`, duet uses that file, though Claude runs the other one. A plugin's agent (`<plugin>:<name>`) can't be mistaken this way, since a `name` with `:` is skipped. The matched file's body goes to
  Codex as role instructions. If its `tools:` (minus `disallowedTools`) grant no edit tool, Codex runs `read-only` regardless of the setting. Both lists may be one line or a YAML block of `- Name` lines; `Write(src/**)` counts as all of `Write`. A form duet doesn't read (a `>` or `|` block, a `[` list that wraps, a value continued on the next line) also runs `read-only`. An agent duet can't find a definition for (a built-in like Explore or Plan, a plugin's agent) also runs `read-only`; only `general-purpose` edits without one.
- **Independent review:** `/duet review` sends Codex the exact diff, never the implementer's summary.
  The review runs on Codex's own review instructions, and its verdict line (with none, its first line) lands in the pane. Duet never applies fixes or chains another round. The command answers `started` only after consent and the concurrency limit allow it; otherwise it answers `Codex review not started: <reason>`.
- **Measurements:** every Codex run and every main-loop Claude subagent is logged; `/duet stats`
  compares them. A background or teammate Claude subagent is measured when its first turn ends.
- **API providers (0.3.0, keys and tests; routing lands in 0.4.0):** `/duet provider` keeps an API key for
  a dozen model providers that share OpenAI's Chat Completions shape (Anthropic, OpenAI, Google Gemini, xAI,
  Mistral, DeepSeek, Groq, Together, Fireworks, OpenRouter, Perplexity, Cerebras, a local Ollama, and a custom
  endpoint for Azure OpenAI, LiteLLM or a gateway) in **`~/.claude/duet-data/.env`** (mode 600), never in
  the project, and tests each key for free with `GET /models`. Codex can't carry other providers: codex-cli
  0.163.0 says `wire_api = "chat"` is no longer supported, and Anthropic's and Gemini's OpenAI-compatible
  endpoints speak only Chat Completions. So 0.4.0 adds duet's own client over `$.http.fetch` for the
  text-only roles (advisor, reviewer, `/duet review`), with Anthropic through the session's own sign-in
  (`$.model.complete`); implementer and routed subagent types stay on Codex, which has tools and a sandbox.

```
 D U E T                                        1 running · 2 done · 2 failed
 ──────────────────────────────────────────────────────────────────────────
 ▸ d5   codex   gpt-5-codex  code-explorer        running   1m12s    38k tok
     "Find every caller of parseConfig and list risky ones"
     spec 3fa9c21 · base 45798a0 · sandbox read-only
   d4   codex   gpt-5-codex  review --base main   done      2m40s    61k tok
     verdict: changes requested (1 high, 2 medium, 0 low)
   d2   codex   gpt-5-codex  Explore              error     0m04s      – tok
     ✕ codex: not signed in. Run `codex login`, then retry.
 ──────────────────────────────────────────────────────────────────────────
 routes  codex ← code-explorer · named, isolated, nested stay Claude
 roles   advisor waits · reviewer bg · others bg   read-only · max 2
 [ Review diff ]  [ Stats ]  [ Next ]  [ Prev ]  [ Close ]
```

## Try it

```
/duet demo
```

- `/duet`: opens the pane, or closes it when it is shown. When it is open as a tab behind another pane, it comes to the front with the keyboard instead of closing; `Esc` returns the keyboard to the prompt. Keys once the pane has the keyboard (`ctrl+x tab`, again for the next tab): r review, s stats, j/k move, c close
- `/duet demo`: one task in each state until the turn ends; nothing runs
- `/duet review [--base <branch> | --commit <sha>]`: an independent read-only Codex review (default: uncommitted changes)
- `/duet show <id>`: a review's full text
- `/duet stats`: runs, success rate, median time and tokens per provider and subagent type
- `/duet routes`: what goes where, what stays on Claude, each role's wait/background mode, and the sandbox
- `/duet provider`: opens the providers pane (0.3.0): one row per provider with its sign-in (`signed-in`, `key …a1b2`, `key …a1b2 from env`, `no key`, `codex login`) and its last test. `j`/`k` move, `e` opens a one-line field for the key (**typing is visible until Enter**; the terminal can't mask it; Enter saves it to `~/.claude/duet-data/.env` and runs `chmod 600`), `t` tests the key, `m` lists the provider's models under its row, `x` removes a key after a confirmation, `c` closes. `/duet provider list` prints the rows; `/duet provider key <id>` opens the pane on that row with the field open (a key typed into the prompt is refused: it would land in the transcript); `/duet provider test <id>` runs the free `GET /models` check (a 2xx that is not a model list fails it; Together's top-level array counts; a paginated list counts as `n+ models (first page)`), and `test <id> <model>` a one-token completion that most providers bill (the only test for Perplexity, which lists no models; OpenAI gets `max_completion_tokens`, since its o-series rejects `max_tokens`; a reasoning model that spends the token thinking and answers an empty choice still passes); a provider that never finishes answering fails after 30 s and a late reply is dropped; a result remembers a fingerprint of the whole key it tested and the base URL it reached, so a saved or removed key, or a changed `apiCustomUrl`, drops it, a reply that lands after the key changed records nothing, a result stored for another key shows as `untested`, and `t` while a test runs sends nothing; a `null` or otherwise unusable reply fails the test rather than sticking on `testing…`; a 429 keeps the provider's message (an exhausted quota is not a transient limit); every provider string shown or stored is redacted, stripped of control characters and bounded; `/duet provider models <id>` (at most 200 ids, then how many more); with no pane (a headless run or a narrow window), `key <id>` names the variable to set and the line to add to the key file; `/duet provider remove <id>`. A key in your environment (`GEMINI_API_KEY`, `XAI_API_KEY`, …) wins over the file and is never removed by duet. A key typed into the prompt by mistake is refused, but it is already in your transcript and shell history: rotate it. Values are stored as JSON strings when they hold a space, a quote or a backslash, and read back exactly. The key file's mode is set to 600 before any write (a new file is created empty first) and again after it; when the mode can't be set, nothing is written and the field stays open, and a failed second chmod shows as a warning. On Windows there is no chmod: the file keeps your user folder's permissions, and the note says `Windows: no chmod`. A provider that takes no key (Ollama, or the custom endpoint at a local `http://` URL such as LM Studio) is tested and listed without one. With no home folder (`HOME` or `USERPROFILE` unset) no key is stored anywhere, and a key file that exists but can't be read is named in the pane and the list rather than treated as empty. OpenRouter's model list is public, so `models openrouter` works without a key; its probe still needs one. Anthropic's native model list gets the `anthropic-version` header. The `anthropic` row is `signed-in` until you store `ANTHROPIC_API_KEY`; with none it is tested when a run goes to it (0.4.0). On 2026-10-16, every remote URL in the table answered a dummy key with 401 or 400 (OpenRouter's model list answers without a key, and its test says so), so none is a wrong address
- `/duet config`: opens a config pane listing every option with its value. `j`/`k` move the highlight, `e` changes the highlighted option (sandbox, consent and scope step to their next choice; the others open a text box, Enter sets it), `s` saves, `u` reverts unsaved edits, `c` closes. Edited rows are marked `•` until saved; after `s` the pane stays open (or comes back after duet reloads with the new settings) on the same row. On the `model` row, `e` opens Codex's live model list (`codex debug models`): `1`–`9` pick a model, `0` clears it back to Codex's default, and either closes the list; `t` types a name instead, `r` refreshes, and a name Codex doesn't list gets a "did you mean" warning. `/duet config list` prints the options as text, `/duet config models` lists the models Codex offers, and `/duet config <field> <value>` changes one directly (aliases `agents`, `sandbox`, `model`, `max`, `timeout`, `consent`, `mode`, `scope`, `paths`, `customurl`, `custommodel`; `""` clears a text field). Use this when `/plugin` no longer shows options that already have a value

Reaching the pane when other panes are open: `ctrl+x tab` shows the first tab and gives it the keyboard,
each press after moves one tab right, and after the last tab the keyboard goes back to the prompt. `Esc` hands
it back from any tab. A letter that is one of the pane's keys acts at once. To cycle without going through the
first tab, bind `pane:next` and `pane:previous` (no default key) in `~/.claude/keybindings.json`; it works while a
pane holds the keyboard:

```json
{"bindings":[{"context":"Pane","bindings":{"ctrl+x n":"pane:next","ctrl+x p":"pane:previous"}}]}
```

## Install

Needs the [Codex CLI](https://github.com/openai/codex) on PATH, signed in once with `codex login`.
Duet uses Codex's own sign-in and usage limits. Codex runs with Claude Code's credential and provider variables blanked; the full list is `BLANKED_ENV` in `hooks/duet-logic.ts`. It covers `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_CUSTOM_HEADERS`, `CLAUDE_CODE_OAUTH_TOKEN` and its refresh token, `CLAUDE_CODE_SESSION_ACCESS_TOKEN`, the mTLS key passphrase `CLAUDE_CODE_CLIENT_KEY_PASSPHRASE`, the session's `CLAUDE_CODE_MESSAGING_TOKEN` and `CLAUDE_CODE_MESSAGING_SOCKET` (so Codex can't post into your session's inbox), and `ANTHROPIC_IDENTITY_TOKEN` (workload identity federation); the Bedrock, Bedrock Mantle, Claude Platform on AWS, Vertex and Foundry settings and keys; the AWS credentials (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`, `AWS_BEARER_TOKEN_BEDROCK`, and the container provider's `AWS_CONTAINER_AUTHORIZATION_TOKEN`); and the Azure SDK's credential variables (`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_CLIENT_CERTIFICATE_PASSWORD`, `AZURE_PASSWORD`) and managed identity's `IDENTITY_HEADER`. Paths and profile names (`CLAUDE_CONFIG_DIR`, `ANTHROPIC_PROFILE`, `AWS_PROFILE`, `GOOGLE_APPLICATION_CREDENTIALS` and the like) are not blanked, the messaging socket apart: a mod can only set a variable to empty, not unset it, and an empty path changes what a tool does. If Codex itself uses Amazon Bedrock, sign it in with an AWS profile: `AWS_PROFILE` reaches it, but the AWS key variables and `AWS_BEARER_TOKEN_BEDROCK` reach it empty. Other variables in your environment pass through, including `OPENAI_API_KEY`, which Codex needs when you sign in with an API key. If Claude Code runs with `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1`, it removes `OPENAI_API_KEY` too, so store the key from a shell where it is set, with `printenv OPENAI_API_KEY | codex login --with-api-key` (the option reads the key from stdin), or sign in with `codex login` instead. Blanking hides variables, not files: Codex can still read a credentials file such as `~/.aws/credentials`, as the next paragraph says. Nor does it hide Claude Code's own environment: on Linux, any process running as you, Codex included, can read it from `/proc/<pid>/environ`. So blanking keeps Codex from picking up the credentials held in those variables by accident, but it is not a barrier against Codex looking for them. Nor does it cover a login that Codex's tools find on their own: an `aws` or `gcloud` command Codex runs still signs in with Claude Code's AWS profile (the one `AWS_PROFILE` names, or `[default]` in `~/.aws/credentials`) or Google credentials (the key file `GOOGLE_APPLICATION_CREDENTIALS` names, or gcloud's `application_default_credentials.json`) without being asked to, as it would for any program you run.

API keys for other providers (0.3.0) live in `~/.claude/duet-data/.env`, written by `/duet provider` with mode 600. Codex can read that file under `codexFsScope: anything`, as it can any file; under `project` it can't. The pane says so when a key is saved, and the Codex consent question names the file, whenever Codex can read it: under `anything`, and under `project` when the session folder holds the file (a session started in your home folder). The provider key variables are not blanked in Codex's environment: a key duet keeps lives in the file, which blanking a variable does nothing about, and one set in your shell is your credential for Codex too. If you don't want Codex to see a provider key, keep it in the key file rather than your shell, since the environment wins over the file in duet. A key in the project's own `.env` would be readable by every Codex run, which is why duet keeps them in the user folder instead.

### Keeping agents out of the key file

Every agent on this machine runs as your user, so the only real barriers are the ones each agent's host enforces. Layered, strongest first:

1. **Codex: `codexFsScope: project`.** Codex's own sandbox hides the file. This is the one enforced barrier duet has, verified through `codex exec` on Codex 0.162.1, Linux (SPEC, Change 0.2.6). Making it the default is issue #114.
2. **Claude Code's Bash sandbox**, OS-enforced, covering Bash, PowerShell and the processes they start. In your user settings:

   ```json
   { "sandbox": { "enabled": true, "credentials": { "files": [
     { "path": "~/.claude/duet-data/.env", "mode": "deny" },
     { "path": "~/**/.env", "mode": "deny" } ] } } }
   ```

   Decline any "retry outside the sandbox" prompt: an allow rule for the command also approves the retry. Runs on WSL2, not native Windows.
3. **Claude's file tools** run outside that sandbox and follow permission rules instead. Deny rules in the same file:

   ```json
   { "permissions": { "deny": [ "Read(~/.claude/duet-data/.env)", "Read(./.env)", "Read(./.env.*)" ] } }
   ```

   Grep and Glob are separate tools: add matching entries for them if the contents must stay unreachable by search too.
4. **Duet's own guards** (0.3.0): the `@`-mention of the key file, a Bash command with a rooted path to it or its folder, and a Read, Grep or Glob under `.claude/duet-data` are refused for anyone who has set no rules. Bash cannot be guarded reliably by a text match, which is what layer 2 is for.
5. **Hold fewer keys.** A gateway such as OpenRouter or a local LiteLLM means one scoped, rotatable key on disk instead of twelve. The honest limit stays: anything your user can read, an unsandboxed agent with a shell can read. The layers above shrink who is unsandboxed; they don't change that.

Codex's sandbox limits writes, not reads. In either mode Codex can read any file your account can read and send it to OpenAI; under `workspace-write` it can also write in the session folder and in `/tmp`, where Claude Code keeps its own working files (measured with Codex 0.162.1 on Linux; see SPEC, Change 0.2.4). The handoff asks Codex to stay in scope, but that's a request to the model, not enforcement. A routed agent's instructions come from a `.claude/agents/` folder in the checkout or above it, or from wherever a symbolic link there points, so route only agents you trust, in repositories you trust, and use `workspace-write` only there. `codexFsScope: project` closes the read and `/tmp` gaps on Codex 0.162.1 (Linux). It was checked through `codex exec`: a canary file outside the project, `/tmp` and a symlink pointing out of the project were all hidden (SPEC, Change 0.2.6). It relies on Codex keeping a permission profile alongside `sandbox_mode`, which OpenAI's docs say don't combine, so re-run that check after upgrading Codex, and until you have, keep `codexSandbox` at `read-only`.

```
/plugin install duet --marketplace bankielewicz/mod-builder
```

From a local clone (`claude plugin marketplace add <folder>` once):

```
/plugin install duet@claudemod
```

While developing: `claude --plugin-dir <path-to>/duet`. Changes load with `/reload-plugins`.

## Options

| Option | Default | What it does |
| --- | --- | --- |
| `codexAgents` | empty (only the `duet:` roles) | Comma-separated subagent types Codex runs, e.g. `general-purpose, code-explorer`. `*` routes every type, Claude Code's own `Explore` and `Plan` included. Named, isolated and nested calls stay on Claude. |
| `codexSandbox` | `read-only` | `read-only` investigates and answers, writing nothing; `workspace-write` lets Codex write in the session folder and in `/tmp`. In both, Codex can read any file your account can read. Agents that can't edit always run read-only. There is no full-access option. |
| `codexModel` | empty | `-m` for Codex; empty uses Codex's configured model. |
| `maxConcurrent` | `2` | Codex runs at once; beyond it, the call is refused with a reason. |
| `timeoutMinutes` | `20` | A Codex run past this is stopped and the call refused. If duet has to fall back to a one-shot run (streaming couldn't start), that run stops at 10 minutes at most. With `timeoutMinutes` above 10, `/duet config` says so, and so does the run's row while that run lasts. The fallback is rare: on Claude Code 2.1.300, streaming failed to start only when `codex` was missing or not executable, and then the one-shot run fails at once too. |
| `codexConsent` | `ask` | `ask` before the first handoff of a session: a yes or a no holds for the rest of the session, and Esc asks again on the next handoff. `allow` pre-approves it (needed for `claude -p`). |
| `codexRunMode` | `background` | `wait` or `background` for `codexAgents` types, then overrides by type: `background, advisor=background, Explore=wait`. Roles default to advisor wait, reviewer background, implementer wait. A run that can edit always waits. |
| `codexFsScope` | `anything` | `anything` leaves Codex's own sandbox, which can read any file your account can read. `project` adds a duet permission profile and sets the sandbox with `-c sandbox_mode` instead of `-s`, which would switch the profile off. Codex can then read only the session folder, the system paths common tools need (`:minimal`), its install folders (the folder the first `codex` file on `PATH` really lands in, unless that folder holds the home folder or the project, `$CODEX_HOME/packages` and `~/.codex/packages`), its own memories folder (`~/.codex/memories`, which Codex adds itself) and, in a linked worktree or a submodule, git's own folders, `.git/config` and its remote URLs included. It writes the session folder only under `workspace-write`. On Linux it sees no `/tmp` and no other files, even through a symlink, so tools that need `/tmp` (`mktemp`) fail. On macOS, Codex 0.162.1's source (`seatbelt_scratch.rs`) makes `/private/tmp` and `/private/var/tmp` readable and writable whenever the profile is used, `read-only` included; this hasn't been run. If the sandbox can't run Codex at all (an install folder duet didn't find, such as some npm/nvm or brew installs), the run fails, naming the binary. On Codex 0.162.1 (Linux), `codex exec` runs confirmed this for reads and `/tmp` under both sandboxes; whether the project stays unwritable under `read-only` was checked in `codex sandbox` only. `/duet review` gets the same profile, but whether it holds there isn't confirmed. Windows isn't checked. A session started in a subfolder of a repository can't run git. Each run's profile has a random name (`duet-mod-fs-scope-<nonce>`), so no Codex config can define it and merge in; a trusted repository's own `.codex/config.toml` can still shape Codex in other ways, such as MCP servers. Re-check after upgrading Codex (SPEC, Change 0.2.6). The consent question still describes the default. |
| `apiCustomUrl` (0.3.0) | empty | The `custom` provider's OpenAI-compatible base URL: `https://…`, or `http://` to `localhost`/`127.0.0.1` only (anything else is refused, a `user:password@` in the URL included), e.g. `https://my-gateway.example.com/v1`. Its key is `DUET_CUSTOM_API_KEY`. |
| `apiCustomModel` (0.3.0) | empty | The model id runs on the `custom` provider use (0.4.0). In 0.3.0 the key test lists models instead; `test custom <model>` names a model directly. |
| `codexWritePaths` | empty | With `project` and `workspace-write`: `agent=folder;folder` entries, comma-separated, e.g. `red-test-writer=tests;test, impl-writer=src`. A named agent writes only those project folders and reads the rest of the project; agents not named write the whole project. It only narrows. An absolute path or one that climbs out of the project (`..`) is ignored, and so is a folder whose real path leaves the project (a symlink out, or to the project itself), lies in `.git`, `.codex` or `.agents` (which Codex keeps read-only), or doesn't exist yet (Codex can't create it); the run's result names each folder ignored this way. An entry whose folders are all ignored leaves the project read-only. A malformed value (not `agent=folder;folder`) is refused by `/duet config`; set another way, it leaves every agent's project read-only. Through `codex exec` (Codex 0.162.1, Linux), a named folder was writable, and writes outside the project, to `/tmp` and through a symlink were refused. That the rest of the project stays read-only was checked in `codex sandbox` only. Codex leaves empty `.agents`, `.aws`, `.codex` and `.git` folders inside each folder it may write. |

An agent that writes files, like the example `test-writer`, needs `codexSandbox: workspace-write`
to save anything on Codex. With the default it can only read and report.

## Safety boundaries

- Codex always runs with `-c approval_policy="never"` under its own sandbox. Duet never passes
  `--dangerously-bypass-*` or `--approve-for-me`. Reviews are always read-only.
- **A routed Agent call is answered above Claude's permission check, so Codex's sandbox is the only
  control on that work.** Mods can't read the session's permission mode, so plan mode doesn't
  tighten Codex. That is why the default is `read-only`.
- Only main-loop subagents are routed (depth 1). Named, isolated and nested `codexAgents` calls stay
  on Claude; a `duet:` role from inside a subagent or isolated is refused with the reason.
  There are no automatic retries, and a Codex failure is a visible refusal (or, for a background
  run, a delivered failure message), never a silent fallback to Claude.
- A Codex run answers once and exits; its result says it can't be messaged (`canContinueAgent: false`).
- Read-only runs can go to the background; a run that can edit always waits. A config change reloads
  duet, and a background run it cuts off is reported as `lost when duet reloaded`.
- Each handoff carries the task id, spec version (prompt hash), base commit, allowed scope,
  prohibited actions (commits, pushes, branch changes, installs, network, outside-scope files)
  and the required output. For a run that can edit, the footer adds the files whose `git status` entry
  changed during the run (worded "during", since a background Claude subagent may have touched some;
  an extra edit to an already-modified file doesn't show). A read-only run skips the comparison.

## What it reaches

Mods are not sandboxed. They run with your access and skip Claude's permission prompts, so this
table lists everything this one can touch. It is generated from `claude plugin validate`.

| Reach | Detail |
| --- | --- |
| Hooks | `session.start`, `command.run{command=duet}`, `tool.call{tool=Agent}`, `turn.complete`, `ui.render{component=Pane, requestId=duet}`, `ui.render{component=Pane, requestId=duet-config}`, `ui.render{component=Pane, requestId=duet-providers}`, `prompt.mention{path=/duet-data[\\/]\.env$/}`, `tool.call{tool=Bash}`, `tool.call{tool=Read}`, `tool.call{tool=Grep}`, `tool.call{tool=Glob}` (they refuse an `@`-mention of the key file; a Bash command with a rooted path (`~`, `/`, `$HOME`, `${HOME}`, `C:\`) to `.claude/duet-data` or a name under it that matches `.env` (globs, braces and `..` included), as an argument, after `=`, in a `-c` payload, a here-string or a heredoc that an interpreter reads; a Read of it; and a Grep or Glob over it or its folder (one regex matcher; no Grep or Glob tool is laid for this build, so that guard is unverified live). A quoted message with spaces (a commit message, a PR body), a grep pattern, a heredoc that `cat` writes out, a `#` comment and another folder named `duet-data` don't count, so this repo's docs and commits can name the path; payloads nested past four levels are refused; **a tripwire for the obvious case, not protection**: a text match, so `grep -r API_KEY ~/.claude`, a path built in a variable, or a script that opens the file pass and put the keys in the transcript. Keep real keys out of sessions where Claude's shell runs unattended) |
| Agent list | `$.agent.register`: `duet:codex-advisor`, `duet:codex-reviewer`, and `duet:codex-implementer` under `workspace-write` (a few hundred tokens of context in every session) |
| Prompts | `$.prompt.submit`: one turn per finished background Codex run (its answer or failure) and per background agent run a reload cut off |
| Settings | `$.config.list` / `$.config.set` on duet's own rows, from `/duet config` |
| Store | `$.store.get` / `$.store.set` / `$.store.delete` on one key per provider, `duet:providers:tests:<id>`: its last key test (status, time, model, a fingerprint of the key and the base URL; never the key), shared by every session |
| Processes | `$.process.spawn` / `$.process.run`: `codex exec --json …`, `codex exec review --json …`, `codex debug models`, `git rev-parse` (the base commit and, under `codexFsScope: project`, `--git-dir --git-common-dir`), `git status --porcelain --untracked-files=all` and `git hash-object -- <changed files>` (before and after a run that can edit); `chmod 600 ~/.claude/duet-data/.env` after a key is saved |
| Files | lists (`$.fs.list`) and reads the `.md` files in every `.claude/agents/` folder from the session folder up to the nearest folder holding `.git` (checked with `$.fs.exists`; with none, up to the filesystem root), and in `~/.claude/agents/`, subfolders and symbolic links included (each folder's real path and each link's target through `$.fs.stat`; managed-settings, `--agents`, plugin and `--add-dir` agents aren't reached); under `codexFsScope: project`, resolves with `$.fs.stat` the session folder, each `codexWritePaths` folder and `codex` in each `PATH` folder; reads `~/.claude/duet-data/runs.jsonl` (legacy) and every `sessions/<session>/runs.jsonl`, with `$.fs.list` on `sessions/`, for `/duet stats`; writes `sessions/<session>/runs.jsonl` (no prompt text), `sessions/<session>/review-<id>.md` and `sessions/<session>/d<n>.out.md` (a background run's answer; per session, since ids restart at d1); reads and rewrites `~/.claude/duet-data/.env` (`$.fs.read`, `$.fs.write`: one `NAME=value` line per provider key, every other line kept) from `/duet provider` |
| Network | `$.http.fetch` from `/duet provider test` and `models` only (0.3.0): `GET <provider base URL>/models` with your key as a Bearer header, and `POST …/chat/completions` with a one-token request when you name a model or the provider lists no models (each waits 30 s at most); the hosts are the table in `hooks/duet-providers-logic.ts`, plus `apiCustomUrl` and `http://localhost:11434` for Ollama. No run goes to an API provider yet (0.4.0). **Codex sends the handoff and whatever it reads to OpenAI** under your Codex sign-in. It can read any file your account can read, not only the session folder, the key file included under `codexFsScope: anything` |
| Model calls | none by the mod directly; Codex usage per routed call and review; each delivered background answer is a Claude turn |
| Environment | reads `CODEX_HOME`, `HOME`, `PATH`, `USERPROFILE`, and each provider key variable (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `XAI_API_KEY`, `MISTRAL_API_KEY`, `DEEPSEEK_API_KEY`, `GROQ_API_KEY`, `TOGETHER_API_KEY`, `FIREWORKS_API_KEY`, `OPENROUTER_API_KEY`, `PERPLEXITY_API_KEY`, `CEREBRAS_API_KEY`, `DUET_CUSTOM_API_KEY`), which wins over the key file; Codex's child env blanks the secrets named in `BLANKED_ENV` (see Install); the provider key variables are **not** among them, so a Codex configured with one as its own `env_key` (OpenRouter, Groq, …) keeps working; other variables pass through |
| Asks | `$.ui.ask` before sending to Codex, until it is answered in the session (unless `codexConsent: allow`); before `x` removes a key in the providers pane (the typed `remove` is immediate) |
| Gating hooks | `tool.call{tool=Agent}` with `.catch` (refuses on failure; never falls through); `prompt.mention` on the key file, `tool.call{tool=Bash}`, `tool.call{tool=Read}`, `tool.call{tool=Grep}` and `tool.call{tool=Glob}` with `.catch` (the mention is denied either way; a Bash, Read, Grep or Glob whose check fails is refused and names the check) |

## Development

```
claude plugin validate .
claude plugin test .
```

Built on Claude Code 2.1.296 and codex-cli 0.162.1; 0.2.9 checked on Claude Code 2.1.300; 0.3.0 built on Claude Code 2.1.301 with codex-cli 0.163.0. Written spec-first with `/mod-builder:build`; see `SPEC.md`.

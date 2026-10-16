# Claude Design prompt: README for bankielewicz/mod-builder

Paste everything below the line into Claude Design. When it comes back, the build step (done by
Claude Code in this repo) checks every claim against the code and fills in anything it missed. It
also adds the "use this in your own project" guide below, verbatim where the design dropped it.

---

Design a **professional, launch-quality README.md** for the GitHub repository **bankielewicz/mod-builder** (https://github.com/bankielewicz/mod-builder).
It should read like the front page of a well-funded developer tool: confident, calm and scannable.
Someone landing on it should know within ten seconds what it is, see it working, and be one copy-paste
away from trying it.

## What the repo is (facts: do not invent features)

This repo is a **Claude Code plugin marketplace** (named `claudemod`) with one plugin, **`mod-builder`**, built around
Claude Code **mods**. A mod is a Claude Code plugin whose behaviour lives in a TypeScript "hooks
module". It runs inside Claude Code and can:
- draw panes, bands above the prompt, status lines and toasts
- add slash commands
- register tools the model can call
- hook tool calls and prompts

The API (function hooks) is **early access**. Everything here was built and verified on
**Claude Code 2.1.296**.

`mod-builder` has two halves:

1. **`/mod-builder:build <idea>`** is a skill that builds a mod **spec-first**:
   1. **Interview:** it asks only about what the request leaves open. A detailed request gets zero
      questions.
   2. **SPEC.md:** the **single approval gate**. It lists every file, process and cost.
   3. **Scaffold:** from one of **5 tested archetypes** (band, pane-command, guard, watcher,
      command-only).
   4. **Build:** logic first, as pure functions with unit tests, then a thin `register.tsx`.
   5. **Verify:** `claude plugin validate`, `claude plugin test`, `tsc`, and a headless smoke test.
   6. **Ship:** a README with a "What it reaches" table generated from validate's output, plus a
      marketplace entry.

   It builds on Claude Code's built-in `plugin-authoring` skill for the API, and adds house
   conventions, a UI-state checklist, a **gotchas list of 43 engine rules** (each tagged by how it
   was verified: `[d.ts]`, `[probe]` measured live, or `[field]`), and **14 patterns**.
2. **Mod Lab (`/modlab`)** is a showcase mod that uses every surface a mod can draw on, while it
   tracks every mod in `mods/` through 8 stages: **Spec → Scaffold → Logic → Register → Validate →
   Test → README → Share**.

   | Surface | What Mod Lab does with it |
   |---|---|
   | Docked pane | stage lights per mod, a detail panel (version, description, pipeline track, HOOKS, REACHES, gating hooks), an error box with **[F] Fix with Claude**, and a "ready to share" box |
   | Band above the prompt | each running stage, with a 15-cell bar that fills on **real** progress (it streams `claude plugin test` output) |
   | Status line badge | `◆ 3 mods · 1 building` |
   | Toasts and a native OS notification | when runs finish, and when a mod is ready to share |
   | Hotkey buttons | V validate · T test · K types · O readme · J/P move · N new · D demo; `ctrl+x tab` gives the pane the keyboard (again: next tab) |
   | Pre-filled prompts | for a new mod and for fix requests |
   | A model-callable tool, `lab_report` | the skill reports each stage as it works, so the pane lights up live; the disk and exit codes always decide pass or fail |
   | `/modlab demo` | a pretend mod, `aurora`, walks all 8 stages in 12 s, including one failed test that Claude fixes; nothing is written to disk |

   Its rules are deterministic and unit-tested: **39 tests** (logic plus UI mounted on terminal,
   desktop and mobile).

**Trust model, which must appear prominently:** mods are **not sandboxed**. They run with the
user's full access and skip Claude's permission prompts. The repo's rule is *our own code only*:
community mods are read for ideas, never installed or copied. Every mod README carries a "What it
reaches" table.

## Repo layout (real)

```
.claude-plugin/marketplace.json     the "claudemod" folder marketplace
plugins/mod-builder/                the plugin: skill + Mod Lab
  skills/build/                     SKILL.md, templates/, references/, scripts/, ci/
  hooks/register.tsx                Mod Lab: every $ call
  hooks/mod-builder-logic.ts        Mod Lab: every rule, $-free, unit-tested
  tests/  types/  SPEC.md  README.md  NOTICE.md  design/
mods/turn-counter/                  an example mod the skill's scaffold produced
.github/workflows/ci.yml            validate + test every plugin, regenerate every archetype
```

## Commands (exact; keep them copy-pasteable)

```
# install from GitHub
/plugin marketplace add bankielewicz/mod-builder
/plugin install mod-builder@claudemod

# or in one line
/plugin install mod-builder --marketplace bankielewicz/mod-builder

# or from a local clone
git clone https://github.com/bankielewicz/mod-builder
claude plugin marketplace add ./mod-builder
/plugin install mod-builder@claudemod

# try it
/modlab demo
/mod-builder:build a band above the prompt showing the current git branch

# develop
claude --plugin-dir plugins/mod-builder
claude plugin validate plugins/mod-builder
claude plugin test plugins/mod-builder
bash plugins/mod-builder/skills/build/scripts/check-archetypes.sh
```

## Sections the README must have (order is a suggestion; improve it)

1. **Hero:** name (**mod-builder**), one-line tagline, 3–4 badges (Claude Code 2.1.296+, early-access API, tests 39
   passing, MIT), and a hero image (see Assets).
2. **What is a Claude Code mod?** Three sentences, for someone who has never heard of one.
3. **What's inside:** the two halves, side by side.
4. **Quick start:** install, then `/modlab demo`, then build your first mod. Three steps, under a
   minute.
5. **Build a mod in your own project.** This is the most important section for adoption. Cover:
   - Install mod-builder once, at user scope, so it's available in every project.
   - In your project, run `/mod-builder:build <idea>`. The skill looks upward for a
     `.claude-plugin/marketplace.json`. When there isn't one, it offers to create a folder
     marketplace in your project, with mods going in `<project>/mods/<name>/`.
   - Approve the SPEC. Claude scaffolds, builds, tests and validates.
   - Load your mod: `claude --plugin-dir mods/<name>` while developing, or
     `claude plugin marketplace add .` then `/plugin install <name>@<your-marketplace>`. After that,
     `/reload-plugins` picks up edits.
   - Watch it in Mod Lab: `/modlab` finds your project's `mods/` from the marketplace nearest the
     working directory (set the `modsDir` option only to pin another folder).
   - Share it: commit the folder; teammates run the two install lines against your repo.
   - Optional CI: copy `plugins/mod-builder/skills/build/ci/ci.yml` to `.github/workflows/`.
6. **The archetypes:** a 5-row table (when to use each, what it draws).
7. **Mod Lab tour:** annotated terminal captures of the pane, band and status line.
8. **How the skill works:** a diagram of the 5 steps and 1 gate, and what each produces.
9. **Safety and trust:** the "What it reaches" idea, and the own-code-only rule.
10. **Requirements and status:** Claude Code version, the early-access caveat, `node`/`npx` for
    the scaffold script and the optional type-check, and "tested on Linux (WSL2); macOS and Windows
    native not yet verified".
11. **Contributing:** run validate, test and check-archetypes; new engine findings go in gotchas.md
    with a source tag.
12. **Credits and licence:** MIT; ideas learned from public mod collections (named in NOTICE.md),
    no code copied; the Anthropic API declarations are referenced, not shipped.

## Medium and visual constraints (GitHub renders the README)

- **GitHub-Flavored Markdown only.** No custom CSS, no scripts, no `<style>`. Allowed: headings,
  tables, fenced code, `<details>`, `<picture>`, `<img>`, `<p align="center">`, `<kbd>`, alerts
  (`> [!NOTE]`, `> [!WARNING]`).
- **Must look right in GitHub light and dark themes.** Use `<picture>` with
  `prefers-color-scheme` sources for any image whose background matters.
- Keep it **scannable**: short paragraphs, tables for comparisons, one idea per section, and
  `<details>` for long reference material.
- Write in plain American English, second person, present tense. No hype words ("revolutionary",
  "supercharge"), no emoji, no exclamation marks.

## Brand

Dark, minimal, premium: the same system as Mod Lab.

| Role | Colour |
|---|---|
| accent | `#D97757` (Claude coral) |
| success | `#7FB685` |
| warn | `#E0B15A` |
| error | `#E06C6C` |
| text | `#E8E6E3` |
| dim | `#8A8580` |
| background | `#1A1918` |

Wordmark style: letter-spaced caps (`M O D   L A B`), monospace (JetBrains Mono). Glyphs from the
product: `◆ ● ◐ ○ ◌ ✕ ━ ┅ ┄`.

## Assets to deliver alongside the README

1. `docs/assets/hero-dark.svg` and `docs/assets/hero-light.svg`, about 1200×420. The wordmark,
   the tagline, and a stylised terminal showing Mod Lab docked beside a transcript, mid-build,
   with the band and status badge visible. Text in the SVG must be real text or outlined paths,
   readable at 600 px wide.
2. `docs/assets/modlab-pane.svg`: a terminal capture of the pane in its "live" state (one mod
   mid-Validate, others green), drawn on a character grid (1 cell ≈ 8×17 px), dark background.
3. `docs/assets/pipeline.svg`: the 8-stage pipeline as a horizontal track with stage lights,
   usable in both themes.
4. `docs/assets/skill-flow.svg`: request → SPEC → (approval gate) → build → verify → handoff,
   with what each step writes.

## Deliverables

- The complete `README.md` text, ready to commit, referencing the assets by those paths.
- The SVG assets above.
- A short list of any facts you were unsure about, so they can be checked against the code. Don't
  guess version numbers, counts or commands that aren't given above.

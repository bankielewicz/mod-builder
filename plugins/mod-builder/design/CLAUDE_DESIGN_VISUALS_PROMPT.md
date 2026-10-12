# Claude Design prompt: README visuals (hero + feature strip)

Paste everything below the line into Claude Design, and attach `docs/assets/modlab-live.svg` (a
real capture of Mod Lab) as the reference. The README text is final; this asks for images only.

---

Design two images for the README of **mod-builder** (https://github.com/bankielewicz/mod-builder),
a Claude Code plugin that builds Claude Code "mods" from a one-sentence request and shows every
build stage live in a panel called **Mod Lab**.

**The text is final. Don't write copy beyond the short labels listed below, and don't invent
product details.** Every terminal element you draw must match the attached real capture
(`modlab-live.svg`): the `M O D   L A B` wordmark, the `MODS 1 2 3 4 5 6 7 8` header, the stage
lights `● ◐ ○ ◌ ✕`, the numbered track `1 Spec ━ 2 Scaffold ━ …`, the band
`◆ aurora  Register ━━━━━━░░░░░░░░░  0:04`, and the status line `◆ 4 mods · 1 building`. Use the
mod names in the capture (`aurora`, `duet`, `git-branch`, `turn-counter`).

## 1. Hero: `docs/assets/hero-dark.svg` and `hero-light.svg` (1200×420)

- Left: the wordmark **mod-builder**, and under it the tagline exactly: "Describe a Claude Code mod
  in one sentence. Approve one spec. Get a tested, documented mod."
- Right: a stylised Claude Code window, with the prompt
  `/mod-builder:build a band above the prompt showing the git branch` in the transcript and Mod Lab
  docked beside it, built from the capture's real elements (crop or simplify, don't alter).
- Dark and light variants; the terminal itself stays dark in both.

## 2. Feature strip: `docs/assets/features.svg` (1200×260, works on light and dark)

Five equal cards, one icon or tiny terminal vignette each, with exactly these labels:

| Card | Label | Sub-label |
|---|---|---|
| 1 | One approval | Claude asks only what's missing, then you approve one SPEC |
| 2 | Works first time | 5 tested starting points, logic with unit tests |
| 3 | Live pipeline | 8 stages, re-checked when code changes |
| 4 | Honest edits | Changes show exactly what still needs redoing |
| 5 | Know what you install | Every mod lists what it can reach |

## Brand

| Role | Colour |
|---|---|
| accent | `#D97757` |
| success | `#7FB685` |
| warn | `#E0B15A` |
| error | `#E06C6C` |
| text | `#E8E6E3` |
| dim | `#8A8580` |
| terminal background | `#1A1918` |

Monospace (JetBrains Mono) for terminal content, letter-spaced caps for the Mod Lab wordmark.
Calm, premium, no gradients beyond a subtle one, no emoji, no exclamation marks.

## Rules

- SVG only, no scripts, no external fonts or links (GitHub serves SVGs as images). Pin terminal
  text to a cell grid with `textLength`.
- Real text or outlined paths, readable at 600 px wide.
- List anything you weren't sure about rather than guessing.

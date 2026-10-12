# UI states checklist

Every drawn mod accounts for each row: draw it, or write "n/a: why" in the SPEC.
`/<name> demo` must reach every drawn state.

| State | Question the SPEC answers | Typical drawing |
| --- | --- | --- |
| **Empty** | What does a first-time user see, with no data? | One line saying what's missing, plus how to get it (a command or a demo button) |
| **Idle** | Nothing happening. What stays on screen? | A static summary. No timers, no animation. Bands usually hide (`return rest`, the result of the one `await next(e)`). |
| **Live** | What moves while work runs, and at what rate? | One clock, at most 4 frames/s, glyph swaps or dim/bright only |
| **Done** | How does finishing announce itself, once? | A summary line, plus a toast and (optionally) `$.ui.notify` |
| **Error** | Exact message? Recovery action? | Red `✕` on the item, the first few lines of the error, and a button to fix or retry |
| **Folded** | Pane closed. What remains? | `$.ui.status` badge, e.g. `12 working · 30 done` |
| **Too narrow** | `ui.open` returned `isPlaced: false` | Toast: "<Name> needs a wider window. Widen it to see the pane." (add "or watch the status line" when the mod keeps one) |
| **Survey** | (bands) `e.props.hasSurvey` | Step aside: `return rest` |
| **Focus** | (panes) `e.props.isFocused` | Brighter border or selected row; hotkeys active |

## Widths (by `e.props.bodyColumns`)

| Width | Layout |
| --- | --- |
| ≥ 60 | full: masthead, rows, detail, buttons |
| 40–59 | medium: drop secondary text, keep the primary action |
| < 40 | compact: one line per item, buttons only |

## Surfaces (`e.surface`)

`terminal` (default design) · `desktop` and `vscode` (same tree; hover works) · `mobile`
(compact layout; no hotkeys; buttons only). Pane tests mount on at least `terminal` and `desktop`.

## Design bar (default; the SPEC may override)

Dark, minimal, premium.

| Role | Colour |
| --- | --- |
| accent | `#D97757` |
| success | `#7FB685` |
| warn | `#E0B15A` |
| error | `#E06C6C` |
| text | default |
| dim | `dimColor` |

Letter-spaced mastheads (`M O D   L A B`). Thin `─` rules. No rainbow, confetti, flashing or emoji.

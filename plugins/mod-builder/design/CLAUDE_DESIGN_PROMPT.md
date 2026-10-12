# Claude Design prompt — Mod Lab UI mockups

> Superseded: Claude Design answered this brief with the mockups in `tmp/mod-lab-mockups-review/`.
> SPEC.md § Design records how the build follows them. Kept for history; don't re-run it as is.

Paste everything below the line into Claude Design.

---

Design high-fidelity mockups for **Mod Lab**, a live panel that runs *inside the Claude Code terminal*. It is a Claude Code "mod": a plugin that draws its own UI in Claude Code's interface. Mod Lab shows every mod a developer is building as a pipeline that lights up in real time while Claude writes it. The pipeline stages are Spec, Scaffold, Logic, Register, Validate, Test, README and Share.

The goal is a showcase. Someone watching a screen recording should think *"I didn't know Claude Code could do that."* The UI should show off every surface a mod can draw on: a side pane, a band above the prompt, the status line, toasts, a native notification, hotkey buttons and a pre-filled prompt. It also has to stay buildable, so read the constraints carefully.

## The medium (hard constraints: the mockups must be buildable)

- **It's a terminal.** Everything sits on a monospace character grid. No pixels, gradients, shadows, rounded rectangles or custom fonts. Draw every frame as a terminal screen made of character cells, about 1 cell = 8×17 px, in a dark terminal theme.
- **Only these elements exist**, and they can only use these props:
  - `Box`: a flex container. Props: `flexDirection`, `gap`, `padding`/`margin` (in cells), `width`/`height` (in cells or %), `borderStyle` (`single`, `round`, `bold`, `double`, or none), `borderColor`, `backgroundColor`, `justifyContent`, `alignItems`, `flexWrap`, and a `hover` style.
  - `Text`: props `color`, `backgroundColor`, `bold`, `italic`, `underline`, `strikethrough`, `dimColor`, `inverse`, `wrap` (`wrap`, `truncate`, or `truncate-middle`).
  - `Button`: props `label`, `hotkey` (one key, shown as `[V] Validate`), `variant` (`primary` or `secondary`), `plain`, `dimColor`.
  - `Markdown`, `Code`, `Link`, `Select`, `Input`.
  - `Image`/`Raster`: only on terminals that support inline images. Always show the text fallback beside them.
- **Glyphs** you can use: `● ◐ ○ ◌ ✕ ✓ ▸ ◆ ━ ┅ ┄ ─ │ ░ ▓ █` and box-drawing characters. Animation is limited to swapping glyphs or toggling dim/bright about 4 times a second. Show an animated element as two or three frames side by side.
- **Width comes from the host.**
  - The pane gets `bodyColumns` (how wide it may draw), `isFocused`, `placement` (`dock` beside the transcript or `inline`), and `scroll`.
  - The band above the prompt gets `bodyColumns`, `maxRows`, `isWorking` and `hasSurvey`. When `hasSurvey` is true, the band must step aside.

## Brand and design bar

- Dark, minimal, premium, like a developer tool a top engineering org pays for. Calm, with plenty of space, and confident type made from letter-spacing (`M O D   L A B`).
- Palette roles:

  | Role | Colour |
  |---|---|
  | accent | `#D97757` (Claude coral) |
  | success | `#7FB685` |
  | warn | `#E0B15A` |
  | error | `#E06C6C` |
  | text | `#E8E6E3` |
  | dim | `#8A8580` |
  | background | `#1A1918` |

- **Never:** rainbows, confetti, flashing, emoji, or movement while nothing is happening.

## What to design

### 1. The Mod Lab pane, docked beside the transcript at 76 columns

Show a realistic Claude Code window: transcript on the left, Mod Lab pane on the right, prompt box at the bottom.

- **Masthead:** the `M O D   L A B` wordmark in coral. On the right, a state word:
  - `● B U I L D I N G`: green, slow pulse
  - `A L L   G R E E N`
  - `N   F A I L I N G`: red
  - `S T A N D I N G   B Y`: dim
- **Summary:** `3 mods · 2 green · 1 building`, with `modsDir  mods/` on the right.
- **Mod rows:**
  - Each row has the name, 8 stage lights, a one-line status and elapsed time.
  - Stage lights: `●` passed (green), `◐` running (coral, animated), `✕` failed (red), `○` pending (dim), `◌` stale (gold).
  - The selected row is marked `▸` with inverse text.
  - A one-line legend sits under the lights: `SpScLoReVaTeRESh`, two letters per stage.
- **Detail panel** for the selected mod:
  - A pipeline track `Spec ━ Scaffold ━ Logic ━ Register ━ Validate ┅ Test ┄ README ┄ Share`
  - `HOOKS` (the events the mod listens to)
  - `REACHES` (processes, files, network, model, gating hooks)
- **Button row:** `[V] Validate  [T] Test  [K] Type-check  [O] README  [J] Next  [P] Prev  [N] New mod  [D] Demo`. Show the hover, pressed/running (dim) and focused styles.

### 2. States: one frame each, same pane

1. **Empty:** "No mods yet." with "Type /mod-builder:build and describe one. Or press D to watch a demo build."
2. **Idle, all green:** calm, nothing moving.
3. **Live:** one mod mid-Validate. Show 3 animation frames of the `◐` light and the track.
4. **Error:** a red `✕` on Test, the first 3 failure lines in a quiet red-bordered box, and a primary button `[F] Fix with Claude`.
5. **Done:** a row reading `ready to share`, with a green-bordered one-line summary.
6. **README view:** the mod's README drawn as Markdown inside the pane, with `[B] Back`.
7. **Demo:** a pretend mod `aurora` with a gold `DEMO` tag, shown at 3 moments of its 12-second walk through the stages: early, a failed test, and all green.

### 3. The rest of the interface the mod touches, in the same window

- **Band above the prompt** while something runs: `◆ agent-dock  Validate ━━━━━━━━━━░░░░░  0:07`, at most 3 lines. Show it with a survey active too, where the band has stepped aside.
- **Status line** under the prompt: `◆ 3 mods · 1 building`, `◆ 3 mods · all green` and `◆ 3 mods · 1 failing`.
- **Toasts:** `agent-dock: validate clean · 4 hooks · 1 gate`, `agent-dock: 12 tests passed in 3.4s` and `inbox-zero: 2 tests failing. Press F in Mod Lab to fix`.
- **Native OS notification:** "agent-dock is ready to share", titled "Mod Lab".
- **Pre-filled prompt:** after `[F]` is pressed, the prompt box contains a draft fix request quoting the failing test.
- **Folded:** pane closed, with only the status-line badge showing.
- **Too narrow:** the toast "Mod Lab needs a wider window. Widen it, or watch the status line."

### 4. Responsive widths

The same live state at `bodyColumns` 76 (full), 50 (medium: no row status text or timer; the detail keeps the track, any error box and the buttons) and 34 (compact: one line per mod, `agent-dock 5/8 ◐`, buttons only).

### 5. Other surfaces

One frame of the same pane in the **Claude desktop app**: same element tree, proportional UI chrome around it, but the pane itself still built from Box, Text and Button. One frame on **mobile**, using the compact layout with no hotkeys.

### 6. Hero shot

One composite "everything at once" frame for a README or launch video:
- the transcript showing Claude building a mod
- Mod Lab docked on the right, mid-build
- the band running
- a toast landing
- the status badge showing

This is the image that should make people want mods.

## Deliverables

- Every frame drawn as a terminal grid. Note the column width on each frame.
- For each frame, a short annotation layer naming the element (`Box borderStyle=round borderColor=accent`, `Text dimColor`, `Button hotkey=V variant=primary`) for anything that isn't obvious, so an engineer can build it directly.
- A one-page style sheet covering colour roles, glyph legend, spacing (in cells), and the text styles used for headers, labels, values and hints.
- Keep the copy exactly as written above. Where you improve a string, show the original next to your version.

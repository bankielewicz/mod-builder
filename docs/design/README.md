# Design: the mod-builder pane, six frames

Mockups of one build from `/mod-builder:build` to a finished mod, made by the owner's driving session on
2026-11-10 and copied here on 2026-11-11 as the reference the pane is rebuilt to in change 0.2.0
([`../mod-builder/SPEC.md`](../mod-builder/SPEC.md), section 8). **Mockups, not captures:** the wording and
the numbers in them are placeholders, and `[N]` marks a number that was never filled in.

| Frame | Picture | Source |
|---|---|---|
| 1 · Launch and knowledge refresh | [`png/Main.png`](png/Main.png) | [`source/Main.dc.html`](source/Main.dc.html) |
| 2 · Describe, spec and approval | [`png/Spec.png`](png/Spec.png) | [`source/Spec.dc.html`](source/Spec.dc.html) |
| 3 · The phase guard refuses an early edit | [`png/Guard.png`](png/Guard.png) | [`source/Guard.dc.html`](source/Guard.dc.html) |
| 4 · Scaffold, red, green | [`png/Build.png`](png/Build.png) | [`source/Build.dc.html`](source/Build.dc.html) |
| 5 · Validate, test, typecheck, live load | [`png/Verify.png`](png/Verify.png) | [`source/Verify.dc.html`](source/Verify.dc.html) |
| 6 · Done | [`png/Done.png`](png/Done.png) | [`source/Done.dc.html`](source/Done.dc.html) |

`source/` holds each frame as exported, with `canvas.json` (where the frames sit on the canvas, and its two
notes). The frames name a `support.js` that was not part of the export, so they do not draw from these files
alone; `png/` holds each frame as a picture, beside the plain HTML it was drawn from.

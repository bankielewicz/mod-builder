# Troubleshooting

[← README](../README.md)

| Symptom | Cause and fix |
|---|---|
| Mod Lab says "No mods yet" in your project | Before a build reports its folder, it watches the `mods/` of the marketplace nearest the session's project root (where Claude started, or where `/cd` took it), else nearest the working directory. Start Claude inside your project (or `/cd` there); if your marketplace keeps its mods somewhere other than `mods/`, set `modsDir` to that folder ([step 5](use-in-your-project.md#5-mod-lab-finds-your-mods)). |
| <kbd>V</kbd> or <kbd>T</kbd> types into the prompt | The pane doesn't have the keyboard. Press <kbd>ctrl</kbd>+<kbd>x</kbd> <kbd>tab</kbd> first. Focus returns to the prompt after a reload. |
| The pane doesn't appear | The window is too narrow. A pane you open places at any width; one that opens by itself waits for 144 columns. Under 34 columns Mod Lab draws nothing and says so. |
| <kbd>K</kbd> says type-check needs the engine's types | Claude Code writes `.claude-plugin/types/` only when an interactive session loads the mod. Load it once with `claude --plugin-dir mods/<name>`. |
| A new mod doesn't load after `/reload-plugins` | `/reload-plugins` re-reads installed plugins only. Install it once, or use `--plugin-dir`. |
| Validate and Test show `○` after switching between `--plugin-dir` and an installed copy, or after a `/cd` into another worktree | Each way of loading the plugin keeps its own store, and each mods folder its own results. Press <kbd>V</kbd> and <kbd>T</kbd> once. |
| A stage shows `◌` | Its evidence is older than the code (or than an edit). A stale Validate or Test re-runs at the end of the turn with `autoRerun`, or press <kbd>V</kbd> / <kbd>T</kbd>. Any other stage passes again when the edit redoes it ([Edits](mod-lab.md#edits)). |
| You need to see what Mod Lab did | Raise its log level: `/mod-builder config logging verbose` (or `debug`). It writes one file per session under `~/.claude/mod-builder-data/logs/`, and `/mod-builder config` names this session's file. |
| A hook seems to do nothing | Start Claude Code with `--debug`: every failing hook, and every tree that doesn't validate, gets a line there. |

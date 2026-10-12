# Troubleshooting

[← README](../README.md)

| Symptom | Cause and fix |
|---|---|
| Mod Lab says "No mods yet" in your project | Its Mods folder still points at the default. Set `modsDir` to your project's `mods/` ([step 5](use-in-your-project.md#5-point-mod-lab-at-your-mods)). |
| <kbd>V</kbd> or <kbd>T</kbd> types into the prompt | The pane doesn't have the keyboard. Press <kbd>ctrl</kbd>+<kbd>x</kbd> <kbd>tab</kbd> first. Focus returns to the prompt after a reload. |
| The pane doesn't appear | The window is too narrow. A pane you open places at any width; one that opens by itself waits for 144 columns. Under 34 columns Mod Lab draws nothing and says so. |
| <kbd>K</kbd> says type-check needs the engine's types | Claude Code writes `.claude-plugin/types/` only when an interactive session loads the mod. Load it once with `claude --plugin-dir mods/<name>`. |
| A new mod doesn't load after `/reload-plugins` | `/reload-plugins` re-reads installed plugins only. Install it once, or use `--plugin-dir`. |
| Validate and Test show `○` after switching between `--plugin-dir` and an installed copy | Each way of loading the plugin keeps its own store. Press <kbd>V</kbd> and <kbd>T</kbd> once. |
| A stage shows `◌` | Its evidence is older than the code (or than an edit). It re-runs at the end of the turn with `autoRerun`, or press <kbd>V</kbd> / <kbd>T</kbd>. |
| A hook seems to do nothing | Start Claude Code with `--debug`: every failing hook, and every tree that doesn't validate, gets a line there. |

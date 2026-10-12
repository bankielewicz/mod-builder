# Patterns, each with a real mod to read

All links point to public repos. They are **for ideas only**: read one to understand how a
pattern works, then write your own code. Never copy-paste from them, and never install or run a
mod you didn't write. Mods aren't sandboxed: they run with the person's full access and skip
Claude's permission prompts.

| # | Pattern | Read |
| --- | --- | --- |
| 1 | **Pane opened by a command**, drawn by `ui.render {Pane, requestId}`, with Buttons | OneWave `agent-race/hooks/register.tsx` · modu-ai `mods/moai-board/hooks/register.tsx` (Apache-2.0) |
| 2 | **Band that composes**: `rest = await next(e)`, steps aside on `hasSurvey`, sized by `bodyColumns` | hamzafer `mods/context-bar/hooks/register.tsx` · `mods/agent-radar/hooks/register.tsx` |
| 3 | **Guard with a ceremony**: classify → `$.ui.ask` → deny with a reason for Claude; `.catch` fails closed | OneWave `launch-codes/hooks/register.tsx` + `classify.ts` · hamzafer `mods/blast-radius` |
| 4 | **Watcher**: status line, toasts on `session.receive`/`turn.complete`, health check on a single-flight timer | modu-ai `mods/moai-status/hooks/register.ts` (Apache-2.0) |
| 5 | **Command-only**, with a `demo`/`show`/`hide` subcommand parser | hamzafer `mods/session-saver/hooks/register.tsx` |
| 6 | **Spinner decoration**: `next({...e, props: {...e.props, suffix}})` | modu-ai `mods/moai-status` |
| 7 | **Rewrite a subagent's model** on `agent.spawn` | hamzafer `mods/switchboard/hooks/register.tsx` + `route.ts` |
| 8 | **Model calls** (`$.model.complete` with Haiku) for a generated line | OneWave `inner-monologue` · hamzafer `mods/where-am-i` |
| 9 | **Animation**: `$.ui.blit` cells on a clock, stopping when a blit is refused (pane gone) | OneWave `boss-fight`, `code-pet` · mobile-next `plugin/hooks/register.tsx` (Apache-2.0) |
| 10 | **Interactive widget** via a `Client` module (keys, frame clock, `ui.message` back) | hamzafer `mods/snake/hooks/game.tsx` |
| 11 | **Hybrid plugin**: skills/agents/MCP plus a hooks module in one plugin | AgriciDaniel `claude-seo/plugins/seo-cockpit` · mobile-next `plugin/` |
| 12 | **Classic hook from a module**: `classic.UserPromptSubmit` returning `{...ran, sessionTitle}` | zhangbububu `session-titles/plugins/last-prompt-title` |
| 13 | **Model-callable tool** served by the mod (`$.tool.register` + `tool.call` hook) | this repo: `plugins/mod-builder/hooks/register.tsx` (`lab_report`) |
| 14 | **Pure logic + engine tests**: `tests/*-logic.test.ts` and `$.ui.mount` pane tests | this repo: `plugins/mod-builder/tests/` · hamzafer `mods/*/tests` |

Repos:
- OneWave: https://github.com/OneWave-AI/claude-code-mods
- hamzafer: https://github.com/hamzafer/claude-code-mods
- modu-ai: https://github.com/modu-ai/moai-adk
- mobile-next: https://github.com/mobile-next/mobile-mcp
- AgriciDaniel: https://github.com/AgriciDaniel/claude-seo
- zhangbububu: https://github.com/zhangbububu/session-titles

Anthropic's own mods (`diff`, `agents-md`, `telemetry`, `sec-default`) live at
https://github.com/anthropics/claude-code/tree/main/mods. They're for reading only (all rights
reserved), and they show the house style of the engine's authors.

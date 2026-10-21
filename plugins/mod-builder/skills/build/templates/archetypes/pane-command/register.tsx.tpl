import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { DEMO_ITEMS, moved, paneAction, rowsThatFit, summaryOf, toggled } from './__NAME__-logic'

/**
 * __TITLE__: a pane beside the transcript, opened by /__NAME__.
 * Archetype: pane + command. The command answers at once and opens the pane
 * in the background; buttons with hotkeys drive it.
 */

const PANE = '__NAME__'
/** The pane as every open asks for it; bringing it to the front adds only `focus`. */
const PANE_ARGS = { id: PANE, title: '__TITLE__', columns: 60 }
/** How long after asking for the front the pane is read again. */
const FRONT_CHECK_MS = 500

const items = atom({ plugin: '__NAME__', key: 'items' } as const, [])
const selected = atom({ plugin: '__NAME__', key: 'selected' } as const, 0)

async function openPane($: EngineInterface): Promise<void> {
  const opened = await $.ui.open(PANE_ARGS)
  if (!opened.isPlaced) $.ui.toast('__TITLE__ needs a wider window. Widen it to see the pane.')
}

async function paneActionOf($: EngineInterface): Promise<ReturnType<typeof paneAction>> {
  return paneAction(await $.ui.panes(), PANE)
}

/**
 * Asks for a pane that is a tab behind another to the front, with the keyboard. Only for a person who asked to see the
 * pane: a start or a background open never takes the keyboard. A pane still behind another afterwards is named in a toast.
 */
async function bringToFront($: EngineInterface): Promise<void> {
  await $.ui.open({ ...PANE_ARGS, focus: true })
  $.clock.after(FRONT_CHECK_MS, () => void warnIfBehind($).catch(() => undefined))
}

async function warnIfBehind($: EngineInterface): Promise<void> {
  if ((await paneActionOf($)) === 'show') $.ui.toast('__TITLE__ is still behind another tab: ctrl+x tab, then again until it shows.')
}

/** A command that names the pane: a tab behind another comes to the front, any other pane is opened as before. */
async function openOrFront($: EngineInterface): Promise<void> {
  if ((await paneActionOf($)) === 'show') void bringToFront($).catch(() => undefined)
  else await openPane($)
}

async function move($: EngineInterface, by: number): Promise<void> {
  const count = (await read($, items)).length
  await update($, selected, at => moved(at, by, count))
}

async function toggleSelected($: EngineInterface): Promise<void> {
  const at = await read($, selected)
  await update($, items, list => toggled(list, at))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command
      .register({ name: '__NAME__', description: __DESCRIPTION_JS__, argumentHint: '[demo]', immediate: true })
      .catch(() => undefined)
    return next(e)
  })

  on('command.run', { command: '__NAME__' }, async ($, e) => {
    try {
      if (e.args.trim().toLowerCase() === 'demo') {
        // The open goes out before this hook returns, ahead of the demo items: an open after that is unasked.
        await openOrFront($).catch(() => undefined)
        void update($, items, () => DEMO_ITEMS).catch(() => undefined)
        return { text: '__TITLE__: demo items are in the pane.' }
      }
      // Three states: not open, shown, or open as a tab behind another pane.
      const action = await paneActionOf($)
      if (action === 'show') {
        void bringToFront($).catch(() => undefined)
        return { text: 'Bringing __TITLE__ to the front; it takes the keyboard if your prompt is empty (Esc gives it back).' }
      }
      void (action === 'close' ? $.ui.close({ id: PANE }) : openPane($)).catch(() => undefined)
      return { text: action === 'close' ? '__TITLE__ closed. /__NAME__ to reopen.' : '__TITLE__ opened.' }
    } catch {
      return { text: '__TITLE__: something went wrong; see claude --debug.' }
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, items)
    const at = await read($, selected)
    const room = rowsThatFit(e.props.scroll.bodyRows)
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box justifyContent="space-between">
          <Text color="#D97757" bold>
            ◆ __TITLE__
          </Text>
          <Text dimColor>{summaryOf(list)}</Text>
        </Box>
        <Text dimColor>{'─'.repeat(Math.max(10, e.props.bodyColumns - 2))}</Text>
        {list.length === 0 && <Text dimColor>Type /__NAME__ demo to see it with items.</Text>}
        {list.slice(0, room).map((item, index) => (
          <Text key={`item-${item.id}`} inverse={index === at} color={item.isDone ? '#7FB685' : undefined}>
            {index === at ? '▸ ' : '  '}
            {item.isDone ? '●' : '○'} {item.label}
          </Text>
        ))}
        <Box gap={2} marginTop={1}>
          <Button key="toggle" label="Toggle" hotkey="x" variant="primary" onPress={() => void toggleSelected($).catch(() => undefined)} />
          <Button key="next" label="Next" hotkey="j" plain onPress={() => void move($, 1).catch(() => undefined)} />
          <Button key="prev" label="Prev" hotkey="k" plain onPress={() => void move($, -1).catch(() => undefined)} />
        </Box>
      </Box>
    )
  })
}

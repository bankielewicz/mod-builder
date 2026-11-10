// pane-template: one pane, opened by the command /pane-template, that draws one line. Laid by mod-builder from its
// pane template; everything here is the mod's own to change.
import type { Register } from 'claude-code'

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'pane-template', description: 'Open the pane-template pane' })

    return next(e)
  })

  on('command.run', { command: 'pane-template' }, async ($) => {
    await $.ui.open({ id: 'pane-template', title: 'Pane template' })

    return { text: 'The pane is open.' }
  })

  on('ui.render', { component: 'Pane', requestId: 'pane-template' }, ($, e) => {
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        <Text>Nothing to show yet.</Text>
      </Box>
    )
  })
}

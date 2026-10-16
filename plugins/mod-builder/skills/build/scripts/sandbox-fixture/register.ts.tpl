import type { Register } from 'claude-code'

// check-sandbox.mjs's fixture: a plugin with nothing to do, so its tests are all that runs.
export const register: Register = on => {
  on('session.start', async ($, e, next) => next(e))
}
export default register

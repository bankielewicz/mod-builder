// __TITLE__'s state contract. Self-contained: no imports.

export type Decision = { command: string; reason: string; verdict: 'allowed' | 'denied' }

declare module 'claude-code' {
  interface PluginState {
    '__NAME__': { last: Decision | null }
  }
}

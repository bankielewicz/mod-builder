// __TITLE__'s state contract. Self-contained: no imports.

export type Turn = { tools: number; failures: number }

declare module 'claude-code' {
  interface PluginState {
    '__NAME__': { turn: Turn | null; isHidden: boolean }
  }
}

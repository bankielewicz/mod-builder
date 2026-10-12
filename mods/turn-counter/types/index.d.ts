// Turn Counter's state contract. Self-contained: no imports.

export type Turn = { tools: number; failures: number }

declare module 'claude-code' {
  interface PluginState {
    'turn-counter': { turn: Turn | null; isHidden: boolean }
  }
}

// __TITLE__'s state contract. Self-contained: no imports.

export type Stats = { turns: number; tools: number; failed: number; turnStartedAt: number | null }

declare module 'claude-code' {
  interface PluginState {
    '__NAME__': { stats: Stats }
  }
}

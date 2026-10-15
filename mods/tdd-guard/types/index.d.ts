// Tdd Guard's state contract. Self-contained: no imports.

declare module 'claude-code' {
  interface PluginState {
    /** `pending`: guarded background runs still going, by agent id, to the subagent type they were started as. */
    'tdd-guard': { pending: Record<string, string> }
  }
}

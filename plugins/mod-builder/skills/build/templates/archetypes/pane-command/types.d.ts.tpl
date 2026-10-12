// __TITLE__'s state contract. Self-contained: no imports.

export type Item = { id: string; label: string; isDone: boolean }

declare module 'claude-code' {
  interface PluginState {
    '__NAME__': { items: Item[]; selected: number }
  }
}

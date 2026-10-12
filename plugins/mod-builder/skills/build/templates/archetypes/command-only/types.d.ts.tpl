// __TITLE__ keeps nothing in $.state; its notes live in $.store under '__NAME__:notes'.
// The note type lives here so the hooks and the logic share one declaration.

export type Note = { text: string; at: number }

declare module 'claude-code' {
  interface PluginState {
    '__NAME__': Record<string, never>
  }
}

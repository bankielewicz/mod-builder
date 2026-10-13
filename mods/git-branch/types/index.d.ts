// Git Branch's state contract. Self-contained: no imports.

/** What `git status --porcelain=v2 --branch` said, or why it said nothing. */
export type Snapshot =
  | { kind: 'branch'; branch: string; ahead: number; behind: number; changed: number }
  | { kind: 'detached'; oid: string; changed: number }
  | { kind: 'unborn'; branch: string; changed: number }
  | { kind: 'none' }
  | { kind: 'error'; message: string }

declare module 'claude-code' {
  interface PluginState {
    'git-branch': { snapshot: Snapshot | null; isHidden: boolean; isDemo: boolean }
  }
}

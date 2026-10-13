// Duet's state contract. Self-contained: no imports.

export type Provider = 'codex' | 'claude'
export type TaskStatus = 'running' | 'done' | 'error' | 'refused'
export type Sandbox = 'read-only' | 'workspace-write'

/** What a handoff carried, shown when a row is selected. */
export type Envelope = {
  specVersion: string
  base: string
  candidate: string
  sandbox: Sandbox
  scope: string
  role: string
}

/** One delegated task, as the pane draws it. */
export type Task = {
  id: string
  provider: Provider
  kind: 'agent' | 'review'
  subagentType: string
  model: string
  status: TaskStatus
  startedAt: number
  endedAt: number | null
  tokens: number
  description: string
  detail: string
  envelope: Envelope | null
}

/** One entry of Codex's model catalog, as the config pane offers it. */
export type CodexModel = {
  slug: string
  name: string
  description: string
  isHidden: boolean
}

/** A Claude subagent that answers later (background or teammate), kept until its first turn ends. */
export type ClaudePending = {
  startedAt: number
  type: string
  description: string
}

export type Consent = 'unasked' | 'yes' | 'no'
export type View = 'tasks' | 'stats'

declare module 'claude-code' {
  interface PluginState {
    duet: {
      tasks: Task[]
      selected: number
      view: View
      consent: Consent
      statsText: string
      now: number
      isDemo: boolean
      /** /duet config pane: edited values by field name, not yet saved. */
      configDraft: Record<string, string>
      /** The pane's last message (saved, refused, a value that does not fit). */
      configNote: string
      /** A save is under way; a reload mid-save finishes it at session.start. */
      configSaving: boolean
      /** Which config row is highlighted. */
      configAt: number
      /** The text field being edited in the config pane, '' when none. */
      configEditing: string
      /** Codex's model catalog as last fetched; [] before the first fetch. */
      configModels: CodexModel[]
      /** The catalog fetch: 'idle', 'fetching', or why the last one failed. */
      configModelsState: string
      /** The model list is open on the model row (e opens it; a pick, t, or moving off closes it). */
      configPicking: boolean
      /** When a save that writes began (0: none): the reload it causes reopens and refocuses the pane. */
      configReopenAt: number
      /** Claude subagents that answer later, by agentId; measured at their first turn.complete. */
      claudePending: Record<string, ClaudePending>
    }
  }
}

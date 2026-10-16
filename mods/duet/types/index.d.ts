// Duet's state contract. Self-contained: no imports.

/** Who ran a task: Codex, a Claude subagent, or (0.3.0) an API provider by its id. */
export type Provider = 'codex' | 'claude' | 'anthropic' | 'openai' | 'google' | 'xai' | 'mistral' | 'deepseek' | 'groq' | 'together' | 'fireworks' | 'openrouter' | 'perplexity' | 'cerebras' | 'ollama' | 'custom'

/** A provider key test's outcome (0.3.0), kept in $.store under duet:providers:tests; never the key. */
export type ProviderTest = {
  ok: boolean
  status: number
  ms: number
  model: string
  note: string
  at: number
}
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
  /** The Grep tool's arguments, so `tool.call { tool: 'Grep' }` type-checks before a session has laid claude-code-tools beside the mod (0.3.0). */
  interface BuiltinToolInputs {
    Grep: { pattern: string; path?: string; glob?: string; output_mode?: string }
  }
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
      /** /duet provider pane (0.3.0): which row is highlighted. */
      providerAt: number
      /** The key field is open on the highlighted row. */
      providerEditing: boolean
      /** The provider whose model list is open under its row, '' when none. */
      providerListing: string
      /** The listed provider's model ids, or the reason they could not be listed. */
      providerModels: string[]
      providerModelsState: string
      /** The pane's last message (saved, removed, refused). */
      providerNote: string
      /** Sign-in by provider id, as the pane shows it (masked key and source); never the key itself. */
      providerAuth: Record<string, string>
      /** Key tests by provider id, as last stored, plus 'running' while one runs. */
      providerTests: Record<string, ProviderTest | 'running'>
      /** Why the key file is not usable ('' when it is): no home folder, or a file that is there but can't be read. */
      providerFileError: string
    }
  }
}

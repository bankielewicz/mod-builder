// Mod Lab's state contract: every value it keeps in `$.state`, and the types
// those values are made of. Self-contained by rule: no imports. hooks/mod-builder-logic.ts
// and hooks/register.tsx import these types from here.

export type Stage = 'Spec' | 'Scaffold' | 'Logic' | 'Register' | 'Validate' | 'Test' | 'README' | 'Share'

/** A run Mod Lab starts itself, by button, by hotkey or after a `lab_report`. */
export type RunKind = 'Validate' | 'Test' | 'Typecheck'

export type Light = 'pending' | 'running' | 'passed' | 'failed' | 'stale'

export type Tone = 'success' | 'accent' | 'error' | 'warn' | 'dim' | 'text'

export type Gate = { hook: string; hasCatch: boolean }

export type Reach = { label: string; value: string }

/** What a `lab_report` call last said, before the disk confirms it. */
export type Reported = {
  stage: Stage
  status: 'running' | 'passed' | 'failed'
  note?: string
  /** When this report arrived, for the band's timer. */
  since: number
  /** The mods folder the session was in when it reported: a placeholder row shows only there (#19). */
  dir?: string
}

/** One mod as the pane, band and status line draw it. */
export type ModView = {
  name: string
  lights: Light[]
  status: string
  tone: Tone
  /** The time column: a run's elapsed time while it runs, else the last run's duration. */
  time: string
  isDemo: boolean
  /** Went all green during this session: the row reads "ready to share" and the done box shows. */
  isFresh: boolean
  version: string | null
  description: string | null
  /** The mod's folder as the session read it at the last scan, with a trailing `/` (`mods/<name>/` under the default `modsDir`); the demo's is `not written to disk`. The detail header works it out again when it draws. */
  path: string
  /** README.md is older than the code it describes. */
  isReadmeStale: boolean
  /** The done box's line, when the mod is fresh. */
  doneLine: string | null
  archetype: string | null
  builtOn: string | null
  hooks: string[]
  reaches: Reach[]
  gates: Gate[]
  errors: string[]
  failedStage: Stage | null
  /** Reported by a build before its folder exists: a row with no actions, until a scan finds the folder. */
  isPlaceholder: boolean
}

/** A run in flight: which mod, which kind, since when, and how far it has got. */
export type Run = {
  mod: string
  kind: RunKind
  startedAt: number
  /** Tests reported so far (streamed), and the total the last run had, when known. */
  passed: number
  failed: number
  total: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'mod-builder': {
      /**
       * The last scan's verdict, written as one value so no reader pairs one folder's rows with
       * another's path: `views`, the mods on disk judged (the demo is not among them), and `modsDir`,
       * the folder they were judged in, which the pane's buttons act on (null before the first scan).
       */
      judged: { modsDir: string | null; views: ModView[] }
      /** The row the detail panel shows. */
      selected: string | null
      runs: Run[]
      reported: Record<string, Reported>
      /** Builds still running, per mods folder then mod name, for placeholder rows (see `withBuilding`). */
      building: Record<string, Record<string, Reported>>
      /** The animation clock: frame count and the time it last ticked. */
      frame: { n: number; now: number }
      /** When the demo started, or null when none runs. */
      demoStartedAt: number | null
      /** The README the pane shows in place of the list, or null. */
      readme: { name: string; text: string; isStale: boolean } | null
      /** Mods that went all green this session (newest code stamp), for "ready to share", as `<modsDir>/<name>`. */
      fresh: string[]
      /** The "too narrow" toast fired for the current narrow spell; reset once wide again. */
      hasWarnedNarrow: boolean
    }
  }
}

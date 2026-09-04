export const OFFSCREEN_TARGET = 'offscreen' as const
export const SESSION_PORT_NAME = 'loudness-session' as const

export const MIN_BLOCKS_FOR_RELIABLE_LUFS = 10
export const MIN_GAIN_DB = -60
export const DEFAULT_MAX_GAIN_DB = 0
export const GAIN_CHANGE_EPSILON_DB = 0.01

export interface TabLufs {
  momentary: number
  shortTerm: number
  integrated: number
  blockCount: number
}

export interface CapturedTab {
  tabId: number
  title: string
  url: string
  isCapturing: boolean
  currentLufs: TabLufs
  gainDb: number
  maxGainDb: number
  isSolo: boolean
}

export interface AutoBalanceSettings {
  enabled: boolean
  targetLufs: number
}

export interface LimiterSettings {
  enabled: boolean
  thresholdDb: number
  kneeDb: number
  ratio: number
  attackMs: number
  releaseMs: number
}

export interface PersistedSettings {
  autoBalance: AutoBalanceSettings
  limiter: LimiterSettings
}

export interface SessionSnapshot {
  tabs: CapturedTab[]
  soloTabId: number | null
}

export interface ExtensionState extends SessionSnapshot {
  autoBalanceSettings: AutoBalanceSettings
  limiterSettings: LimiterSettings
}

export const DEFAULT_AUTO_BALANCE_SETTINGS: Readonly<AutoBalanceSettings> = {
  enabled: false,
  targetLufs: -14,
}

export const DEFAULT_LIMITER_SETTINGS: Readonly<LimiterSettings> = {
  enabled: false,
  thresholdDb: -1,
  kneeDb: 0,
  ratio: 20,
  attackMs: 1,
  releaseMs: 100,
}

export function emptyLufs(): TabLufs {
  return {
    momentary: -Infinity,
    shortTerm: -Infinity,
    integrated: -Infinity,
    blockCount: 0,
  }
}

export function emptySession(): SessionSnapshot {
  return { tabs: [], soloTabId: null }
}

export function createDefaultSettings(): PersistedSettings {
  return {
    autoBalance: { ...DEFAULT_AUTO_BALANCE_SETTINGS },
    limiter: { ...DEFAULT_LIMITER_SETTINGS },
  }
}

export type BackgroundRequest =
  | { type: 'GET_STATE' }
  | { type: 'START_CAPTURE_REQUEST'; tabId: number }
  | { type: 'STOP_CAPTURE_REQUEST'; tabId: number }
  | { type: 'SET_GAIN_REQUEST'; tabId: number; gainDb: number }
  | { type: 'SET_MAX_GAIN_REQUEST'; tabId: number; maxGainDb: number }
  | { type: 'TOGGLE_SOLO'; tabId: number }
  | { type: 'CLEAR_SOLO' }
  | { type: 'AUTO_BALANCE_REQUEST'; targetLufs?: number }
  | { type: 'SET_AUTO_BALANCE_ENABLED'; enabled: boolean }
  | { type: 'SET_TARGET_LUFS'; targetLufs: number }
  | { type: 'SET_LIMITER_SETTINGS'; settings: Partial<LimiterSettings> }
  | { type: 'RESET_LUFS_REQUEST'; tabId: number }

export type OffscreenRequest =
  | {
      type: 'START_CAPTURE'
      target: typeof OFFSCREEN_TARGET
      tabId: number
      streamId: string
      title: string
      url: string
    }
  | { type: 'STOP_CAPTURE'; target: typeof OFFSCREEN_TARGET; tabId: number }
  | { type: 'SET_GAIN'; target: typeof OFFSCREEN_TARGET; tabId: number; gainDb: number }
  | {
      type: 'SET_MAX_GAIN'
      target: typeof OFFSCREEN_TARGET
      tabId: number
      maxGainDb: number
    }
  | { type: 'TOGGLE_SOLO'; target: typeof OFFSCREEN_TARGET; tabId: number }
  | { type: 'CLEAR_SOLO'; target: typeof OFFSCREEN_TARGET }
  | { type: 'AUTO_BALANCE_ONCE'; target: typeof OFFSCREEN_TARGET; targetLufs: number }
  | { type: 'RESET_LUFS'; target: typeof OFFSCREEN_TARGET; tabId: number }
  | {
      type: 'SYNC_SETTINGS'
      target: typeof OFFSCREEN_TARGET
      settings: PersistedSettings
    }
  | {
      type: 'UPDATE_TAB_METADATA'
      target: typeof OFFSCREEN_TARGET
      tabId: number
      title?: string
      url?: string
    }

export interface CommandResponse {
  success: boolean
  state?: ExtensionState
  error?: string
}

export interface OffscreenResponse {
  success: boolean
  session: SessionSnapshot
  error?: string
}

export interface SessionPortMessage {
  type: 'SESSION_UPDATED'
  session: SessionSnapshot
}

export interface CaptureEndedMessage {
  type: 'CAPTURE_ENDED'
  tabId: number
  tabCount: number
  reason: string
}

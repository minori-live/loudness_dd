export const OFFSCREEN_TARGET = 'offscreen' as const
export const SESSION_PORT_NAME = 'loudness-session' as const

export const MIN_BLOCKS_FOR_RELIABLE_LUFS = 10
export const MIN_GAIN_DB = -60
export const DEFAULT_MAX_GAIN_DB = 0
export const GAIN_CHANGE_EPSILON_DB = 0.1
export const FOCUS_ATTENUATION_DB = -12

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
  isFocused: boolean
}

export interface AutoBalanceSettings {
  targetLufs: number
}

export interface AutoFocusSettings {
  enabled: boolean
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
  autoFocus: AutoFocusSettings
  limiter: LimiterSettings
}

export interface SessionSnapshot {
  tabs: CapturedTab[]
  soloTabId: number | null
  focusTabId: number | null
}

export interface ExtensionState extends SessionSnapshot {
  autoBalanceSettings: AutoBalanceSettings
  autoFocusSettings: AutoFocusSettings
  limiterSettings: LimiterSettings
}

export const DEFAULT_AUTO_BALANCE_SETTINGS: Readonly<AutoBalanceSettings> = {
  targetLufs: -14,
}

export const DEFAULT_AUTO_FOCUS_SETTINGS: Readonly<AutoFocusSettings> = {
  enabled: false,
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
  return { tabs: [], soloTabId: null, focusTabId: null }
}

export function createDefaultSettings(): PersistedSettings {
  return {
    autoBalance: { ...DEFAULT_AUTO_BALANCE_SETTINGS },
    autoFocus: { ...DEFAULT_AUTO_FOCUS_SETTINGS },
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
  | { type: 'TOGGLE_FOCUS'; tabId: number }
  | { type: 'CLEAR_FOCUS' }
  | { type: 'SET_AUTO_FOCUS_ENABLED'; enabled: boolean }
  | { type: 'SET_TARGET_LUFS'; targetLufs: number; persist?: boolean }
  | { type: 'SET_LIMITER_SETTINGS'; settings: Partial<LimiterSettings>; persist?: boolean }
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
  | { type: 'TOGGLE_FOCUS'; target: typeof OFFSCREEN_TARGET; tabId: number }
  | { type: 'SET_FOCUS'; target: typeof OFFSCREEN_TARGET; tabId: number | null }
  | { type: 'CLEAR_FOCUS'; target: typeof OFFSCREEN_TARGET }
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

export interface SessionMeterUpdate {
  tabId: number
  currentLufs: TabLufs
  gainDb: number
}

export type SessionPortMessage =
  | {
      type: 'SESSION_UPDATED'
      session: SessionSnapshot
    }
  | {
      type: 'SESSION_METERS_UPDATED'
      updates: SessionMeterUpdate[]
    }

export interface CaptureEndedMessage {
  type: 'CAPTURE_ENDED'
  tabId: number
  tabCount: number
  reason: string
}

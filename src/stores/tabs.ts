import { defineStore } from 'pinia'
import { computed, shallowRef } from 'vue'

import {
  DEFAULT_AUTO_BALANCE_SETTINGS,
  DEFAULT_LIMITER_SETTINGS,
  MIN_BLOCKS_FOR_RELIABLE_LUFS,
  SESSION_PORT_NAME,
  type AutoBalanceSettings,
  type BackgroundRequest,
  type CapturedTab,
  type CommandResponse,
  type ExtensionState,
  type LimiterSettings,
  type SessionPortMessage,
  type SessionSnapshot,
  type TabLufs,
} from '@/protocol'

export { MIN_BLOCKS_FOR_RELIABLE_LUFS }
export type { AutoBalanceSettings, CapturedTab, LimiterSettings, TabLufs }

export function hasEnoughSamples(lufs: TabLufs): boolean {
  return lufs.blockCount >= MIN_BLOCKS_FOR_RELIABLE_LUFS
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function isSessionPortMessage(message: unknown): message is SessionPortMessage {
  return Boolean(
    message &&
    typeof message === 'object' &&
    'type' in message &&
    message.type === 'SESSION_UPDATED' &&
    'session' in message,
  )
}

export const useTabsStore = defineStore('tabs', () => {
  const tabs = shallowRef<CapturedTab[]>([])
  const soloTabId = shallowRef<number | null>(null)
  const autoBalanceSettings = shallowRef<AutoBalanceSettings>({
    ...DEFAULT_AUTO_BALANCE_SETTINGS,
  })
  const limiterSettings = shallowRef<LimiterSettings>({ ...DEFAULT_LIMITER_SETTINGS })
  const isLoading = shallowRef(false)
  const error = shallowRef<string | null>(null)

  let sessionPort: chrome.runtime.Port | null = null
  let syncActive = false

  const capturedTabIds = computed(() => tabs.value.map((tab) => tab.tabId))
  const hasCaptures = computed(() => tabs.value.length > 0)
  const isAutoBalancing = computed(() => autoBalanceSettings.value.enabled)
  const targetLufs = computed(() => autoBalanceSettings.value.targetLufs)
  const averageLufs = computed(() => {
    const validTabs = tabs.value.filter((tab) => Number.isFinite(tab.currentLufs.integrated))
    if (validTabs.length === 0) return -Infinity
    return validTabs.reduce((sum, tab) => sum + tab.currentLufs.integrated, 0) / validTabs.length
  })
  const isLimiterEnabled = computed(() => limiterSettings.value.enabled)
  const limiterThreshold = computed(() => limiterSettings.value.thresholdDb)
  const limiterAttack = computed(() => limiterSettings.value.attackMs)
  const limiterRelease = computed(() => limiterSettings.value.releaseMs)
  const limiterKnee = computed(() => limiterSettings.value.kneeDb)
  const limiterRatio = computed(() => limiterSettings.value.ratio)
  const hasSolo = computed(() => soloTabId.value !== null)

  function applySession(session: SessionSnapshot): void {
    tabs.value = session.tabs
    soloTabId.value = session.soloTabId
  }

  function applyState(state: ExtensionState): void {
    applySession(state)
    autoBalanceSettings.value = state.autoBalanceSettings
    limiterSettings.value = state.limiterSettings
  }

  function disconnectSessionPort(): void {
    if (!sessionPort) return
    sessionPort.disconnect()
    sessionPort = null
  }

  function connectSessionPort(): void {
    if (!syncActive || sessionPort || tabs.value.length === 0) return

    const port = chrome.runtime.connect({ name: SESSION_PORT_NAME })
    sessionPort = port
    port.onMessage.addListener((message: unknown) => {
      if (isSessionPortMessage(message)) applySession(message.session)
    })
    port.onDisconnect.addListener(() => {
      if (sessionPort === port) sessionPort = null
    })
  }

  async function sendCommand(message: BackgroundRequest, fallback: string): Promise<boolean> {
    try {
      const result = (await chrome.runtime.sendMessage(message)) as CommandResponse
      if (result.state) applyState(result.state)
      if (!result.success) error.value = result.error || fallback
      return result.success
    } catch (cause) {
      console.error(fallback, cause)
      error.value = errorMessage(cause, fallback)
      return false
    }
  }

  async function fetchState(): Promise<void> {
    await sendCommand({ type: 'GET_STATE' }, 'Failed to fetch extension state')
  }

  async function withLoading(action: () => Promise<boolean>): Promise<boolean> {
    isLoading.value = true
    error.value = null
    try {
      return await action()
    } finally {
      isLoading.value = false
    }
  }

  async function registerCurrentTab(): Promise<boolean> {
    return withLoading(async () => {
      try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true })
        if (!activeTab?.id) {
          error.value = 'No active tab found'
          return false
        }
        if (capturedTabIds.value.includes(activeTab.id)) {
          error.value = 'Tab is already being captured'
          return false
        }

        const success = await sendCommand(
          { type: 'START_CAPTURE_REQUEST', tabId: activeTab.id },
          'Failed to start capture',
        )
        if (success) connectSessionPort()
        return success
      } catch (cause) {
        console.error('Failed to register tab:', cause)
        error.value = errorMessage(cause, 'Failed to register tab')
        return false
      }
    })
  }

  async function unregisterTab(tabId: number): Promise<boolean> {
    return withLoading(async () => {
      const success = await sendCommand(
        { type: 'STOP_CAPTURE_REQUEST', tabId },
        'Failed to stop capture',
      )
      if (tabs.value.length === 0) disconnectSessionPort()
      return success
    })
  }

  function setGain(tabId: number, gainDb: number): Promise<boolean> {
    return sendCommand({ type: 'SET_GAIN_REQUEST', tabId, gainDb }, 'Failed to set gain')
  }

  function setMaxGain(tabId: number, maxGainDb: number): Promise<boolean> {
    return sendCommand({ type: 'SET_MAX_GAIN_REQUEST', tabId, maxGainDb }, 'Failed to set max gain')
  }

  function toggleSolo(tabId: number): Promise<boolean> {
    return sendCommand({ type: 'TOGGLE_SOLO', tabId }, 'Failed to toggle solo')
  }

  function clearSolo(): Promise<boolean> {
    return sendCommand({ type: 'CLEAR_SOLO' }, 'Failed to clear solo')
  }

  function autoBalanceNow(): Promise<boolean> {
    return sendCommand(
      { type: 'AUTO_BALANCE_REQUEST', targetLufs: autoBalanceSettings.value.targetLufs },
      'Failed to auto-balance',
    )
  }

  function setAutoBalanceEnabled(enabled: boolean): Promise<boolean> {
    return sendCommand({ type: 'SET_AUTO_BALANCE_ENABLED', enabled }, 'Failed to set auto-balance')
  }

  async function toggleAutoBalance(): Promise<void> {
    await setAutoBalanceEnabled(!autoBalanceSettings.value.enabled)
  }

  function setTargetLufs(value: number): Promise<boolean> {
    return sendCommand({ type: 'SET_TARGET_LUFS', targetLufs: value }, 'Failed to set target LUFS')
  }

  function updateLimiter(settings: Partial<LimiterSettings>): Promise<boolean> {
    return sendCommand({ type: 'SET_LIMITER_SETTINGS', settings }, 'Failed to update limiter')
  }

  function setLimiterEnabled(enabled: boolean): Promise<boolean> {
    return updateLimiter({ enabled })
  }

  function setLimiterThreshold(thresholdDb: number): Promise<boolean> {
    return updateLimiter({ thresholdDb })
  }

  function setLimiterAttack(attackMs: number): Promise<boolean> {
    return updateLimiter({ attackMs })
  }

  function setLimiterRelease(releaseMs: number): Promise<boolean> {
    return updateLimiter({ releaseMs })
  }

  function setLimiterKnee(kneeDb: number): Promise<boolean> {
    return updateLimiter({ kneeDb })
  }

  function setLimiterRatio(ratio: number): Promise<boolean> {
    return updateLimiter({ ratio })
  }

  function resetLufs(tabId: number): Promise<boolean> {
    return sendCommand({ type: 'RESET_LUFS_REQUEST', tabId }, 'Failed to reset LUFS')
  }

  async function startSync(): Promise<void> {
    if (syncActive) return
    syncActive = true
    await fetchState()
    connectSessionPort()
  }

  function stopSync(): void {
    syncActive = false
    disconnectSessionPort()
  }

  function clearError(): void {
    error.value = null
  }

  return {
    tabs,
    soloTabId,
    autoBalanceSettings,
    limiterSettings,
    isLoading,
    error,
    capturedTabIds,
    hasCaptures,
    isAutoBalancing,
    targetLufs,
    averageLufs,
    isLimiterEnabled,
    limiterThreshold,
    limiterAttack,
    limiterRelease,
    limiterKnee,
    limiterRatio,
    hasSolo,
    fetchState,
    registerCurrentTab,
    unregisterTab,
    setGain,
    setMaxGain,
    toggleSolo,
    clearSolo,
    autoBalanceNow,
    setAutoBalanceEnabled,
    toggleAutoBalance,
    setTargetLufs,
    setLimiterEnabled,
    setLimiterThreshold,
    setLimiterAttack,
    setLimiterRelease,
    setLimiterKnee,
    setLimiterRatio,
    resetLufs,
    startSync,
    stopSync,
    clearError,
  }
})

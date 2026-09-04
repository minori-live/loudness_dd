import { defineStore } from 'pinia'
import { computed, shallowRef } from 'vue'

import {
  DEFAULT_AUTO_BALANCE_SETTINGS,
  DEFAULT_AUTO_FOCUS_SETTINGS,
  DEFAULT_LIMITER_SETTINGS,
  MIN_BLOCKS_FOR_RELIABLE_LUFS,
  MIN_GAIN_DB,
  SESSION_PORT_NAME,
  type AutoBalanceSettings,
  type AutoFocusSettings,
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
export type { AutoBalanceSettings, AutoFocusSettings, CapturedTab, LimiterSettings, TabLufs }

export function hasEnoughSamples(lufs: TabLufs): boolean {
  return lufs.blockCount >= MIN_BLOCKS_FOR_RELIABLE_LUFS
}

interface BrowserTabPosition {
  windowId: number
  index: number
}

interface PendingCommand {
  message: BackgroundRequest
  fallback: string
  timer: ReturnType<typeof setTimeout>
}

const HOT_UPDATE_INTERVAL_MS = 50

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function isSessionPortMessage(message: unknown): message is SessionPortMessage {
  return Boolean(
    message &&
    typeof message === 'object' &&
    'type' in message &&
    (message.type === 'SESSION_UPDATED' || message.type === 'SESSION_METERS_UPDATED'),
  )
}

function isCommandResponse(response: unknown): response is CommandResponse {
  return Boolean(
    response &&
    typeof response === 'object' &&
    'success' in response &&
    typeof response.success === 'boolean',
  )
}

export const useTabsStore = defineStore('tabs', () => {
  const tabs = shallowRef<CapturedTab[]>([])
  const browserTabPositions = shallowRef(new Map<number, BrowserTabPosition>())
  const soloTabId = shallowRef<number | null>(null)
  const focusTabId = shallowRef<number | null>(null)
  const autoBalanceSettings = shallowRef<AutoBalanceSettings>({
    ...DEFAULT_AUTO_BALANCE_SETTINGS,
  })
  const autoFocusSettings = shallowRef<AutoFocusSettings>({ ...DEFAULT_AUTO_FOCUS_SETTINGS })
  const limiterSettings = shallowRef<LimiterSettings>({ ...DEFAULT_LIMITER_SETTINGS })
  const isLoading = shallowRef(false)
  const error = shallowRef<string | null>(null)

  let sessionPort: chrome.runtime.Port | null = null
  let syncActive = false
  let tabOrderSyncActive = false
  let tabOrderQueryRevision = 0
  const pendingCommands = new Map<string, PendingCommand>()

  const capturedTabIds = computed(() => tabs.value.map((tab) => tab.tabId))
  const orderedTabs = computed(() => {
    const windowGroups = new Map<
      number,
      { firstSessionIndex: number; entries: Array<{ tab: CapturedTab; index: number }> }
    >()
    const tabsWithoutPosition: CapturedTab[] = []

    tabs.value.forEach((tab, sessionIndex) => {
      const position = browserTabPositions.value.get(tab.tabId)
      if (!position) {
        tabsWithoutPosition.push(tab)
        return
      }

      const group = windowGroups.get(position.windowId)
      if (group) {
        group.entries.push({ tab, index: position.index })
        return
      }

      windowGroups.set(position.windowId, {
        firstSessionIndex: sessionIndex,
        entries: [{ tab, index: position.index }],
      })
    })

    const positionedTabs = Array.from(windowGroups.values())
      .sort((left, right) => left.firstSessionIndex - right.firstSessionIndex)
      .flatMap((group) =>
        group.entries.sort((left, right) => left.index - right.index).map(({ tab }) => tab),
      )

    return [...positionedTabs, ...tabsWithoutPosition]
  })
  const hasCaptures = computed(() => tabs.value.length > 0)
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
  const hasFocus = computed(() => focusTabId.value !== null)
  const isAutoFocusEnabled = computed(() => autoFocusSettings.value.enabled)

  function applySession(session: SessionSnapshot): void {
    tabs.value = session.tabs
    soloTabId.value = session.soloTabId
    focusTabId.value = session.focusTabId ?? null
  }

  function applyMeterUpdates(
    message: Extract<SessionPortMessage, { type: 'SESSION_METERS_UPDATED' }>,
  ): void {
    const updates = new Map(message.updates.map((update) => [update.tabId, update]))
    let changed = false
    const nextTabs = tabs.value.map((tab) => {
      const update = updates.get(tab.tabId)
      if (!update) return tab
      changed = true
      return { ...tab, currentLufs: update.currentLufs, gainDb: update.gainDb }
    })
    if (changed) tabs.value = nextTabs
  }

  function applyState(state: ExtensionState): void {
    applySession(state)
    autoBalanceSettings.value = state.autoBalanceSettings
    autoFocusSettings.value = state.autoFocusSettings ?? { ...DEFAULT_AUTO_FOCUS_SETTINGS }
    limiterSettings.value = state.limiterSettings
  }

  function scheduleCommand(key: string, message: BackgroundRequest, fallback: string): void {
    const pending = pendingCommands.get(key)
    if (pending) {
      pending.message = message
      pending.fallback = fallback
      return
    }

    const entry: PendingCommand = {
      message,
      fallback,
      timer: setTimeout(() => {
        pendingCommands.delete(key)
        void sendCommand(entry.message, entry.fallback, false)
      }, HOT_UPDATE_INTERVAL_MS),
    }
    pendingCommands.set(key, entry)
  }

  function cancelScheduledCommand(key: string): void {
    const pending = pendingCommands.get(key)
    if (!pending) return
    clearTimeout(pending.timer)
    pendingCommands.delete(key)
  }

  function cancelAllScheduledCommands(): void {
    for (const pending of pendingCommands.values()) clearTimeout(pending.timer)
    pendingCommands.clear()
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
      if (!isSessionPortMessage(message)) return
      if (message.type === 'SESSION_UPDATED') {
        applySession(message.session)
      } else {
        applyMeterUpdates(message)
      }
    })
    port.onDisconnect.addListener(() => {
      if (sessionPort === port) sessionPort = null
    })
  }

  async function refreshBrowserTabPositions(): Promise<void> {
    const revision = ++tabOrderQueryRevision

    try {
      const browserTabs = await chrome.tabs.query({})
      if (!syncActive || revision !== tabOrderQueryRevision) return

      browserTabPositions.value = new Map(
        browserTabs.flatMap((tab) =>
          tab.id === undefined
            ? []
            : [[tab.id, { windowId: tab.windowId, index: tab.index }] as const],
        ),
      )
    } catch (cause) {
      console.warn('Failed to refresh browser tab order:', cause)
    }
  }

  function handleBrowserTabOrderChanged(): void {
    void refreshBrowserTabPositions()
  }

  function connectBrowserTabOrderSync(): void {
    if (tabOrderSyncActive) return
    tabOrderSyncActive = true
    chrome.tabs.onMoved.addListener(handleBrowserTabOrderChanged)
    chrome.tabs.onAttached.addListener(handleBrowserTabOrderChanged)
    chrome.tabs.onDetached.addListener(handleBrowserTabOrderChanged)
    chrome.tabs.onCreated.addListener(handleBrowserTabOrderChanged)
    chrome.tabs.onRemoved.addListener(handleBrowserTabOrderChanged)
  }

  function disconnectBrowserTabOrderSync(): void {
    if (!tabOrderSyncActive) return
    tabOrderSyncActive = false
    chrome.tabs.onMoved.removeListener(handleBrowserTabOrderChanged)
    chrome.tabs.onAttached.removeListener(handleBrowserTabOrderChanged)
    chrome.tabs.onDetached.removeListener(handleBrowserTabOrderChanged)
    chrome.tabs.onCreated.removeListener(handleBrowserTabOrderChanged)
    chrome.tabs.onRemoved.removeListener(handleBrowserTabOrderChanged)
    tabOrderQueryRevision += 1
    browserTabPositions.value = new Map()
  }

  async function sendCommand(
    message: BackgroundRequest,
    fallback: string,
    applyResponseState = true,
  ): Promise<boolean> {
    try {
      const result: unknown = await chrome.runtime.sendMessage(message)
      if (!isCommandResponse(result)) {
        error.value = `${fallback}: background did not respond; reload the extension`
        return false
      }
      if (applyResponseState && result.state) applyState(result.state)
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
        if (success) {
          connectSessionPort()
          await refreshBrowserTabPositions()
        }
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

  function updateLocalGain(tabId: number, gainDb: number): void {
    const tab = tabs.value.find((candidate) => candidate.tabId === tabId)
    if (!tab) return
    const nextGain = Math.max(MIN_GAIN_DB, Math.min(tab.maxGainDb, gainDb))
    tabs.value = tabs.value.map((candidate) =>
      candidate.tabId === tabId ? { ...candidate, gainDb: nextGain } : candidate,
    )
  }

  function previewGain(tabId: number, gainDb: number): void {
    updateLocalGain(tabId, gainDb)
    scheduleCommand(
      `gain:${tabId}`,
      { type: 'SET_GAIN_REQUEST', tabId, gainDb },
      'Failed to preview gain',
    )
  }

  function setGain(tabId: number, gainDb: number): Promise<boolean> {
    cancelScheduledCommand(`gain:${tabId}`)
    updateLocalGain(tabId, gainDb)
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

  function toggleFocus(tabId: number): Promise<boolean> {
    return sendCommand({ type: 'TOGGLE_FOCUS', tabId }, 'Failed to toggle focus')
  }

  function clearFocus(): Promise<boolean> {
    return sendCommand({ type: 'CLEAR_FOCUS' }, 'Failed to clear focus')
  }

  function setAutoFocusEnabled(enabled: boolean): Promise<boolean> {
    return sendCommand({ type: 'SET_AUTO_FOCUS_ENABLED', enabled }, 'Failed to set auto-focus')
  }

  function previewTargetLufs(value: number): void {
    autoBalanceSettings.value = { targetLufs: value }
    scheduleCommand(
      'target-lufs',
      { type: 'SET_TARGET_LUFS', targetLufs: value, persist: false },
      'Failed to preview target LUFS',
    )
  }

  function setTargetLufs(value: number): Promise<boolean> {
    cancelScheduledCommand('target-lufs')
    autoBalanceSettings.value = { targetLufs: value }
    return sendCommand({ type: 'SET_TARGET_LUFS', targetLufs: value }, 'Failed to set target LUFS')
  }

  function previewLimiter(next: Partial<LimiterSettings>): void {
    limiterSettings.value = { ...limiterSettings.value, ...next }
    scheduleCommand(
      'limiter',
      { type: 'SET_LIMITER_SETTINGS', settings: limiterSettings.value, persist: false },
      'Failed to preview limiter settings',
    )
  }

  function updateLimiter(settings: Partial<LimiterSettings>): Promise<boolean> {
    cancelScheduledCommand('limiter')
    limiterSettings.value = { ...limiterSettings.value, ...settings }
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
    connectBrowserTabOrderSync()
    await Promise.all([fetchState(), refreshBrowserTabPositions()])
    connectSessionPort()
  }

  function stopSync(): void {
    syncActive = false
    cancelAllScheduledCommands()
    disconnectSessionPort()
    disconnectBrowserTabOrderSync()
  }

  function clearError(): void {
    error.value = null
  }

  return {
    tabs,
    orderedTabs,
    soloTabId,
    focusTabId,
    autoBalanceSettings,
    autoFocusSettings,
    limiterSettings,
    isLoading,
    error,
    capturedTabIds,
    hasCaptures,
    targetLufs,
    averageLufs,
    isLimiterEnabled,
    limiterThreshold,
    limiterAttack,
    limiterRelease,
    limiterKnee,
    limiterRatio,
    hasSolo,
    hasFocus,
    isAutoFocusEnabled,
    fetchState,
    registerCurrentTab,
    unregisterTab,
    previewGain,
    setGain,
    setMaxGain,
    toggleSolo,
    clearSolo,
    toggleFocus,
    clearFocus,
    setAutoFocusEnabled,
    previewTargetLufs,
    setTargetLufs,
    previewLimiter,
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

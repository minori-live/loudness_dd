/**
 * Background service worker for Loudness DD
 * Coordinates messaging between popup, offscreen document, and manages tab capture
 */

// Minimum blocks required for reliable LUFS-I measurement
const MIN_BLOCKS_FOR_RELIABLE_LUFS = 10

// Default gain limits
const DEFAULT_MIN_GAIN = -60
const DEFAULT_MAX_GAIN = 0
const GAIN_CHANGE_EPSILON_DB = 0.01
const AUTO_BALANCE_INTERVAL_MS = 100

interface TabCaptureState {
  tabId: number
  title: string
  url: string
  isCapturing: boolean
  currentLufs: {
    momentary: number
    shortTerm: number
    integrated: number
    blockCount: number
  }
  gainDb: number
  maxGainDb: number // Per-tab max gain limit
  isSolo: boolean // Solo mode - mutes all other tabs
  streamId?: string
}

/**
 * Check if a tab has enough samples for reliable LUFS measurement
 */
function hasEnoughSamples(tabState: TabCaptureState): boolean {
  return tabState.currentLufs.blockCount >= MIN_BLOCKS_FOR_RELIABLE_LUFS
}

interface AutoBalanceSettings {
  enabled: boolean
  targetLufs: number
}

interface LimiterSettings {
  enabled: boolean
  thresholdDb: number
  kneeDb: number
  ratio: number
  attackMs: number
  releaseMs: number
}

// State management
const capturedTabs: Map<number, TabCaptureState> = new Map()
let offscreenDocumentReady = false
let offscreenReadyResolve: (() => void) | null = null

// Auto-balance state (runs in background)
let autoBalanceSettings: AutoBalanceSettings = {
  enabled: false,
  targetLufs: -14, // Default target for streaming content
}
let autoBalanceTimer: ReturnType<typeof setTimeout> | null = null

// Limiter settings (global)
let limiterSettings: LimiterSettings = {
  enabled: false,
  thresholdDb: -1,
  kneeDb: 0,
  ratio: 20,
  attackMs: 1,
  releaseMs: 100,
}

// Solo mode: track which tab is currently soloed (null = no solo)
let soloTabId: number | null = null

// Cleanup interval for stale tabs
let cleanupInterval: ReturnType<typeof setInterval> | null = null

// Offscreen document path
const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html'

/**
 * Update the extension badge to show current status
 */
async function updateBadge(): Promise<void> {
  const tabCount = capturedTabs.size
  const isAutoBalancing = autoBalanceSettings.enabled

  if (tabCount === 0) {
    // No tabs monitored
    await chrome.action.setBadgeText({ text: '' })
    await chrome.action.setBadgeBackgroundColor({ color: '#4a5568' })
  } else if (isAutoBalancing) {
    // Auto-balance active - show green badge with tab count
    await chrome.action.setBadgeText({ text: `${tabCount}` })
    await chrome.action.setBadgeBackgroundColor({ color: '#48bb78' })
  } else {
    // Monitoring but no auto-balance - show blue badge
    await chrome.action.setBadgeText({ text: `${tabCount}` })
    await chrome.action.setBadgeBackgroundColor({ color: '#4299e1' })
  }
}

/**
 * Check if a tab still exists
 */
async function isTabValid(tabId: number): Promise<boolean> {
  try {
    await chrome.tabs.get(tabId)
    return true
  } catch {
    // Tab doesn't exist
    return false
  }
}

/**
 * Remove a tab from tracking (internal cleanup)
 */
async function removeTab(tabId: number, reason: string): Promise<void> {
  if (!capturedTabs.has(tabId)) return

  console.log(`Removing tab ${tabId}: ${reason}`)

  // If this was the soloed tab, clear solo mode
  if (soloTabId === tabId) {
    soloTabId = null
    // Restore gains on remaining tabs
    for (const [tid, state] of capturedTabs) {
      if (tid !== tabId) {
        state.isSolo = false
        try {
          await sendToOffscreen({
            type: 'SET_GAIN',
            tabId: tid,
            gainDb: state.gainDb,
          })
        } catch {
          // Ignore errors
        }
      }
    }
  }

  capturedTabs.delete(tabId)

  // Try to stop capture in offscreen (may fail if already stopped)
  try {
    await sendToOffscreen({
      type: 'STOP_CAPTURE',
      tabId,
    })
  } catch {
    // Ignore errors - tab may already be cleaned up
  }

  await saveState()
  await updateBadge()
}

/**
 * Clean up invalid/closed tabs
 */
async function cleanupInvalidTabs(): Promise<void> {
  const tabIds = Array.from(capturedTabs.keys())
  let hasChanges = false

  for (const tabId of tabIds) {
    const isValid = await isTabValid(tabId)
    if (!isValid) {
      console.log(`Tab ${tabId} no longer exists, removing`)
      capturedTabs.delete(tabId)
      hasChanges = true
    }
  }

  if (hasChanges) {
    await saveState()
    await updateBadge()
  }
}

/**
 * Start periodic cleanup of invalid tabs
 */
function startCleanupInterval(): void {
  if (cleanupInterval) return

  // Check for invalid tabs every 5 seconds
  cleanupInterval = setInterval(async () => {
    await cleanupInvalidTabs()
  }, 5000)
}

/**
 * Stop cleanup interval
 */
// function stopCleanupInterval(): void {
//   if (cleanupInterval) {
//     clearInterval(cleanupInterval)
//     cleanupInterval = null
//   }
// }

/**
 * Wait for offscreen document to be ready
 */
function waitForOffscreenReady(): Promise<void> {
  if (offscreenDocumentReady) return Promise.resolve()

  return new Promise((resolve) => {
    offscreenReadyResolve = resolve
  })
}

/**
 * Create offscreen document if it doesn't exist
 */
async function ensureOffscreenDocument(): Promise<void> {
  // Check if document already exists
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)],
  })

  if (existingContexts.length > 0) {
    offscreenDocumentReady = true
    return
  }

  // Reset ready state
  offscreenDocumentReady = false

  // Create the offscreen document
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: [chrome.offscreen.Reason.USER_MEDIA],
    justification: 'Audio processing for LUFS measurement and volume control',
  })

  // Wait for the offscreen document to signal it's ready
  await waitForOffscreenReady()
}

/**
 * Send message to offscreen document only
 */
async function sendToOffscreen(message: object): Promise<unknown> {
  try {
    // Ensure offscreen document exists and is ready
    await ensureOffscreenDocument()

    // Send message - offscreen document will handle it
    return await chrome.runtime.sendMessage({
      target: 'offscreen',
      ...message,
    })
  } catch (error) {
    console.error('Failed to send message to offscreen:', error)
    throw error
  }
}

/**
 * Start capturing a tab's audio
 */
async function startTabCapture(tabId: number): Promise<{ success: boolean; error?: string }> {
  try {
    // Check if tab exists
    const isValid = await isTabValid(tabId)
    if (!isValid) {
      return { success: false, error: 'Tab does not exist' }
    }

    // Get tab info
    const tab = await chrome.tabs.get(tabId)

    // Check if already capturing
    if (capturedTabs.has(tabId) && capturedTabs.get(tabId)?.isCapturing) {
      return { success: false, error: 'Tab is already being captured' }
    }

    // Ensure offscreen document exists
    await ensureOffscreenDocument()

    // Start tab capture
    const streamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId: tabId,
    })

    // Initialize tab state
    const tabState: TabCaptureState = {
      tabId,
      title: tab.title || 'Unknown Tab',
      url: tab.url || '',
      isCapturing: true,
      currentLufs: {
        momentary: -Infinity,
        shortTerm: -Infinity,
        integrated: -Infinity,
        blockCount: 0,
      },
      gainDb: 0,
      maxGainDb: DEFAULT_MAX_GAIN,
      isSolo: false,
      streamId,
    }

    capturedTabs.set(tabId, tabState)

    // Tell offscreen document to start processing
    const result = await sendToOffscreen({
      type: 'START_CAPTURE',
      tabId,
      streamId,
    })

    if (result && typeof result === 'object' && 'success' in result && !result.success) {
      // Capture failed in offscreen, remove from state
      capturedTabs.delete(tabId)
      return {
        success: false,
        error: 'error' in result ? String(result.error) : 'Failed to start audio capture',
      }
    }

    // Persist state and update badge
    await saveState()
    await updateBadge()

    return { success: true }
  } catch (error) {
    console.error('Failed to start tab capture:', error)
    // Clean up if we added to state
    capturedTabs.delete(tabId)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Stop capturing a tab's audio
 */
async function stopTabCapture(tabId: number): Promise<{ success: boolean; error?: string }> {
  try {
    const tabState = capturedTabs.get(tabId)
    if (!tabState) {
      return { success: false, error: 'Tab is not being captured' }
    }

    // Tell offscreen document to stop processing
    try {
      await sendToOffscreen({
        type: 'STOP_CAPTURE',
        tabId,
      })
    } catch {
      // Ignore errors - offscreen may already have cleaned up
    }

    capturedTabs.delete(tabId)

    // Persist state and update badge
    await saveState()
    await updateBadge()

    return { success: true }
  } catch (error) {
    console.error('Failed to stop tab capture:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Set gain for a tab
 */
async function setTabGain(
  tabId: number,
  gainDb: number,
  persist = true,
): Promise<{ success: boolean; error?: string }> {
  const tabState = capturedTabs.get(tabId)
  if (!tabState) {
    return { success: false, error: 'Tab is not being captured' }
  }

  // Clamp gain to per-tab limits
  gainDb = Math.max(DEFAULT_MIN_GAIN, Math.min(tabState.maxGainDb, gainDb))

  // Avoid redundant cross-context messages and storage writes for effectively
  // unchanged gains. Integrated LUFS can fluctuate by tiny floating-point amounts.
  if (Math.abs(tabState.gainDb - gainDb) < GAIN_CHANGE_EPSILON_DB) {
    return { success: true }
  }

  try {
    await sendToOffscreen({
      type: 'SET_GAIN',
      tabId,
      gainDb,
    })
  } catch {
    // If gain setting fails, the stream may have ended
    await removeTab(tabId, 'Failed to set gain - stream may have ended')
    return { success: false, error: 'Stream disconnected' }
  }

  tabState.gainDb = gainDb
  if (persist) {
    await saveState()
  }

  return { success: true }
}

/**
 * Set max gain limit for a tab
 */
async function setTabMaxGain(
  tabId: number,
  maxGainDb: number,
): Promise<{ success: boolean; error?: string }> {
  const tabState = capturedTabs.get(tabId)
  if (!tabState) {
    return { success: false, error: 'Tab is not being captured' }
  }

  // Clamp max gain to reasonable range (-20 to +20 dB)
  maxGainDb = Math.max(-20, Math.min(20, maxGainDb))
  tabState.maxGainDb = maxGainDb

  // If current gain exceeds new max, adjust it
  if (tabState.gainDb > maxGainDb) {
    await setTabGain(tabId, maxGainDb, false)
  }

  await saveState()
  return { success: true }
}

/**
 * Toggle solo mode for a tab
 * When a tab is soloed, all other tabs are muted
 */
async function toggleSolo(tabId: number): Promise<{ success: boolean; soloTabId: number | null }> {
  const tabState = capturedTabs.get(tabId)
  if (!tabState) {
    return { success: false, soloTabId }
  }

  if (soloTabId === tabId) {
    // Un-solo: restore all tabs to their saved gains
    soloTabId = null
    tabState.isSolo = false

    // Restore all tabs to their saved gains
    for (const state of capturedTabs.values()) {
      state.isSolo = false
    }
  } else {
    // Solo this tab: mute all other tabs
    // If another tab was soloed, un-solo it first
    if (soloTabId !== null) {
      const prevSolo = capturedTabs.get(soloTabId)
      if (prevSolo) {
        prevSolo.isSolo = false
      }
    }

    soloTabId = tabId
    tabState.isSolo = true

    // Mute all other tabs, keep soloed tab at its gain
    for (const [tid, state] of capturedTabs) {
      if (tid === tabId) {
        state.isSolo = true
      } else {
        state.isSolo = false
      }
    }
  }

  await saveState()
  return { success: true, soloTabId }
}

/**
 * Get the current solo tab ID
 */
function getSoloTabId(): number | null {
  return soloTabId
}

/**
 * Clear solo mode (called when soloed tab is removed)
 */
async function clearSolo(): Promise<void> {
  if (soloTabId === null) return

  soloTabId = null

  // Restore all tabs to their saved gains
  for (const state of capturedTabs.values()) {
    state.isSolo = false
  }
}

/**
 * Auto-balance all tabs to target LUFS (one-shot)
 */
async function autoBalanceOnce(targetLufs: number): Promise<void> {
  for (const [tabId, tabState] of capturedTabs) {
    if (!tabState.isCapturing) continue

    if (getSoloTabId() !== null && getSoloTabId() !== tabId) {
      await setTabGain(tabId, -100, false)
      continue
    }

    // Skip tabs without enough samples for reliable LUFS measurement
    if (!hasEnoughSamples(tabState)) {
      console.log(
        `Skipping auto-balance for tab ${tabId}: not enough samples (${tabState.currentLufs.blockCount} blocks)`,
      )
      continue
    }

    const currentLufs = tabState.currentLufs.integrated
    if (!isFinite(currentLufs)) continue

    // Calculate required gain adjustment
    const requiredGain = targetLufs - currentLufs

    // Apply gain (with limits)
    await setTabGain(tabId, requiredGain, false)
  }
}

/**
 * Run one serialized continuous auto-balance cycle, then schedule the next.
 * Scheduling after completion prevents slow Chrome API/storage operations from
 * accumulating overlapping async callbacks.
 */
async function runContinuousAutoBalance(): Promise<void> {
  if (!autoBalanceSettings.enabled) {
    autoBalanceTimer = null
    return
  }

  try {
    if (capturedTabs.size > 0) {
      await autoBalanceOnce(autoBalanceSettings.targetLufs)
    }
  } catch (error) {
    console.error('Continuous auto-balance cycle failed:', error)
  }

  if (autoBalanceSettings.enabled) {
    autoBalanceTimer = setTimeout(() => {
      void runContinuousAutoBalance()
    }, AUTO_BALANCE_INTERVAL_MS)
  } else {
    autoBalanceTimer = null
  }
}

/**
 * Start continuous auto-balance in the background
 */
function startContinuousAutoBalance(): void {
  if (autoBalanceTimer !== null) return // Already running or scheduled

  console.log('Starting continuous auto-balance')

  autoBalanceTimer = setTimeout(() => {
    void runContinuousAutoBalance()
  }, AUTO_BALANCE_INTERVAL_MS)
}

/**
 * Stop continuous auto-balance
 */
function stopContinuousAutoBalance(): void {
  if (autoBalanceTimer !== null) {
    clearTimeout(autoBalanceTimer)
    autoBalanceTimer = null
    console.log('Stopped continuous auto-balance')
  }
}

/**
 * Set auto-balance enabled state
 */
async function setAutoBalanceEnabled(enabled: boolean): Promise<void> {
  autoBalanceSettings.enabled = enabled

  if (enabled) {
    startContinuousAutoBalance()
  } else {
    stopContinuousAutoBalance()
  }

  await saveAutoBalanceSettings()
  await updateBadge()
}

/**
 * Set target LUFS for auto-balance
 */
async function setTargetLufs(targetLufs: number): Promise<void> {
  autoBalanceSettings.targetLufs = Math.max(-60, Math.min(0, targetLufs))
  await saveAutoBalanceSettings()
}

/**
 * Get auto-balance settings
 */
function getAutoBalanceSettings(): AutoBalanceSettings {
  return { ...autoBalanceSettings }
}

/**
 * Set limiter settings
 */
async function setLimiterSettings(settings: Partial<LimiterSettings>): Promise<LimiterSettings> {
  // Update local state
  limiterSettings = { ...limiterSettings, ...settings }

  // Forward to offscreen document
  try {
    const response = (await sendToOffscreen({
      type: 'SET_LIMITER',
      settings: limiterSettings,
    })) as { success?: boolean; settings?: LimiterSettings }
    if (response?.settings) {
      limiterSettings = response.settings
    }
  } catch (err) {
    console.error('Failed to update limiter in offscreen:', err)
  }

  // Persist settings
  await saveLimiterSettings()

  return limiterSettings
}

/**
 * Get limiter settings
 */
function getLimiterSettings(): LimiterSettings {
  return { ...limiterSettings }
}

/**
 * Save limiter settings to chrome.storage
 */
async function saveLimiterSettings(): Promise<void> {
  await chrome.storage.local.set({ limiterSettings })
}

/**
 * Get all captured tabs state
 */
function getCapturedTabs(): TabCaptureState[] {
  return Array.from(capturedTabs.values())
}

/**
 * Save state to chrome.storage
 */
async function saveState(): Promise<void> {
  const state = Array.from(capturedTabs.values())
  await chrome.storage.local.set({ capturedTabs: state })
}

/**
 * Save auto-balance settings to chrome.storage
 */
async function saveAutoBalanceSettings(): Promise<void> {
  await chrome.storage.local.set({ autoBalanceSettings })
}

/**
 * Load state from chrome.storage
 * Note: Captured tabs are cleared on reload since media streams can't be recovered
 */
async function loadState(): Promise<void> {
  const result = await chrome.storage.local.get(['autoBalanceSettings', 'limiterSettings'])

  // Clear any stale captured tabs from storage
  // Media streams can't be recovered after extension reload, so tabs must be re-registered
  capturedTabs.clear()
  await chrome.storage.local.remove('capturedTabs')
  console.log('Cleared captured tabs (streams cannot be recovered after reload)')

  // Load auto-balance settings
  const storedAutoBalance = result.autoBalanceSettings as AutoBalanceSettings | undefined
  if (storedAutoBalance) {
    autoBalanceSettings = storedAutoBalance

    // Restart auto-balance if it was enabled
    if (autoBalanceSettings.enabled) {
      startContinuousAutoBalance()
    }
  }

  // Load limiter settings
  const storedLimiter = result.limiterSettings as LimiterSettings | undefined
  if (storedLimiter) {
    limiterSettings = storedLimiter
  }

  // Start cleanup interval
  startCleanupInterval()

  // Update badge with current state
  await updateBadge()
}

// Message types for type-safe handling
interface MessageBase {
  type: string
  target?: string
}

interface TabIdMessage extends MessageBase {
  tabId: number
}

interface GainMessage extends TabIdMessage {
  gainDb: number
}

interface MaxGainMessage extends TabIdMessage {
  maxGainDb: number
}

interface TargetLufsMessage extends MessageBase {
  targetLufs: number
}

interface AutoBalanceEnabledMessage extends MessageBase {
  enabled: boolean
}

interface LufsUpdateMessage extends TabIdMessage {
  momentary: number
  shortTerm: number
  integrated: number
  blockCount: number
}

interface ErrorMessage extends TabIdMessage {
  error: string
  reason?: string
}

interface LimiterSettingsMessage extends MessageBase {
  settings: Partial<LimiterSettings>
}

type IncomingMessage =
  | MessageBase
  | TabIdMessage
  | GainMessage
  | TargetLufsMessage
  | AutoBalanceEnabledMessage
  | LufsUpdateMessage
  | ErrorMessage
  | LimiterSettingsMessage

// Message types that are notifications and don't need a response
const NOTIFICATION_MESSAGE_TYPES = new Set([
  'LUFS_UPDATE',
  'CAPTURE_STARTED',
  'CAPTURE_STOPPED',
  'CAPTURE_ERROR',
  'STREAM_ENDED',
  'GAIN_UPDATED',
  'LIMITER_UPDATED',
  'LUFS_RESET',
])

// Message handler for popup and offscreen communication
chrome.runtime.onMessage.addListener(
  (
    message: IncomingMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ) => {
    // Ignore messages targeted for offscreen document
    if (message.target === 'offscreen') {
      return false
    }

    // Handle notification-type messages synchronously (no response needed)
    if (NOTIFICATION_MESSAGE_TYPES.has(message.type)) {
      switch (message.type) {
        case 'LUFS_UPDATE': {
          const msg = message as LufsUpdateMessage
          const tabState = capturedTabs.get(msg.tabId)
          if (tabState) {
            tabState.currentLufs = {
              momentary: msg.momentary ?? -Infinity,
              shortTerm: msg.shortTerm ?? -Infinity,
              integrated: msg.integrated ?? -Infinity,
              blockCount: msg.blockCount ?? 0,
            }
          }
          break
        }

        case 'CAPTURE_STARTED': {
          const msg = message as TabIdMessage
          const tabState = capturedTabs.get(msg.tabId)
          if (tabState) {
            tabState.isCapturing = true
          }
          break
        }

        case 'CAPTURE_STOPPED': {
          const msg = message as TabIdMessage
          const tabState = capturedTabs.get(msg.tabId)
          if (tabState) {
            tabState.isCapturing = false
          }
          break
        }

        case 'CAPTURE_ERROR': {
          const msg = message as ErrorMessage
          console.error(`Capture error for tab ${msg.tabId}:`, msg.error)
          removeTab(msg.tabId, msg.error || 'Capture error')
          break
        }

        case 'STREAM_ENDED': {
          const msg = message as ErrorMessage
          console.log(`Stream ended for tab ${msg.tabId}:`, msg.reason || 'Unknown reason')
          removeTab(msg.tabId, msg.reason || 'Stream ended')
          break
        }

        case 'GAIN_UPDATED': {
          const msg = message as GainMessage
          const tabState = capturedTabs.get(msg.tabId)
          if (tabState) {
            tabState.gainDb = msg.gainDb
          }
          break
        }
      }
      // Return false - no async response needed for notifications
      return false
    }

    // Handle request-type messages that need async responses
    const handleAsync = async (): Promise<unknown> => {
      switch (message.type) {
        // Offscreen document ready signal
        case 'OFFSCREEN_READY': {
          offscreenDocumentReady = true
          if (offscreenReadyResolve) {
            offscreenReadyResolve()
            offscreenReadyResolve = null
          }
          return { acknowledged: true }
        }

        // From popup
        case 'GET_TABS':
          return { tabs: getCapturedTabs(), soloTabId: getSoloTabId() }

        case 'GET_AUTO_BALANCE_SETTINGS':
          return { settings: getAutoBalanceSettings() }

        case 'SET_AUTO_BALANCE_ENABLED': {
          const msg = message as AutoBalanceEnabledMessage
          await setAutoBalanceEnabled(msg.enabled)
          return { success: true, settings: getAutoBalanceSettings() }
        }

        case 'SET_TARGET_LUFS': {
          const msg = message as TargetLufsMessage
          await setTargetLufs(msg.targetLufs)
          return { success: true, settings: getAutoBalanceSettings() }
        }

        // Limiter settings
        case 'GET_LIMITER_SETTINGS': {
          return { success: true, settings: getLimiterSettings() }
        }

        case 'SET_LIMITER_SETTINGS': {
          const msg = message as LimiterSettingsMessage
          const newSettings = await setLimiterSettings(msg.settings)
          return { success: true, settings: newSettings }
        }

        case 'START_CAPTURE_REQUEST': {
          const msg = message as TabIdMessage
          return await startTabCapture(msg.tabId)
        }

        case 'STOP_CAPTURE_REQUEST': {
          const msg = message as TabIdMessage
          return await stopTabCapture(msg.tabId)
        }

        case 'SET_GAIN_REQUEST': {
          const msg = message as GainMessage
          return await setTabGain(msg.tabId, msg.gainDb)
        }

        case 'SET_MAX_GAIN_REQUEST': {
          const msg = message as MaxGainMessage
          return await setTabMaxGain(msg.tabId, msg.maxGainDb)
        }

        case 'TOGGLE_SOLO': {
          const msg = message as TabIdMessage
          return await toggleSolo(msg.tabId)
        }

        case 'GET_SOLO': {
          return { soloTabId: getSoloTabId() }
        }

        case 'CLEAR_SOLO': {
          await clearSolo()
          return { success: true, soloTabId: null }
        }

        case 'AUTO_BALANCE_REQUEST': {
          // One-shot auto-balance (uses current target LUFS)
          const msg = message as TargetLufsMessage
          const targetLufs = msg.targetLufs ?? autoBalanceSettings.targetLufs
          await autoBalanceOnce(targetLufs)
          return { success: true }
        }

        case 'RESET_LUFS_REQUEST': {
          const msg = message as TabIdMessage
          await sendToOffscreen({
            type: 'RESET_LUFS',
            tabId: msg.tabId,
          })
          return { success: true }
        }

        default:
          return { success: false, error: 'Unknown message type' }
      }
    }

    handleAsync()
      .then((response) => {
        sendResponse(response)
      })
      .catch((error) => {
        console.error('Message handler error:', error)
        sendResponse({ success: false, error: error.message })
      })

    return true // Keep channel open for async response
  },
)

// Handle tab removal - stop capture when tab is closed
chrome.tabs.onRemoved.addListener(async (tabId: number) => {
  if (capturedTabs.has(tabId)) {
    await removeTab(tabId, 'Tab closed')
  }
})

// Handle tab updates - update title/url
chrome.tabs.onUpdated.addListener((tabId: number, changeInfo: { title?: string; url?: string }) => {
  const tabState = capturedTabs.get(tabId)
  if (tabState) {
    if (changeInfo.title) {
      tabState.title = changeInfo.title
    }
    if (changeInfo.url) {
      tabState.url = changeInfo.url
    }
  }
})

// Initialize on install
chrome.runtime.onInstalled.addListener(async () => {
  console.log('Loudness DD extension installed')
  await loadState()
})

// Initialize on startup
chrome.runtime.onStartup.addListener(async () => {
  console.log('Loudness DD extension started')
  await loadState()
})

console.log('Background service worker loaded')

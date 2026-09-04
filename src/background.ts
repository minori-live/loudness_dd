/**
 * Thin MV3 service-worker coordinator.
 * Durable settings live in storage; active audio session state lives offscreen.
 */

import {
  closeOffscreenIfIdle,
  ensureOffscreenDocument,
  isOffscreenTarget,
  sendToExistingOffscreen,
  sendToOffscreen,
} from '@/background/offscreen-client'
import {
  getSettings,
  normalizeSettings,
  resetSettingsCache,
  updateSettings,
} from '@/background/settings'
import {
  OFFSCREEN_TARGET,
  emptySession,
  type BackgroundRequest,
  type CaptureEndedMessage,
  type CommandResponse,
  type ExtensionState,
  type OffscreenRequest,
  type PersistedSettings,
  type SessionSnapshot,
} from '@/protocol'

const BACKGROUND_REQUEST_TYPES = new Set<BackgroundRequest['type']>([
  'GET_STATE',
  'START_CAPTURE_REQUEST',
  'STOP_CAPTURE_REQUEST',
  'SET_GAIN_REQUEST',
  'SET_MAX_GAIN_REQUEST',
  'TOGGLE_SOLO',
  'CLEAR_SOLO',
  'TOGGLE_FOCUS',
  'CLEAR_FOCUS',
  'SET_AUTO_FOCUS_ENABLED',
  'SET_TARGET_LUFS',
  'SET_LIMITER_SETTINGS',
  'RESET_LUFS_REQUEST',
])
const pendingCaptures = new Map<number, Promise<CommandResponse>>()

function toExtensionState(session: SessionSnapshot, settings: PersistedSettings): ExtensionState {
  return {
    ...session,
    autoBalanceSettings: { ...settings.autoBalance },
    autoFocusSettings: { ...settings.autoFocus },
    limiterSettings: { ...settings.limiter },
  }
}

async function updateBadge(tabCount: number): Promise<void> {
  await chrome.action.setBadgeText({ text: tabCount === 0 ? '' : String(tabCount) })
  await chrome.action.setBadgeBackgroundColor({ color: '#48bb78' })
}

async function getState(): Promise<ExtensionState> {
  const settings = await getSettings()
  const result = await sendToExistingOffscreen({
    type: 'SYNC_SETTINGS',
    target: OFFSCREEN_TARGET,
    settings,
  })
  const session = result?.session ?? emptySession()
  await updateBadge(session.tabs.length)
  return toExtensionState(session, settings)
}

async function getActiveTabId(windowId?: number): Promise<number | null> {
  const query =
    windowId === undefined ? { active: true, lastFocusedWindow: true } : { active: true, windowId }
  const [activeTab] = await chrome.tabs.query(query)
  return activeTab?.id ?? null
}

async function syncAutoFocus(tabId?: number | null): Promise<SessionSnapshot | null> {
  const settings = await getSettings()
  if (!settings.autoFocus.enabled) return null

  const activeTabId = tabId === undefined ? await getActiveTabId() : tabId
  const result = await sendToExistingOffscreen({
    type: 'SET_FOCUS',
    target: OFFSCREEN_TARGET,
    tabId: activeTabId,
  })
  return result?.session ?? null
}

async function startTabCapture(tabId: number): Promise<CommandResponse> {
  const pending = pendingCaptures.get(tabId)
  if (pending) return pending

  const capture = (async (): Promise<CommandResponse> => {
    const [settings, tab] = await Promise.all([getSettings(), chrome.tabs.get(tabId)])
    await ensureOffscreenDocument()

    const synced = await sendToOffscreen({
      type: 'SYNC_SETTINGS',
      target: OFFSCREEN_TARGET,
      settings,
    })
    if (synced.session.tabs.some((capturedTab) => capturedTab.tabId === tabId)) {
      return {
        success: false,
        state: toExtensionState(synced.session, settings),
        error: 'Tab is already being captured',
      }
    }

    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId })
    const result = await sendToOffscreen({
      type: 'START_CAPTURE',
      target: OFFSCREEN_TARGET,
      tabId,
      streamId,
      title: tab.title || 'Unknown Tab',
      url: tab.url || '',
    })
    const focusedSession = result.success ? await syncAutoFocus() : null
    const session = focusedSession ?? result.session
    await updateBadge(session.tabs.length)
    if (!result.success) await closeOffscreenIfIdle(session.tabs.length)
    return {
      success: result.success,
      state: toExtensionState(session, settings),
      error: result.error,
    }
  })()

  pendingCaptures.set(tabId, capture)
  try {
    return await capture
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    try {
      const state = await getState()
      await closeOffscreenIfIdle(state.tabs.length)
      return { success: false, state, error: message }
    } catch {
      return { success: false, error: message }
    }
  } finally {
    pendingCaptures.delete(tabId)
  }
}

async function runSessionCommand(message: OffscreenRequest): Promise<CommandResponse> {
  const settings = await getSettings()
  const result = await sendToExistingOffscreen(message)
  if (!result) {
    return {
      success: false,
      state: toExtensionState(emptySession(), settings),
      error: 'No active audio session',
    }
  }

  await updateBadge(result.session.tabs.length)
  if (message.type === 'STOP_CAPTURE') await closeOffscreenIfIdle(result.session.tabs.length)
  return {
    success: result.success,
    state: toExtensionState(result.session, settings),
    error: result.error,
  }
}

async function applySettingsUpdate(
  transform: (current: PersistedSettings) => PersistedSettings,
): Promise<CommandResponse> {
  const settings = await updateSettings(transform)
  const result = await sendToExistingOffscreen({
    type: 'SYNC_SETTINGS',
    target: OFFSCREEN_TARGET,
    settings,
  })
  const session = result?.session ?? emptySession()
  await updateBadge(session.tabs.length)
  return { success: true, state: toExtensionState(session, settings) }
}

async function handleRequest(message: BackgroundRequest): Promise<CommandResponse> {
  switch (message.type) {
    case 'GET_STATE':
      return { success: true, state: await getState() }
    case 'START_CAPTURE_REQUEST':
      return startTabCapture(message.tabId)
    case 'STOP_CAPTURE_REQUEST':
      return runSessionCommand({
        type: 'STOP_CAPTURE',
        target: OFFSCREEN_TARGET,
        tabId: message.tabId,
      })
    case 'SET_GAIN_REQUEST':
      return runSessionCommand({
        type: 'SET_GAIN',
        target: OFFSCREEN_TARGET,
        tabId: message.tabId,
        gainDb: message.gainDb,
      })
    case 'SET_MAX_GAIN_REQUEST':
      return runSessionCommand({
        type: 'SET_MAX_GAIN',
        target: OFFSCREEN_TARGET,
        tabId: message.tabId,
        maxGainDb: message.maxGainDb,
      })
    case 'TOGGLE_SOLO':
      return runSessionCommand({
        type: 'TOGGLE_SOLO',
        target: OFFSCREEN_TARGET,
        tabId: message.tabId,
      })
    case 'CLEAR_SOLO':
      return runSessionCommand({ type: 'CLEAR_SOLO', target: OFFSCREEN_TARGET })
    case 'TOGGLE_FOCUS':
      return runSessionCommand({
        type: 'TOGGLE_FOCUS',
        target: OFFSCREEN_TARGET,
        tabId: message.tabId,
      })
    case 'CLEAR_FOCUS':
      return runSessionCommand({ type: 'CLEAR_FOCUS', target: OFFSCREEN_TARGET })
    case 'SET_AUTO_FOCUS_ENABLED': {
      const result = await applySettingsUpdate((current) =>
        normalizeSettings(current.autoBalance, current.limiter, { enabled: message.enabled }),
      )
      if (!message.enabled) return result

      const session = await syncAutoFocus()
      const settings = await getSettings()
      return session ? { success: true, state: toExtensionState(session, settings) } : result
    }
    case 'SET_TARGET_LUFS':
      return applySettingsUpdate((current) =>
        normalizeSettings(
          { ...current.autoBalance, targetLufs: message.targetLufs },
          current.limiter,
          current.autoFocus,
        ),
      )
    case 'SET_LIMITER_SETTINGS':
      return applySettingsUpdate((current) =>
        normalizeSettings(
          current.autoBalance,
          { ...current.limiter, ...message.settings },
          current.autoFocus,
        ),
      )
    case 'RESET_LUFS_REQUEST':
      return runSessionCommand({
        type: 'RESET_LUFS',
        target: OFFSCREEN_TARGET,
        tabId: message.tabId,
      })
  }
}

async function handleCaptureEnded(message: CaptureEndedMessage): Promise<void> {
  console.log(`Capture ended for tab ${message.tabId}: ${message.reason}`)
  await updateBadge(message.tabCount)
  await closeOffscreenIfIdle(message.tabCount)
}

chrome.runtime.onMessage.addListener((rawMessage: unknown, _sender, sendResponse) => {
  if (!rawMessage || typeof rawMessage !== 'object' || !('type' in rawMessage)) return false
  if (isOffscreenTarget(rawMessage)) return false

  if (rawMessage.type === 'CAPTURE_ENDED') {
    void handleCaptureEnded(rawMessage as CaptureEndedMessage)
    return false
  }

  if (
    typeof rawMessage.type !== 'string' ||
    !BACKGROUND_REQUEST_TYPES.has(rawMessage.type as BackgroundRequest['type'])
  ) {
    return false
  }

  Promise.resolve(handleRequest(rawMessage as BackgroundRequest))
    .then(sendResponse)
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Unknown error'
      console.error('Background request failed:', error)
      sendResponse({ success: false, error: message } satisfies CommandResponse)
    })
  return true
})

async function stopExistingCapture(tabId: number): Promise<void> {
  const result = await sendToExistingOffscreen({
    type: 'STOP_CAPTURE',
    target: OFFSCREEN_TARGET,
    tabId,
  })
  if (!result) return
  await updateBadge(result.session.tabs.length)
  await closeOffscreenIfIdle(result.session.tabs.length)
}

chrome.tabs.onRemoved.addListener((tabId) => void stopExistingCapture(tabId))

chrome.tabs.onActivated.addListener(({ tabId }) => void syncAutoFocus(tabId))

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return
  void getActiveTabId(windowId).then((tabId) => syncAutoFocus(tabId))
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.title && !changeInfo.url) return
  void sendToExistingOffscreen({
    type: 'UPDATE_TAB_METADATA',
    target: OFFSCREEN_TARGET,
    tabId,
    title: changeInfo.title,
    url: changeInfo.url,
  })
})

chrome.tabCapture.onStatusChanged.addListener((info) => {
  if (info.status === 'stopped' || info.status === 'error') void stopExistingCapture(info.tabId)
})

chrome.runtime.onInstalled.addListener(() => {
  resetSettingsCache()
  void chrome.storage.local.remove('capturedTabs')
  void getState()
})

chrome.runtime.onStartup.addListener(() => void getState())

console.log('Background service worker loaded')

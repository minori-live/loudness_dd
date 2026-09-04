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
  'AUTO_BALANCE_REQUEST',
  'SET_AUTO_BALANCE_ENABLED',
  'SET_TARGET_LUFS',
  'SET_LIMITER_SETTINGS',
  'RESET_LUFS_REQUEST',
])
const pendingCaptures = new Map<number, Promise<CommandResponse>>()

function clamp(value: number, minimum: number, maximum: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, value)) : fallback
}

function toExtensionState(session: SessionSnapshot, settings: PersistedSettings): ExtensionState {
  return {
    ...session,
    autoBalanceSettings: { ...settings.autoBalance },
    limiterSettings: { ...settings.limiter },
  }
}

async function updateBadge(tabCount: number, autoBalanceEnabled: boolean): Promise<void> {
  await chrome.action.setBadgeText({ text: tabCount === 0 ? '' : String(tabCount) })
  await chrome.action.setBadgeBackgroundColor({
    color: autoBalanceEnabled ? '#48bb78' : '#4299e1',
  })
}

async function getState(): Promise<ExtensionState> {
  const settings = await getSettings()
  const result = await sendToExistingOffscreen({
    type: 'SYNC_SETTINGS',
    target: OFFSCREEN_TARGET,
    settings,
  })
  const session = result?.session ?? emptySession()
  await updateBadge(session.tabs.length, settings.autoBalance.enabled)
  return toExtensionState(session, settings)
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
    await updateBadge(result.session.tabs.length, settings.autoBalance.enabled)
    if (!result.success) await closeOffscreenIfIdle(result.session.tabs.length)
    return {
      success: result.success,
      state: toExtensionState(result.session, settings),
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

  await updateBadge(result.session.tabs.length, settings.autoBalance.enabled)
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
  await updateBadge(session.tabs.length, settings.autoBalance.enabled)
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
    case 'AUTO_BALANCE_REQUEST': {
      const settings = await getSettings()
      return runSessionCommand({
        type: 'AUTO_BALANCE_ONCE',
        target: OFFSCREEN_TARGET,
        targetLufs: clamp(
          message.targetLufs ?? settings.autoBalance.targetLufs,
          -60,
          0,
          settings.autoBalance.targetLufs,
        ),
      })
    }
    case 'SET_AUTO_BALANCE_ENABLED':
      return applySettingsUpdate((current) =>
        normalizeSettings({ ...current.autoBalance, enabled: message.enabled }, current.limiter),
      )
    case 'SET_TARGET_LUFS':
      return applySettingsUpdate((current) =>
        normalizeSettings(
          { ...current.autoBalance, targetLufs: message.targetLufs },
          current.limiter,
        ),
      )
    case 'SET_LIMITER_SETTINGS':
      return applySettingsUpdate((current) =>
        normalizeSettings(current.autoBalance, { ...current.limiter, ...message.settings }),
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
  const settings = await getSettings()
  console.log(`Capture ended for tab ${message.tabId}: ${message.reason}`)
  await updateBadge(message.tabCount, settings.autoBalance.enabled)
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
  const settings = await getSettings()
  const result = await sendToExistingOffscreen({
    type: 'STOP_CAPTURE',
    target: OFFSCREEN_TARGET,
    tabId,
  })
  if (!result) return
  await updateBadge(result.session.tabs.length, settings.autoBalance.enabled)
  await closeOffscreenIfIdle(result.session.tabs.length)
}

chrome.tabs.onRemoved.addListener((tabId) => void stopExistingCapture(tabId))

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

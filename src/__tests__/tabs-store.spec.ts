import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CapturedTab, ExtensionState, SessionPortMessage } from '@/protocol'
import { useTabsStore } from '@/stores/tabs'

function capturedTab(tabId: number, integrated: number): CapturedTab {
  return {
    tabId,
    title: `Example ${tabId}`,
    url: `https://example.com/${tabId}`,
    isCapturing: true,
    currentLufs: { momentary: integrated, shortTerm: integrated, integrated, blockCount: 10 },
    gainDb: 0,
    maxGainDb: 0,
    isSolo: false,
    isFocused: false,
  }
}

function extensionState(integrated: number, tabIds = [1]): ExtensionState {
  return {
    tabs: tabIds.map((tabId) => capturedTab(tabId, integrated)),
    soloTabId: null,
    focusTabId: null,
    autoBalanceSettings: { targetLufs: -14 },
    autoFocusSettings: { enabled: false },
    limiterSettings: {
      enabled: false,
      thresholdDb: -1,
      kneeDb: 0,
      ratio: 20,
      attackMs: 1,
      releaseMs: 100,
    },
  }
}

function tabOrderEvent() {
  const listeners = new Set<() => void>()
  return {
    addListener: vi.fn((listener: () => void) => listeners.add(listener)),
    removeListener: vi.fn((listener: () => void) => listeners.delete(listener)),
    dispatch: () => listeners.forEach((listener) => listener()),
  }
}

function tabOrderEvents() {
  return {
    onMoved: tabOrderEvent(),
    onAttached: tabOrderEvent(),
    onDetached: tabOrderEvent(),
    onCreated: tabOrderEvent(),
    onRemoved: tabOrderEvent(),
  }
}

describe('tabs store session sync', () => {
  beforeEach(() => setActivePinia(createPinia()))

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('loads one snapshot and then consumes port updates without polling', async () => {
    const messageListeners: Array<(message: SessionPortMessage) => void> = []
    const disconnectListeners: Array<() => void> = []
    const disconnect = vi.fn(() => disconnectListeners.forEach((listener) => listener()))
    const port = {
      disconnect,
      onMessage: { addListener: vi.fn((listener) => messageListeners.push(listener)) },
      onDisconnect: { addListener: vi.fn((listener) => disconnectListeners.push(listener)) },
    } as unknown as chrome.runtime.Port
    const sendMessage = vi.fn(async () => ({ success: true, state: extensionState(-20) }))
    const connect = vi.fn(() => port)
    const setInterval = vi.spyOn(window, 'setInterval')
    const orderEvents = tabOrderEvents()

    vi.stubGlobal('chrome', {
      runtime: { sendMessage, connect },
      tabs: { query: vi.fn(async () => []), ...orderEvents },
    })

    const store = useTabsStore()
    await store.startSync()

    expect(sendMessage).toHaveBeenCalledOnce()
    expect(connect).toHaveBeenCalledOnce()
    expect(setInterval).not.toHaveBeenCalled()
    expect(store.tabs[0]?.currentLufs.integrated).toBe(-20)

    messageListeners[0]?.({
      type: 'SESSION_UPDATED',
      session: { ...extensionState(-16), soloTabId: null, focusTabId: null },
    })
    expect(store.tabs[0]?.currentLufs.integrated).toBe(-16)

    const unchangedTab = capturedTab(2, -18)
    messageListeners[0]?.({
      type: 'SESSION_UPDATED',
      session: { tabs: [store.tabs[0]!, unchangedTab], soloTabId: null, focusTabId: null },
    })
    const stableReference = store.tabs[1]
    messageListeners[0]?.({
      type: 'SESSION_METERS_UPDATED',
      updates: [
        {
          tabId: 1,
          currentLufs: { momentary: -12, shortTerm: -13, integrated: -14, blockCount: 20 },
          gainDb: -2,
        },
      ],
    })
    expect(store.tabs[0]?.currentLufs.integrated).toBe(-14)
    expect(store.tabs[0]?.gainDb).toBe(-2)
    expect(store.tabs[1]).toBe(stableReference)

    store.stopSync()
    expect(disconnect).toHaveBeenCalledOnce()
  })

  it('orders captured tabs by their live position within each browser window', async () => {
    const orderEvents = tabOrderEvents()
    let browserTabs = [
      { id: 1, windowId: 10, index: 0 },
      { id: 2, windowId: 10, index: 2 },
      { id: 3, windowId: 20, index: 0 },
    ]
    const query = vi.fn(async () => browserTabs)
    const sendMessage = vi.fn(async () => ({
      success: true,
      state: extensionState(-20, [2, 3, 1]),
    }))
    const port = {
      disconnect: vi.fn(),
      onMessage: { addListener: vi.fn() },
      onDisconnect: { addListener: vi.fn() },
    } as unknown as chrome.runtime.Port

    vi.stubGlobal('chrome', {
      runtime: { sendMessage, connect: vi.fn(() => port) },
      tabs: { query, ...orderEvents },
    })

    const store = useTabsStore()
    await store.startSync()

    expect(store.tabs.map((tab) => tab.tabId)).toEqual([2, 3, 1])
    expect(store.orderedTabs.map((tab) => tab.tabId)).toEqual([1, 2, 3])

    browserTabs = [
      { id: 2, windowId: 10, index: 0 },
      { id: 1, windowId: 10, index: 1 },
      { id: 3, windowId: 20, index: 0 },
    ]
    orderEvents.onMoved.dispatch()

    await vi.waitFor(() => {
      expect(store.orderedTabs.map((tab) => tab.tabId)).toEqual([2, 1, 3])
    })

    browserTabs = [
      { id: 1, windowId: 10, index: 0 },
      { id: 3, windowId: 20, index: 0 },
      { id: 2, windowId: 20, index: 1 },
    ]
    orderEvents.onAttached.dispatch()

    await vi.waitFor(() => {
      expect(store.orderedTabs.map((tab) => tab.tabId)).toEqual([3, 2, 1])
    })

    store.stopSync()
    expect(orderEvents.onMoved.removeListener).toHaveBeenCalledOnce()
    expect(orderEvents.onAttached.removeListener).toHaveBeenCalledOnce()
    expect(orderEvents.onDetached.removeListener).toHaveBeenCalledOnce()
  })

  it('sends manual focus and auto-focus commands through the background', async () => {
    const sendMessage = vi.fn(async () => ({ success: true, state: extensionState(-20) }))
    vi.stubGlobal('chrome', { runtime: { sendMessage } })

    const store = useTabsStore()
    await store.toggleFocus(1)
    await store.setAutoFocusEnabled(true)

    expect(sendMessage).toHaveBeenNthCalledWith(1, { type: 'TOGGLE_FOCUS', tabId: 1 })
    expect(sendMessage).toHaveBeenNthCalledWith(2, {
      type: 'SET_AUTO_FOCUS_ENABLED',
      enabled: true,
    })
  })

  it('handles an unresponsive stale background without throwing', async () => {
    vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn(async () => undefined) } })

    const store = useTabsStore()
    await expect(store.toggleFocus(1)).resolves.toBe(false)
    expect(store.error).toBe(
      'Failed to toggle focus: background did not respond; reload the extension',
    )
  })
})

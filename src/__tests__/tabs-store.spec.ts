import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ExtensionState, SessionPortMessage } from '@/protocol'
import { useTabsStore } from '@/stores/tabs'

function extensionState(integrated: number): ExtensionState {
  return {
    tabs: [
      {
        tabId: 1,
        title: 'Example',
        url: 'https://example.com',
        isCapturing: true,
        currentLufs: { momentary: integrated, shortTerm: integrated, integrated, blockCount: 10 },
        gainDb: 0,
        maxGainDb: 0,
        isSolo: false,
      },
    ],
    soloTabId: null,
    autoBalanceSettings: { enabled: false, targetLufs: -14 },
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

    vi.stubGlobal('chrome', {
      runtime: { sendMessage, connect },
    })

    const store = useTabsStore()
    await store.startSync()

    expect(sendMessage).toHaveBeenCalledOnce()
    expect(connect).toHaveBeenCalledOnce()
    expect(setInterval).not.toHaveBeenCalled()
    expect(store.tabs[0]?.currentLufs.integrated).toBe(-20)

    messageListeners[0]?.({
      type: 'SESSION_UPDATED',
      session: { ...extensionState(-16), soloTabId: null },
    })
    expect(store.tabs[0]?.currentLufs.integrated).toBe(-16)

    store.stopSync()
    expect(disconnect).toHaveBeenCalledOnce()
  })
})

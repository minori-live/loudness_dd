import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createSessionTab, SessionState } from '@/audio/session-state'
import { createDefaultSettings, type CommandResponse, type OffscreenRequest } from '@/protocol'

const offscreen = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('@/background/offscreen-client', () => ({
  closeOffscreenIfIdle: vi.fn(),
  ensureOffscreenDocument: vi.fn(),
  isOffscreenTarget: () => false,
  sendToExistingOffscreen: offscreen.send,
  sendToOffscreen: offscreen.send,
}))
vi.mock('@/background/settings', () => ({
  getSettings: () => Promise.resolve(createDefaultSettings()),
  normalizeSettings: vi.fn(),
  resetSettingsCache: vi.fn(),
  updateSettings: vi.fn(),
}))

describe('background tab metadata', () => {
  let session: SessionState
  let onMessage: (message: object, sender: object, reply: (value: CommandResponse) => void) => void
  let onUpdated: (
    tabId: number,
    change: Pick<chrome.tabs.Tab, 'title' | 'favIconUrl' | 'url'>,
  ) => void
  const query = vi.fn()

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    session = new SessionState()
    session.add(createSessionTab(1, 'Original title', 'https://example.com/icon.png'))
    offscreen.send.mockImplementation(async (message: OffscreenRequest) => {
      if (message.type === 'UPDATE_TAB_METADATA') session.updateMetadata(message.tabId, message)
      return { success: true, session: session.snapshot() }
    })
    query.mockResolvedValue([{ id: 1 }])
    const event = () => ({ addListener: vi.fn() })
    vi.stubGlobal('chrome', {
      action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn() },
      runtime: {
        onMessage: { addListener: (listener: typeof onMessage) => (onMessage = listener) },
        onInstalled: event(),
        onStartup: event(),
      },
      tabs: {
        query,
        onUpdated: { addListener: (listener: typeof onUpdated) => (onUpdated = listener) },
        onRemoved: event(),
        onActivated: event(),
      },
      windows: { onFocusChanged: event() },
      tabCapture: { onStatusChanged: event() },
    })
    await import('@/background')
  })

  afterEach(() => vi.unstubAllGlobals())

  function getState(): Promise<CommandResponse> {
    return new Promise((resolve) => onMessage({ type: 'GET_STATE' }, {}, resolve))
  }

  it('refreshes the registered current tab when the popup reopens, without copying its URL', async () => {
    query.mockResolvedValue([
      {
        id: 1,
        title: 'New site',
        favIconUrl: 'https://new.example/icon.png',
        url: 'https://new.example/private',
      },
    ])
    const response = await getState()
    expect(response.state?.tabs[0]).toMatchObject({
      title: 'New site',
      favIconUrl: 'https://new.example/icon.png',
    })
    expect(response.state?.tabs[0]).not.toHaveProperty('url')
    expect(offscreen.send).toHaveBeenLastCalledWith({
      type: 'UPDATE_TAB_METADATA',
      target: 'offscreen',
      tabId: 1,
      title: 'New site',
      favIconUrl: 'https://new.example/icon.png',
    })
  })

  it('preserves metadata when Chrome withholds sensitive fields', async () => {
    const response = await getState()
    expect(response.state?.tabs[0]?.title).toBe('Original title')
    expect(offscreen.send).toHaveBeenCalledTimes(1)
  })

  it('does not refresh unregistered tabs', async () => {
    query.mockResolvedValue([{ id: 2, title: 'Unregistered' }])
    await getState()
    expect(offscreen.send).toHaveBeenCalledTimes(1)
  })

  it('updates an authorized background tab and allows its favicon to be cleared', () => {
    onUpdated(1, { title: 'Next song', favIconUrl: '' })
    expect(session.get(1)).toMatchObject({ title: 'Next song', favIconUrl: '' })
    onUpdated(2, { title: 'Unregistered' })
    expect(session.get(2)).toBeUndefined()
  })

  it('ignores URL-only navigation events', () => {
    onUpdated(1, { url: 'https://other.example/private' })
    expect(offscreen.send).not.toHaveBeenCalled()
    expect(session.get(1)?.title).toBe('Original title')
  })
})

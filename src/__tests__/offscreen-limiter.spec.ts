import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDefaultSettings, type OffscreenRequest, type OffscreenResponse } from '@/protocol'

vi.mock('@/wasm/lufs_meter.wasm?url', () => ({ default: 'meter.wasm' }))
vi.mock('@/worklets/lufs-processor?worker&url', () => ({ default: 'processor.js' }))
vi.mock('@/worklets/limiter-processor?worker&url', () => ({ default: 'limiter.js' }))

class MockNode {
  outputs = new Set<MockNode>()
  connect(node: MockNode) {
    this.outputs.add(node)
    return node
  }
  disconnect() {
    this.outputs.clear()
  }
}

function parameter() {
  return { setValueAtTime: vi.fn(), cancelScheduledValues: vi.fn(), setTargetAtTime: vi.fn() }
}

class MockGain extends MockNode {
  gain = parameter()
  constructor(readonly context: MockContext) {
    super()
  }
}

class MockContext {
  static instances: MockContext[] = []
  destination = new MockNode()
  currentTime = 0
  state = 'running'
  gains: MockGain[] = []
  limiters: MockWorklet[] = []
  sources: MockNode[] = []
  audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) }
  resume = vi.fn().mockResolvedValue(undefined)
  close = vi.fn(async () => {
    this.state = 'closed'
  })
  addEventListener = vi.fn()
  removeEventListener = vi.fn()
  constructor() {
    MockContext.instances.push(this)
  }
  createGain() {
    const node = new MockGain(this)
    this.gains.push(node)
    return node
  }
  createMediaStreamSource() {
    const node = new MockNode()
    this.sources.push(node)
    return node
  }
}

class MockWorklet extends MockNode {
  port = { onmessage: null, close: vi.fn(), postMessage: vi.fn() }
  constructor(
    context: MockContext,
    name: string,
    readonly options: AudioWorkletNodeOptions,
  ) {
    super()
    if (name === 'peak-limiter') context.limiters.push(this)
  }
}

describe('offscreen mixed output limiter', () => {
  let dispatch: (message: OffscreenRequest) => Promise<OffscreenResponse>

  beforeEach(async () => {
    vi.resetModules()
    MockContext.instances = []
    vi.stubGlobal('AudioContext', MockContext)
    vi.stubGlobal('AudioWorkletNode', MockWorklet)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, clone: vi.fn() }))
    vi.spyOn(WebAssembly, 'compileStreaming').mockResolvedValue({} as WebAssembly.Module)
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn(async () => {
          const track = { addEventListener: vi.fn(), removeEventListener: vi.fn(), stop: vi.fn() }
          return { getAudioTracks: () => [track], getTracks: () => [track] }
        }),
      },
    })
    vi.stubGlobal('chrome', {
      runtime: {
        onMessage: {
          addListener(
            listener: (
              message: OffscreenRequest,
              sender: object,
              respond: (response: OffscreenResponse) => void,
            ) => void,
          ) {
            dispatch = (message) => new Promise((resolve) => listener(message, {}, resolve))
          },
        },
        onConnect: { addListener: vi.fn() },
        sendMessage: vi.fn().mockResolvedValue(undefined),
      },
    })
    await import('@/offscreen')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  async function start(tabId: number) {
    const result = await dispatch({
      type: 'START_CAPTURE',
      target: 'offscreen',
      tabId,
      streamId: String(tabId),
      title: 'Tab',
      url: 'https://example.com',
    })
    expect(result.success).toBe(true)
    return MockContext.instances[MockContext.instances.length - 1]!
  }

  it('sums concurrent captures before one limiter and preserves it when a tab stops', async () => {
    const settings = createDefaultSettings()
    settings.limiter.enabled = true
    await dispatch({ type: 'SYNC_SETTINGS', target: 'offscreen', settings })
    await Promise.all([start(1), start(2)])
    expect(MockContext.instances).toHaveLength(1)
    const context = MockContext.instances[0]!
    const [mix, first, second] = context.gains
    const [limiter] = context.limiters
    expect(context.limiters).toHaveLength(1)
    expect(limiter!.options.processorOptions.settings).toEqual(settings.limiter)
    expect(first!.outputs).toEqual(new Set([mix]))
    expect(second!.outputs).toEqual(new Set([mix]))
    expect(mix!.outputs).toEqual(new Set([limiter]))
    expect(limiter!.outputs).toEqual(new Set([context.destination]))

    await dispatch({ type: 'STOP_CAPTURE', target: 'offscreen', tabId: 1 })
    expect(first!.outputs.size).toBe(0)
    expect(second!.outputs).toEqual(new Set([mix]))
    expect(limiter!.outputs).toEqual(new Set([context.destination]))
    expect(context.close).not.toHaveBeenCalled()

    await dispatch({ type: 'STOP_CAPTURE', target: 'offscreen', tabId: 2 })
    expect(context.close).toHaveBeenCalledOnce()
    expect(limiter!.port.close).toHaveBeenCalledOnce()
    const next = await start(3)
    expect(next).not.toBe(context)
    expect(next.gains[0]!.outputs).toEqual(new Set([next.limiters[0]]))
  })

  it('switches the shared bypass and updates parameters without reconnecting tab inputs', async () => {
    const context = await start(1)
    await start(2)
    const [mix, first, second] = context.gains
    const limiter = context.limiters[0]!
    expect(mix!.outputs).toEqual(new Set([limiter]))
    const settings = createDefaultSettings()
    settings.limiter = {
      enabled: true,
      thresholdDb: -3,
      targetDb: -1,
      kneePercent: 75,
      releaseMs: 200,
    }
    await dispatch({ type: 'SYNC_SETTINGS', target: 'offscreen', settings })
    expect(mix!.outputs).toEqual(new Set([limiter]))
    expect(limiter.outputs).toEqual(new Set([context.destination]))
    expect(limiter.port.postMessage).toHaveBeenLastCalledWith({
      type: 'settings',
      settings: settings.limiter,
    })
    settings.limiter.thresholdDb = -6
    await dispatch({ type: 'SYNC_SETTINGS', target: 'offscreen', settings })
    expect(limiter.port.postMessage).toHaveBeenLastCalledWith({
      type: 'settings',
      settings: settings.limiter,
    })
    settings.limiter.enabled = false
    await dispatch({ type: 'SYNC_SETTINGS', target: 'offscreen', settings })
    expect(limiter.port.postMessage).toHaveBeenLastCalledWith({
      type: 'settings',
      settings: settings.limiter,
    })
    expect(mix!.outputs).toEqual(new Set([limiter]))
    expect(limiter.outputs).toEqual(new Set([context.destination]))
    settings.limiter.enabled = true
    await dispatch({ type: 'SYNC_SETTINGS', target: 'offscreen', settings })
    expect(mix!.outputs).toEqual(new Set([limiter]))
    expect(limiter.outputs).toEqual(new Set([context.destination]))
    expect(first!.outputs).toEqual(new Set([mix]))
    expect(second!.outputs).toEqual(new Set([mix]))
    expect(context.limiters).toHaveLength(1)
  })
})

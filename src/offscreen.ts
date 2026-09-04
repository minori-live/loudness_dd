/**
 * Owns the complete lifetime and realtime state of active audio captures.
 * The service worker only creates this document and forwards durable commands.
 */

import { dbToGain } from '@/audio/lufs'
import { SessionState, type SessionTabState } from '@/audio/session-state'
import {
  OFFSCREEN_TARGET,
  SESSION_PORT_NAME,
  createDefaultSettings,
  type CaptureEndedMessage,
  type LimiterSettings,
  type OffscreenRequest,
  type OffscreenResponse,
  type PersistedSettings,
  type SessionPortMessage,
  type TabLufs,
} from '@/protocol'
import lufsProcessorUrl from '@/worklets/lufs-processor?worker&url'

interface TabAudioProcessor extends SessionTabState {
  audioContext: AudioContext
  sourceNode: MediaStreamAudioSourceNode
  gainNode: GainNode
  limiterNode: DynamicsCompressorNode
  workletNode: AudioWorkletNode
  stream: MediaStream
  trackEndedHandler: () => void
  contextStateHandler: () => void
}

const session = new SessionState<TabAudioProcessor>()
const subscribers = new Set<chrome.runtime.Port>()
const cleanupTasks = new Map<number, Promise<boolean>>()
let settings = createDefaultSettings()

function response(success: boolean, error?: string): OffscreenResponse {
  return { success, session: session.snapshot(), error }
}

function notifySubscribers(): void {
  if (subscribers.size === 0) return
  const message: SessionPortMessage = { type: 'SESSION_UPDATED', session: session.snapshot() }
  for (const port of subscribers) {
    try {
      port.postMessage(message)
    } catch {
      subscribers.delete(port)
    }
  }
}

function notifyCaptureEnded(tabId: number, reason: string): void {
  const message: CaptureEndedMessage = {
    type: 'CAPTURE_ENDED',
    tabId,
    tabCount: session.size,
    reason,
  }
  void chrome.runtime.sendMessage(message).catch(() => undefined)
}

function applyLimiterSettings(node: DynamicsCompressorNode, limiter: LimiterSettings): void {
  const time = node.context.currentTime
  if (limiter.enabled) {
    node.threshold.setValueAtTime(limiter.thresholdDb, time)
    node.knee.setValueAtTime(limiter.kneeDb, time)
    node.ratio.setValueAtTime(limiter.ratio, time)
    node.attack.setValueAtTime(limiter.attackMs / 1000, time)
    node.release.setValueAtTime(limiter.releaseMs / 1000, time)
    return
  }

  node.threshold.setValueAtTime(0, time)
  node.knee.setValueAtTime(40, time)
  node.ratio.setValueAtTime(1, time)
  node.attack.setValueAtTime(0, time)
  node.release.setValueAtTime(0.25, time)
}

function applyEffectiveGain(processor: TabAudioProcessor): void {
  const gain = session.isMuted(processor.tabId)
    ? 0
    : dbToGain(processor.gainDb + session.gainOffsetDb(processor.tabId))
  processor.gainNode.gain.setValueAtTime(gain, processor.audioContext.currentTime)
}

function applyAllGains(): void {
  for (const processor of session.values()) applyEffectiveGain(processor)
}

function syncSettings(nextSettings: PersistedSettings): void {
  settings = {
    autoBalance: { ...nextSettings.autoBalance },
    autoFocus: { ...nextSettings.autoFocus },
    limiter: { ...nextSettings.limiter },
  }
  for (const processor of session.values()) {
    applyLimiterSettings(processor.limiterNode, settings.limiter)
  }
}

async function performCleanup(tabId: number): Promise<boolean> {
  const processor = session.remove(tabId)
  if (!processor) return false

  for (const track of processor.stream.getAudioTracks()) {
    track.removeEventListener('ended', processor.trackEndedHandler)
  }
  processor.audioContext.removeEventListener('statechange', processor.contextStateHandler)

  try {
    processor.workletNode.port.onmessage = null
    processor.workletNode.port.close()
    processor.workletNode.disconnect()
    processor.sourceNode.disconnect()
    processor.gainNode.disconnect()
    processor.limiterNode.disconnect()
  } catch {
    // Nodes may already be disconnected during browser teardown.
  }

  for (const track of processor.stream.getTracks()) {
    try {
      track.stop()
    } catch {
      // A browser-ended track is already stopped.
    }
  }

  try {
    if (processor.audioContext.state !== 'closed') await processor.audioContext.close()
  } catch {
    // The context may have been closed by Chrome.
  }

  applyAllGains()
  notifySubscribers()
  return true
}

async function cleanupProcessor(tabId: number): Promise<boolean> {
  const pending = cleanupTasks.get(tabId)
  if (pending) return pending

  const cleanup = performCleanup(tabId)
  cleanupTasks.set(tabId, cleanup)
  try {
    return await cleanup
  } finally {
    cleanupTasks.delete(tabId)
  }
}

async function endCapture(tabId: number, reason: string): Promise<void> {
  if (!(await cleanupProcessor(tabId))) return
  notifyCaptureEnded(tabId, reason)
}

function handleLufs(tabId: number, lufs: TabLufs): void {
  if (!session.updateLufs(tabId, lufs)) return
  const gain = session.autoBalance(tabId, settings.autoBalance.targetLufs)
  if (gain !== undefined) {
    const processor = session.get(tabId)
    if (processor) applyEffectiveGain(processor)
  }
  notifySubscribers()
}

async function startCapture(
  tabId: number,
  streamId: string,
  title: string,
  url: string,
): Promise<OffscreenResponse> {
  if (session.get(tabId)) return response(false, 'Tab is already being captured')

  let stream: MediaStream | undefined
  let audioContext: AudioContext | undefined
  let sourceNode: MediaStreamAudioSourceNode | undefined
  let gainNode: GainNode | undefined
  let limiterNode: DynamicsCompressorNode | undefined
  let workletNode: AudioWorkletNode | undefined

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
        },
      } as MediaTrackConstraints,
      video: false,
    })

    const audioTracks = stream.getAudioTracks()
    if (audioTracks.length === 0) throw new Error('No audio tracks in stream')

    audioContext = new AudioContext()
    await audioContext.resume()
    sourceNode = audioContext.createMediaStreamSource(stream)
    gainNode = audioContext.createGain()
    limiterNode = audioContext.createDynamicsCompressor()
    applyLimiterSettings(limiterNode, settings.limiter)

    sourceNode.connect(gainNode)
    gainNode.connect(limiterNode)
    limiterNode.connect(audioContext.destination)

    await audioContext.audioWorklet.addModule(lufsProcessorUrl)
    workletNode = new AudioWorkletNode(audioContext, 'lufs-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    })

    const trackEndedHandler = () => void endCapture(tabId, 'Audio track ended')
    const contextStateHandler = () => {
      if (audioContext?.state === 'closed') void endCapture(tabId, 'Audio context closed')
    }

    const processor: TabAudioProcessor = {
      tabId,
      title,
      url,
      currentLufs: {
        momentary: -Infinity,
        shortTerm: -Infinity,
        integrated: -Infinity,
        blockCount: 0,
      },
      gainDb: 0,
      maxGainDb: 0,
      audioContext,
      sourceNode,
      gainNode,
      limiterNode,
      workletNode,
      stream,
      trackEndedHandler,
      contextStateHandler,
    }

    session.add(processor)
    workletNode.port.onmessage = (event: MessageEvent<Partial<TabLufs> & { type?: string }>) => {
      if (event.data?.type !== 'lufs') return
      handleLufs(tabId, {
        momentary: event.data.momentary ?? -Infinity,
        shortTerm: event.data.shortTerm ?? -Infinity,
        integrated: event.data.integrated ?? -Infinity,
        blockCount: event.data.blockCount ?? 0,
      })
    }

    sourceNode.connect(workletNode)
    workletNode.connect(audioContext.destination)
    for (const track of audioTracks) track.addEventListener('ended', trackEndedHandler)
    audioContext.addEventListener('statechange', contextStateHandler)
    applyEffectiveGain(processor)
    notifySubscribers()
    return response(true)
  } catch (error) {
    if (session.get(tabId)) {
      await cleanupProcessor(tabId)
    } else {
      try {
        workletNode?.port.close()
        workletNode?.disconnect()
        sourceNode?.disconnect()
        gainNode?.disconnect()
        limiterNode?.disconnect()
      } catch {
        // Ignore partial graph cleanup failures.
      }
      stream?.getTracks().forEach((track) => track.stop())
      if (audioContext && audioContext.state !== 'closed') await audioContext.close()
    }
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error(`Failed to start capture for tab ${tabId}:`, error)
    return response(false, message)
  }
}

async function stopCapture(tabId: number): Promise<OffscreenResponse> {
  const removed = await cleanupProcessor(tabId)
  return response(removed, removed ? undefined : 'Tab is not being captured')
}

function setGain(tabId: number, gainDb: number): OffscreenResponse {
  if (session.setGain(tabId, gainDb) === undefined) {
    return response(false, 'Tab is not being captured')
  }
  const processor = session.get(tabId)
  if (processor) applyEffectiveGain(processor)
  notifySubscribers()
  return response(true)
}

function setMaxGain(tabId: number, maxGainDb: number): OffscreenResponse {
  if (session.setMaxGain(tabId, maxGainDb) === undefined) {
    return response(false, 'Tab is not being captured')
  }
  const processor = session.get(tabId)
  if (processor) applyEffectiveGain(processor)
  notifySubscribers()
  return response(true)
}

function toggleSolo(tabId: number): OffscreenResponse {
  if (!session.toggleSolo(tabId)) return response(false, 'Tab is not being captured')
  applyAllGains()
  notifySubscribers()
  return response(true)
}

function toggleFocus(tabId: number): OffscreenResponse {
  if (!session.toggleFocus(tabId)) return response(false, 'Tab is not being captured')
  applyAllGains()
  notifySubscribers()
  return response(true)
}

function setFocus(tabId: number | null): OffscreenResponse {
  session.setFocus(tabId)
  applyAllGains()
  notifySubscribers()
  return response(true)
}

function handleMessage(message: OffscreenRequest): OffscreenResponse | Promise<OffscreenResponse> {
  switch (message.type) {
    case 'START_CAPTURE':
      return startCapture(message.tabId, message.streamId, message.title, message.url)
    case 'STOP_CAPTURE':
      return stopCapture(message.tabId)
    case 'SET_GAIN':
      return setGain(message.tabId, message.gainDb)
    case 'SET_MAX_GAIN':
      return setMaxGain(message.tabId, message.maxGainDb)
    case 'TOGGLE_SOLO':
      return toggleSolo(message.tabId)
    case 'CLEAR_SOLO':
      session.clearSolo()
      applyAllGains()
      notifySubscribers()
      return response(true)
    case 'TOGGLE_FOCUS':
      return toggleFocus(message.tabId)
    case 'SET_FOCUS':
      return setFocus(message.tabId)
    case 'CLEAR_FOCUS':
      session.clearFocus()
      applyAllGains()
      notifySubscribers()
      return response(true)
    case 'RESET_LUFS': {
      const processor = session.get(message.tabId)
      if (!processor) return response(false, 'Tab is not being captured')
      processor.workletNode.port.postMessage({ type: 'reset' })
      handleLufs(message.tabId, {
        momentary: -Infinity,
        shortTerm: -Infinity,
        integrated: -Infinity,
        blockCount: 0,
      })
      return response(true)
    }
    case 'SYNC_SETTINGS':
      syncSettings(message.settings)
      return response(true)
    case 'UPDATE_TAB_METADATA':
      if (session.updateMetadata(message.tabId, { title: message.title, url: message.url })) {
        notifySubscribers()
      }
      return response(true)
  }
}

chrome.runtime.onMessage.addListener((rawMessage: unknown, _sender, sendResponse) => {
  if (
    !rawMessage ||
    typeof rawMessage !== 'object' ||
    !('target' in rawMessage) ||
    rawMessage.target !== OFFSCREEN_TARGET
  ) {
    return false
  }

  Promise.resolve(handleMessage(rawMessage as OffscreenRequest))
    .then(sendResponse)
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Unknown error'
      sendResponse(response(false, message))
    })
  return true
})

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== SESSION_PORT_NAME) return
  subscribers.add(port)
  port.postMessage({
    type: 'SESSION_UPDATED',
    session: session.snapshot(),
  } satisfies SessionPortMessage)
  port.onDisconnect.addListener(() => subscribers.delete(port))
})

console.log('Offscreen audio session loaded')

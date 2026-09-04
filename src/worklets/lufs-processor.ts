import { createKWeightingCoefficients, type BiquadCoefficients } from '../audio/k-weighting'

/* Global AudioWorklet types (provided by browser at runtime) */
declare class AudioWorkletProcessor {
  readonly port: MessagePort
  constructor()
}
declare function registerProcessor(name: string, processorCtor: new () => unknown): void

const CHANNEL_WEIGHTS: number[] = [1.0, 1.0] // Stereo

const ABSOLUTE_THRESHOLD = -70.0
const RELATIVE_THRESHOLD_OFFSET = -10.0
const MAX_INTEGRATED_BLOCKS = 600

/**
 * AudioWorklet processor for LUFS audio analysis
 * Captures audio samples and sends them to the main thread for LUFS calculation,
 * while outputting silence to avoid double audio.
 */
class LufsProcessor extends AudioWorkletProcessor {
  // Config
  readonly channels: number
  readonly blockSizeSamples: number
  readonly hopSizeSamples: number
  readonly shortTermBlockCount: number
  readonly updateIntervalSamples: number
  readonly highShelf: BiquadCoefficients
  readonly highPass: BiquadCoefficients

  // Filter states (typed arrays)
  hs_x1: Float32Array
  hs_x2: Float32Array
  hs_y1: Float32Array
  hs_y2: Float32Array
  hp_x1: Float32Array
  hp_x2: Float32Array
  hp_y1: Float32Array
  hp_y2: Float32Array

  // Rolling block accumulation via circular buffers
  ringIndex: number
  ringSquares: Float32Array[] // per-channel ring of y^2
  sumSquares: Float64Array // per-channel sum of y^2 over window
  samplesSinceLastBlock: number
  samplesSinceLastUpdate: number
  samplesAccumulated: number // Track warm-up: how many samples in ring buffer

  // Histories
  blockLoudnesses: number[]
  shortTermBlocks: number[]
  blockCount: number
  activeChannels: number

  constructor() {
    super()
    this.channels = 2
    const blockMs = 400
    const overlap = 0.75
    const sr = (globalThis as unknown as { sampleRate?: number }).sampleRate ?? 48000
    this.blockSizeSamples = Math.max(128, Math.floor((blockMs / 1000) * sr))
    this.hopSizeSamples = Math.max(1, Math.floor(this.blockSizeSamples * (1 - overlap)))
    this.shortTermBlockCount = Math.ceil(3000 / (blockMs * (1 - overlap)))
    this.updateIntervalSamples = Math.max(128, Math.floor(0.1 * sr)) // ~10 Hz
    const coefficients = createKWeightingCoefficients(sr)
    this.highShelf = coefficients.highShelf
    this.highPass = coefficients.highPass

    this.hs_x1 = new Float32Array(this.channels)
    this.hs_x2 = new Float32Array(this.channels)
    this.hs_y1 = new Float32Array(this.channels)
    this.hs_y2 = new Float32Array(this.channels)
    this.hp_x1 = new Float32Array(this.channels)
    this.hp_x2 = new Float32Array(this.channels)
    this.hp_y1 = new Float32Array(this.channels)
    this.hp_y2 = new Float32Array(this.channels)

    this.ringIndex = 0
    this.ringSquares = Array.from(
      { length: this.channels },
      () => new Float32Array(this.blockSizeSamples),
    )
    this.sumSquares = new Float64Array(this.channels)
    this.samplesSinceLastBlock = 0
    this.samplesSinceLastUpdate = 0
    this.samplesAccumulated = 0

    this.blockLoudnesses = []
    this.shortTermBlocks = []
    this.blockCount = 0
    this.activeChannels = 0

    // Control messages
    this.port.onmessage = (ev: MessageEvent) => {
      const data = ev.data
      if (!data || typeof data !== 'object') return
      if (data.type === 'reset') {
        this.resetState()
      }
    }
  }

  // inputs: [ inputIndex ][ channelIndex ] -> Float32Array
  // outputs: [ outputIndex ][ channelIndex ] -> Float32Array
  process(
    inputs: ReadonlyArray<ReadonlyArray<Float32Array | undefined>>,
    outputs: ReadonlyArray<ReadonlyArray<Float32Array>>,
  ): boolean {
    const input = inputs[0]

    // If no input, keep processor alive
    if (!input || input.length === 0) {
      return true
    }

    const inputL = input[0]
    const inputR = input[1]

    if (!inputL) {
      return true
    }

    const left: Float32Array = inputL as Float32Array
    const right = inputR as Float32Array | undefined
    const frameCount = left.length
    const activeChannels = right ? 2 : 1

    if (this.activeChannels !== 0 && this.activeChannels !== activeChannels) {
      // A layout change invalidates the accumulated channel-weighted history.
      this.resetState()
    }
    this.activeChannels = activeChannels

    // Per-sample filtering and rolling window update
    for (let i = 0; i < frameCount; i++) {
      // Channel 0 (L)
      {
        const ch = 0
        const x = left[i] ?? 0
        const yHs =
          this.highShelf.b[0] * x +
          this.highShelf.b[1] * this.hs_x1[ch]! +
          this.highShelf.b[2] * this.hs_x2[ch]! -
          this.highShelf.a[1] * this.hs_y1[ch]! -
          this.highShelf.a[2] * this.hs_y2[ch]!
        this.hs_x2[ch] = this.hs_x1[ch]!
        this.hs_x1[ch] = x
        this.hs_y2[ch] = this.hs_y1[ch]!
        this.hs_y1[ch] = yHs
        const yHp =
          this.highPass.b[0] * yHs +
          this.highPass.b[1] * this.hp_x1[ch]! +
          this.highPass.b[2] * this.hp_x2[ch]! -
          this.highPass.a[1] * this.hp_y1[ch]! -
          this.highPass.a[2] * this.hp_y2[ch]!
        this.hp_x2[ch] = this.hp_x1[ch]!
        this.hp_x1[ch] = yHs
        this.hp_y2[ch] = this.hp_y1[ch]!
        this.hp_y1[ch] = yHp
        const y2 = yHp * yHp
        const ringCh = this.ringSquares[ch]!
        const old = ringCh[this.ringIndex] || 0
        this.sumSquares[ch] = (this.sumSquares[ch] ?? 0) + (y2 - old)
        ringCh[this.ringIndex] = y2
      }
      // Channel 1 (R), when the source is actually stereo.
      if (right) {
        const ch = 1
        const x = right[i] ?? 0
        const yHs =
          this.highShelf.b[0] * x +
          this.highShelf.b[1] * this.hs_x1[ch]! +
          this.highShelf.b[2] * this.hs_x2[ch]! -
          this.highShelf.a[1] * this.hs_y1[ch]! -
          this.highShelf.a[2] * this.hs_y2[ch]!
        this.hs_x2[ch] = this.hs_x1[ch]!
        this.hs_x1[ch] = x
        this.hs_y2[ch] = this.hs_y1[ch]!
        this.hs_y1[ch] = yHs
        const yHp =
          this.highPass.b[0] * yHs +
          this.highPass.b[1] * this.hp_x1[ch]! +
          this.highPass.b[2] * this.hp_x2[ch]! -
          this.highPass.a[1] * this.hp_y1[ch]! -
          this.highPass.a[2] * this.hp_y2[ch]!
        this.hp_x2[ch] = this.hp_x1[ch]!
        this.hp_x1[ch] = yHs
        this.hp_y2[ch] = this.hp_y1[ch]!
        this.hp_y1[ch] = yHp
        const y2 = yHp * yHp
        const ringCh = this.ringSquares[ch]!
        const old = ringCh[this.ringIndex] || 0
        this.sumSquares[ch] = (this.sumSquares[ch] ?? 0) + (y2 - old)
        ringCh[this.ringIndex] = y2
      }

      // Advance shared ring index and counters
      this.ringIndex++
      if (this.ringIndex >= this.blockSizeSamples) this.ringIndex = 0
      this.samplesSinceLastBlock++
      this.samplesSinceLastUpdate++
      // Track warm-up: ring buffer fills up to blockSizeSamples
      if (this.samplesAccumulated < this.blockSizeSamples) {
        this.samplesAccumulated++
      }

      // Create a new block every hop, but only after ring buffer is full
      if (
        this.samplesSinceLastBlock >= this.hopSizeSamples &&
        this.samplesAccumulated >= this.blockSizeSamples
      ) {
        this.samplesSinceLastBlock -= this.hopSizeSamples
        const blockLufs = this.computeCurrentBlockLufs()
        if (blockLufs > ABSOLUTE_THRESHOLD) {
          this.blockLoudnesses.push(blockLufs)
          if (this.blockLoudnesses.length > MAX_INTEGRATED_BLOCKS) {
            this.blockLoudnesses.shift()
          }
          this.blockCount++
        }
        this.shortTermBlocks.push(blockLufs)
        if (this.shortTermBlocks.length > this.shortTermBlockCount) {
          this.shortTermBlocks.shift()
        }
      }

      // Emit ~10 Hz aggregated results
      if (this.samplesSinceLastUpdate >= this.updateIntervalSamples) {
        this.samplesSinceLastUpdate -= this.updateIntervalSamples
        const momentary = this.getMomentary()
        const shortTerm = this.getShortTerm()
        const integrated = this.getIntegrated()
        this.port.postMessage({
          type: 'lufs',
          momentary,
          shortTerm,
          integrated,
          blockCount: this.blockCount,
        })
      }
    }

    // Output silence to avoid double audio
    const output = outputs[0]
    if (output) {
      for (let channel = 0; channel < output.length; channel++) {
        const outputChannel = output[channel]
        if (outputChannel) {
          outputChannel.fill(0)
        }
      }
    }

    return true
  }

  private computeCurrentBlockLufs(): number {
    let sumWeighted = 0
    for (let ch = 0; ch < this.activeChannels; ch++) {
      const channelSum = this.sumSquares[ch] ?? 0
      const meanSquare = channelSum / this.blockSizeSamples
      const weight = CHANNEL_WEIGHTS[ch] ?? 1.0
      sumWeighted += weight * meanSquare
    }
    if (sumWeighted <= 0) return -Infinity
    return -0.691 + 10 * Math.log10(sumWeighted)
  }

  private getMomentary(): number {
    if (this.shortTermBlocks.length === 0) return -Infinity
    return this.shortTermBlocks[this.shortTermBlocks.length - 1] ?? -Infinity
  }

  private getShortTerm(): number {
    if (this.shortTermBlocks.length === 0) return -Infinity

    let validCount = 0
    let sumPower = 0
    for (let i = 0; i < this.shortTermBlocks.length; i++) {
      const blockLufs = this.shortTermBlocks[i] ?? -Infinity
      if (blockLufs > ABSOLUTE_THRESHOLD) {
        sumPower += Math.pow(10, blockLufs / 10)
        validCount++
      }
    }

    if (validCount === 0) return -Infinity
    const meanPower = sumPower / validCount
    return 10 * Math.log10(meanPower)
  }

  private getIntegrated(): number {
    if (this.blockLoudnesses.length === 0) return -Infinity

    let absoluteCount = 0
    let sumPower1 = 0
    for (let i = 0; i < this.blockLoudnesses.length; i++) {
      const blockLufs = this.blockLoudnesses[i] ?? -Infinity
      if (blockLufs > ABSOLUTE_THRESHOLD) {
        sumPower1 += Math.pow(10, blockLufs / 10)
        absoluteCount++
      }
    }

    if (absoluteCount === 0) return -Infinity
    const firstMeanPower = sumPower1 / absoluteCount
    const relativeThreshold = 10 * Math.log10(firstMeanPower) + RELATIVE_THRESHOLD_OFFSET

    let relativeCount = 0
    let sumPower2 = 0
    for (let i = 0; i < this.blockLoudnesses.length; i++) {
      const blockLufs = this.blockLoudnesses[i] ?? -Infinity
      if (blockLufs > relativeThreshold) {
        sumPower2 += Math.pow(10, blockLufs / 10)
        relativeCount++
      }
    }

    if (relativeCount === 0) return -Infinity
    const finalMeanPower = sumPower2 / relativeCount
    return 10 * Math.log10(finalMeanPower)
  }

  private resetState(): void {
    this.hs_x1.fill(0)
    this.hs_x2.fill(0)
    this.hs_y1.fill(0)
    this.hs_y2.fill(0)
    this.hp_x1.fill(0)
    this.hp_x2.fill(0)
    this.hp_y1.fill(0)
    this.hp_y2.fill(0)
    for (let ch = 0; ch < this.channels; ch++) {
      this.ringSquares[ch]!.fill(0)
      this.sumSquares[ch] = 0
    }
    this.ringIndex = 0
    this.samplesSinceLastBlock = 0
    this.samplesSinceLastUpdate = 0
    this.samplesAccumulated = 0
    this.blockLoudnesses = []
    this.shortTermBlocks = []
    this.blockCount = 0
  }
}

registerProcessor('lufs-processor', LufsProcessor)

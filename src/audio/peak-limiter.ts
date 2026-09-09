import type { LimiterSettings } from '@/protocol'

import { normalizeLimiterSettings } from './limiter-settings'

export const LIMITER_LOOKAHEAD_MS = 5
const ATTACK_MS = 1

/** Stereo-linked sample-peak limiter. No makeup gain or true-peak claim. */
export class PeakLimiter {
  readonly latencyFrames: number
  private readonly leftDelay: Float32Array
  private readonly rightDelay: Float32Array
  private readonly peakValues: Float64Array
  private readonly peakFrames: Float64Array
  private readonly attackCoefficient: number
  private settings: LimiterSettings
  private releaseCoefficient = 0
  private targetGain = 1
  private shape = 2
  private gain = 1
  private frame = 0
  private delayIndex = 0
  private peakHead = 0
  private peakTail = 0

  constructor(
    private readonly sampleRate: number,
    settings: Partial<LimiterSettings> = {},
  ) {
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error('Invalid sample rate')
    this.latencyFrames = Math.max(1, Math.round((sampleRate * LIMITER_LOOKAHEAD_MS) / 1000))
    this.leftDelay = new Float32Array(this.latencyFrames)
    this.rightDelay = new Float32Array(this.latencyFrames)
    this.peakValues = new Float64Array(this.latencyFrames + 2)
    this.peakFrames = new Float64Array(this.latencyFrames + 2)
    this.attackCoefficient = Math.exp(-1 / ((sampleRate * ATTACK_MS) / 1000))
    this.settings = normalizeLimiterSettings(settings)
    this.configure(settings)
  }

  configure(settings: Partial<LimiterSettings>): void {
    this.settings = normalizeLimiterSettings({ ...this.settings, ...settings })
    this.releaseCoefficient = Math.exp(-1 / ((this.sampleRate * this.settings.releaseMs) / 1000))
    this.targetGain = Math.pow(10, this.settings.targetDb / 20)
    this.shape = this.settings.kneePercent > 0 ? 100 / this.settings.kneePercent : Infinity
  }

  private requiredGain(peak: number): number {
    if (peak <= 0) return 1
    const { thresholdDb, targetDb, kneePercent } = this.settings
    const inputDb = 20 * Math.log10(peak)
    if (inputDb <= thresholdDb) return 1
    const headroom = targetDb - thresholdDb
    if (headroom === 0 || kneePercent === 0) return Math.min(1, this.targetGain / peak)

    // A smooth minimum between the excess above threshold and the available
    // headroom. 0% is a hard ceiling, 100% the gentlest bend. This starts at
    // threshold, has unity slope there, and approaches target without boosting.
    const excess = (inputDb - thresholdDb) / headroom
    const bend =
      excess <= 1
        ? excess / Math.pow(1 + Math.pow(excess, this.shape), 1 / this.shape)
        : 1 / Math.pow(1 + Math.pow(1 / excess, this.shape), 1 / this.shape)
    const outputDb = thresholdDb + headroom * bend
    return Math.pow(10, (outputDb - inputDb) / 20)
  }

  private windowPeak(peak: number): number {
    const size = this.peakValues.length
    while (
      this.peakHead !== this.peakTail &&
      this.peakFrames[this.peakHead]! < this.frame - this.latencyFrames
    ) {
      this.peakHead = (this.peakHead + 1) % size
    }
    while (this.peakHead !== this.peakTail) {
      const previous = (this.peakTail + size - 1) % size
      if (this.peakValues[previous]! > peak) break
      this.peakTail = previous
    }
    this.peakValues[this.peakTail] = peak
    this.peakFrames[this.peakTail] = this.frame++
    this.peakTail = (this.peakTail + 1) % size
    return this.peakValues[this.peakHead]!
  }

  process(
    input: ReadonlyArray<Float32Array | undefined>,
    output: ReadonlyArray<Float32Array>,
  ): void {
    const outputLeft = output[0]
    if (!outputLeft) return
    const outputRight = output[1]
    for (let i = 0; i < outputLeft.length; i++) {
      const rawLeft = input[0]?.[i] ?? 0
      const rawRight = input[1]?.[i] ?? rawLeft
      const left = Number.isFinite(rawLeft) ? rawLeft : 0
      const right = Number.isFinite(rawRight) ? rawRight : 0
      const delayedLeft = this.leftDelay[this.delayIndex]!
      const delayedRight = this.rightDelay[this.delayIndex]!
      this.leftDelay[this.delayIndex] = left
      this.rightDelay[this.delayIndex] = right
      this.delayIndex = (this.delayIndex + 1) % this.latencyFrames

      const peak = this.windowPeak(Math.max(Math.abs(left), Math.abs(right)))
      if (this.settings.enabled) {
        const desired = this.requiredGain(peak)
        const coefficient = desired < this.gain ? this.attackCoefficient : this.releaseCoefficient
        this.gain = desired + coefficient * (this.gain - desired)
        // Safeguard sudden peaks and target changes while the envelope settles.
        // Both channels receive exactly the same gain to preserve the stereo image.
        const delayedPeak = Math.max(Math.abs(delayedLeft), Math.abs(delayedRight))
        if (delayedPeak > 0) this.gain = Math.min(this.gain, this.targetGain / delayedPeak)
      } else {
        this.gain = 1
      }
      outputLeft[i] = delayedLeft * this.gain
      if (outputRight) outputRight[i] = delayedRight * this.gain
    }
  }
}

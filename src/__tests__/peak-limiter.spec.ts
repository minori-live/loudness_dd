import { describe, expect, it } from 'vitest'

import { normalizeLimiterSettings } from '@/audio/limiter-settings'
import { PeakLimiter } from '@/audio/peak-limiter'
import { DEFAULT_LIMITER_SETTINGS, type LimiterSettings } from '@/protocol'

const amplitude = (db: number) => Math.pow(10, db / 20)

function render(limiter: PeakLimiter, left: Float32Array, right = left, blockSize = 128) {
  const outputLeft = new Float32Array(left.length)
  const outputRight = new Float32Array(left.length)
  for (let offset = 0; offset < left.length; offset += blockSize) {
    limiter.process(
      [left.subarray(offset, offset + blockSize), right.subarray(offset, offset + blockSize)],
      [
        outputLeft.subarray(offset, offset + blockSize),
        outputRight.subarray(offset, offset + blockSize),
      ],
    )
  }
  return [outputLeft, outputRight] as const
}

function constantOutput(db: number, settings: Partial<LimiterSettings> = {}) {
  const limiter = new PeakLimiter(48000, { enabled: true, ...settings })
  const [output] = render(limiter, new Float32Array(4800).fill(amplitude(db)))
  return output[output.length - 1]!
}

describe('limiter settings', () => {
  it('uses the new soft defaults and migrates old compressor settings', () => {
    expect(normalizeLimiterSettings()).toEqual(DEFAULT_LIMITER_SETTINGS)
    expect(
      normalizeLimiterSettings({
        enabled: true,
        thresholdDb: -1,
        ratio: 20,
        attackMs: 1,
        kneeDb: 0,
        releaseMs: 100,
      }),
    ).toEqual({ ...DEFAULT_LIMITER_SETTINGS, enabled: true })
    expect(
      normalizeLimiterSettings({ enabled: true, thresholdDb: -6, ratio: 40, releaseMs: 200 }),
    ).toEqual({ enabled: true, targetDb: -6, thresholdDb: -8, kneePercent: 50, releaseMs: 200 })
  })

  it('clamps coupled levels, invalid values and control ranges', () => {
    expect(
      normalizeLimiterSettings({
        thresholdDb: -1,
        targetDb: -6,
        kneePercent: NaN,
        releaseMs: Infinity,
      }),
    ).toEqual({ ...DEFAULT_LIMITER_SETTINGS, thresholdDb: -6, targetDb: -6 })
    expect(normalizeLimiterSettings({ targetDb: NaN, thresholdDb: NaN })).toEqual(
      DEFAULT_LIMITER_SETTINGS,
    )
    expect(
      normalizeLimiterSettings({ targetDb: 10, thresholdDb: -100, kneePercent: -1, releaseMs: 0 }),
    ).toEqual({ enabled: false, targetDb: -0.1, thresholdDb: -60, kneePercent: 0, releaseMs: 10 })
  })
})

describe('peak limiter audio', () => {
  it('passes quiet audio unchanged after its fixed delay, including mono', () => {
    const limiter = new PeakLimiter(48000, { enabled: true })
    const input = Float32Array.from({ length: 4096 }, (_, i) => 0.1 * Math.sin(i / 10))
    const [output] = render(limiter, input)
    expect(output.slice(0, limiter.latencyFrames)).toEqual(new Float32Array(limiter.latencyFrames))
    expect(output.slice(limiter.latencyFrames)).toEqual(input.slice(0, -limiter.latencyFrames))
    const mono = new PeakLimiter(48000, { enabled: true })
    const out = [new Float32Array(4096), new Float32Array(4096)]
    mono.process([input], out)
    expect(out[0]).toEqual(output)
    expect(out[1]).toEqual(output)
  })

  it.each([44100, 48000, 96000])(
    'keeps summed peaks and impulses below target at %i Hz',
    (sampleRate) => {
      const limiter = new PeakLimiter(sampleRate, { enabled: true })
      const input = Float32Array.from({ length: sampleRate }, (_, i) => {
        if (i % 997 === 0) return i % 2 === 0 ? 20 : -20
        return Math.sin(i / 7) * 0.8 + Math.sin(i / 11) * 0.8
      })
      const [left, right] = render(
        limiter,
        input,
        Float32Array.from(input, (x) => x * 0.25),
        73,
      )
      const ceiling = amplitude(-1)
      for (let i = 0; i < left.length; i++) {
        expect(Math.abs(left[i]!)).toBeLessThanOrEqual(ceiling + 1e-7)
        expect(right[i]!).toBeCloseTo(left[i]! * 0.25, 7)
        if (i >= limiter.latencyFrames) {
          expect(Math.abs(left[i]!)).toBeLessThanOrEqual(
            Math.abs(input[i - limiter.latencyFrames]!) + 1e-7,
          )
        }
      }
    },
  )

  it('starts soft attenuation above threshold and increases softness with knee', () => {
    expect(constantOutput(-4)).toBeCloseTo(amplitude(-4), 6)
    expect(constantOutput(-3)).toBeCloseTo(amplitude(-3), 6)
    expect(constantOutput(-2.5)).toBeLessThan(amplitude(-2.5))
    expect(constantOutput(0, { kneePercent: 100 })).toBeLessThan(
      constantOutput(0, { kneePercent: 50 }),
    )
    expect(constantOutput(0, { kneePercent: 50 })).toBeLessThan(
      constantOutput(0, { kneePercent: 0 }),
    )
    expect(constantOutput(6, { kneePercent: 0 })).toBeCloseTo(amplitude(-1), 6)
    expect(constantOutput(6, { thresholdDb: -6, targetDb: -6 })).toBeCloseTo(amplitude(-6), 6)
  })

  it('restores gain more slowly with a longer release', () => {
    const input = new Float32Array(24000).fill(0.1)
    input.fill(2, 0, 4800)
    const fast = render(new PeakLimiter(48000, { enabled: true, releaseMs: 10 }), input)[0]
    const slow = render(new PeakLimiter(48000, { enabled: true, releaseMs: 500 }), input)[0]
    expect(fast[12000]!).toBeGreaterThan(slow[12000]!)
    expect(fast[12000]!).toBeCloseTo(0.1, 5)
    expect(slow[20000]!).toBeGreaterThan(slow[12000]!)
  })

  it('applies a lowered target immediately and bypasses without replaying old samples', () => {
    const limiter = new PeakLimiter(48000, { enabled: true })
    render(limiter, new Float32Array(2048).fill(2))
    limiter.configure({ targetDb: -12 })
    const [lowered] = render(limiter, new Float32Array(2048).fill(2))
    for (const sample of lowered) expect(sample).toBeLessThanOrEqual(amplitude(-12) + 1e-7)
    limiter.configure({ enabled: false })
    const [bypassed] = render(limiter, new Float32Array(2048).fill(0.25))
    expect(bypassed[bypassed.length - 1]).toBe(0.25)
    limiter.configure({ enabled: true })
    const [resumed] = render(limiter, new Float32Array(2048).fill(0.1))
    expect(resumed[0]).toBe(0.25)
    expect(resumed[resumed.length - 1]).toBeCloseTo(0.1, 6)
  })

  it('handles silence and non-finite input without poisoning future audio', () => {
    const limiter = new PeakLimiter(48000, { enabled: true })
    const input = new Float32Array(4096).fill(0.1)
    input[0] = NaN
    input[1] = Infinity
    const [output] = render(limiter, input)
    expect(output.every(Number.isFinite)).toBe(true)
    expect(output[output.length - 1]).toBeCloseTo(0.1, 6)
    const silence = [new Float32Array(4096), new Float32Array(4096)]
    limiter.process([], silence)
    expect(silence[0]!.slice(limiter.latencyFrames).every((x) => x === 0)).toBe(true)
  })
})

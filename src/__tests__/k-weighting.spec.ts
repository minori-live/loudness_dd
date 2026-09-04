import { describe, expect, it } from 'vitest'

import { createKWeightingCoefficients } from '@/audio/k-weighting'
import { LufsCalculator } from '@/audio/lufs'

const EXPECTED_COEFFICIENTS = {
  44100: {
    highShelf: {
      b: [1.5308412300503478, -2.6509799951547297, 1.169079079921587],
      a: [1, -1.6636551132560204, 0.7125954280732254],
    },
    highPass: {
      b: [1, -2, 1],
      a: [1, -1.989169673629796, 0.9891990357870393],
    },
  },
  48000: {
    highShelf: {
      b: [1.5351248595869702, -2.6916961894063807, 1.19839281085285],
      a: [1, -1.6906592931824103, 0.7324807742158501],
    },
    highPass: {
      b: [1, -2, 1],
      a: [1, -1.9900474548339797, 0.9900722503662099],
    },
  },
  96000: {
    highShelf: {
      b: [1.5597142289757966, -2.9267415782510824, 1.3782612023158187],
      a: [1, -1.8446094698901085, 0.8558433229306412],
    },
    highPass: {
      b: [1, -2, 1],
      a: [1, -1.9950175447247156, 0.9950237590409233],
    },
  },
} as const

function expectCoefficientsClose(actual: readonly number[], expected: readonly number[]): void {
  expect(actual).toHaveLength(expected.length)
  for (let index = 0; index < expected.length; index++) {
    expect(actual[index]).toBeCloseTo(expected[index]!, 12)
  }
}

function measureSine(sampleRate: number): number {
  const durationSeconds = 4
  const frameCount = sampleRate * durationSeconds
  const samples = new Float32Array(frameCount * 2)
  const amplitude = Math.pow(10, -18 / 20)

  for (let frame = 0; frame < frameCount; frame++) {
    const sample = Math.sin((2 * Math.PI * 1000 * frame) / sampleRate) * amplitude
    samples[frame * 2] = sample
    samples[frame * 2 + 1] = sample
  }

  const calculator = new LufsCalculator({ sampleRate, channels: 2 })
  calculator.processInterleaved(samples)
  return calculator.getIntegratedLoudness()
}

describe('K-weighting coefficients', () => {
  it.each([44100, 48000, 96000] as const)(
    'matches the reference coefficients at %i Hz',
    (sampleRate) => {
      const actual = createKWeightingCoefficients(sampleRate)
      const expected = EXPECTED_COEFFICIENTS[sampleRate]

      expectCoefficientsClose(actual.highShelf.b, expected.highShelf.b)
      expectCoefficientsClose(actual.highShelf.a, expected.highShelf.a)
      expectCoefficientsClose(actual.highPass.b, expected.highPass.b)
      expectCoefficientsClose(actual.highPass.a, expected.highPass.a)
    },
  )

  it('keeps a 1 kHz measurement consistent across common sample rates', () => {
    const at44100 = measureSine(44100)
    const at48000 = measureSine(48000)
    const at96000 = measureSine(96000)

    expect(Math.abs(at44100 - at48000)).toBeLessThan(0.02)
    expect(Math.abs(at96000 - at48000)).toBeLessThan(0.02)
  })

  it('rejects invalid sample rates', () => {
    expect(() => createKWeightingCoefficients(0)).toThrow(RangeError)
    expect(() => createKWeightingCoefficients(Number.NaN)).toThrow(RangeError)
  })
})

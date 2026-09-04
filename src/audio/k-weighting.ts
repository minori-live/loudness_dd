export type BiquadCoefficients = Readonly<{
  b: readonly [number, number, number]
  a: readonly [number, number, number]
}>

export interface KWeightingCoefficients {
  highShelf: BiquadCoefficients
  highPass: BiquadCoefficients
}

/**
 * Calculate the BS.1770 K-weighting filters for the AudioContext sample rate.
 *
 * The constants describe the analogue filter response. The bilinear transform
 * below produces the digital coefficients for the requested sample rate and
 * reproduces the coefficients published by BS.1770 at 48 kHz.
 */
export function createKWeightingCoefficients(sampleRate: number): KWeightingCoefficients {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError(`Invalid sample rate: ${sampleRate}`)
  }

  const shelfFrequency = 1681.974450955533
  const shelfGainDb = 3.999843853973347
  const shelfQ = 0.7071752369554196
  const shelfK = Math.tan((Math.PI * shelfFrequency) / sampleRate)
  const shelfGain = Math.pow(10, shelfGainDb / 20)
  const shelfBandwidthGain = Math.pow(shelfGain, 0.4996667741545416)
  const shelfA0 = 1 + shelfK / shelfQ + shelfK * shelfK

  const highShelf: BiquadCoefficients = {
    b: [
      (shelfGain + (shelfBandwidthGain * shelfK) / shelfQ + shelfK * shelfK) / shelfA0,
      (2 * (shelfK * shelfK - shelfGain)) / shelfA0,
      (shelfGain - (shelfBandwidthGain * shelfK) / shelfQ + shelfK * shelfK) / shelfA0,
    ],
    a: [
      1,
      (2 * (shelfK * shelfK - 1)) / shelfA0,
      (1 - shelfK / shelfQ + shelfK * shelfK) / shelfA0,
    ],
  }

  const highPassFrequency = 38.13547087602444
  const highPassQ = 0.5003270373238773
  const highPassK = Math.tan((Math.PI * highPassFrequency) / sampleRate)
  const highPassA0 = 1 + highPassK / highPassQ + highPassK * highPassK

  const highPass: BiquadCoefficients = {
    b: [1, -2, 1],
    a: [
      1,
      (2 * (highPassK * highPassK - 1)) / highPassA0,
      (1 - highPassK / highPassQ + highPassK * highPassK) / highPassA0,
    ],
  }

  return { highShelf, highPass }
}

import { describe, expect, it } from 'vitest'

import { normalizeSettings } from '@/background/settings'

describe('normalizeSettings', () => {
  it('merges stored partial settings with defaults', () => {
    expect(normalizeSettings(undefined, { ratio: 8 })).toMatchObject({
      autoBalance: { targetLufs: -14 },
      autoFocus: { enabled: false, attenuationDb: -12 },
      limiter: { enabled: false, thresholdDb: -1, ratio: 8 },
    })
  })

  it('normalizes persisted auto-focus settings', () => {
    expect(
      normalizeSettings(undefined, undefined, { enabled: true, attenuationDb: -24 }).autoFocus,
    ).toEqual({ enabled: true, attenuationDb: -24 })
  })

  it('clamps invalid persisted values at the boundary', () => {
    const settings = normalizeSettings(
      { targetLufs: 20 },
      { enabled: true, thresholdDb: -200, kneeDb: 80, ratio: 0, attackMs: -1 },
    )

    expect(settings.autoBalance.targetLufs).toBe(0)
    expect(settings.limiter).toMatchObject({
      enabled: true,
      thresholdDb: -100,
      kneeDb: 40,
      ratio: 1,
      attackMs: 0,
    })
    expect(
      normalizeSettings(undefined, undefined, { attenuationDb: -200 }).autoFocus,
    ).toMatchObject({ attenuationDb: -60 })
  })
})

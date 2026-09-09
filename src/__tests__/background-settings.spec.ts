import { describe, expect, it } from 'vitest'

import { normalizeSettings } from '@/background/settings'

describe('normalizeSettings', () => {
  it('merges stored partial settings with defaults', () => {
    expect(normalizeSettings(undefined, { releaseMs: 200 })).toMatchObject({
      autoBalance: { targetLufs: -14 },
      autoFocus: { enabled: false, attenuationDb: -12 },
      limiter: { enabled: false, thresholdDb: -3, targetDb: -1, kneePercent: 50, releaseMs: 200 },
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
      { enabled: true, thresholdDb: -200, targetDb: 10, kneePercent: 200, releaseMs: -1 },
    )

    expect(settings.autoBalance.targetLufs).toBe(0)
    expect(settings.limiter).toMatchObject({
      enabled: true,
      thresholdDb: -60,
      targetDb: -0.1,
      kneePercent: 100,
      releaseMs: 10,
    })
    expect(
      normalizeSettings(undefined, undefined, { attenuationDb: -200 }).autoFocus,
    ).toMatchObject({ attenuationDb: -60 })
  })
})

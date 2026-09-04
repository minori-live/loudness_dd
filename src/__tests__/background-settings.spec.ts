import { describe, expect, it } from 'vitest'

import { normalizeSettings } from '@/background/settings'

describe('normalizeSettings', () => {
  it('merges stored partial settings with defaults', () => {
    expect(normalizeSettings({ enabled: true }, { ratio: 8 })).toMatchObject({
      autoBalance: { enabled: true, targetLufs: -14 },
      limiter: { enabled: false, thresholdDb: -1, ratio: 8 },
    })
  })

  it('clamps invalid persisted values at the boundary', () => {
    const settings = normalizeSettings(
      { enabled: true, targetLufs: 20 },
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
  })
})

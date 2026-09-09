import { DEFAULT_LIMITER_SETTINGS, type LimiterSettings } from '@/protocol'

type StoredLimiterSettings = Partial<LimiterSettings> & {
  ratio?: number
  attackMs?: number
  kneeDb?: number
}

function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback
}

export function normalizeLimiterSettings(input: StoredLimiterSettings = {}): LimiterSettings {
  // The old compressor exposed its threshold as a ceiling. Keep that ceiling,
  // enabled state and release, but do not transplant compressor-only controls.
  const legacy = input.targetDb === undefined && ('ratio' in input || 'attackMs' in input)
  const targetDb = clamp(
    legacy ? input.thresholdDb : input.targetDb,
    -60,
    -0.1,
    DEFAULT_LIMITER_SETTINGS.targetDb,
  )
  return {
    enabled: typeof input.enabled === 'boolean' ? input.enabled : DEFAULT_LIMITER_SETTINGS.enabled,
    targetDb,
    thresholdDb: clamp(
      legacy ? targetDb - 2 : input.thresholdDb,
      -60,
      targetDb,
      Math.min(DEFAULT_LIMITER_SETTINGS.thresholdDb, targetDb),
    ),
    kneePercent: clamp(input.kneePercent, 0, 100, DEFAULT_LIMITER_SETTINGS.kneePercent),
    releaseMs: clamp(input.releaseMs, 10, 500, DEFAULT_LIMITER_SETTINGS.releaseMs),
  }
}

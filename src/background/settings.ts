import {
  DEFAULT_AUTO_BALANCE_SETTINGS,
  DEFAULT_LIMITER_SETTINGS,
  type LimiterSettings,
  type PersistedSettings,
} from '@/protocol'

let cachedSettings: Promise<PersistedSettings> | null = null
let writeQueue: Promise<void> = Promise.resolve()

function clamp(value: number, minimum: number, maximum: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, value)) : fallback
}

export function normalizeSettings(
  autoBalance?: Partial<PersistedSettings['autoBalance']>,
  limiter?: Partial<LimiterSettings>,
): PersistedSettings {
  return {
    autoBalance: {
      enabled:
        typeof autoBalance?.enabled === 'boolean'
          ? autoBalance.enabled
          : DEFAULT_AUTO_BALANCE_SETTINGS.enabled,
      targetLufs: clamp(
        autoBalance?.targetLufs ?? DEFAULT_AUTO_BALANCE_SETTINGS.targetLufs,
        -60,
        0,
        DEFAULT_AUTO_BALANCE_SETTINGS.targetLufs,
      ),
    },
    limiter: {
      enabled:
        typeof limiter?.enabled === 'boolean' ? limiter.enabled : DEFAULT_LIMITER_SETTINGS.enabled,
      thresholdDb: clamp(
        limiter?.thresholdDb ?? DEFAULT_LIMITER_SETTINGS.thresholdDb,
        -100,
        0,
        DEFAULT_LIMITER_SETTINGS.thresholdDb,
      ),
      kneeDb: clamp(
        limiter?.kneeDb ?? DEFAULT_LIMITER_SETTINGS.kneeDb,
        0,
        40,
        DEFAULT_LIMITER_SETTINGS.kneeDb,
      ),
      ratio: clamp(
        limiter?.ratio ?? DEFAULT_LIMITER_SETTINGS.ratio,
        1,
        60,
        DEFAULT_LIMITER_SETTINGS.ratio,
      ),
      attackMs: clamp(
        limiter?.attackMs ?? DEFAULT_LIMITER_SETTINGS.attackMs,
        0,
        1000,
        DEFAULT_LIMITER_SETTINGS.attackMs,
      ),
      releaseMs: clamp(
        limiter?.releaseMs ?? DEFAULT_LIMITER_SETTINGS.releaseMs,
        0,
        5000,
        DEFAULT_LIMITER_SETTINGS.releaseMs,
      ),
    },
  }
}

async function loadSettings(): Promise<PersistedSettings> {
  const stored = await chrome.storage.local.get(['autoBalanceSettings', 'limiterSettings'])
  return normalizeSettings(
    stored.autoBalanceSettings as Partial<PersistedSettings['autoBalance']> | undefined,
    stored.limiterSettings as Partial<LimiterSettings> | undefined,
  )
}

export function getSettings(): Promise<PersistedSettings> {
  cachedSettings ??= loadSettings()
  return cachedSettings
}

export function updateSettings(
  transform: (current: PersistedSettings) => PersistedSettings,
): Promise<PersistedSettings> {
  const write = writeQueue.then(async () => {
    const settings = transform(await getSettings())
    cachedSettings = Promise.resolve(settings)
    await chrome.storage.local.set({
      autoBalanceSettings: settings.autoBalance,
      limiterSettings: settings.limiter,
    })
    return settings
  })
  writeQueue = write.then(
    () => undefined,
    () => undefined,
  )
  return write
}

export function resetSettingsCache(): void {
  cachedSettings = null
}

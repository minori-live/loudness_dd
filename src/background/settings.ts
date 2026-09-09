import { normalizeLimiterSettings } from '@/audio/limiter-settings'
import {
  DEFAULT_AUTO_BALANCE_SETTINGS,
  DEFAULT_AUTO_FOCUS_SETTINGS,
  MAX_FOCUS_ATTENUATION_DB,
  MIN_FOCUS_ATTENUATION_DB,
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
  autoFocus?: Partial<PersistedSettings['autoFocus']>,
): PersistedSettings {
  return {
    autoBalance: {
      targetLufs: clamp(
        autoBalance?.targetLufs ?? DEFAULT_AUTO_BALANCE_SETTINGS.targetLufs,
        -60,
        0,
        DEFAULT_AUTO_BALANCE_SETTINGS.targetLufs,
      ),
    },
    autoFocus: {
      enabled:
        typeof autoFocus?.enabled === 'boolean'
          ? autoFocus.enabled
          : DEFAULT_AUTO_FOCUS_SETTINGS.enabled,
      attenuationDb: clamp(
        autoFocus?.attenuationDb ?? DEFAULT_AUTO_FOCUS_SETTINGS.attenuationDb,
        MIN_FOCUS_ATTENUATION_DB,
        MAX_FOCUS_ATTENUATION_DB,
        DEFAULT_AUTO_FOCUS_SETTINGS.attenuationDb,
      ),
    },
    limiter: normalizeLimiterSettings(limiter),
  }
}

async function loadSettings(): Promise<PersistedSettings> {
  const stored = await chrome.storage.local.get([
    'autoBalanceSettings',
    'autoFocusSettings',
    'limiterSettings',
  ])
  return normalizeSettings(
    stored.autoBalanceSettings as Partial<PersistedSettings['autoBalance']> | undefined,
    stored.limiterSettings as Partial<LimiterSettings> | undefined,
    stored.autoFocusSettings as Partial<PersistedSettings['autoFocus']> | undefined,
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
      autoFocusSettings: settings.autoFocus,
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

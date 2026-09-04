import {
  DEFAULT_MAX_GAIN_DB,
  GAIN_CHANGE_EPSILON_DB,
  MIN_BLOCKS_FOR_RELIABLE_LUFS,
  MIN_GAIN_DB,
  type SessionSnapshot,
  type TabLufs,
} from '@/protocol'

export interface SessionTabState {
  tabId: number
  title: string
  url: string
  currentLufs: TabLufs
  gainDb: number
  maxGainDb: number
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

export class SessionState<T extends SessionTabState = SessionTabState> {
  readonly #tabs = new Map<number, T>()
  #soloTabId: number | null = null

  get size(): number {
    return this.#tabs.size
  }

  get soloTabId(): number | null {
    return this.#soloTabId
  }

  get(tabId: number): T | undefined {
    return this.#tabs.get(tabId)
  }

  values(): IterableIterator<T> {
    return this.#tabs.values()
  }

  add(tab: T): void {
    this.#tabs.set(tab.tabId, tab)
  }

  remove(tabId: number): T | undefined {
    const tab = this.#tabs.get(tabId)
    if (!tab) return undefined

    this.#tabs.delete(tabId)
    if (this.#soloTabId === tabId) this.#soloTabId = null
    return tab
  }

  updateMetadata(tabId: number, metadata: { title?: string; url?: string }): boolean {
    const tab = this.#tabs.get(tabId)
    if (!tab) return false
    if (metadata.title) tab.title = metadata.title
    if (metadata.url) tab.url = metadata.url
    return true
  }

  updateLufs(tabId: number, lufs: TabLufs): boolean {
    const tab = this.#tabs.get(tabId)
    if (!tab) return false
    tab.currentLufs = lufs
    return true
  }

  setGain(tabId: number, gainDb: number): number | undefined {
    const tab = this.#tabs.get(tabId)
    if (!tab) return undefined

    const nextGain = Number.isFinite(gainDb)
      ? clamp(gainDb, MIN_GAIN_DB, tab.maxGainDb)
      : tab.gainDb
    if (Math.abs(tab.gainDb - nextGain) < GAIN_CHANGE_EPSILON_DB) return tab.gainDb
    tab.gainDb = nextGain
    return nextGain
  }

  setMaxGain(tabId: number, maxGainDb: number): number | undefined {
    const tab = this.#tabs.get(tabId)
    if (!tab) return undefined

    tab.maxGainDb = Number.isFinite(maxGainDb) ? clamp(maxGainDb, -20, 20) : tab.maxGainDb
    tab.gainDb = clamp(tab.gainDb, MIN_GAIN_DB, tab.maxGainDb)
    return tab.gainDb
  }

  toggleSolo(tabId: number): boolean {
    if (!this.#tabs.has(tabId)) return false
    this.#soloTabId = this.#soloTabId === tabId ? null : tabId
    return true
  }

  clearSolo(): void {
    this.#soloTabId = null
  }

  isMuted(tabId: number): boolean {
    return this.#soloTabId !== null && this.#soloTabId !== tabId
  }

  autoBalance(tabId: number, targetLufs: number): number | undefined {
    const tab = this.#tabs.get(tabId)
    if (!tab || tab.currentLufs.blockCount < MIN_BLOCKS_FOR_RELIABLE_LUFS) return undefined
    if (!Number.isFinite(tab.currentLufs.integrated)) return undefined
    return this.setGain(tabId, targetLufs - tab.currentLufs.integrated)
  }

  snapshot(): SessionSnapshot {
    return {
      tabs: Array.from(this.#tabs.values(), (tab) => ({
        tabId: tab.tabId,
        title: tab.title,
        url: tab.url,
        isCapturing: true,
        currentLufs: { ...tab.currentLufs },
        gainDb: tab.gainDb,
        maxGainDb: tab.maxGainDb,
        isSolo: this.#soloTabId === tab.tabId,
      })),
      soloTabId: this.#soloTabId,
    }
  }
}

export function createSessionTab(tabId: number, title: string, url: string): SessionTabState {
  return {
    tabId,
    title,
    url,
    currentLufs: {
      momentary: -Infinity,
      shortTerm: -Infinity,
      integrated: -Infinity,
      blockCount: 0,
    },
    gainDb: 0,
    maxGainDb: DEFAULT_MAX_GAIN_DB,
  }
}

import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { describe, it, expect, vi, beforeEach } from 'vitest'

import App from '../App.vue'
import { i18n } from '../i18n'

vi.mock('@/stores/tabs', () => {
  return {
    useTabsStore: () => ({
      // state/computed used by App.vue and TabList.vue
      isLoading: false,
      error: null,
      hasCaptures: false,
      tabs: [],
      targetLufs: -14,
      soloTabId: null,
      hasSolo: false,
      // actions used by App.vue
      registerCurrentTab: vi.fn(async () => {}),
      clearError: vi.fn(() => {}),
      startSync: vi.fn(async () => {}),
      stopSync: vi.fn(() => {}),
      // actions used by TabList.vue
      setGain: vi.fn(async () => {}),
      setMaxGain: vi.fn(async () => {}),
      unregisterTab: vi.fn(async () => {}),
      resetLufs: vi.fn(async () => {}),
      toggleSolo: vi.fn(async () => {}),
    }),
  }
})

vi.mock('@/stores/settings', () => {
  return {
    useSettingsStore: () => ({
      locale: 'en',
      setLocale: vi.fn(),
    }),
  }
})

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
  })

  it('mounts and renders the header title', () => {
    const wrapper = mount(App, {
      global: {
        plugins: [i18n],
      },
    })
    expect(wrapper.text()).toContain('Loudness DD')
  })
})

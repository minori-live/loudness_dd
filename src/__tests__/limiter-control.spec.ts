import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import Limiter from '@/components/Limiter.vue'
import { i18n } from '@/i18n'
import { DEFAULT_LIMITER_SETTINGS } from '@/protocol'
import { useTabsStore } from '@/stores/tabs'

describe('limiter controls', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    i18n.global.locale.value = 'en'
    vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn(async () => ({ success: true })) } })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('keeps all four controls editable regardless of the processing switch', async () => {
    const wrapper = mount(Limiter, { global: { plugins: [i18n] } })
    const disclosure = wrapper.get('button[aria-expanded]')
    expect(disclosure.attributes('aria-expanded')).toBe('false')
    expect(
      wrapper.findAll('input[type="range"]').map((input) => input.attributes('aria-label')),
    ).toEqual(['Threshold', 'Target'])
    await disclosure.trigger('click')
    expect(disclosure.attributes('aria-expanded')).toBe('true')
    const inputs = wrapper.findAll('input[type="range"]')
    expect(inputs.map((input) => input.attributes('aria-label'))).toEqual([
      'Threshold',
      'Target',
      'Release',
      'Knee softness',
    ])
    expect(inputs.map((input) => (input.element as HTMLInputElement).value)).toEqual([
      '-3',
      '-1',
      '100',
      '50',
    ])
    expect(inputs.every((input) => input.attributes('disabled') === undefined)).toBe(true)
    expect(wrapper.find('.pointer-events-none').exists()).toBe(false)
    await wrapper.get('[role="switch"]').trigger('click')
    expect(inputs.every((input) => input.attributes('disabled') === undefined)).toBe(true)
    await disclosure.trigger('click')
    expect(disclosure.attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('input[aria-label="Release"]').exists()).toBe(false)
    expect(wrapper.find('input[aria-label="Target"]').exists()).toBe(true)
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'SET_LIMITER_SETTINGS',
      settings: { ...DEFAULT_LIMITER_SETTINGS, enabled: true },
    })
    await wrapper.get('[role="switch"]').trigger('click')
    expect(inputs.every((input) => input.attributes('disabled') === undefined)).toBe(true)
    wrapper.unmount()
  })

  it.each([false, true])(
    'previews and saves all parameters with processing enabled=%s',
    async (enabled) => {
      vi.useFakeTimers()
      const store = useTabsStore()
      await store.setLimiterEnabled(enabled)
      const wrapper = mount(Limiter, { global: { plugins: [i18n] } })
      const target = wrapper.get('input[aria-label="Target"]')
      ;(target.element as HTMLInputElement).value = '-6'
      await target.trigger('input')
      await vi.advanceTimersByTimeAsync(50)
      expect(chrome.runtime.sendMessage).toHaveBeenLastCalledWith({
        type: 'SET_LIMITER_SETTINGS',
        persist: false,
        settings: { ...DEFAULT_LIMITER_SETTINGS, enabled, thresholdDb: -6, targetDb: -6 },
      })
      await target.trigger('change')
      await wrapper.get('input[aria-label="Threshold"]').setValue('-8')
      await wrapper.get('button[aria-expanded]').trigger('click')
      await wrapper.get('input[aria-label="Release"]').setValue('200')
      await wrapper.get('input[aria-label="Knee softness"]').setValue('75')
      expect(chrome.runtime.sendMessage).toHaveBeenLastCalledWith({
        type: 'SET_LIMITER_SETTINGS',
        settings: { enabled, thresholdDb: -8, targetDb: -6, releaseMs: 200, kneePercent: 75 },
      })
      expect(store.limiterSettings).toEqual({
        enabled,
        thresholdDb: -8,
        targetDb: -6,
        releaseMs: 200,
        kneePercent: 75,
      })
      await wrapper.get('button[aria-expanded]').trigger('click')
      await wrapper.get('button[aria-expanded]').trigger('click')
      expect((wrapper.get('input[aria-label="Release"]').element as HTMLInputElement).value).toBe(
        '200',
      )
      expect(
        (wrapper.get('input[aria-label="Knee softness"]').element as HTMLInputElement).value,
      ).toBe('75')
      wrapper.unmount()
    },
  )
})

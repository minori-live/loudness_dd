import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import UiButton from '@/components/ui/UiButton.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiRange from '@/components/ui/UiRange.vue'
import UiSwitch from '@/components/ui/UiSwitch.vue'

describe('UI primitives', () => {
  it('renders buttons with safe native defaults and forwards clicks', async () => {
    const wrapper = mount(UiButton, {
      slots: { default: 'Apply' },
    })

    await wrapper.trigger('click')

    expect(wrapper.element.tagName).toBe('BUTTON')
    expect(wrapper.attributes('type')).toBe('button')
    expect(wrapper.emitted('click')).toHaveLength(1)
  })

  it('exposes switch state and emits the next state', async () => {
    const wrapper = mount(UiSwitch, {
      props: { checked: false, label: 'Off' },
    })

    expect(wrapper.attributes('role')).toBe('switch')
    expect(wrapper.attributes('aria-checked')).toBe('false')

    await wrapper.trigger('click')
    expect(wrapper.emitted('toggle')).toEqual([[true]])
  })

  it('normalizes native range input values to numbers', async () => {
    const wrapper = mount(UiRange, {
      props: { value: -14 },
      attrs: { min: -60, max: 0 },
    })
    const input = wrapper.get('input')

    await input.setValue('-18')

    expect(wrapper.emitted('input')).toEqual([[-18]])
  })

  it('renders cards with the requested semantic element', () => {
    const wrapper = mount(UiCard, {
      props: { as: 'section', tone: 'subtle' },
      slots: { default: 'Settings' },
    })

    expect(wrapper.element.tagName).toBe('SECTION')
    expect(wrapper.text()).toBe('Settings')
    expect(wrapper.classes()).toContain('shrink-0')
  })
})

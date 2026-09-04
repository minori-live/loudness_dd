import { describe, expect, it } from 'vitest'

import { createSessionTab, SessionState } from '@/audio/session-state'

describe('SessionState', () => {
  it('keeps the user gain while solo changes the effective mute state', () => {
    const state = new SessionState()
    state.add(createSessionTab(1, 'One', 'https://one.example'))
    state.add(createSessionTab(2, 'Two', 'https://two.example'))
    state.setGain(2, -8)

    expect(state.toggleSolo(1)).toBe(true)
    expect(state.isMuted(1)).toBe(false)
    expect(state.isMuted(2)).toBe(true)
    expect(state.get(2)?.gainDb).toBe(-8)

    state.clearSolo()
    expect(state.isMuted(2)).toBe(false)
    expect(state.get(2)?.gainDb).toBe(-8)
  })

  it('clamps gain and max gain without losing the base gain model', () => {
    const state = new SessionState()
    state.add(createSessionTab(1, 'One', 'https://one.example'))

    expect(state.setMaxGain(1, 6)).toBe(0)
    expect(state.setGain(1, 12)).toBe(6)
    expect(state.setMaxGain(1, -3)).toBe(-3)
    expect(state.get(1)).toMatchObject({ gainDb: -3, maxGainDb: -3 })
    expect(state.setGain(1, Number.NaN)).toBe(-3)
    expect(state.setMaxGain(1, Number.POSITIVE_INFINITY)).toBe(-3)
  })

  it('adds a -12 dB offset to other tabs while preserving their base gain', () => {
    const state = new SessionState()
    state.add(createSessionTab(1, 'One', 'https://one.example'))
    state.add(createSessionTab(2, 'Two', 'https://two.example'))
    state.setGain(2, -8)

    expect(state.toggleFocus(1)).toBe(true)
    expect(state.gainOffsetDb(1)).toBe(0)
    expect(state.gainOffsetDb(2)).toBe(-12)
    expect(state.get(2)?.gainDb).toBe(-8)
    expect(state.snapshot()).toMatchObject({ focusTabId: 1, soloTabId: null })

    state.clearFocus()
    expect(state.gainOffsetDb(2)).toBe(0)
    expect(state.get(2)?.gainDb).toBe(-8)
  })

  it('keeps solo and focus mutually exclusive', () => {
    const state = new SessionState()
    state.add(createSessionTab(1, 'One', 'https://one.example'))
    state.add(createSessionTab(2, 'Two', 'https://two.example'))

    state.toggleFocus(1)
    state.toggleSolo(2)
    expect(state.focusTabId).toBeNull()
    expect(state.soloTabId).toBe(2)

    state.setFocus(1)
    expect(state.focusTabId).toBe(1)
    expect(state.soloTabId).toBeNull()
  })

  it('balances only after enough reliable LUFS blocks exist', () => {
    const state = new SessionState()
    state.add(createSessionTab(1, 'One', 'https://one.example'))

    state.updateLufs(1, { momentary: -20, shortTerm: -20, integrated: -20, blockCount: 9 })
    expect(state.autoBalance(1, -14)).toBeUndefined()
    expect(state.get(1)?.gainDb).toBe(0)

    state.updateLufs(1, { momentary: -20, shortTerm: -20, integrated: -20, blockCount: 10 })
    expect(state.autoBalance(1, -14)).toBe(0)

    state.setMaxGain(1, 10)
    expect(state.autoBalance(1, -14)).toBe(6)
  })

  it('clears solo or focus when its target tab is removed', () => {
    const state = new SessionState()
    state.add(createSessionTab(1, 'One', 'https://one.example'))
    state.add(createSessionTab(2, 'Two', 'https://two.example'))
    state.toggleSolo(1)

    state.remove(1)

    expect(state.soloTabId).toBeNull()
    expect(state.isMuted(2)).toBe(false)

    state.add(createSessionTab(1, 'One', 'https://one.example'))
    state.toggleFocus(1)
    state.remove(1)
    expect(state.focusTabId).toBeNull()
    expect(state.gainOffsetDb(2)).toBe(0)
  })
})

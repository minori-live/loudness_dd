<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'

import { useTabsStore, type CapturedTab, hasEnoughSamples } from '@/stores/tabs'

import LufsMeter from './LufsMeter.vue'

const tabsStore = useTabsStore()
const { t } = useI18n()

const collapsedIds = shallowRef<Set<number>>(new Set())

function isCollapsed(tabId: number): boolean {
  return collapsedIds.value.has(tabId)
}

function toggleCollapsed(tabId: number): void {
  const set = new Set(collapsedIds.value)
  if (set.has(tabId)) {
    set.delete(tabId)
  } else {
    set.add(tabId)
  }
  collapsedIds.value = set
}

function formatGain(gainDb: number): string {
  const prefix = gainDb >= 0 ? '+' : ''
  return `${prefix}${gainDb.toFixed(1)} dB`
}

function getFaviconUrl(url: string): string {
  try {
    const urlObj = new URL(url)
    return `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=32`
  } catch {
    return ''
  }
}

function truncateTitle(title: string, maxLength = 30): string {
  if (title.length <= maxLength) return title
  return title.substring(0, maxLength - 3) + '...'
}

async function handleGainChange(tab: CapturedTab, event: Event): Promise<void> {
  const target = event.target as HTMLInputElement
  const gainDb = parseFloat(target.value)
  await tabsStore.setGain(tab.tabId, gainDb)
}

async function handleMaxGainChange(tab: CapturedTab, event: Event): Promise<void> {
  const target = event.target as HTMLInputElement
  const maxGainDb = parseFloat(target.value)
  await tabsStore.setMaxGain(tab.tabId, maxGainDb)
}

async function handleRemove(tab: CapturedTab): Promise<void> {
  await tabsStore.unregisterTab(tab.tabId)
}

async function handleResetLufs(tab: CapturedTab): Promise<void> {
  await tabsStore.resetLufs(tab.tabId)
}

async function handleSolo(tab: CapturedTab): Promise<void> {
  await tabsStore.toggleSolo(tab.tabId)
}

async function handleFocus(tab: CapturedTab): Promise<void> {
  await tabsStore.toggleFocus(tab.tabId)
}

async function handleAutoFocusToggle(): Promise<void> {
  await tabsStore.setAutoFocusEnabled(!isAutoFocusEnabled.value)
}

const tabs = computed(() => tabsStore.tabs)
const targetLufs = computed(() => tabsStore.targetLufs)
const soloTabId = computed(() => tabsStore.soloTabId)
const hasSolo = computed(() => tabsStore.hasSolo)
const focusTabId = computed(() => tabsStore.focusTabId)
const hasFocus = computed(() => tabsStore.hasFocus)
const isAutoFocusEnabled = computed(() => tabsStore.isAutoFocusEnabled)
</script>

<template>
  <div class="tab-list">
    <div v-if="tabs.length === 0" class="empty-state">
      <div class="empty-icon">🔇</div>
      <p>{{ t('tabs.empty.title') }}</p>
      <p class="empty-hint">{{ t('tabs.empty.hint') }}</p>
    </div>

    <div v-else class="focus-toolbar">
      <div>
        <div class="focus-toolbar-title">{{ t('tabs.autoFocus.title') }}</div>
        <div class="focus-toolbar-description">{{ t('tabs.autoFocus.description') }}</div>
      </div>
      <button
        type="button"
        class="toggle-control"
        :class="{ 'is-active': isAutoFocusEnabled }"
        role="switch"
        :aria-checked="isAutoFocusEnabled"
        @click="handleAutoFocusToggle"
      >
        <span class="toggle-track"><span class="toggle-thumb"></span></span>
        <span class="toggle-label">{{
          isAutoFocusEnabled ? t('tabs.autoFocus.on') : t('tabs.autoFocus.off')
        }}</span>
      </button>
    </div>

    <TransitionGroup name="tab-item" tag="div" class="tabs-container">
      <div
        v-for="tab in tabs"
        :key="tab.tabId"
        class="tab-item"
        :class="{
          'is-solo': soloTabId === tab.tabId,
          'is-muted': hasSolo && soloTabId !== tab.tabId,
          'is-focused': focusTabId === tab.tabId,
          'is-ducked': hasFocus && focusTabId !== tab.tabId,
          'is-collapsed': isCollapsed(tab.tabId),
        }"
      >
        <div class="tab-header" @click.stop="toggleCollapsed(tab.tabId)">
          <img
            v-if="tab.url"
            :src="getFaviconUrl(tab.url)"
            alt=""
            class="tab-favicon"
            @error="($event.target as HTMLImageElement).style.display = 'none'"
          />
          <span class="tab-title" :title="tab.title">{{ truncateTitle(tab.title) }}</span>
          <div class="tab-actions">
            <button
              class="action-btn solo-btn"
              :class="{ active: soloTabId === tab.tabId }"
              :title="
                soloTabId === tab.tabId ? t('tabs.actions.solo.on') : t('tabs.actions.solo.off')
              "
              @click.stop="handleSolo(tab)"
            >
              S
            </button>
            <button
              class="action-btn focus-btn"
              :class="{ active: focusTabId === tab.tabId }"
              :title="
                focusTabId === tab.tabId ? t('tabs.actions.focus.on') : t('tabs.actions.focus.off')
              "
              @click.stop="handleFocus(tab)"
            >
              F
            </button>
            <button
              class="action-btn reset-btn"
              :title="t('tabs.actions.reset')"
              @click.stop="handleResetLufs(tab)"
            >
              ↺
            </button>
            <button
              class="action-btn remove-btn"
              :title="t('tabs.actions.stop')"
              @click.stop="handleRemove(tab)"
            >
              ✕
            </button>
          </div>
        </div>

        <div class="collapsible-content">
          <div class="meter-wrapper" @click="isCollapsed(tab.tabId) && toggleCollapsed(tab.tabId)">
            <LufsMeter
              :momentary="tab.currentLufs.momentary"
              :short-term="tab.currentLufs.shortTerm"
              :integrated="tab.currentLufs.integrated"
              :block-count="tab.currentLufs.blockCount"
              :target-lufs="targetLufs"
              :show-labels="!isCollapsed(tab.tabId)"
              :compact="isCollapsed(tab.tabId)"
            />
          </div>

          <div class="volume-control" :class="{ 'is-collapsed': isCollapsed(tab.tabId) }">
            <label class="volume-label">
              <span class="volume-icon">🔊</span>
              <span class="gain-value">{{ formatGain(tab.gainDb) }}</span>
            </label>
            <div class="slider-container">
              <span v-if="!isCollapsed(tab.tabId)" class="slider-min">-20</span>
              <input
                type="range"
                class="volume-slider"
                min="-20"
                :max="tab.maxGainDb"
                step="0.5"
                :value="tab.gainDb"
                @input="handleGainChange(tab, $event)"
              />
              <span v-if="!isCollapsed(tab.tabId)" class="slider-max">{{
                formatGain(tab.maxGainDb)
              }}</span>
            </div>
            <div v-if="!isCollapsed(tab.tabId)" class="max-gain-control">
              <label class="max-gain-label">
                <span>{{ t('tabs.maxBoost') }}</span>
                <select
                  class="max-gain-select"
                  :value="tab.maxGainDb"
                  @change="handleMaxGainChange(tab, $event)"
                >
                  <option :value="-6">-6 dB</option>
                  <option :value="0">0 dB (default)</option>
                  <option :value="3">+3 dB</option>
                  <option :value="6">+6 dB</option>
                  <option :value="9">+9 dB</option>
                  <option :value="12">+12 dB</option>
                  <option :value="15">+15 dB</option>
                  <option :value="18">+18 dB</option>
                  <option :value="20">+20 dB</option>
                </select>
              </label>
            </div>
          </div>

          <div
            v-if="!isCollapsed(tab.tabId)"
            class="tab-status"
            :class="{ capturing: tab.isCapturing, collecting: !hasEnoughSamples(tab.currentLufs) }"
          >
            <span class="status-dot"></span>
            <span v-if="tab.isCapturing && !hasEnoughSamples(tab.currentLufs)" class="status-text">
              {{ t('tabs.status.collecting') }}
            </span>
            <span v-else-if="tab.isCapturing" class="status-text">
              {{ t('tabs.status.ready') }}
            </span>
            <span v-else class="status-text">{{ t('tabs.status.paused') }}</span>
          </div>
        </div>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.tab-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.focus-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 12px;
  border: 1px solid rgba(99, 179, 237, 0.18);
  border-radius: 8px;
  background: rgba(66, 153, 225, 0.06);
}

.focus-toolbar-title {
  color: #bee3f8;
  font-size: 12px;
  font-weight: 600;
}

.focus-toolbar-description {
  color: #718096;
  font-size: 10px;
}

.toggle-control {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 2px;
  border: 0;
  background: transparent;
  color: #a0aec0;
  cursor: pointer;
  font-family: inherit;
  font-size: 10px;
  white-space: nowrap;
}

.toggle-track {
  width: 30px;
  height: 16px;
  padding: 2px;
  border-radius: 999px;
  background: #4a5568;
  transition: background 0.15s ease;
}

.toggle-thumb {
  display: block;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #e2e8f0;
  transition: transform 0.15s ease;
}

.toggle-control.is-active .toggle-track {
  background: #4299e1;
}

.toggle-control.is-active .toggle-thumb {
  transform: translateX(14px);
}

.toggle-control:focus-visible {
  outline: 2px solid #90cdf4;
  outline-offset: 2px;
  border-radius: 4px;
}

.empty-state {
  text-align: center;
  padding: 32px 16px;
  color: #718096;
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 12px;
  opacity: 0.5;
}

.empty-state p {
  margin: 0;
  font-size: 14px;
}

.empty-hint {
  margin-top: 8px !important;
  font-size: 12px !important;
  opacity: 0.7;
}

.tabs-container {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.tab-item {
  background: linear-gradient(145deg, #1e1e2f 0%, #252538 100%);
  border-radius: 10px;
  padding: 12px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  box-shadow:
    0 4px 12px rgba(0, 0, 0, 0.3),
    inset 0 1px 0 rgba(255, 255, 255, 0.05);
  min-width: 0;
}

.collapsible-content {
  overflow: hidden;
  max-height: 500px;
  transition: max-height 0.3s ease;
}

.tab-item.is-collapsed .collapsible-content {
  max-height: 120px; /* compact meter + slim gain row */
}

.tab-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  cursor: pointer;
  user-select: none;
}

.tab-favicon {
  width: 16px;
  height: 16px;
  border-radius: 2px;
}

.tab-title {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
  color: #e2e8f0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tab-item.is-collapsed .meter-wrapper {
  cursor: pointer;
}

.tab-actions {
  display: flex;
  gap: 4px;
}

.action-btn {
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.05);
  color: #a0aec0;
  cursor: pointer;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}

.action-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #e2e8f0;
}

.remove-btn:hover {
  background: rgba(245, 101, 101, 0.2);
  color: #f56565;
}

.reset-btn:hover {
  background: rgba(66, 153, 225, 0.2);
  color: #4299e1;
}

.solo-btn {
  font-weight: 700;
  font-size: 11px;
}

.solo-btn:hover {
  background: rgba(237, 137, 54, 0.2);
  color: #ed8936;
}

.solo-btn.active {
  background: #ed8936;
  color: #1a1a2e;
  box-shadow: 0 0 8px rgba(237, 137, 54, 0.5);
}

.solo-btn.active:hover {
  background: #dd7824;
}

.focus-btn {
  color: #90cdf4;
  font-size: 11px;
  font-weight: 700;
}

.focus-btn:hover {
  background: rgba(66, 153, 225, 0.2);
  color: #63b3ed;
}

.focus-btn.active {
  background: #4299e1;
  color: #1a1a2e;
  box-shadow: 0 0 8px rgba(66, 153, 225, 0.5);
}

.focus-btn.active:hover {
  background: #3182ce;
}

/* Solo/Muted states for tab items */
.tab-item.is-solo {
  border-color: rgba(237, 137, 54, 0.4);
  box-shadow:
    0 4px 12px rgba(0, 0, 0, 0.3),
    0 0 0 1px rgba(237, 137, 54, 0.3),
    inset 0 1px 0 rgba(255, 255, 255, 0.05);
}

.tab-item.is-muted {
  opacity: 0.5;
}

.tab-item.is-muted .tab-title::after {
  content: ' (muted)';
  color: #f56565;
  font-size: 10px;
  font-weight: 400;
}

.tab-item.is-focused {
  border-color: rgba(66, 153, 225, 0.5);
  box-shadow:
    0 4px 12px rgba(0, 0, 0, 0.3),
    0 0 0 1px rgba(66, 153, 225, 0.35),
    inset 0 1px 0 rgba(255, 255, 255, 0.05);
}

.tab-item.is-ducked {
  opacity: 0.72;
}

.tab-item.is-ducked .tab-title::after {
  content: ' (-12 dB)';
  color: #63b3ed;
  font-size: 10px;
  font-weight: 400;
}

.volume-control {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.volume-label {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  font-size: 11px;
  color: #718096;
}

.volume-icon {
  font-size: 14px;
}

.gain-value {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  color: #a0aec0;
  min-width: 60px;
}

.slider-container {
  display: flex;
  align-items: center;
  gap: 8px;
}

.slider-min,
.slider-max {
  font-size: 9px;
  color: #4a5568;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  width: 24px;
}

.slider-max {
  text-align: right;
  min-width: 50px;
}

.max-gain-control {
  margin-top: 8px;
  display: flex;
  justify-content: flex-end;
}

.max-gain-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  color: #718096;
}

.max-gain-select {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  color: #a0aec0;
  font-size: 10px;
  padding: 3px 6px;
  cursor: pointer;
  outline: none;
  transition: all 0.15s ease;
}

.max-gain-select:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.15);
}

.max-gain-select:focus {
  border-color: #4299e1;
  box-shadow: 0 0 0 2px rgba(66, 153, 225, 0.2);
}

.volume-control.is-collapsed {
  margin-top: 6px;
  padding-top: 6px;
}

.volume-control.is-collapsed .volume-label {
  margin-bottom: 4px;
}

.volume-control.is-collapsed .volume-icon {
  display: none;
}

.max-gain-select option {
  background: #1e1e2f;
  color: #e2e8f0;
}

.volume-slider {
  flex: 1;
  height: 6px;
  -webkit-appearance: none;
  appearance: none;
  background: linear-gradient(to right, #4299e1, #48bb78, #ed8936, #f56565);
  border-radius: 3px;
  outline: none;
  cursor: pointer;
}

.volume-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  background: #e2e8f0;
  border-radius: 50%;
  cursor: pointer;
  box-shadow:
    0 2px 6px rgba(0, 0, 0, 0.3),
    0 0 0 2px rgba(255, 255, 255, 0.1);
  transition: transform 0.1s ease;
}

.volume-slider::-webkit-slider-thumb:hover {
  transform: scale(1.1);
}

.volume-slider::-webkit-slider-thumb:active {
  transform: scale(0.95);
}

.tab-status {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  font-size: 10px;
  color: #718096;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #718096;
}

.tab-status.capturing .status-dot {
  background: #48bb78;
  box-shadow: 0 0 8px #48bb78;
  animation: pulse 2s infinite;
}

.tab-status.collecting .status-dot {
  background: #ed8936;
  box-shadow: 0 0 8px #ed8936;
  animation: pulse 1s infinite;
}

.tab-status.collecting {
  color: #ed8936;
}

.status-text {
  white-space: nowrap;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

/* Transitions */
.tab-item-enter-active,
.tab-item-leave-active {
  transition: all 0.3s ease;
}

.tab-item-enter-from {
  opacity: 0;
  transform: translateY(-10px);
}

.tab-item-leave-to {
  opacity: 0;
  transform: translateX(20px);
}

.tab-item-move {
  transition: transform 0.3s ease;
}
</style>

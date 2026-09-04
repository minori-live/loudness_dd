<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useTabsStore } from '@/stores/tabs'

const tabsStore = useTabsStore()
const { t } = useI18n()

const targetLufs = computed(() => tabsStore.targetLufs)
const averageLufs = computed(() => tabsStore.averageLufs)

function formatLufs(lufs: number): string {
  if (!isFinite(lufs)) return '-∞'
  return lufs.toFixed(1)
}

async function handleTargetChange(event: Event): Promise<void> {
  const target = event.target as HTMLInputElement
  const value = parseFloat(target.value)
  if (!isNaN(value)) {
    await tabsStore.setTargetLufs(value)
  }
}

const presets = [
  { key: 'broadcast', value: -24 },
  { key: 'streaming', value: -14 },
  { key: 'podcast', value: -16 },
  { key: 'loud', value: -9 },
]

async function applyPreset(value: number): Promise<void> {
  await tabsStore.setTargetLufs(value)
}
</script>

<template>
  <div class="auto-balance">
    <div class="section-header">
      <h3>{{ t('autobalance.title') }}</h3>
      <div class="average-lufs">
        <span class="label">{{ t('autobalance.avg') }}</span>
        <span class="value">{{ formatLufs(averageLufs) }} LUFS</span>
      </div>
    </div>

    <!-- Target LUFS Control -->
    <div class="target-control">
      <label class="control-label">
        <span>{{ t('autobalance.target') }}</span>
        <span class="target-value">{{ targetLufs }} LUFS</span>
      </label>

      <div class="slider-row">
        <span class="slider-label">-60</span>
        <input
          type="range"
          class="target-slider"
          min="-60"
          max="0"
          step="1"
          :value="targetLufs"
          @input="handleTargetChange"
        />
        <span class="slider-label">0</span>
      </div>

      <!-- Presets -->
      <div class="presets">
        <button
          v-for="preset in presets"
          :key="preset.value"
          class="preset-btn"
          :class="{ active: targetLufs === preset.value }"
          @click="applyPreset(preset.value)"
        >
          {{ t(`autobalance.presets.${preset.key}`) }}
          <span class="preset-value">{{ preset.value }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.auto-balance {
  background: linear-gradient(145deg, #1a1a2e 0%, #16213e 100%);
  border-radius: 10px;
  padding: 14px;
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
}

.section-header h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #e2e8f0;
}

.average-lufs {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
}

.average-lufs .label {
  color: #718096;
}

.average-lufs .value {
  color: #4299e1;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-weight: 500;
}

.target-control {
  margin-bottom: 14px;
}

.control-label {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: #a0aec0;
  margin-bottom: 8px;
}

.target-value {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  color: #ffd700;
  font-weight: 600;
}

.slider-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.slider-label {
  font-size: 9px;
  color: #4a5568;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  width: 20px;
}

.slider-label:last-child {
  text-align: right;
}

.target-slider {
  flex: 1;
  height: 8px;
  -webkit-appearance: none;
  appearance: none;
  background: linear-gradient(to right, #2d3748, #4a5568);
  border-radius: 4px;
  outline: none;
  cursor: pointer;
}

.target-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 18px;
  height: 18px;
  background: linear-gradient(145deg, #ffd700, #ffaa00);
  border-radius: 50%;
  cursor: pointer;
  box-shadow:
    0 2px 8px rgba(255, 215, 0, 0.4),
    0 0 0 2px rgba(255, 255, 255, 0.1);
  transition: transform 0.1s ease;
}

.target-slider::-webkit-slider-thumb:hover {
  transform: scale(1.1);
}

.presets {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.preset-btn {
  flex: 1;
  min-width: 70px;
  padding: 6px 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.03);
  color: #a0aec0;
  font-size: 10px;
  cursor: pointer;
  transition: all 0.15s ease;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.preset-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.2);
  color: #e2e8f0;
}

.preset-btn.active {
  background: rgba(255, 215, 0, 0.15);
  border-color: rgba(255, 215, 0, 0.4);
  color: #ffd700;
}

.preset-value {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 9px;
  opacity: 0.7;
}
</style>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useTabsStore } from '@/stores/tabs'

import UiButton from './ui/UiButton.vue'
import UiCard from './ui/UiCard.vue'
import UiRange from './ui/UiRange.vue'

const tabsStore = useTabsStore()
const { t } = useI18n()

const targetLufs = computed(() => tabsStore.targetLufs)
const averageLufs = computed(() => tabsStore.averageLufs)

function formatLufs(lufs: number): string {
  if (!isFinite(lufs)) return '-∞'
  return lufs.toFixed(1)
}

function handleTargetPreview(value: number): void {
  tabsStore.previewTargetLufs(value)
}

async function handleTargetChange(value: number): Promise<void> {
  await tabsStore.setTargetLufs(value)
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
  <UiCard tone="balance" as="section">
    <div class="mb-3.5 flex items-center justify-between">
      <h3 class="ui-section-title">{{ t('autobalance.title') }}</h3>
      <div class="flex items-center gap-1.5 text-[11px]">
        <span class="text-subtle">{{ t('autobalance.avg') }}</span>
        <span class="ui-data font-500 text-focus">{{ formatLufs(averageLufs) }} LUFS</span>
      </div>
    </div>

    <div>
      <label class="ui-control-label">
        <span>{{ t('autobalance.target') }}</span>
        <span class="ui-data font-600 text-target">{{ targetLufs }} LUFS</span>
      </label>

      <div class="mb-3 flex items-center gap-2.5">
        <span class="ui-slider-label">-60</span>
        <UiRange
          min="-60"
          max="0"
          step="1"
          :value="targetLufs"
          tone="target"
          @input="handleTargetPreview"
          @change="handleTargetChange"
        />
        <span class="ui-slider-label">0</span>
      </div>

      <div class="flex flex-wrap gap-1.5">
        <UiButton
          v-for="preset in presets"
          :key="preset.value"
          variant="preset"
          tone="target"
          :active="targetLufs === preset.value"
          @click="applyPreset(preset.value)"
        >
          {{ t(`autobalance.presets.${preset.key}`) }}
          <span class="ui-data text-[9px] opacity-70">{{ preset.value }}</span>
        </UiButton>
      </div>
    </div>
  </UiCard>
</template>

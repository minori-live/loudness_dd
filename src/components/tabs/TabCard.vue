<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'

import { type CapturedTab, hasEnoughSamples } from '@/stores/tabs'

import LufsMeter from '../LufsMeter.vue'
import UiButton from '../ui/UiButton.vue'
import UiCard from '../ui/UiCard.vue'
import UiRange from '../ui/UiRange.vue'
import UiSelect from '../ui/UiSelect.vue'

const props = defineProps<{
  tab: CapturedTab
  targetLufs: number
  solo: boolean
  muted: boolean
  focused: boolean
  ducked: boolean
}>()

const emit = defineEmits<{
  gain: [tabId: number, value: number]
  gainPreview: [tabId: number, value: number]
  maxGain: [tabId: number, value: number]
  remove: [tabId: number]
  reset: [tabId: number]
  solo: [tabId: number]
  focus: [tabId: number]
}>()

const { t } = useI18n()
const collapsed = shallowRef(false)

const cardClasses = computed(() => [
  'min-w-0 transition-all duration-200',
  props.solo && 'border-warning/55 shadow-[0_0_0_1px_rgba(237,137,54,0.12)]',
  props.focused && 'border-focus/55 shadow-[0_0_0_1px_rgba(66,153,225,0.12)]',
  props.muted && 'opacity-35',
  props.ducked && !props.muted && 'opacity-65',
])

const faviconUrl = computed(() => {
  try {
    return `https://www.google.com/s2/favicons?domain=${new URL(props.tab.url).hostname}&sz=32`
  } catch {
    return ''
  }
})

function formatGain(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)} dB`
}

function hideBrokenImage(event: Event): void {
  ;(event.target as HTMLImageElement).style.display = 'none'
}
</script>

<template>
  <UiCard as="article" tone="track" padding="sm" :class="cardClasses">
    <div
      class="mb-2.5 flex cursor-pointer select-none items-center gap-2"
      @click="collapsed = !collapsed"
    >
      <img
        v-if="faviconUrl"
        :src="faviconUrl"
        alt=""
        class="h-4 w-4 shrink-0 rounded-sm"
        @error="hideBrokenImage"
      />
      <span class="min-w-0 flex-1 truncate text-xs font-500" :title="tab.title">{{
        tab.title
      }}</span>
      <div class="flex gap-1" @click.stop>
        <UiButton
          variant="icon"
          tone="solo"
          :active="solo"
          :title="solo ? t('tabs.actions.solo.on') : t('tabs.actions.solo.off')"
          @click="emit('solo', tab.tabId)"
          >S</UiButton
        >
        <UiButton
          variant="icon"
          tone="focus"
          :active="focused"
          :title="focused ? t('tabs.actions.focus.on') : t('tabs.actions.focus.off')"
          @click="emit('focus', tab.tabId)"
          >F</UiButton
        >
        <UiButton variant="icon" :title="t('tabs.actions.reset')" @click="emit('reset', tab.tabId)"
          >↺</UiButton
        >
        <UiButton
          variant="icon"
          tone="danger"
          :title="t('tabs.actions.stop')"
          @click="emit('remove', tab.tabId)"
          >✕</UiButton
        >
      </div>
    </div>

    <div class="space-y-2">
      <div :class="collapsed && 'cursor-pointer'" @click="collapsed && (collapsed = false)">
        <LufsMeter
          :momentary="tab.currentLufs.momentary"
          :short-term="tab.currentLufs.shortTerm"
          :integrated="tab.currentLufs.integrated"
          :block-count="tab.currentLufs.blockCount"
          :target-lufs="targetLufs"
          :show-labels="!collapsed"
          :compact="collapsed"
        />
      </div>

      <div class="border-t border-t-solid border-white/6 pt-2" :class="collapsed && 'pt-1.5'">
        <label class="mb-1.5 flex items-center gap-2 text-[11px] text-subtle">
          <span v-if="!collapsed" aria-hidden="true">🔊</span>
          <span class="ui-data font-600 text-focus-light">{{ formatGain(tab.gainDb) }}</span>
        </label>
        <div class="flex items-center gap-2">
          <span v-if="!collapsed" class="ui-slider-label">-20</span>
          <UiRange
            :value="tab.gainDb"
            :min="-20"
            :max="tab.maxGainDb"
            :step="0.5"
            :compact="collapsed"
            tone="success"
            @input="emit('gainPreview', tab.tabId, $event)"
            @change="emit('gain', tab.tabId, $event)"
          />
          <span v-if="!collapsed" class="ui-slider-label">{{ formatGain(tab.maxGainDb) }}</span>
        </div>

        <label
          v-if="!collapsed"
          class="mt-2 flex items-center justify-between text-[10px] text-subtle"
        >
          <span>{{ t('tabs.maxBoost') }}</span>
          <UiSelect
            :value="tab.maxGainDb"
            @change="emit('maxGain', tab.tabId, Number(($event.target as HTMLSelectElement).value))"
          >
            <option v-for="value in [-6, 0, 3, 6, 9, 12, 15, 18, 20]" :key="value" :value="value">
              {{ value > 0 ? '+' : '' }}{{ value }} dB{{ value === 0 ? ' (default)' : '' }}
            </option>
          </UiSelect>
        </label>
      </div>

      <div
        v-if="!collapsed"
        class="flex items-center gap-1.5 text-[9px]"
        :class="tab.isCapturing ? 'text-success' : 'text-subtle'"
      >
        <span
          class="h-1.5 w-1.5 rounded-full"
          :class="tab.isCapturing ? 'animate-pulse bg-success' : 'bg-subtle'"
        />
        <span v-if="tab.isCapturing && !hasEnoughSamples(tab.currentLufs)">
          {{ t('tabs.status.collecting') }}
        </span>
        <span v-else-if="tab.isCapturing">{{ t('tabs.status.ready') }}</span>
        <span v-else>{{ t('tabs.status.paused') }}</span>
      </div>
    </div>
  </UiCard>
</template>

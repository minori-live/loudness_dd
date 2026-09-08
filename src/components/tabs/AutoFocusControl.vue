<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import UiCard from '../ui/UiCard.vue'
import UiRange from '../ui/UiRange.vue'
import UiSwitch from '../ui/UiSwitch.vue'

defineProps<{
  enabled: boolean
  attenuationDb: number
}>()

const emit = defineEmits<{
  toggle: [enabled: boolean]
  attenuation: [value: number]
  attenuationPreview: [value: number]
}>()

const { t } = useI18n()
</script>

<template>
  <UiCard tone="subtle" padding="sm" class="border-focus/18 bg-focus/6">
    <div class="flex items-center justify-between gap-4">
      <div>
        <div class="text-xs font-600 text-blue-200">{{ t('tabs.autoFocus.title') }}</div>
        <div class="text-[10px] text-subtle">{{ t('tabs.autoFocus.description') }}</div>
      </div>
      <UiSwitch
        :checked="enabled"
        :label="enabled ? t('tabs.autoFocus.on') : t('tabs.autoFocus.off')"
        @toggle="emit('toggle', $event)"
      />
    </div>

    <div class="mt-3 transition-opacity" :class="!enabled && 'opacity-45'">
      <label class="ui-control-label">
        <span>{{ t('tabs.autoFocus.attenuation') }}</span>
        <span class="ui-data font-600 text-focus-light">{{ attenuationDb }} dB</span>
      </label>
      <div class="flex items-center gap-2.5">
        <span class="ui-slider-label">-60</span>
        <UiRange
          :value="attenuationDb"
          :min="-60"
          :max="0"
          :step="1"
          :disabled="!enabled"
          :aria-label="t('tabs.autoFocus.attenuation')"
          tone="focus"
          @input="emit('attenuationPreview', $event)"
          @change="emit('attenuation', $event)"
        />
        <span class="ui-slider-label">0</span>
      </div>
    </div>
  </UiCard>
</template>

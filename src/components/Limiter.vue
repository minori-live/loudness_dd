<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useTabsStore } from '@/stores/tabs'

import LimiterParameter from './limiter/LimiterParameter.vue'
import UiCard from './ui/UiCard.vue'
import UiSwitch from './ui/UiSwitch.vue'

defineOptions({ name: 'LimiterControl' })

const tabsStore = useTabsStore()
const { t } = useI18n()

const isEnabled = computed(() => tabsStore.isLimiterEnabled)
const threshold = computed(() => tabsStore.limiterThreshold)
const target = computed(() => tabsStore.limiterTarget)
const release = computed(() => tabsStore.limiterRelease)
const knee = computed(() => tabsStore.limiterKnee)
</script>

<template>
  <UiCard as="section" tone="settings" class="shadow-[0_4px_12px_rgba(0,0,0,0.3)]">
    <div class="mb-2 flex items-center justify-between">
      <h3 class="ui-section-title flex items-center gap-2">
        <span aria-hidden="true">🛡️</span>
        <span>{{ t('limiter.title') }}</span>
      </h3>
      <UiSwitch
        :checked="isEnabled"
        :label="isEnabled ? t('limiter.on') : t('limiter.off')"
        :title="isEnabled ? t('limiter.tooltip.disable') : t('limiter.tooltip.enable')"
        tone="warning"
        @toggle="tabsStore.setLimiterEnabled($event)"
      />
    </div>

    <p class="mb-3 text-[10px] leading-4 text-subtle">{{ t('limiter.description') }}</p>

    <div
      class="space-y-2 transition-opacity"
      :class="!isEnabled && 'pointer-events-none opacity-45'"
    >
      <LimiterParameter
        :label="t('limiter.threshold')"
        :display-value="`${threshold.toFixed(1)} dB`"
        :value="threshold"
        :min="-60"
        :max="target"
        :step="0.1"
        :disabled="!isEnabled"
        tone="focus"
        :hint="t('limiter.hints.threshold')"
        @input="tabsStore.previewLimiter({ thresholdDb: $event })"
        @change="tabsStore.setLimiterThreshold($event)"
      />

      <LimiterParameter
        :label="t('limiter.target')"
        :display-value="`${target.toFixed(1)} dB`"
        :value="target"
        :min="-60"
        :max="-0.1"
        :step="0.1"
        :disabled="!isEnabled"
        tone="target"
        :hint="t('limiter.hints.target')"
        @input="tabsStore.previewLimiter({ targetDb: $event })"
        @change="tabsStore.setLimiterTarget($event)"
      />
      <LimiterParameter
        :label="t('limiter.release')"
        :display-value="`${release.toFixed(0)} ms`"
        :value="release"
        :min="10"
        :max="500"
        :step="5"
        :disabled="!isEnabled"
        tone="warning"
        :hint="t('limiter.hints.release')"
        @input="tabsStore.previewLimiter({ releaseMs: $event })"
        @change="tabsStore.setLimiterRelease($event)"
      />
      <LimiterParameter
        :label="t('limiter.knee')"
        :display-value="`${knee.toFixed(0)}%`"
        :value="knee"
        :min="0"
        :max="100"
        :step="5"
        :disabled="!isEnabled"
        tone="teal"
        :hint="t('limiter.hints.knee')"
        @input="tabsStore.previewLimiter({ kneePercent: $event })"
        @change="tabsStore.setLimiterKnee($event)"
      />
    </div>

    <div v-if="isEnabled" class="mt-3 flex items-center gap-1.5 text-[9px] text-success">
      <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
      <span>{{ t('limiter.active') }}</span>
    </div>
  </UiCard>
</template>

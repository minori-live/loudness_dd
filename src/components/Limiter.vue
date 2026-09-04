<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'

import { useTabsStore } from '@/stores/tabs'

import LimiterAdvanced from './limiter/LimiterAdvanced.vue'
import LimiterParameter from './limiter/LimiterParameter.vue'
import UiButton from './ui/UiButton.vue'
import UiCard from './ui/UiCard.vue'
import UiSwitch from './ui/UiSwitch.vue'

defineOptions({ name: 'LimiterControl' })

const tabsStore = useTabsStore()
const { t } = useI18n()
const showAdvanced = shallowRef(false)

const isEnabled = computed(() => tabsStore.isLimiterEnabled)
const threshold = computed(() => tabsStore.limiterThreshold)
const attack = computed(() => tabsStore.limiterAttack)
const release = computed(() => tabsStore.limiterRelease)
const knee = computed(() => tabsStore.limiterKnee)
const ratio = computed(() => tabsStore.limiterRatio)
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
        :label="t('limiter.ceiling')"
        :display-value="`${threshold.toFixed(1)} dB`"
        :value="threshold"
        :min="-6"
        :max="-0.1"
        :step="0.1"
        :disabled="!isEnabled"
        tone="focus"
        @input="tabsStore.setLimiterThreshold($event)"
      />

      <UiButton
        variant="disclosure"
        :disabled="!isEnabled"
        :aria-expanded="showAdvanced"
        @click="showAdvanced = !showAdvanced"
      >
        <span aria-hidden="true">{{ showAdvanced ? '▼' : '▶' }}</span>
        <span>{{ t('limiter.advanced') }}</span>
      </UiButton>

      <Transition name="limiter-slide">
        <LimiterAdvanced
          v-if="showAdvanced"
          :enabled="isEnabled"
          :ratio="ratio"
          :attack="attack"
          :release="release"
          :knee="knee"
          @ratio="tabsStore.setLimiterRatio($event)"
          @attack="tabsStore.setLimiterAttack($event)"
          @release="tabsStore.setLimiterRelease($event)"
          @knee="tabsStore.setLimiterKnee($event)"
        />
      </Transition>
    </div>

    <div v-if="isEnabled" class="mt-3 flex items-center gap-1.5 text-[9px] text-success">
      <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
      <span>{{ t('limiter.active') }}</span>
    </div>
  </UiCard>
</template>

<style scoped>
.limiter-slide-enter-active,
.limiter-slide-leave-active {
  transition:
    opacity 180ms ease,
    transform 180ms ease;
}

.limiter-slide-enter-from,
.limiter-slide-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>

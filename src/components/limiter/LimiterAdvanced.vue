<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import LimiterParameter from './LimiterParameter.vue'

const props = defineProps<{
  enabled: boolean
  ratio: number
  attack: number
  release: number
  knee: number
}>()

const emit = defineEmits<{
  ratio: [value: number]
  attack: [value: number]
  release: [value: number]
  knee: [value: number]
}>()

const { t } = useI18n()

const attackHint = computed(() => {
  if (props.attack <= 1) return t('limiter.hints.attack.fast')
  if (props.attack <= 10) return t('limiter.hints.attack.balanced')
  return t('limiter.hints.attack.slow')
})

const releaseHint = computed(() => {
  if (props.release <= 50) return t('limiter.hints.release.fast')
  if (props.release <= 150) return t('limiter.hints.release.balanced')
  return t('limiter.hints.release.slow')
})

const kneeHint = computed(() => {
  if (props.knee <= 1) return t('limiter.hints.knee.hard')
  if (props.knee <= 10) return t('limiter.hints.knee.soft')
  return t('limiter.hints.knee.verySoft')
})
</script>

<template>
  <div class="mt-2 space-y-3 border-t border-t-solid border-white/6 pt-3">
    <LimiterParameter
      :label="t('limiter.ratio')"
      :display-value="`${ratio.toFixed(0)}:1`"
      :value="ratio"
      :min="1"
      :max="60"
      :step="1"
      :disabled="!enabled"
      tone="violet"
      @input="emit('ratio', $event)"
    />
    <LimiterParameter
      :label="t('limiter.attack')"
      :display-value="`${attack.toFixed(1)} ms`"
      :value="attack"
      :min="0.1"
      :max="50"
      :step="0.1"
      :disabled="!enabled"
      tone="success"
      :hint="attackHint"
      @input="emit('attack', $event)"
    />
    <LimiterParameter
      :label="t('limiter.release')"
      :display-value="`${release.toFixed(0)} ms`"
      :value="release"
      :min="10"
      :max="500"
      :step="5"
      :disabled="!enabled"
      tone="warning"
      :hint="releaseHint"
      @input="emit('release', $event)"
    />
    <LimiterParameter
      :label="t('limiter.knee')"
      :display-value="`${knee.toFixed(0)} dB`"
      :value="knee"
      :min="0"
      :max="40"
      :step="1"
      :disabled="!enabled"
      tone="teal"
      :hint="kneeHint"
      @input="emit('knee', $event)"
    />
  </div>
</template>

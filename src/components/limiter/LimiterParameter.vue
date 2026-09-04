<script setup lang="ts">
import { computed } from 'vue'

import UiRange from '../ui/UiRange.vue'

const props = withDefaults(
  defineProps<{
    label: string
    displayValue: string
    value: number
    min: number
    max: number
    step: number
    disabled?: boolean
    tone?: 'target' | 'focus' | 'success' | 'warning' | 'violet' | 'teal'
    hint?: string
  }>(),
  {
    disabled: false,
    tone: 'focus',
    hint: '',
  },
)

const valueClass = computed(
  () =>
    ({
      target: 'text-target',
      focus: 'text-focus-light',
      success: 'text-success',
      warning: 'text-warning',
      violet: 'text-violet',
      teal: 'text-teal',
    })[props.tone],
)

const emit = defineEmits<{
  input: [value: number]
  change: [value: number]
}>()
</script>

<template>
  <div class="space-y-1.5">
    <label class="ui-control-label mb-0">
      <span>{{ label }}</span>
      <span class="ui-data font-600" :class="valueClass">{{ displayValue }}</span>
    </label>
    <div class="flex items-center gap-2.5">
      <span class="ui-slider-label">{{ min }}</span>
      <UiRange
        :min="min"
        :max="max"
        :step="step"
        :value="value"
        :tone="tone"
        :disabled="disabled"
        @input="emit('input', $event)"
        @change="emit('change', $event)"
      />
      <span class="ui-slider-label">{{ max }}</span>
    </div>
    <div v-if="hint" class="pl-9 text-[9px] text-faint">{{ hint }}</div>
  </div>
</template>

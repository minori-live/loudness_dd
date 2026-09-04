<script setup lang="ts">
import { computed } from 'vue'

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    value: number
    tone?: 'target' | 'focus' | 'success' | 'warning' | 'violet' | 'teal'
    compact?: boolean
  }>(),
  {
    tone: 'focus',
    compact: false,
  },
)

const emit = defineEmits<{
  input: [value: number]
}>()

const toneClass = computed(
  () =>
    ({
      target: 'ui-range--target',
      focus: 'ui-range--focus',
      success: 'ui-range--success',
      warning: 'ui-range--warning',
      violet: 'ui-range--violet',
      teal: 'ui-range--teal',
    })[props.tone],
)

function handleInput(event: Event): void {
  emit('input', Number((event.target as HTMLInputElement).value))
}
</script>

<template>
  <input
    v-bind="$attrs"
    type="range"
    class="ui-range min-w-0 flex-1 cursor-pointer outline-none"
    :class="[toneClass, compact ? 'h-1' : 'h-2']"
    :value="value"
    @input="handleInput"
  />
</template>

<style scoped>
.ui-range {
  appearance: none;
  border-radius: 999px;
  background: linear-gradient(to right, #2d3748, #4a5568);
  --range-color: #4299e1;
  --range-shadow: rgba(66, 153, 225, 0.4);
}

.ui-range--target {
  --range-color: #ffd700;
  --range-shadow: rgba(255, 215, 0, 0.4);
}

.ui-range--success {
  --range-color: #48bb78;
  --range-shadow: rgba(72, 187, 120, 0.35);
}

.ui-range--warning {
  --range-color: #ed8936;
  --range-shadow: rgba(237, 137, 54, 0.35);
}

.ui-range--violet {
  --range-color: #9f7aea;
  --range-shadow: rgba(159, 122, 234, 0.35);
}

.ui-range--teal {
  --range-color: #38b2ac;
  --range-shadow: rgba(56, 178, 172, 0.35);
}

.ui-range::-webkit-slider-thumb {
  width: 16px;
  height: 16px;
  appearance: none;
  border: 2px solid rgba(255, 255, 255, 0.16);
  border-radius: 999px;
  background: var(--range-color);
  box-shadow: 0 2px 8px var(--range-shadow);
  cursor: pointer;
  transition: transform 100ms ease;
}

.ui-range::-webkit-slider-thumb:hover {
  transform: scale(1.1);
}
</style>

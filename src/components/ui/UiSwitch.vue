<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    checked: boolean
    label?: string
    tone?: 'focus' | 'warning'
  }>(),
  {
    label: '',
    tone: 'focus',
  },
)

const emit = defineEmits<{
  toggle: [checked: boolean]
}>()

const activeTrackClass = computed(() =>
  props.tone === 'warning' ? 'bg-warning/75' : 'bg-focus/75',
)
</script>

<template>
  <button
    type="button"
    class="ui-focus-ring inline-flex shrink-0 cursor-pointer items-center gap-2 border-0 bg-transparent p-0 font-[inherit]"
    role="switch"
    :aria-checked="checked"
    @click="emit('toggle', !checked)"
  >
    <span
      class="relative h-5 w-9 rounded-full bg-white/12 transition-colors duration-150"
      :class="checked && activeTrackClass"
    >
      <span
        class="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-150"
        :class="checked && 'translate-x-4'"
      />
    </span>
    <span v-if="label" class="text-[11px] font-600" :class="checked ? 'text-ink' : 'text-subtle'">
      {{ label }}
    </span>
  </button>
</template>

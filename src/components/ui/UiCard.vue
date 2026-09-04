<script setup lang="ts">
import { computed } from 'vue'

type CardTone = 'panel' | 'balance' | 'settings' | 'track' | 'subtle'
type CardPadding = 'none' | 'sm' | 'md'

const props = withDefaults(
  defineProps<{
    as?: 'div' | 'section' | 'article'
    tone?: CardTone
    padding?: CardPadding
  }>(),
  {
    as: 'div',
    tone: 'panel',
    padding: 'md',
  },
)

const classes = computed(() => [
  'ui-panel-border shrink-0 overflow-hidden rounded-[10px]',
  {
    panel: 'bg-panel',
    balance: 'bg-gradient-to-br from-panel to-panel-deep',
    settings: 'bg-panel/80',
    track: 'bg-panel-raised/75 shadow-[0_6px_18px_rgba(0,0,0,0.16)]',
    subtle: 'bg-white/3',
  }[props.tone],
  { none: '', sm: 'p-2.5', md: 'p-3.5' }[props.padding],
])
</script>

<template>
  <component :is="as" :class="classes">
    <slot />
  </component>
</template>

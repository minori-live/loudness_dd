<script setup lang="ts">
import { computed } from 'vue'

type ButtonVariant = 'primary' | 'preset' | 'icon' | 'disclosure' | 'ghost'
type ButtonTone = 'neutral' | 'focus' | 'solo' | 'danger' | 'target'

const props = withDefaults(
  defineProps<{
    variant?: ButtonVariant
    tone?: ButtonTone
    active?: boolean
    block?: boolean
  }>(),
  {
    variant: 'ghost',
    tone: 'neutral',
    active: false,
    block: false,
  },
)

const classes = computed(() => [
  'ui-focus-ring inline-flex cursor-pointer items-center justify-center border border-solid font-[inherit] transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-45',
  props.block && 'w-full',
  {
    primary:
      'gap-2 rounded-lg border-focus/35 bg-focus/10 px-4 py-3 text-sm font-600 text-focus-light hover:border-focus/60 hover:bg-focus/18',
    preset:
      'min-w-17.5 flex-1 flex-col gap-0.5 rounded-md border-white/10 bg-white/3 px-2 py-1.5 text-[10px] text-muted hover:border-white/20 hover:bg-white/8 hover:text-ink',
    icon: 'h-6 w-6 rounded p-0 text-[11px] font-700',
    disclosure:
      'gap-1 rounded border-transparent bg-transparent px-1 py-0.5 text-[11px] text-subtle hover:text-muted',
    ghost:
      'rounded-md border-white/8 bg-white/4 px-3 py-1.5 text-xs text-muted hover:bg-white/9 hover:text-ink',
  }[props.variant],
  props.variant === 'icon' && !props.active
    ? 'border-white/8 bg-white/4 text-subtle hover:border-white/20 hover:bg-white/9 hover:text-ink'
    : '',
  props.variant === 'icon' && !props.active && props.tone === 'danger'
    ? 'border-white/8 bg-white/4 text-subtle hover:border-danger/35 hover:bg-danger/10 hover:text-danger'
    : '',
  props.active && props.tone === 'focus'
    ? 'border-focus/65 bg-focus/18 text-focus-light shadow-[0_0_0_1px_rgba(66,153,225,0.12)]'
    : '',
  props.active && props.tone === 'solo'
    ? 'border-warning/65 bg-warning/18 text-warning shadow-[0_0_0_1px_rgba(237,137,54,0.12)]'
    : '',
  props.active && props.tone === 'target' ? 'border-target/40 bg-target/15 text-target' : '',
])
</script>

<template>
  <button type="button" :class="classes">
    <slot />
  </button>
</template>

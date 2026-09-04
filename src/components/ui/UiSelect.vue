<script setup lang="ts">
defineOptions({ inheritAttrs: false })
</script>

<template>
  <select
    v-bind="$attrs"
    class="ui-focus-ring cursor-pointer rounded-md border border-solid border-white/10 bg-canvas/55 px-2 py-1 text-[11px] text-muted outline-none hover:border-white/20 hover:text-ink"
  >
    <slot />
  </select>
</template>

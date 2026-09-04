<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import UiCard from '../ui/UiCard.vue'
import UiSwitch from '../ui/UiSwitch.vue'

defineProps<{
  enabled: boolean
}>()

const emit = defineEmits<{
  toggle: [enabled: boolean]
}>()

const { t } = useI18n()
</script>

<template>
  <UiCard
    tone="subtle"
    padding="sm"
    class="flex items-center justify-between gap-4 border-focus/18 bg-focus/6"
  >
    <div>
      <div class="text-xs font-600 text-blue-200">{{ t('tabs.autoFocus.title') }}</div>
      <div class="text-[10px] text-subtle">{{ t('tabs.autoFocus.description') }}</div>
    </div>
    <UiSwitch
      :checked="enabled"
      :label="enabled ? t('tabs.autoFocus.on') : t('tabs.autoFocus.off')"
      @toggle="emit('toggle', $event)"
    />
  </UiCard>
</template>

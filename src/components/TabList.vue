<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useTabsStore } from '@/stores/tabs'

import AutoFocusControl from './tabs/AutoFocusControl.vue'
import TabCard from './tabs/TabCard.vue'

const tabsStore = useTabsStore()
const { t } = useI18n()

const tabs = computed(() => tabsStore.tabs)
const targetLufs = computed(() => tabsStore.targetLufs)
const soloTabId = computed(() => tabsStore.soloTabId)
const focusTabId = computed(() => tabsStore.focusTabId)
</script>

<template>
  <div class="flex flex-col gap-3">
    <div v-if="tabs.length === 0" class="px-4 py-8 text-center text-subtle">
      <div class="mb-3 text-5xl opacity-50" aria-hidden="true">🔇</div>
      <p class="text-sm">{{ t('tabs.empty.title') }}</p>
      <p class="mt-2 text-xs opacity-70">{{ t('tabs.empty.hint') }}</p>
    </div>

    <AutoFocusControl
      v-else
      :enabled="tabsStore.isAutoFocusEnabled"
      @toggle="tabsStore.setAutoFocusEnabled($event)"
    />

    <TransitionGroup name="tab-item" tag="div" class="grid grid-cols-2 gap-3">
      <TabCard
        v-for="tab in tabs"
        :key="tab.tabId"
        :tab="tab"
        :target-lufs="targetLufs"
        :solo="soloTabId === tab.tabId"
        :muted="tabsStore.hasSolo && soloTabId !== tab.tabId"
        :focused="focusTabId === tab.tabId"
        :ducked="tabsStore.hasFocus && focusTabId !== tab.tabId"
        @gain="tabsStore.setGain"
        @max-gain="tabsStore.setMaxGain"
        @remove="tabsStore.unregisterTab"
        @reset="tabsStore.resetLufs"
        @solo="tabsStore.toggleSolo"
        @focus="tabsStore.toggleFocus"
      />
    </TransitionGroup>
  </div>
</template>

<style scoped>
.tab-item-enter-active,
.tab-item-leave-active,
.tab-item-move {
  transition:
    opacity 200ms ease,
    transform 200ms ease;
}

.tab-item-enter-from {
  opacity: 0;
  transform: translateY(-8px);
}

.tab-item-leave-to {
  opacity: 0;
  transform: translateX(16px);
}
</style>

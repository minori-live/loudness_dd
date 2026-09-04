<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AutoBalance from '@/components/AutoBalance.vue'
import Limiter from '@/components/Limiter.vue'
import TabList from '@/components/TabList.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import { useSettingsStore } from '@/stores/settings'
import { useTabsStore } from '@/stores/tabs'

const version = __APP_VERSION__
const tabsStore = useTabsStore()
const { t, locale } = useI18n()
const settings = useSettingsStore()
const languages = [
  { code: 'en', name: 'English' },
  { code: 'zh_CN', name: '简体中文' },
]

const isLoading = computed(() => tabsStore.isLoading)
const error = computed(() => tabsStore.error)
const hasCaptures = computed(() => tabsStore.hasCaptures)

function handleLocaleChange(event: Event): void {
  locale.value = (event.target as HTMLSelectElement).value
}

onMounted(() => {
  void tabsStore.startSync()

  if (!languages.some((language) => language.code === locale.value)) {
    locale.value = 'en'
  }

  if (settings.locale && settings.locale !== locale.value) {
    locale.value = settings.locale
  }
})

watch(
  locale,
  (value) => {
    settings.locale = String(value)
  },
  { flush: 'post' },
)

onUnmounted(() => tabsStore.stopSync())
</script>

<template>
  <div
    class="flex min-h-100 max-h-150 flex-col overflow-hidden bg-gradient-to-b from-canvas via-panel to-panel-deep text-ink"
  >
    <header
      class="flex items-center justify-between border-b border-b-solid border-white/6 bg-black/20 px-4 py-3.5"
    >
      <div class="flex items-center gap-2.5">
        <span class="text-2xl" aria-hidden="true">📊</span>
        <h1
          class="m-0 bg-gradient-to-br from-focus to-violet bg-clip-text text-lg font-700 text-transparent"
        >
          {{ t('popup.title') }}
        </h1>
      </div>
      <div class="flex items-center gap-2">
        <UiSelect :value="locale" aria-label="Language" @change="handleLocaleChange">
          <option v-for="language in languages" :key="language.code" :value="language.code">
            {{ language.name }}
          </option>
        </UiSelect>
        <span class="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-faint">v{{ version }}</span>
      </div>
    </header>

    <Transition name="error">
      <div
        v-if="error"
        class="flex cursor-pointer items-center gap-2 border-b border-b-solid border-danger/30 bg-danger/15 px-4 py-2.5 text-xs text-red-300"
        @click="tabsStore.clearError()"
      >
        <span aria-hidden="true">⚠️</span>
        <span class="flex-1">{{ error }}</span>
        <UiButton variant="icon" tone="danger" aria-label="Dismiss">✕</UiButton>
      </div>
    </Transition>

    <main class="app-scrollbar flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
      <UiButton
        variant="primary"
        block
        :disabled="isLoading"
        @click="tabsStore.registerCurrentTab()"
      >
        <span aria-hidden="true">{{ isLoading ? '⏳' : '➕' }}</span>
        <span>{{
          isLoading ? t('popup.register.registering') : t('popup.register.register')
        }}</span>
      </UiButton>

      <AutoBalance v-if="hasCaptures" />
      <Limiter v-if="hasCaptures" />

      <section class="shrink-0">
        <h2 v-if="hasCaptures" class="mb-2 text-xs font-600 uppercase tracking-wider text-muted">
          {{ t('popup.tabs.title') }}
        </h2>
        <TabList />
      </section>
    </main>

    <footer
      class="flex items-center justify-center gap-2 border-t border-t-solid border-white/5 bg-black/15 px-4 py-2 text-[10px] text-faint"
    >
      <span>{{ t('footer.brand') }}</span>
      <span>•</span>
      <a
        class="text-subtle no-underline transition-colors hover:text-focus-light"
        href="https://github.com/minori-live"
        target="_blank"
        rel="noopener noreferrer"
      >
        {{ t('footer.author') }}
      </a>
    </footer>
  </div>
</template>

<style scoped>
.error-enter-active,
.error-leave-active {
  transition:
    opacity 200ms ease,
    transform 200ms ease;
}

.error-enter-from,
.error-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>

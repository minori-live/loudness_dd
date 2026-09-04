<script setup lang="ts">
import { onMounted, onUnmounted, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AutoBalance from '@/components/AutoBalance.vue'
import Limiter from '@/components/Limiter.vue'
import TabList from '@/components/TabList.vue'
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

async function handleRegisterTab(): Promise<void> {
  await tabsStore.registerCurrentTab()
}

function handleClearError(): void {
  tabsStore.clearError()
}

onMounted(() => {
  void tabsStore.startSync()

  // get current locale
  const currentLocale = locale.value
  if (currentLocale) {
    const language = languages.find((l) => l.code === currentLocale)
    if (language) {
      locale.value = language.code
    } else {
      locale.value = 'en'
    }
  }

  if (settings.locale && settings.locale !== locale.value) {
    locale.value = settings.locale
  }
})

watch(
  locale,
  (val) => {
    settings.locale = String(val)
  },
  { flush: 'post' },
)

onUnmounted(() => {
  tabsStore.stopSync()
})
</script>

<template>
  <div class="app">
    <!-- Header -->
    <header class="app-header">
      <div class="logo">
        <span class="logo-icon">📊</span>
        <h1>{{ t('popup.title') }}</h1>
      </div>
      <div style="display: flex; align-items: center; gap: 8px">
        <select v-model="locale" class="lang-select">
          <option v-for="l in languages" :key="l.code" :value="l.code">{{ l.name }}</option>
        </select>
        <span class="version"> v{{ version }}</span>
      </div>
    </header>

    <!-- Error Banner -->
    <Transition name="error">
      <div v-if="error" class="error-banner" @click="handleClearError">
        <span class="error-icon">⚠️</span>
        <span class="error-text">{{ error }}</span>
        <button class="error-dismiss">✕</button>
      </div>
    </Transition>

    <!-- Main Content -->
    <main class="app-content">
      <!-- Register Tab Button -->
      <button class="register-btn" :disabled="isLoading" @click="handleRegisterTab">
        <span class="btn-icon">{{ isLoading ? '⏳' : '➕' }}</span>
        <span class="btn-text">{{
          isLoading ? t('popup.register.registering') : t('popup.register.register')
        }}</span>
      </button>

      <!-- Auto Balance Controls -->
      <AutoBalance v-if="hasCaptures" />

      <!-- Limiter Controls -->
      <Limiter v-if="hasCaptures" />

      <!-- Tab List -->
      <section class="tabs-section">
        <h2 v-if="hasCaptures">{{ t('popup.tabs.title') }}</h2>
        <TabList />
      </section>
    </main>

    <!-- Footer -->
    <footer class="app-footer">
      <span> {{ t('footer.brand') }} </span>
      <span class="separator">•</span>
      <a href="https://github.com/dsh0416" target="_blank" rel="noopener noreferrer">{{
        t('footer.author')
      }}</a>
    </footer>
  </div>
</template>

<style>
/* Global Styles */
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family:
    'Inter',
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    Roboto,
    sans-serif;
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* Popup dimensions */
html,
body,
#app {
  width: 800px;
  min-height: 400px;
  max-height: 600px;
}
</style>

<style scoped>
.lang-select {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  color: #a0aec0;
  font-size: 11px;
  padding: 4px 6px;
}

.app {
  display: flex;
  flex-direction: column;
  min-height: 400px;
  max-height: 600px;
  background: linear-gradient(180deg, #0f0f1a 0%, #1a1a2e 50%, #16213e 100%);
  color: #e2e8f0;
  overflow: hidden;
}

/* Header */
.app-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 16px;
  background: rgba(0, 0, 0, 0.2);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.logo {
  display: flex;
  align-items: center;
  gap: 10px;
}

.logo-icon {
  font-size: 24px;
}

.logo h1 {
  font-size: 18px;
  font-weight: 700;
  background: linear-gradient(135deg, #4299e1, #9f7aea);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.version {
  font-size: 10px;
  color: #4a5568;
  padding: 2px 6px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 4px;
}

/* Error Banner */
.error-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background: rgba(245, 101, 101, 0.15);
  border-bottom: 1px solid rgba(245, 101, 101, 0.3);
  color: #fc8181;
  font-size: 12px;
  cursor: pointer;
}

.error-icon {
  font-size: 14px;
}

.error-text {
  flex: 1;
}

.error-dismiss {
  background: none;
  border: none;
  color: #fc8181;
  font-size: 14px;
  cursor: pointer;
  opacity: 0.7;
  transition: opacity 0.15s;
}

.error-dismiss:hover {
  opacity: 1;
}

.error-enter-active,
.error-leave-active {
  transition: all 0.3s ease;
}

.error-enter-from,
.error-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}

/* Main Content */
.app-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* Register Button */
.register-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  padding: 14px 20px;
  border: 2px dashed rgba(66, 153, 225, 0.4);
  border-radius: 10px;
  background: rgba(66, 153, 225, 0.08);
  color: #63b3ed;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.register-btn:hover:not(:disabled) {
  background: rgba(66, 153, 225, 0.15);
  border-color: rgba(66, 153, 225, 0.6);
  transform: translateY(-1px);
}

.register-btn:active:not(:disabled) {
  transform: translateY(0);
}

.register-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.register-btn .btn-icon {
  font-size: 18px;
}

/* Tabs Section */
.tabs-section {
  flex: 1;
}

.tabs-section h2 {
  font-size: 12px;
  font-weight: 600;
  color: #718096;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 12px;
}

/* Footer */
.app-footer {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background: rgba(0, 0, 0, 0.2);
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  font-size: 10px;
  color: #4a5568;
}

.separator {
  opacity: 0.5;
}

.app-footer a {
  color: #718096;
  text-decoration: none;
  transition: all 0.2s ease;
}

.app-footer a:hover {
  color: #63b3ed;
  text-shadow: 0 0 8px rgba(99, 179, 237, 0.4);
}

/* Scrollbar */
.app-content::-webkit-scrollbar {
  width: 6px;
}

.app-content::-webkit-scrollbar-track {
  background: transparent;
}

.app-content::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
}

.app-content::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.2);
}
</style>

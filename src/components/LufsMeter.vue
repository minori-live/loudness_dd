<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const MIN_BLOCKS_REQUIRED = 10
const MIN_LUFS = -60
const MAX_LUFS = 0

interface Props {
  momentary?: number | null
  shortTerm?: number | null
  integrated?: number | null
  blockCount?: number | null
  targetLufs?: number | null
  showLabels?: boolean
  compact?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  momentary: -Infinity,
  shortTerm: -Infinity,
  integrated: -Infinity,
  blockCount: 0,
  targetLufs: -14,
  showLabels: true,
  compact: false,
})

const { t } = useI18n()
const hasEnoughSamples = computed(() => (props.blockCount ?? 0) >= MIN_BLOCKS_REQUIRED)

function lufsToPercent(lufs: number): number {
  if (!isFinite(lufs) || lufs <= MIN_LUFS) return 0
  if (lufs >= MAX_LUFS) return 100
  return ((lufs - MIN_LUFS) / (MAX_LUFS - MIN_LUFS)) * 100
}

function formatLufs(lufs: number): string {
  if (!isFinite(lufs) || lufs <= MIN_LUFS) return '-∞'
  return lufs.toFixed(1)
}

function getMeterColor(lufs: number): string {
  if (!isFinite(lufs)) return '#4a5568'
  const diff = lufs - (props.targetLufs ?? -14)
  if (diff > 3) return '#f56565'
  if (diff > 0) return '#ed8936'
  if (diff > -6) return '#48bb78'
  return '#4299e1'
}

const targetPercent = computed(() => lufsToPercent(props.targetLufs ?? -14))
const sampleProgress = computed(() =>
  Math.min(100, ((props.blockCount ?? 0) / MIN_BLOCKS_REQUIRED) * 100),
)

const rows = computed(() => [
  { label: 'M', value: props.momentary ?? -Infinity },
  { label: 'S', value: props.shortTerm ?? -Infinity },
  { label: 'I', value: props.integrated ?? -Infinity, integrated: true },
])
</script>

<template>
  <div
    class="ui-data flex flex-col rounded-md bg-gradient-to-br from-canvas to-panel text-[11px]"
    :class="compact ? 'gap-0.5 p-1.5' : 'gap-1 p-2'"
  >
    <div
      v-if="!hasEnoughSamples && !compact"
      class="mb-1 flex items-center gap-2 rounded border border-solid border-warning/30 bg-warning/10 px-2 py-1.5"
    >
      <span class="animate-pulse text-sm" aria-hidden="true">⏳</span>
      <div class="flex flex-1 flex-col gap-0.5">
        <span class="text-[10px] font-500 text-warning">{{ t('lufs.collecting') }}</span>
        <div class="h-1 overflow-hidden rounded-full bg-warning/20">
          <div
            class="h-full rounded-full bg-gradient-to-r from-warning to-orange-300 transition-[width] duration-300"
            :style="{ width: `${sampleProgress}%` }"
          />
        </div>
      </div>
    </div>

    <template v-for="row in rows" :key="row.label">
      <div v-if="!compact || row.integrated" class="flex items-center gap-2">
        <span v-if="showLabels" class="w-3 text-center font-700 text-subtle">{{ row.label }}</span>
        <div class="relative h-2 flex-1 overflow-hidden rounded-sm bg-panel">
          <div
            class="h-full rounded-sm transition-[width,background-color] duration-150"
            :style="{
              width: `${lufsToPercent(row.value)}%`,
              backgroundColor: getMeterColor(row.value),
            }"
          />
          <div
            class="absolute top-0 h-full w-px bg-target/85"
            :style="{ left: `${targetPercent}%` }"
          />
        </div>
        <span
          class="w-9 text-right font-600"
          :class="row.integrated && !hasEnoughSamples ? 'text-faint' : 'text-ink'"
        >
          {{ formatLufs(row.value) }}
        </span>
      </div>
    </template>

    <span
      v-if="!hasEnoughSamples && compact"
      class="ml-auto h-1.5 w-1.5 animate-pulse rounded-full bg-warning"
    />

    <div v-if="showLabels && !compact" class="ml-5 flex justify-between pr-9 text-[8px] text-faint">
      <span>-60</span><span>-40</span><span>-20</span><span>0</span>
    </div>
  </div>
</template>

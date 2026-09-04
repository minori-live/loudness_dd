import { defineConfig, presetWind3 } from 'unocss'

export default defineConfig({
  presets: [presetWind3()],
  theme: {
    colors: {
      canvas: '#0f0f1a',
      panel: '#1a1a2e',
      'panel-raised': '#252538',
      'panel-deep': '#16213e',
      ink: '#e2e8f0',
      muted: '#a0aec0',
      subtle: '#718096',
      faint: '#4a5568',
      focus: '#4299e1',
      'focus-light': '#63b3ed',
      success: '#48bb78',
      warning: '#ed8936',
      danger: '#f56565',
      target: '#ffd700',
      violet: '#9f7aea',
      teal: '#38b2ac',
    },
  },
  shortcuts: {
    'ui-focus-ring':
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas',
    'ui-panel-border': 'border border-solid border-[rgba(255,255,255,0.06)]',
    'ui-data': "font-['JetBrains_Mono','Fira_Code',monospace] tabular-nums",
    'ui-section-title': 'm-0 text-sm font-600 text-ink',
    'ui-control-label': 'mb-2 flex items-center justify-between text-xs text-muted',
    'ui-slider-label': 'ui-data w-7 text-[9px] text-faint last:text-right',
  },
})

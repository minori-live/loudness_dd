import { PeakLimiter } from '../audio/peak-limiter'
import type { LimiterSettings } from '../protocol'

declare class AudioWorkletProcessor {
  readonly port: MessagePort
  constructor()
}
declare const sampleRate: number
declare function registerProcessor(name: string, processor: new (...args: never[]) => unknown): void

class LimiterProcessor extends AudioWorkletProcessor {
  private readonly limiter: PeakLimiter

  constructor(options?: { processorOptions?: { settings?: Partial<LimiterSettings> } }) {
    super()
    this.limiter = new PeakLimiter(sampleRate, options?.processorOptions?.settings)
    this.port.onmessage = (
      event: MessageEvent<{ type: string; settings?: Partial<LimiterSettings> }>,
    ) => {
      if (event.data?.type === 'settings' && event.data.settings) {
        this.limiter.configure(event.data.settings)
      }
    }
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    this.limiter.process(inputs[0] ?? [], outputs[0] ?? [])
    return true
  }
}

registerProcessor('peak-limiter', LimiterProcessor)

/* Global AudioWorklet types (provided by browser at runtime) */
declare class AudioWorkletProcessor {
  readonly port: MessagePort
  constructor()
}
declare const sampleRate: number
declare function registerProcessor(
  name: string,
  processorCtor: new (...args: never[]) => unknown,
): void

interface LufsWasmExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory
  lufs_create: (sampleRate: number) => number
  lufs_input_capacity: () => number
  lufs_input_left_ptr: (handle: number) => number
  lufs_input_right_ptr: (handle: number) => number
  lufs_measurements_ptr: (handle: number) => number
  lufs_process: (handle: number, frameCount: number, activeChannels: number) => number
  lufs_reset: (handle: number) => void
}

interface LufsProcessorOptions {
  processorOptions?: {
    wasmModule?: WebAssembly.Module
  }
}

/**
 * Thin real-time bridge between Web Audio buffers and the Rust LUFS meter.
 * The WebAssembly module is compiled outside the rendering thread and passed
 * through AudioWorkletNode.processorOptions.
 */
class LufsProcessor extends AudioWorkletProcessor {
  private readonly wasm: LufsWasmExports
  private readonly meterHandle: number
  private readonly inputCapacity: number
  private readonly inputLeft: Float32Array
  private readonly inputRight: Float32Array
  private readonly measurements: Float64Array

  constructor(options?: LufsProcessorOptions) {
    super()

    const wasmModule = options?.processorOptions?.wasmModule
    if (!wasmModule) throw new Error('LUFS WebAssembly module was not provided')

    const instance = new WebAssembly.Instance(wasmModule)
    this.wasm = instance.exports as LufsWasmExports
    this.meterHandle = this.wasm.lufs_create(sampleRate)
    if (this.meterHandle === 0) throw new Error(`Unable to create LUFS meter at ${sampleRate} Hz`)

    this.inputCapacity = this.wasm.lufs_input_capacity()
    const leftPointer = this.wasm.lufs_input_left_ptr(this.meterHandle)
    const rightPointer = this.wasm.lufs_input_right_ptr(this.meterHandle)
    const measurementsPointer = this.wasm.lufs_measurements_ptr(this.meterHandle)
    if (
      this.inputCapacity <= 0 ||
      leftPointer === 0 ||
      rightPointer === 0 ||
      measurementsPointer === 0
    ) {
      throw new Error('LUFS WebAssembly input buffers are unavailable')
    }

    this.inputLeft = new Float32Array(this.wasm.memory.buffer, leftPointer, this.inputCapacity)
    this.inputRight = new Float32Array(this.wasm.memory.buffer, rightPointer, this.inputCapacity)
    this.measurements = new Float64Array(this.wasm.memory.buffer, measurementsPointer, 4)

    this.port.onmessage = (event: MessageEvent) => {
      const data = event.data
      if (data && typeof data === 'object' && data.type === 'reset') {
        this.wasm.lufs_reset(this.meterHandle)
      }
    }
  }

  process(
    inputs: ReadonlyArray<ReadonlyArray<Float32Array | undefined>>,
    _outputs: ReadonlyArray<ReadonlyArray<Float32Array>>,
  ): boolean {
    const input = inputs[0]
    const left = input?.[0]
    if (!left) return true

    const right = input?.[1]
    const activeChannels = right ? 2 : 1
    for (let offset = 0; offset < left.length; offset += this.inputCapacity) {
      const chunkLength = Math.min(this.inputCapacity, left.length - offset)
      this.copyInput(left, this.inputLeft, offset, chunkLength)
      if (right) this.copyInput(right, this.inputRight, offset, chunkLength)

      if (this.wasm.lufs_process(this.meterHandle, chunkLength, activeChannels) !== 0) {
        this.postMeasurements()
      }
    }

    return true
  }

  private copyInput(
    source: Float32Array,
    destination: Float32Array,
    offset: number,
    length: number,
  ): void {
    if (offset === 0 && length === source.length) {
      destination.set(source)
      return
    }
    destination.set(source.subarray(offset, offset + length))
  }

  private postMeasurements(): void {
    this.port.postMessage({
      type: 'lufs',
      momentary: this.measurements[0],
      shortTerm: this.measurements[1],
      integrated: this.measurements[2],
      blockCount: this.measurements[3],
    })
  }
}

registerProcessor('lufs-processor', LufsProcessor)

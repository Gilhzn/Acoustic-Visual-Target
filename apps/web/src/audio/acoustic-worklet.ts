/**
 * AudioWorklet entry. Thin shim over AcousticEngine: emits the transmit chirp,
 * captures the mics, and posts each AcousticMeasurement back to the main thread.
 * Bundled to a single module by Vite (?worker&url) so the AudioWorkletGlobalScope
 * has no remaining import statements. Device-only.
 */
import type { ChirpSpec } from "@avt/dsp";
import { AcousticEngine, type AcousticEngineOpts } from "./acoustic-engine.js";

interface ProcessorOptions {
  spec: ChirpSpec;
  engine?: AcousticEngineOpts;
}

class AcousticProcessor extends AudioWorkletProcessor {
  private readonly engine: AcousticEngine;

  constructor(options?: AudioWorkletNodeOptions) {
    super(options);
    const po = (options?.processorOptions ?? {}) as ProcessorOptions;
    this.engine = new AcousticEngine(po.spec, po.engine);
    this.engine.onMeasurement = (m) => this.port.postMessage({ type: "measurement", m });
    this.engine.onProfile = (mags) =>
      this.port.postMessage({ type: "profile", mags: Float32Array.from(mags) });
    this.port.onmessage = (e: MessageEvent) => {
      const d = e.data as { type?: string; value?: number };
      if (d?.type === "txGain" && typeof d.value === "number") this.engine.setTxGain(d.value);
    };
  }

  override process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0];
    const output = outputs[0];
    const in0 = input?.[0] ?? null;
    const in1 = input?.[1] ?? null;
    const out0 = output?.[0] ?? null;
    if (in0) this.engine.process(in0, in1, out0);
    // Mirror the chirp to any additional output channels (stereo speakers).
    if (output && out0) for (let ch = 1; ch < output.length; ch++) output[ch].set(out0);
    return true;
  }
}

registerProcessor("acoustic-processor", AcousticProcessor);

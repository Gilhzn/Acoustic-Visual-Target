import type { AcousticMeasurement } from "@avt/contracts";
import type { ChirpSpec } from "@avt/dsp";
import type { AcousticEngineOpts } from "./acoustic-engine.js";
// Vite bundles the worklet to a single self-contained module and returns its URL.
import workletUrl from "./acoustic-worklet.ts?worker&url";

export interface AcousticTrackerOpts {
  spec: ChirpSpec;
  engine?: AcousticEngineOpts;
  onMeasurement: (m: AcousticMeasurement) => void;
  onProfile?: (mags: Float32Array) => void;
}

/**
 * Device-side acoustic capture. Opens an unprocessed microphone stream (AEC/AGC/
 * NS disabled so the ultrasonic band survives), runs the FMCW DSP in an
 * AudioWorklet, and forwards measurements to the fusion loop. Device-only.
 */
export class AcousticTracker {
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private stream: MediaStream | null = null;
  private readonly opts: AcousticTrackerOpts;
  channels: 1 | 2 = 1;

  constructor(opts: AcousticTrackerOpts) {
    this.opts = opts;
  }

  get azimuthAvailable(): boolean {
    return this.channels === 2;
  }

  async start(): Promise<void> {
    const fs = this.opts.spec.fs as number;
    const ctx = new AudioContext({ sampleRate: fs, latencyHint: "interactive" });
    this.ctx = ctx;
    await ctx.audioWorklet.addModule(workletUrl);

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 2,
        sampleRate: fs,
      },
      video: false,
    });
    const track = this.stream.getAudioTracks()[0];
    this.channels = (track?.getSettings().channelCount ?? 1) >= 2 ? 2 : 1;

    const src = ctx.createMediaStreamSource(this.stream);
    const node = new AudioWorkletNode(ctx, "acoustic-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: { spec: this.opts.spec, engine: this.opts.engine },
    });
    this.node = node;
    node.port.onmessage = (e: MessageEvent) => {
      const d = e.data as { type?: string; m?: AcousticMeasurement; mags?: Float32Array };
      if (d?.type === "measurement" && d.m) this.opts.onMeasurement(d.m);
      else if (d?.type === "profile" && d.mags) this.opts.onProfile?.(d.mags);
    };
    src.connect(node);
    node.connect(ctx.destination); // play out the chirp
    if (ctx.state === "suspended") await ctx.resume();
  }

  setTxGain(g: number): void {
    this.node?.port.postMessage({ type: "txGain", value: g });
  }

  async stop(): Promise<void> {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.node?.disconnect();
    await this.ctx?.close();
    this.ctx = null;
    this.node = null;
    this.stream = null;
  }
}

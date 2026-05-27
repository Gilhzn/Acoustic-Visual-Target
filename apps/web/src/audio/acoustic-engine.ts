import { seconds } from "@avt/core-units";
import type { AcousticMeasurement } from "@avt/contracts";
import { AcousticPipeline, chirpSamples, synthChirp, type ChirpSpec, type PipelineOpts } from "@avt/dsp";

export interface AcousticEngineOpts {
  pipeline?: PipelineOpts;
  /** Transmit chirp output level [0,1]. */
  txGain?: number;
  /** Edge taper of the emitted chirp (anti-click). */
  taperFraction?: number;
  /** Number of range-profile bins to emit per frame (0 disables, for the waterfall). */
  profileBins?: number;
}

/**
 * Real-time-safe acoustic engine, independent of any audio API. It emits the
 * transmit chirp on the output, accumulates the dual-mic input into chirp-length
 * frames, and runs the real DSP pipeline on each frame boundary. The browser
 * AudioWorkletProcessor is a thin shim over this class; Node tests drive it
 * directly to prove worklet↔pipeline parity.
 */
export class AcousticEngine {
  private readonly pipeline: AcousticPipeline;
  private readonly tx: Float32Array;
  private readonly frameLen: number;
  private readonly fs: number;
  private readonly frame0: Float32Array;
  private readonly frame1: Float32Array;
  private framePos = 0;
  private txPos = 0;
  private elapsed = 0;
  private txGain: number;
  private readonly profile: Float32Array | null;

  onMeasurement: ((m: AcousticMeasurement) => void) | null = null;
  onProfile: ((mags: Float32Array) => void) | null = null;

  constructor(spec: ChirpSpec, opts: AcousticEngineOpts = {}) {
    this.pipeline = new AcousticPipeline(spec, opts.pipeline);
    this.frameLen = chirpSamples(spec);
    this.fs = spec.fs as number;
    this.txGain = opts.txGain ?? 0.6;
    this.tx = synthChirp(spec, undefined, { amplitude: 1, taperFraction: opts.taperFraction ?? 0.05 });
    this.frame0 = new Float32Array(this.frameLen);
    this.frame1 = new Float32Array(this.frameLen);
    this.profile = opts.profileBins && opts.profileBins > 0 ? new Float32Array(opts.profileBins) : null;
  }

  setTxGain(g: number): void {
    this.txGain = Math.max(0, Math.min(1, g));
  }

  reset(): void {
    this.pipeline.reset();
    this.framePos = 0;
    this.txPos = 0;
    this.elapsed = 0;
  }

  /**
   * Process one audio quantum. `out` receives the transmit chirp; `in0`/`in1`
   * are the captured mics (in1 may equal in0 on mono devices). Emits a
   * measurement whenever a full chirp frame has been captured.
   */
  process(in0: Float32Array, in1: Float32Array | null, out: Float32Array | null): void {
    const n = out ? out.length : in0.length;
    for (let i = 0; i < n; i++) {
      if (out) out[i] = this.tx[this.txPos] * this.txGain;
      this.txPos = this.txPos + 1 >= this.frameLen ? 0 : this.txPos + 1;

      this.frame0[this.framePos] = in0[i];
      this.frame1[this.framePos] = in1 ? in1[i] : in0[i];
      this.framePos++;
      this.elapsed++;

      if (this.framePos >= this.frameLen) {
        const m = this.pipeline.process(this.frame0, this.frame1, seconds(this.elapsed / this.fs));
        this.onMeasurement?.(m);
        if (this.profile && this.onProfile) {
          this.pipeline.copyMagnitudeProfile(this.profile);
          this.onProfile(this.profile);
        }
        this.framePos = 0;
      }
    }
  }
}

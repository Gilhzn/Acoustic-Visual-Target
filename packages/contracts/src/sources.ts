import type { Seconds } from "@avt/core-units";
import type { AcousticMeasurement, Detection } from "./measurements.js";

/**
 * A frame as seen by a Detector. In the browser this wraps an ImageBitmap /
 * VideoFrame / HTMLVideoElement; in the Lab it is a synthetic descriptor.
 * Detectors only read width/height + the opaque `source`.
 */
export interface FrameLike {
  width: number;
  height: number;
  tSec: Seconds;
  /** Browser pixel source (CanvasImageSource) or a synthetic marker. */
  source: unknown;
}

/**
 * Pull-based dual-channel audio source. `pull` copies up to mic0.length samples
 * into the provided buffers and returns how many were written. A mono device
 * fills mic1 identically to mic0 and reports `channels === 1`.
 */
export interface AudioSource {
  readonly channels: 1 | 2;
  readonly sampleRate: number;
  start(): Promise<void>;
  pull(mic0: Float32Array, mic1: Float32Array): number;
  stop(): Promise<void>;
}

export interface CameraSource {
  readonly width: number;
  readonly height: number;
  start(): Promise<void>;
  /** Latest available frame, or null if none ready. */
  latestFrame(): FrameLike | null;
  stop(): Promise<void>;
}

/** Object detector: synthetic (Lab) and TF.js (app) both implement this. */
export interface Detector {
  readonly name: string;
  /** Warm up GPU shader compilation / model graph. Safe to call once. */
  warmup(): Promise<void>;
  detect(frame: FrameLike): Promise<Detection[]>;
  dispose(): void;
}

/**
 * The DSP kernel surface. The pure-TS pipeline implements this today; a future
 * Rust→WASM kernel drops in behind the same interface (parity-tested).
 */
export interface RangeProcessor {
  readonly name: string;
  /** Process one chirp-echo frame from both mics captured at time `tSec`. */
  process(mic0: Float32Array, mic1: Float32Array, tSec: Seconds): AcousticMeasurement;
  reset(): void;
}

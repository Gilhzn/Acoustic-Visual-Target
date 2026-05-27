import { SPEED_OF_SOUND_MPS } from "@avt/core-units";
import { chirpSamples, chirpSweepRate, type ChirpSpec } from "@avt/dsp";
import type { Trajectory } from "./scene.js";
import type { Rng } from "./rng.js";

export interface StaticReflector {
  rangeM: number;
  amplitude: number;
}

export interface AcousticImpairments {
  /** Static multipath reflectors (walls/furniture) — removed by clutter cancel. */
  multipath?: StaticReflector[];
  /** DAC/ADC clock-drift carrier offset (Hz) → a beat (range) bias. */
  carrierDriftHz?: number;
  /** Additive Gaussian noise std (per sample). */
  noiseStd?: number;
  /** Mic-1 gain relative to mic-0 (1 = matched). Corrupts PDoA if ≠ 1. */
  micGainMismatch?: number;
  /** Target echo amplitude. */
  attenuation?: number;
}

const c = SPEED_OF_SOUND_MPS as number;

function addChirpEcho(
  out: Float32Array,
  spec: ChirpSpec,
  rangeM: number,
  extraDelaySec: number,
  amp: number,
  driftHz: number,
): void {
  const n = out.length;
  const fs = spec.fs as number;
  const f0 = spec.fStart as number;
  const beta = chirpSweepRate(spec);
  const tau = (2 * rangeM) / c + extraDelaySec;
  for (let i = 0; i < n; i++) {
    const ta = i / fs;
    const t = ta - tau;
    const phase = 2 * Math.PI * (f0 * t + 0.5 * beta * t * t + driftHz * ta);
    out[i] += amp * Math.cos(phase);
  }
}

/**
 * Synthesize the dual-mic received signal for the target at `tSec` plus any
 * impairments. mic-1 carries the PDoA delay d·sinθ/c relative to mic-0.
 */
export function synthEcho(
  traj: Trajectory,
  spec: ChirpSpec,
  baselineM: number,
  imp: AcousticImpairments,
  tSec: number,
  rng: Rng,
): { mic0: Float32Array; mic1: Float32Array } {
  const n = chirpSamples(spec);
  const mic0 = new Float32Array(n);
  const mic1 = new Float32Array(n);
  const p = traj.posAt(tSec);
  const R = Math.hypot(p.x, p.y, p.z);
  const theta = Math.atan2(p.x, p.z);
  const amp = imp.attenuation ?? 1;
  const drift = imp.carrierDriftHz ?? 0;
  const micGain = imp.micGainMismatch ?? 1;
  const extraDelay = (baselineM * Math.sin(theta)) / c;

  // Target echo.
  addChirpEcho(mic0, spec, R, 0, amp, drift);
  addChirpEcho(mic1, spec, R, extraDelay, amp * micGain, drift);

  // Static multipath reflectors (identical every frame → clutter-cancellable).
  for (const refl of imp.multipath ?? []) {
    addChirpEcho(mic0, spec, refl.rangeM, 0, refl.amplitude, drift);
    addChirpEcho(mic1, spec, refl.rangeM, 0, refl.amplitude * micGain, drift);
  }

  // Additive noise.
  const noise = imp.noiseStd ?? 0;
  if (noise > 0) {
    for (let i = 0; i < n; i++) {
      mic0[i] += noise * rng.gaussian();
      mic1[i] += noise * rng.gaussian();
    }
  }
  return { mic0, mic1 };
}

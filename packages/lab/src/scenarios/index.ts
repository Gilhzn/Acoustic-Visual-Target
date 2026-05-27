import { hz, sampleRate } from "@avt/core-units";
import type { CameraIntrinsics } from "@avt/contracts";
import type { ChirpSpec, PipelineOpts } from "@avt/dsp";
import type { EkfOptions } from "@avt/fusion";
import { linearTrajectory, type Trajectory } from "../scene.js";
import type { AcousticImpairments } from "../acousticGen.js";
import type { VisualImpairments } from "../visualGen.js";

export interface ScenarioExpectations {
  meanErrorM: number;
  p95ErrorM?: number;
  jitterStdM?: number;
}

export interface Scenario {
  name: string;
  description: string;
  trajectory: Trajectory;
  chirp: ChirpSpec;
  intrinsics: CameraIntrinsics;
  micBaselineM: number;
  knownHeightM: number;
  classLabel: string;
  acoustic: AcousticImpairments;
  visual: VisualImpairments;
  durationS: number;
  acousticRateHz: number;
  visualRateHz: number;
  pipelineOpts?: PipelineOpts;
  ekfOptions?: Partial<EkfOptions>;
  expect: ScenarioExpectations;
}

const CHIRP: ChirpSpec = {
  fStart: hz(18500),
  fEnd: hz(21500),
  durationS: 0.04,
  fs: sampleRate(48000),
};

const K: CameraIntrinsics = {
  fx: 1000,
  fy: 1000,
  cx: 640,
  cy: 360,
  width: 1280,
  height: 720,
};

// A target walking across the field of view, slowly approaching.
const WALK = linearTrajectory({ x: 0.3, y: 0.0, z: 3.0 }, { x: 0.2, y: 0.0, z: -0.15 });

const BASE = {
  trajectory: WALK,
  chirp: CHIRP,
  intrinsics: K,
  micBaselineM: 0.1,
  knownHeightM: 1.7,
  classLabel: "person",
  durationS: 4,
  acousticRateHz: 25,
  visualRateHz: 15,
  ekfOptions: { sigmaA: 1.0 } as Partial<EkfOptions>,
};

export const SCENARIOS: Record<string, Scenario> = {
  ideal: {
    ...BASE,
    name: "ideal",
    description: "Clean sonar + confident vision, ideal lighting.",
    acoustic: { attenuation: 1, noiseStd: 0.02 },
    visual: { pixelNoiseStd: 2, bboxHeightNoiseFrac: 0.03, confidence: 0.95 },
    pipelineOpts: { clutter: false },
    expect: { meanErrorM: 0.1, jitterStdM: 0.05 },
  },
  noisy: {
    ...BASE,
    name: "noisy",
    description: "High acoustic background noise; vision still confident.",
    acoustic: { attenuation: 1, noiseStd: 0.25 },
    visual: { pixelNoiseStd: 3, bboxHeightNoiseFrac: 0.05, confidence: 0.9 },
    pipelineOpts: { clutter: false },
    expect: { meanErrorM: 0.15, jitterStdM: 0.06 },
  },
  lowLight: {
    ...BASE,
    name: "lowLight",
    description: "Vision largely fails (frequent dropout); sonar carries tracking.",
    acoustic: { attenuation: 1, noiseStd: 0.05 },
    visual: { pixelNoiseStd: 6, bboxHeightNoiseFrac: 0.12, lowLightDropoutProb: 0.8, confidence: 0.3 },
    pipelineOpts: { clutter: false },
    expect: { meanErrorM: 0.22 },
  },
  occlusion: {
    ...BASE,
    name: "occlusion",
    description: "Target visually occluded for 1 s; EKF coasts on sonar, then re-acquires.",
    acoustic: { attenuation: 1, noiseStd: 0.05 },
    visual: { pixelNoiseStd: 3, bboxHeightNoiseFrac: 0.05, occlusionWindows: [[1.5, 2.5]], confidence: 0.9 },
    pipelineOpts: { clutter: false },
    expect: { meanErrorM: 0.16 },
  },
  multipath: {
    ...BASE,
    name: "multipath",
    description: "Strong static wall reflections; clutter cancel + NIS gating reject ghosts.",
    acoustic: {
      attenuation: 1,
      noiseStd: 0.05,
      multipath: [
        { rangeM: 4.2, amplitude: 1.6 },
        { rangeM: 5.0, amplitude: 1.2 },
      ],
    },
    visual: { pixelNoiseStd: 3, bboxHeightNoiseFrac: 0.05, confidence: 0.9 },
    pipelineOpts: { clutter: true, clutterAlpha: 0.9 },
    expect: { meanErrorM: 0.2 },
  },
  carrierDrift: {
    ...BASE,
    name: "carrierDrift",
    description: "DAC/ADC clock drift adds a sonar range bias; fusion leans on vision.",
    acoustic: { attenuation: 1, noiseStd: 0.05, carrierDriftHz: 40 },
    visual: { pixelNoiseStd: 3, bboxHeightNoiseFrac: 0.05, confidence: 0.9 },
    pipelineOpts: { clutter: false },
    expect: { meanErrorM: 0.25 },
  },
};

export const SCENARIO_NAMES = Object.keys(SCENARIOS);

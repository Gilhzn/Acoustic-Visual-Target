import { describe, it, expect } from "vitest";
import {
  postureFromKeypoints,
  bboxFromKeypoints,
  type Keypoint,
} from "../src/tracking/poseClassifier.js";

const k = (name: string, x: number, y: number, score = 0.9): Keypoint => ({ name, x, y, score });

/** Both left/right of a joint at the same point (so the average is the same point). */
function joint(prefix: string, x: number, y: number, score = 0.9): Keypoint[] {
  return [k(`left_${prefix}`, x, y, score), k(`right_${prefix}`, x, y, score)];
}

describe("postureFromKeypoints", () => {
  it("classifies a vertically extended figure as standing", () => {
    const kps = [
      ...joint("shoulder", 100, 100),
      ...joint("hip", 100, 200),
      ...joint("knee", 100, 300),
      ...joint("ankle", 100, 400),
    ];
    expect(postureFromKeypoints(kps)).toBe("standing");
  });

  it("classifies a figure with thigh collapsed (knees at hip level) as sitting", () => {
    const kps = [
      ...joint("shoulder", 100, 100),
      ...joint("hip", 100, 200),
      ...joint("knee", 130, 210), // knee y barely below hip y
      ...joint("ankle", 130, 300),
    ];
    expect(postureFromKeypoints(kps)).toBe("sitting");
  });

  it("classifies a horizontally spread figure as lying", () => {
    const kps = [
      ...joint("shoulder", 100, 200),
      ...joint("hip", 200, 200),
      ...joint("knee", 300, 200),
      ...joint("ankle", 400, 200),
    ];
    expect(postureFromKeypoints(kps)).toBe("lying");
  });

  it("returns unknown when shoulder or hip keypoints are missing/low-confidence", () => {
    const kps = [
      k("nose", 100, 50, 0.9),
      ...joint("shoulder", 100, 100, 0.1), // too low to count
    ];
    expect(postureFromKeypoints(kps)).toBe("unknown");
  });

  it("guesses standing when only the upper body is visible", () => {
    const kps = [...joint("shoulder", 100, 100), ...joint("hip", 100, 200)];
    expect(postureFromKeypoints(kps)).toBe("standing");
  });
});

describe("bboxFromKeypoints", () => {
  it("returns the tight bbox around the confident keypoints", () => {
    const kps = [
      k("a", 50, 80, 0.9),
      k("b", 150, 120, 0.9),
      k("c", 90, 30, 0.9),
      k("d", 999, 999, 0.1), // ignored — too low score
    ];
    expect(bboxFromKeypoints(kps)).toEqual([50, 30, 150, 120]);
  });

  it("returns a zero bbox when no keypoint is confident enough", () => {
    expect(bboxFromKeypoints([k("a", 0, 0, 0.05)])).toEqual([0, 0, 0, 0]);
  });
});

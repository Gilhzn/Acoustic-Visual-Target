import { describe, it, expect } from "vitest";
import { selectPipeline, detectCapabilities, type DeviceCapabilities } from "../src/vision/capability.js";

const full: DeviceCapabilities = {
  webxr: true,
  webxrCameraAccess: true,
  getUserMedia: true,
  webgpu: true,
  sharedArrayBuffer: true,
  audioWorklet: true,
};

describe("selectPipeline", () => {
  it("prefers WebXR raw camera + WebGPU + SAB when fully capable", () => {
    const s = selectPipeline(full);
    expect(s.cameraMode).toBe("webxr-raw");
    expect(s.inferenceBackend).toBe("webgpu");
    expect(s.audioTransport).toBe("sab");
    expect(s.forceWebGLLayer).toBe(true);
  });

  it("falls back to getUserMedia when raw camera access is missing", () => {
    const s = selectPipeline({ ...full, webxrCameraAccess: false });
    expect(s.cameraMode).toBe("getusermedia");
    expect(s.forceWebGLLayer).toBe(false);
  });

  it("falls back to WebGL inference without WebGPU", () => {
    const s = selectPipeline({ ...full, webgpu: false });
    expect(s.inferenceBackend).toBe("webgl");
    expect(s.notes.some((n) => n.includes("WebGPU"))).toBe(true);
  });

  it("uses postMessage transport without SharedArrayBuffer", () => {
    const s = selectPipeline({ ...full, sharedArrayBuffer: false });
    expect(s.audioTransport).toBe("postmessage");
  });

  it("reports sonar-only when no camera is available", () => {
    const s = selectPipeline({ ...full, webxr: false, webxrCameraAccess: false, getUserMedia: false });
    expect(s.cameraMode).toBe("none");
  });
});

describe("detectCapabilities", () => {
  it("runs without throwing in a non-browser environment", () => {
    const caps = detectCapabilities();
    expect(typeof caps.webxr).toBe("boolean");
    expect(typeof caps.audioWorklet).toBe("boolean");
  });
});

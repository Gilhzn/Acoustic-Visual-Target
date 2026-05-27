/**
 * Runtime capability detection and pipeline selection.
 *
 * `selectPipeline` is a pure decision function (unit-tested); `detectCapabilities`
 * probes the live browser. We feature-detect everything rather than pinning to
 * browser versions — the WebGL-layer fallback is chosen from observed support,
 * never from a hard-coded Chrome version.
 */
export interface DeviceCapabilities {
  webxr: boolean;
  webxrCameraAccess: boolean;
  getUserMedia: boolean;
  webgpu: boolean;
  sharedArrayBuffer: boolean;
  audioWorklet: boolean;
}

export type CameraMode = "webxr-raw" | "getusermedia" | "none";
export type InferenceBackend = "webgpu" | "webgl" | "wasm";
export type AudioTransport = "sab" | "postmessage";

export interface PipelineSelection {
  cameraMode: CameraMode;
  inferenceBackend: InferenceBackend;
  audioTransport: AudioTransport;
  /** Use a classic XRWebGLLayer instead of projection layers (raw-camera path). */
  forceWebGLLayer: boolean;
  notes: string[];
}

export interface SelectOpts {
  /** Prefer the XRWebGLLayer path when raw camera access is used. */
  preferWebGLLayerForRawCamera?: boolean;
}

export function selectPipeline(
  caps: DeviceCapabilities,
  opts: SelectOpts = {},
): PipelineSelection {
  const notes: string[] = [];

  let cameraMode: CameraMode;
  if (caps.webxr && caps.webxrCameraAccess) {
    cameraMode = "webxr-raw";
  } else if (caps.getUserMedia) {
    cameraMode = "getusermedia";
    if (caps.webxr) notes.push("WebXR present but no raw camera access; using getUserMedia overlay.");
  } else {
    cameraMode = "none";
    notes.push("No camera access; running sonar-only (no visual disambiguation).");
  }

  const inferenceBackend: InferenceBackend = caps.webgpu ? "webgpu" : "webgl";
  if (!caps.webgpu) notes.push("WebGPU unavailable; falling back to WebGL inference.");

  const audioTransport: AudioTransport = caps.sharedArrayBuffer ? "sab" : "postmessage";
  if (!caps.sharedArrayBuffer)
    notes.push("SharedArrayBuffer unavailable (no cross-origin isolation); using postMessage transport.");

  if (!caps.audioWorklet) notes.push("AudioWorklet unavailable; acoustic tracking disabled.");

  const forceWebGLLayer = cameraMode === "webxr-raw" && (opts.preferWebGLLayerForRawCamera ?? true);

  return { cameraMode, inferenceBackend, audioTransport, forceWebGLLayer, notes };
}

/** Probe the live environment. Safe to call anywhere (only reads globals). */
export function detectCapabilities(): DeviceCapabilities {
  const nav = typeof navigator !== "undefined" ? navigator : ({} as Navigator);
  const xr = nav.xr;
  return {
    webxr: typeof xr !== "undefined" && xr !== null,
    // Raw camera access is reported per-session; we optimistically assume it if
    // WebXR exists and refine after requesting the session features.
    webxrCameraAccess: typeof xr !== "undefined" && xr !== null,
    getUserMedia:
      typeof nav.mediaDevices !== "undefined" &&
      typeof nav.mediaDevices.getUserMedia === "function",
    webgpu: typeof navigator !== "undefined" && "gpu" in navigator,
    sharedArrayBuffer:
      typeof SharedArrayBuffer !== "undefined" &&
      (typeof self === "undefined" || (self as { crossOriginIsolated?: boolean }).crossOriginIsolated !== false),
    audioWorklet:
      typeof AudioWorklet !== "undefined" || typeof globalThis.AudioContext !== "undefined",
  };
}

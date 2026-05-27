import { hz, sampleRate, seconds } from "@avt/core-units";
import {
  KNOWN_OBJECT_HEIGHTS_M,
  type AcousticMeasurement,
  type CameraIntrinsics,
  type Detection,
  type TelemetrySnapshot,
  type VisualMeasurement,
} from "@avt/contracts";
import type { ChirpSpec } from "@avt/dsp";
import { FusionCore, depthFromSize } from "@avt/fusion";
import { AcousticTracker } from "./audio/AcousticTracker.js";
import { GumCameraSource } from "./vision/GumCameraSource.js";
import { TfjsDetector } from "./vision/TfjsDetector.js";
import { detectCapabilities, selectPipeline } from "./vision/capability.js";
import { isImmersiveArSupported, requestArSession, sessionHasCameraAccess } from "./vision/webxr.js";
import { ArScene } from "./render/ArScene.js";
import { Overlay } from "./render/Overlay.js";
import { Waterfall } from "./render/Waterfall.js";
import { RenderAdapter } from "./render/RenderAdapter.js";
import { createDefaultCouncil } from "./agents/index.js";

const CHIRP: ChirpSpec = {
  fStart: hz(18500),
  fEnd: hz(21500),
  durationS: 0.04,
  fs: sampleRate(48000),
};

const VISUAL_RATE_HZ = 15;

function makeIntrinsics(w: number, h: number): CameraIntrinsics {
  const hfov = (60 * Math.PI) / 180;
  const fx = 0.5 * w / Math.tan(hfov / 2);
  return { fx, fy: fx, cx: w / 2, cy: h / 2, width: w, height: h };
}

function knownHeight(label: string): number {
  return KNOWN_OBJECT_HEIGHTS_M[label] ?? KNOWN_OBJECT_HEIGHTS_M.default;
}

function detectionToVisual(d: Detection, K: CameraIntrinsics, tSec: number): VisualMeasurement {
  const [x0, y0, x1, y1] = d.bbox;
  const u = (x0 + x1) / 2;
  const v = (y0 + y1) / 2;
  const depth = depthFromSize(y1 - y0, knownHeight(d.classLabel), K.fy);
  return {
    u,
    v,
    depthM: depth as VisualMeasurement["depthM"],
    confidence: d.score,
    classLabel: d.classLabel,
    tSec: seconds(tSec),
    valid: true,
  };
}

function bestDetection(dets: Detection[]): Detection | null {
  let best: Detection | null = null;
  for (const d of dets) if (!best || d.score > best.score) best = d;
  return best;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function run(): Promise<void> {
  const hud = document.getElementById("hud") as HTMLElement;
  const arCanvas = document.getElementById("ar-canvas") as HTMLCanvasElement;
  const overlayCanvas = document.getElementById("overlay-canvas") as HTMLCanvasElement;
  const waterfallCanvas = document.getElementById("waterfall") as HTMLCanvasElement;

  const caps = detectCapabilities();
  const sel = selectPipeline(caps);

  // --- Camera + detector ---
  const camera = new GumCameraSource();
  await camera.start();
  const K = makeIntrinsics(camera.width, camera.height);

  const detector = new TfjsDetector({ backend: sel.inferenceBackend });
  hud.textContent = "warming up detector…";
  await detector.warmup();

  // --- Scene ---
  const scene = new ArScene(arCanvas);
  const overlay = new Overlay(overlayCanvas);
  const waterfall = new Waterfall(waterfallCanvas);
  const render = new RenderAdapter(scene, overlay, waterfall, hud);
  render.setCameraSize(camera.width, camera.height);
  window.addEventListener("resize", () => overlay.resize());

  // WebXR passthrough if available; otherwise composite the camera video.
  let usingXR = false;
  if (sel.cameraMode === "webxr-raw" && (await isImmersiveArSupported())) {
    try {
      const session = await requestArSession({ domOverlayRoot: document.getElementById("overlay") ?? undefined, cameraAccess: true });
      scene.setForceWebGLLayer(sel.forceWebGLLayer && !sessionHasCameraAccess(session));
      await scene.enterXR(session);
      usingXR = true;
    } catch {
      usingXR = false;
    }
  }
  if (!usingXR && camera.element) scene.setVideoBackground(camera.element);

  // --- Fusion + council ---
  const fusion = new FusionCore({ intrinsics: K, ekf: { sigmaA: 1.2 } });
  const council = createDefaultCouncil();

  const t0 = performance.now();
  const now = (): number => (performance.now() - t0) / 1000;

  let lastConfidence = 0;
  let inferenceMs = 0;
  let fps = 60;
  let lastFrameTime = now();

  // --- Acoustic capture ---
  const acoustic = new AcousticTracker({
    spec: CHIRP,
    engine: { profileBins: 96, pipeline: { micBaselineM: 0.1 } },
    onMeasurement: (m: AcousticMeasurement) => {
      const stamped: AcousticMeasurement = { ...m, tSec: seconds(now()) };
      fusion.onAcoustic(stamped, council.state.fusion.rAcousticAzScale);
    },
    onProfile: (mags) => render.onProfile(mags),
  });
  try {
    await acoustic.start();
  } catch {
    hud.textContent += "\n(no microphone — vision-only)";
  }

  // --- Detection loop (decoupled from render) ---
  let running = true;
  (async () => {
    while (running) {
      const frame = camera.latestFrame();
      if (frame) {
        const t = now();
        if (council.state.vision.restrictToEllipse && fusion.initialized && !fusion.visuallyTracked) {
          const e = fusion.searchEllipse();
          if (e?.valid) {
            const half = Math.max(e.semiMajor, 60) + 40;
            detector.setRoi([
              Math.max(0, e.centerU - half),
              Math.max(0, e.centerV - half),
              Math.min(camera.width, 2 * half),
              Math.min(camera.height, 2 * half),
            ]);
          }
        } else {
          detector.setRoi(null);
        }
        const t1 = performance.now();
        const dets = await detector.detect(frame);
        inferenceMs = performance.now() - t1;
        render.onDetections(dets);
        const best = bestDetection(dets);
        if (best) {
          lastConfidence = best.score;
          const vm = detectionToVisual(best, K, t);
          if (!fusion.initialized) fusion.initFromVisual(vm);
          else fusion.onVisual(vm, t);
        } else if (fusion.initialized) {
          fusion.onVisual(null, t);
        }
      }
      await sleep(1000 / VISUAL_RATE_HZ);
    }
  })().catch((e) => console.error(e));

  // --- Council loop ---
  const battery = await getBatteryFraction();
  setInterval(() => {
    const tele: TelemetrySnapshot = {
      tSec: now(),
      acoustic: { adcSaturationFrac: 0, outOfBandNoiseDb: -80, carrierSnrDb: 20 },
      vision: { inferenceMs, iou: fusion.visuallyTracked ? 0.7 : 0.2, gpuMemFrac: 0.5, detectionConfidence: lastConfidence },
      fusion: { nis: fusion.lastNis, nisDof: 2, velocityVariance: speedVar(fusion), visualConfidence: lastConfidence },
      render: { frameDtMs: 1000 / Math.max(fps, 1), fps, coreTempC: 35, batteryFrac: battery(), contextLost: false },
      tracking: { spatialErrorM: NaN, jitterStd: 0 },
    };
    council.tick(tele);
    scene.setPixelRatio(council.state.render.dpr);
    acoustic.setTxGain(council.state.acoustic.speakerGain);
  }, 1000);

  // --- Render loop ---
  scene.setLoop(() => {
    const t = now();
    const dt = t - lastFrameTime;
    lastFrameTime = t;
    if (dt > 0) fps = fps * 0.9 + 0.1 / dt;

    fusion.predictTo(t);
    const ts = fusion.toTrackState();
    render.onTrack(ts);
    render.onSearchEllipse(fusion.initialized && !fusion.visuallyTracked ? fusion.searchEllipse() : null);

    const p = ts.position;
    const range = Math.hypot(p.x, p.y, p.z);
    render.tick(
      [
        `mode: ${usingXR ? "WebXR AR" : "camera overlay"}  backend: ${detector.activeBackend}`,
        `transport: ${sel.audioTransport}  azimuth: ${acoustic.azimuthAvailable ? "dual-mic" : "vision-only"}`,
        `target: ${ts.tracked ? ts.classLabel : "—"}  range: ${range.toFixed(2)} m`,
        `pos[m] x:${p.x.toFixed(2)} y:${p.y.toFixed(2)} z:${p.z.toFixed(2)}  fps:${fps.toFixed(0)}`,
        `conf:${(lastConfidence * 100).toFixed(0)}%  unc:${ts.posUncertainty.toFixed(2)}  inf:${inferenceMs.toFixed(0)}ms`,
      ].join("\n"),
    );
  });

  window.addEventListener("pagehide", () => {
    running = false;
    void acoustic.stop();
    void camera.stop();
    scene.dispose();
  });
}

function speedVar(fusion: FusionCore): number {
  const v = fusion.velocity();
  return v.x * v.x + v.y * v.y + v.z * v.z;
}

async function getBatteryFraction(): Promise<() => number> {
  type BatteryNav = Navigator & { getBattery?: () => Promise<{ level: number }> };
  const nav = navigator as BatteryNav;
  if (nav.getBattery) {
    try {
      const b = await nav.getBattery();
      return () => b.level;
    } catch {
      /* fall through */
    }
  }
  return () => 1;
}

// --- Boot ---
const startScreen = document.getElementById("start");
const startBtn = document.getElementById("start-btn");
startBtn?.addEventListener("click", () => {
  startScreen?.classList.add("hidden");
  run().catch((err) => {
    const hud = document.getElementById("hud");
    if (hud) hud.textContent = `error: ${err instanceof Error ? err.message : String(err)}`;
    console.error(err);
  });
});

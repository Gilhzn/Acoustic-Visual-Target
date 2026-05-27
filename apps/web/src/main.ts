import { hz, sampleRate, seconds } from "@avt/core-units";
import {
  KNOWN_OBJECT_HEIGHTS_M,
  type AcousticMeasurement,
  type CameraIntrinsics,
  type Detection,
  type TelemetrySnapshot,
  type TrackState,
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
import { Hud, type HudView, type TrackingState } from "./render/Hud.js";
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

interface HudExtras {
  confidence: number;
  fps: number;
  backend: string;
  transport: string;
  azimuthMode: string;
  detCount: number;
  camInfo: string;
}

/** Translate raw fused state into clear, human-readable HUD values. */
function buildHudView(ts: TrackState, fusion: FusionCore, x: HudExtras): HudView {
  if (!fusion.initialized) {
    return {
      state: "searching",
      targetLabel: "—",
      distanceM: null,
      azimuthDeg: null,
      motion: null,
      confidence: 0,
      lock: null,
      fps: x.fps,
      backend: x.backend,
      transport: x.transport,
      azimuthMode: x.azimuthMode,
      detCount: x.detCount,
      camInfo: x.camInfo,
    };
  }
  const p = ts.position;
  const v = ts.velocity;
  const dist = Math.hypot(p.x, p.y, p.z);
  const azimuthDeg = (Math.atan2(p.x, p.z) * 180) / Math.PI;
  const radial = dist > 1e-3 ? (v.x * p.x + v.y * p.y + v.z * p.z) / dist : 0;
  const motion: HudView["motion"] = radial < -0.05 ? "approaching" : radial > 0.05 ? "receding" : "steady";
  const lockStd = Math.sqrt(Math.max(ts.posUncertainty, 0));
  const state: TrackingState = lockStd > 1.5 ? "lost" : fusion.visuallyTracked ? "tracking" : "sonar";
  const lock: HudView["lock"] = lockStd < 0.15 ? "strong" : lockStd < 0.4 ? "medium" : "weak";
  return {
    state,
    targetLabel: ts.classLabel,
    distanceM: dist,
    azimuthDeg,
    motion,
    confidence: x.confidence,
    lock,
    fps: x.fps,
    backend: x.backend,
    transport: x.transport,
    azimuthMode: x.azimuthMode,
    detCount: x.detCount,
    camInfo: x.camInfo,
  };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function run(hud: Hud): Promise<void> {
  const arCanvas = document.getElementById("ar-canvas") as HTMLCanvasElement;
  const overlayCanvas = document.getElementById("overlay-canvas") as HTMLCanvasElement;
  const waterfallCanvas = document.getElementById("waterfall") as HTMLCanvasElement;

  const caps = detectCapabilities();
  const sel = selectPipeline(caps);

  // --- Camera + detector ---
  hud.setStatusText("Requesting camera…");
  const camera = new GumCameraSource();
  await camera.start();
  hud.setSensors(true, false);
  const K = makeIntrinsics(camera.width, camera.height);

  const detector = new TfjsDetector({ backend: "webgl", minScore: 0.4 });
  hud.setStatusText("Loading detector…");
  await detector.warmup();

  // --- Scene ---
  const scene = new ArScene(arCanvas);
  const overlay = new Overlay(overlayCanvas);
  const waterfall = new Waterfall(waterfallCanvas);
  const render = new RenderAdapter(scene, overlay, waterfall);
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
  if (!usingXR && camera.element) {
    // Show the live camera as a real DOM background (reliable; guarantees
    // frames flow to the detector). The transparent AR canvas sits on top.
    const vid = camera.element;
    vid.id = "cam-bg";
    document.getElementById("app")?.prepend(vid);
  }

  // --- Fusion + council ---
  const fusion = new FusionCore({ intrinsics: K, ekf: { sigmaA: 1.2 } });
  const council = createDefaultCouncil();

  const t0 = performance.now();
  const now = (): number => (performance.now() - t0) / 1000;

  let lastConfidence = 0;
  let lastDetCount = 0;
  let camW = camera.width;
  let camH = camera.height;
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
  let sonarActive = true;
  try {
    await acoustic.start();
  } catch {
    sonarActive = false;
  }
  hud.setSensors(true, sonarActive);

  // --- Detection loop (decoupled from render; resilient to per-frame errors) ---
  let running = true;
  (async () => {
    while (running) {
      try {
        const frame = camera.latestFrame();
        if (frame) {
          const t = now();
          camW = frame.width;
          camH = frame.height;
          render.setCameraSize(camW, camH);
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
          lastDetCount = dets.length;
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
      } catch (e) {
        // Never let one bad frame kill the loop; surface it for diagnosis.
        console.error("detection step failed:", e);
      }
      await sleep(1000 / VISUAL_RATE_HZ);
    }
  })();

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
    render.tick();
    hud.update(
      buildHudView(ts, fusion, {
        confidence: lastConfidence,
        fps,
        backend: detector.activeBackend,
        transport: sel.audioTransport,
        azimuthMode: acoustic.azimuthAvailable ? "dual-mic" : "vision-only",
        detCount: lastDetCount,
        camInfo: `${camW}×${camH}`,
      }),
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
  const hud = new Hud();
  run(hud).catch((err) => {
    hud.showError(err instanceof Error ? err.message : String(err));
    console.error(err);
  });
});

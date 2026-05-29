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
import { PoseDetector } from "./vision/PoseDetector.js";
import { detectCapabilities, selectPipeline } from "./vision/capability.js";
import { isImmersiveArSupported, requestArSession, sessionHasCameraAccess } from "./vision/webxr.js";
import { ArScene } from "./render/ArScene.js";
import { Overlay } from "./render/Overlay.js";
import { Waterfall } from "./render/Waterfall.js";
import { RenderAdapter } from "./render/RenderAdapter.js";
import { Minimap } from "./render/Minimap.js";
import { Hud, type HudView, type TrackingState } from "./render/Hud.js";
import { coverFit } from "./render/visuals.js";
import { GyroSource } from "./sensors/GyroSource.js";
import { MultiTracker, type TrackedPerson } from "./tracking/MultiTracker.js";
import { PersonRegistry } from "./tracking/PersonRegistry.js";
import { applyI18n, initLang, onLangChange, t } from "./i18n/i18n.js";
import { Menu } from "./ui/Menu.js";
import { AnalysisView } from "./ui/AnalysisView.js";
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

/** Plausible indoor range bounds (m) for monocular depth + the EKF. */
const MIN_RANGE_M = 0.3;
const MAX_RANGE_M = 12;

function detectionToVisual(d: Detection, K: CameraIntrinsics, tSec: number): VisualMeasurement {
  const [x0, y0, x1, y1] = d.bbox;
  const u = (x0 + x1) / 2;
  const v = (y0 + y1) / 2;
  const rawDepth = depthFromSize(y1 - y0, knownHeight(d.classLabel), K.fy);
  const depth = Math.min(Math.max(rawDepth, MIN_RANGE_M), MAX_RANGE_M);
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

interface HudExtras {
  confidence: number;
  fps: number;
  backend: string;
  transport: string;
  azimuthMode: string;
  detCount: number;
  camInfo: string;
  alive: boolean;
  breathingBpm: number;
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
      alive: x.alive,
      breathingBpm: x.breathingBpm,
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
    alive: x.alive,
    breathingBpm: x.breathingBpm,
  };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function run(hud: Hud): Promise<void> {
  const arCanvas = document.getElementById("ar-canvas") as HTMLCanvasElement;
  const overlayCanvas = document.getElementById("overlay-canvas") as HTMLCanvasElement;
  const waterfallCanvas = document.getElementById("waterfall") as HTMLCanvasElement;

  const caps = detectCapabilities();
  const sel = selectPipeline(caps);

  // --- Motion (gyro) — request first while still in the user gesture (iOS) ---
  const gyro = new GyroSource();
  const motionOk = await gyro.start();

  // --- Camera + detector ---
  hud.setStatusText("Requesting camera…");
  const camera = new GumCameraSource();
  await camera.start();
  hud.setSensors(true, false, motionOk);
  const K = makeIntrinsics(camera.width, camera.height);

  const detector = new TfjsDetector({ backend: "webgl", minScore: 0.4 });
  hud.setStatusText("Loading detector…");
  await detector.warmup();
  // MoveNet adds joint-level posture; failure to load is non-fatal (we fall
  // back to bbox-aspect posture).
  const poseDetector = new PoseDetector();
  let poseEnabled = false;
  try {
    await poseDetector.warmup();
    poseEnabled = true;
  } catch (e) {
    console.warn("pose detector unavailable, falling back to bbox posture", e);
  }

  // --- Scene ---
  const scene = new ArScene(arCanvas);
  const overlay = new Overlay(overlayCanvas);
  const waterfall = new Waterfall(waterfallCanvas);
  const minimapCanvas = document.getElementById("minimap") as HTMLCanvasElement;
  const minimap = new Minimap(minimapCanvas, MAX_RANGE_M);
  const render = new RenderAdapter(scene, overlay, waterfall, minimap);
  render.setCameraSize(camera.width, camera.height);
  window.addEventListener("resize", () => overlay.resize());

  // --- Multi-person tracker + persistent name/history registry ---
  const tracker = new MultiTracker({ K, maxRangeM: MAX_RANGE_M });
  const registry = new PersonRegistry();
  const peopleList = document.getElementById("people-list") as HTMLElement;
  let peopleListLast = 0;

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
  const fusion = new FusionCore({
    intrinsics: K,
    ekf: { sigmaA: 0.8 },
    maxRangeM: MAX_RANGE_M,
    maxSpeed: 4,
  });
  const council = createDefaultCouncil();

  const t0 = performance.now();
  const now = (): number => (performance.now() - t0) / 1000;

  let lastConfidence = 0;
  let lastDetCount = 0;
  let camW = camera.width;
  let camH = camera.height;
  let lastAlive = false;
  let lastBpm = 0;
  let lastTracks: TrackedPerson[] = [];
  let lastPrimaryId: string | null = null;
  let inferenceMs = 0;
  let fps = 60;
  let lastFrameTime = now();

  // --- Acoustic capture (with breathing / life-sign detection) ---
  const acoustic = new AcousticTracker({
    spec: CHIRP,
    engine: { profileBins: 96, pipeline: { micBaselineM: 0.1, breathing: true } },
    onMeasurement: (m: AcousticMeasurement) => {
      const stamped: AcousticMeasurement = { ...m, tSec: seconds(now()) };
      // Trust sonar range more when its SNR is high (5.7 cm physical resolution
      // beats monocular depth there); inflate when the echo is weak.
      const snr = m.snrDb as number;
      const rangeScale = snr >= 18 ? 0.6 : snr >= 12 ? 1.0 : snr >= 6 ? 1.8 : 4.0;
      fusion.onAcoustic(stamped, council.state.fusion.rAcousticAzScale, rangeScale);
      lastAlive = m.alive ?? false;
      lastBpm = m.breathingRateBpm ?? 0;
    },
    onProfile: (mags) => render.onProfile(mags),
  });
  let sonarActive = true;
  try {
    await acoustic.start();
  } catch {
    sonarActive = false;
  }
  hud.setSensors(true, sonarActive, motionOk);

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
          lastTracks = tracker.update(dets, t);
          if (poseEnabled) {
            try {
              const poses = await poseDetector.detect(frame);
              tracker.applyPoses(poses);
            } catch (e) {
              // Don't kill detection if a single pose call hiccups.
              console.warn("pose step failed:", e);
            }
          }
          const primary = tracker.primary();
          lastPrimaryId = primary?.id ?? null;
          render.onPersons(lastTracks, lastPrimaryId);
          if (primary) {
            lastConfidence = primary.confidence;
            const vm = detectionToVisual(
              { bbox: primary.bbox, score: primary.confidence, classLabel: primary.classLabel },
              K,
              t,
            );
            if (!fusion.initialized) fusion.initFromVisual(vm);
            else fusion.onVisual(vm, t);
            if (primary.name) {
              registry.appendSample(primary.name, {
                tSec: t,
                x: primary.position.x,
                z: primary.position.z,
                distanceM: primary.distanceM,
                azimuthDeg: primary.azimuthDeg,
                posture: primary.posture,
                activity: primary.activity,
                breathingBpm: lastAlive ? lastBpm : undefined,
              });
            }
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

  // --- Tap-to-name dialog ---
  const dialog = document.getElementById("name-dialog") as HTMLElement;
  const nameInput = document.getElementById("name-input") as HTMLInputElement;
  const nameWho = document.getElementById("name-who") as HTMLElement;
  const heightInput = document.getElementById("height-input") as HTMLInputElement;
  let dialogTarget: TrackedPerson | null = null;
  const openDialog = (trk: TrackedPerson): void => {
    dialogTarget = trk;
    nameWho.textContent = `${trk.classLabel} · ${trk.distanceM.toFixed(1)} m · ${trk.posture}`;
    nameInput.value = trk.name ?? "";
    // Pre-fill height from a saved record if the track already has a name.
    const knownH = trk.heightOverrideM ?? (trk.name ? registry.get(trk.name)?.heightM : undefined);
    heightInput.value = knownH ? String(Math.round(knownH * 100)) : "";
    dialog.classList.remove("hidden");
    setTimeout(() => nameInput.focus(), 30);
  };
  const closeDialog = (): void => {
    dialog.classList.add("hidden");
    dialogTarget = null;
  };
  document.getElementById("name-cancel")?.addEventListener("click", closeDialog);
  document.getElementById("name-save")?.addEventListener("click", () => {
    if (!dialogTarget) return closeDialog();
    const n = nameInput.value.trim();
    const cm = parseFloat(heightInput.value);
    let heightM: number | undefined;
    if (Number.isFinite(cm) && cm >= 40 && cm <= 230) heightM = cm / 100;
    if (n) {
      // Inherit a previously-saved height for this name if the user didn't enter one.
      if (heightM === undefined) heightM = registry.get(n)?.heightM;
      tracker.setName(dialogTarget.id, n, heightM);
      const rec = registry.ensure(n);
      if (heightM !== undefined) rec.heightM = heightM;
      registry.save();
    }
    closeDialog();
  });
  document.getElementById("name-clear")?.addEventListener("click", () => {
    if (dialogTarget) tracker.setName(dialogTarget.id, null);
    closeDialog();
  });
  overlayCanvas.addEventListener("click", (ev) => {
    const rect = overlayCanvas.getBoundingClientRect();
    const xScreen = ev.clientX - rect.left;
    const yScreen = ev.clientY - rect.top;
    const fit = coverFit(camW, camH, window.innerWidth, window.innerHeight);
    const u = (xScreen - fit.ox) / fit.s;
    const v = (yScreen - fit.oy) / fit.s;
    const hit = tracker.findAtPixel(u, v);
    if (hit) openDialog(hit);
  });

  // Persist the registry periodically so identities + history survive reloads.
  setInterval(() => registry.save(), 5000);
  window.addEventListener("pagehide", () => registry.save());

  /** Render the named-people side panel (throttled). */
  const updatePeopleList = (): void => {
    const tt = now();
    if (tt - peopleListLast < 0.25) return;
    peopleListLast = tt;
    peopleList.innerHTML = "";
    for (const trk of lastTracks) {
      const row = document.createElement("div");
      row.className = "person-row" + (trk.id === lastPrimaryId ? " primary" : "");
      const who = document.createElement("span");
      who.className = "who";
      who.textContent = trk.name ?? trk.id;
      const meta = document.createElement("span");
      meta.className = "meta";
      meta.textContent = `${trk.distanceM.toFixed(1)}m · ${t(`posture.${trk.posture}`)}`;
      row.appendChild(who);
      row.appendChild(meta);
      peopleList.appendChild(row);
    }
  };

  // --- Menu drawer + analysis view ---
  const menu = new Menu();
  const analysisView = new AnalysisView(registry);
  analysisView.bind(
    () => lastTracks,
    (p) => openDialog(p),
    () => menu.setView("main"),
  );
  menu.onView((v) => {
    if (v === "analysis") analysisView.show();
    else analysisView.hide();
  });
  setInterval(() => analysisView.render(), 500);
  onLangChange(() => updatePeopleList());

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
    if (gyro.available) scene.setUpright(gyro.gamma);
    const ts = fusion.toTrackState();
    render.onTrack(ts);
    render.onSearchEllipse(fusion.initialized && !fusion.visuallyTracked ? fusion.searchEllipse() : null);
    render.tick();
    updatePeopleList();
    hud.update(
      buildHudView(ts, fusion, {
        confidence: lastConfidence,
        fps,
        backend: detector.activeBackend,
        transport: sel.audioTransport,
        azimuthMode: acoustic.azimuthAvailable ? "dual-mic" : "vision-only",
        detCount: lastDetCount,
        camInfo: `${camW}×${camH}`,
        alive: lastAlive,
        breathingBpm: lastBpm,
      }),
    );
  });

  window.addEventListener("pagehide", () => {
    running = false;
    void acoustic.stop();
    void camera.stop();
    gyro.stop();
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
initLang();
applyI18n();
onLangChange(() => applyI18n());

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

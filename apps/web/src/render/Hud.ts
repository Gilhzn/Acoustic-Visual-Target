export type TrackingState = "init" | "searching" | "tracking" | "sonar" | "lost";

export interface HudView {
  state: TrackingState;
  targetLabel: string;
  distanceM: number | null;
  /** Signed azimuth in degrees (+ = right of center). */
  azimuthDeg: number | null;
  motion: "approaching" | "receding" | "steady" | null;
  confidence: number; // 0..1
  lock: "strong" | "medium" | "weak" | null;
  fps: number;
  backend: string;
  transport: string;
  azimuthMode: string;
}

/** Half horizontal field-of-view (deg) the direction gauge spans each side. */
const GAUGE_FOV = 35;

const STATUS_TEXT: Record<TrackingState, string> = {
  init: "Initializing…",
  searching: "Searching for target",
  tracking: "Tracking",
  sonar: "Target hidden · sonar only",
  lost: "Signal lost",
};

const STATE_CLASS: Record<TrackingState, string> = {
  init: "state-init",
  searching: "state-searching",
  tracking: "state-tracking",
  sonar: "state-sonar",
  lost: "state-lost",
};

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`missing element #${id}`);
  return e as T;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const cap = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * Owns the heads-up display. Translates raw filter state into clear, labeled,
 * mobile- and desktop-friendly readouts: distance in metres, a visual direction
 * gauge with left/right degrees, a confidence ring, and plain-language status.
 */
export class Hud {
  private readonly overlay = el("overlay");
  private readonly statusText = el("status-text");
  private readonly target = el("d-target");
  private readonly distance = el("d-distance");
  private readonly motion = el("d-motion");
  private readonly dirDot = el("dir-dot");
  private readonly direction = el("d-direction");
  private readonly ring = el("conf-ring");
  private readonly conf = el("d-conf");
  private readonly lock = el("d-lock");
  private readonly tech = el("tech");
  private readonly sensorCam = el("sensor-cam");
  private readonly sensorSonar = el("sensor-sonar");
  private readonly errorBanner = el("error-banner");
  private readonly errorText = el("error-text");
  private currentStateClass = "state-init";

  setSensors(cam: boolean, sonar: boolean): void {
    this.sensorCam.classList.toggle("on", cam);
    this.sensorSonar.classList.toggle("on", sonar);
  }

  setStatusText(text: string): void {
    this.statusText.textContent = text;
  }

  update(v: HudView): void {
    const cls = STATE_CLASS[v.state];
    if (cls !== this.currentStateClass) {
      this.overlay.classList.remove(this.currentStateClass);
      this.overlay.classList.add(cls);
      this.currentStateClass = cls;
    }
    this.statusText.textContent = STATUS_TEXT[v.state];

    const tracked = v.distanceM != null;
    this.target.textContent = tracked ? cap(v.targetLabel) : "No target";

    this.distance.innerHTML =
      v.distanceM == null ? "—" : `${v.distanceM.toFixed(1)}<span class="unit">m</span>`;

    // Motion chip (only when meaningfully moving).
    this.motion.className = "m-chip";
    if (v.motion === "approaching" || v.motion === "receding") {
      this.motion.textContent = v.motion;
      this.motion.classList.add("show", v.motion);
    } else {
      this.motion.textContent = "";
    }

    // Direction gauge + numeric.
    if (v.azimuthDeg == null) {
      this.dirDot.style.opacity = "0";
      this.direction.textContent = "—";
    } else {
      const pos = clamp01((v.azimuthDeg + GAUGE_FOV) / (2 * GAUGE_FOV));
      this.dirDot.style.left = `${pos * 100}%`;
      this.dirDot.style.opacity = "1";
      this.direction.textContent = formatDirection(v.azimuthDeg);
    }

    // Confidence ring.
    const pct = Math.round(clamp01(v.confidence) * 100);
    this.ring.style.setProperty("--p", tracked ? String(pct) : "0");
    this.conf.textContent = tracked ? `${pct}%` : "—";
    this.lock.textContent = v.lock ? `Lock: ${v.lock}` : "—";

    this.tech.textContent = `${v.backend} · ${v.azimuthMode} · ${v.transport} · ${Math.round(v.fps)} fps`;
  }

  showError(message: string): void {
    this.errorText.textContent = message;
    this.errorBanner.classList.remove("hidden");
  }

  clearError(): void {
    this.errorBanner.classList.add("hidden");
  }
}

function formatDirection(deg: number): string {
  const r = Math.round(deg);
  if (Math.abs(r) <= 4) return "ahead";
  return r > 0 ? `${r}° right` : `${Math.abs(r)}° left`;
}

import { onLangChange, t } from "../i18n/i18n.js";
import type { TrackedPerson } from "../tracking/MultiTracker.js";
import type { PersonHistorySample, PersonRegistry } from "../tracking/PersonRegistry.js";
import { deriveState } from "../tracking/behaviorState.js";

/**
 * Per-person analysis screen. Renders a card per tracked person showing the
 * derived observable state (calm/still/engaged/restless), live metrics, and
 * the recent history accumulated under that person's saved name.
 *
 * Important honesty note shown to the user: state is derived from MEASURED
 * signals (motion / posture / breathing). No emotion-from-face / voice-mood
 * inference — that's scientifically unreliable.
 */
export class AnalysisView {
  private readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private readonly backBtn: HTMLElement;
  private renamer: ((p: TrackedPerson) => void) | null = null;
  private getTracks: () => TrackedPerson[] = () => [];
  private onBack: (() => void) | null = null;

  constructor(private readonly registry: PersonRegistry) {
    this.root = el("analysis-view");
    this.body = el("analysis-body");
    this.backBtn = el("analysis-back");
    this.backBtn.addEventListener("click", () => this.onBack?.());
    onLangChange(() => this.render());
  }

  bind(getTracks: () => TrackedPerson[], renamer: (p: TrackedPerson) => void, onBack: () => void): void {
    this.getTracks = getTracks;
    this.renamer = renamer;
    this.onBack = onBack;
  }

  show(): void {
    this.root.classList.remove("hidden");
    this.render();
  }
  hide(): void {
    this.root.classList.add("hidden");
  }
  get isOpen(): boolean {
    return !this.root.classList.contains("hidden");
  }

  /** Re-render the whole view from current tracks + registry history. */
  render(): void {
    if (!this.isOpen) return;
    const tracks = this.getTracks();
    this.body.replaceChildren();
    if (tracks.length === 0) {
      const empty = document.createElement("div");
      empty.className = "analysis-empty";
      empty.textContent = t("analysis.no_people");
      this.body.appendChild(empty);
    } else {
      for (const trk of tracks) this.body.appendChild(this.card(trk));
    }
    const note = document.createElement("p");
    note.className = "honesty-note";
    note.textContent = t("analysis.honesty_note");
    this.body.appendChild(note);
  }

  private card(trk: TrackedPerson): HTMLElement {
    const samples: PersonHistorySample[] = trk.name ? (this.registry.get(trk.name)?.samples ?? []) : [];
    const summary = deriveState(samples);

    const card = document.createElement("section");
    card.className = "analysis-card";

    // Header: name + observable-state chip + rename button.
    const head = document.createElement("header");
    const title = document.createElement("h3");
    title.textContent = trk.name ?? trk.id;
    head.appendChild(title);

    const stateChip = document.createElement("span");
    stateChip.className = `state-chip state-${summary.state}`;
    stateChip.textContent = t(`analysis.state_${summary.state}`);
    head.appendChild(stateChip);

    const rename = document.createElement("button");
    rename.className = "rename-btn";
    rename.type = "button";
    rename.textContent = t("analysis.rename");
    rename.addEventListener("click", () => this.renamer?.(trk));
    head.appendChild(rename);
    card.appendChild(head);

    // Live metrics.
    card.appendChild(this.section("analysis.section_now", [
      [t("analysis.metric_distance"), `${trk.distanceM.toFixed(1)} m`],
      [t("analysis.metric_direction"), `${Math.round(trk.azimuthDeg)}°`],
      [t("analysis.metric_posture"), t(`posture.${trk.posture}`)],
      [t("analysis.metric_activity"), t(`activity.${trk.activityLabel}`)],
    ]));

    // History — only when we have a saved name (i.e. samples actually persist).
    if (trk.name && samples.length > 0) {
      const rec = this.registry.get(trk.name)!;
      const ago = Math.max(0, Math.round(Date.now() / 1000 - rec.lastSeen));
      const bpm = summary.breathingBpm > 0
        ? `${Math.round(summary.breathingBpm)} ${t("ui.life_unit")}`
        : t("analysis.breathing_none");
      const pattern = summary.breathingPattern === "none"
        ? t("analysis.breathing_none")
        : t(`analysis.breathing_${summary.breathingPattern}`);
      card.appendChild(this.section("analysis.section_history", [
        [t("analysis.metric_avg_activity"), summary.meanActivity.toFixed(2)],
        [t("analysis.metric_activity_peaks"), String(summary.activityPeaks)],
        [t("analysis.metric_breathing"), bpm],
        [t("analysis.metric_breathing_pattern"), pattern],
        [t("analysis.metric_posture_changes"), String(summary.postureChanges)],
        [t("analysis.metric_centered_pct"), `${Math.round(summary.centeredFraction * 100)}%`],
        [t("analysis.metric_mean_distance"), `${summary.meanDistance.toFixed(1)} m`],
        [t("analysis.metric_min_distance"), `${summary.minDistance.toFixed(1)} m`],
        [t("analysis.metric_time_present"), `${summary.timePresentSec.toFixed(0)} s`],
        [t("analysis.metric_samples"), String(samples.length)],
        [t("analysis.metric_last_seen"), `${ago} ${t("analysis.metric_seconds")}`],
      ]));
      const canvas = document.createElement("canvas");
      canvas.className = "spark";
      card.appendChild(canvas);
      // Defer until in the DOM so clientWidth is correct.
      requestAnimationFrame(() => this.drawSpark(canvas, samples.slice(-180).map((s) => s.activity)));
    }
    return card;
  }

  private section(titleKey: string, rows: Array<[string, string]>): HTMLElement {
    const wrap = document.createElement("div");
    const h = document.createElement("h4");
    h.textContent = t(titleKey);
    wrap.appendChild(h);
    const grid = document.createElement("div");
    grid.className = "metric-grid";
    for (const [k, v] of rows) {
      const row = document.createElement("div");
      row.className = "kv";
      const kk = document.createElement("span");
      kk.className = "k";
      kk.textContent = k;
      const vv = document.createElement("span");
      vv.className = "v";
      vv.textContent = v;
      row.appendChild(kk);
      row.appendChild(vv);
      grid.appendChild(row);
    }
    wrap.appendChild(grid);
    return wrap;
  }

  private drawSpark(canvas: HTMLCanvasElement, values: number[]): void {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio, 2);
    const cssW = canvas.clientWidth || 600;
    const cssH = 60;
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    if (values.length < 2) return;
    const max = Math.max(...values, 0.1);
    ctx.strokeStyle = "#25e8c0";
    ctx.lineWidth = 1.5;
    ctx.shadowColor = "#25e8c0";
    ctx.shadowBlur = 6;
    ctx.beginPath();
    for (let i = 0; i < values.length; i++) {
      const x = (i / (values.length - 1)) * cssW;
      const y = cssH - (values[i] / max) * cssH * 0.9 - 4;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`missing element #${id}`);
  return e as T;
}

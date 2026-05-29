/**
 * Persistent registry of user-named people. Identities are user-given (tap to
 * name) — there is no automatic face recognition. History (position, posture,
 * activity, breathing) accumulates per name across the session and persists
 * across reloads via localStorage. Device-only (relies on `localStorage`).
 */
const KEY = "av-track:identities-v1";
const MAX_SAMPLES_PER_NAME = 2000;

export interface PersonHistorySample {
  tSec: number;
  x: number;
  z: number;
  distanceM: number;
  azimuthDeg: number;
  posture: string;
  activity: number;
  breathingBpm?: number;
}

export interface PersonRecord {
  name: string;
  firstSeen: number;
  lastSeen: number;
  /** Optional user-calibrated real height (m). Improves monocular depth accuracy. */
  heightM?: number;
  samples: PersonHistorySample[];
}

type Store = Record<string, PersonRecord>;

export class PersonRegistry {
  private data: Store = {};
  private dirty = false;

  constructor() {
    this.data = this.load();
  }

  private load(): Store {
    try {
      const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? (parsed as Store) : {};
    } catch {
      return {};
    }
  }

  save(): void {
    if (!this.dirty) return;
    try {
      if (typeof localStorage !== "undefined") localStorage.setItem(KEY, JSON.stringify(this.data));
      this.dirty = false;
    } catch {
      /* quota / private mode — silently ignore */
    }
  }

  names(): string[] {
    return Object.keys(this.data);
  }

  get(name: string): PersonRecord | undefined {
    return this.data[name];
  }

  ensure(name: string): PersonRecord {
    const now = Date.now() / 1000;
    let rec = this.data[name];
    if (!rec) {
      rec = { name, firstSeen: now, lastSeen: now, samples: [] };
      this.data[name] = rec;
      this.dirty = true;
    }
    return rec;
  }

  appendSample(name: string, sample: PersonHistorySample): void {
    const rec = this.ensure(name);
    rec.lastSeen = Date.now() / 1000;
    rec.samples.push(sample);
    if (rec.samples.length > MAX_SAMPLES_PER_NAME) {
      rec.samples.splice(0, rec.samples.length - MAX_SAMPLES_PER_NAME);
    }
    this.dirty = true;
  }

  remove(name: string): void {
    if (this.data[name]) {
      delete this.data[name];
      this.dirty = true;
      this.save();
    }
  }

  clear(): void {
    this.data = {};
    this.dirty = true;
    this.save();
  }
}

import { clamp } from "@avt/core-units";
import type { Agent, ControlPatch, ControlState, TelemetrySnapshot } from "@avt/contracts";
import { DEFAULT_CONTROL_STATE } from "@avt/contracts";

export interface AppliedPatch {
  agentId: string;
  patch: ControlPatch;
}

function cloneControl(c: ControlState): ControlState {
  return {
    acoustic: { ...c.acoustic },
    vision: { ...c.vision },
    fusion: { ...c.fusion },
    render: { ...c.render },
    test: { ...c.test },
  };
}

/**
 * Coordinates the agent council: each agent inspects telemetry + current
 * control and proposes a patch; the council merges patches and clamps the
 * result to safe ranges. Pure and deterministic — fully unit-testable.
 */
export class Council {
  private readonly agents: Agent[] = [];
  private control: ControlState;

  constructor(initial: ControlState = DEFAULT_CONTROL_STATE) {
    this.control = cloneControl(initial);
  }

  register(agent: Agent): this {
    this.agents.push(agent);
    return this;
  }

  get state(): Readonly<ControlState> {
    return this.control;
  }

  /** Run one coordination round; returns the patches that were applied. */
  tick(t: TelemetrySnapshot): AppliedPatch[] {
    const applied: AppliedPatch[] = [];
    for (const agent of this.agents) {
      const patch = agent.evaluate(t, this.control);
      if (!patch) continue;
      this.merge(patch);
      applied.push({ agentId: agent.id, patch });
    }
    this.clampAll();
    return applied;
  }

  private merge(p: ControlPatch): void {
    if (p.acoustic) Object.assign(this.control.acoustic, p.acoustic);
    if (p.vision) Object.assign(this.control.vision, p.vision);
    if (p.fusion) Object.assign(this.control.fusion, p.fusion);
    if (p.render) Object.assign(this.control.render, p.render);
    if (p.test) Object.assign(this.control.test, p.test);
  }

  private clampAll(): void {
    const c = this.control;
    c.acoustic.speakerGain = clamp(c.acoustic.speakerGain, 0, 1);
    c.acoustic.carrierHz = clamp(c.acoustic.carrierHz, 18500, 21500);
    c.acoustic.clutterAlpha = clamp(c.acoustic.clutterAlpha, 0.5, 0.99);
    c.vision.confidenceThreshold = clamp(c.vision.confidenceThreshold, 0.1, 0.9);
    c.fusion.sigmaA = clamp(c.fusion.sigmaA, 0.2, 12);
    c.fusion.rVisScale = clamp(c.fusion.rVisScale, 1, 50);
    c.fusion.rAcousticAzScale = clamp(c.fusion.rAcousticAzScale, 1, 50);
    c.render.dpr = clamp(c.render.dpr, 1, 2);
    c.render.cullDistanceM = clamp(c.render.cullDistanceM, 2, 30);
  }
}

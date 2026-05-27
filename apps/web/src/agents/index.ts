import { Council } from "./Council.js";
import {
  AcousticTunerAgent,
  InferenceAgent,
  FusionCalibratorAgent,
  RenderScalerAgent,
  RegressionAgent,
} from "./agents.js";

export * from "./Council.js";
export * from "./agents.js";

/** Build the full five-agent council. */
export function createDefaultCouncil(): Council {
  return new Council()
    .register(new AcousticTunerAgent())
    .register(new InferenceAgent())
    .register(new FusionCalibratorAgent())
    .register(new RenderScalerAgent())
    .register(new RegressionAgent());
}

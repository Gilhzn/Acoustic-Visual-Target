/**
 * Synthetic Signal Lab runner. Replays every scenario through the real DSP+EKF
 * pipeline and prints a QA table. Usage: `pnpm lab [scenarioName] [seed]`.
 */
import { runReplay } from "./replay.js";
import { euclideanError, jitterStd, convergenceTime, nisConsistency } from "./metrics.js";
import { SCENARIOS, SCENARIO_NAMES, type Scenario } from "./scenarios/index.js";
import { chiSquareThreshold } from "@avt/fusion";

function evaluate(scn: Scenario, seed: number): { pass: boolean; line: string } {
  const r = runReplay(scn, seed);
  const fromSec = scn.durationS * 0.4; // ignore convergence transient
  const err = euclideanError(r.estimates, r.truth, fromSec);
  const jit = jitterStd(r.estimates, fromSec);
  const conv = convergenceTime(r.estimates, r.truth, Math.max(scn.expect.meanErrorM * 1.5, 0.15));
  const nis = nisConsistency(r.nisLog, chiSquareThreshold(2, 0.05), chiSquareThreshold(2, 0.95));

  let pass = err.mean < scn.expect.meanErrorM;
  if (scn.expect.jitterStdM !== undefined) pass = pass && jit < scn.expect.jitterStdM;

  const line =
    `${scn.name.padEnd(13)} ` +
    `mean=${err.mean.toFixed(3)}m p95=${err.p95.toFixed(3)}m max=${err.max.toFixed(3)}m ` +
    `jitter=${jit.toFixed(3)}m conv=${conv.toFixed(2)}s ` +
    `vis=${r.visualAccepted}/${r.visualTotal}(miss ${r.visualMissed}) ` +
    `aco=${r.acousticAccepted}/${r.acousticTotal} ` +
    `NIS̄=${nis.mean.toFixed(2)} ` +
    `=> ${pass ? "PASS" : "FAIL"} (limit ${scn.expect.meanErrorM}m)`;
  return { pass, line };
}

function main(): void {
  const [, , nameArg, seedArg] = process.argv;
  const seed = seedArg ? Number(seedArg) : 1;
  const names = nameArg ? [nameArg] : SCENARIO_NAMES;
  let allPass = true;
  console.log("Synthetic Signal Lab — QA report\n");
  for (const name of names) {
    const scn = SCENARIOS[name];
    if (!scn) {
      console.error(`Unknown scenario: ${name}. Known: ${SCENARIO_NAMES.join(", ")}`);
      process.exitCode = 1;
      return;
    }
    const { pass, line } = evaluate(scn, seed);
    allPass = allPass && pass;
    console.log(line);
  }
  console.log(`\n${allPass ? "ALL SCENARIOS PASSED" : "SOME SCENARIOS FAILED"}`);
  process.exitCode = allPass ? 0 : 1;
}

main();

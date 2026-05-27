/**
 * Branded numeric units + physical constants shared across the headless core.
 *
 * Brands are erased at runtime (zero cost). They exist to stop unit-confusion
 * bugs at compile time (e.g. passing Hz where Meters is expected). Arithmetic
 * on branded values yields plain `number`; re-brand at function boundaries.
 */

declare const __brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [__brand]: B };

export type Hz = Brand<number, "Hz">;
export type Radians = Brand<number, "Radians">;
export type Degrees = Brand<number, "Degrees">;
export type Meters = Brand<number, "Meters">;
export type Seconds = Brand<number, "Seconds">;
/** A count of audio samples. */
export type Samples = Brand<number, "Samples">;
/** Sampling frequency in samples/second. */
export type SampleRate = Brand<number, "SampleRate">;
export type Decibels = Brand<number, "Decibels">;

export const hz = (n: number): Hz => n as Hz;
export const radians = (n: number): Radians => n as Radians;
export const degrees = (n: number): Degrees => n as Degrees;
export const meters = (n: number): Meters => n as Meters;
export const seconds = (n: number): Seconds => n as Seconds;
export const samples = (n: number): Samples => n as Samples;
export const sampleRate = (n: number): SampleRate => n as SampleRate;
export const decibels = (n: number): Decibels => n as Decibels;

// --- Physical constants -----------------------------------------------------

/** Speed of sound in dry air at ~20°C. */
export const SPEED_OF_SOUND_MPS = 343 as Meters; // m/s (per second is implicit)

export const TWO_PI = Math.PI * 2;

// --- Unit conversions -------------------------------------------------------

export const degToRad = (d: number): Radians => ((d * Math.PI) / 180) as Radians;
export const radToDeg = (r: number): Degrees => ((r * 180) / Math.PI) as Degrees;

/** Linear amplitude ratio -> decibels (20·log10). Guards against log(0). */
export const ampToDb = (amp: number): Decibels =>
  (20 * Math.log10(Math.max(amp, 1e-12))) as Decibels;

/** Power ratio -> decibels (10·log10). */
export const powerToDb = (power: number): Decibels =>
  (10 * Math.log10(Math.max(power, 1e-24))) as Decibels;

export const dbToAmp = (db: number): number => Math.pow(10, db / 20);

/** Acoustic wavelength λ = c / f. */
export const wavelength = (freq: Hz): Meters =>
  ((SPEED_OF_SOUND_MPS as number) / (freq as number)) as Meters;

/** Round-trip time-of-flight for a target at range R: τ = 2R/c. */
export const rangeToTof = (range: Meters): Seconds =>
  ((2 * (range as number)) / (SPEED_OF_SOUND_MPS as number)) as Seconds;

/** Inverse of rangeToTof: R = c·τ/2. */
export const tofToRange = (tof: Seconds): Meters =>
  (((SPEED_OF_SOUND_MPS as number) * (tof as number)) / 2) as Meters;

export const clamp = (x: number, lo: number, hi: number): number =>
  x < lo ? lo : x > hi ? hi : x;

/** Wrap an angle (radians) to (-π, π]. */
export const wrapAngle = (a: number): Radians => {
  let x = (a + Math.PI) % TWO_PI;
  if (x < 0) x += TWO_PI;
  return (x - Math.PI) as Radians;
};

export const isPowerOfTwo = (n: number): boolean => n > 0 && (n & (n - 1)) === 0;

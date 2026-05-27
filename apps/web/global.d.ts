/**
 * Ambient types for the AudioWorkletGlobalScope, which the DOM lib does not
 * provide. Used only by the worklet entry (device-only).
 */
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: AudioWorkletNodeOptions);
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}

declare function registerProcessor(
  name: string,
  ctor: new (options?: AudioWorkletNodeOptions) => AudioWorkletProcessor,
): void;

declare const sampleRate: number;
declare const currentTime: number;
declare const currentFrame: number;

interface Navigator {
  readonly xr?: XRSystem;
  readonly deviceMemory?: number;
}

// Vite asset query imports.
declare module "*?worker&url" {
  const src: string;
  export default src;
}
declare module "*?url" {
  const src: string;
  export default src;
}

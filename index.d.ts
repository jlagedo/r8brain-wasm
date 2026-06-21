/**
 * Type declarations for r8brain-wasm.
 *
 * High-quality sample-rate converter (r8brain-free-src by Aleksey Vaneev of
 * Voxengo) compiled to WebAssembly for Node.
 */

/** Resampler resolution presets (maps to ER8BResamplerRes). */
export const Resolution: {
  /** 16-bit precision. */
  readonly R16: 0;
  /** 16-bit precision for impulse responses. */
  readonly R16IR: 1;
  /** 24-bit precision (incl. 32-bit float) — default. */
  readonly R24: 2;
};

export type ResolutionValue = 0 | 1 | 2;

/** Opaque handle to the instantiated WASM module returned by {@link init}. */
export interface R8brainModule {
  readonly [key: string]: unknown;
}

/** Loads and caches the WASM module (idempotent across calls). */
export function init(): Promise<R8brainModule>;

export interface ResamplerOptions {
  /** Source sample rate (or a ratio numerator). */
  srcRate: number;
  /** Destination sample rate (or ratio denominator). */
  dstRate: number;
  /** Max input samples per process() call. Sizes internal buffers. */
  maxInLen: number;
  /** Transition band, percent of spectral space (0.5..45). Default 2.0. */
  transBand?: number;
  /** Resolution preset. Default Resolution.R24. */
  resolution?: ResolutionValue;
}

/**
 * One resampler per channel/stream. Construct once (designs FIR/FFT filters —
 * never inside an audio callback) and reuse for the stream's lifetime.
 */
export class Resampler {
  constructor(mod: R8brainModule, opts: ResamplerOptions);

  /** Input samples needed to produce at least `outSamples` from a cleared state. */
  inputRequiredForOutput(outSamples: number): number;

  /** Resets internal state; discards buffered input. */
  clear(): void;

  /**
   * Zero-allocation hot path: resamples `input` (<= maxInLen samples) and
   * writes the result into `outArray`, returning the number of samples written.
   * `outArray` must be large enough (for upsampling allow roughly
   * maxInLen * dstRate / srcRate + a few samples). Output count varies per
   * block and is 0 during the initial latency fill.
   */
  processInto(input: Float64Array, outArray: Float64Array): number;

  /**
   * Convenience path: returns a freshly-allocated Float64Array with the
   * resampled samples. Allocates per call — avoid in tight realtime loops;
   * prefer {@link processInto}.
   */
  process(input: Float64Array): Float64Array;

  /** Releases the resampler and its heap buffers. Idempotent. */
  destroy(): void;
}

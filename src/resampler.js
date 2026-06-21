/**
 * High-quality sample-rate converter for Node, backed by r8brain-free-src
 * compiled to WebAssembly.
 *
 * Realtime discipline baked in:
 *  - one resampler object per channel, created once and reused;
 *  - input/output staging buffers live in WASM linear memory, allocated once;
 *  - no per-block allocation in the hot path (use processInto());
 *  - ALLOW_MEMORY_GROWTH is off in the build, so heap views stay valid.
 */

import createR8brain from '../dist/r8brain.mjs';

/** Resampler resolution presets (maps to ER8BResamplerRes). */
export const Resolution = Object.freeze({
  R16: 0,    // 16-bit precision
  R16IR: 1,  // 16-bit precision for impulse responses
  R24: 2,    // 24-bit precision (incl. 32-bit float) — default
});

let modulePromise = null;

/** Loads and caches the WASM module (idempotent). */
export async function init() {
  if (modulePromise === null) {
    modulePromise = createR8brain();
  }
  return modulePromise;
}

export class Resampler {
  /**
   * @param {object} mod   The instantiated WASM module from init().
   * @param {object} opts
   * @param {number} opts.srcRate    Source sample rate (or a ratio numerator).
   * @param {number} opts.dstRate    Destination sample rate (or denominator).
   * @param {number} opts.maxInLen   Max input samples per process() call.
   * @param {number} [opts.transBand=2.0]  Transition band, percent (0.5..45).
   * @param {number} [opts.resolution=Resolution.R24]
   */
  constructor(mod, { srcRate, dstRate, maxInLen, transBand = 2.0,
    resolution = Resolution.R24 }) {
    if (!Number.isInteger(maxInLen) || maxInLen <= 0) {
      throw new RangeError('maxInLen must be a positive integer');
    }
    this._mod = mod;
    this._maxInLen = maxInLen;
    this._BPS = Float64Array.BYTES_PER_ELEMENT; // 8

    this._create = mod.cwrap('r8b_create', 'number',
      ['number', 'number', 'number', 'number', 'number']);
    this._delete = mod.cwrap('r8b_delete', null, ['number']);
    this._clearFn = mod.cwrap('r8b_clear', null, ['number']);
    this._inlen = mod.cwrap('r8b_inlen', 'number', ['number', 'number']);
    this._process = mod.cwrap('r8bw_process', 'number',
      ['number', 'number', 'number', 'number']);

    this._handle = this._create(srcRate, dstRate, maxInLen, transBand,
      resolution);
    if (this._handle === 0) throw new Error('r8b_create failed');

    // Staging buffers in WASM linear memory, allocated once.
    this._inPtr = mod._malloc(maxInLen * this._BPS);
    this._opPtrSlot = mod._malloc(4); // holds the output pointer (wasm32)
    if (this._inPtr === 0 || this._opPtrSlot === 0) {
      throw new Error('WASM malloc failed');
    }
  }

  /** Input samples needed to produce at least `outSamples` from a cleared state. */
  inputRequiredForOutput(outSamples) {
    return this._inlen(this._handle, outSamples);
  }

  /** Resets internal state; discards buffered input. */
  clear() {
    this._clearFn(this._handle);
  }

  /**
   * Zero-allocation path: writes resampled data into `outArray` and returns
   * the number of samples written. `outArray` must be large enough; for
   * upsampling allow roughly maxInLen * dstRate / srcRate + a few samples.
   *
   * @param {Float64Array} input    Up to maxInLen samples.
   * @param {Float64Array} outArray Destination.
   * @returns {number} samples written.
   */
  processInto(input, outArray) {
    const n = this._runProcess(input);
    // View over the resampler's internal output buffer (valid until next call).
    const view = new Float64Array(this._mod.HEAPF64.buffer, this._outAddr, n);
    if (n > outArray.length) {
      throw new RangeError(`output (${n}) exceeds outArray (${outArray.length})`);
    }
    outArray.set(view);
    return n;
  }

  /**
   * Convenience path: returns a freshly-allocated Float64Array with the
   * resampled samples. Allocates per call — avoid in tight realtime loops;
   * prefer processInto().
   *
   * @param {Float64Array} input  Up to maxInLen samples.
   * @returns {Float64Array}
   */
  process(input) {
    const n = this._runProcess(input);
    const view = new Float64Array(this._mod.HEAPF64.buffer, this._outAddr, n);
    return view.slice(); // copy out before the buffer is reused
  }

  _runProcess(input) {
    if (input.length > this._maxInLen) {
      throw new RangeError(
        `input length ${input.length} exceeds maxInLen ${this._maxInLen}`);
    }
    const mod = this._mod;
    // Copy input into the WASM heap staging buffer.
    mod.HEAPF64.set(input, this._inPtr / this._BPS);
    const n = this._process(this._handle, this._inPtr, input.length,
      this._opPtrSlot);
    this._outAddr = mod.HEAPU32[this._opPtrSlot >> 2];
    return n;
  }

  /** Releases the resampler and its heap buffers. Idempotent. */
  destroy() {
    if (this._handle !== 0) {
      this._delete(this._handle);
      this._handle = 0;
    }
    if (this._inPtr) { this._mod._free(this._inPtr); this._inPtr = 0; }
    if (this._opPtrSlot) { this._mod._free(this._opPtrSlot); this._opPtrSlot = 0; }
  }
}

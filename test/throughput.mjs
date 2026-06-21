/**
 * WASM throughput benchmark — mirrors test/native_bench.cpp (same rate pairs,
 * ~30 s of a 1 kHz tone, 1024-sample blocks, R24, transBand 2.0) so the
 * realtime factors are directly comparable to native and reveal the WASM
 * overhead (including the per-block JS<->WASM heap copy in processInto).
 *
 * Run after building:  node test/throughput.mjs
 */

import { init, Resampler, Resolution } from '../src/resampler.js';

const mod = await init();
const PAIRS = [[22050, 48000], [24000, 48000], [44100, 48000]];
const MAX_IN = 1024;

console.log('# WASM r8brain (R24, transBand 2.0) — processInto hot path');
console.log('rate pair        throughput        realtime x');
for (const [src, dst] of PAIRS) {
  const rs = new Resampler(mod, {
    srcRate: src, dstRate: dst, maxInLen: MAX_IN,
    transBand: 2.0, resolution: Resolution.R24,
  });
  const outBuf = new Float64Array(Math.ceil(MAX_IN * dst / src) + 16);
  const input = new Float64Array(MAX_IN);
  const totalIn = Math.floor(src * 30);

  // Warm up (JIT + first filter-block path).
  for (let k = 0; k < 8; k++) rs.processInto(input, outBuf);
  rs.clear();

  let gotOut = 0;
  const t0 = process.hrtime.bigint();
  for (let off = 0; off < totalIn; off += MAX_IN) {
    const len = Math.min(MAX_IN, totalIn - off);
    for (let i = 0; i < len; i++) {
      input[i] = Math.sin(2 * Math.PI * 1000 * (off + i) / src);
    }
    gotOut += rs.processInto(len === MAX_IN ? input : input.subarray(0, len), outBuf);
  }
  const t1 = process.hrtime.bigint();
  rs.destroy();

  const sec = Number(t1 - t0) / 1e9;
  const outPerSec = gotOut / sec;
  const rtx = (gotOut / dst) / sec;
  console.log(
    `${String(src).padStart(6)} -> ${String(dst).padStart(5)}   ` +
    `${(outPerSec / 1e6).toFixed(1).padStart(6)} Msmp/s     ` +
    `${rtx.toFixed(0).padStart(8)}x`);
}

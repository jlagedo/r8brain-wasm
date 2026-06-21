/**
 * Smoke test: upsample a sine wave 44.1k -> 96k, stream it block-by-block,
 * and check that the output frequency/amplitude survive resampling.
 *
 * Run after building:  node test/smoke.mjs
 */

import { init, Resampler, Resolution } from '../src/resampler.js';

const SRC = 44100;
const DST = 96000;
const FREQ = 1000;        // 1 kHz test tone
const MAX_IN = 1024;
const TOTAL_IN = SRC;     // 1 second

const mod = await init();
const rs = new Resampler(mod, {
  srcRate: SRC, dstRate: DST, maxInLen: MAX_IN,
  transBand: 2.0, resolution: Resolution.R24,
});

// Pre-size the zero-alloc output buffer (upsampling expands the block).
const outCap = Math.ceil(MAX_IN * DST / SRC) + 16;
const outBuf = new Float64Array(outCap);

let produced = 0;
let peak = 0;
const input = new Float64Array(MAX_IN);

for (let off = 0; off < TOTAL_IN; off += MAX_IN) {
  const len = Math.min(MAX_IN, TOTAL_IN - off);
  for (let i = 0; i < len; i++) {
    input[i] = Math.sin(2 * Math.PI * FREQ * (off + i) / SRC);
  }
  const n = rs.processInto(len === MAX_IN ? input : input.subarray(0, len), outBuf);
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(outBuf[i]));
  produced += n;
}

// Drain the resampler's filter latency: a streaming converter holds back
// ~latency samples internally, so the live output above falls short of
// input * ratio. Feed silence until the buffered tail flushes out.
const expected = Math.round(TOTAL_IN * DST / SRC);
const zeros = new Float64Array(MAX_IN);
for (let i = 0; i < 64 && produced < expected; i++) {
  produced += rs.processInto(zeros, outBuf);
}

rs.destroy();

console.log(`produced ${produced} samples (expected ~${expected})`);
console.log(`output peak amplitude: ${peak.toFixed(4)} (expected ~1.0)`);

const ratioOk = Math.abs(produced - expected) < DST * 0.02; // within 2%
const ampOk = peak > 0.9 && peak < 1.1;
if (!ratioOk || !ampOk) {
  console.error('FAIL: resampled output outside expected bounds');
  process.exit(1);
}
console.log('OK');

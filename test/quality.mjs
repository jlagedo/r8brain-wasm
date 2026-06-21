/**
 * Quality probe: upsample a pure tone and measure SINAD (signal-to-noise+
 * distortion) via a least-squares fit of the expected output tone. Confirms the
 * resampler stays transparent. EXTFFT only changes FFT zero-padding, not the
 * filter, so this should match the high-latency build.
 *
 * Run after building:  node test/quality.mjs
 */

import { init, Resampler, Resolution } from '../src/resampler.js';

const CASES = [
  [22050, 48000, 3000],
  [22050, 48000, 8000],
  [24000, 48000, 3000],
  [24000, 48000, 8000],
];

const mod = await init();

// Least-squares fit of A*sin + B*cos at frequency f over y[]; returns SINAD dB.
function sinad(y, f, rate) {
  const N = y.length;
  let saa = 0, sbb = 0, sab = 0, say = 0, sby = 0;
  for (let i = 0; i < N; i++) {
    const ph = 2 * Math.PI * f * i / rate;
    const a = Math.sin(ph), b = Math.cos(ph);
    saa += a * a; sbb += b * b; sab += a * b; say += a * y[i]; sby += b * y[i];
  }
  const det = saa * sbb - sab * sab;
  const A = (say * sbb - sby * sab) / det;
  const B = (sby * saa - say * sab) / det;
  let sig = 0, err = 0;
  for (let i = 0; i < N; i++) {
    const ph = 2 * Math.PI * f * i / rate;
    const fit = A * Math.sin(ph) + B * Math.cos(ph);
    sig += fit * fit; err += (y[i] - fit) ** 2;
  }
  return 10 * Math.log10(sig / err);
}

const MAX_IN = 1024;
for (const [src, dst, freq] of CASES) {
  const rs = new Resampler(mod, {
    srcRate: src, dstRate: dst, maxInLen: MAX_IN,
    transBand: 2.0, resolution: Resolution.R24,
  });
  const lat = rs.inputRequiredForOutput(1);
  const totalIn = src; // 1 s
  const outCap = Math.ceil(MAX_IN * dst / src) + 16;
  const outBuf = new Float64Array(outCap);
  const input = new Float64Array(MAX_IN);
  const out = [];
  for (let off = 0; off < totalIn + lat + MAX_IN; off += MAX_IN) {
    for (let i = 0; i < MAX_IN; i++) {
      const idx = off + i;
      input[i] = idx < totalIn ? Math.sin(2 * Math.PI * freq * idx / src) : 0;
    }
    const n = rs.processInto(input, outBuf);
    for (let i = 0; i < n; i++) out.push(outBuf[i]);
  }
  rs.destroy();
  // Skip the latency-fill ramp and the trailing flush; measure the steady state.
  const guard = Math.ceil(lat * dst / src) + 256;
  const steady = out.slice(guard, guard + Math.floor(dst * 0.5));
  console.log(`${src}->${dst} @${freq} Hz: SINAD ${sinad(steady, freq, dst).toFixed(1)} dB`);
}

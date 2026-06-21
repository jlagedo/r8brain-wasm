/**
 * Latency-lever exploration: sweep the knobs already exposed by the C API
 * (transBand, resolution) and report initial delay vs SINAD for each.
 *
 * Run:  node test/explore.mjs
 */

import { init, Resampler, Resolution } from '../src/resampler.js';

const mod = await init();

// Least-squares SINAD of tone `f` in y[] sampled at `rate`.
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

function measure(src, dst, freq, transBand, resolution) {
  const rs = new Resampler(mod, { srcRate: src, dstRate: dst, maxInLen: MAX_IN, transBand, resolution });
  const lat = rs.inputRequiredForOutput(1);
  const totalIn = src;
  const outBuf = new Float64Array(Math.ceil(MAX_IN * dst / src) + 16);
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
  const guard = Math.ceil(lat * dst / src) + 256;
  const steady = out.slice(guard, guard + Math.floor(dst * 0.5));
  return { lat, ms: (lat / src) * 1000, sinad: sinad(steady, freq, dst) };
}

const RESNAME = { 0: 'R16', 1: 'R16IR', 2: 'R24' };
const SRC = 22050, DST = 48000; // worst-case latency pair from our set

console.log(`# ${SRC} -> ${DST}\n`);
console.log('res     tBand   latency        SINAD@3k   SINAD@8k');
for (const res of [Resolution.R24, Resolution.R16, Resolution.R16IR]) {
  for (const tb of [2.0, 3.0, 4.0, 6.0, 10.0]) {
    const a = measure(SRC, DST, 3000, tb, res);
    const b = measure(SRC, DST, 8000, tb, res);
    console.log(
      `${RESNAME[res].padEnd(6)}  ${tb.toFixed(1).padStart(4)}   ` +
      `${String(a.lat).padStart(4)} (${a.ms.toFixed(1).padStart(5)} ms)   ` +
      `${a.sinad.toFixed(1).padStart(6)} dB  ${b.sinad.toFixed(1).padStart(6)} dB`);
  }
}

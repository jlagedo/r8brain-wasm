/**
 * Latency for the two TTS source rates we actually ship:
 *   - 22050 -> 48000  (Piper voices)
 *   - 24000 -> 48000  (Kokoro voices)
 *
 * Sweeps transBand and reports the initial processing delay, the approximate
 * passband edge (where the top of the band starts rolling off), and SINAD at a
 * speech-relevant tone to confirm in-band quality is untouched.
 *
 * Run after building:  node test/voices.mjs
 */

import { init, Resampler, Resolution } from '../src/resampler.js';

const mod = await init();
const MAX_IN = 1024;

const VOICES = [
  { name: 'Piper ', src: 22050, dst: 48000 },
  { name: 'Kokoro', src: 24000, dst: 48000 },
];
const TBANDS = [2.0, 3.0, 4.0, 5.0, 6.0, 8.0];

// Least-squares SINAD + recovered amplitude of tone `f` in y[] at `rate`.
function fit(y, f, rate, skip) {
  const s = y.slice(skip, skip + Math.floor(rate * 0.4));
  const N = s.length;
  let saa = 0, sbb = 0, sab = 0, say = 0, sby = 0;
  for (let i = 0; i < N; i++) {
    const ph = 2 * Math.PI * f * i / rate;
    const a = Math.sin(ph), b = Math.cos(ph);
    saa += a * a; sbb += b * b; sab += a * b; say += a * s[i]; sby += b * s[i];
  }
  const det = saa * sbb - sab * sab;
  const A = (say * sbb - sby * sab) / det;
  const B = (sby * saa - say * sab) / det;
  let sig = 0, err = 0;
  for (let i = 0; i < N; i++) {
    const ph = 2 * Math.PI * f * i / rate;
    const v = A * Math.sin(ph) + B * Math.cos(ph);
    sig += v * v; err += (s[i] - v) ** 2;
  }
  return { sinad: 10 * Math.log10(sig / err), amp: Math.hypot(A, B) };
}

function run(src, dst, freq, tb) {
  const rs = new Resampler(mod, { srcRate: src, dstRate: dst, maxInLen: MAX_IN,
    transBand: tb, resolution: Resolution.R24 });
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
  const guard = Math.ceil(lat * dst / src) + 512;
  return { lat, ...fit(out, freq, dst, guard) };
}

for (const v of VOICES) {
  const nyq = v.src / 2;
  console.log(`\n# ${v.name}  ${v.src} -> ${v.dst}   (Nyquist ${nyq} Hz)`);
  console.log('transBand   latency           passband edge   SINAD@3kHz');
  for (const tb of TBANDS) {
    const r = run(v.src, v.dst, 3000, tb);
    const ms = (r.lat / v.src) * 1000;
    const edge = Math.round(nyq * (1 - tb / 100)); // approx -3 dB point
    const star = tb === 2.0 ? '  (default)' : '';
    console.log(
      `${tb.toFixed(1).padStart(5)}      ${String(r.lat).padStart(4)} ` +
      `(${ms.toFixed(1).padStart(5)} ms)   ~${String(edge).padStart(5)} Hz      ` +
      `${r.sinad.toFixed(1).padStart(6)} dB${star}`);
  }
}

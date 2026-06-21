/**
 * Latency probe: reports the initial processing delay (input samples that must
 * be fed before the first output sample appears) for a few common rate pairs.
 *
 * Run after building:  node test/latency.mjs
 */

import { init, Resampler, Resolution } from '../src/resampler.js';

const CASES = [
  [22050, 48000],
  [24000, 48000],
  [44100, 48000],
];

const mod = await init();

for (const res of [Resolution.R24, Resolution.R16]) {
  const resName = res === Resolution.R24 ? 'R24' : 'R16';
  for (const [src, dst] of CASES) {
    const rs = new Resampler(mod, {
      srcRate: src, dstRate: dst, maxInLen: 1024,
      transBand: 2.0, resolution: res,
    });
    const inNeeded = rs.inputRequiredForOutput(1);
    const ms = (inNeeded / src) * 1000;
    console.log(
      `${resName}  ${src}->${dst}: ${inNeeded} input samples (~${ms.toFixed(1)} ms)`);
    rs.destroy();
  }
}

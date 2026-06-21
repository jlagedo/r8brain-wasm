# r8brain-wasm

[r8brain-free-src](https://github.com/avaneev/r8brain-free-src) — Aleksey
Vaneev's high-quality sample-rate converter — compiled to WebAssembly for use
in Node, including realtime/streaming processing.

> Credit, as the upstream library asks: "Sample rate converter designed by
> Aleksey Vaneev of Voxengo".

This is an unofficial WebAssembly port. The C++ sources are not vendored — they
come from the upstream repo as a git submodule under `vendor/r8brain-free-src`,
pinned to a specific commit. The prebuilt `dist/` artifacts are committed, so
**consumers do not need Emscripten or the submodule** — only contributors who
rebuild the WASM do.

## Install

The package ships the prebuilt WASM in `dist/`, so it works straight from a
git install — no build step on the consumer side:

```bash
# from a published npm registry (if published):
npm install r8brain-wasm

# or straight from GitHub (no registry needed):
npm install github:jlagedo/r8brain-wasm

# or a specific tag/commit:
npm install github:jlagedo/r8brain-wasm#v0.1.0
```

## Build (contributors only)

Clone with the submodule, then build. The submodule supplies the r8brain C++
headers; `dist/` is only regenerated when you change the build or bump upstream.

```bash
git clone --recurse-submodules https://github.com/jlagedo/r8brain-wasm
# (already cloned without it?  git submodule update --init)
```

### Build with Docker (recommended)

The Docker build is the preferred path — it pins the exact Emscripten toolchain,
so the output is reproducible and you don't have to install or match an emcc
version on the host. It produces the same `dist/r8brain.mjs` + `dist/r8brain.wasm`
as a local build:

```bash
git submodule update --init     # the build needs the vendored C++ sources
npm run build:docker            # or: bash docker-build.sh
```

It mounts the repo at `/src`, runs as your host UID/GID so `dist/` stays owned
by you (not root), and redirects Emscripten's cache into a git-ignored
`./.emcache`. Only Docker is required.

### Build with a local Emscripten (alternative)

If you'd rather use a host toolchain, you need the
[Emscripten SDK](https://emscripten.org/docs/getting_started/downloads.html)
on PATH (`emcc --version` should work):

```bash
source /path/to/emsdk/emsdk_env.sh   # activate emcc
npm run build                        # -> dist/r8brain.mjs + dist/r8brain.wasm
npm test                             # smoke test (44.1k -> 96k sine)
npm run test:latency                 # initial processing delay per rate pair
npm run test:quality                 # SINAD of a resampled tone
```

To move to a newer upstream r8brain release: `cd vendor/r8brain-free-src`,
`git checkout <tag>`, `cd ..`, rebuild, retest, then commit the submodule
pointer bump together with the regenerated `dist/`.

The build is configured for: full-precision `double` (Ooura FFT, library
default), WASM SIMD (`-msimd128`), single-threaded (no pthreads — correct for
Node), `-O3 -flto`, and a fixed 64 MB heap (`ALLOW_MEMORY_GROWTH=0`). It leaves
`R8B_EXTFFT` at the library default (`0`) to favour **low latency** over the
marginal throughput gain — appropriate for streaming use off the realtime audio
loop. (Setting `R8B_EXTFFT=1` roughly doubles the initial processing delay.)

## Usage

```js
import { init, Resampler, Resolution } from 'r8brain-wasm';

const mod = await init();                 // load WASM once, cached

// One resampler PER channel. Create once, reuse for the stream's lifetime.
const rs = new Resampler(mod, {
  srcRate: 44100,
  dstRate: 48000,
  maxInLen: 1024,                          // max input samples per process()
  transBand: 2.0,                          // transition band, %
  resolution: Resolution.R24,              // R16 | R16IR | R24
});

// Realtime hot path — zero allocation. Pre-size outBuf for the largest block.
const outBuf = new Float64Array(Math.ceil(1024 * 48000 / 44100) + 16);
const n = rs.processInto(inputFloat64, outBuf);   // n = samples written
// ... consume outBuf[0..n) before the next processInto on this object ...

rs.destroy();                              // free WASM resources when done
```

`process(input)` is a convenience variant that returns a fresh `Float64Array`
(it allocates per call — fine for batch work, avoid in tight realtime loops).

## Realtime notes

- **One `Resampler` per channel/stream.** Objects are not shared across
  channels. Create them up front; construction designs FIR/FFT filters and must
  never happen inside the audio callback.
- **Variable output size.** Resampling yields a variable number of samples per
  block, and 0 during the initial latency fill. Feed a ring buffer if your sink
  needs fixed-size blocks. `inputRequiredForOutput(n)` tells you how many input
  samples produce at least `n` outputs from a cleared state.
- **Don't create garbage in the callback.** Reuse the input and output typed
  arrays; the JS GC is the main realtime hazard (WASM itself has no GC).
- **The output of `processInto`/`process` is the resampler's internal buffer**;
  it is only valid until the next `processInto`/`process`/`clear`/`destroy` on
  the same object. `processInto` copies it into your buffer for you.
- For audio I/O, drive the resampler from a worker thread with a
  SharedArrayBuffer ring rather than the main event loop.

## Latency

The converter holds back roughly one FIR length of input before emitting the
first output sample (it returns 0 from `processInto`/`process` until then), so
short streams only flush at end-of-stream. `inputRequiredForOutput(1)` reports
this delay; with the default build it is about:

| rate pair      | delay            |
| -------------- | ---------------- |
| 22.05k -> 48k  | ~1701 in (77 ms) |
| 24k -> 48k     | ~1695 in (71 ms) |
| 44.1k -> 48k   | ~1701 in (39 ms) |

Knobs that trade quality for less delay/CPU (set per `Resampler`, not at build
time):

- **`transBand`** (default `2.0`%): widening it (e.g. `3`–`4`) shortens the
  filter — lower latency, narrower flat passband. This is the main latency knob.
- **`resolution`**: `R16` (~136 dB) is already far beyond 16-bit sources and is
  cheaper than the `R24` default, though it does *not* reduce latency on its own
  (its filter rounds into the same FFT block size).

## Layout

```
r8b_wasm.cpp              thin C shim over the DLL/ C API (adds r8bw_process)
build.sh                  emcc build command
docker-build.sh           same build inside the emscripten/emsdk container
src/resampler.js          ESM wrapper class (zero-copy realtime path)
index.d.ts                TypeScript declarations
test/smoke.mjs            build verification (+ latency/quality/voices probes)
dist/                     generated r8brain.mjs + r8brain.wasm (committed)
vendor/r8brain-free-src/  upstream C++ sources (git submodule, pinned)
```

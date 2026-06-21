#!/usr/bin/env bash
#
# Builds r8brain-free-src into a WebAssembly module for Node (ESM).
#
# The r8brain C++ sources live in the git submodule at vendor/r8brain-free-src
# (pinned to a specific upstream commit). Run `git submodule update --init`
# after cloning if vendor/ is empty.
#
# Prerequisites: the Emscripten SDK must be active on PATH, i.e. run
#   source /path/to/emsdk/emsdk_env.sh
# so that `emcc` is available. Check with `emcc --version`.
# (Or use docker-build.sh, which needs no local toolchain.)
#
# Configuration: full-precision double, single-threaded (no pthreads) which is
# correct for Node.
#
# FFT backend: PFFFT "double" (R8B_PFFFT_DOUBLE=1) rather than the library's
# default scalar Ooura FFT. PFFFT's SSE2 intrinsics are mapped by Emscripten to
# WASM SIMD128, so the FFT-bound (fractional-ratio) paths run ~6-9% faster at
# bit-identical SNR. Its C source (fft/pffft_double.c) must be compiled as C
# (it rejects -std=c++17), so we build it to an object file first, then link.
#
# SIMD: -msimd128 -msse2 enable WASM SIMD + the SSE2->SIMD128 intrinsic mapping
# PFFFT needs. -mrelaxed-simd adds fused multiply-add (FMA), worth a few more
# percent at no precision cost. Relaxed SIMD requires Node >= 20 (see
# package.json "engines"); a Node 16-19 runtime would fail to instantiate.
#
# Latency note: R8B_EXTFFT is left at the library default (0). Setting it to 1
# doubles the low-pass FIR's FFT block (zero-padded), which raises throughput
# but also raises the initial processing delay. This build targets streaming /
# low-latency use off the realtime audio loop, so we favour latency over the
# marginal throughput gain.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENDOR="$HERE/vendor/r8brain-free-src"
OUT="$HERE/dist"

if [ ! -f "$VENDOR/DLL/r8bsrc.cpp" ]; then
  echo "ERROR: $VENDOR/DLL/r8bsrc.cpp not found." >&2
  echo "Run: git submodule update --init" >&2
  exit 1
fi

mkdir -p "$OUT"

# Compile the PFFFT double FFT (C source) to an object file first; it cannot
# take -std=c++17. Same SIMD flags as the main link so the SSE2/FMA paths match.
emcc -c \
  "$VENDOR/fft/pffft_double.c" \
  -O3 -flto \
  -msimd128 -msse2 -mrelaxed-simd \
  -DR8B_PFFFT_DOUBLE=1 \
  -o "$OUT/pffft_double.o"

emcc \
  "$VENDOR/DLL/r8bsrc.cpp" \
  "$HERE/r8b_wasm.cpp" \
  "$OUT/pffft_double.o" \
  -I "$VENDOR/DLL" \
  -std=c++17 -O3 -flto \
  -msimd128 -msse2 -mrelaxed-simd \
  -DR8BSRC_DECL= \
  -DR8B_FASTTIMING=1 \
  -DR8B_PFFFT_DOUBLE=1 \
  -s MODULARIZE=1 \
  -s EXPORT_ES6=1 \
  -s ENVIRONMENT=node \
  -s ALLOW_MEMORY_GROWTH=0 \
  -s INITIAL_MEMORY=67108864 \
  -s EXPORT_NAME=createR8brain \
  -s EXPORTED_FUNCTIONS='_r8b_create,_r8b_delete,_r8b_clear,_r8b_inlen,_r8bw_process,_malloc,_free' \
  -s EXPORTED_RUNTIME_METHODS='cwrap,HEAPF64,HEAPU32' \
  -o "$OUT/r8brain.mjs"

rm -f "$OUT/pffft_double.o"

echo "Built: $OUT/r8brain.mjs + $OUT/r8brain.wasm"

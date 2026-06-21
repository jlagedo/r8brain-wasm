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
# Configuration: full-precision double (Ooura FFT, the library default),
# WASM SIMD enabled, single-threaded (no pthreads) which is correct for Node.
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

emcc \
  "$VENDOR/DLL/r8bsrc.cpp" \
  "$HERE/r8b_wasm.cpp" \
  -I "$VENDOR/DLL" \
  -std=c++17 -O3 -flto \
  -msimd128 -msse2 \
  -DR8BSRC_DECL= \
  -DR8B_FASTTIMING=1 \
  -s MODULARIZE=1 \
  -s EXPORT_ES6=1 \
  -s ENVIRONMENT=node \
  -s ALLOW_MEMORY_GROWTH=0 \
  -s INITIAL_MEMORY=67108864 \
  -s EXPORT_NAME=createR8brain \
  -s EXPORTED_FUNCTIONS='_r8b_create,_r8b_delete,_r8b_clear,_r8b_inlen,_r8bw_process,_malloc,_free' \
  -s EXPORTED_RUNTIME_METHODS='cwrap,HEAPF64,HEAPU32' \
  -o "$OUT/r8brain.mjs"

echo "Built: $OUT/r8brain.mjs + $OUT/r8brain.wasm"

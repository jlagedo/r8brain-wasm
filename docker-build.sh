#!/usr/bin/env bash
#
# Builds the wasm module inside the official emscripten/emsdk container, so no
# Emscripten toolchain needs to be installed on the host. Produces the same
# dist/r8brain.mjs + dist/r8brain.wasm as running build.sh under a local emcc.
#
# Usage:  bash docker-build.sh   (from the repo root)
#
# Requires the vendor/ submodule to be checked out:
#   git submodule update --init
#
# Notes:
#  - The repo root is mounted at /src; build.sh runs from /src.
#  - We run as the host UID/GID so dist/ is owned by you, not root.
#  - Emscripten's cache and config are redirected into ./.emcache (which is
#    git-ignored) because the mapped user has no writable home in the container.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE="emscripten/emsdk:latest"

if [ ! -f "$HERE/vendor/r8brain-free-src/DLL/r8bsrc.cpp" ]; then
  echo "ERROR: submodule not checked out. Run: git submodule update --init" >&2
  exit 1
fi

mkdir -p "$HERE/.emcache"

docker run --rm \
  -v "$HERE:/src" \
  -w /src \
  --user "$(id -u):$(id -g)" \
  -e HOME=/src/.emcache \
  -e EM_CACHE=/src/.emcache \
  -e EM_CONFIG=/src/.emcache/.emscripten \
  "$IMAGE" \
  bash build.sh

echo "Done. Artifacts in $HERE/dist/"
